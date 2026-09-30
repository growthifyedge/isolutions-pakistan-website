import type { CatalogProduct } from "./catalog";

export const HOMEPAGE_FEATURED_LIMIT = 4;

// Mirrors the homepage_featured_products RPC filter so the homepage can never render a
// fictional, unpublished-shaped, imageless, unpriced, or out-of-stock Featured product.
export function isHomepageFeaturedEligible(product: CatalogProduct) {
  return (
    product.is_featured === true &&
    product.media.some((item) => item.isPrimary && Boolean(item.publicId && item.url)) &&
    product.variants.some((variant) => variant.priceMinor > 0 && variant.quantity > 0)
  );
}

export function selectHomepageFeaturedProducts(
  products: CatalogProduct[],
  limit = HOMEPAGE_FEATURED_LIMIT,
) {
  return products.filter(isHomepageFeaturedEligible).slice(0, limit);
}
