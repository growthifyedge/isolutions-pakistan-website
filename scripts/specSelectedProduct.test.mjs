// Spec Upload → Single Product with the product chosen in Admin (Owner-approved 2026-11-24): a ChatGPT workbook without
// Product Slug or Product ID (written by the Open XML SDK, which ExcelJS cannot open) previews against the chosen product
// only; anything naming another product refuses the whole file. Pure functions + the Owner's reference file; no database.
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import {
  assignSelectedProduct,
  planSpecificationUpload,
  rowsFromCsv,
  rowsFromXlsx,
  selectWrites,
  specUploadTemplateXlsx,
} from "../src/lib/specificationBulkUpload.ts";
import { readXlsxTables } from "../src/lib/xlsxTableReader.ts";

const REFERENCE = readFileSync(new URL("./fixtures/samsung-s26-ultra-gpt-specifications.xlsx", import.meta.url));
const S26 = { id: "6f1c5c55-2a5e-4b1f-9a51-26a0b6a0c026", slug: "samsung-s26-ultra", title: "Samsung S26 Ultra" };
const XIAOMI = { id: "7a2d6d66-3b6f-4c2a-8b62-37b1c7b1d037", slug: "xiaomi-redmi-note-15-pro", title: "Xiaomi Redmi Note 15 Pro" };
const CATALOG = [S26, XIAOMI];
const spec = (label, value, group = "Display") => ({ id: `s-${label}`, product_id: S26.id, specification_group: group, label, value, sort_order: 0 });
const row = (rowNumber, productName, productKey, section, label, value) => ({ rowNumber, productName, productKey, section, label, value });

test("the reference ChatGPT workbook (Open XML SDK, x:-prefixed XML) is read: 53 specification rows, blank Product Slug or ID", async () => {
  const sheets = await readXlsxTables(REFERENCE);
  assert.deepEqual(sheets.map((sheet) => sheet.name), ["Specifications", "Instructions", "GPT Instructions"]);
  const read = await rowsFromXlsx(REFERENCE);
  assert.deepEqual(read.fileErrors, []);
  assert.equal(read.rows.length, 53);
  assert.ok(read.rows.every((item) => item.productName === "Samsung S26 Ultra" && item.productKey === ""));
  assert.deepEqual(read.rows[0], row(2, "Samsung S26 Ultra", "", "Display", "Screen Size", "6.9 inches"));
  assert.equal(read.rows.at(-1).rowNumber, 54);
  assert.equal(read.rows.find((item) => item.label === "Resolution").value, "3120 × 1440 pixels (QHD+)", "unicode kept");
  // The Instructions / GPT Instructions text is never imported.
  assert.ok(!read.rows.some((item) => /EXAMPLE|ISOLUTIONS PAKISTAN|Mandatory Research Rules/.test(`${item.productName}${item.label}${item.value}`)));
});

test("chosen product = S26 Ultra: all 53 rows preview for its real id as New Spec; nothing else is touched", async () => {
  const { rows } = await rowsFromXlsx(REFERENCE);
  const assigned = assignSelectedProduct(rows, S26);
  assert.deepEqual(assigned.fileErrors, []);
  assert.ok(assigned.rows.every((item) => item.productKey === S26.id && item.productName === S26.title));
  const plan = planSpecificationUpload(assigned.rows, CATALOG, []);
  assert.deepEqual(plan.fileErrors, []);
  assert.equal(plan.counts["New Spec"], 53);
  assert.equal(plan.exactMatchProducts, 1);
  assert.ok(plan.rows.every((item) => item.product?.id === S26.id));
  assert.equal(selectWrites(plan, new Set()).total, 53);
});

test("existing specifications keep the conflict / overwrite rules: same value present, different value a Conflict (tick to overwrite)", async () => {
  const { rows } = await rowsFromXlsx(REFERENCE);
  const existing = [spec("Screen Size", "6.9 inches"), spec("Display Type", "AMOLED"), spec("Sensors", "Fingerprint", "Security")];
  const plan = planSpecificationUpload(assignSelectedProduct(rows, S26).rows, CATALOG, existing);
  assert.equal(plan.counts["Already Present"], 1);
  assert.equal(plan.counts.Conflict, 2);
  assert.equal(plan.counts["New Spec"], 50);
  const display = plan.rows.find((item) => item.label === "Display Type");
  assert.equal(display.overwritable, true, "same section: overwritable only when ticked");
  const sensors = plan.rows.find((item) => item.label === "Sensors");
  assert.equal(sensors.overwritable, false, "stored under another section: never changed by this upload");
  assert.equal(selectWrites(plan, new Set()).total, 50, "conflicts are not written unless ticked");
  assert.equal(selectWrites(plan, new Set([display.rowNumber])).total, 51);
});

test("wrong product chosen: the whole file is refused (nothing previewed)", async () => {
  const { rows } = await rowsFromXlsx(REFERENCE);
  const result = assignSelectedProduct(rows, XIAOMI);
  assert.deepEqual(result.rows, []);
  assert.match(result.fileErrors.join(" "), /This file is for “Samsung S26 Ultra”, but you chose “Xiaomi Redmi Note 15 Pro”\. Nothing was uploaded/);
});

test("mismatched or multiple identifiers refuse the whole file; the chosen product's own id or slug is accepted", () => {
  const base = [row(2, "Samsung S26 Ultra", "", "Display", "Screen Size", "6.9 inches"), row(3, "Samsung S26 Ultra", "", "Battery", "Capacity", "5000 mAh")];
  assert.deepEqual(assignSelectedProduct([{ ...base[0], productKey: S26.slug }, { ...base[1], productKey: S26.id }], S26).fileErrors, []);
  const other = assignSelectedProduct([{ ...base[0], productKey: XIAOMI.slug }, base[1]], S26);
  assert.deepEqual(other.rows, []);
  assert.match(other.fileErrors[0], /This file names another product \(“xiaomi-redmi-note-15-pro”\), not “Samsung S26 Ultra”/);
  const two = assignSelectedProduct([{ ...base[0], productKey: "a-phone" }, { ...base[1], productKey: "b-phone" }], S26);
  assert.match(two.fileErrors[0], /names 2 other products/);
  const names = assignSelectedProduct([base[0], { ...base[1], productName: "Samsung S25 Ultra" }], S26);
  assert.match(names.fileErrors.join(" "), /names 2 different products/);
  // Case / spacing of the same name is fine; a blank name is fine.
  assert.deepEqual(assignSelectedProduct([{ ...base[0], productName: " samsung  s26 ULTRA " }, { ...base[1], productName: "" }], S26).fileErrors, []);
});

test("duplicate specifications in the file: the second is an Invalid Row (never written twice)", () => {
  const rows = [row(2, "Samsung S26 Ultra", "", "Display", "Screen Size", "6.9 inches"), row(3, "Samsung S26 Ultra", "", "Display", "screen  size", "6.8 inches")];
  const plan = planSpecificationUpload(assignSelectedProduct(rows, S26).rows, CATALOG, []);
  assert.deepEqual(plan.rows.map((item) => item.category), ["New Spec", "Invalid Row"]);
  assert.match(plan.rows[1].messages[0], /Same product and label as row 2/);
  assert.equal(selectWrites(plan, new Set()).total, 1);
});

test("no product chosen: the previous behaviour is unchanged (files for several products; a blank key is an Invalid Row)", () => {
  const csv = "Product Name,Product Slug or Product ID,Section,Label,Value\r\nSamsung S26 Ultra,samsung-s26-ultra,Battery,Capacity,5000 mAh\r\nXiaomi Redmi Note 15 Pro,xiaomi-redmi-note-15-pro,Battery,Capacity,5500 mAh\r\nSamsung S26 Ultra,,Display,Screen Size,6.9 inches\r\n";
  const plan = planSpecificationUpload(rowsFromCsv(csv).rows, CATALOG, []);
  assert.deepEqual(plan.rows.map((item) => item.category), ["New Spec", "New Spec", "Invalid Row"]);
  assert.equal(plan.exactMatchProducts, 2);
  assert.match(plan.rows[2].messages.join(" "), /Product Slug or Product ID is empty/);
});

test("the Admin template (ExcelJS) still reads through ExcelJS; an unreadable file is refused", async () => {
  assert.deepEqual(await rowsFromXlsx(await specUploadTemplateXlsx()), { rows: [], fileErrors: ["The file has no specification rows."] });
  assert.deepEqual(await rowsFromXlsx(new TextEncoder().encode("not a workbook")), { rows: [], fileErrors: ["The file could not be read as an .xlsx workbook."] });
});

test("page: choose the product first; choosing / uploading only previews; Apply uses the existing secure save", () => {
  const page = readFileSync(new URL("../src/admin/SpecificationBulkUpload.tsx", import.meta.url), "utf8").replace(/\r\n/g, "\n");
  assert.match(page, /<select aria-label="Product for this file" value=\{selectedId\}/);
  assert.match(page, /const assigned = assignSelectedProduct\(rows, product\);\s*if \(assigned\.fileErrors\.length\) \{\s*setFileErrors\(assigned\.fileErrors\);\s*return;/);
  assert.match(page, /Choose the product above first: this file has no Product Slug or Product ID/);
  const previewBody = page.slice(page.indexOf("const preview = async"), page.indexOf("const chooseProduct"));
  assert.doesNotMatch(previewBody, /runSpecificationUpload|\.rpc\(|\.insert\(|\.update\(|\.upsert\(|\.delete\(/, "preview never writes");
  assert.match(page, /const outcome = await runSpecificationUpload\(plan, \{ overwrite, typed: phrase \}, catalog, \{/);
  const reader = readFileSync(new URL("../src/lib/xlsxTableReader.ts", import.meta.url), "utf8");
  assert.doesNotMatch(reader, /eval\(|new Function|import\(|fetch\(|supabase/, "the reader only reads cell text");
});
