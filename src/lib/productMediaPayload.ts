/**
 * Pure mapping from a Cloudinary upload response to a `product_media` insert, and the
 * primary-image decision for bulk assignment. No network or database access here.
 * Field set mirrors the per-product Media tab (MediaManager) exactly.
 */
import { containsBinaryMediaData } from "./cloudinary.ts";

export type ProductMediaInsert = {
  product_id: string;
  variant_id: null;
  cloudinary_public_id: string;
  cloudinary_asset_id: string;
  cloudinary_version: number;
  secure_url: string;
  width: number;
  height: number;
  bytes: number;
  format: string;
  alt_text: string;
  sort_order: number;
  is_primary: boolean;
};

const DELIVERED_FORMATS = new Set(["jpg", "jpeg", "png", "webp", "avif"]);
const positiveInteger = (value: unknown): value is number => Number.isInteger(value) && (value as number) > 0;

/**
 * Validates a Cloudinary upload response and maps it to product media metadata.
 * The asset must sit in this product's folder (`…/products/<productId>/…`), so a
 * response can never be attached to the wrong product.
 */
export function productMediaPayload(
  result: Record<string, unknown>,
  target: { productId: string; altText: string; sortOrder: number; isPrimary: boolean },
): ProductMediaInsert {
  const { public_id, asset_id, version, secure_url, width, height, bytes, format } = result;
  if (typeof public_id !== "string" || !public_id.includes(`/products/${target.productId}/`))
    throw new Error("Cloudinary response does not belong to this product's media folder.");
  if (typeof asset_id !== "string" || !asset_id) throw new Error("Cloudinary response is missing the asset id.");
  if (!positiveInteger(version)) throw new Error("Cloudinary response is missing the asset version.");
  if (typeof secure_url !== "string" || !secure_url.startsWith("https://res.cloudinary.com/"))
    throw new Error("Cloudinary response is missing a secure delivery URL.");
  if (!positiveInteger(width) || !positiveInteger(height) || !positiveInteger(bytes))
    throw new Error("Cloudinary response is missing image dimensions or size.");
  if (typeof format !== "string" || !DELIVERED_FORMATS.has(format.toLowerCase()))
    throw new Error("Cloudinary stored an unsupported image format.");
  const altText = target.altText.trim();
  if (!altText) throw new Error("Alt text is required.");
  const payload: ProductMediaInsert = {
    product_id: target.productId,
    variant_id: null,
    cloudinary_public_id: public_id,
    cloudinary_asset_id: asset_id,
    cloudinary_version: version,
    secure_url,
    width,
    height,
    bytes,
    format: format.toLowerCase(),
    alt_text: altText,
    sort_order: target.sortOrder,
    is_primary: target.isPrimary,
  };
  if (containsBinaryMediaData(payload)) throw new Error("Binary image data cannot be stored as metadata.");
  return payload;
}

/**
 * Primary decision from the product's media as re-read immediately before upload.
 * - No primary yet → insert as primary.
 * - Primary exists, default → skip (Owner-approved default; nothing uploaded).
 * - Primary exists, explicit "add and make primary" → insert as non-primary at the end,
 *   then switch via set_product_media_primary (the one-primary index forbids inserting
 *   a second primary). Existing media is never deleted.
 */
export function planPrimaryAssignment(
  existing: { count: number; hasPrimary: boolean },
  mode: "primary" | "make_primary",
):
  | { action: "skip"; reason: string }
  | { action: "insert"; isPrimary: boolean; sortOrder: number; makePrimaryAfterInsert: boolean } {
  if (!existing.hasPrimary) return { action: "insert", isPrimary: true, sortOrder: existing.count, makePrimaryAfterInsert: false };
  if (mode !== "make_primary") return { action: "skip", reason: "Product already has a primary image." };
  return { action: "insert", isPrimary: false, sortOrder: existing.count, makePrimaryAfterInsert: true };
}
