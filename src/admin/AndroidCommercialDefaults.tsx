import { useRef, useState } from "react";
import { ShieldCheck } from "lucide-react";
import { supabase } from "../lib/supabase";
import { PRODUCTION_CONFIRMATION_TEXT, confirmationSatisfied } from "../lib/bulkImagePreflight";
import {
  ANDROID_BATCH_DESIRED,
  CONDITION_LABEL,
  PTA_LABEL,
  commercialWriteTarget,
  planCommercialDefaults,
  runCommercialDefaults,
  selectAndroidBatch,
  type BatchSelection,
  type CommercialPlan,
  type CommercialProduct,
  type CommercialRunResult,
  type CommercialVariant,
} from "../lib/commercialDefaults";
import { createSubmitLatch } from "../lib/bulkImageUpload";
import { VARIANT_COLUMNS, commercialDbDeps } from "../lib/commercialDefaultsDb";

// Bulk commercial facts for the imported Android batch (PTA Approved + Brand New). Preview is read-only;
// the write only touches product_variants.pta_status / condition (+ the product-level defaults that mirror them).

const BUILD_MODE: string = import.meta.env.MODE;
const target = commercialWriteTarget(import.meta.env.VITE_SUPABASE_URL, BUILD_MODE);
type ProductRecord = {
  id: string;
  title: string;
  slug: string;
  data_class: string | null;
  publication_status: string | null;
  default_pta_status: string;
  default_condition: string;
  brand: { name: string } | null;
};

const toProduct = (record: ProductRecord): CommercialProduct => ({
  id: record.id,
  title: record.title,
  slug: record.slug,
  brandName: record.brand?.name ?? null,
  dataClass: record.data_class,
  publicationStatus: record.publication_status,
  defaultPta: record.default_pta_status,
  defaultCondition: record.default_condition,
});

async function loadProducts(): Promise<CommercialProduct[]> {
  if (!supabase) throw new Error("Supabase client environment is not configured.");
  const products: CommercialProduct[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase
      .from("products")
      .select("id,title,slug,data_class,publication_status,default_pta_status,default_condition,brand:brands(name)")
      .order("id")
      .range(from, from + 999);
    if (error) throw new Error(error.message);
    const page = (data ?? []) as unknown as ProductRecord[];
    products.push(...page.map(toProduct));
    if (page.length < 1000) return products;
  }
}

async function loadVariants(productIds: string[]): Promise<CommercialVariant[]> {
  if (!supabase) throw new Error("Supabase client environment is not configured.");
  const variants: CommercialVariant[] = [];
  for (let index = 0; index < productIds.length; index += 40) {
    const { data, error } = await supabase.from("product_variants").select(VARIANT_COLUMNS).in("product_id", productIds.slice(index, index + 40));
    if (error) throw new Error(error.message);
    variants.push(...((data ?? []) as unknown as CommercialVariant[]));
  }
  return variants;
}

type Preview = { selection: BatchSelection; plan: CommercialPlan; loadedAt: number };
type Validation = { checked: number; ready: number; unresolved: number; blockers: Record<string, number>; sampleA07: string | null };

export function AndroidCommercialDefaults() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [typed, setTyped] = useState("");
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState("");
  const [result, setResult] = useState<CommercialRunResult | null>(null);
  const [validation, setValidation] = useState<Validation | null>(null);
  const latch = useRef(createSubmitLatch());

  async function runPreview() {
    setError("");
    setResult(null);
    setValidation(null);
    setPreview(null);
    setBusy(true);
    try {
      const products = await loadProducts();
      const selection = selectAndroidBatch(products);
      const variants = await loadVariants(selection.targets.map((product) => product.id));
      setPreview({ selection, plan: planCommercialDefaults(selection.targets, variants, ANDROID_BATCH_DESIRED, { overwriteExplicit: false }), loadedAt: Date.now() });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Preview failed.");
    } finally {
      setBusy(false);
    }
  }

  async function validatePublication(selection: BatchSelection) {
    if (!supabase) return;
    const client = supabase;
    const blockers: Record<string, number> = {};
    let ready = 0;
    let unresolved = 0;
    let sampleA07: string | null = null;
    for (const product of selection.targets) {
      const { data, error: rpcError } = await client.rpc("validate_product_for_publication", { p_product_id: product.id });
      if (rpcError) throw new Error(rpcError.message);
      const row = (Array.isArray(data) ? data[0] : data) as { is_valid: boolean; errors: string[] } | undefined;
      const errors = row?.errors ?? [];
      if (row?.is_valid) ready += 1;
      if (errors.includes("variant_commercial_facts_unresolved")) unresolved += 1;
      for (const code of errors) blockers[code] = (blockers[code] ?? 0) + 1;
      if (/^samsung (galaxy )?a07$/i.test(product.title.trim())) sampleA07 = errors.length ? errors.join(", ") : "valid (no blockers)";
    }
    setValidation({ checked: selection.targets.length, ready, unresolved, blockers, sampleA07 });
  }

  async function apply() {
    if (!preview || !supabase || !confirmationSatisfied(target.environment, typed) || !latch.current.tryAcquire()) return;
    const client = supabase;
    setConfirming(false);
    setRunning(true);
    setError("");
    try {
      const run = await runCommercialDefaults(preview.plan, {
        supabaseUrl: import.meta.env.VITE_SUPABASE_URL,
        buildMode: BUILD_MODE,
        ...commercialDbDeps(client),
        onProgress: (done, total, current) => setProgress(current ? `Product ${done + 1} of ${total}: ${current}` : ""),
      });
      setResult(run);
      if (run.summary.failed === 0) {
        try {
          await validatePublication(preview.selection);
        } catch (caught) {
          setError(`Publication check could not run: ${caught instanceof Error ? caught.message : "error"}`);
        }
      }
    } finally {
      setRunning(false);
      setProgress("");
      latch.current.release();
    }
  }

  const plan = preview?.plan;
  const totals = plan?.totals;
  const production = target.environment === "production";
  const canApply = Boolean(target.allowed && plan && totals && totals.variantsToChange + totals.productDefaultsToChange > 0 && !running && !busy);

  return (
    <section className="admin-panel android-commercial" aria-labelledby="android-commercial-title">
      <span className="admin-kicker">CATALOG MAINTENANCE</span>
      <h2 id="android-commercial-title">Apply Android commercial defaults</h2>
      <p>
        Sets <strong>{PTA_LABEL}</strong> and <strong>{CONDITION_LABEL}</strong> on every variant of the imported Android batch (exact title list, never by brand or
        category alone). Prices, stock, SKUs, RAM/storage/colour, images, titles and publication are never changed.
      </p>
      <div className={`bulk-images-env ${production ? "production" : "development"}`} role="status">
        <span>Environment</span>
        <strong>{target.environment ? target.environment.toUpperCase() : "UNKNOWN"}</strong>
        <small>{target.projectRef ?? "Writes blocked"}</small>
      </div>
      {!target.allowed && <p className="bulk-images-error">{target.reason}</p>}
      <div className="bulk-images-bulk">
        <button type="button" className="admin-secondary" disabled={busy || running} onClick={() => void runPreview()}>
          {busy ? "Reading…" : "Preview (read-only)"}
        </button>
      </div>
      {error && (
        <p className="bulk-images-error" role="alert">
          {error}
        </p>
      )}
      {preview && totals && plan && (
        <div className="bulk-images-devreport" aria-label="Commercial defaults preview">
          <strong>Preview — no changes made</strong>
          <p>
            Target products {totals.products} · variants {totals.variants} · PTA Unknown {totals.unknownPta} · Condition Unknown {totals.unknownCondition}
          </p>
          <p>
            Will change: {totals.variantsToChange} variant(s) in {totals.productsToChange} product(s) · product defaults to set: {totals.productDefaultsToChange} · already correct:{" "}
            {totals.variantsAlreadyCorrect} variant(s) / {totals.productsAlreadyCorrect} product(s) · skipped: {totals.productsSkipped}
          </p>
          {preview.selection.missingTitles.length > 0 && <p>Batch titles not found in this environment: {preview.selection.missingTitles.length} (not touched).</p>}
          {plan.products.some((entry) => entry.status === "skipped") && (
            <ul>
              {plan.products
                .filter((entry) => entry.status === "skipped")
                .slice(0, 12)
                .map((entry) => (
                  <li key={entry.productId}>
                    Skipped {entry.title}: {entry.reason}
                  </li>
                ))}
            </ul>
          )}
          <button type="button" className="admin-primary" disabled={!canApply} onClick={() => { setTyped(""); setConfirming(true); }}>
            Apply Android commercial defaults
          </button>
        </div>
      )}
      {running && (
        <p className="bulk-images-note" role="status">
          Applying… {progress}
        </p>
      )}
      {result && (
        <div className={`bulk-images-devreport ${result.outcome === "verified" ? "verified" : "failed"}`} role={result.outcome === "verified" ? "status" : "alert"} aria-label="Commercial defaults result">
          <strong>{result.outcome === "verified" ? "Commercial defaults verified" : "Finished with issues"}</strong>
          <p>{result.message}</p>
          <p>
            Products updated {result.summary.productsUpdated} · variants updated {result.summary.variantsUpdated} · already correct {result.summary.alreadyCorrect} · skipped {result.summary.skipped} ·
            failed {result.summary.failed}
          </p>
          {result.products.filter((product) => product.status === "failed").map((product) => (
            <p key={product.productId}>
              <strong>{product.title}</strong>: {product.message}
            </p>
          ))}
        </div>
      )}
      {validation && (
        <div className="bulk-images-devreport" aria-label="Publication validation (read-only)">
          <strong>
            <ShieldCheck /> Publication check (read-only, nothing published)
          </strong>
          <p>
            Checked {validation.checked} · fully ready {validation.ready} · still “variant_commercial_facts_unresolved”: {validation.unresolved}
          </p>
          {Object.keys(validation.blockers).length > 0 && (
            <ul>
              {Object.entries(validation.blockers).map(([code, count]) => (
                <li key={code}>
                  {code}: {count}
                </li>
              ))}
            </ul>
          )}
          {validation.sampleA07 && <p>Samsung A07: {validation.sampleA07}</p>}
        </div>
      )}
      {confirming && plan && totals && (
        <div className="bulk-images-dialog-backdrop">
          <div className={`bulk-images-dialog${production ? " production" : ""}`} role="dialog" aria-modal="true" aria-labelledby="android-commercial-confirm">
            {production && <div className="bulk-images-prod-banner">PRODUCTION</div>}
            <h3 id="android-commercial-confirm">Apply to {totals.variantsToChange} variants?</h3>
            <dl>
              <div><dt>Environment</dt><dd><strong>{target.environment?.toUpperCase()}</strong> <code>{target.projectRef}</code></dd></div>
              <div><dt>Target products</dt><dd>{totals.products} ({totals.productsToChange} to change)</dd></div>
              <div><dt>Target variants</dt><dd>{totals.variants} ({totals.variantsToChange} to change)</dd></div>
              <div><dt>PTA</dt><dd>{PTA_LABEL}</dd></div>
              <div><dt>Condition</dt><dd>{CONDITION_LABEL}</dd></div>
            </dl>
            <p className="bulk-images-error">{production ? "This will write production catalog data (PTA and Condition only)." : "This will write PTA and Condition on DEV variants."}</p>
            {production && (
              <label className="bulk-images-typed">
                Type {PRODUCTION_CONFIRMATION_TEXT} to enable the update
                <input type="text" autoComplete="off" spellCheck={false} value={typed} onChange={(event) => setTyped(event.target.value)} />
              </label>
            )}
            <div className="bulk-images-dialog-actions">
              <button type="button" className="admin-secondary" onClick={() => setConfirming(false)}>
                Cancel
              </button>
              <button type="button" className="admin-primary" disabled={!confirmationSatisfied(target.environment, typed)} onClick={() => void apply()}>
                Confirm and apply
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
