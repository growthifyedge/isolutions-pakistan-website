/**
 * Descriptions Bulk Upload (Admin): Excel/CSV → preview → save. Updates ONLY products.content ("Product content") and,
 * when the file has a non-empty value, products.short_description. publication_status is never sent, so a published
 * product stays published; prices, stock, variants, media and specifications are never written and are compared
 * before/after every save. Products are matched only by exact Product ID or Slug, and a given Product Name must match.
 * A stored description is replaced only when the Owner ticks Replace. PRODUCTION also needs a typed phrase.
 */
import { csvRows } from "./bulkCatalog.ts";
import { commercialWriteTarget } from "./commercialDefaults.ts";

export const DESCRIPTION_UPLOAD_HEADERS = ["Product Name", "Product Slug or Product ID", "Product content", "Short description"] as const;
export const DESCRIPTION_UPLOAD_EXAMPLE = ["JBL Tune 660NC", "jbl-tune-660nc", "First paragraph.\n\nSecond paragraph.", ""];
export const MAX_CONTENT = 10000;
export const MAX_SHORT = 500;

export type DescRowCategory = "New Description" | "Replace" | "Unchanged" | "Product Not Found" | "Invalid Row";
export const DESC_ROW_CATEGORIES: readonly DescRowCategory[] = ["New Description", "Replace", "Unchanged", "Product Not Found", "Invalid Row"];

export type DescUploadRow = { rowNumber: number; productName: string; productKey: string; content: string; shortDescription: string };
export type DescCatalogProduct = { id: string; title: string; slug: string; content: string | null; short_description: string | null; publication_status: string };
export type DescPatch = { content: string; short_description?: string };
export type PlannedDescRow = DescUploadRow & {
  category: DescRowCategory;
  messages: string[];
  product: DescCatalogProduct | null;
  patch: DescPatch | null;
};
export type DescUploadPlan = { rows: PlannedDescRow[]; counts: Record<DescRowCategory, number>; exactMatchProducts: number; fileErrors: string[] };

const squash = (text: unknown) => String(text ?? "").replace(/\s+/g, " ").trim();
const key = (text: string) => squash(text).toLowerCase();
/** Multi-line text as stored: CRLF → LF, trailing spaces per line and outer blank lines removed. Paragraphs are kept. */
export const normalizeText = (text: unknown) =>
  String(text ?? "").replace(/\r\n?/g, "\n").split("\n").map((line) => line.replace(/[ \t]+$/g, "")).join("\n").trim();

// ---------------- reading ----------------

const COLUMN_ALIASES = {
  name: (h: string) => h === "product name" || h.startsWith("product name "),
  key: (h: string) => ["product slug or product id", "slug", "product slug", "product id", "id"].includes(h),
  content: (h: string) => h === "product content" || h === "description" || h.startsWith("description "),
  short: (h: string) => h === "short description",
};

/** Header row → rows. Columns found by name (case/spacing ignored); extra columns such as "#", "SKU(s)", "Done?" are ignored. */
export function descriptionRowsFromTable(table: readonly (readonly unknown[])[]): { rows: DescUploadRow[]; fileErrors: string[] } {
  const headerIndex = table.findIndex((row) => row.some((cell) => squash(cell)));
  if (headerIndex < 0) return { rows: [], fileErrors: ["The file is empty."] };
  const header = table[headerIndex].map((cell) => key(String(cell ?? "")));
  const find = (test: (h: string) => boolean) => header.findIndex(test);
  const col = { name: find(COLUMN_ALIASES.name), key: find(COLUMN_ALIASES.key), content: find(COLUMN_ALIASES.content), short: find(COLUMN_ALIASES.short) };
  const missing = [col.key < 0 ? "Product Slug or Product ID" : null, col.content < 0 ? "Product content" : null].filter(Boolean);
  if (missing.length) return { rows: [], fileErrors: [`Missing column(s): ${missing.join(", ")}. Download the template.`] };
  const rows: DescUploadRow[] = [];
  table.slice(headerIndex + 1).forEach((row, offset) => {
    if (!row.some((cell) => squash(cell))) return;
    rows.push({
      rowNumber: headerIndex + offset + 2,
      productName: col.name >= 0 ? squash(row[col.name]) : "",
      productKey: squash(row[col.key]),
      content: normalizeText(row[col.content]),
      shortDescription: col.short >= 0 ? normalizeText(row[col.short]) : "",
    });
  });
  if (!rows.length) return { rows, fileErrors: ["The file has no description rows."] };
  return { rows, fileErrors: [] };
}

export const descriptionRowsFromCsv = (text: string) => descriptionRowsFromTable(csvRows(text.replace(/^\uFEFF/, "")));

const cellText = (value: unknown): string => {
  if (value === null || value === undefined) return "";
  if (typeof value !== "object") return String(value);
  const object = value as { richText?: { text: string }[]; text?: unknown; result?: unknown };
  if (object.richText) return object.richText.map((part) => part.text).join("");
  if (object.text !== undefined) return cellText(object.text);
  if (object.result !== undefined) return cellText(object.result);
  return value instanceof Date ? value.toISOString() : "";
};

/** Reads the "Descriptions" sheet, else the first sheet that is not Instructions / HOLD. */
export async function descriptionRowsFromXlsx(bytes: ArrayBuffer) {
  const { loadExcelJs } = await import("./catalogWorkbook.ts");
  const ExcelJS = await loadExcelJs();
  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(bytes);
  } catch {
    return { rows: [], fileErrors: ["The file could not be read as an .xlsx workbook."] };
  }
  const sheet = workbook.worksheets.find((entry) => key(entry.name) === "descriptions")
    ?? workbook.worksheets.find((entry) => !/instruction|hold/i.test(entry.name));
  if (!sheet) return { rows: [], fileErrors: ["The workbook has no sheet."] };
  const table: string[][] = [];
  sheet.eachRow({ includeEmpty: true }, (row) => {
    const cells: string[] = [];
    for (let column = 1; column <= Math.max(row.cellCount, DESCRIPTION_UPLOAD_HEADERS.length); column += 1) cells.push(cellText(row.getCell(column).value));
    table.push(cells);
  });
  return descriptionRowsFromTable(table);
}

// ---------------- template ----------------

const csvCell = (text: string) => (/[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text);
export const descriptionTemplateCsv = () => `${DESCRIPTION_UPLOAD_HEADERS.map(csvCell).join(",")}\r\n`;

export async function descriptionTemplateXlsx(): Promise<ArrayBuffer> {
  const { loadExcelJs } = await import("./catalogWorkbook.ts");
  const ExcelJS = await loadExcelJs();
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Descriptions");
  sheet.addRow([...DESCRIPTION_UPLOAD_HEADERS]);
  sheet.columns.forEach((column, index) => (column.width = [30, 32, 90, 40][index]));
  const help = workbook.addWorksheet("Instructions");
  [
    ["One row per product. Product Slug or Product ID must match exactly; Product Name must match the product title."],
    ["Product content = the description shown on the product page. Leave a blank line between paragraphs (Alt+Enter twice in Excel)."],
    ["Short description is optional; an empty cell leaves the stored short description unchanged."],
    ["Only these two fields are saved. Publication status, prices, stock, variants, images and specifications are never changed."],
    [DESCRIPTION_UPLOAD_HEADERS.map((header, index) => `${header}: ${DESCRIPTION_UPLOAD_EXAMPLE[index] || "(empty)"}`).join("  ·  ")],
  ].forEach((row) => help.addRow(row));
  help.getColumn(1).width = 140;
  return (await workbook.xlsx.writeBuffer()) as ArrayBuffer;
}

// ---------------- planning ----------------

export function findDescriptionProduct(row: DescUploadRow, catalog: readonly DescCatalogProduct[]) {
  if (!row.productKey) return { product: null, message: "Product Slug or Product ID is empty." };
  const product = catalog.find((entry) => entry.id === row.productKey) ?? catalog.find((entry) => entry.slug === row.productKey) ?? null;
  if (!product) return { product: null, message: `No product has the exact ID or slug "${row.productKey}".` };
  if (row.productName && key(row.productName) !== key(product.title))
    return { product: null, message: `Product Name "${row.productName}" does not match "${product.title}" for ${row.productKey}.` };
  return { product, message: null };
}

export function planDescriptionUpload(rows: readonly DescUploadRow[], catalog: readonly DescCatalogProduct[]): DescUploadPlan {
  const seen = new Set<string>();
  const planned = rows.map((row): PlannedDescRow => {
    const base = { ...row, product: null, patch: null, messages: [] as string[] };
    const problems: string[] = [];
    if (!row.content) problems.push("Product content is empty.");
    else if (row.content.length > MAX_CONTENT) problems.push(`Product content is longer than ${MAX_CONTENT} characters.`);
    if (row.shortDescription.length > MAX_SHORT) problems.push(`Short description is longer than ${MAX_SHORT} characters.`);
    const { product, message } = findDescriptionProduct(row, catalog);
    if (!product) return { ...base, category: problems.length ? "Invalid Row" : "Product Not Found", messages: [...problems, ...(message ? [message] : [])] };
    if (problems.length) return { ...base, product, category: "Invalid Row", messages: problems };
    if (seen.has(product.id)) return { ...base, product, category: "Invalid Row", messages: ["This product already appears in an earlier row."] };
    seen.add(product.id);
    const storedContent = normalizeText(product.content);
    const storedShort = normalizeText(product.short_description);
    const patch: DescPatch = { content: row.content };
    if (row.shortDescription && row.shortDescription !== storedShort) patch.short_description = row.shortDescription;
    const contentChanges = row.content !== storedContent;
    if (!contentChanges && !patch.short_description) return { ...base, product, category: "Unchanged", messages: ["The same description is already stored."] };
    const replacing = (contentChanges && storedContent !== "") || (Boolean(patch.short_description) && storedShort !== "");
    return {
      ...base,
      product,
      patch,
      category: replacing ? "Replace" : "New Description",
      messages: replacing ? ["A different description is stored. Kept unless you tick Replace."] : [],
    };
  });
  const counts = Object.fromEntries(DESC_ROW_CATEGORIES.map((category) => [category, planned.filter((row) => row.category === category).length])) as Record<DescRowCategory, number>;
  return { rows: planned, counts, exactMatchProducts: new Set(planned.filter((row) => row.product).map((row) => row.product!.id)).size, fileErrors: [] };
}

/** Rows that will be saved: every New Description plus the Replace rows the Owner ticked. */
export const selectDescriptionWrites = (plan: DescUploadPlan, replace: ReadonlySet<number>) =>
  plan.rows.filter((row) => row.patch && (row.category === "New Description" || (row.category === "Replace" && replace.has(row.rowNumber))));

export const descriptionConfirmationPhrase = (count: number) => `APPLY ${count} DESCRIPTIONS`;
export const descriptionNeedsTypedConfirmation = (environment: "development" | "production" | null) => environment === "production";

// ---------------- saving ----------------

export type DescProductState = { content: string | null; short_description: string | null; publication_status: string };
/** Everything that must NOT change: variant prices/stock, media and specification counts. */
export type DescProductSnapshot = string;
export type DescUploadDeps = {
  supabaseUrl: string | undefined;
  buildMode: string | undefined;
  readProduct: (productId: string) => Promise<DescProductState>;
  readSnapshot: (productId: string) => Promise<DescProductSnapshot>;
  updateDescription: (productId: string, patch: DescPatch) => Promise<void>;
  onProgress?: (done: number, total: number, current: string | null) => void;
};
export type DescCheck = { name: string; ok: boolean; detail: string };
export type DescProductResult = { rowNumber: number; productId: string; title: string; status: "verified" | "failed" | "skipped"; message: string; checks: DescCheck[] };
export type DescUploadResult = { outcome: "verified" | "partial" | "blocked"; message: string; products: DescProductResult[] };

export async function runDescriptionUpload(
  plan: DescUploadPlan,
  options: { replace: ReadonlySet<number>; typed: string },
  deps: DescUploadDeps,
): Promise<DescUploadResult> {
  const target = commercialWriteTarget(deps.supabaseUrl, deps.buildMode);
  if (!target.allowed) return { outcome: "blocked", message: target.reason ?? "Blocked: unknown environment.", products: [] };
  const writes = selectDescriptionWrites(plan, options.replace);
  if (!writes.length) return { outcome: "blocked", message: "Nothing to save.", products: [] };
  const phrase = descriptionConfirmationPhrase(writes.length);
  if (descriptionNeedsTypedConfirmation(target.environment) && options.typed !== phrase)
    return { outcome: "blocked", message: `Type ${phrase} to confirm saving to PRODUCTION.`, products: [] };

  const results: DescProductResult[] = [];
  for (const [index, row] of writes.entries()) {
    const product = row.product!;
    const patch = row.patch!;
    deps.onProgress?.(index, writes.length, product.title);
    const result = (status: DescProductResult["status"], message: string, checks: DescCheck[] = []) =>
      results.push({ rowNumber: row.rowNumber, productId: product.id, title: product.title, status, message, checks });
    try {
      const before = await deps.readProduct(product.id);
      // The stored text must still be what the preview showed (nobody edited it since).
      if (normalizeText(before.content) !== normalizeText(product.content) || normalizeText(before.short_description) !== normalizeText(product.short_description)) {
        result("skipped", "The stored description changed after the preview. Upload the file again.");
        continue;
      }
      const snapshotBefore = await deps.readSnapshot(product.id);
      await deps.updateDescription(product.id, patch);
      const after = await deps.readProduct(product.id);
      const snapshotAfter = await deps.readSnapshot(product.id);
      const expectedShort = patch.short_description ?? normalizeText(before.short_description);
      const checks: DescCheck[] = [
        { name: "Product content", ok: normalizeText(after.content) === patch.content, detail: normalizeText(after.content) === patch.content ? "saved text read back exactly" : "read-back text differs" },
        { name: "Short description", ok: normalizeText(after.short_description) === expectedShort, detail: patch.short_description ? "updated" : "unchanged" },
        { name: "Publication status", ok: after.publication_status === before.publication_status, detail: `${before.publication_status} → ${after.publication_status}` },
        { name: "Prices, stock, variants, images, specifications", ok: snapshotAfter === snapshotBefore, detail: snapshotAfter === snapshotBefore ? "unchanged" : "changed" },
      ];
      const ok = checks.every((check) => check.ok);
      result(ok ? "verified" : "failed", ok ? "Saved and verified." : "Saved, but a read-back check failed.", checks);
    } catch (reason) {
      result("failed", reason instanceof Error ? reason.message : String(reason));
    }
  }
  deps.onProgress?.(writes.length, writes.length, null);
  const verified = results.filter((entry) => entry.status === "verified").length;
  return {
    outcome: verified === writes.length ? "verified" : "partial",
    message: `${verified} of ${writes.length} description(s) saved and verified${verified === writes.length ? "." : ". See the failed or skipped products below."}`,
    products: results,
  };
}
