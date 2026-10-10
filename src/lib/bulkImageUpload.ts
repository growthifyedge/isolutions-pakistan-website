/**
 * Bulk Product Images — controlled, environment-aware bulk uploader.
 *
 * Uploads the Owner's included image sets product-by-product through the shared Phase 3B
 * flow (signature → Cloudinary → product_media insert). It runs only for an exact, known
 * (build mode, Supabase project, Cloudinary folder root) triple: DEVELOPMENT or PRODUCTION.
 * - A product failure never stops the batch: the product is recorded Failed/Partial and the
 *   run moves on. Orphaned Cloudinary assets are reported, never silently deleted.
 * - Media is re-read from the database right before each product's first write; if it differs from
 *   what the review saw, the product is blocked ("Media changed since review").
 * - Nothing is deleted or replaced; products are not published; prices, variants and
 *   inventory are never touched. "Add and make primary" keeps the old primary as gallery.
 * - Each product is verified by reading product_media back.
 * Network and database access are injected, so the whole path is testable offline.
 */
import {
  planImageSet,
  reviewSetStates,
  type BulkImageCatalogProduct,
  type BulkImageReview,
  type BulkImageSourceKind,
} from "./bulkProductImagesReview.ts";
import { productMediaPayload, type ProductMediaInsert } from "./productMediaPayload.ts";
import { shopifyImageUrlProblem } from "./shopifyProductCsv.ts";
import { SUPABASE_ENVIRONMENTS, environmentForSupabaseUrl, supabaseProjectRef } from "./supabaseEnvironment.ts";
import type { UploadSignature } from "./productMediaUpload.ts";

export const MEDIA_CHANGED_MESSAGE = "Media changed since review — re-review required";

export type UploadEnvironmentName = "development" | "production";

/** Cloudinary folder root every signed folder and returned public_id must sit under, per environment. */
export const CLOUDINARY_ROOTS: Record<UploadEnvironmentName, string> = {
  development: "isolutions-development/products/",
  production: "isolutions-production/products/",
};

export function uploadWarning(environment: UploadEnvironmentName) {
  return environment === "production"
    ? "This will write production media."
    : "This will write product_media records to DEV and upload images to Cloudinary.";
}

export type UploadTarget = {
  allowed: boolean;
  reason: string | null;
  environment: UploadEnvironmentName | null;
  projectRef: string | null;
  /** e.g. "isolutions-production/products/" */
  cloudinaryRoot: string | null;
};

/**
 * The ONLY gate for writing. The Supabase URL must resolve to a known project, the build mode must equal
 * that project's environment, and the pair must be exactly (development, DEV ref) or (production, PROD ref).
 * Unknown, lookalike, missing or mismatched combinations are blocked.
 */
export function resolveUploadTarget(supabaseUrl: string | undefined | null, buildMode: string | undefined | null): UploadTarget {
  const denied = (reason: string, environment: UploadEnvironmentName | null = null, projectRef: string | null = null): UploadTarget => ({
    allowed: false,
    reason,
    environment,
    projectRef,
    cloudinaryRoot: null,
  });
  const ref = supabaseProjectRef(supabaseUrl);
  const environment = environmentForSupabaseUrl(supabaseUrl);
  if (!ref || !environment) return denied("Blocked: the Supabase environment is UNKNOWN. Uploads run only on the exact DEVELOPMENT or PRODUCTION project.");
  const pair = SUPABASE_ENVIRONMENTS[environment.name];
  if (ref !== pair.supabaseProjectRef) return denied("Blocked: the Supabase project does not match its environment.", environment.name, ref);
  if (buildMode !== environment.name)
    return denied(
      `Blocked: this ${buildMode ?? "unknown"}-mode build is connected to the ${environment.name.toUpperCase()} Supabase project (${ref}). Build mode and project must match.`,
      environment.name,
      ref,
    );
  return { allowed: true, reason: null, environment: environment.name, projectRef: ref, cloudinaryRoot: CLOUDINARY_ROOTS[environment.name] };
}

/** Folder must be exactly `<root><productId>`; returned public_ids must sit under `<root><productId>/`. */
export function cloudinaryFolderProblem(environment: UploadEnvironmentName, folder: string, productId: string): string | null {
  const root = CLOUDINARY_ROOTS[environment];
  if (folder !== `${root}${productId}`)
    return `The signed Cloudinary folder "${folder}" is not "${root}${productId}" (${environment.toUpperCase()}).`;
  return null;
}

export function cloudinaryPublicIdProblem(environment: UploadEnvironmentName, publicId: unknown, productId: string): string | null {
  const prefix = `${CLOUDINARY_ROOTS[environment]}${productId}/`;
  if (typeof publicId !== "string" || !publicId.startsWith(prefix))
    return `Cloudinary returned public_id "${String(publicId)}", which is not under "${prefix}" (${environment.toUpperCase()}).`;
  return null;
}

// ---------------- Plan ----------------

export type BulkUploadMode = "new" | "add" | "add_make_primary";

export type BulkUploadImage = {
  imageId: string;
  label: string;
  altText: string;
  /** https URL (Shopify) or File/Blob (local) handed to the shared Cloudinary uploader. */
  source: string | Blob;
  sortOrder: number;
  /** is_primary value for the insert (false when the primary is switched afterwards). */
  insertAsPrimary: boolean;
  /** This image is the product's primary once the product is done. */
  finalPrimary: boolean;
};

export type BulkUploadProduct = {
  setId: string;
  productId: string;
  title: string;
  sourceKind: BulkImageSourceKind;
  sourceLabel: "Shopify URL" | "Local File";
  mode: BulkUploadMode;
  /** What the review saw; the pre-write re-check must match it exactly. */
  expected: { count: number; hasPrimary: boolean };
  images: BulkUploadImage[];
};

export type BulkUploadUnresolved = { review: number; multiple: number; conflict: number; invalid: number };

export type BulkUploadPlan = {
  enabled: boolean;
  /** ONE concise blocking message (first real problem, plus how many more). */
  reason: string | null;
  /** Every problem found (the preflight reports them all). */
  problems: string[];
  /** Included sets that are still Review / Multiple / Conflict / Invalid. */
  unresolved: BulkUploadUnresolved;
  target: UploadTarget;
  products: BulkUploadProduct[];
  totals: { products: number; images: number; addImages: number; makePrimary: number };
};

const emptyTotals = { products: 0, images: 0, addImages: 0, makePrimary: 0 };
const noUnresolved: BulkUploadUnresolved = { review: 0, multiple: 0, conflict: 0, invalid: 0 };
const blocked = (reason: string, target: UploadTarget, extra: Partial<BulkUploadPlan> = {}): BulkUploadPlan => ({
  enabled: false,
  reason,
  problems: [reason],
  unresolved: noUnresolved,
  target,
  products: [],
  totals: emptyTotals,
  ...extra,
});

/** Decides whether the included sets can be uploaded, and exactly what would be written. */
export function planBulkUpload(
  review: BulkImageReview,
  catalog: BulkImageCatalogProduct[],
  supabaseUrl: string | undefined | null,
  buildMode: string | undefined | null,
): BulkUploadPlan {
  const target = resolveUploadTarget(supabaseUrl, buildMode);
  if (!target.allowed) return blocked(target.reason!, target);
  const included = review.sets.filter((set) => review.decisions[set.setId]?.included);
  if (included.length === 0) return blocked("Select at least one image set to upload.", target);
  const unresolved: BulkUploadUnresolved = { review: 0, multiple: 0, conflict: 0, invalid: 0 };

  const states = reviewSetStates(review, catalog);
  const productById = new Map(catalog.map((product) => [product.id, product]));
  const problems: string[] = [];
  const products: BulkUploadProduct[] = [];
  const claimed = new Map<string, string>();

  for (const set of included) {
    const decision = review.decisions[set.setId];
    const state = states.get(set.setId)!;
    const fail = (text: string) => problems.push(`${set.title}: ${text}`);
    if (state.status === "review" || state.status === "multiple" || state.status === "conflict" || state.status === "invalid") unresolved[state.status] += 1;
    if (state.status === "review") { fail("Review is unresolved — confirm the product match."); continue; }
    if (state.status === "multiple") { fail("Multiple matches are unresolved — choose one product."); continue; }
    if (state.status === "conflict") { fail("Conflict is unresolved — choose one source set."); continue; }
    if (state.status === "invalid") { fail("the source is invalid."); continue; }
    if (state.status !== "matched" && state.status !== "confirmed") { fail(`the set is ${state.status}; it needs a matched or confirmed product.`); continue; }
    const product = state.targetId ? productById.get(state.targetId) : undefined;
    if (!product || !decision.confirmed) { fail("choose and confirm exactly one product."); continue; }
    if (claimed.has(product.id)) { fail(`another included set also targets ${product.title}.`); continue; }
    claimed.set(product.id, set.setId);

    const selected = set.images.filter((image) => decision.selectedImageIds.includes(image.id));
    if (selected.length === 0) { fail("select at least one image."); continue; }
    const invalid = selected.find((image) => image.invalidReason);
    if (invalid) { fail(`invalid image ${invalid.label} — ${invalid.invalidReason}`); continue; }
    let sourceProblem: string | null = null;
    for (const image of selected) {
      if (set.sourceKind === "shopify") {
        const problem = image.sourceUrl ? shopifyImageUrlProblem(image.sourceUrl) : "no source URL";
        if (problem) sourceProblem = `${image.label} — ${problem}`;
      } else if (!image.file) sourceProblem = `${image.label} — the local file is no longer available, re-add it`;
    }
    if (sourceProblem) { fail(`invalid source ${sourceProblem}.`); continue; }
    if (product.hasPrimary && decision.existingMode === "skip") { fail('the product already has a primary image — choose "Add images" or "Add and make primary", or untick it.'); continue; }
    const needsPrimary = !product.hasPrimary || decision.existingMode === "add_make_primary";
    if (needsPrimary && !selected.some((image) => image.id === decision.primaryImageId)) { fail("mark exactly one selected image as Primary."); continue; }

    const planned = planImageSet(set, decision, product);
    if (planned.length !== selected.length || planned.filter((entry) => entry.isPrimary || entry.makePrimaryAfterInsert).length > 1) { fail("the upload plan is inconsistent."); continue; }
    const byId = new Map(selected.map((image) => [image.id, image]));
    const mode: BulkUploadMode = !product.hasPrimary ? "new" : decision.existingMode === "add_make_primary" ? "add_make_primary" : "add";
    products.push({
      setId: set.setId,
      productId: product.id,
      title: product.title,
      sourceKind: set.sourceKind,
      sourceLabel: set.sourceKind === "shopify" ? "Shopify URL" : "Local File",
      mode,
      expected: { count: product.mediaCount, hasPrimary: product.hasPrimary },
      images: planned.map((entry, index) => {
        const image = byId.get(entry.imageId)!;
        const finalPrimary = entry.isPrimary || entry.makePrimaryAfterInsert;
        return {
          imageId: image.id,
          label: image.label,
          altText: finalPrimary || index === 0 ? product.title : `${product.title} – image ${index + 1}`,
          source: set.sourceKind === "shopify" ? image.sourceUrl!.trim() : image.file!,
          sortOrder: entry.sortOrder,
          insertAsPrimary: entry.isPrimary,
          finalPrimary,
        };
      }),
    });
  }

  if (problems.length > 0)
    return blocked(problems.length === 1 ? problems[0] : `${problems[0]} (+${problems.length - 1} more set${problems.length === 2 ? "" : "s"} need attention)`, target, {
      problems,
      unresolved,
    });
  return {
    enabled: true,
    reason: null,
    problems: [],
    unresolved,
    target,
    products,
    totals: {
      products: products.length,
      images: products.reduce((total, product) => total + product.images.length, 0),
      addImages: products.filter((product) => product.mode === "add").length,
      makePrimary: products.filter((product) => product.mode === "add_make_primary").length,
    },
  };
}

/** One-shot guard against repeated clicks: only one run can hold it at a time. */
export function createSubmitLatch() {
  let held = false;
  return {
    tryAcquire() {
      if (held) return false;
      held = true;
      return true;
    },
    release() {
      held = false;
    },
    get held() {
      return held;
    },
  };
}

// ---------------- Execution ----------------

export type BulkMediaRow = {
  id: string;
  product_id: string;
  cloudinary_public_id: string;
  secure_url: string | null;
  sort_order: number;
  is_primary: boolean;
};

export type BulkUploadDeps = {
  supabaseUrl: string | undefined | null;
  /** Vite build mode ("development" | "production"); must match the Supabase project's environment. */
  buildMode: string | undefined | null;
  requestSignature: (productId: string) => Promise<UploadSignature>;
  upload: (signature: UploadSignature, source: string | Blob, onProgress?: (percent: number) => void) => Promise<Record<string, unknown>>;
  insertMedia: (payload: ProductMediaInsert) => Promise<{ id: string }>;
  /** Existing set_product_media_primary RPC semantics: the old primary stays as gallery. */
  setPrimary: (mediaId: string) => Promise<void>;
  readMedia: (productId: string) => Promise<BulkMediaRow[]>;
  onProgress?: (progress: BulkUploadProgress) => void;
};

export type BulkUploadProductStatus = "pending" | "uploading" | "saved" | "verified" | "failed" | "partial" | "blocked";

export type BulkUploadProgress = {
  productsTotal: number;
  productsDone: number;
  imagesTotal: number;
  imagesDone: number;
  current: { title: string; imageIndex: number; imageTotal: number; stage: "checking" | "authorizing" | "uploading" | "saving" | "switching primary" | "verifying"; percent?: number } | null;
  statuses: Record<string, BulkUploadProductStatus>;
};

export type BulkUploadInserted = { mediaId: string; publicId: string; secureUrl: string; label: string; isPrimary: boolean; sortOrder: number };
export type BulkUploadCheck = { name: string; ok: boolean; detail: string };

export type BulkUploadProductResult = {
  setId: string;
  productId: string;
  title: string;
  mode: BulkUploadMode;
  status: Exclude<BulkUploadProductStatus, "pending" | "uploading">;
  message: string;
  inserted: BulkUploadInserted[];
  imagesPlanned: number;
  failure: { index: number; label: string; stage: "authorization" | "upload" | "validation" | "insert" | "primary"; message: string } | null;
  /** Cloudinary asset that exists but has no product_media row. Never deleted automatically. */
  orphan: { publicId: string; label: string } | null;
  checks: BulkUploadCheck[];
};

export type BulkUploadSummary = {
  attempted: number;
  verified: number;
  failed: number;
  partial: number;
  saved: number;
  blocked: number;
  imagesUploaded: number;
  imagesFailed: number;
  orphans: { title: string; publicId: string }[];
};

export type BulkUploadResult = {
  /** all_verified only when every product was read back and verified. */
  outcome: "all_verified" | "issues" | "blocked";
  message: string;
  products: BulkUploadProductResult[];
  summary: BulkUploadSummary;
};

const messageOf = (error: unknown, fallback: string) => (error instanceof Error && error.message ? error.message : fallback);

/** Compares the rows read back from the database with what was inserted and what existed before. */
export function verifyProductMedia(rows: BulkMediaRow[], inserted: BulkUploadInserted[], before: BulkMediaRow[], mode: BulkUploadMode): BulkUploadCheck[] {
  const check = (name: string, ok: boolean, detail: string): BulkUploadCheck => ({ name, ok, detail });
  const byId = new Map(rows.map((row) => [row.id, row]));
  const primaries = rows.filter((row) => row.is_primary);
  const oldPrimary = before.find((row) => row.is_primary);
  const newPrimary = inserted.find((entry) => entry.isPrimary);
  const expectedPrimaryId = mode === "add" ? oldPrimary?.id : newPrimary?.mediaId;
  const missingNew = inserted.filter((entry) => !byId.has(entry.mediaId));
  const missingOld = before.filter((row) => !byId.has(row.id));
  const sortMismatches = inserted.filter((entry) => byId.get(entry.mediaId)?.sort_order !== entry.sortOrder);
  const noUrl = inserted.filter((entry) => {
    const url = byId.get(entry.mediaId)?.secure_url;
    return typeof url !== "string" || !url.startsWith("https://");
  });
  const duplicates = rows.length - new Set(rows.map((row) => row.id)).size + (rows.length - new Set(rows.map((row) => row.cloudinary_public_id)).size);
  const checks = [
    check("Row count", rows.length === before.length + inserted.length, `${rows.length} row(s) in the database, ${before.length + inserted.length} expected`),
    check("Existing media kept", missingOld.length === 0, missingOld.length ? `Missing: ${missingOld.map((row) => row.id).join(", ")}` : `${before.length} existing row(s) still present`),
    check("Inserted rows exist", missingNew.length === 0, missingNew.length ? `Missing: ${missingNew.map((entry) => entry.mediaId).join(", ")}` : "All inserted IDs found"),
    check("Exactly one primary", primaries.length === 1 && primaries[0].id === expectedPrimaryId, `${primaries.length} primary row(s)`),
    check("sort_order correct", sortMismatches.length === 0, sortMismatches.length ? `Mismatch: ${sortMismatches.map((entry) => entry.label).join(", ")}` : "Matches the selected order"),
    check("secure_url populated", noUrl.length === 0, noUrl.length ? `${noUrl.length} inserted row(s) without an https URL` : "All inserted rows have an https URL"),
    check("No duplicates", duplicates === 0, duplicates ? `${duplicates} duplicate id/public_id value(s)` : "No duplicates"),
  ];
  if (mode === "add_make_primary" && oldPrimary)
    checks.push(check("Old primary kept as gallery", byId.has(oldPrimary.id) && !byId.get(oldPrimary.id)!.is_primary, "Previous primary is still present and no longer primary"));
  return checks;
}

function summarize(products: BulkUploadProductResult[]): BulkUploadSummary {
  const count = (status: BulkUploadProductResult["status"]) => products.filter((product) => product.status === status).length;
  return {
    attempted: products.length,
    verified: count("verified"),
    failed: count("failed"),
    partial: count("partial"),
    saved: count("saved"),
    blocked: count("blocked"),
    imagesUploaded: products.reduce((total, product) => total + product.inserted.length, 0),
    imagesFailed: products.reduce((total, product) => total + (product.status === "verified" || product.status === "saved" ? 0 : product.imagesPlanned - product.inserted.length), 0),
    orphans: products.flatMap((product) => (product.orphan ? [{ title: product.title, publicId: product.orphan.publicId }] : [])),
  };
}

/**
 * Runs the bulk upload product-by-product. Per image: signature → Cloudinary → response
 * validation → product_media insert. A failure stops only that product; the next product runs.
 */
export async function runBulkUpload(products: BulkUploadProduct[], deps: BulkUploadDeps): Promise<BulkUploadResult> {
  const guard = resolveUploadTarget(deps.supabaseUrl, deps.buildMode);
  if (!guard.allowed || products.length === 0)
    return {
      outcome: "blocked",
      message: `${guard.reason ?? "Nothing selected."} Nothing was uploaded or saved.`,
      products: [],
      summary: summarize([]),
    };

  const progress: BulkUploadProgress = {
    productsTotal: products.length,
    productsDone: 0,
    imagesTotal: products.reduce((total, product) => total + product.images.length, 0),
    imagesDone: 0,
    current: null,
    statuses: Object.fromEntries(products.map((product) => [product.setId, "pending" as BulkUploadProductStatus])),
  };
  const emit = () => deps.onProgress?.({ ...progress, current: progress.current && { ...progress.current }, statuses: { ...progress.statuses } });
  const results: BulkUploadProductResult[] = [];

  for (const product of products) {
    progress.statuses[product.setId] = "uploading";
    const imagesBefore = progress.imagesDone;
    const total = product.images.length;
    const setCurrent = (imageIndex: number, stage: NonNullable<BulkUploadProgress["current"]>["stage"], percent?: number) => {
      progress.current = { title: product.title, imageIndex, imageTotal: total, stage, percent };
      emit();
    };
    const result = await runProduct(product, deps, setCurrent, () => {
      progress.imagesDone += 1;
      emit();
    });
    // Images never attempted (stopped product) still count as handled so the counter reaches its total.
    progress.imagesDone = imagesBefore + total;
    progress.statuses[product.setId] = result.status;
    progress.productsDone += 1;
    progress.current = null;
    emit();
    results.push(result);
  }

  const summary = summarize(results);
  const allVerified = summary.verified === results.length;
  return {
    outcome: allVerified ? "all_verified" : "issues",
    message: allVerified
      ? `All ${summary.verified} product(s) uploaded and verified.`
      : `Finished with issues: ${summary.verified} verified, ${summary.partial} partial, ${summary.failed} failed${summary.saved ? `, ${summary.saved} saved but not verified` : ""}${summary.blocked ? `, ${summary.blocked} blocked` : ""}.`,
    products: results,
    summary,
  };
}

async function runProduct(
  product: BulkUploadProduct,
  deps: BulkUploadDeps,
  setCurrent: (imageIndex: number, stage: NonNullable<BulkUploadProgress["current"]>["stage"], percent?: number) => void,
  imageHandled: () => void,
): Promise<BulkUploadProductResult> {
  const total = product.images.length;
  const base = { setId: product.setId, productId: product.productId, title: product.title, mode: product.mode, imagesPlanned: total };
  const inserted: BulkUploadInserted[] = [];
  const done = (status: BulkUploadProductResult["status"], message: string, extra: Partial<BulkUploadProductResult> = {}): BulkUploadProductResult => ({
    ...base,
    status,
    message,
    inserted,
    failure: null,
    orphan: null,
    checks: [],
    ...extra,
  });

  const guard = resolveUploadTarget(deps.supabaseUrl, deps.buildMode);
  if (!guard.allowed || !guard.environment) return done("blocked", `${guard.reason} Nothing was uploaded or saved for this product.`);

  setCurrent(0, "checking");
  let before: BulkMediaRow[];
  try {
    before = await deps.readMedia(product.productId);
  } catch (error) {
    return done("blocked", `Could not re-check the product's media (${messageOf(error, "read failed")}). Nothing was uploaded or saved.`);
  }
  if (before.length !== product.expected.count || before.some((row) => row.is_primary) !== product.expected.hasPrimary)
    return done("blocked", `${MEDIA_CHANGED_MESSAGE}: ${guard.environment.toUpperCase()} now has ${before.length} media row(s) for ${product.title}, the review saw ${product.expected.count}. Nothing was uploaded or saved.`);

  const fail = (index: number, stage: NonNullable<BulkUploadProductResult["failure"]>["stage"], error: unknown, orphanPublicId?: string): BulkUploadProductResult => {
    const image = product.images[index];
    const detail = messageOf(error, `${stage} failed`);
    const orphanNote = orphanPublicId ? ` ORPHANED Cloudinary asset (no database row, not deleted): ${orphanPublicId}.` : "";
    const savedNote = inserted.length ? ` ${inserted.length} of ${total} image(s) were saved (product_media IDs: ${inserted.map((entry) => entry.mediaId).join(", ")}).` : " No product_media row was saved.";
    const rest = stage === "primary" ? "" : " Remaining images for this product were not processed.";
    return done(inserted.length > 0 || orphanPublicId ? "partial" : "failed", `Image ${index + 1} of ${total} (${image.label}) failed at ${stage}: ${detail}.${orphanNote}${savedNote}${rest}`, {
      failure: { index, label: image.label, stage, message: detail },
      orphan: orphanPublicId ? { publicId: orphanPublicId, label: image.label } : null,
    });
  };

  for (const [index, image] of product.images.entries()) {
    let signature: UploadSignature;
    try {
      setCurrent(index, "authorizing");
      signature = await deps.requestSignature(product.productId);
      const folderProblem = cloudinaryFolderProblem(guard.environment, signature.signedParameters.folder, product.productId);
      if (folderProblem) throw new Error(folderProblem);
    } catch (error) {
      return fail(index, "authorization", error);
    }
    let response: Record<string, unknown>;
    try {
      setCurrent(index, "uploading", 0);
      response = await deps.upload(signature, image.source, (percent) => setCurrent(index, "uploading", percent));
    } catch (error) {
      return fail(index, "upload", error);
    }
    const uploadedPublicId = typeof response.public_id === "string" ? response.public_id : undefined;
    let payload: ProductMediaInsert;
    try {
      const publicIdProblem = cloudinaryPublicIdProblem(guard.environment, response.public_id, product.productId);
      if (publicIdProblem) throw new Error(publicIdProblem);
      payload = productMediaPayload(response, { productId: product.productId, altText: image.altText, sortOrder: image.sortOrder, isPrimary: image.insertAsPrimary });
    } catch (error) {
      return fail(index, "validation", error, uploadedPublicId);
    }
    try {
      setCurrent(index, "saving");
      const row = await deps.insertMedia(payload);
      inserted.push({ mediaId: row.id, publicId: payload.cloudinary_public_id, secureUrl: payload.secure_url, label: image.label, isPrimary: image.finalPrimary, sortOrder: image.sortOrder });
      imageHandled();
    } catch (error) {
      imageHandled();
      return fail(index, "insert", error, payload.cloudinary_public_id);
    }
  }

  if (product.mode === "add_make_primary") {
    const newPrimary = inserted.find((entry) => entry.isPrimary);
    try {
      setCurrent(total - 1, "switching primary");
      if (!newPrimary) throw new Error("no inserted image is marked as the new primary");
      await deps.setPrimary(newPrimary.mediaId);
    } catch (error) {
      const index = product.images.findIndex((image) => image.finalPrimary);
      return fail(Math.max(index, 0), "primary", error);
    }
  }

  setCurrent(total - 1, "verifying");
  let rows: BulkMediaRow[];
  try {
    rows = await deps.readMedia(product.productId);
  } catch (error) {
    return done("saved", `${total} image(s) were saved, but the read-back from the database failed (${messageOf(error, "read failed")}). NOT verified.`);
  }
  const checks = verifyProductMedia(rows, inserted, before, product.mode);
  const ok = checks.every((entry) => entry.ok);
  return done(ok ? "verified" : "saved", ok ? `${total} image(s) saved and verified.` : `Saved, but read-back verification FAILED: ${checks.filter((entry) => !entry.ok).map((entry) => entry.name).join(", ")}. NOT verified.`, { checks });
}
