// Android mobile warranty automation (Owner rule 2026-10-01): Android / non-Apple Mobile Phones
// with no warranty get "1 Year" before Bulk Preview; explicit warranties always win. Also covers
// the guarded backfill migration on a seeded replay (never the live database).
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import ExcelJS from "exceljs";
import {
  ANDROID_MOBILE_WARRANTY,
  applyAndroidMobileWarrantyDefault,
  applyStagingProfile,
  normalizeStockLines,
} from "../src/lib/catalogSheet.ts";
import {
  PRODUCT_HEADERS,
  buildCatalogWorkbook,
  catalogSheetToBulkParseResult,
  readCatalogWorkbook,
  validateCatalogSheet,
} from "../src/lib/catalogWorkbook.ts";
import { ANDROID_MOBILE_WARRANTY_SOURCE } from "../src/lib/bulkCatalog.ts";
import { resolveImportWarranty } from "../src/lib/catalogImport.ts";
import { createCatalogTestDatabase, signInAsOwner } from "./support/catalogTestDatabase.mjs";

const reference = {
  brands: ["Samsung", "Xiaomi", "Oppo", "Apple", "Vivo", "Infinix", "Tecno", "Realme", "Honor"],
  categories: ["Mobile Phones", "Accessories", "Gadgets", "Laptops", "Tablets"],
};

// The wholesale paste path exactly as Bulk Upload runs it: normalize -> profile -> validate -> preview.
const wholesalePreview = (text, profile = "wholesale_pta_approved") => {
  const { rows } = normalizeStockLines(text, { brands: reference.brands.map((name) => ({ name })) });
  return catalogSheetToBulkParseResult(validateCatalogSheet(applyStagingProfile(rows, profile), [], reference));
};
const variantsOf = (preview) => preview.products.flatMap((product) => product.variants);
const warrantyOf = (text) => variantsOf(wholesalePreview(text)).map((variant) => [variant.warranty, variant.warrantySource]);

// ---------------------------------------------------------------------------
// Staging / preview rule
// ---------------------------------------------------------------------------

test("wholesale Android blank warranty -> 1 Year, marked as the Android mobile default", () => {
  const preview = wholesalePreview("🔵 ✨ Samsung ✨\nA16 8/256 black @ 55000\n💠 ✨ Infinix ✨\nHot 50 8/128 green @ 41000");
  assert.deepEqual(preview.products.map((product) => product.productType), ["Mobile Phone", "Mobile Phone"]);
  assert.deepEqual(variantsOf(preview).map((variant) => [variant.warranty, variant.warrantySource]), [
    ["1 Year", ANDROID_MOBILE_WARRANTY_SOURCE],
    ["1 Year", ANDROID_MOBILE_WARRANTY_SOURCE],
  ]);
  assert.equal(ANDROID_MOBILE_WARRANTY, "1 Year");
  // Works without a staging profile too, for brand-new and used Android phones alike.
  assert.deepEqual(variantsOf(wholesalePreview("Samsung A16 6/128 Black; 42500", "none")).map((variant) => variant.warranty), ["1 Year"]);
  assert.deepEqual(variantsOf(wholesalePreview("Samsung S23 8/256 Black; 120000; Used", "none")).map((variant) => [variant.condition, variant.warranty]),
    [["used", "1 Year"]]);
});

test("Excel Android blank warranty -> 1 Year; a typed warranty stays explicit", async () => {
  const { rows } = normalizeStockLines("Samsung A16 6/128 Black; 42500\nSamsung A26 8/256 Blue; 62000", {
    brands: reference.brands.map((name) => ({ name })),
  });
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(await buildCatalogWorkbook(rows, [], reference));
  const sheet = workbook.getWorksheet("Products");
  // Generated workbooks never carry the auto-default, so a re-upload cannot make it explicit.
  assert.equal(sheet.getRow(2).getCell(PRODUCT_HEADERS.indexOf("Warranty") + 1).value ?? null, null);
  sheet.getRow(3).getCell(PRODUCT_HEADERS.indexOf("Warranty") + 1).value = "Official Warranty";
  const data = await readCatalogWorkbook(new Uint8Array(await workbook.xlsx.writeBuffer()), reference);
  assert.deepEqual(variantsOf(catalogSheetToBulkParseResult(data)).map((variant) => [variant.warranty, variant.warrantySource]), [
    ["1 Year", ANDROID_MOBILE_WARRANTY_SOURCE],
    ["Official Warranty", "Owner supplied explicitly"],
  ]);
});

test("Apple / iPhone blank warranty stays blank (new and used)", () => {
  assert.deepEqual(warrantyOf("iPhone 15 128 Black; 250000"), [[null, "unresolved"]]);
  assert.deepEqual(warrantyOf("iPhone 13 128 Blue; 120000; Used; BH 88%"), [[null, "unresolved"]]);
  assert.deepEqual(warrantyOf("🍎 ✨ Apple ✨\niPhone 16 Pro 256 natural @ 400000"), [[null, "unresolved"]]);
});

test("tablet / laptop / watch / accessory blank warranty stays blank", () => {
  assert.deepEqual(warrantyOf("📲 ✨ Samsung Tab ✨\nA11 wifi 8/128 grey @ 52000"), [[null, "unresolved"]]);
  const [phone] = normalizeStockLines("Samsung A16 6/128 Black; 42500", { brands: reference.brands.map((name) => ({ name })) }).rows;
  // Tablet, Laptop, Gadget (watches, general gadgets) and Accessory rows are never touched.
  for (const productType of ["Tablet", "Laptop", "Gadget", "Accessory"]) {
    const [row] = applyAndroidMobileWarrantyDefault([{ ...phone, productType }]);
    assert.equal(row.warranty, null, productType);
    assert.equal(row.fieldStatus.warranty, phone.fieldStatus.warranty, productType);
  }
  // An unrecognised brand is not "resolved": no default.
  assert.deepEqual(warrantyOf("Zqxphone Z1 4/64 Black; 30000"), [[null, "unresolved"]]);
});

test("explicit Official / Non / 2 Year / other warranties are preserved", () => {
  assert.deepEqual(warrantyOf("💠 ✨ Honor ✨\n▪️ official warranty\nX9c 12/256 black @ 90000"), [["Official Warranty", "Owner supplied explicitly"]]);
  assert.deepEqual(warrantyOf("🔵 ✨ Samsung ✨\n▪️ Non Warranty\nA16 8/256 black @ 55000"), [["No Warranty", "Owner supplied explicitly"]]);
  assert.deepEqual(warrantyOf("Samsung A16 6/128 Black; 42500; Non Warranty"), [["No Warranty", "Owner supplied explicitly"]]);
  assert.deepEqual(warrantyOf("Samsung A16 6/128 Black; 42500; 2 Year Warranty"), [["2 Year Warranty", "Owner supplied explicitly"]]);
  assert.deepEqual(warrantyOf("Samsung A16 6/128 Black; 42500; 6 Months Warranty"), [["6 Months Warranty", "Owner supplied explicitly"]]);
});

test("preview resolution: the auto-default never replaces a stored warranty; explicit always wins", () => {
  const auto = { warranty: "1 Year", source: ANDROID_MOBILE_WARRANTY_SOURCE };
  const explicit = { warranty: "Official Warranty", source: "Owner supplied explicitly" };
  const blank = { warranty: null, source: "unresolved" };
  // Nothing stored: the auto-default is saved.
  assert.deepEqual(resolveImportWarranty(auto, {}), auto);
  assert.deepEqual(resolveImportWarranty(auto, { productDefault: " ", variantOverride: "" }), auto);
  // Replace Existing: a matched variant keeps its stored explicit warranty.
  assert.deepEqual(resolveImportWarranty(auto, { variantOverride: "Non Warranty" }),
    { warranty: "Non Warranty", source: "Owner supplied explicitly" });
  // An existing product default is inherited instead of being shadowed by "1 Year".
  assert.deepEqual(resolveImportWarranty(auto, { productDefault: "2 Year Warranty" }),
    { warranty: "2 Year Warranty", source: "inherited from product" });
  // Explicit incoming warranty updates the stored one.
  assert.deepEqual(resolveImportWarranty(explicit, { variantOverride: "1 Year", productDefault: "Non Warranty" }), explicit);
  // Blank keeps preserving the stored value (unchanged rule).
  assert.deepEqual(resolveImportWarranty(blank, { variantOverride: "3 Months" }),
    { warranty: "3 Months", source: "Owner supplied explicitly" });
  assert.deepEqual(resolveImportWarranty(blank, {}), blank);
});

// ---------------------------------------------------------------------------
// apply_catalog_bulk_import_v2 (replayed migrations)
// ---------------------------------------------------------------------------

const rpcVariant = (overrides = {}) => ({
  source: "row", sku: null, ram: "8 GB", storage: "256 GB", color: "Black",
  price_minor: 5_500_000, compare_at_price_minor: null, stock: null,
  pta_status: "approved", condition: "brand_new", condition_grade: null,
  battery_health_percent: null, battery_cycle_count: null, sim_configuration: null,
  warranty: null, delivery_scope: "karachi_only", ...overrides,
});
const rpcProduct = (overrides = {}) => ({
  action: "Create", source: "rows", product_type: "Mobile Phone", brand: "Samsung",
  title: "Samsung A16", category: "Mobile Phones", specifications: [], variants: [rpcVariant()], ...overrides,
});
const apply = async (db, products) =>
  (await db.query(`select public.apply_catalog_bulk_import_v2($1::jsonb) as result`, [JSON.stringify({ products })])).rows[0].result;
const storedWarranties = async (db, title) =>
  (await db.query(`select v.color_finish, v.warranty_override from public.product_variants v
    join public.products p on p.id = v.product_id where p.title = $1 order by v.color_finish`, [title])).rows
    .map((row) => [row.color_finish, row.warranty_override]);

test("Create persists 1 Year; Replace keeps a stored explicit warranty; explicit Replace updates", async () => {
  const db = await createCatalogTestDatabase();
  await signInAsOwner(db);
  const [previewVariant] = variantsOf(wholesalePreview("🔵 ✨ Samsung ✨\nA16 8/256 black @ 55000"));
  await apply(db, [rpcProduct({ variants: [
    rpcVariant({ warranty: previewVariant.warranty }),
    rpcVariant({ color: "Blue", warranty: "Official Warranty" }),
  ] })]);
  assert.deepEqual(await storedWarranties(db, "Samsung A16"), [["Black", "1 Year"], ["Blue", "Official Warranty"]]);

  // Replace Existing from a list without a warranty: the preview resolves the auto-default
  // against what is stored, so "Official Warranty" is sent back unchanged.
  const stored = Object.fromEntries((await storedWarranties(db, "Samsung A16")));
  const send = (color) => resolveImportWarranty(
    { warranty: "1 Year", source: ANDROID_MOBILE_WARRANTY_SOURCE }, { variantOverride: stored[color] }).warranty;
  await apply(db, [rpcProduct({ action: "Replace Existing", variants: [
    rpcVariant({ warranty: send("Black") }), rpcVariant({ color: "Blue", warranty: send("Blue") }),
  ] })]);
  assert.deepEqual(await storedWarranties(db, "Samsung A16"), [["Black", "1 Year"], ["Blue", "Official Warranty"]]);

  // An explicit incoming warranty updates the stored one.
  await apply(db, [rpcProduct({ action: "Replace Existing", variants: [
    rpcVariant({ warranty: "2 Year Warranty" }), rpcVariant({ color: "Blue", warranty: null }),
  ] })]);
  assert.deepEqual(await storedWarranties(db, "Samsung A16"), [["Black", "2 Year Warranty"], ["Blue", "Official Warranty"]]);
});

// ---------------------------------------------------------------------------
// 202610010001_android_mobile_warranty_backfill.sql
// ---------------------------------------------------------------------------

const MIGRATION = readFileSync(
  new URL("../supabase/migrations/202610010001_android_mobile_warranty_backfill.sql", import.meta.url), "utf8");
const BATCH = "android_mobile_warranty_1_year_2026_10_01";
const COLORS = ["Black", "Blue", "Green"];
const runMigration = async (db) => {
  try {
    await db.exec(MIGRATION);
  } catch (error) {
    await db.exec("rollback");
    throw error;
  }
};
const count = async (db, sql) => (await db.query(sql)).rows[0].n;
// Everything except warranty_override / updated_at, to prove nothing else moves.
const snapshot = async (db) => (await db.query(`
  select v.id, v.sku, v.price_minor::text, v.compare_at_price_minor::text, v.pta_status, v.condition, v.is_active,
    v.delivery_scope, public.current_inventory(v.id)::int as stock, p.default_warranty, p.publication_status, p.data_class
  from public.product_variants v join public.products p on p.id = v.product_id order by v.id`)).rows;
const warrantyBy = async (db, title) =>
  (await db.query(`select v.warranty_override from public.product_variants v join public.products p on p.id = v.product_id
    where p.title = $1 order by v.color_finish`, [title])).rows.map((row) => row.warranty_override);

test("backfill: 105 products / 305 variants set to 1 Year with audit; Apple and resolved warranties untouched; rerun is a no-op", async () => {
  const db = await createCatalogTestDatabase();
  await signInAsOwner(db);
  // 105 real bulk Android products: 95 x 3 variants + 10 x 2 = 305 (one variant added outside Bulk Upload).
  const candidates = Array.from({ length: 105 }, (_, index) => rpcProduct({
    title: `Samsung Backfill ${index + 1}`,
    variants: COLORS.slice(0, index < 95 ? 3 : index < 104 ? 2 : 1).map((color) => rpcVariant({ color, source: `${index} ${color}` })),
  }));
  await apply(db, candidates);
  await db.query(`insert into public.product_variants (product_id, sku, ram_display, storage_display, color_finish, price_minor,
      pta_status, condition, delivery_scope, is_active)
    select id, '', '8 GB', '256 GB', 'Blue', 5500000, 'approved', 'used', 'karachi_only', true
    from public.products where title = 'Samsung Backfill 105'`);
  // Non-candidates.
  await apply(db, [
    rpcProduct({ brand: "Apple", title: "Apple iPhone 15", variants: [rpcVariant({ ram: null })] }),
    rpcProduct({ title: "Samsung Explicit", variants: [rpcVariant({ warranty: "Official Warranty" }), rpcVariant({ color: "Blue", warranty: "Non Warranty" })] }),
    rpcProduct({ title: "Samsung Product Default" }),
    rpcProduct({ title: "Samsung Development" }),
    rpcProduct({ product_type: "Tablet", title: "Samsung Tab A11", category: "Tablets", variants: [rpcVariant({ pta_status: "not_applicable" })] }),
    rpcProduct({ product_type: "Gadget", title: "Samsung Watch 8", category: null, variants: [rpcVariant({ ram: null, storage: null, pta_status: "not_applicable" })] }),
  ]);
  await db.query(`update public.products set default_warranty = '2 Year Warranty' where title = 'Samsung Product Default'`);
  await db.query(`update public.products set data_class = 'development' where title = 'Samsung Development'`);
  const before = await snapshot(db);

  // Guard: a candidate set that differs from the reviewed 305 variants aborts with no change.
  await db.query(`update public.product_variants set warranty_override = 'Official Warranty'
    where id = (select v.id from public.product_variants v join public.products p on p.id = v.product_id
                where p.title = 'Samsung Backfill 1' and v.color_finish = 'Black')`);
  await assert.rejects(runMigration(db), /android_warranty_backfill_guard: expected 105 products \/ 305 variants, found 105 \/ 304/);
  assert.equal(await count(db, `select count(*)::int as n from public.product_variants where warranty_override = '1 Year'`), 0);
  assert.equal(await count(db, `select (to_regclass('public.catalog_warranty_backfill_audit') is null)::int as n`), 1);
  await db.query(`update public.product_variants set warranty_override = null where warranty_override = 'Official Warranty'
    and product_id = (select id from public.products where title = 'Samsung Backfill 1')`);

  await runMigration(db);
  assert.equal(await count(db, `select count(*)::int as n from public.product_variants where warranty_override = '1 Year'`), 305);
  assert.equal(await count(db, `select count(distinct v.product_id)::int as n from public.product_variants v where warranty_override = '1 Year'`), 105);
  assert.equal(await count(db, `select count(*)::int as n from public.product_variants v join public.products p on p.id = v.product_id
    where p.title like 'Samsung Backfill %' and v.warranty_override is distinct from '1 Year'`), 0);
  // Apple, explicit, product-default, development, tablet and watch rows are untouched.
  assert.deepEqual(await warrantyBy(db, "Apple iPhone 15"), [null]);
  assert.deepEqual(await warrantyBy(db, "Samsung Explicit"), ["Official Warranty", "Non Warranty"]);
  assert.deepEqual(await warrantyBy(db, "Samsung Product Default"), [null]);
  assert.deepEqual(await warrantyBy(db, "Samsung Development"), [null]);
  assert.deepEqual(await warrantyBy(db, "Samsung Tab A11"), [null]);
  assert.deepEqual(await warrantyBy(db, "Samsung Watch 8"), [null]);
  // Nothing but warranty_override changed: price, stock, PTA, condition, SKU, product default, publication.
  assert.deepEqual(await snapshot(db), before);
  assert.equal(await count(db, `select count(*)::int as n from public.products where publication_status <> 'draft'`), 0);

  // Audit: one row per variant with previous and new values; bulk origin recorded, not required.
  const audit = (await db.query(`select * from public.catalog_warranty_backfill_audit order by sku`)).rows;
  assert.equal(audit.length, 305);
  assert.ok(audit.every((row) => row.batch_label === BATCH && row.new_warranty_override === "1 Year"
    && row.previous_warranty_override === null && row.previous_product_default_warranty === null
    && row.brand === "Samsung" && row.sku && row.product_id && row.applied_at));
  assert.equal(audit.filter((row) => !row.has_bulk_import_v2_movement).length, 1);
  assert.equal(new Set(audit.map((row) => row.product_id)).size, 105);

  // Rerun: already recorded -> nothing changes, even after an Owner edit.
  await db.query(`update public.product_variants set warranty_override = 'Official Warranty'
    where id = (select variant_id from public.catalog_warranty_backfill_audit order by sku limit 1)`);
  await runMigration(db);
  assert.equal(await count(db, `select count(*)::int as n from public.catalog_warranty_backfill_audit`), 305);
  assert.equal(await count(db, `select count(*)::int as n from public.product_variants where warranty_override = '1 Year'`), 304);
});

test("backfill guard: a database without exactly 105 / 305 candidates aborts before any write", async () => {
  const db = await createCatalogTestDatabase();
  await signInAsOwner(db);
  await apply(db, [rpcProduct({ variants: COLORS.map((color) => rpcVariant({ color })) })]);
  await assert.rejects(runMigration(db), /android_warranty_backfill_guard: expected 105 products \/ 305 variants, found 1 \/ 3; nothing changed/);
  assert.deepEqual(await storedWarranties(db, "Samsung A16"), [["Black", null], ["Blue", null], ["Green", null]]);
  assert.equal(await count(db, `select (to_regclass('public.catalog_warranty_backfill_audit') is null)::int as n`), 1);
});
