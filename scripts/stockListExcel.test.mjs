import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import ExcelJS from "exceljs";
import { buildStockDelta, parseStockList, rowCategory as rowCategoryOf, tableToStockText } from "../src/lib/stockListDelta.ts";
import { buildPhonePlan } from "../src/lib/stockUpdateApply.ts";
import { applyResolutions, describeResolution, draftFromState, loadDraft, saveDraft } from "../src/lib/stockListDraft.ts";
import {
  STOCK_EXCEL_FILL,
  STOCK_EXCEL_HEADERS,
  STOCK_SHEET,
  EXCLUDED_SHEET,
  buildStockExcelRows,
  buildStockExcelWorkbook,
  isStockExcelTable,
  newPhoneDecisions,
  newPhoneResolutions,
  readStockExcel,
  tableFromWorksheet,
} from "../src/lib/stockListExcel.ts";

// Android Stock Update — "Fix in Excel", Phase 1 (pure module). No database, no page change.

const BRANDS = ["Samsung", "Xiaomi", "Motorola", "Realme", "Tecno", "Infinix", "Vivo", "Oppo", "Honor", "itel", "Nothing", "ZTE", "VgoTel", "Apple", "Nokia", "Google"].map((name) => ({ name }));

let n = 0;
const variant = (ram, storage, color, price, extra = {}) => ({
  id: `v${++n}`, sku: `MB${String(n).padStart(3, "0")}`, ram, storage, color, priceMinor: price * 100, compareAtPriceMinor: null, stock: 30,
  ptaStatus: "approved", condition: "brand_new", conditionGrade: null, batteryHealth: null, cycleCount: null, isActive: true, warrantyOverride: "1 Year", deliveryScope: "karachi_only", ...extra,
});
const product = (title, variants, extra = {}) => ({
  id: `p-${title}`, slug: title.toLowerCase().replace(/\+/g, " plus ").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""), title, brand: title.split(" ")[0],
  category: "Mobile Phones", categorySlug: "mobile-phones", publicationStatus: "published", mediaCount: 3, specCount: 9, variants, ...extra,
});
const catalog = () => [
  product("Samsung A07", [variant("4 GB", "64 GB", "Black", 36900), variant("4 GB", "64 GB", "Green", 36900)]),
  product("Realme C75x", [variant("8 GB", "128 GB", "Pink", 61000), variant("8 GB", "128 GB", "Blue", 61000)]),
  product("Samsung S26", [variant("12 GB", "256 GB", "Black", 230000)]),
];

const LIST = [
  "Samsung",
  "A07 4/64 black/green @ 37500",
  "S26 FE 8/256 green @ 150000",
  "",
  "Realme",
  "C75x 8/128 @ 61000",
  "Note 60x 3+5/64 green @ 30500",
  "",
  "Apple",
  "iPhone 16 8/128 black @ 250000",
  "Gift box @ 1500",
].join("\n");

const rowKey = (row) => [row.brand, row.model, row.ram, row.storage, row.color, row.priceMinor].join("|");

/** list -> rows -> real .xlsx bytes -> read back -> list text -> existing parser. */
async function roundTrip(text, options = {}, edit) {
  const parsed = parseStockList(text, BRANDS);
  const data = buildStockExcelRows(parsed, options);
  const workbook = buildStockExcelWorkbook(ExcelJS, data);
  const bytes = await workbook.xlsx.writeBuffer();
  const loaded = new ExcelJS.Workbook();
  await loaded.xlsx.load(bytes);
  const sheet = loaded.getWorksheet(STOCK_SHEET);
  if (edit) edit(sheet);
  const table = tableFromWorksheet(sheet);
  const read = readStockExcel(table);
  return { parsed, data, workbook: loaded, sheet, table, read, reparsed: parseStockList(read.text, BRANDS) };
}

// ---------------------------------------------------------------------------
// Sheet content: list facts only
// ---------------------------------------------------------------------------

test("the sheet has exactly the agreed columns and one row per Android variant; nothing from the website", async () => {
  const { data, sheet, workbook } = await roundTrip(LIST, { delta: buildStockDelta(parseStockList(LIST, BRANDS), catalog()) });
  assert.deepEqual(sheet.getRow(1).values.slice(1), [...STOCK_EXCEL_HEADERS]);
  assert.deepEqual(data.rows.map((r) => [r.line, r.brand, r.model, r.ram, r.storage, r.colour, r.price]), [
    [2, "Samsung", "A07", "4", "64 GB", "Black", "37500"],
    [2, "Samsung", "A07", "4", "64 GB", "Green", "37500"],
    [3, "Samsung", "S26 FE", "8", "256 GB", "Green", "150000"],
    [6, "Realme", "C75x", "8", "128 GB", "", "61000"],
    [7, "Realme", "Note 60x", "3+5", "64 GB", "Green", "30500"],
  ]);
  // The website's own price (36,900), SKUs, stock and ids never appear anywhere in the file.
  const everything = workbook.worksheets.flatMap((ws) => tableFromWorksheet(ws).flat()).join(" ");
  for (const websiteValue of ["36900", "369", "MB001", "MB002", "p-Samsung", "v1", "230000"]) assert.equal(everything.includes(websiteValue), false, websiteValue);
  // iPhone and the gift box are listed only on the "Not included" sheet.
  assert.deepEqual(tableFromWorksheet(workbook.getWorksheet(EXCLUDED_SHEET)).slice(1).map((r) => r[0]), ["10", "11"]);
  assert.equal(data.rows.some((r) => /iphone/i.test(r.model)), false);
});

test("problems are highlighted on the exact cell with a plain reason; nothing missing is filled in", async () => {
  const parsed = parseStockList(LIST, BRANDS);
  const delta = buildStockDelta(parsed, catalog());
  const { data, sheet } = await roundTrip(LIST, { delta, phonePlan: buildPhonePlan(delta, catalog()) });
  const byModel = (model) => data.rows.find((r) => r.model === model);
  const c75x = byModel("C75x");
  assert.equal(c75x.status, "Needs fix");
  assert.equal(c75x.colour, "", "a missing colour stays blank");
  assert.ok(c75x.problems.includes("Colour is missing"));
  assert.ok(c75x.problems.some((p) => /New variant 8 GB \/ 128 GB \(line 6\): this line has no RAM, storage or colour/.test(p)));
  assert.deepEqual(c75x.problemFields, ["colour"]);
  const fe = byModel("S26 FE");
  assert.equal(fe.status, "Needs fix");
  assert.ok(fe.problems.some((p) => /^Looks like the existing Samsung S26/.test(p)));
  assert.deepEqual(fe.problemFields, ["model"]);
  const ram = byModel("Note 60x");
  assert.ok(ram.problems.some((p) => /confirm the RAM/.test(p)));
  assert.deepEqual(ram.problemFields, ["ram"]);
  assert.equal(byModel("A07").status, "Ready");

  // In the real file: red on the problem cell, yellow status, reason text.
  const rowOf = (model) => [...Array(sheet.rowCount).keys()].map((i) => sheet.getRow(i + 1)).find((r) => r.getCell(3).text === model);
  const colourCell = rowOf("C75x").getCell(6);
  assert.equal(colourCell.fill?.fgColor?.argb, STOCK_EXCEL_FILL.problem);
  assert.equal(rowOf("C75x").getCell(9).fill?.fgColor?.argb, STOCK_EXCEL_FILL.needsFix);
  assert.match(rowOf("C75x").getCell(10).text, /Colour is missing/);
  assert.equal(rowOf("A07").getCell(6).fill?.fgColor?.argb, undefined, "a correct cell is not highlighted");
  assert.equal(rowOf("A07").getCell(9).text, "Ready");
});

test("without a Check List the sheet still flags what the list itself is missing", () => {
  const { rows } = buildStockExcelRows(parseStockList(LIST, BRANDS));
  const c75x = rows.find((r) => r.model === "C75x");
  assert.deepEqual([c75x.status, c75x.problems, c75x.problemFields], ["Needs fix", ["Colour is missing"], ["colour"]]);
  assert.equal(rows.find((r) => r.model === "A07").status, "Ready");
});

// ---------------------------------------------------------------------------
// Round trip
// ---------------------------------------------------------------------------

test("round trip: every variant comes back exactly (brand, model, RAM, storage, colour, price) through a real .xlsx file", async () => {
  const { parsed, reparsed, read } = await roundTrip(LIST);
  assert.deepEqual(read.errors, []);
  const android = parsed.rows.filter((r) => r.productType === "Mobile Phone" && r.brand !== "Apple");
  assert.deepEqual(reparsed.rows.map(rowKey), android.map(rowKey));
});

test("the read-back text is exactly what the existing tableToStockText writes (same parser input)", async () => {
  const { table, read } = await roundTrip(LIST);
  assert.equal(read.text, tableToStockText(table));
});

const REAL_LIST = new URL("../scratch/stock-list.txt", import.meta.url);
test("round trip with the Owner's real list (scratch/stock-list.txt): zero differences", { skip: !existsSync(REAL_LIST) && "scratch/stock-list.txt not present" }, async () => {
  const text = readFileSync(REAL_LIST, "utf8");
  const { parsed, reparsed, read, data } = await roundTrip(text);
  assert.deepEqual(read.errors, []);
  const android = parsed.rows.filter((_, index) => !["iphone", "tablet", "accessory", "feature_phone", "other", "unknown"].includes(rowCategoryOf(parsed.rows[index])));
  assert.equal(data.rows.length, android.length);
  assert.equal(reparsed.rows.length, android.length);
  const diffs = android.map((row, index) => [rowKey(row), rowKey(reparsed.rows[index])]).filter(([a, b]) => a !== b);
  assert.deepEqual(diffs, []);
  // The same rows still need review after the round trip (nothing hidden by the conversion).
  assert.equal(reparsed.rows.filter((r) => r.reviewReasons.length).length, android.filter((r) => r.reviewReasons.length).length);
});

// ---------------------------------------------------------------------------
// Corrections and decisions
// ---------------------------------------------------------------------------

test("corrections made in Excel reach the comparison: a colour added fixes the row; 'New phone? = Yes' confirms a look-alike", async () => {
  const { read, reparsed } = await roundTrip(LIST, {}, (sheet) => {
    sheet.eachRow((row) => {
      if (row.getCell(3).text === "C75x") row.getCell(6).value = "Blue";
      if (row.getCell(3).text === "S26 FE") row.getCell(8).value = "Yes";
    });
  });
  assert.deepEqual(read.errors, []);
  const delta = buildStockDelta(reparsed, catalog(), newPhoneDecisions(reparsed, read.newPhoneLines));
  const kindOf = (model, colour) => delta.entries.find((e) => e.row.model === model && e.row.color === colour)?.kind;
  assert.equal(kindOf("C75x", "Blue"), "unchanged", "C75x Blue now matches the existing variant");
  assert.equal(kindOf("S26 FE", "Green"), "new_product", "the Owner confirmed it is a new phone");
  assert.equal(delta.entries.filter((e) => e.kind === "new_variant" && !e.row.color).length, 0);
});

test("uploading the same sheet again (repeated correction) gives the same list", async () => {
  const first = await roundTrip(LIST);
  const again = readStockExcel(first.table);
  assert.equal(again.text, first.read.text);
});

test("a sheet is refused instead of guessed: no Brand / Model / Price column, a blank brand, or a bad 'New phone?' value", () => {
  const header = [...STOCK_EXCEL_HEADERS];
  assert.match(readStockExcel([["Model", "Price"], ["A07", "100"]]).errors[0], /no "Brand" column/);
  assert.match(readStockExcel([header, ["2", "", "A07", "4", "64 GB", "Black", "37500", "", "", ""]]).errors.join(), /Row 2: Brand is empty — type the brand \(it is never copied from the row above\)/);
  assert.match(readStockExcel([header, ["2", "Samsung", "", "4", "64 GB", "Black", "37500", "", "", ""]]).errors.join(), /Row 2: Model is empty/);
  assert.match(readStockExcel([header, ["2", "Samsung", "A07", "4", "64 GB", "Black", "37500", "maybe", "", ""]]).errors.join(), /"New phone\?" must be Yes or empty/);
  assert.match(readStockExcel([header]).errors.join(), /no phone rows/);
  assert.match(readStockExcel([]).errors.join(), /empty/);
});

test("several colours typed in one cell become one variant per colour (shown, not hidden)", () => {
  const header = [...STOCK_EXCEL_HEADERS];
  const read = readStockExcel([header, ["2", "Samsung", "A07", "4", "64 GB", "Black, Green", "37500", "", "", ""]]);
  const parsed = parseStockList(read.text, BRANDS);
  assert.deepEqual(parsed.rows.map((r) => r.color), ["Black", "Green"]);
});

test("Status / What to fix / Line columns are ignored on upload (only list facts are read)", () => {
  const header = [...STOCK_EXCEL_HEADERS];
  const a = readStockExcel([header, ["2", "Samsung", "A07", "4", "64 GB", "Black", "37500", "", "Ready", ""]]);
  const b = readStockExcel([header, ["99", "Samsung", "A07", "4", "64 GB", "Black", "37500", "", "Needs fix", "anything at all"]]);
  assert.equal(a.text, b.text);
});

test("module guarantees: no database access, no website price field", () => {
  const source = readFileSync(new URL("../src/lib/stockListExcel.ts", import.meta.url), "utf8");
  assert.doesNotMatch(source, /supabase|\.rpc\(|from\("|\.insert\(|\.update\(|\.delete\(/);
  assert.doesNotMatch(source, /currentPriceMinor|compareAtPriceMinor|\.sku\b|mediaCount|specCount/);
  const page = readFileSync(new URL("../src/admin/StockListUpdate.tsx", import.meta.url), "utf8");
  // Phase 2 wires the page; the write path itself stays the gated per-phone runner (checked in the page test below).
  assert.match(page, /from "\.\.\/lib\/stockListExcel"/);
});

// ---------------------------------------------------------------------------
// Phase 2: page flow (download -> correct -> upload -> saved fixes -> Check List)
// ---------------------------------------------------------------------------

test("a sheet made by this page is recognised; ordinary CSV / Excel lists keep the old upload", () => {
  assert.equal(isStockExcelTable([[...STOCK_EXCEL_HEADERS]]), true);
  assert.equal(isStockExcelTable([["", ""], ["Line", "Brand", "Model", "Price", "What to fix"]]), true);
  assert.equal(isStockExcelTable([["Brand", "Model", "RAM", "Storage", "Color", "Price"]]), false);
  assert.equal(isStockExcelTable([]), false);
});

test("decisions made on the page travel with the sheet: confirmed new phone = Yes, accepted spelling written corrected", async () => {
  const cat = [...catalog(), product("Xiaomi Redmi Note 15 Pro", [variant("8 GB", "256 GB", "Black", 85000)])];
  const text = `${LIST}\n\nXiaomi\nRedmi Note 15 Pr 8/256 black @ 84000`;
  const parsed = parseStockList(text, BRANDS);
  const fe = parsed.rows.findIndex((r) => r.model === "S26 FE");
  const pr = parsed.rows.findIndex((r) => r.model === "Redmi Note 15 Pr");
  const decisions = parsed.rows.map((_, i) => (i === fe ? { confirmNewPhone: true } : i === pr ? { matchProductId: "p-Xiaomi Redmi Note 15 Pro" } : undefined));
  const delta = buildStockDelta(parsed, cat, decisions);
  const { rows } = buildStockExcelRows(parsed, { delta, decisions });
  assert.equal(rows.find((r) => r.model === "S26 FE").newPhone, true);
  const corrected = rows.find((r) => r.line === parsed.rows[pr].lineNumber);
  assert.equal(corrected.model, "Redmi Note 15 Pro", "only the accepted word is corrected");
  assert.equal(corrected.status, "Ready");
  // After a round trip the corrected spelling matches exactly; "Yes" comes back as a saved new-phone fix.
  const workbook = buildStockExcelWorkbook(ExcelJS, { rows, excluded: [] });
  const loaded = new ExcelJS.Workbook();
  await loaded.xlsx.load(await workbook.xlsx.writeBuffer());
  const read = readStockExcel(tableFromWorksheet(loaded.getWorksheet(STOCK_SHEET)));
  const reparsed = parseStockList(read.text, BRANDS);
  const fixes = newPhoneResolutions(reparsed, read.newPhoneLines);
  assert.equal(Object.keys(fixes).length, 1);
  assert.deepEqual(Object.values(fixes)[0].resolution, { type: "confirm_new_phone" });
  const resolved = applyResolutions(reparsed, fixes);
  const after = buildStockDelta(resolved.parsed, cat, resolved.rowDecisions);
  assert.equal(after.entries.find((e) => e.row.model === "S26 FE").kind, "new_product");
  assert.equal(after.entries.find((e) => e.row.model === "Redmi Note 15 Pro").kind, "price_change");
  assert.equal(after.entries.filter((e) => e.kind === "new_product" && /Note 15/.test(e.productTitle)).length, 0, "never a duplicate phone");
});

test("saved new-phone fixes are one per marked line, survive a draft save / restore and show as a plain fix", () => {
  const read = readStockExcel([[...STOCK_EXCEL_HEADERS], ["3", "Samsung", "S26 FE", "8", "256 GB", "Green, Blue", "150000", "Yes", "", ""], ["4", "Samsung", "A07", "4", "64 GB", "Black", "37500", "", "", ""]]);
  const parsed = parseStockList(read.text, BRANDS);
  const fixes = newPhoneResolutions(parsed, read.newPhoneLines, new Date("2026-10-19T10:00:00Z"));
  assert.equal(Object.keys(fixes).length, 1, "two colours on one line = one fix for the line");
  const record = Object.values(fixes)[0];
  assert.equal(describeResolution(record.resolution), "Confirmed as a new phone");
  const storage = new Map();
  const box = { getItem: (k) => storage.get(k) ?? null, setItem: (k, v) => storage.set(k, v), removeItem: (k) => storage.delete(k) };
  saveDraft(box, draftFromState({ text: read.text, fileName: "x.xlsx", wasParsed: true, lastComparedAt: null, resolutions: fixes, selectionOverrides: {} }));
  const back = loadDraft(box);
  assert.deepEqual(back.draft.resolutions, fixes);
  assert.deepEqual(applyResolutions(parsed, back.draft.resolutions).rowDecisions, [{ confirmNewPhone: true }, { confirmNewPhone: true }, undefined]);
});

test("page source: download after Check List, sheet upload re-checks automatically, other uploads unchanged, no database write", () => {
  const ui = readFileSync(new URL("../src/admin/StockListUpdate.tsx", import.meta.url), "utf8");
  assert.match(ui, /if \(file\.name\.toLowerCase\(\)\.endsWith\("\.xlsx"\) && isStockExcelTable\(table\)\) return await onStockExcel\(table, file\.name\);/);
  assert.match(ui, /changeText\(file\.name\.toLowerCase\(\)\.endsWith\("\.txt"\) \? table\.map\(\(row\) => row\.join\(" "\)\)\.join\("\\n"\) : tableToStockText\(table\), file\.name\);/, "old upload path kept");
  const onStock = ui.slice(ui.indexOf("async function onStockExcel"), ui.indexOf("async function downloadExcel"));
  assert.match(onStock, /if \(read\.errors\.length\) return setError/, "a refused sheet changes nothing");
  assert.match(onStock, /setResolutions\(fixes\);/);
  assert.match(onStock, /await runCheck\(read\.text, fixes\);/, "Check List runs again after upload");
  const download = ui.slice(ui.indexOf("async function downloadExcel"), ui.indexOf("/** Check List = read"));
  assert.match(download, /buildStockExcelRows\(resolved\.parsed, \{ delta, phonePlan, decisions: resolved\.rowDecisions \}\)/);
  assert.doesNotMatch(onStock + download, /\.rpc\(|from\("|\.insert\(|\.update\(|runStockUpdate/);
  assert.match(ui, /WORDING\.excelDownload/);
  assert.equal(ui.match(/runStockUpdate\(/g).length, 1, "Update Website is still the single gated write path");
});
