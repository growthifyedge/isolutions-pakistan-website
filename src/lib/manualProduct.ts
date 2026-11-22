/**
 * Manual Add / Edit Product (Admin) — pure logic, no database access.
 *
 *  - Add Product (every category): the form is checked here first (category rules, required facts, prices, stock,
 *    duplicate products and variants against the loaded catalog), then sent as ONE "Create" product to the existing
 *    apply_catalog_bulk_import_v2 (one transaction: a real Draft, variants with server-assigned SKUs, opening stock,
 *    specifications). The server re-checks duplicates (name + brand, web address, variants), prices and enums, and
 *    publishing is always validated by the server (validate_product_for_publication). Blank facts are sent as null.
 *  - Category rules (Owner-approved): Android = PTA Approved, Brand New, 1 Year, Karachi only. New / Used iPhones are
 *    separate Apple products ("… (Used)", every variant Used, no warranty); New iPhone warranty optional (1 or 2 Years,
 *    or blank = NULL — Owner rule 2026-11-18); no battery / SIM facts unless entered.
 *    Tablets: New or Used, Wi-Fi = PTA Not Applicable, Cellular = PTA Approved / Non-PTA, Karachi only, warranty
 *    optional. MacBooks: Apple only, PTA Not Applicable, Karachi only, warranty optional.
 *  - Edit: see liveProductProblems (Gadgets / Accessories) and SERVER_SAFE_LIVE_COLUMNS (every other category).
 */
import { catalogSlug } from "./catalogSheet.ts";
import { parsePkrMajorToMinor } from "./money.ts";
import { CONDITION_GRADES, SIM_CONFIGURATIONS } from "./variantFacts.ts";

/** Categories with the Gadget / Accessory editor (live edits pre-checked against the publish rules). */
export type ManualCategory = "gadgets" | "mobile-accessories";
export const isManualCategory = (slug: string | null | undefined): slug is ManualCategory => slug === "gadgets" || slug === "mobile-accessories";

export type ProductKind = "gadgets" | "mobile-accessories" | "android" | "iphone-new" | "iphone-used" | "tablet" | "macbook";
export type KindProfile = {
  kind: ProductKind;
  label: string;
  group: string;
  productType: "Gadget" | "Accessory" | "Mobile Phone" | "Tablet" | "Laptop";
  categorySlug: "gadgets" | "mobile-accessories" | "mobile-phones" | "tablets" | "laptops";
  brand: "optional" | "required" | "apple" | "not-apple";
  /** "(Used)" title: never, always (Used iPhone), or when the product condition is Used (tablets, MacBooks). */
  usedTitle: "never" | "always" | "by-condition";
  ram: boolean;
  storage: boolean;
  sim: boolean;
  usedFacts: boolean;
  delivery: "choose" | "karachi_only";
  /** "choice" = optional pick from IPHONE_NEW_WARRANTIES; blank stays NULL (New iPhones, Owner rule 2026-11-18). */
  warranty: "optional" | "choice" | "hidden" | { fixed: string };
  pta: "optional" | "required" | { fixed: string } | "approved-or-non" | "by-connectivity";
  condition: "optional" | "required" | { fixed: string } | "by-product";
};

export const ANDROID_WARRANTY = "1 Year";
export const IPHONE_NEW_WARRANTIES = ["1 Year", "2 Years"] as const;
export const USED_SUFFIX = " (Used)";

export const KIND_PROFILES: readonly KindProfile[] = [
  { kind: "gadgets", label: "Gadget", group: "Gadgets & Accessories", productType: "Gadget", categorySlug: "gadgets", brand: "optional", usedTitle: "never", ram: false, storage: false, sim: false, usedFacts: false, delivery: "choose", warranty: "optional", pta: "optional", condition: "optional" },
  { kind: "mobile-accessories", label: "Mobile Accessory", group: "Gadgets & Accessories", productType: "Accessory", categorySlug: "mobile-accessories", brand: "optional", usedTitle: "never", ram: false, storage: false, sim: false, usedFacts: false, delivery: "choose", warranty: "optional", pta: "required", condition: "required" },
  { kind: "android", label: "Android Mobile", group: "Mobile Phones", productType: "Mobile Phone", categorySlug: "mobile-phones", brand: "not-apple", usedTitle: "never", ram: true, storage: true, sim: true, usedFacts: false, delivery: "karachi_only", warranty: { fixed: ANDROID_WARRANTY }, pta: { fixed: "approved" }, condition: { fixed: "brand_new" } },
  { kind: "iphone-new", label: "New iPhone", group: "Mobile Phones", productType: "Mobile Phone", categorySlug: "mobile-phones", brand: "apple", usedTitle: "never", ram: false, storage: true, sim: true, usedFacts: false, delivery: "karachi_only", warranty: "choice", pta: "approved-or-non", condition: { fixed: "brand_new" } },
  { kind: "iphone-used", label: "Used iPhone", group: "Mobile Phones", productType: "Mobile Phone", categorySlug: "mobile-phones", brand: "apple", usedTitle: "always", ram: false, storage: true, sim: true, usedFacts: true, delivery: "karachi_only", warranty: "hidden", pta: "approved-or-non", condition: { fixed: "used" } },
  { kind: "tablet", label: "Tablet / iPad", group: "Tablets & MacBooks", productType: "Tablet", categorySlug: "tablets", brand: "required", usedTitle: "by-condition", ram: true, storage: true, sim: false, usedFacts: false, delivery: "karachi_only", warranty: "optional", pta: "by-connectivity", condition: "by-product" },
  { kind: "macbook", label: "Apple MacBook", group: "Tablets & MacBooks", productType: "Laptop", categorySlug: "laptops", brand: "apple", usedTitle: "by-condition", ram: true, storage: true, sim: false, usedFacts: false, delivery: "karachi_only", warranty: "optional", pta: { fixed: "not_applicable" }, condition: "by-product" },
];
export const kindProfile = (kind: string | null | undefined) => KIND_PROFILES.find((profile) => profile.kind === kind) ?? null;
/** Backwards-compatible list of the Gadget / Accessory kinds. */
export const MANUAL_CATEGORIES = KIND_PROFILES.filter((profile) => isManualCategory(profile.kind)).map((profile) => ({ slug: profile.kind as ManualCategory, label: profile.label === "Gadget" ? "Gadgets" : "Mobile Accessories", productType: profile.productType as "Gadget" | "Accessory" }));

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
  ram?: string;
  storage?: string;
  sim?: string;
  grade?: string;
  batteryHealth?: string;
  cycleCount?: string;
};
export type ManualSpecInput = { section: string; label: string; value: string };
export type ManualProductInput = {
  category: ProductKind | "";
  title: string;
  brandName: string;
  content: string;
  shortDescription: string;
  /** Tablets and MacBooks: New or Used for the whole product. */
  productCondition?: "" | "brand_new" | "used";
  /** Tablets: Wi-Fi only or Cellular for the whole product. */
  connectivity?: "" | "wifi" | "cellular";
  variants: ManualVariantInput[];
  specs: ManualSpecInput[];
};
export type ExistingCatalogProduct = { id: string; title: string; slug: string; brandName: string | null };

export const emptyManualVariant = (): ManualVariantInput => ({
  color: "", price: "", compareAt: "", stock: "", pta: "", condition: "", delivery: "", warranty: "", ram: "", storage: "", sim: "", grade: "", batteryHealth: "", cycleCount: "",
});

const squash = (text: string) => text.replace(/\s+/g, " ").trim();
const same = (a: string | null | undefined, b: string | null | undefined) => squash(a ?? "").toLowerCase() === squash(b ?? "").toLowerCase();
export const normalizeMultiline = (text: string) =>
  text.replace(/\r\n?/g, "\n").split("\n").map((line) => line.replace(/[ \t]+$/g, "")).join("\n").trim();

/** Exactly the server's slug rule ("+" → "plus"), so the duplicate pre-check finds what the server would refuse. */
export const manualProductSlug = (title: string) => catalogSlug(title);
const USED_TITLE = /\s\(used\)\s*$/i;
const WIFI_WORD = /\bwi[\s-]?fi\b/i;
const CELLULAR_WORD = /\b(?:4g|5g|lte|cellular)\b/i;

/** The title as it will be stored: " (Used)" added for Used products (never removed or reworded otherwise). */
export function finalTitle(profile: KindProfile | null, title: string, productCondition: string | undefined) {
  const clean = squash(title);
  const used = profile?.usedTitle === "always" || (profile?.usedTitle === "by-condition" && productCondition === "used");
  return used && clean && !USED_TITLE.test(clean) ? `${clean}${USED_SUFFIX}` : clean;
}

/** Same identity the server uses to refuse duplicate variants inside one product. */
export const variantIdentity = (variant: { ram?: string | null; storage?: string | null; color?: string | null; pta?: string | null; condition?: string | null; grade?: string | null; batteryHealth?: string | number | null; cycleCount?: string | number | null }) =>
  [variant.ram, variant.storage, variant.color, variant.pta, variant.condition, variant.grade, variant.batteryHealth, variant.cycleCount].map((part) => squash(String(part ?? "")).toLowerCase()).join("|");

// ---------------------------------------------------------------------------
// Add Product: check + payload
// ---------------------------------------------------------------------------

export type CreateVariantPayload = {
  source: string;
  ram: string | null;
  storage: string | null;
  color: string | null;
  price_minor: number;
  compare_at_price_minor: number | null;
  stock: number;
  pta_status: string | null;
  condition: string | null;
  condition_grade: string | null;
  battery_health_percent: number | null;
  battery_cycle_count: number | null;
  sim_configuration: string | null;
  warranty: string | null;
  delivery_scope: string | null;
};
export type CreatePayload = {
  products: [{
    source: string;
    action: "Create";
    product_type: KindProfile["productType"];
    title: string;
    brand: string | null;
    variants: CreateVariantPayload[];
    specifications: { group: string | null; label: string; value: string }[];
  }];
};
export type ManualCheck = {
  ok: boolean;
  errors: string[];
  warnings: string[];
  payload: CreatePayload | null;
  slug: string;
  title: string;
  categorySlug: string | null;
  description: { content: string | null; short_description: string | null };
};

const money = (text: string, label: string, errors: string[]) => {
  try {
    return parsePkrMajorToMinor(text);
  } catch (reason) {
    errors.push(`${label}: ${reason instanceof Error ? reason.message : "enter a PKR amount"}`);
    return null;
  }
};
const fixedValue = (rule: unknown): string | null => (rule && typeof rule === "object" && "fixed" in (rule as object) ? (rule as { fixed: string }).fixed : null);
const wholeNumber = (text: string, min: number, max: number) => (/^\d+$/.test(text) && Number(text) >= min && Number(text) <= max ? Number(text) : null);

export function checkManualProduct(input: ManualProductInput, catalog: readonly ExistingCatalogProduct[], activeBrands: readonly string[]): ManualCheck {
  const errors: string[] = [];
  const warnings: string[] = [];
  const profile = kindProfile(input.category);
  const productCondition = input.productCondition ?? "";
  const connectivity = input.connectivity ?? "";
  const typed = squash(input.title);
  const title = finalTitle(profile, typed, productCondition);
  const slug = manualProductSlug(title);
  const rawBrand = squash(input.brandName) || null;
  const brand = profile?.brand === "apple" ? (activeBrands.find((name) => same(name, "Apple")) ?? "Apple") : rawBrand;

  if (!profile) errors.push("Choose a category: Gadget, Mobile Accessory, Android Mobile, New iPhone, Used iPhone, Tablet / iPad or Apple MacBook.");
  if (!typed) errors.push("Product name is required.");
  else if (!slug) errors.push("Product name must contain letters or digits.");
  if (profile) {
    if ((profile.brand === "required" || profile.brand === "not-apple") && !brand) errors.push(`Choose the brand (${profile.label}s need one).`);
    if (profile.brand === "not-apple" && brand && same(brand, "Apple")) errors.push("Apple phones are added as New iPhone or Used iPhone, not Android.");
    if (profile.brand === "apple" && !activeBrands.some((name) => same(name, "Apple"))) errors.push("The Apple brand is not active.");
    if (profile.usedTitle === "by-condition" && productCondition !== "brand_new" && productCondition !== "used") errors.push("Choose New or Used for this product.");
    const wantsUsed = profile.usedTitle === "always" || (profile.usedTitle === "by-condition" && productCondition === "used");
    if (!wantsUsed && USED_TITLE.test(typed)) errors.push(profile.kind === "iphone-new" ? 'A New iPhone name cannot end with "(Used)" — choose Used iPhone instead.' : 'Remove "(Used)" from the name, or choose Used.');
    if (profile.kind === "tablet") {
      if (connectivity !== "wifi" && connectivity !== "cellular") errors.push("Choose the connectivity: Wi-Fi only or Cellular.");
      else if (connectivity === "wifi" && !WIFI_WORD.test(typed)) warnings.push('The name does not say "Wi-Fi"; customers see connectivity only in the name.');
      else if (connectivity === "cellular" && !CELLULAR_WORD.test(typed)) warnings.push('The name does not say "Cellular", "LTE", "4G" or "5G"; customers see connectivity only in the name.');
    }
  }
  if (rawBrand && profile?.brand !== "apple" && !activeBrands.some((name) => same(name, rawBrand))) errors.push(`Brand "${rawBrand}" is not an active brand.`);

  // Duplicates: the server refuses the same name + brand and the same web address; check first so nothing is half-sent.
  if (title && catalog.some((product) => same(product.title, title) && same(product.brandName, brand)))
    errors.push(`"${title}"${brand ? ` (${brand})` : ""} already exists — open it in Catalog and edit it instead.`);
  else if (slug && catalog.some((product) => product.slug === slug)) errors.push(`The web address "${slug}" is already used by another product — change the name.`);

  if (!input.variants.length) errors.push("Add at least one variant.");
  if (input.variants.length > MAX_VARIANTS) errors.push(`At most ${MAX_VARIANTS} variants at a time.`);
  const identities = new Set<string>();
  const variants = input.variants.map((variant, index) => {
    const color = squash(variant.color) || null;
    const ram = profile?.ram ? squash(variant.ram ?? "") || null : null;
    const storage = profile?.storage ? squash(variant.storage ?? "") || null : null;
    const label = `Variant ${index + 1}${[ram, storage, color].filter(Boolean).length ? ` (${[ram, storage, color].filter(Boolean).join(" / ")})` : ""}`;
    if (profile?.storage && !storage) errors.push(`${label}: storage is required.`);

    // PTA, condition, warranty, delivery — from the category rule, never guessed.
    let pta: string | null = variant.pta || null;
    const ptaFixed = fixedValue(profile?.pta);
    if (ptaFixed) pta = ptaFixed;
    else if (profile?.pta === "by-connectivity") {
      if (connectivity === "wifi") pta = "not_applicable";
      else if (connectivity === "cellular") {
        if (pta !== "approved" && pta !== "not_approved") errors.push(`${label}: choose PTA Approved or Non-PTA (Cellular tablet).`);
      } else pta = null;
    } else if (profile?.pta === "approved-or-non") {
      if (pta !== "approved" && pta !== "not_approved") errors.push(`${label}: choose PTA Approved or Non-PTA.`);
    } else if (profile?.pta === "required") {
      if (!PTA_VALUES.includes(pta as (typeof PTA_VALUES)[number])) errors.push(`${label}: choose a PTA status (accessories need it to publish).`);
    } else if (pta && !PTA_VALUES.includes(pta as (typeof PTA_VALUES)[number])) errors.push(`${label}: unknown PTA status.`);

    let condition: string | null = variant.condition || null;
    const conditionFixed = fixedValue(profile?.condition);
    if (conditionFixed) condition = conditionFixed;
    else if (profile?.condition === "by-product") condition = productCondition || null;
    else if (profile?.condition === "required") {
      if (!CONDITION_VALUES.includes(condition as (typeof CONDITION_VALUES)[number])) errors.push(`${label}: choose a condition (accessories need it to publish).`);
    } else if (condition && !CONDITION_VALUES.includes(condition as (typeof CONDITION_VALUES)[number])) errors.push(`${label}: unknown condition.`);

    let warranty: string | null = squash(variant.warranty) || null;
    const warrantyFixed = fixedValue(profile?.warranty);
    if (warrantyFixed) warranty = warrantyFixed;
    else if (profile?.warranty === "hidden") warranty = null;
    // New iPhones: warranty is optional (blank stays NULL, never a default); a chosen value must be 1 Year or 2 Years.
    else if (profile?.warranty === "choice" && warranty !== null && !IPHONE_NEW_WARRANTIES.includes(warranty as (typeof IPHONE_NEW_WARRANTIES)[number]))
      errors.push(`${label}: warranty must be 1 Year or 2 Years, or left blank.`);

    let delivery: string | null = variant.delivery || null;
    if (profile?.delivery === "karachi_only") delivery = "karachi_only";
    else if (!DELIVERY_VALUES.includes(delivery as (typeof DELIVERY_VALUES)[number])) errors.push(`${label}: choose a delivery area.`);

    let sim: string | null = null;
    if (profile?.sim && variant.sim) {
      if (SIM_CONFIGURATIONS.some((option) => option.value === variant.sim)) sim = variant.sim;
      else errors.push(`${label}: unknown SIM configuration.`);
    }
    let grade: string | null = null;
    let batteryHealth: number | null = null;
    let cycleCount: number | null = null;
    if (profile?.usedFacts) {
      if (variant.grade) {
        if ((CONDITION_GRADES as readonly string[]).includes(variant.grade)) grade = variant.grade;
        else errors.push(`${label}: grade must be A++.`);
      }
      if ((variant.batteryHealth ?? "").trim()) {
        batteryHealth = wholeNumber((variant.batteryHealth ?? "").trim(), 1, 100);
        if (batteryHealth === null) errors.push(`${label}: battery health must be a whole number from 1 to 100.`);
      }
      if ((variant.cycleCount ?? "").trim()) {
        cycleCount = wholeNumber((variant.cycleCount ?? "").trim(), 0, 9_999_999);
        if (cycleCount === null) errors.push(`${label}: cycle count must be a whole number of 0 or more.`);
      }
    }

    const identity = variantIdentity({ ram, storage, color, pta, condition, grade, batteryHealth, cycleCount });
    if (identities.has(identity)) errors.push(profile?.storage ? `${label}: the same variant is listed twice.` : `${label}: the same colour is listed twice.`);
    identities.add(identity);

    const price = money(variant.price, `${label} price`, errors);
    if (price !== null && price <= 0) errors.push(`${label}: price must be more than 0.`);
    const compareAt = variant.compareAt.trim() ? money(variant.compareAt, `${label} compare-at price`, errors) : null;
    if (price !== null && compareAt !== null && compareAt <= price) errors.push(`${label}: compare-at price must be higher than the price.`);
    const stockText = variant.stock.trim();
    const stock = stockText === "" ? NaN : Number(stockText);
    if (!Number.isInteger(stock) || stock < 0 || stock > MAX_STOCK) errors.push(`${label}: stock must be a whole number of 0 or more.`);
    return {
      source: label,
      ram,
      storage,
      color,
      price_minor: price ?? 0,
      compare_at_price_minor: compareAt,
      stock: Number.isInteger(stock) ? stock : 0,
      pta_status: pta,
      condition,
      condition_grade: grade,
      battery_health_percent: batteryHealth,
      battery_cycle_count: cycleCount,
      sim_configuration: sim,
      warranty,
      delivery_scope: delivery,
    } satisfies CreateVariantPayload;
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
  const payload: CreatePayload | null = errors.length || !profile
    ? null
    : { products: [{ source: title, action: "Create", product_type: profile.productType, title, brand, variants, specifications }] };
  return {
    ok: errors.length === 0,
    errors,
    warnings,
    payload,
    slug,
    title,
    categorySlug: profile?.categorySlug ?? null,
    description: { content: content || null, short_description: shortDescription || null },
  };
}

// ---------------------------------------------------------------------------
// Edit, every category except Gadgets / Accessories: a LIVE product only accepts changes the server's publish rules
// never read, so no edit can make it invalid while it stays published. (validate_product_for_publication reads the
// title, brand, category, catalog class, default warranty, variants and primary image — never these columns.)
// Prices, variants and commercial facts of a live phone / tablet / MacBook change through the existing Stock Update
// pages, whose server functions check every change inside one transaction.
// ---------------------------------------------------------------------------

export const SERVER_SAFE_LIVE_COLUMNS = ["short_description", "content", "seo_title", "seo_description", "is_flash_sale", "is_featured", "is_best_seller"] as const;

export function serverSafeLivePatch(draft: Record<string, unknown>): Record<string, unknown> {
  const nullable = (value: unknown) => (typeof value === "string" ? value.trim() || null : value ?? null);
  return {
    short_description: nullable(draft.short_description),
    content: nullable(draft.content),
    seo_title: nullable(draft.seo_title),
    seo_description: nullable(draft.seo_description),
    is_flash_sale: draft.is_flash_sale === true,
    is_featured: draft.is_featured === true,
    is_best_seller: draft.is_best_seller === true,
  };
}

/** Where a live product's prices and variants are changed (existing, server-checked Stock Update pages). */
export function liveStockUpdatePage(categorySlug: string | null, brandName: string | null): { href: string; label: string } | null {
  if (categorySlug === "mobile-phones") return same(brandName, "Apple") ? { href: "/admin/iphone-stock-update", label: "iPhone Stock Update" } : { href: "/admin/stock-update", label: "Stock Update (Android)" };
  if (categorySlug === "tablets" || categorySlug === "laptops") return { href: "/admin/tablet-stock-update", label: "Tablets & MacBooks Stock Update" };
  return null;
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
  variants: { sku: string; ram?: string | null; storage?: string | null; color: string | null; price_minor: number; on_hand: number; pta_status?: string; condition?: string; warranty_override?: string | null; delivery_scope?: string | null }[];
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
        { name: "Category", ok: readBack.category_slug === check.categorySlug, detail: readBack.category_slug ?? "—" },
        { name: "Name", ok: readBack.title === check.title, detail: readBack.title },
        { name: "Variants", ok: readBack.variants.length === payload.variants.length, detail: `${readBack.variants.length} of ${payload.variants.length}, SKUs ${readBack.variants.map((variant) => variant.sku).join(", ")}` },
        {
          name: "Prices and stock",
          ok: payload.variants.every((variant) => readBack!.variants.some((saved) =>
            (saved.ram ?? null) === variant.ram && (saved.storage ?? null) === variant.storage && (saved.color ?? null) === variant.color
            && saved.price_minor === variant.price_minor && saved.on_hand === variant.stock)),
          detail: "as entered",
        },
        {
          name: "PTA, condition, warranty, delivery",
          ok: payload.variants.every((variant) => readBack!.variants.some((saved) =>
            (saved.ram ?? null) === variant.ram && (saved.storage ?? null) === variant.storage && (saved.color ?? null) === variant.color
            && (saved.pta_status === undefined || saved.pta_status === (variant.pta_status ?? "unknown"))
            && (saved.condition === undefined || saved.condition === (variant.condition ?? "unknown"))
            && (saved.warranty_override === undefined || (saved.warranty_override ?? null) === variant.warranty)
            && (saved.delivery_scope === undefined || (saved.delivery_scope ?? null) === variant.delivery_scope))),
          detail: "as the category rules set them",
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
