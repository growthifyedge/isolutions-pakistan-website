import { ChangeEvent, useEffect, useMemo, useRef, useState } from "react";
import { Download, FolderOpen, ImagePlus, RotateCcw, ShieldCheck, Upload, X } from "lucide-react";
import { supabase } from "../lib/supabase";
import { createSubmitLatch, resolveUploadTarget, uploadWarning, type BulkMediaRow } from "../lib/bulkImageUpload";
import { PRODUCTION_CONFIRMATION_TEXT, confirmationSatisfied } from "../lib/bulkImagePreflight";
import { requestProductUploadSignature, uploadToCloudinary } from "../lib/productMediaUpload";
import { supabaseRefsInText } from "../lib/supabaseEnvironment";
import { installUnloadGuard } from "../lib/unloadGuard";
import { readPickedFiles, readZipFile } from "../lib/skuImageFiles";
import {
  SKU_IMAGE_ACCEPT,
  RANGE_NOT_SET_MESSAGE,
  buildSkuPreview,
  fileSkuSpans,
  parseSkuRange,
  runSkuImageUpload,
  skuUploadReportCsv,
  type SkuCatalogProduct,
  type SkuImageFile,
  type SkuLedger,
  type SkuLedgerEntry,
  type SkuPreviewProduct,
  type SkuProductStatus,
  type SkuUploadProgress,
  type SkuUploadResult,
} from "../lib/skuImageUpload";

// Bulk Image Upload by SKU: images named "<SKU>-<number>" (GD032-01.jpg …) are matched to existing products and
// uploaded through the shared signed Cloudinary flow. Never deletes, replaces or publishes; existing images, their
// order and colour links are untouched. All rules live in src/lib/skuImageUpload.ts.

const BUILD_MODE: string = import.meta.env.MODE;
const uploadTarget = resolveUploadTarget(import.meta.env.VITE_SUPABASE_URL, BUILD_MODE);
const ENV_LABEL = uploadTarget.environment === "production" ? "PRODUCTION" : uploadTarget.environment === "development" ? "DEV" : "UNKNOWN";
const RUNTIME_REFS = supabaseRefsInText(Object.values(import.meta.env).filter((value): value is string => typeof value === "string").join(" "));
const LEDGER_STORAGE_KEY = "isolutions.skuImageUpload.ledger.v1";
const PAGE_SIZE = 50;

type CatalogRecord = {
  id: string;
  title: string;
  publication_status: string | null;
  category: { slug: string } | null;
  product_variants: { sku: string | null }[];
  product_media: BulkMediaRow[];
};

async function loadSkuCatalog(): Promise<SkuCatalogProduct[]> {
  if (!supabase) throw new Error("Supabase client environment is not configured.");
  const products: SkuCatalogProduct[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase
      .from("products")
      .select("id,title,publication_status,category:categories(slug),product_variants(sku),product_media(id,product_id,cloudinary_public_id,secure_url,sort_order,is_primary)")
      .order("id")
      .range(from, from + 999);
    if (error) throw new Error(error.message);
    const page = (data ?? []) as unknown as CatalogRecord[];
    products.push(
      ...page.map((record) => ({
        id: record.id,
        title: record.title,
        category: record.category?.slug ?? null,
        publicationStatus: record.publication_status,
        skus: record.product_variants.map((variant) => variant.sku).filter((sku): sku is string => Boolean(sku)),
        media: record.product_media,
      })),
    );
    if (page.length < 1000) return products;
  }
}

/** Recorded upload results (retry). Kept in this browser; every use is re-checked against the database. */
function loadLedger(): SkuLedger {
  try {
    const raw = window.localStorage.getItem(LEDGER_STORAGE_KEY);
    return raw ? (JSON.parse(raw) as SkuLedger) : {};
  } catch {
    return {};
  }
}
function saveLedger(ledger: SkuLedger) {
  try {
    window.localStorage.setItem(LEDGER_STORAGE_KEY, JSON.stringify(ledger));
  } catch {
    // Storage full or blocked: the in-memory record still drives this session's retry.
  }
}

const PRODUCT_STATUS: Record<SkuPreviewProduct["status"], string> = { ready: "Ready", done: "Already uploaded", skipped: "Skipped", blocked: "Blocked" };
const RUN_STATUS: Record<SkuProductStatus, string> = {
  pending: "Waiting",
  running: "Uploading",
  verified: "Verified",
  partial: "Partial",
  failed: "Failed",
  not_verified: "Saved, NOT verified",
  blocked: "Blocked",
};

type Tab = "products" | "unmatched" | "duplicates" | "errors";

export function SkuImageUpload() {
  const [catalog, setCatalog] = useState<SkuCatalogProduct[]>([]);
  const [catalogError, setCatalogError] = useState("");
  const [catalogLoading, setCatalogLoading] = useState(true);
  const [files, setFiles] = useState<SkuImageFile[]>([]);
  const [ignored, setIgnored] = useState<string[]>([]);
  const [reading, setReading] = useState<{ done: number; total: number } | null>(null);
  const [readError, setReadError] = useState("");
  const [rangeFrom, setRangeFrom] = useState("");
  const [rangeTo, setRangeTo] = useState("");
  const [addToExisting, setAddToExisting] = useState(false);
  const [tab, setTab] = useState<Tab>("products");
  const [page, setPage] = useState(0);
  const [ledger, setLedger] = useState<SkuLedger>(() => loadLedger());
  const ledgerRef = useRef<SkuLedger>(ledger);
  const latch = useRef(createSubmitLatch());
  const [checking, setChecking] = useState(false);
  const [preflightErrors, setPreflightErrors] = useState<string[]>([]);
  const [confirm, setConfirm] = useState<{ cloudName: string | null; folder: string | null } | null>(null);
  const [typed, setTyped] = useState("");
  const [progress, setProgress] = useState<SkuUploadProgress | null>(null);
  const [result, setResult] = useState<SkuUploadResult | null>(null);
  const uploading = progress !== null;

  const reloadCatalog = async () => {
    setCatalogLoading(true);
    setCatalogError("");
    try {
      setCatalog(await loadSkuCatalog());
    } catch (error) {
      setCatalogError(error instanceof Error ? error.message : "The catalog could not be loaded.");
    } finally {
      setCatalogLoading(false);
    }
  };
  useEffect(() => {
    void reloadCatalog();
  }, []);
  useEffect(() => (uploading ? installUnloadGuard(window) : undefined), [uploading]);

  const range = useMemo(() => parseSkuRange(rangeFrom, rangeTo), [rangeFrom, rangeTo]);
  const preview = useMemo(
    () =>
      buildSkuPreview(files, catalog, {
        environment: uploadTarget.environment,
        range: range.range,
        rangeError: range.error,
        addToProductsWithImages: addToExisting,
        ledger,
      }),
    [files, catalog, range, addToExisting, ledger],
  );
  const skuSpans = useMemo(() => fileSkuSpans(files.map((file) => file.name)), [files]);
  const fileByIndex = useMemo(() => new Map(files.map((file) => [file.index, file.file])), [files]);

  async function addFiles(reader: (start: number) => Promise<{ files: SkuImageFile[]; ignored: string[]; error: string | null }>) {
    setReadError("");
    setResult(null);
    setReading({ done: 0, total: 0 });
    try {
      const start = files.reduce((max, file) => Math.max(max, file.index + 1), 0);
      const read = await reader(start);
      if (read.error) setReadError(read.error);
      setFiles((current) => [...current, ...read.files]);
      setIgnored((current) => [...current, ...read.ignored]);
      setPage(0);
    } finally {
      setReading(null);
    }
  }
  const onPick = (event: ChangeEvent<HTMLInputElement>) => {
    const picked = [...(event.target.files ?? [])];
    event.target.value = "";
    if (picked.length) void addFiles((start) => readPickedFiles(picked, start, (done, total) => setReading({ done, total })));
  };
  const onZip = (event: ChangeEvent<HTMLInputElement>) => {
    const zip = event.target.files?.[0];
    event.target.value = "";
    if (zip) void addFiles((start) => readZipFile(zip, start, (done, total) => setReading({ done, total })));
  };
  const clearFiles = () => {
    setFiles([]);
    setIgnored([]);
    setResult(null);
    setPreflightErrors([]);
    setPage(0);
  };

  /** Read-only checks, then (PRODUCTION) one signature-only Cloudinary check, then the confirmation dialog. */
  async function startUpload() {
    if (!supabase || checking || uploading) return;
    const errors: string[] = [];
    if (!uploadTarget.allowed) errors.push(uploadTarget.reason ?? "Upload target blocked.");
    if (catalogLoading || catalogError || catalog.length === 0) errors.push("The catalog is not loaded, so existing images cannot be checked.");
    if (range.error) errors.push(range.error);
    if (uploadTarget.environment === "production" && !range.range && !range.error) errors.push(RANGE_NOT_SET_MESSAGE);
    const foreign = RUNTIME_REFS.filter((ref) => ref !== uploadTarget.projectRef);
    if (foreign.length) errors.push(`The active build references another Supabase project (${foreign.join(", ")}).`);
    const ready = preview.products.filter((product) => product.status === "ready");
    if (ready.length === 0) errors.push("No product is ready to upload.");
    setPreflightErrors(errors);
    if (errors.length) return;
    setChecking(true);
    try {
      let cloud: { cloudName: string | null; folder: string | null } = { cloudName: null, folder: null };
      if (uploadTarget.environment === "production") {
        const signature = await requestProductUploadSignature(supabase, ready[0].productId);
        const folder = signature.signedParameters.folder;
        if (folder !== `${uploadTarget.cloudinaryRoot}${ready[0].productId}` || !signature.cloudName) {
          setPreflightErrors([`Signature check failed: folder "${folder}" is not under ${uploadTarget.cloudinaryRoot}. PRODUCTION upload is blocked.`]);
          return;
        }
        cloud = { cloudName: signature.cloudName, folder };
      }
      setTyped("");
      setConfirm(cloud);
    } catch (error) {
      setPreflightErrors([`Signature check failed: ${error instanceof Error ? error.message : "request failed"}. Upload is blocked.`]);
    } finally {
      setChecking(false);
    }
  }

  async function runUpload() {
    setConfirm(null);
    if (!supabase || !confirmationSatisfied(uploadTarget.environment, typed) || !latch.current.tryAcquire()) return;
    const client = supabase;
    setResult(null);
    try {
      const run = await runSkuImageUpload(preview, {
        supabaseUrl: import.meta.env.VITE_SUPABASE_URL,
        buildMode: BUILD_MODE,
        requestSignature: (productId) => requestProductUploadSignature(client, productId),
        upload: (signature, source, onProgress) => uploadToCloudinary(signature, source, { onProgress }),
        insertMedia: async (payload) => {
          const { data, error } = await client.from("product_media").insert(payload).select("id").single();
          if (error || !data) throw new Error(error?.message || "product_media insert returned no row.");
          return { id: data.id as string };
        },
        readMedia: async (productId) => {
          const { data, error } = await client
            .from("product_media")
            .select("id,product_id,cloudinary_public_id,secure_url,sort_order,is_primary")
            .eq("product_id", productId)
            .order("sort_order");
          if (error) throw new Error(error.message);
          return (data ?? []) as BulkMediaRow[];
        },
        ledger: {
          get: (key) => ledgerRef.current[key],
          set: (key: string, entry: SkuLedgerEntry) => {
            ledgerRef.current = { ...ledgerRef.current, [key]: entry };
            saveLedger(ledgerRef.current);
          },
        },
        fileFor: (index) => fileByIndex.get(index) ?? null,
        onProgress: setProgress,
      });
      setResult(run);
    } finally {
      setProgress(null);
      latch.current.release();
      setLedger(ledgerRef.current);
      // Fresh read so the preview shows what is now in the database (uploaded images become "Already uploaded").
      await reloadCatalog();
    }
  }

  function downloadReport() {
    const csv = skuUploadReportCsv(preview, result, uploadTarget.environment);
    const url = URL.createObjectURL(new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `sku-image-upload-${(uploadTarget.environment ?? "unknown").toLowerCase()}-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}.csv`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  const failedImages = result ? result.summary.imagesFailed + result.summary.imagesNotAttempted : 0;
  const lists = { unmatched: preview.unmatched, duplicates: preview.duplicates, errors: preview.errors };
  const rows = tab === "products" ? preview.products : lists[tab];
  const pageCount = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const pageRows = rows.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
  const running = progress ? Object.entries(progress.products).filter(([, entry]) => entry.status === "running") : [];

  return (
    <section className="admin-panel bulk-images" aria-labelledby="sku-images-title">
      <div className="bulk-images-head">
        <div>
          <span className="admin-kicker">PRODUCT IMAGES</span>
          <h2 id="sku-images-title">Bulk Image Upload by SKU</h2>
          <p>
            Name each image by the product's SKU and image number — <code>GD032-01.jpg</code>, <code>GD032-02.png</code>, <code>GD032-03.webp</code> — then choose the
            files, a folder or a ZIP. Image 01 becomes the Primary only when the product has none; every other image is added to the gallery after the existing
            ones. Nothing is deleted, replaced or published, and colour links are not changed.
          </p>
        </div>
        <div className={`bulk-images-env ${ENV_LABEL.toLowerCase()}`} role="status">
          <span>Upload target</span>
          <strong>{ENV_LABEL}</strong>
          <small>{catalogLoading ? "Loading products…" : catalogError ? "Not loaded" : `${catalog.length} products (read-only)`}</small>
        </div>
      </div>
      {catalogError && <p className="bulk-images-error" role="alert">{catalogError}</p>}

      <fieldset className="bulk-images-lock" disabled={uploading || checking}>
        <div className="sku-images-controls" style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "end", margin: "12px 0" }}>
          <label className="admin-secondary" style={{ cursor: "pointer" }}>
            <ImagePlus size={16} /> Choose images
            <input type="file" multiple accept={SKU_IMAGE_ACCEPT} onChange={onPick} hidden aria-label="Choose images" />
          </label>
          <label className="admin-secondary" style={{ cursor: "pointer" }}>
            <FolderOpen size={16} /> Choose folder
            <input type="file" multiple onChange={onPick} hidden aria-label="Choose folder" {...({ webkitdirectory: "", directory: "" } as Record<string, string>)} />
          </label>
          <label className="admin-secondary" style={{ cursor: "pointer" }}>
            <Upload size={16} /> Choose ZIP
            <input type="file" accept=".zip,application/zip" onChange={onZip} hidden aria-label="Choose ZIP" />
          </label>
          {files.length > 0 && (
            <button type="button" className="admin-secondary" onClick={clearFiles}>
              <X size={16} /> Clear files
            </button>
          )}
          <label>
            SKU range from
            <input value={rangeFrom} onChange={(event) => setRangeFrom(event.target.value.toUpperCase())} placeholder="first SKU" size={9} aria-label="SKU range from" />
          </label>
          <label>
            to
            <input value={rangeTo} onChange={(event) => setRangeTo(event.target.value.toUpperCase())} placeholder="last SKU" size={9} aria-label="SKU range to" />
          </label>
          <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
            <input type="checkbox" checked={addToExisting} onChange={(event) => setAddToExisting(event.target.checked)} />
            Add gallery images to products that already have images
          </label>
        </div>
        {/* Range state is always spelled out: an empty box must never look like an entered range. */}
        {range.range ? (
          <p className="bulk-images-valid" role="status" aria-label="SKU range status">
            <ShieldCheck size={16} /> SKU range active: <strong>{range.range.label}</strong>. Files outside it are listed under Unmatched and are never uploaded.
          </p>
        ) : range.error ? (
          <p className="bulk-images-error" role="alert" aria-label="SKU range status">SKU range invalid: {range.error}</p>
        ) : (
          <p className={uploadTarget.environment === "production" ? "bulk-images-error" : "bulk-images-note"} role="status" aria-label="SKU range status">
            SKU range: <strong>not set</strong> (the From / To boxes are empty).
            {uploadTarget.environment === "production" ? " PRODUCTION uploads need one: only files whose SKU is inside the range can be uploaded." : " Optional on DEV."}
          </p>
        )}
        {skuSpans.length > 0 && (
          <p className="bulk-images-note" aria-label="SKUs in the chosen files">
            The chosen files cover: <strong>{skuSpans.join(", ")}</strong>. Type the range yourself; it is not filled in automatically.
          </p>
        )}
        {readError && <p className="bulk-images-error" role="alert">{readError}</p>}
        {reading && <p className="bulk-images-note" role="status">Reading files… {reading.total ? `${reading.done} / ${reading.total}` : ""}</p>}

        <div className="bulk-images-selection" aria-label="SKU upload summary">
          <h3>Preview</h3>
          <dl>
            <div><dt>Files</dt><dd>{preview.totals.files}</dd></div>
            <div><dt>Matched products</dt><dd>{preview.totals.products}</dd></div>
            <div><dt>Ready products</dt><dd>{preview.totals.readyProducts}</dd></div>
            <div><dt>Images to upload</dt><dd>{preview.totals.imagesToUpload}</dd></div>
            <div><dt>New primaries</dt><dd>{preview.totals.newPrimaries}</dd></div>
            <div><dt>Already uploaded</dt><dd>{preview.totals.alreadyUploaded}</dd></div>
            <div><dt>Skipped / blocked</dt><dd>{preview.totals.skippedProducts} / {preview.totals.blockedProducts}</dd></div>
            <div><dt>Unmatched · duplicates · errors</dt><dd>{preview.unmatched.length} · {preview.duplicates.length} · {preview.errors.length}</dd></div>
          </dl>
          {ignored.length > 0 && <p className="bulk-images-note">{ignored.length} non-image file(s) ignored (e.g. {ignored.slice(0, 2).join(", ")}).</p>}
        </div>

        <div role="tablist" style={{ display: "flex", gap: 8, flexWrap: "wrap", margin: "8px 0" }}>
          {(
            [
              ["products", `Products (${preview.products.length})`],
              ["unmatched", `Unmatched (${preview.unmatched.length})`],
              ["duplicates", `Duplicates (${preview.duplicates.length})`],
              ["errors", `Errors (${preview.errors.length})`],
            ] as [Tab, string][]
          ).map(([key, label]) => (
            <button key={key} type="button" role="tab" aria-selected={tab === key} className={tab === key ? "admin-primary" : "admin-secondary"} onClick={() => { setTab(key); setPage(0); }}>
              {label}
            </button>
          ))}
        </div>
        <div style={{ overflowX: "auto" }}>
          {tab === "products" ? (
            <table className="admin-table" aria-label="Matched products">
              <thead>
                <tr><th>SKU</th><th>Product</th><th>Status</th><th>Existing</th><th>New</th><th>Primary</th><th>Files (in upload order)</th><th>Note</th></tr>
              </thead>
              <tbody>
                {(pageRows as SkuPreviewProduct[]).map((product) => {
                  const pending = product.images.filter((image) => image.state !== "already_uploaded");
                  const primary = product.images.find((image) => image.role === "primary" && image.state !== "already_uploaded");
                  const warnings = [...new Set(product.images.map((image) => image.warning).filter(Boolean))];
                  return (
                    <tr key={product.productId}>
                      <td>{product.skus.join(", ")}</td>
                      <td>{product.title}<br /><small>{product.category ?? ""} · {product.publicationStatus ?? ""}</small></td>
                      <td>{PRODUCT_STATUS[product.status]}</td>
                      <td>{product.existingCount}{product.hasPrimary ? " (has primary)" : ""}</td>
                      <td>{pending.length}</td>
                      <td>{primary ? primary.name : product.hasPrimary ? "Keeps existing" : "—"}</td>
                      <td><small>{product.images.map((image) => `${image.name}${image.state === "already_uploaded" ? " ✓" : image.state === "save_only" ? " (save recorded upload)" : ""}`).join(", ")}</small></td>
                      <td><small>{[product.reason, ...warnings].filter(Boolean).join(" · ")}</small></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          ) : (
            <table className="admin-table" aria-label={tab}>
              <thead>
                <tr><th>File</th><th>SKU</th><th>Reason</th></tr>
              </thead>
              <tbody>
                {(pageRows as { fileIndex: number; name: string; path: string; sku: string | null; reason: string }[]).map((entry) => (
                  <tr key={`${entry.fileIndex}-${entry.reason}`}>
                    <td>{entry.path || entry.name}</td>
                    <td>{entry.sku ?? "—"}</td>
                    <td>{entry.reason}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {rows.length === 0 && <p className="bulk-images-note">Nothing here yet.</p>}
          {pageCount > 1 && (
            <p>
              <button type="button" className="admin-secondary" disabled={page === 0} onClick={() => setPage(page - 1)}>Previous</button>{" "}
              Page {page + 1} of {pageCount}{" "}
              <button type="button" className="admin-secondary" disabled={page + 1 >= pageCount} onClick={() => setPage(page + 1)}>Next</button>
            </p>
          )}
        </div>

        <div className={`bulk-images-apply bulk-images-devtest${uploadTarget.environment === "production" ? " production" : ""}`}>
          <div>
            <strong>{uploadTarget.allowed ? `Upload to ${ENV_LABEL}` : "Upload unavailable"}</strong>
            <p>
              Uploads the Ready products ({preview.totals.imagesToUpload} image{preview.totals.imagesToUpload === 1 ? "" : "s"} for {preview.totals.readyProducts} product
              {preview.totals.readyProducts === 1 ? "" : "s"}), three products at a time, each product's images in order. Each product's images are re-checked just before
              writing and read back afterwards.{uploadTarget.projectRef ? ` ${ENV_LABEL} project only (${uploadTarget.projectRef}).` : ""}
            </p>
            {!uploadTarget.allowed && <p className="bulk-images-error">{uploadTarget.reason}</p>}
          </div>
          <button type="button" className="admin-primary" disabled={!uploadTarget.allowed || preview.totals.readyProducts === 0 || checking || uploading || Boolean(reading)} onClick={() => void startUpload()}>
            {uploading ? "Uploading…" : checking ? "Checking…" : `Upload ${preview.totals.imagesToUpload} image${preview.totals.imagesToUpload === 1 ? "" : "s"} to ${ENV_LABEL}`}
          </button>
        </div>
      </fieldset>

      {preflightErrors.length > 0 && (
        <div className="bulk-images-devreport failed" role="alert">
          <strong>Upload blocked — nothing was uploaded</strong>
          <ul>{preflightErrors.map((error) => <li key={error}>{error}</li>)}</ul>
        </div>
      )}

      {progress && (
        <div className="bulk-images-devreport" role="status" aria-label="SKU upload progress">
          <strong>Uploading to {ENV_LABEL}… keep this tab open</strong>
          <progress max={progress.imagesTotal} value={progress.imagesDone} style={{ width: "100%" }} />
          <p>Products {progress.productsDone} / {progress.productsTotal} · Images {progress.imagesDone} / {progress.imagesTotal}</p>
          <ul>
            {running.map(([id, entry]) => (
              <li key={id}>
                {entry.title}: {entry.current ?? "…"}
                {entry.percent !== null ? ` (${entry.percent}%)` : ""} — {entry.imagesDone} / {entry.imagesTotal}
              </li>
            ))}
          </ul>
        </div>
      )}

      {result && (
        <div className={`bulk-images-devreport ${result.outcome === "all_verified" ? "verified" : "failed"}`} role={result.outcome === "all_verified" ? "status" : "alert"} aria-label="SKU upload result">
          <strong>{result.outcome === "all_verified" ? `${ENV_LABEL} upload verified` : result.outcome === "blocked" ? "Upload blocked" : "Upload finished with issues"}</strong>
          <p>{result.message}</p>
          <p>
            Products {result.summary.products} · verified {result.summary.verified} · partial {result.summary.partial} · failed {result.summary.failed} · not verified{" "}
            {result.summary.notVerified} · blocked {result.summary.blocked} · images saved {result.summary.imagesSaved} · images failed {result.summary.imagesFailed}
            {result.summary.imagesNotAttempted ? ` · not attempted ${result.summary.imagesNotAttempted}` : ""}
          </p>
          <ul>
            {result.products.filter((product) => product.status !== "verified").slice(0, 20).map((product) => (
              <li key={product.productId}>{product.skus.join(", ")} {product.title}: {RUN_STATUS[product.status]} — {product.message}</li>
            ))}
          </ul>
          <p style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button type="button" className="admin-secondary" onClick={downloadReport}><Download size={16} /> Download CSV report</button>
            {failedImages > 0 && (
              <button type="button" className="admin-primary" disabled={catalogLoading} onClick={() => void startUpload()}>
                <RotateCcw size={16} /> Retry failed images
              </button>
            )}
          </p>
          {failedImages > 0 && <p className="bulk-images-note">Retry re-reads the database first: images already saved are skipped, and images already in Cloudinary are only saved, not uploaded again.</p>}
        </div>
      )}
      {!result && files.length > 0 && (
        <p><button type="button" className="admin-secondary" onClick={downloadReport}><Download size={16} /> Download preview CSV</button></p>
      )}

      {confirm && uploadTarget.environment && (
        <div className="bulk-images-dialog-backdrop">
          <div className={`bulk-images-dialog${uploadTarget.environment === "production" ? " production" : ""}`} role="dialog" aria-modal="true" aria-labelledby="sku-upload-confirm-title">
            {uploadTarget.environment === "production" && <div className="bulk-images-prod-banner">PRODUCTION</div>}
            <h3 id="sku-upload-confirm-title">Confirm {ENV_LABEL} upload</h3>
            <dl>
              <div><dt>Environment</dt><dd><strong>{uploadTarget.environment.toUpperCase()}</strong></dd></div>
              <div><dt>Supabase</dt><dd><code>{uploadTarget.projectRef}</code></dd></div>
              {confirm.cloudName && <div><dt>Cloudinary cloud</dt><dd><code>{confirm.cloudName}</code></dd></div>}
              {confirm.folder && <div><dt>Cloudinary folder (first product)</dt><dd><code>{confirm.folder}</code></dd></div>}
              <div><dt>SKU range</dt><dd>{range.range?.label ?? "none"}</dd></div>
              <div><dt>Products</dt><dd>{preview.totals.readyProducts}</dd></div>
              <div><dt>Images</dt><dd>{preview.totals.imagesToUpload}</dd></div>
              <div><dt>New primaries</dt><dd>{preview.totals.newPrimaries}</dd></div>
            </dl>
            <p className="bulk-images-error">{uploadWarning(uploadTarget.environment)}</p>
            {uploadTarget.environment === "production" && (
              <label className="bulk-images-typed">
                Type {PRODUCTION_CONFIRMATION_TEXT} to enable the upload
                <input type="text" autoComplete="off" spellCheck={false} value={typed} onChange={(event) => setTyped(event.target.value)} />
              </label>
            )}
            <div className="bulk-images-dialog-actions">
              <button type="button" className="admin-secondary" onClick={() => setConfirm(null)}>Cancel</button>
              <button type="button" className="admin-primary" disabled={!confirmationSatisfied(uploadTarget.environment, typed)} onClick={() => void runUpload()}>
                <ShieldCheck size={16} /> Confirm and upload to {ENV_LABEL}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
