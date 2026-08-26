import { supabase } from "./supabase";

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
  brand: { id: string; name: string; slug: string };
  category: { id: string; name: string; slug: string };
  variants: CatalogVariant[];
  media: CatalogMedia[];
  specifications: { group: string | null; label: string; value: string }[];
};

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

export async function fetchPublicCatalog(filters: CatalogFilters = {}) {
  if (!supabase) throw new Error("Supabase environment is not configured");

  const { data, error } = await supabase.rpc("search_public_catalog", {
    p_search: optional(filters.search),
    p_slug: optional(filters.slug),
    p_category_slugs: optional(filters.categories),

    p_brand_slugs: optional(filters.brands),
    p_price_min: optional(filters.priceMin),
    p_price_max: optional(filters.priceMax),
    p_storage: optional(filters.storage),
    p_ram: optional(filters.ram),
    p_pta_status: optional(filters.ptaStatus),
    p_in_stock: optional(filters.inStock),
    p_delivery_scope: optional(filters.deliveryScope),
    p_limit: filters.limit ?? 48,
    p_offset: 0,
  });
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
export function formatPkrMinor(value: number) {
  return new Intl.NumberFormat("en-PK", {
    style: "currency",
    currency: "PKR",
    maximumFractionDigits: 0,
  }).format(Math.trunc(value) / 100);
}

export function validCompareAt(variant: CatalogVariant) {
  return variant.compareAtPriceMinor !== null &&
    variant.compareAtPriceMinor > variant.priceMinor
    ? variant.compareAtPriceMinor
    : null;
}

export function productPrice(product: CatalogProduct) {
  const prices = product.variants.map((variant) => variant.priceMinor);
  return prices.length ? Math.min(...prices) : null;
}

export function hasVariablePrice(product: CatalogProduct) {
  return (
    new Set(product.variants.map((variant) => variant.priceMinor)).size > 1
  );
}

export function primaryMedia(product: CatalogProduct) {
  return (
    product.media.find((item) => item.isPrimary) ?? product.media[0] ?? null
  );
}
