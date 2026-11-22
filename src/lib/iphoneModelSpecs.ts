/**
 * Model-Based Shared Specifications (iPhone + Android). Pure: nothing here reads from or writes to the database.
 *
 * Owner rule (2026-11-20/21): same phone model = same common specifications. "Apple iPhone 18 Pro Max",
 * "iPhone 18 Pro Max" and "Apple iPhone 18 Pro Max (Used)" are the same model, as are "Samsung A57" and
 * "Samsung A57 PTA 8/256GB", whatever their PTA status, condition, colour or storage. Each product keeps its own identity,
 * title, URL and variants; the model's common specifications are added to each matching product's own rows (the
 * existing product_specifications storage), never overwritten. Saving records them as the model's Owner-approved
 * common specifications, and products of that model added later receive them automatically (missing ones only).
 *
 * Mirrors public.model_title_core / public.iphone_model_key / public.model_spec_key / public.is_variant_specific_spec
 * (migration 202611200002); the server re-checks everything when saving.
 */
import { csvRows } from "./bulkCatalog.ts";
import { SPEC_SECTIONS } from "./productSpecificationExtraction.ts";
import type { CatalogSpecProduct, ExistingSpec } from "./specificationApply.ts";
import { planSpecificationUpload, type PlannedRow, type UploadRow } from "./specificationBulkUpload.ts";

const collapseLower = (text: string) => text.replace(/\s+/g, " ").trim().toLowerCase();

/** A trailing colour starts with one of these (last word of the title). Mirrors public.model_title_core. */
export const COLOUR_WORDS = ["black", "white", "blue", "green", "red", "purple", "pink", "gold", "silver", "gray", "grey", "graphite", "burgundy", "orange", "yellow", "violet", "lavender", "mint", "cream", "midnight", "starlight", "teal", "beige", "brown", "bronze", "copper", "navy", "titanium"] as const;
/** Words that may come before a trailing colour ("Natural Titanium", "Deep Blue", "Cosmic Orange"). */
export const COLOUR_MODIFIERS = ["natural", "desert", "cosmic", "deep", "sky", "light", "dark", "space", "jet", "rose", "sierra", "alpine", "pacific", "ice", "icy", "phantom", "awesome", "mist", "glacier", "ocean", "forest", "sunset", "lime", "lemon", "matte", "glossy"] as const;
const COLOUR = new Set<string>(COLOUR_WORDS);
const COLOUR_OR_MODIFIER = new Set<string>([...COLOUR_WORDS, ...COLOUR_MODIFIERS]);

/**
 * Title without the words that never change the model: PTA wording (PTA, PTA Approved, Non-PTA, also in brackets),
 * storage / RAM+storage (256GB, 1TB, 8/256GB, 8GB+256GB), a trailing "(Used)" and a trailing colour (only when the last
 * word is a known colour, e.g. "Burgundy", "Natural Titanium"). Lower case, single spaces. Mirrors public.model_title_core.
 */
export function modelTitleCore(title: string) {
  let v = collapseLower(title);
  v = v.replace(/(^| )\(?(?:pta[ -]approved|non[ -]?pta|pta)\)?(?= |$)/g, "");
  v = v.replace(/(^| )(?:\d+ ?(?:gb|tb)? ?[/+] ?)?\d+ ?(?:gb|tb)(?= |$)/g, "");
  v = collapseLower(v).replace(/ ?\(used\)$/, "");
  const words = v.split(" ");
  if (words.length > 1 && COLOUR.has(words[words.length - 1])) {
    words.pop();
    while (words.length > 1 && COLOUR_OR_MODIFIER.has(words[words.length - 1])) words.pop();
  }
  return words.join(" ");
}

/** Optional series words written after (or instead of) the brand: "Samsung Galaxy A57" = "Samsung A57" = "Galaxy A57". */
export const BRAND_SERIES_ALIASES: Readonly<Record<string, string>> = { samsung: "galaxy", motorola: "moto" };

/** "Apple iPhone 18 Pro Max (Used)" -> "iphone-18-pro-max"; null for anything not an exact, unambiguous iPhone model. */
export function iphoneModelKey(title: string | null | undefined): string | null {
  if (!title) return null;
  let v = modelTitleCore(title);
  v = v.replace(/ ?\(used\)$/, "");
  v = v.replace(/^apple /, "");
  v = v.replace(/([0-9])(pro|plus|mini)/g, "$1 $2");
  v = v.replace(/pro ?max/g, "pro max");
  if (v === "iphone air") return "iphone-air";
  let m = /^iphone (x|xr|xs|xs max)$/.exec(v);
  if (m) return `iphone-${m[1].replace(/ /g, "-")}`;
  m = /^iphone ([1-9][0-9]?)e$/.exec(v);
  if (m) return `iphone-${m[1]}e`;
  m = /^iphone ([1-9][0-9]?)(?: (pro max|pro|plus|mini))?$/.exec(v);
  if (m) return `iphone-${m[1]}${m[2] ? `-${m[2].replace(/ /g, "-")}` : ""}`;
  return null;
}

/** "iphone-18-pro-max" -> "iPhone 18 Pro Max". */
export function iphoneModelName(key: string) {
  const words = key.replace(/^iphone-/, "").split("-");
  const named = words.map((word) => (/^x[rs]?$/.test(word) ? word.toUpperCase() : /^[0-9]+e?$/.test(word) ? word : word[0].toUpperCase() + word.slice(1)));
  return `iPhone ${named.join(" ")}`;
}

/**
 * Android phone model key: brand slug + model, e.g. ("samsung", "Samsung Galaxy A57 PTA 8/256GB Black (Used)") -> "samsung-a57".
 * PTA wording, storage, "(Used)", a trailing colour, the brand name in front and the brand's series word (Galaxy, Moto)
 * are ignored; "15Pro" = "15 Pro". Every other word stays part
 * of the model (Pro, Pro+, Lite, FE, 5G...), so different models never share a key. Any other bracket (JV, Refurbished...)
 * = not an exact model (null). Mirrors public.model_spec_key.
 */
export function androidModelKey(brandSlug: string | null | undefined, title: string | null | undefined): string | null {
  if (!brandSlug || !title || !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(brandSlug)) return null;
  let v = modelTitleCore(title).replace(/ ?\(used\)$/, "");
  if (/[()]/.test(v)) return null;
  const brand = brandSlug.replace(/-/g, " ");
  if (v === brand) return null;
  if (v.startsWith(`${brand} `)) v = v.slice(brand.length + 1);
  const series = BRAND_SERIES_ALIASES[brandSlug];
  if (series && v === series) return null;
  if (series && v.startsWith(`${series} `)) v = v.slice(series.length + 1);
  v = v.replace(/([0-9])(pro|max|plus|ultra|lite|mini|neo|prime|fe)(?= |\+|$)/g, "$1 $2");
  v = v.replace(/pro ?max/g, "pro max");
  v = v.replace(/\+/g, " plus ").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return v ? `${brandSlug}-${v}` : null;
}

/** Model key for any phone in Mobile Phones: iPhone rules for Apple, Android rules for every other brand. */
export const phoneModelKey = (brandSlug: string | null | undefined, title: string | null | undefined) =>
  brandSlug === "apple" ? iphoneModelKey(title) : androidModelKey(brandSlug, title);

const VARIANT_LABEL = /(^|[^a-z])(storage|ram|memory|colou?rs?|price|pta|condition|warranty|battery health|battery cycles?|cycle count|grade|sim|stock|imei)([^a-z]|$)/i;
const VARIANT_GROUP = /^(storage|memory|variant|variants|price|pricing)$/i;

/** Variant facts (storage, RAM, colour, price, PTA, condition, warranty, battery health/cycles, grade, SIM…) are never shared. */
export function isVariantSpecificLabel(section: string, label: string) {
  return VARIANT_LABEL.test(label) || VARIANT_GROUP.test(section.trim());
}

export type IphoneCatalogProduct = CatalogSpecProduct & {
  brandSlug: string | null;
  categorySlug: string | null;
  publicationStatus: string;
  /** Distinct variant facts, for display only. */
  conditions: string[];
  ptaStatuses: string[];
  variantCount: number;
};

export type IphoneModelGroup = { key: string; name: string; kind: "iphone" | "android"; products: IphoneCatalogProduct[] };

/** Phones only: every brand in Mobile Phones (iPhone + Android). */
export const isPhoneCatalogProduct = (product: Pick<IphoneCatalogProduct, "brandSlug" | "categorySlug">) =>
  Boolean(product.brandSlug) && product.categorySlug === "mobile-phones";

/** Shortest title of the model without " (Used)", e.g. "Samsung A57". */
const androidModelName = (products: readonly IphoneCatalogProduct[]) =>
  products.map((product) => product.title.replace(/\s*\(used\)\s*$/i, "").trim()).sort((a, b) => a.length - b.length || a.localeCompare(b))[0];

/** Every exact phone model (iPhone + Android) with its products, plus phone titles that are ambiguous (never matched). */
export function groupPhoneModels(products: readonly IphoneCatalogProduct[]) {
  const groups = new Map<string, IphoneCatalogProduct[]>();
  const ambiguous: IphoneCatalogProduct[] = [];
  for (const product of products) {
    if (!isPhoneCatalogProduct(product)) continue;
    const key = phoneModelKey(product.brandSlug, product.title);
    if (!key) {
      ambiguous.push(product);
      continue;
    }
    groups.set(key, [...(groups.get(key) ?? []), product]);
  }
  const models: IphoneModelGroup[] = [...groups.entries()]
    .map(([key, entries]) => {
      const kind = entries[0].brandSlug === "apple" ? ("iphone" as const) : ("android" as const);
      return { key, kind, name: kind === "iphone" ? iphoneModelName(key) : androidModelName(entries), products: [...entries].sort((a, b) => a.title.localeCompare(b.title)) };
    })
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
  return { models, ambiguous: ambiguous.sort((a, b) => a.title.localeCompare(b.title)) };
}

// ---------------- the model's specifications ----------------

export const MODEL_SPEC_HEADERS = ["Section", "Label", "Value"] as const;
/** Optional column of the final verified sheet: a row whose status is not a "verified" word is never applied. */
export const MODEL_SPEC_STATUS_HEADERS = ["Status", "Verification", "Verified"] as const;
/** status: the sheet's Status cell (undefined when the sheet has no Status column). */
export type ModelSpec = { rowNumber: number; section: string; label: string; value: string; status?: string };

const clean = (text: unknown) => String(text ?? "").replace(/\s+/g, " ").trim();

/** Header row Section / Label / Value (+ optional Status; any order, case ignored) -> specifications. One model per file. */
export function modelSpecsFromTable(table: readonly (readonly unknown[])[]): { specs: ModelSpec[]; fileErrors: string[] } {
  const headerIndex = table.findIndex((row) => row.some((cell) => clean(cell)));
  if (headerIndex < 0) return { specs: [], fileErrors: ["The file is empty."] };
  const header = table[headerIndex].map((cell) => clean(cell).toLowerCase());
  const position = (name: string) => header.indexOf(name.toLowerCase());
  const missing = MODEL_SPEC_HEADERS.filter((name) => position(name) < 0);
  if (missing.length) return { specs: [], fileErrors: [`Missing column(s): ${missing.join(", ")}. Use the columns Section, Label, Value.`] };
  const statusColumn = MODEL_SPEC_STATUS_HEADERS.map(position).find((index) => index >= 0);
  const specs: ModelSpec[] = [];
  table.slice(headerIndex + 1).forEach((row, offset) => {
    if (!row.some((cell) => clean(cell))) return;
    specs.push({
      rowNumber: headerIndex + offset + 2,
      section: clean(row[position("Section")]),
      label: clean(row[position("Label")]),
      value: String(row[position("Value")] ?? "").trim(),
      ...(statusColumn === undefined ? {} : { status: clean(row[statusColumn]) }),
    });
  });
  return specs.length ? { specs, fileErrors: [] } : { specs, fileErrors: ["The file has no specification rows."] };
}

// ---------------- final verified sheet (Owner decision 2026-11-21) ----------------
// The Owner gives the specification file to ChatGPT, which verifies it against official sources and returns the final
// sheet. That final sheet IS the approval: no per-spec tick or typed phrase. Only rows that are clearly verified are
// applied; anything unverified or ambiguous is skipped (listed, never written).

const VERIFIED_STATUS = /^(verified|approved|official|confirmed|final|ok|yes|y|true|✓|✔)$/i;
const PLACEHOLDER_VALUE = /^(?:-+|—|–|n\/?a|na|none|tbd|tbc|tba|unknown|unverified|not verified|pending|to be confirmed|to be verified|check|\?+)$/i;

export type SkippedSpec = { rowNumber: number; label: string; reason: string };

/** Final verified sheet -> rows to apply + rows skipped (unverified / ambiguous / no value / variant fact). */
export function approvedSheetRows(specs: readonly ModelSpec[]): { apply: ModelSpec[]; skipped: SkippedSpec[] } {
  const apply: ModelSpec[] = [];
  const skipped: SkippedSpec[] = [];
  for (const spec of specs) {
    const skip = (reason: string) => skipped.push({ rowNumber: spec.rowNumber, label: spec.label || "(no label)", reason });
    if (spec.status !== undefined && !VERIFIED_STATUS.test(spec.status))
      skip(spec.status ? `status "${spec.status}" is not Verified` : "no status (not marked Verified)");
    else if (!spec.value) skip("no value");
    else if (PLACEHOLDER_VALUE.test(spec.value) || spec.value.includes("?")) skip(`value "${spec.value}" is not a verified value`);
    else if (spec.label && isVariantSpecificLabel(spec.section, spec.label)) skip("variant fact (storage, RAM, colour, price, PTA, condition, warranty, battery, grade or SIM) — never shared");
    else apply.push(spec);
  }
  return { apply, skipped };
}

export const modelSpecsFromCsv = (text: string) => modelSpecsFromTable(csvRows(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text));

export const modelSpecTemplateCsv = () => `${MODEL_SPEC_HEADERS.join(",")}\r\n`;

const cellText = (value: unknown): string => {
  if (value === null || value === undefined) return "";
  if (typeof value !== "object") return String(value);
  const object = value as { richText?: { text: string }[]; text?: unknown; result?: unknown };
  if (object.richText) return object.richText.map((part) => part.text).join("");
  if (object.text !== undefined) return cellText(object.text);
  if (object.result !== undefined) return cellText(object.result);
  return "";
};

/** First sheet not called "Instructions" (same reading as Spec Upload). */
export async function modelSpecsFromXlsx(bytes: ArrayBuffer) {
  const { loadExcelJs } = await import("./catalogWorkbook.ts");
  const ExcelJS = await loadExcelJs();
  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(bytes);
  } catch {
    return { specs: [], fileErrors: ["The file could not be read as an .xlsx workbook."] };
  }
  const sheet = workbook.worksheets.find((entry) => clean(entry.name).toLowerCase() !== "instructions");
  if (!sheet) return { specs: [], fileErrors: ["The workbook has no sheet."] };
  const table: string[][] = [];
  sheet.eachRow({ includeEmpty: true }, (row) => {
    const cells: string[] = [];
    for (let column = 1; column <= Math.max(row.cellCount, MODEL_SPEC_HEADERS.length); column += 1) cells.push(cellText(row.getCell(column).value));
    table.push(cells);
  });
  return modelSpecsFromTable(table);
}

/** A product's stored specifications as the model's source ("copy from an existing product of this model"). */
export function modelSpecsFromProduct(productId: string, existing: readonly ExistingSpec[]): ModelSpec[] {
  return existing
    .filter((spec) => spec.product_id === productId)
    .sort((a, b) => a.sort_order - b.sort_order)
    .map((spec, index) => ({ rowNumber: index + 1, section: spec.specification_group ?? "", label: spec.label, value: spec.value }));
}

/** Problems with the model's specifications themselves (before any product is considered). */
export function modelSpecProblems(specs: readonly ModelSpec[]) {
  const problems: { rowNumber: number; label: string; message: string }[] = [];
  const seen = new Set<string>();
  for (const spec of specs) {
    const where = { rowNumber: spec.rowNumber, label: spec.label || "(no label)" };
    if (!SPEC_SECTIONS.includes(spec.section as (typeof SPEC_SECTIONS)[number])) problems.push({ ...where, message: `Section "${spec.section}" is not one of: ${SPEC_SECTIONS.join(", ")}.` });
    if (!spec.label) problems.push({ ...where, message: "Label is empty." });
    if (!spec.value) problems.push({ ...where, message: "Value is empty." });
    if (spec.label && isVariantSpecificLabel(spec.section, spec.label))
      problems.push({ ...where, message: `"${spec.label}" is a variant fact (storage, RAM, colour, price, PTA, condition, warranty, battery, grade or SIM) and is never shared.` });
    const label = spec.label.toLowerCase();
    if (label && seen.has(label)) problems.push({ ...where, message: `"${spec.label}" is listed twice.` });
    seen.add(label);
  }
  return problems;
}

/** A row of the preview: Spec Upload's categories, plus "Correct" = follows an Owner-ticked correction of the approved value. */
export type ModelPlannedRow = Omit<PlannedRow, "category"> & { category: PlannedRow["category"] | "Correct" };
export type ModelProductPlan = { product: IphoneCatalogProduct; rows: ModelPlannedRow[]; add: number; present: number; conflicts: number; correct: number; invalid: number };
/** The model's Owner-approved common specification already saved (public.model_common_specifications). */
export type ApprovedSpec = { label: string; value: string; specification_group?: string | null };
/** A label whose approved value differs from the value given now. The final verified sheet corrects it ("ticked" = applied). */
export type ApprovedChange = { label: string; section: string; oldValue: string; newValue: string; ticked: boolean; followers: number };
export type ModelSpecPlan = {
  model: IphoneModelGroup;
  specProblems: ReturnType<typeof modelSpecProblems>;
  products: ModelProductPlan[];
  approvedChanges: ApprovedChange[];
  totals: { specs: number; products: number; affected: number; add: number; present: number; conflicts: number; corrections: number; corrected: number };
};

const same = (a: string, b: string) => clean(a) === clean(b);

/**
 * Preview for one model: the existing Spec Upload planner run once per matching product (exact id + title), so New /
 * Already Present / Conflict mean what they mean in Spec Upload (a label stored under another section with the same value
 * counts as present, like the server). Conflicts are never overwritten. When a given value differs from the model's
 * approved value, the change is listed. The final verified sheet is approved, so by default (`corrections` = "all") every
 * such change corrects the approved value; a Set of lower-case labels limits it. Only products still showing the old
 * approved value follow ("Correct"); products with any other value keep it (conflict).
 */
export function planModelSpecs(
  model: IphoneModelGroup,
  specs: readonly ModelSpec[],
  existing: readonly ExistingSpec[],
  approved: readonly ApprovedSpec[] = [],
  corrections: ReadonlySet<string> | "all" = "all",
): ModelSpecPlan {
  const specProblems = modelSpecProblems(specs);
  const approvedBy = new Map(approved.map((row) => [clean(row.label).toLowerCase(), row]));
  const changes = specs.flatMap((spec) => {
    const row = approvedBy.get(clean(spec.label).toLowerCase());
    return row && !same(row.value, spec.value) ? [{ label: clean(spec.label), section: spec.section, oldValue: row.value, newValue: spec.value.trim() }] : [];
  });
  const chosen = (label: string) => corrections === "all" || corrections.has(label.toLowerCase());
  const ticked = new Map(changes.filter((change) => chosen(change.label)).map((change) => [change.label.toLowerCase(), change]));
  const catalog = model.products.map(({ id, slug, title }) => ({ id, slug, title }));
  const products = model.products.map((product): ModelProductPlan => {
    const rows: UploadRow[] = specs.map((spec) => ({ rowNumber: spec.rowNumber, productName: product.title, productKey: product.id, section: spec.section, label: spec.label, value: spec.value }));
    const planned: ModelPlannedRow[] = planSpecificationUpload(rows, catalog, existing.filter((spec) => spec.product_id === product.id)).rows.map((row) => {
      if (row.category !== "Conflict" || !row.existing) return row;
      if (same(row.existing.value, row.value)) return { ...row, category: "Already Present" };
      const change = ticked.get(clean(row.label).toLowerCase());
      return change && same(row.existing.value, change.oldValue) ? { ...row, category: "Correct" } : row;
    });
    const count = (category: ModelPlannedRow["category"]) => planned.filter((row) => row.category === category).length;
    return { product, rows: planned, add: count("New Spec"), present: count("Already Present"), conflicts: count("Conflict"), correct: count("Correct"), invalid: count("Invalid Row") + count("Product Not Found") };
  });
  const approvedChanges = changes.map((change) => ({
    ...change,
    ticked: ticked.has(change.label.toLowerCase()),
    followers: model.products.filter((product) => existing.some((spec) => spec.product_id === product.id && clean(spec.label).toLowerCase() === change.label.toLowerCase() && same(spec.value, change.oldValue))).length,
  }));
  const sum = (pick: (plan: ModelProductPlan) => number) => products.reduce((total, plan) => total + pick(plan), 0);
  return {
    model,
    specProblems,
    products,
    approvedChanges,
    totals: {
      specs: specs.length,
      products: products.length,
      affected: products.filter((plan) => plan.add > 0 || plan.correct > 0).length,
      add: sum((plan) => plan.add),
      present: sum((plan) => plan.present),
      conflicts: sum((plan) => plan.conflicts),
      corrections: ticked.size,
      corrected: sum((plan) => plan.correct),
    },
  };
}

/** Corrections for apply_model_common_specifications: label + the approved value seen in the preview. */
export const modelSpecCorrectionsPayload = (plan: Pick<ModelSpecPlan, "approvedChanges">) =>
  plan.approvedChanges.filter((change) => change.ticked).map((change) => ({ label: change.label, old_value: change.oldValue }));

/**
 * Why the final verified sheet cannot be applied yet (null = ready). No tick or typed phrase (Owner decision 2026-11-21):
 * the sheet is the approval; the Owner's click on Apply is the only action that writes.
 */
export function modelSpecBlocker(plan: ModelSpecPlan | null) {
  if (!plan) return "Choose a model and upload its final verified sheet first.";
  if (!plan.totals.specs) return "The sheet has no verified specification to apply.";
  if (plan.specProblems.length) return "Fix the problems in the sheet first (nothing is applied while any remain).";
  if (plan.products.some((entry) => entry.invalid > 0)) return "Some rows could not be checked; nothing can be saved.";
  return null;
}

/** Payload for apply_model_common_specifications: the whole model's list (the server adds only what each product lacks). */
export const modelSpecPayload = (specs: readonly ModelSpec[]) =>
  specs.map((spec) => ({ specification_group: spec.section, label: clean(spec.label), value: spec.value.trim() }));
