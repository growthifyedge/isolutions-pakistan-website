/**
 * Gadgets Stock Update — the "Update Website" write path. Database access is injected, so the whole flow runs offline in tests.
 *   existing gadget -> ONE call to apply_gadget_stock_product (price and/or description, all or nothing; stock never changes)
 *   new gadget      -> ONE call to apply_catalog_bulk_import_v2 ("Create": draft, server SKU, stock 20), then — only when the
 *                      sheet has a description — ONE call to apply_gadget_stock_product that sets the description.
 *
 * apply_gadget_stock_product comes from migration 202610260001 (applied to DEV and PROD). Update Website is approved per
 * environment: GADGET_WRITE_ENVIRONMENTS lists DEV and PROD; the build mode must still match its Supabase project.
 *
 * Partial success: a new gadget can be created while its description is not saved (the second call fails or its answer is
 * lost). That gadget is reported as "Created — description NOT saved", never as Updated. A retry is safe: Check Changes
 * then finds the gadget on the website by its name and lists it under Description Updates; it is never created twice
 * (the server refuses Create for an existing name, and the web address is unique).
 * Every gadget is read back after its calls; anything unexpected is reported as "check again", never as Updated.
 */
import { commercialWriteTarget } from "./commercialDefaults.ts";
import {
  GADGET_DELIVERY_SCOPE,
  GADGET_NEW_PRODUCT_STOCK,
  cleanDescription,
  type GadgetCreatePayload,
  type GadgetPlan,
  type GadgetPlanItem,
  type GadgetRpcPayload,
} from "./gadgetStockUpdate.ts";
import { PhoneWriteError, type ProductSnapshot, type VerifyCheck } from "./stockUpdateApply.ts";

export type GadgetStatus = "updated" | "partial" | "failed" | "unknown" | "needs_check" | "held";

export type GadgetUpdateDeps = {
  supabaseUrl: string | undefined | null;
  buildMode: string | undefined | null;
  /** Offline tests only (the Admin page never passes it): environments to treat as approved instead of GADGET_WRITE_ENVIRONMENTS. */
  testWriteEnvironments?: readonly string[];
  readSnapshot: (productId: string) => Promise<ProductSnapshot>;
  /** ONE call to apply_gadget_stock_product (one transaction). Throws PhoneWriteError. */
  applyProduct: (payload: GadgetRpcPayload) => Promise<{ status: string }>;
  /** ONE call to apply_catalog_bulk_import_v2 with ONE "Create" product (one transaction). Throws PhoneWriteError. */
  createProduct: (payload: GadgetCreatePayload) => Promise<{ products: { id: string; title: string; action: string }[]; assigned_skus: { product: string; sku: string }[] }>;
};

export type GadgetReport = { key: string; productId: string | null; productTitle: string; status: GadgetStatus; reasons: string[]; changes: string[]; newSkus: string[]; checks: VerifyCheck[] };

export type GadgetUpdateResult = { outcome: "blocked" | "finished"; message: string; products: GadgetReport[]; counts: Record<GadgetStatus, number> };

/** Owner-approved 2026-10-25: DEV, then PROD (apply_gadget_stock_product installed on both). */
export const GADGET_WRITE_ENVIRONMENTS: readonly string[] = ["development", "production"];
export const GADGET_NOT_APPROVED_REASON = "Update Website for gadgets is not approved for this website yet (the gadget database function is not installed).";
export const RETRY_HINT = "Click Check Changes again: it shows under Description Updates and is not created twice.";

const rupees = (minor: number) => `Rs ${(minor / 100).toLocaleString("en-PK")}`;
const message = (problem: unknown) => (problem instanceof Error ? problem.message : String(problem));
const emptyCounts = (): Record<GadgetStatus, number> => ({ updated: 0, partial: 0, failed: 0, unknown: 0, needs_check: 0, held: 0 });

function gadgetWriteTarget(supabaseUrl: string | undefined | null, buildMode: string | undefined | null, approved: readonly string[] = GADGET_WRITE_ENVIRONMENTS): string | null {
  const target = commercialWriteTarget(supabaseUrl, buildMode);
  if (!target.allowed) return target.reason ?? "The website environment could not be confirmed.";
  if (!target.environment || !approved.includes(target.environment)) return GADGET_NOT_APPROVED_REASON;
  return null;
}

/** Every condition Update Website needs. Returns the first reason it must stay off, or null. */
export function gadgetUpdateBlocker(input: { supabaseUrl: string | undefined | null; buildMode: string | undefined | null; enabled: boolean; checkIsCurrent: boolean; plan: GadgetPlan | null }): string | null {
  if (!input.enabled) return "Update Website is switched off on this build until the Owner approves the gadget database function.";
  const environmentProblem = gadgetWriteTarget(input.supabaseUrl, input.buildMode);
  if (environmentProblem) return environmentProblem;
  if (!input.plan) return "Click Check Changes first.";
  if (!input.checkIsCurrent) return "You uploaded a different sheet since the last check. Click Check Changes again.";
  if (!input.plan.items.length) return input.plan.held.length ? "Every product in this sheet needs review. Fix them first." : "Nothing to update — everything is the same.";
  return null;
}

function describe(item: GadgetPlanItem): string[] {
  if (item.kind === "new") return [`New draft at ${rupees(item.payload.variants[0].price_minor)}, stock ${GADGET_NEW_PRODUCT_STOCK}${item.description ? ", with description" : ", no description"}`];
  const changes: string[] = [];
  if (item.payload.steps.price) changes.push(`Price ${rupees(item.payload.steps.price.from_minor)} → ${rupees(item.payload.steps.price.to_minor)} (stock kept)`);
  if (item.payload.steps.content) changes.push(item.payload.expected.content ? "Description replaced" : "Description added");
  return changes;
}

const check = (productId: string, name: string, ok: boolean, detail: string): VerifyCheck => ({ productId, name, ok, detail });

/** Read-back of an existing gadget: only the planned price / description may change; stock, visibility, variants, status, title, images and specs stay. */
export function verifyExistingGadget(item: Extract<GadgetPlanItem, { kind: "existing" }>, before: ProductSnapshot, after: ProductSnapshot): VerifyCheck[] {
  const id = item.productId;
  const variantId = item.payload.expected.variant.id;
  const wantPrice = item.payload.steps.price?.to_minor ?? item.payload.expected.variant.price_minor;
  const wantContent = item.payload.steps.content ? item.payload.steps.content.to : cleanDescription(before.product.content as string | null);
  const beforeIds = Object.keys(before.variants).sort().join(",");
  const afterIds = Object.keys(after.variants).sort().join(",");
  const stockSame = Object.keys(before.stock).every((key) => after.stock[key] === before.stock[key]);
  const activeSame = Object.keys(before.variants).every((key) => after.variants[key]?.is_active === before.variants[key]?.is_active);
  return [
    check(id, "Price as listed", Number(after.variants[variantId]?.price_minor) === wantPrice, `${after.variants[variantId]?.price_minor ?? "missing"} (wanted ${wantPrice})`),
    check(id, "Description as planned", cleanDescription(after.product.content as string | null) === wantContent, item.payload.steps.content ? "replaced" : "kept"),
    check(id, "Stock unchanged", stockSame, Object.values(after.stock).join("/")),
    check(id, "Visibility unchanged", activeSame, ""),
    check(id, "Same variants", beforeIds === afterIds, `${Object.keys(after.variants).length} variant(s)`),
    check(id, "Status and name unchanged", after.product.publication_status === before.product.publication_status && after.product.title === before.product.title, String(after.product.publication_status)),
    check(id, "Images and specifications unchanged", after.media.length === before.media.length && after.specifications.length === before.specifications.length, ""),
  ];
}

/** Read-back of a created gadget: draft, one GD variant at the listed price, stock 20, nationwide, unset facts left unset, no description yet. */
export function verifyCreatedGadget(item: Extract<GadgetPlanItem, { kind: "new" }>, productId: string, snapshot: ProductSnapshot): VerifyCheck[] {
  const variants = Object.values(snapshot.variants);
  const variant = variants[0];
  const planned = item.payload.variants[0];
  const unset = variant ? ["ram_display", "storage_display", "color_finish", "warranty_override", "sim_configuration", "condition_grade", "battery_health_percent", "battery_cycle_count"].filter((key) => variant[key] !== null && variant[key] !== undefined) : [];
  return [
    check(productId, "Created as a draft", snapshot.product.publication_status === "draft", String(snapshot.product.publication_status)),
    check(productId, "One variant with a GD SKU", variants.length === 1 && /^GD[0-9]{3}$/.test(String(variant?.sku)), variants.map((row) => String(row.sku)).join(", ")),
    check(productId, `Price as listed, stock ${GADGET_NEW_PRODUCT_STOCK}`, Number(variant?.price_minor) === planned.price_minor && snapshot.stock[String(variant?.id)] === GADGET_NEW_PRODUCT_STOCK, `${variant?.price_minor ?? "—"}, stock ${variant ? snapshot.stock[String(variant.id)] : "—"}`),
    check(productId, `Delivery ${GADGET_DELIVERY_SCOPE}; PTA, condition, warranty and other facts unset`, variant?.delivery_scope === GADGET_DELIVERY_SCOPE && variant?.pta_status === "unknown" && variant?.condition === "unknown" && unset.length === 0, unset.length ? `filled: ${unset.join(", ")}` : `${variant?.pta_status}/${variant?.condition}`),
  ];
}

export async function runGadgetUpdate(deps: GadgetUpdateDeps, plan: GadgetPlan, onProgress?: (done: number, total: number, current: string | null) => void): Promise<GadgetUpdateResult> {
  const heldReports: GadgetReport[] = plan.held.map((entry) => ({ key: entry.id, productId: entry.productId, productTitle: entry.productTitle || `Row ${entry.row.rowNumber}`, status: "held", reasons: entry.reasons, changes: [], newSkus: [], checks: [] }));
  const finish = (outcome: GadgetUpdateResult["outcome"], text: string, products: GadgetReport[]): GadgetUpdateResult => {
    const counts = emptyCounts();
    for (const product of products) counts[product.status] += 1;
    return { outcome, message: text, products, counts };
  };
  const environmentProblem = gadgetWriteTarget(deps.supabaseUrl, deps.buildMode, deps.testWriteEnvironments);
  if (environmentProblem) return finish("blocked", `${environmentProblem} Nothing was written.`, heldReports);
  if (!plan.items.length) return finish("blocked", "Nothing to update. Nothing was written.", heldReports);

  const emit = (done: number, current: string | null) => {
    try {
      onProgress?.(done, plan.items.length, current);
    } catch {
      /* a progress listener never changes the update */
    }
  };

  const reports: GadgetReport[] = [];
  for (const item of plan.items) {
    emit(reports.length, item.productTitle);
    const report: GadgetReport = { key: item.key, productId: item.productId, productTitle: item.productTitle, status: "updated", reasons: [], changes: describe(item), newSkus: [], checks: [] };
    reports.push(report);
    if (item.kind === "existing") {
      try {
        const before = await deps.readSnapshot(item.productId);
        await deps.applyProduct(item.payload);
        try {
          report.checks = verifyExistingGadget(item, before, await deps.readSnapshot(item.productId));
          const bad = report.checks.filter((row) => !row.ok);
          if (bad.length) {
            report.status = "needs_check";
            report.reasons = bad.map((row) => `${row.name}: ${row.detail}`);
          }
        } catch (problem) {
          report.status = "needs_check";
          report.reasons = [`Saved, but it could not be read back: ${message(problem)}`];
        }
      } catch (problem) {
        report.status = problem instanceof PhoneWriteError && problem.saved === false ? "failed" : "unknown";
        report.reasons = [message(problem)];
      }
      continue;
    }

    // New gadget, step 1: create (draft, stock 20). Nothing else is attempted if this fails.
    if (item.payload.action !== "Create") {
      report.status = "failed";
      report.reasons = ["Only Create is allowed for new gadgets"];
      continue;
    }
    let createdId: string;
    try {
      const response = await deps.createProduct(item.payload);
      const created = response.products.find((product) => product.title === item.productTitle && product.action === "Create");
      report.newSkus = response.assigned_skus.filter((row) => row.product === item.productTitle).map((row) => row.sku);
      if (!created) {
        report.status = "needs_check";
        report.reasons = [`The website did not report this gadget as created.${item.description ? " The description was NOT saved." : ""} ${RETRY_HINT}`];
        continue;
      }
      createdId = created.id;
      report.productId = created.id;
    } catch (problem) {
      report.status = problem instanceof PhoneWriteError && problem.saved === false ? "failed" : "unknown";
      report.reasons = [message(problem)];
      if (report.status === "unknown") report.reasons.push(`It may or may not have been created. ${RETRY_HINT}`);
      continue;
    }

    // Step 2: read the created gadget back. Its variant id is needed for the description call.
    let snapshot: ProductSnapshot;
    try {
      snapshot = await deps.readSnapshot(createdId);
      report.checks = verifyCreatedGadget(item, createdId, snapshot);
    } catch (problem) {
      report.status = item.description ? "partial" : "needs_check";
      report.reasons = [`Created, but it could not be read back: ${message(problem)}.${item.description ? ` The description was NOT saved. ${RETRY_HINT}` : ""}`];
      continue;
    }
    const bad = report.checks.filter((row) => !row.ok);
    if (bad.length) {
      report.status = item.description ? "partial" : "needs_check";
      report.reasons = [...bad.map((row) => `${row.name}: ${row.detail}`), ...(item.description ? ["The description was NOT saved because the created gadget did not look as planned. Check it in Catalog."] : [])];
      continue;
    }
    if (!item.description) continue;

    // Step 3: the description, through the same gadget function (expects exactly the created state).
    const variant = Object.values(snapshot.variants)[0];
    const payload: GadgetRpcPayload = {
      product_id: createdId,
      expected: { title: item.productTitle, content: null, variant: { id: String(variant.id), price_minor: Number(variant.price_minor), is_active: true } },
      steps: { content: { to: item.description } },
    };
    try {
      await deps.applyProduct(payload);
    } catch (problem) {
      report.status = "partial";
      const lost = !(problem instanceof PhoneWriteError && problem.saved === false);
      report.reasons = [`Created as a draft, but the description ${lost ? "may not have been saved" : "was NOT saved"}: ${message(problem)}. ${RETRY_HINT}`];
      continue;
    }
    try {
      const after = await deps.readSnapshot(createdId);
      const saved = cleanDescription(after.product.content as string | null) === item.description;
      const stockKept = after.stock[String(variant.id)] === GADGET_NEW_PRODUCT_STOCK;
      report.checks.push(check(createdId, "Description saved", saved, saved ? "saved" : "not found"), check(createdId, `Stock still ${GADGET_NEW_PRODUCT_STOCK}`, stockKept, String(after.stock[String(variant.id)])));
      if (!saved) {
        report.status = "partial";
        report.reasons = [`Created as a draft, but the description was not found after saving. ${RETRY_HINT}`];
      } else if (!stockKept) {
        report.status = "needs_check";
        report.reasons = ["The stock changed while saving the description. Check it in Catalog."];
      }
    } catch (problem) {
      report.status = "needs_check";
      report.reasons = [`Created and description sent, but it could not be read back: ${message(problem)}. ${RETRY_HINT}`];
    }
  }
  emit(reports.length, null);

  const result = finish("finished", "", [...reports, ...heldReports]);
  const { updated, partial, failed, unknown, needs_check: needsCheck, held } = result.counts;
  result.message = `${updated} gadget(s) updated · ${partial} created without description · ${failed} failed · ${held} held for review${unknown + needsCheck ? ` · ${unknown + needsCheck} to check again` : ""}. Nothing was hidden, deleted or published.`;
  return result;
}
