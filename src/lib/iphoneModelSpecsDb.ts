/**
 * Supabase adapter for Model-Based Shared Specifications (iPhone + Android). Reads are plain Admin reads (RLS applies);
 * the only write is apply_model_common_specifications (migration 202611200002, Owner only, add-only).
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { loadExistingSpecs } from "./specificationApplyDb.ts";
import type { ExistingSpec } from "./specificationApply.ts";
import type { IphoneCatalogProduct, ModelSpec } from "./iphoneModelSpecs.ts";
import { modelSpecPayload } from "./iphoneModelSpecs.ts";

type ProductRecord = {
  id: string;
  title: string;
  slug: string;
  publication_status: string;
  brand: { slug: string } | null;
  category: { slug: string } | null;
  variants: { condition: string; pta_status: string }[] | null;
};

/** Every phone in Mobile Phones, any brand (drafts included), with distinct variant condition / PTA for display. */
export async function loadIphoneCatalog(client: SupabaseClient): Promise<IphoneCatalogProduct[]> {
  const products: IphoneCatalogProduct[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await client
      .from("products")
      .select("id,title,slug,publication_status,brand:brands!inner(slug),category:categories!inner(slug),variants:product_variants(condition,pta_status)")
      .eq("category.slug", "mobile-phones")
      .order("id")
      .range(from, from + 999);
    if (error) throw new Error(error.message);
    const page = (data ?? []) as unknown as ProductRecord[];
    products.push(
      ...page.map((record) => ({
        id: record.id,
        title: record.title,
        slug: record.slug,
        brandSlug: record.brand?.slug ?? null,
        categorySlug: record.category?.slug ?? null,
        publicationStatus: record.publication_status,
        conditions: [...new Set((record.variants ?? []).map((variant) => variant.condition))].sort(),
        ptaStatuses: [...new Set((record.variants ?? []).map((variant) => variant.pta_status))].sort(),
        variantCount: (record.variants ?? []).length,
      })),
    );
    if (page.length < 1000) return products;
  }
}

export const loadIphoneSpecs = (client: SupabaseClient, productIds: readonly string[]): Promise<ExistingSpec[]> =>
  loadExistingSpecs(client, productIds);

export type ApprovedModelSpec = { model_key: string; specification_group: string; label: string; value: string };

/** Owner-approved common specifications per model; null when the migration is not applied on this database. */
export async function loadApprovedModelSpecs(client: SupabaseClient): Promise<ApprovedModelSpec[] | null> {
  const rows: ApprovedModelSpec[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await client
      .from("model_common_specifications")
      .select("model_key,specification_group,label,value")
      .order("model_key")
      .order("sort_order")
      .range(from, from + 999);
    if (error) return null;
    rows.push(...((data ?? []) as ApprovedModelSpec[]));
    if ((data ?? []).length < 1000) return rows;
  }
}

export type ModelSpecApplyResult = {
  inserted: number;
  corrected: number;
  products: { product_id: string; inserted: number; present: number; conflicts: number; corrected?: number }[];
  approved: { added: number; present: number; kept: number; corrected: number };
};

/** "not_installed" = migration 202611200002 is not applied on the connected database (nothing can be saved yet). */
export class ModelSpecSaveError extends Error {
  constructor(readonly code: "not_installed" | "forbidden" | "stale" | "failed", message: string) {
    super(message);
  }
}

export async function applyIphoneModelSpecs(
  client: SupabaseClient,
  modelKey: string,
  productIds: readonly string[],
  specs: readonly ModelSpec[],
  corrections: readonly { label: string; old_value: string }[] = [],
): Promise<ModelSpecApplyResult> {
  const { data, error } = await client.rpc("apply_model_common_specifications", {
    p_model_key: modelKey,
    p_product_ids: productIds,
    p_specs: modelSpecPayload(specs),
    p_corrections: corrections,
  });
  if (error) {
    const message = error.message ?? "Save failed";
    if (error.code === "PGRST202" || /could not find the function/i.test(message))
      throw new ModelSpecSaveError("not_installed", "Saving is not available yet: the database update (migration 202611200002) is not applied on this database. Nothing was saved.");
    if (error.code === "42501" || /forbidden/.test(message)) throw new ModelSpecSaveError("forbidden", "Only the Owner can approve shared specifications. Nothing was saved.");
    if (/_stale_approved/.test(message)) throw new ModelSpecSaveError("stale", "An approved value changed since the preview. Check again; nothing was saved.");
    if (/_stale/.test(message)) throw new ModelSpecSaveError("stale", "The matching products changed since the preview. Check again; nothing was saved.");
    throw new ModelSpecSaveError("failed", `${message} Nothing was saved.`);
  }
  const result = (data ?? {}) as Partial<ModelSpecApplyResult>;
  return {
    inserted: Number(result.inserted ?? 0),
    corrected: Number(result.corrected ?? 0),
    products: result.products ?? [],
    approved: {
      added: Number(result.approved?.added ?? 0),
      present: Number(result.approved?.present ?? 0),
      kept: Number(result.approved?.kept ?? 0),
      corrected: Number(result.approved?.corrected ?? 0),
    },
  };
}
