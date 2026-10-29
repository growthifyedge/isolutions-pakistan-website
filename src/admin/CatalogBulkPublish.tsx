import { useEffect, useRef, useState } from "react";
import { supabase } from "../lib/supabase";
import { createSubmitLatch } from "../lib/bulkImageUpload";
import { installUnloadGuard } from "../lib/unloadGuard";
import { buildPublishPreview, publishConfirmationPhrase, publishConfirmationSatisfied, runBulkPublish, type PublishPreview, type PublishProgress, type PublishRunResult } from "../lib/bulkPublish";
import { loadPublishProducts, publishDbDeps, validateForPublication } from "../lib/bulkPublishDb";
import { commercialWriteTarget } from "../lib/commercialDefaults";
import { PREVIEW_LABEL, catalogPublishSelection, previewMatchesSelection, readableBlocker, validateDrafts } from "../lib/catalogBulkPublish";

// Admin -> Catalog: validate and publish the ticked Draft products (any category). Validation is read-only; the only
// write is products.publication_status = "published" through the existing bulk publish engine, which re-validates each
// product right before its write (and the database trigger validates once more).

const BUILD_MODE: string = import.meta.env.MODE;
const target = commercialWriteTarget(import.meta.env.VITE_SUPABASE_URL, BUILD_MODE);

type Props = {
  selected: ReadonlySet<string>;
  /** Reload the catalog list and clear the selection (called after a publish run). */
  onPublished: () => Promise<void>;
};

export function CatalogBulkPublish({ selected, onPublished }: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [preview, setPreview] = useState<PublishPreview | null>(null);
  const [previewIds, setPreviewIds] = useState<string[]>([]);
  const [confirming, setConfirming] = useState(false);
  const [typed, setTyped] = useState("");
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<PublishProgress | null>(null);
  const [result, setResult] = useState<PublishRunResult | null>(null);
  const validateLatch = useRef(createSubmitLatch());
  const publishLatch = useRef(createSubmitLatch());

  useEffect(() => {
    if (!running) return undefined;
    return installUnloadGuard(window);
  }, [running]);

  // Any tick / untick after validating makes the preview stale: it is dropped and must be re-run.
  const current = previewMatchesSelection(preview, previewIds, selected);
  useEffect(() => {
    if (preview && !current) {
      setPreview(null);
      setPreviewIds([]);
      setConfirming(false);
    }
  }, [preview, current]);

  async function validateSelected() {
    if (!supabase || selected.size === 0 || !validateLatch.current.tryAcquire()) return;
    const client = supabase;
    const ids = [...selected];
    setError("");
    setResult(null);
    setPreview(null);
    setBusy(true);
    try {
      // Fresh read: the list's cached status is never trusted.
      const selection = catalogPublishSelection(ids, await loadPublishProducts(client));
      const validations = await validateDrafts(selection, (productId) => validateForPublication(client, productId));
      setPreviewIds(ids);
      setPreview(buildPublishPreview(selection, validations));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Validation failed.");
    } finally {
      setBusy(false);
      validateLatch.current.release();
    }
  }

  async function publish() {
    if (!preview || !current || !supabase || running || !publishConfirmationSatisfied(target.environment, typed, preview.totals.ready) || !publishLatch.current.tryAcquire()) return;
    const client = supabase;
    setConfirming(false);
    setRunning(true);
    setError("");
    try {
      const run = await runBulkPublish(preview, { supabaseUrl: import.meta.env.VITE_SUPABASE_URL, buildMode: BUILD_MODE, ...publishDbDeps(client), onProgress: setProgress });
      setResult(run);
      setPreview(null);
      setPreviewIds([]);
      await onPublished();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Publish failed.");
    } finally {
      setRunning(false);
      setProgress(null);
      publishLatch.current.release();
    }
  }

  const totals = current ? preview?.totals : undefined;
  const entries = current ? preview?.entries ?? [] : [];
  const ready = entries.filter((entry) => entry.kind === "ready");
  const needsReview = entries.filter((entry) => entry.kind === "blocked");
  const other = entries.filter((entry) => entry.kind === "already_published" || entry.kind === "skipped");
  const production = target.environment === "production";
  const canPublish = Boolean(target.allowed && totals && totals.ready > 0 && !running && !busy);
  // Hidden until something is selected; the last run's results stay visible after the selection is cleared.
  if (selected.size === 0 && !result && !running && !error) return null;

  return (
    <section className="catalog-bulk" aria-labelledby="catalog-bulk-title">
      <div className="catalog-bulk-head">
        <div>
          <h2 id="catalog-bulk-title">Bulk publish</h2>
          <p>
            <strong>{selected.size}</strong> Draft product(s) selected. Validation only checks; nothing is published until you confirm.
          </p>
        </div>
        <div className={`bulk-images-env ${production ? "production" : "development"}`} role="status">
          <span>Environment</span>
          <strong>{target.environment ? target.environment.toUpperCase() : "UNKNOWN"}</strong>
          <small>{target.projectRef ?? "Publishing blocked"}</small>
        </div>
      </div>
      {!target.allowed && <p className="bulk-images-error">{target.reason} Publishing is disabled.</p>}
      <div className="bulk-images-bulk">
        <button type="button" className="admin-secondary" disabled={busy || running || selected.size === 0} onClick={() => void validateSelected()}>
          {busy ? "Validating…" : `Validate Selected (${selected.size})`}
        </button>
        <button type="button" className="admin-primary" disabled={!canPublish} onClick={() => { setTyped(""); setConfirming(true); }}>
          Publish Selected{totals ? ` (${totals.ready})` : ""}
        </button>
      </div>
      {error && <p className="bulk-images-error" role="alert">{error}</p>}
      {totals && (
        <div className="bulk-images-devreport catalog-bulk-preview" aria-label="Validation results">
          <strong>Validation results — nothing published</strong>
          <p>
            Ready to Publish {totals.ready} · Needs Review {totals.blocked} · Already Published {totals.alreadyPublished} · Skipped {totals.skipped}
            {totals.missingTitles > 0 ? ` · No longer exists ${totals.missingTitles}` : ""}
          </p>
          <ul>
            {[...ready, ...needsReview, ...other].map((entry) => (
              <li key={entry.productId} className={`catalog-bulk-${entry.kind}`}>
                <span>{PREVIEW_LABEL[entry.kind]}</span> <strong>{entry.title}</strong>
                {entry.blockers.length > 0 && <> — {entry.blockers.map(readableBlocker).join("; ")}</>}
                {entry.reason && <> — {entry.reason}</>}
              </li>
            ))}
          </ul>
        </div>
      )}
      {running && progress && (
        <p className="bulk-images-note" role="status">
          Product {Math.min(progress.done + 1, progress.total)} of {progress.total}: {progress.current ?? "finishing"} — please keep this page open.
        </p>
      )}
      {result && (
        <div className={`bulk-images-devreport ${result.outcome === "verified" ? "verified" : "failed"}`} role={result.outcome === "verified" ? "status" : "alert"} aria-label="Bulk publish result">
          <strong>{result.outcome === "verified" ? "Publish complete" : result.outcome === "blocked" ? "Publish blocked" : "Finished with issues"}</strong>
          <p>{result.message}</p>
          <p>
            Successfully Published {result.summary.verified} · Failed / Needs Review {result.summary.failed + result.summary.blocked} · Already Published / Skipped{" "}
            {result.summary.alreadyPublished + result.summary.skipped}
          </p>
          <ul>
            {result.products.map((product) => (
              <li key={product.productId}>
                <strong>{product.title}</strong> — {product.status === "verified" ? "Published" : product.status.replace("_", " ")}
                {product.status !== "verified" && <>: {product.blockers.length ? product.blockers.map(readableBlocker).join("; ") : product.message}</>}
              </li>
            ))}
          </ul>
        </div>
      )}
      {confirming && totals && (
        <div className="bulk-images-dialog-backdrop">
          <div className={`bulk-images-dialog${production ? " production" : ""}`} role="dialog" aria-modal="true" aria-labelledby="catalog-bulk-confirm">
            {production && <div className="bulk-images-prod-banner">PRODUCTION</div>}
            <h3 id="catalog-bulk-confirm">Publish {totals.ready} product(s)?</h3>
            <dl>
              <div><dt>Environment</dt><dd><strong>{target.environment?.toUpperCase()}</strong> <code>{target.projectRef}</code></dd></div>
              <div><dt>Will publish</dt><dd>{totals.ready}</dd></div>
              <div><dt>Not published</dt><dd>{totals.blocked} need review · {totals.alreadyPublished + totals.skipped} already published / skipped</dd></div>
            </dl>
            <ul className="catalog-bulk-confirm-list" aria-label="Products to publish">
              {ready.map((entry) => <li key={entry.productId}>{entry.title}</li>)}
            </ul>
            <p className="bulk-images-error">
              {production ? "This publishes these products to the live storefront." : "This publishes these products on the DEV storefront."} Each product is validated again right before it is published.
            </p>
            {production && (
              <label className="bulk-images-typed">
                Type {publishConfirmationPhrase(totals.ready)} to enable publishing
                <input type="text" autoComplete="off" spellCheck={false} value={typed} onChange={(event) => setTyped(event.target.value)} />
              </label>
            )}
            <div className="bulk-images-dialog-actions">
              <button type="button" className="admin-secondary" onClick={() => setConfirming(false)}>Cancel</button>
              <button type="button" className="admin-primary" disabled={running || !publishConfirmationSatisfied(target.environment, typed, totals.ready)} onClick={() => void publish()}>
                Confirm and publish
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
