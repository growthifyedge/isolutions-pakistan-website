/**
 * Supabase adapters for the Gadgets Stock Update.
 *   reads                               catalog (shared loadCatalogForDelta) + each product's description + every web address
 *   rpc apply_catalog_bulk_import_v2    one new gadget, action "Create" only (draft, server SKU, stock 20)
 *   rpc apply_gadget_stock_product      one gadget's price and/or description (migration 202610260001, not applied yet)
 * The browser never writes a table directly. Writes run only when gadgetUpdateBlocker allows them (switched off today).
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { GadgetUpdateDeps } from "./gadgetStockApply.ts";
import type { GadgetCatalogProduct, GadgetCreatePayload, GadgetRpcPayload, SlugOwner } from "./gadgetStockUpdate.ts";
import { loadCatalogForDelta } from "./stockListDeltaDb.ts";
import { PhoneWriteError } from "./stockUpdateApply.ts";
import { readProductSnapshot } from "./stockUpdateApplyDb.ts";

async function selectPages<T>(page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await page(from, from + 999);
    if (error) throw new Error(error.message);
    rows.push(...(data ?? []));
    if ((data ?? []).length < 1000) return rows;
  }
}

/** Read-only: the real catalog with each product's description, and every product's web address (test products too). */
export async function loadGadgetCatalog(client: SupabaseClient): Promise<{ catalog: GadgetCatalogProduct[]; slugOwners: SlugOwner[] }> {
  const [products, rows] = await Promise.all([
    loadCatalogForDelta(client),
    selectPages<{ id: string; slug: string; title: string; content: string | null }>((from, to) => client.from("products").select("id,slug,title,content").order("id").range(from, to)),
  ]);
  const content = new Map(rows.map((row) => [row.id, row.content] as const));
  return {
    catalog: products.map((product) => ({ ...product, content: content.get(product.id) ?? null })),
    slugOwners: rows.map((row) => ({ slug: row.slug, title: row.title })),
  };
}

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

export function gadgetUpdateDbDeps(client: SupabaseClient): Pick<GadgetUpdateDeps, "readSnapshot" | "applyProduct" | "createProduct"> {
  return {
    readSnapshot: (productId) => readProductSnapshot(client, productId),
    applyProduct: (payload: GadgetRpcPayload) => callRpc<{ status: string }>(client, "apply_gadget_stock_product", { p_product: payload }),
    createProduct: async (payload: GadgetCreatePayload) => {
      if (payload.action !== "Create" || payload.product_type !== "Gadget") throw new PhoneWriteError("Only Create of a Gadget is allowed here", false);
      const result = await callRpc<{ products?: { id: string; title: string; action: string }[]; assigned_skus?: { product: string; sku: string }[] }>(client, "apply_catalog_bulk_import_v2", { p_batch: { products: [payload] } });
      return { products: result.products ?? [], assigned_skus: result.assigned_skus ?? [] };
    },
  };
}
