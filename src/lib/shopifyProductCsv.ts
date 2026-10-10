/**
 * Shopify "Products" CSV export → one image source per Shopify product (pure; no
 * network, no database). Shopify writes one row per variant / extra image: only the
 * first row of a Handle carries Title and Vendor, later rows of the same Handle add
 * Image Src / Image Position. Variant Image is ignored (colour images come later).
 * Nothing is downloaded here; URLs are only validated.
 */
import { csvRows } from "./bulkCatalog.ts";
import { familyBrandText, type ImageSource } from "./productImageMatching.ts";

export type ShopifyImage = { src: string; position: number; alt: string };

export type ShopifyProductImages = {
  handle: string;
  title: string;
  vendor: string;
  status: string;
  images: ShopifyImage[];
  /** Lowest Image Position; the only image used in the first version. */
  primaryImage: ShopifyImage | null;
};

const SUPPORTED_EXTENSIONS = /\.(?:jpe?g|png|webp|avif)$/i;

const headerKey = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, "");

/** https only; Shopify CDN (cdn.shopify.com or a store domain's /cdn/shop/ path); JPEG/PNG/WebP/AVIF. */
export function shopifyImageUrlProblem(value: string) {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    return "Image URL is not a valid URL.";
  }
  if (url.protocol !== "https:") return "Image URL must use https.";
  if (url.username || url.password) return "Image URL must not contain credentials.";
  if (url.hostname !== "cdn.shopify.com" && !url.pathname.startsWith("/cdn/shop/"))
    return "Image URL is not a Shopify CDN image.";
  if (!SUPPORTED_EXTENSIONS.test(url.pathname)) return "Shopify image must be JPEG, PNG, WebP or AVIF.";
  return null;
}

export function parseShopifyProductsCsv(text: string) {
  const rows = csvRows(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text);
  const errors: string[] = [];
  if (rows.length === 0) return { products: [] as ShopifyProductImages[], errors: ["The CSV file is empty."], rowCount: 0 };

  const header = rows[0].map(headerKey);
  const column = (name: string) => header.indexOf(headerKey(name));
  const columns = {
    handle: column("Handle"),
    title: column("Title"),
    vendor: column("Vendor"),
    status: column("Status"),
    imageSrc: column("Image Src"),
    imagePosition: column("Image Position"),
    imageAlt: column("Image Alt Text"),
  };
  if (columns.handle < 0) errors.push('Missing "Handle" column — is this a Shopify Products export?');
  if (columns.imageSrc < 0) errors.push('Missing "Image Src" column — is this a Shopify Products export?');
  if (columns.title < 0) errors.push('Missing "Title" column — is this a Shopify Products export?');
  if (errors.length) return { products: [] as ShopifyProductImages[], errors, rowCount: rows.length - 1 };

  const cell = (row: string[], index: number) => (index >= 0 ? (row[index] ?? "").trim() : "");
  const byHandle = new Map<string, ShopifyProductImages & { order: number }>();
  rows.slice(1).forEach((row, rowIndex) => {
    const handle = cell(row, columns.handle);
    if (!handle) return;
    const product =
      byHandle.get(handle) ??
      byHandle.set(handle, { handle, title: "", vendor: "", status: "", images: [], primaryImage: null, order: byHandle.size }).get(handle)!;
    product.title ||= cell(row, columns.title);
    product.vendor ||= cell(row, columns.vendor);
    product.status ||= cell(row, columns.status);
    const src = cell(row, columns.imageSrc);
    if (src && !product.images.some((image) => image.src === src)) {
      const position = Number.parseInt(cell(row, columns.imagePosition), 10);
      product.images.push({
        src,
        // Rows without a position keep file order, after positioned images.
        position: Number.isFinite(position) && position > 0 ? position : 100_000 + rowIndex,
        alt: cell(row, columns.imageAlt),
      });
    }
  });

  const products = [...byHandle.values()]
    .sort((a, b) => a.order - b.order)
    .map((product): ShopifyProductImages => {
      const images = [...product.images].sort((a, b) => a.position - b.position);
      const { handle, title, vendor, status } = product;
      return { handle, title, vendor, status, images, primaryImage: images[0] ?? null };
    });
  return { products, errors, rowCount: rows.length - 1 };
}

/**
 * Matching texts for a Shopify product. Title (with Vendor prefixed when Vendor is a
 * catalog brand the title does not already start with) and the Handle may match
 * exactly; a brand inferred from a model family ("Galaxy …") is review-only.
 */
export function shopifyImageSources(products: ShopifyProductImages[], brands: string[]): ImageSource[] {
  return products.map((product) => {
    const title = product.title || product.handle;
    const vendorBrand = brands.find((brand) => brand.toLowerCase() === product.vendor.trim().toLowerCase());
    const texts =
      vendorBrand && !title.toLowerCase().startsWith(`${vendorBrand.toLowerCase()} `)
        ? [`${vendorBrand} ${title}`, title, product.handle]
        : [title, product.handle];
    const inferred = familyBrandText(title, brands);
    return {
      id: `shopify:${product.handle}`,
      label: product.title ? `${product.title} (${product.handle})` : product.handle,
      texts,
      reviewTexts: inferred ? [inferred] : [],
      invalidReason: product.primaryImage
        ? shopifyImageUrlProblem(product.primaryImage.src)
        : "No product image in the Shopify export.",
    };
  });
}
