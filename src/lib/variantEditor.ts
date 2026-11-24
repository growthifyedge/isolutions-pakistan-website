/**
 * Catalog → Variants & Pricing: fully editable variants (Owner-approved 2026-11-23, Option B).
 *
 * Product open → edit any field → Review Changes (Old → New, stock separately, new variants separately) → typed
 * confirmation → ONE call to public.apply_product_variant_edits (migration 202611240001), which is Owner only, all or
 * nothing, refuses stale data / duplicates / a published product that would become unpublishable, and verifies its
 * own writes. Only the fields that changed are sent. Pure functions only (no database access here).
 */
import { normalizeCapacity } from "./bulkCatalog.ts";
import { commercialWriteTarget } from "./commercialDefaults.ts";
import { formatPkrMinor, parsePkrMajorToMinor, pkrMajorInputFromMinor } from "./money.ts";

export const EDIT_FIELDS = ["ram_display", "storage_display", "color_finish", "price_minor", "compare_at_price_minor", "pta_status", "condition", "warranty_override", "delivery_scope", "is_active"] as const;
export type EditField = (typeof EDIT_FIELDS)[number];
export const FIELD_LABEL: Record<EditField, string> = {
  ram_display: "RAM",
  storage_display: "Storage",
  color_finish: "Colour",
  price_minor: "Price",
  compare_at_price_minor: "Compare-at",
  pta_status: "PTA",
  condition: "Condition",
  warranty_override: "Warranty",
  delivery_scope: "Delivery",
  is_active: "Website",
};
export const PTA_CHOICES = [["approved", "PTA Approved"], ["not_approved", "Non-PTA"], ["not_applicable", "Not applicable"]] as const;
export const CONDITION_CHOICES = [["brand_new", "Brand New"], ["used", "Used"]] as const;
export const DELIVERY_CHOICES = [["karachi_only", "Karachi only"], ["nationwide", "Nationwide"]] as const;
export const MAX_STOCK = 100000;

/** A variant exactly as loaded (the "expected" state the server compares against). */
export type EditorVariant = {
  id: string;
  sku: string;
  ram_display: string | null;
  storage_display: string | null;
  color_finish: string | null;
  price_minor: number;
  compare_at_price_minor: number | null;
  pta_status: string;
  condition: string;
  warranty_override: string | null;
  delivery_scope: string | null;
  is_active: boolean;
  stock: number;
};

/** What the Owner typed in one row (inputs as text; checkbox as boolean). */
export type RowInput = {
  ram_display: string;
  storage_display: string;
  color_finish: string;
  price: string;
  compare_at: string;
  pta_status: string;
  condition: string;
  warranty_override: string;
  delivery_scope: string;
  is_active: boolean;
  stock: string;
  /**
   * Discount % (2026-11-24): never stored. Price = Compare-at × (1 − Discount % / 100), rounded to whole rupees, when
   * the Owner edits it; shown as derived from the saved Price and Compare-at otherwise. Empty = no calculation.
   */
  discount: string;
};

/** Discount % the Owner may type: 0–99, at most 2 decimals. */
export const MAX_DISCOUNT_PERCENT = 99;

/** A typed Discount % as a number, or null when it is not a valid 0–99 percentage. */
export function parseDiscount(text: string): number | null {
  const clean = text.trim();
  if (!/^\d{1,2}(\.\d{1,2})?$/.test(clean)) return null;
  const value = Number(clean);
  return value >= 0 && value <= MAX_DISCOUNT_PERCENT ? value : null;
}

/** A typed rupee amount in minor units, or null when it is not a positive amount. */
function positiveMinor(text: string): number | null {
  try {
    const minor = parsePkrMajorToMinor(text);
    return minor > 0 ? minor : null;
  } catch {
    return null;
  }
}

/**
 * The discount the saved / typed prices give: (Compare-at − Price) / Compare-at, at most 2 decimals. Empty when the
 * Compare-at is missing, zero or invalid, or not above the Price (never a wrong or negative discount).
 */
export function discountFromPrices(price: string, compareAt: string): string {
  const priceMinor = positiveMinor(price);
  const compareMinor = positiveMinor(compareAt);
  if (priceMinor === null || compareMinor === null || compareMinor <= priceMinor) return "";
  return String(Math.round(((compareMinor - priceMinor) * 10000) / compareMinor) / 100);
}

/**
 * Price = Compare-at × (1 − Discount % / 100), rounded to whole rupees (the catalog's prices are whole rupees).
 * Null when the Compare-at or the Discount % is not valid, or the result would not be a positive price.
 */
export function priceFromDiscount(compareAt: string, discount: string): string | null {
  const compareMinor = positiveMinor(compareAt);
  const percent = parseDiscount(discount);
  if (compareMinor === null || percent === null) return null;
  const basisPoints = Math.round(percent * 100);
  const rupees = Math.round((compareMinor * (10000 - basisPoints)) / 1_000_000);
  return rupees > 0 ? pkrMajorInputFromMinor(rupees * 100) : null;
}

/**
 * One edit of Price, Compare-at or Discount % in a row, with the linked field recalculated:
 *   Discount % typed      → Price from Compare-at (nothing when Discount % is empty or invalid);
 *   Compare-at changed    → Price from the row's Discount % (nothing when it is empty or invalid);
 *   Price typed by hand   → Discount % from Price and a valid Compare-at (empty otherwise).
 */
export function applyPricingEdit(row: RowInput, key: "price" | "compare_at" | "discount", value: string): RowInput {
  if (key === "price") return { ...row, price: value, discount: discountFromPrices(value, row.compare_at) };
  if (key === "compare_at") {
    const next = { ...row, compare_at: value };
    const price = row.discount.trim() ? priceFromDiscount(value, row.discount) : null;
    return price === null ? next : { ...next, price };
  }
  const next = { ...row, discount: value };
  const price = value.trim() ? priceFromDiscount(row.compare_at, value) : null;
  return price === null ? next : { ...next, price };
}

export type FieldDiff = { field: EditField; label: string; from: string; to: string };
export type VariantUpdate = { variantId: string; sku: string; name: string; changes: Partial<Record<EditField, string | number | boolean | null>>; diffs: FieldDiff[] };
export type StockChange = { variantId: string; sku: string; name: string; from: number; to: number };
export type NewVariant = { row: number; name: string; values: Record<EditField, string | number | boolean | null>; stock: number };

export type EditPlan = {
  updates: VariantUpdate[];
  stock: StockChange[];
  adds: NewVariant[];
  problems: string[];
  /** Field changes + stock changes + new variants (the number the Owner confirms). */
  changeCount: number;
  payload: EditPayload | null;
};

export type EditPayload = {
  product_id: string;
  expected: { variants: Omit<EditorVariant, "sku">[] };
  updates: { variant_id: string; changes: Partial<Record<EditField, string | number | boolean | null>> }[];
  stock: { variant_id: string; from_stock: number; to_stock: number }[];
  adds: (Record<EditField, string | number | boolean | null> & { stock: number })[];
};

const collapse = (value: string) => value.trim().replace(/\s+/g, " ");
/** RAM / storage as typed, tidied ("12gb" → "12 GB"); anything else kept as typed. Blank = none. */
export const tidyCapacity = (value: string): string | null => (collapse(value) ? normalizeCapacity(collapse(value)) ?? collapse(value) : null);
const tidyText = (value: string): string | null => collapse(value) || null;
const sameKey = (value: string | null | undefined) => (value ?? "").replace(/\s+/g, "").toLowerCase();
export const variantName = (variant: Pick<EditorVariant, "ram_display" | "storage_display" | "color_finish">) =>
  [variant.ram_display, variant.storage_display, variant.color_finish].filter(Boolean).join(" / ") || "—";
const choiceLabel = (choices: readonly (readonly [string, string])[], value: string | null) => choices.find(([key]) => key === value)?.[1] ?? value ?? "—";

export function display(field: EditField, value: string | number | boolean | null): string {
  if (value === null || value === "") return field === "compare_at_price_minor" ? "none" : "—";
  if (field === "price_minor" || field === "compare_at_price_minor") return formatPkrMinor(Number(value));
  if (field === "pta_status") return choiceLabel(PTA_CHOICES, String(value));
  if (field === "condition") return choiceLabel(CONDITION_CHOICES, String(value));
  if (field === "delivery_scope") return choiceLabel(DELIVERY_CHOICES, String(value));
  if (field === "is_active") return value ? "Visible" : "Hidden";
  return String(value);
}

/** The input boxes of an existing variant, as loaded. */
export const rowFromVariant = (variant: EditorVariant): RowInput => ({
  ram_display: variant.ram_display ?? "",
  storage_display: variant.storage_display ?? "",
  color_finish: variant.color_finish ?? "",
  price: pkrMajorInputFromMinor(variant.price_minor),
  compare_at: variant.compare_at_price_minor === null ? "" : pkrMajorInputFromMinor(variant.compare_at_price_minor),
  // A value that is not one of the choices (an old "unknown", "open box") shows as "keep current" and is never sent.
  pta_status: PTA_CHOICES.some(([key]) => key === variant.pta_status) ? variant.pta_status : "",
  condition: CONDITION_CHOICES.some(([key]) => key === variant.condition) ? variant.condition : "",
  warranty_override: variant.warranty_override ?? "",
  delivery_scope: variant.delivery_scope ?? "",
  is_active: variant.is_active,
  stock: String(variant.stock),
  // Shown from the saved prices only; nothing is applied until the Owner edits Price, Compare-at or Discount %.
  discount: variant.compare_at_price_minor === null ? "" : discountFromPrices(pkrMajorInputFromMinor(variant.price_minor), pkrMajorInputFromMinor(variant.compare_at_price_minor)),
});

/** A new row starts with the commercial facts of the product's first visible variant (the Owner can change them). */
export function newRowDefaults(variants: readonly EditorVariant[], mobilePhone: boolean): RowInput {
  const model = variants.find((variant) => variant.is_active) ?? variants[0];
  return {
    ram_display: model?.ram_display ?? "",
    storage_display: model?.storage_display ?? "",
    color_finish: "",
    price: "",
    compare_at: "",
    pta_status: model && model.pta_status !== "unknown" ? model.pta_status : "",
    condition: model && ["brand_new", "used"].includes(model.condition) ? model.condition : "",
    warranty_override: model?.warranty_override ?? "",
    delivery_scope: mobilePhone ? "karachi_only" : model?.delivery_scope ?? "",
    is_active: true,
    stock: "0",
    discount: "",
  };
}

function money(text: string, label: string, problems: string[], optional: boolean): number | null | undefined {
  if (!text.trim()) {
    if (optional) return null;
    problems.push(`${label} is required`);
    return undefined;
  }
  try {
    const minor = parsePkrMajorToMinor(text);
    if (minor <= 0) throw new Error("zero");
    return minor;
  } catch {
    problems.push(`${label}: “${text.trim()}” is not an amount — use rupees, e.g. 385000`);
    return undefined;
  }
}

function stockNumber(text: string, label: string, problems: string[]): number | undefined {
  const clean = text.trim().replaceAll(",", "");
  if (!/^\d{1,6}$/.test(clean) || Number(clean) > MAX_STOCK) {
    problems.push(`${label}: stock must be a whole number from 0 to ${MAX_STOCK.toLocaleString("en-PK")}`);
    return undefined;
  }
  return Number(clean);
}

/** One row's typed values → the values the database would store (undefined = the row has a problem). */
function readRow(input: RowInput, label: string, mobilePhone: boolean, problems: string[], requireFacts: boolean) {
  const before = problems.length;
  const price = money(input.price, `${label}: price`, problems, false);
  const compare = money(input.compare_at, `${label}: compare-at price`, problems, true);
  if (typeof price === "number" && typeof compare === "number" && compare <= price) problems.push(`${label}: the compare-at price must be above the price (or left empty)`);
  // A Discount % typed by the Owner must be 0–99 (a value derived from the saved prices is always accepted).
  if (input.discount.trim() && input.discount.trim() !== discountFromPrices(input.price, input.compare_at) && parseDiscount(input.discount) === null)
    problems.push(`${label}: Discount % must be a number from 0 to ${MAX_DISCOUNT_PERCENT}`);
  if (requireFacts || input.pta_status) {
    if (!PTA_CHOICES.some(([key]) => key === input.pta_status)) problems.push(`${label}: choose PTA Approved, Non-PTA or Not applicable`);
  }
  if (requireFacts || input.condition) {
    if (!CONDITION_CHOICES.some(([key]) => key === input.condition)) problems.push(`${label}: choose Brand New or Used`);
  }
  if (requireFacts || input.delivery_scope) {
    if (!DELIVERY_CHOICES.some(([key]) => key === input.delivery_scope)) problems.push(`${label}: choose the delivery`);
    else if (mobilePhone && input.delivery_scope !== "karachi_only") problems.push(`${label}: mobile phones are delivered in Karachi only`);
  }
  const values: Record<EditField, string | number | boolean | null> = {
    ram_display: tidyCapacity(input.ram_display),
    storage_display: tidyCapacity(input.storage_display),
    color_finish: tidyText(input.color_finish),
    price_minor: price ?? null,
    compare_at_price_minor: compare ?? null,
    pta_status: input.pta_status || null,
    condition: input.condition || null,
    warranty_override: tidyText(input.warranty_override),
    delivery_scope: input.delivery_scope || null,
    is_active: input.is_active,
  };
  for (const field of ["ram_display", "storage_display", "color_finish"] as const) {
    if (String(values[field] ?? "").length > 40) problems.push(`${label}: ${FIELD_LABEL[field]} is too long`);
  }
  if (String(values.warranty_override ?? "").length > 80) problems.push(`${label}: warranty is too long`);
  return { values, ok: problems.length === before };
}

/** The Owner's edits → field changes (changed fields only), stock changes, new variants, problems and the ONE payload. */
export function buildVariantEditPlan(input: {
  productId: string;
  mobilePhone: boolean;
  variants: readonly EditorVariant[];
  rows: Readonly<Record<string, RowInput>>;
  newRows: readonly RowInput[];
}): EditPlan {
  const problems: string[] = [];
  const updates: VariantUpdate[] = [];
  const stock: StockChange[] = [];
  const adds: NewVariant[] = [];
  const finals: { label: string; key: string }[] = [];
  const keyOf = (values: Record<EditField, string | number | boolean | null>, variant?: EditorVariant) =>
    [sameKey(values.ram_display as string), sameKey(values.storage_display as string), sameKey(values.color_finish as string), values.pta_status ?? variant?.pta_status ?? "", values.condition ?? variant?.condition ?? ""].join("|");

  for (const variant of input.variants) {
    const row = input.rows[variant.id] ?? rowFromVariant(variant);
    const name = `${variant.sku} (${variantName(variant)})`;
    const { values, ok } = readRow(row, variant.sku, input.mobilePhone, problems, false);
    if (!ok) continue;
    const changes: VariantUpdate["changes"] = {};
    const diffs: FieldDiff[] = [];
    for (const field of EDIT_FIELDS) {
      const now = variant[field] as string | number | boolean | null;
      let next = values[field];
      // A fact the Owner did not set stays as it is (e.g. an old "unknown" PTA is never sent back).
      if ((field === "pta_status" || field === "condition" || field === "delivery_scope") && next === null) next = now;
      if (next === now || (next === null && (now === null || now === ""))) continue;
      changes[field] = next;
      diffs.push({ field, label: FIELD_LABEL[field], from: display(field, now), to: display(field, next) });
    }
    if (diffs.length) updates.push({ variantId: variant.id, sku: variant.sku, name, changes, diffs });
    finals.push({ label: variant.sku, key: keyOf({ ...values, pta_status: (changes.pta_status as string) ?? variant.pta_status, condition: (changes.condition as string) ?? variant.condition }) });
    const to = stockNumber(row.stock, variant.sku, problems);
    if (to !== undefined && to !== variant.stock) stock.push({ variantId: variant.id, sku: variant.sku, name, from: variant.stock, to });
  }

  input.newRows.forEach((row, index) => {
    const label = `New variant ${index + 1}`;
    const { values, ok } = readRow(row, label, input.mobilePhone, problems, true);
    const opening = stockNumber(row.stock, label, problems);
    if (!values.storage_display && !values.color_finish) problems.push(`${label}: storage or colour is required`);
    if (!ok || opening === undefined || (!values.storage_display && !values.color_finish)) return;
    adds.push({ row: index, name: variantName(values as unknown as EditorVariant), values, stock: opening });
    finals.push({ label, key: keyOf(values) });
  });

  const seen = new Map<string, string>();
  for (const entry of finals) {
    const earlier = seen.get(entry.key);
    if (earlier) problems.push(`${earlier} and ${entry.label} would be the same variant (same RAM / storage / colour / PTA / condition)`);
    else seen.set(entry.key, entry.label);
  }

  const changeCount = updates.reduce((sum, update) => sum + update.diffs.length, 0) + stock.length + adds.length;
  const payload: EditPayload | null =
    problems.length || changeCount === 0
      ? null
      : {
          product_id: input.productId,
          expected: { variants: input.variants.map((variant) => Object.fromEntries(Object.entries(variant).filter(([key]) => key !== "sku")) as Omit<EditorVariant, "sku">) },
          updates: updates.map((update) => ({ variant_id: update.variantId, changes: update.changes })),
          stock: stock.map((change) => ({ variant_id: change.variantId, from_stock: change.from, to_stock: change.to })),
          adds: adds.map((add) => ({ ...add.values, stock: add.stock })),
        };
  return { updates, stock, adds, problems, changeCount, payload };
}

export const editConfirmationPhrase = (plan: Pick<EditPlan, "changeCount">) => `SAVE ${plan.changeCount} CHANGE${plan.changeCount === 1 ? "" : "S"}`;

/** Where saving is allowed: the build and its Supabase project must match (DEV or PROD), like every catalog write. */
export function editEnvironmentBlocker(supabaseUrl: string | undefined | null, buildMode: string | undefined | null): string | null {
  const target = commercialWriteTarget(supabaseUrl, buildMode);
  if (!target.allowed) return target.reason ?? "The website environment could not be confirmed.";
  return null;
}

/** After a save: every planned value and stock figure must be what the database now has. */
export function verifyVariantEdit(plan: EditPlan, before: readonly EditorVariant[], after: readonly EditorVariant[]): string[] {
  const issues: string[] = [];
  const byId = new Map(after.map((variant) => [variant.id, variant]));
  for (const variant of before) {
    const now = byId.get(variant.id);
    if (!now) {
      issues.push(`${variant.sku} is missing after saving`);
      continue;
    }
    const update = plan.updates.find((item) => item.variantId === variant.id);
    for (const field of EDIT_FIELDS) {
      const expected = update && field in update.changes ? update.changes[field] : variant[field];
      if ((now[field] ?? null) !== (expected ?? null)) issues.push(`${variant.sku}: ${FIELD_LABEL[field]} is ${display(field, now[field])}, expected ${display(field, expected ?? null)}`);
    }
    const stock = plan.stock.find((item) => item.variantId === variant.id)?.to ?? variant.stock;
    if (now.stock !== stock) issues.push(`${variant.sku}: stock is ${now.stock}, expected ${stock}`);
  }
  const fresh = after.filter((variant) => !before.some((old) => old.id === variant.id));
  if (fresh.length !== plan.adds.length) issues.push(`${fresh.length} new variant(s) found, ${plan.adds.length} planned`);
  for (const add of plan.adds) {
    const match = fresh.find((variant) => EDIT_FIELDS.every((field) => (variant[field] ?? null) === (add.values[field] ?? null)));
    if (!match) issues.push(`${add.name}: not found as planned`);
    else if (match.stock !== add.stock) issues.push(`${match.sku}: opening stock is ${match.stock}, expected ${add.stock}`);
  }
  return issues;
}
