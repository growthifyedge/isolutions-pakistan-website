import { supabase } from "./supabase";
import { minimumActiveVariantPrice } from "./money";
import { nullIfEmpty } from "./catalogFilters";
export { formatPkrMinor } from "./money";

export type CatalogVariant = {
  id: string;
  sku: string;
  ram: string | null;
  storage: string | null;
  color: string | null;
  priceMinor: number;
  compareAtPriceMinor: number | null;
  ptaStatus: "approved" | "not_approved" | "not_applicable" | "unknown";
  condition: "brand_new" | "used" | "open_box" | "refurbished" | "unknown";
  warranty: string | null;
  carrierJv: string | null;
  deliveryScope: "karachi_only" | "nationwide" | null;
  quantity: number;
};

export type CatalogMedia = {
  id: string;
  variantId: string | null;
  variantIds?: string[];
  publicId: string;
  url: string;
  alt: string;
  width: number;
  height: number;
  format: string;
  isPrimary: boolean;
};

export type CatalogProduct = {
  id: string;
  slug: string;
  title: string;
  short_description: string | null;
  content: string | null;
  default_warranty: string | null;
  published_at: string;
  is_flash_sale: boolean;
  is_featured: boolean;
  is_best_seller: boolean;
  brand: { id: string; name: string; slug: string } | null;
  category: { id: string; name: string; slug: string };
  variants: CatalogVariant[];
  media: CatalogMedia[];
  specifications: { group: string | null; label: string; value: string }[];
};

export type FrequentlyBoughtTogetherProduct = Pick<
  CatalogProduct,
  "id" | "slug" | "title" | "brand" | "variants" | "media"
>;

export type CatalogFilters = {
  search?: string;
  slug?: string;
  categories?: string[];
  brands?: string[];
  priceMin?: number;
  priceMax?: number;
  storage?: string[];
  ram?: string[];
  ptaStatus?: CatalogVariant["ptaStatus"][];
  inStock?: boolean;
  deliveryScope?: NonNullable<CatalogVariant["deliveryScope"]>[];
  limit?: number;
};

const optional = <T>(value: T | undefined, fallback: null = null) =>
  value ?? fallback;

export function publicCatalogRpcParameters(filters: CatalogFilters = {}) {
  return {
    p_search: optional(filters.search),
    p_slug: optional(filters.slug),
    p_category_slugs: nullIfEmpty(filters.categories),
    p_brand_slugs: nullIfEmpty(filters.brands),
    p_price_min: optional(filters.priceMin),
    p_price_max: optional(filters.priceMax),
    p_storage: nullIfEmpty(filters.storage),
    p_ram: nullIfEmpty(filters.ram),
    p_pta_status: nullIfEmpty(filters.ptaStatus),
    p_in_stock: optional(filters.inStock),
    p_delivery_scope: nullIfEmpty(filters.deliveryScope),
    p_limit: filters.limit ?? 48,
    p_offset: 0,
  };
}

export async function fetchPublicCatalog(filters: CatalogFilters = {}) {
  if (!supabase) throw new Error("Supabase environment is not configured");

  const { data, error } = await supabase.rpc(
    "search_public_catalog",
    publicCatalogRpcParameters(filters),
  );
  if (error) throw error;
  return (data ?? []) as CatalogProduct[];
}

export async function fetchPublicTaxonomy() {
  if (!supabase) throw new Error("Supabase environment is not configured");
  const { data, error } = await supabase.rpc("public_catalog_taxonomy");
  if (error) throw error;
  return (data ?? { brands: [], categories: [] }) as {
    brands: { id: string; name: string; slug: string }[];
    categories: { id: string; name: string; slug: string }[];
  };
}

export async function fetchFrequentlyBoughtTogether(productId: string, limit = 4) {
  if (!supabase) throw new Error("Supabase environment is not configured");
  const { data, error } = await supabase.rpc("frequently_bought_together", {
    p_product_id: productId,
    p_limit: Math.min(Math.max(limit, 1), 4),
  });
  if (error) throw error;
  return (data ?? []) as FrequentlyBoughtTogetherProduct[];
}

export function validCompareAt(variant: CatalogVariant) {
  return variant.compareAtPriceMinor !== null &&
    variant.compareAtPriceMinor > variant.priceMinor
    ? variant.compareAtPriceMinor
    : null;
}

export function productPrice(product: CatalogProduct) {
  return minimumActiveVariantPrice(product.variants);
}

export function hasVariablePrice(product: CatalogProduct) {
  return (
    new Set(product.variants.map((variant) => variant.priceMinor)).size > 1
  );
}

export function primaryMedia(product: Pick<CatalogProduct, "media">) {
  return (
    product.media.find((item) => item.isPrimary) ?? product.media[0] ?? null
  );
}
