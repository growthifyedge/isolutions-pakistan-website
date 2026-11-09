import { useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, Download, Upload } from "lucide-react";
import { supabase, supabaseEnvironmentLabel } from "../lib/supabase";
import { commercialWriteTarget } from "../lib/commercialDefaults";
import { loadSubcategoryCatalog, subcategoryUploadDbDeps } from "../lib/subcategoryAssignmentDb";
import {
  SUB_ROW_CATEGORIES,
  planSubcategoryUpload,
  runSubcategoryUpload,
  selectSubcategoryWrites,
  subcategoryConfirmationPhrase,
  subcategoryNeedsTypedConfirmation,
  subcategoryRowsFromCsv,
  subcategoryRowsFromXlsx,
  subcategoryTemplateCsv,
  subcategoryTemplateXlsx,
  type SubRowCategory,
  type SubUploadPlan,
  type SubUploadResult,
} from "../lib/subcategoryAssignment";

const BUILD_MODE: string = import.meta.env.MODE;
const target = commercialWriteTarget(import.meta.env.VITE_SUPABASE_URL, BUILD_MODE);
const typedConfirmation = subcategoryNeedsTypedConfirmation(target.environment);
const tone: Record<SubRowCategory, string> = {
  Assign: "ready",
  Change: "blocked",
  Unchanged: "muted",
  "SKU Not Found": "warning",
  "Missing Subcategory": "warning",
  "Unknown Subcategory": "warning",
  Duplicate: "warning",
  "Not Allowed": "warning",
};

function download(name: string, data: BlobPart, type: string) {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * Home Gadgets subcategories — bulk SKU → subcategory assignment: Download Template → Fill Excel → Upload (read-only
 * preview) → tick confirmation → Save. The save is one server call that re-checks every row and writes nothing unless all
 * rows are valid. Only the subcategory changes; names, prices, variants, stock, descriptions, images and publication
 * status are never written. PRODUCTION also needs the typed phrase.
 */
export function SubcategoryAssignment() {
  const [fileName, setFileName] = useState("");
  const [plan, setPlan] = useState<SubUploadPlan | null>(null);
  const [fileErrors, setFileErrors] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState<SubRowCategory | "All">("All");
  const [change, setChange] = useState<Set<number>>(new Set());
  const [confirmed, setConfirmed] = useState(false);
  const [typed, setTyped] = useState("");
  const [result, setResult] = useState<SubUploadResult | null>(null);
  const running = useRef(false);

  const reset = () => {
    setPlan(null);
    setChange(new Set());
    setConfirmed(false);
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
        ? await subcategoryRowsFromXlsx(await file.arrayBuffer())
        : /\.csv$/i.test(file.name)
          ? subcategoryRowsFromCsv(await file.text())
          : { rows: [], fileErrors: ["Upload a .csv or .xlsx file."] };
      if (parsed.fileErrors.length) {
        setFileErrors(parsed.fileErrors);
        return;
      }
      const { products, subcategories } = await loadSubcategoryCatalog(supabase);
      setPlan(planSubcategoryUpload(parsed.rows, products, subcategories));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  };

  const writes = plan ? selectSubcategoryWrites(plan, change) : [];
  const phrase = subcategoryConfirmationPhrase(writes.length);
  const applyBlocker = !target.allowed
    ? target.reason ?? "Blocked: unknown environment."
    : !plan
      ? "Upload a file first."
      : result
        ? "Saved. Upload the file again to see the new state."
        : writes.length === 0
          ? "Nothing to save."
          : !confirmed
            ? "Tick the confirmation first."
            : typedConfirmation && typed !== phrase
              ? `Type ${phrase} to confirm saving to PRODUCTION.`
              : null;

  const apply = async () => {
    if (!plan || !supabase || applyBlocker || running.current) return;
    running.current = true;
    setBusy(true);
    try {
      const outcome = await runSubcategoryUpload(plan, { change, confirmed, typed }, {
        supabaseUrl: import.meta.env.VITE_SUPABASE_URL,
        buildMode: BUILD_MODE,
        ...subcategoryUploadDbDeps(supabase),
      });
      setResult(outcome);
      setTyped("");
      setConfirmed(false);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      running.current = false;
      setBusy(false);
    }
  };

  const visible = plan ? (filter === "All" ? plan.rows : plan.rows.filter((row) => row.category === filter)) : [];

  return (
    <section className="spec-upload subcategory-upload">
      <div className="admin-heading compact">
        <div>
          <span className="admin-kicker">CATALOG · HOME GADGETS SUBCATEGORIES</span>
          <h1>Subcategory bulk assignment</h1>
          <p>
            Upload an Excel or CSV file of SKU → Home Gadgets subcategory. Products are matched only by exact SKU; only Gadgets products can be
            assigned, and the 16 Watches / Bands stay out of Home Gadgets. A blank or unknown subcategory is an error — nothing is guessed. Only the
            subcategory is saved: names, prices, variants, stock, descriptions, images and publication status never change. Connected to{" "}
            {supabaseEnvironmentLabel}.
          </p>
        </div>
      </div>

      <div className="spec-upload-step">
        <h3>1 · Download template</h3>
        <div className="spec-upload-actions">
          <button type="button" onClick={async () => download("subcategory-assignment-template.xlsx", await subcategoryTemplateXlsx(), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")}>
            <Download /> Download XLSX template
          </button>
          <button type="button" onClick={() => download("subcategory-assignment-template.csv", subcategoryTemplateCsv(), "text/csv;charset=utf-8")}>
            <Download /> Download CSV template
          </button>
        </div>
        <small>Columns: SKU · Subcategory (name or slug) · Product Name (optional check). The XLSX reads the “Assignments” sheet.</small>
      </div>

      <div className="spec-upload-step">
        <h3>2 · Upload filled file (checked, nothing saved yet)</h3>
        <label className="spec-upload-file">
          <Upload /> {fileName || "Choose a .xlsx or .csv file"}
          <input type="file" accept=".xlsx,.csv" disabled={busy} onChange={(event) => { void onFile(event.target.files?.[0]); event.target.value = ""; }} />
        </label>
        {busy && <p className="stock-hint">Working…</p>}
        {fileErrors.map((message) => <p key={message} className="admin-error">{message}</p>)}
        {error && <p className="admin-error">{error}</p>}
        {plan && (
          <>
            <div className="stock-cards">
              {SUB_ROW_CATEGORIES.map((category) => (
                <div key={category} className="stock-card"><strong>{plan.counts[category]}</strong><span>{category}</span></div>
              ))}
            </div>
            <div className="specs-images-filters" role="group" aria-label="Filter rows">
              {(["All", ...SUB_ROW_CATEGORIES] as const).map((value) => (
                <button key={value} type="button" className={filter === value ? "active" : ""} aria-pressed={filter === value} onClick={() => setFilter(value)}>
                  {value} ({value === "All" ? plan.rows.length : plan.counts[value]})
                </button>
              ))}
            </div>
            <div className="specs-images-table-wrap">
              <table className="specs-images-table">
                <thead>
                  <tr><th>Row</th><th>Status</th><th>SKU</th><th>Product</th><th>New subcategory</th><th>Stored now</th><th>Notes</th><th>Change</th></tr>
                </thead>
                <tbody>
                  {visible.map((row) => (
                    <tr key={row.rowNumber}>
                      <td>{row.rowNumber}</td>
                      <td><span className={`specs-images-pill ${tone[row.category]}`}>{row.category}</span></td>
                      <td>{row.sku || "—"}</td>
                      <td><strong>{row.product?.title ?? (row.productName || "—")}</strong>{row.product && <small>{row.product.publication_status}</small>}</td>
                      <td>{row.target?.name ?? (row.subcategory || "—")}</td>
                      <td>{row.current?.name ?? (row.product ? "None" : "—")}</td>
                      <td>{row.messages.map((message) => <small key={message}>{message}</small>)}</td>
                      <td>
                        {row.category === "Change" ? (
                          <input
                            type="checkbox"
                            aria-label={`Change row ${row.rowNumber}`}
                            checked={change.has(row.rowNumber)}
                            disabled={Boolean(result)}
                            onChange={(event) => {
                              const next = new Set(change);
                              if (event.target.checked) next.add(row.rowNumber);
                              else next.delete(row.rowNumber);
                              setChange(next);
                              setConfirmed(false);
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
          <h3>3 · Save subcategories</h3>
          <p className="stock-hint">
            Will save {writes.length} subcategory assignment(s). Unchanged, SKU Not Found, Missing / Unknown Subcategory, Duplicate, Not Allowed and
            unticked Change rows are not saved. The server checks every row again and saves nothing if any row fails.
          </p>
          <label className="subcategory-confirm" style={{ display: "flex", gap: 8, alignItems: "center", margin: "8px 0" }}>
            <input
              type="checkbox"
              checked={confirmed}
              disabled={busy || writes.length === 0 || Boolean(result)}
              onChange={(event) => setConfirmed(event.target.checked)}
            />
            I confirm saving {writes.length} subcategory assignment(s) to {target.environment ? target.environment.toUpperCase() : "—"}. Only the subcategory changes.
          </label>
          <div className="spec-upload-actions">
            {typedConfirmation && (
              <input type="text" value={typed} placeholder={phrase} onChange={(event) => setTyped(event.target.value)} disabled={busy || writes.length === 0 || Boolean(result)} aria-label="PRODUCTION confirmation" />
            )}
            <button type="button" className="admin-primary" disabled={Boolean(applyBlocker) || busy} onClick={() => void apply()}>
              Save Subcategories to {target.environment ? target.environment.toUpperCase() : "—"}
            </button>
          </div>
          {applyBlocker && <small>{applyBlocker}</small>}
          {result && (
            <div className="spec-upload-result">
              <p className={result.outcome === "verified" ? "" : "admin-error"}>
                {result.outcome === "verified" ? <CheckCircle2 /> : <AlertTriangle />} {result.message}
              </p>
              {result.problems.length > 0 && <ul>{result.problems.map((problem) => <li key={problem}>{problem}</li>)}</ul>}
              <p className="stock-hint">Upload the file again to see the new state.</p>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
