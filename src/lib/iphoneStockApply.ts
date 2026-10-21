/**
 * iPhone Stock Update — the "Update Website" write path. One all-or-nothing database call per phone:
 *   existing phone -> apply_iphone_stock_phone (price / show again / new variants with stock 20)
 *   new phone      -> apply_catalog_bulk_import_v2, action "Create" only (draft, server SKUs, stock 20)
 * A failed phone never stops or undoes the others. Held phones are reported, never written. Nothing is retried.
 * Every existing phone is read back after its call (verifyProduct from the Android update): only the planned price /
 * visibility may change, stock of existing variants must be unchanged, new variants must match the list.
 * Database access is injected, so the whole flow runs offline in tests.
 */
import { commercialWriteTarget } from "./commercialDefaults.ts";
import { IPHONE_NEW_VARIANT_STOCK, type IphonePhoneUpdate, type IphonePlan, type IphoneNewPhonePayload, type IphoneRpcPayload } from "./iphoneStockUpdate.ts";
import { PhoneWriteError, verifyProduct, type PhoneStatus, type ProductSnapshot, type VerifyCheck, type WriteStep } from "./stockUpdateApply.ts";

export type IphoneRpcResult = { status: string; new_variants?: { id: string; sku: string }[] };

export type IphoneUpdateDeps = {
  supabaseUrl: string | undefined | null;
  buildMode: string | undefined | null;
  readSnapshot: (productId: string) => Promise<ProductSnapshot>;
  /** ONE call to apply_iphone_stock_phone (one transaction). */
  applyPhone: (payload: IphoneRpcPayload) => Promise<IphoneRpcResult>;
  /** ONE call to apply_catalog_bulk_import_v2 with ONE "Create" product (one transaction). */
  createPhone: (payload: IphoneNewPhonePayload) => Promise<{ products: { id: string; title: string; action: string }[]; assigned_skus: { product: string; sku: string }[] }>;
  /** Read-only check of a created phone. */
  readCreatedPhone: (productId: string) => Promise<{ publicationStatus: string; variantCount: number; skus: string[]; stock: number[]; sims: (string | null)[] }>;
};

export type IphonePhoneReport = { key: string; productId: string | null; productTitle: string; status: PhoneStatus; reasons: string[]; changes: string[]; newSkus: string[]; checks: VerifyCheck[] };

export type IphoneUpdateResult = { outcome: "blocked" | "finished"; message: string; phones: IphonePhoneReport[]; counts: Record<PhoneStatus, number> };

const rupees = (minor: number) => `Rs ${(minor / 100).toLocaleString("en-PK")}`;

/** The Android read-back expects its own step shapes; the iPhone steps map onto them exactly. */
function verifySteps(phone: Extract<IphonePhoneUpdate, { kind: "existing" }>): WriteStep[] {
  const base = { productId: phone.productId, productTitle: phone.productTitle };
  return phone.payload.steps.flatMap((step, index): WriteStep[] => {
    const entryId = `${phone.key}:${index}`;
    if (step.kind === "price") return [{ kind: "price", entryId, ...base, variantId: step.variant_id, sku: "", label: "", fromMinor: step.from_minor, toMinor: step.to_minor }];
    if (step.kind === "show") {
      const show: WriteStep = { kind: "show", entryId, ...base, variantIds: [step.variant_id], label: "" };
      return step.to_minor === step.from_minor ? [show] : [show, { kind: "price", entryId, ...base, variantId: step.variant_id, sku: "", label: "", fromMinor: step.from_minor, toMinor: step.to_minor }];
    }
    return [{ kind: "add_variant", entryId, ...base, ram: null, storage: step.storage, color: step.color, priceMinor: step.price_minor, stock: step.stock, inherited: { ptaStatus: step.pta_status, condition: step.condition, warrantyOverride: null, deliveryScope: "karachi_only" }, label: `${step.storage} ${step.color}` }];
  });
}

/** Extra read-back for new variants: the facts the list did not give are blank, and the SIM is exactly the listed one. */
function newVariantFactChecks(phone: Extract<IphonePhoneUpdate, { kind: "existing" }>, before: ProductSnapshot, after: ProductSnapshot): VerifyCheck[] {
  const productId = phone.productId;
  const planned = phone.payload.steps.filter((step) => step.kind === "add_variant");
  return Object.entries(after.variants)
    .filter(([id]) => !(id in before.variants))
    .map(([, row]) => {
      const filled = ["ram_display", "condition_grade", "battery_health_percent", "battery_cycle_count", "warranty_override"].filter((key) => row[key] !== null && row[key] !== undefined);
      const step = planned.find((item) => item.storage === row.storage_display && item.color === row.color_finish);
      const sim = (row.sim_configuration ?? null) as string | null;
      const simOk = step !== undefined && sim === step.sim_configuration;
      return {
        productId,
        name: `New variant ${String(row.sku)}: RAM, grade, battery, cycles and warranty blank; SIM as listed`,
        ok: filled.length === 0 && simOk,
        detail: filled.length ? `filled: ${filled.join(", ")}` : simOk ? `SIM ${sim ?? "blank"}` : `SIM ${sim ?? "blank"}, planned ${step?.sim_configuration ?? "blank"}`,
      };
    });
}

const sortedSims = (values: readonly (string | null)[]) => values.map((value) => value ?? "").sort().join("|");

function describe(phone: IphonePhoneUpdate): string[] {
  return phone.entries.map((entry) => {
    const label = `${entry.storage} ${entry.color}`;
    if (entry.kind === "price_change") return `${label}: price ${rupees(entry.currentPriceMinor ?? 0)} → ${rupees(entry.priceMinor ?? 0)} (stock kept)`;
    if (entry.kind === "show_again") return `${label}: shown again at ${rupees(entry.priceMinor ?? 0)} (stock kept at ${entry.stock ?? 0})`;
    return `${label}: new variant at ${rupees(entry.priceMinor ?? 0)}, stock ${IPHONE_NEW_VARIANT_STOCK}`;
  });
}

const emptyCounts = (): Record<PhoneStatus, number> => ({ updated: 0, failed: 0, unknown: 0, needs_check: 0, held: 0 });

/** Owner approval (2026-10-22): iPhone Stock Update may write to DEV only. PROD needs a separate approval and code change. */
export const IPHONE_WRITE_ENVIRONMENTS: readonly string[] = ["development"];
export const DEV_ONLY_REASON = "iPhone Stock Update is approved for the DEV website only; this website is not DEV.";

/** The write target if it is allowed for the iPhone update (matching build/project AND DEV), else the reason it is not. */
function iphoneWriteTarget(supabaseUrl: string | undefined | null, buildMode: string | undefined | null): string | null {
  const target = commercialWriteTarget(supabaseUrl, buildMode);
  if (!target.allowed) return target.reason ?? "The website environment could not be confirmed.";
  if (!target.environment || !IPHONE_WRITE_ENVIRONMENTS.includes(target.environment)) return DEV_ONLY_REASON;
  return null;
}

/** Every condition Update Website needs. Returns the first reason it must stay off, or null. */
export function iphoneUpdateBlocker(input: { supabaseUrl: string | undefined | null; buildMode: string | undefined | null; enabled: boolean; checkIsCurrent: boolean; plan: IphonePlan | null }): string | null {
  if (!input.enabled) return "Update Website is switched off on this build until the Owner approves the DEV step.";
  const environmentProblem = iphoneWriteTarget(input.supabaseUrl, input.buildMode);
  if (environmentProblem) return environmentProblem;
  if (!input.plan) return "Click Check Changes first.";
  if (!input.checkIsCurrent) return "You changed something since the last check. Click Check Changes again.";
  if (!input.plan.phones.length) return input.plan.held.length ? "Every phone in this list needs attention. Fix them first." : "Nothing to update — everything is the same.";
  return null;
}

export async function runIphoneUpdate(deps: IphoneUpdateDeps, plan: IphonePlan, onProgress?: (done: number, total: number, current: string | null) => void): Promise<IphoneUpdateResult> {
  const heldReports: IphonePhoneReport[] = plan.held.map((item) => ({ key: item.key, productId: null, productTitle: item.productTitle, status: "held", reasons: item.reasons, changes: [], newSkus: [], checks: [] }));
  const finish = (outcome: IphoneUpdateResult["outcome"], message: string, phones: IphonePhoneReport[]): IphoneUpdateResult => {
    const counts = emptyCounts();
    for (const phone of phones) counts[phone.status] += 1;
    return { outcome, message, phones, counts };
  };
  const environmentProblem = iphoneWriteTarget(deps.supabaseUrl, deps.buildMode);
  if (environmentProblem) return finish("blocked", `${environmentProblem} Nothing was written.`, heldReports);
  if (!plan.phones.length) return finish("blocked", "Nothing to update. Nothing was written.", heldReports);

  const emit = (done: number, current: string | null) => {
    try {
      onProgress?.(done, plan.phones.length, current);
    } catch {
      /* a progress listener never changes the update */
    }
  };

  const reports: IphonePhoneReport[] = [];
  for (const phone of plan.phones) {
    emit(reports.length, phone.productTitle);
    const report: IphonePhoneReport = { key: phone.key, productId: phone.productId, productTitle: phone.productTitle, status: "updated", reasons: [], changes: describe(phone), newSkus: [], checks: [] };
    try {
      if (phone.kind === "existing") {
        const before = await deps.readSnapshot(phone.productId);
        const saved = await deps.applyPhone(phone.payload);
        report.newSkus = (saved.new_variants ?? []).map((variant) => variant.sku);
        try {
          const after = await deps.readSnapshot(phone.productId);
          report.checks = [...verifyProduct(phone.productId, before, after, verifySteps(phone)), ...newVariantFactChecks(phone, before, after)];
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
        if (phone.payload.action !== "Create") throw new PhoneWriteError("Only Create is allowed for new phones", false);
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
            const ok =
              read.publicationStatus === "draft" &&
              read.variantCount === phone.payload.variants.length &&
              read.skus.every((sku) => /^MB[0-9]{3}$/.test(sku)) &&
              read.stock.every((units) => units === IPHONE_NEW_VARIANT_STOCK) &&
              sortedSims(read.sims) === sortedSims(phone.payload.variants.map((item) => item.sim_configuration));
            report.checks = [{ productId: created.id, name: `New phone ${phone.productTitle} created as a draft with stock ${IPHONE_NEW_VARIANT_STOCK}`, ok, detail: `${read.publicationStatus}, ${read.variantCount} variant(s), stock ${read.stock.join("/")}` }];
            if (!ok) {
              report.status = "needs_check";
              report.reasons = [`Created, but the check found ${read.publicationStatus} with ${read.variantCount} variant(s), stock ${read.stock.join("/")}`];
            }
          } catch (problem) {
            report.status = "needs_check";
            report.reasons = [`Created, but it could not be read back: ${problem instanceof Error ? problem.message : String(problem)}`];
          }
        }
      }
    } catch (problem) {
      report.status = problem instanceof PhoneWriteError && problem.saved === false ? "failed" : "unknown";
      report.reasons = [problem instanceof Error ? problem.message : String(problem)];
    }
    reports.push(report);
  }
  emit(reports.length, null);

  const result = finish("finished", "", [...reports, ...heldReports]);
  const { updated, failed, unknown, needs_check: needsCheck, held } = result.counts;
  result.message = `${updated} phone(s) updated · ${failed} failed · ${held} held for review${unknown + needsCheck ? ` · ${unknown + needsCheck} to check again` : ""}. Nothing was hidden or deleted.`;
  return result;
}
