/**
 * Supabase adapters for iphoneStockApply.ts (iPhone Stock Update -> Update Website).
 *   rpc apply_iphone_stock_phone        one existing iPhone product: price / show again / new variants (stock 20)
 *   rpc apply_catalog_bulk_import_v2    one new iPhone product, action "Create" only (draft, server SKUs, stock 20)
 * Everything else is a read. The browser never writes a table directly.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { IphoneNewPhonePayload, IphoneRpcPayload } from "./iphoneStockUpdate.ts";
import type { IphoneRpcResult, IphoneUpdateDeps } from "./iphoneStockApply.ts";
import { PhoneWriteError } from "./stockUpdateApply.ts";
import { readProductSnapshot } from "./stockUpdateApplyDb.ts";
import type { CatalogDeltaProduct } from "./stockListDelta.ts";

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

/** Read-only: every variant's stored SIM (the shared Android catalog loader does not read it). */
export async function loadVariantSims(client: SupabaseClient): Promise<Map<string, string | null>> {
  const sims = new Map<string, string | null>();
  for (let from = 0; ; from += 1000) {
    const { data, error } = await client.from("product_variants").select("id,sim_configuration").order("id").range(from, from + 999);
    if (error) throw new Error(error.message);
    const page = (data ?? []) as { id: string; sim_configuration: string | null }[];
    for (const row of page) sims.set(row.id, row.sim_configuration);
    if (page.length < 1000) return sims;
  }
}

/** The catalog with each variant's stored SIM attached (for the SIM conflict check). */
export const withVariantSims = (products: CatalogDeltaProduct[], sims: ReadonlyMap<string, string | null>): CatalogDeltaProduct[] =>
  products.map((product) => ({ ...product, variants: product.variants.map((variant) => ({ ...variant, simConfiguration: sims.has(variant.id) ? sims.get(variant.id) ?? null : undefined })) }));

export function iphoneUpdateDbDeps(client: SupabaseClient): Pick<IphoneUpdateDeps, "readSnapshot" | "applyPhone" | "createPhone" | "readCreatedPhone"> {
  return {
    readSnapshot: (productId) => readProductSnapshot(client, productId),
    applyPhone: (payload: IphoneRpcPayload) => callRpc<IphoneRpcResult>(client, "apply_iphone_stock_phone", { p_phone: payload }),
    createPhone: async (payload: IphoneNewPhonePayload) => {
      if (payload.action !== "Create") throw new PhoneWriteError("Only Create is allowed for new phones", false);
      const result = await callRpc<{ products?: { id: string; title: string; action: string }[]; assigned_skus?: { product: string; sku: string }[] }>(client, "apply_catalog_bulk_import_v2", { p_batch: { products: [payload] } });
      return { products: result.products ?? [], assigned_skus: result.assigned_skus ?? [] };
    },
    readCreatedPhone: async (productId) => {
      const snapshot = await readProductSnapshot(client, productId);
      const variants = Object.values(snapshot.variants);
      return {
        publicationStatus: String(snapshot.product.publication_status),
        variantCount: variants.length,
        skus: variants.map((row) => String(row.sku)),
        stock: variants.map((row) => snapshot.stock[String(row.id)] ?? 0),
        sims: variants.map((row) => (row.sim_configuration ?? null) as string | null),
      };
    },
  };
}
