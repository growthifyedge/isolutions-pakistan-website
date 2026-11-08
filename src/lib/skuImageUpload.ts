/**
 * Bulk Image Upload by SKU — matches image files named by SKU ("GD032-01.jpg") to existing products and uploads
 * them through the shared Phase 3B flow (Admin-only signature → Cloudinary → product_media insert).
 *
 * Safety (all enforced here, the UI only displays it):
 * - Only the exact DEVELOPMENT or PRODUCTION build/project pair can write (resolveUploadTarget). PRODUCTION also
 *   needs a SKU range guard, so a batch can never reach products outside the range the Owner typed.
 * - Never deletes, replaces, re-orders or re-assigns existing media, never touches colour links, never publishes.
 *   New images are appended after the existing ones. The first image becomes Primary only when the product has none.
 * - The product's media is re-read right before its first write and must equal the preview snapshot exactly.
 * - Retry is driven by recorded results, checked against the database: an image counts as uploaded only when its
 *   product_media row (by id or Cloudinary public_id) is present in a fresh read; an image whose Cloudinary upload
 *   succeeded but whose row was not saved is completed by inserting that stored Cloudinary result, never re-uploaded.
 * - Each product is read back once after its writes and verified.
 * Network, database and storage access are injected, so everything here is testable offline.
 */
import {
  cloudinaryFolderProblem,
  cloudinaryPublicIdProblem,
  resolveUploadTarget,
  type BulkMediaRow,
  type UploadEnvironmentName,
  type UploadTarget,
} from "./bulkImageUpload.ts";
import { MAX_SOURCE_IMAGE_BYTES } from "./cloudinary.ts";
import { productMediaPayload, type ProductMediaInsert } from "./productMediaPayload.ts";
import type { UploadSignature } from "./productMediaUpload.ts";

export const SKU_IMAGE_ACCEPT = ".jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp";
export const SKU_IMAGE_MIN_SIDE = 300;
export const SKU_IMAGE_LOW_SIDE = 600;
export const SKU_UPLOAD_CONCURRENCY = 3;

export type SkuImageFormat = "jpeg" | "png" | "webp";

/** One selected file after reading (hash / format / size are filled by the browser reader). */
export type SkuImageFile = {
  index: number;
  name: string;
  /** Folder or ZIP path, for the report only. */
  path: string;
  size: number;
  file: Blob | null;
  sha256: string | null;
  format: SkuImageFormat | null;
  width: number | null;
  height: number | null;
  /** Unreadable / not an image / wrong content. */
  readError: string | null;
};

export type SkuCatalogProduct = {
  id: string;
  title: string;
  category: string | null;
  publicationStatus: string | null;
  skus: string[];
  media: BulkMediaRow[];
};

export type SkuRange = { prefix: string; from: number; to: number; width: number; label: string };

// ---------------- filenames, SKUs and ranges ----------------

const SKU_FILE = /^([A-Za-z]{2,4})(\d{3,6})(?:[-_ ]+(\d{1,3}))?\.(jpe?g|png|webp)$/i;

/** "GD032-01.jpg" → { sku: "GD032", number: 1 }. "GD032.jpg" is image 1. Anything else → null. */
export function parseSkuFileName(name: string): { sku: string; number: number } | null {
  const base = name.split(/[\\/]/).pop()!.trim();
  const match = SKU_FILE.exec(base);
  if (!match) return null;
  const number = match[3] === undefined ? 1 : Number(match[3]);
  if (!Number.isInteger(number) || number < 1) return null;
  return { sku: `${match[1].toUpperCase()}${match[2]}`, number };
}

const SKU_PARTS = /^([A-Za-z]{2,4})(\d{3,6})$/;

/** "GD032" – "GD223" → a range; both ends need the same prefix and digit count. */
export function parseSkuRange(fromText: string, toText: string): { range: SkuRange | null; error: string | null } {
  const from = SKU_PARTS.exec(fromText.trim());
  const to = SKU_PARTS.exec(toText.trim());
  if (!fromText.trim() && !toText.trim()) return { range: null, error: null };
  if (!from || !to) return { range: null, error: 'Enter both ends of the SKU range, e.g. "GD032" and "GD223".' };
  if (from[1].toUpperCase() !== to[1].toUpperCase() || from[2].length !== to[2].length)
    return { range: null, error: "Both ends of the SKU range must use the same prefix and number of digits." };
  const a = Number(from[2]);
  const b = Number(to[2]);
  if (a > b) return { range: null, error: "The first SKU of the range must not be higher than the last." };
  const prefix = from[1].toUpperCase();
  return { range: { prefix, from: a, to: b, width: from[2].length, label: `${prefix}${from[2]}–${prefix}${to[2]}` }, error: null };
}

export function skuInRange(sku: string, range: SkuRange) {
  const parts = SKU_PARTS.exec(sku);
  if (!parts || parts[1].toUpperCase() !== range.prefix || parts[2].length !== range.width) return false;
  const value = Number(parts[2]);
  return value >= range.from && value <= range.to;
}

/** Real content type from the first bytes (the extension is not trusted). */
export function sniffImageFormat(bytes: Uint8Array): SkuImageFormat | null {
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "jpeg";
  if ([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((value, index) => bytes[index] === value)) return "png";
  const text = (from: number, to: number) => String.fromCharCode(...bytes.slice(from, to));
  if (text(0, 4) === "RIFF" && text(8, 12) === "WEBP") return "webp";
  return null;
}

// ---------------- retry ledger ----------------

/** Stored Cloudinary upload result: enough to save the product_media row without uploading again. */
export type StoredCloudinaryResult = Record<string, unknown> & { public_id: string };
const STORED_FIELDS = ["public_id", "asset_id", "version", "secure_url", "width", "height", "bytes", "format"] as const;
const storedResult = (response: Record<string, unknown>) =>
  Object.fromEntries(STORED_FIELDS.filter((field) => field in response).map((field) => [field, response[field]])) as StoredCloudinaryResult;

export type SkuLedgerEntry = {
  productId: string;
  sha256: string;
  fileName: string;
  /** Present once Cloudinary accepted the file. */
  cloudinary: StoredCloudinaryResult | null;
  /** Present once the product_media row was saved. */
  mediaId: string | null;
};

export type SkuLedger = Record<string, SkuLedgerEntry>;
export const ledgerKey = (environment: UploadEnvironmentName, productId: string, sha256: string) => `${environment}|${productId}|${sha256}`;

// ---------------- preview ----------------

export type SkuPreviewImageState =
  /** upload to Cloudinary, then save the row */
  | "new"
  /** Cloudinary already has it (recorded), only the row is saved */
  | "save_only"
  /** row confirmed in the database: nothing to do */
  | "already_uploaded";

export type SkuPreviewImage = {
  fileIndex: number;
  name: string;
  sku: string;
  number: number;
  sha256: string;
  width: number;
  height: number;
  format: SkuImageFormat;
  state: SkuPreviewImageState;
  role: "primary" | "gallery";
  sortOrder: number;
  warning: string | null;
  /** media id when already uploaded */
  mediaId: string | null;
};

export type SkuPreviewProductStatus = "ready" | "done" | "skipped" | "blocked";

export type SkuPreviewProduct = {
  productId: string;
  title: string;
  category: string | null;
  publicationStatus: string | null;
  skus: string[];
  existingCount: number;
  /** Rows that were not created by this upload tool (recorded results). */
  foreignCount: number;
  hasPrimary: boolean;
  status: SkuPreviewProductStatus;
  reason: string | null;
  images: SkuPreviewImage[];
  /** What the pre-write re-check must find (ids, primary, order). */
  snapshot: BulkMediaRow[];
};

export type SkuPreviewIssue = { fileIndex: number; name: string; path: string; sku: string | null; reason: string };

export type SkuPreview = {
  products: SkuPreviewProduct[];
  unmatched: SkuPreviewIssue[];
  duplicates: SkuPreviewIssue[];
  errors: SkuPreviewIssue[];
  rangeError: string | null;
  totals: { files: number; products: number; readyProducts: number; imagesToUpload: number; newPrimaries: number; alreadyUploaded: number; skippedProducts: number; blockedProducts: number };
};

export type SkuPreviewOptions = {
  environment: UploadEnvironmentName | null;
  range: SkuRange | null;
  rangeError?: string | null;
  /** Off by default: products that already have images (not from this tool) are skipped. */
  addToProductsWithImages: boolean;
  ledger: SkuLedger;
};

export function buildSkuPreview(files: SkuImageFile[], catalog: SkuCatalogProduct[], options: SkuPreviewOptions): SkuPreview {
  const unmatched: SkuPreviewIssue[] = [];
  const duplicates: SkuPreviewIssue[] = [];
  const errors: SkuPreviewIssue[] = [];
  const issue = (file: SkuImageFile, sku: string | null, reason: string): SkuPreviewIssue => ({ fileIndex: file.index, name: file.name, path: file.path, sku, reason });

  const productBySku = new Map<string, SkuCatalogProduct[]>();
  for (const product of catalog)
    for (const sku of product.skus) {
      const key = sku.trim().toUpperCase();
      productBySku.set(key, [...(productBySku.get(key) ?? []), product]);
    }

  type Candidate = { file: SkuImageFile; sku: string; number: number; product: SkuCatalogProduct; warning: string | null };
  const candidates: Candidate[] = [];
  const productionNeedsRange = options.environment === "production" && !options.range;
  for (const file of files) {
    const parsed = parseSkuFileName(file.name);
    if (!parsed) {
      unmatched.push(issue(file, null, 'The filename is not "<SKU>-<number>.jpg/.png/.webp" (e.g. GD032-01.jpg).'));
      continue;
    }
    if (options.range && !skuInRange(parsed.sku, options.range)) {
      unmatched.push(issue(file, parsed.sku, `${parsed.sku} is outside the SKU range ${options.range.label}.`));
      continue;
    }
    const products = productBySku.get(parsed.sku) ?? [];
    if (products.length === 0) {
      unmatched.push(issue(file, parsed.sku, `No product has SKU ${parsed.sku}.`));
      continue;
    }
    if (products.length > 1) {
      errors.push(issue(file, parsed.sku, `SKU ${parsed.sku} belongs to more than one product.`));
      continue;
    }
    if (file.readError) {
      errors.push(issue(file, parsed.sku, file.readError));
      continue;
    }
    if (!file.sha256 || !file.format || !file.width || !file.height) {
      errors.push(issue(file, parsed.sku, "The image could not be read."));
      continue;
    }
    if (file.size <= 0 || file.size > MAX_SOURCE_IMAGE_BYTES) {
      errors.push(issue(file, parsed.sku, "The image must be between 1 byte and 25 MB."));
      continue;
    }
    const side = Math.min(file.width, file.height);
    if (side < SKU_IMAGE_MIN_SIDE) {
      errors.push(issue(file, parsed.sku, `Too small (${file.width}×${file.height}); at least ${SKU_IMAGE_MIN_SIDE} px on the short side is required.`));
      continue;
    }
    const ext = file.name.toLowerCase().split(".").pop();
    const declared = ext === "jpg" || ext === "jpeg" ? "jpeg" : ext;
    const warnings = [
      side < SKU_IMAGE_LOW_SIDE ? `Low resolution (${file.width}×${file.height})` : null,
      declared !== file.format ? `The file is really ${file.format.toUpperCase()} (extension .${ext})` : null,
    ].filter(Boolean);
    candidates.push({ file, sku: parsed.sku, number: parsed.number, product: products[0], warning: warnings.length ? warnings.join("; ") : null });
  }

  // Same picture on two different products: never decided silently — both files are held back.
  const productsBySha = new Map<string, Set<string>>();
  for (const candidate of candidates) productsBySha.set(candidate.file.sha256!, new Set([...(productsBySha.get(candidate.file.sha256!) ?? []), candidate.product.id]));
  const crossProduct = candidates.filter((candidate) => productsBySha.get(candidate.file.sha256!)!.size > 1);
  for (const candidate of crossProduct) {
    const others = catalog.filter((product) => productsBySha.get(candidate.file.sha256!)!.has(product.id) && product.id !== candidate.product.id).map((product) => product.skus[0] ?? product.title);
    duplicates.push(issue(candidate.file, candidate.sku, `The same image is also named for ${others.join(", ")}; rename or remove one copy.`));
  }
  const usable = candidates.filter((candidate) => !crossProduct.includes(candidate));

  const byProduct = new Map<string, Candidate[]>();
  for (const candidate of usable) byProduct.set(candidate.product.id, [...(byProduct.get(candidate.product.id) ?? []), candidate]);

  const products: SkuPreviewProduct[] = [];
  for (const [productId, list] of byProduct) {
    const product = list[0].product;
    const snapshot = [...product.media].sort((a, b) => a.sort_order - b.sort_order);
    const sorted = [...list].sort((a, b) => a.number - b.number || a.sku.localeCompare(b.sku) || a.file.name.localeCompare(b.file.name));
    const kept: Candidate[] = [];
    const seenSha = new Map<string, Candidate>();
    let numberConflict: string | null = null;
    for (const candidate of sorted) {
      const earlier = seenSha.get(candidate.file.sha256!);
      if (earlier) {
        duplicates.push(issue(candidate.file, candidate.sku, `Same image as ${earlier.file.name}; this copy is skipped.`));
        continue;
      }
      seenSha.set(candidate.file.sha256!, candidate);
      const sameNumber = kept.find((other) => other.number === candidate.number);
      if (sameNumber) numberConflict = `${sameNumber.file.name} and ${candidate.file.name} both use image number ${candidate.number}.`;
      kept.push(candidate);
    }

    // Recorded results confirmed against the database.
    const rowsById = new Map(snapshot.map((row) => [row.id, row]));
    const rowsByPublicId = new Map(snapshot.map((row) => [row.cloudinary_public_id, row]));
    const ownRowIds = new Set<string>();
    const resolved = kept.map((candidate) => {
      const entry = options.environment ? options.ledger[ledgerKey(options.environment, productId, candidate.file.sha256!)] : undefined;
      const row = (entry?.mediaId && rowsById.get(entry.mediaId)) || (entry?.cloudinary && rowsByPublicId.get(entry.cloudinary.public_id)) || null;
      if (row) ownRowIds.add(row.id);
      // A recorded row that is gone was removed on purpose (the Media tab's Delete also removes the Cloudinary asset):
      // upload again. Only an upload whose row was never saved is completed from the recorded Cloudinary result.
      const state: SkuPreviewImageState = row ? "already_uploaded" : entry?.cloudinary && !entry.mediaId ? "save_only" : "new";
      return { candidate, state, mediaId: row?.id ?? null };
    });
    const foreignCount = snapshot.filter((row) => !ownRowIds.has(row.id)).length;
    const hasPrimary = snapshot.some((row) => row.is_primary);
    const pending = resolved.filter((entry) => entry.state !== "already_uploaded");
    // Image n of this set belongs at slot (last foreign image + n). A retried image takes its intended slot when it is
    // still free (so the order stays 01, 02, 03 …); an occupied slot is never shared — it is appended at the end instead.
    const foreignMax = snapshot.filter((row) => !ownRowIds.has(row.id)).reduce((max, row) => Math.max(max, row.sort_order), -1);
    const occupied = new Set(snapshot.map((row) => row.sort_order));
    let append = snapshot.reduce((max, row) => Math.max(max, row.sort_order), -1) + 1;
    const slots = resolved.map((entry, index) => {
      if (entry.state === "already_uploaded") return rowsById.get(entry.mediaId!)!.sort_order;
      const intended = foreignMax + 1 + index;
      const slot = occupied.has(intended) ? append : intended;
      occupied.add(slot);
      append = Math.max(append, slot + 1);
      return slot;
    });
    let primaryGiven = hasPrimary;
    const images: SkuPreviewImage[] = resolved.map(({ candidate, state, mediaId }, index) => {
      const role: SkuPreviewImage["role"] = state === "already_uploaded" ? (rowsById.get(mediaId!)?.is_primary ? "primary" : "gallery") : primaryGiven ? "gallery" : "primary";
      if (state !== "already_uploaded") primaryGiven = true;
      return {
        fileIndex: candidate.file.index,
        name: candidate.file.name,
        sku: candidate.sku,
        number: candidate.number,
        sha256: candidate.file.sha256!,
        width: candidate.file.width!,
        height: candidate.file.height!,
        format: candidate.file.format!,
        state,
        role,
        sortOrder: slots[index],
        warning: candidate.warning,
        mediaId,
      };
    });

    let status: SkuPreviewProductStatus = "ready";
    let reason: string | null = null;
    if (productionNeedsRange) {
      status = "blocked";
      reason = "PRODUCTION uploads need a SKU range (e.g. GD032 – GD223).";
    } else if (numberConflict) {
      status = "blocked";
      reason = `Filename conflict: ${numberConflict} Rename one of them.`;
    } else if (pending.length === 0) {
      status = "done";
      reason = "All images are already uploaded (confirmed in the database).";
    } else if (foreignCount > 0 && !options.addToProductsWithImages) {
      status = "skipped";
      reason = `Already has ${foreignCount} image${foreignCount === 1 ? "" : "s"}. Tick "Add gallery images to products that already have images" to add these.`;
    }
    products.push({
      productId,
      title: product.title,
      category: product.category,
      publicationStatus: product.publicationStatus,
      skus: [...new Set(kept.map((candidate) => candidate.sku))].sort(),
      existingCount: snapshot.length,
      foreignCount,
      hasPrimary,
      status,
      reason,
      images,
      snapshot,
    });
  }
  products.sort((a, b) => (a.skus[0] ?? "").localeCompare(b.skus[0] ?? "") || a.title.localeCompare(b.title));

  const ready = products.filter((product) => product.status === "ready");
  return {
    products,
    unmatched,
    duplicates,
    errors,
    rangeError: options.rangeError ?? null,
    totals: {
      files: files.length,
      products: products.length,
      readyProducts: ready.length,
      imagesToUpload: ready.reduce((total, product) => total + product.images.filter((image) => image.state !== "already_uploaded").length, 0),
      newPrimaries: ready.filter((product) => !product.hasPrimary).length,
      alreadyUploaded: products.reduce((total, product) => total + product.images.filter((image) => image.state === "already_uploaded").length, 0),
      skippedProducts: products.filter((product) => product.status === "skipped").length,
      blockedProducts: products.filter((product) => product.status === "blocked").length,
    },
  };
}

// ---------------- execution ----------------

export type SkuImageStatus = "pending" | "uploading" | "saving" | "saved" | "failed" | "not_attempted" | "already_uploaded";
export type SkuProductStatus = "pending" | "running" | "verified" | "partial" | "failed" | "not_verified" | "blocked";

export type SkuImageResult = {
  fileIndex: number;
  name: string;
  sku: string;
  number: number;
  role: "primary" | "gallery";
  status: SkuImageStatus;
  mediaId: string | null;
  publicId: string | null;
  message: string | null;
};

export type SkuProductResult = {
  productId: string;
  title: string;
  skus: string[];
  status: SkuProductStatus;
  message: string;
  images: SkuImageResult[];
  checks: { name: string; ok: boolean; detail: string }[];
};

export type SkuUploadProgress = {
  productsTotal: number;
  productsDone: number;
  imagesTotal: number;
  imagesDone: number;
  products: Record<string, { title: string; status: SkuProductStatus; imagesDone: number; imagesTotal: number; current: string | null; percent: number | null }>;
};

export type SkuUploadDeps = {
  supabaseUrl: string | undefined | null;
  buildMode: string | undefined | null;
  requestSignature: (productId: string) => Promise<UploadSignature>;
  upload: (signature: UploadSignature, source: Blob, onProgress?: (percent: number) => void) => Promise<Record<string, unknown>>;
  insertMedia: (payload: ProductMediaInsert) => Promise<{ id: string }>;
  readMedia: (productId: string) => Promise<BulkMediaRow[]>;
  /** Recorded results (retry). Written as soon as each step succeeds. */
  ledger: { get: (key: string) => SkuLedgerEntry | undefined; set: (key: string, entry: SkuLedgerEntry) => void };
  fileFor: (fileIndex: number) => Blob | null;
  onProgress?: (progress: SkuUploadProgress) => void;
  concurrency?: number;
};

export type SkuUploadResult = {
  outcome: "all_verified" | "issues" | "blocked";
  message: string;
  products: SkuProductResult[];
  summary: { products: number; verified: number; partial: number; failed: number; notVerified: number; blocked: number; imagesSaved: number; imagesFailed: number; imagesNotAttempted: number };
};

const messageOf = (error: unknown, fallback: string) => (error instanceof Error && error.message ? error.message : fallback);
const sameRows = (a: BulkMediaRow[], b: BulkMediaRow[]) => {
  if (a.length !== b.length) return false;
  const byId = new Map(b.map((row) => [row.id, row]));
  return a.every((row) => {
    const other = byId.get(row.id);
    return Boolean(other) && other!.is_primary === row.is_primary && other!.sort_order === row.sort_order && other!.cloudinary_public_id === row.cloudinary_public_id;
  });
};

/** Compares a fresh read with the snapshot and the rows this run saved. */
export function verifySkuProduct(rows: BulkMediaRow[], snapshot: BulkMediaRow[], saved: { mediaId: string; publicId: string; sortOrder: number; primary: boolean }[], environment: UploadEnvironmentName, productId: string) {
  const check = (name: string, ok: boolean, detail: string) => ({ name, ok, detail });
  const byId = new Map(rows.map((row) => [row.id, row]));
  const changedOld = snapshot.filter((row) => {
    const now = byId.get(row.id);
    return !now || now.is_primary !== row.is_primary || now.sort_order !== row.sort_order || now.cloudinary_public_id !== row.cloudinary_public_id;
  });
  const missing = saved.filter((entry) => !byId.has(entry.mediaId));
  const wrongOrder = saved.filter((entry) => byId.get(entry.mediaId) && byId.get(entry.mediaId)!.sort_order !== entry.sortOrder);
  const wrongFolder = saved.filter((entry) => cloudinaryPublicIdProblem(environment, byId.get(entry.mediaId)?.cloudinary_public_id, productId));
  const noUrl = saved.filter((entry) => !String(byId.get(entry.mediaId)?.secure_url ?? "").startsWith("https://"));
  const primaries = rows.filter((row) => row.is_primary);
  const expectedPrimary = snapshot.find((row) => row.is_primary)?.id ?? saved.find((entry) => entry.primary)?.mediaId ?? null;
  const duplicatePublicIds = rows.length - new Set(rows.map((row) => row.cloudinary_public_id)).size;
  return [
    check("Existing images unchanged", changedOld.length === 0, changedOld.length ? `${changedOld.length} existing row(s) changed or missing` : `${snapshot.length} existing row(s) unchanged`),
    check("Row count", rows.length === snapshot.length + saved.length, `${rows.length} row(s), ${snapshot.length + saved.length} expected`),
    check("Saved rows present", missing.length === 0, missing.length ? `${missing.length} saved row(s) not found` : `${saved.length} saved row(s) found`),
    check("Image order", wrongOrder.length === 0, wrongOrder.length ? `${wrongOrder.length} row(s) out of order` : "As planned"),
    check("Cloudinary folder", wrongFolder.length === 0, wrongFolder.length ? `${wrongFolder.length} row(s) outside the product folder` : "All in the product's folder"),
    check("secure_url", noUrl.length === 0, noUrl.length ? `${noUrl.length} row(s) without an https URL` : "All https"),
    check("Exactly one primary", expectedPrimary === null ? primaries.length === 0 : primaries.length === 1 && primaries[0].id === expectedPrimary, `${primaries.length} primary row(s)`),
    check("No duplicates", duplicatePublicIds === 0, duplicatePublicIds ? `${duplicatePublicIds} duplicate public_id(s)` : "None"),
  ];
}

async function pool<T>(items: T[], limit: number, run: (item: T) => Promise<void>) {
  let next = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    while (next < items.length) {
      const item = items[next++];
      await run(item);
    }
  });
  await Promise.all(workers);
}

/** Uploads the ready products of a preview (several products in parallel, each product's images in order). */
export async function runSkuImageUpload(preview: SkuPreview, deps: SkuUploadDeps): Promise<SkuUploadResult> {
  const target: UploadTarget = resolveUploadTarget(deps.supabaseUrl, deps.buildMode);
  const ready = preview.products.filter((product) => product.status === "ready");
  const emptySummary = { products: 0, verified: 0, partial: 0, failed: 0, notVerified: 0, blocked: 0, imagesSaved: 0, imagesFailed: 0, imagesNotAttempted: 0 };
  if (!target.allowed || !target.environment) return { outcome: "blocked", message: `${target.reason} Nothing was uploaded or saved.`, products: [], summary: emptySummary };
  if (ready.length === 0) return { outcome: "blocked", message: "No product is ready to upload. Nothing was uploaded or saved.", products: [], summary: emptySummary };
  const environment = target.environment;

  const progress: SkuUploadProgress = {
    productsTotal: ready.length,
    productsDone: 0,
    imagesTotal: ready.reduce((total, product) => total + product.images.filter((image) => image.state !== "already_uploaded").length, 0),
    imagesDone: 0,
    products: Object.fromEntries(ready.map((product) => [product.productId, { title: product.title, status: "pending" as SkuProductStatus, imagesDone: 0, imagesTotal: product.images.filter((image) => image.state !== "already_uploaded").length, current: null, percent: null }])),
  };
  const emit = () => deps.onProgress?.({ ...progress, products: Object.fromEntries(Object.entries(progress.products).map(([id, entry]) => [id, { ...entry }])) });
  const results = new Map<string, SkuProductResult>();

  await pool(ready, deps.concurrency ?? SKU_UPLOAD_CONCURRENCY, async (product) => {
    const state = progress.products[product.productId];
    state.status = "running";
    emit();
    const result = await runProduct(product, environment, deps, (current, percent) => {
      state.current = current;
      state.percent = percent;
      emit();
    }, () => {
      state.imagesDone += 1;
      progress.imagesDone += 1;
      emit();
    });
    // Images never attempted (the primary failed) still count as handled so the counter reaches its total.
    const notAttempted = result.images.filter((image) => image.status === "not_attempted").length;
    progress.imagesDone += notAttempted;
    state.imagesDone += notAttempted;
    state.status = result.status;
    state.current = null;
    state.percent = null;
    progress.productsDone += 1;
    emit();
    results.set(product.productId, result);
  });

  const products = ready.map((product) => results.get(product.productId)!);
  const count = (status: SkuProductStatus) => products.filter((product) => product.status === status).length;
  const images = products.flatMap((product) => product.images);
  const summary = {
    products: products.length,
    verified: count("verified"),
    partial: count("partial"),
    failed: count("failed"),
    notVerified: count("not_verified"),
    blocked: count("blocked"),
    imagesSaved: images.filter((image) => image.status === "saved").length,
    imagesFailed: images.filter((image) => image.status === "failed").length,
    imagesNotAttempted: images.filter((image) => image.status === "not_attempted").length,
  };
  const all = summary.verified === summary.products;
  return {
    outcome: all ? "all_verified" : "issues",
    message: all
      ? `All ${summary.verified} product(s) uploaded and verified (${summary.imagesSaved} image(s)).`
      : `Finished with issues: ${summary.verified} verified, ${summary.partial} partial, ${summary.failed} failed, ${summary.notVerified} not verified, ${summary.blocked} blocked. Use "Retry failed images" — it re-reads the database and uploads only what is missing.`,
    products,
    summary,
  };
}

async function runProduct(
  product: SkuPreviewProduct,
  environment: UploadEnvironmentName,
  deps: SkuUploadDeps,
  setCurrent: (current: string | null, percent: number | null) => void,
  imageDone: () => void,
): Promise<SkuProductResult> {
  const images: SkuImageResult[] = product.images.map((image) => ({
    fileIndex: image.fileIndex,
    name: image.name,
    sku: image.sku,
    number: image.number,
    role: image.role,
    status: image.state === "already_uploaded" ? "already_uploaded" : "pending",
    mediaId: image.mediaId,
    publicId: null,
    message: image.state === "already_uploaded" ? "Already uploaded (confirmed in the database)" : null,
  }));
  const finish = (status: SkuProductStatus, message: string, checks: SkuProductResult["checks"] = []): SkuProductResult => {
    for (const image of images) if (image.status === "pending") image.status = "not_attempted";
    return { productId: product.productId, title: product.title, skus: product.skus, status, message, images, checks };
  };

  setCurrent("Checking current images", null);
  let before: BulkMediaRow[];
  try {
    before = await deps.readMedia(product.productId);
  } catch (error) {
    return finish("blocked", `Could not re-check the product's images (${messageOf(error, "read failed")}). Nothing was uploaded.`);
  }
  if (!sameRows(before, product.snapshot))
    return finish("blocked", `Images changed since the preview (${before.length} now, ${product.snapshot.length} in the preview). Nothing was uploaded — reload the preview.`);

  const saved: { mediaId: string; publicId: string; sortOrder: number; primary: boolean }[] = [];
  for (const [index, image] of product.images.entries()) {
    if (image.state === "already_uploaded") continue;
    const result = images[index];
    const key = ledgerKey(environment, product.productId, image.sha256);
    const label = `${image.name} (${index + 1} of ${product.images.length})`;
    const failImage = (message: string) => {
      result.status = "failed";
      result.message = message;
      imageDone();
    };
    let response: Record<string, unknown> | null = image.state === "save_only" ? (deps.ledger.get(key)?.cloudinary ?? null) : null;
    if (!response) {
      const source = deps.fileFor(image.fileIndex);
      if (!source) {
        failImage("The file is no longer available; choose the files again.");
        if (image.role === "primary") break;
        continue;
      }
      try {
        result.status = "uploading";
        setCurrent(`Authorizing ${label}`, null);
        const signature = await deps.requestSignature(product.productId);
        const folderProblem = cloudinaryFolderProblem(environment, signature.signedParameters.folder, product.productId);
        if (folderProblem) throw new Error(folderProblem);
        setCurrent(`Uploading ${label}`, 0);
        response = await deps.upload(signature, source, (percent) => setCurrent(`Uploading ${label}`, percent));
        const publicIdProblem = cloudinaryPublicIdProblem(environment, response.public_id, product.productId);
        if (publicIdProblem) throw new Error(publicIdProblem);
        deps.ledger.set(key, { productId: product.productId, sha256: image.sha256, fileName: image.name, cloudinary: storedResult(response), mediaId: null });
      } catch (error) {
        failImage(`Upload failed: ${messageOf(error, "upload failed")}`);
        if (image.role === "primary") break; // gallery images wait until the product has its primary
        continue;
      }
    }
    try {
      result.status = "saving";
      setCurrent(`Saving ${label}`, null);
      const altText = image.role === "primary" ? product.title : `${product.title} – image ${image.number}`;
      const payload = productMediaPayload(response, { productId: product.productId, altText, sortOrder: image.sortOrder, isPrimary: image.role === "primary" });
      const row = await deps.insertMedia(payload);
      deps.ledger.set(key, { productId: product.productId, sha256: image.sha256, fileName: image.name, cloudinary: storedResult(response), mediaId: row.id });
      saved.push({ mediaId: row.id, publicId: payload.cloudinary_public_id, sortOrder: image.sortOrder, primary: image.role === "primary" });
      result.status = "saved";
      result.mediaId = row.id;
      result.publicId = payload.cloudinary_public_id;
      result.message = image.state === "save_only" ? "Saved from the recorded Cloudinary upload (not uploaded again)" : null;
      imageDone();
    } catch (error) {
      failImage(`Uploaded to Cloudinary but the database row was not saved (${messageOf(error, "insert failed")}). Retry saves it without uploading again.`);
      result.publicId = typeof response.public_id === "string" ? response.public_id : null;
      if (image.role === "primary") break;
    }
  }

  setCurrent("Verifying", null);
  let rows: BulkMediaRow[];
  try {
    rows = await deps.readMedia(product.productId);
  } catch (error) {
    return finish("not_verified", `${saved.length} image(s) saved, but the read-back failed (${messageOf(error, "read failed")}). NOT verified.`);
  }
  const checks = verifySkuProduct(rows, before, saved, environment, product.productId);
  const checksOk = checks.every((entry) => entry.ok);
  const failed = images.filter((image) => image.status === "failed").length;
  const notAttempted = images.filter((image) => image.status === "pending").length;
  if (!checksOk) return finish("not_verified", `Read-back verification FAILED: ${checks.filter((entry) => !entry.ok).map((entry) => entry.name).join(", ")}.`, checks);
  if (failed === 0 && notAttempted === 0) return finish("verified", `${saved.length} image(s) saved and verified.`, checks);
  return finish(saved.length ? "partial" : "failed", `${saved.length} saved and verified, ${failed} failed${notAttempted ? `, ${notAttempted} waiting for the primary` : ""}.`, checks);
}

// ---------------- report ----------------

const csvCell = (value: unknown) => {
  const text = value === null || value === undefined ? "" : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

/** One row per selected file: what the preview decided and what the upload did. */
export function skuUploadReportCsv(preview: SkuPreview, result: SkuUploadResult | null, environment: UploadEnvironmentName | null) {
  const header = ["environment", "file_name", "path", "sku", "image_number", "product_id", "product_title", "preview_decision", "role", "sort_order", "upload_status", "media_id", "cloudinary_public_id", "message"];
  const byFile = new Map<number, { product: SkuProductResult; image: SkuImageResult }>();
  for (const product of result?.products ?? []) for (const image of product.images) byFile.set(image.fileIndex, { product, image });
  const rows: unknown[][] = [];
  for (const product of preview.products)
    for (const image of product.images) {
      const done = byFile.get(image.fileIndex);
      rows.push([
        environment ?? "",
        image.name,
        "",
        image.sku,
        image.number,
        product.productId,
        product.title,
        product.status === "ready" ? (image.state === "already_uploaded" ? "already uploaded" : image.state === "save_only" ? "save recorded upload" : "upload") : product.status,
        image.role,
        image.sortOrder,
        done?.image.status ?? (image.state === "already_uploaded" ? "already_uploaded" : "not run"),
        done?.image.mediaId ?? image.mediaId ?? "",
        done?.image.publicId ?? "",
        done?.image.message ?? product.reason ?? image.warning ?? "",
      ]);
    }
  for (const [kind, list] of [["unmatched", preview.unmatched], ["duplicate", preview.duplicates], ["error", preview.errors]] as const)
    for (const entry of list) rows.push([environment ?? "", entry.name, entry.path, entry.sku ?? "", "", "", "", kind, "", "", "not uploaded", "", "", entry.reason]);
  return [header, ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n") + "\r\n";
}
