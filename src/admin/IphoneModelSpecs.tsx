import { ChangeEvent, useEffect, useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, Download, Upload, XCircle } from "lucide-react";
import { supabase, supabaseEnvironmentLabel } from "../lib/supabase";
import type { ExistingSpec } from "../lib/specificationApply";
import {
  approvedSheetRows,
  groupPhoneModels,
  modelSpecBlocker,
  modelSpecCorrectionsPayload,
  modelSpecsFromCsv,
  modelSpecsFromXlsx,
  modelSpecTemplateCsv,
  planModelSpecs,
  type IphoneCatalogProduct,
} from "../lib/iphoneModelSpecs";
import { ModelSpecSaveError, applyIphoneModelSpecs, loadApprovedModelSpecs, loadIphoneCatalog, loadIphoneSpecs, type ApprovedModelSpec, type ModelSpecApplyResult } from "../lib/iphoneModelSpecsDb";

const CONDITION: Record<string, string> = { brand_new: "New", used: "Used" };
const PTA: Record<string, string> = { approved: "PTA Approved", not_approved: "Non-PTA", not_applicable: "—", unknown: "PTA unknown" };
const list = (values: string[], names: Record<string, string>) => values.map((value) => names[value] ?? value).join(" / ") || "—";

function download(name: string, data: BlobPart, type: string) {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

type SheetFile = { fileName: string; specs: ReturnType<typeof modelSpecsFromCsv>["specs"]; fileErrors: string[] } | null;

/**
 * Model Specifications (iPhone + Android). Owner decision 2026-11-21: the Owner gives the specification file to ChatGPT,
 * which verifies it against official sources; that FINAL VERIFIED SHEET is already approved. Here: choose the exact phone
 * model, upload the sheet (reading it never writes), check the preview, click Apply. No per-spec tick or typed phrase.
 * Only rows clearly verified are applied (a Status column, when present, must say Verified; blank / "TBD" / "?" values and
 * variant facts are skipped). Each product receives only what it is missing; stored values are never overwritten, except
 * products still showing the model's old approved value when the sheet corrects it. Products of the model added later
 * receive the approved list automatically. Owner only (server-side).
 */
export function IphoneModelSpecs() {
  const [catalog, setCatalog] = useState<IphoneCatalogProduct[]>([]);
  const [existing, setExisting] = useState<ExistingSpec[]>([]);
  const [approved, setApproved] = useState<ApprovedModelSpec[] | null>(null);
  const [loadError, setLoadError] = useState("");
  const [loading, setLoading] = useState(true);
  const [modelKey, setModelKey] = useState("");
  const [sheet, setSheet] = useState<SheetFile>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [result, setResult] = useState<ModelSpecApplyResult | null>(null);

  async function load() {
    if (!supabase) return;
    setLoading(true);
    try {
      const products = await loadIphoneCatalog(supabase);
      setCatalog(products);
      setExisting(await loadIphoneSpecs(supabase, products.map((product) => product.id)));
      setApproved(await loadApprovedModelSpecs(supabase));
      setLoadError("");
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "Could not load phone products.");
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    void load();
  }, []);

  const { models, ambiguous } = useMemo(() => groupPhoneModels(catalog), [catalog]);
  const model = models.find((entry) => entry.key === modelKey) ?? null;
  const specCount = (productId: string) => existing.filter((spec) => spec.product_id === productId).length;
  // The final verified sheet: verified rows are applied, unverified / ambiguous rows skipped (never written).
  const rows = useMemo(() => (sheet && !sheet.fileErrors.length ? approvedSheetRows(sheet.specs) : null), [sheet]);
  const specs = rows?.apply ?? null;
  const approvedForModel = useMemo(() => (model && approved ? approved.filter((row) => row.model_key === model.key) : []), [model, approved]);
  const plan = useMemo(
    () => (model && rows ? planModelSpecs(model, rows.apply, existing, approvedForModel) : null),
    [model, rows, existing, approvedForModel],
  );
  const blocker = modelSpecBlocker(plan);

  function downloadApproved() {
    if (!model) return;
    const cell = (text: string) => (/[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text);
    const rows = approvedForModel.map((row) => [row.specification_group, row.label, row.value].map(cell).join(","));
    download(`${model.key}-approved-specifications.csv`, `${modelSpecTemplateCsv()}${rows.join("\r\n")}\r\n`, "text/csv");
  }

  function chooseModel(key: string) {
    setModelKey(key);
    setSheet(null);
    setResult(null);
    setMessage("");
  }

  // Reading the file only fills the preview: nothing is written until the Owner clicks Apply.
  async function chooseFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    const parsed = /\.xlsx$/i.test(file.name) ? await modelSpecsFromXlsx(await file.arrayBuffer()) : modelSpecsFromCsv(await file.text());
    setSheet({ fileName: file.name, specs: parsed.specs, fileErrors: parsed.fileErrors });
    setResult(null);
    setMessage("");
  }

  async function save() {
    if (!supabase || !plan || !specs || blocker || busy) return;
    const summary =
      `Apply the final verified sheet to ${plan.model.name} on ${supabaseEnvironmentLabel}?\n\n` +
      `${plan.totals.specs} approved specifications · ${plan.totals.add} to add to ${plan.totals.affected} product(s)` +
      `${plan.totals.corrections ? ` · ${plan.totals.corrections} approved value(s) corrected` : ""}` +
      `${plan.totals.conflicts ? ` · ${plan.totals.conflicts} conflict(s) kept as stored` : ""}` +
      `${rows?.skipped.length ? ` · ${rows.skipped.length} unverified row(s) skipped` : ""}.\n\nProducts of this model added later receive the approved list automatically.`;
    if (!window.confirm(summary)) return;
    setBusy(true);
    setMessage("");
    try {
      const saved = await applyIphoneModelSpecs(supabase, plan.model.key, plan.model.products.map((product) => product.id), specs, modelSpecCorrectionsPayload(plan));
      setResult(saved);
      setMessage(
        `Saved: ${saved.inserted} specifications added to existing products; ${saved.approved.added} newly approved for future products of this model` +
          `${saved.approved.corrected ? `; ${saved.approved.corrected} approved value${saved.approved.corrected === 1 ? "" : "s"} corrected (${saved.corrected} product value${saved.corrected === 1 ? "" : "s"} that still showed the old approved value updated)` : ""}` +
          `${saved.approved.kept ? ` (${saved.approved.kept} earlier approved value${saved.approved.kept === 1 ? "" : "s"} kept)` : ""}. Other stored values were not changed.`,
      );
      await load();
    } catch (error) {
      setMessage(error instanceof ModelSpecSaveError || error instanceof Error ? error.message : "Save failed. Nothing was saved.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="iphone-model-specs">
      <div className="admin-heading compact">
        <div>
          <span className="admin-kicker">SPECIFICATIONS · IPHONE + ANDROID MODELS · OWNER ONLY</span>
          <h1>Model Specifications</h1>
          <p>
            Same phone model = same common specifications. Upload the model’s <strong>final verified sheet</strong> (checked
            against official sources by ChatGPT — that sheet is the approval); after you click Apply, every product of that
            exact model receives the specifications — New and Used, PTA Approved and Non-PTA, with or without the brand, PTA or
            storage in the title — and products of that model added later receive them automatically. Each product only gets
            what it is missing; stored values are never overwritten. Unverified or unclear rows and variant facts (storage, RAM,
            colour, price, PTA, condition, warranty, battery, grade, SIM) are never applied.
          </p>
        </div>
      </div>

      {loading && <p className="admin-inline-message">Loading phone products…</p>}
      {loadError && <p className="admin-inline-message" role="alert">{loadError}</p>}

      {!loading && !loadError && (
        <>
          <section className="admin-panel model-spec-step">
            <h2>1. Choose the phone model</h2>
            {models.length ? (
              <label className="model-spec-field">
                Model
                <select value={modelKey} onChange={(event) => chooseModel(event.target.value)}>
                  <option value="">Select a model…</option>
                  {(["iphone", "android"] as const).map((kind) => (
                    <optgroup key={kind} label={kind === "iphone" ? "iPhone" : "Android"}>
                      {models.filter((entry) => entry.kind === kind).map((entry) => (
                        <option key={entry.key} value={entry.key}>
                          {entry.name} — {entry.products.length} product{entry.products.length === 1 ? "" : "s"}
                          {approved?.some((row) => row.model_key === entry.key) ? " · approved specs saved" : ""}
                        </option>
                      ))}
                    </optgroup>
                  ))}
                </select>
              </label>
            ) : (
              <p>No phone products were found in Mobile Phones.</p>
            )}
            {ambiguous.length > 0 && (
              <details className="model-spec-ambiguous">
                <summary>
                  <AlertTriangle /> {ambiguous.length} phone title{ambiguous.length === 1 ? " is" : "s are"} not an exact model and never receive{ambiguous.length === 1 ? "s" : ""} shared specifications
                </summary>
                <ul>{ambiguous.map((product) => <li key={product.id}>{product.title}</li>)}</ul>
              </details>
            )}
          </section>

          {model && (
            <section className="admin-panel model-spec-step">
              <h2>2. Upload the final verified sheet of {model.name}</h2>
              <p className="model-spec-hint">
                {approved === null
                  ? "Approved specifications cannot be read on this database yet (migration 202611200002 not applied)."
                  : approvedForModel.length
                    ? `${approvedForModel.length} approved specification${approvedForModel.length === 1 ? " is" : "s are"} saved for this model; products of this model added later receive ${approvedForModel.length === 1 ? "it" : "them"} automatically.`
                    : "No approved specifications for this model yet. Specifications already on a product are never shared; only the final verified sheet is."}
              </p>
              <div className="model-spec-file">
                <label className="admin-secondary">
                  <Upload /> {sheet?.fileName || "Choose final verified sheet (.csv / .xlsx)"}
                  <input hidden type="file" accept=".csv,.xlsx" onChange={(event) => void chooseFile(event)} />
                </label>
                <button type="button" className="admin-secondary" onClick={() => download("model-specifications-template.csv", modelSpecTemplateCsv(), "text/csv")}>
                  <Download /> Template (CSV)
                </button>
                {approvedForModel.length > 0 && (
                  <button type="button" className="admin-secondary" onClick={downloadApproved}>
                    <Download /> Approved specifications (CSV)
                  </button>
                )}
              </div>
              <small className="model-spec-hint">
                Columns Section, Label, Value (+ optional Status: only rows marked Verified are applied). Choosing a file only
                shows the preview — nothing is saved until you click Apply.
              </small>
              {sheet?.fileErrors.map((error) => <p className="model-spec-error" key={error}>{error}</p>)}
            </section>
          )}

          {plan && (
            <section className="admin-panel model-spec-step">
              <h2>3. Preview — nothing is saved yet</h2>
              <div className="model-spec-totals">
                <div><strong>{plan.totals.products}</strong><span>matching products</span></div>
                <div><strong>{plan.totals.affected}</strong><span>will receive specifications</span></div>
                <div><strong>{plan.totals.add}</strong><span>specifications to add</span></div>
                <div><strong>{plan.totals.present}</strong><span>already present</span></div>
                <div className={plan.totals.conflicts ? "is-warning" : ""}><strong>{plan.totals.conflicts}</strong><span>conflicts kept as stored</span></div>
                {plan.approvedChanges.length > 0 && (
                  <div className="is-warning"><strong>{plan.totals.corrections}</strong><span>approved values corrected by the sheet</span></div>
                )}
                {rows && rows.skipped.length > 0 && (
                  <div className="is-warning"><strong>{rows.skipped.length}</strong><span>unverified rows skipped</span></div>
                )}
              </div>
              {plan.approvedChanges.length > 0 && (
                <div className="model-spec-approved-changes">
                  <p>
                    <AlertTriangle /> The final verified sheet differs from the model’s saved approved values. The sheet wins: the
                    approved value is corrected (future products get the new one) and only products still showing the old approved
                    value are updated; products with any other value keep it.
                  </p>
                  <ul>
                    {plan.approvedChanges.map((change) => (
                      <li key={change.label}>
                        <strong>{change.label}</strong>: approved “{change.oldValue}” → “{change.newValue}” ({change.followers} product
                        {change.followers === 1 ? " still shows" : "s still show"} the old approved value)
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {rows && rows.skipped.length > 0 && (
                <details className="model-spec-ambiguous" open>
                  <summary>
                    <AlertTriangle /> {rows.skipped.length} row{rows.skipped.length === 1 ? "" : "s"} not applied (unverified or unclear)
                  </summary>
                  <ul>{rows.skipped.map((row) => <li key={row.rowNumber}>Row {row.rowNumber} · {row.label}: {row.reason}</li>)}</ul>
                </details>
              )}
              {plan.specProblems.length > 0 && (
                <ul className="model-spec-problems">
                  {plan.specProblems.map((problem) => <li key={`${problem.rowNumber}-${problem.message}`}><XCircle /> Row {problem.rowNumber} · {problem.label}: {problem.message}</li>)}
                </ul>
              )}
              <div className="model-spec-table" role="table" aria-label="Matching products">
                <div role="row" className="is-head">
                  <span role="columnheader">Product (exact title)</span>
                  <span role="columnheader">Condition</span>
                  <span role="columnheader">PTA</span>
                  <span role="columnheader">Status</span>
                  <span role="columnheader">Add</span>
                  <span role="columnheader">Present</span>
                  <span role="columnheader">Conflicts</span>
                </div>
                {plan.products.map((entry) => (
                  <div role="row" key={entry.product.id}>
                    <span role="cell"><strong>{entry.product.title}</strong><small>{entry.product.slug} · {entry.product.variantCount} variants · {specCount(entry.product.id)} specs stored</small></span>
                    <span role="cell">{list(entry.product.conditions, CONDITION)}</span>
                    <span role="cell">{list(entry.product.ptaStatuses, PTA)}</span>
                    <span role="cell">{entry.product.publicationStatus}</span>
                    <span role="cell" className={entry.add ? "is-add" : ""}>{entry.add}</span>
                    <span role="cell">{entry.present}</span>
                    <span role="cell" className={entry.conflicts ? "is-warning" : ""}>{entry.conflicts}</span>
                    {entry.conflicts + entry.correct > 0 && (
                      <details className="model-spec-conflicts" open={entry.correct > 0}>
                        <summary>
                          {entry.conflicts > 0 && `Show ${entry.conflicts} conflict${entry.conflicts === 1 ? "" : "s"} (kept as stored)`}
                          {entry.conflicts > 0 && entry.correct > 0 && " · "}
                          {entry.correct > 0 && `${entry.correct} value${entry.correct === 1 ? "" : "s"} will follow the correction`}
                        </summary>
                        <ul>
                          {entry.rows.filter((row) => row.category === "Conflict" || row.category === "Correct").map((row) => (
                            <li key={row.rowNumber}>
                              {row.label}: stored “{row.existing?.value}” —{" "}
                              {row.category === "Correct" ? <>will become “{row.value}” (it was the old approved value)</> : <>shared value “{row.value}” not applied</>}
                            </li>
                          ))}
                        </ul>
                      </details>
                    )}
                  </div>
                ))}
              </div>
            </section>
          )}

          {plan && (
            <section className="admin-panel model-spec-step">
              <h2>4. Apply</h2>
              <p>
                Connected database: <strong>{supabaseEnvironmentLabel}</strong>. The final verified sheet is already approved —
                no tick or typed phrase. Apply saves its {plan.totals.specs} verified specifications as the common specifications
                of {plan.model.name}, adds the missing ones to the {plan.totals.affected} product{plan.totals.affected === 1 ? "" : "s"} above
                {plan.totals.corrections ? `, applies ${plan.totals.corrections} correction${plan.totals.corrections === 1 ? "" : "s"}` : ""}, and gives
                them automatically to products of this model added later — in one step (all or nothing). The server checks the
                Owner account and the exact model again before saving.
              </p>
              <button type="button" className="admin-primary" onClick={() => void save()} disabled={Boolean(blocker) || busy}>
                <CheckCircle2 /> Apply approved sheet to {plan.totals.products} product{plan.totals.products === 1 ? "" : "s"}
              </button>
              {blocker && <p className="model-spec-hint">{blocker}</p>}
              {message && <p className="admin-inline-message" role="status">{message}</p>}
              {result && (
                <ul className="model-spec-result">
                  {result.products.map((entry) => (
                    <li key={entry.product_id}>
                      {catalog.find((product) => product.id === entry.product_id)?.title ?? entry.product_id}: +{entry.inserted} added · {entry.present} present · {entry.conflicts} kept
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )}
        </>
      )}
    </section>
  );
}
