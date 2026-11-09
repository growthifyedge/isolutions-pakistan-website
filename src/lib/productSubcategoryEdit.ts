/**
 * Admin product editor "Save subcategory" (Home Gadgets subcategories, migration 202611090001). Updates ONLY
 * products.subcategory_id — never publication_status — so a published product stays published (the publication trigger
 * fires only on publication_status, and validate_product_for_publication does not read the subcategory). Prices, variants,
 * stock, images, descriptions and every other column are left alone.
 */
import { ACCESSORIES_EXTRA_PRODUCT_IDS } from "./collections.ts";
import { HOME_GADGET_SUBCATEGORY_PARENT } from "./homeGadgetSubcategories.ts";

export type SubcategoryRow = { id: string; name: string; slug: string; category_id: string; is_active: boolean; sort_order: number };

/** Choices for one product: active subcategories of its own category (in order), plus its current one if inactive. */
export function subcategoryOptionsFor(categoryId: string, rows: readonly SubcategoryRow[], currentId: string | null): SubcategoryRow[] {
  const own = rows.filter((row) => row.category_id === categoryId);
  return [...own]
    .filter((row) => row.is_active || row.id === currentId)
    .sort((left, right) => left.sort_order - right.sort_order || left.name.localeCompare(right.name));
}

/** Why the subcategory cannot be edited for this product, or null when it can. */
export function subcategoryEditBlocker(input: {
  productId: string | null;
  categorySlug: string | null;
  subcategoriesAvailable: boolean;
}): string | null {
  if (!input.productId) return "Save the product first.";
  if (!input.subcategoriesAvailable) return "Subcategories are not available on this database yet (migration 202611090001 not applied).";
  if (input.categorySlug !== HOME_GADGET_SUBCATEGORY_PARENT) return "Only Home Gadgets (category Gadgets) products have a subcategory.";
  if (ACCESSORIES_EXTRA_PRODUCT_IDS.includes(input.productId))
    return "This watch / band is shown in Mobile Accessories and stays out of Home Gadgets, so it gets no Home Gadgets subcategory.";
  return null;
}

/** The single column to update, or null when the choice equals what is stored. "" = no subcategory (NULL). */
export function subcategoryPatch(loadedId: string | null, chosenId: string): { subcategory_id: string | null } | null {
  const next = chosenId || null;
  return next === (loadedId || null) ? null : { subcategory_id: next };
}
