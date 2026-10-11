/**
 * Bulk publish for the imported Android batch — pure planning, confirmation and the write loop.
 *
 * It reuses the SAME mechanism as the product editor's "Validate & publish":
 *   1. `validate_product_for_publication(p_product_id)` (the real validator; also enforced again by the
 *      `products_enforce_publication` database trigger, which sets published_at), then
 *   2. `products.update({ publication_status: "published" })`.
 * Unlike the editor it sends ONLY publication_status (no flag columns). There is no weaker parallel validator here.
 * Targeting is the exact 82-title Android import list (`selectAndroidBatch`), never brand/category alone.
 * Database access is injected so the whole flow is testable offline.
 */
import { commercialWriteTarget, verifyCommercialUpdate, type BatchSelection, type CommercialCheck, type CommercialSnapshot } from "./commercialDefaults.ts";

export type PublishValidation = { isValid: boolean; errors: string[] };

// ---------------- Preview ----------------

export type PublishPreviewKind = "ready" | "already_published" | "blocked" | "skipped";

export type PublishPreviewEntry = {
  productId: string;
  title: string;
  kind: PublishPreviewKind;
  blockers: string[];
  reason: string | null;
};

export type PublishPreview = {
  entries: PublishPreviewEntry[];
  totals: { targets: number; draft: number; alreadyPublished: number; ready: number; blocked: number; skipped: number; missingTitles: number };
};

/** Zero-write preview from the batch selection and the real validator's answers for each draft target. */
export function buildPublishPreview(selection: BatchSelection, validations: ReadonlyMap<string, PublishValidation | null>): PublishPreview {
  const entries: PublishPreviewEntry[] = [];
  for (const product of selection.targets) {
    const base = { productId: product.id, title: product.title, blockers: [] as string[], reason: null as string | null };
    if (product.publicationStatus === "published") entries.push({ ...base, kind: "already_published" });
    else if (product.publicationStatus !== "draft") entries.push({ ...base, kind: "skipped", reason: `Publication status is "${product.publicationStatus ?? "unknown"}", not draft.` });
    else {
      const validation = validations.get(product.id);
      if (!validation) entries.push({ ...base, kind: "blocked", blockers: ["validation_unavailable"], reason: "The publication validator did not return a result." });
      else if (validation.isValid) entries.push({ ...base, kind: "ready" });
      else entries.push({ ...base, kind: "blocked", blockers: validation.errors });
    }
  }
  for (const { product, reason } of selection.skipped) entries.push({ productId: product.id, title: product.title, kind: "skipped", blockers: [], reason });
  const count = (kind: PublishPreviewKind) => entries.filter((entry) => entry.kind === kind).length;
  return {
    entries,
    totals: {
      targets: selection.targets.length,
      draft: selection.targets.filter((product) => product.publicationStatus === "draft").length,
      alreadyPublished: count("already_published"),
      ready: count("ready"),
      blocked: count("blocked"),
      skipped: count("skipped"),
      missingTitles: selection.missingTitles.length,
    },
  };
}

// ---------------- Confirmation ----------------

export const publishConfirmationPhrase = (readyCount: number) => `PUBLISH ${readyCount}`;

/** PRODUCTION: the exact phrase "PUBLISH <ready count>"; DEVELOPMENT: a plain confirmation (always satisfied); unknown: never. */
export function publishConfirmationSatisfied(environment: "development" | "production" | null, typed: string, readyCount: number) {
  if (environment === "production") return readyCount > 0 && typed === publishConfirmationPhrase(readyCount);
  return environment === "development" && readyCount > 0;
}

// ---------------- Write loop ----------------

export type PublishProductState = {
  publicationStatus: string;
  publishedAt: string | null;
  /** Everything else on the product row that must not change (title, slug, brand, category, defaults, flags…). */
  fields: Record<string, unknown>;
};

export type PublishDeps = {
  supabaseUrl: string | undefined | null;
  buildMode: string | undefined | null;
  readProduct: (productId: string) => Promise<PublishProductState>;
  /** The existing real validator (RPC validate_product_for_publication). */
  validate: (productId: string) => Promise<PublishValidation>;
  readSnapshot: (productId: string) => Promise<CommercialSnapshot>;
  /** Writes ONLY publication_status = "published" (the database trigger re-validates and stamps published_at). */
  publish: (productId: string) => Promise<void>;
  onProgress?: (progress: PublishProgress) => void;
};

export type PublishStatus = "pending" | "validating" | "publishing" | "verified" | "blocked" | "failed" | "already_published" | "skipped";

export type PublishProgress = { done: number; total: number; current: string | null; statuses: Record<string, PublishStatus> };

export type PublishProductResult = {
  productId: string;
  title: string;
  status: Exclude<PublishStatus, "pending" | "validating" | "publishing">;
  message: string;
  blockers: string[];
  checks: CommercialCheck[];
};

export type PublishRunResult = {
  outcome: "verified" | "issues" | "blocked";
  message: string;
  products: PublishProductResult[];
  summary: { targeted: number; verified: number; alreadyPublished: number; blocked: number; failed: number; skipped: number };
};

function summarize(products: PublishProductResult[]): PublishRunResult["summary"] {
  const count = (status: PublishProductResult["status"]) => products.filter((product) => product.status === status).length;
  return { targeted: products.length, verified: count("verified"), alreadyPublished: count("already_published"), blocked: count("blocked"), failed: count("failed"), skipped: count("skipped") };
}

const messageOf = (error: unknown) => (error instanceof Error && error.message ? error.message : "unknown error");

/** Compares a product before and after publishing: only publication_status / published_at may differ. */
export function verifyPublish(before: PublishProductState, after: PublishProductState, snapshotBefore: CommercialSnapshot, snapshotAfter: CommercialSnapshot): CommercialCheck[] {
  const changed = Object.keys(before.fields).filter((key) => JSON.stringify(before.fields[key]) !== JSON.stringify(after.fields[key]));
  return [
    { name: "Published", ok: after.publicationStatus === "published", detail: `publication_status = ${after.publicationStatus}` },
    { name: "published_at set", ok: Boolean(after.publishedAt), detail: after.publishedAt ?? "missing" },
    { name: "Product fields unchanged", ok: changed.length === 0, detail: changed.length ? `Changed: ${changed.join(", ")}` : "Title, slug, brand, category, defaults and flags identical" },
    // desired values are irrelevant with no target ids: this asserts variants (price, SKU, PTA, condition, …), media and stock are untouched.
    ...verifyCommercialUpdate(snapshotBefore, snapshotAfter, { pta: "", condition: "" }, []).filter((check) => check.name !== "PTA and Condition set on targets" && check.name !== "No target left Unknown"),
  ];
}

/**
 * Publishes the REVIEWED ready products one by one. Every product is re-read and re-validated immediately before its write;
 * anything that changed since the preview is blocked, never published. A failure never stops the batch, and a product is
 * "verified" only after the read-back confirms publication and that nothing else changed.
 */
export async function runBulkPublish(preview: PublishPreview, deps: PublishDeps): Promise<PublishRunResult> {
  const target = commercialWriteTarget(deps.supabaseUrl, deps.buildMode);
  if (!target.allowed) return { outcome: "blocked", message: `${target.reason} Nothing was published.`, products: [], summary: summarize([]) };
  const statuses: Record<string, PublishStatus> = Object.fromEntries(preview.entries.map((entry) => [entry.productId, "pending" as PublishStatus]));
  const results: PublishProductResult[] = [];
  const emit = (done: number, current: string | null) => deps.onProgress?.({ done, total: preview.entries.length, current, statuses: { ...statuses } });

  for (const [index, entry] of preview.entries.entries()) {
    emit(index, entry.title);
    const base = { productId: entry.productId, title: entry.title, blockers: [] as string[], checks: [] as CommercialCheck[] };
    const finish = (status: PublishProductResult["status"], message: string, extra: Partial<PublishProductResult> = {}) => {
      statuses[entry.productId] = status;
      results.push({ ...base, status, message, ...extra });
    };
    if (entry.kind === "skipped") {
      finish("skipped", entry.reason ?? "Skipped.");
      continue;
    }
    if (entry.kind === "already_published") {
      finish("already_published", "Already published; not touched.");
      continue;
    }
    if (entry.kind === "blocked") {
      finish("blocked", `Blocked: ${entry.blockers.join(", ") || entry.reason || "not publication-ready"}. Not published.`, { blockers: entry.blockers });
      continue;
    }
    try {
      statuses[entry.productId] = "validating";
      emit(index, entry.title);
      const before = await deps.readProduct(entry.productId);
      if (before.publicationStatus === "published") {
        finish("already_published", "Already published since the preview; not touched.");
        continue;
      }
      if (before.publicationStatus !== "draft") {
        finish("skipped", `Publication status is now "${before.publicationStatus}", not draft.`);
        continue;
      }
      const validation = await deps.validate(entry.productId);
      if (!validation.isValid) {
        finish("blocked", `Blocked since the preview: ${validation.errors.join(", ")}. Not published.`, { blockers: validation.errors });
        continue;
      }
      const snapshotBefore = await deps.readSnapshot(entry.productId);
      statuses[entry.productId] = "publishing";
      emit(index, entry.title);
      await deps.publish(entry.productId);
      const after = await deps.readProduct(entry.productId);
      const snapshotAfter = await deps.readSnapshot(entry.productId);
      const checks = verifyPublish(before, after, snapshotBefore, snapshotAfter);
      const ok = checks.every((check) => check.ok);
      finish(ok ? "verified" : "failed", ok ? "Published and verified." : `Written, but read-back verification FAILED: ${checks.filter((check) => !check.ok).map((check) => check.name).join(", ")}.`, { checks });
    } catch (error) {
      finish("failed", `Publish failed: ${messageOf(error)}. Check the product's status before retrying.`);
    }
  }
  emit(preview.entries.length, null);
  const summary = summarize(results);
  const clean = summary.failed === 0 && summary.blocked === 0;
  return {
    outcome: clean ? "verified" : "issues",
    message: clean
      ? `Published and verified ${summary.verified} product(s); ${summary.alreadyPublished} already published; ${summary.skipped} skipped.`
      : `Finished with issues: ${summary.verified} published and verified, ${summary.blocked} blocked, ${summary.failed} failed, ${summary.alreadyPublished} already published, ${summary.skipped} skipped.`,
    products: results,
    summary,
  };
}
