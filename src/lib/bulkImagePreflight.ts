/**
 * Bulk Product Images — preflight before any upload.
 *
 * Read-only. The only external call is, for PRODUCTION, ONE signature request for the first
 * product ("signature-only check"): it proves the Cloudinary cloud and folder root the Edge
 * Function will sign for, and uploads nothing. The dependency type below deliberately has no
 * upload, insert or delete capability, so the preflight cannot write even by mistake.
 */
import type { BulkImageCatalogProduct, BulkImageReview } from "./bulkProductImagesReview.ts";
import {
  CLOUDINARY_ROOTS,
  cloudinaryFolderProblem,
  planBulkUpload,
  resolveUploadTarget,
  type BulkUploadPlan,
  type BulkUploadUnresolved,
  type UploadEnvironmentName,
} from "./bulkImageUpload.ts";
import type { UploadSignature } from "./productMediaUpload.ts";

export const PRODUCTION_CONFIRMATION_TEXT = "PRODUCTION";

export type BulkPreflightInput = {
  review: BulkImageReview;
  catalog: BulkImageCatalogProduct[];
  catalogLoaded: boolean;
  supabaseUrl: string | undefined | null;
  buildMode: string | undefined | null;
  /** Supabase project refs referenced by the running bundle's configuration (any `<ref>.supabase.co`). */
  runtimeRefs: string[];
};

/** Signature-only capability: no upload function exists here. */
export type BulkPreflightDeps = {
  requestSignature: (productId: string) => Promise<Pick<UploadSignature, "cloudName" | "signedParameters">>;
};

export type BulkPreflightResult = {
  passed: boolean;
  errors: string[];
  warnings: string[];
  environment: UploadEnvironmentName | null;
  projectRef: string | null;
  buildMode: string | null;
  productCount: number;
  imageCount: number;
  actions: { newMedia: number; addImages: number; makePrimary: number };
  unresolved: BulkUploadUnresolved;
  mediaSnapshot: { catalogProducts: number; productsWithMedia: number; productsWithPrimary: number };
  /** Filled by the PRODUCTION signature-only check. */
  cloudinary: { cloudName: string; folder: string; root: string } | null;
  plan: BulkUploadPlan;
};

/** Synchronous checks over review state, catalog snapshot and environment. */
export function evaluateBulkPreflight(input: BulkPreflightInput): BulkPreflightResult {
  const target = resolveUploadTarget(input.supabaseUrl, input.buildMode);
  const plan = planBulkUpload(input.review, input.catalog, input.supabaseUrl, input.buildMode);
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!target.allowed) errors.push(target.reason!);
  if (!input.catalogLoaded || input.catalog.length === 0) errors.push("The catalog is not loaded, so existing media cannot be checked.");
  if (target.allowed) for (const problem of plan.problems) errors.push(problem);
  if (target.allowed && target.projectRef) {
    const foreign = input.runtimeRefs.filter((ref) => ref !== target.projectRef);
    if (foreign.length)
      errors.push(`The active build references another Supabase project (${foreign.join(", ")}); a ${target.environment!.toUpperCase()} build may reference only ${target.projectRef}.`);
  }
  for (const product of plan.products) {
    if (product.mode === "new" && product.expected.count > 0)
      warnings.push(`${product.title} has ${product.expected.count} media row(s) but no primary; the new primary is added after them.`);
  }

  return {
    passed: errors.length === 0,
    errors,
    warnings,
    environment: target.environment,
    projectRef: target.projectRef,
    buildMode: input.buildMode ?? null,
    productCount: plan.totals.products,
    imageCount: plan.totals.images,
    actions: {
      newMedia: plan.products.filter((product) => product.mode === "new").length,
      addImages: plan.totals.addImages,
      makePrimary: plan.totals.makePrimary,
    },
    unresolved: plan.unresolved,
    mediaSnapshot: {
      catalogProducts: input.catalog.length,
      productsWithMedia: input.catalog.filter((product) => product.mediaCount > 0).length,
      productsWithPrimary: input.catalog.filter((product) => product.hasPrimary).length,
    },
    cloudinary: null,
    plan,
  };
}

/**
 * Full preflight. For PRODUCTION (and only then) it also requests one upload signature for the first
 * selected product and checks the cloud name and folder; nothing is uploaded.
 */
export async function runBulkPreflight(input: BulkPreflightInput, deps: BulkPreflightDeps): Promise<BulkPreflightResult> {
  const result = evaluateBulkPreflight(input);
  if (result.environment !== "production" || result.errors.length > 0 || result.plan.products.length === 0) return result;
  const first = result.plan.products[0];
  try {
    const signature = await deps.requestSignature(first.productId);
    const folder = signature.signedParameters.folder;
    const problem = cloudinaryFolderProblem("production", folder, first.productId);
    if (problem) return { ...result, passed: false, errors: [...result.errors, `Signature check failed: ${problem}`] };
    if (!signature.cloudName) return { ...result, passed: false, errors: [...result.errors, "Signature check failed: no Cloudinary cloud name was returned."] };
    return { ...result, cloudinary: { cloudName: signature.cloudName, folder, root: CLOUDINARY_ROOTS.production } };
  } catch (error) {
    const reason = error instanceof Error && error.message ? error.message : "request failed";
    return { ...result, passed: false, errors: [...result.errors, `Signature check failed: ${reason}. PRODUCTION upload is blocked.`] };
  }
}

/** PRODUCTION needs the Owner to type exactly "PRODUCTION"; DEVELOPMENT needs no typed text. */
export function confirmationSatisfied(environment: UploadEnvironmentName | null, typed: string) {
  if (environment === "production") return typed === PRODUCTION_CONFIRMATION_TEXT;
  return environment === "development";
}
