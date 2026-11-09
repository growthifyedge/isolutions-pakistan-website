/**
 * Home Gadgets subcategory bulk assignment (Admin): Excel/CSV of SKU → subcategory → read-only preview → confirmed save.
 * The save is ONE call to admin_assign_product_subcategories (migration 202611090001), which re-validates every row on
 * the server and writes nothing unless all rows are valid; it changes only products.subcategory_id (never
 * publication_status, name, price, variant, stock, description or image). Products are matched by exact SKU only.
 * Nothing is inferred: a blank or unknown subcategory is an error, never a guess. A product that already has a
 * different subcategory is changed only when the Owner ticks it. PRODUCTION also needs a typed phrase.
 */
import { csvRows } from "./bulkCatalog.ts";
import { commercialWriteTarget } from "./commercialDefaults.ts";
import { ACCESSORIES_EXTRA_PRODUCT_IDS } from "./collections.ts";
import { HOME_GADGET_SUBCATEGORIES, HOME_GADGET_SUBCATEGORY_PARENT, matchHomeGadgetSubcategory } from "./homeGadgetSubcategories.ts";

export const SUBCATEGORY_UPLOAD_HEADERS = ["SKU", "Subcategory", "Product Name (optional check)"] as const;

export type SubRowCategory =
  | "Assign"
  | "Change"
  | "Unchanged"
  | "SKU Not Found"
  | "Missing Subcategory"
  | "Unknown Subcategory"
  | "Duplicate"
  | "Not Allowed";
export const SUB_ROW_CATEGORIES: readonly SubRowCategory[] = [
  "Assign", "Change", "Unchanged", "SKU Not Found", "Missing Subcategory", "Unknown Subcategory", "Duplicate", "Not Allowed",
];
/** Rows that can be saved (Change only when ticked). */
export const SAVABLE: readonly SubRowCategory[] = ["Assign", "Change"];

export type SubUploadRow = { rowNumber: number; sku: string; subcategory: string; productName: string };
export type SubCatalogProduct = {
  id: string;
  title: string;
  publication_status: string;
  categorySlug: string | null;
  subcategoryId: string | null;
  skus: string[];
};
export type SubcategoryRef = { id: string; name: string; slug: string; is_active: boolean; categorySlug: string | null };
export type PlannedSubRow = SubUploadRow & {
  category: SubRowCategory;
  messages: string[];
  product: SubCatalogProduct | null;
  target: SubcategoryRef | null;
  current: SubcategoryRef | null;
};
export type SubUploadPlan = { rows: PlannedSubRow[]; counts: Record<SubRowCategory, number>; fileErrors: string[] };

const squash = (text: unknown) => String(text ?? "").replace(/\s+/g, " ").trim();
const key = (text: string) => squash(text).toLowerCase();
export const normalizeSku = (text: unknown) => squash(text).toUpperCase();

// ---------------- reading ----------------

const COLUMN_ALIASES = {
  sku: (h: string) => h === "sku" || h === "variant sku",
  subcategory: (h: string) => h === "subcategory" || h === "sub category" || h === "home gadgets subcategory" || h === "sub-category",
  name: (h: string) => h.startsWith("product name") || h === "title",
};

/** Header row → rows. Columns found by name (case/spacing ignored); other columns are ignored. */
export function subcategoryRowsFromTable(table: readonly (readonly unknown[])[]): { rows: SubUploadRow[]; fileErrors: string[] } {
  const headerIndex = table.findIndex((row) => row.some((cell) => squash(cell)));
  if (headerIndex < 0) return { rows: [], fileErrors: ["The file is empty."] };
  const header = table[headerIndex].map((cell) => key(String(cell ?? "")));
  const find = (test: (h: string) => boolean) => header.findIndex(test);
  const col = { sku: find(COLUMN_ALIASES.sku), subcategory: find(COLUMN_ALIASES.subcategory), name: find(COLUMN_ALIASES.name) };
  const missing = [col.sku < 0 ? "SKU" : null, col.subcategory < 0 ? "Subcategory" : null].filter(Boolean);
  if (missing.length) return { rows: [], fileErrors: [`Missing column(s): ${missing.join(", ")}. Download the template.`] };
  const rows: SubUploadRow[] = [];
  table.slice(headerIndex + 1).forEach((row, offset) => {
    if (!row.some((cell) => squash(cell))) return;
    rows.push({
      rowNumber: headerIndex + offset + 2,
      sku: normalizeSku(row[col.sku]),
      subcategory: squash(row[col.subcategory]),
      productName: col.name >= 0 ? squash(row[col.name]) : "",
    });
  });
  if (!rows.length) return { rows, fileErrors: ["The file has no SKU rows."] };
  return { rows, fileErrors: [] };
}

export const subcategoryRowsFromCsv = (text: string) => subcategoryRowsFromTable(csvRows(text.replace(/^\uFEFF/, "")));

const cellText = (value: unknown): string => {
  if (value === null || value === undefined) return "";
  if (typeof value !== "object") return String(value);
  const object = value as { richText?: { text: string }[]; text?: unknown; result?: unknown };
  if (object.richText) return object.richText.map((part) => part.text).join("");
  if (object.text !== undefined) return cellText(object.text);
  if (object.result !== undefined) return cellText(object.result);
  return "";
};

/** Reads the "Assignments" sheet, else the first sheet that is not Instructions / Owner Review / Summary. */
export async function subcategoryRowsFromXlsx(bytes: ArrayBuffer) {
  const { loadExcelJs } = await import("./catalogWorkbook.ts");
  const ExcelJS = await loadExcelJs();
  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(bytes);
  } catch {
    return { rows: [], fileErrors: ["The file could not be read as an .xlsx workbook."] };
  }
  const sheet = workbook.worksheets.find((entry) => key(entry.name) === "assignments")
    ?? workbook.worksheets.find((entry) => !/instruction|review|summary|hold|subcategories/i.test(entry.name));
  if (!sheet) return { rows: [], fileErrors: ["The workbook has no Assignments sheet."] };
  const table: string[][] = [];
  sheet.eachRow({ includeEmpty: true }, (row) => {
    const cells: string[] = [];
    for (let column = 1; column <= Math.max(row.cellCount, SUBCATEGORY_UPLOAD_HEADERS.length); column += 1) cells.push(cellText(row.getCell(column).value));
    table.push(cells);
  });
  return subcategoryRowsFromTable(table);
}

// ---------------- template ----------------

const csvCell = (text: string) => (/[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text);
export const subcategoryTemplateCsv = () => `${SUBCATEGORY_UPLOAD_HEADERS.map(csvCell).join(",")}\r\n`;

export async function subcategoryTemplateXlsx(): Promise<ArrayBuffer> {
  const { loadExcelJs } = await import("./catalogWorkbook.ts");
  const ExcelJS = await loadExcelJs();
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Assignments");
  sheet.addRow([...SUBCATEGORY_UPLOAD_HEADERS]);
  sheet.columns.forEach((column, index) => (column.width = [12, 26, 70][index]));
  const list = workbook.addWorksheet("Subcategories");
  list.addRow(["Subcategory", "Slug"]);
  HOME_GADGET_SUBCATEGORIES.forEach((entry) => list.addRow([entry.name, entry.slug]));
  list.getColumn(1).width = 26;
  list.getColumn(2).width = 24;
  const help = workbook.addWorksheet("Instructions");
  [
    ["One row per SKU. SKU must match exactly (e.g. GD032). Subcategory = one of the 10 names (or slugs) on the Subcategories sheet."],
    ["Product Name is optional; when filled it must match the product title, as an extra check."],
    ["A blank or unknown subcategory is an error — nothing is guessed. Only Home Gadgets (category Gadgets) products can be assigned."],
    ["Only the subcategory is saved. Publication status, names, prices, variants, stock, descriptions and images are never changed."],
  ].forEach((row) => help.addRow(row));
  help.getColumn(1).width = 140;
  return (await workbook.xlsx.writeBuffer()) as ArrayBuffer;
}

// ---------------- planning ----------------

export function planSubcategoryUpload(
  rows: readonly SubUploadRow[],
  catalog: readonly SubCatalogProduct[],
  subcategories: readonly SubcategoryRef[],
  excludedProductIds: readonly string[] = ACCESSORIES_EXTRA_PRODUCT_IDS,
): SubUploadPlan {
  const bySku = new Map<string, SubCatalogProduct>();
  for (const product of catalog) for (const sku of product.skus) bySku.set(normalizeSku(sku), product);
  const subById = new Map(subcategories.map((entry) => [entry.id, entry]));
  const subBySlug = new Map(subcategories.map((entry) => [entry.slug, entry]));
  const excluded = new Set(excludedProductIds);

  const planned = rows.map((row): PlannedSubRow => {
    const base = { ...row, product: null, target: null, current: null, messages: [] as string[] };
    if (!row.sku) return { ...base, category: "SKU Not Found", messages: ["SKU is empty."] };
    const product = bySku.get(row.sku) ?? null;
    if (!product) return { ...base, category: "SKU Not Found", messages: [`No product has the SKU ${row.sku}.`] };
    const current = product.subcategoryId ? subById.get(product.subcategoryId) ?? null : null;
    const withProduct = { ...base, product, current };
    if (row.productName && key(row.productName) !== key(product.title))
      return { ...withProduct, category: "Not Allowed", messages: [`Product Name "${row.productName}" does not match "${product.title}".`] };
    if (product.categorySlug !== HOME_GADGET_SUBCATEGORY_PARENT)
      return { ...withProduct, category: "Not Allowed", messages: [`${row.sku} is in category ${product.categorySlug ?? "unknown"}, not Gadgets.`] };
    if (excluded.has(product.id))
      return { ...withProduct, category: "Not Allowed", messages: ["Watches / Bands stay in Mobile Accessories and out of Home Gadgets."] };
    if (!row.subcategory) return { ...withProduct, category: "Missing Subcategory", messages: ["Subcategory is blank — left for Owner review, nothing is guessed."] };
    const known = matchHomeGadgetSubcategory(row.subcategory);
    const target = known ? subBySlug.get(known.slug) ?? null : null;
    if (!target) return { ...withProduct, category: "Unknown Subcategory", messages: [`"${row.subcategory}" is not one of the 10 Home Gadgets subcategories.`] };
    if (!target.is_active) return { ...withProduct, target, category: "Unknown Subcategory", messages: [`${target.name} is not active.`] };
    if (current?.id === target.id) return { ...withProduct, target, category: "Unchanged", messages: ["Already in this subcategory."] };
    if (current) return { ...withProduct, target, category: "Change", messages: [`Currently ${current.name}. Kept unless you tick Change.`] };
    return { ...withProduct, target, category: "Assign", messages: [] };
  });

  // Duplicates. Rows that agree → the first row stays, later rows are ignored as Duplicate. Rows that disagree (a
  // different or blank subcategory) → every one of them is a conflicting Duplicate and none is saved (never a pick).
  const wanted = (row: PlannedSubRow) => matchHomeGadgetSubcategory(row.subcategory)?.slug ?? `raw:${key(row.subcategory)}`;
  const resolveGroup = (list: PlannedSubRow[], sameMessage: (first: PlannedSubRow, row: PlannedSubRow) => string) => {
    if (list.length < 2) return;
    if (new Set(list.map(wanted)).size > 1) {
      for (const row of list) {
        row.category = "Duplicate";
        row.messages = [`Conflict: rows ${list.map((entry) => entry.rowNumber).join(", ")} disagree on the subcategory. None is saved.`];
      }
      return;
    }
    for (const row of list.slice(1)) {
      row.category = "Duplicate";
      row.messages = [sameMessage(list[0], row)];
    }
  };
  // 1. The same SKU more than once.
  const rowsBySku = new Map<string, PlannedSubRow[]>();
  for (const row of planned) if (row.sku) rowsBySku.set(row.sku, [...(rowsBySku.get(row.sku) ?? []), row]);
  for (const list of rowsBySku.values()) resolveGroup(list, (first, row) => `SKU ${row.sku} already appears in row ${first.rowNumber}; this row is ignored.`);
  // 2. Different SKUs of one product (rows still savable or unchanged).
  const byProduct = new Map<string, PlannedSubRow[]>();
  for (const row of planned) {
    if (!row.product || !row.target || !["Assign", "Change", "Unchanged"].includes(row.category)) continue;
    byProduct.set(row.product.id, [...(byProduct.get(row.product.id) ?? []), row]);
  }
  for (const list of byProduct.values()) resolveGroup(list, (first) => `Same product as row ${first.rowNumber} (${first.sku}); this row is ignored.`);

  const counts = Object.fromEntries(SUB_ROW_CATEGORIES.map((category) => [category, planned.filter((row) => row.category === category).length])) as Record<SubRowCategory, number>;
  return { rows: planned, counts, fileErrors: [] };
}

/** Rows that will be saved: every Assign plus the Change rows the Owner ticked. */
export const selectSubcategoryWrites = (plan: SubUploadPlan, change: ReadonlySet<number>) =>
  plan.rows.filter((row) => row.product && row.target && (row.category === "Assign" || (row.category === "Change" && change.has(row.rowNumber))));

export const subcategoryConfirmationPhrase = (count: number) => `ASSIGN ${count} SUBCATEGORIES`;
export const subcategoryNeedsTypedConfirmation = (environment: "development" | "production" | null) => environment === "production";

/** The RPC payload: server-side SKU resolution, with the subcategory the preview showed (detects edits since). */
export const subcategoryRpcPayload = (writes: readonly PlannedSubRow[]) =>
  writes.map((row) => ({ sku: row.sku, subcategory: row.target!.slug, expected_current: row.current?.slug ?? null }));

// ---------------- saving ----------------

export type SubReadBack = { id: string; subcategoryId: string | null; publication_status: string };
export type SubUploadDeps = {
  supabaseUrl: string | undefined;
  buildMode: string | undefined;
  assign: (payload: ReturnType<typeof subcategoryRpcPayload>) => Promise<{ total: number; updated: number; unchanged: number }>;
  readBack: (productIds: string[]) => Promise<SubReadBack[]>;
};
export type SubUploadResult = {
  outcome: "verified" | "failed" | "blocked";
  message: string;
  verified: number;
  problems: string[];
};

export async function runSubcategoryUpload(
  plan: SubUploadPlan,
  options: { change: ReadonlySet<number>; confirmed: boolean; typed: string },
  deps: SubUploadDeps,
): Promise<SubUploadResult> {
  const blocked = (message: string): SubUploadResult => ({ outcome: "blocked", message, verified: 0, problems: [] });
  const target = commercialWriteTarget(deps.supabaseUrl, deps.buildMode);
  if (!target.allowed) return blocked(`${target.reason ?? "Blocked: unknown environment."} Nothing was changed.`);
  const writes = selectSubcategoryWrites(plan, options.change);
  if (!writes.length) return blocked("Nothing to save.");
  if (!options.confirmed) return blocked("Tick the confirmation first. Nothing was changed.");
  const phrase = subcategoryConfirmationPhrase(writes.length);
  if (subcategoryNeedsTypedConfirmation(target.environment) && options.typed !== phrase)
    return blocked(`Type ${phrase} to confirm saving to PRODUCTION.`);

  const productIds = writes.map((row) => row.product!.id);
  const before = new Map((await deps.readBack(productIds)).map((row) => [row.id, row]));
  try {
    await deps.assign(subcategoryRpcPayload(writes));
  } catch (reason) {
    return { outcome: "failed", message: `Not saved — the server refused the file (nothing was changed): ${reason instanceof Error ? reason.message : String(reason)}`, verified: 0, problems: [] };
  }
  const after = new Map((await deps.readBack(productIds)).map((row) => [row.id, row]));
  const problems: string[] = [];
  let verified = 0;
  for (const row of writes) {
    const now = after.get(row.product!.id);
    const was = before.get(row.product!.id);
    if (!now) problems.push(`${row.sku}: could not be read back.`);
    else if (now.subcategoryId !== row.target!.id) problems.push(`${row.sku}: subcategory reads back as ${now.subcategoryId ?? "none"}.`);
    else if (was && now.publication_status !== was.publication_status) problems.push(`${row.sku}: publication status changed ${was.publication_status} → ${now.publication_status}.`);
    else verified += 1;
  }
  return {
    outcome: problems.length ? "failed" : "verified",
    message: `${verified} of ${writes.length} subcategory assignment(s) saved and verified${problems.length ? ". See the problems below." : "; publication status unchanged."}`,
    verified,
    problems,
  };
}
