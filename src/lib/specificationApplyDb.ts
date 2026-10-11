/**
 * Supabase adapters for specificationApply.ts. The ONLY writes are on public.product_specifications:
 * an INSERT of new rows and an UPDATE of one existing row's `value`. Everything else is a select.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { readCommercialSnapshot } from "./commercialDefaultsDb.ts";
import { loadPublishProducts } from "./bulkPublishDb.ts";
import { selectAndroidBatch } from "./commercialDefaults.ts";
import type { CatalogSpecProduct, ExistingSpec, SpecApplyDeps } from "./specificationApply.ts";

const SPEC_COLUMNS = "id,product_id,specification_group,label,value,sort_order";

/** Read-only: every catalog product (so slug uniqueness is judged against the whole catalog) and the Android batch ids. */
export async function loadSpecificationCatalog(client: SupabaseClient): Promise<{ catalog: CatalogSpecProduct[]; batchIds: Set<string> }> {
  const all = await loadPublishProducts(client);
  const batch = selectAndroidBatch(all);
  return { catalog: all.map((product) => ({ id: product.id, slug: product.slug, title: product.title })), batchIds: new Set(batch.targets.map((product) => product.id)) };
}

/** Read-only: stored specification rows of the given products. */
export async function loadExistingSpecs(client: SupabaseClient, productIds: readonly string[]): Promise<ExistingSpec[]> {
  const rows: ExistingSpec[] = [];
  for (let index = 0; index < productIds.length; index += 40) {
    for (let from = 0; ; from += 1000) {
      const { data, error } = await client
        .from("product_specifications")
        .select(SPEC_COLUMNS)
        .in("product_id", productIds.slice(index, index + 40))
        .order("id")
        .range(from, from + 999);
      if (error) throw new Error(error.message);
      const page = (data ?? []) as unknown as ExistingSpec[];
      rows.push(...page);
      if (page.length < 1000) break;
    }
  }
  return rows;
}

export function specificationApplyDbDeps(client: SupabaseClient): Pick<SpecApplyDeps, "readSpecs" | "readProduct" | "readSnapshot" | "insertSpecs" | "updateSpecValue"> {
  return {
    readSpecs: (productId) => loadExistingSpecs(client, [productId]),
    readProduct: async (productId) => {
      const { data, error } = await client.from("products").select("*").eq("id", productId).single();
      if (error || !data) throw new Error(error?.message || "product not found");
      return data as Record<string, unknown>;
    },
    readSnapshot: (productId) => readCommercialSnapshot(client, productId),
    insertSpecs: async (productId, rows) => {
      const { error } = await client.from("product_specifications").insert(rows.map((row) => ({ product_id: productId, ...row })));
      if (error) throw new Error(error.message);
    },
    updateSpecValue: async (id, value) => {
      const { error } = await client.from("product_specifications").update({ value }).eq("id", id);
      if (error) throw new Error(error.message);
    },
  };
}
