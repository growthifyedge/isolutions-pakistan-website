import test from "node:test";
import assert from "node:assert/strict";
import ExcelJS from "exceljs";
import { normalizeColor } from "../src/lib/catalogColors.ts";
import { buildStockDelta, parseStockList } from "../src/lib/stockListDelta.ts";
import { STOCK_EXCEL_HEADERS, STOCK_SHEET, buildStockExcelRows, buildStockExcelWorkbook, readStockExcel, tableFromWorksheet } from "../src/lib/stockListExcel.ts";

// Owner decision 2026-10-19: "Icyblue", "i.blue" and "icy blue" are one colour, stored as "Icyblue" (Samsung A57).
// Pure planning only: no database.

const BRANDS = ["Samsung", "Xiaomi", "ZTE"].map((name) => ({ name }));
const SPELLINGS = ["Icyblue", "icyblue", "ICYBLUE", "i.blue", "I.Blue", "icy blue", "Icy Blue", "ICY  BLUE"];

// Mirror of the DEV Samsung A57 rows (SKUs, colours, prices) after the 2026-10-19 Stock Update.
const v = (sku, ram, storage, color, price, stock = 30) => ({
  id: sku, sku, ram, storage, color, priceMinor: price * 100, compareAtPriceMinor: null, stock, ptaStatus: "approved", condition: "brand_new",
  conditionGrade: null, batteryHealth: null, cycleCount: null, isActive: true, warrantyOverride: "1 Year", deliveryScope: "karachi_only",
});
const a57 = () => ({
  id: "p-a57", slug: "samsung-a57", title: "Samsung A57", brand: "Samsung", category: "Mobile Phones", categorySlug: "mobile-phones",
  publicationStatus: "published", mediaCount: 0, specCount: 0,
  variants: [
    v("MB023", "8 GB", "256 GB", "Blue", 149500, 10), v("MB024", "8 GB", "256 GB", "Grey", 149500, 10), v("MB345", "8 GB", "256 GB", "Icyblue", 150500),
    v("MB346", "8 GB", "256 GB", "Lilac", 150500), v("MB025", "8 GB", "256 GB", "Navy", 150500),
    v("MB029", "12 GB", "256 GB", "Blue", 166000, 10), v("MB027", "12 GB", "256 GB", "Envy", 166000, 10), v("MB028", "12 GB", "256 GB", "Grey", 168500),
    v("MB347", "12 GB", "256 GB", "Icyblue", 168500), v("MB026", "12 GB", "256 GB", "Lilac", 168500), v("MB348", "12 GB", "256 GB", "Navy", 168500),
    v("MB032", "12 GB", "512 GB", "Blue", 203000, 10), v("MB030", "12 GB", "512 GB", "Grey", 204500), v("MB349", "12 GB", "512 GB", "Icyblue", 204500),
    v("MB033", "12 GB", "512 GB", "Lilac", 204500), v("MB031", "12 GB", "512 GB", "Navy", 204500),
  ],
});

const a57List = (icy) => [
  "Samsung",
  `A57 8/256 ${icy}/lilac/navy @ 150500`,
  `A57 12/256 ${icy}/lilac/navy/grey @ 168500`,
  `A57 12/512 ${icy}/lilac/navy/grey @ 204500`,
].join("\n");

const icyEntries = (delta) => delta.entries.filter((entry) => entry.row.color === "Icyblue");

test("Icyblue: every Owner-approved spelling normalises to the known colour 'Icyblue'", () => {
  for (const spelling of SPELLINGS) assert.deepEqual(normalizeColor(spelling), { color: "Icyblue", known: true }, spelling);
});

test("Icyblue: other colour mappings are unchanged (no blue / icy / ice word is captured)", () => {
  const unchanged = { blue: "Blue", Blue: "Blue", icy: "Icy", ice: "Ice", "ice blue": "Ice Blue", "light blue": "Light Blue", "sky blue": "Sky Blue", gray: "Grey", grey: "Grey", navy: "Navy", nv: "Navy", lilac: "Lilac", "grey green": "Grey Green" };
  for (const [input, color] of Object.entries(unchanged)) assert.deepEqual(normalizeColor(input), { color, known: true }, input);
  // Near-misses stay unknown and are flagged for review — never guessed into Icyblue.
  for (const input of ["i blue", "i-blue", "icyblu", "icey blue", "iblue", "icy blue green"]) {
    const result = normalizeColor(input);
    assert.notEqual(result.color, "Icyblue", input);
  }
  assert.equal(normalizeColor("icy blue green").known, true, "three known words stay a (multi-word) colour, not Icyblue");
});

test("Icyblue: Check List matches each spelling to the existing A57 Icyblue variants MB345 / MB347 / MB349", () => {
  for (const spelling of ["Icyblue", "i.blue", "icy blue"]) {
    const delta = buildStockDelta(parseStockList(a57List(spelling), BRANDS), [a57()]);
    const icy = icyEntries(delta);
    assert.deepEqual(icy.map((entry) => entry.sku).sort(), ["MB345", "MB347", "MB349"], spelling);
    assert.ok(icy.every((entry) => entry.kind === "unchanged"), `${spelling}: Same, not a new variant`);
    assert.equal(delta.entries.filter((entry) => entry.kind === "ambiguous").length, 0, `${spelling}: nothing needs attention`);
    assert.equal(delta.entries.filter((entry) => entry.kind === "new_variant" || entry.kind === "new_product").length, 0, `${spelling}: nothing created`);
    assert.ok(delta.entries.every((entry) => entry.reasons.every((reason) => !/Colour|Multi-word/.test(reason))), `${spelling}: no colour warning`);
  }
});

test("Icyblue: the old 'Blue' variants are never matched by an Icyblue spelling (stay listed as not in the list)", () => {
  const delta = buildStockDelta(parseStockList(a57List("i.blue"), BRANDS), [a57()]);
  const matched = new Set(delta.entries.map((entry) => entry.sku).filter(Boolean));
  for (const sku of ["MB023", "MB029", "MB032"]) assert.equal(matched.has(sku), false, sku);
  const missing = delta.missing.map((entry) => entry.sku);
  for (const sku of ["MB023", "MB029", "MB032"]) assert.ok(missing.includes(sku), `${sku} reported as not in the list`);
});

test("Icyblue: a plain 'blue' line still matches 'Blue', never Icyblue", () => {
  const delta = buildStockDelta(parseStockList("Samsung\nA57 8/256 blue @ 149500", BRANDS), [a57()]);
  assert.equal(delta.entries[0].sku, "MB023");
  assert.equal(delta.entries[0].kind, "unchanged");
});

test("Icyblue: two spellings of it on one line collapse into the one existing variant (never doubled)", () => {
  const delta = buildStockDelta(parseStockList("Samsung\nA57 8/256 i.blue/icy blue @ 150500", BRANDS), [a57()]);
  assert.deepEqual(delta.entries.map((entry) => [entry.row.color, entry.sku, entry.kind]), [["Icyblue", "MB345", "unchanged"]]);
});

async function excelRoundTrip(text, edit) {
  const parsed = parseStockList(text, BRANDS);
  const workbook = buildStockExcelWorkbook(ExcelJS, buildStockExcelRows(parsed, { delta: buildStockDelta(parsed, [a57()]) }));
  const loaded = new ExcelJS.Workbook();
  await loaded.xlsx.load(await workbook.xlsx.writeBuffer());
  const sheet = loaded.getWorksheet(STOCK_SHEET);
  if (edit) edit(sheet);
  const read = readStockExcel(tableFromWorksheet(sheet));
  return { sheet, read, reparsed: parseStockList(read.text, BRANDS) };
}

test("Icyblue Excel: the downloaded sheet writes 'Icyblue' with no colour problem, and the upload matches MB345 / MB347 / MB349", async () => {
  const { sheet, read, reparsed } = await excelRoundTrip(a57List("i.blue"));
  const colours = [];
  sheet.eachRow((row, index) => { if (index > 1) colours.push(row.getCell(6).text); });
  assert.ok(colours.includes("Icyblue"));
  assert.equal(colours.some((colour) => /i\.blue|icy blue/i.test(colour)), false);
  assert.deepEqual(read.errors, []);
  const icy = icyEntries(buildStockDelta(reparsed, [a57()]));
  assert.deepEqual(icy.map((entry) => [entry.sku, entry.kind]).sort(), [["MB345", "unchanged"], ["MB347", "unchanged"], ["MB349", "unchanged"]]);
});

test("Icyblue Excel: the Owner typing 'icy blue' or 'i.blue' in the Colour cell still matches the existing variant", async () => {
  for (const typed of ["icy blue", "i.blue", "ICYBLUE"]) {
    const { read, reparsed } = await excelRoundTrip("Samsung\nA57 8/256 navy @ 150500", (sheet) => {
      sheet.eachRow((row, index) => { if (index > 1 && row.getCell(6).text === "Navy") row.getCell(6).value = typed; });
    });
    assert.deepEqual(read.errors, [], typed);
    const delta = buildStockDelta(reparsed, [a57()]);
    assert.equal(delta.entries.length, 1, typed);
    assert.equal(delta.entries[0].sku, "MB345", typed);
    assert.equal(delta.entries[0].kind, "unchanged", typed);
  }
});

test("Icyblue Excel: 'Icy Blue, Lilac' in one cell becomes the two existing variants", () => {
  const read = readStockExcel([[...STOCK_EXCEL_HEADERS], ["2", "Samsung", "A57", "8", "256 GB", "Icy Blue, Lilac", "150500", "", "", ""]]);
  assert.deepEqual(read.errors, []);
  const delta = buildStockDelta(parseStockList(read.text, BRANDS), [a57()]);
  assert.deepEqual(delta.entries.map((entry) => [entry.row.color, entry.sku, entry.kind]), [["Icyblue", "MB345", "unchanged"], ["Lilac", "MB346", "unchanged"]]);
});
