/**
 * Android Stock Update — the "Update Website" write path (Safe Partial Updates).
 *
 * The plan: one write step per Owner result group (buildWritePlan), grouped by phone (buildPhonePlan):
 *   Price Changed     -> new price on the same variant row (same SKU)
 *   Stock 30          -> one 'correction' ledger row = 30 - current stock, for every existing listed variant that is
 *                        visible after the update. New variants and new phones start at 30. Hidden items: stock untouched.
 *   New Variants      -> new variant row (server SKU) + opening stock; PTA / condition / warranty / delivery copied only
 *                        when every sibling variant agrees
 *   New Phones        -> apply_catalog_bulk_import_v2, action "Create" ONLY, ONE phone per call (draft)
 *   Will Be Hidden    -> is_active = false (never delete, never unpublish)
 *   Back On Website   -> is_active = true
 *   Same              -> no action
 *   Needs Attention   -> that phone (and any phone a problem line looks like) is HELD: nothing written, nothing hidden;
 *                        every other phone still updates
 *   Not Android Phones-> untouched
 * Each existing phone is written by ONE call to apply_android_stock_phone (all of its changes or none), then read back.
 * products, product_media and product_specifications are never written for an existing phone.
 *
 * Database access is injected, so the whole flow runs offline in tests. Pure planning + gate + runner + verifier.
 */
import { ANDROID_MOBILE_WARRANTY } from "./catalogSheet.ts";
import { CANONICAL_CONDITION, CANONICAL_PTA, commercialWriteTarget } from "./commercialDefaults.ts";
import { STOCK_UPDATE_TARGET, identityKey, isAndroidCatalogProduct, needsStockTarget, willHide, type CatalogDeltaProduct, type CatalogDeltaVariant, type DeltaEntry, type StockDelta } from "./stockListDelta.ts";

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

/** Planner reason for a listed new variant without RAM, storage or colour (the database refuses such a variant too). */
export const NEW_VARIANT_INCOMPLETE = "A new variant needs RAM, storage and colour";

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
      // Same rule as the database: a new variant is never created without RAM, storage and colour (never guessed).
      if (!entry.row.ram?.trim() || !entry.row.storage?.trim() || !entry.row.color?.trim()) {
        blocked.push({ entryId: entry.id, productTitle: entry.productTitle, label: entry.label, reason: NEW_VARIANT_INCOMPLETE });
        continue;
      }
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
// Per-phone plan (Safe Partial Updates)
// ---------------------------------------------------------------------------

/** One step as the database function apply_android_stock_phone reads it (snake_case, see the migration). */
export type PhoneRpcStep =
  | { kind: "price"; variant_id: string; from_minor: number; to_minor: number }
  | { kind: "show" | "hide"; variant_ids: string[] }
  | { kind: "set_stock"; variant_id: string; to_stock: number }
  | {
      kind: "add_variant";
      ram: string | null;
      storage: string | null;
      color: string | null;
      price_minor: number;
      stock: number;
      inherited: { pta_status: string; condition: string; warranty_override: string | null; delivery_scope: string | null };
    };

/** The payload of ONE call to apply_android_stock_phone: every planned change of one existing phone, all or nothing. */
export type PhoneRpcPayload = {
  product_id: string;
  /** Every variant of the phone as Check List saw it; the database refuses the phone if any of it changed since. */
  expected: { variants: { id: string; price_minor: number; is_active: boolean }[] };
  steps: PhoneRpcStep[];
};

/** One phone that Update Website will write, in its own all-or-nothing call. */
export type PhoneUpdate =
  | { kind: "existing"; key: string; productId: string; productTitle: string; steps: WriteStep[]; payload: PhoneRpcPayload }
  | { kind: "new"; key: string; productId: null; productTitle: string; steps: [Extract<WriteStep, { kind: "create_phone" }>]; payload: NewPhonePayload };

/** A phone (or an unmatched line) left out of this update until the Owner fixes it. Nothing about it is written or hidden. */
export type HeldPhone = { key: string; productId: string | null; productTitle: string; reasons: string[]; lines: number[] };

export type PhonePlan = {
  phones: PhoneUpdate[];
  held: HeldPhone[];
  /** Real changes across the phones that will be written (the number the Owner types to confirm). */
  changeCount: number;
  counts: WritePlan["counts"] & { phones: number; heldPhones: number; notMatched: number };
};

function toRpcStep(step: WriteStep): PhoneRpcStep {
  switch (step.kind) {
    case "price":
      return { kind: "price", variant_id: step.variantId, from_minor: step.fromMinor, to_minor: step.toMinor };
    case "show":
    case "hide":
      return { kind: step.kind, variant_ids: [...step.variantIds] };
    case "set_stock":
      return { kind: "set_stock", variant_id: step.variantId, to_stock: step.toStock };
    case "add_variant":
      return {
        kind: "add_variant",
        ram: step.ram,
        storage: step.storage,
        color: step.color,
        price_minor: step.priceMinor,
        stock: step.stock,
        inherited: { pta_status: step.inherited.ptaStatus, condition: step.inherited.condition, warranty_override: step.inherited.warrantyOverride, delivery_scope: step.inherited.deliveryScope },
      };
    case "create_phone":
      throw new Error("A new phone is never part of an existing phone's update");
  }
}

const newPhoneKey = (entry: Pick<DeltaEntry, "productSlug" | "productTitle">) => `new:${entry.productSlug || entry.productTitle.toLowerCase()}`;

/** The held-list key of a review row (an existing phone's id, or its new-phone key), to mark rows of held phones on the page. */
export const heldKeyOf = (entry: Pick<DeltaEntry, "productId" | "productSlug" | "productTitle">) => entry.productId ?? newPhoneKey(entry);

/** The write rules' reasons, in words the Owner can act on. */
function plainWriteRule(reason: string): string {
  if (reason === NEW_VARIANT_INCOMPLETE) return "this line has no RAM, storage or colour for it, so it cannot be added as a new variant — add the missing colour (or RAM / storage) to the line";
  if (/no PTA \/ condition to copy/.test(reason)) return "the phone's other variants have no PTA / condition set, so this new variant cannot copy them — set them for this phone in Admin, or add the variant by hand";
  if (/no existing variant to copy/.test(reason)) return "the phone has no variant to copy PTA / condition from — add this variant by hand";
  if (/different PTA or condition/.test(reason)) return "the phone's other variants have different PTA or condition — add this variant by hand";
  if (/different warranty or delivery/.test(reason)) return "the phone's other variants have different warranty or delivery — add this variant by hand";
  return reason;
}

/**
 * Groups the write steps by phone. A phone with ANY row that needs attention — or that a problem line looks like — is held:
 * none of its changes are written and none of its variants are hidden. Every other phone is written in its own call.
 */
export function buildPhonePlan(delta: StockDelta, catalog: readonly CatalogDeltaProduct[], activeBrands?: readonly string[]): PhonePlan {
  const plan = buildWritePlan(delta, catalog, activeBrands);
  const byId = new Map(catalog.map((product) => [product.id, product] as const));
  const byTitle = new Map(catalog.map((product) => [product.title, product] as const));
  const entryById = new Map(delta.entries.map((entry) => [entry.id, entry] as const));
  const android = catalog.filter(isAndroidCatalogProduct);
  /** The one existing Android phone whose name (or URL) is exactly this unmatched row's, else null. Same rule as the comparison. */
  const exactExistingPhone = (entry: DeltaEntry): string | null => {
    if (entry.category !== "smartphone" || entry.nearTitles.length) return null;
    const key = identityKey(entry.productTitle);
    const matches = android.filter((product) => identityKey(product.title) === key || (entry.productSlug !== "" && product.slug === entry.productSlug));
    return matches.length === 1 ? matches[0].id : null;
  };

  const held = new Map<string, HeldPhone>();
  const hold = (key: string, productId: string | null, productTitle: string, reason: string, line?: number) => {
    const item = held.get(key) ?? { key, productId, productTitle, reasons: [], lines: [] };
    if (!item.reasons.includes(reason)) item.reasons.push(reason);
    if (line !== undefined && !item.lines.includes(line)) item.lines.push(line);
    held.set(key, item);
  };

  for (const row of plan.blocked) {
    const entry = entryById.get(row.entryId);
    // A row held by a write rule (e.g. a new variant whose PTA / condition cannot be copied) names its variant and line.
    const reasons = entry && entry.reasons.length ? entry.reasons : [entry && entry.kind === "new_variant" ? `New variant ${entry.label} (line ${entry.row.lineNumber}): ${plainWriteRule(row.reason)}` : row.reason];
    // A line the comparison could not read fully (e.g. its price is missing) can still name an existing phone exactly:
    // it is held under that phone, so the same phone is never listed twice (once as "not matched").
    const productId = entry?.productId ?? (entry ? exactExistingPhone(entry) : null);
    const key = productId ?? (entry ? newPhoneKey(entry) : row.entryId);
    for (const reason of reasons) hold(key, productId, row.productTitle, reason, entry?.row.lineNumber);
    // The phones a problem line looks like are held too, so a typo can never hide or change the real phone.
    for (const title of entry?.nearTitles ?? []) {
      const near = byTitle.get(title);
      if (near) hold(near.id, near.id, near.title, `A line that needs attention looks like this phone (line ${entry?.row.lineNumber})`);
    }
  }
  for (const missing of delta.missing) {
    if (missing.action === "held") hold(missing.productId, missing.productId, missing.productTitle, missing.reason);
  }

  const phones = new Map<string, PhoneUpdate>();
  for (const step of plan.steps) {
    if (step.kind === "create_phone") {
      const key = newPhoneKey({ productSlug: entryById.get(step.entryIds[0])?.productSlug ?? "", productTitle: step.productTitle });
      if (held.has(key)) continue;
      phones.set(key, { kind: "new", key, productId: null, productTitle: step.productTitle, steps: [step], payload: step.payload });
      continue;
    }
    if (held.has(step.productId)) continue;
    const product = byId.get(step.productId);
    if (!product) continue;
    const existing = phones.get(step.productId);
    if (existing && existing.kind === "existing") {
      existing.steps.push(step);
      existing.payload.steps.push(toRpcStep(step));
      continue;
    }
    phones.set(step.productId, {
      kind: "existing",
      key: step.productId,
      productId: step.productId,
      productTitle: product.title,
      steps: [step],
      payload: {
        product_id: product.id,
        expected: { variants: product.variants.map((variant) => ({ id: variant.id, price_minor: variant.priceMinor, is_active: variant.isActive })) },
        steps: [toRpcStep(step)],
      },
    });
  }

  const list = [...phones.values()];
  const heldList = [...held.values()];
  const written = list.flatMap((phone) => phone.steps);
  const of = <K extends WriteStep["kind"]>(kind: K) => written.filter((step): step is Extract<WriteStep, { kind: K }> => step.kind === kind);
  return {
    phones: list,
    held: heldList,
    changeCount: written.length,
    counts: {
      ...plan.counts,
      priceUpdates: of("price").length,
      stockUpdates: of("set_stock").length,
      newVariants: of("add_variant").length,
      newPhones: of("create_phone").length,
      newPhoneVariants: of("create_phone").reduce((sum, step) => sum + step.payload.variants.length, 0),
      hideSteps: of("hide").length,
      hiddenVariants: of("hide").reduce((sum, step) => sum + step.variantIds.length, 0),
      showSteps: of("show").length,
      shownVariants: of("show").reduce((sum, step) => sum + step.variantIds.length, 0),
      blocked: plan.blocked.length,
      phones: list.length,
      heldPhones: heldList.length,
      notMatched: heldList.filter((item) => item.productId === null).length,
    },
  };
}

// ---------------------------------------------------------------------------
// Gate
// ---------------------------------------------------------------------------

export const confirmationPhrase = (plan: PhonePlan) => `UPDATE ${plan.changeCount} CHANGES`;

/** Every condition Update Website needs. Returns the first reason it must stay off, or null. Held phones never stop the others. */
export function updateWebsiteBlocker(input: {
  supabaseUrl: string | undefined | null;
  buildMode: string | undefined | null;
  checkIsCurrent: boolean;
  plan: PhonePlan | null;
  confirmation: string;
}): string | null {
  const target = commercialWriteTarget(input.supabaseUrl, input.buildMode);
  if (!target.allowed) return target.reason ?? "The website environment could not be confirmed.";
  if (!input.plan) return "Click Check List first.";
  if (!input.checkIsCurrent) return "You changed something since the last check. Click Check List again.";
  if (!input.plan.phones.length) return input.plan.held.length ? "Every phone in this list needs attention. Fix them first." : "Nothing to update.";
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
// Runner (one all-or-nothing database call per phone)
// ---------------------------------------------------------------------------

/** What the database function returns for an updated phone. */
export type PhoneRpcResult = { status: string; new_variants?: { id: string; sku: string }[]; stock_corrections?: number };

/**
 * Thrown by the database adapter. `saved: false` = the database answered with an error, so the phone's transaction rolled
 * back and nothing was saved. `saved: "unknown"` = no answer (network), so the phone may or may not have been saved.
 */
export class PhoneWriteError extends Error {
  readonly saved: false | "unknown";
  constructor(message: string, saved: false | "unknown") {
    super(message);
    this.name = "PhoneWriteError";
    this.saved = saved;
  }
}

export type StockUpdateDeps = {
  supabaseUrl: string | undefined | null;
  buildMode: string | undefined | null;
  readSnapshot: (productId: string) => Promise<ProductSnapshot>;
  /** ONE call to apply_android_stock_phone (one transaction). */
  applyPhone: (payload: PhoneRpcPayload) => Promise<PhoneRpcResult>;
  /** ONE call to apply_catalog_bulk_import_v2 with ONE "Create" product (one transaction). */
  createPhone: (payload: NewPhonePayload) => Promise<{ products: { id: string; title: string; action: string }[]; assigned_skus: { product: string; sku: string }[] }>;
  /** Read-only check that a created phone exists with its variants (draft, never published by this tool). */
  readCreatedPhone: (productId: string) => Promise<{ publicationStatus: string; variantCount: number; skus: string[] }>;
};

/**
 * updated     saved and read back exactly as planned
 * failed      not saved (the database refused or rolled back this phone); the reason says why
 * unknown     no answer from the website (network); run Check List to see whether it was saved
 * needs_check saved, but the read-back after saving did not match; run Check List
 * held        left out of this update until the Owner fixes it (never written, never hidden)
 */
export type PhoneStatus = "updated" | "failed" | "unknown" | "needs_check" | "held";

export type PhoneReport = {
  key: string;
  productId: string | null;
  productTitle: string;
  status: PhoneStatus;
  /** The exact reason(s) for anything that is not "updated". */
  reasons: string[];
  /** What was planned for this phone, in plain words. */
  changes: string[];
  /** SKUs the database gave to new variants / a new phone. */
  newSkus: string[];
  /** Read-back checks. */
  checks: VerifyCheck[];
};

export type StockUpdateProgress = {
  phase: "writing" | "finished";
  /** Phones finished (any status) out of `total`; moves only after a phone's call has returned. */
  done: number;
  total: number;
  failed: number;
  /** The phone being written now. */
  current: string | null;
  lastFailure: { productTitle: string; message: string } | null;
};

export type StockUpdateResult = {
  outcome: "blocked" | "finished";
  message: string;
  phones: PhoneReport[];
  counts: Record<PhoneStatus, number>;
};

const rupees = (minor: number) => `Rs ${(minor / 100).toLocaleString("en-PK")}`;

function describeSteps(steps: readonly WriteStep[]): string[] {
  return steps.map((step) => {
    switch (step.kind) {
      case "price":
        return `${step.label}: price ${rupees(step.fromMinor)} → ${rupees(step.toMinor)}`;
      case "set_stock":
        return `${step.label}: stock set to ${step.toStock}`;
      case "show":
        return `${step.label}: shown again`;
      case "hide":
        return `${step.label}: hidden`;
      case "add_variant":
        return `${step.label}: new variant, stock ${step.stock}`;
      case "create_phone":
        return `New phone (draft) with ${step.payload.variants.length} variant(s), stock ${STOCK_UPDATE_TARGET}`;
    }
  });
}

const emptyCounts = (): Record<PhoneStatus, number> => ({ updated: 0, failed: 0, unknown: 0, needs_check: 0, held: 0 });

/**
 * Writes the plan phone by phone. Each phone is one database call that saves all of its changes or none of them;
 * a failed phone never stops or undoes the others. Held phones are reported, never written. Nothing is retried:
 * fix the list, click Check List and update again (finished phones then show as Same).
 */
export async function runStockUpdate(deps: StockUpdateDeps, plan: PhonePlan, onProgress?: (progress: StockUpdateProgress) => void): Promise<StockUpdateResult> {
  const heldReports: PhoneReport[] = plan.held.map((item) => ({ key: item.key, productId: item.productId, productTitle: item.productTitle, status: "held", reasons: item.reasons, changes: [], newSkus: [], checks: [] }));
  const finish = (outcome: StockUpdateResult["outcome"], message: string, phones: PhoneReport[]): StockUpdateResult => {
    const counts = emptyCounts();
    for (const phone of phones) counts[phone.status] += 1;
    return { outcome, message, phones, counts };
  };
  const target = commercialWriteTarget(deps.supabaseUrl, deps.buildMode);
  if (!target.allowed) return finish("blocked", `${target.reason} Nothing was written.`, heldReports);
  if (!plan.phones.length) return finish("blocked", "Nothing to update. Nothing was written.", heldReports);

  const progress: StockUpdateProgress = { phase: "writing", done: 0, total: plan.phones.length, failed: 0, current: null, lastFailure: null };
  // A progress listener can never break or change the update.
  const emit = (patch: Partial<StockUpdateProgress> = {}) => {
    Object.assign(progress, patch);
    try {
      onProgress?.({ ...progress, lastFailure: progress.lastFailure ? { ...progress.lastFailure } : null });
    } catch {
      /* ignore listener errors */
    }
  };

  const reports: PhoneReport[] = [];
  for (const phone of plan.phones) {
    emit({ current: phone.productTitle });
    const report: PhoneReport = { key: phone.key, productId: phone.productId, productTitle: phone.productTitle, status: "updated", reasons: [], changes: describeSteps(phone.steps), newSkus: [], checks: [] };
    try {
      if (phone.kind === "existing") {
        const before = await deps.readSnapshot(phone.productId);
        const saved = await deps.applyPhone(phone.payload);
        report.newSkus = (saved.new_variants ?? []).map((variant) => variant.sku);
        try {
          report.checks = verifyProduct(phone.productId, before, await deps.readSnapshot(phone.productId), phone.steps);
          const bad = report.checks.filter((check) => !check.ok);
          if (bad.length) {
            report.status = "needs_check";
            report.reasons = bad.map((check) => `${check.name}: ${check.detail}`);
          }
        } catch (problem) {
          report.status = "needs_check";
          report.reasons = [`Saved, but it could not be read back: ${problem instanceof Error ? problem.message : String(problem)}`];
        }
      } else {
        const response = await deps.createPhone(phone.payload);
        const created = response.products.find((item) => item.title === phone.productTitle && item.action === "Create");
        report.newSkus = response.assigned_skus.filter((item) => item.product === phone.productTitle).map((item) => item.sku);
        if (!created) {
          report.status = "needs_check";
          report.reasons = ["The website did not report this phone as created"];
        } else {
          report.productId = created.id;
          try {
            const read = await deps.readCreatedPhone(created.id);
            const ok = read.publicationStatus === "draft" && read.variantCount === phone.payload.variants.length && read.skus.every((sku) => /^MB[0-9]{3}$/.test(sku));
            report.checks = [{ productId: created.id, name: `New phone ${phone.productTitle} created as a draft`, ok, detail: `${read.publicationStatus}, ${read.variantCount} variant(s)` }];
            if (!ok) {
              report.status = "needs_check";
              report.reasons = [`Created, but the check found ${read.publicationStatus} with ${read.variantCount} variant(s)`];
            }
          } catch (problem) {
            report.status = "needs_check";
            report.reasons = [`Created, but it could not be read back: ${problem instanceof Error ? problem.message : String(problem)}`];
          }
        }
      }
    } catch (problem) {
      const message = problem instanceof Error ? problem.message : String(problem);
      report.status = problem instanceof PhoneWriteError && problem.saved === false ? "failed" : "unknown";
      report.reasons = [message];
    }
    reports.push(report);
    const bad = report.status !== "updated";
    emit({ done: progress.done + 1, ...(bad ? { failed: progress.failed + 1, lastFailure: { productTitle: report.productTitle, message: report.reasons[0] ?? "" } } : {}) });
  }
  emit({ phase: "finished", current: null });

  const result = finish("finished", "", [...reports, ...heldReports]);
  const { updated, failed, unknown, needs_check: needsCheck, held } = result.counts;
  result.message = `${updated} phone(s) updated · ${failed} failed · ${held} held for review${unknown + needsCheck ? ` · ${unknown + needsCheck} to check again` : ""}. Nothing was deleted.`;
  return result;
}

// ---------------------------------------------------------------------------
// Report download (CSV, built in the browser; nothing is stored)
// ---------------------------------------------------------------------------

const csvCell = (value: string) => (/[",\n\r]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value);

export function reportCsv(report: readonly PhoneReport[], statusLabel: Record<PhoneStatus, string>): string {
  const header = ["Phone", "Result", "Reason", "Changes", "New SKUs"];
  const rows = report.map((phone) => [phone.productTitle, statusLabel[phone.status], phone.reasons.join(" | "), phone.changes.join(" | "), phone.newSkus.join(" ")]);
  return [header, ...rows].map((row) => row.map((cell) => csvCell(cell)).join(",")).join("\r\n");
}
