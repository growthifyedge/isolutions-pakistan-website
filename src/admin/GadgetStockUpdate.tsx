import { useEffect, useMemo, useState } from "react";
import { supabase, supabaseEnvironmentLabel } from "../lib/supabase";
import { loadExcelJs } from "../lib/catalogWorkbook";
import { formatMinor } from "../lib/stockListDelta";
import {
  GADGET_NEW_PRODUCT_STOCK,
  buildGadgetPlan,
  buildGadgetWorkbook,
  compareGadgetSheet,
  gadgetSheetFingerprint,
  gadgetTableFromWorksheet,
  parseGadgetList,
  readGadgetSheet,
  type GadgetComparison,
  type GadgetEntry,
  type GadgetSheetRow,
  type GadgetUnreadLine,
} from "../lib/gadgetStockUpdate";
import { gadgetUpdateBlocker, runGadgetUpdate, type GadgetUpdateResult } from "../lib/gadgetStockApply";
import { gadgetUpdateDbDeps, loadGadgetCatalog } from "../lib/gadgetStockUpdateDb";
import { installUnloadGuard } from "../lib/unloadGuard";

// Admin "Gadgets Stock Update": Paste List -> Generate Excel -> fill Description -> Upload Excel -> Check Changes -> Update Website.
// Generate Excel and Check Changes only read. Update Website writes gadget by gadget and only after a fresh check of exactly
// this sheet. Gadgets that need review are held, never written. Stock of existing gadgets is never changed.

/** Owner gate: ON (approved 2026-10-25). Which websites may write is decided by GADGET_WRITE_ENVIRONMENTS (DEV only). */
const GADGET_UPDATE_WEBSITE_ENABLED = true;

const BUILD_MODE: string = import.meta.env.MODE;
const SUPABASE_URL: string | undefined = import.meta.env.VITE_SUPABASE_URL;
const DRAFT_KEY = "isolutions.gadget-stock-update.list.v1";

const readDraft = () => {
  try {
    return window.localStorage.getItem(DRAFT_KEY) ?? "";
  } catch {
    return "";
  }
};

const STATUS_LABEL = { updated: "Updated", partial: "Created — description NOT saved", failed: "Not saved", unknown: "Check again", needs_check: "Saved — check again", held: "Held for review" } as const;

type SectionId = "new_product" | "price" | "description" | "review";

const SECTIONS: { id: SectionId; title: string; help: string; pick: (entry: GadgetEntry) => boolean }[] = [
  { id: "review", title: "Needs review", help: "Nothing is written for these. Fix the sheet or the product in Catalog, then upload again.", pick: (entry) => entry.kind === "review" },
  { id: "new_product", title: "New products", help: `Created as drafts (not on the storefront until you add Condition, PTA, Warranty and images, and publish). Stock starts at ${GADGET_NEW_PRODUCT_STOCK}.`, pick: (entry) => entry.kind === "new_product" },
  { id: "price", title: "Price updates", help: "Only the price changes. Stock stays exactly as it is.", pick: (entry) => entry.kind === "update" && Boolean(entry.priceChange) },
  { id: "description", title: "Description updates", help: "Your text from the sheet replaces the saved description. A blank description in the sheet keeps the saved one.", pick: (entry) => entry.kind === "update" && Boolean(entry.descriptionChange) },
];

const excerpt = (text: string | null) => (text ? (text.length > 160 ? `${text.slice(0, 160)}…` : text) : "—");

async function downloadExcel(bytes: ArrayBuffer, name: string) {
  const url = URL.createObjectURL(new Blob([bytes], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  URL.revokeObjectURL(url);
}

export function GadgetStockUpdate() {
  const [text, setText] = useState(readDraft);
  const [unread, setUnread] = useState<GadgetUnreadLine[]>([]);
  const [excelNote, setExcelNote] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [rows, setRows] = useState<GadgetSheetRow[] | null>(null);
  const [comparison, setComparison] = useState<GadgetComparison | null>(null);
  const [checkedFingerprint, setCheckedFingerprint] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [checking, setChecking] = useState(false);
  const [writing, setWriting] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [result, setResult] = useState<GadgetUpdateResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    try {
      window.localStorage.setItem(DRAFT_KEY, text);
    } catch {
      /* the list still works without saving */
    }
  }, [text]);
  useEffect(() => (writing ? installUnloadGuard(window) : undefined), [writing]);

  const fingerprint = rows ? gadgetSheetFingerprint(rows) : null;
  const checkIsCurrent = fingerprint !== null && checkedFingerprint === fingerprint;
  const plan = useMemo(() => (comparison ? buildGadgetPlan(comparison) : null), [comparison]);
  const blocker = gadgetUpdateBlocker({ supabaseUrl: SUPABASE_URL, buildMode: BUILD_MODE, enabled: GADGET_UPDATE_WEBSITE_ENABLED, checkIsCurrent, plan });

  async function generateExcel() {
    setError(null);
    setExcelNote(null);
    const parsed = parseGadgetList(text);
    setUnread(parsed.unread);
    if (!parsed.lines.length) {
      setError("No product with a price was found in the list.");
      return;
    }
    setBusy(true);
    try {
      const ExcelJS = await loadExcelJs();
      const workbook = buildGadgetWorkbook(ExcelJS, parsed.lines);
      await downloadExcel(await workbook.xlsx.writeBuffer(), `gadgets-stock-${new Date().toISOString().slice(0, 10)}.xlsx`);
      setExcelNote(`Excel generated: ${parsed.lines.length} product(s)${parsed.unread.length ? `, ${parsed.unread.length} line(s) not understood (not in the Excel)` : ""}. Nothing on the website was changed.`);
    } catch (problem) {
      setError(`The Excel could not be made: ${problem instanceof Error ? problem.message : String(problem)}`);
    } finally {
      setBusy(false);
    }
  }

  async function uploadExcel(file: File | undefined) {
    if (!file) return;
    setError(null);
    setResult(null);
    setComparison(null);
    setRows(null);
    setFileName(file.name);
    if (!file.name.toLowerCase().endsWith(".xlsx")) {
      setError("Upload the .xlsx file made by Generate Excel.");
      return;
    }
    setBusy(true);
    try {
      const ExcelJS = await loadExcelJs();
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(await file.arrayBuffer());
      const sheet = workbook.worksheets[0];
      if (!sheet) throw new Error("The workbook has no sheets.");
      const read = readGadgetSheet(gadgetTableFromWorksheet(sheet));
      if (!read.ok) setError(read.error);
      else setRows(read.rows);
    } catch (problem) {
      setError(`The Excel could not be read: ${problem instanceof Error ? problem.message : String(problem)}`);
    } finally {
      setBusy(false);
    }
  }

  async function check() {
    if (!rows) return;
    if (!supabase) {
      setError("The website connection is not configured.");
      return;
    }
    setBusy(true);
    setChecking(true);
    setError(null);
    setResult(null);
    try {
      const { catalog, slugOwners } = await loadGadgetCatalog(supabase);
      setComparison(compareGadgetSheet(rows, catalog, slugOwners));
      setCheckedFingerprint(gadgetSheetFingerprint(rows));
    } catch (problem) {
      setError(`Could not read the website: ${problem instanceof Error ? problem.message : String(problem)}`);
    } finally {
      setBusy(false);
      setChecking(false);
    }
  }

  async function update() {
    if (!supabase || !plan || blocker) return;
    if (!window.confirm(`Update the ${supabaseEnvironmentLabel.toUpperCase()} website now? ${plan.counts.newProducts} new draft(s), ${plan.counts.priceUpdates} price update(s), ${plan.counts.descriptionUpdates} description update(s). Held gadgets are not touched.`)) return;
    setWriting(true);
    setResult(null);
    try {
      const outcome = await runGadgetUpdate({ supabaseUrl: SUPABASE_URL, buildMode: BUILD_MODE, ...gadgetUpdateDbDeps(supabase) }, plan, (done, total, current) => setProgress(current ? `Updating ${done + 1} of ${total}: ${current}` : `Finished ${done} of ${total}`));
      setResult(outcome);
      setCheckedFingerprint(null);
    } finally {
      setWriting(false);
    }
  }

  function section(id: SectionId) {
    const spec = SECTIONS.find((item) => item.id === id);
    const list = comparison?.entries.filter((entry) => spec?.pick(entry)) ?? [];
    if (!spec || !list.length) return null;
    return (
      <div key={id} style={{ marginTop: 16 }}>
        <h4>{spec.title} ({list.length})</h4>
        <p className="stock-hint">{spec.help}</p>
        <div className="bulk-images-table">
          <table>
            <thead>
              <tr>
                <th>Product</th>
                <th>{id === "price" ? "Price now → new" : "Price"}</th>
                <th>{id === "description" ? "Description now → new" : id === "review" ? "What to do" : "Notes"}</th>
              </tr>
            </thead>
            <tbody>
              {list.map((entry) => (
                <tr key={entry.id}>
                  <td>
                    <strong>{entry.productTitle || "—"}</strong>
                    <small className="plain">Row {entry.row.rowNumber}{entry.sku ? <> · <code>{entry.sku}</code> · stock {entry.stock ?? 0}</> : null}</small>
                  </td>
                  <td>{id === "price" && entry.priceChange ? `${formatMinor(entry.priceChange.fromMinor)} → ${formatMinor(entry.priceChange.toMinor)}` : formatMinor(entry.row.priceMinor)}</td>
                  <td className="stock-resolve">
                    {id === "description" && entry.descriptionChange ? (
                      <>
                        <small className="plain">Now: {excerpt(entry.descriptionChange.from)}</small>
                        <small className="plain" style={{ whiteSpace: "pre-line" }}>New: {entry.descriptionChange.to}</small>
                      </>
                    ) : (
                      <>
                        {entry.reasons.map((reason) => (<small className="plain stock-held-note" key={reason}>{reason}</small>))}
                        {entry.notes.map((note) => (<small className="plain" key={note}>{note}</small>))}
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  const counts = comparison?.counts;

  return (
    <section className="admin-panel stock-update" aria-labelledby="gadget-stock-title">
      <span className="admin-kicker">CATALOG · GADGETS STOCK</span>
      <h2 id="gadget-stock-title">Gadgets Stock Update</h2>
      <p>Paste the gadgets list, make the Excel, write each description, upload it, check the changes, then update the website. Prices and descriptions are updated, stock is kept, and gadgets missing from the sheet are never touched.</p>
      <div className={`bulk-images-env ${supabaseEnvironmentLabel.toLowerCase() === "production" ? "production" : "development"}`} role="status">
        <span>Website</span>
        <strong>{supabaseEnvironmentLabel.toUpperCase()}</strong>
        <small>Generate Excel and Check Changes only read the website.</small>
      </div>

      <div className="stock-step" aria-labelledby="gadget-step-1">
        <h3 id="gadget-step-1"><span className="stock-step-number">1</span> Paste List</h3>
        <label className="stock-field">
          <span>Gadgets list — one product per line: name, then the price</span>
          <textarea value={text} rows={10} placeholder={"Apple AirPods Pro 2 @ 58,000\nAnker PowerCore 10000 - Rs 6,500\nSamsung 25W Charger @ 4,200"} onChange={(event) => setText(event.target.value)} />
        </label>
        <div className="bulk-images-bulk">
          <button type="button" className="admin-primary" disabled={busy || writing || !text.trim()} onClick={() => void generateExcel()}>Generate Excel</button>
        </div>
        <p className="stock-hint">The Excel has Product Name, Price and a blank Description column. Write each description in your own words, then upload the file below.</p>
        {excelNote && <p className="stock-hint" role="status">{excelNote}</p>}
        {unread.length > 0 && (
          <div style={{ marginTop: 12 }}>
            <h4>Lines not understood ({unread.length})</h4>
            <ul className="stock-excluded">
              {unread.map((line) => (<li key={line.lineNumber}>Line {line.lineNumber}: “{line.line}” — {line.reason}</li>))}
            </ul>
          </div>
        )}
      </div>

      <div className="stock-step" aria-labelledby="gadget-step-2">
        <h3 id="gadget-step-2"><span className="stock-step-number">2</span> Upload Excel</h3>
        <label className="stock-field">
          <span>Completed Gadgets Excel (.xlsx)</span>
          <input type="file" accept=".xlsx" disabled={busy || writing} onChange={(event) => { void uploadExcel(event.target.files?.[0]); event.target.value = ""; }} />
        </label>
        {rows && fileName && <p className="stock-hint" role="status">{fileName}: {rows.length} product row(s) read. Click Check Changes.</p>}
        <div className="bulk-images-bulk">
          <button type="button" className="admin-primary" disabled={busy || writing || !rows} onClick={() => void check()}>{checking ? "Checking…" : "Check Changes"}</button>
        </div>
        {error && <p className="bulk-images-error" role="alert">{error}</p>}
      </div>

      {comparison && counts && (
        <div className="stock-step" aria-labelledby="gadget-step-3">
          <h3 id="gadget-step-3"><span className="stock-step-number">3</span> Check Changes</h3>
          {!checkIsCurrent && <p className="stock-hint stock-warning">You uploaded a different sheet since this check. Click Check Changes again.</p>}
          <div className="stock-cards" aria-label="Summary">
            {([
              ["New products", counts.newProducts],
              ["Price updates", counts.priceUpdates],
              ["Description updates", counts.descriptionUpdates],
              ["Same (no change)", counts.same],
              ["Needs review", counts.review],
            ] as const).map(([label, value]) => (
              <div className="stock-card" key={label}>
                <strong>{value}</strong>
                <span>{label}</span>
              </div>
            ))}
          </div>
          {SECTIONS.map((item) => section(item.id))}
          {counts.same > 0 && <p className="stock-hint">{counts.same} product(s) are the same as the website and need no change.</p>}
        </div>
      )}

      {comparison && plan && (
        <div className="stock-step" aria-labelledby="gadget-step-4">
          <h3 id="gadget-step-4"><span className="stock-step-number">4</span> Update Website</h3>
          <p>{plan.counts.newProducts} new draft(s) · {plan.counts.priceUpdates} price update(s) · {plan.counts.descriptionUpdates} description update(s) — {plan.items.length} gadget(s). {plan.counts.held} held for review.</p>
          <p className="stock-hint">Nothing is hidden, deleted or published. Stock of existing gadgets is not changed. Gadgets that are not in this sheet are not touched.</p>
          <p className={`stock-hint${blocker ? " stock-warning" : ""}`} aria-live="polite">{blocker ?? "Ready. Each gadget is saved on its own."}</p>
          <div className="bulk-images-bulk">
            <button type="button" className="admin-primary" disabled={Boolean(blocker) || busy || writing} onClick={() => void update()}>{writing ? "Updating…" : "Update Website"}</button>
          </div>
          {progress && writing && <p className="stock-hint" aria-live="polite">{progress}</p>}
        </div>
      )}

      {result && (
        <div className="stock-step" aria-label="Update result">
          <h3>Result</h3>
          <p><strong>{result.message}</strong></p>
          <div className="bulk-images-table">
            <table>
              <thead><tr><th>Gadget</th><th>Result</th><th>Details</th></tr></thead>
              <tbody>
                {result.products.map((product) => (
                  <tr key={product.key}>
                    <td><strong>{product.productTitle}</strong>{product.newSkus.length > 0 && <small className="plain">New SKU: {product.newSkus.join(", ")}</small>}</td>
                    <td>{STATUS_LABEL[product.status]}</td>
                    <td>
                      {product.changes.map((change) => (<small className="plain" key={change}>{change}</small>))}
                      {product.reasons.map((reason) => (<small className="plain stock-held-note" key={reason}>{reason}</small>))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="stock-hint">Click Check Changes again to confirm: updated gadgets then show as Same.</p>
        </div>
      )}
    </section>
  );
}
