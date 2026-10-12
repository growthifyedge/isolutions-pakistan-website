/**
 * Read-only Supabase adapter for stockListDelta.ts. Every call here is a select; the Stock List Update tool
 * performs no write in this phase.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { BrandReference } from "./catalogSheet.ts";
import type { CatalogDeltaProduct, CatalogDeltaVariant } from "./stockListDelta.ts";

const PAGE = 1000;

async function selectAll<T>(read: (from: number, to: number) => PromiseLike<{ data: unknown; error: { message: string } | null }>): Promise<T[]> {
  const all: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await read(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    const page = (data ?? []) as T[];
    all.push(...page);
    if (page.length < PAGE) return all;
  }
}

export async function loadActiveBrands(client: SupabaseClient): Promise<BrandReference[]> {
  const rows = await selectAll<{ name: string }>((from, to) =>
    client.from("brands").select("name").eq("is_active", true).eq("data_class", "real").order("name").range(from, to),
  );
  return rows.map((row) => ({ name: row.name }));
}

type ProductRow = {
  id: string;
  slug: string;
  title: string;
  publication_status: string | null;
  brand: { name: string } | null;
  category: { name: string } | null;
};

type VariantRow = {
  id: string;
  product_id: string;
  sku: string;
  ram_display: string | null;
  storage_display: string | null;
  color_finish: string | null;
  price_minor: number;
  compare_at_price_minor: number | null;
  pta_status: string | null;
  condition: string | null;
  condition_grade: string | null;
  battery_health_percent: number | null;
  battery_cycle_count: number | null;
  is_active: boolean;
};

/** Every real product with its variants, media count, specification count and current stock. */
export async function loadCatalogForDelta(client: SupabaseClient): Promise<CatalogDeltaProduct[]> {
  const products = await selectAll<ProductRow>((from, to) =>
    client
      .from("products")
      .select("id,slug,title,publication_status,brand:brands(name),category:categories(name)")
      .eq("data_class", "real")
      .order("id")
      .range(from, to),
  );
  const variants = await selectAll<VariantRow>((from, to) =>
    client
      .from("product_variants")
      .select("id,product_id,sku,ram_display,storage_display,color_finish,price_minor,compare_at_price_minor,pta_status,condition,condition_grade,battery_health_percent,battery_cycle_count,is_active")
      .order("id")
      .range(from, to),
  );
  const media = await selectAll<{ product_id: string }>((from, to) => client.from("product_media").select("product_id").order("id").range(from, to));
  const specs = await selectAll<{ product_id: string }>((from, to) => client.from("product_specifications").select("product_id").order("id").range(from, to));
  const movements = await selectAll<{ variant_id: string; quantity_delta: number }>((from, to) =>
    client.from("inventory_movements").select("variant_id,quantity_delta").order("id").range(from, to),
  );

  const count = (rows: { product_id: string }[]) => {
    const map = new Map<string, number>();
    for (const row of rows) map.set(row.product_id, (map.get(row.product_id) ?? 0) + 1);
    return map;
  };
  const mediaCount = count(media);
  const specCount = count(specs);
  const stock = new Map<string, number>();
  for (const row of movements) stock.set(row.variant_id, (stock.get(row.variant_id) ?? 0) + row.quantity_delta);

  const variantsByProduct = new Map<string, CatalogDeltaVariant[]>();
  for (const row of variants) {
    const variant: CatalogDeltaVariant = {
      id: row.id,
      sku: row.sku,
      ram: row.ram_display,
      storage: row.storage_display,
      color: row.color_finish,
      priceMinor: Number(row.price_minor),
      compareAtPriceMinor: row.compare_at_price_minor === null ? null : Number(row.compare_at_price_minor),
      stock: stock.get(row.id) ?? 0,
      ptaStatus: row.pta_status,
      condition: row.condition,
      conditionGrade: row.condition_grade,
      batteryHealth: row.battery_health_percent,
      cycleCount: row.battery_cycle_count,
      isActive: row.is_active,
    };
    variantsByProduct.set(row.product_id, [...(variantsByProduct.get(row.product_id) ?? []), variant]);
  }

  return products.map((product) => ({
    id: product.id,
    slug: product.slug,
    title: product.title,
    brand: product.brand?.name ?? null,
    category: product.category?.name ?? null,
    publicationStatus: product.publication_status,
    mediaCount: mediaCount.get(product.id) ?? 0,
    specCount: specCount.get(product.id) ?? 0,
    variants: variantsByProduct.get(product.id) ?? [],
  }));
}
