/**
 * Supabase adapters for bulkPublish.ts. The ONLY write is `products.update({ publication_status: "published" })`,
 * exactly the update the editor's "Validate & publish" performs (minus its flag columns); everything else is a select
 * or the existing read-only validator RPC.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { readCommercialSnapshot } from "./commercialDefaultsDb.ts";
import type { CommercialProduct } from "./commercialDefaults.ts";
import type { PublishDeps, PublishValidation } from "./bulkPublish.ts";

type ProductRecord = {
  id: string;
  title: string;
  slug: string;
  data_class: string | null;
  publication_status: string | null;
  default_pta_status: string;
  default_condition: string;
  brand: { name: string } | null;
};

export async function loadPublishProducts(client: SupabaseClient): Promise<CommercialProduct[]> {
  const products: CommercialProduct[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await client
      .from("products")
      .select("id,title,slug,data_class,publication_status,default_pta_status,default_condition,brand:brands(name)")
      .order("id")
      .range(from, from + 999);
    if (error) throw new Error(error.message);
    const page = (data ?? []) as unknown as ProductRecord[];
    products.push(
      ...page.map((record) => ({
        id: record.id,
        title: record.title,
        slug: record.slug,
        brandName: record.brand?.name ?? null,
        dataClass: record.data_class,
        publicationStatus: record.publication_status,
        defaultPta: record.default_pta_status,
        defaultCondition: record.default_condition,
      })),
    );
    if (page.length < 1000) return products;
  }
}

/** The existing validator (read-only RPC): same call and same row shape as the product editor. */
export async function validateForPublication(client: SupabaseClient, productId: string): Promise<PublishValidation> {
  const { data, error } = await client.rpc("validate_product_for_publication", { p_product_id: productId });
  if (error) throw new Error(error.message);
  const row = (Array.isArray(data) ? data[0] : data) as { is_valid: boolean; errors: string[] | null } | undefined;
  if (!row) throw new Error("The publication validator returned no row.");
  return { isValid: Boolean(row.is_valid), errors: row.errors ?? [] };
}

export function publishDbDeps(client: SupabaseClient): Pick<PublishDeps, "readProduct" | "validate" | "readSnapshot" | "publish"> {
  return {
    readProduct: async (productId) => {
      const { data, error } = await client.from("products").select("*").eq("id", productId).single();
      if (error || !data) throw new Error(error?.message || "product not found");
      const { publication_status: status, published_at: publishedAt, updated_at: _updatedAt, ...fields } = data as Record<string, unknown>;
      void _updatedAt;
      return { publicationStatus: String(status), publishedAt: (publishedAt as string | null) ?? null, fields };
    },
    validate: (productId) => validateForPublication(client, productId),
    readSnapshot: (productId) => readCommercialSnapshot(client, productId),
    publish: async (productId) => {
      const { error } = await client.from("products").update({ publication_status: "published" }).eq("id", productId);
      if (error) throw new Error(error.message);
    },
  };
}
