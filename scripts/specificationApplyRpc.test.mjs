import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createCatalogTestDatabase, signInAsOwner, signOut } from "./support/catalogTestDatabase.mjs";

// Executes the REAL migrations (including 202610230001_apply_product_specifications.sql) in an in-memory Postgres
// (PGlite). No DEV / PROD database is involved.

async function makeDb() {
  const db = await createCatalogTestDatabase();
  await signInAsOwner(db);
  let n = 0;
  const product = async (title, category) =>
    (await db.query(
      `insert into public.products (category_id, title, slug, publication_status, data_class)
       select id, $1, $2, 'draft', 'real' from public.categories where slug = $3 returning id`,
      [title, `spec-test-${(n += 1)}`, category],
    )).rows[0].id;
  const spec = async (productId, group, label, value, order) =>
    (await db.query(`insert into public.product_specifications (product_id, specification_group, label, value, sort_order) values ($1, $2, $3, $4, $5) returning id`, [productId, group, label, value, order])).rows[0].id;
  const specs = async (productId) =>
    (await db.query(`select id, specification_group, label, value, sort_order from public.product_specifications where product_id = $1 order by sort_order, id`, [productId])).rows;
  const apply = async (productId, inserts = [], updates = []) =>
    (await db.query(`select public.apply_product_specifications($1, $2::jsonb, $3::jsonb) as r`, [productId, JSON.stringify(inserts), JSON.stringify(updates)])).rows[0].r;
  return { db, product, spec, specs, apply };
}

test("new specifications and an approved overwrite are saved together in one call; sort_order continues; nothing deleted", async () => {
  const { product, spec, specs, apply } = await makeDb();
  const phone = await product("Apple iPhone 13 (Used)", "mobile-phones");
  const battery = await spec(phone, "Battery", "Battery Capacity", "3200 mAh", 0);
  await spec(phone, "Display", "Screen Size", "6.1 inches", 1);
  const result = await apply(phone, [{ specification_group: "Camera", label: "Main Camera", value: "12 MP" }, { specification_group: "Build", label: "Weight", value: "174 g" }], [{ id: battery, expected_value: "3200 mAh", value: "3240 mAh" }]);
  assert.deepEqual(result, { product_id: phone, inserted: 2, updated: 1 });
  assert.deepEqual((await specs(phone)).map(({ specification_group, label, value, sort_order }) => [specification_group, label, value, sort_order]), [
    ["Battery", "Battery Capacity", "3240 mAh", 0],
    ["Display", "Screen Size", "6.1 inches", 1],
    ["Camera", "Main Camera", "12 MP", 2],
    ["Build", "Weight", "174 g", 3],
  ]);
});

test("a stale overwrite rolls back the whole product: the inserts of the same call are not saved", async () => {
  const { product, spec, specs, apply } = await makeDb();
  const phone = await product("Samsung A57", "mobile-phones");
  const battery = await spec(phone, "Battery", "Battery Capacity", "5000 mAh", 0);
  const before = await specs(phone);
  await assert.rejects(
    apply(phone, [{ specification_group: "Camera", label: "Main Camera", value: "50 MP" }], [{ id: battery, expected_value: "4900 mAh", value: "5100 mAh" }]),
    /apply_product_specifications_stale/,
  );
  assert.deepEqual(await specs(phone), before, "nothing saved, nothing changed");
  // A valid overwrite already applied inside the call is undone when a later insert is refused.
  await assert.rejects(
    apply(phone, [{ specification_group: "Camera", label: "Main Camera", value: "50 MP" }, { specification_group: "Other", label: "battery capacity", value: "5000" }], [{ id: battery, expected_value: "5000 mAh", value: "5100 mAh" }]),
    /already exists/,
  );
  assert.deepEqual(await specs(phone), before, "the overwrite and the first insert were rolled back");
});

test("an insert of a label the product already has (any section, case / spacing ignored) rolls back the product", async () => {
  const { product, spec, specs, apply } = await makeDb();
  const tablet = await product("Apple iPad Air", "tablets");
  await spec(tablet, "Display", "Screen Size", "11 inches", 0);
  const before = await specs(tablet);
  await assert.rejects(apply(tablet, [{ specification_group: "Battery", label: "Battery", value: "28.6 Wh" }, { specification_group: "Other", label: "screen  size", value: "11 in" }]), /already exists/);
  await assert.rejects(apply(tablet, [{ specification_group: "Battery", label: "Battery", value: "28.6 Wh" }, { specification_group: "Battery", label: "Battery", value: "29 Wh" }]), /already exists/, "duplicate in one payload");
  assert.deepEqual(await specs(tablet), before);
});

test("invalid payloads are refused and save nothing", async () => {
  const { product, spec, specs, apply } = await makeDb();
  const laptop = await product("Apple MacBook Air M3", "laptops");
  const chip = await spec(laptop, "Performance", "Chipset", "Apple M3", 0);
  for (const [inserts, updates] of [
    [[{ specification_group: "", label: "Weight", value: "1.24 kg" }], []],
    [[{ specification_group: "Build", label: "Weight", value: "  " }], []],
    [[], [{ id: chip, expected_value: "Apple M3", value: "" }]],
    [[], [{ id: chip, value: "Apple M3 8-core" }]],
    [[], []],
  ])
    await assert.rejects(apply(laptop, inserts, updates), /invalid_payload/);
  await assert.rejects(apply("00000000-0000-0000-0000-000000000000", [{ specification_group: "Build", label: "Weight", value: "1 kg" }]), /product_not_found/);
  assert.deepEqual((await specs(laptop)).map((row) => row.value), ["Apple M3"]);
});

test("an update can never touch another product's row", async () => {
  const { product, spec, specs, apply } = await makeDb();
  const charger = await product("Apple 20W USB-C Charger", "mobile-accessories");
  const other = await product("Anker Power Bank", "gadgets");
  const foreign = await spec(other, "Battery", "Capacity", "10000 mAh", 0);
  await assert.rejects(apply(charger, [], [{ id: foreign, expected_value: "10000 mAh", value: "20000 mAh" }]), /stale/);
  assert.equal((await specs(other))[0].value, "10000 mAh");
});

test("every category works the same: phones, tablets, laptops, accessories, gadgets", async () => {
  const { product, specs, apply } = await makeDb();
  for (const category of ["mobile-phones", "tablets", "laptops", "mobile-accessories", "gadgets"]) {
    const id = await product(`Test ${category}`, category);
    assert.deepEqual(await apply(id, [{ specification_group: "Other", label: "Warranty Card", value: "Included" }]), { product_id: id, inserted: 1, updated: 0 });
    assert.equal((await specs(id)).length, 1);
  }
});

test("only catalog admins can save; anon cannot execute the function", async () => {
  const { db, product, specs, apply } = await makeDb();
  const phone = await product("Tecno Spark 50 Pro", "mobile-phones");
  await signOut(db);
  await assert.rejects(apply(phone, [{ specification_group: "Battery", label: "Battery Capacity", value: "6000 mAh" }]), /forbidden/);
  const grants = (await db.query(`select has_function_privilege('anon', 'public.apply_product_specifications(uuid, jsonb, jsonb)', 'execute') as anon, has_function_privilege('authenticated', 'public.apply_product_specifications(uuid, jsonb, jsonb)', 'execute') as authed`)).rows[0];
  assert.deepEqual(grants, { anon: false, authed: true });
  assert.equal((await specs(phone)).length, 0);
});

test("the migration writes only product_specifications and never deletes", async () => {
  const sql = (await readFile(new URL("../supabase/migrations/202610230001_apply_product_specifications.sql", import.meta.url), "utf8")).replace(/^--.*$/gm, "");
  assert.doesNotMatch(sql, /delete\s+from|truncate|drop\s+table|alter\s+table/i);
  assert.deepEqual([...sql.matchAll(/(insert\s+into|update)\s+public\.(\w+)/gi)].map((match) => match[2]), ["product_specifications", "product_specifications"]);
  assert.match(sql, /security invoker/);
  assert.match(sql, /revoke all on function public\.apply_product_specifications\(uuid, jsonb, jsonb\) from public, anon;/);
});
