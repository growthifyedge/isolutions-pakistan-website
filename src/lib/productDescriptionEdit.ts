/**
 * Admin product editor "Save description": updates only the product's description text (short description and product
 * content), never publication_status, so a published product stays published. Prices, variants, stock, images,
 * specifications and every other column are left alone. Only fields that actually changed are sent; blank text is
 * stored as NULL (the same rule as the editor's Save draft).
 */
export type ProductDescriptionFields = { short_description: string; content: string };
export type ProductDescriptionPatch = Partial<{ short_description: string | null; content: string | null }>;

const stored = (value: string) => (value.trim() ? value : null);

/** The columns to update, or null when nothing changed. */
export function productDescriptionPatch(
  loaded: ProductDescriptionFields,
  edited: ProductDescriptionFields,
): ProductDescriptionPatch | null {
  const patch: ProductDescriptionPatch = {};
  if (stored(edited.short_description) !== stored(loaded.short_description)) patch.short_description = stored(edited.short_description);
  if (stored(edited.content) !== stored(loaded.content)) patch.content = stored(edited.content);
  return Object.keys(patch).length ? patch : null;
}
