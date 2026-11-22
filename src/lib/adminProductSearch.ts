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

// Category + Subcategory filter (2026-11-21, localhost). Reuses the existing catalog relationships: products.category_id
// -> categories, products.subcategory_id -> product_subcategories (whose category_id is the parent). "" = all.
export type AdminCategoryFilter = { categoryId: string; subcategoryId: string };
export const NO_CATEGORY_FILTER: AdminCategoryFilter = { categoryId: "", subcategoryId: "" };

export type AdminFilterableProduct = { category_id: string | null; subcategory_id?: string | null };
export type AdminSubcategoryOption = { id: string; name: string; category_id: string; is_active: boolean; sort_order: number };

/** Category = every product of that category; Subcategory = only products stored with that subcategory. */
export function adminProductMatchesCategory(product: AdminFilterableProduct, filter: AdminCategoryFilter) {
  if (filter.categoryId && product.category_id !== filter.categoryId) return false;
  if (filter.subcategoryId && (product.subcategory_id ?? null) !== filter.subcategoryId) return false;
  return true;
}

/** Subcategories of one category, in their stored order; inactive ones only while products still use them. */
export function subcategoriesForCategory(
  categoryId: string,
  rows: readonly AdminSubcategoryOption[],
  products: readonly AdminFilterableProduct[],
): AdminSubcategoryOption[] {
  if (!categoryId) return [];
  const used = new Set(products.map((product) => product.subcategory_id).filter(Boolean));
  return rows
    .filter((row) => row.category_id === categoryId && (row.is_active || used.has(row.id)))
    .sort((left, right) => left.sort_order - right.sort_order || left.name.localeCompare(right.name));
}

/** Choosing a category clears a subcategory that belongs to another category. */
export function withCategory(filter: AdminCategoryFilter, categoryId: string, rows: readonly AdminSubcategoryOption[]): AdminCategoryFilter {
  const keep = rows.some((row) => row.id === filter.subcategoryId && row.category_id === categoryId);
  return { categoryId, subcategoryId: categoryId && keep ? filter.subcategoryId : "" };
}

/** Number of loaded products per category / subcategory id (for the option labels). */
export function countBy(products: readonly AdminFilterableProduct[], key: "category_id" | "subcategory_id") {
  const counts = new Map<string, number>();
  for (const product of products) {
    const id = product[key];
    if (id) counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  return counts;
}
