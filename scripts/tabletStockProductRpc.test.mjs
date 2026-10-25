import test from "node:test";
import assert from "node:assert/strict";
import { createCatalogTestDatabase, signInAsOwner, signOut } from "./support/catalogTestDatabase.mjs";
import { buildTabletPlan, compareTabletList, emptyDecisions, parseTabletList } from "../src/lib/tabletStockUpdate.ts";

// Executes the REAL migrations (all of them, including 202610270001_tablet_macbook_stock_update_and_publication.sql) in an
// in-memory Postgres (PGlite). No DEV / PROD database is involved.

const COMMERCIAL = "variant_commercial_facts_unresolved";
const LAPTOP_BRAND = "laptops_apple_brand_required";

async function makeDb() {
  const db = await createCatalogTestDatabase();
  await signInAsOwner(db);
  await db.exec(`
    insert into public.brands (name, slug, is_active, data_class)
    select v.name, v.slug, true, 'real' from (values ('Apple', 'apple-test'), ('Samsung', 'samsung-test'), ('Lenovo', 'lenovo-test')) as v(name, slug)
    where not exists (select 1 from public.brands b where lower(b.name) = lower(v.name));
    update public.brands set is_active = true, data_class = 'real' where lower(name) in ('apple', 'samsung', 'lenovo');
  `);
  let n = 0;
  const product = async (title, { category = "tablets", brand = "Samsung", warranty = null } = {}) =>
    (await db.query(
      `insert into public.products (brand_id, category_id, title, slug, publication_status, data_class, default_warranty)
       select (select id from public.brands where name = $3 and data_class = 'real' limit 1), c.id, $1, $2, 'draft', 'real', $5
       from public.categories c where c.slug = $4 returning id`,
      [title, `t-${(n += 1)}`, brand, category, warranty],
    )).rows[0].id;
  const variant = async (productId, { ram = "4 GB", storage = "64 GB", color = null, price = 4000000, pta = "not_applicable", condition = "brand_new", scope = "karachi_only", active = true, stock = 7, warranty = null } = {}) => {
    const id = (await db.query(
      `insert into public.product_variants (product_id, sku, ram_display, storage_display, color_finish, price_minor, pta_status, condition, delivery_scope, is_active, warranty_override)
       values ($1, '', $2, $3, $4, $5, $6::public.pta_status, $7::public.product_condition, $8::public.delivery_scope, $9, $10) returning id`,
      [productId, ram, storage, color, price, pta, condition, scope, active, warranty],
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
  const call = async (payload) => (await db.query(`select public.apply_tablet_stock_product($1::jsonb) as r`, [JSON.stringify(payload)])).rows[0].r;
  const validate = async (id) => (await db.query(`select is_valid, errors from public.validate_product_for_publication($1)`, [id])).rows[0];
  const expectedOf = async (productId) =>
    (await db.query(`select id, price_minor, is_active from public.product_variants where product_id = $1 order by id`, [productId])).rows.map((row) => ({ id: row.id, price_minor: Number(row.price_minor), is_active: row.is_active }));
  return { db, product, variant, image, call, validate, expectedOf };
}

const stockOf = async (db, id) => Number((await db.query(`select public.current_inventory($1) as s`, [id])).rows[0].s);

async function everything(db) {
  const q = async (sql) => (await db.query(sql)).rows;
  return {
    products: await q(`select * from public.products order by id`),
    variants: await q(`select * from public.product_variants order by id`),
    movements: await q(`select * from public.inventory_movements order by id`),
    media: await q(`select * from public.product_media order by id`),
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

const add = (extra = {}) => ({ kind: "add_variant", ram: "6 GB", storage: "128 GB", color: null, price_minor: 5000000, stock: 20, pta_status: "not_applicable", condition: "brand_new", ...extra });

// ---------------------------------------------------------------------------
// apply_tablet_stock_product
// ---------------------------------------------------------------------------

test("Tablet: price, show again and a new variant (RAM, no colour) in one call; stock kept; new variant stock 20, Karachi only, IP SKU", async () => {
  const env = await makeDb();
  const id = await env.product("Samsung Galaxy Tab A8");
  const v1 = await env.variant(id);
  const v2 = await env.variant(id, { ram: "3 GB", price: 3500000, active: false, stock: 2 });
  await env.image(id);
  const result = await env.call({
    product_id: id,
    condition: "brand_new",
    expected: { variants: await env.expectedOf(id) },
    steps: [
      { kind: "price", variant_id: v1, from_minor: 4000000, to_minor: 4300000 },
      { kind: "show", variant_id: v2, from_minor: 3500000, to_minor: 3600000 },
      add(),
    ],
  });
  assert.equal(result.status, "updated");
  assert.equal(await stockOf(env.db, v1), 7);
  assert.equal(await stockOf(env.db, v2), 2);
  const rows = (await env.db.query(`select * from public.product_variants where product_id = $1 order by price_minor`, [id])).rows;
  assert.deepEqual(rows.map((row) => [Number(row.price_minor), row.is_active]), [[3600000, true], [4300000, true], [5000000, true]]);
  const created = rows.find((row) => Number(row.price_minor) === 5000000);
  assert.match(created.sku, /^IP[0-9]{3}$/);
  assert.deepEqual([created.ram_display, created.storage_display, created.color_finish, created.pta_status, created.condition, created.delivery_scope, created.warranty_override, created.sim_configuration], ["6 GB", "128 GB", null, "not_applicable", "brand_new", "karachi_only", null, null]);
  assert.equal(await stockOf(env.db, created.id), 20);
});

test("MacBook: Apple in laptops only, PTA Not Applicable only, MC SKU; Windows laptops, phones and gadgets are refused", async () => {
  const env = await makeDb();
  const mac = await env.product("Apple MacBook Air M5", { category: "laptops", brand: "Apple" });
  await env.variant(mac, { ram: "16 GB", storage: "512 GB", color: "Midnight", price: 42050000 });
  const base = { product_id: mac, condition: "brand_new", expected: { variants: await env.expectedOf(mac) } };
  await rejects(env, { ...base, steps: [add({ ram: "24 GB", storage: "1 TB", color: "Silver", pta_status: "approved" })] }, /a MacBook's PTA is Not Applicable/);
  await env.call({ ...base, steps: [add({ ram: "24 GB", storage: "1 TB", color: "Silver" })] });
  const sku = (await env.db.query(`select sku from public.product_variants where product_id = $1 and storage_display = '1 TB'`, [mac])).rows[0].sku;
  assert.match(sku, /^MC[0-9]{3}$/);

  for (const [title, category, brand] of [["Lenovo ThinkPad", "laptops", "Lenovo"], ["Samsung Galaxy A55", "mobile-phones", "Samsung"], ["Samsung Gadget", "gadgets", "Samsung"]]) {
    const id = await env.product(title, { category, brand });
    await env.variant(id);
    await rejects(env, { product_id: id, condition: "brand_new", expected: { variants: await env.expectedOf(id) }, steps: [add()] }, /tablet_stock_product_out_of_scope/);
  }
});

test("Refused, nothing saved: wrong listing, other-condition variants, changed since check, duplicate variant, wrong stock", async () => {
  const env = await makeDb();
  const id = await env.product("Samsung Galaxy Tab A8");
  const v1 = await env.variant(id);
  const expected = { variants: await env.expectedOf(id) };
  await rejects(env, { product_id: id, condition: "used", expected, steps: [add({ condition: "used" })] }, /wrong_listing/);
  await rejects(env, { product_id: id, condition: "brand_new", expected: { variants: [{ ...expected.variants[0], price_minor: 1 }] }, steps: [add()] }, /changed_since_check/);
  await rejects(env, { product_id: id, condition: "brand_new", expected, steps: [add({ ram: "4 GB", storage: "64 GB" })] }, /already exists on this product/);
  await rejects(env, { product_id: id, condition: "brand_new", expected, steps: [add({ stock: 30 })] }, /opening stock must be 20/);
  await rejects(env, { product_id: id, condition: "brand_new", expected, steps: [add({ pta_status: "unknown" })] }, /PTA must be given/);
  await rejects(env, { product_id: id, condition: "brand_new", expected, steps: [{ kind: "price", variant_id: v1, from_minor: 4000000, to_minor: 4000000 }] }, /equals the current price/);
  await env.variant(id, { ram: "8 GB", condition: "used" });
  await rejects(env, { product_id: id, condition: "brand_new", expected: { variants: await env.expectedOf(id) }, steps: [add()] }, /has variants that are not New/);
});

test("Catalog admins only; anon and public cannot run it", async () => {
  const env = await makeDb();
  const id = await env.product("Samsung Galaxy Tab A8");
  await env.variant(id);
  const expected = { variants: await env.expectedOf(id) };
  await signOut(env.db);
  await assert.rejects(env.call({ product_id: id, condition: "brand_new", expected, steps: [add()] }), /admin_required/);
  await signInAsOwner(env.db);
  const grants = (await env.db.query(`select has_function_privilege('anon', 'public.apply_tablet_stock_product(jsonb)', 'execute') as anon, has_function_privilege('authenticated', 'public.apply_tablet_stock_product(jsonb)', 'execute') as auth`)).rows[0];
  assert.deepEqual(grants, { anon: false, auth: true });
});

// ---------------------------------------------------------------------------
// New products through apply_catalog_bulk_import_v2 (the plan's payload)
// ---------------------------------------------------------------------------

test("New tablet and MacBook from the plan: drafts, stock 20, Karachi only, IP / MC SKUs, blank colour kept blank", async () => {
  const env = await makeDb();
  const brands = ["Apple", "Samsung"].map((name) => ({ name }));
  for (const [text, selection, prefix] of [
    ["Galaxy Tab A8 4/64; 43,000", { productType: "tablet", condition: "brand_new", connectivity: "wifi" }, /^IP[0-9]{3}$/],
    ["Macbook Air M5 Now Available\n\n420500\n\n16-512Gb Midnight", { productType: "macbook", condition: "brand_new", connectivity: null }, /^MC[0-9]{3}$/],
  ]) {
    const plan = buildTabletPlan(compareTabletList(parseTabletList(text, brands), [], selection, emptyDecisions()), []);
    assert.equal(plan.products.length, 1);
    const result = (await env.db.query(`select public.apply_catalog_bulk_import_v2($1::jsonb) as r`, [JSON.stringify({ products: [plan.products[0].payload] })])).rows[0].r;
    const productId = result.products[0].id;
    const row = (await env.db.query(`select publication_status from public.products where id = $1`, [productId])).rows[0];
    assert.equal(row.publication_status, "draft");
    const variants = (await env.db.query(`select * from public.product_variants where product_id = $1`, [productId])).rows;
    assert.equal(variants.length, 1);
    assert.match(variants[0].sku, prefix);
    assert.equal(variants[0].delivery_scope, "karachi_only");
    assert.equal(variants[0].pta_status, "not_applicable");
    assert.equal(variants[0].warranty_override, null);
    assert.equal(await stockOf(env.db, variants[0].id), 20);
  }
});

// ---------------------------------------------------------------------------
// validate_product_for_publication
// ---------------------------------------------------------------------------

test("Publishing: Tablets & MacBooks need no warranty (New and Used); PTA / condition / image still required", async () => {
  const env = await makeDb();
  const tablet = await env.product("Samsung Galaxy Tab A8");
  await env.variant(tablet);
  await env.image(tablet);
  assert.deepEqual(await env.validate(tablet), { is_valid: true, errors: [] });

  const used = await env.product("Samsung Galaxy Tab A8 (Used)");
  await env.variant(used, { condition: "used" });
  await env.image(used);
  assert.deepEqual(await env.validate(used), { is_valid: true, errors: [] });

  const mac = await env.product("Apple MacBook Air M5", { category: "laptops", brand: "Apple" });
  await env.variant(mac, { ram: "16 GB", storage: "512 GB" });
  await env.image(mac);
  assert.deepEqual(await env.validate(mac), { is_valid: true, errors: [] });

  const unknownPta = await env.product("Samsung Galaxy Tab S9");
  await env.variant(unknownPta, { pta: "unknown" });
  await env.image(unknownPta);
  assert.deepEqual((await env.validate(unknownPta)).errors, [COMMERCIAL]);

  const noImage = await env.product("Samsung Galaxy Tab S10");
  await env.variant(noImage);
  assert.deepEqual((await env.validate(noImage)).errors, ["primary_product_media_required"]);
});

test("Publishing: a non-Apple laptop can never be published; phones still need a warranty", async () => {
  const env = await makeDb();
  const windows = await env.product("Lenovo ThinkPad", { category: "laptops", brand: "Lenovo", warranty: "1 Year" });
  await env.variant(windows);
  await env.image(windows);
  assert.deepEqual((await env.validate(windows)).errors, [LAPTOP_BRAND]);

  const phone = await env.product("Samsung Galaxy A55", { category: "mobile-phones", brand: "Samsung" });
  await env.variant(phone, { pta: "approved" });
  await env.image(phone);
  assert.deepEqual((await env.validate(phone)).errors, [COMMERCIAL]);
  await env.db.query(`update public.products set default_warranty = '1 Year' where id = $1`, [phone]);
  assert.deepEqual(await env.validate(phone), { is_valid: true, errors: [] });
});
