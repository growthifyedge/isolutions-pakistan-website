import { ChangeEvent, useEffect, useMemo, useRef, useState } from "react";
import { FileArchive, ImagePlus, Search, ShieldCheck, Star, Trash2, X } from "lucide-react";
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
  addLocalFiles,
  assignProduct,
  attachLocalImages,
  catalogCoverage,
  chooseSourceSet,
  clearLocalSet,
  deselectAll,
  keepOnlyBlockReason,
  keepOnlySet,
  selectAllEligible,
  confirmAllReviewSuggestions,
  confirmMatch,
  eligibleReviewSetIds,
  createPreviewUrlRegistry,
  emptyReview,
  filterReviewSets,
  localFileProblems,
  localImageContentProblems,
  missingImageProducts,
  parseShopifyReview,
  previewUrlsInReview,
  readShopifyExport,
  referenceCatalogEnvironment,
  removeLocalImage,
  restoreSet,
  reviewSetStates,
  searchCatalogProducts,
  setExistingMode,
  setImageSelected,
  setIncluded,
  setPrimaryImage,
  skipSet,
  summarizeReview,
  validateBulkImageSelection,
  type BulkImageCatalogProduct,
  type BulkImageFilter,
  type BulkImageReview,
  type BulkImageSet,
  type BulkImageSetState,
  type BulkImageSourceKind,
  type ExistingImageMode,
} from "../lib/bulkProductImagesReview";

// Review panel + environment-aware bulk uploader. The only write path is the single upload button
// (src/lib/bulkImageUpload.ts): it exists only for the exact DEVELOPMENT or PRODUCTION build, runs a
// preflight first, needs an explicit confirmation (typed "PRODUCTION" on production) and uploads one product at a time.

const PAGE_SIZE = 60;
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

const FILTERS: { key: BulkImageFilter; label: string }[] = [
  { key: "relevant", label: "Relevant" },
  { key: "all", label: "All" },
  { key: "matched", label: "Matched" },
  { key: "review", label: "Review" },
  { key: "multiple", label: "Multiple" },
  { key: "conflict", label: "Conflict" },
  { key: "unmatched", label: "Unmatched" },
  { key: "invalid", label: "Invalid" },
  { key: "existing", label: "Existing image" },
];

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
  const [sourceKind, setSourceKind] = useState<BulkImageSourceKind>("shopify");
  const [shopifyFile, setShopifyFile] = useState<File | null>(null);
  const [localFiles, setLocalFiles] = useState<File[]>([]);
  const [inputKey, setInputKey] = useState(0);
  const [review, setReview] = useState<BulkImageReview>(emptyReview);
  const [notes, setNotes] = useState<string[]>([]);
  const [errors, setErrors] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [filter, setFilter] = useState<BulkImageFilter>("relevant");
  const [query, setQuery] = useState("");
  const [limit, setLimit] = useState(PAGE_SIZE);
  const [pickerFor, setPickerFor] = useState<string | null>(null);
  const [galleryFor, setGalleryFor] = useState<string | null>(null);
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

  /** "Confirm all review suggestions": accepts only the matcher's existing, unambiguous Review suggestions. */
  function confirmAllReview() {
    const result = confirmAllReviewSuggestions(review, catalog);
    setReview(result.review);
    const after = reviewSetStates(result.review, catalog);
    const count = (status: string) => [...after.values()].filter((state) => state.status === status).length;
    const conflictProducts = new Set([...after.values()].filter((state) => state.status === "conflict").map((state) => state.targetId)).size;
    const missing = missingImageProducts(result.review, after, catalog).length;
    const head = `Confirmed ${result.confirmed} review suggestion${result.confirmed === 1 ? "" : "s"}. ${result.skipped} skipped${result.skipped ? " — manual review still required" : ""}.`;
    const remaining = [
      conflictProducts ? `${conflictProducts} Conflict product${conflictProducts === 1 ? "" : "s"}` : "",
      count("multiple") ? `${count("multiple")} Multiple` : "",
      count("review") ? `${count("review")} Review` : "",
      missing ? `${missing} Missing` : "",
    ].filter(Boolean);
    setKeepNotice(`${head} ${remaining.length ? `${count("review") ? "Review not complete" : "Review complete"}. Remaining manual actions: ${remaining.join(", ")}.` : "Nothing else needs manual action."}`);
  }

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

  async function loadAndMatch() {
    setErrors([]);
    setBusy(true);
    try {
      if (sourceKind === "shopify") {
        if (!shopifyFile) return;
        const exported = await readShopifyExport(shopifyFile);
        if ("error" in exported) {
          setErrors([exported.error]);
          return;
        }
        const parsed = parseShopifyReview(review, exported.text, catalog);
        if (!parsed.review) {
          setErrors(parsed.errors);
          return;
        }
        setReview(parsed.review);
        setNotes((current) => [
          ...current.filter((note) => !note.startsWith("Shopify")),
          `Shopify ${exported.csvName}: ${parsed.rowCount} CSV rows → ${parsed.productCount} source sets (one per Handle).`,
        ]);
        setFilter("relevant");
      } else {
        if (localFiles.length === 0) return;
        const contentProblems = await localImageContentProblems(localFiles);
        const previewUrls = localFiles.map((file, index) => (contentProblems[index] ? null : previews.current.create(file)));
        setReview((current) => addLocalFiles(current, localFiles, catalog, { contentProblems, previewUrls }));
        setNotes((current) => [...current, `Local: ${localFiles.length} file${localFiles.length === 1 ? "" : "s"} added — shown first in the table (Source = Local).`]);
        setFilter("all");
        setQuery("");
        setLocalFiles([]);
        setInputKey((key) => key + 1);
      }
      setLimit(PAGE_SIZE);
    } finally {
      setBusy(false);
    }
  }

  function clearReview() {
    setReview(emptyReview());
    setNotes([]);
    setErrors([]);
    setPickerFor(null);
    setGalleryFor(null);
  }

  const states = useMemo(() => reviewSetStates(review, catalog), [review, catalog]);
  const summary = useMemo(() => summarizeReview(review, states), [review, states]);
  const coverage = useMemo(() => catalogCoverage(review, states, catalog), [review, states, catalog]);
  const validation = useMemo(() => validateBulkImageSelection(review, catalog, environment), [review, catalog]);
  const visibleSets = useMemo(() => filterReviewSets(review, states, catalog, filter, query), [review, states, catalog, filter, query]);
  const productById = useMemo(() => new Map(catalog.map((product) => [product.id, product])), [catalog]);
  const canLoad = !busy && !catalogLoading && !catalogError && (sourceKind === "shopify" ? Boolean(shopifyFile) : localFiles.length > 0);
  const hasSets = review.sets.length > 0;
  const eligibleReviewIds = useMemo(() => eligibleReviewSetIds(review, catalog), [review, catalog]);
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
          <span className="admin-kicker">BULK PRODUCT IMAGES</span>
          <h2 id="bulk-images-title">Bulk Product Images</h2>
          <p>
            Match Shopify image sets or local images to catalog products, choose the primary and gallery images, review, then upload the
            selected sets to the {uploadTarget.environment === "production" ? "PRODUCTION" : "DEV"} catalog.
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
      <div className="bulk-images-source" role="group" aria-label="Image source">
        <button type="button" className={sourceKind === "shopify" ? "active" : ""} aria-pressed={sourceKind === "shopify"} onClick={() => setSourceKind("shopify")}>
          <FileArchive /> Shopify CSV / ZIP
        </button>
        <button type="button" className={sourceKind === "local" ? "active" : ""} aria-pressed={sourceKind === "local"} onClick={() => setSourceKind("local")}>
          <ImagePlus /> Local Images
        </button>
      </div>
      <div className="bulk-images-load">
        {sourceKind === "shopify" ? (
          <label>
            Shopify Products export (.csv or .zip)
            <input key={`shopify-${inputKey}`} type="file" accept=".csv,.zip,text/csv,application/zip" onChange={(event) => setShopifyFile(event.target.files?.[0] ?? null)} />
          </label>
        ) : (
          <label>
            Product images (JPEG, PNG, WebP, AVIF · named "Brand Model", extra images "Brand Model (2)")
            <input
              key={`local-${inputKey}`}
              type="file"
              multiple
              accept={LOCAL_IMAGE_ACCEPT}
              onChange={(event: ChangeEvent<HTMLInputElement>) => setLocalFiles([...(event.target.files ?? [])])}
            />
          </label>
        )}
        <button type="button" className="admin-primary" disabled={!canLoad} onClick={() => void loadAndMatch()}>
          {busy ? "Matching…" : "Load & Match"}
        </button>
        {hasSets && (
          <button type="button" className="admin-secondary" onClick={clearReview}>
            Clear review
          </button>
        )}
      </div>
      {errors.length > 0 && (
        <ul className="bulk-images-error" role="alert">
          {errors.map((error) => (
            <li key={error}>{error}</li>
          ))}
        </ul>
      )}
      {notes.length > 0 && <p className="bulk-images-note">{notes.join(" · ")}</p>}

      {!catalogLoading && !catalogError && (
        <div className="bulk-images-coverage" aria-label="Catalog coverage">
          <h3>Catalog coverage</h3>
          <div className="bulk-images-cards six">
            {(
              [
                ["Catalog products", coverage.total],
                ["With usable source", coverage.withSource],
                ["Selected for images", coverage.selected],
                ["Still missing", coverage.missing],
                ["Existing primary", coverage.existingPrimary],
                ["Needs manual action", coverage.needsManualAction],
              ] as const
            ).map(([label, value]) => (
              <article key={label}>
                <small>{label}</small>
                <strong>{value}</strong>
              </article>
            ))}
          </div>
          <p>
            By best source: {coverage.matched} matched{coverage.confirmed ? ` · ${coverage.confirmed} confirmed` : ""} · {coverage.review} review ·{" "}
            {coverage.conflict} conflict · {coverage.multiple} multiple · {coverage.none} without a source
          </p>
        </div>
      )}

      {hasSets && (
        <>
          <h3 className="bulk-images-section-title">Source sets</h3>
          <div className="bulk-images-cards" aria-label="Source summary">
            {(
              [
                ["Loaded", summary.loaded, `${summary.images} images`],
                ["Matched", summary.matched + summary.confirmed],
                ["Review", summary.review],
                ["Multiple", summary.multiple],
                ["Conflict", summary.conflict, `${summary.conflictProducts} product${summary.conflictProducts === 1 ? "" : "s"}`],
                ["Unmatched", summary.unmatched, summary.skipped ? `${summary.skipped} skipped` : undefined],
                ["Invalid", summary.invalid],
                ["Included", summary.included, `${summary.includedImages} images`],
              ] as const
            ).map(([label, value, note]) => (
              <article key={label}>
                <small>{label}</small>
                <strong>{value}</strong>
                {note && <span>{note}</span>}
              </article>
            ))}
          </div>

          <div className="bulk-images-tools">
            <div className="bulk-images-filters" role="group" aria-label="Filter source sets">
              {FILTERS.map((entry) => (
                <button
                  key={entry.key}
                  type="button"
                  className={filter === entry.key ? "active" : ""}
                  aria-pressed={filter === entry.key}
                  onClick={() => {
                    setFilter(entry.key);
                    setLimit(PAGE_SIZE);
                  }}
                >
                  {entry.label}
                </button>
              ))}
            </div>
            <label className="bulk-images-search">
              <Search />
              <input
                type="search"
                placeholder="Search title, handle, brand, model or product"
                value={query}
                onChange={(event) => {
                  setQuery(event.target.value);
                  setLimit(PAGE_SIZE);
                }}
              />
            </label>
          </div>

          <div className="bulk-images-bulk" role="group" aria-label="Bulk selection">
            <button type="button" className="admin-secondary" disabled={eligibleReviewIds.length === 0} onClick={confirmAllReview}>
              Confirm all review suggestions
            </button>
            <button type="button" className="admin-secondary" onClick={() => update((current) => selectAllEligible(current, catalog))}>
              Select all eligible
            </button>
            <button type="button" className="admin-secondary" onClick={() => update(deselectAll)}>
              Deselect all
            </button>
            <small>Review-only: changes which sets are included. Nothing is saved or uploaded.</small>
          </div>
          {keepNotice && (
            <p className="bulk-images-note" role="status">
              {keepNotice}
            </p>
          )}

          <div className="bulk-images-table">
            <table>
              <thead>
                <tr>
                  <th>Include Set?</th>
                  <th>Source</th>
                  <th>Shopify Title / Files</th>
                  <th>Handle</th>
                  <th>Detected Brand</th>
                  <th>Detected Model</th>
                  <th>Matched iSolutions Product</th>
                  <th>Images</th>
                  <th>Primary Preview</th>
                  <th>Status</th>
                  <th>Issue</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {visibleSets.slice(0, limit).map((set) => (
                  <SetRows
                    key={set.setId}
                    set={set}
                    state={states.get(set.setId)!}
                    review={review}
                    catalog={catalog}
                    productById={productById}
                    pickerOpen={pickerFor === set.setId}
                    onPicker={(open) => setPickerFor(open ? set.setId : null)}
                    galleryOpen={galleryFor === set.setId}
                    onGallery={(open) => setGalleryFor(open ? set.setId : null)}
                    update={update}
                    onKeepOnly={keepOnly}
                  />
                ))}
                {visibleSets.length === 0 && (
                  <tr>
                    <td colSpan={12} className="bulk-images-empty">
                      No source sets for this filter.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          {visibleSets.length > limit && (
            <button type="button" className="admin-secondary bulk-images-more" onClick={() => setLimit((current) => current + PAGE_SIZE)}>
              Show {Math.min(PAGE_SIZE, visibleSets.length - limit)} more of {visibleSets.length - limit} remaining
            </button>
          )}
        </>
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

function SetRows({
  set,
  state,
  review,
  catalog,
  productById,
  pickerOpen,
  onPicker,
  galleryOpen,
  onGallery,
  update,
  onKeepOnly,
}: {
  set: BulkImageSet;
  state: BulkImageSetState;
  review: BulkImageReview;
  catalog: BulkImageCatalogProduct[];
  productById: Map<string, BulkImageCatalogProduct>;
  pickerOpen: boolean;
  onPicker: (open: boolean) => void;
  galleryOpen: boolean;
  onGallery: (open: boolean) => void;
  update: Update;
  onKeepOnly: (setId: string) => void;
}) {
  const decision = review.decisions[set.setId];
  const target = state.targetId ? productById.get(state.targetId) : undefined;
  const dismissed = state.status === "not_used" || state.status === "skipped";
  const includable = state.status !== "invalid" && Boolean(target);
  const primary = set.images.find((image) => image.id === decision.primaryImageId) ?? null;
  const assign = (productId: string | null) => {
    update((current) => assignProduct(current, set.setId, productId, catalog));
    onPicker(false);
  };
  const reviewImages = state.status !== "invalid" && (
    <button type="button" onClick={() => onGallery(!galleryOpen)}>
      {galleryOpen ? "Hide images" : "Review Images"}
    </button>
  );
  return (
    <>
      <tr className={`status-${state.status}${decision.included ? " included" : ""}`}>
        <td>
          <input
            type="checkbox"
            aria-label={`Include ${set.title}`}
            checked={decision.included}
            disabled={!includable}
            onChange={(event) => update((current) => setIncluded(current, set.setId, event.target.checked))}
          />
        </td>
        <td>
          {set.sourceKind === "shopify" ? "Shopify" : "Local"}
          {set.shopifyStatus && <small>{set.shopifyStatus}</small>}
        </td>
        <td className="bulk-images-label">
          {set.sourceKind === "local" && set.images.length > 1 ? `${set.images.length} local files` : set.title}
          {set.sourceKind === "local" && set.images.length > 1 && <small className="plain">{set.images.map((image) => image.label).join(", ")}</small>}
        </td>
        <td className="bulk-images-candidate">{set.handle ?? "—"}</td>
        <td>{set.match.detectedBrand ?? "—"}</td>
        <td>{set.match.detectedModel || "—"}</td>
        <td className="bulk-images-target">
          {target ? (
            <>
              <strong>{target.title}</strong>
              {!decision.confirmed && !dismissed && <small>Suggested</small>}
              {target.hasPrimary && <small className="has-primary">Has primary image</small>}
            </>
          ) : state.status === "multiple" ? (
            <small>{set.match.candidateProductIds.length} candidates</small>
          ) : (
            "—"
          )}
          {pickerOpen && <ProductPicker catalog={catalog} onPick={assign} onClose={() => onPicker(false)} />}
        </td>
        <td className="bulk-images-strip-cell">
          <span className="bulk-images-count">
            {decision.selectedImageIds.length}/{set.images.length} selected
          </span>
          <span className="bulk-images-strip">
            {set.images.slice(0, 4).map((image) => (
              <Thumb key={image.id} url={image.previewUrl} />
            ))}
            {set.images.length > 4 && <em>+{set.images.length - 4}</em>}
          </span>
        </td>
        <td>
          <Thumb url={primary?.previewUrl ?? null} large />
          {primary && <small className="plain">{target?.hasPrimary && decision.existingMode !== "add_make_primary" ? "Gallery only" : primary.label}</small>}
        </td>
        <td>
          <span className={`bulk-images-status ${state.status}`}>{STATUS_LABEL[state.status]}</span>
        </td>
        <td className="bulk-images-issue">{state.issue}</td>
        <td className="bulk-images-actions">
          {dismissed ? (
            <button type="button" onClick={() => update((current) => restoreSet(current, set.setId))}>
              Restore
            </button>
          ) : (
            <>
              {state.status === "review" && (
                <button type="button" onClick={() => update((current) => confirmMatch(current, set.setId, catalog))}>
                  Confirm Match
                </button>
              )}
              {state.status === "conflict" && (
                <button type="button" onClick={() => update((current) => chooseSourceSet(current, set.setId, catalog))}>
                  Use This Source Set
                </button>
              )}
              {state.status === "multiple" &&
                set.match.candidateProductIds.map((id) => (
                  <button key={id} type="button" onClick={() => assign(id)}>
                    Use {productById.get(id)?.title ?? "product"}
                  </button>
                ))}
              {state.status !== "invalid" && (
                <button type="button" onClick={() => onPicker(!pickerOpen)}>
                  {target ? "Change Product" : "Choose Product"}
                </button>
              )}
              {state.status === "unmatched" && (
                <button type="button" onClick={() => update((current) => skipSet(current, set.setId))}>
                  Skip
                </button>
              )}
              {reviewImages}
              {includable && (
                <button type="button" onClick={() => onKeepOnly(set.setId)}>
                  Keep only this set
                </button>
              )}
              {target && decision.confirmed && !set.match.productId && set.sourceKind === "shopify" && (
                <button type="button" onClick={() => assign(null)}>
                  Clear product
                </button>
              )}
              {set.sourceKind === "local" && (
                <button type="button" onClick={() => update((current) => clearLocalSet(current, set.setId))}>
                  Remove set
                </button>
              )}
              {target?.hasPrimary && (
                <ExistingModeSelect
                  value={decision.existingMode}
                  onChange={(mode) => update((current) => setExistingMode(current, set.setId, mode))}
                />
              )}
            </>
          )}
        </td>
      </tr>
      {galleryOpen && (
        <tr className="bulk-images-gallery-row">
          <td colSpan={12}>
            <GalleryEditor set={set} review={review} target={target} update={update} />
          </td>
        </tr>
      )}
    </>
  );
}

function ExistingModeSelect({ value, onChange }: { value: ExistingImageMode; onChange: (mode: ExistingImageMode) => void }) {
  return (
    <label className="bulk-images-override">
      Existing image
      <select value={value} onChange={(event) => onChange(event.target.value as ExistingImageMode)}>
        <option value="skip">Skip (default)</option>
        <option value="add">Add images (gallery)</option>
        <option value="add_make_primary">Add and make primary</option>
      </select>
    </label>
  );
}

/** All images of one source set: select gallery images and choose the single primary. */
function GalleryEditor({ set, review, target, update }: { set: BulkImageSet; review: BulkImageReview; target?: BulkImageCatalogProduct; update: Update }) {
  const decision = review.decisions[set.setId];
  const galleryOnly = Boolean(target?.hasPrimary && decision.existingMode !== "add_make_primary");
  return (
    <div className="bulk-images-gallery" aria-label={`Images of ${set.title}`}>
      <p>
        {galleryOnly
          ? "This product already has a primary image: selected images are added as gallery images only (old media is kept)."
          : "One selected image is Primary; every other selected image is added as a gallery image. Untick an image to leave it out."}
      </p>
      <ul>
        {set.images.map((image) => {
          const selected = decision.selectedImageIds.includes(image.id);
          const isPrimary = decision.primaryImageId === image.id;
          return (
            <li key={image.id} className={`${selected ? "selected" : ""}${isPrimary && !galleryOnly ? " primary" : ""}${image.invalidReason ? " invalid" : ""}`}>
              <Thumb url={image.previewUrl} large />
              <span className="bulk-images-image-label">{image.label}</span>
              {image.invalidReason ? (
                <small className="plain">{image.invalidReason}</small>
              ) : (
                <>
                  <label>
                    <input
                      type="checkbox"
                      checked={selected}
                      disabled={isPrimary && !galleryOnly}
                      onChange={(event) => update((current) => setImageSelected(current, set.setId, image.id, event.target.checked))}
                    />
                    {isPrimary && !galleryOnly ? "Included (primary)" : "Include"}
                  </label>
                  {!galleryOnly && (
                    <label>
                      <input
                        type="radio"
                        name={`primary-${set.setId}`}
                        checked={isPrimary}
                        onChange={() => update((current) => setPrimaryImage(current, set.setId, image.id))}
                      />
                      Primary
                    </label>
                  )}
                </>
              )}
              {set.sourceKind === "local" && (
                <button type="button" onClick={() => update((current) => removeLocalImage(current, set.setId, image.id))}>
                  <Trash2 /> Remove
                </button>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** Catalog perspective: products without a primary image and without a usable Shopify source set. */
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
            Catalog products with no primary image and no usable Shopify source. Upload one or more local images per product — one is Primary,
            the rest are gallery images.
          </p>
        </div>
        <label className="bulk-images-search">
          <Search />
          <input type="search" placeholder="Search missing products" value={query} onChange={(event) => setQuery(event.target.value)} />
        </label>
      </div>
      <p className="bulk-images-note">{missing.length} product{missing.length === 1 ? "" : "s"} without a usable Shopify source.</p>
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
        {missing.length === 0 && <li className="bulk-images-empty">Every product has a primary image or a usable Shopify source.</li>}
      </ul>
      {missing.length > limit && (
        <button type="button" className="admin-secondary bulk-images-more" onClick={() => setLimit((current) => current + MISSING_PAGE_SIZE)}>
          Show {Math.min(MISSING_PAGE_SIZE, missing.length - limit)} more of {missing.length - limit} remaining
        </button>
      )}
    </div>
  );
}

function ProductPicker({
  catalog,
  onPick,
  onClose,
}: {
  catalog: BulkImageCatalogProduct[];
  onPick: (productId: string) => void;
  onClose: () => void;
}) {
  const [term, setTerm] = useState("");
  const results = useMemo(() => searchCatalogProducts(catalog, term), [catalog, term]);
  return (
    <div className="bulk-images-picker">
      <div>
        <input
          type="search"
          autoFocus
          aria-label="Search products by title, brand or slug"
          placeholder="Search title, brand or slug"
          value={term}
          onChange={(event) => setTerm(event.target.value)}
        />
        <button type="button" aria-label="Close product picker" onClick={onClose}>
          <X />
        </button>
      </div>
      <ul>
        {results.map((product) => (
          <li key={product.id}>
            <button type="button" onClick={() => onPick(product.id)}>
              <strong>{product.title}</strong>
              <small>
                {product.brand ?? "No brand"} · {product.slug}
                {product.hasPrimary ? " · has primary" : ""}
              </small>
            </button>
          </li>
        ))}
        {results.length === 0 && <li className="bulk-images-empty">No products found.</li>}
      </ul>
    </div>
  );
}
