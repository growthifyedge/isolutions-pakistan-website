/**
 * Admin -> Catalog bulk publish: selection rules and the batch built from the Owner's ticked Draft products.
 *
 * Everything that decides or writes is the existing bulk publish engine (bulkPublish.ts):
 *   - `buildPublishPreview` turns the real validator's answers into Ready / Needs Review / Already Published / Skipped;
 *   - `runBulkPublish` re-reads and re-validates every product right before its write, publishes one by one,
 *     never lets one failure stop another, and reads each product back.
 * The server enforces the same validator again (`products_enforce_publication` trigger), so a stale preview can
 * never publish an invalid product. This file adds no validation of its own — only which ids are in the batch.
 */
import type { BatchSelection, CommercialProduct } from "./commercialDefaults.ts";
import type { PublishPreview, PublishValidation } from "./bulkPublish.ts";

export type SelectableProduct = { id: string; publication_status: string };

export const isDraft = (product: SelectableProduct) => product.publication_status === "draft";

/** Only Draft products can be ticked; unticking always works. */
export function toggleSelection(selected: ReadonlySet<string>, product: SelectableProduct, checked: boolean): Set<string> {
  const next = new Set(selected);
  if (!checked) next.delete(product.id);
  else if (isDraft(product)) next.add(product.id);
  return next;
}

/** Adds every Draft among the given (shown) products; published / archived rows are never added. */
export function selectAllDrafts(selected: ReadonlySet<string>, shown: readonly SelectableProduct[]): Set<string> {
  const next = new Set(selected);
  for (const product of shown) if (isDraft(product)) next.add(product.id);
  return next;
}

/** After a reload: keep only ids that still exist and are still Draft. */
export function pruneSelection(selected: ReadonlySet<string>, products: readonly SelectableProduct[]): Set<string> {
  const drafts = new Set(products.filter(isDraft).map((product) => product.id));
  return new Set([...selected].filter((id) => drafts.has(id)));
}

/**
 * The batch for the engine, from FRESHLY read products (never the list's cached status). A selected product that is no
 * longer Draft stays a target so the preview reports it (published -> Already Published, archived -> Skipped); an id
 * that no longer exists is reported in `missingTitles`.
 */
export function catalogPublishSelection(selectedIds: Iterable<string>, fresh: readonly CommercialProduct[]): BatchSelection {
  const byId = new Map(fresh.map((product) => [product.id, product]));
  const targets: CommercialProduct[] = [];
  const missingTitles: string[] = [];
  for (const id of new Set(selectedIds)) {
    const product = byId.get(id);
    if (product) targets.push(product);
    else missingTitles.push(id);
  }
  targets.sort((a, b) => a.title.localeCompare(b.title));
  return { targets, missingTitles, skipped: [] };
}

/** Runs the real validator for every Draft target, a few at a time. A validator error leaves that product unvalidated (blocked). */
export async function validateDrafts(selection: BatchSelection, validate: (productId: string) => Promise<PublishValidation>, concurrency = 6) {
  const validations = new Map<string, PublishValidation | null>();
  const drafts = selection.targets.filter((product) => product.publicationStatus === "draft");
  for (let index = 0; index < drafts.length; index += concurrency) {
    await Promise.all(
      drafts.slice(index, index + concurrency).map(async (product) => {
        try {
          validations.set(product.id, await validate(product.id));
        } catch {
          validations.set(product.id, null);
        }
      }),
    );
  }
  return validations;
}

/** A preview is only usable for the exact selection it was made for; any tick / untick makes it stale. */
export function previewMatchesSelection(preview: PublishPreview | null, previewIds: readonly string[], selected: ReadonlySet<string>) {
  if (!preview) return false;
  return previewIds.length === selected.size && previewIds.every((id) => selected.has(id));
}

/** Owner-facing labels for the engine's preview kinds. */
export const PREVIEW_LABEL = { ready: "Ready to Publish", blocked: "Needs Review", already_published: "Already Published", skipped: "Skipped" } as const;

const READABLE: Record<string, string> = {
  validation_unavailable: "the publication validator did not answer",
  primary_product_media_required: "primary image required",
  active_variant_required: "at least one active variant required",
  variant_commercial_facts_unresolved: "variant PTA / condition / warranty / delivery not resolved",
  laptops_apple_brand_required: "only Apple MacBooks are allowed in Laptops",
  real_catalog_classification_required: "product is not classified as real",
};
/** Validator codes as plain words, keeping the exact code for support (e.g. "primary image required (primary_product_media_required)"). */
export const readableBlocker = (code: string) => {
  const words = READABLE[code] ?? code.replace(/_/g, " ");
  return words === code ? code : `${words} (${code})`;
};
