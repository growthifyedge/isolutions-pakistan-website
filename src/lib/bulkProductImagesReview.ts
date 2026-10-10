/**
 * Bulk Product Images — review state (pure; no uploads, no database writes).
 *
 * The review works on PRODUCT IMAGE SETS, not single images:
 * - a Shopify source set = one Shopify Handle with ALL its valid images (lowest Image
 *   Position is the proposed primary, the rest are gallery images);
 * - a local source set = Owner-selected local files for one product. Files that target
 *   the same product (filename match, manual assignment or "Missing Images" upload) join
 *   one set instead of competing.
 * A set has exactly one primary image and any number of selected gallery images. A
 * Conflict means two DIFFERENT source sets (e.g. two Shopify Handles, or a Shopify Handle
 * and a local set) target the same product; the Owner chooses which set to use.
 *
 * Matching is the Step 1 matcher (productImageMatching / shopifyProductCsv) unchanged;
 * the insert plan reuses the Step 2 primary rule (productMediaPayload). Nothing here
 * calls Cloudinary, Supabase or fetch — Apply is a later, separately approved step.
 */
import { validateSourceImage } from "./cloudinary.ts";
import {
  localImageSources,
  matchImageSources,
  type CatalogImageProduct,
  type ImageMatchRow,
  type ImageMatchStatus,
} from "./productImageMatching.ts";
import { planPrimaryAssignment } from "./productMediaPayload.ts";
import {
  parseShopifyProductsCsv,
  shopifyImageSources,
  shopifyImageUrlProblem,
  type ShopifyProductImages,
} from "./shopifyProductCsv.ts";
import { environmentForSupabaseUrl } from "./supabaseEnvironment.ts";

/** Upload/apply stays off until the Owner approves upload testing. */
export const BULK_IMAGE_APPLY_ENABLED = false;
export const BULK_IMAGE_APPLY_DISABLED_REASON = "Not enabled until upload testing is approved.";
/** Largest unmatched local batch kept together as one manual-assignment set. */
export const MAX_MANUAL_BATCH = 10;
export const MAX_SHOPIFY_EXPORT_BYTES = 50 * 1024 * 1024;
export const LOCAL_IMAGE_ACCEPT = ".jpg,.jpeg,.png,.webp,.avif,image/jpeg,image/png,image/webp,image/avif";

export type BulkImageSourceKind = "shopify" | "local";

export type BulkImageCatalogProduct = CatalogImageProduct & { slug: string; mediaCount: number };

export type BulkImage = {
  id: string;
  /** "Position 2 · a07-back.jpg" or the local filename. */
  label: string;
  /** Shopify CDN thumbnail (direct, lazy) or a local object URL. */
  previewUrl: string | null;
  /** Shopify image URL — the future Cloudinary upload source. Never fetched during review. */
  sourceUrl: string | null;
  /** Local source file (kept in memory only) — the upload source for a local image. */
  file?: Blob;
  /** Shopify Image Position, or the order the local files were added in. */
  sourcePosition: number;
  invalidReason: string | null;
};

export type BulkImageSet = {
  setId: string;
  sourceKind: BulkImageSourceKind;
  /** Shopify title, or the first local filename. */
  title: string;
  handle: string | null;
  shopifyStatus: string | null;
  /** Matcher result for this source set (before Owner decisions). */
  match: ImageMatchRow;
  images: BulkImage[];
};

/** For a product that already has a primary image: default skip; additions only by explicit choice. */
export type ExistingImageMode = "skip" | "add" | "add_make_primary";

export type BulkImageSetDecision = {
  /** Target product: the matcher's suggestion until the Owner changes it. */
  productId: string | null;
  /** Exact match, or explicitly confirmed/assigned by the Owner. */
  confirmed: boolean;
  included: boolean;
  /** "not_used": another source set was chosen for the product; "skipped": Owner ignored this source. */
  dismissed: "not_used" | "skipped" | null;
  existingMode: ExistingImageMode;
  selectedImageIds: string[];
  /** Always one of the selected images while the set has any. */
  primaryImageId: string | null;
};

export type BulkImageReview = {
  sets: BulkImageSet[];
  decisions: Record<string, BulkImageSetDecision>;
  nextLocalId: number;
};

export type BulkImageSetStatus = ImageMatchStatus | "confirmed" | "not_used" | "skipped";

export type BulkImageSetState = {
  status: BulkImageSetStatus;
  targetId: string | null;
  productHasPrimary: boolean;
  issue: string;
};

export type ReferenceCatalogEnvironment = { label: "DEVELOPMENT" | "PRODUCTION" | "UNKNOWN"; known: boolean };

type LocalFile = { name: string; type: string; size: number };
type LocalFileOptions = { contentProblems?: (string | null)[]; previewUrls?: (string | null)[] };

/** Label for the catalog the review reads from, via the shared environment map. */
export function referenceCatalogEnvironment(supabaseUrl: string | undefined | null): ReferenceCatalogEnvironment {
  const environment = environmentForSupabaseUrl(supabaseUrl);
  return environment
    ? { label: environment.label.toUpperCase() as "DEVELOPMENT" | "PRODUCTION", known: true }
    : { label: "UNKNOWN", known: false };
}

export function emptyReview(): BulkImageReview {
  return { sets: [], decisions: {}, nextLocalId: 1 };
}

const isValidImage = (image: BulkImage) => !image.invalidReason;
const productIn = (catalog: CatalogImageProduct[], id: string | null | undefined) =>
  id ? catalog.find((product) => product.id === id) : undefined;

// ---------------- Shopify source ----------------

type ExportFile = { name: string; size: number; arrayBuffer(): Promise<ArrayBuffer> };

const isShopifyProductsHeader = (text: string) => {
  const firstLine = (text.charCodeAt(0) === 0xfeff ? text.slice(1) : text).split(/\r?\n/, 1)[0].toLowerCase().replace(/[^a-z0-9,]/g, "");
  const columns = firstLine.split(",");
  return columns.includes("handle") && columns.includes("imagesrc");
};

/** Reads a Shopify Products export: a .csv, or a Shopify export .zip containing exactly one Products CSV. */
export async function readShopifyExport(file: ExportFile): Promise<{ csvName: string; text: string } | { error: string }> {
  if (file.size > MAX_SHOPIFY_EXPORT_BYTES) return { error: "The Shopify export must be 50 MB or smaller." };
  const lower = file.name.toLowerCase();
  if (lower.endsWith(".csv")) return { csvName: file.name, text: new TextDecoder().decode(await file.arrayBuffer()) };
  if (!lower.endsWith(".zip")) return { error: "Choose a Shopify Products export (.csv or .zip)." };

  const { default: JSZip } = await import("jszip");
  let zip: InstanceType<typeof JSZip>;
  try {
    zip = await JSZip.loadAsync(await file.arrayBuffer());
  } catch {
    return { error: "The ZIP file could not be read." };
  }
  const csvEntries = Object.values(zip.files).filter(
    (entry) => !entry.dir && entry.name.toLowerCase().endsWith(".csv") && !entry.name.startsWith("__MACOSX/"),
  );
  const products: { csvName: string; text: string }[] = [];
  for (const entry of csvEntries) {
    const text = await entry.async("string");
    if (isShopifyProductsHeader(text)) products.push({ csvName: entry.name, text });
  }
  if (products.length === 0) return { error: "No Shopify Products CSV (with Handle and Image Src columns) was found in the ZIP." };
  if (products.length > 1)
    return { error: `The ZIP contains ${products.length} Shopify Products CSVs (${products.map((entry) => entry.csvName).join(", ")}). Upload the one you want as a .csv.` };
  return products[0];
}

const catalogBrands = (catalog: CatalogImageProduct[]) => [
  ...new Set(catalog.map((product) => product.brand).filter((brand): brand is string => Boolean(brand))),
];

/** Shopify CDN resize parameter for review thumbnails (direct CDN request; nothing is proxied or stored). */
export function shopifyThumbnailUrl(src: string, width = 160) {
  try {
    const url = new URL(src);
    if (url.hostname === "cdn.shopify.com" || url.pathname.startsWith("/cdn/shop/")) url.searchParams.set("width", String(width));
    return url.toString();
  } catch {
    return null;
  }
}

const fileNameOf = (src: string) => {
  try {
    return decodeURIComponent(new URL(src).pathname.split("/").pop() ?? src);
  } catch {
    return src;
  }
};

function defaultDecision(set: BulkImageSet, catalog: CatalogImageProduct[]): BulkImageSetDecision {
  const valid = set.images.filter(isValidImage);
  const invalidSet = set.match.status === "invalid" || valid.length === 0;
  const productId = invalidSet ? null : set.match.productId;
  return {
    productId,
    confirmed: !invalidSet && set.match.status === "matched",
    included: !invalidSet && set.match.status === "matched" && !productIn(catalog, productId)?.hasPrimary,
    dismissed: null,
    existingMode: "skip",
    selectedImageIds: invalidSet ? [] : valid.map((image) => image.id),
    primaryImageId: invalidSet ? null : (valid[0]?.id ?? null),
  };
}

/** One source set per Shopify Handle, all valid images kept (sorted by Image Position). Replaces earlier Shopify sets. */
export function loadShopifySets(review: BulkImageReview, shopifyProducts: ShopifyProductImages[], catalog: CatalogImageProduct[]): BulkImageReview {
  const byId = new Map(shopifyProducts.map((product) => [`shopify:${product.handle}`, product]));
  const matches = matchImageSources(shopifyImageSources(shopifyProducts, catalogBrands(catalog)), catalog);
  const sets = matches.map((match): BulkImageSet => {
    const product = byId.get(match.sourceId)!;
    return {
      setId: match.sourceId,
      sourceKind: "shopify",
      title: product.title || product.handle,
      handle: product.handle,
      shopifyStatus: product.status || null,
      match,
      images: product.images.map((image, index) => {
        const invalidReason = shopifyImageUrlProblem(image.src);
        const position = image.position < 100_000 ? image.position : null;
        return {
          id: `${match.sourceId}#${index + 1}`,
          label: `Position ${position ?? "—"} · ${fileNameOf(image.src)}`,
          previewUrl: invalidReason ? null : shopifyThumbnailUrl(image.src),
          sourceUrl: image.src,
          sourcePosition: image.position,
          invalidReason,
        };
      }),
    };
  });
  const kept = review.sets.filter((set) => set.sourceKind !== "shopify");
  const decisions = Object.fromEntries(Object.entries(review.decisions).filter(([setId]) => !setId.startsWith("shopify:")));
  for (const set of sets) decisions[set.setId] = defaultDecision(set, catalog);
  return { ...review, sets: [...sets, ...kept], decisions };
}

export function parseShopifyReview(review: BulkImageReview, csvText: string, catalog: CatalogImageProduct[]) {
  const parsed = parseShopifyProductsCsv(csvText);
  if (parsed.errors.length) return { errors: parsed.errors, review: null, rowCount: parsed.rowCount, productCount: 0 };
  return {
    errors: [] as string[],
    review: loadShopifySets(review, parsed.products, catalog),
    rowCount: parsed.rowCount,
    productCount: parsed.products.length,
  };
}

// ---------------- Local source ----------------

/** Content check (magic bytes) for each local file; declared type/size are checked by the matcher. */
export async function localImageContentProblems(files: File[]) {
  return Promise.all(files.map((file) => validateSourceImage(file)));
}

/** Per file: declared type/size problem, else the content problem, else null. */
export function localFileProblems(files: LocalFile[], contentProblems: (string | null)[] = []) {
  return localImageSources(files).map((source, index) => source.invalidReason ?? contentProblems[index] ?? null);
}

function localImages(review: BulkImageReview, files: LocalFile[], sources: { invalidReason?: string | null }[], options: LocalFileOptions) {
  return files.map((file, index): BulkImage => {
    const invalidReason = sources[index].invalidReason ?? null;
    return {
      id: `local:${review.nextLocalId + index}`,
      label: file.name,
      previewUrl: invalidReason ? null : (options.previewUrls?.[index] ?? null),
      sourceUrl: null,
      ...(typeof Blob !== "undefined" && (file as unknown) instanceof Blob ? { file: file as unknown as Blob } : {}),
      sourcePosition: review.nextLocalId + index,
      invalidReason,
    };
  });
}

const activeLocalSetFor = (review: BulkImageReview, productId: string, exceptSetId?: string) =>
  review.sets.find((set) => {
    const decision = review.decisions[set.setId];
    return set.sourceKind === "local" && set.setId !== exceptSetId && decision.productId === productId && !decision.dismissed;
  });

/** Adds images to a product's local set (created when missing). Never touches its existing primary. */
function addToLocalSet(
  review: BulkImageReview,
  productId: string,
  images: BulkImage[],
  match: ImageMatchRow,
  confirmed: boolean,
  catalog: CatalogImageProduct[],
): BulkImageReview {
  const existing = activeLocalSetFor(review, productId);
  const valid = images.filter(isValidImage).map((image) => image.id);
  if (existing) {
    const decision = review.decisions[existing.setId];
    return {
      ...review,
      sets: review.sets.map((set) => (set.setId === existing.setId ? { ...set, images: [...set.images, ...images] } : set)),
      decisions: {
        ...review.decisions,
        [existing.setId]: {
          ...decision,
          confirmed: decision.confirmed && confirmed,
          selectedImageIds: [...decision.selectedImageIds, ...valid],
          primaryImageId: decision.primaryImageId ?? valid[0] ?? null,
        },
      },
    };
  }
  const setId = `local-set:${images[0].id}`;
  const set: BulkImageSet = { setId, sourceKind: "local", title: images[0].label, handle: null, shopifyStatus: null, match: { ...match, sourceId: setId }, images };
  const product = productIn(catalog, productId);
  return {
    ...review,
    sets: [...review.sets, set],
    decisions: {
      ...review.decisions,
      [setId]: {
        productId,
        confirmed,
        included: confirmed && !product?.hasPrimary,
        dismissed: null,
        existingMode: "skip",
        selectedImageIds: valid,
        primaryImageId: valid[0] ?? null,
      },
    },
  };
}

/**
 * Global "Local Images" source: every file is matched by filename (Step 1 matcher); files
 * that target the same product join ONE local set. Unmatched / multiple / invalid files
 * stay as single-file sets for the Owner to assign or ignore.
 */
export function addLocalFiles(review: BulkImageReview, files: LocalFile[], catalog: CatalogImageProduct[], options: LocalFileOptions = {}): BulkImageReview {
  const sources = localImageSources(files).map((source, index) => ({
    ...source,
    invalidReason: source.invalidReason ?? options.contentProblems?.[index] ?? null,
  }));
  const images = localImages(review, files, sources, options);
  let next: BulkImageReview = { ...review, nextLocalId: review.nextLocalId + files.length };
  // Each file is matched on its own: several files for one product are one set, not a conflict.
  const matches = sources.map((source) => matchImageSources([source], catalog)[0]);
  const groups = new Map<string, number[]>();
  matches.forEach((match, index) => {
    if (match.productId && (match.status === "matched" || match.status === "review"))
      groups.set(match.productId, [...(groups.get(match.productId) ?? []), index]);
  });
  for (const [productId, indexes] of groups) {
    const allExact = indexes.every((index) => matches[index].status === "matched");
    const first = matches[indexes[0]];
    const match: ImageMatchRow = {
      ...first,
      status: allExact ? "matched" : "review",
      reason: allExact ? first.reason : "Suggested from filename — confirm before upload.",
    };
    next = addToLocalSet(next, productId, indexes.map((index) => images[index]), match, allExact, catalog);
  }
  // A batch where nothing auto-matched is a manual replacement: its valid, unmatched files stay together
  // as ONE local set (all File objects kept) that the Owner assigns to a product in one step.
  const unmatchedValid = matches.flatMap((match, index) => (match.status === "unmatched" && !sources[index].invalidReason ? [index] : []));
  const noAutoMatch = matches.every((match) => match.status === "unmatched" || match.status === "invalid" || match.status === "multiple");
  const grouped = new Set<number>();
  if (noAutoMatch && unmatchedValid.length >= 2 && unmatchedValid.length <= MAX_MANUAL_BATCH) {
    const setId = `local-set:${images[unmatchedValid[0]].id}`;
    const set: BulkImageSet = {
      setId,
      sourceKind: "local",
      title: files[unmatchedValid[0]].name,
      handle: null,
      shopifyStatus: null,
      match: { ...matches[unmatchedValid[0]], sourceId: setId },
      images: unmatchedValid.map((index) => images[index]),
    };
    next = { ...next, sets: [...next.sets, set], decisions: { ...next.decisions, [setId]: defaultDecision(set, catalog) } };
    unmatchedValid.forEach((index) => grouped.add(index));
  }
  matches.forEach((match, index) => {
    if (grouped.has(index)) return;
    if (match.productId && (match.status === "matched" || match.status === "review")) return;
    const setId = `local-set:${images[index].id}`;
    const set: BulkImageSet = { setId, sourceKind: "local", title: files[index].name, handle: null, shopifyStatus: null, match: { ...match, sourceId: setId }, images: [images[index]] };
    next = { ...next, sets: [...next.sets, set], decisions: { ...next.decisions, [setId]: defaultDecision(set, catalog) } };
  });
  return next;
}

/**
 * "Missing Images": the Owner uploads local files for one chosen product. Valid files join
 * that product's local set (one primary, the rest gallery); invalid files are rejected.
 */
export function attachLocalImages(
  review: BulkImageReview,
  productId: string,
  files: LocalFile[],
  catalog: CatalogImageProduct[],
  options: LocalFileOptions = {},
) {
  const product = productIn(catalog, productId);
  if (!product || files.length === 0) return { review, rejected: [] as { name: string; reason: string }[] };
  const sources = localImageSources(files).map((source, index) => ({
    ...source,
    invalidReason: source.invalidReason ?? options.contentProblems?.[index] ?? null,
  }));
  const images = localImages(review, files, sources, options);
  const accepted = images.filter(isValidImage);
  const rejected = images.filter((image) => !isValidImage(image)).map((image) => ({ name: image.label, reason: image.invalidReason! }));
  let next: BulkImageReview = { ...review, nextLocalId: review.nextLocalId + files.length };
  if (accepted.length) {
    const match: ImageMatchRow = {
      sourceId: "",
      label: accepted[0].label,
      status: "unmatched",
      detectedBrand: product.brand,
      detectedModel: "",
      productId: null,
      candidateProductIds: [],
      productHasPrimary: product.hasPrimary,
      defaultSelected: false,
      reason: "Images uploaded by the Owner for this product.",
    };
    next = addToLocalSet(next, product.id, accepted, match, true, catalog);
    const set = activeLocalSetFor(next, product.id)!;
    next = withDecision(next, set.setId, { confirmed: true, included: !product.hasPrimary || next.decisions[set.setId].existingMode !== "skip" });
  }
  return { review: next, rejected };
}

/** Removes one local image (Shopify images can only be deselected). An emptied local set is removed. */
export function removeLocalImage(review: BulkImageReview, setId: string, imageId: string): BulkImageReview {
  const set = review.sets.find((entry) => entry.setId === setId);
  if (!set || set.sourceKind !== "local") return review;
  const images = set.images.filter((image) => image.id !== imageId);
  if (images.length === set.images.length) return review;
  if (images.length === 0) return clearLocalSet(review, setId);
  const decision = review.decisions[setId];
  const selectedImageIds = decision.selectedImageIds.filter((id) => id !== imageId);
  const primaryImageId = decision.primaryImageId === imageId ? (selectedImageIds[0] ?? null) : decision.primaryImageId;
  return {
    ...review,
    sets: review.sets.map((entry) => (entry.setId === setId ? { ...entry, images, title: images[0].label } : entry)),
    decisions: { ...review.decisions, [setId]: { ...decision, selectedImageIds, primaryImageId } },
  };
}

/** Clears a local set completely (its images are dropped from the review). */
export function clearLocalSet(review: BulkImageReview, setId: string): BulkImageReview {
  const set = review.sets.find((entry) => entry.setId === setId);
  if (!set || set.sourceKind !== "local") return review;
  const decisions = { ...review.decisions };
  delete decisions[setId];
  return { ...review, sets: review.sets.filter((entry) => entry.setId !== setId), decisions };
}

/** Every preview URL still shown by the review (object URLs outside this list can be revoked). */
export function previewUrlsInReview(review: BulkImageReview) {
  return new Set(review.sets.flatMap((set) => set.images.map((image) => image.previewUrl).filter((url): url is string => Boolean(url))));
}

/** Object URLs for local previews: retainOnly() revokes those no longer shown; revokeAll() on reset/unmount. */
export function createPreviewUrlRegistry(
  api: { createObjectURL(blob: Blob): string; revokeObjectURL(url: string): void } = URL,
) {
  const urls = new Set<string>();
  return {
    create(blob: Blob) {
      const url = api.createObjectURL(blob);
      urls.add(url);
      return url;
    },
    retainOnly(keep: Set<string>) {
      const all = [...urls];
      urls.clear();
      for (const url of all) {
        if (keep.has(url)) urls.add(url);
        else api.revokeObjectURL(url);
      }
    },
    revokeAll() {
      for (const url of urls) api.revokeObjectURL(url);
      urls.clear();
    },
    get size() {
      return urls.size;
    },
  };
}

// ---------------- Owner decisions ----------------

const withDecision = (review: BulkImageReview, setId: string, change: Partial<BulkImageSetDecision>): BulkImageReview => ({
  ...review,
  decisions: { ...review.decisions, [setId]: { ...review.decisions[setId], ...change } },
});

const setOf = (review: BulkImageReview, setId: string) => review.sets.find((set) => set.setId === setId);
const setIsInvalid = (set: BulkImageSet) => set.match.status === "invalid" || !set.images.some(isValidImage);

/**
 * Owner assigns (or clears) the target product of a whole source set. A local set joins the
 * product's existing local set (same Owner files, no conflict); a Shopify set keeps all its
 * images and is re-checked against other source sets.
 */
export function assignProduct(review: BulkImageReview, setId: string, productId: string | null, catalog: CatalogImageProduct[]): BulkImageReview {
  const set = setOf(review, setId);
  if (!set || setIsInvalid(set)) return review;
  const product = productIn(catalog, productId);
  if (productId && !product) return review;
  if (product && set.sourceKind === "local") {
    const existing = activeLocalSetFor(review, product.id, setId);
    if (existing) {
      const decision = review.decisions[setId];
      const merged = addToLocalSet(clearLocalSet(review, setId), product.id, set.images, set.match, true, catalog);
      const target = review.decisions[existing.setId];
      // Keep the Owner's image choices from the moved set; the joined set's primary is unchanged.
      return withDecision(merged, existing.setId, {
        confirmed: true,
        selectedImageIds: [...target.selectedImageIds, ...decision.selectedImageIds],
        primaryImageId: target.primaryImageId ?? decision.primaryImageId,
      });
    }
  }
  // Re-confirming the SAME product (Confirm Match, Use This Source Set) keeps the Owner's Existing-image
  // choice; only a different product starts again from "skip".
  const current = review.decisions[setId];
  const existingMode: ExistingImageMode = product && current?.productId === product.id ? current.existingMode : "skip";
  return withDecision(review, setId, {
    productId: product?.id ?? null,
    confirmed: Boolean(product),
    included: Boolean(product && (!product.hasPrimary || existingMode !== "skip")),
    dismissed: null,
    existingMode,
  });
}

/** "Confirm Match" for a Review set: the suggested product is accepted as is. */
export function confirmMatch(review: BulkImageReview, setId: string, catalog: CatalogImageProduct[]) {
  const productId = review.decisions[setId]?.productId;
  return productId ? assignProduct(review, setId, productId, catalog) : review;
}

/**
 * Review sets whose current suggestion can be accepted in bulk. Only the matcher's EXISTING Review result qualifies:
 * status Review, exactly one candidate product that is still the set's target, a valid source, and no other active
 * source set targeting the same product (otherwise the set would already be a Conflict, or become one).
 */
export function eligibleReviewSetIds(review: BulkImageReview, catalog: CatalogImageProduct[]): string[] {
  const states = reviewSetStates(review, catalog);
  const targets = new Map<string, number>();
  for (const set of review.sets) {
    const decision = review.decisions[set.setId];
    if (isActive(set, decision)) targets.set(decision.productId!, (targets.get(decision.productId!) ?? 0) + 1);
  }
  return review.sets
    .filter((set) => {
      const decision = review.decisions[set.setId];
      const state = states.get(set.setId);
      return (
        state?.status === "review" &&
        set.match.status === "review" &&
        set.match.candidateProductIds.length === 1 &&
        Boolean(decision.productId) &&
        set.match.candidateProductIds[0] === decision.productId &&
        !decision.dismissed &&
        !decision.confirmed &&
        !setIsInvalid(set) &&
        Boolean(productIn(catalog, decision.productId)) &&
        targets.get(decision.productId!) === 1
      );
    })
    .map((set) => set.setId);
}

/**
 * "Confirm all review suggestions": accepts every eligible Review suggestion exactly as the per-row "Confirm Match" would.
 * Conflict, Multiple, Unmatched, Invalid and Not used sets are never touched; images, Primary and Existing-image
 * choices are kept, and a set that was already included stays included.
 */
export function confirmAllReviewSuggestions(review: BulkImageReview, catalog: CatalogImageProduct[]) {
  const reviewCount = [...reviewSetStates(review, catalog).values()].filter((state) => state.status === "review").length;
  const ids = eligibleReviewSetIds(review, catalog);
  let next = review;
  for (const setId of ids) {
    const wasIncluded = next.decisions[setId].included;
    next = confirmMatch(next, setId, catalog);
    if (wasIncluded && next.decisions[setId] && !next.decisions[setId].included) next = withDecision(next, setId, { included: true });
  }
  return { review: next, confirmed: ids.length, skipped: reviewCount - ids.length, confirmedSetIds: ids };
}

/** "Use This Source Set": keep ALL this set's images for its product; every competing source set becomes Not Used. */
export function chooseSourceSet(review: BulkImageReview, setId: string, catalog: CatalogImageProduct[]): BulkImageReview {
  const productId = review.decisions[setId]?.productId;
  if (!productId) return review;
  let next = assignProduct(review, setId, productId, catalog);
  for (const set of next.sets) {
    const decision = next.decisions[set.setId];
    if (set.setId !== setId && decision.productId === productId && !decision.dismissed)
      next = withDecision(next, set.setId, { dismissed: "not_used", included: false });
  }
  return next;
}

/** "Skip" an unmatched (or any) source set completely; restoreSet() undoes it. */
export function skipSet(review: BulkImageReview, setId: string): BulkImageReview {
  if (!review.decisions[setId]) return review;
  return withDecision(review, setId, { dismissed: "skipped", included: false });
}

export function restoreSet(review: BulkImageReview, setId: string): BulkImageReview {
  if (!review.decisions[setId]) return review;
  return withDecision(review, setId, { dismissed: null });
}

/** Include/exclude a set. Invalid sets and sets without a target product can never be included. */
export function setIncluded(review: BulkImageReview, setId: string, included: boolean): BulkImageReview {
  const set = setOf(review, setId);
  const decision = review.decisions[setId];
  if (!set || !decision) return review;
  if (included && (setIsInvalid(set) || !decision.productId)) return review;
  return withDecision(review, setId, included ? { included: true, dismissed: null } : { included: false });
}

/** A set can be bulk-included only when it is already fully resolved and would not be blocked for a skipped existing primary. */
function isEligibleForBulkInclude(set: BulkImageSet, decision: BulkImageSetDecision, state: BulkImageSetState | undefined, catalog: CatalogImageProduct[]) {
  if (!state || (state.status !== "matched" && state.status !== "confirmed") || !decision.confirmed || decision.dismissed || !decision.productId) return false;
  if (setIsInvalid(set) || !decision.selectedImageIds.length) return false;
  const product = catalog.find((entry) => entry.id === decision.productId);
  return Boolean(product) && (!product!.hasPrimary || decision.existingMode !== "skip");
}

/** "Select all eligible": includes only resolved Matched/Confirmed sets. Never confirms, resolves or changes anything else. */
export function selectAllEligible(review: BulkImageReview, catalog: CatalogImageProduct[]): BulkImageReview {
  const states = reviewSetStates(review, catalog);
  const decisions = { ...review.decisions };
  for (const set of review.sets)
    if (isEligibleForBulkInclude(set, decisions[set.setId], states.get(set.setId), catalog)) decisions[set.setId] = { ...decisions[set.setId], included: true };
  return { ...review, decisions };
}

/** "Deselect all": clears only the include flag; decisions, image selections, primaries and statuses stay. */
export function deselectAll(review: BulkImageReview): BulkImageReview {
  const decisions = { ...review.decisions };
  for (const set of review.sets) if (decisions[set.setId]?.included) decisions[set.setId] = { ...decisions[set.setId], included: false };
  return { ...review, decisions };
}

/** Why "Keep only this set" cannot apply to a set, or null when it can. */
export function keepOnlyBlockReason(review: BulkImageReview, setId: string): string | null {
  const set = setOf(review, setId);
  const decision = review.decisions[setId];
  if (!set || !decision) return "this set no longer exists.";
  if (decision.dismissed) return `this set is ${decision.dismissed === "not_used" ? "Not used" : "Skipped"} — restore it first.`;
  if (setIsInvalid(set)) return "this set has no valid image.";
  if (!decision.productId) return "choose a product for this set first.";
  return null;
}

/**
 * "Keep only this set": every other set is un-included; the chosen set is included as it is
 * (images, Primary, Existing-image mode and status untouched). Refused sets, and a selection
 * that is already exactly this set, return the SAME review object (nothing changed).
 */
export function keepOnlySet(review: BulkImageReview, setId: string): BulkImageReview {
  if (keepOnlyBlockReason(review, setId)) return review;
  let changed = false;
  const decisions = { ...review.decisions };
  for (const other of review.sets) {
    const included = other.setId === setId;
    if (decisions[other.setId].included !== included) {
      decisions[other.setId] = { ...decisions[other.setId], included };
      changed = true;
    }
  }
  return changed ? { ...review, decisions } : review;
}

/** Existing-primary products: "skip" (default), "add" (gallery only) or "add_make_primary" — explicit Owner choice only. */
export function setExistingMode(review: BulkImageReview, setId: string, mode: ExistingImageMode): BulkImageReview {
  if (!review.decisions[setId]?.productId) return review;
  return withDecision(review, setId, { existingMode: mode, included: mode !== "skip", ...(mode !== "skip" ? { dismissed: null } : {}) });
}

/** Select / deselect one gallery image. The primary image cannot be deselected (choose another primary first). */
export function setImageSelected(review: BulkImageReview, setId: string, imageId: string, selected: boolean): BulkImageReview {
  const set = setOf(review, setId);
  const decision = review.decisions[setId];
  const image = set?.images.find((entry) => entry.id === imageId);
  if (!set || !decision || !image) return review;
  if (selected) {
    if (!isValidImage(image) || decision.selectedImageIds.includes(imageId)) return review;
    const order = set.images.map((entry) => entry.id);
    const selectedImageIds = [...decision.selectedImageIds, imageId].sort((a, b) => order.indexOf(a) - order.indexOf(b));
    return withDecision(review, setId, { selectedImageIds, primaryImageId: decision.primaryImageId ?? imageId });
  }
  if (decision.primaryImageId === imageId) return review;
  return withDecision(review, setId, { selectedImageIds: decision.selectedImageIds.filter((id) => id !== imageId) });
}

/** Choose the primary image of a set. Only the primary flag moves; every other selected image stays as gallery. */
export function setPrimaryImage(review: BulkImageReview, setId: string, imageId: string): BulkImageReview {
  const set = setOf(review, setId);
  const decision = review.decisions[setId];
  const image = set?.images.find((entry) => entry.id === imageId);
  if (!set || !decision || !image || !isValidImage(image)) return review;
  const selectedImageIds = decision.selectedImageIds.includes(imageId) ? decision.selectedImageIds : [...decision.selectedImageIds, imageId];
  return withDecision(review, setId, { primaryImageId: imageId, selectedImageIds });
}

// ---------------- Derived state ----------------

const isActive = (set: BulkImageSet, decision: BulkImageSetDecision | undefined) =>
  Boolean(decision?.productId) && !decision!.dismissed && !setIsInvalid(set);

/** Live status of every source set; conflicts = two or more ACTIVE source sets with the same target product. */
export function reviewSetStates(review: BulkImageReview, catalog: CatalogImageProduct[]) {
  const productById = new Map(catalog.map((product) => [product.id, product]));
  const claimers = new Map<string, string[]>();
  for (const set of review.sets) {
    const decision = review.decisions[set.setId];
    if (isActive(set, decision)) claimers.set(decision.productId!, [...(claimers.get(decision.productId!) ?? []), set.setId]);
  }
  const states = new Map<string, BulkImageSetState>();
  for (const set of review.sets) {
    const decision = review.decisions[set.setId];
    const invalid = setIsInvalid(set);
    const targetId = invalid ? null : (decision?.productId ?? null);
    const product = targetId ? productById.get(targetId) : undefined;
    const productHasPrimary = Boolean(product?.hasPrimary);
    let status: BulkImageSetStatus;
    let issue: string;
    if (invalid) [status, issue] = ["invalid", set.match.status === "invalid" ? set.match.reason : "No valid image in this source."];
    else if (decision.dismissed === "not_used") [status, issue] = ["not_used", "Not used — another source set was chosen for this product."];
    else if (decision.dismissed === "skipped") [status, issue] = ["skipped", "Skipped by Owner."];
    else if (!targetId) {
      status = set.match.status === "multiple" ? "multiple" : "unmatched";
      issue = set.match.status === "multiple" || set.match.status === "unmatched" ? set.match.reason : "No product assigned.";
    } else if ((claimers.get(targetId)?.length ?? 0) > 1) {
      status = "conflict";
      issue = `${claimers.get(targetId)!.length} source sets target ${product?.title ?? "this product"} — choose one set.`;
    } else if (decision.confirmed) {
      const unchanged = set.match.status === "matched" && targetId === set.match.productId;
      status = unchanged ? "matched" : "confirmed";
      issue = unchanged ? set.match.reason : "Confirmed by Owner.";
    } else {
      status = "review";
      issue = set.match.status === "review" ? set.match.reason : "Suggested product — confirm before use.";
    }
    if (productHasPrimary && targetId && !decision.dismissed)
      issue = `${issue} Product already has a primary image — skipped unless "Add images" or "Add and make primary" is chosen.`;
    states.set(set.setId, { status, targetId, productHasPrimary, issue });
  }
  return states;
}

export function summarizeReview(review: BulkImageReview, states: Map<string, BulkImageSetState>) {
  const values = [...states.values()];
  const count = (status: BulkImageSetStatus) => values.filter((state) => state.status === status).length;
  const included = review.sets.filter((set) => review.decisions[set.setId]?.included);
  return {
    loaded: review.sets.length,
    images: review.sets.reduce((total, set) => total + set.images.length, 0),
    matched: count("matched"),
    confirmed: count("confirmed"),
    review: count("review"),
    multiple: count("multiple"),
    conflict: count("conflict"),
    conflictProducts: new Set(values.filter((state) => state.status === "conflict").map((state) => state.targetId)).size,
    unmatched: count("unmatched"),
    invalid: count("invalid"),
    notUsed: count("not_used"),
    skipped: count("skipped"),
    included: included.length,
    includedImages: included.reduce((total, set) => total + review.decisions[set.setId].selectedImageIds.length, 0),
    existingImage: values.filter((state) => state.productHasPrimary && state.status !== "not_used" && state.status !== "skipped").length,
  };
}

export type CatalogCoverageStatus = "matched" | "confirmed" | "review" | "conflict" | "multiple" | "none";

function productSourceIndex(review: BulkImageReview, states: Map<string, BulkImageSetState>) {
  const claims = new Map<string, { set: BulkImageSet; state: BulkImageSetState }[]>();
  const multipleCandidates = new Set<string>();
  for (const set of review.sets) {
    const state = states.get(set.setId)!;
    if (state.targetId && !["not_used", "skipped", "invalid"].includes(state.status))
      claims.set(state.targetId, [...(claims.get(state.targetId) ?? []), { set, state }]);
    if (state.status === "multiple") set.match.candidateProductIds.forEach((id) => multipleCandidates.add(id));
  }
  return { claims, multipleCandidates };
}

/** Catalog perspective: what each catalog product has in this review. */
export function catalogCoverage(review: BulkImageReview, states: Map<string, BulkImageSetState>, catalog: CatalogImageProduct[]) {
  const { claims, multipleCandidates } = productSourceIndex(review, states);
  const products = catalog.map((product) => {
    const own = claims.get(product.id) ?? [];
    const status: CatalogCoverageStatus =
      own.length > 1 ? "conflict" : own.length === 1 ? (own[0].state.status as CatalogCoverageStatus) : multipleCandidates.has(product.id) ? "multiple" : "none";
    const selected = own.some(({ set }) => review.decisions[set.setId].included);
    return { productId: product.id, title: product.title, status, selected, hasPrimary: product.hasPrimary };
  });
  const count = (status: CatalogCoverageStatus) => products.filter((product) => product.status === status).length;
  const missing = products.filter((product) => product.status === "none" && !product.hasPrimary);
  return {
    total: catalog.length,
    withSource: products.filter((product) => product.status !== "none").length,
    selected: products.filter((product) => product.selected).length,
    missing: missing.length,
    existingPrimary: products.filter((product) => product.hasPrimary).length,
    needsManualAction: products.filter((product) => ["review", "conflict", "multiple"].includes(product.status)).length + missing.length,
    matched: count("matched"),
    confirmed: count("confirmed"),
    review: count("review"),
    conflict: count("conflict"),
    multiple: count("multiple"),
    none: count("none"),
    coverable: catalog.length - count("none"),
    withoutSource: products.filter((product) => product.status === "none"),
  };
}

/**
 * "Missing Images" (catalog perspective): products with no primary image and no usable
 * Shopify source set (and not a candidate of an unresolved Multiple). Their pending local
 * set, if the Owner uploaded images, is returned with them.
 */
export function missingImageProducts(
  review: BulkImageReview,
  states: Map<string, BulkImageSetState>,
  catalog: BulkImageCatalogProduct[],
  query = "",
) {
  const { claims, multipleCandidates } = productSourceIndex(review, states);
  const needle = query.trim().toLowerCase();
  return catalog
    .filter((product) => !product.hasPrimary && !multipleCandidates.has(product.id))
    .filter((product) => !(claims.get(product.id) ?? []).some(({ set }) => set.sourceKind === "shopify"))
    .filter((product) => !needle || [product.title, product.brand, product.slug].some((value) => value?.toLowerCase().includes(needle)))
    .sort((a, b) => a.title.localeCompare(b.title))
    .map((product) => ({ product, localSetId: activeLocalSetFor(review, product.id)?.setId ?? null }));
}

export type BulkImageFilter = "relevant" | "all" | "matched" | "review" | "multiple" | "conflict" | "unmatched" | "invalid" | "existing";

const STATUS_ORDER: BulkImageSetStatus[] = ["conflict", "multiple", "review", "confirmed", "matched", "unmatched", "not_used", "skipped", "invalid"];

/**
 * Source sets for the table. "relevant" (default) hides Shopify sets that touch no catalog product.
 * Search covers title, handle, detected brand/model and the target product's title, brand and slug.
 */
export function filterReviewSets(
  review: BulkImageReview,
  states: Map<string, BulkImageSetState>,
  catalog: BulkImageCatalogProduct[],
  filter: BulkImageFilter,
  query = "",
) {
  const productById = new Map(catalog.map((product) => [product.id, product]));
  const needle = query.trim().toLowerCase();
  const passes = (set: BulkImageSet) => {
    const state = states.get(set.setId)!;
    switch (filter) {
      case "all":
        return true;
      case "relevant":
        return set.sourceKind === "local" || Boolean(state.targetId) || state.status === "multiple" || set.match.candidateProductIds.length > 0;
      case "matched":
        return state.status === "matched" || state.status === "confirmed";
      case "unmatched":
        return state.status === "unmatched" || state.status === "skipped";
      case "existing":
        return state.productHasPrimary;
      default:
        return state.status === filter;
    }
  };
  const searchable = (set: BulkImageSet) => {
    if (!needle) return true;
    const product = productById.get(states.get(set.setId)!.targetId ?? "");
    const fileNames = set.sourceKind === "local" ? set.images.map((image) => image.label) : [];
    return [set.title, set.handle, set.match.detectedBrand, set.match.detectedModel, product?.title, product?.brand, product?.slug, ...fileNames].some((value) =>
      value?.toLowerCase().includes(needle),
    );
  };
  const titleOf = (set: BulkImageSet) => productById.get(states.get(set.setId)!.targetId ?? "")?.title ?? "";
  return review.sets
    .filter((set) => passes(set) && searchable(set))
    .sort(
      (a, b) =>
        Number(b.sourceKind === "local") - Number(a.sourceKind === "local") ||
        STATUS_ORDER.indexOf(states.get(a.setId)!.status) - STATUS_ORDER.indexOf(states.get(b.setId)!.status) ||
        titleOf(a).localeCompare(titleOf(b)) ||
        a.title.localeCompare(b.title),
    );
}

/** Product picker search over title, brand and slug (case-insensitive substring). */
export function searchCatalogProducts(catalog: BulkImageCatalogProduct[], query: string, limit = 8) {
  const needle = query.trim().toLowerCase();
  const results = needle
    ? catalog.filter((product) => [product.title, product.brand, product.slug].some((value) => value?.toLowerCase().includes(needle)))
    : catalog;
  return [...results].sort((a, b) => a.title.localeCompare(b.title)).slice(0, limit);
}

// ---------------- Insert plan + validation before a future Apply ----------------

export type PlannedImageInsert = {
  imageId: string;
  label: string;
  sortOrder: number;
  isPrimary: boolean;
  /** Insert as gallery, then switch via set_product_media_primary (old media is kept). */
  makePrimaryAfterInsert: boolean;
};

/**
 * The future product_media inserts for one set (nothing is executed here):
 * - product without primary → selected primary first (is_primary), then gallery;
 * - existing primary + "add" → gallery only, existing primary unchanged;
 * - existing primary + "add_make_primary" → all inserted as gallery, the chosen one is then made primary.
 * Sort orders continue after the product's existing media; nothing is deleted.
 */
export function planImageSet(set: BulkImageSet, decision: BulkImageSetDecision, product: BulkImageCatalogProduct): PlannedImageInsert[] {
  const selected = set.images.filter((image) => isValidImage(image) && decision.selectedImageIds.includes(image.id));
  if (selected.length === 0) return [];
  const existing = { count: product.mediaCount, hasPrimary: product.hasPrimary };
  if (product.hasPrimary && decision.existingMode === "skip") return [];
  if (product.hasPrimary && decision.existingMode === "add")
    return selected.map((image, index) => ({ imageId: image.id, label: image.label, sortOrder: existing.count + index, isPrimary: false, makePrimaryAfterInsert: false }));
  const primary = selected.find((image) => image.id === decision.primaryImageId);
  if (!primary) return [];
  const first = planPrimaryAssignment(existing, product.hasPrimary ? "make_primary" : "primary");
  if (first.action !== "insert") return [];
  const gallery = selected.filter((image) => image.id !== primary.id);
  return [
    { imageId: primary.id, label: primary.label, sortOrder: first.sortOrder, isPrimary: first.isPrimary, makePrimaryAfterInsert: first.makePrimaryAfterInsert },
    ...gallery.map((image, index) => ({ imageId: image.id, label: image.label, sortOrder: first.sortOrder + index + 1, isPrimary: false, makePrimaryAfterInsert: false })),
  ];
}

export function validateBulkImageSelection(review: BulkImageReview, catalog: BulkImageCatalogProduct[], environment: ReferenceCatalogEnvironment) {
  const states = reviewSetStates(review, catalog);
  const productById = new Map(catalog.map((product) => [product.id, product]));
  const included = review.sets.filter((set) => review.decisions[set.setId]?.included);
  const blockers: string[] = [];
  const targets = new Map<string, number>();
  for (const set of included) {
    const target = states.get(set.setId)!.targetId;
    if (target) targets.set(target, (targets.get(target) ?? 0) + 1);
  }

  let ready = 0;
  let needsReview = 0;
  let conflicts = 0;
  let existingImages = 0;
  const plans: { setId: string; productId: string; title: string; inserts: PlannedImageInsert[] }[] = [];
  for (const set of included) {
    const state = states.get(set.setId)!;
    const decision = review.decisions[set.setId];
    const product = state.targetId ? productById.get(state.targetId) : undefined;
    const selected = set.images.filter((image) => decision.selectedImageIds.includes(image.id));
    const problems: string[] = [];
    if (setIsInvalid(set)) problems.push("source is not valid");
    if (selected.some((image) => !isValidImage(image))) problems.push("an invalid image is selected");
    if (!product) problems.push("choose exactly one product");
    if (product && (state.status === "conflict" || (targets.get(product.id) ?? 0) > 1)) {
      conflicts += 1;
      problems.push(`another source set also targets ${product.title} — choose one set`);
    } else if (product && !decision.confirmed) {
      needsReview += 1;
      problems.push("confirm the product match");
    }
    if (selected.length === 0) problems.push("select at least one image");
    if (product?.hasPrimary) {
      existingImages += 1;
      if (decision.existingMode === "skip") problems.push('product already has a primary image — choose "Add images" or "Add and make primary", or untick');
    }
    const needsPrimary = product && (!product.hasPrimary || decision.existingMode === "add_make_primary");
    if (needsPrimary && selected.length && !selected.some((image) => image.id === decision.primaryImageId)) problems.push("mark exactly one selected image as Primary");
    if (problems.length) blockers.push(`${set.title}: ${problems.join("; ")}.`);
    else {
      ready += 1;
      plans.push({ setId: set.setId, productId: product!.id, title: product!.title, inserts: planImageSet(set, decision, product!) });
    }
  }
  if (included.length === 0) blockers.unshift("Select at least one image set.");
  if (!environment.known) blockers.unshift("Reference catalog environment is UNKNOWN — Apply is blocked.");
  const readyForApply = blockers.length === 0 && plans.length > 0;
  return {
    selectedProducts: targets.size,
    selectedSets: included.length,
    selectedImages: included.reduce((total, set) => total + review.decisions[set.setId].selectedImageIds.length, 0),
    ready,
    needsReview,
    conflicts,
    existingImages,
    blockers,
    plans,
    readyForApply,
    applyEnabled: readyForApply && BULK_IMAGE_APPLY_ENABLED,
    applyDisabledReason: BULK_IMAGE_APPLY_ENABLED ? null : BULK_IMAGE_APPLY_DISABLED_REASON,
  };
}
