/**
 * Global PDP Background — database calls (migration 202611200001, scope "pdp_gallery"). Owner-only rules are enforced by
 * the RPCs; nothing here can bypass them. Pure helpers: pdpGalleryBackground.ts.
 */
import { supabase } from "./supabase";
import { parsePdpGalleryBackground, type PdpGalleryBackground } from "./pdpGalleryBackground";

export class PdpBackgroundError extends Error {
  readonly code: "not_installed" | "owner_required" | "invalid" | "failed";
  constructor(code: PdpBackgroundError["code"], message: string) {
    super(message);
    this.code = code;
  }
}

const toError = (error: { code?: string; message?: string } | null) => {
  const message = error?.message ?? "Request failed";
  if (error?.code === "PGRST202" || error?.code === "42883" || /could not find the function/i.test(message))
    return new PdpBackgroundError("not_installed", "Saving is not available yet: the database update (migration 202611200001) is not applied on this database.");
  if (error?.code === "42501" || /owner_required/.test(message)) return new PdpBackgroundError("owner_required", "Only the Owner can change the PDP background.");
  if (/invalid_site_content/.test(message)) return new PdpBackgroundError("invalid", `The setting did not pass validation (${message.replace(/^.*invalid_site_content: /, "")}).`);
  return new PdpBackgroundError("failed", message);
};

/** Public, published-only read; null = nothing published / not installed (built-in look). */
export async function fetchPublishedPdpBackground(): Promise<PdpGalleryBackground | null> {
  if (!supabase) return null;
  const { data, error } = await supabase.rpc("get_published_site_content", { p_scope: "pdp_gallery" });
  if (error) {
    const failure = toError(error);
    if (failure.code === "not_installed") return null;
    throw failure;
  }
  return parsePdpGalleryBackground(data);
}

export async function fetchPdpBackgroundAdmin(): Promise<{ draft: PdpGalleryBackground | null; published: PdpGalleryBackground | null }> {
  if (!supabase) throw new PdpBackgroundError("failed", "Supabase environment is not configured");
  const { data, error } = await supabase.rpc("get_site_content_admin", { p_scope: "pdp_gallery" });
  if (error) throw toError(error);
  const raw = (data ?? {}) as { draft?: { content: unknown } | null; published?: { content: unknown } | null };
  return { draft: raw.draft ? parsePdpGalleryBackground(raw.draft.content) : null, published: raw.published ? parsePdpGalleryBackground(raw.published.content) : null };
}

/** Saves the setting as the draft and publishes it (Owner, typed confirmation in the Admin). */
export async function publishPdpBackground(value: PdpGalleryBackground) {
  if (!supabase) throw new PdpBackgroundError("failed", "Supabase environment is not configured");
  const saved = await supabase.rpc("save_site_content_draft", { p_scope: "pdp_gallery", p_content: value });
  if (saved.error) throw toError(saved.error);
  const published = await supabase.rpc("publish_site_content", { p_scope: "pdp_gallery" });
  if (published.error) throw toError(published.error);
}
