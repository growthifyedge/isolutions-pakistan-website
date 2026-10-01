// Bulk Upload v2 Phase 2 — client-side preview helpers that mirror
// public.apply_catalog_bulk_import_v2 (202609240006). The database re-validates and
// re-matches everything; these only make the preview show what the import will do.
import { ANDROID_MOBILE_WARRANTY_SOURCE, type ValueSource } from "./bulkCatalog.ts";

/** The facts of an existing variant that take part in matching. */
export type ExistingVariantFacts = {
  id: string;
  sku: string;
  is_active?: boolean;
  carrier_jv?: string | null;
  ram_display: string | null;
  storage_display: string | null;
  color_finish: string | null;
  pta_status: string;
  condition: string;
  condition_grade?: string | null;
  battery_health_percent?: number | null;
  battery_cycle_count?: number | null;
};

/** An imported row's variant facts; null / "unknown" means "not supplied". */
export type ImportVariantFacts = {
  ram: string | null;
  storage: string | null;
  color: string | null;
  ptaStatus: string | null;
  condition: string | null;
  conditionGrade?: string | null;
  batteryHealth?: number | null;
  cycleCount?: number | null;
};

const text = (value: string | null | undefined) => value?.trim().toLowerCase() ?? "";
const supplied = (value: string | null | undefined) => (value && value !== "unknown" ? value : null);

/**
 * Same rules as the database: RAM / Storage / Color must be equal; a supplied PTA, Condition,
 * Grade, Battery Health or Cycle Count must equal the existing value or fill an unknown one;
 * a blank one matches anything. If several variants qualify, only an exact match on the
 * supplied facts decides; otherwise the row is ambiguous. SKU is never used.
 */
export function matchImportVariant<T extends ExistingVariantFacts>(
  existing: T[],
  row: ImportVariantFacts,
): { match: T | null; ambiguous: boolean } {
  const pta = supplied(row.ptaStatus);
  const condition = supplied(row.condition);
  const grade = row.conditionGrade ?? null;
  const health = row.batteryHealth ?? null;
  const cycles = row.cycleCount ?? null;
  const base = existing.filter(
    (item) =>
      !item.carrier_jv &&
      text(item.ram_display) === text(row.ram) &&
      text(item.storage_display) === text(row.storage) &&
      text(item.color_finish) === text(row.color),
  );
  const candidates = base.filter(
    (item) =>
      (!pta || item.pta_status === pta || item.pta_status === "unknown") &&
      (!condition || item.condition === condition || item.condition === "unknown") &&
      (grade === null || item.condition_grade == null || item.condition_grade === grade) &&
      (health === null || item.battery_health_percent == null || item.battery_health_percent === health) &&
      (cycles === null || item.battery_cycle_count == null || item.battery_cycle_count === cycles),
  );
  if (candidates.length <= 1) return { match: candidates[0] ?? null, ambiguous: false };
  const exact = base.filter(
    (item) =>
      (!pta || item.pta_status === pta) &&
      (!condition || item.condition === condition) &&
      (grade === null || item.condition_grade === grade) &&
      (health === null || item.battery_health_percent === health) &&
      (cycles === null || item.battery_cycle_count === cycles),
  );
  return exact.length === 1 ? { match: exact[0], ambiguous: false } : { match: null, ambiguous: true };
}

const filled = (value: string | null | undefined): value is string => Boolean(value?.trim());

/**
 * The warranty a preview row sends for one variant (the database writes it as
 * warranty_override and keeps the stored value when it is blank):
 * - an Owner-supplied warranty always wins and may update the stored one;
 * - a blank or auto-filled Android "1 Year" warranty never replaces a stored one: it inherits
 *   the existing product default, and a matched variant keeps its own stored warranty;
 * - with nothing stored, the auto-filled "1 Year" is saved.
 */
export function resolveImportWarranty(
  incoming: { warranty: string | null; source: ValueSource },
  stored: { productDefault?: string | null; variantOverride?: string | null },
): { warranty: string | null; source: ValueSource } {
  let result = incoming;
  if (
    (result.source === "unresolved" || result.source === ANDROID_MOBILE_WARRANTY_SOURCE) &&
    filled(stored.productDefault)
  )
    result = { warranty: stored.productDefault, source: "inherited from product" };
  if (filled(stored.variantOverride) && result.source !== "Owner supplied explicitly")
    result = { warranty: stored.variantOverride, source: "Owner supplied explicitly" };
  return result;
}

export type CatalogImportCounts = {
  productsToCreate: number;
  productsToReplace: number;
  variantsToCreate: number;
  variantsToUpdate: number;
  variantsToReactivate: number;
  variantsToHide: number;
  rowsNeedingReview: number;
};

type PreviewLike = {
  action: string;
  blocked: string[];
  hiddenVariants: unknown[];
  variants: Array<{ action: string; warnings: string[] }>;
};

export function catalogImportCounts(products: PreviewLike[]): CatalogImportCounts {
  const variants = products.flatMap((product) => product.variants);
  return {
    productsToCreate: products.filter((product) => product.action === "CREATE").length,
    productsToReplace: products.filter((product) => product.action === "REPLACE EXISTING").length,
    variantsToCreate: variants.filter((variant) => variant.action === "CREATE VARIANT").length,
    variantsToUpdate: variants.filter((variant) => variant.action === "UPDATE VARIANT").length,
    variantsToReactivate: variants.filter((variant) => variant.action === "REACTIVATE VARIANT").length,
    variantsToHide: products.reduce((count, product) => count + product.hiddenVariants.length, 0),
    rowsNeedingReview: variants.filter((variant) => variant.warnings.length > 0).length,
  };
}

/** Apply is allowed only for an Excel v2 preview with no file errors and nothing needing review. */
export function canApplyCatalogImport(format: string, products: PreviewLike[], fileErrors: string[]) {
  return (
    format === "catalog_sheet" &&
    products.length > 0 &&
    fileErrors.length === 0 &&
    products.every((product) => product.blocked.length === 0 && product.action !== "NEEDS REVIEW") &&
    catalogImportCounts(products).rowsNeedingReview === 0
  );
}

export function catalogImportConfirmation(counts: CatalogImportCounts) {
  return [
    `Products to create: ${counts.productsToCreate}`,
    `Products to replace: ${counts.productsToReplace}`,
    `Variants to create: ${counts.variantsToCreate}`,
    `Variants to update: ${counts.variantsToUpdate + counts.variantsToReactivate}${counts.variantsToReactivate ? ` (${counts.variantsToReactivate} brought back)` : ""}`,
    `Variants to hide: ${counts.variantsToHide}`,
    `Rows needing review: ${counts.rowsNeedingReview}`,
  ].join("\n");
}

/** Result returned by apply_catalog_bulk_import_v2. */
export type CatalogImportResult = {
  products_created: number;
  products_replaced: number;
  variants_created: number;
  variants_updated: number;
  variants_reactivated: number;
  variants_hidden: number;
  inventory_adjustments: number;
  specifications_created: number;
  assigned_skus: Array<{ product: string; source: string; sku: string }>;
  compare_at_cleared: Array<{ product: string; source: string; sku: string }>;
  products: Array<{ id: string; title: string; action: string; has_primary_image: boolean }>;
};
