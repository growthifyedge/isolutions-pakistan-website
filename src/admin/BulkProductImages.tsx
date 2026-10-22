import { ChangeEvent, useEffect, useMemo, useRef, useState } from "react";
import { ImagePlus, Search, ShieldCheck, Star, X } from "lucide-react";
import { supabase } from "../lib/supabase";
import {
  resolveUploadTarget,
  uploadWarning,
  createSubmitLatch,
  planBulkUpload,
  runBulkUpload,
  type BulkUploadProgress,
  type BulkUploadProductStatus,
  type BulkUploadResult,
  type BulkMediaRow,
} from "../lib/bulkImageUpload";
import {
  PRODUCTION_CONFIRMATION_TEXT,
  confirmationSatisfied,
  runBulkPreflight,
  type BulkPreflightResult,
} from "../lib/bulkImagePreflight";
import { requestProductUploadSignature, uploadToCloudinary } from "../lib/productMediaUpload";
import { supabaseRefsInText } from "../lib/supabaseEnvironment";
import { installUnloadGuard } from "../lib/unloadGuard";
import {
  LOCAL_IMAGE_ACCEPT,
  attachLocalImages,
  clearLocalSet,
  keepOnlyBlockReason,
  keepOnlySet,
  createPreviewUrlRegistry,
  emptyReview,
  localFileProblems,
  localImageContentProblems,
  missingImageProducts,
  previewUrlsInReview,
  referenceCatalogEnvironment,
  removeLocalImage,
  reviewSetStates,
  setIncluded,
  setPrimaryImage,
  validateBulkImageSelection,
  type BulkImageCatalogProduct,
  type BulkImageReview,
  type BulkImageSetState,
} from "../lib/bulkProductImagesReview";

// Manual product image upload + environment-aware uploader. The Owner picks a product without a primary image,
// uploads its images and chooses the Primary (the rest are gallery images). The only write path is the single upload
// button (src/lib/bulkImageUpload.ts): it exists only for the exact DEVELOPMENT or PRODUCTION build, runs a preflight
// first, needs an explicit confirmation (typed "PRODUCTION" on production) and uploads one product at a time.
// Same flow for every category and condition. Products that already have a primary image are managed in the product editor's Media tab.

const MISSING_PAGE_SIZE = 20;
const environment = referenceCatalogEnvironment(import.meta.env.VITE_SUPABASE_URL);
const BUILD_MODE: string = import.meta.env.MODE;
const uploadTarget = resolveUploadTarget(import.meta.env.VITE_SUPABASE_URL, BUILD_MODE);
const UPLOAD_LABEL = uploadTarget.environment === "production" ? "PROD" : "DEV";
/** Supabase projects referenced anywhere in this bundle's VITE_ configuration. */
const RUNTIME_REFS = supabaseRefsInText(Object.values(import.meta.env).filter((value): value is string => typeof value === "string").join(" "));

const STATUS_LABEL: Record<BulkImageSetState["status"], string> = {
  matched: "Matched",
  confirmed: "Confirmed",
  review: "Review",
  multiple: "Multiple",
  conflict: "Conflict",
  unmatched: "Unmatched",
  invalid: "Invalid",
  not_used: "Not used",
  skipped: "Skipped",
};

type CatalogRecord = {
  id: string;
  title: string;
  slug: string;
  brand: { name: string } | null;
  product_media: { is_primary: boolean }[];
};

type Update = (change: (current: BulkImageReview) => BulkImageReview) => void;

async function loadReferenceCatalog(): Promise<BulkImageCatalogProduct[]> {
  if (!supabase) throw new Error("Supabase client environment is not configured.");
  const products: BulkImageCatalogProduct[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase
      .from("products")
      .select("id,title,slug,brand:brands(name),product_media(is_primary)")
      .order("id")
      .range(from, from + 999);
    if (error) throw new Error(error.message);
    const page = (data ?? []) as unknown as CatalogRecord[];
    products.push(
      ...page.map((record) => ({
        id: record.id,
        title: record.title,
        slug: record.slug,
        brand: record.brand?.name ?? null,
        hasPrimary: record.product_media.some((media) => media.is_primary),
        mediaCount: record.product_media.length,
      })),
    );
    if (page.length < 1000) return products;
  }
}

export function BulkProductImages() {
  const [catalog, setCatalog] = useState<BulkImageCatalogProduct[]>([]);
  const [catalogError, setCatalogError] = useState("");
  const [catalogLoading, setCatalogLoading] = useState(true);
  const [review, setReview] = useState<BulkImageReview>(emptyReview);
  const previews = useRef(createPreviewUrlRegistry());
  const uploadLatch = useRef(createSubmitLatch());
  const [keepNotice, setKeepNotice] = useState("");
  const [uploadConfirm, setUploadConfirm] = useState(false);
  const [preflight, setPreflight] = useState<BulkPreflightResult | null>(null);
  const [preflighting, setPreflighting] = useState(false);
  const [typedConfirmation, setTypedConfirmation] = useState("");
  const [uploadProgress, setUploadProgress] = useState<BulkUploadProgress | null>(null);
  const [uploadResult, setUploadResult] = useState<BulkUploadResult | null>(null);

  useEffect(() => {
    let active = true;
    loadReferenceCatalog()
      .then((products) => active && setCatalog(products))
      .catch((error: Error) => active && setCatalogError(error.message))
      .finally(() => active && setCatalogLoading(false));
    const registry = previews.current;
    return () => {
      active = false;
      registry.revokeAll();
    };
  }, []);

  // Local preview URLs that are no longer shown (removed image, cleared set, reset) are revoked.
  useEffect(() => {
    previews.current.retainOnly(previewUrlsInReview(review));
  }, [review]);

  const update: Update = (change) => setReview((current) => change(current));

  /** "Keep only this set" with a visible result, so a click is never silent. */
  function keepOnly(setId: string) {
    const blockedReason = keepOnlyBlockReason(review, setId);
    const next = keepOnlySet(review, setId);
    const set = review.sets.find((entry) => entry.setId === setId);
    const state = reviewSetStates(next, catalog).get(setId);
    const images = next.decisions[setId]?.selectedImageIds.length ?? 0;
    const label = set?.sourceKind === "local" ? `local set "${set.title}"` : `"${set?.title ?? "set"}"`;
    if (blockedReason) setKeepNotice(`Keep only this set: not applied — ${blockedReason}`);
    else if (state && state.status !== "matched" && state.status !== "confirmed")
      setKeepNotice(`Kept only ${label}, but it is ${state.status.toUpperCase()}: ${state.issue} Resolve it before uploading.`);
    else setKeepNotice(`Kept only ${label}: 1 set, ${images} image${images === 1 ? "" : "s"}${next === review ? " (it was already the only included set)" : ""}.`);
    if (next !== review) setReview(next);
  }

  const states = useMemo(() => reviewSetStates(review, catalog), [review, catalog]);
  const validation = useMemo(() => validateBulkImageSelection(review, catalog, environment), [review, catalog]);
  const devUpload = useMemo(() => planBulkUpload(review, catalog, import.meta.env.VITE_SUPABASE_URL, BUILD_MODE), [review, catalog]);
  const uploading = uploadProgress !== null;

  // While an upload runs, the browser warns before a reload / tab close / navigation; idle pages are never blocked.
  useEffect(() => {
    if (!uploading) return undefined;
    return installUnloadGuard(window);
  }, [uploading]);

  /** Preflight (read-only; production adds a signature-only Cloudinary check), then the confirmation dialog. */
  async function startUpload() {
    if (!devUpload.enabled || !supabase || preflighting || uploading) return;
    const client = supabase;
    setPreflighting(true);
    setPreflight(null);
    setUploadResult(null);
    try {
      const result = await runBulkPreflight(
        { review, catalog, catalogLoaded: !catalogLoading && !catalogError, supabaseUrl: import.meta.env.VITE_SUPABASE_URL, buildMode: BUILD_MODE, runtimeRefs: RUNTIME_REFS },
        { requestSignature: (productId) => requestProductUploadSignature(client, productId) },
      );
      setPreflight(result);
      if (result.passed) {
        setTypedConfirmation("");
        setUploadConfirm(true);
      }
    } finally {
      setPreflighting(false);
    }
  }

  async function runDevUpload() {
    setUploadConfirm(false);
    const products = devUpload.products;
    if (!devUpload.enabled || products.length === 0 || !supabase || !confirmationSatisfied(uploadTarget.environment, typedConfirmation) || !uploadLatch.current.tryAcquire()) return;
    const client = supabase;
    setUploadResult(null);
    setUploadProgress({
      productsTotal: products.length,
      productsDone: 0,
      imagesTotal: devUpload.totals.images,
      imagesDone: 0,
      current: null,
      statuses: Object.fromEntries(products.map((product) => [product.setId, "pending" as BulkUploadProductStatus])),
    });
    try {
      const result = await runBulkUpload(products, {
        supabaseUrl: import.meta.env.VITE_SUPABASE_URL,
        buildMode: BUILD_MODE,
        requestSignature: (productId) => requestProductUploadSignature(client, productId),
        upload: (signature, source, onProgress) => uploadToCloudinary(signature, source, { onProgress }),
        insertMedia: async (payload) => {
          const { data, error } = await client.from("product_media").insert(payload).select("id").single();
          if (error || !data) throw new Error(error?.message || "product_media insert returned no row.");
          return { id: data.id as string };
        },
        setPrimary: async (mediaId) => {
          const { error } = await client.rpc("set_product_media_primary", { p_media_id: mediaId });
          if (error) throw new Error(error.message);
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
        onProgress: setUploadProgress,
      });
      setUploadResult(result);
      // Verified sets leave the selection; the catalog is re-read so existing media is recognised (no blind re-upload).
      const verified = new Set(result.products.filter((product) => product.status === "verified").map((product) => product.setId));
      update((current) => ({
        ...current,
        decisions: Object.fromEntries(Object.entries(current.decisions).map(([id, decision]) => [id, verified.has(id) ? { ...decision, included: false } : decision])),
      }));
      try {
        setCatalog(await loadReferenceCatalog());
      } catch {
        // The result above stays authoritative; reloading the page re-reads the catalog.
      }
    } finally {
      setUploadProgress(null);
      uploadLatch.current.release();
    }
  }

  return (
    <section className="admin-panel bulk-images" aria-labelledby="bulk-images-title">
      <div className="bulk-images-head">
        <div>
          <span className="admin-kicker">PRODUCT IMAGES</span>
          <h2 id="bulk-images-title">Manual Product Image Upload</h2>
          <p>
            Choose a product without a primary image, upload its images, pick the Primary (the rest become gallery images), then upload the
            selected products to the {uploadTarget.environment === "production" ? "PRODUCTION" : "DEV"} catalog. Works for every category,
            New and Used. Products that already have a primary image are managed in the product editor's Media tab.
          </p>
        </div>
        <div className={`bulk-images-env ${environment.label.toLowerCase()}`} role="status">
          <span>Reference catalog</span>
          <strong>{environment.label}</strong>
          <small>{catalogLoading ? "Loading products…" : catalogError ? "Not loaded" : `${catalog.length} products (read-only)`}</small>
        </div>
      </div>
      {catalogError && (
        <p className="bulk-images-error" role="alert">
          {catalogError}
        </p>
      )}

      <fieldset className="bulk-images-lock" disabled={uploading}>
      {keepNotice && (
        <p className="bulk-images-note" role="status">
          {keepNotice}
        </p>
      )}
      {!catalogLoading && !catalogError && (
        <MissingImages review={review} states={states} catalog={catalog} createPreview={(file) => previews.current.create(file)} update={update} onKeepOnly={keepOnly} />
      )}

      <div className="bulk-images-selection" aria-label="Selection summary">
        <h3>Selection summary</h3>
        <dl>
          <div><dt>Selected products</dt><dd>{validation.selectedProducts}</dd></div>
          <div><dt>Image sets</dt><dd>{validation.selectedSets}</dd></div>
          <div><dt>Images</dt><dd>{validation.selectedImages}</dd></div>
          <div><dt>Ready</dt><dd>{validation.ready}</dd></div>
          <div><dt>Needs review</dt><dd>{validation.needsReview}</dd></div>
          <div><dt>Conflicts</dt><dd>{validation.conflicts}</dd></div>
          <div><dt>Existing images</dt><dd>{validation.existingImages}</dd></div>
        </dl>
        {validation.blockers.length > 0 ? (
          <p className="bulk-images-blockers">
            {validation.blockers[0]}
            {validation.blockers.length > 1 ? ` (+${validation.blockers.length - 1} more)` : ""}
          </p>
        ) : (
          <p className="bulk-images-valid">
            <ShieldCheck /> Selection review is valid: {validation.plans.reduce((total, plan) => total + plan.inserts.length, 0)} images for{" "}
            {validation.plans.length} product{validation.plans.length === 1 ? "" : "s"} ready for preflight on {environment.label}. The upload panel below is the final check.
          </p>
        )}
      </div>

      <div className={`bulk-images-apply bulk-images-devtest${uploadTarget.environment === "production" ? " production" : ""}`} aria-label={`Upload selected images to ${UPLOAD_LABEL}`}>
        <div>
          <strong>
            {uploadTarget.environment === "production" ? "Upload selected images to PRODUCTION" : uploadTarget.allowed ? "Upload selected images to DEV" : "Upload unavailable"}
          </strong>
          <p>
            Runs a preflight, then uploads every included image set to Cloudinary and saves its product_media rows, one product at a time, then reads each product
            back. Nothing is deleted, replaced or published.
            {uploadTarget.environment ? ` ${uploadTarget.environment.toUpperCase()} project only (${uploadTarget.projectRef}).` : ""}
          </p>
          {!uploadTarget.allowed ? (
            <p className="bulk-images-error">{uploadTarget.reason}</p>
          ) : devUpload.enabled ? (
            <p className="bulk-images-valid">
              <ShieldCheck /> Ready: {devUpload.totals.images} image{devUpload.totals.images === 1 ? "" : "s"} for {devUpload.totals.products} product
              {devUpload.totals.products === 1 ? "" : "s"}.
            </p>
          ) : (
            <p className="bulk-images-note">{devUpload.reason}</p>
          )}
        </div>
        {uploadTarget.allowed ? (
          <button type="button" className="admin-primary" disabled={!devUpload.enabled || uploading || preflighting} onClick={() => void startUpload()}>
            {uploading ? "Uploading…" : preflighting ? "Running preflight…" : `Upload Selected Images to ${UPLOAD_LABEL}`}
          </button>
        ) : (
          <button type="button" className="admin-primary" disabled>
            Upload unavailable
          </button>
        )}
      </div>
      </fieldset>
      {preflight && !preflight.passed && (
        <div className="bulk-images-devreport failed" role="alert" aria-label="Preflight failed">
          <strong>Preflight failed — nothing was uploaded</strong>
          <ul>
            {preflight.errors.slice(0, 6).map((error) => (
              <li key={error}>{error}</li>
            ))}
            {preflight.errors.length > 6 && <li>…and {preflight.errors.length - 6} more.</li>}
          </ul>
        </div>
      )}
      {uploadProgress && <UploadProgress progress={uploadProgress} label={UPLOAD_LABEL} titles={new Map(devUpload.products.map((product) => [product.setId, product.title]))} />}
      {uploadResult && <UploadReport result={uploadResult} label={UPLOAD_LABEL} />}
      {uploadConfirm && preflight?.passed && uploadTarget.environment && (
        <div className="bulk-images-dialog-backdrop">
          <div className={`bulk-images-dialog${uploadTarget.environment === "production" ? " production" : ""}`} role="dialog" aria-modal="true" aria-labelledby="dev-upload-confirm-title">
            {uploadTarget.environment === "production" && <div className="bulk-images-prod-banner">PRODUCTION</div>}
            <h3 id="dev-upload-confirm-title">Confirm {uploadTarget.environment === "production" ? "PRODUCTION" : "DEV"} upload</h3>
            <dl>
              <div><dt>Environment</dt><dd><strong>{uploadTarget.environment.toUpperCase()}</strong></dd></div>
              <div><dt>Supabase</dt><dd><code>{preflight.projectRef}</code></dd></div>
              {preflight.cloudinary && (
                <>
                  <div><dt>Cloudinary cloud</dt><dd><code>{preflight.cloudinary.cloudName}</code></dd></div>
                  <div><dt>Cloudinary folder</dt><dd><code>{preflight.cloudinary.folder}</code></dd></div>
                </>
              )}
              <div><dt>Products</dt><dd>{preflight.productCount}</dd></div>
              <div><dt>Images</dt><dd>{preflight.imageCount}</dd></div>
              <div>
                <dt>Existing media</dt>
                <dd>
                  {preflight.actions.newMedia} new · {preflight.actions.addImages} add as gallery · {preflight.actions.makePrimary} add and make primary
                </dd>
              </div>
              <div>
                <dt>Unresolved</dt>
                <dd>{preflight.unresolved.review + preflight.unresolved.multiple + preflight.unresolved.conflict + preflight.unresolved.invalid}</dd>
              </div>
            </dl>
            <p className="bulk-images-error">{uploadWarning(uploadTarget.environment)}</p>
            {preflight.warnings.length > 0 && (
              <ul className="bulk-images-blockers">
                {preflight.warnings.slice(0, 3).map((warning) => (
                  <li key={warning}>{warning}</li>
                ))}
              </ul>
            )}
            {uploadTarget.environment === "production" && (
              <label className="bulk-images-typed">
                Type {PRODUCTION_CONFIRMATION_TEXT} to enable the upload
                <input type="text" autoComplete="off" spellCheck={false} value={typedConfirmation} onChange={(event) => setTypedConfirmation(event.target.value)} />
              </label>
            )}
            <div className="bulk-images-dialog-actions">
              <button type="button" className="admin-secondary" onClick={() => setUploadConfirm(false)}>
                Cancel
              </button>
              <button
                type="button"
                className="admin-primary"
                disabled={!confirmationSatisfied(uploadTarget.environment, typedConfirmation)}
                onClick={() => void runDevUpload()}
              >
                Confirm and upload to {UPLOAD_LABEL}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

const PRODUCT_STATUS_LABEL: Record<BulkUploadProductStatus, string> = {
  pending: "Pending",
  uploading: "Uploading",
  saved: "Saved (not verified)",
  verified: "Verified",
  failed: "Failed",
  partial: "Partial",
  blocked: "Blocked",
};

function UploadProgress({ progress, titles, label }: { progress: BulkUploadProgress; titles: Map<string, string>; label: string }) {
  const { current } = progress;
  return (
    <div className="bulk-images-devreport" role="status" aria-label="Upload progress">
      <strong>Uploading to {label}…</strong>
      <p>
        Products: {progress.productsDone} / {progress.productsTotal} · Images: {progress.imagesDone} / {progress.imagesTotal}
      </p>
      {current && (
        <p>
          Current: {current.title} — {current.stage === "uploading" ? "uploading" : current.stage} image {current.imageIndex + 1} of {current.imageTotal}
          {current.percent !== undefined && current.stage === "uploading" ? ` (${current.percent}%)` : ""}
        </p>
      )}
      <ul>
        {Object.entries(progress.statuses).map(([setId, status]) => (
          <li key={setId}>
            {titles.get(setId) ?? setId}: {PRODUCT_STATUS_LABEL[status]}
          </li>
        ))}
      </ul>
    </div>
  );
}

function UploadReport({ result, label }: { result: BulkUploadResult; label: string }) {
  const { summary } = result;
  return (
    <div className={`bulk-images-devreport ${result.outcome === "all_verified" ? "verified" : "failed"}`} role={result.outcome === "all_verified" ? "status" : "alert"} aria-label={`${label} upload result`}>
      <strong>{result.outcome === "all_verified" ? `${label} upload verified` : result.outcome === "blocked" ? "Upload blocked" : "Upload finished with issues"}</strong>
      <p>{result.message}</p>
      {result.products.length > 0 && (
        <p>
          Products attempted {summary.attempted} · verified {summary.verified} · failed {summary.failed} · partial {summary.partial}
          {summary.saved ? ` · saved, not verified ${summary.saved}` : ""}
          {summary.blocked ? ` · blocked ${summary.blocked}` : ""} · images uploaded {summary.imagesUploaded} · images failed {summary.imagesFailed}
        </p>
      )}
      {result.products.some((product) => product.inserted.length > 0 && product.status !== "verified") && (
        <p>
          Retrying a partly saved product: first untick the images that were already saved. Uploading a saved image again creates another Cloudinary
          asset and media row.
        </p>
      )}
      {summary.orphans.length > 0 && (
        <>
          <p>Orphaned Cloudinary assets (uploaded, no database row, not deleted):</p>
          <ul>
            {summary.orphans.map((orphan) => (
              <li key={orphan.publicId}>
                {orphan.title}: <code>{orphan.publicId}</code>
              </li>
            ))}
          </ul>
        </>
      )}
      <ul>
        {result.products.map((product) => (
          <li key={product.setId}>
            <strong>{product.title}</strong> — {PRODUCT_STATUS_LABEL[product.status]}
            {product.status !== "verified" && <> · {product.message}</>}
            {product.status !== "verified" && product.inserted.length > 0 && (
              <> Media IDs: {product.inserted.map((entry) => entry.mediaId).join(", ")}</>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

function Thumb({ url, large = false }: { url: string | null; large?: boolean }) {
  return url ? (
    <img className={`bulk-images-thumb${large ? " large" : ""}`} src={url} alt="" loading="lazy" decoding="async" referrerPolicy="no-referrer" />
  ) : (
    <span className={`bulk-images-thumb empty${large ? " large" : ""}`} />
  );
}

/** Catalog perspective: products without a primary image, each with its own Upload Images action. */
function MissingImages({
  review,
  states,
  catalog,
  createPreview,
  update,
  onKeepOnly,
}: {
  review: BulkImageReview;
  states: Map<string, BulkImageSetState>;
  catalog: BulkImageCatalogProduct[];
  createPreview: (file: File) => string;
  update: Update;
  onKeepOnly: (setId: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [limit, setLimit] = useState(MISSING_PAGE_SIZE);
  const [messages, setMessages] = useState<Record<string, string>>({});
  const missing = useMemo(() => missingImageProducts(review, states, catalog, query), [review, states, catalog, query]);

  async function upload(productId: string, event: ChangeEvent<HTMLInputElement>) {
    const files = [...(event.target.files ?? [])];
    event.target.value = "";
    if (files.length === 0) return;
    const contentProblems = await localImageContentProblems(files);
    const problems = localFileProblems(files, contentProblems);
    const previewUrls = files.map((file, index) => (problems[index] ? null : createPreview(file)));
    update((current) => attachLocalImages(current, productId, files, catalog, { contentProblems, previewUrls }).review);
    const rejected = files.flatMap((file, index) => (problems[index] ? [`${file.name} (${problems[index]})`] : []));
    setMessages((current) => ({ ...current, [productId]: rejected.length ? `Rejected: ${rejected.join("; ")}` : "" }));
  }

  return (
    <div className="bulk-images-missing" aria-labelledby="bulk-images-missing-title">
      <div className="bulk-images-missing-head">
        <div>
          <h3 id="bulk-images-missing-title">Missing Images</h3>
          <p>
            Catalog products with no primary image (every category, New and Used). Upload one or more images per product — one is Primary,
            the rest are gallery images.
          </p>
        </div>
        <label className="bulk-images-search">
          <Search />
          <input type="search" placeholder="Search missing products" value={query} onChange={(event) => setQuery(event.target.value)} />
        </label>
      </div>
      <p className="bulk-images-note">{missing.length} product{missing.length === 1 ? "" : "s"} without a primary image.</p>
      <ul className="bulk-images-missing-list">
        {missing.slice(0, limit).map(({ product, localSetId }) => {
          const set = localSetId ? review.sets.find((entry) => entry.setId === localSetId) : undefined;
          const decision = localSetId ? review.decisions[localSetId] : undefined;
          const state = localSetId ? states.get(localSetId) : undefined;
          return (
            <li key={product.id}>
              <div className="bulk-images-missing-product">
                <strong>{product.title}</strong>
                <small>
                  {product.brand ?? "No brand"} · {product.mediaCount ? `${product.mediaCount} image${product.mediaCount === 1 ? "" : "s"}, no primary` : "No images"}
                </small>
                {state && <span className={`bulk-images-status ${state.status}`}>{STATUS_LABEL[state.status]}</span>}
              </div>
              <div className="bulk-images-missing-images">
                {set && decision ? (
                  set.images.map((image) => {
                    const isPrimary = decision.primaryImageId === image.id;
                    return (
                      <figure key={image.id} className={isPrimary ? "primary" : ""}>
                        <Thumb url={image.previewUrl} large />
                        <figcaption>{image.label}</figcaption>
                        <div>
                          <button
                            type="button"
                            aria-pressed={isPrimary}
                            title={isPrimary ? "Primary image" : "Make primary"}
                            onClick={() => update((current) => setPrimaryImage(current, set.setId, image.id))}
                          >
                            <Star /> {isPrimary ? "Primary" : "Make primary"}
                          </button>
                          <button
                            type="button"
                            aria-label={`Remove ${image.label}`}
                            onClick={() => update((current) => removeLocalImage(current, set.setId, image.id))}
                          >
                            <X />
                          </button>
                        </div>
                      </figure>
                    );
                  })
                ) : (
                  <span className="bulk-images-missing-empty">No images selected yet.</span>
                )}
              </div>
              <div className="bulk-images-missing-actions">
                <label className="admin-secondary bulk-images-upload">
                  <ImagePlus /> Upload Images
                  <input type="file" multiple accept={LOCAL_IMAGE_ACCEPT} onChange={(event) => void upload(product.id, event)} />
                </label>
                {set && decision && (
                  <>
                    <label className="bulk-images-override">
                      <input
                        type="checkbox"
                        checked={decision.included}
                        onChange={(event) => update((current) => setIncluded(current, set.setId, event.target.checked))}
                      />
                      Include
                    </label>
                    <button type="button" className="bulk-images-link" onClick={() => onKeepOnly(set.setId)}>
                      Keep only this set
                    </button>
                    <button type="button" className="bulk-images-link" onClick={() => update((current) => clearLocalSet(current, set.setId))}>
                      Clear selected set
                    </button>
                  </>
                )}
                {messages[product.id] && <small className="bulk-images-reject">{messages[product.id]}</small>}
              </div>
            </li>
          );
        })}
        {missing.length === 0 && <li className="bulk-images-empty">Every product has a primary image.</li>}
      </ul>
      {missing.length > limit && (
        <button type="button" className="admin-secondary bulk-images-more" onClick={() => setLimit((current) => current + MISSING_PAGE_SIZE)}>
          Show {Math.min(MISSING_PAGE_SIZE, missing.length - limit)} more of {missing.length - limit} remaining
        </button>
      )}
    </div>
  );
}
