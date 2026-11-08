import { useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, Download, MinusCircle, Upload, XCircle } from "lucide-react";
import { supabase, supabaseEnvironmentLabel } from "../lib/supabase";
import { commercialWriteTarget } from "../lib/commercialDefaults";
import { descriptionUploadDbDeps, loadDescriptionCatalog } from "../lib/descriptionBulkUploadDb";
import {
  DESC_ROW_CATEGORIES,
  descriptionConfirmationPhrase,
  descriptionNeedsTypedConfirmation,
  descriptionRowsFromCsv,
  descriptionRowsFromXlsx,
  descriptionTemplateCsv,
  descriptionTemplateXlsx,
  planDescriptionUpload,
  runDescriptionUpload,
  selectDescriptionWrites,
  type DescRowCategory,
  type DescUploadPlan,
  type DescUploadResult,
} from "../lib/descriptionBulkUpload";

const BUILD_MODE: string = import.meta.env.MODE;
const target = commercialWriteTarget(import.meta.env.VITE_SUPABASE_URL, BUILD_MODE);
const typedConfirmation = descriptionNeedsTypedConfirmation(target.environment);
const tone: Record<DescRowCategory, string> = { "New Description": "ready", Replace: "blocked", Unchanged: "muted", "Product Not Found": "warning", "Invalid Row": "warning" };

function download(name: string, data: BlobPart, type: string) {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const preview = (text: string | null | undefined, length = 220) => {
  const flat = (text ?? "").replace(/\s+/g, " ").trim();
  return flat.length > length ? `${flat.slice(0, length)}…` : flat || "—";
};

/**
 * Descriptions Bulk Upload: Download Template → Fill Excel → Upload → Save Descriptions. The check after upload is read-only.
 * Saving changes only Product content (and Short description when given); a stored description is replaced only when the
 * Owner ticks Replace. Publication status, prices, stock, variants, images and specifications are never written and are
 * compared before and after each product. PRODUCTION also needs the typed phrase.
 */
export function DescriptionBulkUpload() {
  const [fileName, setFileName] = useState("");
  const [plan, setPlan] = useState<DescUploadPlan | null>(null);
  const [fileErrors, setFileErrors] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState<DescRowCategory | "All">("All");
  const [replace, setReplace] = useState<Set<number>>(new Set());
  const [typed, setTyped] = useState("");
  const [result, setResult] = useState<DescUploadResult | null>(null);
  const [progress, setProgress] = useState("");
  const running = useRef(false);

  const reset = () => {
    setPlan(null);
    setReplace(new Set());
    setTyped("");
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
      const parsed = /\.xlsx$/i.test(file.name)
        ? await descriptionRowsFromXlsx(await file.arrayBuffer())
        : /\.csv$/i.test(file.name)
          ? descriptionRowsFromCsv(await file.text())
          : { rows: [], fileErrors: ["Upload a .csv or .xlsx file."] };
      if (parsed.fileErrors.length) {
        setFileErrors(parsed.fileErrors);
        return;
      }
      setPlan(planDescriptionUpload(parsed.rows, await loadDescriptionCatalog(supabase)));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  };

  const writes = plan ? selectDescriptionWrites(plan, replace) : [];
  const phrase = descriptionConfirmationPhrase(writes.length);
  const applyBlocker = !target.allowed
    ? target.reason ?? "Blocked: unknown environment."
    : !plan
      ? "Upload a file first."
      : result
        ? "Saved. Upload the file again to see the new state."
        : writes.length === 0
          ? "Nothing to save."
          : typedConfirmation && typed !== phrase
            ? `Type ${phrase} to confirm saving to PRODUCTION.`
            : null;

  const apply = async () => {
    if (!plan || !supabase || applyBlocker || running.current) return;
    running.current = true;
    setBusy(true);
    try {
      const outcome = await runDescriptionUpload(plan, { replace, typed }, {
        supabaseUrl: import.meta.env.VITE_SUPABASE_URL,
        buildMode: BUILD_MODE,
        ...descriptionUploadDbDeps(supabase),
        onProgress: (done, total, current) => setProgress(current ? `Saving ${done + 1} of ${total}: ${current}` : ""),
      });
      setResult(outcome);
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
  const counts = result
    ? { verified: result.products.filter((p) => p.status === "verified").length, failed: result.products.filter((p) => p.status === "failed").length, skipped: result.products.filter((p) => p.status === "skipped").length }
    : null;

  return (
    <section className="spec-upload description-upload">
      <div className="admin-heading compact">
        <div>
          <span className="admin-kicker">CATALOG · DESCRIPTIONS BULK UPLOAD</span>
          <h1>Descriptions bulk upload</h1>
          <p>
            Upload an Excel or CSV file of product descriptions and save them in one go. Products are matched only by exact Product ID or Slug, and
            the Product Name must match. Only Product content (and Short description, when filled) is saved — published products stay published;
            prices, stock, variants, images and specifications are never changed and are checked after every save. A stored description is replaced
            only when you tick Replace. Connected to {supabaseEnvironmentLabel}.
          </p>
        </div>
      </div>

      <div className="spec-upload-step">
        <h3>1 · Download template</h3>
        <div className="spec-upload-actions">
          <button type="button" onClick={async () => download("descriptions-template.xlsx", await descriptionTemplateXlsx(), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")}>
            <Download /> Download XLSX template
          </button>
          <button type="button" onClick={() => download("descriptions-template.csv", descriptionTemplateCsv(), "text/csv;charset=utf-8")}>
            <Download /> Download CSV template
          </button>
        </div>
        <small>Columns: Product Name · Product Slug or Product ID · Product content · Short description (optional). Phase 2 files with a “Slug” and “Description …” column are read too.</small>
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
              {DESC_ROW_CATEGORIES.map((category) => (
                <div key={category} className="stock-card"><strong>{plan.counts[category]}</strong><span>{category}</span></div>
              ))}
            </div>
            <div className="specs-images-filters" role="group" aria-label="Filter rows">
              {(["All", ...DESC_ROW_CATEGORIES] as const).map((value) => (
                <button key={value} type="button" className={filter === value ? "active" : ""} aria-pressed={filter === value} onClick={() => setFilter(value)}>
                  {value} ({value === "All" ? plan.rows.length : plan.counts[value]})
                </button>
              ))}
            </div>
            <div className="specs-images-table-wrap">
              <table className="specs-images-table">
                <thead>
                  <tr><th>Row</th><th>Status</th><th>Product</th><th>New description</th><th>Stored now</th><th>Notes</th><th>Replace</th></tr>
                </thead>
                <tbody>
                  {visible.map((row) => (
                    <tr key={row.rowNumber}>
                      <td>{row.rowNumber}</td>
                      <td><span className={`specs-images-pill ${tone[row.category]}`}>{row.category}</span></td>
                      <td><strong>{row.product?.title ?? (row.productName || "—")}</strong><small>{row.productKey || "—"}{row.product ? ` · ${row.product.publication_status}` : ""}</small></td>
                      <td>{preview(row.content)}{row.shortDescription && <small>Short: {preview(row.shortDescription, 120)}</small>}</td>
                      <td>{row.product ? preview(row.product.content) : "—"}</td>
                      <td>{row.messages.map((message) => <small key={message}>{message}</small>)}</td>
                      <td>
                        {row.category === "Replace" ? (
                          <input
                            type="checkbox"
                            aria-label={`Replace row ${row.rowNumber}`}
                            checked={replace.has(row.rowNumber)}
                            onChange={(event) => {
                              const next = new Set(replace);
                              if (event.target.checked) next.add(row.rowNumber);
                              else next.delete(row.rowNumber);
                              setReplace(next);
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
          <h3>3 · Save descriptions</h3>
          <p className="stock-hint">
            Will save {writes.length} description(s). Unchanged, Product Not Found, Invalid Row and unticked Replace rows are not saved. Only Product
            content / Short description change; publication status, prices, stock, variants, images and specifications are read back after each product.
          </p>
          <div className="spec-upload-actions">
            {typedConfirmation && (
              <input type="text" value={typed} placeholder={phrase} onChange={(event) => setTyped(event.target.value)} disabled={busy || writes.length === 0 || Boolean(result)} aria-label="PRODUCTION confirmation" />
            )}
            <button type="button" className="admin-primary" disabled={Boolean(applyBlocker) || busy} onClick={() => void apply()}>
              Save Descriptions to {target.environment ? target.environment.toUpperCase() : "—"}
            </button>
          </div>
          {applyBlocker && <small>{applyBlocker}</small>}
          {progress && <p className="stock-hint">{progress}</p>}
          {result && (
            <div className="spec-upload-result">
              <p className={result.outcome === "verified" ? "" : "admin-error"}>
                {result.outcome === "verified" ? <CheckCircle2 /> : <AlertTriangle />} {result.message}
              </p>
              {counts && (
                <div className="stock-cards" aria-label="Save summary">
                  <div className="stock-card"><strong>{counts.verified}</strong><span>Saved &amp; verified</span></div>
                  <div className="stock-card"><strong>{counts.failed}</strong><span>Failed</span></div>
                  <div className="stock-card"><strong>{counts.skipped}</strong><span>Skipped</span></div>
                </div>
              )}
              {result.products.map((product) => (
                <details key={product.rowNumber}>
                  <summary>
                    {product.status === "verified" ? <CheckCircle2 /> : product.status === "skipped" ? <MinusCircle /> : <XCircle />} Row {product.rowNumber} · {product.title}: {product.message}
                  </summary>
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
