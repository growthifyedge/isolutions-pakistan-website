/**
 * Tablets & MacBooks Stock Update — the "Update Website" write path. One all-or-nothing database call per product:
 *   existing product -> apply_tablet_stock_product (price / show again / new variants with stock 20)
 *   new product      -> apply_catalog_bulk_import_v2, action "Create" only (draft, server SKUs, stock 20)
 * A failed product never stops or undoes the others. Held products are reported, never written. Nothing is retried.
 * Every product is read back after its call: only the planned price / visibility may change, stock of existing variants
 * must be unchanged, new variants must match the list (RAM, storage, colour, price, PTA, condition, Karachi only,
 * blank warranty / grade / battery / SIM, stock 20, an IP / MC SKU).
 * Database access is injected, so the whole flow runs offline in tests.
 *
 * apply_tablet_stock_product comes from migration 202610270001 (applied to DEV and PROD). Update Website is approved per
 * environment: TABLET_WRITE_ENVIRONMENTS lists DEV and PROD; the build mode must still match its Supabase project.
 */
import { commercialWriteTarget } from "./commercialDefaults.ts";
import { TABLET_NEW_VARIANT_STOCK, variantLabel, type TabletNewProductPayload, type TabletPlan, type TabletProductUpdate, type TabletRpcPayload } from "./tabletStockUpdate.ts";
import { PhoneWriteError, type PhoneStatus, type ProductSnapshot, type VerifyCheck } from "./stockUpdateApply.ts";

export type TabletRpcResult = { status: string; new_variants?: { id: string; sku: string }[] };

export type CreatedProductRead = { publicationStatus: string; variants: { sku: string; ram: string | null; storage: string | null; color: string | null; pta: string | null; delivery: string | null; stock: number }[] };

export type TabletUpdateDeps = {
  supabaseUrl: string | undefined | null;
  buildMode: string | undefined | null;
  /** Offline tests only (the Admin page never passes it): environments to treat as approved instead of TABLET_WRITE_ENVIRONMENTS. */
  testWriteEnvironments?: readonly string[];
  readSnapshot: (productId: string) => Promise<ProductSnapshot>;
  /** ONE call to apply_tablet_stock_product (one transaction). Throws PhoneWriteError. */
  applyProduct: (payload: TabletRpcPayload) => Promise<TabletRpcResult>;
  /** ONE call to apply_catalog_bulk_import_v2 with ONE "Create" product (one transaction). Throws PhoneWriteError. */
  createProduct: (payload: TabletNewProductPayload) => Promise<{ products: { id: string; title: string; action: string }[]; assigned_skus: { product: string; sku: string }[] }>;
  /** Read-only check of a created product. */
  readCreatedProduct: (productId: string) => Promise<CreatedProductRead>;
};

export type TabletProductReport = { key: string; productId: string | null; productTitle: string; status: PhoneStatus; reasons: string[]; changes: string[]; newSkus: string[]; checks: VerifyCheck[] };

export type TabletUpdateResult = { outcome: "blocked" | "finished"; message: string; products: TabletProductReport[]; counts: Record<PhoneStatus, number> };

/** Owner-approved 2026-10-26: DEV, then PROD (apply_tablet_stock_product installed on both). */
export const TABLET_WRITE_ENVIRONMENTS: readonly string[] = ["development", "production"];
export const TABLET_NOT_APPROVED_REASON = "Update Website for Tablets & MacBooks is not approved for this website yet (the database function is not installed).";

const rupees = (minor: number) => `Rs ${(minor / 100).toLocaleString("en-PK")}`;
const message = (problem: unknown) => (problem instanceof Error ? problem.message : String(problem));
const emptyCounts = (): Record<PhoneStatus, number> => ({ updated: 0, failed: 0, unknown: 0, needs_check: 0, held: 0 });
const skuPattern = (categorySlug: "tablets" | "laptops") => (categorySlug === "laptops" ? /^MC[0-9]{3}$/ : /^IP[0-9]{3}$/);
const blank = (value: unknown) => value === null || value === undefined;
const same = (a: unknown, b: unknown) => (blank(a) && blank(b)) || a === b;

function tabletWriteTarget(supabaseUrl: string | undefined | null, buildMode: string | undefined | null, approved: readonly string[] = TABLET_WRITE_ENVIRONMENTS): string | null {
  const target = commercialWriteTarget(supabaseUrl, buildMode);
  if (!target.allowed) return target.reason ?? "The website environment could not be confirmed.";
  if (!target.environment || !approved.includes(target.environment)) return TABLET_NOT_APPROVED_REASON;
  return null;
}

/** Every condition Update Website needs. Returns the first reason it must stay off, or null. */
export function tabletUpdateBlocker(input: { supabaseUrl: string | undefined | null; buildMode: string | undefined | null; enabled: boolean; checkIsCurrent: boolean; plan: TabletPlan | null }): string | null {
  if (!input.enabled) return "Update Website is switched off on this build until the Owner approves the Tablets & MacBooks database function.";
  const environmentProblem = tabletWriteTarget(input.supabaseUrl, input.buildMode);
  if (environmentProblem) return environmentProblem;
  if (!input.plan) return "Click Check Changes first.";
  if (!input.checkIsCurrent) return "You changed something since the last check. Click Check Changes again.";
  if (!input.plan.products.length) return input.plan.held.length ? "Every product in this list needs attention. Fix them first." : "Nothing to update — everything is the same.";
  return null;
}

const check = (productId: string, name: string, ok: boolean, detail: string): VerifyCheck => ({ productId, name, ok, detail });

/** Read-back of an existing product after its call. */
export function verifyTabletProduct(update: Extract<TabletProductUpdate, { kind: "existing" }>, before: ProductSnapshot, after: ProductSnapshot): VerifyCheck[] {
  const id = update.productId;
  const checks: VerifyCheck[] = [];
  const priceTarget = new Map<string, number>();
  const shown = new Set<string>();
  for (const step of update.payload.steps) {
    if (step.kind === "price" || step.kind === "show") priceTarget.set(step.variant_id, step.to_minor);
    if (step.kind === "show") shown.add(step.variant_id);
  }
  const productChanges = Object.keys({ ...before.product, ...after.product }).filter((key) => key !== "updated_at" && !same(before.product[key], after.product[key]));
  checks.push(check(id, "Product row unchanged", productChanges.length === 0, productChanges.length ? `changed: ${productChanges.join(", ")}` : String(after.product.publication_status)));
  checks.push(check(id, "Images and specifications unchanged", after.media.length === before.media.length && after.specifications.length === before.specifications.length, ""));
  for (const [variantId, row] of Object.entries(before.variants)) {
    const now = after.variants[variantId];
    if (!now) {
      checks.push(check(id, `Variant ${String(row.sku)} still exists`, false, "missing after the update"));
      continue;
    }
    const others = Object.keys(row).filter((key) => !["updated_at", "price_minor", "is_active"].includes(key) && !same(row[key], now[key]));
    const wantPrice = priceTarget.get(variantId) ?? row.price_minor;
    const wantActive = shown.has(variantId) ? true : row.is_active;
    checks.push(check(id, `Variant ${String(row.sku)}: only the planned price / visibility changed`, others.length === 0 && Number(now.price_minor) === Number(wantPrice) && now.is_active === wantActive, others.length ? `unexpected change: ${others.join(", ")}` : `${String(now.price_minor)}${now.is_active ? "" : " (hidden)"}`));
    checks.push(check(id, `Variant ${String(row.sku)}: stock unchanged`, (after.stock[variantId] ?? 0) === (before.stock[variantId] ?? 0), `${before.stock[variantId] ?? 0} -> ${after.stock[variantId] ?? 0}`));
  }
  const created = Object.entries(after.variants).filter(([variantId]) => !(variantId in before.variants));
  const planned = update.payload.steps.filter((step) => step.kind === "add_variant");
  checks.push(check(id, "No unexpected new variant", created.length === planned.length, `${created.length} created, ${planned.length} planned`));
  for (const step of planned) {
    const match = created.filter(([, row]) => same(row.ram_display, step.ram) && row.storage_display === step.storage && same(row.color_finish, step.color));
    const [variantId, row] = match[0] ?? [];
    const ok =
      match.length === 1 &&
      row !== undefined &&
      Number(row.price_minor) === step.price_minor &&
      row.is_active === true &&
      row.pta_status === step.pta_status &&
      row.condition === step.condition &&
      row.delivery_scope === "karachi_only" &&
      ["warranty_override", "condition_grade", "battery_health_percent", "battery_cycle_count", "sim_configuration", "compare_at_price_minor"].every((key) => blank(row[key])) &&
      skuPattern(update.categorySlug).test(String(row.sku)) &&
      (after.stock[variantId as string] ?? 0) === step.stock;
    checks.push(check(id, `New variant ${[step.ram, step.storage, step.color].filter(Boolean).join(" / ")} added correctly`, ok, ok ? `SKU ${String(row?.sku)}, stock ${step.stock}` : "missing, duplicated or different from the plan"));
  }
  return checks;
}

function describe(update: TabletProductUpdate): string[] {
  return update.entries.map((entry) => {
    const label = variantLabel(entry);
    if (entry.kind === "price_change") return `${label}: price ${rupees(entry.currentPriceMinor ?? 0)} → ${rupees(entry.priceMinor ?? 0)} (stock kept)`;
    if (entry.kind === "show_again") return `${label}: shown again at ${rupees(entry.priceMinor ?? 0)} (stock kept at ${entry.stock ?? 0})`;
    return `${label}: new variant at ${rupees(entry.priceMinor ?? 0)}, stock ${TABLET_NEW_VARIANT_STOCK}`;
  });
}

const sortedKeys = (rows: { ram: string | null; storage: string | null; color: string | null }[]) => rows.map((row) => [row.ram ?? "", row.storage ?? "", row.color ?? ""].join("|").toLowerCase()).sort().join(",");

export async function runTabletUpdate(deps: TabletUpdateDeps, plan: TabletPlan, onProgress?: (done: number, total: number, current: string | null) => void): Promise<TabletUpdateResult> {
  const heldReports: TabletProductReport[] = plan.held.map((item) => ({ key: item.key, productId: null, productTitle: item.productTitle, status: "held", reasons: item.reasons, changes: [], newSkus: [], checks: [] }));
  const finish = (outcome: TabletUpdateResult["outcome"], text: string, products: TabletProductReport[]): TabletUpdateResult => {
    const counts = emptyCounts();
    for (const product of products) counts[product.status] += 1;
    return { outcome, message: text, products, counts };
  };
  const environmentProblem = tabletWriteTarget(deps.supabaseUrl, deps.buildMode, deps.testWriteEnvironments);
  if (environmentProblem) return finish("blocked", `${environmentProblem} Nothing was written.`, heldReports);
  if (!plan.products.length) return finish("blocked", "Nothing to update. Nothing was written.", heldReports);

  const emit = (done: number, current: string | null) => {
    try {
      onProgress?.(done, plan.products.length, current);
    } catch {
      /* a progress listener never changes the update */
    }
  };

  const reports: TabletProductReport[] = [];
  for (const update of plan.products) {
    emit(reports.length, update.productTitle);
    const report: TabletProductReport = { key: update.key, productId: update.productId, productTitle: update.productTitle, status: "updated", reasons: [], changes: describe(update), newSkus: [], checks: [] };
    try {
      if (update.kind === "existing") {
        const before = await deps.readSnapshot(update.productId);
        const saved = await deps.applyProduct(update.payload);
        report.newSkus = (saved.new_variants ?? []).map((variant) => variant.sku);
        try {
          const after = await deps.readSnapshot(update.productId);
          report.checks = verifyTabletProduct(update, before, after);
          const bad = report.checks.filter((item) => !item.ok);
          if (bad.length) {
            report.status = "needs_check";
            report.reasons = bad.map((item) => `${item.name}: ${item.detail}`);
          }
        } catch (problem) {
          report.status = "needs_check";
          report.reasons = [`Saved, but it could not be read back: ${message(problem)}`];
        }
      } else {
        if (update.payload.action !== "Create") throw new PhoneWriteError("Only Create is allowed for new products", false);
        const response = await deps.createProduct(update.payload);
        const created = response.products.find((item) => item.title === update.productTitle && item.action === "Create");
        report.newSkus = response.assigned_skus.filter((item) => item.product === update.productTitle).map((item) => item.sku);
        if (!created) {
          report.status = "needs_check";
          report.reasons = ["The website did not report this product as created"];
        } else {
          report.productId = created.id;
          try {
            const read = await deps.readCreatedProduct(created.id);
            const ok =
              read.publicationStatus === "draft" &&
              read.variants.length === update.payload.variants.length &&
              sortedKeys(read.variants) === sortedKeys(update.payload.variants) &&
              read.variants.every((variant) => skuPattern(update.categorySlug).test(variant.sku) && variant.stock === TABLET_NEW_VARIANT_STOCK && variant.delivery === "karachi_only");
            report.checks = [check(created.id, `New product ${update.productTitle} created as a draft with stock ${TABLET_NEW_VARIANT_STOCK}, Karachi only`, ok, `${read.publicationStatus}, ${read.variants.length} variant(s), stock ${read.variants.map((variant) => variant.stock).join("/")}`)];
            if (!ok) {
              report.status = "needs_check";
              report.reasons = [`Created, but the check found ${read.publicationStatus} with ${read.variants.length} variant(s), stock ${read.variants.map((variant) => variant.stock).join("/")}`];
            }
          } catch (problem) {
            report.status = "needs_check";
            report.reasons = [`Created, but it could not be read back: ${message(problem)}`];
          }
        }
      }
    } catch (problem) {
      report.status = problem instanceof PhoneWriteError && problem.saved === false ? "failed" : "unknown";
      report.reasons = [message(problem)];
    }
    reports.push(report);
  }
  emit(reports.length, null);

  const result = finish("finished", "", [...reports, ...heldReports]);
  const { updated, failed, unknown, needs_check: needsCheck, held } = result.counts;
  result.message = `${updated} product(s) updated · ${failed} failed · ${held} held for review${unknown + needsCheck ? ` · ${unknown + needsCheck} to check again` : ""}. Nothing was hidden or deleted.`;
  return result;
}
