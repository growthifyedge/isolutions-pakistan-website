/**
 * Supabase adapter for variantEditor.ts. The ONLY write is one call to public.apply_product_variant_edits (Owner only,
 * all or nothing, verified by the server). Everything else is a read; the browser never writes a table directly.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { EditPayload, EditorVariant } from "./variantEditor.ts";

export class VariantSaveError extends Error {
  /** false = the server refused (nothing saved); "unknown" = no answer (may or may not be saved). */
  readonly saved: false | "unknown";
  constructor(message: string, saved: false | "unknown") {
    super(message);
    this.name = "VariantSaveError";
    this.saved = saved;
  }
}

export async function readEditorVariants(client: SupabaseClient, productId: string): Promise<EditorVariant[]> {
  const [variants, stock] = await Promise.all([
    client
      .from("product_variants")
      .select("id,sku,ram_display,storage_display,color_finish,price_minor,compare_at_price_minor,pta_status,condition,warranty_override,delivery_scope,is_active,sort_order")
      .eq("product_id", productId)
      .order("sort_order")
      .order("sku"),
    client.from("admin_variant_inventory").select("variant_id,quantity_on_hand").eq("product_id", productId),
  ]);
  if (variants.error) throw new Error(`Could not read the variants: ${variants.error.message}`);
  if (stock.error) throw new Error(`Could not read the stock: ${stock.error.message}`);
  const onHand = new Map((stock.data ?? []).map((row) => [String(row.variant_id), Number(row.quantity_on_hand)]));
  return (variants.data ?? []).map((row) => ({
    id: String(row.id),
    sku: String(row.sku),
    ram_display: row.ram_display ?? null,
    storage_display: row.storage_display ?? null,
    color_finish: row.color_finish ?? null,
    price_minor: Number(row.price_minor),
    compare_at_price_minor: row.compare_at_price_minor === null ? null : Number(row.compare_at_price_minor),
    pta_status: String(row.pta_status),
    condition: String(row.condition),
    warranty_override: row.warranty_override ?? null,
    delivery_scope: row.delivery_scope ?? null,
    is_active: Boolean(row.is_active),
    stock: onHand.get(String(row.id)) ?? 0,
  }));
}

/** True only for the active Owner profile (the server checks this again on every save). */
export async function readIsOwner(client: SupabaseClient): Promise<boolean> {
  const { data, error } = await client.rpc("is_site_owner");
  return !error && data === true;
}

export async function saveVariantEdits(client: SupabaseClient, payload: EditPayload): Promise<unknown> {
  let response: { data: unknown; error: { message: string } | null };
  try {
    response = await client.rpc("apply_product_variant_edits", { p_edit: payload });
  } catch (problem) {
    throw new VariantSaveError(`No answer from the website (${problem instanceof Error ? problem.message : String(problem)})`, "unknown");
  }
  if (response.error) {
    if (/Failed to fetch|NetworkError|fetch failed/i.test(response.error.message)) throw new VariantSaveError(`No answer from the website (${response.error.message})`, "unknown");
    throw new VariantSaveError(response.error.message, false);
  }
  return response.data;
}
