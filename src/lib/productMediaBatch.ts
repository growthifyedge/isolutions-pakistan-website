/**
 * Multiple-image upload for the per-product Admin Media tab.
 *
 * Pure planning + sequential runner; the actual signed Cloudinary upload and the
 * product_media insert stay in MediaManager (same calls as the single upload).
 * - Duplicates are skipped before anything is uploaded: the same file content
 *   twice in one selection (SHA-256), a file already uploaded in this session,
 *   or a file whose name matches an existing image's alt text for this product.
 * - Items upload one at a time, so sort_order and the single-primary rule stay
 *   exactly as in the single upload. A failure never stops or rolls back the
 *   other items; failed items keep their File so they can be retried.
 * - A batch only ever adds images. It never replaces or deletes existing media.
 */

export type BatchItemStatus =
  | "queued"
  | "uploading"
  | "done"
  | "failed"
  | "skipped";

export type BatchItem = {
  key: string;
  file: File;
  name: string;
  hash: string;
  status: BatchItemStatus;
  progress: number;
  message: string;
};

/** Same alt text the single upload derives from a file name. */
export function altTextFromFileName(name: string) {
  return name.replace(/\.[^.]+$/, "").replace(/[-_]+/g, " ");
}

function normalizedAlt(text: string) {
  return text.trim().replace(/\s+/g, " ").toLowerCase();
}

export async function sha256Hex(file: Blob) {
  const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  return [...new Uint8Array(digest)]
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Builds the batch queue. `uploadedHashes` = content hashes already uploaded to
 * this product in this session; `existingAltTexts` = alt texts of the product's
 * current images.
 */
export function planMediaBatch(
  files: { file: File; hash: string }[],
  existingAltTexts: string[],
  uploadedHashes: ReadonlySet<string>,
): BatchItem[] {
  const existing = new Set(existingAltTexts.map(normalizedAlt));
  const seen = new Set<string>();
  return files.map(({ file, hash }, index) => {
    const item: BatchItem = {
      key: `${index}-${hash}`,
      file,
      name: file.name,
      hash,
      status: "queued",
      progress: 0,
      message: "Queued",
    };
    if (seen.has(hash))
      return { ...item, status: "skipped", message: "Skipped: same image selected twice." };
    seen.add(hash);
    if (uploadedHashes.has(hash))
      return { ...item, status: "skipped", message: "Skipped: already uploaded to this product." };
    if (existing.has(normalizedAlt(altTextFromFileName(file.name))))
      return { ...item, status: "skipped", message: "Skipped: an image with this file name already exists on this product." };
    return item;
  });
}

/**
 * Uploads the given items one by one. `uploadOne` returns the error message or
 * null on success. Already-done and skipped items are never uploaded again.
 */
export async function runMediaBatch(
  items: BatchItem[],
  uploadOne: (item: BatchItem, onProgress: (percent: number) => void) => Promise<string | null>,
  onChange: (key: string, patch: Partial<BatchItem>) => void,
) {
  let done = 0;
  let failed = 0;
  for (const item of items) {
    if (item.status !== "queued" && item.status !== "failed") continue;
    onChange(item.key, { status: "uploading", progress: 0, message: "Uploading…" });
    let error: string | null;
    try {
      error = await uploadOne(item, (progress) => onChange(item.key, { progress }));
    } catch (caught) {
      error = caught instanceof Error ? caught.message : "Upload failed.";
    }
    if (error) {
      failed += 1;
      onChange(item.key, { status: "failed", progress: 0, message: error });
    } else {
      done += 1;
      onChange(item.key, { status: "done", progress: 100, message: "Uploaded" });
    }
  }
  return { done, failed };
}

export function batchSummary(items: BatchItem[]) {
  const count = (status: BatchItemStatus) =>
    items.filter((item) => item.status === status).length;
  return {
    total: items.length,
    done: count("done"),
    failed: count("failed"),
    skipped: count("skipped"),
    pending: count("queued") + count("uploading"),
  };
}
