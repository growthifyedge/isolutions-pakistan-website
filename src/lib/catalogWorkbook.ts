import type { Cell, DataValidation, Workbook, Worksheet } from "exceljs";
import type { BulkParseResult, BulkProduct, BulkVariant } from "./bulkCatalog.ts";
import {
  DEFAULT_IMPORT_STOCK,
  EXTENDED_RAM,
  applyAndroidMobileWarrantyDefault,
  catalogSlug,
  catalogVariantKey,
  parseCatalogPrice,
  type CatalogAction,
  type CatalogCondition,
  type CatalogConditionGrade,
  type CatalogDeliveryScope,
  type CatalogField,
  type CatalogProductType,
  type CatalogPtaStatus,
  type CatalogSheetRow,
  type CatalogSimConfiguration,
  type FieldStatus,
} from "./catalogSheet.ts";
import { ANDROID_MOBILE_WARRANTY_SOURCE, normalizeCapacity } from "./bulkCatalog.ts";
import { pkrMajorInputFromMinor } from "./money.ts";
import { SIM_CONFIGURATIONS } from "./variantFacts.ts";

// Bulk Upload v2 — Phase 1B. Excel staging for CatalogSheetRow data: a workbook
// writer, a reader, and validation against current active brands/categories.
// Nothing in this module talks to the database; callers pass reference data in.

export const CATALOG_TEMPLATE_VERSION = "isolutions-catalog-v1";

export const PRODUCT_HEADERS = [
  "Action", "Product Type", "Brand", "Model / Product Title", "RAM", "Storage", "Color",
  "PTA Status", "Condition", "Battery Health", "Cycle Count", "SIM Configuration", "Warranty", "Delivery Scope",
  "Price", "Compare-at Price", "Stock", "SKU", "Category", "Slug", "Notes",
] as const;
export const SPECIFICATION_HEADERS = ["Product Key", "Section", "Specification Name", "Specification Value"] as const;

type ProductHeader = (typeof PRODUCT_HEADERS)[number];
/** Columns added after v1 shipped: workbooks without them still read (the value stays blank). */
const OPTIONAL_PRODUCT_HEADERS: ProductHeader[] = ["SIM Configuration"];

const HEADER_FIELD: Record<ProductHeader, CatalogField> = {
  Action: "action",
  "Product Type": "productType",
  Brand: "brand",
  "Model / Product Title": "model",
  RAM: "ram",
  Storage: "storage",
  Color: "color",
  "PTA Status": "ptaStatus",
  Condition: "condition",
  "Battery Health": "batteryHealth",
  "Cycle Count": "cycleCount",
  "SIM Configuration": "simConfiguration",
  Warranty: "warranty",
  "Delivery Scope": "deliveryScope",
  Price: "priceMinor",
  "Compare-at Price": "compareAtPriceMinor",
  Stock: "stock",
  SKU: "sku",
  Category: "category",
  Slug: "slug",
  Notes: "notes",
};

export const CATALOG_LISTS = {
  action: ["Create", "Replace Existing"] as CatalogAction[],
  productType: ["Mobile Phone", "Accessory", "Gadget", "Tablet", "Laptop"] as CatalogProductType[],
  ptaStatus: ["PTA Approved", "Non-PTA", "Not Applicable"],
  condition: ["Brand New", "Used", "Open Box", "Refurbished"],
  deliveryScope: ["Karachi Only", "Nationwide"],
  simConfiguration: SIM_CONFIGURATIONS.map((option) => option.label) as string[],
};

const PTA_LABEL: Record<CatalogPtaStatus, string> = {
  approved: "PTA Approved",
  not_approved: "Non-PTA",
  not_applicable: "Not Applicable",
};
const CONDITION_LABEL: Record<CatalogCondition, string> = {
  brand_new: "Brand New",
  used: "Used",
  open_box: "Open Box",
  refurbished: "Refurbished",
};
const DELIVERY_LABEL: Record<CatalogDeliveryScope, string> = {
  karachi_only: "Karachi Only",
  nationwide: "Nationwide",
};
const SIM_LABEL = Object.fromEntries(SIM_CONFIGURATIONS.map((option) => [option.value, option.label])) as Record<
  CatalogSimConfiguration,
  string
>;

/** An SKU already in the catalog and the slug of the product that owns it. */
export type CatalogExistingSku = { sku: string; productSlug: string };

/**
 * Current active real brands and categories (names), supplied by the caller, plus every
 * SKU already in the catalog (all products, active and inactive variants). Existing SKUs
 * are only used to check a supplied SKU; new SKUs are assigned by the database on import.
 */
export type CatalogReference = { brands: string[]; categories: string[]; existingSkus?: CatalogExistingSku[] };

export type CatalogSpecificationRow = {
  rowNumber: number;
  productKey: string;
  section: string | null;
  name: string | null;
  value: string | null;
  needsReview: boolean;
  reviewReasons: string[];
};

export type CatalogWorkbookData = {
  rows: CatalogSheetRow[];
  specifications: CatalogSpecificationRow[];
  /** Blocking problems with the file itself (missing sheets/headers, wrong template). */
  fileErrors: string[];
};

const REQUIRED_FIELDS: CatalogField[] = [
  "productType", "model", "ptaStatus", "condition", "warranty", "deliveryScope", "priceMinor", "category",
];
const FILL = {
  header: "FFE7E6E6",
  needsReview: "FFFFC7CE",
  inferred: "FFFFF2CC",
  requiredBlank: "FFFCE4D6",
};
const TEXT_COLUMNS: ProductHeader[] = ["RAM", "Storage", "SKU", "Slug"];
const COLUMN_WIDTHS: Record<ProductHeader, number> = {
  Action: 16, "Product Type": 14, Brand: 14, "Model / Product Title": 26, RAM: 9, Storage: 10,
  Color: 16, "PTA Status": 15, Condition: 13, "Battery Health": 14, "Cycle Count": 12, "SIM Configuration": 18, Warranty: 18,
  "Delivery Scope": 15, Price: 13, "Compare-at Price": 16, Stock: 8, SKU: 10, Category: 20, Slug: 30, Notes: 32,
};
const VALIDATION_ROWS = 2000;

const collapse = (value: string) => value.trim().replace(/\s+/g, " ");
const lower = (value: string) => collapse(value).toLowerCase();
const columnLetter = (index: number) => String.fromCharCode(65 + index);

// ExcelJS supports range-wide validations at runtime but does not declare them in its types.
type WorksheetWithValidations = Worksheet & {
  dataValidations: { add(range: string, validation: DataValidation): void };
};

async function loadExcelJs() {
  const imported = await import("exceljs");
  return ((imported as unknown as { default?: typeof imported }).default ?? imported) as typeof import("exceljs");
}

// ---------------------------------------------------------------------------
// Writer
// ---------------------------------------------------------------------------

function cellValueFor(row: CatalogSheetRow, header: ProductHeader): string | number | null {
  switch (header) {
    case "Action": return row.action;
    case "Product Type": return row.productType;
    case "Brand": return row.brand;
    case "Model / Product Title": return row.model;
    case "RAM": return row.ram;
    case "Storage": return row.storage;
    case "Color": return row.color;
    case "PTA Status": return row.ptaStatus ? PTA_LABEL[row.ptaStatus] : null;
    case "Condition": return row.condition ? CONDITION_LABEL[row.condition] : null;
    case "Battery Health": return row.batteryHealth;
    case "Cycle Count": return row.cycleCount;
    case "SIM Configuration": return row.simConfiguration ? SIM_LABEL[row.simConfiguration] : null;
    case "Warranty": return row.warranty;
    case "Delivery Scope": return row.deliveryScope ? DELIVERY_LABEL[row.deliveryScope] : null;
    case "Price": return row.priceMinor === null ? null : row.priceMinor / 100;
    case "Compare-at Price": return row.compareAtPriceMinor === null ? null : row.compareAtPriceMinor / 100;
    case "Stock": return row.stock;
    case "SKU": return row.sku;
    case "Category": return row.category;
    case "Slug": return row.slug;
    case "Notes": return row.notes.length ? row.notes.join("; ") : null;
  }
}

function fill(cell: Cell, argb: string) {
  cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb } };
}

function styleHeader(sheet: Worksheet, columnCount: number) {
  const header = sheet.getRow(1);
  header.font = { bold: true };
  for (let index = 1; index <= columnCount; index += 1) fill(header.getCell(index), FILL.header);
  sheet.views = [{ state: "frozen", ySplit: 1 }];
  sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: columnCount } };
}

function writeListsSheet(workbook: Workbook, reference: CatalogReference) {
  const sheet = workbook.addWorksheet("Lists");
  const columns: Array<[string, string[]]> = [
    ["Brands", [...reference.brands].sort((left, right) => left.localeCompare(right))],
    ["Categories", [...reference.categories].sort((left, right) => left.localeCompare(right))],
    ["Action", CATALOG_LISTS.action],
    ["Product Type", CATALOG_LISTS.productType],
    ["PTA Status", CATALOG_LISTS.ptaStatus],
    ["Condition", CATALOG_LISTS.condition],
    ["Delivery Scope", CATALOG_LISTS.deliveryScope],
    ["Template", [CATALOG_TEMPLATE_VERSION]],
    ["SIM Configuration", CATALOG_LISTS.simConfiguration],
  ];
  const ranges: Record<string, string | null> = {};
  columns.forEach(([title, values], index) => {
    const letter = columnLetter(index);
    sheet.getCell(`${letter}1`).value = title;
    values.forEach((value, valueIndex) => {
      sheet.getCell(`${letter}${valueIndex + 2}`).value = value;
    });
    ranges[title] = values.length ? `Lists!$${letter}$2:$${letter}$${values.length + 1}` : null;
  });
  sheet.state = "hidden";
  return ranges;
}

/**
 * Builds the fixed catalog workbook (Products, Specifications, hidden Lists).
 * Returns the .xlsx bytes; the caller decides whether to download or test them.
 */
export async function buildCatalogWorkbook(
  rows: CatalogSheetRow[],
  specifications: Array<Pick<CatalogSpecificationRow, "productKey" | "section" | "name" | "value">>,
  reference: CatalogReference,
): Promise<Uint8Array<ArrayBuffer>> {
  const ExcelJS = await loadExcelJs();
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "iSolutions Admin Studio";
  workbook.title = "iSolutions catalog import";
  workbook.subject = CATALOG_TEMPLATE_VERSION;

  const products = workbook.addWorksheet("Products");
  products.columns = PRODUCT_HEADERS.map((header) => ({
    header,
    key: header,
    width: COLUMN_WIDTHS[header],
    ...(TEXT_COLUMNS.includes(header) ? { style: { numFmt: "@" } } : {}),
  }));
  styleHeader(products, PRODUCT_HEADERS.length);
  products.getCell("A1").note =
    "Red = needs review · Yellow = inferred, please confirm · Orange = required but blank. Blank optional cells stay blank; blank Stock imports as 10. Leave SKU blank for new variants: it is assigned on import (MB/AC/GD/MC/IP + number).";

  for (const row of rows) {
    const excelRow = products.addRow(PRODUCT_HEADERS.map((header) => cellValueFor(row, header)));
    PRODUCT_HEADERS.forEach((header, index) => {
      const cell = excelRow.getCell(index + 1);
      const field = HEADER_FIELD[header];
      const status: FieldStatus = row.fieldStatus[field];
      if (header === "Price" || header === "Compare-at Price") {
        const minor = header === "Price" ? row.priceMinor : row.compareAtPriceMinor;
        cell.numFmt = minor !== null && minor % 100 !== 0 ? "#,##0.00" : "#,##0";
      }
      if (TEXT_COLUMNS.includes(header)) cell.numFmt = "@";
      if (status === "needs_review") fill(cell, FILL.needsReview);
      else if (status === "inferred") fill(cell, FILL.inferred);
      else if (status === "blank" && REQUIRED_FIELDS.includes(field)) fill(cell, FILL.requiredBlank);
    });
    if (row.needsReview) {
      const actionCell = excelRow.getCell(1);
      fill(actionCell, FILL.needsReview);
      actionCell.note = `Needs review: ${row.reviewReasons.join("; ")}`;
    }
  }

  const specSheet = workbook.addWorksheet("Specifications");
  specSheet.columns = SPECIFICATION_HEADERS.map((header, index) => ({
    header,
    key: header,
    width: [30, 18, 26, 40][index],
    ...(index === 0 ? { style: { numFmt: "@" } } : {}),
  }));
  styleHeader(specSheet, SPECIFICATION_HEADERS.length);
  for (const specification of specifications) {
    specSheet.addRow([specification.productKey, specification.section, specification.name, specification.value]);
  }

  const ranges = writeListsSheet(workbook, reference);
  const listColumns: Array<[ProductHeader, string]> = [
    ["Action", "Action"],
    ["Product Type", "Product Type"],
    ["Brand", "Brands"],
    ["PTA Status", "PTA Status"],
    ["Condition", "Condition"],
    ["Delivery Scope", "Delivery Scope"],
    ["SIM Configuration", "SIM Configuration"],
    ["Category", "Categories"],
  ];
  for (const [header, list] of listColumns) {
    const range = ranges[list];
    if (!range) continue;
    const letter = columnLetter(PRODUCT_HEADERS.indexOf(header));
    (products as WorksheetWithValidations).dataValidations.add(`${letter}2:${letter}${VALIDATION_ROWS}`, {
      type: "list",
      allowBlank: true,
      formulae: [range],
      showErrorMessage: true,
      errorStyle: "warning",
      errorTitle: header,
      error: `Choose a value from the ${header} list.`,
    });
  }

  const buffer = await workbook.xlsx.writeBuffer();
  return new Uint8Array(buffer as ArrayBuffer);
}

// ---------------------------------------------------------------------------
// Reader
// ---------------------------------------------------------------------------

type CellInput = string | number | null;

function readCell(cell: Cell): CellInput {
  const value = cell.value as unknown;
  if (value === null || value === undefined) return null;
  if (typeof value === "number") {
    // A value typed as "89%" is stored by Excel as 0.89 with a percent format.
    return cell.numFmt?.includes("%") ? Math.round(value * 10000) / 100 : value;
  }
  if (typeof value === "string") return collapse(value) || null;
  if (typeof value === "boolean") return String(value);
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === "object") {
    const object = value as { richText?: Array<{ text: string }>; text?: unknown; result?: unknown };
    if (object.richText) return collapse(object.richText.map((part) => part.text).join("")) || null;
    if (object.result !== undefined) return readCell({ value: object.result, numFmt: cell.numFmt } as Cell);
    if (typeof object.text === "string") return collapse(object.text) || null;
  }
  return collapse(String(value)) || null;
}

const asText = (value: CellInput) => (value === null ? null : collapse(String(value)) || null);

function sheetByName(workbook: Workbook, name: string) {
  return workbook.worksheets.find((sheet) => lower(sheet.name) === lower(name));
}

const HEADER_ALIASES: Record<string, ProductHeader> = {
  model: "Model / Product Title",
  "product title": "Model / Product Title",
  "model / product title": "Model / Product Title",
  qty: "Stock",
  quantity: "Stock",
  "compare at price": "Compare-at Price",
  pta: "PTA Status",
  delivery: "Delivery Scope",
};

function headerMap<T extends string>(sheet: Worksheet, headers: readonly T[], aliases: Record<string, T> = {}) {
  const positions = new Map<T, number>();
  sheet.getRow(1).eachCell((cell, column) => {
    const text = asText(readCell(cell));
    if (!text) return;
    const key = lower(text);
    const header = headers.find((candidate) => lower(candidate) === key) ?? aliases[key];
    if (header && !positions.has(header)) positions.set(header, column);
  });
  return { positions, missing: headers.filter((header) => !positions.has(header)) };
}

function matchLabel<T extends string>(value: string, options: Record<string, T>): T | null {
  return options[lower(value)] ?? null;
}

const PTA_INPUT: Record<string, CatalogPtaStatus> = {
  "pta approved": "approved", pta: "approved", approved: "approved",
  "non-pta": "not_approved", "non pta": "not_approved", nonpta: "not_approved", "not approved": "not_approved",
  "not applicable": "not_applicable", "n/a": "not_applicable", na: "not_applicable",
};
const CONDITION_INPUT: Record<string, CatalogCondition> = {
  "brand new": "brand_new", new: "brand_new", "box pack": "brand_new", "box packed": "brand_new",
  used: "used", "a++": "used", "open box": "open_box", refurbished: "refurbished",
};
const DELIVERY_INPUT: Record<string, CatalogDeliveryScope> = {
  "karachi only": "karachi_only", karachi: "karachi_only", nationwide: "nationwide",
};
// Exact display labels only (case-insensitive). Anything else needs review; never guessed.
const SIM_INPUT: Record<string, CatalogSimConfiguration> = Object.fromEntries(
  SIM_CONFIGURATIONS.map((option) => [option.label.toLowerCase(), option.value]),
);
const ACTION_INPUT: Record<string, CatalogAction> = {
  create: "Create", "replace existing": "Replace Existing", replace: "Replace Existing",
};
const PRODUCT_TYPE_INPUT: Record<string, CatalogProductType> = Object.fromEntries(
  CATALOG_LISTS.productType.map((type) => [type.toLowerCase(), type]),
);

function emptyStatus(): Record<CatalogField, FieldStatus> {
  return Object.fromEntries(Object.values(HEADER_FIELD).concat(["productTitle", "conditionGrade"]).map((field) => [field, "blank"])) as Record<
    CatalogField,
    FieldStatus
  >;
}

/** Converts one Products sheet record (header → cell) into a CatalogSheetRow. */
export function catalogRowFromRecord(record: Partial<Record<ProductHeader, CellInput>>, rowNumber: number): CatalogSheetRow {
  const status = emptyStatus();
  const reasons: string[] = [];
  const text = (header: ProductHeader) => asText(record[header] ?? null);
  const explicit = (field: CatalogField, value: unknown) => {
    status[field] = value === null ? "blank" : "explicit";
  };
  const invalid = (field: CatalogField, message: string) => {
    status[field] = "needs_review";
    reasons.push(message);
  };
  const choose = <T extends string>(header: ProductHeader, options: Record<string, T>): T | null => {
    const value = text(header);
    const field = HEADER_FIELD[header];
    if (value === null) return null;
    const matched = matchLabel(value, options);
    if (matched === null) invalid(field, `Unknown ${header}: "${value}"`);
    else explicit(field, matched);
    return matched;
  };
  const wholeNumber = (header: ProductHeader, min: number, max: number) => {
    const raw = record[header] ?? null;
    const field = HEADER_FIELD[header];
    if (raw === null) return null;
    const value = typeof raw === "number" ? raw : Number(String(raw).replace(/[%,\s]/g, ""));
    if (!Number.isInteger(value) || value < min || value > max) {
      invalid(field, `${header} must be a whole number${max === Number.MAX_SAFE_INTEGER ? ` of at least ${min}` : ` from ${min} to ${max}`}: "${raw}"`);
      return null;
    }
    explicit(field, value);
    return value;
  };
  const price = (header: ProductHeader) => {
    const raw = record[header] ?? null;
    const field = HEADER_FIELD[header];
    if (raw === null) return null;
    const minor = parseCatalogPrice(String(raw));
    if (minor === null || minor <= 0) {
      invalid(field, `${header} is not a valid PKR amount: "${raw}"`);
      return null;
    }
    explicit(field, minor);
    return minor;
  };
  const capacity = (header: ProductHeader) => {
    const value = text(header);
    const field = HEADER_FIELD[header];
    if (value === null) return null;
    const normalized = normalizeCapacity(value);
    if (!normalized) invalid(field, `${header} is not a capacity like "8 GB" or "1 TB": "${value}"`);
    else explicit(field, normalized);
    return normalized;
  };

  const action = choose("Action", ACTION_INPUT);
  const productType = choose("Product Type", PRODUCT_TYPE_INPUT);
  const brand = text("Brand");
  explicit("brand", brand);
  let model = text("Model / Product Title");
  // The brand belongs in the Brand column; drop a repeated brand prefix from the model cell.
  if (brand && model && lower(model).startsWith(`${lower(brand)} `)) model = model.slice(brand.length).trim();
  explicit("model", model);
  if (!model) invalid("model", "Model / Product Title is required");
  // Extended/virtual RAM ("3+5 GB") is kept exactly as written and stays Needs Review until
  // the Owner replaces it with the physical RAM; it is never summed or split.
  const extendedRam = text("RAM")?.match(/^(\d+)\s*\+\s*(\d+)\s*(?:GB)?$/i);
  const ram = extendedRam ? `${extendedRam[1]}+${extendedRam[2]} GB` : capacity("RAM");
  if (extendedRam) invalid("ram", EXTENDED_RAM);
  const storage = capacity("Storage");
  const color = text("Color");
  explicit("color", color);
  const ptaStatus = choose("PTA Status", PTA_INPUT);
  const condition = choose("Condition", CONDITION_INPUT);
  let conditionGrade: CatalogConditionGrade | null = null;
  if (condition === "used") {
    conditionGrade = "A++";
    status.conditionGrade = lower(text("Condition") ?? "") === "a++" ? "explicit" : "default";
  }
  const batteryHealth = wholeNumber("Battery Health", 1, 100);
  const cycleCount = wholeNumber("Cycle Count", 0, Number.MAX_SAFE_INTEGER);
  const simConfiguration = choose("SIM Configuration", SIM_INPUT);
  const warranty = text("Warranty");
  explicit("warranty", warranty);
  const deliveryScope = choose("Delivery Scope", DELIVERY_INPUT);
  if (productType === "Mobile Phone" && deliveryScope === "nationwide")
    invalid("deliveryScope", "Mobile phones are Karachi-only; Nationwide conflicts");
  const priceMinor = price("Price");
  if (priceMinor === null && status.priceMinor === "blank") invalid("priceMinor", "Price is required");
  const compareAtPriceMinor = price("Compare-at Price");
  if (compareAtPriceMinor !== null && priceMinor !== null && compareAtPriceMinor <= priceMinor)
    invalid("compareAtPriceMinor", "Compare-at Price must be higher than Price");
  let stock = wholeNumber("Stock", 0, Number.MAX_SAFE_INTEGER);
  if (stock === null) {
    // Owner-locked rule: a blank Stock cell imports as 10.
    if (status.stock === "blank") status.stock = "default";
    stock = DEFAULT_IMPORT_STOCK;
  }
  const category = text("Category");
  explicit("category", category);
  const notes = text("Notes");
  explicit("notes", notes);

  const productTitle = model ? (brand ? `${brand} ${model}` : model) : null;
  status.productTitle = productTitle ? "inferred" : "needs_review";
  const slugInput = text("Slug");
  const slug = slugInput ? catalogSlug(slugInput) || null : productTitle ? catalogSlug(productTitle) || null : null;
  status.slug = slugInput ? "explicit" : slug ? "inferred" : "needs_review";

  const row: CatalogSheetRow = {
    lineNumber: rowNumber,
    sourceLine: `Products row ${rowNumber}`,
    action,
    productType,
    brand,
    model,
    productTitle,
    ram,
    storage,
    color,
    ptaStatus,
    condition,
    conditionGrade,
    batteryHealth,
    cycleCount,
    simConfiguration,
    warranty,
    deliveryScope,
    priceMinor,
    compareAtPriceMinor,
    stock,
    sku: null,
    category,
    slug,
    notes: notes ? [notes] : [],
    fieldStatus: status,
    needsReview: false,
    reviewReasons: reasons,
  };
  // SKU is normally blank (assigned on import). A supplied SKU is checked in
  // validateCatalogSheet and is only valid as the existing SKU of that product.
  const skuInput = text("SKU");
  if (skuInput) {
    row.sku = skuInput;
    status.sku = "explicit";
  }
  row.needsReview = reasons.length > 0;
  return row;
}

// Locked category structure: Mobile Phones, Accessories and Gadgets at the top level,
// with Laptops and Tablets as sub-categories of Gadgets. Each Product Type resolves to
// exactly one existing active category; categories are never created.
export const PRODUCT_TYPE_CATEGORY: Record<CatalogProductType, string> = {
  "Mobile Phone": "Mobile Phones",
  Accessory: "Accessories",
  Gadget: "Gadgets",
  Tablet: "Tablets",
  Laptop: "Laptops",
};

export function categoriesForProductType(productType: CatalogProductType, categories: string[]) {
  const accepted = lower(PRODUCT_TYPE_CATEGORY[productType]);
  return categories.filter((name) => lower(name) === accepted);
}

/**
 * Values the v2 staging preview genuinely requires per variant. Warranty, PTA,
 * Condition, Battery Health and Cycle Count may stay blank while staging; SKU is
 * blank for new variants because the database assigns it on import.
 */
export function catalogStagingMissingFacts(variant: Pick<BulkVariant, "priceMinor" | "inventory">) {
  const missing: string[] = [];
  if (variant.priceMinor === null || variant.priceMinor <= 0) missing.push("Price");
  if (variant.inventory === null || !Number.isInteger(variant.inventory) || variant.inventory < 0) missing.push("Stock");
  return missing;
}

/**
 * Cross-row and reference validation shared by Excel uploads and normalized raw stock.
 * Returns new row/specification objects; unknown or conflicting data is flagged, never fixed silently.
 */
export function validateCatalogSheet(
  rows: CatalogSheetRow[],
  specifications: CatalogSpecificationRow[],
  reference: CatalogReference,
): { rows: CatalogSheetRow[]; specifications: CatalogSpecificationRow[] } {
  const brandNames = new Map(reference.brands.map((name) => [lower(name), name]));
  const categoryNames = new Map(reference.categories.map((name) => [lower(name), name]));
  const flag = (row: CatalogSheetRow, field: CatalogField | null, reason: string) => {
    if (field) row.fieldStatus[field] = "needs_review";
    if (!row.reviewReasons.includes(reason)) row.reviewReasons.push(reason);
    row.needsReview = true;
  };
  const validated = rows.map((source) => ({
    ...source,
    notes: [...source.notes],
    fieldStatus: { ...source.fieldStatus },
    reviewReasons: [...source.reviewReasons],
  }));

  for (const row of validated) {
    if (row.brand) {
      const canonical = brandNames.get(lower(row.brand));
      if (!canonical) flag(row, "brand", `Brand not found among active brands: "${row.brand}"`);
      else if (canonical !== row.brand) {
        row.brand = canonical;
        row.productTitle = row.model ? `${canonical} ${row.model}` : row.productTitle;
      }
    }
    if (row.category) {
      const canonical = categoryNames.get(lower(row.category));
      if (!canonical) flag(row, "category", `Category not found among active categories: "${row.category}"`);
      else {
        row.category = canonical;
        const expected = row.productType ? PRODUCT_TYPE_CATEGORY[row.productType] : null;
        if (expected && lower(expected) !== lower(canonical))
          flag(row, "category", `Category "${canonical}" does not match Product Type ${row.productType} (expected ${expected})`);
      }
    } else if (row.productType) {
      const matches = categoriesForProductType(row.productType, reference.categories);
      if (matches.length === 1) {
        row.category = matches[0];
        row.fieldStatus.category = "inferred";
      } else if (matches.length > 1)
        flag(row, "category", `Category is ambiguous for ${row.productType}: ${matches.join(" / ")}`);
      else flag(row, "category", `No active category matches Product Type ${row.productType}`);
    } else {
      flag(row, "category", "Category cannot be resolved without a Product Type");
    }
    // Locked business rule: mobile phones deliver in Karachi only.
    if (row.productType === "Mobile Phone" && row.deliveryScope === null) {
      row.deliveryScope = "karachi_only";
      row.fieldStatus.deliveryScope = "inferred";
    }
    if (row.priceMinor === null) flag(row, "priceMinor", "Price is required");
  }

  const identities = new Map<string, CatalogSheetRow>();
  for (const row of validated) {
    if (!row.slug) continue;
    const first = identities.get(row.slug);
    if (!first) {
      identities.set(row.slug, row);
      continue;
    }
    const checks: Array<[CatalogField, string, unknown, unknown]> = [
      ["brand", "Brand", first.brand, row.brand],
      ["model", "Model", first.model?.toLowerCase() ?? null, row.model?.toLowerCase() ?? null],
      ["productType", "Product Type", first.productType, row.productType],
      ["category", "Category", first.category?.toLowerCase() ?? null, row.category?.toLowerCase() ?? null],
      ["action", "Action", first.action, row.action],
    ];
    for (const [field, label, left, right] of checks) {
      if (left !== null && right !== null && left !== right)
        flag(row, field, `${label} conflicts with ${first.sourceLine} for product ${row.slug}`);
    }
  }

  const variantRows = new Map<string, CatalogSheetRow>();
  for (const row of validated) {
    const key = catalogVariantKey(row);
    const first = variantRows.get(key);
    if (first) flag(row, null, `Duplicate variant (same as ${first.sourceLine})`);
    else variantRows.set(key, row);
  }

  // SKUs. Blank is normal: the database assigns the next SKU for the product's prefix on
  // import. A supplied SKU is never generated or rewritten here; it is only accepted as an
  // existing SKU of the same product (Replace Existing keeps it). Anything else needs review.
  const existingSkuOwners = new Map(
    (reference.existingSkus ?? []).map((item) => [item.sku.trim().toUpperCase(), item.productSlug] as const),
  );
  const suppliedSkus = new Map<string, CatalogSheetRow[]>();
  for (const row of validated) {
    if (!row.sku) continue;
    const sku = row.sku.trim().toUpperCase();
    const owner = existingSkuOwners.get(sku);
    if (owner === undefined)
      flag(row, "sku", `SKU ${sku} is not an existing catalog SKU; leave SKU blank for new variants (assigned on import)`);
    else if (owner !== row.slug) flag(row, "sku", `SKU ${sku} belongs to another product (${owner})`);
    else row.sku = sku;
    suppliedSkus.set(sku, [...(suppliedSkus.get(sku) ?? []), row]);
  }
  for (const [sku, matches] of suppliedSkus) {
    if (matches.length < 2) continue;
    for (const row of matches) flag(row, "sku", `Duplicate SKU ${sku} (${matches.map((item) => item.sourceLine).join(", ")})`);
  }

  const slugs = new Set(validated.map((row) => row.slug).filter(Boolean));
  const validatedSpecifications = specifications.map((source) => {
    const specification = { ...source, reviewReasons: [...source.reviewReasons] };
    if (!slugs.has(specification.productKey))
      specification.reviewReasons.push(`Unknown Product Key "${specification.productKey}" (no matching Slug in Products)`);
    specification.needsReview = specification.reviewReasons.length > 0;
    return specification;
  });

  return { rows: validated, specifications: validatedSpecifications };
}

/** Reads an uploaded catalog workbook and validates it against current reference data. */
export async function readCatalogWorkbook(
  data: ArrayBuffer | Uint8Array,
  reference: CatalogReference,
): Promise<CatalogWorkbookData> {
  const ExcelJS = await loadExcelJs();
  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(data as ArrayBuffer);
  } catch {
    return { rows: [], specifications: [], fileErrors: ["The file could not be read as an .xlsx workbook."] };
  }
  const fileErrors: string[] = [];
  const products = sheetByName(workbook, "Products");
  const specSheet = sheetByName(workbook, "Specifications");
  if (!products) fileErrors.push('Missing required sheet "Products".');
  if (!specSheet) fileErrors.push('Missing required sheet "Specifications".');
  const lists = sheetByName(workbook, "Lists");
  if (lists) {
    const templateHeader = headerMap(lists, ["Template"] as const);
    const column = templateHeader.positions.get("Template");
    const version = column ? asText(readCell(lists.getRow(2).getCell(column))) : null;
    if (version && version !== CATALOG_TEMPLATE_VERSION)
      fileErrors.push(`Unsupported template version "${version}"; download a fresh template.`);
  }
  if (!products || !specSheet || fileErrors.length) return { rows: [], specifications: [], fileErrors };

  const productHeaders = headerMap(products, PRODUCT_HEADERS, HEADER_ALIASES);
  const missingProductHeaders = productHeaders.missing.filter((header) => !OPTIONAL_PRODUCT_HEADERS.includes(header));
  if (missingProductHeaders.length)
    fileErrors.push(`Products sheet is missing required column(s): ${missingProductHeaders.join(", ")}.`);
  const specHeaders = headerMap(specSheet, SPECIFICATION_HEADERS);
  if (specHeaders.missing.length)
    fileErrors.push(`Specifications sheet is missing required column(s): ${specHeaders.missing.join(", ")}.`);
  if (fileErrors.length) return { rows: [], specifications: [], fileErrors };

  const rows: CatalogSheetRow[] = [];
  products.eachRow((excelRow, rowNumber) => {
    if (rowNumber === 1) return;
    const record: Partial<Record<ProductHeader, CellInput>> = {};
    for (const [header, column] of productHeaders.positions) record[header] = readCell(excelRow.getCell(column));
    if (Object.values(record).every((value) => value === null)) return;
    rows.push(catalogRowFromRecord(record, rowNumber));
  });

  const specifications: CatalogSpecificationRow[] = [];
  specSheet.eachRow((excelRow, rowNumber) => {
    if (rowNumber === 1) return;
    const cell = (header: (typeof SPECIFICATION_HEADERS)[number]) =>
      asText(readCell(excelRow.getCell(specHeaders.positions.get(header)!)));
    const key = cell("Product Key");
    const section = cell("Section");
    const name = cell("Specification Name");
    const value = cell("Specification Value");
    if (!key && !section && !name && !value) return;
    const reasons: string[] = [];
    if (!key) reasons.push("Product Key is required");
    if (!name) reasons.push("Specification Name is required");
    if (!value) reasons.push("Specification Value is required");
    specifications.push({
      rowNumber,
      productKey: key ? catalogSlug(key) : "",
      section,
      name,
      value,
      needsReview: reasons.length > 0,
      reviewReasons: reasons,
    });
  });

  return { ...validateCatalogSheet(rows, specifications, reference), fileErrors };
}

// ---------------------------------------------------------------------------
// Bridge into the existing Bulk Import preview
// ---------------------------------------------------------------------------

function toBulkVariant(row: CatalogSheetRow): BulkVariant {
  const source = (value: unknown) => (value === null ? ("unresolved" as const) : ("Owner supplied explicitly" as const));
  return {
    source: row.sourceLine,
    sku: row.sku,
    ram: row.ram,
    storage: row.storage,
    color: row.color,
    pricePkr: row.priceMinor === null ? null : pkrMajorInputFromMinor(row.priceMinor),
    priceMinor: row.priceMinor,
    compareAtPricePkr: row.compareAtPriceMinor === null ? null : pkrMajorInputFromMinor(row.compareAtPriceMinor),
    compareAtPriceMinor: row.compareAtPriceMinor,
    ptaStatus: row.ptaStatus ?? "unknown",
    ptaSource: source(row.ptaStatus),
    condition: row.condition ?? "unknown",
    conditionSource: source(row.condition),
    warranty: row.warranty,
    // The auto-filled Android "1 Year" stays distinct from an Owner-supplied warranty, so it
    // never replaces a warranty already stored on the product or variant.
    warrantySource:
      row.fieldStatus.warranty === "default" && row.warranty !== null
        ? ANDROID_MOBILE_WARRANTY_SOURCE
        : source(row.warranty),
    deliveryScope: row.deliveryScope,
    deliverySource: source(row.deliveryScope),
    inventory: row.stock,
    warnings: [...row.reviewReasons],
    conditionGrade: row.conditionGrade,
    batteryHealth: row.batteryHealth,
    cycleCount: row.cycleCount,
    simConfiguration: row.simConfiguration,
  };
}

/**
 * Groups catalog rows by product key (slug) into the existing BulkParseResult preview model.
 * Both Bulk Upload v2 sources (pasted wholesale lists and Excel uploads) pass through here, so
 * the Android "1 Year" warranty default is applied here, before Bulk Preview. It is not written
 * into generated workbooks, so a re-uploaded file never turns it into an explicit value.
 */
export function catalogSheetToBulkParseResult(
  data: Pick<CatalogWorkbookData, "rows" | "specifications"> & { fileErrors?: string[] },
): BulkParseResult {
  const groups = new Map<string, CatalogSheetRow[]>();
  for (const row of applyAndroidMobileWarrantyDefault(data.rows)) {
    const key = row.slug ?? `unkeyed-${row.lineNumber}`;
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  const products: BulkProduct[] = [...groups.entries()].map(([key, rows]) => {
    const [first] = rows;
    const specifications = data.specifications.filter((specification) => specification.productKey === key);
    const warnings = specifications.flatMap((specification) =>
      specification.reviewReasons.map((reason) => `Specifications row ${specification.rowNumber}: ${reason}`),
    );
    return {
      source: rows.map((row) => row.sourceLine).join(", "),
      title: first.productTitle ?? first.model ?? "(model missing)",
      brand: first.brand ?? "",
      brandExplicit: Boolean(first.brand),
      category: first.category,
      categoryExplicit: Boolean(first.category),
      slug: first.slug,
      shortDescription: null,
      seoTitle: null,
      seoDescription: null,
      defaultPtaStatus: null,
      defaultPtaSource: "unresolved",
      defaultCondition: null,
      defaultConditionSource: "unresolved",
      defaultWarranty: null,
      defaultWarrantySource: "unresolved",
      defaultDeliveryScope: null,
      defaultDeliverySource: "unresolved",
      notes: [...new Set(rows.flatMap((row) => row.notes))],
      specifications: specifications
        .filter((specification) => specification.name && specification.value)
        .map((specification) => ({
          source: `Specifications row ${specification.rowNumber}`,
          group: specification.section,
          label: specification.name!,
          value: specification.value!,
        })),
      diagnostics: [],
      variants: rows.map(toBulkVariant),
      warnings,
      requestedAction: first.action,
      productType: first.productType,
    };
  });
  const orphanErrors = data.specifications
    .filter((specification) => !groups.has(specification.productKey))
    .flatMap((specification) => specification.reviewReasons.map((reason) => `Specifications row ${specification.rowNumber}: ${reason}`));
  return { format: "catalog_sheet", products, errors: [...(data.fileErrors ?? []), ...orphanErrors] };
}
