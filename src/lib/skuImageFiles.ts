/**
 * Reads the files chosen for Bulk Image Upload by SKU (multiple files, a folder or a ZIP) into SkuImageFile records:
 * SHA-256, real format (magic bytes) and pixel size from the image header. Nothing is uploaded here.
 */
import { sniffImageFormat, type SkuImageFile, type SkuImageFormat } from "./skuImageUpload.ts";

const IMAGE_EXTENSION = /\.(jpe?g|png|webp)$/i;
/** System / metadata files that are never images and are ignored silently. */
const SYSTEM_FILE = /(^|\/)(__MACOSX\/|\.[^/]*$|thumbs\.db$|desktop\.ini$)/i;
export const MAX_ZIP_BYTES = 600 * 1024 * 1024;

const MIME: Record<SkuImageFormat, string> = { jpeg: "image/jpeg", png: "image/png", webp: "image/webp" };
const mimeForName = (name: string) => {
  const ext = name.toLowerCase().split(".").pop();
  return ext === "png" ? MIME.png : ext === "webp" ? MIME.webp : MIME.jpeg;
};

/** Pixel size from the PNG / JPEG / WebP header (no decoding). */
export function imageDimensions(bytes: Uint8Array, format: SkuImageFormat): { width: number; height: number } | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  try {
    if (format === "png") return { width: view.getUint32(16), height: view.getUint32(20) };
    if (format === "webp") {
      const chunk = String.fromCharCode(...bytes.slice(12, 16));
      if (chunk === "VP8X") return { width: 1 + (bytes[24] | (bytes[25] << 8) | (bytes[26] << 16)), height: 1 + (bytes[27] | (bytes[28] << 8) | (bytes[29] << 16)) };
      if (chunk === "VP8L") {
        const b = bytes.slice(21, 25);
        return { width: 1 + (((b[1] & 0x3f) << 8) | b[0]), height: 1 + (((b[3] & 0x0f) << 10) | (b[2] << 2) | ((b[1] & 0xc0) >> 6)) };
      }
      if (chunk === "VP8 ") return { width: view.getUint16(26, true) & 0x3fff, height: view.getUint16(28, true) & 0x3fff };
      return null;
    }
    // JPEG: walk the markers to the first SOFn frame header.
    let offset = 2;
    while (offset + 9 < bytes.length) {
      if (bytes[offset] !== 0xff) return null;
      const marker = bytes[offset + 1];
      if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
        offset += 2;
        continue;
      }
      const length = view.getUint16(offset + 2);
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc)
        return { height: view.getUint16(offset + 5), width: view.getUint16(offset + 7) };
      offset += 2 + length;
    }
  } catch {
    return null;
  }
  return null;
}

async function sha256Hex(bytes: Uint8Array) {
  const digest = await crypto.subtle.digest("SHA-256", bytes as unknown as ArrayBuffer);
  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, "0")).join("");
}

export async function describeImage(index: number, name: string, path: string, blob: Blob): Promise<SkuImageFile> {
  const base: SkuImageFile = { index, name, path, size: blob.size, file: blob, sha256: null, format: null, width: null, height: null, readError: null };
  try {
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const format = sniffImageFormat(bytes);
    if (!format) return { ...base, readError: "The file contents are not a JPG, PNG or WebP image." };
    const size = imageDimensions(bytes, format);
    if (!size || size.width <= 0 || size.height <= 0) return { ...base, format, readError: "The image size could not be read (damaged or unusual file)." };
    return { ...base, format, width: size.width, height: size.height, sha256: await sha256Hex(bytes) };
  } catch {
    return { ...base, readError: "The file could not be read." };
  }
}

export type ReadSkuFilesResult = { files: SkuImageFile[]; ignored: string[]; error: string | null };

type PickedFile = { name: string; size: number; webkitRelativePath?: string } & Blob;

/** Files from a multiple-file or folder picker. Non-image files are listed as ignored. */
export async function readPickedFiles(picked: PickedFile[], startIndex = 0, onProgress?: (done: number, total: number) => void): Promise<ReadSkuFilesResult> {
  const files: SkuImageFile[] = [];
  const ignored: string[] = [];
  const images = picked.filter((file) => {
    const path = file.webkitRelativePath || file.name;
    if (SYSTEM_FILE.test(path)) return false;
    if (!IMAGE_EXTENSION.test(file.name)) {
      ignored.push(path);
      return false;
    }
    return true;
  });
  for (const [offset, file] of images.entries()) {
    files.push(await describeImage(startIndex + offset, file.name, file.webkitRelativePath || file.name, file));
    onProgress?.(offset + 1, images.length);
  }
  return { files, ignored, error: null };
}

/** A ZIP of images (folders inside the ZIP are fine). */
export async function readZipFile(zip: Blob & { name?: string }, startIndex = 0, onProgress?: (done: number, total: number) => void): Promise<ReadSkuFilesResult> {
  if (zip.size > MAX_ZIP_BYTES) return { files: [], ignored: [], error: `The ZIP is larger than ${MAX_ZIP_BYTES / 1024 / 1024} MB; split it into smaller ZIPs or choose the folder instead.` };
  const { default: JSZip } = await import("jszip");
  let archive: InstanceType<typeof JSZip>;
  try {
    archive = await JSZip.loadAsync(zip);
  } catch {
    return { files: [], ignored: [], error: "The ZIP file could not be read." };
  }
  const entries = Object.values(archive.files).filter((entry) => !entry.dir && !SYSTEM_FILE.test(entry.name));
  const ignored = entries.filter((entry) => !IMAGE_EXTENSION.test(entry.name)).map((entry) => entry.name);
  const images = entries.filter((entry) => IMAGE_EXTENSION.test(entry.name)).sort((a, b) => a.name.localeCompare(b.name));
  const files: SkuImageFile[] = [];
  for (const [offset, entry] of images.entries()) {
    const name = entry.name.split("/").pop()!;
    const bytes = await entry.async("uint8array");
    files.push(await describeImage(startIndex + offset, name, `${zip.name ?? "ZIP"}/${entry.name}`, new Blob([bytes as unknown as ArrayBuffer], { type: mimeForName(name) })));
    onProgress?.(offset + 1, images.length);
  }
  return { files, ignored, error: null };
}
