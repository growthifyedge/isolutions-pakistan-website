/**
 * Supabase adapter for Add Product (Gadgets / Mobile Accessories). Uses the signed-in admin session and the existing RLS
 * policies and server functions only:
 *   - apply_catalog_bulk_import_v2 (existing): one atomic Create (real Draft, server SKUs, opening stock, specifications),
 *     with the server's own admin check and duplicate refusal (name + brand, web address).
 *   - products.update({ content, short_description }) on the new product while it is still a Draft (never a status change).
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { CreatedProductReadBack, ExistingCatalogProduct, ManualCreateDeps } from "./manualProduct.ts";

const PAGE = 1000;

export async function loadAddProductContext(client: SupabaseClient): Promise<{ catalog: ExistingCatalogProduct[]; brands: string[] }> {
  const catalog: ExistingCatalogProduct[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await client.from("products").select("id,title,slug,brand:brands(name)").order("id").range(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    for (const row of (data ?? []) as unknown as { id: string; title: string; slug: string; brand: { name: string } | { name: string }[] | null }[]) {
      const brand = Array.isArray(row.brand) ? row.brand[0] ?? null : row.brand;
      catalog.push({ id: row.id, title: row.title, slug: row.slug, brandName: brand?.name ?? null });
    }
    if (!data || data.length < PAGE) break;
  }
  const brands = await client.from("brands").select("name").eq("data_class", "real").eq("is_active", true).order("name");
  if (brands.error) throw new Error(brands.error.message);
  return { catalog, brands: (brands.data ?? []).map((row) => row.name as string) };
}

export function manualCreateDbDeps(client: SupabaseClient): Pick<ManualCreateDeps, "createProduct" | "saveDescription" | "readBack"> {
  return {
    createProduct: async (payload) => {
      const { data, error } = await client.rpc("apply_catalog_bulk_import_v2", { p_batch: payload });
      if (error) throw new Error([error.message, error.details].filter(Boolean).join(" — "));
      return data as { products: { id: string; title: string; action: string }[]; assigned_skus: { sku: string }[] };
    },
    saveDescription: async (productId, values) => {
      const { data, error } = await client.from("products").update(values).eq("id", productId).eq("publication_status", "draft").select("id");
      if (error) throw new Error(error.message);
      if (!data || data.length !== 1) throw new Error("the new Draft product was not found");
    },
    readBack: async (productId) => {
      const product = await client
        .from("products")
        .select("id,title,slug,publication_status,data_class,content,short_description,category:categories(slug)")
        .eq("id", productId)
        .single();
      if (product.error || !product.data) throw new Error(product.error?.message || "product not found");
      const variants = await client.from("product_variants").select("id,sku,ram_display,storage_display,color_finish,price_minor,pta_status,condition,warranty_override,delivery_scope").eq("product_id", productId).order("sku");
      if (variants.error) throw new Error(variants.error.message);
      const ids = (variants.data ?? []).map((row) => row.id as string);
      const stock = ids.length ? await client.from("admin_variant_inventory").select("variant_id,quantity_on_hand").in("variant_id", ids) : { data: [], error: null };
      if (stock.error) throw new Error(stock.error.message);
      const onHand = new Map((stock.data ?? []).map((row) => [row.variant_id as string, Number(row.quantity_on_hand)]));
      const specs = await client.from("product_specifications").select("id", { count: "exact", head: true }).eq("product_id", productId);
      if (specs.error) throw new Error(specs.error.message);
      const row = product.data as unknown as Omit<CreatedProductReadBack, "category_slug" | "variants" | "spec_count"> & { category: { slug: string } | { slug: string }[] | null };
      const category = Array.isArray(row.category) ? row.category[0] ?? null : row.category;
      return {
        id: row.id,
        title: row.title,
        slug: row.slug,
        publication_status: row.publication_status,
        data_class: row.data_class,
        content: row.content,
        short_description: row.short_description,
        category_slug: category?.slug ?? null,
        variants: (variants.data ?? []).map((variant) => ({
          sku: variant.sku as string,
          ram: (variant.ram_display as string | null) ?? null,
          storage: (variant.storage_display as string | null) ?? null,
          color: (variant.color_finish as string | null) ?? null,
          pta_status: variant.pta_status as string,
          condition: variant.condition as string,
          warranty_override: (variant.warranty_override as string | null) ?? null,
          delivery_scope: (variant.delivery_scope as string | null) ?? null,
          price_minor: Number(variant.price_minor),
          on_hand: onHand.get(variant.id as string) ?? 0,
        })),
        spec_count: specs.count ?? 0,
      };
    },
  };
}
