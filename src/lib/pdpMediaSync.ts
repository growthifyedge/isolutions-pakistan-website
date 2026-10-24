/**
 * PDP colour <-> image sync. Pure: decides which variant and which image belong together, using ONLY the stored
 * colour association of each image (`variantId` / `variantIds`, set in the Admin Media editor). Nothing is inferred
 * from file names or alt text; an image without an association is a shared image that fits every colour.
 */
import type { CatalogMedia, CatalogProduct, CatalogVariant } from "./catalog.ts";

type Product = Pick<CatalogProduct, "media" | "variants">;

/** Same rule as catalog.ts primaryMedia (kept local so this module has no runtime dependencies). */
const primaryMedia = (product: Pick<CatalogProduct, "media">) => product.media.find((item) => item.isPrimary) ?? product.media[0] ?? null;

const assignedIds = (media: CatalogMedia) => [...new Set([...(media.variantId ? [media.variantId] : []), ...(media.variantIds ?? [])])];
const isShared = (media: CatalogMedia) => assignedIds(media).length === 0;
export const mediaIsAssignedTo = (media: CatalogMedia, variantId: string) => assignedIds(media).includes(variantId);

/**
 * The image to show for a variant, in gallery order:
 *   1. an image associated with this exact variant (the primary first, if it is one of them);
 *   2. otherwise a shared image (the primary first, if it is shared) — never another colour's image;
 *   3. otherwise the primary (nothing better exists).
 */
export function mediaForVariant(product: Product, variantId: string): CatalogMedia | null {
  const primary = primaryMedia(product);
  const exact = product.media.filter((media) => mediaIsAssignedTo(media, variantId));
  if (exact.length) return exact.find((media) => media.id === primary?.id) ?? exact[0];
  const shared = product.media.filter(isShared);
  if (shared.length) return shared.find((media) => media.id === primary?.id) ?? shared[0];
  return primary;
}

/**
 * The variant an image belongs to, or null when the selection should stay as it is: a shared image, or an image
 * whose colour has no in-stock variant in the selected configuration (browsing never switches the storage).
 */
export function variantForMedia(product: Product, media: CatalogMedia, current: CatalogVariant | undefined, sameConfiguration: (variant: CatalogVariant) => boolean): CatalogVariant | null {
  const ids = assignedIds(media);
  if (!ids.length) return null;
  if (current && ids.includes(current.id)) return current;
  return product.variants.find((variant) => ids.includes(variant.id) && sameConfiguration(variant) && variant.quantity > 0) ?? null;
}

/**
 * The selection on page load: if the primary image belongs to an in-stock variant, that variant is selected (so
 * the first image and the selected colour agree); otherwise the first in-stock variant, and its image.
 */
export function initialPdpSelection(product: Product): { variantId: string; media: CatalogMedia | null } {
  const primary = primaryMedia(product);
  const owner = primary ? product.variants.find((variant) => mediaIsAssignedTo(primary, variant.id) && variant.quantity > 0) : undefined;
  const variant = owner ?? product.variants.find((item) => item.quantity > 0) ?? product.variants[0];
  if (!variant) return { variantId: "", media: primary };
  return { variantId: variant.id, media: mediaForVariant(product, variant.id) };
}
