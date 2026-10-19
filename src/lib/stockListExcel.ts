/**
 * Android Stock Update — "Fix in Excel" (Phase 1: pure module, not wired to the page yet).
 *
 *   pasted list -> parseStockList (existing parser) -> one Excel row per variant (list facts only)
 *   -> the Owner corrects the sheet -> upload -> the sheet becomes the list text again -> the existing parser,
 *   Check List, held rules, per-phone saving, stock 30 and hiding all apply unchanged.
 *
 * The sheet holds ONLY what the Owner's list says (brand, model, RAM, storage, colour, list price) plus the line it came
 * from and plain reasons for anything to fix. It never contains website prices, SKUs, stock, images or other website data,
 * and nothing missing is ever filled in: a blank stays blank and is highlighted.
 *
 * Reading back reuses the existing text form (same lines as tableToStockText), so the same parser reads it. The only
 * extra is the "New phone?" column: "Yes" becomes the existing confirm-new-phone decision for that row's line.
 * Database access: none.
 */
import type { Cell, Workbook, Worksheet } from "exceljs";
import { rowCategory, type DeltaEntry, type ParsedStockList, type RowDecision, type StockDelta } from "./stockListDelta.ts";
import { buildRowKeys, type ResolutionRecord } from "./stockListDraft.ts";
import { heldKeyOf, type PhonePlan } from "./stockUpdateApply.ts";
import { explainReason } from "./stockUpdateWording.ts";

// ---------------------------------------------------------------------------
// Sheet layout
// ---------------------------------------------------------------------------

export const STOCK_SHEET = "Android list";
export const EXCLUDED_SHEET = "Not included";

/** Columns of the Owner's sheet, in order. Brand / Model / RAM / Storage / Colour / Price are read back; the rest is help. */
export const STOCK_EXCEL_HEADERS = ["Line", "Brand", "Model", "RAM", "Storage", "Colour", "Price", "New phone?", "Status", "What to fix"] as const;
export type StockExcelHeader = (typeof STOCK_EXCEL_HEADERS)[number];

export type StockExcelField = "brand" | "model" | "ram" | "storage" | "colour" | "price";
export type StockExcelStatus = "Ready" | "New phone" | "Needs fix";

export type StockExcelRow = {
  /** Line number in the pasted list (for the Owner's reference only). */
  line: number;
  brand: string;
  model: string;
  ram: string;
  storage: string;
  colour: string;
  /** List price in rupees as typed (no website price). Blank when the list has none. */
  price: string;
  newPhone: boolean;
  status: StockExcelStatus;
  /** Plain reasons, already in the Owner's words. */
  problems: string[];
  /** Cells to highlight. */
  problemFields: StockExcelField[];
};

export type StockExcelExcluded = { line: number; text: string; reason: string };

/** Fill colours (ARGB). */
export const STOCK_EXCEL_FILL = {
  header: "FFE5E7EB",
  problem: "FFFECACA",
  needsFix: "FFFEF3C7",
  ready: "FFDCFCE7",
  newPhone: "FFDBEAFE",
  help: "FFF3F4F6",
} as const;

// ---------------------------------------------------------------------------
// Rows (list facts only)
// ---------------------------------------------------------------------------

const GB = /^(\d+(?:\+\d+)?)\s*GB$/i;
/** RAM is written the way the list writes it ("8", "3+5"), which the parser reads back exactly. */
const ramCell = (ram: string | null) => (ram ? ram.trim().replace(GB, "$1") : "");
const priceCell = (priceMinor: number | null) => (priceMinor === null ? "" : String(priceMinor / 100));

/** Which cell a reason points at (for highlighting). */
function fieldsForReason(reason: string): StockExcelField[] {
  if (/colou?r/i.test(reason)) return ["colour"];
  if (/RAM/.test(reason) && !/storage/i.test(reason)) return ["ram"];
  if (/price/i.test(reason)) return ["price"];
  if (/brand/i.test(reason)) return ["brand"];
  if (/^Looks like |spelling|matches more than one phone|phone name|Model missing|phone you chose/i.test(reason)) return ["model"];
  return [];
}

/** Replaces exactly one whole word (case-insensitive) — the word the Owner's accepted spelling correction names. */
function correctWord(model: string, from: string, to: string): string {
  const words = model.split(/(\s+)/);
  const index = words.findIndex((word) => word.toLowerCase() === from.toLowerCase());
  if (index < 0) return model;
  const original = words[index];
  words[index] = original === original.toUpperCase() ? to.toUpperCase() : original[0] === original[0].toUpperCase() ? to[0].toUpperCase() + to.slice(1) : to;
  return words.join("");
}

const missingFields = (row: ParsedStockList["rows"][number]): Array<[StockExcelField, string]> => {
  const missing: Array<[StockExcelField, string]> = [];
  if (!row.brand) missing.push(["brand", "Brand is missing"]);
  if (!row.model) missing.push(["model", "Phone name is missing"]);
  if (!row.ram) missing.push(["ram", "RAM is missing"]);
  if (!row.storage) missing.push(["storage", "Storage is missing"]);
  if (!row.color) missing.push(["colour", "Colour is missing"]);
  if (row.priceMinor === null) missing.push(["price", "Price is missing"]);
  return missing;
};

/**
 * One sheet row per Android variant in the pasted list. Without a Check List (`delta` absent) only the list itself is
 * checked (parser reasons + missing fields). With a Check List, the comparison's reasons and the held reasons that name
 * this line are added, so the sheet says exactly what the page says. Non-Android lines go to the "Not included" list.
 */
export function buildStockExcelRows(
  parsed: ParsedStockList,
  options: { delta?: StockDelta | null; phonePlan?: PhonePlan | null; decisions?: readonly (RowDecision | undefined)[] } = {},
): { rows: StockExcelRow[]; excluded: StockExcelExcluded[] } {
  const { delta = null, phonePlan = null, decisions = [] } = options;
  const rows: StockExcelRow[] = [];
  const excluded: StockExcelExcluded[] = parsed.excluded.map((line) => ({ line: line.lineNumber, text: line.line, reason: line.reason }));
  const heldByKey = new Map((phonePlan?.held ?? []).map((item) => [item.key, item] as const));

  parsed.rows.forEach((row, index) => {
    const category = rowCategory(row);
    if (category !== "smartphone") {
      excluded.push({ line: row.lineNumber, text: row.sourceLine, reason: delta?.entries[index]?.reasons[0] ?? "Not an Android phone — not part of this update" });
      return;
    }
    const entry: DeltaEntry | undefined = delta?.entries[index];
    const problems: string[] = [];
    const fields = new Set<StockExcelField>();
    const add = (text: string, own: StockExcelField[] = fieldsForReason(text)) => {
      if (!problems.includes(text)) problems.push(text);
      for (const field of own) fields.add(field);
    };

    for (const [field, text] of missingFields(row)) add(text, [field]);
    const reasons = entry && entry.kind === "ambiguous" ? entry.reasons : row.reviewReasons;
    for (const reason of reasons) add(explainReason(reason), fieldsForReason(reason).length ? fieldsForReason(reason) : fieldsForReason(explainReason(reason)));

    // Held reasons from the per-phone plan that name this exact variant line (e.g. a new variant without a colour).
    if (entry && phonePlan) {
      const held = heldByKey.get(heldKeyOf(entry));
      const prefix = `New variant ${entry.label} (line ${row.lineNumber}): `;
      for (const reason of held?.reasons ?? []) if (reason.startsWith(prefix)) add(reason, missingFields(row).map(([field]) => field));
    }

    const status: StockExcelStatus = problems.length ? "Needs fix" : entry?.kind === "new_product" ? "New phone" : "Ready";
    // The Owner's decisions made on the page travel with the sheet: a confirmed spelling is written corrected
    // (only the one word the Owner accepted), and a confirmed new phone keeps "New phone? = Yes".
    const decision = decisions[index];
    const accepted = decision?.matchProductId && entry?.suggestion?.productId === decision.matchProductId ? entry.suggestion : null;
    const model = accepted && row.model ? correctWord(row.model, accepted.from, accepted.to) : row.model ?? "";
    rows.push({
      line: row.lineNumber,
      brand: row.brand ?? "",
      model,
      ram: ramCell(row.ram),
      storage: row.storage ?? "",
      colour: row.color ?? "",
      price: priceCell(row.priceMinor),
      newPhone: decision?.confirmNewPhone === true,
      status,
      problems,
      problemFields: [...fields],
    });
  });
  excluded.sort((a, b) => a.line - b.line);
  return { rows, excluded };
}

// ---------------------------------------------------------------------------
// Workbook (ExcelJS is passed in, like loadExcelJs() on the page)
// ---------------------------------------------------------------------------

type ExcelJsModule = { Workbook: new () => Workbook };

const fill = (cell: Cell, argb: string) => {
  cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb } };
};

const FIELD_COLUMN: Record<StockExcelField, StockExcelHeader> = { brand: "Brand", model: "Model", ram: "RAM", storage: "Storage", colour: "Colour", price: "Price" };
const column = (header: StockExcelHeader) => STOCK_EXCEL_HEADERS.indexOf(header) + 1;
const TEXT_COLUMNS: StockExcelHeader[] = ["Brand", "Model", "RAM", "Storage", "Colour", "Price", "New phone?"];

export function buildStockExcelWorkbook(ExcelJS: ExcelJsModule, data: { rows: StockExcelRow[]; excluded: StockExcelExcluded[] }): Workbook {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet(STOCK_SHEET);
  sheet.columns = STOCK_EXCEL_HEADERS.map((header) => ({
    header,
    key: header,
    width: header === "What to fix" ? 70 : header === "Model" ? 28 : header === "Line" ? 7 : header === "New phone?" ? 12 : 14,
  }));
  // Text cells: Excel must never turn "4/64", "3+5" or a model number into a date or a number.
  for (const header of TEXT_COLUMNS) sheet.getColumn(column(header)).numFmt = "@";
  const head = sheet.getRow(1);
  head.font = { bold: true };
  for (let index = 1; index <= STOCK_EXCEL_HEADERS.length; index += 1) fill(head.getCell(index), STOCK_EXCEL_FILL.header);
  sheet.views = [{ state: "frozen", ySplit: 1 }];
  head.getCell(column("New phone?")).note = 'Type "Yes" only if this line is a genuinely new phone that just looks like an existing one.';
  head.getCell(column("Status")).note = "Filled in for you. Changing it has no effect.";
  head.getCell(column("What to fix")).note = "Filled in for you. Fix the red cells, then upload this file again.";

  for (const row of data.rows) {
    const added = sheet.addRow({
      Line: row.line,
      Brand: row.brand,
      Model: row.model,
      RAM: row.ram,
      Storage: row.storage,
      Colour: row.colour,
      Price: row.price,
      "New phone?": row.newPhone ? "Yes" : "",
      Status: row.status,
      "What to fix": row.problems.join(" · "),
    });
    for (const field of row.problemFields) fill(added.getCell(column(FIELD_COLUMN[field])), STOCK_EXCEL_FILL.problem);
    fill(added.getCell(column("Status")), row.status === "Needs fix" ? STOCK_EXCEL_FILL.needsFix : row.status === "New phone" ? STOCK_EXCEL_FILL.newPhone : STOCK_EXCEL_FILL.ready);
    for (const header of ["Line", "What to fix"] as const) fill(added.getCell(column(header)), STOCK_EXCEL_FILL.help);
    added.getCell(column("What to fix")).alignment = { wrapText: true, vertical: "top" };
  }
  const last = Math.max(2, data.rows.length + 1);
  (sheet as Worksheet & { dataValidations: { add(range: string, validation: object): void } }).dataValidations.add(`H2:H${last + 200}`, {
    type: "list",
    allowBlank: true,
    formulae: ['"Yes"'],
  });

  const other = workbook.addWorksheet(EXCLUDED_SHEET);
  other.columns = [
    { header: "Line", key: "line", width: 7 },
    { header: "Text in the list", key: "text", width: 50 },
    { header: "Why it is not included", key: "reason", width: 60 },
  ];
  other.getRow(1).font = { bold: true };
  for (const item of data.excluded) other.addRow(item);
  return workbook;
}

/** Reads a worksheet into rows of cell texts (same reading as the page's file upload: one string per cell). */
export function tableFromWorksheet(sheet: Worksheet): string[][] {
  const table: string[][] = [];
  sheet.eachRow({ includeEmpty: false }, (row) => {
    const cells: string[] = [];
    row.eachCell({ includeEmpty: true }, (cell, columnNumber) => {
      cells[columnNumber - 1] = cell.text ?? "";
    });
    table.push(Array.from(cells, (cell) => cell ?? ""));
  });
  return table;
}

// ---------------------------------------------------------------------------
// Reading a corrected sheet back
// ---------------------------------------------------------------------------

export type StockExcelRead = {
  /** The list text for the existing parser (same lines tableToStockText would write). */
  text: string;
  /** Text line number -> spreadsheet row number, for messages and decisions. */
  sheetRowOfLine: Map<number, number>;
  /** Text lines whose sheet row says "New phone? = Yes". */
  newPhoneLines: Set<number>;
  /** Problems that stop the upload (nothing is guessed). Empty when the sheet can be used. */
  errors: string[];
  /** Sheet rows read (non-empty data rows). */
  rowCount: number;
};

const norm = (value: string) => value.trim().toLowerCase().replace(/[^a-z0-9?]+/g, " ").trim();
const HEADER_ALIASES: Record<"brand" | "model" | "ram" | "storage" | "colour" | "price" | "newPhone", string[]> = {
  brand: ["brand"],
  model: ["model", "model product title", "product", "title", "name"],
  ram: ["ram"],
  storage: ["storage", "rom"],
  colour: ["colour", "color", "colors", "colours"],
  price: ["price", "rate", "pkr"],
  newPhone: ["new phone?", "new phone"],
};

/**
 * Turns the Owner's corrected sheet (rows of cell texts, header first) into list text for the existing parser.
 * Refuses (errors) instead of guessing: missing Brand / Model / Price columns, a data row without a brand or model,
 * or a "New phone?" value other than Yes / blank. The Line / Status / What to fix columns are ignored.
 */
export function readStockExcel(table: string[][]): StockExcelRead {
  const errors: string[] = [];
  const rows = table.map((cells) => cells.map((cell) => String(cell ?? "").trim()));
  const headerIndex = rows.findIndex((cells) => cells.some(Boolean));
  const empty: StockExcelRead = { text: "", sheetRowOfLine: new Map(), newPhoneLines: new Set(), errors, rowCount: 0 };
  if (headerIndex < 0) {
    errors.push("The sheet is empty.");
    return empty;
  }
  const header = rows[headerIndex].map(norm);
  const find = (key: keyof typeof HEADER_ALIASES) => header.findIndex((cell) => HEADER_ALIASES[key].includes(cell));
  const at = { brand: find("brand"), model: find("model"), ram: find("ram"), storage: find("storage"), colour: find("colour"), price: find("price"), newPhone: find("newPhone") };
  for (const [key, label] of [["brand", "Brand"], ["model", "Model"], ["price", "Price"]] as const) if (at[key] < 0) errors.push(`The sheet has no "${label}" column.`);
  if (errors.length) return empty;

  const lines: string[] = [];
  const sheetRowOfLine = new Map<number, number>();
  const newPhoneLines = new Set<number>();
  let currentBrand = "";
  let rowCount = 0;
  rows.slice(headerIndex + 1).forEach((cells, offset) => {
    const sheetRow = headerIndex + offset + 2;
    const value = (index: number) => (index >= 0 ? cells[index] ?? "" : "");
    const facts = [at.brand, at.model, at.ram, at.storage, at.colour, at.price].map(value);
    if (!facts.some(Boolean)) return;
    rowCount += 1;
    const [brand, model, ram, storage, colour, price] = facts;
    if (!brand) errors.push(`Row ${sheetRow}: Brand is empty — type the brand (it is never copied from the row above).`);
    if (!model) errors.push(`Row ${sheetRow}: Model is empty.`);
    const flag = norm(value(at.newPhone));
    if (flag && flag !== "yes") errors.push(`Row ${sheetRow}: "New phone?" must be Yes or empty (found "${value(at.newPhone)}").`);
    if (!brand || !model) return;
    if (brand !== currentBrand) {
      currentBrand = brand;
      lines.push("", brand);
    }
    const capacity = [ram, storage].filter(Boolean).join("/");
    const colours = colour.replace(/[,;]\s*/g, "/");
    lines.push([model, capacity, colours, `@ ${price}`].filter(Boolean).join(" "));
    const lineNumber = lines.length; // 1-based line number of the line just written
    sheetRowOfLine.set(lineNumber, sheetRow);
    if (flag === "yes") newPhoneLines.add(lineNumber);
  });
  if (!rowCount) errors.push("The sheet has no phone rows.");
  return { text: lines.join("\n"), sheetRowOfLine, newPhoneLines, errors, rowCount };
}

/** True for a sheet made by this tool (it has the "New phone?" or "What to fix" column); other sheets use the old upload. */
export function isStockExcelTable(table: string[][]): boolean {
  const header = table.find((cells) => cells.some((cell) => String(cell ?? "").trim()))?.map((cell) => norm(String(cell ?? ""))) ?? [];
  return header.includes("new phone?") || header.includes("what to fix");
}

/**
 * "New phone? = Yes" as the page's saved fixes (the existing confirm-new-phone decision): one fix per marked line, so it
 * is autosaved with the list, shown under "Your fixes" (with Undo) and survives a reload, like a fix made with the button.
 */
export function newPhoneResolutions(parsed: ParsedStockList, newPhoneLines: ReadonlySet<number>, now: Date = new Date()): Record<string, ResolutionRecord> {
  const keys = buildRowKeys(parsed.rows);
  const fixes: Record<string, ResolutionRecord> = {};
  const done = new Set<number>();
  parsed.rows.forEach((row, index) => {
    if (!newPhoneLines.has(row.lineNumber) || done.has(row.lineNumber)) return;
    done.add(row.lineNumber);
    const label = [row.productTitle ?? [row.brand, row.model].filter(Boolean).join(" "), "new phone"].filter(Boolean).join(" · ");
    fixes[keys[index]] = { rowKey: keys[index], resolution: { type: "confirm_new_phone" }, sourceLine: row.sourceLine, label, decidedAt: now.toISOString() };
  });
  return fixes;
}

/**
 * The Owner's "New phone? = Yes" as the existing confirm-new-phone decision, aligned with the parsed rows
 * (pass it to buildStockDelta as `decisions`). Rows from other lines get no decision.
 */
export function newPhoneDecisions(parsed: ParsedStockList, newPhoneLines: ReadonlySet<number>): (RowDecision | undefined)[] {
  return parsed.rows.map((row) => (newPhoneLines.has(row.lineNumber) ? { confirmNewPhone: true } : undefined));
}
