import { useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, Download, Upload, XCircle } from "lucide-react";
import { supabase, supabaseEnvironmentLabel } from "../lib/supabase";
import { commercialWriteTarget } from "../lib/commercialDefaults";
import { loadExistingSpecs, loadSpecificationCatalog, specificationApplyDbDeps } from "../lib/specificationApplyDb";
import { specificationUploadSaveDeps } from "../lib/specificationBulkUploadDb";
import type { CatalogSpecProduct } from "../lib/specificationApply";
import {
  ROW_CATEGORIES,
  planSpecificationUpload,
  rowsFromCsv,
  rowsFromXlsx,
  runSpecificationUpload,
  selectWrites,
  specUploadConfirmationPhrase,
  specUploadNeedsTypedConfirmation,
  specUploadTemplateCsv,
  specUploadTemplateXlsx,
  summarizeUpload,
  type RowCategory,
  type SpecUploadResult,
  type SpecUploadSummary,
  type UploadPlan,
} from "../lib/specificationBulkUpload";

const BUILD_MODE: string = import.meta.env.MODE;
const target = commercialWriteTarget(import.meta.env.VITE_SUPABASE_URL, BUILD_MODE);
const typedConfirmation = specUploadNeedsTypedConfirmation(target.environment);
const tone: Record<RowCategory, string> = { "New Spec": "ready", "Already Present": "muted", Conflict: "blocked", "Product Not Found": "warning", "Invalid Row": "warning" };
const SUMMARY_LABELS: (keyof SpecUploadSummary)[] = ["New", "Updated", "Already Present", "Skipped", "Failed"];

function download(name: string, data: BlobPart, type: string) {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * Specifications Bulk Upload: Download Template → Fill Excel → Upload → Save Specifications. The check after upload is
 * read-only. Saving adds new specifications and overwrites only the Conflict rows the Owner ticks; each product is
 * saved all or nothing. Nothing is ever deleted. PRODUCTION also needs the typed phrase.
 */
export function SpecificationBulkUpload() {
  const [fileName, setFileName] = useState("");
  const [plan, setPlan] = useState<UploadPlan | null>(null);
  const [catalog, setCatalog] = useState<CatalogSpecProduct[]>([]);
  const [fileErrors, setFileErrors] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState<RowCategory | "All">("All");
  const [overwrite, setOverwrite] = useState<Set<number>>(new Set());
  const [typed, setTyped] = useState("");
  const [result, setResult] = useState<SpecUploadResult | null>(null);
  const [summary, setSummary] = useState<SpecUploadSummary | null>(null);
  const [progress, setProgress] = useState("");
  const running = useRef(false);

  const reset = () => {
    setPlan(null);
    setOverwrite(new Set());
    setTyped("");
    setSummary(null);
    setResult(null);
    setError("");
    setFileErrors([]);
  };

  const onFile = async (file: File | undefined) => {
    if (!file || !supabase) return;
    reset();
    setFileName(file.name);
    setBusy(true);
    try {
      const parsed = /\.xlsx$/i.test(file.name) ? await rowsFromXlsx(await file.arrayBuffer()) : /\.csv$/i.test(file.name) ? rowsFromCsv(await file.text()) : { rows: [], fileErrors: ["Upload a .csv or .xlsx file."] };
      if (parsed.fileErrors.length) {
        setFileErrors(parsed.fileErrors);
        return;
      }
      const { catalog: products } = await loadSpecificationCatalog(supabase);
      const keys = new Set(parsed.rows.map((row) => row.productKey));
      const ids = products.filter((product) => keys.has(product.id) || keys.has(product.slug)).map((product) => product.id);
      const existing = await loadExistingSpecs(supabase, ids);
      setCatalog(products);
      setPlan(planSpecificationUpload(parsed.rows, products, existing));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  };

  const writes = plan ? selectWrites(plan, overwrite) : { creates: [], updates: [], total: 0 };
  const phrase = specUploadConfirmationPhrase(writes.total);
  const applyBlocker = !target.allowed
    ? target.reason ?? "Blocked: unknown environment."
    : !plan
      ? "Upload a file first."
      : result
        ? "Saved. Upload the file again to see the new state."
        : writes.total === 0
          ? "Nothing to save."
          : typedConfirmation && typed !== phrase
            ? `Type ${phrase} to confirm saving to PRODUCTION.`
            : null;

  const apply = async () => {
    if (!plan || !supabase || applyBlocker || running.current) return;
    running.current = true;
    setBusy(true);
    try {
      const { readSpecs, readProduct, readSnapshot } = specificationApplyDbDeps(supabase);
      const outcome = await runSpecificationUpload(plan, { overwrite, typed }, catalog, {
        supabaseUrl: import.meta.env.VITE_SUPABASE_URL,
        buildMode: BUILD_MODE,
        readSpecs,
        readProduct,
        readSnapshot,
        ...specificationUploadSaveDeps(supabase),
        onProgress: (done, total, current) => setProgress(current ? `Saving ${done + 1} of ${total}: ${current}` : ""),
      });
      setResult(outcome);
      if (outcome.products.length) setSummary(summarizeUpload(plan, overwrite, outcome));
      setTyped("");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      running.current = false;
      setBusy(false);
      setProgress("");
    }
  };

  const visible = plan ? (filter === "All" ? plan.rows : plan.rows.filter((row) => row.category === filter)) : [];

  return (
    <section className="spec-upload">
      <div className="admin-heading compact">
        <div>
          <span className="admin-kicker">CATALOG · SPECIFICATIONS BULK UPLOAD</span>
          <h1>Specifications bulk upload</h1>
          <p>
            Download the template, fill in specifications, upload it and save. Works for every category, New and Used. Products are matched
            only by exact Product ID or Slug, and the Product Name must match. New specifications are added; a stored value changes only when
            you tick Overwrite. Each product is saved all or nothing, and nothing is deleted. Connected to {supabaseEnvironmentLabel}.
          </p>
        </div>
      </div>

      <div className="spec-upload-step">
        <h3>1 · Download template</h3>
        <div className="spec-upload-actions">
          <button type="button" onClick={async () => download("specifications-template.xlsx", await specUploadTemplateXlsx(), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")}>
            <Download /> Download XLSX template
          </button>
          <button type="button" onClick={() => download("specifications-template.csv", specUploadTemplateCsv(), "text/csv;charset=utf-8")}>
            <Download /> Download CSV template
          </button>
        </div>
        <small>Columns: Product Name · Product Slug or Product ID · Section · Label · Value.</small>
      </div>

      <div className="spec-upload-step">
        <h3>2 · Upload filled file (checked, nothing saved yet)</h3>
        <label className="spec-upload-file">
          <Upload /> {fileName || "Choose a .xlsx or .csv file"}
          <input type="file" accept=".xlsx,.csv" disabled={busy} onChange={(event) => { void onFile(event.target.files?.[0]); event.target.value = ""; }} />
        </label>
        {busy && !progress && <p className="stock-hint">Reading…</p>}
        {fileErrors.map((message) => <p key={message} className="admin-error">{message}</p>)}
        {error && <p className="admin-error">{error}</p>}
        {plan && (
          <>
            <div className="stock-cards">
              <div className="stock-card"><strong>{plan.exactMatchProducts}</strong><span>Exact Match products</span></div>
              {ROW_CATEGORIES.map((category) => (
                <div key={category} className="stock-card"><strong>{plan.counts[category]}</strong><span>{category}</span></div>
              ))}
            </div>
            <div className="specs-images-filters" role="group" aria-label="Filter rows">
              {(["All", ...ROW_CATEGORIES] as const).map((value) => (
                <button key={value} type="button" className={filter === value ? "active" : ""} aria-pressed={filter === value} onClick={() => setFilter(value)}>
                  {value} ({value === "All" ? plan.rows.length : plan.counts[value]})
                </button>
              ))}
            </div>
            <div className="specs-images-table-wrap">
              <table className="specs-images-table">
                <thead>
                  <tr><th>Row</th><th>Status</th><th>Product</th><th>Section / Label</th><th>Value</th><th>Notes</th><th>Overwrite</th></tr>
                </thead>
                <tbody>
                  {visible.map((row) => (
                    <tr key={row.rowNumber}>
                      <td>{row.rowNumber}</td>
                      <td><span className={`specs-images-pill ${tone[row.category]}`}>{row.category}</span></td>
                      <td><strong>{row.productName || "—"}</strong><small>{row.productKey || "—"}</small></td>
                      <td><strong>{row.label || "—"}</strong><small>{row.section || "—"}</small></td>
                      <td>{row.value || "—"}</td>
                      <td>{row.messages.map((message) => <small key={message}>{message}</small>)}</td>
                      <td>
                        {row.category === "Conflict" && row.overwritable ? (
                          <input
                            type="checkbox"
                            aria-label={`Overwrite row ${row.rowNumber}`}
                            checked={overwrite.has(row.rowNumber)}
                            onChange={(event) => {
                              const next = new Set(overwrite);
                              if (event.target.checked) next.add(row.rowNumber);
                              else next.delete(row.rowNumber);
                              setOverwrite(next);
                              setTyped("");
                            }}
                          />
                        ) : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>

      {plan && (
        <div className="spec-upload-step">
          <h3>3 · Save specifications</h3>
          <p className="stock-hint">
            Will add {writes.creates.length} new specification(s)
            {writes.updates.length ? ` and overwrite ${writes.updates.length} ticked stored value(s)` : ""}. Already Present, Product Not Found, Invalid Row
            and unticked Conflict rows are not saved. Each product is saved all or nothing; products, variants, prices, stock, media and publication are
            not touched and are checked after.
          </p>
          <div className="spec-upload-actions">
            {typedConfirmation && (
              <input type="text" value={typed} placeholder={phrase} onChange={(event) => setTyped(event.target.value)} disabled={busy || writes.total === 0 || Boolean(result)} aria-label="PRODUCTION confirmation" />
            )}
            <button type="button" className="admin-primary" disabled={Boolean(applyBlocker) || busy} onClick={() => void apply()}>
              Save Specifications to {target.environment ? target.environment.toUpperCase() : "—"}
            </button>
          </div>
          {applyBlocker && <small>{applyBlocker}</small>}
          {progress && <p className="stock-hint">{progress}</p>}
          {result && (
            <div className="spec-upload-result">
              <p className={result.outcome === "verified" ? "" : "admin-error"}>
                {result.outcome === "verified" ? <CheckCircle2 /> : <AlertTriangle />} {result.message}
              </p>
              {summary && (
                <div className="stock-cards" aria-label="Save summary">
                  {SUMMARY_LABELS.map((label) => (
                    <div key={label} className="stock-card"><strong>{summary[label]}</strong><span>{label}</span></div>
                  ))}
                </div>
              )}
              {result.products.map((product) => (
                <details key={product.productId}>
                  <summary>{product.status === "verified" ? <CheckCircle2 /> : <XCircle />} {product.title}: {product.message}</summary>
                  <ul>{product.checks.map((check) => <li key={check.name}>{check.ok ? "✓" : "✗"} {check.name} — {check.detail}</li>)}</ul>
                </details>
              ))}
              <p className="stock-hint">Upload the file again to see the new state.</p>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
