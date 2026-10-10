/**
 * Shared signed Cloudinary upload for product media (Phase 3B flow), used by the
 * per-product Media tab and, later, Bulk Product Images.
 *
 * 1. `cloudinary-upload-signature` Edge Function (Admin-only) signs folder,
 *    timestamp and the optimized-master transformation; the API secret never
 *    reaches the browser.
 * 2. The browser posts the source straight to Cloudinary with only file,
 *    api_key, signature and the signed parameters.
 * Metadata insert, primary and replace/delete handling stay with the caller.
 * The Supabase client and the request factory are injected so this module has
 * no import-time environment dependency and can be tested without a network.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

export type UploadSignature = {
  cloudName: string;
  apiKey: string;
  signature: string;
  signedParameters: {
    folder: string;
    timestamp: number;
    transformation: string;
  };
};

/** Maps a Cloudinary error body to a safe, user-facing message (no raw provider text). */
export function safeCloudinaryUploadError(responseText: string) {
  let message = "";
  try {
    const parsed = JSON.parse(responseText) as {
      error?: { message?: unknown };
    };
    if (typeof parsed.error?.message === "string")
      message = parsed.error.message;
  } catch {
    return "Cloudinary rejected the upload with an invalid response.";
  }
  if (/invalid transformation/i.test(message))
    return "Cloudinary rejected the optimized-master transformation.";
  if (/invalid signature/i.test(message))
    return "Cloudinary rejected the upload signature.";
  if (/file size|too large/i.test(message))
    return "Cloudinary rejected the source file size.";
  if (/format|unsupported|invalid image/i.test(message))
    return "Cloudinary rejected the image format or file contents.";
  return "Cloudinary rejected the upload.";
}

/** Requests a short-lived signed upload for one product's media folder. */
export async function requestProductUploadSignature(
  client: Pick<SupabaseClient, "functions">,
  productId: string,
) {
  const { data, error } = await client.functions.invoke<UploadSignature>(
    "cloudinary-upload-signature",
    { body: { productId } },
  );
  if (error || !data)
    throw new Error(error?.message || "Upload authorization failed.");
  return data;
}

/**
 * Builds the Cloudinary upload form. `source` is the image file, or (for a remote
 * source such as a Shopify CDN image) an https URL that Cloudinary fetches itself.
 * Only these fields are sent; nothing else can loosen the signed parameters.
 */
export function cloudinaryUploadForm(source: Blob | string, data: UploadSignature) {
  const form = new FormData();
  form.set("file", source);
  form.set("api_key", data.apiKey);
  form.set("signature", data.signature);
  for (const [key, value] of Object.entries(data.signedParameters))
    form.set(key, String(value));
  return form;
}

/** Uploads to Cloudinary and resolves with its parsed JSON response. */
export function uploadToCloudinary(
  data: UploadSignature,
  source: Blob | string,
  options: {
    onProgress?: (percent: number) => void;
    createRequest?: () => XMLHttpRequest;
  } = {},
) {
  const form = cloudinaryUploadForm(source, data);
  return new Promise<Record<string, unknown>>((resolve, reject) => {
    const xhr = (options.createRequest ?? (() => new XMLHttpRequest()))();
    xhr.open(
      "POST",
      `https://api.cloudinary.com/v1_1/${data.cloudName}/image/upload`,
    );
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable)
        options.onProgress?.(Math.round((event.loaded / event.total) * 100));
    };
    xhr.onerror = () => reject(new Error("Cloudinary upload failed."));
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          resolve(JSON.parse(xhr.responseText));
        } catch {
          reject(new Error("Cloudinary returned an invalid upload response."));
        }
        return;
      }
      reject(new Error(safeCloudinaryUploadError(xhr.responseText)));
    };
    xhr.send(form);
  });
}
