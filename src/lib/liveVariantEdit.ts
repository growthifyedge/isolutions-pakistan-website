/**
 * Catalog → Variants & Pricing for a LIVE (published) phone, tablet or MacBook (Owner-approved 2026-11-23, Option A).
 *
 * The Owner edits several prices (and, for an Android phone, adds new variants) in one table and saves once. Nothing is
 * written from the browser: the save is ONE call to the SAME server-checked function the Stock Update page uses for that
 * kind of product. That function locks the product, refuses it if anything changed since this page loaded ("expected"),
 * checks every rule again, writes all or nothing and verifies its own writes. No new database function, no migration.
 *
 *   Android phone            → apply_android_stock_phone   price steps + add_variant (opening stock fixed at 30)
 *   iPhone                   → apply_iphone_stock_phone    price steps for visible variants only
 *   Tablet / MacBook         → apply_tablet_stock_product  price steps for visible variants only
 *
 * Stock, compare-at price, PTA, condition, warranty and delivery of a live product are read-only here (those functions
 * cannot change them). Draft products keep the existing editor unchanged. Pure functions only.
 */
import { normalizeCapacity } from "./bulkCatalog.ts";
import { normalizeColor } from "./catalogColors.ts";
import { commercialWriteTarget } from "./commercialDefaults.ts";
import { formatPkrMinor, parsePkrMajorToMinor, pkrMajorInputFromMinor } from "./money.ts";
import type { PhoneRpcPayload, PhoneRpcStep } from "./stockUpdateApply.ts";
import type { IphoneRpcPayload } from "./iphoneStockUpdate.ts";
import type { TabletRpcPayload } from "./tabletStockUpdate.ts";

export type LiveKind = "android" | "iphone" | "tablet";

/** Opening stock the server function requires for a new variant (fixed; never chosen here). */
export const LIVE_OPENING_STOCK: Record<LiveKind, number> = { android: 30, iphone: 20, tablet: 20 };
export const LIVE_KIND_LABEL: Record<LiveKind, string> = { android: "Android Stock Update", iphone: "iPhone Stock Update", tablet: "Tablets & MacBooks Stock Update" };
/** Environments where the Stock Update functions may write (the same approval as the Stock Update pages). */
export const LIVE_EDIT_ENVIRONMENTS: readonly string[] = ["development", "production"];

export type LiveVariant = {
  id: string;
  sku: string;
  ram: string | null;
  storage: string | null;
  color: string | null;
  priceMinor: number;
  compareAtPriceMinor: number | null;
  isActive: boolean;
  ptaStatus: string;
  condition: string;
  warrantyOverride: string | null;
  deliveryScope: string | null;
};

export type NewVariantInput = { ram: string; storage: string; color: string; price: string };

export type PriceChange = { variantId: string; sku: string; label: string; fromMinor: number; toMinor: number; hidden: boolean };
export type NewVariantPlan = { row: number; ram: string; storage: string; color: string; priceMinor: number; stock: number; inherited: Inherited };
export type Inherited = { pta_status: string; condition: string; warranty_override: string | null; delivery_scope: string | null };

export type LiveReview = {
  kind: LiveKind;
  changes: PriceChange[];
  additions: NewVariantPlan[];
  /** Problems that block Save (each names the row). */
  problems: string[];
  /** Information the Owner should read before saving (not blocking). */
  notes: string[];
  /** Number of changes the Owner confirms ("UPDATE n CHANGES"). */
  changeCount: number;
  payload: { kind: "android"; payload: PhoneRpcPayload } | { kind: "iphone"; payload: IphoneRpcPayload } | { kind: "tablet"; payload: TabletRpcPayload } | null;
};

const lower = (value: string | null | undefined) => (value ?? "").trim().replace(/\s+/g, " ").toLowerCase();
const capacityKey = (value: string | null | undefined) => normalizeCapacity(value ?? "") ?? lower(value);
const colourKey = (value: string | null | undefined) => (value && value.trim() ? normalizeColor(value).color.toLowerCase() : "");
export const liveVariantLabel = (variant: Pick<LiveVariant, "ram" | "storage" | "color">) => [variant.ram, variant.storage, variant.color].filter(Boolean).join(" / ") || "—";

/** Which server-checked function handles this live product, or null (not a supported live phone / tablet / MacBook). */
export function liveKindFor(categorySlug: string | null | undefined, brandName: string | null | undefined, title: string): LiveKind | null {
  const brand = lower(brandName);
  if (categorySlug === "mobile-phones") {
    if (brand === "apple") return "iphone";
    // The Android function refuses these; never offer an edit it would reject.
    if (!brand || brand === "nokia" || brand === "hmd" || /\biphone\b/i.test(title)) return null;
    return "android";
  }
  if (categorySlug === "tablets" || categorySlug === "laptops") return "tablet";
  return null;
}

/** The reason saving is not allowed on this website build, or null (same environment rule as the Stock Update pages). */
export function liveEditEnvironmentBlocker(supabaseUrl: string | undefined | null, buildMode: string | undefined | null): string | null {
  const target = commercialWriteTarget(supabaseUrl, buildMode);
  if (!target.allowed) return target.reason ?? "The website environment could not be confirmed.";
  if (!target.environment || !LIVE_EDIT_ENVIRONMENTS.includes(target.environment)) return "Saving prices here is approved for the DEV and PROD websites only.";
  return null;
}

/** iPhone / tablet rule: the title says the condition (" (Used)" at the end), and every variant must have it. */
export function productCondition(title: string): "used" | "brand_new" {
  return /\s\(used\)\s*$/i.test(title) ? "used" : "brand_new";
}

/** PTA / condition / warranty / delivery a new Android variant copies — only when every (visible) sibling agrees. */
export function inheritedFacts(variants: readonly LiveVariant[]): { facts: Inherited | null; problem: string | null } {
  const pool = variants.some((variant) => variant.isActive) ? variants.filter((variant) => variant.isActive) : variants;
  if (!pool.length) return { facts: null, problem: "This phone has no variant to copy PTA / condition from" };
  const one = <T,>(values: T[]) => new Set(values.map((value) => (value === null ? "<null>" : String(value)))).size === 1;
  if (!one(pool.map((v) => v.ptaStatus)) || !one(pool.map((v) => v.condition)) || !one(pool.map((v) => v.warrantyOverride)) || !one(pool.map((v) => v.deliveryScope)))
    return { facts: null, problem: "The variants of this phone do not all have the same PTA, condition, warranty and delivery, so a new variant cannot copy them — add it on the Android Stock Update page" };
  const first = pool[0];
  if (first.ptaStatus === "unknown" || first.condition === "unknown") return { facts: null, problem: "The variants of this phone have no PTA / condition to copy" };
  return { facts: { pta_status: first.ptaStatus, condition: first.condition, warranty_override: first.warrantyOverride, delivery_scope: first.deliveryScope }, problem: null };
}

const blankRow = (row: NewVariantInput) => !row.ram.trim() && !row.storage.trim() && !row.color.trim() && !row.price.trim();

function parsePrice(value: string): number | null {
  try {
    const minor = parsePkrMajorToMinor(value);
    return minor > 0 && minor % 100 === 0 ? minor : null;
  } catch {
    return null;
  }
}

/**
 * The Owner's edits → what will change, what blocks Save, and the ONE server payload.
 * `priceInputs` holds the price box of each variant (PKR, as typed); only boxes that differ from the current price count.
 */
export function buildLiveReview(input: {
  kind: LiveKind;
  productId: string;
  title: string;
  variants: readonly LiveVariant[];
  priceInputs: Readonly<Record<string, string>>;
  newRows: readonly NewVariantInput[];
}): LiveReview {
  const { kind, variants } = input;
  const problems: string[] = [];
  const notes: string[] = [];
  const changes: PriceChange[] = [];
  const additions: NewVariantPlan[] = [];

  for (const variant of variants) {
    const typed = input.priceInputs[variant.id];
    if (typed === undefined || typed.trim() === "" || typed.trim() === pkrMajorInputFromMinor(variant.priceMinor)) continue;
    const label = `${variant.sku} (${liveVariantLabel(variant)})`;
    const toMinor = parsePrice(typed);
    if (toMinor === null) {
      problems.push(`${label}: “${typed.trim()}” is not a price — use whole rupees, e.g. 385000`);
      continue;
    }
    if (toMinor === variant.priceMinor) continue;
    if (!variant.isActive && kind !== "android") {
      problems.push(`${label} is hidden — its price is changed together with showing it again on the ${LIVE_KIND_LABEL[kind]} page`);
      continue;
    }
    if (variant.compareAtPriceMinor !== null && toMinor >= variant.compareAtPriceMinor) {
      problems.push(`${label}: the new price must be below its compare-at price ${formatPkrMinor(variant.compareAtPriceMinor)}`);
      continue;
    }
    changes.push({ variantId: variant.id, sku: variant.sku, label: liveVariantLabel(variant), fromMinor: variant.priceMinor, toMinor, hidden: !variant.isActive });
    if (!variant.isActive) notes.push(`${variant.sku} is hidden on the website: it gets the new price but stays hidden`);
  }

  const rows = input.newRows.map((row, index) => ({ row, index })).filter(({ row }) => !blankRow(row));
  if (rows.length && kind !== "android") {
    problems.push(`New ${kind === "iphone" ? "iPhone" : "tablet / MacBook"} variants need PTA and SIM choices — add them on the ${LIVE_KIND_LABEL[kind]} page`);
  } else if (rows.length) {
    const { facts, problem } = inheritedFacts(variants);
    if (problem) problems.push(problem);
    const seen = new Set<string>();
    for (const { row, index } of rows) {
      const name = `New variant ${index + 1}`;
      const ram = normalizeCapacity(row.ram);
      const storage = normalizeCapacity(row.storage);
      const color = row.color.trim() ? normalizeColor(row.color).color : "";
      const priceMinor = parsePrice(row.price);
      const missing = [!ram && "RAM", !storage && "storage", !color && "colour", priceMinor === null && "price"].filter(Boolean);
      if (missing.length) {
        problems.push(`${name}: ${missing.join(", ")} ${missing.length === 1 ? "is" : "are"} missing or not readable (e.g. RAM 12, storage 512, colour Cobalt, price 440000)`);
        continue;
      }
      const key = `${capacityKey(ram)}|${capacityKey(storage)}|${colourKey(color)}`;
      const existing = variants.find((variant) => `${capacityKey(variant.ram)}|${capacityKey(variant.storage)}|${colourKey(variant.color)}` === key);
      if (existing) {
        problems.push(`${name}: ${ram} / ${storage} / ${color} already exists (${existing.sku}${existing.isActive ? "" : ", hidden"}) — change its price in the table instead`);
        continue;
      }
      if (seen.has(key)) {
        problems.push(`${name}: ${ram} / ${storage} / ${color} is added twice`);
        continue;
      }
      seen.add(key);
      if (!normalizeColor(row.color).known) notes.push(`${name}: “${color}” is not a usual colour name — check the spelling before saving`);
      if (facts) additions.push({ row: index, ram: ram as string, storage: storage as string, color, priceMinor: priceMinor as number, stock: LIVE_OPENING_STOCK.android, inherited: facts });
    }
  }

  if (kind !== "android") {
    const condition = productCondition(input.title);
    if (variants.some((variant) => variant.condition !== condition))
      problems.push(`The ${condition === "used" ? "title says Used" : "title says New"}, but not every variant is ${condition === "used" ? "Used" : "Brand New"} — use the ${LIVE_KIND_LABEL[kind]} page`);
  }

  const changeCount = changes.length + additions.length;
  let payload: LiveReview["payload"] = null;
  if (!problems.length && changeCount > 0) {
    const expected = { variants: variants.map((variant) => ({ id: variant.id, price_minor: variant.priceMinor, is_active: variant.isActive })) };
    const priceSteps = changes.map((change) => ({ kind: "price" as const, variant_id: change.variantId, from_minor: change.fromMinor, to_minor: change.toMinor }));
    if (kind === "android") {
      const steps: PhoneRpcStep[] = [
        ...priceSteps,
        ...additions.map((add) => ({ kind: "add_variant" as const, ram: add.ram, storage: add.storage, color: add.color, price_minor: add.priceMinor, stock: add.stock, inherited: add.inherited })),
      ];
      payload = { kind, payload: { product_id: input.productId, expected, steps } };
    } else if (kind === "iphone") {
      payload = { kind, payload: { product_id: input.productId, condition: productCondition(input.title), expected, steps: priceSteps } };
    } else {
      payload = { kind, payload: { product_id: input.productId, condition: productCondition(input.title), expected, steps: priceSteps } };
    }
  }
  return { kind, changes, additions, problems, notes, changeCount, payload };
}

export const liveConfirmationPhrase = (review: Pick<LiveReview, "changeCount">) => `UPDATE ${review.changeCount} CHANGE${review.changeCount === 1 ? "" : "S"}`;

/** After a save: the prices / new variants read back must be exactly what was planned (anything else is reported). */
export function verifyLiveSave(review: LiveReview, after: readonly LiveVariant[], before: readonly LiveVariant[]): string[] {
  const issues: string[] = [];
  const byId = new Map(after.map((variant) => [variant.id, variant]));
  const planned = new Map(review.changes.map((change) => [change.variantId, change.toMinor]));
  for (const variant of before) {
    const now = byId.get(variant.id);
    if (!now) {
      issues.push(`${variant.sku} is missing after saving`);
      continue;
    }
    const expectedPrice = planned.get(variant.id) ?? variant.priceMinor;
    if (now.priceMinor !== expectedPrice) issues.push(`${variant.sku}: price is ${formatPkrMinor(now.priceMinor)}, expected ${formatPkrMinor(expectedPrice)}`);
    if (now.isActive !== variant.isActive) issues.push(`${variant.sku}: visibility changed`);
  }
  const fresh = after.filter((variant) => !before.some((old) => old.id === variant.id));
  if (fresh.length !== review.additions.length) issues.push(`${fresh.length} new variant(s) found, ${review.additions.length} planned`);
  for (const add of review.additions) {
    const match = fresh.find((variant) => capacityKey(variant.ram) === capacityKey(add.ram) && capacityKey(variant.storage) === capacityKey(add.storage) && colourKey(variant.color) === colourKey(add.color));
    if (!match) issues.push(`New variant ${add.ram} / ${add.storage} / ${add.color} was not found`);
    else if (match.priceMinor !== add.priceMinor) issues.push(`New variant ${match.sku}: price is ${formatPkrMinor(match.priceMinor)}, expected ${formatPkrMinor(add.priceMinor)}`);
  }
  return issues;
}
