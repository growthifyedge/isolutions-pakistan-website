import test from "node:test";
import assert from "node:assert/strict";
import { createCatalogTestDatabase, signInAsOwner, signOut } from "./support/catalogTestDatabase.mjs";
import { buildGadgetPlan, compareGadgetSheet } from "../src/lib/gadgetStockUpdate.ts";

// Executes the REAL migrations (all of them, including 202610260001_gadget_stock_update_and_publication.sql) in an
// in-memory Postgres (PGlite). No DEV / PROD database is involved.

const COMMERCIAL = "variant_commercial_facts_unresolved";
const IMAGE = "primary_product_media_required";

async function makeDb(options) {
  const db = await createCatalogTestDatabase(options);
  await signInAsOwner(db);
  await db.exec(`
    insert into public.brands (name, slug, is_active, data_class)
    select v.name, v.slug, true, 'real' from (values ('Apple', 'apple-test'), ('Samsung', 'samsung-test'), ('Anker', 'anker-test')) as v(name, slug)
    where not exists (select 1 from public.brands b where lower(b.name) = lower(v.name));
    update public.brands set is_active = true, data_class = 'real' where lower(name) in ('apple', 'samsung', 'anker');
  `);
  let n = 0;
  const product = async (title, { category = "gadgets", brand = null, content = null, warranty = null, dataClass = "real" } = {}) =>
    (await db.query(
      `insert into public.products (brand_id, category_id, title, slug, content, publication_status, data_class, default_warranty)
       select (select id from public.brands where name = $3 and data_class = 'real' limit 1), c.id, $1, $2, $5, 'draft', $6::public.catalog_data_class, $7
       from public.categories c where c.slug = $4 returning id`,
      [title, `g-${(n += 1)}`, brand, category, content, dataClass, warranty],
    )).rows[0].id;
  const variant = async (productId, { price = 500000, compareAt = null, pta = "unknown", condition = "unknown", scope = "nationwide", active = true, stock = 7, warranty = null, color = null } = {}) => {
    const id = (await db.query(
      `insert into public.product_variants (product_id, sku, color_finish, price_minor, compare_at_price_minor, pta_status, condition, delivery_scope, is_active, warranty_override)
       values ($1, '', $2, $3, $4, $5::public.pta_status, $6::public.product_condition, $7::public.delivery_scope, $8, $9) returning id`,
      [productId, color, price, compareAt, pta, condition, scope, active, warranty],
    )).rows[0].id;
    if (stock) await db.query(`insert into public.inventory_movements (variant_id, quantity_delta, reason, reference) values ($1, $2, 'initial', 'seed')`, [id, stock]);
    return id;
  };
  const image = (productId) =>
    db.query(
      `insert into public.product_media (product_id, cloudinary_public_id, cloudinary_asset_id, cloudinary_version, secure_url, width, height, bytes, format, alt_text, is_primary)
       values ($1, $2, $3, 1, 'https://res.cloudinary.com/test/image/upload/v1/x.jpg', 1000, 1000, 1000, 'jpg', 'Front', true)`,
      [productId, `isolutions-test/products/${productId}/front-${(n += 1)}`, `asset-${n}`],
    );
  const spec = (productId) => db.query(`insert into public.product_specifications (product_id, specification_group, label, value, sort_order) values ($1, 'Build', 'Colour', 'Black', 0)`, [productId]);
  const call = async (payload) => (await db.query(`select public.apply_gadget_stock_product($1::jsonb) as r`, [JSON.stringify(payload)])).rows[0].r;
  const validate = async (id) => (await db.query(`select is_valid, errors from public.validate_product_for_publication($1)`, [id])).rows[0];
  const publish = (id) => db.query(`update public.products set publication_status = 'published' where id = $1`, [id]);
  return { db, product, variant, image, spec, call, validate, publish };
}

const stockOf = async (db, id) => Number((await db.query(`select public.current_inventory($1) as s`, [id])).rows[0].s);

async function everything(db) {
  const q = async (sql) => (await db.query(sql)).rows;
  return {
    products: await q(`select * from public.products order by id`),
    variants: await q(`select * from public.product_variants order by id`),
    movements: await q(`select * from public.inventory_movements order by id`),
    media: await q(`select * from public.product_media order by id`),
    specs: await q(`select * from public.product_specifications order by id`),
  };
}

async function rejects(env, payload, pattern) {
  const before = await everything(env.db);
  await assert.rejects(env.call(payload), (error) => {
    assert.match(error.message, pattern);
    return true;
  });
  assert.deepEqual(await everything(env.db), before, "nothing may change when the call fails");
}

const payloadFor = (productId, variantId, { title, content = null, price = 500000, steps }) => ({
  product_id: productId,
  expected: { title, content, variant: { id: variantId, price_minor: price, is_active: true } },
  steps,
});

// ---------------------------------------------------------------------------
// apply_gadget_stock_product
// ---------------------------------------------------------------------------

test("price + description are saved together; stock, visibility, status, media, specs and facts are untouched", async () => {
  const env = await makeDb();
  const id = await env.product("Anker PowerCore 10000", { content: "Old text\r\n", brand: "Anker" });
  const vid = await env.variant(id, { compareAt: 900000 });
  await env.image(id);
  await env.spec(id);
  await env.db.query(`update public.product_variants set warranty_override = 'Owner warranty' where id = $1`, [vid]);
  const before = await everything(env.db);

  const result = await env.call(payloadFor(id, vid, { title: "Anker PowerCore 10000", content: "Old text", steps: { price: { from_minor: 500000, to_minor: 650000 }, content: { to: "Colour: Black\n\nFast charging." } } }));
  assert.equal(result.status, "updated");
  assert.equal(result.price_updated, true);
  assert.equal(result.description_updated, true);

  const after = await everything(env.db);
  const p = after.products.find((row) => row.id === id);
  const v = after.variants.find((row) => row.id === vid);
  assert.equal(p.content, "Colour: Black\n\nFast charging.");
  assert.equal(Number(v.price_minor), 650000);
  assert.equal(await stockOf(env.db, vid), 7, "stock unchanged");
  assert.deepEqual(after.movements, before.movements, "no inventory movement written");
  assert.deepEqual(after.media, before.media);
  assert.deepEqual(after.specs, before.specs);
  const strip = (row) => { const { price_minor: _p, updated_at: _u, ...rest } = row; return rest; };
  assert.deepEqual(strip(v), strip(before.variants.find((row) => row.id === vid)), "only the price of the variant changed");
  const productStrip = (row) => { const { content: _c, updated_at: _u, updated_by: _b, ...rest } = row; return rest; };
  assert.deepEqual(productStrip(p), productStrip(before.products.find((row) => row.id === id)), "only the description of the product changed");
  assert.equal(p.publication_status, "draft");
});

test("price only keeps the saved description; description only keeps the price (blank description is never written)", async () => {
  const env = await makeDb();
  const id = await env.product("Desk Fan", { content: "Saved text" });
  const vid = await env.variant(id);
  await env.call(payloadFor(id, vid, { title: "Desk Fan", content: "Saved text", steps: { price: { from_minor: 500000, to_minor: 450000 } } }));
  assert.equal((await env.db.query(`select content from public.products where id = $1`, [id])).rows[0].content, "Saved text");

  await rejects(env, payloadFor(id, vid, { title: "Desk Fan", content: "Saved text", price: 450000, steps: { content: { to: "  \n " } } }), /blank description is never written/);
  await rejects(env, payloadFor(id, vid, { title: "Desk Fan", content: "Saved text", price: 450000, steps: { content: { to: "Saved text" } } }), /equals the saved one/);
  await env.call(payloadFor(id, vid, { title: "Desk Fan", content: "Saved text", price: 450000, steps: { content: { to: "New text" } } }));
  const row = (await env.db.query(`select p.content, v.price_minor from public.products p join public.product_variants v on v.product_id = p.id where p.id = $1`, [id])).rows[0];
  assert.deepEqual({ ...row, price_minor: Number(row.price_minor) }, { content: "New text", price_minor: 450000 });
  assert.equal(await stockOf(env.db, vid), 7);
});

test("atomic: an invalid price rolls back the description too", async () => {
  const env = await makeDb();
  const id = await env.product("Lamp", { content: null });
  const vid = await env.variant(id, { compareAt: 600000 });
  await rejects(env, payloadFor(id, vid, { title: "Lamp", steps: { price: { from_minor: 500000, to_minor: 700000 }, content: { to: "A lamp." } } }), /not below the compare-at price/);
  await rejects(env, payloadFor(id, vid, { title: "Lamp", steps: { price: { from_minor: 500000, to_minor: 0 }, content: { to: "A lamp." } } }), /positive amount/);
});

test("only gadgets: other categories, development records and unknown products are refused", async () => {
  const env = await makeDb();
  const phone = await env.product("Samsung A57", { category: "mobile-phones", brand: "Samsung" });
  const phoneV = await env.variant(phone, { pta: "approved", condition: "brand_new", scope: "karachi_only" });
  await rejects(env, payloadFor(phone, phoneV, { title: "Samsung A57", steps: { price: { from_minor: 500000, to_minor: 400000 } } }), /gadget_stock_product_not_gadget/);
  const tablet = await env.product("iPad Air", { category: "tablets", brand: "Apple" });
  const tabletV = await env.variant(tablet);
  await rejects(env, payloadFor(tablet, tabletV, { title: "iPad Air", steps: { content: { to: "x" } } }), /gadget_stock_product_not_gadget/);
  const dev = await env.product("Test Gadget", { dataClass: "development" });
  const devV = await env.variant(dev);
  await rejects(env, payloadFor(dev, devV, { title: "Test Gadget", steps: { content: { to: "x" } } }), /gadget_stock_product_not_gadget/);
  await rejects(env, payloadFor("00000000-0000-0000-0000-000000000000", devV, { title: "x", steps: { content: { to: "x" } } }), /gadget_stock_product_not_found/);
});

test("single visible variant only: several variants, no variant, a hidden variant or another variant id are refused", async () => {
  const env = await makeDb();
  const multi = await env.product("Smart Watch");
  const a = await env.variant(multi, { color: "Black" });
  await env.variant(multi, { color: "Silver" });
  await rejects(env, payloadFor(multi, a, { title: "Smart Watch", steps: { price: { from_minor: 500000, to_minor: 400000 } } }), /not_single_variant: "Smart Watch" has 2 variants/);
  const none = await env.product("Empty Gadget");
  await rejects(env, payloadFor(none, a, { title: "Empty Gadget", steps: { content: { to: "x" } } }), /has 0 variants/);
  const hidden = await env.product("Hidden Lamp");
  const h = await env.variant(hidden, { active: false });
  await rejects(env, { ...payloadFor(hidden, h, { title: "Hidden Lamp", steps: { content: { to: "x" } } }), expected: { title: "Hidden Lamp", content: null, variant: { id: h, price_minor: 500000, is_active: false } } }, /gadget_stock_product_hidden/);
  const other = await env.product("Cable");
  await env.variant(other);
  await rejects(env, payloadFor(other, a, { title: "Cable", steps: { content: { to: "x" } } }), /changed_since_check/);
});

test("changed since Check Changes: price, description, title or visibility differences are refused and nothing is written", async () => {
  const env = await makeDb();
  const id = await env.product("Speaker", { content: "Saved" });
  const vid = await env.variant(id);
  const steps = { price: { from_minor: 500000, to_minor: 550000 }, content: { to: "New" } };
  await rejects(env, payloadFor(id, vid, { title: "Speaker", content: "Saved", price: 490000, steps }), /changed_since_check/);
  await rejects(env, payloadFor(id, vid, { title: "Speaker", content: "Other", steps }), /changed_since_check/);
  await rejects(env, payloadFor(id, vid, { title: "Speaker", content: null, steps }), /changed_since_check/);
  await rejects(env, payloadFor(id, vid, { title: "speaker", content: "Saved", steps }), /changed_since_check/);
  const { content: _omit, ...noContent } = payloadFor(id, vid, { title: "Speaker", content: "Saved", steps }).expected;
  await rejects(env, { product_id: id, expected: noContent, steps }, /changed_since_check/);
  await rejects(env, payloadFor(id, vid, { title: "Speaker", content: "Saved", steps: { price: { from_minor: 480000, to_minor: 550000 } } }), /Price changed since Check Changes/);
  await env.db.query(`update public.product_variants set is_active = false where id = $1`, [vid]);
  await rejects(env, payloadFor(id, vid, { title: "Speaker", content: "Saved", steps }), /changed_since_check/);
});

test("bad payloads are refused: no steps, unknown steps, stock or visibility steps", async () => {
  const env = await makeDb();
  const id = await env.product("Router");
  const vid = await env.variant(id);
  await rejects(env, payloadFor(id, vid, { title: "Router", steps: {} }), /nothing to change/);
  await rejects(env, payloadFor(id, vid, { title: "Router", steps: { stock: { to: 20 } } }), /steps may only be price and content/);
  await rejects(env, payloadFor(id, vid, { title: "Router", steps: { content: { to: "x" }, is_active: false } }), /steps may only be price and content/);
  await rejects(env, { product_id: "nope", expected: { title: "Router", content: null, variant: { id: vid, price_minor: 500000, is_active: true } }, steps: { content: { to: "x" } } }, /invalid_payload/);
});

test("only an active catalog admin may call it; anon has no execute right (with Supabase default grants)", async () => {
  const env = await makeDb({ supabaseDefaultPrivileges: true });
  const id = await env.product("Fan");
  const vid = await env.variant(id);
  const payload = payloadFor(id, vid, { title: "Fan", steps: { content: { to: "x" } } });

  await signOut(env.db);
  await rejects(env, payload, /gadget_stock_product_admin_required/);
  const customer = (await env.db.query(`insert into auth.users (email) values ('customer@example.test') returning id`)).rows[0].id;
  await env.db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [customer]);
  await rejects(env, payload, /gadget_stock_product_admin_required/);

  const rights = (await env.db.query(`select has_function_privilege('anon', 'public.apply_gadget_stock_product(jsonb)', 'execute') as anon, has_function_privilege('authenticated', 'public.apply_gadget_stock_product(jsonb)', 'execute') as auth, (select prosecdef from pg_proc where proname = 'apply_gadget_stock_product') as definer, (select proconfig from pg_proc where proname = 'apply_gadget_stock_product') as config`)).rows[0];
  assert.deepEqual({ anon: rights.anon, auth: rights.auth, definer: rights.definer }, { anon: false, auth: true, definer: true });
  assert.ok(rights.config.includes("search_path=\"\""));
});

test("end to end with the client plan: v2 Create (draft, stock 20) then the description; a retry never creates twice", async () => {
  const env = await makeDb();
  const rows = [{ rowNumber: 2, name: "Baseus  Cable", priceText: "1200", priceMinor: 120000, description: "Braided, 1 m." }];
  const [item] = buildGadgetPlan(compareGadgetSheet(rows, [], [])).items;
  assert.equal(item.kind, "new");
  const created = (await env.db.query(`select public.apply_catalog_bulk_import_v2($1::jsonb) as r`, [JSON.stringify({ products: [item.payload] })])).rows[0].r;
  const productId = created.products[0].id;
  const v = (await env.db.query(`select * from public.product_variants where product_id = $1`, [productId])).rows;
  assert.equal(v.length, 1);
  assert.match(v[0].sku, /^GD[0-9]{3}$/);
  assert.deepEqual([v[0].pta_status, v[0].condition, v[0].warranty_override, v[0].delivery_scope], ["unknown", "unknown", null, "nationwide"]);
  assert.equal(await stockOf(env.db, v[0].id), 20);
  const p = (await env.db.query(`select title, publication_status, content, brand_id from public.products where id = $1`, [productId])).rows[0];
  assert.deepEqual(p, { title: "Baseus  Cable", publication_status: "draft", content: null, brand_id: null });

  await env.call({ product_id: productId, expected: { title: item.productTitle, content: null, variant: { id: v[0].id, price_minor: 120000, is_active: true } }, steps: { content: { to: item.description } } });
  assert.equal((await env.db.query(`select content from public.products where id = $1`, [productId])).rows[0].content, "Braided, 1 m.");
  assert.equal(await stockOf(env.db, v[0].id), 20);

  await assert.rejects(env.db.query(`select public.apply_catalog_bulk_import_v2($1::jsonb)`, [JSON.stringify({ products: [item.payload] })]), /already exists/);
  assert.equal(Number((await env.db.query(`select count(*) as n from public.products where lower(title) = 'baseus  cable'`)).rows[0].n), 1);
});

// ---------------------------------------------------------------------------
// Publishing rule
// ---------------------------------------------------------------------------

test("gadget publishes without PTA, condition or warranty when it has a price, delivery and a primary image; publishing stays a separate Owner step", async () => {
  const env = await makeDb();
  const id = await env.product("Desk Fan", { content: "Quiet." });
  const vid = await env.variant(id);
  await env.image(id);
  assert.deepEqual(await env.validate(id), { is_valid: true, errors: [] });
  assert.equal((await env.db.query(`select publication_status from public.products where id = $1`, [id])).rows[0].publication_status, "draft", "nothing publishes automatically");
  await env.publish(id);
  const row = (await env.db.query(`select p.publication_status, v.pta_status, v.condition, v.warranty_override, p.default_warranty from public.products p join public.product_variants v on v.product_id = p.id where v.id = $1`, [vid])).rows[0];
  assert.deepEqual(row, { publication_status: "published", pta_status: "unknown", condition: "unknown", warranty_override: null, default_warranty: null }, "no fact is invented");
});

test("gadget keeps the other blockers: image, price, delivery, active variant, inactive brand, development record", async () => {
  const env = await makeDb();
  const noImage = await env.product("No Image");
  await env.variant(noImage);
  assert.deepEqual(await env.validate(noImage), { is_valid: false, errors: [IMAGE] });
  await assert.rejects(env.publish(noImage), /product_publication_validation_failed/);

  const free = await env.product("Free Gadget");
  await env.variant(free, { price: 0 });
  await env.image(free);
  assert.deepEqual((await env.validate(free)).errors, [COMMERCIAL]);

  const noScope = await env.product("No Delivery");
  await env.variant(noScope, { scope: null });
  await env.image(noScope);
  assert.deepEqual((await env.validate(noScope)).errors, [COMMERCIAL]);

  const hidden = await env.product("Hidden Gadget");
  await env.variant(hidden, { active: false });
  await env.image(hidden);
  assert.deepEqual((await env.validate(hidden)).errors, ["active_variant_required"]);

  const branded = await env.product("Anker Charger", { brand: "Anker" });
  await env.variant(branded);
  await env.image(branded);
  await env.db.query(`update public.brands set is_active = false where name = 'Anker'`);
  assert.deepEqual((await env.validate(branded)).errors, ["active_real_brand_required"]);

  const dev = await env.product("Dev Gadget", { dataClass: "development" });
  await env.variant(dev);
  await env.image(dev);
  assert.deepEqual((await env.validate(dev)).errors, ["real_catalog_classification_required", COMMERCIAL], "the gadget exemption is for real products only");
});

test("every other category keeps its rules: Android, New / Used iPhone, accessories; tablets and Apple laptops follow 202610270001", async () => {
  const env = await makeDb();
  const listing = async (title, category, brand, facts) => {
    const id = await env.product(title, { category, brand });
    await env.variant(id, facts);
    await env.image(id);
    return id;
  };
  const unset = { pta: "unknown", condition: "unknown", scope: "nationwide" };
  for (const [title, category, brand, scope] of [
    ["Samsung A57", "mobile-phones", "Samsung", "karachi_only"],
    ["Apple iPhone 16", "mobile-phones", "Apple", "karachi_only"],
    ["Apple 20W Charger", "mobile-accessories", "Apple", "nationwide"],
  ]) {
    assert.deepEqual((await env.validate(await listing(title, category, brand, { ...unset, scope }))).errors, [COMMERCIAL], `${title}: unset facts still block`);
    assert.deepEqual((await env.validate(await listing(`${title} W`, category, brand, { pta: "approved", condition: "brand_new", scope }))).errors, [COMMERCIAL], `${title}: warranty still required`);
    assert.deepEqual((await env.validate(await listing(`${title} OK`, category, brand, { pta: "approved", condition: "brand_new", scope, warranty: "1 Year" }))).errors, [], `${title}: complete facts publish`);
  }
  // Tablets & MacBooks (Gadgets children, migration 202610270001): warranty optional; unset PTA / condition still block.
  for (const [title, category] of [["Apple iPad Air", "tablets"], ["Apple MacBook Air", "laptops"]]) {
    assert.deepEqual((await env.validate(await listing(title, category, "Apple", unset))).errors, [COMMERCIAL], `${title}: unset facts still block`);
    assert.deepEqual((await env.validate(await listing(`${title} W`, category, "Apple", { pta: "not_applicable", condition: "brand_new", scope: "karachi_only" }))).errors, [], `${title}: no warranty needed`);
  }
  const used = await env.product("Apple iPhone 13 (Used)", { category: "mobile-phones", brand: "Apple" });
  await env.variant(used, { pta: "approved", condition: "used", scope: "karachi_only" });
  await env.image(used);
  assert.deepEqual(await env.validate(used), { is_valid: true, errors: [] }, "Used iPhone: still no warranty needed");
  const usedUnknownPta = await env.product("Apple iPhone 14 (Used)", { category: "mobile-phones", brand: "Apple" });
  await env.variant(usedUnknownPta, { pta: "unknown", condition: "used", scope: "karachi_only" });
  await env.image(usedUnknownPta);
  assert.deepEqual((await env.validate(usedUnknownPta)).errors, [COMMERCIAL], "Used iPhone: PTA still required");
});
