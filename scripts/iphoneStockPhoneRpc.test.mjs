import test from "node:test";
import assert from "node:assert/strict";
import { createCatalogTestDatabase, signInAsOwner, signOut } from "./support/catalogTestDatabase.mjs";
import { buildIphonePlan, compareIphoneList, emptyDecisions, parseIphoneList } from "../src/lib/iphoneStockUpdate.ts";

// Executes the REAL migrations (all of them, including 202610210001_iphone_stock_update_per_phone.sql) in an in-memory
// Postgres (PGlite). No DEV / PROD database is involved.

const BRANDS = [{ name: "Apple" }, { name: "Samsung" }];

async function makeDb() {
  const db = await createCatalogTestDatabase();
  await signInAsOwner(db);
  await db.exec(`
    insert into public.brands (name, slug, is_active, data_class)
    select v.name, v.slug, true, 'real' from (values ('Apple', 'apple-test'), ('Samsung', 'samsung-test')) as v(name, slug)
    where not exists (select 1 from public.brands b where lower(b.name) = lower(v.name));
    update public.brands set is_active = true, data_class = 'real' where lower(name) in ('apple', 'samsung');
  `);
  const ids = {};
  const product = async (key, title, brand = "Apple") => {
    ids[key] = (await db.query(
      `insert into public.products (brand_id, category_id, title, slug, publication_status, data_class)
       select b.id, c.id, $1, $2, 'draft', 'real' from public.brands b, public.categories c
       where b.name = $3 and b.data_class = 'real' and c.slug = 'mobile-phones' limit 1 returning id`,
      [title, `${key.toLowerCase()}-slug`, brand],
    )).rows[0].id;
    return ids[key];
  };
  const variant = async (key, productKey, storage, color, price, { active = true, condition = "used", pta = "approved", stock = 5, ram = null, bh = null, grade = null } = {}) => {
    const row = (await db.query(
      `insert into public.product_variants (product_id, sku, ram_display, storage_display, color_finish, price_minor, pta_status, condition, delivery_scope, is_active, battery_health_percent, condition_grade)
       values ($1, '', $2, $3, $4, $5, $6::public.pta_status, $7::public.product_condition, 'karachi_only', $8, $9, $10) returning id`,
      [ids[productKey], ram, storage, color, price, pta, condition, active, bh, grade],
    )).rows[0];
    ids[key] = row.id;
    if (stock) await db.query(`insert into public.inventory_movements (variant_id, quantity_delta, reason, reference) values ($1, $2, 'initial', 'seed')`, [row.id, stock]);
  };

  await product("used", "Apple iPhone 15 Pro Max (Used)");
  await variant("same", "used", "256 GB", "Blue", 27400000, { stock: 3 });
  await variant("price", "used", "256 GB", "Natural", 28500000, { stock: 2 });
  await variant("hidden", "used", "512 GB", "Blue", 30000000, { active: false, stock: 4 });
  await variant("missing", "used", "1 TB", "Black", 33000000, { stock: 6 });

  // DEV-like test product: plain title holding a Used variant (must never be touched).
  await product("plain", "Apple iPhone 15 Pro");
  await variant("plainUsed", "plain", "256 GB", "Natural", 26500000, { pta: "not_approved", stock: 10, bh: 89, grade: "A++" });

  await product("newPhone", "Apple iPhone 16");
  await variant("newBlack", "newPhone", "256 GB", "Black", 30000000, { condition: "brand_new" });

  await product("android", "Samsung A57", "Samsung");
  await variant("androidBlack", "android", "256 GB", "Black", 15000000, { condition: "brand_new", ram: "8 GB" });
  return { db, ids };
}

const call = async (db, payload) => (await db.query(`select public.apply_iphone_stock_phone($1::jsonb) as r`, [JSON.stringify(payload)])).rows[0].r;
const stockOf = async (db, id) => Number((await db.query(`select public.current_inventory($1) as s`, [id])).rows[0].s);
const variantRow = async (db, id) => (await db.query(`select * from public.product_variants where id = $1`, [id])).rows[0];

async function expectedFor(db, productId) {
  const rows = (await db.query(`select id, price_minor, is_active from public.product_variants where product_id = $1 order by id`, [productId])).rows;
  return { variants: rows.map((row) => ({ id: row.id, price_minor: Number(row.price_minor), is_active: row.is_active })) };
}

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

async function rejects(db, payload, pattern) {
  const before = await everything(db);
  await assert.rejects(call(db, payload), (error) => {
    assert.match(error.message, pattern);
    assert.doesNotMatch(error.message, /malformed array literal/);
    return true;
  });
  assert.deepEqual(await everything(db), before, "nothing may change when the call fails");
}

const ADD = { kind: "add_variant", storage: "256 GB", color: "Black", price_minor: 27500000, stock: 20, pta_status: "approved", condition: "used" };

test("price only keeps stock; a hidden listed variant is shown with the new price and keeps its stock; a new variant opens at 20; missing variants untouched", async () => {
  const { db, ids } = await makeDb();
  const before = await everything(db);
  const missingBefore = await variantRow(db, ids.missing);
  const result = await call(db, {
    product_id: ids.used,
    condition: "used",
    expected: await expectedFor(db, ids.used),
    steps: [
      { kind: "price", variant_id: ids.price, from_minor: 28500000, to_minor: 28000000 },
      { kind: "show", variant_id: ids.hidden, from_minor: 30000000, to_minor: 29800000 },
      ADD,
    ],
  });
  assert.equal(result.status, "updated");
  assert.equal(result.price_updates, 2);
  assert.equal(result.shown, 1);
  assert.equal(result.new_variants.length, 1);

  assert.equal(Number((await variantRow(db, ids.price)).price_minor), 28000000);
  assert.equal(await stockOf(db, ids.price), 2, "price change keeps stock");
  const hidden = await variantRow(db, ids.hidden);
  assert.equal(hidden.is_active, true);
  assert.equal(Number(hidden.price_minor), 29800000);
  assert.equal(await stockOf(db, ids.hidden), 4, "shown again without a stock reset");
  assert.equal(await stockOf(db, ids.same), 3);
  assert.deepEqual(await variantRow(db, ids.missing), missingBefore, "a variant missing from the list is not touched at all");
  assert.equal(await stockOf(db, ids.missing), 6);

  const created = await variantRow(db, result.new_variants[0].id);
  assert.match(created.sku, /^MB[0-9]{3}$/);
  assert.equal(created.condition, "used");
  assert.equal(created.pta_status, "approved");
  assert.equal(created.ram_display, null);
  assert.equal(created.condition_grade, null);
  assert.equal(created.battery_health_percent, null);
  assert.equal(created.battery_cycle_count, null);
  assert.equal(created.sim_configuration, null);
  assert.equal(created.warranty_override, null);
  assert.equal(created.delivery_scope, "karachi_only");
  assert.equal(await stockOf(db, created.id), 20);

  const after = await everything(db);
  assert.deepEqual(after.products, before.products, "products are never written");
  assert.equal(after.movements.length, before.movements.length + 1, "exactly one ledger row: the new variant's opening stock");
  const ledger = after.movements.at(-1);
  assert.equal(ledger.reason, "initial");
  assert.equal(ledger.reference, "iphone_stock_update");
  assert.equal(ledger.quantity_delta, 20);
  // Every other phone is untouched.
  for (const key of ["plainUsed", "newBlack", "androidBlack"]) {
    assert.deepEqual(after.variants.find((row) => row.id === ids[key]), before.variants.find((row) => row.id === ids[key]));
  }
});

test("a hidden variant listed at the same price is only shown again", async () => {
  const { db, ids } = await makeDb();
  await call(db, { product_id: ids.used, condition: "used", expected: await expectedFor(db, ids.used), steps: [{ kind: "show", variant_id: ids.hidden, from_minor: 30000000, to_minor: 30000000 }] });
  const row = await variantRow(db, ids.hidden);
  assert.equal(row.is_active, true);
  assert.equal(Number(row.price_minor), 30000000);
  assert.equal(await stockOf(db, ids.hidden), 4);
});

test("New / Used isolation: the plain-title Used product, a New product with a Used list and an Android phone are refused", async () => {
  const { db, ids } = await makeDb();
  await rejects(db, { product_id: ids.plain, condition: "used", expected: await expectedFor(db, ids.plain), steps: [{ kind: "price", variant_id: ids.plainUsed, from_minor: 26500000, to_minor: 26000000 }] }, /iphone_stock_phone_wrong_listing: "Apple iPhone 15 Pro" is not the Used listing/);
  await rejects(db, { product_id: ids.plain, condition: "brand_new", expected: await expectedFor(db, ids.plain), steps: [{ kind: "price", variant_id: ids.plainUsed, from_minor: 26500000, to_minor: 26000000 }] }, /has variants that are not New/);
  await rejects(db, { product_id: ids.newPhone, condition: "used", expected: await expectedFor(db, ids.newPhone), steps: [{ ...ADD }] }, /not the Used listing/);
  await rejects(db, { product_id: ids.used, condition: "brand_new", expected: await expectedFor(db, ids.used), steps: [{ ...ADD, condition: "brand_new" }] }, /not the New listing/);
  await rejects(db, { product_id: ids.android, condition: "brand_new", expected: await expectedFor(db, ids.android), steps: [{ kind: "price", variant_id: ids.androidBlack, from_minor: 15000000, to_minor: 14000000 }] }, /iphone_stock_phone_not_iphone/);
});

test("all or nothing: one bad step saves nothing for the phone", async () => {
  const { db, ids } = await makeDb();
  const expected = await expectedFor(db, ids.used);
  await rejects(db, { product_id: ids.used, condition: "used", expected, steps: [{ kind: "price", variant_id: ids.price, from_minor: 28500000, to_minor: 28000000 }, { ...ADD, stock: 30 }] }, /opening stock must be 20/);
  await rejects(db, { product_id: ids.used, condition: "used", expected, steps: [{ kind: "price", variant_id: ids.price, from_minor: 28500000, to_minor: 28000000 }, { ...ADD, color: "blue" }] }, /already exists on this phone/);
  await rejects(db, { product_id: ids.used, condition: "used", expected, steps: [ADD, { ...ADD }] }, /listed twice/);
  await rejects(db, { product_id: ids.used, condition: "used", expected, steps: [{ ...ADD, condition: "brand_new" }] }, /condition must be used/);
  await rejects(db, { product_id: ids.used, condition: "used", expected, steps: [{ ...ADD, pta_status: null }] }, /PTA must be given/);
});

test("there is no hide, no stock step and no price step for a hidden variant", async () => {
  const { db, ids } = await makeDb();
  const expected = await expectedFor(db, ids.used);
  await rejects(db, { product_id: ids.used, condition: "used", expected, steps: [{ kind: "hide", variant_ids: [ids.missing] }] }, /Unknown step kind "hide"/);
  await rejects(db, { product_id: ids.used, condition: "used", expected, steps: [{ kind: "set_stock", variant_id: ids.same, to_stock: 20 }] }, /Unknown step kind "set_stock"/);
  await rejects(db, { product_id: ids.used, condition: "used", expected, steps: [{ kind: "price", variant_id: ids.hidden, from_minor: 30000000, to_minor: 29000000 }] }, /is hidden; use a show step/);
  await rejects(db, { product_id: ids.used, condition: "used", expected, steps: [{ kind: "show", variant_id: ids.same, from_minor: 27400000, to_minor: 27000000 }] }, /already visible/);
  await rejects(db, { product_id: ids.used, condition: "used", expected, steps: [{ kind: "price", variant_id: ids.newBlack, from_minor: 30000000, to_minor: 29000000 }] }, /does not belong to this phone/);
});

test("a phone changed since Check Changes is refused", async () => {
  const { db, ids } = await makeDb();
  const expected = await expectedFor(db, ids.used);
  await db.query(`update public.product_variants set price_minor = 28400000 where id = $1`, [ids.price]);
  await rejects(db, { product_id: ids.used, condition: "used", expected, steps: [{ kind: "price", variant_id: ids.price, from_minor: 28500000, to_minor: 28000000 }] }, /changed since Check Changes/);
  await rejects(db, { product_id: ids.used, condition: "used", expected: { variants: expected.variants.slice(1) }, steps: [ADD] }, /different set of variants/);
});

test("only an active catalog admin may call it; anon has no execute right", async () => {
  const { db, ids } = await makeDb();
  const expected = await expectedFor(db, ids.used);
  await signOut(db);
  await rejects(db, { product_id: ids.used, condition: "used", expected, steps: [ADD] }, /iphone_stock_phone_admin_required/);
  const rights = (await db.query(`select has_function_privilege('anon', 'public.apply_iphone_stock_phone(jsonb)', 'execute') as anon, has_function_privilege('authenticated', 'public.apply_iphone_stock_phone(jsonb)', 'execute') as auth`)).rows[0];
  assert.deepEqual(rights, { anon: false, auth: true });
});

test("new phones from the Owner's sample go through the existing Create: drafts, (Used) titles, stock 20, blank facts, no duplicates", async () => {
  const { db } = await makeDb();
  const sample = "IPhone 14Pro Max 1TB\nPurple @265,000\nBlack @263,000\n\nIPhone 14Pro Max 256Gb\nPurple @230,000\nWhite@230,000";
  const comparison = compareIphoneList(parseIphoneList(sample, BRANDS), [], { condition: "used", pta: "approved" }, emptyDecisions());
  const plan = buildIphonePlan(comparison, []);
  assert.equal(plan.phones.length, 1);
  const payload = plan.phones[0].payload;
  const before = (await db.query(`select count(*)::int as n from public.products`)).rows[0].n;
  const result = (await db.query(`select public.apply_catalog_bulk_import_v2($1::jsonb) as r`, [JSON.stringify({ products: [payload] })])).rows[0].r;
  assert.equal(result.products[0].action, "Create");
  const created = (await db.query(`select * from public.products where id = $1`, [result.products[0].id])).rows[0];
  assert.equal(created.title, "Apple iPhone 14 Pro Max (Used)");
  assert.equal(created.slug, "apple-iphone-14-pro-max-used");
  assert.equal(created.publication_status, "draft");
  assert.equal((await db.query(`select count(*)::int as n from public.products`)).rows[0].n, before + 1);
  const variants = (await db.query(`select * from public.product_variants where product_id = $1 order by sku`, [created.id])).rows;
  assert.equal(variants.length, 4);
  for (const row of variants) {
    assert.match(row.sku, /^MB[0-9]{3}$/);
    assert.equal(row.condition, "used");
    assert.equal(row.pta_status, "approved");
    assert.equal(row.ram_display, null);
    assert.equal(row.condition_grade, null);
    assert.equal(row.battery_health_percent, null);
    assert.equal(row.battery_cycle_count, null);
    assert.equal(row.sim_configuration, null);
    assert.equal(row.warranty_override, null);
    assert.equal(row.delivery_scope, "karachi_only");
    assert.equal(await stockOf(db, row.id), 20);
  }
  // The same title again is refused by the existing Create (no duplicate listing).
  await assert.rejects(db.query(`select public.apply_catalog_bulk_import_v2($1::jsonb) as r`, [JSON.stringify({ products: [payload] })]), /already exists/);

  // The new (Used) product then updates through the new function like any other.
  const black = variants.find((row) => row.color_finish === "Black");
  const updated = await call(db, { product_id: created.id, condition: "used", expected: await expectedFor(db, created.id), steps: [{ kind: "price", variant_id: black.id, from_minor: Number(black.price_minor), to_minor: 26000000 }] });
  assert.equal(updated.status, "updated");
  assert.equal(await stockOf(db, black.id), 20);
});

// ---------------------------------------------------------------------------
// Dual Physical SIM (202610210002)
// ---------------------------------------------------------------------------

test("SIM constraint: all five values and NULL are stored; anything else is refused", async () => {
  const { db, ids } = await makeDb();
  const set = (value) => db.query(`update public.product_variants set sim_configuration = $1 where id = $2`, [value, ids.same]);
  for (const value of ["physical_sim", "esim", "physical_plus_esim", "dual_esim", "dual_physical_sim", null]) {
    await set(value);
    assert.equal((await variantRow(db, ids.same)).sim_configuration, value);
  }
  for (const value of ["physical_dual", "Dual Physical SIM", "two_physical"]) await assert.rejects(set(value), /variants_sim_configuration_valid/, value);
});

const sampleCreate = (sim) => ({
  products: [{
    source: "test", action: "Create", product_type: "Mobile Phone", brand: "Apple", category: "Mobile Phones", title: "Apple iPhone 13 (Used)",
    variants: [
      { source: "Black", ram: null, storage: "256 GB", color: "Black", price_minor: 12000000, stock: 20, pta_status: "approved", condition: "used", sim_configuration: sim, warranty: null, delivery_scope: "karachi_only" },
      { source: "White", ram: null, storage: "128 GB", color: "White", price_minor: 10000000, stock: 20, pta_status: "approved", condition: "used", sim_configuration: null, warranty: null, delivery_scope: "karachi_only" },
    ],
  }],
});

test("Bulk Import Create stores dual_physical_sim; a blank SIM stays NULL; an unknown SIM is refused with nothing saved", async () => {
  const { db } = await makeDb();
  const before = await everything(db);
  await assert.rejects(db.query(`select public.apply_catalog_bulk_import_v2($1::jsonb)`, [JSON.stringify(sampleCreate("physical_dual"))]), /Unknown SIM Configuration "physical_dual"/);
  assert.deepEqual(await everything(db), before);
  const result = (await db.query(`select public.apply_catalog_bulk_import_v2($1::jsonb) as r`, [JSON.stringify(sampleCreate("dual_physical_sim"))])).rows[0].r;
  const rows = (await db.query(`select color_finish, sim_configuration from public.product_variants where product_id = $1 order by color_finish`, [result.products[0].id])).rows;
  assert.deepEqual(rows, [{ color_finish: "Black", sim_configuration: "dual_physical_sim" }, { color_finish: "White", sim_configuration: null }]);
});

test("Bulk Import keeps its security: only an active admin may call it, anon has no execute right", async () => {
  const { db } = await makeDb();
  await signOut(db);
  await assert.rejects(db.query(`select public.apply_catalog_bulk_import_v2($1::jsonb)`, [JSON.stringify(sampleCreate("dual_physical_sim"))]), /catalog_admin_required/);
  const rights = (await db.query(`select has_function_privilege('anon', 'public.apply_catalog_bulk_import_v2(jsonb)', 'execute') as anon, (select prosecdef from pg_proc where proname = 'apply_catalog_bulk_import_v2') as definer, (select proconfig from pg_proc where proname = 'apply_catalog_bulk_import_v2') as config`)).rows[0];
  assert.equal(rights.anon, false);
  assert.equal(rights.definer, true);
  assert.deepEqual(rights.config, ['search_path=""']);
});

test("iPhone new variant with dual_physical_sim: stored as listed, stock 20; unknown SIM refused; existing SIM never changed", async () => {
  const { db, ids } = await makeDb();
  await db.query(`update public.product_variants set sim_configuration = 'physical_sim' where id = $1`, [ids.price]);
  const expected = await expectedFor(db, ids.used);
  await rejects(db, { product_id: ids.used, condition: "used", expected, steps: [{ ...ADD, sim_configuration: "physical_dual" }] }, /unknown SIM configuration "physical_dual"/);
  const result = await call(db, {
    product_id: ids.used,
    condition: "used",
    expected,
    steps: [{ kind: "price", variant_id: ids.price, from_minor: 28500000, to_minor: 28000000 }, { ...ADD, sim_configuration: "dual_physical_sim" }],
  });
  const created = await variantRow(db, result.new_variants[0].id);
  assert.equal(created.sim_configuration, "dual_physical_sim");
  assert.equal(await stockOf(db, created.id), 20);
  assert.equal(created.condition_grade, null);
  assert.equal(created.warranty_override, null);
  assert.equal((await variantRow(db, ids.price)).sim_configuration, "physical_sim", "a price update never changes the stored SIM");
});
