import { ChangeEvent, useCallback, useEffect, useRef, useState } from "react";
import {
  ChevronDown,
  ChevronUp,
  ImagePlus,
  RefreshCw,
  Star,
  Trash2,
  UploadCloud,
} from "lucide-react";
import { supabase } from "../lib/supabase";
import {
  ProductMedia,
  containsBinaryMediaData,
  validateSourceImage,
} from "../lib/cloudinary";

type UploadSignature = {
  cloudName: string;
  apiKey: string;
  signature: string;
  folder: string;
  overwrite: string;
  timestamp: number;
  transformation: string;
  unique_filename: string;
  use_filename: string;
  expiresAt: number;
};

function safeCloudinaryUploadError(responseText: string) {
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

const cloudinaryConfigured = Boolean(
  import.meta.env.VITE_CLOUDINARY_CLOUD_NAME,
);

export function MediaManager({ productId }: { productId: string | null }) {
  const [media, setMedia] = useState<ProductMedia[]>([]);
  const [progress, setProgress] = useState(0);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [replacementId, setReplacementId] = useState<string | null>(null);
  const [variants, setVariants] = useState<{ id: string; sku: string }[]>([]);
  const input = useRef<HTMLInputElement>(null);

  const loadMedia = useCallback(async () => {
    if (!supabase || !productId) return;
    const { data, error } = await supabase
      .from("product_media")
      .select("*")
      .eq("product_id", productId)
      .order("sort_order");
    if (error) setMessage(error.message);
    else setMedia((data ?? []) as ProductMedia[]);
    const { data: variantData } = await supabase
      .from("product_variants")
      .select("id,sku")
      .eq("product_id", productId)
      .order("sort_order");
    setVariants(variantData ?? []);
  }, [productId]);
  useEffect(() => {
    void loadMedia();
  }, [loadMedia]);

  async function upload(file: File) {
    const validation = await validateSourceImage(file);
    if (validation) {
      setMessage(validation);
      return;
    }
    if (!supabase || !productId || !cloudinaryConfigured) {
      setMessage(
        "Cloudinary connection and a saved development product are required before upload.",
      );
      return;
    }
    setBusy(true);
    setProgress(0);
    setMessage("Requesting secure upload authorization…");
    try {
      const { data, error } = await supabase.functions.invoke<UploadSignature>(
        "cloudinary-upload-signature",
        { body: { productId } },
      );
      if (error || !data)
        throw new Error(error?.message || "Upload authorization failed.");
      const form = new FormData();
      form.set("file", file);
      form.set("api_key", data.apiKey);
      form.set("signature", data.signature);
      for (const key of [
        "folder",
        "overwrite",
        "timestamp",
        "transformation",
        "unique_filename",
        "use_filename",
      ] as const)
        form.set(key, String(data[key]));
      const result = await new Promise<Record<string, unknown>>(
        (resolve, reject) => {
          const xhr = new XMLHttpRequest();
          xhr.open(
            "POST",
            `https://api.cloudinary.com/v1_1/${data.cloudName}/image/upload`,
          );
          xhr.upload.onprogress = (event) =>
            event.lengthComputable &&
            setProgress(Math.round((event.loaded / event.total) * 100));
          xhr.onerror = () => reject(new Error("Cloudinary upload failed."));
          xhr.onload = () => {
            if (xhr.status >= 200 && xhr.status < 300) {
              try {
                resolve(JSON.parse(xhr.responseText));
              } catch {
                reject(
                  new Error("Cloudinary returned an invalid upload response."),
                );
              }
              return;
            }
            reject(new Error(safeCloudinaryUploadError(xhr.responseText)));
          };
          xhr.send(form);
        },
      );
      const metadata = {
        product_id: productId,
        variant_id: null,
        cloudinary_public_id: result.public_id,
        cloudinary_asset_id: result.asset_id,
        cloudinary_version: result.version,
        secure_url: result.secure_url,
        width: result.width,
        height: result.height,
        bytes: result.bytes,
        format: result.format,
        alt_text: file.name.replace(/\.[^.]+$/, "").replace(/[-_]+/g, " "),
        sort_order: media.length,
        is_primary: media.length === 0,
      };
      if (containsBinaryMediaData(metadata))
        throw new Error("Binary image data cannot be stored as metadata.");
      const { data: inserted, error: insertError } = await supabase
        .from("product_media")
        .insert(metadata)
        .select()
        .single();
      if (insertError) throw insertError;
      if (replacementId) {
        const replaced = media.find((item) => item.id === replacementId);
        if (replaced?.is_primary)
          await supabase.rpc("set_product_media_primary", {
            p_media_id: inserted.id,
          });
        const { error: deleteError } = await supabase.functions.invoke(
          "cloudinary-delete-media",
          { body: { mediaId: replacementId } },
        );
        if (deleteError)
          throw new Error(
            "Replacement uploaded, but the previous asset still requires deletion.",
          );
      }
      setReplacementId(null);
      setMessage("Optimized master uploaded and metadata saved.");
      await loadMedia();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Upload failed.");
    } finally {
      setBusy(false);
      setProgress(0);
      if (input.current) input.current.value = "";
    }
  }

  async function update(id: string, values: Partial<ProductMedia>) {
    if (!supabase) return;
    const { error } = await supabase
      .from("product_media")
      .update(values)
      .eq("id", id);
    setMessage(error ? error.message : "Media metadata updated.");
    if (!error) await loadMedia();
  }
  async function makePrimary(id: string) {
    if (!supabase) return;
    const { error } = await supabase.rpc("set_product_media_primary", {
      p_media_id: id,
    });
    setMessage(error ? error.message : "Primary image updated.");
    if (!error) await loadMedia();
  }
  async function reorder(index: number, direction: -1 | 1) {
    if (!supabase || !productId) return;
    const next = [...media];
    const target = index + direction;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    const { error } = await supabase.rpc("reorder_product_media", {
      p_product_id: productId,
      p_media_ids: next.map((item) => item.id),
    });
    setMessage(error ? error.message : "Image order updated.");
    if (!error) await loadMedia();
  }
  async function remove(id: string) {
    if (!supabase || !confirm("Delete this optimized master and its metadata?"))
      return;
    setBusy(true);
    const { error } = await supabase.functions.invoke(
      "cloudinary-delete-media",
      { body: { mediaId: id } },
    );
    setBusy(false);
    setMessage(error ? error.message : "Image deleted safely.");
    if (!error) await loadMedia();
  }
  function choose(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (file) void upload(file);
  }

  const ready = cloudinaryConfigured && Boolean(productId);
  return (
    <div className="media-manager">
      <div className="editor-section-title media-title">
        <div>
          <span className="admin-kicker">CLOUDINARY PRODUCT MEDIA</span>
          <h2>Media</h2>
          <p>
            One optimized high-quality master with responsive delivery generated
            on demand.
          </p>
        </div>
        <button
          className="admin-primary"
          disabled={!ready || busy}
          onClick={() => input.current?.click()}
        >
          <UploadCloud /> Upload image
        </button>
        <input
          ref={input}
          hidden
          type="file"
          accept="image/jpeg,image/png,image/webp,image/avif"
          onChange={choose}
        />
      </div>
      {!ready && (
        <div className="media-preconnection">
          <ImagePlus />
          <div>
            <strong>Safe pre-connection state</strong>
            <p>
              {!cloudinaryConfigured
                ? "Cloudinary browser-safe configuration is not present. Upload remains disabled until Edge Function secrets and the public cloud name are configured."
                : "Save this development product to Supabase before assigning media."}
            </p>
            <small>
              JPEG, PNG, WebP or AVIF · maximum source size 25 MB · optimized
              master limited to 3000 × 3000 without upscaling
            </small>
          </div>
        </div>
      )}
      {busy && (
        <div className="media-progress">
          <span style={{ width: `${Math.max(progress, 8)}%` }} />
          <p>{progress ? `Uploading ${progress}%` : message}</p>
        </div>
      )}
      {message && !busy && (
        <p className="media-message" role="status">
          {message}
        </p>
      )}
      {media.length === 0 ? (
        <div className="media-empty">
          <div className="media-placeholder">
            <ImagePlus />
          </div>
          <h3>No product images yet</h3>
          <p>The publication guard requires one complete primary image.</p>
        </div>
      ) : (
        <div className="media-grid">
          {media.map((item, index) => (
            <article key={item.id} className={item.is_primary ? "primary" : ""}>
              <img src={item.secure_url} alt={item.alt_text} />
              <div className="media-card-body">
                <div className="media-badges">
                  {item.is_primary && (
                    <span>
                      <Star /> Primary
                    </span>
                  )}
                  <small>
                    {item.width} × {item.height} · {item.format.toUpperCase()}
                  </small>
                </div>
                <label>
                  Alt text
                  <input
                    value={item.alt_text}
                    onChange={(event) =>
                      setMedia((current) =>
                        current.map((entry) =>
                          entry.id === item.id
                            ? { ...entry, alt_text: event.target.value }
                            : entry,
                        ),
                      )
                    }
                    onBlur={() =>
                      void update(item.id, { alt_text: item.alt_text })
                    }
                  />
                </label>
                <label>
                  Variant assignment
                  <select
                    value={item.variant_id ?? ""}
                    onChange={(event) =>
                      void update(item.id, {
                        variant_id: event.target.value || null,
                      })
                    }
                  >
                    <option value="">All product variants</option>
                    {variants.map((variant) => (
                      <option value={variant.id} key={variant.id}>
                        {variant.sku}
                      </option>
                    ))}
                  </select>
                </label>
                <div className="media-actions">
                  <button
                    disabled={index === 0}
                    onClick={() => void reorder(index, -1)}
                    aria-label="Move image earlier"
                  >
                    <ChevronUp />
                  </button>
                  <button
                    disabled={index === media.length - 1}
                    onClick={() => void reorder(index, 1)}
                    aria-label="Move image later"
                  >
                    <ChevronDown />
                  </button>
                  {!item.is_primary && (
                    <button onClick={() => void makePrimary(item.id)}>
                      <Star /> Make primary
                    </button>
                  )}
                  <button
                    onClick={() => {
                      setReplacementId(item.id);
                      input.current?.click();
                    }}
                  >
                    <RefreshCw /> Replace
                  </button>
                  <button
                    className="danger"
                    onClick={() => void remove(item.id)}
                  >
                    <Trash2 /> Delete
                  </button>
                </div>
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
