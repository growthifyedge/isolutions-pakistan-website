/**
 * Homepage Banner & Slider (Website Editor, PROJECT_HANDOVER.md §4S).
 * Pure helpers shared by the storefront carousel and the Owner-only Admin Banner Manager. No database or
 * environment access here (the Cloudinary cloud name is passed in), so everything runs offline in tests.
 *
 * The built-in banners below are today's 7 homepage slides. They are the default content AND the fallback:
 * the storefront shows them whenever nothing is published, the published read fails, or published data is unusable.
 */

export type BannerImage = { src: string; publicId: string | null };

export type HomeBanner = {
  id: string;
  enabled: boolean;
  alt: string;
  heading: string | null;
  buttonText: string | null;
  link: string | null;
  desktop: BannerImage;
  mobile: BannerImage | null;
};

export type HomepageContent = { banners: HomeBanner[] };

/** What the carousel renders. */
export type HomeHeroSlide = {
  desktopSrc: string;
  mobileSrc?: string;
  alt: string;
  heading?: string;
  buttonText?: string;
  link?: string;
};

export const MAX_HOMEPAGE_BANNERS = 12;
export const BANNER_TEXT_LIMITS = { alt: 120, heading: 80, buttonText: 30, link: 200 } as const;
/** Delivery widths for uploaded banners: the built-in desktop files are 2000 px wide, the mobile ones 1122 px. */
export const BANNER_DELIVERY_WIDTH = { desktop: 2000, mobile: 1122 } as const;
export const BANNER_PREVIEW_STORAGE_KEY = "isp.homepageBannerPreview.v1";
export const BANNER_CACHE_STORAGE_KEY = "isp.homepageBanners.v1";
/** Image chosen in preview-only mode, kept in this browser's IndexedDB (src/lib/bannerPreviewStore.ts). Never saved. */
export const LOCAL_PREVIEW_PREFIX = "local-preview:";
const LOCAL_PREVIEW_SRC = /^local-preview:[A-Za-z0-9-]{1,64}$/;

export function isLocalPreviewSrc(value: string) {
  return LOCAL_PREVIEW_SRC.test(value);
}

const builtIn = (id: string, desktopSrc: string, mobileSrc: string, alt: string): HomeBanner => ({
  id,
  enabled: true,
  alt,
  heading: null,
  buttonText: null,
  link: null,
  desktop: { src: desktopSrc, publicId: null },
  mobile: { src: mobileSrc, publicId: null },
});

export const DEFAULT_HOMEPAGE_BANNERS: readonly HomeBanner[] = [
  builtIn(
    "default-apple-01",
    "/assets/banners/banner-apple-01-desktop.webp",
    "/assets/banners/banner-apple-01-mobile.webp",
    "Apple products banner",
  ),
  builtIn(
    "default-redmi-note-15-pro",
    "/assets/banners/banner-redmi-note-15-pro-desktop.webp",
    "/assets/banners/banner-redmi-note-15-pro-mobile.webp",
    "Redmi Note 15 Pro banner",
  ),
  builtIn(
    "default-tecno-camon-50-pro",
    "/assets/banners/banner-tecno-camon-50-pro-desktop-v2.webp",
    "/assets/banners/banner-tecno-camon-50-pro-mobile.webp",
    "Tecno Camon 50 Pro banner",
  ),
  builtIn(
    "default-samsung-galaxy-s26-ultra",
    "/assets/banners/banner-samsung-galaxy-s26-ultra-desktop.webp",
    "/assets/banners/banner-samsung-galaxy-s26-ultra-mobile.webp",
    "Samsung Galaxy S26 Ultra banner",
  ),
  builtIn(
    "default-xiaomi-tv-a-series-2026",
    "/assets/banners/banner-xiaomi-tv-a-series-2026-desktop.webp",
    "/assets/banners/banner-xiaomi-tv-a-series-2026-mobile.webp",
    "Xiaomi TV A Series 2026 banner",
  ),
  builtIn(
    "default-xiaomi-eco-accessories",
    "/assets/banners/banner-xiaomi-eco-accessories-desktop.webp",
    "/assets/banners/banner-xiaomi-eco-accessories-mobile.webp",
    "Xiaomi ecosystem accessories banner",
  ),
  builtIn(
    "default-iphone-18-pro-max",
    "/assets/banners/banner-iphone-18-pro-max-desktop.webp",
    "/assets/banners/banner-iphone-18-pro-max-mobile.webp",
    "iPhone 18 Pro Max banner",
  ),
];

/** Deep copy of the built-in banners, safe to edit. */
export function defaultHomepageBanners(): HomeBanner[] {
  return DEFAULT_HOMEPAGE_BANNERS.map((banner) => ({
    ...banner,
    desktop: { ...banner.desktop },
    mobile: banner.mobile ? { ...banner.mobile } : null,
  }));
}

const BUILT_IN_SRC = /^\/assets\/banners\/[a-z0-9-]+\.(webp|png|jpg)$/;
const BANNER_ID = /^[A-Za-z0-9_-]{1,64}$/;
// Same rule as the SQL validator: one leading "/", then site-path characters only (no scheme, host, "//",
// backslash or whitespace).
const INTERNAL_LINK = /^\/([A-Za-z0-9._~%?=&#+-][A-Za-z0-9/._~%?=&#+-]*)?$/;

export function isInternalLink(value: string) {
  return value.length <= BANNER_TEXT_LIMITS.link && INTERNAL_LINK.test(value);
}

export function isBuiltInBannerSrc(value: string) {
  return BUILT_IN_SRC.test(value);
}

/** Readable message for each server/client validation code. */
export function bannerErrorMessage(code: string) {
  const match = /^banner_(\d+)_(.+)$/.exec(code);
  const where = match ? `Banner ${match[1]}: ` : "";
  const key = match ? match[2] : code;
  const messages: Record<string, string> = {
    banners_required: "Add at least one banner.",
    banners_too_many: `Use at most ${MAX_HOMEPAGE_BANNERS} banners.`,
    enabled_banner_required: "At least one banner must be enabled.",
    id_invalid: "internal id is invalid.",
    id_duplicate: "internal id is duplicated.",
    alt_invalid: `image description (alt text) is required, up to ${BANNER_TEXT_LIMITS.alt} characters.`,
    heading_invalid: `heading must be 1–${BANNER_TEXT_LIMITS.heading} characters.`,
    button_text_invalid: `button text must be 1–${BANNER_TEXT_LIMITS.buttonText} characters.`,
    button_requires_link: "a button needs a link.",
    link_invalid: "link must be an internal page path starting with / (for example /shop).",
    desktop_src_required: "desktop image is required.",
    desktop_src_not_allowed: "desktop image is not an allowed file.",
    desktop_asset_not_registered: "desktop image is not a registered upload.",
    mobile_src_not_allowed: "mobile image is not an allowed file.",
    mobile_asset_not_registered: "mobile image is not a registered upload.",
  };
  return where + (messages[key] ?? key.replace(/_/g, " "));
}

function imageErrors(image: unknown, prefix: string, allowLocalPreview: boolean): string[] {
  if (!image || typeof image !== "object") return [`${prefix}src_required`];
  const { src, publicId } = image as Partial<BannerImage>;
  if (typeof src !== "string" || !src) return [`${prefix}src_required`];
  if (publicId === null || publicId === undefined) {
    if (allowLocalPreview && isLocalPreviewSrc(src)) return [];
    return isBuiltInBannerSrc(src) ? [] : [`${prefix}src_not_allowed`];
  }
  if (typeof publicId !== "string" || !src.startsWith("https://res.cloudinary.com/")) return [`${prefix}asset_not_registered`];
  return [];
}

const optionalText = (value: unknown, max: number) =>
  value === null || value === undefined || (typeof value === "string" && value.trim().length >= 1 && value.trim().length <= max);

/**
 * Client mirror of public.validate_site_content (instant feedback only; the database is the authority and also
 * checks that uploaded images are registered site assets). allowLocalPreview accepts browser-local preview images.
 */
export function validateHomepageBanners(banners: readonly HomeBanner[], { allowLocalPreview = false } = {}) {
  const errors: string[] = [];
  if (banners.length < 1) return ["banners_required"];
  if (banners.length > MAX_HOMEPAGE_BANNERS) return ["banners_too_many"];
  const ids = new Set<string>();
  banners.forEach((banner, index) => {
    const prefix = `banner_${index + 1}_`;
    if (!BANNER_ID.test(banner.id ?? "")) errors.push(`${prefix}id_invalid`);
    else if (ids.has(banner.id)) errors.push(`${prefix}id_duplicate`);
    else ids.add(banner.id);
    const alt = typeof banner.alt === "string" ? banner.alt.trim() : "";
    if (alt.length < 1 || alt.length > BANNER_TEXT_LIMITS.alt) errors.push(`${prefix}alt_invalid`);
    if (!optionalText(banner.heading, BANNER_TEXT_LIMITS.heading)) errors.push(`${prefix}heading_invalid`);
    if (!optionalText(banner.buttonText, BANNER_TEXT_LIMITS.buttonText)) errors.push(`${prefix}button_text_invalid`);
    if (banner.buttonText != null && banner.link == null) errors.push(`${prefix}button_requires_link`);
    if (banner.link != null && !(typeof banner.link === "string" && isInternalLink(banner.link))) errors.push(`${prefix}link_invalid`);
    errors.push(...imageErrors(banner.desktop, `${prefix}desktop_`, allowLocalPreview));
    if (banner.mobile != null) errors.push(...imageErrors(banner.mobile, `${prefix}mobile_`, allowLocalPreview));
  });
  if (!banners.some((banner) => banner.enabled === true)) errors.push("enabled_banner_required");
  return errors;
}

/** Turns empty / whitespace-only optional text into null, trims the rest. Applied before saving. */
export function normalizeBanner(banner: HomeBanner): HomeBanner {
  const clean = (value: string | null) => (value && value.trim() ? value.trim() : null);
  return {
    ...banner,
    alt: banner.alt.trim(),
    heading: clean(banner.heading),
    buttonText: clean(banner.buttonText),
    link: clean(banner.link),
  };
}

/** Parses unknown JSON (published RPC result, cache, preview storage) into banners, or null if unusable. */
export function parseHomepageContent(value: unknown, { allowLocalPreview = false } = {}): HomeBanner[] | null {
  if (!value || typeof value !== "object") return null;
  const banners = (value as { banners?: unknown }).banners;
  if (!Array.isArray(banners)) return null;
  const parsed: HomeBanner[] = [];
  for (const raw of banners) {
    if (!raw || typeof raw !== "object") return null;
    const item = raw as Record<string, unknown>;
    const image = (input: unknown): BannerImage | null =>
      input && typeof input === "object" && typeof (input as BannerImage).src === "string"
        ? { src: (input as BannerImage).src, publicId: typeof (input as BannerImage).publicId === "string" ? (input as BannerImage).publicId : null }
        : null;
    const desktop = image(item.desktop);
    if (!desktop) return null;
    const text = (input: unknown) => (typeof input === "string" ? input : null);
    parsed.push({
      id: String(item.id ?? ""),
      enabled: item.enabled === true,
      alt: typeof item.alt === "string" ? item.alt : "",
      heading: text(item.heading),
      buttonText: text(item.buttonText),
      link: text(item.link),
      desktop,
      mobile: image(item.mobile),
    });
  }
  return validateHomepageBanners(parsed, { allowLocalPreview }).length === 0 ? parsed : null;
}

function deliveryUrl(image: BannerImage, width: number, cloudName: string | undefined) {
  if (!image.publicId) return image.src;
  if (!cloudName) return image.src;
  return `https://res.cloudinary.com/${cloudName}/image/upload/c_limit,w_${width},q_auto,f_auto/${image.publicId}`;
}

/** Enabled banners, in order, as carousel slides. Built-in files keep their exact path; uploads use responsive delivery. */
export function bannersToSlides(banners: readonly HomeBanner[], cloudName?: string): HomeHeroSlide[] {
  return banners
    .filter((banner) => banner.enabled)
    .map((banner) => {
      const slide: HomeHeroSlide = {
        desktopSrc: deliveryUrl(banner.desktop, BANNER_DELIVERY_WIDTH.desktop, cloudName),
        alt: banner.alt.trim(),
      };
      if (banner.mobile) slide.mobileSrc = deliveryUrl(banner.mobile, BANNER_DELIVERY_WIDTH.mobile, cloudName);
      if (banner.heading?.trim()) slide.heading = banner.heading.trim();
      if (banner.link && isInternalLink(banner.link)) {
        slide.link = banner.link;
        if (banner.buttonText?.trim()) slide.buttonText = banner.buttonText.trim();
      }
      return slide;
    });
}

/** Stable identity of a slide list (used to reset the carousel only when the slides really change). */
export function slidesSignature(slides: readonly HomeHeroSlide[]) {
  return slides.map((slide) => [slide.desktopSrc, slide.mobileSrc ?? "", slide.alt, slide.heading ?? "", slide.buttonText ?? "", slide.link ?? ""].join("|")).join("\n");
}

export function newBannerId() {
  const random = typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
  return `banner-${random.replace(/[^A-Za-z0-9]/g, "").slice(0, 24)}`;
}

export function moveBanner<T>(items: readonly T[], index: number, delta: -1 | 1): T[] {
  const target = index + delta;
  if (index < 0 || index >= items.length || target < 0 || target >= items.length) return [...items];
  const next = [...items];
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}

/** Every browser-local preview image key the banners use. */
export function localPreviewKeys(banners: readonly HomeBanner[]) {
  return banners
    .flatMap((banner) => [banner.desktop.src, banner.mobile?.src ?? ""])
    .filter(isLocalPreviewSrc)
    .map((src) => src.slice(LOCAL_PREVIEW_PREFIX.length));
}

/**
 * Replaces browser-local preview images with their object URLs. A banner whose desktop image is missing is dropped;
 * a missing mobile image falls back to the desktop one (same rule as the live carousel).
 */
export function resolveLocalPreviewImages(banners: readonly HomeBanner[], urls: ReadonlyMap<string, string>): HomeBanner[] {
  const resolve = (src: string) => (isLocalPreviewSrc(src) ? urls.get(src.slice(LOCAL_PREVIEW_PREFIX.length)) ?? null : src);
  return banners.flatMap((banner) => {
    const desktop = resolve(banner.desktop.src);
    if (!desktop) return [];
    const mobile = banner.mobile ? resolve(banner.mobile.src) : null;
    return [{ ...banner, desktop: { ...banner.desktop, src: desktop }, mobile: banner.mobile && mobile ? { ...banner.mobile, src: mobile } : null }];
  });
}

export function sameBanners(a: readonly HomeBanner[], b: readonly HomeBanner[]) {
  return JSON.stringify(a) === JSON.stringify(b);
}
