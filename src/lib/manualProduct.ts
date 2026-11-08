/**
 * Manual Add / Edit Product (Admin) for Gadgets and Mobile Accessories — pure logic, no database access.
 *
 *  - Add Product: the form is checked here first (required fields, prices, stock, duplicates against the loaded catalog),
 *    then sent as ONE "Create" product to the existing apply_catalog_bulk_import_v2 (one transaction: product as a real
 *    Draft, variants with server-assigned SKUs, opening stock, specifications). The server re-checks everything, including
 *    duplicates by name + brand and the web address. Blank facts are sent as null, never guessed.
 *  - Edit: published Gadgets / Accessories keep their status. Every change is checked BEFORE it is saved against the same
 *    rules the server uses to publish (validate_product_for_publication), so a valid edit never unpublishes a product and
 *    an edit that would break a live product is refused.
 */
import { catalogSlug } from "./catalogSheet.ts";
import { parsePkrMajorToMinor } from "./money.ts";

export type ManualCategory = "gadgets" | "mobile-accessories";
export const MANUAL_CATEGORIES: readonly { slug: ManualCategory; label: string; productType: "Gadget" | "Accessory" }[] = [
  { slug: "gadgets", label: "Gadgets", productType: "Gadget" },
  { slug: "mobile-accessories", label: "Mobile Accessories", productType: "Accessory" },
];
export const isManualCategory = (slug: string | null | undefined): slug is ManualCategory => slug === "gadgets" || slug === "mobile-accessories";

export const PTA_VALUES = ["approved", "not_approved", "not_applicable"] as const;
export const CONDITION_VALUES = ["brand_new", "used", "open_box", "refurbished"] as const;
export const DELIVERY_VALUES = ["nationwide", "karachi_only"] as const;
export const SPEC_SECTION_OPTIONS = ["Display", "Performance", "Software", "Camera", "Battery", "Connectivity", "Build", "Audio", "Security", "Other"] as const;
export const MAX_VARIANTS = 30;
export const MAX_STOCK = 9_999_999;

export type ManualVariantInput = {
  color: string;
  price: string;
  compareAt: string;
  stock: string;
  pta: string;
  condition: string;
  delivery: string;
  warranty: string;
};
export type ManualSpecInput = { section: string; label: string; value: string };
export type ManualProductInput = {
  category: ManualCategory | "";
  title: string;
  brandName: string;
  content: string;
  shortDescription: string;
  variants: ManualVariantInput[];
  specs: ManualSpecInput[];
};
export type ExistingCatalogProduct = { id: string; title: string; slug: string; brandName: string | null };

export const emptyManualVariant = (): ManualVariantInput => ({ color: "", price: "", compareAt: "", stock: "", pta: "", condition: "", delivery: "", warranty: "" });

const squash = (text: string) => text.replace(/\s+/g, " ").trim();
const same = (a: string | null | undefined, b: string | null | undefined) => squash(a ?? "").toLowerCase() === squash(b ?? "").toLowerCase();
export const normalizeMultiline = (text: string) =>
  text.replace(/\r\n?/g, "\n").split("\n").map((line) => line.replace(/[ \t]+$/g, "")).join("\n").trim();

/** Exactly the server's slug rule ("+" → "plus"), so the duplicate pre-check finds what the server would refuse. */
export const manualProductSlug = (title: string) => catalogSlug(title);

// ---------------------------------------------------------------------------
// Add Product: check + payload
// ---------------------------------------------------------------------------

export type CreatePayload = {
  products: [{
    source: string;
    action: "Create";
    product_type: "Gadget" | "Accessory";
    title: string;
    brand: string | null;
    variants: {
      source: string;
      ram: null;
      storage: null;
      color: string | null;
      price_minor: number;
      compare_at_price_minor: number | null;
      stock: number;
      pta_status: string | null;
      condition: string | null;
      condition_grade: null;
      battery_health_percent: null;
      battery_cycle_count: null;
      sim_configuration: null;
      warranty: string | null;
      delivery_scope: string | null;
    }[];
    specifications: { group: string | null; label: string; value: string }[];
  }];
};
export type ManualCheck = { ok: boolean; errors: string[]; payload: CreatePayload | null; slug: string; description: { content: string | null; short_description: string | null } };

const money = (text: string, label: string, errors: string[]) => {
  try {
    return parsePkrMajorToMinor(text);
  } catch (reason) {
    errors.push(`${label}: ${reason instanceof Error ? reason.message : "enter a PKR amount"}`);
    return null;
  }
};

export function checkManualProduct(input: ManualProductInput, catalog: readonly ExistingCatalogProduct[], activeBrands: readonly string[]): ManualCheck {
  const errors: string[] = [];
  const title = squash(input.title);
  const brand = squash(input.brandName) || null;
  const category = MANUAL_CATEGORIES.find((entry) => entry.slug === input.category);
  const slug = manualProductSlug(title);
  if (!category) errors.push("Choose a category: Gadgets or Mobile Accessories.");
  if (!title) errors.push("Product name is required.");
  else if (!slug) errors.push("Product name must contain letters or digits.");
  if (brand && !activeBrands.some((name) => same(name, brand))) errors.push(`Brand "${brand}" is not an active brand.`);

  // Duplicates: the server refuses the same name + brand and the same web address; check first so nothing is half-sent.
  const sameName = catalog.filter((product) => same(product.title, title) && same(product.brandName, brand));
  if (title && sameName.length) errors.push(`"${title}"${brand ? ` (${brand})` : ""} already exists — open it in Catalog and edit it instead.`);
  else if (slug && catalog.some((product) => product.slug === slug)) errors.push(`The web address "${slug}" is already used by another product — change the name.`);

  if (!input.variants.length) errors.push("Add at least one variant (colour / price / stock).");
  if (input.variants.length > MAX_VARIANTS) errors.push(`At most ${MAX_VARIANTS} variants at a time.`);
  const colours = new Set<string>();
  const variants = input.variants.map((variant, index) => {
    const label = `Variant ${index + 1}${variant.color.trim() ? ` (${squash(variant.color)})` : ""}`;
    const color = squash(variant.color) || null;
    const key = (color ?? "").toLowerCase();
    if (colours.has(key)) errors.push(`${label}: the same colour is listed twice.`);
    colours.add(key);
    const price = money(variant.price, `${label} price`, errors);
    if (price !== null && price <= 0) errors.push(`${label}: price must be more than 0.`);
    const compareAt = variant.compareAt.trim() ? money(variant.compareAt, `${label} compare-at price`, errors) : null;
    if (price !== null && compareAt !== null && compareAt <= price) errors.push(`${label}: compare-at price must be higher than the price.`);
    const stockText = variant.stock.trim();
    const stock = stockText === "" ? NaN : Number(stockText);
    if (!Number.isInteger(stock) || stock < 0 || stock > MAX_STOCK) errors.push(`${label}: stock must be a whole number of 0 or more.`);
    if (!DELIVERY_VALUES.includes(variant.delivery as (typeof DELIVERY_VALUES)[number])) errors.push(`${label}: choose a delivery area.`);
    if (category?.slug === "mobile-accessories") {
      if (!PTA_VALUES.includes(variant.pta as (typeof PTA_VALUES)[number])) errors.push(`${label}: choose a PTA status (accessories need it to publish).`);
      if (!CONDITION_VALUES.includes(variant.condition as (typeof CONDITION_VALUES)[number])) errors.push(`${label}: choose a condition (accessories need it to publish).`);
    } else {
      if (variant.pta && !PTA_VALUES.includes(variant.pta as (typeof PTA_VALUES)[number])) errors.push(`${label}: unknown PTA status.`);
      if (variant.condition && !CONDITION_VALUES.includes(variant.condition as (typeof CONDITION_VALUES)[number])) errors.push(`${label}: unknown condition.`);
    }
    return {
      source: label,
      ram: null,
      storage: null,
      color,
      price_minor: price ?? 0,
      compare_at_price_minor: compareAt,
      stock: Number.isInteger(stock) ? stock : 0,
      pta_status: variant.pta || null,
      condition: variant.condition || null,
      condition_grade: null,
      battery_health_percent: null,
      battery_cycle_count: null,
      sim_configuration: null,
      warranty: squash(variant.warranty) || null,
      delivery_scope: variant.delivery || null,
    } as CreatePayload["products"][0]["variants"][number];
  });

  const seenSpecs = new Set<string>();
  const specifications = input.specs
    .filter((spec) => spec.label.trim() || spec.value.trim())
    .map((spec, index) => {
      const label = squash(spec.label);
      const value = squash(spec.value);
      const group = spec.section.trim() || null;
      if (!label || !value) errors.push(`Specification ${index + 1}: name and value are both required.`);
      if (group && !SPEC_SECTION_OPTIONS.includes(group as (typeof SPEC_SECTION_OPTIONS)[number])) errors.push(`Specification ${index + 1}: unknown section "${group}".`);
      const key = `${(group ?? "").toLowerCase()}|${label.toLowerCase()}`;
      if (label && seenSpecs.has(key)) errors.push(`Specification "${label}" is listed twice in the same section.`);
      seenSpecs.add(key);
      return { group, label, value };
    });

  const content = normalizeMultiline(input.content);
  const shortDescription = normalizeMultiline(input.shortDescription);
  const payload: CreatePayload | null = errors.length || !category
    ? null
    : { products: [{ source: title, action: "Create", product_type: category.productType, title, brand, variants, specifications }] };
  return { ok: errors.length === 0, errors, payload, slug, description: { content: content || null, short_description: shortDescription || null } };
}

// ---------------------------------------------------------------------------
// Edit: the publish rules for a LIVE Gadget / Accessory, checked before saving
// ---------------------------------------------------------------------------

export type LiveVariantState = { id: string; is_active: boolean; price_minor: number; delivery_scope: string | null; pta_status: string; condition: string };
export type LiveProductState = {
  categorySlug: string | null;
  title: string;
  brandId: string | null;
  activeRealBrandIds: readonly string[];
  variants: readonly LiveVariantState[];
  hasPrimaryImage: boolean;
};

/**
 * Same checks validate_product_for_publication applies to Gadgets and Mobile Accessories (202611060001):
 * title, active real brand (when set), at least one active variant, every active variant priced above 0 with a delivery
 * scope, and — for accessories — PTA and condition known; plus a primary image. Empty list = the edit keeps the product valid.
 */
export function liveProductProblems(state: LiveProductState): string[] {
  const problems: string[] = [];
  if (!squash(state.title)) problems.push("Product name cannot be empty.");
  if (state.brandId && !state.activeRealBrandIds.includes(state.brandId)) problems.push("The brand must be an active brand.");
  const active = state.variants.filter((variant) => variant.is_active);
  if (!active.length) problems.push("A live product needs at least one active variant.");
  for (const variant of active) {
    if (!(variant.price_minor > 0)) problems.push("Every active variant needs a price above 0.");
    if (!variant.delivery_scope) problems.push("Every active variant needs a delivery area.");
    if (state.categorySlug === "mobile-accessories" && (variant.pta_status === "unknown" || variant.condition === "unknown"))
      problems.push("Accessories need PTA status and condition on every active variant.");
  }
  if (!state.hasPrimaryImage) problems.push("A live product needs a primary image.");
  return [...new Set(problems)];
}

/** The state after replacing one variant (or removing it with `null`). */
export const withVariant = (state: LiveProductState, id: string, next: Partial<LiveVariantState> | null): LiveProductState => ({
  ...state,
  variants: next === null ? state.variants.filter((variant) => variant.id !== id) : state.variants.map((variant) => (variant.id === id ? { ...variant, ...next } : variant)),
});

/** Editable product columns for "Save changes": never publication_status, category, data class or the web address. */
export const SAFE_PRODUCT_COLUMNS = [
  "title",
  "brand_id",
  "short_description",
  "content",
  "default_warranty",
  "default_condition",
  "default_delivery_scope",
  "default_pta_status",
  "seo_title",
  "seo_description",
  "is_flash_sale",
  "is_featured",
  "is_best_seller",
] as const;

export function safeProductPatch(draft: Record<string, unknown>): Record<string, unknown> {
  const text = (value: unknown) => (typeof value === "string" ? value.trim() : value);
  const nullable = (value: unknown) => (typeof value === "string" ? value.trim() || null : value ?? null);
  return {
    title: text(draft.title),
    brand_id: nullable(draft.brand_id),
    short_description: nullable(draft.short_description),
    content: nullable(draft.content),
    default_warranty: nullable(draft.default_warranty),
    default_condition: draft.default_condition,
    default_delivery_scope: nullable(draft.default_delivery_scope),
    default_pta_status: draft.default_pta_status,
    seo_title: nullable(draft.seo_title),
    seo_description: nullable(draft.seo_description),
    is_flash_sale: draft.is_flash_sale === true,
    is_featured: draft.is_featured === true,
    is_best_seller: draft.is_best_seller === true,
  };
}

// ---------------------------------------------------------------------------
// Stock: "set to N" becomes one ledger movement
// ---------------------------------------------------------------------------

export function stockMovementTo(currentOnHand: number, targetText: string): { ok: true; delta: number } | { ok: false; message: string } {
  const text = targetText.trim();
  const target = text === "" ? NaN : Number(text);
  if (!Number.isInteger(target) || target < 0 || target > MAX_STOCK) return { ok: false, message: "Enter the new stock as a whole number of 0 or more." };
  const delta = target - currentOnHand;
  if (delta === 0) return { ok: false, message: "Stock is already at that number." };
  return { ok: true, delta };
}

// ---------------------------------------------------------------------------
// Specifications: one row edit
// ---------------------------------------------------------------------------

export function checkSpecEdit(
  next: ManualSpecInput,
  others: readonly { id: string; specification_group: string | null; label: string }[],
  selfId: string | null,
): string | null {
  const label = squash(next.label);
  const value = squash(next.value);
  if (!label || !value) return "Specification name and value are both required.";
  if (label.length > 120) return "Specification name is longer than 120 characters.";
  if (value.length > 600) return "Specification value is longer than 600 characters.";
  // Existing products may use older section names (e.g. Memory, Network), so any section text is kept as typed here.
  const group = next.section.trim();
  const clash = others.some((spec) => spec.id !== selfId && same(spec.label, label) && same(spec.specification_group ?? "", group));
  return clash ? `"${label}" already exists in this section.` : null;
}

// ---------------------------------------------------------------------------
// Add Product: the save (database injected so it runs offline in tests)
// ---------------------------------------------------------------------------

export type CreatedProductReadBack = {
  id: string;
  title: string;
  slug: string;
  publication_status: string;
  data_class: string;
  category_slug: string | null;
  content: string | null;
  short_description: string | null;
  variants: { sku: string; color: string | null; price_minor: number; on_hand: number }[];
  spec_count: number;
};
export type ManualCreateDeps = {
  supabaseUrl: string | undefined;
  buildMode: string | undefined;
  /** ONE call to apply_catalog_bulk_import_v2 (one transaction). */
  createProduct: (payload: CreatePayload) => Promise<{ products: { id: string; title: string; action: string }[]; assigned_skus: { sku: string }[] }>;
  /** Description on the new Draft only (never a status change). */
  saveDescription: (productId: string, values: { content?: string; short_description?: string }) => Promise<void>;
  readBack: (productId: string) => Promise<CreatedProductReadBack>;
};
export type ManualCreateResult =
  | { status: "blocked" | "failed"; message: string; productId: null; readBack: null; checks: [] }
  | { status: "created" | "created_with_problems"; message: string; productId: string; readBack: CreatedProductReadBack | null; checks: { name: string; ok: boolean; detail: string }[] };

export async function runManualCreate(check: ManualCheck, deps: ManualCreateDeps, isAllowed: (url: string | undefined, mode: string | undefined) => { allowed: boolean; reason: string | null }): Promise<ManualCreateResult> {
  const target = isAllowed(deps.supabaseUrl, deps.buildMode);
  if (!target.allowed) return { status: "blocked", message: target.reason ?? "Blocked: unknown environment.", productId: null, readBack: null, checks: [] };
  if (!check.ok || !check.payload) return { status: "blocked", message: "Fix the listed problems first.", productId: null, readBack: null, checks: [] };
  let productId: string;
  try {
    const result = await deps.createProduct(check.payload);
    const created = result.products.find((product) => product.action === "Create" || product.action === "created" || product.action === "Created") ?? result.products[0];
    if (!created?.id) return { status: "failed", message: "The server did not return the new product.", productId: null, readBack: null, checks: [] };
    productId = created.id;
  } catch (reason) {
    return { status: "failed", message: reason instanceof Error ? reason.message : String(reason), productId: null, readBack: null, checks: [] };
  }
  const descriptionValues: { content?: string; short_description?: string } = {};
  if (check.description.content) descriptionValues.content = check.description.content;
  if (check.description.short_description) descriptionValues.short_description = check.description.short_description;
  const problems: string[] = [];
  if (Object.keys(descriptionValues).length) {
    try {
      await deps.saveDescription(productId, descriptionValues);
    } catch (reason) {
      problems.push(`Description NOT saved: ${reason instanceof Error ? reason.message : String(reason)}. Add it in the editor (Save description).`);
    }
  }
  let readBack: CreatedProductReadBack | null = null;
  try {
    readBack = await deps.readBack(productId);
  } catch (reason) {
    problems.push(`Could not read the new product back: ${reason instanceof Error ? reason.message : String(reason)}.`);
  }
  const payload = check.payload.products[0];
  const checks = readBack
    ? [
        { name: "Saved as Draft", ok: readBack.publication_status === "draft", detail: readBack.publication_status },
        { name: "Real catalog record", ok: readBack.data_class === "real", detail: readBack.data_class },
        { name: "Category", ok: MANUAL_CATEGORIES.some((entry) => entry.slug === readBack!.category_slug && entry.productType === payload.product_type), detail: readBack.category_slug ?? "—" },
        { name: "Variants", ok: readBack.variants.length === payload.variants.length, detail: `${readBack.variants.length} of ${payload.variants.length}, SKUs ${readBack.variants.map((variant) => variant.sku).join(", ")}` },
        {
          name: "Prices and stock",
          ok: payload.variants.every((variant) => readBack!.variants.some((saved) => (saved.color ?? null) === variant.color && saved.price_minor === variant.price_minor && saved.on_hand === variant.stock)),
          detail: "as entered",
        },
        { name: "Specifications", ok: readBack.spec_count === payload.specifications.length, detail: `${readBack.spec_count} of ${payload.specifications.length}` },
        {
          name: "Description",
          ok: normalizeMultiline(readBack.content ?? "") === (check.description.content ?? "") && normalizeMultiline(readBack.short_description ?? "") === (check.description.short_description ?? ""),
          detail: check.description.content ? "saved" : "none entered",
        },
      ]
    : [];
  const allOk = !problems.length && checks.length > 0 && checks.every((entry) => entry.ok);
  return {
    status: allOk ? "created" : "created_with_problems",
    message: allOk ? `Created "${payload.title}" as a Draft. Add images, then Validate & publish.` : [`Created "${payload.title}" as a Draft, but please check:`, ...problems, ...checks.filter((entry) => !entry.ok).map((entry) => `${entry.name}: ${entry.detail}`)].join(" "),
    productId,
    readBack,
    checks,
  };
}
