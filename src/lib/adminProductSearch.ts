// Admin Products list search (client-side, over the products Admin already loads). Matches the
// product title, slug or brand, or any of its variants' SKU, storage or colour. Case-insensitive
// substring match, so "mb004", "MB00" and "256 gb" all work. Storefront search is separate.

export type AdminSearchableProduct = {
  title: string;
  slug: string;
  brand: { name: string } | null;
  product_variants: { sku: string | null; storage_display: string | null; color_finish: string | null }[];
};

export function adminProductMatchesQuery(product: AdminSearchableProduct, query: string) {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  const haystack = [
    product.title,
    product.slug,
    product.brand?.name,
    ...product.product_variants.flatMap((variant) => [variant.sku, variant.storage_display, variant.color_finish]),
  ];
  return haystack.some((value) => value?.toLowerCase().includes(needle));
}
