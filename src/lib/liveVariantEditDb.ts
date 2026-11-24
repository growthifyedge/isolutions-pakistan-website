/**
 * Supabase adapter for liveVariantEdit.ts. The ONLY write is one call to the existing server-checked Stock Update
 * function for this kind of product (through the Stock Update pages' own adapters); the browser never writes a table.
 * Everything else is a read: the product's variants before the review and after the save.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { iphoneUpdateDbDeps } from "./iphoneStockApplyDb.ts";
import type { LiveReview, LiveVariant } from "./liveVariantEdit.ts";
import { stockUpdateDbDeps } from "./stockUpdateApplyDb.ts";
import { tabletUpdateDbDeps } from "./tabletStockApplyDb.ts";

type VariantRow = {
  id: string;
  sku: string;
  ram_display: string | null;
  storage_display: string | null;
  color_finish: string | null;
  price_minor: number | string;
  compare_at_price_minor: number | string | null;
  is_active: boolean;
  pta_status: string;
  condition: string;
  warranty_override: string | null;
  delivery_scope: string | null;
};

export const toLiveVariant = (row: VariantRow): LiveVariant => ({
  id: row.id,
  sku: row.sku,
  ram: row.ram_display,
  storage: row.storage_display,
  color: row.color_finish,
  priceMinor: Number(row.price_minor),
  compareAtPriceMinor: row.compare_at_price_minor === null ? null : Number(row.compare_at_price_minor),
  isActive: row.is_active,
  ptaStatus: row.pta_status,
  condition: row.condition,
  warrantyOverride: row.warranty_override,
  deliveryScope: row.delivery_scope,
});

export async function readLiveVariants(client: SupabaseClient, productId: string): Promise<LiveVariant[]> {
  const { data, error } = await client
    .from("product_variants")
    .select("id,sku,ram_display,storage_display,color_finish,price_minor,compare_at_price_minor,is_active,pta_status,condition,warranty_override,delivery_scope,sort_order")
    .eq("product_id", productId)
    .order("sort_order");
  if (error) throw new Error(`Could not read the variants: ${error.message}`);
  return ((data ?? []) as VariantRow[]).map(toLiveVariant);
}

/** ONE call to the product's Stock Update function. Throws PhoneWriteError (saved: false = nothing saved; "unknown" = no answer). */
export async function saveLiveReview(client: SupabaseClient, review: LiveReview): Promise<unknown> {
  if (!review.payload) throw new Error("Nothing to save.");
  if (review.payload.kind === "android") return stockUpdateDbDeps(client).applyPhone(review.payload.payload);
  if (review.payload.kind === "iphone") return iphoneUpdateDbDeps(client).applyPhone(review.payload.payload);
  return tabletUpdateDbDeps(client).applyProduct(review.payload.payload);
}
