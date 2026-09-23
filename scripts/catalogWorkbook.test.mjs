import assert from "node:assert/strict";
import test from "node:test";
import ExcelJS from "exceljs";
import { normalizeStockLines } from "../src/lib/catalogSheet.ts";
import {
  CATALOG_TEMPLATE_VERSION,
  PRODUCT_HEADERS,
  SPECIFICATION_HEADERS,
  buildCatalogWorkbook,
  catalogSheetToBulkParseResult,
  readCatalogWorkbook,
} from "../src/lib/catalogWorkbook.ts";

const reference = {
  brands: ["Samsung", "Xiaomi", "Oppo", "Apple", "Vivo", "Infinix", "Tecno", "Realme"],
  categories: ["Mobile Phones", "Tablets", "Chargers"],
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
  for (const field of ["ptaStatus", "condition", "warranty", "category", "compareAtPriceMinor", "batteryHealth", "cycleCount", "action"])
    assert.equal(row[field], null, field);
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
  assert.equal(used.sku, "APPLE-IPHONE-15-PRO-256-NATURAL-NONPTA-USED-BH89-C312");
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
    sheet.getRow(2).getCell(column("SKU")).value = "a16-dup";
    sheet.getRow(3).getCell(column("SKU")).value = "A16-DUP";
  });
  assert.ok(data.rows.every((row) => row.needsReview && row.fieldStatus.sku === "needs_review"));
  assert.ok(data.rows[0].reviewReasons.some((reason) => reason.startsWith("Duplicate SKU A16-DUP")));
});

test("11b. duplicate variant detection includes PTA and Condition", async () => {
  const rows = normalize("Samsung A16 6/128 Black; 42500; PTA Approved\nSamsung A16 6/128 Black; 39000; Non-PTA");
  const distinct = await roundTrip(rows);
  assert.ok(distinct.rows.every((row) => !row.reviewReasons.some((reason) => reason.startsWith("Duplicate"))));
  const duplicate = await roundTrip(rows, (workbook) => {
    workbook.getWorksheet("Products").getRow(3).getCell(column("PTA Status")).value = "PTA Approved";
    workbook.getWorksheet("Products").getRow(3).getCell(column("SKU")).value = "A16-SECOND";
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
  assert.equal(new Set(data.rows.map((row) => row.sku.toLowerCase())).size, 100);
  data.rows.forEach((row, index) => {
    assert.equal(row.sku, source[index].sku);
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
