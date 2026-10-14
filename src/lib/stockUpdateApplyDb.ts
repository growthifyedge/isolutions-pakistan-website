/**
 * Supabase adapters for stockUpdateApply.ts (Android Stock Update -> Update Website). NOT wired to the page yet.
 * The ONLY writes, all under the existing catalog-admin RLS:
 *   product_variants.update({ price_minor })        price changes
 *   product_variants.update({ is_active })          hide / show again
 *   product_variants.insert(one new variant row)    new variant (sku "" -> the database assigns MB###)
 *   inventory_movements.insert(opening stock)       new variant stock (30)
 *   inventory_movements.insert('correction')        set an existing visible variant's stock to 30
 *   rpc apply_catalog_bulk_import_v2 ("Create")     new phones (draft, atomic)
 * There is no delete, no products / product_media / product_specifications write for existing phones.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { NewPhonePayload, ProductSnapshot, StockUpdateDeps } from "./stockUpdateApply.ts";

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

export function stockUpdateDbDeps(client: SupabaseClient): Pick<StockUpdateDeps, "readSnapshot" | "updatePrice" | "setActive" | "insertVariant" | "insertOpeningStock" | "readStock" | "adjustStock" | "createPhones" | "readCreatedPhone"> {
  return {
    readSnapshot: (productId) => readProductSnapshot(client, productId),
    updatePrice: async (variantId, priceMinor) => {
      const { error } = await client.from("product_variants").update({ price_minor: priceMinor }).eq("id", variantId);
      if (error) throw new Error(error.message);
    },
    setActive: async (variantIds, productId, isActive) => {
      const { error } = await client.from("product_variants").update({ is_active: isActive }).eq("product_id", productId).in("id", variantIds);
      if (error) throw new Error(error.message);
    },
    insertVariant: async (productId, values) => {
      const { data, error } = await client
        .from("product_variants")
        .insert({
          product_id: productId,
          sku: "",
          ram_display: values.ram,
          storage_display: values.storage,
          color_finish: values.color,
          price_minor: values.priceMinor,
          pta_status: values.inherited.ptaStatus,
          condition: values.inherited.condition,
          warranty_override: values.inherited.warrantyOverride,
          delivery_scope: values.inherited.deliveryScope,
          is_active: true,
        })
        .select("id,sku")
        .single();
      if (error || !data) throw new Error(error?.message ?? "variant was not created");
      return { id: String(data.id), sku: String(data.sku) };
    },
    insertOpeningStock: async (variantId, quantity) => {
      const { data: auth } = await client.auth.getUser();
      const { error } = await client.from("inventory_movements").insert({ variant_id: variantId, quantity_delta: quantity, reason: "initial", reference: "android_stock_update", note: "Android Stock Update opening stock", actor_id: auth.user?.id });
      if (error) throw new Error(error.message);
    },
    readStock: async (variantId) => {
      const rows = must(await client.from("inventory_movements").select("quantity_delta").eq("variant_id", variantId), "read stock") as { quantity_delta: number }[];
      return rows.reduce((sum, row) => sum + Number(row.quantity_delta), 0);
    },
    adjustStock: async (variantId, delta) => {
      if (!Number.isInteger(delta) || delta === 0) throw new Error("stock correction must be a non-zero whole number");
      const { data: auth } = await client.auth.getUser();
      const { error } = await client.from("inventory_movements").insert({ variant_id: variantId, quantity_delta: delta, reason: "correction", reference: "android_stock_update", note: "Android Stock Update: stock set to 30", actor_id: auth.user?.id });
      if (error) throw new Error(error.message);
    },
    createPhones: async (products: NewPhonePayload[]) => {
      if (products.some((product) => product.action !== "Create")) throw new Error("Only Create is allowed for new phones");
      const { data, error } = await client.rpc("apply_catalog_bulk_import_v2", { p_batch: { products } });
      if (error) throw new Error(error.message);
      const result = data as { products?: { id: string; title: string; action: string }[]; assigned_skus?: { product: string; sku: string }[] };
      return { products: result.products ?? [], assigned_skus: result.assigned_skus ?? [] };
    },
    readCreatedPhone: async (productId) => {
      const product = must(await client.from("products").select("publication_status").eq("id", productId).single(), "read new phone") as { publication_status: string };
      const variants = must(await client.from("product_variants").select("sku").eq("product_id", productId), "read new phone variants") as { sku: string }[];
      return { publicationStatus: product.publication_status, variantCount: variants.length, skus: variants.map((row) => row.sku) };
    },
  };
}
