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
    // A valid workbook ExcelJS cannot open (e.g. written by the Open XML SDK with "x:"-prefixed XML, as ChatGPT does):
    // read its cell text with the minimal reader, under the same sheet rules.
    try {
      const { readXlsxTables } = await import("./xlsxTableReader.ts");
      const tables = await readXlsxTables(bytes);
      const table = tables.find((entry) => key(entry.name) === "specifications") ?? tables.find((entry) => !isInstructionsSheet(entry.name));
      if (!table) return { rows: [], fileErrors: ["The workbook has no sheet."] };
      return rowsFromTable(table.rows);
    } catch {
      return { rows: [], fileErrors: ["The file could not be read as an .xlsx workbook."] };
    }
  }
  // The Instructions and GPT Instructions sheets (and the example) are never read as data: any sheet whose name contains
  // "instructions" is skipped even when the Specifications sheet was renamed or moved.
  const sheet = workbook.worksheets.find((entry) => key(entry.name) === "specifications") ?? workbook.worksheets.find((entry) => !isInstructionsSheet(entry.name));
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
    ["Single product: choose the product in Admin first; then Product Slug or Product ID may be left blank (Admin uses the chosen product's ID) and Product Name must be that product's title."],
    ["A file for several products: Product Slug or Product ID must be the exact slug or id; Product Name must equal that product's title."],
    [`Section must be one of: ${SPEC_SECTIONS.join(", ")}.`],
    ["Do not put RAM / storage / colour here: they belong to variants."],
    ["Keep it concise: up to 4 General Features (Section Other), 4 Display, 2 Performance + 2 Memory (Section Performance), 4 Camera, 3 Battery, 4 Connectivity, 2 Software and 3 Build rows. No N/A or repeated values, and no PTA, price, stock, condition, warranty, delivery or colour."],
    ["Default upload adds missing specifications only; a different stored value is shown as a Conflict."],
    [""],
    ["EXAMPLE — for reference only, NOT imported. Type your rows on the Specifications sheet:"],
    [SPEC_UPLOAD_HEADERS.map((header, index) => `${header}: ${SPEC_UPLOAD_EXAMPLE[index]}`).join("  ·  ")],
  ].forEach((row) => help.addRow(row));
  help.getColumn(1).width = 110;
  // GPT Instructions (Owner-approved 2026-11-23): the reusable research prompt, text only, never imported.
  const gpt = workbook.addWorksheet(GPT_INSTRUCTIONS_SHEET);
  gpt.getColumn(1).width = 120;
  SPEC_GPT_PROMPT_LINES.forEach((line, index) => {
    const row = gpt.addRow([line]);
    row.getCell(1).alignment = { wrapText: true, vertical: "top" };
    if (index === 0) row.font = { bold: true, size: 14 };
    else if (SPEC_GPT_PROMPT_HEADINGS.includes(line)) row.font = { bold: true, size: 12 };
  });
  return (await workbook.xlsx.writeBuffer()) as ArrayBuffer;
}

export const GPT_INSTRUCTIONS_SHEET = "GPT Instructions";
const isInstructionsSheet = (name: string) => key(name).includes("instructions");

const SPEC_GPT_PROMPT_HEADINGS: readonly string[] = ["Mandatory Research Rules", "Excel Rules", "Row Limits", "Verification and Final Output"];
/**
 * The Owner's research prompt, exactly as approved (one line per row on the GPT Instructions sheet).
 * 2026-11-24 (Owner-approved, localhost): "Row Limits" block (maximum rows per section, mapped to the template's
 * section names; no N/A / repeats / commercial facts / colour); the numbered rules are unchanged.
 * 2026-11-24 (Owner-approved): rule 21 added — GPT leaves Product Slug or Product ID blank; Admin's selected product
 * supplies it. The research / no-guessing rules are unchanged; later rules renumbered 22–26.
 */
export const SPEC_GPT_PROMPT_LINES: readonly string[] = [
  "ISOLUTIONS PAKISTAN — GPT PRODUCT SPECIFICATIONS RESEARCHER",
  "You are an expert Product Specifications Researcher and Excel Data Specialist for iSolutions Pakistan.",
  "Product Model: [OWNER WILL PROVIDE EXACT MODEL NAME]",
  "Your objective: Research the exact product model, verify its technical specifications, fill the attached Excel template, and return a completed upload-ready Excel file.",
  "",
  "Mandatory Research Rules",
  "1. Read the attached Excel workbook completely, including its GPT Instructions worksheet.",
  "2. Research the exact manufacturer, model, generation and regional variant specified by the Owner.",
  "3. Prioritize official manufacturer specification pages, official product documentation and trustworthy technical sources.",
  "4. Cross-check uncertain specifications against independent reliable sources.",
  "5. Never guess or fabricate specifications.",
  "6. Never copy specifications from similar models, older generations, Plus/Pro/Ultra variants or different regional versions.",
  "7. If any specification cannot be verified reliably, leave its value blank.",
  "8. Do not substitute general product-family specifications for model-specific facts.",
  "9. Respect differences in chipset, RAM, storage, cameras, display, battery, charging, SIM, network and connectivity.",
  "10. Never invent PTA status, warranty, prices, stock, availability or product condition.",
  "11. If the exact model identification is ambiguous, explicitly flag the ambiguity rather than selecting a model without evidence.",
  "",
  "Excel Rules",
  "12. Preserve the existing workbook format, worksheet names, column headers, identifiers and required upload structure.",
  "13. Fill only the intended specification-value cells.",
  "14. Do not delete, rename or reorder existing upload columns.",
  "15. Do not create duplicate specification rows.",
  "16. Do not overwrite verified existing values with uncertain information.",
  "17. Keep unsupported or unknown specification values blank.",
  "18. Ensure values are concise, technically accurate and suitable for a customer-facing product page.",
  "19. Never insert research notes, citations or explanations into cells reserved for specification values.",
  "20. Do not alter SKU, product identifiers or model references unless explicitly instructed by the Owner.",
  "21. Leave the \"Product Slug or Product ID\" column blank: never fill an internal product ID or slug. The Owner selects the exact product in Admin, which supplies its database ID. Put only the exact product name in \"Product Name\" on every row.",
  "",
  "Row Limits",
  "Keep the sheet concise. Maximum rows per section (the Section column must use the template's section names shown in brackets):",
  "- General Features: up to 4 rows (Section \"Other\")",
  "- Display: up to 4 rows (Section \"Display\")",
  "- Performance: up to 2 rows, chipset / processor (Section \"Performance\")",
  "- Memory: up to 2 rows, memory type or card slot only (Section \"Performance\", in addition to the 2 performance rows); RAM and storage sizes belong to the variants, not here",
  "- Camera: up to 4 rows (Section \"Camera\")",
  "- Battery: up to 3 rows, capacity and charging (Section \"Battery\")",
  "- Connectivity: up to 4 rows (Section \"Connectivity\")",
  "- Software: up to 2 rows (Section \"Software\")",
  "- Build / Design: up to 3 rows (Section \"Build\")",
  "- Audio and Security are not part of this list: leave them out.",
  "- Leave out N/A, unknown or empty values, values repeated under another label, and minor technical details.",
  "- Never include PTA status, price, stock, condition, warranty, delivery or colour.",
  "- These limits apply to the full specification sheet (at most 28 rows). The website's Top 7 compact view is chosen automatically from these rows; do not limit the sheet to 7.",
  "",
  "Verification and Final Output",
  "22. Review all completed specifications for factual accuracy, consistency and correct units.",
  "23. Validate that the workbook remains compatible with the original iSolutions specification upload template.",
  "24. Return the completed .xlsx file, ready for Admin → Spec Upload.",
  "25. Provide a brief research summary, official source links and any unresolved specifications separately in the chat.",
  "26. Do not claim successful website upload or publication. The Owner controls the final Apply action.",
  "",
  "Approval Rule: The final ChatGPT-verified specification sheet is considered business-approved under the existing Owner workflow. No additional individual specification approval checklist is required; unverified fields must remain blank.",
];

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

/**
 * Single Product with a product chosen in Admin (Owner-approved 2026-11-24): every row of the file belongs to that
 * product, whose real database id is used; the file's Product Slug or Product ID may be blank. The WHOLE file is refused
 * (nothing previewed, nothing saved) when it names another product: a key that is not the chosen product's id or slug,
 * more than one product name, or a name that is not the chosen product's title. Nothing is silently re-assigned.
 */
export function assignSelectedProduct(rows: readonly UploadRow[], product: CatalogSpecProduct): { rows: UploadRow[]; fileErrors: string[] } {
  const fileErrors: string[] = [];
  const otherKeys = [...new Set(rows.map((row) => row.productKey).filter((value) => value && value !== product.id && value !== product.slug))];
  if (otherKeys.length) fileErrors.push(`This file names ${otherKeys.length === 1 ? "another product" : `${otherKeys.length} other products`} (${otherKeys.map((value) => `“${value}”`).join(", ")}), not “${product.title}” (${product.slug}). Nothing was uploaded — choose the right product or fix the file.`);
  const names = [...new Map(rows.filter((row) => row.productName).map((row) => [key(row.productName), row.productName])).values()];
  if (names.length > 1) fileErrors.push(`This file names ${names.length} different products (${names.map((value) => `“${value}”`).join(", ")}). Upload one product per file.`);
  else if (names.length === 1 && key(names[0]) !== key(product.title)) fileErrors.push(`This file is for “${names[0]}”, but you chose “${product.title}”. Nothing was uploaded — choose the right product or fix the Product Name.`);
  if (fileErrors.length) return { rows: [], fileErrors };
  return { rows: rows.map((row) => ({ ...row, productName: product.title, productKey: product.id })), fileErrors: [] };
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
