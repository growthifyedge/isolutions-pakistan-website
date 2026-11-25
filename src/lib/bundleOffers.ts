/**
 * Bundle Offers Editor (Admin Studio → Homepage → Bundle Offers), localhost implementation 2026-11-25.
 *
 * The homepage Bundle Offers section shows four fixed bundle tiles and one large promotional banner. The Owner can
 * replace each image and edit each destination link; the layout, sizes and responsive behaviour stay as they are.
 *
 * Stored as Website Editor content, scope "bundle_offers" (migration 202611250002 — prepared, not applied): Owner-only
 * Save Draft / Publish / Restore, published-only public read. image null = the built-in image for that slot.
 * Nothing published, a read failure or unusable data = today's built-in tiles, links and banner.
 * Images use the same signed Cloudinary siteAsset upload as the Homepage Banner editor (uploadBannerImage).
 */
import { LOCAL_PREVIEW_PREFIX, isInternalLink, isLocalPreviewSrc, type BannerImage } from "./homepageBanners.ts";

export type BundleOfferImage = BannerImage;
export type BundleOfferTile = { image: BundleOfferImage | null; link: string };
export type BundleOfferPromo = { image: BundleOfferImage | null; link: string | null };
export type BundleOffersContent = { tiles: BundleOfferTile[]; promo: BundleOfferPromo };

/** Today's homepage tiles (titles stay fixed: they are the tiles' accessible names). */
export const BUILT_IN_BUNDLE_TILES = [
  { title: "Phone Essentials Bundle", image: "/assets/bundles/bundle-phone-essentials.png", href: "/collections/bundle-offers?bundle=phone-essentials" },
  { title: "Power On-the-Go Bundle", image: "/assets/bundles/bundle-power-on-go.png", href: "/collections/bundle-offers?bundle=power-on-go" },
  { title: "MacBook Essentials Bundle", image: "/assets/bundles/bundle-macbook-essentials.png", href: "/collections/bundle-offers?bundle=macbook-essentials" },
  { title: "Everyday Essentials Bundle", image: "/assets/bundles/bundle-everyday-essentials.png", href: "/collections/bundle-offers?bundle=everyday-essentials" },
] as const;
export const BUILT_IN_BUNDLE_PROMO_IMAGE = "/assets/bundles/bundle-offers-banner.png";

/** Recommended upload sizes = the built-in artwork (tiles 4:3, promo 1315:1196 — the banner box keeps that shape). */
export const BUNDLE_TILE_RECOMMENDED = { width: 1456, height: 1080 } as const;
export const BUNDLE_PROMO_RECOMMENDED = { width: 1315, height: 1196 } as const;
/** Delivery widths (Cloudinary c_limit: resized, never cropped). */
export const BUNDLE_TILE_DELIVERY_WIDTH = 900;
export const BUNDLE_PROMO_DELIVERY_WIDTH = 1400;
export const BUNDLE_OFFERS_CACHE_KEY = "isp.bundleOffers.v1";

const CLOUDINARY = /^https:\/\/res\.cloudinary\.com\/[A-Za-z0-9_-]+\/image\/upload\//;

export function defaultBundleOffers(): BundleOffersContent {
  return { tiles: BUILT_IN_BUNDLE_TILES.map((tile) => ({ image: null, link: tile.href })), promo: { image: null, link: null } };
}

const readImage = (value: unknown, allowLocalPreview: boolean): BundleOfferImage | null | undefined => {
  if (value === null || value === undefined) return null;
  if (typeof value !== "object") return undefined;
  const { src, publicId } = value as { src?: unknown; publicId?: unknown };
  if (typeof src !== "string") return undefined;
  if (allowLocalPreview && isLocalPreviewSrc(src)) return { src, publicId: null };
  if (typeof publicId !== "string" || !publicId || !CLOUDINARY.test(src)) return undefined;
  return { src, publicId };
};

/** Problems (mirrors public.validate_bundle_offers_content; the server is the authority). Empty = valid. */
export function validateBundleOffers(value: BundleOffersContent, { allowLocalPreview = false } = {}) {
  const errors: string[] = [];
  if (value.tiles.length !== 4) errors.push("There must be exactly four bundle tiles.");
  value.tiles.forEach((tile, index) => {
    if (tile.image && readImage(tile.image, allowLocalPreview) === undefined) errors.push(`Tile ${index + 1}: the image is not an uploaded image.`);
    if (!isInternalLink(tile.link)) errors.push(`Tile ${index + 1}: the link must be a page of this website, starting with / (for example /collections/bundle-offers).`);
  });
  if (value.promo.image && readImage(value.promo.image, allowLocalPreview) === undefined) errors.push("Promotional banner: the image is not an uploaded image.");
  if (value.promo.link !== null && !isInternalLink(value.promo.link))
    errors.push("Promotional banner: the link must be a page of this website, starting with / — or leave it empty.");
  return errors;
}

/** Empty link text = no link for the promo; tile links are kept as typed (validated). */
export function normalizeBundleOffers(value: BundleOffersContent): BundleOffersContent {
  return {
    tiles: value.tiles.map((tile) => ({ image: tile.image, link: tile.link.trim() })),
    promo: { image: value.promo.image, link: value.promo.link?.trim() ? value.promo.link.trim() : null },
  };
}

/** Stored / published JSON -> content; null when unusable (the storefront then keeps the built-in section). */
export function parseBundleOffers(value: unknown, { allowLocalPreview = false } = {}): BundleOffersContent | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as { tiles?: unknown; promo?: unknown };
  if (!Array.isArray(raw.tiles) || raw.tiles.length !== 4 || !raw.promo || typeof raw.promo !== "object") return null;
  const tiles: BundleOfferTile[] = [];
  for (const entry of raw.tiles) {
    if (!entry || typeof entry !== "object") return null;
    const { image, link } = entry as { image?: unknown; link?: unknown };
    const parsed = readImage(image, allowLocalPreview);
    if (parsed === undefined || typeof link !== "string") return null;
    tiles.push({ image: parsed, link });
  }
  const promoRaw = raw.promo as { image?: unknown; link?: unknown };
  const promoImage = readImage(promoRaw.image, allowLocalPreview);
  if (promoImage === undefined) return null;
  if (promoRaw.link !== null && promoRaw.link !== undefined && typeof promoRaw.link !== "string") return null;
  const content: BundleOffersContent = { tiles, promo: { image: promoImage, link: typeof promoRaw.link === "string" ? promoRaw.link : null } };
  return validateBundleOffers(content, { allowLocalPreview }).length ? null : content;
}

/** Image URL to show: Cloudinary resize only (c_limit keeps the whole image); local preview = object URL; null = built-in. */
export function bundleOfferImageUrl(image: BundleOfferImage | null, width: number, cloudName: string | undefined, localUrls?: ReadonlyMap<string, string>) {
  if (!image) return null;
  if (isLocalPreviewSrc(image.src)) return localUrls?.get(image.src.slice(LOCAL_PREVIEW_PREFIX.length)) ?? null;
  return cloudName && image.publicId ? `https://res.cloudinary.com/${cloudName}/image/upload/c_limit,w_${width},q_auto,f_auto/${image.publicId}` : image.src;
}

/** What the homepage renders for this content (built-in image / link wherever the content leaves it empty). */
export function resolveBundleOffers(content: BundleOffersContent | null, cloudName: string | undefined, localUrls?: ReadonlyMap<string, string>) {
  const value = content ?? defaultBundleOffers();
  return {
    tiles: BUILT_IN_BUNDLE_TILES.map((builtIn, index) => {
      const tile = value.tiles[index];
      return {
        title: builtIn.title,
        image: bundleOfferImageUrl(tile?.image ?? null, BUNDLE_TILE_DELIVERY_WIDTH, cloudName, localUrls) ?? builtIn.image,
        href: tile?.link || builtIn.href,
      };
    }),
    promo: {
      image: bundleOfferImageUrl(value.promo.image, BUNDLE_PROMO_DELIVERY_WIDTH, cloudName, localUrls),
      href: value.promo.link,
    },
  };
}

export const sameBundleOffers = (a: BundleOffersContent | null, b: BundleOffersContent | null) => JSON.stringify(a) === JSON.stringify(b);
