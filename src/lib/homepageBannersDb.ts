/**
 * Homepage Banner & Slider — database and Cloudinary calls (migration 202611200001, Edge Function
 * cloudinary-upload-signature with { siteAsset: true }). Owner-only rules are enforced by the database RPCs and the
 * Edge Function; nothing here can bypass them.
 */
import { supabase } from "./supabase";
import { parseHomepageContent, type BannerImage, type HomeBanner } from "./homepageBanners";

export type SiteContentVersionSummary = {
  id: string;
  status: "published" | "archived";
  publishedAt: string | null;
  archivedAt: string | null;
  bannerCount: number;
};

export type HomepageBannerAdminState = {
  draft: { id: string; banners: HomeBanner[]; updatedAt: string } | null;
  published: { id: string; banners: HomeBanner[]; publishedAt: string } | null;
  history: SiteContentVersionSummary[];
};

/** "not_installed" = the migration is not applied on the connected database (RPC missing). */
export class BannerEditorError extends Error {
  constructor(readonly code: "not_installed" | "owner_required" | "invalid" | "failed", message: string, readonly details: string[] = []) {
    super(message);
  }
}

type RpcError = { code?: string; message?: string; status?: number } | null;

function toEditorError(error: RpcError): BannerEditorError {
  const message = error?.message ?? "Request failed";
  if (error?.code === "PGRST202" || error?.code === "42883" || /could not find the function/i.test(message))
    return new BannerEditorError("not_installed", "The banner editor database update (migration 202611200001) is not applied on this database yet.");
  if (error?.code === "42501" || /owner_required/.test(message))
    return new BannerEditorError("owner_required", "Only the Owner can edit homepage banners.");
  const invalid = /invalid_site_content: (.*)$/.exec(message);
  if (invalid) return new BannerEditorError("invalid", "The banners did not pass validation.", invalid[1].split(","));
  return new BannerEditorError("failed", message);
}

function requireClient() {
  if (!supabase) throw new BannerEditorError("failed", "Supabase environment is not configured");
  return supabase;
}

/** Public, published-only read. Resolves null when nothing usable is published (caller keeps the built-in banners). */
export async function fetchPublishedHomepageBanners(): Promise<HomeBanner[] | null> {
  if (!supabase) return null;
  const { data, error } = await supabase.rpc("get_published_site_content", { p_scope: "homepage" });
  if (error) {
    const failure = toEditorError(error);
    // Migration not applied on this database = nothing can be published yet: same as "nothing published".
    if (failure.code === "not_installed") return null;
    throw failure;
  }
  return parseHomepageContent(data);
}

export async function checkSiteOwner(): Promise<boolean> {
  const { data, error } = await requireClient().rpc("is_site_owner");
  if (error) throw toEditorError(error);
  return data === true;
}

export async function fetchHomepageBannerAdminState(): Promise<HomepageBannerAdminState> {
  const { data, error } = await requireClient().rpc("get_site_content_admin", { p_scope: "homepage" });
  if (error) throw toEditorError(error);
  const raw = (data ?? {}) as {
    draft?: { id: string; content: unknown; updatedAt: string } | null;
    published?: { id: string; content: unknown; publishedAt: string } | null;
    history?: SiteContentVersionSummary[];
  };
  const draftBanners = raw.draft ? parseHomepageContent(raw.draft.content) : null;
  const publishedBanners = raw.published ? parseHomepageContent(raw.published.content) : null;
  return {
    draft: raw.draft && draftBanners ? { id: raw.draft.id, banners: draftBanners, updatedAt: raw.draft.updatedAt } : null,
    published: raw.published && publishedBanners ? { id: raw.published.id, banners: publishedBanners, publishedAt: raw.published.publishedAt } : null,
    history: raw.history ?? [],
  };
}

export async function saveHomepageBannerDraft(banners: HomeBanner[]) {
  const { data, error } = await requireClient().rpc("save_site_content_draft", { p_scope: "homepage", p_content: { banners } });
  if (error) throw toEditorError(error);
  return data as { id: string; updatedAt: string };
}

export async function publishHomepageBanners() {
  const { data, error } = await requireClient().rpc("publish_site_content", { p_scope: "homepage" });
  if (error) throw toEditorError(error);
  return data as { id: string; publishedAt: string };
}

export async function restoreHomepageBannerVersion(versionId: string) {
  const { data, error } = await requireClient().rpc("restore_site_content_version", { p_scope: "homepage", p_version_id: versionId });
  if (error) throw toEditorError(error);
  return data as { id: string; updatedAt: string };
}

type UploadSignature = { cloudName: string; apiKey: string; signature: string; signedParameters: Record<string, string | number> };

/** Signed direct upload to Cloudinary (<root>/site/<uuid>), then registration as a site asset. */
export async function uploadBannerImage(file: File): Promise<BannerImage> {
  const client = requireClient();
  const { data, error } = await client.functions.invoke<UploadSignature>("cloudinary-upload-signature", { body: { siteAsset: true } });
  if (error || !data) throw new BannerEditorError("failed", "Upload is not available (the Edge Function update may not be deployed yet).");
  const form = new FormData();
  form.set("file", file);
  form.set("api_key", data.apiKey);
  form.set("signature", data.signature);
  for (const [key, value] of Object.entries(data.signedParameters)) form.set(key, String(value));
  const response = await fetch(`https://api.cloudinary.com/v1_1/${data.cloudName}/image/upload`, { method: "POST", body: form });
  const uploaded = (await response.json()) as { public_id?: string; secure_url?: string; width?: number; height?: number; bytes?: number; format?: string };
  if (!response.ok || !uploaded.public_id || !uploaded.secure_url) throw new BannerEditorError("failed", "Cloudinary upload failed.");
  const { data: asset, error: registerError } = await client.rpc("register_site_asset", {
    p_public_id: uploaded.public_id,
    p_secure_url: uploaded.secure_url,
    p_width: uploaded.width ?? 0,
    p_height: uploaded.height ?? 0,
    p_bytes: uploaded.bytes ?? 0,
    p_format: uploaded.format ?? "",
  });
  if (registerError) throw toEditorError(registerError);
  const registered = asset as { publicId: string; src: string };
  return { src: registered.src, publicId: registered.publicId };
}
