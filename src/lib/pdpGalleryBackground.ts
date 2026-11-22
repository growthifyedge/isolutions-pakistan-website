/**
 * Global PDP Background (Owner-approved localhost development, 2026-11-21).
 *
 * One setting for every product page: the main gallery image box shows the built-in look ("default"), one solid colour,
 * or an uploaded background image (landscape for desktop, optional portrait for mobile; mobile falls back to desktop).
 * Product images stay on top, unchanged (contain: never cropped or stretched); only the box behind them changes.
 *
 * Stored as Website Editor content, scope "pdp_gallery" (migration 202611200001: Owner-only draft / publish / restore,
 * published-only public read). Nothing published, a read failure or unusable data = the built-in look.
 *
 * Localhost preview: the Admin setting writes its unsaved choice to this browser only (localStorage + IndexedDB images
 * via bannerPreviewStore); a product page opened with ?pdpBackgroundPreview=1 shows it. Never sent to the database.
 */
import { LOCAL_PREVIEW_PREFIX, isLocalPreviewSrc } from "./homepageBanners.ts";

export type PdpBackgroundImage = { src: string; publicId: string | null };
export type PdpBackgroundMode = "default" | "color" | "image";
export type PdpGalleryBackground = {
  mode: PdpBackgroundMode;
  /** #RRGGBB. Required for "color"; with "image" it shows while the image loads. */
  color: string | null;
  /** Landscape image (desktop and tablet). Required for "image". */
  desktop: PdpBackgroundImage | null;
  /** Portrait image (phones, up to 600 px wide). Optional: the desktop image is used when absent. */
  mobile: PdpBackgroundImage | null;
};

export const DEFAULT_PDP_BACKGROUND: PdpGalleryBackground = { mode: "default", color: null, desktop: null, mobile: null };
/**
 * Owner decision 2026-11-21: the Admin offers Solid Colour only, default #DCEAF9. "default" / "image" stay readable here
 * (and in the migration validator) so an older stored value never breaks a product page; the Admin no longer creates them.
 */
export const OWNER_PDP_BACKGROUND_COLOR = "#DCEAF9";
export const PDP_BACKGROUND_PREVIEW_STORAGE_KEY = "isp.pdpBackgroundPreview.v1";
export const PDP_BACKGROUND_CACHE_STORAGE_KEY = "isp.pdpBackground.v1";
export const PDP_BACKGROUND_PREVIEW_PARAM = "pdpBackgroundPreview";

const HEX = /^#[0-9A-Fa-f]{6}$/;
const CLOUDINARY = /^https:\/\/res\.cloudinary\.com\/[A-Za-z0-9_-]+\/image\/upload\//;

const readImage = (value: unknown, allowLocalPreview: boolean): PdpBackgroundImage | null | undefined => {
  if (value === null || value === undefined) return null;
  if (typeof value !== "object") return undefined;
  const { src, publicId } = value as { src?: unknown; publicId?: unknown };
  if (typeof src !== "string") return undefined;
  if (allowLocalPreview && isLocalPreviewSrc(src)) return { src, publicId: null };
  if (typeof publicId !== "string" || !publicId || !CLOUDINARY.test(src)) return undefined;
  return { src, publicId };
};

/** Problems (mirrors public.validate_pdp_gallery_content; the server is the authority). Empty = valid. */
export function validatePdpGalleryBackground(value: PdpGalleryBackground, options: { allowLocalPreview?: boolean } = {}) {
  const errors: string[] = [];
  if (!["default", "color", "image"].includes(value.mode)) errors.push("Choose Default, Solid colour or Background image.");
  if (value.color !== null && !HEX.test(value.color)) errors.push("Colour must be a hex value like #EEF4FA.");
  if (value.mode === "color" && !value.color) errors.push("Choose a colour.");
  if (value.mode === "image" && !value.desktop) errors.push("Upload a desktop (landscape) background image.");
  for (const image of [value.desktop, value.mobile])
    if (image && readImage(image, Boolean(options.allowLocalPreview)) === undefined) errors.push("A background image is not an uploaded image.");
  return errors;
}

/** Stored / published JSON -> setting; null when unusable (the caller keeps the built-in look). */
export function parsePdpGalleryBackground(value: unknown, options: { allowLocalPreview?: boolean } = {}): PdpGalleryBackground | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  const mode = raw.mode;
  if (mode !== "default" && mode !== "color" && mode !== "image") return null;
  const color = typeof raw.color === "string" && HEX.test(raw.color) ? raw.color.toUpperCase() : null;
  const desktop = readImage(raw.desktop, Boolean(options.allowLocalPreview));
  const mobile = readImage(raw.mobile, Boolean(options.allowLocalPreview));
  if (desktop === undefined || mobile === undefined) return null;
  const parsed: PdpGalleryBackground = { mode, color, desktop, mobile };
  return validatePdpGalleryBackground(parsed, options).length ? null : parsed;
}

/** Browser-local preview image keys used by a setting (IndexedDB, bannerPreviewStore). */
export const pdpBackgroundPreviewKeys = (value: PdpGalleryBackground) =>
  [value.desktop?.src, value.mobile?.src].filter((src): src is string => Boolean(src && isLocalPreviewSrc(src))).map((src) => src.slice(LOCAL_PREVIEW_PREFIX.length));

const cssUrl = (src: string) => `url("${src.replace(/["\\\n\r]/g, "")}")`;
const delivered = (image: PdpBackgroundImage, width: number, cloudName: string | undefined, localUrls?: ReadonlyMap<string, string>) => {
  if (isLocalPreviewSrc(image.src)) return localUrls?.get(image.src.slice(LOCAL_PREVIEW_PREFIX.length)) ?? null;
  // Cloudinary resize only (c_limit keeps the whole image; CSS "cover" fills the box behind the product).
  return cloudName && image.publicId ? `https://res.cloudinary.com/${cloudName}/image/upload/c_limit,w_${width},q_auto,f_auto/${image.publicId}` : image.src;
};

/**
 * CSS custom properties for the PDP main image box; null = built-in look. --pdp-bg-desktop / --pdp-bg-mobile are
 * url() values (mobile falls back to desktop), --pdp-bg-color a colour.
 */
export function pdpBackgroundStyle(value: PdpGalleryBackground | null, cloudName: string | undefined, localUrls?: ReadonlyMap<string, string>) {
  if (!value || value.mode === "default") return null;
  if (value.mode === "color") return value.color ? { "--pdp-bg-color": value.color } : null;
  const desktop = value.desktop ? delivered(value.desktop, 1800, cloudName, localUrls) : null;
  if (!desktop) return value.color ? { "--pdp-bg-color": value.color } : null;
  const mobile = value.mobile ? delivered(value.mobile, 1000, cloudName, localUrls) : null;
  return {
    ...(value.color ? { "--pdp-bg-color": value.color } : {}),
    "--pdp-bg-desktop": cssUrl(desktop),
    "--pdp-bg-mobile": cssUrl(mobile ?? desktop),
    // No portrait image: phones crop the landscape image anchored to its bottom edge, so bottom artwork (waves) stays.
    ...(mobile ? {} : { "--pdp-bg-mobile-position": "center bottom" }),
  };
}

export const samePdpBackground = (a: PdpGalleryBackground | null, b: PdpGalleryBackground | null) => JSON.stringify(a) === JSON.stringify(b);
