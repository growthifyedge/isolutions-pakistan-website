// Model-Based Shared Specifications (iPhone + Android): pure helpers + migration 202611200002 replayed in an in-memory
// database (scripts/support/catalogTestDatabase.mjs). Nothing here touches DEV or PROD.
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import {
  androidModelKey,
  groupPhoneModels,
  iphoneModelKey,
  iphoneModelName,
  approvedSheetRows,
  isVariantSpecificLabel,
  modelSpecBlocker,
  modelSpecCorrectionsPayload,
  modelSpecPayload,
  modelSpecsFromCsv,
  modelSpecsFromProduct,
  phoneModelKey,
  planModelSpecs,
} from "../src/lib/iphoneModelSpecs.ts";
import { createCatalogTestDatabase, signInAsOwner } from "./support/catalogTestDatabase.mjs";

const readText = (path) => readFileSync(new URL(path, import.meta.url), "utf8").replace(/\r\n/g, "\n");
const migration = readText("../supabase/migrations/202611200002_iphone_model_shared_specifications.sql");
const adminApp = readText("../src/admin/AdminApp.tsx");
const page = readText("../src/admin/IphoneModelSpecs.tsx");

// Same table is checked against the TypeScript reader AND the SQL function.
const KEY_CASES = [
  ["Apple iPhone 18 Pro Max", "iphone-18-pro-max"],
  ["iPhone 18 Pro Max", "iphone-18-pro-max"],
  ["Apple iPhone 18 Pro Max (Used)", "iphone-18-pro-max"],
  ["iPhone 18 Pro Max (Used)", "iphone-18-pro-max"],
  ["  apple   IPHONE 18   pro max ", "iphone-18-pro-max"],
  ["iPhone 18ProMax", "iphone-18-pro-max"],
  // PTA and storage wording never change the model.
  ["iPhone 18 Pro Max 256GB", "iphone-18-pro-max"],
  ["Apple iPhone 18 Pro Max PTA Approved", "iphone-18-pro-max"],
  ["iPhone 18 Pro Max Non-PTA 1TB (Used)", "iphone-18-pro-max"],
  ["iPhone 18 Pro Max (PTA)", "iphone-18-pro-max"],
  ["iPhone 18 Pro Max non pta", "iphone-18-pro-max"],
  // A trailing colour never changes the model.
  ["iPhone 18 Pro Max Burgundy", "iphone-18-pro-max"],
  ["Apple iPhone 16 Pro Natural Titanium (Used)", "iphone-16-pro"],
  ["iPhone 17 Pro Max Cosmic Orange 256GB PTA", "iphone-17-pro-max"],
  ["iPhone Air Sky Blue", "iphone-air"],
  ["iPhone 15 Black Non-PTA", "iphone-15"],
  ["iPhone 18 Pro", "iphone-18-pro"],
  ["Apple iPhone 18 Pro (Used)", "iphone-18-pro"],
  ["Apple iPhone 15", "iphone-15"],
  ["Apple iPhone 15 Plus", "iphone-15-plus"],
  ["Apple iPhone 13 mini", "iphone-13-mini"],
  ["iPhone 16e", "iphone-16e"],
  ["iPhone Air", "iphone-air"],
  ["iPhone XS Max", "iphone-xs-max"],
  ["iPhone XR", "iphone-xr"],
  // Ambiguous / not an exact model: never matched.
  ["Apple iPhone 18 Pro Max (JV)", null],
  ["iPhone 18 Pro Max Natural", null],
  ["iPhone 18 Pro Max (Black)", null],
  ["iPhone 18 Max", null],
  ["iPhone SE", null],
  ["iPhone SE (2022)", null],
  ["iPhone 16e Pro", null],
  ["iPhone Pro Max", null],
  ["Apple Pencil 2nd Generation", null],
  ["Samsung Galaxy S26 Ultra", null],
  ["iPhone 18 Pro Max (Refurbished)", null],
  ["", null],
];

const ANDROID_CASES = [
  ["samsung", "Samsung A57", "samsung-a57"],
  ["samsung", "Samsung A57 PTA 8/256GB", "samsung-a57"],
  ["samsung", "samsung  a57 (Used)", "samsung-a57"],
  ["samsung", "Samsung A57 Non-PTA 8GB+256GB (Used)", "samsung-a57"],
  ["samsung", "A57", "samsung-a57"],
  ["samsung", "Samsung S26", "samsung-s26"],
  ["samsung", "Samsung S26 Ultra", "samsung-s26-ultra"],
  ["samsung", "Samsung S26Ultra 12GB+512GB", "samsung-s26-ultra"],
  // Series aliases: Galaxy (Samsung) and Moto (Motorola) are optional.
  ["samsung", "Samsung Galaxy S26 Ultra", "samsung-s26-ultra"],
  ["samsung", "Samsung Galaxy A57", "samsung-a57"],
  ["samsung", "Galaxy A57", "samsung-a57"],
  ["samsung", "SAMSUNG GALAXY A57 PTA 8/256GB Awesome Black (Used)", "samsung-a57"],
  ["samsung", "Samsung Galaxy A57 5G", "samsung-a57-5g"],
  ["samsung", "Samsung S25", "samsung-s25"],
  ["samsung", "Samsung Galaxy S25FE", "samsung-s25-fe"],
  ["samsung", "Samsung S25 FE Mint", "samsung-s25-fe"],
  ["samsung", "Samsung S26 Ultra Titanium Silverblue", "samsung-s26-ultra-titanium-silverblue"],
  ["samsung", "Samsung Galaxy", null],
  ["motorola", "Motorola Moto G77", "motorola-g77"],
  ["motorola", "Moto G77", "motorola-g77"],
  ["motorola", "Motorola G77", "motorola-g77"],
  ["motorola", "Motorola Edge 70 Fusion", "motorola-edge-70-fusion"],
  ["oppo", "Oppo Reno 15 Pro Max 5G", "oppo-reno-15-pro-max-5g"],
  ["infinix", "Infinix Note 60 Pro", "infinix-note-60-pro"],
  ["infinix", "Infinix Note 60 Pro+", "infinix-note-60-pro-plus"],
  ["nothing", "Nothing Phone 3A", "nothing-phone-3a"],
  ["xiaomi", "Xiaomi Galaxy 5", "xiaomi-galaxy-5"],
  ["oppo", "Oppo Reno 15 5G", "oppo-reno-15-5g"],
  ["oppo", "Oppo Reno 15 Pro 5G", "oppo-reno-15-pro-5g"],
  ["honor", "Honor X5c", "honor-x5c"],
  ["honor", "Honor X5c+", "honor-x5c-plus"],
  ["itel", "itel A200+", "itel-a200-plus"],
  ["nothing", "Nothing Phone 3A Lite", "nothing-phone-3a-lite"],
  ["infinix", "Infinix Hot 70", "infinix-hot-70"],
  ["infinix", "Infinix Hot 70 Pro", "infinix-hot-70-pro"],
  ["realme", "Realme C75x", "realme-c75x"],
  // Not an exact model: never matched.
  ["samsung", "Samsung A57 (JV)", null],
  ["samsung", "Samsung A57 (Refurbished)", null],
  ["samsung", "Samsung", null],
  ["samsung", "", null],
  ["Bad Slug", "Samsung A57", null],
];

test("iPhone model identity: Apple prefix, Used suffix, PTA and storage wording, case and spacing ignored; generations and Pro / Pro Max kept apart", () => {
  for (const [title, key] of KEY_CASES) assert.equal(iphoneModelKey(title), key, JSON.stringify(title));
  assert.notEqual(iphoneModelKey("iPhone 18 Pro"), iphoneModelKey("iPhone 18 Pro Max"));
  assert.notEqual(iphoneModelKey("iPhone 17 Pro Max"), iphoneModelKey("iPhone 18 Pro Max"));
  assert.equal(iphoneModelName("iphone-18-pro-max"), "iPhone 18 Pro Max");
  assert.equal(iphoneModelName("iphone-16e"), "iPhone 16e");
  assert.equal(iphoneModelName("iphone-xs-max"), "iPhone XS Max");
});

test("Android model identity: brand + model; PTA, storage, Used ignored; Ultra / Pro / + / 5G keep models apart", () => {
  for (const [brand, title, key] of ANDROID_CASES) assert.equal(androidModelKey(brand, title), key, JSON.stringify([brand, title]));
  assert.notEqual(androidModelKey("samsung", "Samsung S26"), androidModelKey("samsung", "Samsung S26 Ultra"));
  assert.notEqual(androidModelKey("honor", "Honor X5c"), androidModelKey("honor", "Honor X5c+"));
  assert.notEqual(androidModelKey("oppo", "Oppo Reno 15 5G"), androidModelKey("oppo", "Oppo Reno 15 Pro 5G"));
  assert.notEqual(androidModelKey("samsung", "Samsung A57"), androidModelKey("oppo", "Oppo A57"), "brands never mix");
  // Different models never mix: Pro / Pro+ / Max / Ultra / Lite / FE / 5G.
  const different = [["Samsung S26", "Samsung S26 Ultra"], ["Samsung S26 Ultra", "Samsung S26+"], ["Samsung S25", "Samsung S25 FE"], ["Samsung A57", "Samsung A57 5G"],
    ["Infinix Note 60 Pro", "Infinix Note 60 Pro+"], ["Oppo Reno 15 Pro 5G", "Oppo Reno 15 Pro Max 5G"], ["Nothing Phone 3A", "Nothing Phone 3A Lite"], ["Samsung A57", "Samsung A57 Pro"]];
  for (const [a, b] of different) assert.notEqual(androidModelKey(a.split(" ")[0].toLowerCase(), a), androidModelKey(b.split(" ")[0].toLowerCase(), b), `${a} vs ${b}`);
  assert.notEqual(iphoneModelKey("iPhone 17 Pro"), iphoneModelKey("iPhone 17 Pro Max"));
  assert.notEqual(iphoneModelKey("iPhone 16"), iphoneModelKey("iPhone 16 Plus"));
  assert.notEqual(iphoneModelKey("iPhone 16"), iphoneModelKey("iPhone 16e"));
  assert.equal(androidModelKey("samsung", "Samsung Galaxy A57"), androidModelKey("samsung", "Samsung A57"));
  assert.equal(phoneModelKey("apple", "Apple iPhone 15"), "iphone-15");
  assert.equal(phoneModelKey("samsung", "Samsung A57"), "samsung-a57");
  assert.equal(phoneModelKey(null, "Samsung A57"), null);
});

test("variant facts are never shared", () => {
  for (const label of ["Storage", "Internal Storage", "RAM", "Memory", "Colour", "Colors", "Price", "PTA Status", "Condition", "Warranty", "Battery Health", "Battery Cycles", "Cycle Count", "Grade", "SIM", "SIM Type", "Stock", "IMEI"])
    assert.equal(isVariantSpecificLabel("Other", label), true, label);
  for (const label of ["Display Type", "Screen Size", "Chipset", "Wireless Charging", "Video Playback", "Biometric Security", "Water and Dust Resistance", "Network", "Simultaneous Recording"])
    assert.equal(isVariantSpecificLabel("Display", label), false, label);
  assert.equal(isVariantSpecificLabel("Storage", "Capacity"), true);
});

// ---------- preview (pure) ----------

const product = (id, title, extra = {}) => ({ id, slug: id, title, brandSlug: "apple", categorySlug: "mobile-phones", publicationStatus: "published", conditions: ["brand_new"], ptaStatuses: ["approved"], variantCount: 2, ...extra });
const CATALOG = [
  product("p-apple-pta", "Apple iPhone 18 Pro Max"),
  product("p-plain-nonpta", "iPhone 18 Pro Max", { ptaStatuses: ["not_approved"] }),
  product("p-used", "Apple iPhone 18 Pro Max (Used)", { conditions: ["used"], publicationStatus: "draft" }),
  product("p-pro", "Apple iPhone 18 Pro"),
  product("p-ambiguous", "Apple iPhone 18 Pro Max (JV)"),
  product("p-pencil", "Apple Pencil 2nd Generation", { categorySlug: "mobile-accessories" }),
  product("p-a57", "Samsung A57", { brandSlug: "samsung" }),
  product("p-a57-used", "Samsung A57 PTA 8/256GB (Used)", { brandSlug: "samsung", conditions: ["used"] }),
  product("p-s26u", "Samsung S26 Ultra", { brandSlug: "samsung" }),
  product("p-tab", "Samsung Tab S10", { brandSlug: "samsung", categorySlug: "tablets" }),
];
const spec = (product_id, group, label, value, sort_order = 0) => ({ id: `${product_id}-${label}`, product_id, specification_group: group, label, value, sort_order });
const EXISTING = [
  spec("p-apple-pta", "Display", "Screen Size", "6.9 inches", 0),
  spec("p-apple-pta", "Performance", "Chipset", "Apple A20 Pro", 1),
  spec("p-apple-pta", "Build", "Weight", "249 g", 2),
  spec("p-used", "Build", "Weight", "250 g", 0), // conflicting stored value: must be kept
  spec("p-pro", "Display", "Screen Size", "6.3 inches", 0),
];

test("grouping: iPhone + Android exact models; ambiguous titles listed and blocked; other categories ignored", () => {
  const { models, ambiguous } = groupPhoneModels(CATALOG);
  assert.deepEqual(models.map((model) => [model.kind, model.name, model.products.map((entry) => entry.id)]), [
    ["iphone", "iPhone 18 Pro", ["p-pro"]],
    ["iphone", "iPhone 18 Pro Max", ["p-apple-pta", "p-used", "p-plain-nonpta"]],
    ["android", "Samsung A57", ["p-a57", "p-a57-used"]],
    ["android", "Samsung S26 Ultra", ["p-s26u"]],
  ]);
  assert.deepEqual(ambiguous.map((entry) => entry.id), ["p-ambiguous"]);
});

test("preview: one set of specs for every matching product; present skipped; conflicts kept; Pro untouched; final sheet needs no tick or phrase", () => {
  const { models } = groupPhoneModels(CATALOG);
  const proMax = models.find((model) => model.key === "iphone-18-pro-max");
  const specs = modelSpecsFromProduct("p-apple-pta", EXISTING);
  assert.deepEqual(specs.map((entry) => entry.label), ["Screen Size", "Chipset", "Weight"]);
  const plan = planModelSpecs(proMax, specs, EXISTING);
  const by = Object.fromEntries(plan.products.map((entry) => [entry.product.id, [entry.add, entry.present, entry.conflicts]]));
  assert.deepEqual(by, { "p-apple-pta": [0, 3, 0], "p-used": [2, 0, 1], "p-plain-nonpta": [3, 0, 0] });
  assert.deepEqual(plan.totals, { specs: 3, products: 3, affected: 2, add: 5, present: 3, conflicts: 1, corrections: 0, corrected: 0 });
  assert.equal(plan.products.some((entry) => entry.product.id === "p-pro"), false);
  // Owner decision 2026-11-21: the final verified sheet is the approval — ready as soon as the preview is clean.
  assert.equal(modelSpecBlocker(plan), null);
  assert.match(modelSpecBlocker(null), /upload its final verified sheet/);
  const conflict = plan.products.find((entry) => entry.product.id === "p-used").rows.find((row) => row.category === "Conflict");
  assert.equal(conflict.existing.value, "250 g");
  // Applying is allowed even when every product already has the values (it still saves them for future products).
  const onlyApple = planModelSpecs({ ...proMax, products: proMax.products.filter((entry) => entry.id === "p-apple-pta") }, specs, EXISTING);
  assert.equal(modelSpecBlocker(onlyApple), null);
});

test("corrections: the final sheet corrects differing approved values (no tick); only products with the old approved value follow", () => {
  const { models } = groupPhoneModels(CATALOG);
  const proMax = models.find((model) => model.key === "iphone-18-pro-max");
  const existing = [...EXISTING, spec("p-plain-nonpta", "Build", "Weight", "249 g")];
  const approved = [{ label: "Screen Size", value: "6.9 inches" }, { label: "Weight", value: "249 g" }];
  const specs = [{ rowNumber: 2, section: "Display", label: "Screen Size", value: "6.9 inches" }, { rowNumber: 3, section: "Build", label: "Weight", value: "247 g" }];
  const sheet = planModelSpecs(proMax, specs, existing, approved);
  assert.deepEqual(sheet.approvedChanges, [{ label: "Weight", section: "Build", oldValue: "249 g", newValue: "247 g", ticked: true, followers: 2 }]);
  const by = Object.fromEntries(sheet.products.map((entry) => [entry.product.id, [entry.add, entry.present, entry.conflicts, entry.correct]]));
  // p-apple-pta (249 g) and p-plain-nonpta (249 g) follow; p-used keeps its own 250 g (conflict shown, never overwritten).
  assert.deepEqual(by, { "p-apple-pta": [0, 1, 0, 1], "p-plain-nonpta": [1, 0, 0, 1], "p-used": [1, 0, 1, 0] });
  assert.deepEqual([sheet.totals.corrections, sheet.totals.corrected, sheet.totals.conflicts], [1, 2, 1]);
  assert.deepEqual(modelSpecCorrectionsPayload(sheet), [{ label: "Weight", old_value: "249 g" }]);
  assert.equal(modelSpecBlocker(sheet), null);
  // A limited set still works (lib option): nothing corrected when no label is chosen.
  const none = planModelSpecs(proMax, specs, existing, approved, new Set());
  assert.deepEqual([none.totals.corrections, none.totals.corrected, modelSpecCorrectionsPayload(none).length], [0, 0, 0]);
});

test("final verified sheet: optional Status column; unverified, blank, placeholder and variant-fact rows are skipped, never applied", () => {
  const parsed = modelSpecsFromCsv(
    "Section,Label,Value,Status\r\nDisplay,Screen Size,6.9 inches,Verified\r\nPerformance,Chipset,A20 Pro,Unverified\r\nBuild,Weight,,Verified\r\n" +
      "Camera,Main Camera,TBD,Verified\r\nBattery,Capacity,4685 mAh?,Verified\r\nOther,Storage,256 GB,Verified\r\nBuild,Materials,Titanium,\r\nConnectivity,Wi-Fi,Wi-Fi 7,approved\r\n",
  );
  assert.deepEqual(parsed.fileErrors, []);
  const { apply, skipped } = approvedSheetRows(parsed.specs);
  assert.deepEqual(apply.map((row) => row.label), ["Screen Size", "Wi-Fi"]);
  assert.deepEqual(skipped.map((row) => [row.rowNumber, row.label]), [[3, "Chipset"], [4, "Weight"], [5, "Main Camera"], [6, "Capacity"], [7, "Storage"], [8, "Materials"]]);
  assert.match(skipped[0].reason, /not Verified/);
  assert.match(skipped[5].reason, /no status/);
  // Without a Status column every row with a real value is applied (the sheet itself is the approval).
  const plain = approvedSheetRows(modelSpecsFromCsv("Section,Label,Value\r\nDisplay,Screen Size,6.9 inches\r\nBuild,Weight,N/A\r\n").specs);
  assert.deepEqual([plain.apply.map((row) => row.label), plain.skipped.map((row) => row.label)], [["Screen Size"], ["Weight"]]);
  // Only skipped rows: nothing to apply.
  const { models } = groupPhoneModels(CATALOG);
  const proMax = models.find((model) => model.key === "iphone-18-pro-max");
  assert.match(modelSpecBlocker(planModelSpecs(proMax, approvedSheetRows(parsed.specs.slice(1, 3)).apply, EXISTING)), /no verified specification/);
});

test("file upload: Section / Label / Value; unknown sections and duplicates (ambiguous) block saving", () => {
  const parsed = modelSpecsFromCsv("Section,Label,Value\r\nDisplay,Screen Size,6.9 inches\r\nOther,Storage,256 GB\r\nOops,Thing,1\r\nDisplay,screen size,6.9\r\n");
  assert.deepEqual(parsed.fileErrors, []);
  const { models } = groupPhoneModels(CATALOG);
  const plan = planModelSpecs(models[1], parsed.specs, EXISTING);
  assert.deepEqual(plan.specProblems.map((problem) => problem.rowNumber), [3, 4, 5]);
  assert.match(modelSpecBlocker(plan), /Fix the problems/);
  // Through the sheet reader the variant fact (row 3) is skipped; the unknown section and the duplicate still block.
  const sheetPlan = planModelSpecs(models[1], approvedSheetRows(parsed.specs).apply, EXISTING);
  assert.deepEqual(sheetPlan.specProblems.map((problem) => problem.rowNumber), [4, 5]);
  assert.match(modelSpecBlocker(sheetPlan), /Fix the problems/);
  assert.deepEqual(modelSpecsFromCsv("Label,Value\r\nA,B\r\n").fileErrors, ["Missing column(s): Section. Use the columns Section, Label, Value."]);
  const excelCsv = modelSpecsFromCsv(`${String.fromCharCode(0xfeff)}Section,Label,Value\r\nDisplay,Screen Size,6.9 inches\r\n`);
  assert.deepEqual([excelCsv.fileErrors, excelCsv.specs.map((entry) => entry.label)], [[], ["Screen Size"]], "Excel's UTF-8 BOM is ignored");
});

test("admin page: same route, final verified sheet, preview before save, one Apply click (no tick, no typed phrase, file read never writes)", () => {
  // Merged into Spec Upload: no separate sidebar item; the old address opens the Same Model option.
  assert.doesNotMatch(adminApp, /\["Model Specs",/);
  assert.match(adminApp, /\["Spec Upload", "\/admin\/spec-upload", FileSearch\]/);
  assert.match(adminApp, /path === "\/admin\/spec-upload" \|\| path === "\/admin\/iphone-model-specs"\)/);
  assert.match(adminApp, /<AdminLayout section="Spec Upload">\s*<SpecUploadModes initial=\{path === "\/admin\/iphone-model-specs" \|\| new URLSearchParams\(location\.search\)\.get\("mode"\) === "model" \? "model" : "single"\} \/>/);
  assert.match(adminApp, /\{mode === "single" \? <SpecificationBulkUpload \/> : <IphoneModelSpecs \/>\}/);
  assert.match(adminApp, /Single Product/);
  assert.match(adminApp, /Same Model <small>iPhone \+ Android<\/small>/);
  assert.match(page, /3\. Preview — nothing is saved yet/);
  assert.match(page, /2\. Upload the final verified sheet of/);
  assert.match(page, /Apply approved sheet to/);
  assert.match(page, /disabled=\{Boolean\(blocker\) \|\| busy\}/);
  // Owner decision 2026-11-21: no verification tick, typed phrase, per-correction tick, or copy-from-product source.
  assert.doesNotMatch(page, /I verified these specifications|modelSpecConfirmationPhrase|setTyped|toggleCorrection|type="checkbox"|modelSpecsFromProduct|Copy from a product/);
  // Choosing a file only parses it; the RPC is called from save() alone, after the Owner's click (and a summary confirm).
  const chooseFile = page.slice(page.indexOf("async function chooseFile"), page.indexOf("async function save"));
  assert.doesNotMatch(chooseFile, /applyIphoneModelSpecs|supabase\./);
  assert.match(page, /if \(!window\.confirm\(summary\)\) return;\n\s+setBusy\(true\);[\s\S]*?await applyIphoneModelSpecs\(/);
  assert.equal((page.match(/applyIphoneModelSpecs\(/g) ?? []).length, 1);
  assert.doesNotMatch(page, /from\("(product_specifications|model_common_specifications)"\)\.(insert|update|delete|upsert)/);
});

test("migration: one new table (approved model specs) and functions; no product, variant or existing-spec change", () => {
  assert.deepEqual([...migration.matchAll(/\bcreate table(?: if not exists)? public\.(\w+)/gi)].map((match) => match[1]), ["model_common_specifications"]);
  assert.doesNotMatch(migration, /\b(alter|drop) table (?!public\.model_common_specifications enable row level security;)/i);
  // Only Owner-ticked corrections update: the approved row, and product values that still equal the old approved value.
  assert.deepEqual([...migration.matchAll(/\bupdate public\.(\w+)/gi)].map((match) => match[1]), ["model_common_specifications", "product_specifications"]);
  assert.match(migration, /update public\.product_specifications set value = v_value where id = v_existing\.id;/);
  assert.doesNotMatch(migration, /\bdelete from\b/i);
  assert.doesNotMatch(migration, /insert into public\.(products|product_variants|inventory_movements|product_media)/i);
  assert.match(migration, /revoke all on function public\.apply_model_common_specifications\(text, uuid\[\], jsonb, jsonb\) from public, anon;/);
  assert.match(migration, /revoke all on public\.model_common_specifications from public, anon, authenticated;\ngrant select on public\.model_common_specifications to authenticated;/);
});

// ---------- database behaviour (in-memory replay) ----------

const db = await createCatalogTestDatabase({ supabaseDefaultPrivileges: true });
const ownerId = await signInAsOwner(db);
const all = async (sql, params = []) => (await db.query(sql, params)).rows;
const one = async (sql, params = []) => (await all(sql, params))[0];
const asAuthenticated = async (fn) => {
  await db.query("set role authenticated");
  try { return await fn(); } finally { await db.query("reset role"); }
};
const actAs = (id) => db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [id]);

test("SQL model keys match the TypeScript readers for every case", async () => {
  for (const [title] of KEY_CASES) {
    const row = await one(`select public.iphone_model_key($1) as key, public.model_spec_key('apple', $1) as via`, [title]);
    assert.equal(row.key, iphoneModelKey(title), JSON.stringify(title));
    assert.equal(row.via, iphoneModelKey(title), JSON.stringify(title));
  }
  for (const [brand, title] of ANDROID_CASES) {
    const row = await one(`select public.model_spec_key($1, $2) as key`, [brand, title]);
    assert.equal(row.key, androidModelKey(brand, title), JSON.stringify([brand, title]));
  }
  for (const label of ["Storage", "RAM", "Battery Health", "SIM Type", "Colour", "Warranty", "PTA Status"])
    assert.equal((await one(`select public.is_variant_specific_spec('Other', $1) as v`, [label])).v, true, label);
  assert.equal((await one(`select public.is_variant_specific_spec('Display', 'Screen Size') as v`)).v, false);
});

const variant = (overrides = {}) => ({
  source: "row", sku: null, ram: null, storage: "256 GB", color: "Burgundy",
  price_minor: 50_000_000, compare_at_price_minor: null, stock: 3,
  pta_status: "approved", condition: "brand_new", condition_grade: null,
  battery_health_percent: null, battery_cycle_count: null,
  warranty: "1 Year Official", delivery_scope: "karachi_only", ...overrides,
});
const importProduct = async (title, variants, { brand = "Apple", specifications = [] } = {}) => {
  const { rows: [row] } = await db.query(`select public.apply_catalog_bulk_import_v2($1::jsonb) as r`, [JSON.stringify({ products: [{ action: "Create", source: "row", product_type: "Mobile Phone", brand, title, category: "Mobile Phones", specifications, variants }] })]);
  assert.ok((await one(`select id from public.products where title = $1`, [title]))?.id, `imported: ${title} ${JSON.stringify(row.r)}`);
  return row.r;
};
await importProduct("Apple iPhone 18 Pro Max", [variant(), variant({ storage: "512 GB", price_minor: 60_000_000 })]);
await importProduct("iPhone 18 Pro Max", [variant({ pta_status: "not_approved" }), variant({ pta_status: "not_approved", color: "Silver" })]);
await importProduct("Apple iPhone 18 Pro Max (Used)", [variant({ condition: "used", warranty: null, battery_health_percent: 92, battery_cycle_count: 140 })]);
await importProduct("Apple iPhone 18 Pro", [variant()]);
await importProduct("Apple iPhone 18 Pro Max (JV)", [variant()]);
const idOf = async (title) => (await one(`select id from public.products where title = $1`, [title]))?.id;
const ids = {
  applePta: await idOf("Apple iPhone 18 Pro Max"),
  plainNonPta: await idOf("iPhone 18 Pro Max"),
  used: await idOf("Apple iPhone 18 Pro Max (Used)"),
  pro: await idOf("Apple iPhone 18 Pro"),
  ambiguous: await idOf("Apple iPhone 18 Pro Max (JV)"),
};
await db.query(
  `insert into public.product_specifications (product_id, specification_group, label, value, sort_order) values
   ($1, 'Display', 'Screen Size', '6.9 inches', 0), ($1, 'Performance', 'Chipset', 'Apple A20 Pro', 1), ($1, 'Build', 'Weight', '249 g', 2),
   ($2, 'Build', 'Weight', '250 g', 0), ($3, 'Display', 'Screen Size', '6.3 inches', 0)`,
  [ids.applePta, ids.used, ids.pro],
);
const SHARED = [
  { specification_group: "Display", label: "Screen Size", value: "6.9 inches" },
  { specification_group: "Performance", label: "Chipset", value: "Apple A20 Pro" },
  { specification_group: "Build", label: "Weight", value: "249 g" },
];
const proMaxIds = [ids.applePta, ids.plainNonPta, ids.used];
const fingerprint = () => all(
  `select p.id, p.title, p.slug, p.publication_status, v.sku, v.storage_display, v.color_finish, v.price_minor, v.pta_status, v.condition,
          v.warranty_override, v.battery_health_percent, v.battery_cycle_count, v.condition_grade, v.ram_display, public.current_inventory(v.id) as stock
   from public.products p join public.product_variants v on v.product_id = p.id order by p.id, v.sku`);
const specsOf = (id) => all(`select specification_group, label, value from public.product_specifications where product_id = $1 order by sort_order, label`, [id]);
const approvedOf = (key) => all(`select specification_group, label, value from public.model_common_specifications where model_key = $1 order by sort_order, label`, [key]);
const apply = (key, productIds, specs) =>
  asAuthenticated(() => one(`select public.apply_model_common_specifications($1, $2::uuid[], $3::jsonb) as r`, [key, productIds, JSON.stringify(specs)]));

test("Owner only: Admin and signed-out users are refused; nothing is written; approved list cannot be written directly", async () => {
  const { rows: [{ id: adminId }] } = await db.query(`insert into auth.users (email) values ('admin@example.test') returning id`);
  await db.query(`update public.profiles set role = 'admin', is_active = true where id = $1`, [adminId]);
  await actAs(adminId);
  await assert.rejects(apply("iphone-18-pro-max", proMaxIds, SHARED), /owner required/);
  await actAs("");
  await assert.rejects(apply("iphone-18-pro-max", proMaxIds, SHARED), /owner required|permission denied/);
  await db.query("set role anon");
  await assert.rejects(db.query(`select public.apply_model_common_specifications('iphone-18-pro-max', '{}'::uuid[], '[]'::jsonb)`), /permission denied/);
  await db.query("reset role");
  await actAs(ownerId);
  await assert.rejects(asAuthenticated(() => db.query(
    `insert into public.model_common_specifications (model_key, specification_group, label, value, approved_by) values ('iphone-18-pro-max', 'Display', 'X', 'Y', $1)`, [ownerId])), /permission denied/);
  await assert.rejects(asAuthenticated(() => db.query(`select public.copy_approved_model_specifications()`)), /permission denied|trigger functions can only be called as triggers/);
  assert.deepEqual(await specsOf(ids.plainNonPta), []);
  assert.deepEqual(await approvedOf("iphone-18-pro-max"), []);
});

test("refused payloads: variant facts, stale product set, unknown model", async () => {
  await actAs(ownerId);
  await assert.rejects(apply("iphone-18-pro-max", proMaxIds, [...SHARED, { specification_group: "Other", label: "Storage", value: "256 GB" }]), /variant_specific/);
  await assert.rejects(apply("iphone-18-pro-max", proMaxIds, [...SHARED, { specification_group: "Other", label: "Battery Health", value: "100%" }]), /variant_specific/);
  await assert.rejects(apply("iphone-18-pro-max", [ids.applePta, ids.plainNonPta], SHARED), /_stale/, "a product missing from the preview");
  await assert.rejects(apply("iphone-18-pro-max", [...proMaxIds, ids.pro], SHARED), /_stale/, "Pro is never part of Pro Max");
  await assert.rejects(apply("iphone-18-pro-max", [...proMaxIds, ids.ambiguous], SHARED), /_stale/, "an ambiguous title is never matched");
  await assert.rejects(apply("iphone-99", [], SHARED), /no_products/);
  await assert.rejects(apply("not a key", proMaxIds, SHARED), /invalid_model/);
  assert.deepEqual(await specsOf(ids.plainNonPta), []);
  assert.deepEqual(await approvedOf("iphone-18-pro-max"), []);
});

test("unverified specs are never copied: a new product of a model without approved specs receives nothing", async () => {
  await importProduct("iPhone 18 Pro Non-PTA", [variant({ pta_status: "not_approved" })]);
  assert.deepEqual(await specsOf(await idOf("iPhone 18 Pro Non-PTA")), [], "iPhone 18 Pro has product specs but none approved");
});

test("apply: every exact Pro Max product receives the missing specs and the list is approved; conflicts, Pro, ambiguous title and all variant data untouched", async () => {
  await actAs(ownerId);
  const before = await fingerprint();
  const proBefore = await specsOf(ids.pro);
  const ambiguousBefore = await specsOf(ids.ambiguous);
  const { r } = await apply("iphone-18-pro-max", proMaxIds, SHARED);
  assert.equal(r.inserted, 5);
  assert.deepEqual(r.approved, { added: 3, present: 0, kept: 0, corrected: 0 });
  const by = Object.fromEntries(r.products.map((entry) => [entry.product_id, [entry.inserted, entry.present, entry.conflicts]]));
  assert.deepEqual(by[ids.applePta], [0, 3, 0]);
  assert.deepEqual(by[ids.plainNonPta], [3, 0, 0]);
  assert.deepEqual(by[ids.used], [2, 0, 1]);
  assert.deepEqual(await specsOf(ids.plainNonPta), SHARED);
  assert.deepEqual(await approvedOf("iphone-18-pro-max"), SHARED);
  const used = await specsOf(ids.used);
  assert.equal(used.find((row) => row.label === "Weight").value, "250 g", "stored conflicting value kept");
  assert.equal(used.length, 3);
  assert.deepEqual(await specsOf(ids.pro), proBefore);
  assert.deepEqual(await specsOf(ids.ambiguous), ambiguousBefore);
  assert.deepEqual(await fingerprint(), before, "titles, slugs, PTA, condition, price, stock, warranty, battery, grade, RAM, colour, storage unchanged");
  // Running again adds nothing (idempotent); a different value never replaces the approved one.
  const again = await apply("iphone-18-pro-max", proMaxIds, SHARED);
  assert.equal(again.r.inserted, 0);
  assert.deepEqual(again.r.approved, { added: 0, present: 3, kept: 0, corrected: 0 });
  const changed = await apply("iphone-18-pro-max", proMaxIds, [{ specification_group: "Build", label: "Weight", value: "999 g" }]);
  assert.deepEqual([changed.r.inserted, changed.r.approved], [0, { added: 0, present: 0, kept: 1, corrected: 0 }]);
  assert.deepEqual(await approvedOf("iphone-18-pro-max"), SHARED);
  // The client reader agrees with the payload shape it sends.
  assert.deepEqual(modelSpecPayload([{ rowNumber: 1, section: "Display", label: " Screen  Size ", value: " 6.9 inches " }]), [{ specification_group: "Display", label: "Screen Size", value: "6.9 inches" }]);
});

test("future products: a new product of the model receives the approved specs automatically; its own specs win; other models and ambiguous titles get nothing", async () => {
  await importProduct("iPhone 18 Pro Max PTA Approved", [variant({ color: "Blue" })]);
  assert.deepEqual(await specsOf(await idOf("iPhone 18 Pro Max PTA Approved")), SHARED);
  await importProduct("Apple iPhone 18ProMax Non-PTA (Used)", [variant({ condition: "used", warranty: null, pta_status: "not_approved" })], {
    specifications: [{ group: "Build", label: "Weight", value: "251 g" }],
  });
  const own = await specsOf(await idOf("Apple iPhone 18ProMax Non-PTA (Used)"));
  assert.equal(own.find((row) => row.label === "Weight").value, "251 g", "the product's own value is kept");
  assert.deepEqual(own.map((row) => row.label).sort(), ["Chipset", "Screen Size", "Weight"]);
  await importProduct("Apple iPhone 17 Pro Max", [variant()]);
  assert.deepEqual(await specsOf(await idOf("Apple iPhone 17 Pro Max")), [], "another generation never receives them");
  await importProduct("Apple iPhone 18 Pro Max (Refurbished)", [variant()]);
  assert.deepEqual(await specsOf(await idOf("Apple iPhone 18 Pro Max (Refurbished)")), [], "an ambiguous title never receives them");
  // A product renamed into the model receives them (missing ones only).
  await db.query(`update public.products set title = 'iPhone 18 Pro Max Non-PTA' where id = $1`, [ids.ambiguous]);
  assert.deepEqual((await specsOf(ids.ambiguous)).map((row) => row.label).sort(), ["Chipset", "Screen Size", "Weight"]);
});

test("Android: Samsung A57 products share; S26 / A57 Pro / other brands never receive A57 specs", async () => {
  await actAs(ownerId);
  await importProduct("Samsung A57", [variant({ warranty: "1 Year" })], { brand: "Samsung" });
  await importProduct("Samsung A57 Non-PTA (Used)", [variant({ condition: "used", warranty: null, pta_status: "not_approved" })], { brand: "Samsung" });
  await importProduct("Samsung S26", [variant({ warranty: "1 Year" })], { brand: "Samsung" });
  const a57 = [await idOf("Samsung A57"), await idOf("Samsung A57 Non-PTA (Used)")];
  const A57 = [{ specification_group: "Battery", label: "Battery Capacity", value: "5000 mAh" }, { specification_group: "Display", label: "Screen Size", value: "6.7 inches" }];
  await assert.rejects(apply("samsung-a57", [a57[0]], A57), /_stale/);
  const { r } = await apply("samsung-a57", a57, A57);
  assert.equal(r.inserted, 4);
  for (const id of a57) assert.deepEqual((await specsOf(id)).map((row) => row.value).sort(), ["5000 mAh", "6.7 inches"]);
  assert.deepEqual(await approvedOf("samsung-a57"), A57);
  assert.deepEqual(await specsOf(await idOf("Samsung S26")), []);
  // Future Android product of the same model (PTA + storage wording in the title) receives them; A57 Pro does not.
  await importProduct("Samsung A57 PTA 8/256GB", [variant({ warranty: "1 Year" })], { brand: "Samsung" });
  assert.deepEqual((await specsOf(await idOf("Samsung A57 PTA 8/256GB"))).map((row) => row.label).sort(), ["Battery Capacity", "Screen Size"]);
  await importProduct("Samsung A57 Pro", [variant({ warranty: "1 Year" })], { brand: "Samsung" });
  assert.deepEqual(await specsOf(await idOf("Samsung A57 Pro")), []);
});

test("correction workflow: Owner-ticked correction updates the approved value and only products still showing the old value; stale refused; future products get the corrected value", async () => {
  await actAs(ownerId);
  const proMaxNow = (await all(`select p.id from public.products p join public.brands b on b.id = p.brand_id
    where public.model_spec_key(b.slug, p.title) = 'iphone-18-pro-max' order by p.id`)).map((row) => row.id);
  assert.equal(proMaxNow.length, 6);
  const weights = async () => Object.fromEntries(await Promise.all(proMaxNow.map(async (id) => [id, (await specsOf(id)).find((row) => row.label === "Weight")?.value])));
  const before = await weights();
  const fp = await fingerprint();
  const NEW = [{ specification_group: "Build", label: "Weight", value: "247 g" }];
  const correct = (corrections) =>
    asAuthenticated(() => one(`select public.apply_model_common_specifications($1, $2::uuid[], $3::jsonb, $4::jsonb) as r`, ["iphone-18-pro-max", proMaxNow, JSON.stringify(NEW), JSON.stringify(corrections)]));
  // Refused: stale old value, label not in the list, label never approved.
  await assert.rejects(correct([{ label: "Weight", old_value: "248 g" }]), /_stale_approved/);
  await assert.rejects(correct([{ label: "Chipset", old_value: "Apple A20 Pro" }]), /invalid_payload/);
  const a57Now = (await all(`select p.id from public.products p join public.brands b on b.id = p.brand_id where public.model_spec_key(b.slug, p.title) = 'samsung-a57' order by p.id`)).map((row) => row.id);
  await assert.rejects(asAuthenticated(() => one(`select public.apply_model_common_specifications('samsung-a57', $1::uuid[], $2::jsonb, $3::jsonb) as r`,
    [a57Now, JSON.stringify([{ specification_group: "Build", label: "Weight", value: "190 g" }]), JSON.stringify([{ label: "Weight", old_value: "189 g" }])])), /_stale_approved/);
  assert.deepEqual(await weights(), before, "nothing changed after refusals");
  // Not ticked: the approved value and every product keep their value.
  const notTicked = await correct([]);
  assert.deepEqual([notTicked.r.corrected, notTicked.r.approved.kept], [0, 1]);
  assert.deepEqual(await weights(), before);
  // Ticked with the right old value.
  const { r } = await correct([{ label: "Weight", old_value: "249 g" }]);
  assert.equal(r.approved.corrected, 1);
  const after = await weights();
  for (const id of proMaxNow) assert.equal(after[id], before[id] === "249 g" ? "247 g" : before[id], `product ${id}`);
  assert.ok(Object.values(after).includes("250 g") && Object.values(after).includes("251 g"), "products with their own value keep it");
  assert.equal(r.corrected, Object.values(before).filter((value) => value === "249 g").length);
  assert.equal((await approvedOf("iphone-18-pro-max")).find((row) => row.label === "Weight").value, "247 g");
  assert.deepEqual(await fingerprint(), fp, "titles, slugs and all variant data unchanged");
  // A product added after the correction receives the corrected value.
  await importProduct("iPhone 18 Pro Max Cosmic Orange", [variant({ color: "Cosmic Orange" })]);
  assert.equal((await specsOf(await idOf("iPhone 18 Pro Max Cosmic Orange"))).find((row) => row.label === "Weight").value, "247 g");
});

test("final verified sheet end-to-end (Owner decision 2026-11-21): sheet -> preview -> Apply; unverified rows never written; later sheet corrects without a tick; future product follows", async () => {
  await actAs(ownerId);
  await importProduct("Samsung A37", [variant({ warranty: "1 Year" })], { brand: "Samsung" });
  await importProduct("Samsung A37 Non-PTA (Used)", [variant({ condition: "used", warranty: null, pta_status: "not_approved" })], { brand: "Samsung" });
  const a37 = [await idOf("Samsung A37"), await idOf("Samsung A37 Non-PTA (Used)")].sort();
  await db.query(`insert into public.product_specifications (product_id, specification_group, label, value, sort_order) values ($1, 'Battery', 'Battery Capacity', '4900 mAh', 0)`, [a37[1]]);
  const model = { key: "samsung-a37", name: "Samsung A37", kind: "android", products: await Promise.all(a37.map(async (id) => one(`select id, title, slug from public.products where id = $1`, [id]))) };
  const existingNow = async () => all(`select id, product_id, specification_group, label, value, sort_order from public.product_specifications where product_id = any($1::uuid[])`, [a37]);
  const sheet = (csv) => approvedSheetRows(modelSpecsFromCsv(csv).specs);
  const runSheet = async (rows) => {
    const plan = planModelSpecs(model, rows.apply, await existingNow(), await approvedOf("samsung-a37").then((list) => list.map(({ label, value }) => ({ label, value }))));
    assert.equal(modelSpecBlocker(plan), null);
    return asAuthenticated(() => one(`select public.apply_model_common_specifications($1, $2::uuid[], $3::jsonb, $4::jsonb) as r`,
      ["samsung-a37", a37, JSON.stringify(modelSpecPayload(rows.apply)), JSON.stringify(modelSpecCorrectionsPayload(plan))]));
  };
  const first = sheet("Section,Label,Value,Status\r\nBattery,Battery Capacity,5000 mAh,Verified\r\nDisplay,Screen Size,6.6 inches,Verified\r\nPerformance,Chipset,Exynos 1680,Unverified\r\nCamera,Main Camera,TBD,Verified\r\n");
  assert.deepEqual(first.skipped.map((row) => row.label), ["Chipset", "Main Camera"]);
  const { r } = await runSheet(first);
  assert.deepEqual(r.approved, { added: 2, present: 0, kept: 0, corrected: 0 });
  assert.deepEqual((await approvedOf("samsung-a37")).map((row) => row.label), ["Battery Capacity", "Screen Size"], "unverified rows never approved");
  assert.equal((await specsOf(a37[1])).find((row) => row.label === "Battery Capacity").value, "4900 mAh", "existing product value never overwritten (conflict kept)");
  for (const id of a37) assert.equal((await specsOf(id)).some((row) => ["Chipset", "Main Camera"].includes(row.label)), false);
  // A later final sheet with a different value corrects it — no tick: the approved row and products still showing the old approved value.
  const second = await runSheet(sheet("Section,Label,Value\r\nBattery,Battery Capacity,5000 mAh\r\nDisplay,Screen Size,6.7 inches\r\n"));
  assert.equal(second.r.approved.corrected, 1);
  assert.equal((await approvedOf("samsung-a37")).find((row) => row.label === "Screen Size").value, "6.7 inches");
  for (const id of a37) assert.equal((await specsOf(id)).find((row) => row.label === "Screen Size").value, "6.7 inches");
  assert.equal((await specsOf(a37[1])).find((row) => row.label === "Battery Capacity").value, "4900 mAh", "still kept after the correction");
  // Future product of the exact model receives the corrected approved list; a different model does not.
  await importProduct("Samsung Galaxy A37 PTA 8/256GB", [variant({ warranty: "1 Year" })], { brand: "Samsung" });
  assert.deepEqual((await specsOf(await idOf("Samsung Galaxy A37 PTA 8/256GB"))).map((row) => `${row.label}=${row.value}`).sort(), ["Battery Capacity=5000 mAh", "Screen Size=6.7 inches"]);
  await importProduct("Samsung A37 Pro", [variant({ warranty: "1 Year" })], { brand: "Samsung" });
  assert.deepEqual(await specsOf(await idOf("Samsung A37 Pro")), []);
});

test("Android alias: Samsung Galaxy A57 is the same model as Samsung A57 and receives its approved specs; Galaxy A57 5G does not", async () => {
  await importProduct("Samsung Galaxy A57 Awesome Black", [variant({ warranty: "1 Year" })], { brand: "Samsung" });
  assert.deepEqual((await specsOf(await idOf("Samsung Galaxy A57 Awesome Black"))).map((row) => row.label).sort(), ["Battery Capacity", "Screen Size"]);
  await importProduct("Samsung Galaxy A57 5G", [variant({ warranty: "1 Year" })], { brand: "Samsung" });
  assert.deepEqual(await specsOf(await idOf("Samsung Galaxy A57 5G")), []);
});
