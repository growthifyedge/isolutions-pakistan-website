/**
 * Android Stock Update — the "Update Website" WRITE PATH (built and tested; NOT wired to the page yet).
 *
 * Exactly one write per Owner result group, and nothing else:
 *   Price Changed     -> product_variants.update({ price_minor })                  (same row, same SKU)
 *   Stock 30          -> inventory_movements.insert(one 'correction' row = 30 - current stock), for every
 *                        existing Android variant in the list that is visible after the update (Same, Price Changed,
 *                        Back On Website). New variants and new phones start at 30. Hidden items: stock untouched.
 *   New Variants      -> product_variants.insert(one row, sku "" = server SKU)     + inventory_movements.insert(opening stock)
 *   New Phones        -> rpc apply_catalog_bulk_import_v2, action "Create" ONLY    (draft product + variants + stock, atomic)
 *   Will Be Hidden    -> product_variants.update({ is_active: false })             (never delete, never unpublish)
 *   Back On Website   -> product_variants.update({ is_active: true })
 *   Same              -> no action
 *   Needs Attention   -> the whole Update Website is BLOCKED until every row is fixed (there is no skip)
 *   Not Android Phones-> untouched
 * products, product_media and product_specifications are never written for an existing phone. "Replace Existing" of the
 * import RPC is never used: it rewrites compare-at prices / variant facts and hides every variant not in its file.
 *
 * Database access is injected, so the whole flow runs offline in tests. Pure planning + gate + runner + verifier.
 */
import { ANDROID_MOBILE_WARRANTY } from "./catalogSheet.ts";
import { CANONICAL_CONDITION, CANONICAL_PTA, commercialWriteTarget } from "./commercialDefaults.ts";
import { STOCK_UPDATE_TARGET, needsStockTarget, willHide, type CatalogDeltaProduct, type CatalogDeltaVariant, type DeltaEntry, type StockDelta } from "./stockListDelta.ts";

// ---------------------------------------------------------------------------
// Plan
// ---------------------------------------------------------------------------

export type InheritedFacts = { ptaStatus: string; condition: string; warrantyOverride: string | null; deliveryScope: string | null };

export type NewPhoneVariantPayload = {
  source: string;
  ram: string | null;
  storage: string | null;
  color: string | null;
  price_minor: number;
  stock: number;
  pta_status: string;
  condition: string;
  warranty: string;
  delivery_scope: string;
};

export type NewPhonePayload = {
  source: string;
  action: "Create";
  product_type: "Mobile Phone";
  brand: string;
  category: "Mobile Phones";
  title: string;
  variants: NewPhoneVariantPayload[];
};

export type WriteStep =
  | { kind: "price"; entryId: string; productId: string; productTitle: string; variantId: string; sku: string; label: string; fromMinor: number; toMinor: number }
  | { kind: "set_stock"; entryId: string; productId: string; productTitle: string; variantId: string; sku: string; label: string; fromStock: number; toStock: number }
  | { kind: "show"; entryId: string; productId: string; productTitle: string; variantIds: string[]; label: string }
  | { kind: "hide"; entryId: string; productId: string; productTitle: string; variantIds: string[]; label: string; scope: "product" | "variant" }
  | { kind: "add_variant"; entryId: string; productId: string; productTitle: string; ram: string | null; storage: string | null; color: string | null; priceMinor: number; stock: number; inherited: InheritedFacts; label: string }
  | { kind: "create_phone"; entryIds: string[]; productTitle: string; payload: NewPhonePayload };

export type BlockedRow = { entryId: string; productTitle: string; label: string; reason: string };

export type WritePlan = {
  steps: WriteStep[];
  counts: { priceUpdates: number; stockUpdates: number; newVariants: number; newPhones: number; newPhoneVariants: number; hideSteps: number; hiddenVariants: number; showSteps: number; shownVariants: number; same: number; notAndroid: number; blocked: number };
  /** Rows that stop Update Website: Needs Attention, or a listed row that cannot be written safely. Any blocked row stops everything. */
  blocked: BlockedRow[];
  /** Existing phones the write may touch (variants only). Their products / media / specifications rows must read back identical. */
  touchedProductIds: string[];
  fingerprint: string;
};

/** Every write kind that exists. There is no delete, no media, no specification and no products-row write for existing phones. */
export const WRITE_KINDS = ["price", "set_stock", "show", "hide", "add_variant", "create_phone"] as const;

const unique = <T,>(values: T[]) => [...new Set(values)];

/** New variants inherit PTA / condition / warranty / delivery from the phone's existing variants — only when they all agree. Never guessed. */
export function inheritedFacts(product: CatalogDeltaProduct): InheritedFacts | string {
  const siblings = product.variants.filter((variant) => variant.isActive).length ? product.variants.filter((variant) => variant.isActive) : product.variants;
  if (!siblings.length) return "This phone has no existing variant to copy PTA / condition from";
  const one = <K extends keyof CatalogDeltaVariant>(key: K) => unique(siblings.map((variant) => variant[key] ?? null));
  const pta = one("ptaStatus");
  const condition = one("condition");
  const warranty = one("warrantyOverride");
  const delivery = one("deliveryScope");
  if (pta.length !== 1 || condition.length !== 1) return "The existing variants of this phone have different PTA or condition — add this variant by hand";
  if (warranty.length !== 1 || delivery.length !== 1) return "The existing variants of this phone have different warranty or delivery — add this variant by hand";
  if (!pta[0] || pta[0] === "unknown" || !condition[0] || condition[0] === "unknown") return "The existing variants of this phone have no PTA / condition to copy";
  return { ptaStatus: String(pta[0]), condition: String(condition[0]), warrantyOverride: (warranty[0] as string | null) ?? null, deliveryScope: (delivery[0] as string | null) ?? null };
}

/** FNV-1a over the ordered write steps: any change in what would be written changes it. */
export function planFingerprint(steps: readonly WriteStep[]): string {
  const text = steps
    .map((step) => {
      switch (step.kind) {
        case "price":
          return `price|${step.variantId}|${step.fromMinor}|${step.toMinor}`;
        case "set_stock":
          return `stock|${step.variantId}|${step.toStock}`;
        case "show":
        case "hide":
          return `${step.kind}|${[...step.variantIds].sort().join(",")}`;
        case "add_variant":
          return `add|${step.productId}|${step.ram}|${step.storage}|${step.color}|${step.priceMinor}|${JSON.stringify(step.inherited)}`;
        case "create_phone":
          return `create|${JSON.stringify(step.payload)}`;
      }
    })
    .join("\n");
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `${steps.length}:${hash.toString(16).padStart(8, "0")}`;
}

/** Turns the reviewed result (and the Owner's ticks) into exact write steps. Pure. */
/** The latest list is the final truth: there is no selection. Every listed item is written; every absent visible item is hidden. */
export function buildWritePlan(delta: StockDelta, catalog: readonly CatalogDeltaProduct[], activeBrands?: readonly string[]): WritePlan {
  const brandSet = activeBrands ? new Set(activeBrands.map((name) => name.trim().toLowerCase())) : null;
  const byId = new Map(catalog.map((product) => [product.id, product] as const));
  const steps: WriteStep[] = [];
  const blocked: BlockedRow[] = [];
  const phones = new Map<string, Extract<WriteStep, { kind: "create_phone" }>>();

  for (const entry of delta.entries) {
    if (entry.kind === "ambiguous") {
      blocked.push({ entryId: entry.id, productTitle: entry.productTitle, label: entry.label, reason: "Needs Attention — fix this row before updating the website" });
      continue;
    }
    if (entry.kind === "blocked" || !entry.willUpdate) continue;
    if (entry.kind === "price_change" && entry.productId && entry.variantId && entry.currentPriceMinor !== null && entry.newPriceMinor !== null) {
      steps.push({ kind: "price", entryId: entry.id, productId: entry.productId, productTitle: entry.productTitle, variantId: entry.variantId, sku: entry.sku ?? "", label: entry.label, fromMinor: entry.currentPriceMinor, toMinor: entry.newPriceMinor });
    }
    if (entry.showAgain && entry.productId && entry.variantId) {
      steps.push({ kind: "show", entryId: entry.id, productId: entry.productId, productTitle: entry.productTitle, variantIds: [entry.variantId], label: entry.label });
    }
    if (entry.kind === "new_variant" && entry.productId && entry.newPriceMinor !== null) {
      const product = byId.get(entry.productId);
      const facts = product ? inheritedFacts(product) : "The phone was not found in the website data";
      if (typeof facts === "string") {
        blocked.push({ entryId: entry.id, productTitle: entry.productTitle, label: entry.label, reason: facts });
        continue;
      }
      steps.push({ kind: "add_variant", entryId: entry.id, productId: entry.productId, productTitle: entry.productTitle, ram: entry.row.ram, storage: entry.row.storage, color: entry.row.color, priceMinor: entry.newPriceMinor, stock: STOCK_UPDATE_TARGET, inherited: facts, label: entry.label });
    }
    if (entry.kind === "new_product" && entry.newPriceMinor !== null) {
      const brand = entry.row.brand?.trim();
      if (!brand || !entry.row.ram || !entry.row.storage || !entry.row.color) {
        blocked.push({ entryId: entry.id, productTitle: entry.productTitle, label: entry.label, reason: "A new phone needs brand, RAM, storage and color" });
        continue;
      }
      // One unknown brand would make the import reject every new phone at once, so it is stopped per row here.
      if (brandSet && !brandSet.has(brand.toLowerCase())) {
        blocked.push({ entryId: entry.id, productTitle: entry.productTitle, label: entry.label, reason: `The brand “${brand}” is not set up on the website yet` });
        continue;
      }
      const key = entry.productSlug || entry.productTitle.toLowerCase();
      const step = phones.get(key) ?? { kind: "create_phone" as const, entryIds: [], productTitle: entry.productTitle, payload: { source: `Android Stock Update: ${entry.productTitle}`, action: "Create" as const, product_type: "Mobile Phone" as const, brand, category: "Mobile Phones" as const, title: entry.productTitle, variants: [] } };
      step.entryIds.push(entry.id);
      step.payload.variants.push({ source: `Line ${entry.row.lineNumber}: ${entry.label}`, ram: entry.row.ram, storage: entry.row.storage, color: entry.row.color, price_minor: entry.newPriceMinor, stock: STOCK_UPDATE_TARGET, pta_status: CANONICAL_PTA, condition: CANONICAL_CONDITION, warranty: ANDROID_MOBILE_WARRANTY, delivery_scope: "karachi_only" });
      phones.set(key, step);
    }
  }
  steps.push(...phones.values());

  for (const entry of delta.entries) {
    if (!needsStockTarget(entry)) continue;
    steps.push({ kind: "set_stock", entryId: entry.id, productId: entry.productId as string, productTitle: entry.productTitle, variantId: entry.variantId as string, sku: entry.sku ?? "", label: entry.label, fromStock: entry.stock ?? 0, toStock: STOCK_UPDATE_TARGET });
  }

  for (const entry of delta.missing) {
    if (!willHide(entry) || !entry.variantIds.length) continue;
    steps.push({ kind: "hide", entryId: entry.id, productId: entry.productId, productTitle: entry.productTitle, variantIds: [...entry.variantIds], label: entry.label, scope: entry.scope });
  }

  const of = <K extends WriteStep["kind"]>(kind: K) => steps.filter((step): step is Extract<WriteStep, { kind: K }> => step.kind === kind);
  const touched = unique(steps.flatMap((step) => (step.kind === "create_phone" ? [] : [step.productId])));
  return {
    steps,
    counts: {
      priceUpdates: of("price").length,
      stockUpdates: of("set_stock").length,
      newVariants: of("add_variant").length,
      newPhones: of("create_phone").length,
      newPhoneVariants: of("create_phone").reduce((sum, step) => sum + step.payload.variants.length, 0),
      hideSteps: of("hide").length,
      hiddenVariants: of("hide").reduce((sum, step) => sum + step.variantIds.length, 0),
      showSteps: of("show").length,
      shownVariants: of("show").reduce((sum, step) => sum + step.variantIds.length, 0),
      same: delta.entries.filter((entry: DeltaEntry) => entry.kind === "unchanged" && !entry.showAgain).length,
      notAndroid: delta.counts.notAndroid,
      blocked: blocked.length,
    },
    blocked,
    touchedProductIds: touched,
    fingerprint: planFingerprint(steps),
  };
}

// ---------------------------------------------------------------------------
// Gate
// ---------------------------------------------------------------------------

export const confirmationPhrase = (plan: WritePlan) => `UPDATE ${plan.steps.length} CHANGES`;

/** Every condition Update Website needs. Returns the first reason it must stay off, or null. */
export function updateWebsiteBlocker(input: {
  supabaseUrl: string | undefined | null;
  buildMode: string | undefined | null;
  checkIsCurrent: boolean;
  plan: WritePlan | null;
  confirmation: string;
}): string | null {
  const target = commercialWriteTarget(input.supabaseUrl, input.buildMode);
  if (!target.allowed) return target.reason ?? "The website environment could not be confirmed.";
  if (!input.plan) return "Click Check List first.";
  if (!input.checkIsCurrent) return "You changed something since the last check. Click Check List again.";
  if (input.plan.blocked.length) return `${input.plan.blocked.length} row(s) need attention. Fix them first.`;
  if (!input.plan.steps.length) return "Nothing to update.";
  if (input.confirmation.trim() !== confirmationPhrase(input.plan)) return `Type ${confirmationPhrase(input.plan)} to confirm.`;
  return null;
}

// ---------------------------------------------------------------------------
// Snapshot + verification
// ---------------------------------------------------------------------------

/** Everything about an existing phone that must not change, plus its variants (compared field by field). */
export type ProductSnapshot = {
  productId: string;
  /** The whole products row (including slug, publication_status, published_at, updated_at). */
  product: Record<string, unknown>;
  /** product_media rows, full. */
  media: Record<string, unknown>[];
  /** product_specifications rows, full. */
  specifications: Record<string, unknown>[];
  /** product_variants rows, full, keyed by id. */
  variants: Record<string, Record<string, unknown>>;
  /** Current stock per variant id. */
  stock: Record<string, number>;
};

export type VerifyCheck = { productId: string; name: string; ok: boolean; detail: string };

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const sortRows = (rows: Record<string, unknown>[]) => [...rows].sort((a, b) => String(a.id).localeCompare(String(b.id)));
/** Columns the database itself changes on any variant update. */
const VOLATILE_VARIANT_COLUMNS = new Set(["updated_at"]);

function variantChanges(before: Record<string, unknown>, after: Record<string, unknown>) {
  return Object.keys({ ...before, ...after }).filter((key) => !VOLATILE_VARIANT_COLUMNS.has(key) && !same(before[key], after[key]));
}

/**
 * Read-back verification for one existing phone. Verified only if: products row identical (incl. slug, publication, updated_at),
 * media and specification rows identical, no variant deleted, each existing variant changed ONLY in the column its step targets
 * (price_minor / is_active) to exactly the target value, SKUs unchanged, stock of existing variants unchanged, and every planned
 * new variant exists once with the inherited facts, a server SKU and its opening stock.
 */
export function verifyProduct(productId: string, before: ProductSnapshot, after: ProductSnapshot, steps: readonly WriteStep[]): VerifyCheck[] {
  const checks: VerifyCheck[] = [];
  const add = (name: string, ok: boolean, detail: string) => checks.push({ productId, name, ok, detail });
  add("Product row unchanged (slug, URL, publication, metadata)", same(before.product, after.product), "products row compared column by column");
  add("Images unchanged", same(sortRows(before.media), sortRows(after.media)), `${before.media.length} -> ${after.media.length} media row(s)`);
  add("Specifications unchanged", same(sortRows(before.specifications), sortRows(after.specifications)), `${before.specifications.length} -> ${after.specifications.length} specification row(s)`);

  const expected = new Map<string, Record<string, unknown>>();
  const stockTarget = new Map<string, number>();
  for (const step of steps) if (step.kind === "set_stock" && step.productId === productId) stockTarget.set(step.variantId, step.toStock);
  for (const step of steps) {
    if (step.kind === "price" && step.productId === productId) expected.set(step.variantId, { ...(expected.get(step.variantId) ?? {}), price_minor: step.toMinor });
    if ((step.kind === "show" || step.kind === "hide") && step.productId === productId)
      for (const id of step.variantIds) expected.set(id, { ...(expected.get(id) ?? {}), is_active: step.kind === "show" });
  }
  for (const [id, row] of Object.entries(before.variants)) {
    const now = after.variants[id];
    if (!now) {
      add(`Variant ${row.sku} still exists`, false, "variant row missing after the update");
      continue;
    }
    const target = expected.get(id) ?? {};
    const changed = variantChanges(row, now);
    const unexpected = changed.filter((key) => !(key in target));
    const wrong = Object.entries(target).filter(([key, value]) => !same(now[key], value));
    add(`Variant ${row.sku}: only the planned field changed`, unexpected.length === 0 && wrong.length === 0, unexpected.length ? `unexpected change: ${unexpected.join(", ")}` : wrong.length ? `not at target: ${wrong.map(([key]) => key).join(", ")}` : Object.keys(target).length ? `changed: ${Object.keys(target).join(", ")}` : "untouched");
    const wantStock = stockTarget.get(id) ?? before.stock[id] ?? 0;
    add(`Variant ${row.sku}: SKU unchanged, stock ${stockTarget.has(id) ? `set to ${wantStock}` : "unchanged"}`, now.sku === row.sku && (after.stock[id] ?? 0) === wantStock, `stock ${before.stock[id] ?? 0} -> ${after.stock[id] ?? 0}`);
  }

  const created = Object.entries(after.variants).filter(([id]) => !(id in before.variants));
  const planned = steps.filter((step): step is Extract<WriteStep, { kind: "add_variant" }> => step.kind === "add_variant" && step.productId === productId);
  add("No unexpected new variant", created.length === planned.length, `${created.length} created, ${planned.length} planned`);
  for (const step of planned) {
    const match = created.filter(([, row]) => row.ram_display === step.ram && row.storage_display === step.storage && row.color_finish === step.color);
    const [id, row] = match[0] ?? [];
    const ok =
      match.length === 1 &&
      row !== undefined &&
      row.price_minor === step.priceMinor &&
      row.is_active === true &&
      row.pta_status === step.inherited.ptaStatus &&
      row.condition === step.inherited.condition &&
      (row.warranty_override ?? null) === step.inherited.warrantyOverride &&
      (row.delivery_scope ?? null) === step.inherited.deliveryScope &&
      typeof row.sku === "string" &&
      /^MB[0-9]{3}$/.test(row.sku) &&
      (after.stock[id as string] ?? 0) === step.stock;
    add(`New variant ${step.label} added correctly`, ok, ok ? `SKU ${row?.sku}, stock ${step.stock}` : "missing, duplicated or different from the plan");
  }
  return checks;
}

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

export type StockUpdateDeps = {
  supabaseUrl: string | undefined | null;
  buildMode: string | undefined | null;
  /** Fresh read-only catalog, used to re-plan immediately before writing. */
  readCatalog: () => Promise<CatalogDeltaProduct[]>;
  /** Re-run the same comparison on fresh data (parse + Owner fixes + ticks are already applied by the caller). */
  replan: (catalog: CatalogDeltaProduct[]) => WritePlan;
  readSnapshot: (productId: string) => Promise<ProductSnapshot>;
  updatePrice: (variantId: string, priceMinor: number) => Promise<void>;
  setActive: (variantIds: string[], productId: string, isActive: boolean) => Promise<void>;
  insertVariant: (productId: string, values: { ram: string | null; storage: string | null; color: string | null; priceMinor: number; inherited: InheritedFacts }) => Promise<{ id: string; sku: string }>;
  insertOpeningStock: (variantId: string, quantity: number) => Promise<void>;
  /** Current stock (sum of the ledger) read immediately before the correction row is written. */
  readStock: (variantId: string) => Promise<number>;
  /** One inventory_movements 'correction' row; never edits or deletes ledger rows. */
  adjustStock: (variantId: string, delta: number) => Promise<void>;
  createPhones: (products: NewPhonePayload[]) => Promise<{ products: { id: string; title: string; action: string }[]; assigned_skus: { product: string; sku: string }[] }>;
  /** Read-only check that a created phone exists with its variants (draft, never published by this tool). */
  readCreatedPhone: (productId: string) => Promise<{ publicationStatus: string; variantCount: number; skus: string[] }>;
};

export type StepResult = { step: WriteStep; ok: boolean; message: string };

/**
 * Live progress, reported from REAL completed work only (never a timer):
 *   checking  -> re-reading the website and re-planning (no write yet)
 *   saving    -> reading the "before" copy of each touched phone (checked / toCheck)
 *   writing   -> `done` write steps finished out of `total` (= the confirmed change count); `kind` is the step running now
 *   verifying -> read-back of each touched phone / new phone (checked / toCheck); all writes are finished
 *   finished  -> the runner returned
 * `failed` counts write steps that finished with an error (they also count as done: nothing is retried).
 */
export type StockUpdateProgress = {
  phase: "checking" | "saving" | "writing" | "verifying" | "finished";
  kind: WriteStep["kind"] | null;
  done: number;
  total: number;
  failed: number;
  checked: number;
  toCheck: number;
  /** The step that failed most recently (for an exact on-screen report). */
  lastFailure: { productTitle: string; kind: WriteStep["kind"]; message: string } | null;
};

export type StockUpdateResult = {
  outcome: "blocked" | "verified" | "failed";
  message: string;
  results: StepResult[];
  checks: VerifyCheck[];
  createdPhones: { id: string; title: string; skus: string[] }[];
};

/**
 * Writes the REVIEWED plan. Refuses unless the environment pair matches, the plan has no blocked row, and a fresh read of the
 * website yields the exact same plan (fingerprint). Snapshots every touched phone first, writes step by step, then re-reads
 * and verifies. Nothing is deleted at any point; a failed step is reported and the rest continue.
 */
export async function runStockUpdate(deps: StockUpdateDeps, reviewed: WritePlan, onProgress?: (progress: StockUpdateProgress) => void): Promise<StockUpdateResult> {
  const empty = { results: [], checks: [], createdPhones: [] };
  const progress: StockUpdateProgress = { phase: "checking", kind: null, done: 0, total: reviewed.steps.length, failed: 0, checked: 0, toCheck: 0, lastFailure: null };
  // A progress listener can never break or change the update.
  const emit = (patch: Partial<StockUpdateProgress> = {}) => {
    Object.assign(progress, patch);
    try {
      onProgress?.({ ...progress, lastFailure: progress.lastFailure ? { ...progress.lastFailure } : null });
    } catch {
      /* ignore listener errors */
    }
  };
  const target = commercialWriteTarget(deps.supabaseUrl, deps.buildMode);
  if (!target.allowed) return { outcome: "blocked", message: `${target.reason} Nothing was written.`, ...empty };
  if (reviewed.blocked.length) return { outcome: "blocked", message: `${reviewed.blocked.length} row(s) need attention. Nothing was written.`, ...empty };
  if (!reviewed.steps.length) return { outcome: "blocked", message: "Nothing to update. Nothing was written.", ...empty };

  emit();
  const fresh = deps.replan(await deps.readCatalog());
  if (fresh.fingerprint !== reviewed.fingerprint || fresh.blocked.length) {
    return { outcome: "blocked", message: "The website changed since you checked the list. Click Check List again. Nothing was written.", ...empty };
  }

  const before = new Map<string, ProductSnapshot>();
  emit({ phase: "saving", checked: 0, toCheck: reviewed.touchedProductIds.length });
  for (const productId of reviewed.touchedProductIds) {
    before.set(productId, await deps.readSnapshot(productId));
    emit({ checked: progress.checked + 1 });
  }

  const results: StepResult[] = [];
  const record = (step: WriteStep, ok: boolean, message: string) => {
    results.push({ step, ok, message });
    emit(ok ? { done: progress.done + 1 } : { done: progress.done + 1, failed: progress.failed + 1, lastFailure: { productTitle: step.productTitle, kind: step.kind, message } });
  };
  emit({ phase: "writing", checked: 0, toCheck: 0 });
  const createdPhones: StockUpdateResult["createdPhones"] = [];

  for (const step of reviewed.steps) {
    if (step.kind === "create_phone") continue; // all new phones are created together, in one atomic call, after this loop
    emit({ kind: step.kind });
    try {
      if (step.kind === "price") {
        await deps.updatePrice(step.variantId, step.toMinor);
        record(step, true, "price updated");
      } else if (step.kind === "show" || step.kind === "hide") {
        await deps.setActive(step.variantIds, step.productId, step.kind === "show");
        record(step, true, step.kind === "show" ? "shown again" : "hidden");
      } else if (step.kind === "set_stock") {
        const delta = step.toStock - (await deps.readStock(step.variantId));
        if (delta !== 0) await deps.adjustStock(step.variantId, delta);
        record(step, true, delta === 0 ? `stock already ${step.toStock}` : `stock set to ${step.toStock} (${delta > 0 ? "+" : ""}${delta})`);
      } else if (step.kind === "add_variant") {
        const created = await deps.insertVariant(step.productId, { ram: step.ram, storage: step.storage, color: step.color, priceMinor: step.priceMinor, inherited: step.inherited });
        await deps.insertOpeningStock(created.id, step.stock);
        record(step, true, `added as ${created.sku}`);
      }
    } catch (problem) {
      record(step, false, problem instanceof Error ? problem.message : String(problem));
    }
  }

  // New phones: one atomic call (all or none), action "Create" only -> draft products.
  const phoneSteps = reviewed.steps.filter((step): step is Extract<WriteStep, { kind: "create_phone" }> => step.kind === "create_phone");
  if (phoneSteps.length) {
    emit({ kind: "create_phone" });
    try {
      const response = await deps.createPhones(phoneSteps.map((step) => step.payload));
      for (const step of phoneSteps) {
        const product = response.products.find((item) => item.title === step.productTitle && item.action === "Create");
        if (!product) {
          record(step, false, "not reported as created");
          continue;
        }
        const skus = response.assigned_skus.filter((item) => item.product === step.productTitle).map((item) => item.sku);
        createdPhones.push({ id: product.id, title: step.productTitle, skus });
        record(step, true, `created as a draft with ${skus.length} variant(s)`);
      }
    } catch (problem) {
      for (const step of phoneSteps) record(step, false, problem instanceof Error ? problem.message : String(problem));
    }
  }

  const checks: VerifyCheck[] = [];
  emit({ phase: "verifying", kind: null, checked: 0, toCheck: before.size + createdPhones.length });
  for (const [productId, snapshot] of before) {
    checks.push(...verifyProduct(productId, snapshot, await deps.readSnapshot(productId), reviewed.steps));
    emit({ checked: progress.checked + 1 });
  }
  for (const phone of createdPhones) {
    const step = phoneSteps.find((item) => item.productTitle === phone.title);
    const read = await deps.readCreatedPhone(phone.id);
    const ok = read.publicationStatus === "draft" && read.variantCount === (step?.payload.variants.length ?? -1) && read.skus.every((sku) => /^MB[0-9]{3}$/.test(sku));
    checks.push({ productId: phone.id, name: `New phone ${phone.title} created as a draft`, ok, detail: `${read.publicationStatus}, ${read.variantCount} variant(s)` });
    emit({ checked: progress.checked + 1 });
  }
  emit({ phase: "finished" });

  const allWritten = results.every((result) => result.ok);
  const allVerified = checks.every((check) => check.ok);
  return {
    outcome: allWritten && allVerified ? "verified" : "failed",
    message: allWritten && allVerified ? `Website updated and checked: ${results.length} change(s).` : `${results.filter((result) => !result.ok).length} change(s) failed and ${checks.filter((check) => !check.ok).length} check(s) did not pass. Nothing was deleted; review the list below.`,
    results,
    checks,
    createdPhones,
  };
}
