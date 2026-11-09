/**
 * Supabase adapter for the Home Gadgets subcategory bulk assignment. Reads products / SKUs / subcategories for the
 * preview; the only write is the admin_assign_product_subcategories RPC (202611090001), which re-validates every row on
 * the server, is all-or-nothing and changes only products.subcategory_id. Uses the signed-in admin session.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { SubCatalogProduct, SubcategoryRef, SubReadBack, SubUploadDeps } from "./subcategoryAssignment.ts";

const PAGE = 1000;

/** Raised when the database has no subcategory table / column yet (migration 202611090001 not applied). */
export class SubcategoriesUnavailableError extends Error {}

export async function loadSubcategoryCatalog(client: SupabaseClient): Promise<{ products: SubCatalogProduct[]; subcategories: SubcategoryRef[] }> {
  const subs = await client.from("product_subcategories").select("id,name,slug,is_active,category:categories(slug)").order("sort_order");
  if (subs.error) throw new SubcategoriesUnavailableError(`Subcategories are not available on this database yet (migration 202611090001 not applied): ${subs.error.message}`);
  const products: SubCatalogProduct[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await client
      .from("products")
      .select("id,title,publication_status,subcategory_id,category:categories(slug),product_variants(sku)")
      .order("id")
      .range(from, from + PAGE - 1);
    if (error) throw new SubcategoriesUnavailableError(`Products could not be read with their subcategory: ${error.message}`);
    for (const row of (data ?? []) as unknown as {
      id: string; title: string; publication_status: string; subcategory_id: string | null;
      category: { slug: string } | null; product_variants: { sku: string | null }[];
    }[]) {
      products.push({
        id: row.id,
        title: row.title,
        publication_status: row.publication_status,
        categorySlug: row.category?.slug ?? null,
        subcategoryId: row.subcategory_id,
        skus: row.product_variants.map((variant) => variant.sku).filter((sku): sku is string => Boolean(sku)),
      });
    }
    if (!data || data.length < PAGE) break;
  }
  const subcategories = ((subs.data ?? []) as unknown as { id: string; name: string; slug: string; is_active: boolean; category: { slug: string } | null }[])
    .map((row) => ({ id: row.id, name: row.name, slug: row.slug, is_active: row.is_active, categorySlug: row.category?.slug ?? null }));
  return { products, subcategories };
}

export function subcategoryUploadDbDeps(client: SupabaseClient): Pick<SubUploadDeps, "assign" | "readBack"> {
  return {
    assign: async (payload) => {
      const { data, error } = await client.rpc("admin_assign_product_subcategories", { p_assignments: payload });
      if (error) throw new Error(error.message);
      return data as { total: number; updated: number; unchanged: number };
    },
    readBack: async (productIds) => {
      const rows: SubReadBack[] = [];
      for (let index = 0; index < productIds.length; index += 200) {
        const { data, error } = await client
          .from("products")
          .select("id,subcategory_id,publication_status")
          .in("id", productIds.slice(index, index + 200));
        if (error) throw new Error(error.message);
        rows.push(...((data ?? []) as { id: string; subcategory_id: string | null; publication_status: string }[])
          .map((row) => ({ id: row.id, subcategoryId: row.subcategory_id, publication_status: row.publication_status })));
      }
      return rows;
    },
  };
}
