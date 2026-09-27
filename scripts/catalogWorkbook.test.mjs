import assert from "node:assert/strict";
import test from "node:test";
import ExcelJS from "exceljs";
import { readFileSync } from "node:fs";
import {
  CATALOG_SKU_PATTERN,
  CATALOG_SKU_PREFIX_BY_CATEGORY_SLUG,
  CATALOG_SKU_PREFIX_BY_PRODUCT_TYPE,
  catalogSkuPending,
  normalizeStockLines,
} from "../src/lib/catalogSheet.ts";
import { STAGING_PROFILES, applyStagingProfile } from "../src/lib/catalogSheet.ts";
import {
  CATALOG_LISTS,
  CATALOG_TEMPLATE_VERSION,
  catalogStagingMissingFacts,
  categoriesForProductType,
  validateCatalogSheet,
  PRODUCT_HEADERS,
  SPECIFICATION_HEADERS,
  buildCatalogWorkbook,
  catalogSheetToBulkParseResult,
  readCatalogWorkbook,
} from "../src/lib/catalogWorkbook.ts";

const reference = {
  brands: ["Samsung", "Xiaomi", "Oppo", "Apple", "Vivo", "Infinix", "Tecno", "Realme"],
  // Locked category structure (Gadgets > Laptops / Tablets), as after 202609240001.
  categories: ["Mobile Phones", "Accessories", "Gadgets", "Laptops", "Tablets"],
};
const normalize = (text) =>
  normalizeStockLines(text, { brands: reference.brands.map((name) => ({ name })) }).rows;

const load = async (bytes) => {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(bytes);
  return workbook;
};
const save = async (workbook) => new Uint8Array(await workbook.xlsx.writeBuffer());
const column = (header) => PRODUCT_HEADERS.indexOf(header) + 1;

/** Generates a workbook, lets the test edit it like an Owner would, then reads it back. */
async function roundTrip(rows, edit = () => {}, specifications = []) {
  const workbook = await load(await buildCatalogWorkbook(rows, specifications, reference));
  await edit(workbook);
  return readCatalogWorkbook(await save(workbook), reference);
}

// Fills the fields the Owner is expected to complete in Excel (never guessed by the importer).
const completeRow = (sheet, rowNumber, values = {}) => {
  const filled = { "PTA Status": "PTA Approved", Condition: "Brand New", Warranty: "1 Year Official", Category: "Mobile Phones", ...values };
  for (const [header, value] of Object.entries(filled)) sheet.getRow(rowNumber).getCell(column(header)).value = value;
};

test("1-3. workbook has Products, Specifications and a hidden Lists sheet with exact headers", async () => {
  const workbook = await load(await buildCatalogWorkbook(normalize("Samsung A16 6/128 Black; 42500"), [], reference));
  assert.deepEqual(workbook.worksheets.map((sheet) => sheet.name), ["Products", "Specifications", "Lists"]);
  assert.equal(workbook.getWorksheet("Lists").state, "hidden");
  assert.equal(workbook.getWorksheet("Products").state, "visible");
  assert.deepEqual(workbook.getWorksheet("Products").getRow(1).values.slice(1), [...PRODUCT_HEADERS]);
  assert.deepEqual(workbook.getWorksheet("Specifications").getRow(1).values.slice(1), [...SPECIFICATION_HEADERS]);
  const lists = workbook.getWorksheet("Lists");
  assert.deepEqual(lists.getRow(1).values.slice(1), ["Brands", "Categories", "Action", "Product Type", "PTA Status", "Condition", "Delivery Scope", "Template"]);
  assert.equal(lists.getCell("H2").value, CATALOG_TEMPLATE_VERSION);
  assert.equal(lists.getCell("A2").value, "Apple");
  assert.deepEqual(lists.getColumn(4).values.slice(2), ["Mobile Phone", "Accessory", "Gadget", "Tablet", "Laptop"]);
  const products = workbook.getWorksheet("Products");
  assert.equal(products.views[0].state, "frozen");
  assert.ok(products.autoFilter);
  assert.equal(products.getCell(`${String.fromCharCode(64 + column("PTA Status"))}50`).dataValidation.type, "list");
  assert.equal(products.getRow(2).getCell(column("RAM")).numFmt, "@");
  assert.equal(products.getRow(2).getCell(column("Price")).value, 42500);
});

test("4. normalized Android row survives write → read round-trip", async () => {
  const [source] = normalize("Samsung A16 6/128 Black; 42500");
  const data = await roundTrip([source]);
  assert.deepEqual(data.fileErrors, []);
  assert.equal(data.rows.length, 1);
  const [row] = data.rows;
  for (const field of ["productType", "brand", "model", "productTitle", "ram", "storage", "color", "deliveryScope", "priceMinor", "stock", "sku", "slug"])
    assert.equal(row[field], source[field], field);
  assert.equal(row.model, "A16");
  assert.equal(row.productTitle, "Samsung A16");
  for (const field of ["ptaStatus", "condition", "warranty", "compareAtPriceMinor", "batteryHealth", "cycleCount", "action"])
    assert.equal(row[field], null, field);
  // Category resolves from Product Type to the one matching active category.
  assert.equal(row.category, "Mobile Phones");
  assert.equal(row.fieldStatus.category, "inferred");
  assert.equal(row.needsReview, false);
});

test("5-6. used iPhone keeps BH/CC; blank BH/CC stay blank", async () => {
  const [withBattery] = normalize("iPhone 15 Pro 256 Natural; 265000; Used; Non-PTA; BH 89%; Cycles 312");
  const [withoutBattery] = normalize("iPhone 14 128 Midnight; 150000; Used; PTA Approved");
  const data = await roundTrip([withBattery, withoutBattery]);
  const [used, plain] = data.rows;
  assert.equal(used.model, "iPhone 15 Pro");
  assert.equal(used.productTitle, "Apple iPhone 15 Pro");
  assert.equal(used.condition, "used");
  assert.equal(used.conditionGrade, "A++");
  assert.equal(used.ptaStatus, "not_approved");
  assert.equal(used.batteryHealth, 89);
  assert.equal(used.cycleCount, 312);
  assert.equal(used.sku, null);
  assert.equal(used.priceMinor, 26_500_000);
  assert.equal(plain.batteryHealth, null);
  assert.equal(plain.cycleCount, null);
  assert.equal(plain.fieldStatus.batteryHealth, "blank");
  assert.equal(plain.fieldStatus.cycleCount, "blank");
  assert.equal(plain.ptaStatus, "approved");
});

test("7-8. blank Stock cell imports as 10; explicit 25 stays 25", async () => {
  const rows = normalize("Samsung A16 6/128 Black; 42500\nSamsung A16 6/128 Blue; 42500");
  const data = await roundTrip(rows, (workbook) => {
    const sheet = workbook.getWorksheet("Products");
    sheet.getRow(2).getCell(column("Stock")).value = null;
    sheet.getRow(3).getCell(column("Stock")).value = 25;
  });
  assert.equal(data.rows[0].stock, 10);
  assert.equal(data.rows[0].fieldStatus.stock, "default");
  assert.equal(data.rows[1].stock, 25);
  assert.equal(data.rows[1].fieldStatus.stock, "explicit");
});

test("9. unknown PTA value needs review and is not guessed", async () => {
  const data = await roundTrip(normalize("Samsung A16 6/128 Black; 42500"), (workbook) => {
    completeRow(workbook.getWorksheet("Products"), 2, { "PTA Status": "Yes" });
  });
  const [row] = data.rows;
  assert.equal(row.ptaStatus, null);
  assert.equal(row.fieldStatus.ptaStatus, "needs_review");
  assert.equal(row.needsReview, true);
  assert.ok(row.reviewReasons.includes('Unknown PTA Status: "Yes"'));
});

test("10. unknown brand needs review and is never created", async () => {
  const data = await roundTrip(normalize("Samsung A16 6/128 Black; 42500"), (workbook) => {
    workbook.getWorksheet("Products").getRow(2).getCell(column("Brand")).value = "Samsnug";
  });
  const [row] = data.rows;
  assert.equal(row.fieldStatus.brand, "needs_review");
  assert.ok(row.reviewReasons.some((reason) => reason.startsWith("Brand not found among active brands")));
});

test("11. duplicate SKU ignoring case needs review on every duplicate row", async () => {
  const data = await roundTrip(normalize("Samsung A16 6/128 Black; 42500\nSamsung A16 6/128 Blue; 42500"), (workbook) => {
    const sheet = workbook.getWorksheet("Products");
    sheet.getRow(2).getCell(column("SKU")).value = "mb001";
    sheet.getRow(3).getCell(column("SKU")).value = "MB001";
  });
  assert.ok(data.rows.every((row) => row.needsReview && row.fieldStatus.sku === "needs_review"));
  assert.ok(data.rows[0].reviewReasons.some((reason) => reason.startsWith("Duplicate SKU MB001")));
});

test("11b. duplicate variant detection includes PTA and Condition", async () => {
  const rows = normalize("Samsung A16 6/128 Black; 42500; PTA Approved\nSamsung A16 6/128 Black; 39000; Non-PTA");
  const distinct = await roundTrip(rows);
  assert.ok(distinct.rows.every((row) => !row.reviewReasons.some((reason) => reason.startsWith("Duplicate"))));
  const duplicate = await roundTrip(rows, (workbook) => {
    workbook.getWorksheet("Products").getRow(3).getCell(column("PTA Status")).value = "PTA Approved";
    workbook.getWorksheet("Products").getRow(3).getCell(column("SKU")).value = "A16S2";
  });
  assert.ok(duplicate.rows[1].reviewReasons.includes("Duplicate variant (same as Products row 2)"));
});

test("12-13. multiple specification rows per product key; unknown key needs review", async () => {
  const specifications = [
    { productKey: "samsung-a16", section: "Display", name: "Size", value: "6.7 inch" },
    { productKey: "samsung-a16", section: "Battery", name: "Capacity", value: "5000 mAh" },
    { productKey: "samsung-a16", section: null, name: "Chipset", value: "Exynos 1330" },
    { productKey: "samsung-a99", section: "Display", name: "Size", value: "7 inch" },
  ];
  const data = await roundTrip(normalize("Samsung A16 6/128 Black; 42500"), () => {}, specifications);
  assert.equal(data.specifications.length, 4);
  assert.deepEqual(data.specifications.filter((spec) => !spec.needsReview).map((spec) => spec.name), ["Size", "Capacity", "Chipset"]);
  const unknown = data.specifications[3];
  assert.equal(unknown.needsReview, true);
  assert.ok(unknown.reviewReasons[0].startsWith('Unknown Product Key "samsung-a99"'));
  const preview = catalogSheetToBulkParseResult(data);
  assert.equal(preview.format, "catalog_sheet");
  assert.equal(preview.products[0].specifications.length, 3);
  assert.ok(preview.errors.some((error) => error.includes("samsung-a99")));
});

test("14. missing Products or Specifications sheet is a blocking file error", async () => {
  for (const missing of ["Products", "Specifications"]) {
    const workbook = await load(await buildCatalogWorkbook(normalize("Samsung A16 6/128 Black; 42500"), [], reference));
    workbook.removeWorksheet(workbook.getWorksheet(missing).id);
    const data = await readCatalogWorkbook(await save(workbook), reference);
    assert.deepEqual(data.fileErrors, [`Missing required sheet "${missing}".`]);
    assert.equal(data.rows.length, 0);
  }
  const headerless = await roundTrip([], (workbook) => {
    workbook.getWorksheet("Products").getRow(1).getCell(column("Price")).value = "Cost";
  });
  assert.ok(headerless.fileErrors[0].includes("missing required column(s): Price"));
  const garbage = await readCatalogWorkbook(new TextEncoder().encode("not a workbook"), reference);
  assert.deepEqual(garbage.fileErrors, ["The file could not be read as an .xlsx workbook."]);
});

test("15. a 100-row workbook round-trips without collisions", async () => {
  const families = ["Samsung Galaxy A", "Redmi Note ", "Oppo Reno ", "Vivo Y", "Infinix Hot ", "Tecno Spark ", "Realme C", "Samsung Galaxy S", "Oppo A", "Vivo V"];
  const configs = ["4/64", "6/128", "8/256", "12/512"];
  const colors = ["Black", "Blue", "Green", "Silver", "Gold"];
  const lines = Array.from({ length: 100 }, (_, index) =>
    `${families[index % families.length]}${10 + Math.floor(index / 10)} ${configs[index % configs.length]} ${colors[index % colors.length]}; ${(30000 + index * 500).toLocaleString("en-US")}`,
  );
  const source = normalize(lines.join("\n"));
  const data = await roundTrip(source, (workbook) => {
    const sheet = workbook.getWorksheet("Products");
    for (let rowNumber = 2; rowNumber <= 101; rowNumber += 1) completeRow(sheet, rowNumber);
  });
  assert.equal(data.rows.length, 100);
  assert.deepEqual(data.rows.filter((row) => row.needsReview).map((row) => `${row.sourceLine}: ${row.reviewReasons}`), []);
  // New variants carry no SKU: the database assigns one per variant on import.
  assert.ok(data.rows.every((row) => row.sku === null && row.fieldStatus.sku === "blank"));
  data.rows.forEach((row, index) => {
    assert.equal(row.priceMinor, source[index].priceMinor);
    assert.equal(row.ptaStatus, "approved");
    assert.equal(row.category, "Mobile Phones");
  });
  const preview = catalogSheetToBulkParseResult(data);
  assert.equal(preview.products.reduce((count, product) => count + product.variants.length, 0), 100);
});

test("owner-entered values: labels, brand prefix in model, percent BH, Mobile + Nationwide", async () => {
  const data = await roundTrip(normalize("Samsung A16 6/128 Black; 42500"), (workbook) => {
    const sheet = workbook.getWorksheet("Products");
    completeRow(sheet, 2, { Action: "Replace Existing", Condition: "Used", "Battery Health": "91%", "Delivery Scope": "Nationwide" });
    sheet.getRow(2).getCell(column("Model / Product Title")).value = "Samsung A16";
  });
  const [row] = data.rows;
  assert.equal(row.action, "Replace Existing");
  assert.equal(row.model, "A16");
  assert.equal(row.productTitle, "Samsung A16");
  assert.equal(row.condition, "used");
  assert.equal(row.conditionGrade, "A++");
  assert.equal(row.batteryHealth, 91);
  assert.ok(row.reviewReasons.includes("Mobile phones are Karachi-only; Nationwide conflicts"));
  const preview = catalogSheetToBulkParseResult(data);
  assert.equal(preview.products[0].requestedAction, "Replace Existing");
  assert.equal(preview.products[0].variants[0].batteryHealth, 91);
});

// Active categories after migration 202609240001 (Gadgets > Laptops / Tablets).
const lockedCategories = reference.categories;
// Active categories in the live database before that migration (read-only check, 2026-09-24).
const preMigrationCategories = ["Accessories", "Laptops", "Mobile Accessories", "Smartphones"];
const stage = (text, profile = "none", categories = lockedCategories, existingSkus = []) => {
  const ref = { brands: reference.brands, categories, existingSkus };
  return validateCatalogSheet(applyStagingProfile(normalize(text), profile), [], ref).rows;
};

test("v2 A. Android Box Pack / PTA Approved profile fills blanks only", () => {
  assert.equal(STAGING_PROFILES.android_box_pack_pta.label, "Android Box Pack / PTA Approved");
  const [row] = stage("Samsung A16 6/128 Black; 42500", "android_box_pack_pta");
  assert.equal(row.brand, "Samsung");
  assert.equal(row.model, "A16");
  assert.equal(row.productType, "Mobile Phone");
  assert.equal(row.category, "Mobile Phones");
  assert.equal(row.condition, "brand_new");
  assert.equal(row.fieldStatus.condition, "default");
  assert.equal(row.ptaStatus, "approved");
  assert.equal(row.fieldStatus.ptaStatus, "default");
  assert.equal(row.deliveryScope, "karachi_only");
  assert.equal(row.stock, 10);
  assert.equal(row.warranty, null);
  assert.equal(row.sku, null);
  assert.equal(row.needsReview, false);
  // Explicit row values always win over the profile.
  const [explicit] = stage("iPhone 15 Pro 256 Natural; 265000; Used; Non-PTA; Qty 3", "android_box_pack_pta");
  assert.equal(explicit.condition, "used");
  assert.equal(explicit.ptaStatus, "not_approved");
  assert.equal(explicit.fieldStatus.ptaStatus, "explicit");
  assert.equal(explicit.stock, 3);
});

test("v2 A2. Wholesale List / PTA Approved profile defaults PTA only; explicit PTA wins", () => {
  assert.equal(STAGING_PROFILES.wholesale_pta_approved.label, "Wholesale List / PTA Approved");
  assert.deepEqual(STAGING_PROFILES.wholesale_pta_approved.supplies, ["PTA Status: PTA Approved (Mobile Phones only)"]);
  const text = [
    "Samsung A16 6/128 Black; 42500",
    "Samsung A16 6/128 Blue; 39000; Non-PTA",
    "Samsung A16 8/256 Black; 52000; PTA Approved",
  ].join("\n");
  const [plain, nonPta, pta] = stage(text, "wholesale_pta_approved");
  const [basePlain, baseNonPta, basePta] = stage(text);
  // 1. A normal wholesale row gets PTA Approved as a visible default.
  assert.equal(plain.ptaStatus, "approved");
  assert.equal(plain.fieldStatus.ptaStatus, "default");
  // 2-3. Explicit Non-PTA / PTA Approved are kept as written.
  assert.equal(nonPta.ptaStatus, "not_approved");
  assert.equal(nonPta.fieldStatus.ptaStatus, "explicit");
  assert.equal(pta.ptaStatus, "approved");
  assert.equal(pta.fieldStatus.ptaStatus, "explicit");
  // Nothing but PTA changes compared with no profile.
  for (const [row, base] of [[plain, basePlain], [nonPta, baseNonPta], [pta, basePta]]) {
    for (const field of ["productType", "category", "condition", "warranty", "deliveryScope", "priceMinor", "stock", "sku", "slug", "productTitle", "color", "ram", "storage"]) {
      assert.deepEqual(row[field], base[field], field);
    }
  }
  // 4. Without this profile the blank PTA stays unresolved.
  assert.equal(basePlain.ptaStatus, null);
  assert.equal(basePlain.fieldStatus.ptaStatus, "blank");
  // Wholesale list format: V70FE notes stay metadata and the 8/256 Silver price conflict stays blocked.
  const [active, non, blue] = stage(
    "💙 ✨ Vivo ✨\nV70FE 8/256 silver @ 110000 active 25-04-26/-\nV70FE 8/256 silver @ 119500 non\nV70FE 12/256 blue @ 137000 non",
    "wholesale_pta_approved",
  );
  assert.ok([active, non, blue].every((row) => row.ptaStatus === "approved"));
  assert.deepEqual([active.notes, non.notes, blue.notes], [["active 25-04-26"], ["non"], ["non"]]);
  const conflict = "Same variant is listed more than once with conflicting commercial data — review.";
  assert.ok(active.needsReview && active.reviewReasons.includes(conflict));
  assert.ok(non.needsReview && non.reviewReasons.includes(conflict));
  assert.ok(!blue.reviewReasons.includes(conflict));
});

test("v2 A3. Wholesale PTA default applies to Mobile Phones only; other types stay unresolved", () => {
  const text = [
    "📲 ✨ Samsung Tab ✨",
    "A11 wifi 8/128 grey @ 52000",
    "⌚ ✨ Samsung Watch ✨",
    "Watch 8 44mm graphite @ 60000",
    "🍎 ✨ Apple ✨",
    "MacBook Air M3 256 midnight @ 300000",
    "🔵 ✨ Samsung ✨",
    "A16 8/256 black @ 55000",
  ].join("\n");
  const rows = stage(text, "wholesale_pta_approved");
  const base = stage(text);
  const byType = Object.fromEntries(rows.map((row) => [row.productType, row]));
  assert.deepEqual(Object.keys(byType).sort(), ["Gadget", "Laptop", "Mobile Phone", "Tablet"]);
  // 1. Mobile Phone + blank PTA -> PTA Approved (default).
  assert.equal(byType["Mobile Phone"].ptaStatus, "approved");
  assert.equal(byType["Mobile Phone"].fieldStatus.ptaStatus, "default");
  // 2-3. Tablet, Gadget/Watch and Laptop + blank PTA -> unresolved, identical to no profile.
  for (const type of ["Tablet", "Gadget", "Laptop"]) {
    assert.equal(byType[type].ptaStatus, null, type);
    assert.equal(byType[type].fieldStatus.ptaStatus, "blank", type);
  }
  rows.forEach((row, index) => {
    if (row.productType !== "Mobile Phone") assert.deepEqual(row, base[index], row.productType);
  });
  // 4. Accessory (parsed without a type, or typed Accessory) + blank PTA -> unresolved.
  const [cable] = normalize("Samsung 25W charger white; 3500");
  const [typedAccessory] = applyStagingProfile([{ ...cable, productType: "Accessory" }], "wholesale_pta_approved");
  assert.equal(typedAccessory.ptaStatus, null);
  const [untyped] = applyStagingProfile([cable], "wholesale_pta_approved");
  assert.notEqual(untyped.productType, "Mobile Phone");
  assert.equal(untyped.ptaStatus, null);
  // Explicit PTA on a non-phone row is kept as written.
  const [explicitTab] = stage("📲 ✨ Samsung Tab ✨\nA11 8/128 grey @ 52000; Non-PTA", "wholesale_pta_approved");
  assert.equal(explicitTab.productType, "Tablet");
  assert.equal(explicitTab.ptaStatus, "not_approved");
  assert.equal(explicitTab.fieldStatus.ptaStatus, "explicit");
});

test("extended/virtual RAM survives the Excel round trip and blocks until the Owner supplies physical RAM", async () => {
  const EXTENDED = "RAM uses extended/virtual notation — verify physical RAM";
  const rows = normalizeStockLines(
    "🟡 ✨ Realme ✨\nNote 60x 3+5/64 green @ 29500/-\nNote 60x 4+4/64 green @ 33500/-",
    { brands: [...reference.brands, "ZTE"].map((name) => ({ name })) },
  ).rows;
  // Exported cells show the supplier value and the original notation for Owner review.
  const exported = await load(await buildCatalogWorkbook(rows, [], reference));
  const sheet = exported.getWorksheet("Products");
  assert.deepEqual([2, 3].map((r) => sheet.getRow(r).getCell(column("RAM")).value), ["3+5 GB", "4+4 GB"]);
  assert.deepEqual([2, 3].map((r) => sheet.getRow(r).getCell(column("Notes")).value), ["RAM as listed: 3+5", "RAM as listed: 4+4"]);
  // Unedited re-upload: exact value and clear reason kept; no summing, no false duplicate; Apply blocked.
  const unedited = await roundTrip(rows, (workbook) => [2, 3].forEach((r) => completeRow(workbook.getWorksheet("Products"), r)));
  assert.deepEqual(unedited.rows.map((row) => row.ram), ["3+5 GB", "4+4 GB"]);
  for (const row of unedited.rows) {
    assert.equal(row.needsReview, true);
    assert.deepEqual(row.reviewReasons, [EXTENDED]);
    assert.equal(row.fieldStatus.ram, "needs_review");
  }
  const blocked = catalogSheetToBulkParseResult(unedited);
  assert.ok(blocked.products[0].variants.every((variant) => variant.warnings.includes(EXTENDED)));
  // Owner replaces one value with physical RAM: that variant is clean; the other stays blocked.
  const partial = await roundTrip(rows, (workbook) => {
    const products = workbook.getWorksheet("Products");
    [2, 3].forEach((r) => completeRow(products, r));
    products.getRow(2).getCell(column("RAM")).value = "3 GB";
  });
  assert.deepEqual(partial.rows.map((row) => row.ram), ["3 GB", "4+4 GB"]);
  assert.deepEqual(partial.rows.map((row) => row.needsReview), [false, true]);
  assert.deepEqual(partial.rows[1].reviewReasons, [EXTENDED]);
  assert.deepEqual(partial.rows.map((row) => [row.storage, row.color, row.priceMinor]), [["64 GB", "Green", 2_950_000], ["64 GB", "Green", 3_350_000]]);
});

test("v2 B. mixed stock without a profile leaves PTA/Condition/Warranty blank without review", () => {
  const [android] = stage("Samsung A16 6/128 Black; 42500");
  assert.equal(android.ptaStatus, null);
  assert.equal(android.condition, null);
  assert.equal(android.category, "Mobile Phones");
  assert.equal(android.needsReview, false);
  const [iphone] = stage("iPhone 15 Pro 256 Natural; 265000; Used; Non-PTA; BH 89%; Cycles 312");
  assert.equal(iphone.brand, "Apple");
  assert.equal(iphone.model, "iPhone 15 Pro");
  assert.equal(iphone.productType, "Mobile Phone");
  assert.equal(iphone.category, "Mobile Phones");
  assert.equal(iphone.condition, "used");
  assert.equal(iphone.conditionGrade, "A++");
  assert.equal(iphone.ptaStatus, "not_approved");
  assert.equal(iphone.batteryHealth, 89);
  assert.equal(iphone.cycleCount, 312);
  assert.equal(iphone.deliveryScope, "karachi_only");
  assert.equal(iphone.stock, 10);
  assert.equal(iphone.warranty, null);
  assert.equal(iphone.needsReview, false);
});

test("v2 category mapping: each Product Type resolves to exactly one locked category", () => {
  // 1-5. Mobile Phone, Accessory, Gadget, Tablet, Laptop
  assert.deepEqual(categoriesForProductType("Mobile Phone", lockedCategories), ["Mobile Phones"]);
  assert.deepEqual(categoriesForProductType("Accessory", lockedCategories), ["Accessories"]);
  assert.deepEqual(categoriesForProductType("Gadget", lockedCategories), ["Gadgets"]);
  assert.deepEqual(categoriesForProductType("Tablet", lockedCategories), ["Tablets"]);
  assert.deepEqual(categoriesForProductType("Laptop", lockedCategories), ["Laptops"]);
  assert.deepEqual(CATALOG_LISTS.productType, ["Mobile Phone", "Accessory", "Gadget", "Tablet", "Laptop"]);
  const byType = (productType) =>
    validateCatalogSheet([{ ...normalize("Samsung A16 6/128 Black; 42500")[0], productType }], [], reference).rows[0];
  assert.equal(byType("Accessory").category, "Accessories");
  assert.equal(byType("Gadget").category, "Gadgets");
  assert.equal(byType("Accessory").fieldStatus.category, "inferred");
  const [phone] = stage("Samsung A16 6/128 Black; 42500");
  assert.equal(phone.category, "Mobile Phones");
  const [ipad] = stage("iPad Air 11 128 Blue; 190000");
  assert.equal(ipad.productType, "Tablet");
  assert.equal(ipad.category, "Tablets");
  const [tab] = stage("Samsung Tab S9 8/128 Grey; 150000");
  assert.equal(tab.category, "Tablets");
  assert.equal(tab.deliveryScope, null);
});

test("v2 MacBook line is a Laptop in Laptops, never a Mobile Phone, and keeps its delivery", () => {
  const [macbook] = stage("MacBook Neo 256 Indigo; 250000; Karachi Only");
  assert.equal(macbook.brand, "Apple");
  assert.equal(macbook.productType, "Laptop");
  assert.equal(macbook.category, "Laptops");
  assert.equal(macbook.deliveryScope, "karachi_only");
  assert.equal(macbook.needsReview, false);
  // Laptop delivery is never auto-set (neither Karachi Only nor Nationwide).
  const [blank] = stage("MacBook Air 13 M3 256 Midnight; 330000");
  assert.equal(blank.productType, "Laptop");
  assert.equal(blank.deliveryScope, null);
});

test("v2 Category / Product Type mismatch needs review; unknown or outdated names are never created", () => {
  const rows = normalize("Samsung A16 6/128 Black; 42500\nMacBook Neo 256 Indigo; 250000");
  const [mismatch, laptopAsPhone] = validateCatalogSheet(
    [{ ...rows[0], category: "Accessories" }, { ...rows[1], category: "Mobile Phones" }],
    [],
    reference,
  ).rows;
  assert.ok(mismatch.needsReview);
  assert.equal(mismatch.fieldStatus.category, "needs_review");
  assert.ok(mismatch.reviewReasons.includes('Category "Accessories" does not match Product Type Mobile Phone (expected Mobile Phones)'));
  assert.ok(laptopAsPhone.reviewReasons.includes('Category "Mobile Phones" does not match Product Type Laptop (expected Laptops)'));
  // Before migration 202609240001 the locked names do not exist yet: review, never create.
  const [beforeMigration] = stage("Samsung A16 6/128 Black; 42500", "none", preMigrationCategories);
  assert.equal(beforeMigration.category, null);
  assert.ok(beforeMigration.reviewReasons.includes("No active category matches Product Type Mobile Phone"));
  const [outdated] = validateCatalogSheet([{ ...rows[0], category: "Smartphones" }], [], reference).rows;
  assert.ok(outdated.reviewReasons.includes('Category not found among active categories: "Smartphones"'));
  const [noType] = stage("Samsung 25W Charger; 3500");
  assert.ok(noType.reviewReasons.includes("Category cannot be resolved without a Product Type"));
});

test("v2 uploaded Mobile Phone with blank delivery resolves to Karachi Only", async () => {
  const data = await roundTrip(normalize("Samsung A16 6/128 Black; 42500"), (workbook) => {
    const sheet = workbook.getWorksheet("Products");
    sheet.getRow(2).getCell(column("Delivery Scope")).value = null;
    sheet.getRow(2).getCell(column("Category")).value = null;
  });
  const [row] = data.rows;
  assert.equal(row.deliveryScope, "karachi_only");
  assert.equal(row.fieldStatus.deliveryScope, "inferred");
  assert.equal(row.category, "Mobile Phones");
  assert.equal(row.needsReview, false);
});

test("v2 preview requires only Price and Stock (SKU is assigned on import)", () => {
  assert.deepEqual(catalogStagingMissingFacts({ priceMinor: 4_250_000, inventory: 10 }), []);
  assert.deepEqual(catalogStagingMissingFacts({ priceMinor: null, inventory: -1 }), ["Price", "Stock"]);
});

// ---------------------------------------------------------------------------
// Server-assigned sequential SKUs (MB001 / AC001 / GD001 / MC001 / IP001)
// ---------------------------------------------------------------------------

const withSku = (row, sku) => ({ ...row, sku, fieldStatus: { ...row.fieldStatus, sku: "explicit" } });
const validate = (rows, existingSkus = []) =>
  validateCatalogSheet(rows, [], { ...reference, existingSkus }).rows;

test("SKU prefixes: product type and category slug map to MB / AC / GD / MC / IP", () => {
  assert.deepEqual(CATALOG_SKU_PREFIX_BY_PRODUCT_TYPE, {
    "Mobile Phone": "MB", Accessory: "AC", Gadget: "GD", Laptop: "MC", Tablet: "IP",
  });
  // Mirrors public.catalog_sku_prefix() in 202609240003.
  assert.deepEqual(CATALOG_SKU_PREFIX_BY_CATEGORY_SLUG, {
    "mobile-phones": "MB", "mobile-accessories": "AC", gadgets: "GD", laptops: "MC", tablets: "IP",
  });
  assert.equal(catalogSkuPending("MB"), "MB — assigned on import");
  assert.equal(catalogSkuPending("AC"), "AC — assigned on import");
  for (const sku of ["MB001", "AC001", "GD001", "MC001", "IP001", "IP999"]) assert.match(sku, CATALOG_SKU_PATTERN);
  for (const sku of ["MB1000", "XX001", "MB01", "mb001", "A1B2C", "APPLE-20W-USB-C-CHARGER"]) assert.doesNotMatch(sku, CATALOG_SKU_PATTERN);
});

test("SKU: normalizer and blank Excel SKU leave SKU blank; nothing is generated client-side", async () => {
  const rows = normalize("Samsung A16 6/128 Black; 42500\nMacBook Air 13 M3 256 Midnight; 330000\niPad Air 11 128 Blue; 190000");
  assert.ok(rows.every((row) => row.sku === null && row.fieldStatus.sku === "blank"));
  const data = await roundTrip(rows);
  assert.ok(data.rows.every((row) => row.sku === null && !row.reviewReasons.some((reason) => reason.includes("SKU"))));
  const variants = catalogSheetToBulkParseResult(data).products.flatMap((product) => product.variants);
  assert.ok(variants.every((variant) => variant.sku === null));
});

test("SKU: a supplied SKU is only accepted as an existing SKU of the same product", () => {
  const [row] = normalize("Samsung A16 6/128 Black; 42500");
  const existing = [{ sku: "MB007", productSlug: "samsung-a16" }, { sku: "MB008", productSlug: "xiaomi-redmi-note-14" }];
  const [kept] = validate([withSku(row, "mb007")], existing);
  assert.equal(kept.sku, "MB007");
  assert.equal(kept.needsReview, false);
  const [other] = validate([withSku(row, "MB008")], existing);
  assert.ok(other.reviewReasons.includes("SKU MB008 belongs to another product (xiaomi-redmi-note-14)"));
  // A made-up SKU, even in the right format, is never used for a new variant.
  const [invented] = validate([withSku(row, "MB050")], existing);
  assert.equal(invented.fieldStatus.sku, "needs_review");
  assert.ok(invented.reviewReasons.includes("SKU MB050 is not an existing catalog SKU; leave SKU blank for new variants (assigned on import)"));
  assert.equal(invented.sku, "MB050");
});

test("SKU: an existing legacy long SKU of the same product is preserved, never rewritten", () => {
  const [macbook] = normalize("MacBook Neo 256 Indigo; 250000; Karachi Only");
  const legacy = "APPLE-MACBOOK-NEO-256-INDIGO";
  const [kept] = validate([withSku(macbook, legacy)], [{ sku: legacy, productSlug: "apple-macbook-neo" }]);
  assert.equal(kept.sku, legacy);
  assert.equal(kept.needsReview, false);
});

test("SKU: a duplicate supplied SKU needs review on every row", () => {
  const [first, second] = normalize("Samsung A16 6/128 Black; 42500\nSamsung A16 6/128 Blue; 42500");
  const rows = validate([withSku(first, "MB007"), withSku(second, "mb007")], [{ sku: "MB007", productSlug: "samsung-a16" }]);
  assert.ok(rows.every((row) => row.needsReview && row.reviewReasons.some((reason) => reason.startsWith("Duplicate SKU MB007"))));
});

test("SKU preview: matching never uses SKU; matched variant keeps its SKU; new variant shows the prefix only", () => {
  const source = readFileSync(new URL("../src/admin/BulkImport.tsx", import.meta.url), "utf8").replace(/\r\n/g, "\n");
  // v2 rows match with the import function's rules; legacy rows keep attribute matching.
  assert.ok(source.includes("matchImportVariant(existing?.product_variants ?? [], {"));
  assert.ok(source.includes("existing?.product_variants.filter((item) =>\n                  matchesVariant(item, variant),"));
  assert.ok(!source.includes("item.sku === variant.sku"));
  assert.ok(!source.includes("generatedVariantSku"));
  assert.ok(source.includes('const skuResolved = match?.sku ?? "";'));
  assert.ok(source.includes("existing SKUs are kept"));
  assert.ok(source.includes("SKU is assigned automatically; leave SKU blank for a new variant"));
  assert.ok(source.includes("catalogSkuPending(variant.skuPrefix)"));
  assert.ok(source.includes("CATALOG_SKU_PREFIX_BY_CATEGORY_SLUG[effectiveCategorySlug]"));
  assert.ok(source.includes("// Blank for a new variant: the database assigns its SKU.\n          sku: variant.skuResolved,"));
});
