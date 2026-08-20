export const MAX_SOURCE_IMAGE_BYTES = 25 * 1024 * 1024;
export const SUPPORTED_IMAGE_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/avif",
] as const;

export type ProductMedia = {
  id: string;
  product_id: string;
  variant_id: string | null;
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

export async function validateSourceImage(file: File) {
  if (
    !SUPPORTED_IMAGE_TYPES.includes(
      file.type as (typeof SUPPORTED_IMAGE_TYPES)[number],
    )
  )
    return "Use a JPEG, PNG, WebP, or AVIF image.";
  if (file.size <= 0) return "The selected file is empty.";
  if (file.size > MAX_SOURCE_IMAGE_BYTES)
    return "The source image must be 25 MB or smaller.";
  const bytes = new Uint8Array(await file.slice(0, 12).arrayBuffer());
  const isJpeg = bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  const isPng = bytes
    .slice(0, 8)
    .every(
      (value, index) =>
        value === [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a][index],
    );
  const isWebp =
    String.fromCharCode(...bytes.slice(0, 4)) === "RIFF" &&
    String.fromCharCode(...bytes.slice(8, 12)) === "WEBP";
  const isAvif = String.fromCharCode(...bytes.slice(4, 12)).includes(
    "ftypavif",
  );
  if (!isJpeg && !isPng && !isWebp && !isAvif)
    return "The file contents do not match a supported image format.";
  return null;
}

export function cloudinaryDeliveryUrl(publicId: string, width: number) {
  const cloudName = import.meta.env.VITE_CLOUDINARY_CLOUD_NAME;
  if (!cloudName || !publicId) return "";
  const safeWidth = Math.max(160, Math.min(3000, Math.round(width)));
  return `https://res.cloudinary.com/${cloudName}/image/upload/c_limit,w_${safeWidth},q_auto,f_auto/${publicId}`;
}

export function containsBinaryMediaData(value: unknown): boolean {
  return /data:image\/|;base64,/i.test(JSON.stringify(value));
}
