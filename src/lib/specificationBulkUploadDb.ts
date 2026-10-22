/**
 * Supabase adapter for the Specifications Bulk Upload save: ONE call per product to apply_product_specifications
 * (migration 202610230001), which inserts new rows and updates ticked values in a single transaction.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { SpecUploadDeps } from "./specificationBulkUpload.ts";

export function specificationUploadSaveDeps(client: SupabaseClient): Pick<SpecUploadDeps, "applyProductSpecs"> {
  return {
    applyProductSpecs: async (productId, inserts, updates) => {
      const { data, error } = await client.rpc("apply_product_specifications", { p_product_id: productId, p_inserts: inserts, p_updates: updates });
      if (error) throw new Error(error.message);
      const saved = (data ?? {}) as { inserted?: number; updated?: number };
      return { inserted: Number(saved.inserted ?? 0), updated: Number(saved.updated ?? 0) };
    },
  };
}
