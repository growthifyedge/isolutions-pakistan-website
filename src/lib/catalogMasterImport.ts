// Prepare Import Workbook: turns a supplier/master catalog workbook into an upload-ready
// Bulk Upload v2 workbook. Every row goes through the importer's own row parser
// (catalogRowFromRecord) and cross-row checks (validateCatalogSheet), the workbook is written
// by the Download Template builder, and the result is read back with readCatalogWorkbook
// before it can be downloaded. Nothing here talks to the database.
import type { Worksheet } from "exceljs";
import {
  PRODUCT_HEADERS,
  PRODUCT_TYPE_CATEGORY,
  buildCatalogImportWorkbook,
  catalogRowFromRecord,
  loadExcelJs,
  readCell,
  validateCatalogSheet,
  validateGeneratedCatalogWorkbook,
  type CatalogReference,
  type CellInput,
  type GeneratedWorkbookValidation,
} from "./catalogWorkbook.ts";
import {
  canonicalModel,
  catalogSlug,
  catalogVariantKey,
  physicalRamFromExtended,
  type CatalogAction,
  type CatalogProductType,
  type CatalogSheetRow,
} from "./catalogSheet.ts";
import { normalizeXlsxForReading } from "./xlsxCompatibility.ts";

type ProductHeader = (typeof PRODUCT_HEADERS)[number];

/** Master columns that carry catalog data (named after the import template headers). */
export type MasterField = Exclude<ProductHeader, "Action" | "Product Type" | "SKU" | "Slug">;

const collapse = (value: string) => value.trim().replace(/\s+/g, " ");
const lower = (value: string) => collapse(value).toLowerCase();
/** Header comparison key: case, spacing and punctuation ("Price (PKR)", "stock_qty") do not matter. */
const headerKey = (value: string) => lower(value.replace(/[_\-./()]+/g, " "));

const MASTER_HEADER_ALIASES: Record<string, MasterField> = {
  brand: "Brand",
  model: "Model / Product Title",
  "product title": "Model / Product Title",
  "model product title": "Model / Product Title",
  "model name": "Model / Product Title",
  ram: "RAM",
  storage: "Storage",
  rom: "Storage",
  color: "Color",
  colour: "Color",
  price: "Price",
  "price pkr": "Price",
  "pkr price": "Price",
  "price rs": "Price",
  stock: "Stock",
  "stock qty": "Stock",
  "stock quantity": "Stock",
  qty: "Stock",
  quantity: "Stock",
  warranty: "Warranty",
  category: "Category",
  pta: "PTA Status",
  "pta status": "PTA Status",
  condition: "Condition",
  "battery health": "Battery Health",
  "cycle count": "Cycle Count",
  "battery cycle count": "Cycle Count",
  sim: "SIM Configuration",
  "sim configuration": "SIM Configuration",
  "compare at price": "Compare-at Price",
  "compare at price pkr": "Compare-at Price",
  delivery: "Delivery Scope",
  "delivery scope": "Delivery Scope",
  notes: "Notes",
};
/** Recognised master columns that are deliberately not imported. */
const MASTER_IGNORED_HEADERS: Record<string, string> = {
  "source date": "not imported (reference only)",
  action: "set by the Action strategy below",
  "product type": "set by the Product Type below",
  sku: "always blank: SKUs are assigned on import",
  slug: "always blank: derived on import",
};

export const MASTER_REQUIRED_FIELDS: MasterField[] = ["Brand", "Model / Product Title", "Price"];
/** Preferred source sheet when a master has several usable sheets. */
export const MASTER_PREFERRED_SHEET = "Import - Android Phones";
const HEADER_SCAN_ROWS = 10;

export type MasterColumn = { column: number; header: string; field: MasterField | null; note: string | null };
export type MasterSourceRow = { sourceRow: number; values: Partial<Record<MasterField, CellInput>> };
export type MasterSheet = {
  name: string;
  headerRow: number;
  columns: MasterColumn[];
  /** Required fields with no matching column. */
  missing: MasterField[];
  /** Two or more columns that map to the same field (never resolved silently). */
  conflicts: string[];
  rows: MasterSourceRow[];
  usable: boolean;
};
export type MasterWorkbook = {
  sheets: MasterSheet[];
  /** The file needed the read-only compatibility normalization before it could be read. */
  compatibilityMode: boolean;
  error: string | null;
};

function mapColumns(sheet: Worksheet, rowNumber: number) {
  const columns: MasterColumn[] = [];
  sheet.getRow(rowNumber).eachCell((cell, column) => {
    const value = readCell(cell);
    if (value === null) return;
    const header = collapse(String(value));
    const key = headerKey(header);
    const field = MASTER_HEADER_ALIASES[key] ?? null;
    columns.push({ column, header, field, note: field ? null : (MASTER_IGNORED_HEADERS[key] ?? "not recognised: ignored") });
  });
  return columns;
}

function readMasterSheet(sheet: Worksheet): MasterSheet | null {
  let best: { row: number; columns: MasterColumn[]; mapped: number } | null = null;
  for (let row = 1; row <= Math.min(HEADER_SCAN_ROWS, sheet.rowCount); row += 1) {
    const columns = mapColumns(sheet, row);
    const mapped = new Set(columns.map((item) => item.field).filter(Boolean)).size;
    const hasRequired = MASTER_REQUIRED_FIELDS.every((field) => columns.some((item) => item.field === field));
    if (hasRequired) {
      best = { row, columns, mapped };
      break;
    }
    if (mapped >= 2 && (!best || mapped > best.mapped)) best = { row, columns, mapped };
  }
  if (!best) return null;
  const byField = new Map<MasterField, MasterColumn[]>();
  for (const column of best.columns)
    if (column.field) byField.set(column.field, [...(byField.get(column.field) ?? []), column]);
  const conflicts = [...byField.entries()]
    .filter(([, columns]) => columns.length > 1)
    .map(([field, columns]) => `${columns.map((item) => `"${item.header}"`).join(" and ")} both look like ${field}; keep only one of these columns`);
  const missing = MASTER_REQUIRED_FIELDS.filter((field) => !byField.has(field));
  const rows: MasterSourceRow[] = [];
  if (!missing.length && !conflicts.length) {
    for (let rowNumber = best.row + 1; rowNumber <= sheet.rowCount; rowNumber += 1) {
      const excelRow = sheet.getRow(rowNumber);
      const values: MasterSourceRow["values"] = {};
      for (const [field, [column]] of byField) values[field] = readCell(excelRow.getCell(column.column));
      if (Object.values(values).every((value) => value === null)) continue;
      rows.push({ sourceRow: rowNumber, values });
    }
  }
  return {
    name: sheet.name,
    headerRow: best.row,
    columns: best.columns,
    missing,
    conflicts,
    rows,
    usable: !missing.length && !conflicts.length,
  };
}

/** Reads a master workbook. Sheets without at least two recognisable columns are skipped. */
export async function readMasterWorkbook(data: ArrayBuffer | Uint8Array): Promise<MasterWorkbook> {
  const ExcelJS = await loadExcelJs();
  const load = async (bytes: ArrayBuffer | Uint8Array) => {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(bytes as ArrayBuffer);
    if (!workbook.worksheets.length) throw new Error("no worksheets");
    return workbook;
  };
  let compatibilityMode = false;
  let workbook;
  try {
    workbook = await load(data);
  } catch {
    try {
      workbook = await load(await normalizeXlsxForReading(data));
      compatibilityMode = true;
    } catch {
      return { sheets: [], compatibilityMode: false, error: "The file could not be read as an .xlsx workbook." };
    }
  }
  const sheets = workbook.worksheets.map(readMasterSheet).filter((sheet): sheet is MasterSheet => sheet !== null);
  const error = sheets.length
    ? null
    : `No sheet has recognisable catalog columns. Required: ${MASTER_REQUIRED_FIELDS.join(", ")}.`;
  return { sheets, compatibilityMode, error };
}

/** The sheet to start with: the Android import sheet when present, else the first usable sheet. */
export function defaultMasterSheet(workbook: MasterWorkbook) {
  const usable = workbook.sheets.filter((sheet) => sheet.usable);
  return usable.find((sheet) => lower(sheet.name) === lower(MASTER_PREFERRED_SHEET)) ?? usable[0] ?? workbook.sheets[0] ?? null;
}

// ---------------------------------------------------------------------------
// Normalization
// ---------------------------------------------------------------------------

export type MasterActionStrategy = "create" | "replace" | "auto";
export const MASTER_ACTION_STRATEGIES: Record<MasterActionStrategy, string> = {
  create: "Create New Catalog",
  replace: "Replace Existing Catalog",
  auto: "Auto from target catalog",
};

export type MasterReference = CatalogReference & {
  /** Titles of real products already in the target catalog (any case); null when unknown. */
  existingTitles: string[] | null;
};

export type MasterOptions = {
  productType: CatalogProductType;
  strategy: MasterActionStrategy;
  /** Stock for rows whose Stock / Qty cell is blank (Owner rule: 10). */
  defaultStock: number;
  reference: MasterReference;
};

export type PreparedMasterRow = {
  sourceRow: number;
  /** Parsed by the importer's own row parser from the normalized values. */
  row: CatalogSheetRow;
  /** Value changes made by normalization (shown to the Owner, never silent). */
  changes: string[];
  warnings: string[];
  /** Problems found before the importer's checks (always blocking). */
  issues: string[];
};

const textOf = (value: CellInput | undefined) =>
  value === null || value === undefined ? null : collapse(String(value)) || null;

/** Maps and normalizes every master row into an import row (no rows are dropped). */
export function prepareMasterRows(sheet: MasterSheet, options: MasterOptions): PreparedMasterRow[] {
  const { productType, strategy, defaultStock, reference } = options;
  if (!Number.isInteger(defaultStock) || defaultStock < 0) throw new Error("Default stock must be a whole number of 0 or more.");
  const brands = new Map(reference.brands.map((name) => [lower(name), name]));
  const existing = reference.existingTitles ? new Set(reference.existingTitles.map(lower)) : null;
  const expectedCategory = PRODUCT_TYPE_CATEGORY[productType];

  return sheet.rows.map(({ sourceRow, values }) => {
    const changes: string[] = [];
    const warnings: string[] = [];
    const issues: string[] = [];

    const brandInput = textOf(values.Brand);
    const brand = brandInput ? (brands.get(lower(brandInput)) ?? brandInput) : null;
    if (!brandInput) issues.push("Brand is required");
    else if (brand !== brandInput) changes.push(`Brand ${brandInput} → ${brand}`);

    let model = textOf(values["Model / Product Title"]);
    if (model && brandInput && lower(model).startsWith(`${lower(brandInput)} `)) model = model.slice(brandInput.length).trim();
    const cleanModel = model ? canonicalModel(model) || null : null;
    if (model && cleanModel && cleanModel !== model) changes.push(`Model ${model} → ${cleanModel}`);

    const ramInput = textOf(values.RAM);
    const extended = physicalRamFromExtended(ramInput);
    if (extended)
      warnings.push(`RAM ${ramInput} → ${extended.ram} (physical RAM; the ${extended.extended} extended/virtual RAM is not stored)`);

    const stockInput = values.Stock ?? null;
    const stock = stockInput === null || textOf(stockInput) === null ? defaultStock : stockInput;

    const categoryInput = textOf(values.Category);
    // "Gadgets > Tablets" names the category by its last segment.
    const category = categoryInput ? collapse(categoryInput.split(">").pop() ?? "") : expectedCategory;
    if (categoryInput && category !== categoryInput) changes.push(`Category ${categoryInput} → ${category}`);

    const deliveryInput = textOf(values["Delivery Scope"]);
    const delivery = deliveryInput ?? (productType === "Mobile Phone" ? "Karachi Only" : null);
    if (!delivery) warnings.push("Delivery Scope blank: set it before publishing");
    if (!textOf(values.Color)) warnings.push("Color blank");

    const title = brand && cleanModel ? `${brand} ${cleanModel}` : cleanModel;
    const exists = existing && title ? existing.has(lower(title)) : null;
    let action: CatalogAction = strategy === "replace" ? "Replace Existing" : "Create";
    if (strategy === "auto" && exists) action = "Replace Existing";
    if (exists === true && strategy === "create")
      issues.push("Already in the target catalog: Create would be rejected (use Replace Existing)");
    if (exists === false && strategy === "replace")
      issues.push("Not in the target catalog: Replace Existing would be rejected (use Create)");
    if (exists === true && strategy === "auto")
      warnings.push("Already in the target catalog → Replace Existing (its active variants missing from this file will be hidden)");

    const record: Partial<Record<ProductHeader, CellInput>> = {
      Action: action,
      "Product Type": productType,
      Brand: brand,
      "Model / Product Title": cleanModel,
      RAM: extended ? extended.ram : ramInput,
      Storage: values.Storage ?? null,
      Color: values.Color ?? null,
      "PTA Status": values["PTA Status"] ?? null,
      Condition: values.Condition ?? null,
      "Battery Health": values["Battery Health"] ?? null,
      "Cycle Count": values["Cycle Count"] ?? null,
      "SIM Configuration": values["SIM Configuration"] ?? null,
      Warranty: values.Warranty ?? null,
      "Delivery Scope": delivery,
      Price: values.Price ?? null,
      "Compare-at Price": values["Compare-at Price"] ?? null,
      Stock: stock,
      SKU: null,
      Category: category,
      Slug: null,
      Notes: null,
    };
    const row = catalogRowFromRecord(record, sourceRow);
    row.sourceLine = `Row ${sourceRow}`;
    return { sourceRow, row, changes, warnings, issues };
  });
}

// ---------------------------------------------------------------------------
// Review
// ---------------------------------------------------------------------------

export type MasterRowStatus = "ready" | "warning" | "blocked";
export type MasterRowReview = Omit<PreparedMasterRow, "issues"> & {
  included: boolean;
  status: MasterRowStatus;
  /** Blocking problems (importer review reasons, duplicates, unknown brand, ...). */
  issues: string[];
};
export type MasterReview = {
  rows: MasterRowReview[];
  counts: { total: number; ready: number; warning: number; blocked: number; included: number; excluded: number; products: number };
  /** Validated import rows for the included source rows, in source order. */
  includedRows: CatalogSheetRow[];
  /** Why the workbook cannot be generated yet (empty when it can). */
  blockers: string[];
};

// Server limits of apply_catalog_bulk_import_v2.
const MAX_PRODUCTS = 500;
const MAX_VARIANTS = 5000;

const friendlyReason = (reason: string) =>
  reason.replace(/^Brand not found among active brands: "(.*)"$/, "Brand does not exist in target catalog: $1");

function assess(rows: PreparedMasterRow[], reference: CatalogReference) {
  const validated = validateCatalogSheet(rows.map((item) => item.row), [], reference).rows;
  // Every member of a duplicate group is blocked, never just the later rows.
  const groups = new Map<string, number[]>();
  validated.forEach((row, index) => {
    if (row.slug) groups.set(catalogVariantKey(row), [...(groups.get(catalogVariantKey(row)) ?? []), index]);
  });
  return validated.map((row, index) => {
    const group = row.slug ? groups.get(catalogVariantKey(row))! : [index];
    const issues = [
      ...rows[index].issues,
      ...row.reviewReasons.filter((reason) => !reason.startsWith("Duplicate variant (same as")).map(friendlyReason),
    ];
    if (group.length > 1)
      issues.push(`Duplicate variant: rows ${group.map((member) => rows[member].sourceRow).join(", ")} have the same Brand, Model, RAM, Storage, Color, PTA, Condition, Grade, Battery Health and Cycle Count`);
    const unique = [...new Set(issues)];
    const status: MasterRowStatus = unique.length ? "blocked" : rows[index].warnings.length ? "warning" : "ready";
    return { row, issues: unique, status };
  });
}

/** Rows included by default: everything that is not blocked. */
export function initialMasterSelection(rows: PreparedMasterRow[], reference: CatalogReference) {
  const statuses = assess(rows, reference);
  return new Set(rows.filter((_, index) => statuses[index].status !== "blocked").map((item) => item.sourceRow));
}

/**
 * Reviews the rows for the current selection. Included rows are checked together (so excluding
 * one row of a duplicate pair clears the other); excluded rows show their result against all rows.
 */
export function evaluateMasterRows(rows: PreparedMasterRow[], included: ReadonlySet<number>, reference: CatalogReference): MasterReview {
  const all = assess(rows, reference);
  const includedSource = rows.filter((item) => included.has(item.sourceRow));
  const includedResult = new Map(assess(includedSource, reference).map((result, index) => [includedSource[index].sourceRow, result]));
  const reviewed = rows.map((item, index): MasterRowReview => {
    const isIncluded = included.has(item.sourceRow);
    const result = (isIncluded && includedResult.get(item.sourceRow)) || all[index];
    return { ...item, row: result.row, issues: result.issues, status: result.status, included: isIncluded };
  });
  const includedRows = reviewed.filter((item) => item.included).map((item) => item.row);
  const products = new Set(includedRows.map((row) => row.slug)).size;
  const count = (status: MasterRowStatus) => reviewed.filter((item) => item.status === status).length;
  const blockedIncluded = reviewed.filter((item) => item.included && item.status === "blocked").length;
  const blockers: string[] = [];
  if (!includedRows.length) blockers.push("Select at least one row to include.");
  if (blockedIncluded)
    blockers.push(`${blockedIncluded} included row${blockedIncluded === 1 ? " is" : "s are"} blocked: fix ${blockedIncluded === 1 ? "it" : "them"} in the master file or exclude ${blockedIncluded === 1 ? "it" : "them"}.`);
  if (products > MAX_PRODUCTS) blockers.push(`${products} products: the importer accepts at most ${MAX_PRODUCTS} per import.`);
  if (includedRows.length > MAX_VARIANTS) blockers.push(`${includedRows.length} rows: the importer accepts at most ${MAX_VARIANTS} variants per import.`);
  return {
    rows: reviewed,
    counts: {
      total: reviewed.length,
      ready: count("ready"),
      warning: count("warning"),
      blocked: count("blocked"),
      included: includedRows.length,
      excluded: reviewed.length - includedRows.length,
      products,
    },
    includedRows,
    blockers,
  };
}

/** Issues grouped by message, with the source rows that have them. */
export function groupMasterIssues(review: MasterReview, kind: "issues" | "warnings") {
  const groups = new Map<string, number[]>();
  for (const item of review.rows)
    for (const message of item[kind]) groups.set(message, [...(groups.get(message) ?? []), item.sourceRow]);
  return [...groups.entries()].map(([message, rows]) => ({ message, rows }));
}

// ---------------------------------------------------------------------------
// Generation
// ---------------------------------------------------------------------------

export type GeneratedImportWorkbook = { bytes: Uint8Array<ArrayBuffer>; validation: GeneratedWorkbookValidation };

/** Writes the included rows with the template builder and validates the exact bytes. */
export async function generateMasterImportWorkbook(review: MasterReview, reference: CatalogReference): Promise<GeneratedImportWorkbook> {
  if (review.blockers.length) throw new Error(review.blockers.join(" "));
  const bytes = await buildCatalogImportWorkbook(review.includedRows, reference);
  const validation = await validateGeneratedCatalogWorkbook(bytes, review.includedRows, reference);
  if (validation.productCount !== review.counts.products) {
    validation.errors.push(`Parsed ${validation.productCount} products; expected ${review.counts.products}.`);
    validation.ok = false;
  }
  return { bytes, validation };
}

/** isolutions-mobile-phones-import-2026-10-07.xlsx (local date). */
export function catalogImportFilename(productType: CatalogProductType, date = new Date()) {
  const day = [date.getFullYear(), date.getMonth() + 1, date.getDate()].map((part) => String(part).padStart(2, "0")).join("-");
  return `isolutions-${catalogSlug(PRODUCT_TYPE_CATEGORY[productType])}-import-${day}.xlsx`;
}
