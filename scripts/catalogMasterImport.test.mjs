import assert from "node:assert/strict";
import test from "node:test";
import ExcelJS from "exceljs";
import JSZip from "jszip";
import {
  MASTER_ACTION_STRATEGIES,
  catalogImportFilename,
  defaultMasterSheet,
  evaluateMasterRows,
  generateMasterImportWorkbook,
  groupMasterIssues,
  initialMasterSelection,
  prepareMasterRows,
  readMasterWorkbook,
} from "../src/lib/catalogMasterImport.ts";
import { canonicalModel, physicalRamFromExtended } from "../src/lib/catalogSheet.ts";
import {
  CATALOG_TEMPLATE_VERSION,
  PRODUCT_HEADERS,
  SPECIFICATION_HEADERS,
  buildCatalogWorkbook,
  readCatalogWorkbook,
} from "../src/lib/catalogWorkbook.ts";
import { normalizeRelationshipsPart, normalizeXmlPart } from "../src/lib/xlsxCompatibility.ts";

// Active PROD taxonomy as read on 2026-10-07 (no Vgotel / ZTE).
const reference = {
  brands: ["Apple", "Google", "Honor", "Infinix", "itel", "Motorola", "Nothing", "OnePlus", "Oppo", "Realme", "Samsung", "Tecno", "Vivo", "Xiaomi"],
  categories: ["Accessories", "Gadgets", "Laptops", "Mobile Phones", "Tablets"],
  existingSkus: [],
  existingTitles: [],
};
const MASTER_HEADERS = ["Brand", "Model", "RAM", "Storage", "Color", "Price PKR", "Stock Qty", "Warranty", "Category", "Source Date", "Notes"];

/** A master workbook shaped like the Android catalog import pack (Summary sheet first). */
async function masterBytes(rows, { headers = MASTER_HEADERS, sheetName = "Import - Android Phones" } = {}) {
  const workbook = new ExcelJS.Workbook();
  const summary = workbook.addWorksheet("Summary");
  summary.addRow(["iSolutions Pakistan - Android Catalog Import Pack"]);
  summary.addRow(["Android phone variant rows ready", rows.length]);
  const sheet = workbook.addWorksheet(sheetName);
  sheet.addRow(headers);
  for (const row of rows) sheet.addRow(headers.map((header) => row[header] ?? null));
  return new Uint8Array(await workbook.xlsx.writeBuffer());
}
const phone = (brand, model, ram, storage, color, price, extra = {}) => ({
  Brand: brand, Model: model, RAM: ram, Storage: storage, Color: color, "Price PKR": price,
  Warranty: "1 Year", Category: "Mobile Phones", "Source Date": "2026-09-14", ...extra,
});
const options = (extra = {}) => ({ productType: "Mobile Phone", strategy: "create", defaultStock: 10, reference, ...extra });
async function prepare(rows, extra) {
  const master = await readMasterWorkbook(await masterBytes(rows));
  return prepareMasterRows(defaultMasterSheet(master), options(extra));
}
const reviewAll = (prepared) => evaluateMasterRows(prepared, new Set(prepared.map((item) => item.sourceRow)), reference);

test("A. master headers map by name: Price PKR -> Price, Stock Qty -> Stock; Source Date is not imported", async () => {
  const master = await readMasterWorkbook(await masterBytes([phone("Samsung", "A07", "4GB", "64GB", "Black", 35800)]));
  assert.equal(master.error, null);
  assert.equal(master.compatibilityMode, false);
  const sheet = defaultMasterSheet(master);
  assert.equal(sheet.name, "Import - Android Phones");
  assert.equal(sheet.usable, true);
  const field = (header) => sheet.columns.find((column) => column.header === header);
  assert.equal(field("Price PKR").field, "Price");
  assert.equal(field("Stock Qty").field, "Stock");
  assert.equal(field("Model").field, "Model / Product Title");
  assert.equal(field("Source Date").field, null);
  assert.match(field("Source Date").note, /not imported/);
  assert.equal(sheet.rows.length, 1);
  assert.equal(sheet.rows[0].sourceRow, 2);
});

test("A2. missing required columns and ambiguous duplicate columns are reported, never guessed", async () => {
  const noPrice = await readMasterWorkbook(await masterBytes([{ Brand: "Samsung", Model: "A07" }], { headers: ["Brand", "Model", "Cost"] }));
  const [sheet] = noPrice.sheets.filter((item) => item.name !== "Summary");
  assert.equal(sheet.usable, false);
  assert.deepEqual(sheet.missing, ["Price"]);
  assert.match(sheet.columns.find((column) => column.header === "Cost").note, /not recognised/);
  const twoPrices = await readMasterWorkbook(await masterBytes([], { headers: ["Brand", "Model", "Price", "Price PKR"] }));
  const [conflicted] = twoPrices.sheets.filter((item) => item.name !== "Summary");
  assert.equal(conflicted.usable, false);
  assert.match(conflicted.conflicts[0], /"Price" and "Price PKR" both look like Price/);
});

test("B-C. blank Stock Qty -> numeric default (10); an explicit quantity is kept", async () => {
  const prepared = await prepare([
    phone("Samsung", "A07", "4GB", "64GB", "Black", 35800),
    phone("Samsung", "A07", "4GB", "64GB", "Green", 35800, { "Stock Qty": 3 }),
    phone("Samsung", "A07", "4GB", "64GB", "Volt", 35800, { "Stock Qty": 0 }),
  ]);
  assert.deepEqual(prepared.map((item) => item.row.stock), [10, 3, 0]);
  assert.ok(prepared.every((item) => typeof item.row.stock === "number" && !item.row.needsReview));
  const custom = await prepare([phone("Samsung", "A07", "4GB", "64GB", "Black", 35800)], { defaultStock: 7 });
  assert.equal(custom[0].row.stock, 7);
  const invalid = await prepare([phone("Samsung", "A07", "4GB", "64GB", "Black", 35800, { "Stock Qty": "10 pcs" })]);
  assert.equal(reviewAll(invalid).rows[0].status, "blocked");
});

test("D. models use the project canonicalModel rule (glued Pro/Lite/FE split, Pro+ kept)", async () => {
  const expected = {
    V80lite: "V80 Lite", X300FE: "X300 FE", A7pro: "A7 Pro", "Note 14pro": "Note 14 Pro", "Note 15pro": "Note 15 Pro",
    "Note 15pro+": "Note 15 Pro+", "Reno 15pro 5G": "Reno 15 Pro 5G", "Note 60pro": "Note 60 Pro", "GT 50pro": "GT 50 Pro",
    "Camon 50pro": "Camon 50 Pro", "Phone 2pro": "Phone 2 Pro", "New 16pro": "New 16 Pro", "Smart 9pro": "Smart 9 Pro", V70FE: "V70 FE",
  };
  for (const [input, output] of Object.entries(expected)) assert.equal(canonicalModel(input), output, input);
  const prepared = await prepare([
    phone("Xiaomi", "A7pro", "4GB", "64GB", "Black", 34900),
    phone("Vivo", "V70FE", "12GB", "256GB", "Blue", 137000),
    phone("Xiaomi", "Note 15pro+", "12GB", "512GB", "Black", 159500),
    phone("Samsung", "Samsung A07", "4GB", "64GB", "Black", 35800),
  ]);
  assert.deepEqual(prepared.map((item) => item.row.productTitle), ["Xiaomi A7 Pro", "Vivo V70 FE", "Xiaomi Note 15 Pro+", "Samsung A07"]);
  assert.deepEqual(prepared[0].changes, ["Model A7pro → A7 Pro"]);
  assert.equal(prepared[2].row.slug, "xiaomi-note-15-pro-plus");
});

test("E. extended RAM uses the first (physical) figure with a visible warning; anything else is blocked", async () => {
  assert.deepEqual(physicalRamFromExtended("3+5GB"), { ram: "3 GB", extended: "5 GB" });
  assert.deepEqual(physicalRamFromExtended("4+4GB"), { ram: "4 GB", extended: "4 GB" });
  assert.deepEqual(physicalRamFromExtended("4 GB + 8 GB"), { ram: "4 GB", extended: "8 GB" });
  assert.equal(physicalRamFromExtended("8GB"), null);
  assert.equal(physicalRamFromExtended("4+4+4"), null);
  const prepared = await prepare([
    phone("Realme", "Note 60x", "3+5GB", "64GB", "Green", 29500),
    phone("Realme", "Note 60x", "4+4GB", "64GB", "Green", 33500),
    phone("Realme", "C100", "4+8GB", "128GB", "Gold", 28300),
    phone("Realme", "C100", "4+4+4GB", "128GB", "Blue", 28300),
  ]);
  const review = reviewAll(prepared);
  assert.deepEqual(prepared.slice(0, 3).map((item) => item.row.ram), ["3 GB", "4 GB", "4 GB"]);
  assert.deepEqual(review.rows.slice(0, 3).map((item) => item.status), ["warning", "warning", "warning"]);
  assert.match(review.rows[0].warnings[0], /RAM 3\+5GB → 3 GB/);
  assert.equal(review.rows[3].status, "blocked");
});

test("F. variants differing only by price/warranty are duplicates: both rows blocked, never dropped", async () => {
  const prepared = await prepare([
    phone("Vivo", "V70FE", "8GB", "256GB", "Silver", 110000, { Notes: "Active" }),
    phone("Vivo", "V70FE", "8GB", "256GB", "Silver", 119500, { Warranty: "Official Warranty" }),
    phone("Vivo", "V70FE", "12GB", "256GB", "Blue", 137000),
  ]);
  const review = reviewAll(prepared);
  assert.deepEqual(review.rows.map((item) => item.status), ["blocked", "blocked", "ready"]);
  assert.match(review.rows[0].issues.join(), /Duplicate variant: rows 2, 3/);
  assert.match(review.rows[1].issues.join(), /Duplicate variant: rows 2, 3/);
  assert.equal(review.blockers.length, 1);
  // Default selection leaves both out; explicitly including one of them clears the other.
  const selection = initialMasterSelection(prepared, reference);
  assert.deepEqual([...selection], [4]);
  const chosen = evaluateMasterRows(prepared, new Set([3, 4]), reference);
  assert.deepEqual(chosen.rows.map((item) => item.status), ["blocked", "ready", "ready"]);
  assert.deepEqual(chosen.blockers, []);
  assert.equal(chosen.counts.included, 2);
});

test("G. unknown brands are blocked with a clear message and excluded by default", async () => {
  const prepared = await prepare([
    phone("VgoTel", "Onyx", "3GB", "32GB", "Black", 14900),
    phone("ZTE", "A56", "4GB", "128GB", "Black", 31300),
    phone("Itel", "A50c", "2GB", "64GB", "Black", 23900),
  ]);
  const review = reviewAll(prepared);
  assert.deepEqual(review.rows.map((item) => item.status), ["blocked", "blocked", "ready"]);
  assert.deepEqual(review.rows[0].issues, ["Brand does not exist in target catalog: VgoTel"]);
  assert.equal(review.rows[2].row.brand, "itel");
  assert.deepEqual(prepared[2].changes, ["Brand Itel → itel"]);
  assert.deepEqual([...initialMasterSelection(prepared, reference)], [4]);
  const groups = groupMasterIssues(review, "issues");
  assert.deepEqual(groups.map((group) => group.rows), [[2], [3]]);
});

test("Category, delivery and action rules: Karachi Only phones, category mismatch blocked, strategies explicit", async () => {
  const prepared = await prepare([
    phone("Samsung", "A07", "4GB", "64GB", "Black", 35800, { Category: undefined }),
    phone("Samsung", "Tab A11", "8GB", "128GB", "Grey", 52000, { Category: "Gadgets > Tablets" }),
  ]);
  assert.equal(prepared[0].row.category, "Mobile Phones");
  assert.equal(prepared[0].row.deliveryScope, "karachi_only");
  assert.equal(prepared[0].row.action, "Create");
  const review = reviewAll(prepared);
  assert.equal(review.rows[0].status, "ready");
  assert.match(review.rows[1].issues.join(), /does not match Product Type Mobile Phone/);

  const existing = { ...reference, existingTitles: ["Samsung A07"] };
  const rows = [phone("Samsung", "A07", "4GB", "64GB", "Black", 35800), phone("Samsung", "A17", "6GB", "128GB", "Black", 66500)];
  const create = await prepare(rows, { reference: existing, strategy: "create" });
  assert.match(create[0].issues[0], /Create would be rejected/);
  assert.deepEqual(create[1].issues, []);
  const replace = await prepare(rows, { reference: existing, strategy: "replace" });
  assert.equal(replace[0].row.action, "Replace Existing");
  assert.match(replace[1].issues[0], /Replace Existing would be rejected/);
  const auto = await prepare(rows, { reference: existing, strategy: "auto" });
  assert.deepEqual(auto.map((item) => item.row.action), ["Replace Existing", "Create"]);
  assert.match(auto[0].warnings[0], /will be hidden/);
  assert.deepEqual(Object.keys(MASTER_ACTION_STRATEGIES), ["create", "replace", "auto"]);
});

test("H-I. generated workbook: template sheets, headers and marker; the exact bytes read back with readCatalogWorkbook", async () => {
  const prepared = await prepare([
    phone("Samsung", "A07", "4GB", "64GB", "Black", 35800),
    phone("Samsung", "A07", "4GB", "64GB", "Green", 35800),
  ]);
  const review = reviewAll(prepared);
  const { bytes, validation } = await generateMasterImportWorkbook(review, reference);
  assert.equal(validation.ok, true, validation.errors.join("\n"));
  assert.deepEqual(validation.errors, []);
  assert.equal(validation.rowCount, 2);
  assert.equal(validation.productCount, 1);

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(bytes);
  assert.deepEqual(workbook.worksheets.map((sheet) => sheet.name), ["Products", "Specifications", "Lists"]);
  assert.equal(workbook.getWorksheet("Lists").state, "hidden");
  assert.deepEqual(workbook.getWorksheet("Products").getRow(1).values.slice(1), [...PRODUCT_HEADERS]);
  assert.deepEqual(workbook.getWorksheet("Specifications").getRow(1).values.slice(1), [...SPECIFICATION_HEADERS]);
  assert.equal(workbook.getWorksheet("Specifications").rowCount, 1);
  assert.equal(workbook.getWorksheet("Lists").getCell("H2").value, CATALOG_TEMPLATE_VERSION);
  const products = workbook.getWorksheet("Products");
  const cell = (row, header) => products.getRow(row).getCell(PRODUCT_HEADERS.indexOf(header) + 1).value;
  assert.equal(cell(2, "Action"), "Create");
  assert.equal(cell(2, "Stock"), 10);
  assert.equal(cell(2, "Price"), 35800);
  assert.equal(cell(2, "SKU"), null);
  assert.equal(cell(2, "Slug"), null);
  assert.equal(cell(2, "Delivery Scope"), "Karachi Only");

  // Independent read of the same bytes, exactly as Upload Excel does it.
  const data = await readCatalogWorkbook(bytes, reference);
  assert.deepEqual(data.fileErrors, []);
  assert.equal(data.rows.length, 2);
  assert.ok(data.rows.every((row) => row.stock === 10 && row.action === "Create" && !row.needsReview && row.sku === null));
});

test("I2. generation refuses while included rows are blocked; validation failures are reported", async () => {
  const prepared = await prepare([phone("VgoTel", "Onyx", "3GB", "32GB", "Black", 14900)]);
  const review = reviewAll(prepared);
  await assert.rejects(() => generateMasterImportWorkbook(review, reference), /blocked/);
});

test("J. representative 279-row Android master: 17 blocked rows shown, 262 included rows round-trip", async () => {
  const brands = ["Samsung", "Xiaomi", "Vivo", "Oppo", "Infinix", "Tecno", "Realme", "Honor", "Nothing", "Itel", "Motorola"];
  const suffixes = ["", "pro", "lite", "FE", " Pro+", "pro 5G"];
  const configs = [["4GB", "64GB"], ["6GB", "128GB"], ["8GB", "256GB"], ["12GB", "512GB"], ["3+5GB", "64GB"]];
  const colors = ["Black", "Blue", "Green"];
  const rows = [];
  for (let index = 0; rows.length < 260; index += 1) {
    const brand = brands[index % brands.length];
    const model = `X${10 + Math.floor(index / 15)}${suffixes[Math.floor(index / 3) % suffixes.length]}`;
    const [ram, storage] = configs[Math.floor(index / 3) % configs.length];
    rows.push(phone(brand, model, ram, storage, colors[index % colors.length], 20000 + index * 350, index % 40 === 0 ? { Warranty: "Official Warranty" } : {}));
  }
  // The two duplicate-identity Vivo rows plus their normal siblings.
  rows.push(phone("Vivo", "V70FE", "8GB", "256GB", "Silver", 110000));
  rows.push(phone("Vivo", "V70FE", "8GB", "256GB", "Silver", 119500));
  rows.push(phone("Vivo", "V70FE", "12GB", "256GB", "Blue", 137000));
  for (let index = 0; index < 16; index += 1)
    rows.push(phone(index < 8 ? "ZTE" : "VgoTel", `Model ${index}`, "4GB", "64GB", colors[index % 3], 26500));
  assert.equal(rows.length, 279);

  const started = performance.now();
  const prepared = await prepare(rows);
  const selection = initialMasterSelection(prepared, reference);
  assert.equal(selection.size, 261);
  // The Owner explicitly includes the normal V70 FE 8/256 Silver (row 263) and leaves 262 out.
  selection.add(263);
  const review = evaluateMasterRows(prepared, selection, reference);
  assert.deepEqual(review.blockers, []);
  assert.equal(review.counts.total, 279);
  assert.equal(review.counts.included, 262);
  assert.equal(review.counts.excluded, 17);
  assert.equal(review.rows.filter((item) => !item.included && item.status === "blocked").length, 17);
  const { bytes, validation } = await generateMasterImportWorkbook(review, reference);
  assert.equal(validation.ok, true, validation.errors.join("\n"));
  assert.equal(validation.rowCount, 262);
  assert.equal(validation.productCount, review.counts.products);
  const data = await readCatalogWorkbook(bytes, reference);
  assert.deepEqual(data.fileErrors, []);
  assert.equal(data.rows.length, 262);
  assert.ok(data.rows.every((row) => !row.needsReview && row.stock === 10 && row.action === "Create" && row.category === "Mobile Phones"));
  assert.ok(!data.rows.some((row) => /\+/.test(row.ram ?? "") || /^(zte|vgotel)$/i.test(row.brand ?? "")));
  assert.ok(performance.now() - started < 15000);
});

// Rewrites an ExcelJS workbook the way some generators write OOXML: prefixed elements, a BOM
// and absolute relationship targets. ExcelJS (and therefore readCatalogWorkbook) cannot read it.
async function prefixedCopy(bytes) {
  const zip = await JSZip.loadAsync(bytes);
  for (const name of Object.keys(zip.files)) {
    if (!/\.(xml|rels)$/.test(name)) continue;
    let xml = await zip.file(name).async("string");
    if (name.startsWith("xl/") && !name.endsWith(".rels") && xml.includes('xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"')) {
      xml = xml
        .replace(/<(\/?)(?![?!])([A-Za-z][\w.-]*)(?=[\s/>])/g, "<$1x:$2")
        .replace('xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"', 'xmlns:x="http://schemas.openxmlformats.org/spreadsheetml/2006/main"');
    }
    if (name.endsWith(".rels")) {
      const dir = name.replace(/_rels\/[^/]*$/, "");
      xml = `${String.fromCharCode(0xfeff)}${xml.replace(/Target="(?!\/|http)([^"]+)"/g, (_, target) => `Target="/${dir}${target}"`)}`;
    }
    zip.file(name, xml);
  }
  return zip.generateAsync({ type: "uint8array" });
}

test("compatibility: prefixed-namespace masters are readable for preparation; exact upload behaviour is unchanged", async () => {
  const original = await masterBytes([phone("Samsung", "A07", "4GB", "64GB", "Black", 35800)]);
  const prefixed = await prefixedCopy(original);
  const plain = new ExcelJS.Workbook();
  await assert.rejects(() => plain.xlsx.load(prefixed));
  const master = await readMasterWorkbook(prefixed);
  assert.equal(master.error, null);
  assert.equal(master.compatibilityMode, true);
  const sheet = defaultMasterSheet(master);
  assert.equal(sheet.rows.length, 1);
  assert.equal(sheet.rows[0].values.Price, 35800);
  // The exact-template Upload Excel reader is not changed: it still rejects such a file.
  const template = await prefixedCopy(await buildCatalogWorkbook([], [], reference));
  const data = await readCatalogWorkbook(template, reference);
  assert.deepEqual(data.fileErrors, ["The file could not be read as an .xlsx workbook."]);

  const main = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
  assert.equal(normalizeXmlPart(`${String.fromCharCode(0xfeff)}<?xml version="1.0"?><x:a xmlns:x="${main}"><x:b/></x:a>`), `<?xml version="1.0"?><a xmlns="${main}"><b/></a>`);
  // Other namespaces keep their prefixes (ExcelJS expects cp:coreProperties).
  const core = '<?xml version="1.0"?><cp:coreProperties xmlns:cp="urn:core"><cp:keywords/></cp:coreProperties>';
  assert.equal(normalizeXmlPart(core), core);
  assert.equal(
    normalizeRelationshipsPart('<Relationships xmlns="urn:r"><Relationship Id="a" Type="t/comments" Target="/xl/comments1.xml"/><Relationship Id="b" Type="t/styles" Target="/xl/styles.xml"/></Relationships>', "xl/_rels/workbook.xml.rels"),
    '<Relationships xmlns="urn:r"><Relationship Id="b" Type="t/styles" Target="styles.xml"/></Relationships>',
  );
});

test("unreadable files report the importer's message", async () => {
  const master = await readMasterWorkbook(new TextEncoder().encode("not a workbook"));
  assert.equal(master.error, "The file could not be read as an .xlsx workbook.");
});

test("file name: isolutions-mobile-phones-import-YYYY-MM-DD.xlsx", () => {
  assert.equal(catalogImportFilename("Mobile Phone", new Date(2026, 9, 7)), "isolutions-mobile-phones-import-2026-10-07.xlsx");
  assert.equal(catalogImportFilename("Accessory", new Date(2026, 0, 2)), "isolutions-accessories-import-2026-01-02.xlsx");
});
