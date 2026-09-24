// Bulk Upload v2 Phase 2 — apply_catalog_bulk_import_v2 against the replayed migrations
// (see scripts/support/catalogTestDatabase.mjs). Nothing here touches the live database.
import assert from "node:assert/strict";
import test from "node:test";
import { createCatalogTestDatabase, signInAsOwner, signOut } from "./support/catalogTestDatabase.mjs";

const variant = (overrides = {}) => ({
  source: "Products row 2", sku: null, ram: "6 GB", storage: "128 GB", color: "Black",
  price_minor: 4_250_000, compare_at_price_minor: null, stock: null,
  pta_status: "approved", condition: "brand_new", condition_grade: null,
  battery_health_percent: null, battery_cycle_count: null,
  warranty: "1 Year Official", delivery_scope: "karachi_only", ...overrides,
});
const product = (overrides = {}) => ({
  action: "Create", source: "Products rows 2", product_type: "Mobile Phone",
  brand: "Samsung", title: "Samsung A16", category: "Mobile Phones",
  specifications: [], variants: [variant()], ...overrides,
});

async function fresh() {
  const db = await createCatalogTestDatabase();
  await signInAsOwner(db);
  return db;
}
const apply = async (db, products) =>
  (await db.query(`select public.apply_catalog_bulk_import_v2($1::jsonb) as result`, [JSON.stringify({ products })])).rows[0].result;
const rejects = (db, products, pattern) => assert.rejects(apply(db, products), pattern);
const one = async (db, sql, params = []) => (await db.query(sql, params)).rows[0];
const all = async (db, sql, params = []) => (await db.query(sql, params)).rows;
const productBy = (db, title) => one(db, `select * from public.products where title = $1`, [title]);
const variantsOf = (db, title) => all(db,
  `select v.*, public.current_inventory(v.id)::int as stock from public.product_variants v
   join public.products p on p.id = v.product_id where p.title = $1 order by v.sku`, [title]);

// One replayed database shared by the tests below (each uses its own product names); tests that
// assert exact SKU numbers or counts get a fresh database.
const db = await fresh();

test("1-6. Create Mobile / Accessory / Gadget / MacBook / iPad: drafts in the locked categories with server SKUs", async () => {
  const local = await fresh();
  const result = await apply(local, [
    product(),
    product({ product_type: "Accessory", brand: "Apple", title: "Apple 20W Charger", category: "Accessories",
      variants: [variant({ ram: null, storage: null, color: "White", pta_status: "not_applicable", delivery_scope: "nationwide" })] }),
    product({ product_type: "Gadget", brand: "Xiaomi", title: "Xiaomi Smart Band 9", category: null,
      variants: [variant({ ram: null, storage: null, pta_status: "not_applicable", delivery_scope: "nationwide" })] }),
    product({ product_type: "Laptop", brand: "Apple", title: "Apple MacBook Air 13 M3", category: "Laptops",
      variants: [variant({ ram: "16 GB", storage: "512 GB", color: "Midnight", pta_status: "not_applicable" })] }),
    product({ product_type: "Tablet", brand: "Apple", title: "Apple iPad Air 11", category: "Tablets",
      variants: [variant({ ram: null, storage: "128 GB", color: "Blue", pta_status: "not_applicable", delivery_scope: "nationwide" })] }),
  ]);
  assert.equal(result.products_created, 5);
  assert.equal(result.variants_created, 5);
  assert.deepEqual(result.assigned_skus.map((item) => item.sku), ["MB001", "AC001", "GD001", "MC001", "IP001"]);
  const rows = await all(local, `select p.title, p.publication_status, c.slug, v.sku from public.products p
    join public.categories c on c.id = p.category_id join public.product_variants v on v.product_id = p.id order by v.sku`);
  assert.deepEqual(rows.map((row) => [row.sku, row.slug, row.publication_status]), [
    ["AC001", "mobile-accessories", "draft"], ["GD001", "gadgets", "draft"], ["IP001", "tablets", "draft"],
    ["MB001", "mobile-phones", "draft"], ["MC001", "laptops", "draft"],
  ]);
  assert.ok(result.products.every((item) => item.has_primary_image === false));
  // Counters are independent: a second phone is MB002, not MB006.
  const second = await apply(local, [product({ title: "Samsung A26", variants: [variant()] })]);
  assert.deepEqual(second.assigned_skus.map((item) => item.sku), ["MB002"]);
});

test("7-8. Stock blank → 10; explicit 25 stays 25 (ledger corrections)", async () => {
  await apply(db, [product({ title: "Samsung Stock Test", variants: [variant({ color: "Black" }), variant({ color: "Blue", stock: 25 })] })]);
  const rows = await variantsOf(db, "Samsung Stock Test");
  assert.deepEqual(rows.map((row) => [row.color_finish, row.stock]).sort(), [["Black", 10], ["Blue", 25]]);
  const reasons = await all(db, `select distinct m.reason, m.reference from public.inventory_movements m
    join public.product_variants v on v.id = m.variant_id join public.products p on p.id = v.product_id where p.title = 'Samsung Stock Test'`);
  assert.deepEqual(reasons, [{ reason: "correction", reference: "bulk_import_v2" }]);
});

test("9-10, 26-27. Used A++ with BH/CC; used without BH/CC; blank warranty — stored as given, blanks stay NULL", async () => {
  await apply(db, [product({ brand: "Apple", title: "Apple iPhone 15 Pro", variants: [
    variant({ ram: null, storage: "256 GB", color: "Natural", pta_status: "not_approved", condition: "used", condition_grade: "A++", battery_health_percent: 89, battery_cycle_count: 312 }),
    variant({ ram: null, storage: "256 GB", color: "Natural", pta_status: "not_approved", condition: "used", condition_grade: "A++", battery_health_percent: 92, battery_cycle_count: 120, price_minor: 27_000_000 }),
    variant({ ram: null, storage: "128 GB", color: "Blue", pta_status: "approved", condition: "used", condition_grade: "A++", warranty: null }),
  ] })]);
  const rows = await variantsOf(db, "Apple iPhone 15 Pro");
  const byStorage = rows.map((row) => [row.storage_display, row.condition, row.condition_grade, row.battery_health_percent, row.battery_cycle_count, row.warranty_override]);
  assert.deepEqual(byStorage.sort(), [
    ["128 GB", "used", "A++", null, null, null],
    ["256 GB", "used", "A++", 89, 312, "1 Year Official"],
    ["256 GB", "used", "A++", 92, 120, "1 Year Official"],
  ]);
});

test("11-13. Create saves specs; Replace ignores the file's specs and preserves specs, media and product fields", async () => {
  await apply(db, [product({ title: "Samsung Spec Test", specifications: [
    { group: "Display", label: "Size", value: "6.7 inch" }, { group: "Battery", label: "Capacity", value: "5000 mAh" }, { group: null, label: "Chipset", value: "Exynos 1330" },
  ] })]);
  const created = await productBy(db, "Samsung Spec Test");
  assert.deepEqual((await all(db, `select specification_group, label, value from public.product_specifications where product_id = $1 order by sort_order`, [created.id]))
    .map((row) => [row.specification_group, row.label, row.value]), [["Display", "Size", "6.7 inch"], ["Battery", "Capacity", "5000 mAh"], [null, "Chipset", "Exynos 1330"]]);
  // Owner edits after import: SEO, description, homepage flag, media.
  await db.query(`update public.products set seo_title = 'Samsung Spec Test SEO', short_description = 'Owner copy', is_featured = true where id = $1`, [created.id]);
  const [firstVariant] = await variantsOf(db, "Samsung Spec Test");
  await db.query(`insert into public.product_media (product_id, variant_id, alt_text, sort_order) values ($1, null, 'Front', 0), ($1, $2, 'Black side', 1)`, [created.id, firstVariant.id]);
  const edited = await productBy(db, "Samsung Spec Test");

  const result = await apply(db, [product({ action: "Replace Existing", title: "samsung spec test", specifications: [{ group: "Display", label: "Size", value: "WRONG" }],
    variants: [variant({ color: "Blue" })] })]);
  assert.equal(result.products_replaced, 1);
  const after = await productBy(db, "Samsung Spec Test");
  // The product row is not written at all by Replace Existing (updated_at unchanged).
  assert.deepEqual(after, edited);
  assert.equal(after.title, "Samsung Spec Test", "file's title casing does not overwrite the product");
  assert.equal(after.seo_title, "Samsung Spec Test SEO");
  assert.equal(after.is_featured, true);
  assert.equal((await one(db, `select count(*)::int as n from public.product_specifications where product_id = $1 and value = '6.7 inch'`, [created.id])).n, 1);
  assert.equal((await one(db, `select count(*)::int as n from public.product_specifications where value = 'WRONG'`)).n, 0);
  // Media survives, including the image linked to the variant that the file no longer lists.
  assert.equal((await one(db, `select count(*)::int as n from public.product_media where product_id = $1`, [created.id])).n, 2);
  assert.equal((await one(db, `select is_active from public.product_variants where id = $1`, [firstVariant.id])).is_active, false);
});

test("14-18. Replace keeps SKU, updates price and stock, hides missing variants, brings hidden ones back", async () => {
  await apply(db, [product({ title: "Samsung Replace Test", variants: [
    variant({ color: "Black", price_minor: 4_000_000 }), variant({ color: "Blue", price_minor: 4_000_000 }), variant({ color: "Green", price_minor: 4_000_000 }),
  ] })]);
  const before = await variantsOf(db, "Samsung Replace Test");
  const skuOf = (rows, color) => rows.find((row) => row.color_finish === color).sku;

  const replaced = await apply(db, [product({ action: "Replace Existing", title: "Samsung Replace Test", variants: [
    variant({ color: "Black", price_minor: 3_800_000, stock: 4 }),
    variant({ color: "Blue", price_minor: 3_900_000, sku: skuOf(before, "Blue") }),
    variant({ color: "Silver", price_minor: 4_100_000 }),
  ] })]);
  assert.equal(replaced.variants_updated, 2);
  assert.equal(replaced.variants_created, 1);
  assert.equal(replaced.variants_hidden, 1);
  const mid = await variantsOf(db, "Samsung Replace Test");
  const black = mid.find((row) => row.color_finish === "Black");
  assert.equal(black.sku, skuOf(before, "Black"));
  assert.equal(Number(black.price_minor), 3_800_000);
  assert.equal(black.stock, 4);
  assert.equal(mid.find((row) => row.color_finish === "Blue").stock, 10);
  const green = mid.find((row) => row.color_finish === "Green");
  assert.equal(green.is_active, false);
  assert.equal(green.stock, 10, "hidden variant keeps its inventory history");
  assert.match(mid.find((row) => row.color_finish === "Silver").sku, /^MB\d{3}$/);

  const back = await apply(db, [product({ action: "Replace Existing", title: "Samsung Replace Test", variants: [
    variant({ color: "Black", price_minor: 3_800_000, stock: 4 }), variant({ color: "Green", price_minor: 3_700_000 }),
  ] })]);
  assert.equal(back.variants_reactivated, 1);
  assert.equal(back.variants_hidden, 2);
  const final = await variantsOf(db, "Samsung Replace Test");
  const greenAgain = final.find((row) => row.color_finish === "Green");
  assert.equal(greenAgain.is_active, true);
  assert.equal(greenAgain.sku, green.sku, "brought-back variant keeps its original SKU");
  assert.equal(final.length, 4, "nothing was deleted");
});

test("5 (blank rule). Replace with blank optional facts keeps existing BH / CC / warranty / compare-at", async () => {
  await apply(db, [product({ brand: "Apple", title: "Apple iPhone 14", variants: [
    variant({ ram: null, color: "Midnight", condition: "used", condition_grade: "A++", battery_health_percent: 88, battery_cycle_count: 400, compare_at_price_minor: 16_000_000, price_minor: 15_000_000, warranty: "3 Months" }),
  ] })]);
  await apply(db, [product({ action: "Replace Existing", brand: "Apple", title: "Apple iPhone 14", variants: [
    variant({ ram: null, color: "Midnight", pta_status: null, condition: "used", condition_grade: null, battery_health_percent: null, battery_cycle_count: null, compare_at_price_minor: null, price_minor: 14_500_000, warranty: null, delivery_scope: null }),
  ] })]);
  const [row] = await variantsOf(db, "Apple iPhone 14");
  assert.deepEqual([row.battery_health_percent, row.battery_cycle_count, row.warranty_override, Number(row.compare_at_price_minor), row.condition_grade, row.pta_status, row.delivery_scope],
    [88, 400, "3 Months", 16_000_000, "A++", "approved", "karachi_only"]);
  assert.equal(Number(row.price_minor), 14_500_000);
});

test("19. order history stays intact when an ordered variant is hidden by Replace Existing", async () => {
  await apply(db, [product({ title: "Samsung Order Test", variants: [variant({ color: "Black" }), variant({ color: "Blue" })] })]);
  const [black] = (await variantsOf(db, "Samsung Order Test")).filter((row) => row.color_finish === "Black");
  const order = await one(db, `insert into public.orders (order_number, customer_name, phone, city, full_delivery_address, payment_method, delivery_classification, subtotal_minor, total_minor)
    values ('ISP-ORD-TEST1', 'Test', '03000000000', 'Karachi', 'Address', 'cash_on_delivery', 'karachi_only', 4250000, 4250000) returning id`);
  await db.query(`insert into public.order_items (order_id, product_id, variant_id, product_title_snapshot, sku_snapshot, quantity, unit_price_minor, line_total_minor, delivery_scope_snapshot)
    values ($1, $2, $3, 'Samsung Order Test', $4, 1, 4250000, 4250000, 'karachi_only')`, [order.id, black.product_id, black.id, black.sku]);
  await apply(db, [product({ action: "Replace Existing", title: "Samsung Order Test", variants: [variant({ color: "Blue" })] })]);
  const item = await one(db, `select oi.sku_snapshot, v.sku, v.is_active from public.order_items oi join public.product_variants v on v.id = oi.variant_id where oi.order_id = $1`, [order.id]);
  assert.deepEqual([item.sku_snapshot, item.sku, item.is_active], [black.sku, black.sku, false]);
});

test("20-25. Server rejects unknown brand/category, type mismatch, Create-existing, Replace-missing, duplicate variants", async () => {
  await rejects(db, [product({ brand: "Samsnug", title: "Samsnug A99" })], /Brand not found among active brands: "Samsnug"/);
  await rejects(db, [product({ title: "Samsung Cat Test", category: "Smartphones" })], /Category not found among active categories: "Smartphones"/);
  await rejects(db, [product({ title: "Samsung Type Test", category: "Accessories" })], /Category "Accessories" does not match Product Type Mobile Phone/);
  await apply(db, [product({ title: "Samsung Exists Test" })]);
  await rejects(db, [product({ title: "Samsung Exists Test" })], /Action is Create but "Samsung Exists Test" already exists/);
  await rejects(db, [product({ action: "Replace Existing", title: "Samsung Never Imported" })], /Action is Replace Existing but "Samsung Never Imported" does not exist/);
  await rejects(db, [product({ title: "Samsung Dup Test", variants: [variant({ source: "row 2" }), variant({ source: "row 3" })] })], /Duplicate variant: row 2, row 3/);
});

test("12. Server rejects bad values, malformed actions, missing identity and any SKU supplied or changed", async () => {
  await rejects(db, [product({ title: "Samsung Bad", variants: [variant({ price_minor: 0 })] })], /Price must be a positive PKR amount/);
  await rejects(db, [product({ title: "Samsung Bad", variants: [variant({ stock: -1 })] })], /Stock must be a whole number/);
  await rejects(db, [product({ title: "Samsung Bad", variants: [variant({ condition: "used", condition_grade: "A++", battery_health_percent: 120 })] })], /Battery Health must be a whole number from 1 to 100/);
  await rejects(db, [product({ title: "Samsung Bad", variants: [variant({ battery_cycle_count: "-4" })] })], /Cycle Count must be a whole number/);
  await rejects(db, [product({ title: "Samsung Bad", variants: [variant({ pta_status: "yes" })] })], /Unknown PTA Status "yes"/);
  await rejects(db, [product({ title: "Samsung Bad", variants: [variant({ condition: "mint" })] })], /Unknown Condition "mint"/);
  await rejects(db, [product({ title: "Samsung Bad", variants: [variant({ condition: "brand_new", condition_grade: "A++" })] })], /Condition Grade A\+\+ requires Condition Used/);
  await rejects(db, [product({ title: "Samsung Bad", variants: [variant({ delivery_scope: "nationwide" })] })], /Mobile phones are Karachi-only/);
  await rejects(db, [product({ action: "Upsert", title: "Samsung Bad" })], /Action must be Create or Replace Existing/);
  await rejects(db, [product({ title: " " })], /Product Title is required/);
  await rejects(db, [product({ title: "Samsung Bad", variants: [variant({ sku: "MB050" })] })], /SKU is assigned automatically; leave it blank for a new variant/);
  await apply(db, [product({ title: "Samsung SKU Test" })]);
  await rejects(db, [product({ action: "Replace Existing", title: "Samsung SKU Test", variants: [variant({ sku: "MB999" })] })], /SKUs cannot be changed/);
  // Errors are reported together, before any write.
  await assert.rejects(apply(db, [product({ brand: "Nope", title: "Nope 1" }), product({ title: "Samsung Bad", variants: [variant({ price_minor: -5 })] })]),
    (error) => /Brand not found/.test(error.message) && /Price must be a positive/.test(error.message));
  assert.equal((await one(db, `select count(*)::int as n from public.products where title in ('Nope 1', 'Samsung Bad')`)).n, 0);
});

test("admin only", async () => {
  const local = await fresh();
  await signOut(local);
  await assert.rejects(apply(local, [product()]), /catalog_admin_required/);
});

test("published product: Replace that would break publication checks is rejected", async () => {
  await apply(db, [product({ title: "Samsung Published Test" })]);
  const created = await productBy(db, "Samsung Published Test");
  await db.query(`insert into public.product_media (product_id, alt_text, is_primary, cloudinary_public_id, cloudinary_asset_id, cloudinary_version, secure_url, width, height, bytes, format)
    values ($1, 'Front', true, 'isolutions-development/products/x/front', 'asset-1', 1, 'https://example.test/front.jpg', 800, 800, 1000, 'jpg')`, [created.id]);
  await db.query(`update public.products set publication_status = 'published' where id = $1`, [created.id]);
  await rejects(db, [product({ action: "Replace Existing", title: "Samsung Published Test", variants: [variant({ color: "Red", pta_status: null, warranty: null })] })],
    /bulk_import_v2_publication_guard: "Samsung Published Test" is published/);
  const ok = await apply(db, [product({ action: "Replace Existing", title: "Samsung Published Test", variants: [variant({ price_minor: 4_100_000 })] })]);
  assert.equal(ok.variants_updated, 1);
  assert.equal((await productBy(db, "Samsung Published Test")).publication_status, "published");
  assert.equal(ok.products[0].has_primary_image, true);
});

test("29. a 100-row import succeeds atomically with unique sequential SKUs", async () => {
  const local = await fresh();
  const products = Array.from({ length: 20 }, (_, index) => product({
    title: `Samsung Bulk ${index + 1}`,
    variants: ["Black", "Blue", "Green", "Silver", "Gold"].map((color) => variant({ color, source: `P${index + 1} ${color}` })),
  }));
  const result = await apply(local, products);
  assert.equal(result.products_created, 20);
  assert.equal(result.variants_created, 100);
  const skus = result.assigned_skus.map((item) => item.sku);
  assert.equal(new Set(skus).size, 100);
  assert.equal(skus[0], "MB001");
  assert.equal(skus[99], "MB100");
});

test("30. a forced error mid-import rolls back the whole batch", async () => {
  const local = await fresh();
  await local.exec(`create function pg_temp.fail_on_title() returns trigger language plpgsql as $$
    begin if new.title = 'Samsung Explodes' then raise exception 'forced failure'; end if; return new; end $$;
    create trigger fail_on_title before insert on public.products for each row execute function pg_temp.fail_on_title();`);
  await assert.rejects(apply(local, [product({ title: "Samsung Fine" }), product({ title: "Samsung Explodes" })]), /forced failure/);
  assert.equal((await one(local, `select count(*)::int as n from public.products`)).n, 0);
  assert.equal((await one(local, `select count(*)::int as n from public.product_variants`)).n, 0);
  assert.equal((await one(local, `select count(*)::int as n from public.inventory_movements`)).n, 0);
});

test("legacy import stays available alongside v2", async () => {
  const functions = await all(db, `select proname from pg_proc where proname in ('apply_catalog_bulk_import', 'apply_catalog_bulk_import_phase4_legacy', 'apply_catalog_bulk_import_v2') order by proname`);
  assert.deepEqual(functions.map((row) => row.proname), ["apply_catalog_bulk_import", "apply_catalog_bulk_import_phase4_legacy", "apply_catalog_bulk_import_v2"]);
});
