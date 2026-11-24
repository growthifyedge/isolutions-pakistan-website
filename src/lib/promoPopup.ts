/**
 * Promotional Popup (Admin Studio → Marketing → Promotional Popup), localhost implementation 2026-11-23.
 *
 * One promotional image that opens a product / deal / collection page. Shown on the homepage only, 3 seconds after
 * the first homepage visit of a browser session; closed (or shown) once = not again in that session.
 *
 * Stored as Website Editor content, scope "promo_popup" (migration 202611230001 — prepared, not applied): Owner-only
 * save + publish, published-only public read that returns the popup only when it is enabled and complete. Nothing
 * published, a read failure, a disabled popup or a missing image / link = no popup.
 *
 * Browser preview: the Admin writes its unsaved setting to this browser only (localStorage + IndexedDB image via
 * bannerPreviewStore); the homepage opened with ?promoPopupPreview=1 shows it. Never sent to the database.
 */
import { LOCAL_PREVIEW_PREFIX, isInternalLink, isLocalPreviewSrc } from "./homepageBanners.ts";

export type PromoPopupImage = { src: string; publicId: string | null };
export type PromoPopup = { enabled: boolean; image: PromoPopupImage | null; link: string | null };

export const EMPTY_PROMO_POPUP: PromoPopup = { enabled: false, image: null, link: null };
export const PROMO_POPUP_DELAY_MS = 3000;
/** Give up when the setting or image is not ready this long after the homepage opened (no late surprise popup). */
export const PROMO_POPUP_GIVE_UP_MS = 12000;
export const PROMO_POPUP_SESSION_KEY = "isp.promoPopup.seen.v1";
export const PROMO_POPUP_PREVIEW_STORAGE_KEY = "isp.promoPopupPreview.v1";
export const PROMO_POPUP_PREVIEW_PARAM = "promoPopupPreview";
export const PROMO_POPUP_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
export const PROMO_POPUP_MAX_BYTES = 10 * 1024 * 1024;
/**
 * Delivery widths (Cloudinary c_limit: resized, never cropped, never enlarged beyond the upload). The popup is up to
 * 900 px wide on desktop, so sharp high-density screens need up to 1800 px.
 */
export const PROMO_POPUP_WIDTHS = [480, 720, 1080, 1440, 1800] as const;

const CLOUDINARY = /^https:\/\/res\.cloudinary\.com\/[A-Za-z0-9_-]+\/image\/upload\//;
const SITE_HOSTS = /^https?:\/\/(www\.)?isolutionspakistan\.com(?=[/?#]|$)/i;

/** Problem with a chosen file, or null when it can be used (JPG, PNG, WebP up to 10 MB). */
export function promoPopupFileProblem(file: { type: string; size: number }) {
  if (!(PROMO_POPUP_IMAGE_TYPES as readonly string[]).includes(file.type)) return "Choose a JPG, PNG or WebP image.";
  if (file.size <= 0) return "The image file is empty.";
  if (file.size > PROMO_POPUP_MAX_BYTES) return "The image is larger than 10 MB.";
  return null;
}

/**
 * Typed destination -> internal path. A full link to this website (isolutionspakistan.com) becomes its path, so the
 * Owner can paste a copied page address; anything else is returned trimmed and checked by isInternalLink.
 */
export function toInternalPath(input: string) {
  const value = input.trim();
  if (SITE_HOSTS.test(value)) {
    const rest = value.replace(SITE_HOSTS, "");
    return rest.startsWith("/") ? rest : `/${rest}`;
  }
  return value;
}

const readImage = (value: unknown, allowLocalPreview: boolean): PromoPopupImage | null | undefined => {
  if (value === null || value === undefined) return null;
  if (typeof value !== "object") return undefined;
  const { src, publicId } = value as { src?: unknown; publicId?: unknown };
  if (typeof src !== "string") return undefined;
  if (allowLocalPreview && isLocalPreviewSrc(src)) return { src, publicId: null };
  if (typeof publicId !== "string" || !publicId || !CLOUDINARY.test(src)) return undefined;
  return { src, publicId };
};

/** Problems (mirrors public.validate_promo_popup_content; the server is the authority). Empty = valid. */
export function validatePromoPopup(value: PromoPopup, options: { allowLocalPreview?: boolean } = {}) {
  const errors: string[] = [];
  if (value.image && readImage(value.image, Boolean(options.allowLocalPreview)) === undefined) errors.push("The image is not an uploaded image.");
  if (value.link !== null && !isInternalLink(value.link))
    errors.push("Destination must be a page of this website, starting with / (for example /product/apple-iphone-17-pro-max or /collections/deals).");
  if (value.enabled && !value.image) errors.push("Upload a popup image before turning the popup ON.");
  if (value.enabled && !value.link) errors.push("Add a destination link before turning the popup ON.");
  return errors;
}

/** Stored / published JSON -> setting; null when unusable. */
export function parsePromoPopup(value: unknown, options: { allowLocalPreview?: boolean } = {}): PromoPopup | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  if (typeof raw.enabled !== "boolean") return null;
  const image = readImage(raw.image, Boolean(options.allowLocalPreview));
  if (image === undefined) return null;
  if (raw.link !== null && raw.link !== undefined && typeof raw.link !== "string") return null;
  const parsed: PromoPopup = { enabled: raw.enabled, image, link: typeof raw.link === "string" ? raw.link : null };
  return validatePromoPopup(parsed, options).length ? null : parsed;
}

/** The storefront shows a popup only when it is ON and has both an image and a link. */
export const isPromoPopupShowable = (value: PromoPopup | null): value is PromoPopup & { image: PromoPopupImage; link: string } =>
  Boolean(value && value.enabled && value.image && value.link);

export const promoPopupPreviewKey = (value: PromoPopup | null) =>
  value?.image && isLocalPreviewSrc(value.image.src) ? value.image.src.slice(LOCAL_PREVIEW_PREFIX.length) : null;

/** Image URL for one width: Cloudinary resize only (c_limit keeps the whole image), local preview = object URL. */
export function promoPopupImageUrl(image: PromoPopupImage, width: number, cloudName: string | undefined, localUrls?: ReadonlyMap<string, string>) {
  if (isLocalPreviewSrc(image.src)) return localUrls?.get(image.src.slice(LOCAL_PREVIEW_PREFIX.length)) ?? null;
  return cloudName && image.publicId ? `https://res.cloudinary.com/${cloudName}/image/upload/c_limit,w_${width},q_auto,f_auto/${image.publicId}` : image.src;
}

/** src + srcSet for the popup <img>; srcSet only for Cloudinary images. */
export function promoPopupImageSources(image: PromoPopupImage, cloudName: string | undefined, localUrls?: ReadonlyMap<string, string>) {
  const src = promoPopupImageUrl(image, PROMO_POPUP_WIDTHS[1], cloudName, localUrls);
  if (!src) return null;
  const srcSet = !isLocalPreviewSrc(image.src) && cloudName && image.publicId
    ? PROMO_POPUP_WIDTHS.map((width) => `${promoPopupImageUrl(image, width, cloudName)} ${width}w`).join(", ")
    : undefined;
  return { src, srcSet };
}

export const samePromoPopup = (a: PromoPopup | null, b: PromoPopup | null) => JSON.stringify(a) === JSON.stringify(b);
