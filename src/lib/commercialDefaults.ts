/**
 * Bulk commercial facts for the imported Android batch — pure planning, targeting and verification.
 *
 * Business rule for this batch: every imported Android phone is PTA Approved and Brand New (box pack).
 * Canonical schema values (no new enum): pta_status = "approved" ("PTA Approved"), condition = "brand_new" ("Brand New").
 *
 * Only pta_status and condition (and the product-level default_pta_status / default_condition that mirror them) are
 * ever written. Prices, stock, SKUs, RAM/storage/colour, media, titles, delivery and publication are never touched.
 * Database access is injected, so planning, the write loop and verification are testable offline.
 */
import { ANDROID_IMPORT_BATCH_TITLES } from "./androidImportBatch.ts";
import { SUPABASE_ENVIRONMENTS, environmentForSupabaseUrl, supabaseProjectRef } from "./supabaseEnvironment.ts";

export const CANONICAL_PTA = "approved" as const;
export const CANONICAL_CONDITION = "brand_new" as const;
export const PTA_LABEL = "PTA Approved";
export const CONDITION_LABEL = "Brand New (box pack)";

export type CommercialDesired = { pta: string; condition: string };
export const ANDROID_BATCH_DESIRED: CommercialDesired = { pta: CANONICAL_PTA, condition: CANONICAL_CONDITION };

// ---------------- Environment ----------------

export type CommercialWriteTarget = { allowed: boolean; reason: string | null; environment: "development" | "production" | null; projectRef: string | null };

/** Same exact pairing as the image uploader: known project, build mode == its environment. */
export function commercialWriteTarget(supabaseUrl: string | undefined | null, buildMode: string | undefined | null): CommercialWriteTarget {
  const ref = supabaseProjectRef(supabaseUrl);
  const environment = environmentForSupabaseUrl(supabaseUrl);
  if (!ref || !environment) return { allowed: false, reason: "Blocked: the Supabase environment is UNKNOWN.", environment: null, projectRef: null };
  if (ref !== SUPABASE_ENVIRONMENTS[environment.name].supabaseProjectRef)
    return { allowed: false, reason: "Blocked: the Supabase project does not match its environment.", environment: environment.name, projectRef: ref };
  if (buildMode !== environment.name)
    return {
      allowed: false,
      reason: `Blocked: this ${buildMode ?? "unknown"}-mode build is connected to the ${environment.name.toUpperCase()} Supabase project (${ref}). Build mode and project must match.`,
      environment: environment.name,
      projectRef: ref,
    };
  return { allowed: true, reason: null, environment: environment.name, projectRef: ref };
}

// ---------------- Data shapes ----------------

export type CommercialProduct = {
  id: string;
  title: string;
  slug: string;
  brandName: string | null;
  dataClass: string | null;
  publicationStatus: string | null;
  defaultPta: string;
  defaultCondition: string;
};

export type CommercialVariant = {
  id: string;
  product_id: string;
  sku: string;
  ram_display: string | null;
  storage_display: string | null;
  color_finish: string | null;
  carrier_jv: string | null;
  price_minor: number;
  compare_at_price_minor: number | null;
  pta_status: string;
  condition: string;
  condition_grade: string | null;
  battery_health_percent: number | null;
  battery_cycle_count: number | null;
  sim_configuration: string | null;
  warranty_override: string | null;
  delivery_scope: string | null;
  is_active: boolean;
  sort_order: number;
};

/** Everything except pta_status / condition: must be identical before and after a write. */
const PRESERVED_FIELDS = [
  "sku",
  "ram_display",
  "storage_display",
  "color_finish",
  "carrier_jv",
  "price_minor",
  "compare_at_price_minor",
  "condition_grade",
  "battery_health_percent",
  "battery_cycle_count",
  "sim_configuration",
  "warranty_override",
  "delivery_scope",
  "is_active",
  "sort_order",
] as const satisfies readonly (keyof CommercialVariant)[];

export const normalizeTitle = (title: string) => title.trim().replace(/\s+/g, " ").toLowerCase();

// ---------------- Targeting ----------------

export type BatchSelection = {
  targets: CommercialProduct[];
  /** Batch titles with no matching product in this environment (informational). */
  missingTitles: string[];
  /** Products with a batch title that are NOT targeted, with the reason. */
  skipped: { product: CommercialProduct; reason: string }[];
};

/**
 * The imported Android batch = products whose title exactly equals a batch title (case/space-insensitive).
 * Never by brand or category alone. A title that matches more than one product is ambiguous and targets none of them;
 * Apple-branded or non-real products are never targeted even if a title collides.
 */
export function selectAndroidBatch(products: CommercialProduct[], titles: readonly string[] = ANDROID_IMPORT_BATCH_TITLES): BatchSelection {
  const wanted = new Set(titles.map(normalizeTitle));
  const byTitle = new Map<string, CommercialProduct[]>();
  for (const product of products) {
    const key = normalizeTitle(product.title);
    if (wanted.has(key)) byTitle.set(key, [...(byTitle.get(key) ?? []), product]);
  }
  const targets: CommercialProduct[] = [];
  const skipped: BatchSelection["skipped"] = [];
  for (const [, matches] of byTitle) {
    for (const product of matches) {
      if (matches.length > 1) skipped.push({ product, reason: "Several products share this batch title — ambiguous, not targeted." });
      else if (/^apple$/i.test((product.brandName ?? "").trim())) skipped.push({ product, reason: "Apple product — never part of the Android batch." });
      else if (product.dataClass !== "real") skipped.push({ product, reason: `Catalog class is "${product.dataClass ?? "unknown"}", not real.` });
      else targets.push(product);
    }
  }
  const missingTitles = titles.filter((title) => !byTitle.has(normalizeTitle(title)));
  targets.sort((a, b) => a.title.localeCompare(b.title));
  return { targets, missingTitles, skipped };
}

// ---------------- Planning (dry run) ----------------

export type VariantAction = "change" | "already" | "conflict";

export type ProductCommercialPlan = {
  productId: string;
  title: string;
  status: "change" | "already_correct" | "skipped";
  reason: string | null;
  variants: { id: string; sku: string; fromPta: string; fromCondition: string; action: VariantAction }[];
  /** Variant ids whose pta/condition will be written. */
  changeIds: string[];
  productDefaultsChange: boolean;
};

export type CommercialPlan = {
  desired: CommercialDesired;
  products: ProductCommercialPlan[];
  totals: {
    products: number;
    variants: number;
    unknownPta: number;
    unknownCondition: number;
    variantsToChange: number;
    variantsAlreadyCorrect: number;
    productsToChange: number;
    productsAlreadyCorrect: number;
    productsSkipped: number;
    productDefaultsToChange: number;
  };
};

const comboKey = (variant: CommercialVariant, pta: string, condition: string) =>
  JSON.stringify([variant.ram_display, variant.storage_display, variant.color_finish, variant.carrier_jv, pta, condition]);

/**
 * Dry-run plan. `overwriteExplicit: false` (batch) only fills Unknown values and SKIPS a product whose variant carries a
 * different explicit value; `true` (the Owner's per-product action) also overwrites explicit values. Either way a product is
 * skipped when the change would be impossible or ambiguous (used-phone grade facts, or two variants becoming identical).
 */
export function planCommercialDefaults(
  products: CommercialProduct[],
  variants: CommercialVariant[],
  desired: CommercialDesired,
  options: { overwriteExplicit: boolean },
): CommercialPlan {
  const byProduct = new Map<string, CommercialVariant[]>();
  for (const variant of variants) byProduct.set(variant.product_id, [...(byProduct.get(variant.product_id) ?? []), variant]);

  const plans = products.map((product): ProductCommercialPlan => {
    const own = [...(byProduct.get(product.id) ?? [])].sort((a, b) => a.sort_order - b.sort_order || a.sku.localeCompare(b.sku));
    const productDefaultsChange = product.defaultPta !== desired.pta || product.defaultCondition !== desired.condition;
    const rows = own.map((variant) => {
      const same = variant.pta_status === desired.pta && variant.condition === desired.condition;
      const explicitOther =
        (variant.pta_status !== "unknown" && variant.pta_status !== desired.pta) || (variant.condition !== "unknown" && variant.condition !== desired.condition);
      const action: VariantAction = same ? "already" : explicitOther && !options.overwriteExplicit ? "conflict" : "change";
      return { id: variant.id, sku: variant.sku, fromPta: variant.pta_status, fromCondition: variant.condition, action };
    });
    const base = { productId: product.id, title: product.title, variants: rows, changeIds: [] as string[], productDefaultsChange };
    if (own.length === 0) return { ...base, status: "skipped", reason: "The product has no variants." };
    const conflicts = rows.filter((row) => row.action === "conflict");
    if (conflicts.length)
      return { ...base, status: "skipped", reason: `${conflicts.length} variant(s) already carry a different explicit PTA/Condition (${conflicts.map((row) => row.sku).join(", ")}) — needs manual review.` };
    const graded = own.filter((variant) => variant.condition_grade && desired.condition !== "used");
    if (graded.length) return { ...base, status: "skipped", reason: `Variant(s) ${graded.map((variant) => variant.sku).join(", ")} carry used-phone grade facts that only fit Condition = used.` };
    // After the write every variant of the product has the desired pair; two variants that differ only by it would collide.
    const seen = new Set<string>();
    for (const variant of own) {
      const key = comboKey(variant, desired.pta, desired.condition);
      if (seen.has(key)) return { ...base, status: "skipped", reason: "Two variants differ only in PTA/Condition; setting both would create identical variants." };
      seen.add(key);
    }
    const changeIds = rows.filter((row) => row.action === "change").map((row) => row.id);
    if (changeIds.length === 0 && !productDefaultsChange) return { ...base, status: "already_correct", reason: null };
    return { ...base, status: "change", reason: null, changeIds };
  });

  const countVariants = (predicate: (variant: CommercialVariant) => boolean) => products.reduce((total, product) => total + (byProduct.get(product.id) ?? []).filter(predicate).length, 0);
  return {
    desired,
    products: plans,
    totals: {
      products: products.length,
      variants: countVariants(() => true),
      unknownPta: countVariants((variant) => variant.pta_status === "unknown"),
      unknownCondition: countVariants((variant) => variant.condition === "unknown"),
      variantsToChange: plans.reduce((total, plan) => total + plan.changeIds.length, 0),
      variantsAlreadyCorrect: plans.reduce((total, plan) => total + (plan.status === "skipped" ? 0 : plan.variants.filter((row) => row.action === "already").length), 0),
      productsToChange: plans.filter((plan) => plan.status === "change").length,
      productsAlreadyCorrect: plans.filter((plan) => plan.status === "already_correct").length,
      productsSkipped: plans.filter((plan) => plan.status === "skipped").length,
      productDefaultsToChange: plans.filter((plan) => plan.status === "change" && plan.productDefaultsChange).length,
    },
  };
}

// ---------------- Verification ----------------

export type CommercialSnapshot = { variants: CommercialVariant[]; mediaCount: number; stockRows: number; stockSum: number };
export type CommercialCheck = { name: string; ok: boolean; detail: string };

/** Compares a product's state before and after the write. Only the targeted pta/condition may differ. */
export function verifyCommercialUpdate(before: CommercialSnapshot, after: CommercialSnapshot, desired: CommercialDesired, targetIds: string[]): CommercialCheck[] {
  const check = (name: string, ok: boolean, detail: string): CommercialCheck => ({ name, ok, detail });
  const afterById = new Map(after.variants.map((variant) => [variant.id, variant]));
  const target = new Set(targetIds);
  const changedPreserved: string[] = [];
  const untouchedChanged: string[] = [];
  const wrongValue: string[] = [];
  for (const old of before.variants) {
    const now = afterById.get(old.id);
    if (!now) continue;
    if (PRESERVED_FIELDS.some((field) => old[field] !== now[field])) changedPreserved.push(old.sku);
    if (target.has(old.id)) {
      if (now.pta_status !== desired.pta || now.condition !== desired.condition) wrongValue.push(old.sku);
    } else if (now.pta_status !== old.pta_status || now.condition !== old.condition) untouchedChanged.push(old.sku);
  }
  return [
    check("Variant count unchanged", before.variants.length === after.variants.length && before.variants.every((variant) => afterById.has(variant.id)), `${before.variants.length} before, ${after.variants.length} after`),
    check("PTA and Condition set on targets", wrongValue.length === 0, wrongValue.length ? `Wrong/unset: ${wrongValue.join(", ")}` : `${targetIds.length} variant(s) = ${desired.pta} / ${desired.condition}`),
    check("No target left Unknown", !targetIds.some((id) => afterById.get(id)?.pta_status === "unknown" || afterById.get(id)?.condition === "unknown"), "PTA and Condition are resolved"),
    check("Other variants unchanged", untouchedChanged.length === 0, untouchedChanged.length ? `Changed: ${untouchedChanged.join(", ")}` : "Untargeted variants untouched"),
    check("Prices, SKUs, RAM/storage/colour, delivery, stock-facing fields unchanged", changedPreserved.length === 0, changedPreserved.length ? `Changed: ${changedPreserved.join(", ")}` : "All preserved fields identical"),
    check("Media count unchanged", before.mediaCount === after.mediaCount, `${before.mediaCount} before, ${after.mediaCount} after`),
    check("Stock ledger unchanged", before.stockRows === after.stockRows && before.stockSum === after.stockSum, `${before.stockRows} rows / ${before.stockSum} units before, ${after.stockRows} / ${after.stockSum} after`),
  ];
}

// ---------------- Write loop ----------------

export type CommercialDeps = {
  supabaseUrl: string | undefined | null;
  buildMode: string | undefined | null;
  readSnapshot: (productId: string) => Promise<CommercialSnapshot>;
  readProduct: (productId: string) => Promise<{ defaultPta: string; defaultCondition: string }>;
  /** Writes ONLY pta_status and condition for these variant ids of one product. */
  updateVariants: (productId: string, variantIds: string[], values: { pta_status: string; condition: string }) => Promise<void>;
  /** Writes ONLY default_pta_status and default_condition of the product. */
  updateProductDefaults: (productId: string, values: { default_pta_status: string; default_condition: string }) => Promise<void>;
  onProgress?: (done: number, total: number, current: string) => void;
};

export type CommercialProductResult = {
  productId: string;
  title: string;
  status: "updated" | "already_correct" | "skipped" | "failed";
  variantsUpdated: number;
  message: string;
  checks: CommercialCheck[];
};

export type CommercialRunResult = {
  outcome: "verified" | "issues" | "blocked";
  message: string;
  products: CommercialProductResult[];
  summary: { productsUpdated: number; variantsUpdated: number; alreadyCorrect: number; skipped: number; failed: number };
};

function summarize(products: CommercialProductResult[]): CommercialRunResult["summary"] {
  return {
    productsUpdated: products.filter((product) => product.status === "updated").length,
    variantsUpdated: products.reduce((total, product) => total + product.variantsUpdated, 0),
    alreadyCorrect: products.filter((product) => product.status === "already_correct").length,
    skipped: products.filter((product) => product.status === "skipped").length,
    failed: products.filter((product) => product.status === "failed").length,
  };
}

const messageOf = (error: unknown) => (error instanceof Error && error.message ? error.message : "unknown error");

/**
 * Applies a reviewed plan product by product. Right before each write the product's variants are re-read and must still
 * match the plan ("changed since preview" otherwise); afterwards everything is re-read and verified. A product failure never
 * stops the others. "verified" only when every product was read back and passed.
 */
export async function runCommercialDefaults(plan: CommercialPlan, deps: CommercialDeps): Promise<CommercialRunResult> {
  const target = commercialWriteTarget(deps.supabaseUrl, deps.buildMode);
  if (!target.allowed) return { outcome: "blocked", message: `${target.reason} Nothing was changed.`, products: [], summary: summarize([]) };
  const results: CommercialProductResult[] = [];
  const todo = plan.products;
  for (const [index, entry] of todo.entries()) {
    deps.onProgress?.(index, todo.length, entry.title);
    const base = { productId: entry.productId, title: entry.title, variantsUpdated: 0, checks: [] as CommercialCheck[] };
    if (entry.status === "skipped") {
      results.push({ ...base, status: "skipped", message: entry.reason ?? "Skipped." });
      continue;
    }
    if (entry.status === "already_correct") {
      results.push({ ...base, status: "already_correct", message: "Already correct." });
      continue;
    }
    try {
      const before = await deps.readSnapshot(entry.productId);
      const stillMatches =
        before.variants.length === entry.variants.length &&
        entry.variants.every((row) => {
          const now = before.variants.find((variant) => variant.id === row.id);
          return now && now.pta_status === row.fromPta && now.condition === row.fromCondition;
        });
      if (!stillMatches) {
        results.push({ ...base, status: "failed", message: "Variants changed since preview — nothing was written; run the preview again." });
        continue;
      }
      if (entry.changeIds.length > 0) await deps.updateVariants(entry.productId, entry.changeIds, { pta_status: plan.desired.pta, condition: plan.desired.condition });
      if (entry.productDefaultsChange) await deps.updateProductDefaults(entry.productId, { default_pta_status: plan.desired.pta, default_condition: plan.desired.condition });
      const after = await deps.readSnapshot(entry.productId);
      const defaults = await deps.readProduct(entry.productId);
      const checks = verifyCommercialUpdate(before, after, plan.desired, entry.changeIds);
      checks.push({
        name: "Product defaults match",
        ok: defaults.defaultPta === plan.desired.pta && defaults.defaultCondition === plan.desired.condition,
        detail: `${defaults.defaultPta} / ${defaults.defaultCondition}`,
      });
      const ok = checks.every((item) => item.ok);
      results.push({
        ...base,
        status: ok ? "updated" : "failed",
        variantsUpdated: ok ? entry.changeIds.length : 0,
        message: ok ? `${entry.changeIds.length} variant(s) updated and verified.` : `Written, but read-back verification FAILED: ${checks.filter((item) => !item.ok).map((item) => item.name).join(", ")}.`,
        checks,
      });
    } catch (error) {
      results.push({ ...base, status: "failed", message: `Update failed: ${messageOf(error)}. Re-run the preview to see what changed.` });
    }
  }
  deps.onProgress?.(todo.length, todo.length, "");
  const summary = summarize(results);
  const clean = summary.failed === 0;
  return {
    outcome: clean ? "verified" : "issues",
    message: clean
      ? `Verified: ${summary.productsUpdated} product(s) / ${summary.variantsUpdated} variant(s) updated, ${summary.alreadyCorrect} already correct, ${summary.skipped} skipped.`
      : `Finished with issues: ${summary.failed} product(s) failed, ${summary.productsUpdated} updated, ${summary.skipped} skipped.`,
    products: results,
    summary,
  };
}
