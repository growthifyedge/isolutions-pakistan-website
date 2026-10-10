/**
 * Supabase adapters for commercialDefaults.ts. The ONLY writes are product_variants.pta_status/condition and
 * products.default_pta_status/default_condition; every other call is a select.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { CommercialDeps, CommercialSnapshot, CommercialVariant } from "./commercialDefaults.ts";

export const VARIANT_COLUMNS =
  "id,product_id,sku,ram_display,storage_display,color_finish,carrier_jv,price_minor,compare_at_price_minor,pta_status,condition,condition_grade,battery_health_percent,battery_cycle_count,sim_configuration,warranty_override,delivery_scope,is_active,sort_order";

export async function readCommercialSnapshot(client: SupabaseClient, productId: string): Promise<CommercialSnapshot> {
  const variantResult = await client.from("product_variants").select(VARIANT_COLUMNS).eq("product_id", productId);
  if (variantResult.error) throw new Error(variantResult.error.message);
  const variants = (variantResult.data ?? []) as unknown as CommercialVariant[];
  const media = await client.from("product_media").select("id", { count: "exact", head: true }).eq("product_id", productId);
  if (media.error) throw new Error(media.error.message);
  let stockRows = 0;
  let stockSum = 0;
  if (variants.length) {
    const stock = await client.from("inventory_movements").select("quantity_delta").in("variant_id", variants.map((variant) => variant.id));
    if (stock.error) throw new Error(stock.error.message);
    for (const row of (stock.data ?? []) as { quantity_delta: number }[]) {
      stockRows += 1;
      stockSum += row.quantity_delta;
    }
  }
  return { variants, mediaCount: media.count ?? 0, stockRows, stockSum };
}

export function commercialDbDeps(client: SupabaseClient): Pick<CommercialDeps, "readSnapshot" | "readProduct" | "updateVariants" | "updateProductDefaults"> {
  return {
    readSnapshot: (productId) => readCommercialSnapshot(client, productId),
    readProduct: async (productId) => {
      const { data, error } = await client.from("products").select("default_pta_status,default_condition").eq("id", productId).single();
      if (error || !data) throw new Error(error?.message || "product not found");
      return { defaultPta: data.default_pta_status as string, defaultCondition: data.default_condition as string };
    },
    updateVariants: async (productId, variantIds, values) => {
      const { error } = await client.from("product_variants").update(values).eq("product_id", productId).in("id", variantIds);
      if (error) throw new Error(error.message);
    },
    updateProductDefaults: async (productId, values) => {
      const { error } = await client.from("products").update(values).eq("id", productId);
      if (error) throw new Error(error.message);
    },
  };
}
