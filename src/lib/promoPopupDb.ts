/**
 * Promotional Popup — database and Cloudinary calls (migration 202611230001, scope "promo_popup"; prepared, not
 * applied). Owner-only rules are enforced by the RPCs and the upload Edge Function; nothing here can bypass them.
 * Pure helpers: promoPopup.ts.
 */
import { supabase } from "./supabase";
import { parsePromoPopup, type PromoPopup, type PromoPopupImage } from "./promoPopup";

export class PromoPopupError extends Error {
  readonly code: "not_installed" | "owner_required" | "invalid" | "upload_unavailable" | "failed";
  constructor(code: PromoPopupError["code"], message: string) {
    super(message);
    this.code = code;
  }
}

const NOT_INSTALLED = "Saving is not available yet: the database update (migration 202611230001) is not applied on this database.";

const toError = (error: { code?: string; message?: string } | null) => {
  const message = error?.message ?? "Request failed";
  if (error?.code === "PGRST202" || error?.code === "42883" || /could not find the function/i.test(message)) return new PromoPopupError("not_installed", NOT_INSTALLED);
  // Before 202611230001 the shared table refuses the new scope (check constraint) and the validator answers "scope_not_supported".
  if (/scope_not_supported|site_content_versions_scope_check/.test(message)) return new PromoPopupError("not_installed", NOT_INSTALLED);
  if (error?.code === "42501" || /owner_required/.test(message)) return new PromoPopupError("owner_required", "Only the Owner can change the promotional popup.");
  if (/invalid_site_content/.test(message)) return new PromoPopupError("invalid", `The popup did not pass validation (${message.replace(/^.*invalid_site_content: /, "")}).`);
  return new PromoPopupError("failed", message);
};

/** Public, published-only read; null = no popup (nothing published, disabled, incomplete or not installed). */
export async function fetchPublishedPromoPopup(): Promise<PromoPopup | null> {
  if (!supabase) return null;
  const { data, error } = await supabase.rpc("get_published_site_content", { p_scope: "promo_popup" });
  if (error) return null;
  return parsePromoPopup(data);
}

/**
 * Admin state. The shared get_site_content_admin answers for any scope (even before 202611230001), so installation and
 * Owner access are checked first with promo_popup_installed (missing function = not installed).
 */
export async function fetchPromoPopupAdmin(): Promise<{ draft: PromoPopup | null; published: PromoPopup | null }> {
  if (!supabase) throw new PromoPopupError("failed", "Supabase environment is not configured");
  const probe = await supabase.rpc("promo_popup_installed");
  if (probe.error) throw toError(probe.error);
  if ((probe.data as { owner?: boolean } | null)?.owner !== true) throw new PromoPopupError("owner_required", "Only the Owner can change the promotional popup.");
  const { data, error } = await supabase.rpc("get_site_content_admin", { p_scope: "promo_popup" });
  if (error) throw toError(error);
  const raw = (data ?? {}) as { draft?: { content: unknown } | null; published?: { content: unknown } | null };
  return { draft: raw.draft ? parsePromoPopup(raw.draft.content) : null, published: raw.published ? parsePromoPopup(raw.published.content) : null };
}

/** Saves the setting as the draft and publishes it (Owner). ON = live on the homepage; OFF = hidden. */
export async function savePromoPopup(value: PromoPopup) {
  if (!supabase) throw new PromoPopupError("failed", "Supabase environment is not configured");
  const saved = await supabase.rpc("save_site_content_draft", { p_scope: "promo_popup", p_content: value });
  if (saved.error) throw toError(saved.error);
  const published = await supabase.rpc("publish_site_content", { p_scope: "promo_popup" });
  if (published.error) throw toError(published.error);
}

type UploadSignature = { cloudName: string; apiKey: string; signature: string; signedParameters: Record<string, string | number> };

/** Signed direct upload to Cloudinary (<root>/site/<uuid>), then registration as a site asset (Owner only). */
export async function uploadPromoPopupImage(file: File): Promise<PromoPopupImage> {
  if (!supabase) throw new PromoPopupError("failed", "Supabase environment is not configured");
  const { data, error } = await supabase.functions.invoke<UploadSignature>("cloudinary-upload-signature", { body: { siteAsset: true } });
  if (error || !data)
    throw new PromoPopupError("upload_unavailable", "Image upload is not available yet: the upload service update (Edge Function cloudinary-upload-signature, site images) is not deployed on this environment.");
  const form = new FormData();
  form.set("file", file);
  form.set("api_key", data.apiKey);
  form.set("signature", data.signature);
  for (const [key, value] of Object.entries(data.signedParameters)) form.set(key, String(value));
  const response = await fetch(`https://api.cloudinary.com/v1_1/${data.cloudName}/image/upload`, { method: "POST", body: form });
  const uploaded = (await response.json()) as { public_id?: string; secure_url?: string; width?: number; height?: number; bytes?: number; format?: string };
  if (!response.ok || !uploaded.public_id || !uploaded.secure_url) throw new PromoPopupError("failed", "Cloudinary upload failed.");
  const { data: asset, error: registerError } = await supabase.rpc("register_site_asset", {
    p_public_id: uploaded.public_id,
    p_secure_url: uploaded.secure_url,
    p_width: uploaded.width ?? 0,
    p_height: uploaded.height ?? 0,
    p_bytes: uploaded.bytes ?? 0,
    p_format: uploaded.format ?? "",
  });
  if (registerError) throw toError(registerError);
  const registered = asset as { publicId: string; src: string };
  return { src: registered.src, publicId: registered.publicId };
}
