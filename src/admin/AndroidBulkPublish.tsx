import { useEffect, useRef, useState } from "react";
import { supabase } from "../lib/supabase";
import { createSubmitLatch } from "../lib/bulkImageUpload";
import { installUnloadGuard } from "../lib/unloadGuard";
import { buildPublishPreview, publishConfirmationPhrase, publishConfirmationSatisfied, runBulkPublish, type PublishPreview, type PublishProgress, type PublishRunResult, type PublishValidation } from "../lib/bulkPublish";
import { loadPublishProducts, publishDbDeps, validateForPublication } from "../lib/bulkPublishDb";
import { commercialWriteTarget, selectAndroidBatch } from "../lib/commercialDefaults";

// Publish ready products of the imported Android batch (exact title list). Preview is read-only; the only write is
// products.publication_status = "published", after the existing validator passes (re-run immediately before each write).

const BUILD_MODE: string = import.meta.env.MODE;
const target = commercialWriteTarget(import.meta.env.VITE_SUPABASE_URL, BUILD_MODE);

export function AndroidBulkPublish() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [preview, setPreview] = useState<PublishPreview | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [typed, setTyped] = useState("");
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<PublishProgress | null>(null);
  const [result, setResult] = useState<PublishRunResult | null>(null);
  const latch = useRef(createSubmitLatch());

  // While publishing, the browser warns before a reload / tab close / navigation.
  useEffect(() => {
    if (!running) return undefined;
    return installUnloadGuard(window);
  }, [running]);

  async function runPreview() {
    if (!supabase) return;
    const client = supabase;
    setError("");
    setResult(null);
    setPreview(null);
    setBusy(true);
    try {
      const selection = selectAndroidBatch(await loadPublishProducts(client));
      const validations = new Map<string, PublishValidation | null>();
      const drafts = selection.targets.filter((product) => product.publicationStatus === "draft");
      for (let index = 0; index < drafts.length; index += 6) {
        await Promise.all(
          drafts.slice(index, index + 6).map(async (product) => {
            try {
              validations.set(product.id, await validateForPublication(client, product.id));
            } catch {
              validations.set(product.id, null);
            }
          }),
        );
      }
      setPreview(buildPublishPreview(selection, validations));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Preview failed.");
    } finally {
      setBusy(false);
    }
  }

  async function publish() {
    if (!preview || !supabase || !publishConfirmationSatisfied(target.environment, typed, preview.totals.ready) || !latch.current.tryAcquire()) return;
    const client = supabase;
    setConfirming(false);
    setRunning(true);
    setResult(null);
    setError("");
    try {
      setResult(
        await runBulkPublish(preview, {
          supabaseUrl: import.meta.env.VITE_SUPABASE_URL,
          buildMode: BUILD_MODE,
          ...publishDbDeps(client),
          onProgress: setProgress,
        }),
      );
    } finally {
      setRunning(false);
      setProgress(null);
      latch.current.release();
    }
  }

  const totals = preview?.totals;
  const production = target.environment === "production";
  const canPublish = Boolean(target.allowed && totals && totals.ready > 0 && !running && !busy);
  const blockedEntries = preview?.entries.filter((entry) => entry.kind === "blocked" || entry.kind === "skipped") ?? [];

  return (
    <section className="admin-panel android-commercial" aria-labelledby="android-publish-title">
      <span className="admin-kicker">CATALOG MAINTENANCE</span>
      <h2 id="android-publish-title">Publish ready Android products</h2>
      <p>
        Publishes only products of the imported Android batch (exact title list) that pass the real publication validation <em>right before</em> each write. Nothing else
        changes: prices, stock, SKUs, PTA/Condition, media, titles, slugs, brand and category stay as they are.
      </p>
      <div className={`bulk-images-env ${production ? "production" : "development"}`} role="status">
        <span>Environment</span>
        <strong>{target.environment ? target.environment.toUpperCase() : "UNKNOWN"}</strong>
        <small>{target.projectRef ?? "Publishing blocked"}</small>
      </div>
      {!target.allowed && <p className="bulk-images-error">{target.reason}</p>}
      <div className="bulk-images-bulk">
        <button type="button" className="admin-secondary" disabled={busy || running || !target.allowed} onClick={() => void runPreview()}>
          {busy ? "Checking…" : "Preview publication"}
        </button>
        <button type="button" className="admin-primary" disabled={!canPublish} onClick={() => { setTyped(""); setConfirming(true); }}>
          Publish ready products
        </button>
      </div>
      {error && (
        <p className="bulk-images-error" role="alert">
          {error}
        </p>
      )}
      {preview && totals && (
        <div className="bulk-images-devreport" aria-label="Publication preview">
          <strong>Preview — nothing published</strong>
          <p>
            Target products {totals.targets} · draft {totals.draft} · already published {totals.alreadyPublished} · fully ready {totals.ready} · blocked {totals.blocked} · skipped{" "}
            {totals.skipped}
          </p>
          {totals.missingTitles > 0 && <p>Batch titles not found in this environment: {totals.missingTitles} (not touched).</p>}
          {blockedEntries.length > 0 && (
            <ul>
              {blockedEntries.slice(0, 15).map((entry) => (
                <li key={entry.productId}>
                  {entry.kind === "blocked" ? "Blocked" : "Skipped"} — {entry.title}: {entry.blockers.length ? entry.blockers.join(", ") : entry.reason}
                </li>
              ))}
              {blockedEntries.length > 15 && <li>…and {blockedEntries.length - 15} more.</li>}
            </ul>
          )}
        </div>
      )}
      {running && progress && (
        <p className="bulk-images-note" role="status">
          Product {Math.min(progress.done + 1, progress.total)} of {progress.total}: {progress.current ?? "finishing"} — please keep this page open.
        </p>
      )}
      {result && (
        <div className={`bulk-images-devreport ${result.outcome === "verified" ? "verified" : "failed"}`} role={result.outcome === "verified" ? "status" : "alert"} aria-label="Bulk publish result">
          <strong>{result.outcome === "verified" ? "Publish verified" : result.outcome === "blocked" ? "Publish blocked" : "Finished with issues"}</strong>
          <p>{result.message}</p>
          <p>
            Products targeted {result.summary.targeted} · published + verified {result.summary.verified} · already published {result.summary.alreadyPublished} · blocked{" "}
            {result.summary.blocked} · failed {result.summary.failed} · skipped {result.summary.skipped}
          </p>
          {result.products.filter((product) => product.status === "blocked" || product.status === "failed").map((product) => (
            <p key={product.productId}>
              <strong>{product.title}</strong> ({product.status}): {product.message}
            </p>
          ))}
        </div>
      )}
      {confirming && totals && (
        <div className="bulk-images-dialog-backdrop">
          <div className={`bulk-images-dialog${production ? " production" : ""}`} role="dialog" aria-modal="true" aria-labelledby="android-publish-confirm">
            {production && <div className="bulk-images-prod-banner">PRODUCTION</div>}
            <h3 id="android-publish-confirm">Publish {totals.ready} products?</h3>
            <dl>
              <div><dt>Environment</dt><dd><strong>{target.environment?.toUpperCase()}</strong> <code>{target.projectRef}</code></dd></div>
              <div><dt>Target products</dt><dd>{totals.targets}</dd></div>
              <div><dt>Ready to publish</dt><dd>{totals.ready}</dd></div>
              <div><dt>Already published</dt><dd>{totals.alreadyPublished}</dd></div>
              <div><dt>Blocked</dt><dd>{totals.blocked}</dd></div>
              <div><dt>Skipped</dt><dd>{totals.skipped}</dd></div>
            </dl>
            <p className="bulk-images-error">{production ? "This will publish products to the live storefront." : "This will publish products on the DEV storefront."}</p>
            {production && (
              <label className="bulk-images-typed">
                Type {publishConfirmationPhrase(totals.ready)} to enable publishing
                <input type="text" autoComplete="off" spellCheck={false} value={typed} onChange={(event) => setTyped(event.target.value)} />
              </label>
            )}
            <div className="bulk-images-dialog-actions">
              <button type="button" className="admin-secondary" onClick={() => setConfirming(false)}>
                Cancel
              </button>
              <button type="button" className="admin-primary" disabled={!publishConfirmationSatisfied(target.environment, typed, totals.ready)} onClick={() => void publish()}>
                Confirm and publish
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
