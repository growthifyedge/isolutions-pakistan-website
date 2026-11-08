/**
 * Supabase adapter for Descriptions Bulk Upload. The only write is products.update({ content[, short_description] })
 * for one product id — never publication_status. Uses the signed-in admin session and the existing RLS policies.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { readCommercialSnapshot } from "./commercialDefaultsDb.ts";
import type { DescCatalogProduct, DescUploadDeps } from "./descriptionBulkUpload.ts";

const PRODUCT_COLUMNS = "id,title,slug,content,short_description,publication_status";
const PAGE = 1000;

/** Every product (any category or status) the admin can read, for exact ID / slug matching. */
export async function loadDescriptionCatalog(client: SupabaseClient): Promise<DescCatalogProduct[]> {
  const products: DescCatalogProduct[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await client.from("products").select(PRODUCT_COLUMNS).order("id").range(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    products.push(...((data ?? []) as DescCatalogProduct[]));
    if (!data || data.length < PAGE) break;
  }
  return products;
}

export function descriptionUploadDbDeps(client: SupabaseClient): Pick<DescUploadDeps, "readProduct" | "readSnapshot" | "updateDescription"> {
  return {
    readProduct: async (productId) => {
      const { data, error } = await client.from("products").select("content,short_description,publication_status").eq("id", productId).single();
      if (error || !data) throw new Error(error?.message || "product not found");
      return data as { content: string | null; short_description: string | null; publication_status: string };
    },
    readSnapshot: async (productId) => {
      const commercial = await readCommercialSnapshot(client, productId);
      const specs = await client.from("product_specifications").select("id", { count: "exact", head: true }).eq("product_id", productId);
      if (specs.error) throw new Error(specs.error.message);
      const variants = [...commercial.variants].sort((a, b) => String(a.id).localeCompare(String(b.id)));
      return JSON.stringify({ ...commercial, variants, specCount: specs.count ?? 0 });
    },
    updateDescription: async (productId, patch) => {
      const values: { content: string; short_description?: string } = { content: patch.content };
      if (patch.short_description) values.short_description = patch.short_description;
      const { data, error } = await client.from("products").update(values).eq("id", productId).select("id");
      if (error) throw new Error(error.message);
      if (!data || data.length !== 1) throw new Error("The product was not updated (no permission or not found).");
    },
  };
}
