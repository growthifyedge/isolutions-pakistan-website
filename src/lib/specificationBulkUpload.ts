/**
 * Specifications Bulk Upload: specifications from a manually prepared spreadsheet (CSV / XLSX).
 *
 * Rules:
 *   - A row's product is found ONLY by its exact Product ID or exact Product Slug, and the Product Name must equal
 *     that product's title (case / spacing ignored). No fuzzy, similar-model or name-only matching.
 *   - New specifications are added. A different stored value is a Conflict and is overwritten only when the Owner
 *     ticks that row. Nothing is ever deleted. Works for every category and condition.
 *   - Each product is saved all or nothing by ONE call to apply_product_specifications (insert new rows, update
 *     ticked values only while they still equal the previewed value). One product failing never blocks another.
 *   - Only public.product_specifications is written. Products, variants, prices, stock, media and publication are
 *     read before and after and must be identical.
 *   - PRODUCTION needs the typed phrase "APPLY <n> SPECS"; DEVELOPMENT saves with the button alone.
 */
import { csvRows } from "./bulkCatalog.ts";
import { commercialWriteTarget } from "./commercialDefaults.ts";
import type { CommercialSnapshot } from "./commercialDefaults.ts";
import { SPEC_SECTIONS } from "./productSpecificationExtraction.ts";
import { verifySpecificationWrite, type CatalogSpecProduct, type ExistingSpec, type PlanEntry, type SpecApplyCheck } from "./specificationApply.ts";

export const SPEC_UPLOAD_HEADERS = ["Product Name", "Product Slug or Product ID", "Section", "Label", "Value"] as const;
/** Shown on the Instructions sheet only, as one line of text (never a data row, so it can never be imported). */
export const SPEC_UPLOAD_EXAMPLE =["Realme C75x", "realme-c75x", "Battery", "Battery Capacity", "5600 mAh"];
const MAX_LABEL = 120;
const MAX_VALUE = 600;

export type UploadRow = { rowNumber: number; productName: string; productKey: string; section: string; label: string; value: string };

export type RowCategory = "New Spec" | "Already Present" | "Conflict" | "Product Not Found" | "Invalid Row";
export const ROW_CATEGORIES: readonly RowCategory[] = ["New Spec", "Already Present", "Conflict", "Product Not Found", "Invalid Row"];

export type PlannedRow = UploadRow & {
  category: RowCategory;
  messages: string[];
  product: CatalogSpecProduct | null;
  /** The stored row this one matches (same section + label, case / spacing ignored). */
  existing: ExistingSpec | null;
  /** Conflicts only: the stored row can be overwritten (same section). */
  overwritable: boolean;
};

export type UploadPlan = {
  rows: PlannedRow[];
  counts: Record<RowCategory, number>;
  /** Products matched exactly (by id or slug, name confirmed). */
  exactMatchProducts: number;
  fileErrors: string[];
};

const clean = (text: unknown) => String(text ?? "").replace(/\s+/g, " ").trim();
const key = (text: string) => clean(text).toLowerCase();

// ---------------- reading ----------------

/** Header row -> rows. Column order is free; header names must match (case / spacing ignored). */
export function rowsFromTable(table: readonly (readonly unknown[])[]): { rows: UploadRow[]; fileErrors: string[] } {
  const headerIndex = table.findIndex((row) => row.some((cell) => clean(cell)));
  if (headerIndex < 0) return { rows: [], fileErrors: ["The file is empty."] };
  const header = table[headerIndex].map((cell) => key(String(cell ?? "")));
  const position = (name: string) => header.indexOf(key(name));
  const missing = SPEC_UPLOAD_HEADERS.filter((name) => position(name) < 0);
  if (missing.length) return { rows: [], fileErrors: [`Missing column(s): ${missing.join(", ")}. Download the template.`] };
  const at = (row: readonly unknown[], name: string) => clean(row[position(name)]);
  const rows: UploadRow[] = [];
  table.slice(headerIndex + 1).forEach((row, offset) => {
    if (!row.some((cell) => clean(cell))) return;
    rows.push({
      rowNumber: headerIndex + offset + 2,
      productName: at(row, "Product Name"),
      productKey: at(row, "Product Slug or Product ID"),
      section: at(row, "Section"),
      label: at(row, "Label"),
      value: String(row[position("Value")] ?? "").trim(),
    });
  });
  if (!rows.length) return { rows, fileErrors: ["The file has no specification rows."] };
  return { rows, fileErrors: [] };
}

export const rowsFromCsv = (text: string) => rowsFromTable(csvRows(text.replace(/^\uFEFF/, "")));

/** Cell value as text: rich text, hyperlinks and formulas give their visible text. */
const cellText = (value: unknown): string => {
  if (value === null || value === undefined) return "";
  if (typeof value !== "object") return String(value);
  const object = value as { richText?: { text: string }[]; text?: unknown; result?: unknown };
  if (object.richText) return object.richText.map((part) => part.text).join("");
  if (object.text !== undefined) return cellText(object.text);
  if (object.result !== undefined) return cellText(object.result);
  return value instanceof Date ? value.toISOString() : "";
};

export async function rowsFromXlsx(bytes: ArrayBuffer) {
  const { loadExcelJs } = await import("./catalogWorkbook.ts");
  const ExcelJS = await loadExcelJs();
  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(bytes);
  } catch {
    return { rows: [], fileErrors: ["The file could not be read as an .xlsx workbook."] };
  }
  // The Instructions sheet (and its example) is never read as data.
  const sheet = workbook.worksheets.find((entry) => key(entry.name) === "specifications") ?? workbook.worksheets.find((entry) => key(entry.name) !== "instructions");
  if (!sheet) return { rows: [], fileErrors: ["The workbook has no sheet."] };
  const table: string[][] = [];
  sheet.eachRow({ includeEmpty: true }, (row) => {
    const cells: string[] = [];
    for (let column = 1; column <= Math.max(row.cellCount, SPEC_UPLOAD_HEADERS.length); column += 1) cells.push(cellText(row.getCell(column).value));
    table.push(cells);
  });
  return rowsFromTable(table);
}

// ---------------- template ----------------

const csvCell = (text: string) => (/[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text);
/** Headers only: no product or specification row. */
export const specUploadTemplateCsv = () => `${SPEC_UPLOAD_HEADERS.map(csvCell).join(",")}\r\n`;

export async function specUploadTemplateXlsx(): Promise<ArrayBuffer> {
  const { loadExcelJs } = await import("./catalogWorkbook.ts");
  const ExcelJS = await loadExcelJs();
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Specifications");
  sheet.addRow([...SPEC_UPLOAD_HEADERS]);
  sheet.getRow(1).font = { bold: true };
  sheet.columns.forEach((column, index) => (column.width = [28, 30, 16, 26, 40][index]));
  (sheet as unknown as { dataValidations: { add(range: string, validation: object): void } }).dataValidations.add("C2:C2000", { type: "list", allowBlank: false, formulae: [`"${SPEC_SECTIONS.join(",")}"`] });
  const help = workbook.addWorksheet("Instructions");
  [
    ["One row = one specification of one product."],
    ["Product Slug or Product ID must be the exact slug or id; Product Name must equal that product's title."],
    [`Section must be one of: ${SPEC_SECTIONS.join(", ")}.`],
    ["Do not put RAM / storage / colour here: they belong to variants."],
    ["Default upload adds missing specifications only; a different stored value is shown as a Conflict."],
    [""],
    ["EXAMPLE — for reference only, NOT imported. Type your rows on the Specifications sheet:"],
    [SPEC_UPLOAD_HEADERS.map((header, index) => `${header}: ${SPEC_UPLOAD_EXAMPLE[index]}`).join("  ·  ")],
  ].forEach((row) => help.addRow(row));
  help.getColumn(1).width = 110;
  return (await workbook.xlsx.writeBuffer()) as ArrayBuffer;
}

// ---------------- plan (pure, read-only) ----------------

function rowProblems(row: UploadRow): string[] {
  const problems: string[] = [];
  if (!row.productName) problems.push("Product Name is empty.");
  if (!row.productKey) problems.push("Product Slug or Product ID is empty.");
  if (!SPEC_SECTIONS.includes(row.section as (typeof SPEC_SECTIONS)[number])) problems.push(`Section "${row.section}" is not one of: ${SPEC_SECTIONS.join(", ")}.`);
  if (!row.label) problems.push("Label is empty.");
  else if (row.label.length > MAX_LABEL) problems.push(`Label is longer than ${MAX_LABEL} characters.`);
  if (!row.value) problems.push("Value is empty.");
  else if (row.value.length > MAX_VALUE) problems.push(`Value is longer than ${MAX_VALUE} characters.`);
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(`${row.label}${row.value}`)) problems.push("Contains control characters.");
  return problems;
}

/** Exact product only: id or slug must match exactly one product, and the name must equal its title. */
export function findProduct(row: UploadRow, catalog: readonly CatalogSpecProduct[]): { product: CatalogSpecProduct | null; message: string | null } {
  const byId = catalog.filter((product) => product.id === row.productKey);
  const bySlug = catalog.filter((product) => product.slug === row.productKey);
  const hits = byId.length ? byId : bySlug;
  if (hits.length === 0) return { product: null, message: `No product has the exact id or slug "${row.productKey}".` };
  if (hits.length > 1) return { product: null, message: `"${row.productKey}" matches ${hits.length} products; none is picked.` };
  if (key(hits[0].title) !== key(row.productName)) return { product: null, message: `"${row.productKey}" is "${hits[0].title}", not "${row.productName}". The name must match exactly.` };
  return { product: hits[0], message: null };
}

export function planSpecificationUpload(rows: readonly UploadRow[], catalog: readonly CatalogSpecProduct[], existing: readonly ExistingSpec[]): UploadPlan {
  const stored = new Map<string, ExistingSpec[]>();
  for (const spec of existing) stored.set(spec.product_id, [...(stored.get(spec.product_id) ?? []), spec]);
  const seen = new Map<string, UploadRow>();
  const matched = new Set<string>();
  const planned = rows.map((row): PlannedRow => {
    const base = { ...row, product: null, existing: null, overwritable: false };
    const problems = rowProblems(row);
    if (problems.length) return { ...base, category: "Invalid Row", messages: problems };
    const found = findProduct(row, catalog);
    if (!found.product) return { ...base, category: "Product Not Found", messages: [found.message!] };
    const product = found.product;
    matched.add(product.id);
    const duplicateKey = `${product.id}|${key(row.label)}`;
    const earlier = seen.get(duplicateKey);
    if (earlier) return { ...base, product, category: "Invalid Row", messages: [`Same product and label as row ${earlier.rowNumber}; each label once per product.`] };
    seen.set(duplicateKey, row);
    const mine = stored.get(product.id) ?? [];
    const sameLabel = mine.filter((spec) => key(spec.label) === key(row.label));
    const sameSection = sameLabel.find((spec) => key(spec.specification_group ?? "") === key(row.section));
    if (sameSection) {
      if (clean(sameSection.value) === clean(row.value)) return { ...base, product, existing: sameSection, category: "Already Present", messages: ["The same value is already stored."] };
      return { ...base, product, existing: sameSection, overwritable: true, category: "Conflict", messages: [`Stored value: "${sameSection.value}". Kept unless you tick Overwrite and confirm.`] };
    }
    if (sameLabel.length)
      return { ...base, product, existing: sameLabel[0], category: "Conflict", messages: [`"${sameLabel[0].label}" is stored under section "${sameLabel[0].specification_group ?? "—"}" ("${sameLabel[0].value}"). Not changed by this upload.`] };
    return { ...base, product, category: "New Spec", messages: [] };
  });
  const counts = Object.fromEntries(ROW_CATEGORIES.map((category) => [category, planned.filter((row) => row.category === category).length])) as Record<RowCategory, number>;
  return { rows: planned, counts, exactMatchProducts: matched.size, fileErrors: [] };
}

// ---------------- apply ----------------

/** Rows that would be written: every New Spec, plus the Conflicts the Owner ticked for overwrite. */
export function selectWrites(plan: UploadPlan, overwrite: ReadonlySet<number>) {
  const creates = plan.rows.filter((row) => row.category === "New Spec");
  const updates = plan.rows.filter((row) => row.category === "Conflict" && row.overwritable && overwrite.has(row.rowNumber));
  return { creates, updates, total: creates.length + updates.length };
}

export const specUploadConfirmationPhrase = (count: number) => `APPLY ${count} SPECS`;
/** The typed phrase is the PRODUCTION safety confirmation; DEVELOPMENT needs none. */
export const specUploadNeedsTypedConfirmation = (environment: "development" | "production" | null) => environment === "production";

export type SpecInsert = { specification_group: string; label: string; value: string };
export type SpecValueUpdate = { id: string; expected_value: string; value: string };

export type SpecUploadDeps = {
  supabaseUrl: string | undefined | null;
  buildMode: string | undefined | null;
  readSpecs: (productId: string) => Promise<ExistingSpec[]>;
  readProduct: (productId: string) => Promise<Record<string, unknown>>;
  readSnapshot: (productId: string) => Promise<CommercialSnapshot>;
  /** ONE all-or-nothing save for one product (apply_product_specifications). Throws when anything is refused. */
  applyProductSpecs: (productId: string, inserts: SpecInsert[], updates: SpecValueUpdate[]) => Promise<{ inserted: number; updated: number }>;
  onProgress?: (done: number, total: number, current: string | null) => void;
};

export type SpecUploadProductResult = {
  productId: string;
  title: string;
  status: "verified" | "blocked" | "failed";
  message: string;
  checks: SpecApplyCheck[];
  /** Rows this product was asked to add / overwrite. */
  creates: number;
  updates: number;
};
export type SpecUploadResult = { outcome: "verified" | "issues" | "blocked"; message: string; products: SpecUploadProductResult[]; written: number };

export type SpecUploadSummary = { New: number; Updated: number; "Already Present": number; Skipped: number; Failed: number };

/**
 * Row counts after a save. New / Updated = rows saved and read back; Already Present = same value stored;
 * Skipped = not written on purpose (Conflict not ticked, Product Not Found, Invalid Row, or a product that changed since
 * the preview); Failed = rows of a product whose save failed or whose read-back did not match.
 */
export function summarizeUpload(plan: UploadPlan, overwrite: ReadonlySet<number>, result: SpecUploadResult): SpecUploadSummary {
  const { creates, updates } = selectWrites(plan, overwrite);
  const statusOf = new Map(result.products.map((product) => [product.productId, product.status]));
  const summary: SpecUploadSummary = { New: 0, Updated: 0, "Already Present": plan.counts["Already Present"], Skipped: 0, Failed: 0 };
  for (const [rows, saved] of [[creates, "New"], [updates, "Updated"]] as const) {
    for (const row of rows) {
      const status = statusOf.get(row.product!.id);
      if (status === "verified") summary[saved] += 1;
      else if (status === "failed") summary.Failed += 1;
      else summary.Skipped += 1;
    }
  }
  summary.Skipped += plan.rows.length - creates.length - updates.length - plan.counts["Already Present"];
  return summary;
}

const messageOf = (error: unknown) => (error instanceof Error && error.message ? error.message : "unknown error");

/**
 * Saves the selected rows product by product: matching build + project only (typed phrase on PRODUCTION), each
 * product's specifications re-read and re-planned first (anything changed since the preview = that product is
 * blocked), ONE all-or-nothing save per product, then read-back verification of specs, product row, variants, prices,
 * stock, media and publication. One product failing never stops the others.
 */
export async function runSpecificationUpload(
  plan: UploadPlan,
  selection: { overwrite: ReadonlySet<number>; typed: string },
  catalog: readonly CatalogSpecProduct[],
  deps: SpecUploadDeps,
): Promise<SpecUploadResult> {
  const target = commercialWriteTarget(deps.supabaseUrl, deps.buildMode);
  if (!target.allowed) return { outcome: "blocked", message: `${target.reason ?? "Blocked: unknown environment."} Nothing was written.`, products: [], written: 0 };
  const { creates, updates, total } = selectWrites(plan, selection.overwrite);
  if (!total) return { outcome: "blocked", message: "Nothing to write. Nothing was written.", products: [], written: 0 };
  if (specUploadNeedsTypedConfirmation(target.environment) && selection.typed !== specUploadConfirmationPhrase(total))
    return { outcome: "blocked", message: `Type ${specUploadConfirmationPhrase(total)} to confirm. Nothing was written.`, products: [], written: 0 };

  const byProduct = new Map<string, PlannedRow[]>();
  for (const row of [...creates, ...updates]) byProduct.set(row.product!.id, [...(byProduct.get(row.product!.id) ?? []), row]);
  const results: SpecUploadProductResult[] = [];
  let written = 0;
  let done = 0;
  for (const [productId, rows] of byProduct) {
    const title = rows[0].product!.title;
    const asked = { creates: rows.filter((row) => row.category === "New Spec").length, updates: rows.filter((row) => row.category === "Conflict").length };
    deps.onProgress?.(done, byProduct.size, title);
    done += 1;
    try {
      const before = await deps.readSpecs(productId);
      const productRows = plan.rows.filter((row) => row.product?.id === productId).map(({ rowNumber, productName, productKey, section, label, value }) => ({ rowNumber, productName, productKey, section, label, value }));
      const replanned = planSpecificationUpload(productRows, catalog, before).rows;
      const unchanged = rows.every((row) => {
        const again = replanned.find((entry) => entry.rowNumber === row.rowNumber);
        return again && again.category === row.category && again.existing?.id === row.existing?.id && again.existing?.value === row.existing?.value;
      });
      if (!unchanged) {
        results.push({ productId, title, status: "blocked", message: "Stored specifications changed since the preview. Nothing written for this product; upload the file again.", checks: [], ...asked });
        continue;
      }
      const productBefore = await deps.readProduct(productId);
      const snapshotBefore = await deps.readSnapshot(productId);
      let order = before.reduce((max, spec) => Math.max(max, spec.sort_order), -1) + 1;
      const entries: PlanEntry[] = rows.map((row) => {
        const isUpdate = row.category === "Conflict";
        return {
          productId,
          productTitle: title,
          productKey: row.productKey,
          section: isUpdate ? (row.existing!.specification_group ?? row.section) : row.section,
          name: isUpdate ? row.existing!.label : row.label,
          value: row.value,
          kind: isUpdate ? "update" : "create",
          blockers: [],
          existingId: isUpdate ? row.existing!.id : null,
          existingValue: isUpdate ? row.existing!.value : null,
          sortOrder: isUpdate ? row.existing!.sort_order : order++,
        };
      });
      const toCreate = entries.filter((entry) => entry.kind === "create");
      const toUpdate = entries.filter((entry) => entry.kind === "update");
      // One all-or-nothing save for this product: every insert and ticked overwrite, or nothing.
      try {
        await deps.applyProductSpecs(
          productId,
          toCreate.map((entry) => ({ specification_group: entry.section, label: entry.name, value: entry.value })),
          toUpdate.map((entry) => ({ id: entry.existingId!, expected_value: entry.existingValue!, value: entry.value })),
        );
      } catch (error) {
        results.push({ productId, title, status: "failed", message: `Not saved: ${messageOf(error)}. This product is saved all or nothing; upload the file again to see its current state.`, checks: [], ...asked });
        continue;
      }
      written += entries.length;
      let checks: SpecApplyCheck[];
      try {
        const after = await deps.readSpecs(productId);
        checks = verifySpecificationWrite(entries, before, after, productBefore, await deps.readProduct(productId), snapshotBefore, await deps.readSnapshot(productId));
      } catch (error) {
        results.push({ productId, title, status: "failed", message: `Saved, but the read-back could not run: ${messageOf(error)}. Upload the file again to confirm its state.`, checks: [], ...asked });
        continue;
      }
      const ok = checks.every((check) => check.ok);
      results.push({ productId, title, status: ok ? "verified" : "failed", message: ok ? `${toCreate.length} added, ${toUpdate.length} overwritten; read-back verified.` : `Saved, but read-back FAILED: ${checks.filter((check) => !check.ok).map((check) => check.name).join(", ")}.`, checks, ...asked });
    } catch (error) {
      results.push({ productId, title, status: "failed", message: `Failed before saving: ${messageOf(error)}. Nothing was saved for this product.`, checks: [], ...asked });
    }
  }
  deps.onProgress?.(byProduct.size, byProduct.size, null);
  const clean = results.every((result) => result.status === "verified");
  return {
    outcome: clean ? "verified" : "issues",
    message: clean ? `Wrote and verified ${written} specification row(s) on ${results.length} product(s).` : `Finished with issues: ${results.filter((result) => result.status === "verified").length} verified, ${results.filter((result) => result.status !== "verified").length} not verified.`,
    products: results,
    written,
  };
}
