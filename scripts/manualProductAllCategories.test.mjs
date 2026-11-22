import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import {
  SERVER_SAFE_LIVE_COLUMNS,
  checkManualProduct,
  emptyManualVariant,
  liveStockUpdatePage,
  runManualCreate,
  serverSafeLivePatch,
} from "../src/lib/manualProduct.ts";
import { commercialWriteTarget } from "../src/lib/commercialDefaults.ts";

const brands = ["Apple", "Samsung", "Xiaomi", "Infinix"];
const catalog = [
  { id: "a", title: "Apple iPhone 15 Pro Max", slug: "apple-iphone-15-pro-max", brandName: "Apple" },
  { id: "b", title: "Apple iPhone 14 Pro Max (Used)", slug: "apple-iphone-14-pro-max-used", brandName: "Apple" },
  { id: "c", title: "Samsung Galaxy A16", slug: "samsung-galaxy-a16", brandName: "Samsung" },
];
const v = (patch = {}) => ({ ...emptyManualVariant(), storage: "256 GB", color: "Black", price: "100000", stock: "3", ...patch });
const input = (patch = {}) => ({ category: "android", title: "Infinix Hot 60", brandName: "Infinix", content: "", shortDescription: "", productCondition: "", connectivity: "", variants: [v({ ram: "8 GB" })], specs: [], ...patch });
const one = (result) => result.payload.products[0];

test("Android: PTA Approved, Brand New, 1 Year, Karachi only are fixed; RAM / storage / SIM are sent; brand required and not Apple", () => {
  const ok = checkManualProduct(input({ variants: [v({ ram: "8 GB", sim: "dual_physical_sim", pta: "not_approved", condition: "used", warranty: "2 Years", delivery: "nationwide" })] }), catalog, brands);
  assert.equal(ok.ok, true, ok.errors.join("; "));
  assert.equal(one(ok).product_type, "Mobile Phone");
  assert.equal(ok.categorySlug, "mobile-phones");
  const variant = one(ok).variants[0];
  assert.deepEqual([variant.pta_status, variant.condition, variant.warranty, variant.delivery_scope], ["approved", "brand_new", "1 Year", "karachi_only"], "Owner rules override anything typed");
  assert.deepEqual([variant.ram, variant.storage, variant.color, variant.sim_configuration], ["8 GB", "256 GB", "Black", "dual_physical_sim"]);
  assert.deepEqual([variant.condition_grade, variant.battery_health_percent, variant.battery_cycle_count], [null, null, null]);
  assert.match(checkManualProduct(input({ brandName: "" }), catalog, brands).errors.join(" "), /Choose the brand/);
  assert.match(checkManualProduct(input({ brandName: "Apple" }), catalog, brands).errors.join(" "), /New iPhone or Used iPhone/);
  assert.match(checkManualProduct(input({ variants: [v({ storage: "" })] }), catalog, brands).errors.join(" "), /storage is required/);
  assert.match(checkManualProduct(input({ title: "Samsung Galaxy A16", brandName: "Samsung" }), catalog, brands).errors.join(" "), /already exists/);
});

test("New iPhone: Apple, Brand New, PTA chosen (Approved / Non-PTA), warranty optional (1 or 2 years, or blank); no '(Used)' in the name", () => {
  const base = { category: "iphone-new", title: "Apple iPhone 16", brandName: "" };
  const ok = checkManualProduct(input({ ...base, variants: [v({ pta: "approved", warranty: "1 Year", ram: "8 GB", batteryHealth: "90" })] }), catalog, brands);
  assert.equal(ok.ok, true, ok.errors.join("; "));
  assert.equal(one(ok).brand, "Apple");
  const variant = one(ok).variants[0];
  assert.deepEqual([variant.condition, variant.pta_status, variant.warranty, variant.delivery_scope, variant.ram, variant.battery_health_percent], ["brand_new", "approved", "1 Year", "karachi_only", null, null], "no RAM / battery facts for a New iPhone");
  const missing = checkManualProduct(input({ ...base, variants: [v()] }), catalog, brands).errors.join(" ");
  assert.match(missing, /PTA Approved or Non-PTA/);
  assert.doesNotMatch(missing, /warranty/i, "a missing New iPhone warranty is not an error (Owner rule 2026-11-18)");
  const blank = checkManualProduct(input({ ...base, variants: [v({ pta: "approved" })] }), catalog, brands);
  assert.equal(blank.ok, true, blank.errors.join("; "));
  assert.equal(one(blank).variants[0].warranty, null, "blank warranty stays NULL — no default is inserted");
  const twoYears = checkManualProduct(input({ ...base, variants: [v({ pta: "approved", warranty: "2 Years" })] }), catalog, brands);
  assert.equal(one(twoYears).variants[0].warranty, "2 Years", "a stated warranty is kept as given");
  assert.match(checkManualProduct(input({ ...base, variants: [v({ pta: "approved", warranty: "3 Years" })] }), catalog, brands).errors.join(" "), /1 Year or 2 Years, or left blank/);
  assert.match(checkManualProduct(input({ ...base, title: "Apple iPhone 16 (Used)", variants: [v({ pta: "approved", warranty: "1 Year" })] }), catalog, brands).errors.join(" "), /choose Used iPhone/);
  assert.match(checkManualProduct(input({ ...base, title: "Apple iPhone 15 Pro Max", variants: [v({ pta: "approved", warranty: "1 Year" })] }), catalog, brands).errors.join(" "), /already exists/);
});

test("Used iPhone: '(Used)' added, every variant Used, no warranty, optional battery facts only as entered; distinct from the New product", () => {
  const base = { category: "iphone-used", title: "Apple iPhone 15 Pro Max", brandName: "" };
  const ok = checkManualProduct(input({ ...base, variants: [v({ pta: "not_approved", warranty: "1 Year", batteryHealth: "88", cycleCount: "412", grade: "A++" }), v({ pta: "not_approved", batteryHealth: "91" })] }), catalog, brands);
  assert.equal(ok.ok, true, ok.errors.join("; "));
  assert.equal(ok.title, "Apple iPhone 15 Pro Max (Used)");
  assert.equal(ok.slug, "apple-iphone-15-pro-max-used");
  assert.deepEqual(one(ok).variants.map((x) => [x.condition, x.warranty, x.battery_health_percent, x.battery_cycle_count, x.condition_grade]), [["used", null, 88, 412, "A++"], ["used", null, 91, null, null]]);
  const dup = checkManualProduct(input({ ...base, variants: [v({ pta: "approved" }), v({ pta: "approved" })] }), catalog, brands);
  assert.match(dup.errors.join(" "), /same variant is listed twice/);
  assert.match(checkManualProduct(input({ ...base, variants: [v({ pta: "approved", batteryHealth: "101" })] }), catalog, brands).errors.join(" "), /1 to 100/);
  assert.match(checkManualProduct(input({ ...base, title: "Apple iPhone 14 Pro Max", variants: [v({ pta: "approved" })] }), catalog, brands).errors.join(" "), /already exists/);
});

test("Tablet: New/Used + connectivity required; Wi-Fi = Not Applicable, Cellular = Approved / Non-PTA; Karachi only; warranty optional", () => {
  const base = { category: "tablet", title: "Samsung Galaxy Tab S10 FE Wi-Fi", brandName: "Samsung" };
  assert.match(checkManualProduct(input({ ...base, variants: [v()] }), catalog, brands).errors.join(" "), /Choose New or Used[\s\S]*Choose the connectivity/);
  const wifi = checkManualProduct(input({ ...base, productCondition: "brand_new", connectivity: "wifi", variants: [v({ ram: "8 GB", pta: "approved" })] }), catalog, brands);
  assert.equal(wifi.ok, true, wifi.errors.join("; "));
  assert.deepEqual(wifi.warnings, []);
  assert.deepEqual([one(wifi).product_type, one(wifi).variants[0].pta_status, one(wifi).variants[0].condition, one(wifi).variants[0].delivery_scope, one(wifi).variants[0].warranty], ["Tablet", "not_applicable", "brand_new", "karachi_only", null]);
  const cellular = { ...base, title: "Apple iPad Air 11 M3", brandName: "Apple", productCondition: "used", connectivity: "cellular" };
  assert.match(checkManualProduct(input({ ...cellular, variants: [v()] }), catalog, brands).errors.join(" "), /Cellular tablet/);
  const used = checkManualProduct(input({ ...cellular, variants: [v({ pta: "not_approved", warranty: "6 Months" })] }), catalog, brands);
  assert.equal(used.ok, true, used.errors.join("; "));
  assert.equal(used.title, "Apple iPad Air 11 M3 (Used)");
  assert.deepEqual([one(used).variants[0].condition, one(used).variants[0].pta_status, one(used).variants[0].warranty], ["used", "not_approved", "6 Months"]);
  assert.match(used.warnings.join(" "), /Cellular/, "a name without the connectivity word is warned about");
  assert.match(checkManualProduct(input({ ...base, brandName: "", productCondition: "brand_new", connectivity: "wifi" }), catalog, brands).errors.join(" "), /Choose the brand/);
});

test("MacBook: Apple only, PTA Not Applicable, Karachi only, New/Used title rule, warranty optional", () => {
  const ok = checkManualProduct(input({ category: "macbook", title: "Apple MacBook Air 13 M4", brandName: "Samsung", productCondition: "brand_new", variants: [v({ ram: "16 GB", storage: "512 GB", pta: "approved" })] }), catalog, brands);
  assert.equal(ok.ok, true, ok.errors.join("; "));
  assert.equal(one(ok).brand, "Apple", "brand is always Apple");
  assert.equal(one(ok).product_type, "Laptop");
  assert.deepEqual([one(ok).variants[0].pta_status, one(ok).variants[0].delivery_scope, one(ok).variants[0].warranty], ["not_applicable", "karachi_only", null]);
  const used = checkManualProduct(input({ category: "macbook", title: "Apple MacBook Pro 14 M3 (Used)", productCondition: "used", variants: [v({ ram: "8 GB" })] }), catalog, brands);
  assert.equal(used.title, "Apple MacBook Pro 14 M3 (Used)", "an existing (Used) suffix is not doubled");
  assert.match(checkManualProduct(input({ category: "macbook", title: "Apple MacBook Pro 14 M3 (Used)", productCondition: "brand_new" }), catalog, brands).errors.join(" "), /Remove "\(Used\)"/);
  assert.match(checkManualProduct(input({ category: "macbook", title: "Apple MacBook Pro 14", productCondition: "brand_new" }), catalog, ["Samsung"]).errors.join(" "), /Apple brand is not active/);
});

test("Create for a phone reads back category, name, RAM / storage / colour, PTA, condition, warranty and delivery", async () => {
  const check = checkManualProduct(input(), catalog, brands);
  const result = await runManualCreate(check, {
    supabaseUrl: "https://acwatgxkcyrdxpcljxjb.supabase.co",
    buildMode: "development",
    createProduct: async () => ({ products: [{ id: "n1", title: "Infinix Hot 60", action: "Create" }], assigned_skus: [{ sku: "MB300" }] }),
    saveDescription: async () => {},
    readBack: async () => ({ id: "n1", title: "Infinix Hot 60", slug: "infinix-hot-60", publication_status: "draft", data_class: "real", category_slug: "mobile-phones", content: null, short_description: null, spec_count: 0,
      variants: [{ sku: "MB300", ram: "8 GB", storage: "256 GB", color: "Black", price_minor: 10000000, on_hand: 3, pta_status: "approved", condition: "brand_new", warranty_override: "1 Year", delivery_scope: "karachi_only" }] }),
  }, commercialWriteTarget);
  assert.equal(result.status, "created", result.message);
  const wrong = await runManualCreate(check, {
    supabaseUrl: "https://acwatgxkcyrdxpcljxjb.supabase.co",
    buildMode: "development",
    createProduct: async () => ({ products: [{ id: "n1", title: "Infinix Hot 60", action: "Create" }], assigned_skus: [] }),
    saveDescription: async () => {},
    readBack: async () => ({ id: "n1", title: "Infinix Hot 60", slug: "infinix-hot-60", publication_status: "draft", data_class: "real", category_slug: "mobile-phones", content: null, short_description: null, spec_count: 0,
      variants: [{ sku: "MB300", ram: "8 GB", storage: "256 GB", color: "Black", price_minor: 10000000, on_hand: 3, pta_status: "unknown", condition: "brand_new", warranty_override: null, delivery_scope: "karachi_only" }] }),
  }, commercialWriteTarget);
  assert.equal(wrong.status, "created_with_problems");
});

test("Server-safe live edits: only columns the publish validator never reads (checked against the current validator SQL)", () => {
  const migrations = readdirSync(new URL("../supabase/migrations/", import.meta.url)).filter((name) => name.endsWith(".sql")).sort();
  const definers = migrations.filter((name) => readFileSync(new URL(`../supabase/migrations/${name}`, import.meta.url), "utf8").includes("function public.validate_product_for_publication"));
  // Reviewed validator versions: 202610270001 (committed), 202611060001 (applied on DEV + PROD; may be uncommitted locally)
  // and 202611190001 (New iPhone warranty optional; file only, not applied). 202611190001 reads no new product column.
  assert.ok(["202610270001_tablet_macbook_stock_update_and_publication.sql", "202611060001_publication_accessories_no_warranty.sql", "202611190001_publication_new_iphone_warranty_optional.sql"].includes(definers.at(-1)), `the publish validator changed (${definers.at(-1)}) — re-check SERVER_SAFE_LIVE_COLUMNS and liveProductProblems`);
  for (const name of definers.filter((file) => file >= "202610270001")) {
    const sql = readFileSync(new URL(`../supabase/migrations/${name}`, import.meta.url), "utf8");
    const body = sql.slice(sql.lastIndexOf("create or replace function public.validate_product_for_publication"));
    const validator = body.slice(0, body.indexOf("$$;"));
    for (const column of SERVER_SAFE_LIVE_COLUMNS) assert.equal(new RegExp(`\\b${column}\\b`).test(validator), false, `${name}: ${column} is not read by the validator`);
    for (const column of ["title", "brand_id", "category_id", "data_class", "default_warranty", "warranty_override", "pta_status", "condition", "delivery_scope", "price_minor", "is_primary"]) assert.match(validator, new RegExp(`\\b${column}\\b`), `${name}: ${column} is read by the validator (so it is locked while live)`);
  }
  const patch = serverSafeLivePatch({ title: "x", brand_id: "b", category_id: "c", slug: "s", data_class: "development", publication_status: "draft", default_warranty: "", content: " A ", seo_title: "", is_featured: true });
  assert.deepEqual(Object.keys(patch).sort(), [...SERVER_SAFE_LIVE_COLUMNS].sort());
  assert.equal(patch.content, "A");
  assert.equal(patch.seo_title, null);
});

test("Live prices / variants go to the existing server-checked Stock Update page of the category", () => {
  assert.deepEqual(liveStockUpdatePage("mobile-phones", "Samsung"), { href: "/admin/stock-update", label: "Stock Update (Android)" });
  assert.equal(liveStockUpdatePage("mobile-phones", "Apple").href, "/admin/iphone-stock-update");
  assert.equal(liveStockUpdatePage("tablets", "Samsung").href, "/admin/tablet-stock-update");
  assert.equal(liveStockUpdatePage("laptops", "Apple").href, "/admin/tablet-stock-update");
  assert.equal(liveStockUpdatePage("gadgets", null), null);
});

test("Editor wiring: live phones / tablets / MacBooks never send validator columns and refuse variant writes; Gadgets unchanged", () => {
  const editor = readFileSync(new URL("../src/admin/AdminCatalog.tsx", import.meta.url), "utf8").replace(/\r\n/g, "\n");
  const saveSafe = editor.match(/const saveServerSafe = async \(\) => \{[\s\S]*?\n  \};/)[0];
  assert.match(saveSafe, /\.update\(serverSafeLivePatch\(/);
  assert.equal(/publication_status|persistChangedVariantPricing|product_variants/.test(saveSafe), false);
  assert.match(editor, /const serverSafeLive = Boolean\(productId\) && !manualMode && draft\.publication_status === "published";/);
  for (const name of ["addVariant", "saveVariantPrice", "saveVariantDetails", "deleteVariant", "applyCommercialDefaults"]) {
    const body = editor.match(new RegExp(`const ${name} = async [^\\n]*\\n[\\s\\S]*?\\n  \\};`))[0];
    assert.match(body, /if \(serverSafeLive\) \{\s*setMessage\(serverSafeMessage\);/, `${name} refuses on a live phone / tablet / MacBook`);
  }
  assert.match(editor, /Unpublish &amp; edit as Draft/);
  assert.match(editor, /window\.confirm\("Take this product off the website/);
  // Gadgets / Accessories keep their pre-checked Save changes, now with the server's full primary-image rule.
  assert.match(editor.match(/const saveChanges = async \(\) => \{[\s\S]*?\n  \};/)[0], /safeProductPatch\(/);
  assert.match(editor, /\.not\("secure_url", "is", null\)\.gt\("width", 0\)\.gt\("height", 0\)\.gt\("bytes", 0\)/);
  // Duplicate variants are refused before the insert, for every category.
  assert.match(editor.match(/const addVariant = async [\s\S]*?\n  \};/)[0], /This variant already exists on the product/);
});
