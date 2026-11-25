/**
 * Bundle Offers Editor — database calls (migration 202611250002, scope "bundle_offers"; prepared, not applied).
 * Owner-only rules are enforced by the shared Website Editor RPCs; nothing here can bypass them.
 * Image upload is NOT duplicated: the editor uses uploadBannerImage (homepageBannersDb.ts, siteAsset target).
 * Pure helpers: bundleOffers.ts.
 */
import { supabase } from "./supabase";
import { parseBundleOffers, type BundleOffersContent } from "./bundleOffers";
import type { SiteContentVersionSummary } from "./homepageBannersDb";

export type BundleOffersAdminState = {
  draft: { id: string; content: BundleOffersContent; updatedAt: string } | null;
  published: { id: string; content: BundleOffersContent; publishedAt: string } | null;
  history: SiteContentVersionSummary[];
};

export class BundleOffersError extends Error {
  constructor(readonly code: "not_installed" | "owner_required" | "invalid" | "failed", message: string) {
    super(message);
  }
}

const NOT_INSTALLED = "Saving is not available yet: the database update (migration 202611250002) is not applied on this database.";

const toError = (error: { code?: string; message?: string } | null) => {
  const message = error?.message ?? "Request failed";
  if (error?.code === "PGRST202" || error?.code === "42883" || /could not find the function/i.test(message)) return new BundleOffersError("not_installed", NOT_INSTALLED);
  // Before 202611250002 the shared table refuses the new scope (check constraint) and the validator answers "scope_not_supported".
  if (/scope_not_supported|site_content_versions_scope_check/.test(message)) return new BundleOffersError("not_installed", NOT_INSTALLED);
  if (error?.code === "42501" || /owner_required/.test(message)) return new BundleOffersError("owner_required", "Only the Owner can change the bundle offers.");
  if (/invalid_site_content/.test(message)) return new BundleOffersError("invalid", `The bundle offers did not pass validation (${message.replace(/^.*invalid_site_content: /, "")}).`);
  return new BundleOffersError("failed", message);
};

function requireClient() {
  if (!supabase) throw new BundleOffersError("failed", "Supabase environment is not configured");
  return supabase;
}

/** Public, published-only read; null = keep the built-in section (nothing published, unusable, not installed or failed). */
export async function fetchPublishedBundleOffers(): Promise<BundleOffersContent | null> {
  if (!supabase) return null;
  const { data, error } = await supabase.rpc("get_published_site_content", { p_scope: "bundle_offers" });
  if (error) return null;
  return parseBundleOffers(data);
}

/** Admin state; installation + Owner access checked first (missing probe function = migration not applied). */
export async function fetchBundleOffersAdmin(): Promise<BundleOffersAdminState> {
  const client = requireClient();
  const probe = await client.rpc("bundle_offers_installed");
  if (probe.error) throw toError(probe.error);
  if ((probe.data as { owner?: boolean } | null)?.owner !== true) throw new BundleOffersError("owner_required", "Only the Owner can change the bundle offers.");
  const { data, error } = await client.rpc("get_site_content_admin", { p_scope: "bundle_offers" });
  if (error) throw toError(error);
  const raw = (data ?? {}) as {
    draft?: { id: string; content: unknown; updatedAt: string } | null;
    published?: { id: string; content: unknown; publishedAt: string } | null;
    history?: SiteContentVersionSummary[];
  };
  const draft = raw.draft ? parseBundleOffers(raw.draft.content) : null;
  const published = raw.published ? parseBundleOffers(raw.published.content) : null;
  return {
    draft: raw.draft && draft ? { id: raw.draft.id, content: draft, updatedAt: raw.draft.updatedAt } : null,
    published: raw.published && published ? { id: raw.published.id, content: published, publishedAt: raw.published.publishedAt } : null,
    history: raw.history ?? [],
  };
}

export async function saveBundleOffersDraft(content: BundleOffersContent) {
  const { error } = await requireClient().rpc("save_site_content_draft", { p_scope: "bundle_offers", p_content: content });
  if (error) throw toError(error);
}

export async function publishBundleOffers() {
  const { error } = await requireClient().rpc("publish_site_content", { p_scope: "bundle_offers" });
  if (error) throw toError(error);
}

export async function restoreBundleOffersVersion(versionId: string) {
  const { error } = await requireClient().rpc("restore_site_content_version", { p_scope: "bundle_offers", p_version_id: versionId });
  if (error) throw toError(error);
}
