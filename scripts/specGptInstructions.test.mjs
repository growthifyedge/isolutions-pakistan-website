// Spec Upload → Single Product template: the "GPT Instructions" worksheet (Owner-approved 2026-11-23). The template's
// Specifications sheet and the upload must be unchanged, and no Instructions sheet can ever be imported as data.
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import {
  GPT_INSTRUCTIONS_SHEET,
  SPEC_GPT_PROMPT_LINES,
  SPEC_UPLOAD_HEADERS,
  rowsFromXlsx,
  specUploadTemplateCsv,
  specUploadTemplateXlsx,
} from "../src/lib/specificationBulkUpload.ts";

const { loadExcelJs } = await import("../src/lib/catalogWorkbook.ts");
const ExcelJS = await loadExcelJs();
const load = async (bytes) => {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(bytes);
  return workbook;
};
const SPEC = ["Realme C75x", "realme-c75x", "Battery", "Wired Charging", "45W"];

test("template: Specifications (unchanged) + Instructions + GPT Instructions, in that order", async () => {
  const workbook = await load(await specUploadTemplateXlsx());
  assert.deepEqual(workbook.worksheets.map((sheet) => sheet.name), ["Specifications", "Instructions", GPT_INSTRUCTIONS_SHEET]);
  const specs = workbook.getWorksheet("Specifications");
  assert.equal(specs.actualRowCount, 1, "headers only");
  assert.deepEqual(specs.getRow(1).values.slice(1), [...SPEC_UPLOAD_HEADERS]);
  assert.equal(specs.getRow(1).font.bold, true);
  assert.deepEqual(specs.columns.map((column) => column.width), [28, 30, 16, 26, 40]);
  assert.equal(specUploadTemplateCsv(), "Product Name,Product Slug or Product ID,Section,Label,Value\r\n", "CSV template unchanged");
});

test("GPT Instructions: the Owner's prompt, word for word, one line per row", async () => {
  const workbook = await load(await specUploadTemplateXlsx());
  const gpt = workbook.getWorksheet(GPT_INSTRUCTIONS_SHEET);
  const lines = [];
  for (let row = 1; row <= gpt.rowCount; row += 1) lines.push(String(gpt.getRow(row).getCell(1).value ?? ""));
  assert.deepEqual(lines, [...SPEC_GPT_PROMPT_LINES]);
  assert.equal(lines[0], "ISOLUTIONS PAKISTAN — GPT PRODUCT SPECIFICATIONS RESEARCHER");
  assert.ok(lines.includes("Product Model: [OWNER WILL PROVIDE EXACT MODEL NAME]"));
  const rules = lines.filter((line) => /^\d+\. /.test(line));
  // 2026-11-24: rule 21 (leave Product Slug or Product ID blank; Admin's chosen product supplies it) → 26 rules.
  assert.equal(rules.length, 26);
  assert.deepEqual(rules.map((line) => Number(line.split(".")[0])), Array.from({ length: 26 }, (_, index) => index + 1));
  assert.equal(rules[0], "1. Read the attached Excel workbook completely, including its GPT Instructions worksheet.");
  assert.match(rules[20], /^21\. Leave the "Product Slug or Product ID" column blank: never fill an internal product ID or slug\. The Owner selects the exact product in Admin/);
  assert.equal(rules[25], "26. Do not claim successful website upload or publication. The Owner controls the final Apply action.");
  for (const kept of ["5. Never guess or fabricate specifications.", "7. If any specification cannot be verified reliably, leave its value blank."]) assert.ok(rules.includes(kept), kept);
  assert.match(lines.at(-1), /^Approval Rule: The final ChatGPT-verified specification sheet is considered business-approved/);
  for (const heading of ["Mandatory Research Rules", "Excel Rules", "Verification and Final Output"]) assert.ok(lines.includes(heading), heading);
  assert.equal(gpt.getRow(1).font.bold, true);
  assert.equal(gpt.getRow(2).getCell(1).alignment.wrapText, true);
});

test("upload: the untouched template imports nothing; a filled template reads back exactly (GPT sheet ignored)", async () => {
  const bytes = await specUploadTemplateXlsx();
  assert.deepEqual(await rowsFromXlsx(bytes), { rows: [], fileErrors: ["The file has no specification rows."] });
  const workbook = await load(bytes);
  workbook.getWorksheet("Specifications").addRow(SPEC);
  const read = await rowsFromXlsx(await workbook.xlsx.writeBuffer());
  assert.deepEqual(read, { rows: [{ rowNumber: 2, productName: "Realme C75x", productKey: "realme-c75x", section: "Battery", label: "Wired Charging", value: "45W" }], fileErrors: [] });
});

test("the GPT Instructions sheet can never be imported — even moved first, with headers typed in it, or alone", async () => {
  // GPT moved the sheet first and renamed Specifications: the data sheet is still the one read.
  let workbook = await load(await specUploadTemplateXlsx());
  workbook.getWorksheet("Specifications").addRow(SPEC);
  workbook.getWorksheet("Specifications").name = "Sheet1";
  workbook.getWorksheet(GPT_INSTRUCTIONS_SHEET).orderNo = -1;
  workbook.getWorksheet("Instructions").orderNo = 0;
  workbook.getWorksheet("Sheet1").orderNo = 5;
  let read = await rowsFromXlsx(await workbook.xlsx.writeBuffer());
  assert.deepEqual(read.rows.map((row) => row.label), ["Wired Charging"]);

  // Specification-looking rows typed into the GPT sheet, and no data sheet at all: nothing is imported.
  workbook = await load(await specUploadTemplateXlsx());
  workbook.getWorksheet(GPT_INSTRUCTIONS_SHEET).addRow([...SPEC_UPLOAD_HEADERS]);
  workbook.getWorksheet(GPT_INSTRUCTIONS_SHEET).addRow(SPEC);
  workbook.removeWorksheet(workbook.getWorksheet("Specifications").id);
  read = await rowsFromXlsx(await workbook.xlsx.writeBuffer());
  assert.deepEqual(read, { rows: [], fileErrors: ["The workbook has no sheet."] });

  // Same with a renamed copy of the sheet (e.g. a GPT tool renames it).
  workbook = await load(await specUploadTemplateXlsx());
  workbook.removeWorksheet(workbook.getWorksheet("Specifications").id);
  workbook.getWorksheet(GPT_INSTRUCTIONS_SHEET).name = "GPT-INSTRUCTIONS copy";
  assert.deepEqual((await rowsFromXlsx(await workbook.xlsx.writeBuffer())).rows, []);
});

test("Same Model (iPhone / Android model specs) and the page are unchanged", () => {
  const page = readFileSync(new URL("../src/admin/SpecificationBulkUpload.tsx", import.meta.url), "utf8");
  assert.match(page, /download\("specifications-template\.xlsx", await specUploadTemplateXlsx\(\)/);
  const lib = readFileSync(new URL("../src/lib/specificationBulkUpload.ts", import.meta.url), "utf8");
  const start = lib.indexOf("export const SPEC_GPT_PROMPT_LINES");
  assert.doesNotMatch(lib.slice(start, lib.indexOf("\n];", start)), /\.rpc\(|\.from\(|\$\{|`/, "the prompt is plain text");
});

test("GPT Instructions: Row Limits per section (template section names), exclusions, and the Top 7 note; numbered rules unchanged", async () => {
  const start = SPEC_GPT_PROMPT_LINES.indexOf("Row Limits");
  const end = SPEC_GPT_PROMPT_LINES.indexOf("Verification and Final Output");
  assert.ok(start > SPEC_GPT_PROMPT_LINES.findIndex((line) => line.startsWith("21. ")) && end > start, "after the Excel rules");
  const block = SPEC_GPT_PROMPT_LINES.slice(start, end).join("\n");
  const limits = [...block.matchAll(/^- ([^:]+): up to (\d) rows/gm)].map((match) => [match[1], Number(match[2])]);
  assert.deepEqual(limits, [["General Features", 4], ["Display", 4], ["Performance", 2], ["Memory", 2], ["Camera", 4], ["Battery", 3], ["Connectivity", 4], ["Software", 2], ["Build / Design", 3]]);
  assert.equal(limits.reduce((sum, [, max]) => sum + max, 0), 28);
  for (const section of [...block.matchAll(/Section "([^"]+)"/g)].map((match) => match[1])) assert.ok(["Display", "Performance", "Software", "Camera", "Battery", "Connectivity", "Build", "Audio", "Security", "Other"].includes(section), `upload accepts ${section}`);
  assert.match(block, /Never include PTA status, price, stock, condition, warranty, delivery or colour\./);
  assert.match(block, /Leave out N\/A, unknown or empty values, values repeated under another label/);
  assert.match(block, /do not limit the sheet to 7/);
  assert.equal(SPEC_GPT_PROMPT_LINES.filter((line) => /^\d+\. /.test(line)).length, 26);
  const workbook = await load(await specUploadTemplateXlsx());
  assert.deepEqual(workbook.worksheets.map((sheet) => sheet.name), ["Specifications", "Instructions", GPT_INSTRUCTIONS_SHEET]);
  assert.deepEqual(workbook.getWorksheet("Specifications").getRow(1).values.slice(1), [...SPEC_UPLOAD_HEADERS]);
  const help = [];
  workbook.getWorksheet("Instructions").eachRow((row) => help.push(String(row.getCell(1).value ?? "")));
  assert.ok(help.some((line) => /^Keep it concise: up to 4 General Features \(Section Other\)/.test(line)));
});
