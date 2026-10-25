/**
 * Supabase adapters for tabletStockApply.ts (Tablets & MacBooks Stock Update -> Update Website).
 *   rpc apply_tablet_stock_product      one existing tablet / MacBook: price / show again / new variants (stock 20)
 *   rpc apply_catalog_bulk_import_v2    one new product, action "Create" only (draft, server SKUs, stock 20)
 * Everything else is a read. The browser never writes a table directly.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { TabletNewProductPayload, TabletRpcPayload } from "./tabletStockUpdate.ts";
import type { TabletRpcResult, TabletUpdateDeps } from "./tabletStockApply.ts";
import { PhoneWriteError } from "./stockUpdateApply.ts";
import { readProductSnapshot } from "./stockUpdateApplyDb.ts";

async function callRpc<T>(client: SupabaseClient, name: string, args: Record<string, unknown>): Promise<T> {
  let response: { data: unknown; error: { message: string } | null };
  try {
    response = await client.rpc(name, args);
  } catch (problem) {
    throw new PhoneWriteError(`No answer from the website (${problem instanceof Error ? problem.message : String(problem)})`, "unknown");
  }
  if (response.error) {
    if (/Failed to fetch|NetworkError|fetch failed/i.test(response.error.message)) throw new PhoneWriteError(`No answer from the website (${response.error.message})`, "unknown");
    throw new PhoneWriteError(response.error.message, false);
  }
  return response.data as T;
}

export function tabletUpdateDbDeps(client: SupabaseClient): Pick<TabletUpdateDeps, "readSnapshot" | "applyProduct" | "createProduct" | "readCreatedProduct"> {
  return {
    readSnapshot: (productId) => readProductSnapshot(client, productId),
    applyProduct: (payload: TabletRpcPayload) => callRpc<TabletRpcResult>(client, "apply_tablet_stock_product", { p_product: payload }),
    createProduct: async (payload: TabletNewProductPayload) => {
      if (payload.action !== "Create") throw new PhoneWriteError("Only Create is allowed for new products", false);
      const result = await callRpc<{ products?: { id: string; title: string; action: string }[]; assigned_skus?: { product: string; sku: string }[] }>(client, "apply_catalog_bulk_import_v2", { p_batch: { products: [payload] } });
      return { products: result.products ?? [], assigned_skus: result.assigned_skus ?? [] };
    },
    readCreatedProduct: async (productId) => {
      const snapshot = await readProductSnapshot(client, productId);
      return {
        publicationStatus: String(snapshot.product.publication_status),
        variants: Object.values(snapshot.variants).map((row) => ({
          sku: String(row.sku),
          ram: (row.ram_display ?? null) as string | null,
          storage: (row.storage_display ?? null) as string | null,
          color: (row.color_finish ?? null) as string | null,
          pta: (row.pta_status ?? null) as string | null,
          delivery: (row.delivery_scope ?? null) as string | null,
          stock: snapshot.stock[String(row.id)] ?? 0,
        })),
      };
    },
  };
}
