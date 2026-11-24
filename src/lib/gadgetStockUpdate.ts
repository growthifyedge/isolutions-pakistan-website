/**
 * Gadgets Stock Update: Paste List -> Generate Excel -> (Owner fills Description) -> Upload Excel -> Check Changes -> Update Website.
 * Pure logic only (no database, no browser): parsing, Excel sheet layout, reading the sheet back, matching and the plan.
 *
 * Owner rules (approved 2026-10-25):
 *   * Gadgets category only. Names are kept exactly as written; matching ignores case and extra spaces only.
 *   * Description is the Owner's own text, saved unchanged in products.content. A blank Description keeps what is saved.
 *   * New product -> draft, one variant, opening stock 20. Facts the list does not give stay unset
 *     (PTA / condition "unknown", warranty and colour blank). Delivery is the locked gadget rule: nationwide.
 *   * Existing product with exactly one variant (visible): the list price and a nonblank description. Stock is never changed.
 *   * Duplicates, names used by more than one product or by another category, web-address clashes, products with more
 *     than one variant (or a hidden one) are held in Needs Review. Products missing from the sheet are never touched.
 *   * Nothing is hidden, deleted or published here.
 */
import type { Workbook, Worksheet } from "exceljs";
import { catalogSlug } from "./catalogSheet.ts";
import type { CatalogDeltaProduct } from "./stockListDelta.ts";

export const GADGET_CATEGORY_SLUG = "gadgets";
export const GADGET_NEW_PRODUCT_STOCK = 20;
export const GADGET_DELIVERY_SCOPE = "nationwide";
export const GADGET_SHEET = "Gadgets";
export const GADGET_EXCEL_HEADERS = ["Product Name", "Price", "Description"] as const;
/** A description longer than this is held for review (a pasted page by mistake, not a product description). */
export const GADGET_DESCRIPTION_MAX = 10000;

/** Matching key: case and extra spaces are ignored, nothing else (punctuation and digits are part of the name). */
export const gadgetNameKey = (value: string) => value.trim().replace(/\s+/g, " ").toLowerCase();

/** The Owner's text with Windows / old Mac line endings made plain and the outer blank space removed. Nothing else changes. */
export const cleanDescription = (value: string | null | undefined) => {
  const text = (value ?? "").replace(/\r\n?/g, "\n").trim();
  return text ? text : null;
};

const rupeesToMinor = (digits: string) => {
  const plain = digits.replace(/,/g, "");
  if (!/^\d+$/.test(plain)) return null;
  const rupees = Number(plain);
  return Number.isSafeInteger(rupees) && rupees > 0 ? rupees * 100 : null;
};

// ---------------------------------------------------------------------------
// 1. Paste List
// ---------------------------------------------------------------------------

export type GadgetListLine = { lineNumber: number; name: string; priceMinor: number };
export type GadgetUnreadLine = { lineNumber: number; line: string; reason: string };
export type ParsedGadgetList = { lines: GadgetListLine[]; unread: GadgetUnreadLine[] };

export const NO_PRICE_REASON = "No price found. Put the price on the next line (Rs 4,500) or on the same line (Product Name - Rs 4,500).";
export const ORPHAN_PRICE_REASON = "Price without a product name before it.";
export const BARE_NUMBER_REASON = "A price on its own line needs Rs or PKR (e.g. Rs 4,500); this number was not used.";
const INVALID_PRICE_REASON = "The price is not a valid amount in rupees.";

/** A line that is only a price: "Rs 750", "Rs. 1,200/-", "PKR 450" (optionally after "Price:"). Rs or PKR is required. */
const PRICE_ONLY = /^(?:price\s*[:=-]?\s*)?(?:rs\.?|pkr)\s*(\d[\d,]*)(?:\.0+)?\s*(?:\/-)?$/i;

type SameLine = { kind: "product"; name: string; priceMinor: number } | { kind: "malformed"; reason: string } | { kind: "name" };

/**
 * Same-line format: the name, then the price at the end after "@", "=", ":", " - ", "Rs"/"PKR" or a tab (pasted
 * from Excel). A number at the end without one of these is NOT a price (it may be part of the name, e.g.
 * "Power Bank 10000" or "Mini Fan Y05"), so the line is treated as a name only.
 */
function readSameLine(raw: string): SameLine {
  const tail = raw.replace(/\s*\/-\s*$/, "").match(/^(.*?)(\d[\d,]*)(?:\.0+)?\s*$/);
  if (!tail) return { kind: "name" };
  let marked = /\t\s*$/.test(tail[1]);
  let rest = tail[1].trimEnd();
  const currency = rest.match(/(?:^|[^a-z0-9])(rs\.?|pkr)$/i);
  if (currency) {
    marked = true;
    rest = rest.slice(0, rest.length - currency[1].length).trimEnd();
  }
  const separator = rest.match(/(?:[@=:]|\s[-–])$/);
  if (separator) {
    marked = true;
    rest = rest.slice(0, rest.length - separator[0].length);
  }
  if (!marked) return { kind: "name" };
  const name = rest.trim();
  const priceMinor = rupeesToMinor(tail[2]);
  if (!name) return { kind: "malformed", reason: "No product name before the price." };
  if (priceMinor === null) return { kind: "malformed", reason: INVALID_PRICE_REASON };
  return { kind: "product", name, priceMinor };
}

/**
 * Two formats, mixed freely; blank lines are ignored:
 *   A. separate lines — "Mini Fan Y05" then "Rs 750" (the price line must say Rs or PKR);
 *   B. same line      — "Mini Fan Y05 - Rs 750".
 * A name is paired only with the price line right after it (blank lines between are fine). Nothing is guessed: a name
 * followed by another name, a same-line product or a malformed line, a name at the end, a price with no name before
 * it, and a bare number are all listed as not understood. Names are kept exactly as written.
 */
export function parseGadgetList(text: string): ParsedGadgetList {
  const lines: GadgetListLine[] = [];
  const unread: GadgetUnreadLine[] = [];
  let pending: { lineNumber: number; line: string } | null = null;
  const flushPending = () => {
    if (pending) unread.push({ ...pending, reason: NO_PRICE_REASON });
    pending = null;
  };
  text.replace(/\r\n?/g, "\n").split("\n").forEach((raw, index) => {
    const lineNumber = index + 1;
    const line = raw.trim();
    if (!line) return;
    if (/^product\s*name\b/i.test(line) && /\bprice\b/i.test(line)) return; // header pasted with the list
    const priceOnly = line.match(PRICE_ONLY);
    if (priceOnly) {
      const priceMinor = rupeesToMinor(priceOnly[1]);
      if (!pending) unread.push({ lineNumber, line, reason: ORPHAN_PRICE_REASON });
      else if (priceMinor === null) {
        unread.push({ lineNumber, line, reason: INVALID_PRICE_REASON });
        flushPending();
      } else {
        lines.push({ lineNumber: pending.lineNumber, name: pending.line, priceMinor });
        pending = null;
      }
      return;
    }
    if (/^\d[\d,]*(?:\.\d+)?\s*(?:\/-)?$/.test(line)) {
      flushPending();
      unread.push({ lineNumber, line, reason: BARE_NUMBER_REASON });
      return;
    }
    const same = readSameLine(raw);
    if (same.kind === "name") {
      flushPending();
      pending = { lineNumber, line };
      return;
    }
    flushPending();
    if (same.kind === "malformed") unread.push({ lineNumber, line, reason: same.reason });
    else lines.push({ lineNumber, name: same.name, priceMinor: same.priceMinor });
  });
  flushPending();
  unread.sort((a, b) => a.lineNumber - b.lineNumber);
  return { lines, unread };
}

// ---------------------------------------------------------------------------
// 2. Generate Excel / 4. Upload Excel
// ---------------------------------------------------------------------------

type ExcelJsModule = { Workbook: new () => Workbook };

/** The sheet the Owner fills: Product Name (as written), Price (rupees), Description (blank). */
export function buildGadgetWorkbook(ExcelJS: ExcelJsModule, lines: readonly GadgetListLine[]): Workbook {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet(GADGET_SHEET, { views: [{ state: "frozen", ySplit: 1 }] });
  sheet.columns = [
    { header: GADGET_EXCEL_HEADERS[0], key: "name", width: 44 },
    { header: GADGET_EXCEL_HEADERS[1], key: "price", width: 14 },
    { header: GADGET_EXCEL_HEADERS[2], key: "description", width: 80 },
  ];
  sheet.getRow(1).font = { bold: true };
  for (const line of lines) {
    const row = sheet.addRow({ name: line.name, price: line.priceMinor / 100, description: "" });
    row.getCell(1).numFmt = "@";
    row.getCell(2).numFmt = "#,##0";
  }
  sheet.getColumn(3).alignment = { wrapText: true, vertical: "top" };
  const help = workbook.addWorksheet("How to fill");
  help.getColumn(1).width = 110;
  [
    "Write each product's Description in column C of the Gadgets sheet, in your own words (colour, material, size, features).",
    "Use Alt+Enter for a new line inside a cell. Leave a blank line between paragraphs.",
    "A blank Description keeps the description that is already on the website.",
    "Do not change the column headings. You may change a price. Then upload this file on the Gadgets Stock Update page.",
  ].forEach((text) => help.addRow([text]));
  // Ready-to-use ChatGPT prompt (2026-11-24): upload this file to ChatGPT and it fills the blank Descriptions.
  // Added AFTER the Gadgets sheet: the upload reads the first sheet only, so import is unchanged.
  const gpt = workbook.addWorksheet(GADGET_GPT_SHEET);
  gpt.getColumn(1).width = 120;
  GADGET_GPT_PROMPT.forEach((text, index) => {
    const row = gpt.addRow([text]);
    row.getCell(1).alignment = { wrapText: true, vertical: "top" };
    if (index === 0 || /^[A-Z][^.]*:$/.test(text)) row.font = { bold: true };
  });
  return workbook;
}

export const GADGET_GPT_SHEET = "GPT Instructions";
/** One prompt line per row. Lines ending in ":" are section headings. */
export const GADGET_GPT_PROMPT: readonly string[] = [
  "TASK FOR CHATGPT — complete this Excel file and return it. Do not ask questions; follow these rules exactly.",
  "",
  "Goal:",
  "Fill every BLANK cell in column C (Description) of the \"Gadgets\" sheet with an accurate, professional, customer-friendly product description for the product named in column A of the same row.",
  "",
  "Research rules:",
  "1. Research each product (column A, exactly as written) using reliable sources: the manufacturer's official website or product page first, then well-known retailers and trusted review sites.",
  "2. Use only facts confirmed for that exact product (same brand, model and variant). Never invent or guess features, specifications, materials, sizes, capacities, compatibility, certifications or claims.",
  "3. If a detail cannot be confirmed, leave it out. If the product itself cannot be identified reliably, leave its Description cell blank.",
  "4. For an unbranded or generic product, describe only what the product name clearly states and the product's basic, commonly known use — no specific numbers or claims you cannot confirm.",
  "",
  "Writing rules:",
  "5. English, plain text only: no HTML, Markdown, emojis, links or hashtags.",
  "6. Structure: one short opening paragraph (2–3 sentences) saying what the product is and who it is for, then a blank line, then up to 6 key features, one per line, each starting with \"• \".",
  "7. Professional, friendly and clear. No exaggeration (no \"best\", \"No. 1\", \"100% guaranteed\"), no comparisons with other brands or shops.",
  "8. Do not mention price, discounts, stock, delivery, warranty, the seller or any shop name.",
  "9. Keep each description under 1,200 characters. Use line breaks inside the cell (not new rows).",
  "",
  "Excel rules (the file is imported automatically — any structure change makes the import fail):",
  "10. Only write into blank cells of column C on the \"Gadgets\" sheet. Never change a Description that already has text.",
  "11. Do not change column A (Product Name) or column B (Price) in any row, not even spelling, spacing or number format.",
  "12. Keep row 1 headings exactly: Product Name | Price | Description. Do not add, remove, rename, reorder or merge columns, rows or sheets.",
  "13. Keep \"Gadgets\" as the FIRST sheet. Keep the \"How to fill\" and \"GPT Instructions\" sheets as they are.",
  "14. Do not add notes, comments, colours, formulas or extra text anywhere in the file.",
  "",
  "Final output:",
  "15. Return the completed file as a downloadable .xlsx with the same file name, ready to upload on the Gadgets Stock Update page.",
  "16. In your chat reply (not in the file), list only the products you left blank and why, in one short line each. Nothing else is needed.",
];

/** Reads a worksheet into rows of cell texts (one string per cell; line breaks inside a cell are kept). */
export function gadgetTableFromWorksheet(sheet: Worksheet): string[][] {
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

export type GadgetSheetRow = {
  rowNumber: number;
  /** Exactly as written in the sheet (outer spaces removed). */
  name: string;
  priceText: string;
  priceMinor: number | null;
  /** null = blank = keep the saved description. */
  description: string | null;
};

export type GadgetSheetRead = { ok: true; rows: GadgetSheetRow[] } | { ok: false; error: string };

/**
 * 4. Upload Excel: the FIRST sheet, validated by readGadgetSheet. ExcelJS reads the file as before; a valid workbook ExcelJS
 * cannot open (ChatGPT saves with "x:"-prefixed XML: "Cannot read properties of undefined (reading 'sheets')") is read
 * with the same minimal cell-text reader the Single Product Spec Upload uses. Same sheet rule, same validation.
 */
export async function readGadgetFile(ExcelJS: ExcelJsModule, bytes: ArrayBuffer | Uint8Array): Promise<GadgetSheetRead> {
  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(bytes as ArrayBuffer);
  } catch {
    try {
      const { readXlsxTables } = await import("./xlsxTableReader.ts");
      const first = (await readXlsxTables(bytes))[0];
      if (!first) return { ok: false, error: "The workbook has no sheets." };
      return readGadgetSheet(first.rows);
    } catch {
      return { ok: false, error: "The file could not be read as an .xlsx workbook." };
    }
  }
  const sheet = workbook.worksheets[0];
  if (!sheet) return { ok: false, error: "The workbook has no sheets." };
  return readGadgetSheet(gadgetTableFromWorksheet(sheet));
}

export function readGadgetSheet(table: string[][]): GadgetSheetRead {
  const header = (table[0] ?? []).map((cell) => cell.trim().toLowerCase());
  const expected = GADGET_EXCEL_HEADERS.map((name) => name.toLowerCase());
  if (expected.some((name, index) => header[index] !== name))
    return { ok: false, error: `This is not the Gadgets Excel. Row 1 must be: ${GADGET_EXCEL_HEADERS.join(" | ")}. Use Generate Excel to make it.` };
  const rows: GadgetSheetRow[] = [];
  table.slice(1).forEach((cells, index) => {
    const name = (cells[0] ?? "").trim();
    const priceText = (cells[1] ?? "").trim();
    const description = cleanDescription(cells[2]);
    if (!name && !priceText && !description) return;
    const plainPrice = priceText.replace(/^(?:rs\.?|pkr)\s*/i, "").replace(/\s*\/-$/, "").replace(/\.0+$/, "");
    rows.push({ rowNumber: index + 2, name, priceText, priceMinor: rupeesToMinor(plainPrice), description });
  });
  if (!rows.length) return { ok: false, error: "The Gadgets sheet has no products." };
  return { ok: true, rows };
}

/** Same sheet = same check. Any change to a name, price or description needs Check Changes again. */
export const gadgetSheetFingerprint = (rows: readonly GadgetSheetRow[]) =>
  JSON.stringify(rows.map((row) => [row.rowNumber, row.name, row.priceMinor, row.description]));

// ---------------------------------------------------------------------------
// 5. Check Changes
// ---------------------------------------------------------------------------

export type GadgetCatalogProduct = CatalogDeltaProduct & { content: string | null };
/** Every product's web address (all data classes): a new product's address must be free. */
export type SlugOwner = { slug: string; title: string };

export type GadgetEntryKind = "new_product" | "update" | "same" | "review";

export type GadgetEntry = {
  id: string;
  kind: GadgetEntryKind;
  row: GadgetSheetRow;
  productId: string | null;
  productTitle: string;
  slug: string | null;
  variantId: string | null;
  sku: string | null;
  stock: number | null;
  currentPriceMinor: number | null;
  currentDescription: string | null;
  priceChange: { fromMinor: number; toMinor: number } | null;
  descriptionChange: { from: string | null; to: string } | null;
  reasons: string[];
  notes: string[];
};

export type GadgetComparison = {
  entries: GadgetEntry[];
  counts: { newProducts: number; priceUpdates: number; descriptionUpdates: number; review: number; same: number };
};

export function compareGadgetSheet(rows: readonly GadgetSheetRow[], catalog: readonly GadgetCatalogProduct[], slugOwners: readonly SlugOwner[]): GadgetComparison {
  const byKey = new Map<string, GadgetCatalogProduct[]>();
  for (const product of catalog) {
    const key = gadgetNameKey(product.title);
    byKey.set(key, [...(byKey.get(key) ?? []), product]);
  }
  const slugOwner = new Map(slugOwners.map((owner) => [owner.slug, owner] as const));
  const listed = new Map<string, number[]>();
  for (const row of rows) if (row.name) listed.set(gadgetNameKey(row.name), [...(listed.get(gadgetNameKey(row.name)) ?? []), row.rowNumber]);
  const newSlugs = new Map<string, number[]>();
  for (const row of rows) {
    const slug = row.name ? catalogSlug(row.name) : "";
    if (slug && !(byKey.get(gadgetNameKey(row.name)) ?? []).length) newSlugs.set(slug, [...(newSlugs.get(slug) ?? []), row.rowNumber]);
  }

  const entries = rows.map((row): GadgetEntry => {
    const entry: GadgetEntry = {
      id: `row:${row.rowNumber}`, kind: "review", row, productId: null, productTitle: row.name, slug: null, variantId: null, sku: null, stock: null,
      currentPriceMinor: null, currentDescription: null, priceChange: null, descriptionChange: null, reasons: [], notes: [],
    };
    const review = (reason: string) => {
      entry.reasons.push(reason);
      return entry;
    };
    if (!row.name) return review("Product Name is blank.");
    if (row.priceMinor === null) return review(row.priceText ? `Price "${row.priceText}" is not a valid amount in rupees.` : "Price is blank.");
    if (row.description && row.description.length > GADGET_DESCRIPTION_MAX) return review(`Description is longer than ${GADGET_DESCRIPTION_MAX.toLocaleString("en-PK")} characters.`);
    const sameName = listed.get(gadgetNameKey(row.name)) ?? [];
    if (sameName.length > 1) return review(`This name is in the sheet more than once (rows ${sameName.join(", ")}). Keep one row.`);

    const matches = byKey.get(gadgetNameKey(row.name)) ?? [];
    if (matches.length > 1)
      return review(`${matches.length} products on the website have this name (${matches.map((product) => `${product.title} — ${product.category ?? "no category"}`).join("; ")}). Fix it in Catalog first.`);
    const product = matches[0];
    if (product) {
      entry.productId = product.id;
      entry.productTitle = product.title;
      entry.slug = product.slug;
      entry.currentDescription = cleanDescription(product.content);
      if (product.categorySlug !== GADGET_CATEGORY_SLUG) return review(`This name belongs to "${product.title}" in ${product.category ?? "another category"}. Only Gadgets are changed here.`);
      if (product.variants.length !== 1) return review(`This gadget has ${product.variants.length} variants on the website. Only gadgets with one variant are updated here; change it in Catalog.`);
      const variant = product.variants[0];
      entry.variantId = variant.id;
      entry.sku = variant.sku;
      entry.stock = variant.stock;
      entry.currentPriceMinor = variant.priceMinor;
      if (!variant.isActive) return review(`Its variant ${variant.sku} is hidden on the website. Show it in Catalog first; nothing is shown again from here.`);
      if (product.title !== row.name) entry.notes.push(`Matched "${product.title}" (the website name is kept).`);
      if (variant.priceMinor !== row.priceMinor) entry.priceChange = { fromMinor: variant.priceMinor, toMinor: row.priceMinor };
      if (row.description && row.description !== entry.currentDescription) entry.descriptionChange = { from: entry.currentDescription, to: row.description };
      if (!row.description) entry.notes.push(entry.currentDescription ? "Description is blank: the saved description is kept." : "Description is blank: nothing is saved.");
      entry.kind = entry.priceChange || entry.descriptionChange ? "update" : "same";
      return entry;
    }

    const slug = catalogSlug(row.name);
    entry.slug = slug || null;
    if (!slug) return review("The name has no letters or digits, so it cannot get a web address.");
    const owner = slugOwner.get(slug);
    if (owner) return review(`The web address "${slug}" is already used by "${owner.title}". Use a different name or fix it in Catalog.`);
    const clash = newSlugs.get(slug) ?? [];
    if (clash.length > 1) return review(`Rows ${clash.join(", ")} would get the same web address "${slug}". Keep one of them.`);
    entry.kind = "new_product";
    entry.notes.push(`New draft, stock ${GADGET_NEW_PRODUCT_STOCK}.`, row.description ? "Description from the sheet." : "No description yet.");
    return entry;
  });

  return {
    entries,
    counts: {
      newProducts: entries.filter((entry) => entry.kind === "new_product").length,
      priceUpdates: entries.filter((entry) => entry.kind === "update" && entry.priceChange).length,
      descriptionUpdates: entries.filter((entry) => entry.kind === "update" && entry.descriptionChange).length,
      review: entries.filter((entry) => entry.kind === "review").length,
      same: entries.filter((entry) => entry.kind === "same").length,
    },
  };
}

// ---------------------------------------------------------------------------
// 6. Update Website — the plan (what each database call will receive)
// ---------------------------------------------------------------------------

/** apply_catalog_bulk_import_v2, ONE product, action Create only. Unset facts go as null (the server stores "unknown"/blank). */
export type GadgetCreatePayload = {
  source: string;
  action: "Create";
  product_type: "Gadget";
  title: string;
  variants: {
    source: string;
    ram: null;
    storage: null;
    color: null;
    price_minor: number;
    stock: typeof GADGET_NEW_PRODUCT_STOCK;
    pta_status: null;
    condition: null;
    condition_grade: null;
    battery_health_percent: null;
    battery_cycle_count: null;
    sim_configuration: null;
    warranty: null;
    delivery_scope: typeof GADGET_DELIVERY_SCOPE;
  }[];
};

/**
 * apply_gadget_stock_product (migration 202610260001, not applied yet): ONE gadget, all or nothing.
 * "expected" is what Check Changes saw; the server refuses the call if anything differs.
 */
export type GadgetRpcPayload = {
  product_id: string;
  expected: { title: string; content: string | null; variant: { id: string; price_minor: number; is_active: true } };
  steps: { price?: { from_minor: number; to_minor: number }; content?: { to: string } };
};

export type GadgetPlanItem =
  | { kind: "existing"; key: string; productId: string; productTitle: string; entry: GadgetEntry; payload: GadgetRpcPayload }
  | { kind: "new"; key: string; productId: null; productTitle: string; entry: GadgetEntry; payload: GadgetCreatePayload; description: string | null };

export type GadgetPlan = {
  items: GadgetPlanItem[];
  held: GadgetEntry[];
  counts: { newProducts: number; priceUpdates: number; descriptionUpdates: number; held: number; same: number };
};

export function buildGadgetPlan(comparison: GadgetComparison): GadgetPlan {
  const items: GadgetPlanItem[] = [];
  for (const entry of comparison.entries) {
    if (entry.kind === "update" && entry.productId && entry.variantId && entry.currentPriceMinor !== null) {
      const steps: GadgetRpcPayload["steps"] = {};
      if (entry.priceChange) steps.price = { from_minor: entry.priceChange.fromMinor, to_minor: entry.priceChange.toMinor };
      if (entry.descriptionChange) steps.content = { to: entry.descriptionChange.to };
      items.push({
        kind: "existing", key: entry.id, productId: entry.productId, productTitle: entry.productTitle, entry,
        payload: { product_id: entry.productId, expected: { title: entry.productTitle, content: entry.currentDescription, variant: { id: entry.variantId, price_minor: entry.currentPriceMinor, is_active: true } }, steps },
      });
    } else if (entry.kind === "new_product" && entry.row.priceMinor !== null) {
      const source = `Row ${entry.row.rowNumber}`;
      items.push({
        kind: "new", key: entry.id, productId: null, productTitle: entry.row.name, entry, description: entry.row.description,
        payload: {
          source, action: "Create", product_type: "Gadget", title: entry.row.name,
          variants: [{
            source, ram: null, storage: null, color: null, price_minor: entry.row.priceMinor, stock: GADGET_NEW_PRODUCT_STOCK,
            pta_status: null, condition: null, condition_grade: null, battery_health_percent: null, battery_cycle_count: null,
            sim_configuration: null, warranty: null, delivery_scope: GADGET_DELIVERY_SCOPE,
          }],
        },
      });
    }
  }
  return {
    items,
    held: comparison.entries.filter((entry) => entry.kind === "review"),
    counts: { ...comparison.counts, held: comparison.counts.review },
  };
}
