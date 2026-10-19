/**
 * Supabase adapters for stockUpdateApply.ts (Android Stock Update -> Update Website).
 * Every write is ONE database call per phone, and the database saves all of that phone's changes or none:
 *   rpc apply_android_stock_phone        one existing Android phone: price / show / hide / stock 30 / new variants
 *   rpc apply_catalog_bulk_import_v2     one new phone, action "Create" only (draft, server SKUs, stock 30)
 * Everything else here is a read (before / after copies for the read-back check). The browser never writes a table directly.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { PhoneWriteError, type NewPhonePayload, type PhoneRpcPayload, type PhoneRpcResult, type ProductSnapshot, type StockUpdateDeps } from "./stockUpdateApply.ts";

const must = <T,>(result: { data: T | null; error: { message: string } | null }, what: string): T => {
  if (result.error) throw new Error(`${what}: ${result.error.message}`);
  if (result.data === null) throw new Error(`${what}: no data`);
  return result.data;
};

export async function readProductSnapshot(client: SupabaseClient, productId: string): Promise<ProductSnapshot> {
  const product = must(await client.from("products").select("*").eq("id", productId).single(), "read product") as Record<string, unknown>;
  const media = must(await client.from("product_media").select("*").eq("product_id", productId), "read media") as Record<string, unknown>[];
  const specifications = must(await client.from("product_specifications").select("*").eq("product_id", productId), "read specifications") as Record<string, unknown>[];
  const variantRows = must(await client.from("product_variants").select("*").eq("product_id", productId), "read variants") as Record<string, unknown>[];
  const ids = variantRows.map((row) => String(row.id));
  const movements = ids.length
    ? (must(await client.from("inventory_movements").select("variant_id,quantity_delta").in("variant_id", ids), "read stock") as { variant_id: string; quantity_delta: number }[])
    : [];
  const stock: Record<string, number> = Object.fromEntries(ids.map((id) => [id, 0]));
  for (const row of movements) stock[row.variant_id] = (stock[row.variant_id] ?? 0) + Number(row.quantity_delta);
  return { productId, product, media, specifications, variants: Object.fromEntries(variantRows.map((row) => [String(row.id), row])), stock };
}

/**
 * One RPC call. An error answer from the database means its transaction rolled back (nothing saved);
 * a thrown request (no answer) means we cannot know, so the phone is reported as "check again".
 */
async function callRpc<T>(client: SupabaseClient, name: string, args: Record<string, unknown>): Promise<T> {
  let response: { data: unknown; error: { message: string } | null };
  try {
    response = await client.rpc(name, args);
  } catch (problem) {
    throw new PhoneWriteError(`No answer from the website (${problem instanceof Error ? problem.message : String(problem)})`, "unknown");
  }
  if (response.error) {
    // PostgREST answers a failed fetch with an error that has no database message; treat that as "no answer" too.
    if (/Failed to fetch|NetworkError|fetch failed/i.test(response.error.message)) throw new PhoneWriteError(`No answer from the website (${response.error.message})`, "unknown");
    throw new PhoneWriteError(response.error.message, false);
  }
  return response.data as T;
}

export function stockUpdateDbDeps(client: SupabaseClient): Pick<StockUpdateDeps, "readSnapshot" | "applyPhone" | "createPhone" | "readCreatedPhone"> {
  return {
    readSnapshot: (productId) => readProductSnapshot(client, productId),
    applyPhone: (payload: PhoneRpcPayload) => callRpc<PhoneRpcResult>(client, "apply_android_stock_phone", { p_phone: payload }),
    createPhone: async (payload: NewPhonePayload) => {
      if (payload.action !== "Create") throw new PhoneWriteError("Only Create is allowed for new phones", false);
      const result = await callRpc<{ products?: { id: string; title: string; action: string }[]; assigned_skus?: { product: string; sku: string }[] }>(client, "apply_catalog_bulk_import_v2", { p_batch: { products: [payload] } });
      return { products: result.products ?? [], assigned_skus: result.assigned_skus ?? [] };
    },
    readCreatedPhone: async (productId) => {
      const product = must(await client.from("products").select("publication_status").eq("id", productId).single(), "read new phone") as { publication_status: string };
      const variants = must(await client.from("product_variants").select("sku").eq("product_id", productId), "read new phone variants") as { sku: string }[];
      return { publicationStatus: product.publication_status, variantCount: variants.length, skus: variants.map((row) => row.sku) };
    },
  };
}
