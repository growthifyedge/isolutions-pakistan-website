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

export const NO_PRICE_REASON = "No price found. Write it as: Product Name @ 4,500 (or Rs 4,500, or a tab before the price).";

/**
 * One product per line: the name, then the price at the end after "@", "=", ":", " - ", "Rs"/"PKR" or a tab
 * (pasted from Excel). A number at the end without one of these is NOT read as a price (it may be part of the name,
 * e.g. "Power Bank 10000"), so the line is listed as not understood instead of guessed.
 */
export function parseGadgetList(text: string): ParsedGadgetList {
  const lines: GadgetListLine[] = [];
  const unread: GadgetUnreadLine[] = [];
  text.replace(/\r\n?/g, "\n").split("\n").forEach((raw, index) => {
    const lineNumber = index + 1;
    const line = raw.trim();
    if (!line) return;
    if (/^product\s*name\b/i.test(line) && /\bprice\b/i.test(line)) return; // header pasted with the list
    const tail = raw.replace(/\s*\/-\s*$/, "").match(/^(.*?)(\d[\d,]*)(?:\.0+)?\s*$/);
    if (!tail) {
      unread.push({ lineNumber, line, reason: NO_PRICE_REASON });
      return;
    }
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
    const name = rest.trim();
    const priceMinor = rupeesToMinor(tail[2]);
    if (!marked) unread.push({ lineNumber, line, reason: NO_PRICE_REASON });
    else if (!name) unread.push({ lineNumber, line, reason: "No product name before the price." });
    else if (priceMinor === null) unread.push({ lineNumber, line, reason: "The price is not a valid amount in rupees." });
    else lines.push({ lineNumber, name, priceMinor });
  });
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
  return workbook;
}

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
