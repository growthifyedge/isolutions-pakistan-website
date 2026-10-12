import { useMemo, useState } from "react";
import { supabase, supabaseEnvironmentLabel } from "../lib/supabase";
import { csvRows } from "../lib/bulkCatalog";
import { loadExcelJs } from "../lib/catalogWorkbook";
import {
  CATEGORY_LABEL,
  buildApplyPlan,
  buildStockDelta,
  defaultSelection,
  formatDiff,
  formatMinor,
  isSelectable,
  parseStockList,
  tableToStockText,
  type DeltaEntry,
  type ParsedStockList,
  type StockDelta,
} from "../lib/stockListDelta";
import { loadActiveBrands, loadCatalogForDelta } from "../lib/stockListDeltaDb";

// Admin "Stock List Update": parse -> compare -> delta preview -> selection -> apply PLAN.
// This phase performs NO database write; "Apply Selected Changes" is intentionally disabled.

type TabId = "price_change" | "new_variant" | "new_product" | "missing" | "ambiguous" | "blocked" | "unchanged";

const TABS: Array<{ id: TabId; label: string }> = [
  { id: "price_change", label: "Price Changes" },
  { id: "new_variant", label: "New Variants" },
  { id: "new_product", label: "New Products" },
  { id: "missing", label: "Missing" },
  { id: "ambiguous", label: "Ambiguous" },
  { id: "blocked", label: "Blocked" },
  { id: "unchanged", label: "Unchanged" },
];

async function readTable(file: File): Promise<string[][]> {
  const lower = file.name.toLowerCase();
  if (lower.endsWith(".xlsx")) {
    const ExcelJS = await loadExcelJs();
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(await file.arrayBuffer());
    const sheet = workbook.worksheets[0];
    if (!sheet) throw new Error("The workbook has no sheets.");
    const rows: string[][] = [];
    sheet.eachRow({ includeEmpty: false }, (row) => {
      const cells: string[] = [];
      row.eachCell({ includeEmpty: true }, (cell, column) => {
        cells[column - 1] = cell.text ?? "";
      });
      rows.push(Array.from(cells, (cell) => cell ?? ""));
    });
    return rows;
  }
  const text = (await file.text()).replace(/^\uFEFF/, "");
  return lower.endsWith(".csv") ? csvRows(text) : text.split(/\r?\n/).map((line) => [line]);
}

export function StockListUpdate() {
  const [text, setText] = useState("");
  const [fileName, setFileName] = useState("");
  const [parsed, setParsed] = useState<ParsedStockList | null>(null);
  const [delta, setDelta] = useState<StockDelta | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [tab, setTab] = useState<TabId>("price_change");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const plan = useMemo(() => (delta ? buildApplyPlan(delta, selected) : null), [delta, selected]);

  async function onFile(file: File | undefined) {
    if (!file) return;
    setError("");
    try {
      const table = await readTable(file);
      setText(file.name.toLowerCase().endsWith(".txt") ? table.map((row) => row.join(" ")).join("\n") : tableToStockText(table));
      setFileName(file.name);
      setParsed(null);
      setDelta(null);
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : "The file could not be read.");
    }
  }

  async function runParse() {
    if (!supabase) return setError("Supabase is not configured.");
    setBusy(true);
    setError("");
    try {
      const brands = await loadActiveBrands(supabase);
      setParsed(parseStockList(text, brands));
      setDelta(null);
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : "Parsing failed.");
    } finally {
      setBusy(false);
    }
  }

  async function runCompare() {
    if (!supabase || !parsed) return;
    setBusy(true);
    setError("");
    try {
      const catalog = await loadCatalogForDelta(supabase);
      const next = buildStockDelta(parsed, catalog);
      setDelta(next);
      setSelected(defaultSelection(next));
      setTab(next.counts.priceChanges ? "price_change" : next.counts.newVariants ? "new_variant" : next.counts.newProducts ? "new_product" : "unchanged");
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : "The catalog comparison failed.");
    } finally {
      setBusy(false);
    }
  }

  function toggle(id: string, on: boolean) {
    setSelected((current) => {
      const next = new Set(current);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  const counts = delta?.counts;
  const cards: Array<[string, number | string]> = counts
    ? [
        ["Parsed rows", counts.parsedRows],
        ["Matched products", counts.matchedProducts],
        ["Unchanged", counts.unchanged],
        ["Price changes", counts.priceChanges],
        ["New variants", counts.newVariants],
        ["New products", counts.newProducts],
        ["Missing from list", counts.missingProducts + counts.missingVariants],
        ["Ambiguous", counts.ambiguous],
        ["Blocked", counts.blocked + counts.excluded],
      ]
    : [];

  const entriesFor = (kind: DeltaEntry["kind"]) => delta?.entries.filter((entry) => entry.kind === kind) ?? [];

  function entryRows(kind: DeltaEntry["kind"], mode: "price" | "variant" | "product" | "plain") {
    const rows = entriesFor(kind);
    if (!rows.length) return <p className="stock-empty">Nothing in this group.</p>;
    return (
      <div className="bulk-images-table">
        <table>
          <thead>
            <tr>
              {isSelectableKind(kind) && <th>Apply</th>}
              <th>Product</th>
              <th>RAM / Storage / Color</th>
              {mode === "price" && (<><th>SKU</th><th>Current</th><th>New</th><th>Diff</th></>)}
              {mode !== "price" && mode !== "plain" && <th>New price</th>}
              {mode === "plain" && (<><th>Category</th><th>Price</th></>)}
              <th>Notes</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((entry) => (
              <tr key={entry.id} className={selected.has(entry.id) ? "included" : undefined}>
                {isSelectableKind(kind) && (
                  <td>
                    <input type="checkbox" aria-label={`Apply ${entry.productTitle} ${entry.label}`} checked={selected.has(entry.id)} disabled={!isSelectable(entry)} onChange={(event) => toggle(entry.id, event.target.checked)} />
                  </td>
                )}
                <td>
                  <strong>{entry.productTitle}</strong>
                  {entry.mediaCount !== null && <small className="plain">{entry.mediaCount} image(s) · {entry.specCount} spec(s) preserved</small>}
                </td>
                <td>{entry.label}</td>
                {mode === "price" && (<><td><code>{entry.sku}</code></td><td>{formatMinor(entry.currentPriceMinor)}</td><td>{formatMinor(entry.newPriceMinor)}</td><td>{formatDiff(entry.diffMinor)}</td></>)}
                {mode !== "price" && mode !== "plain" && <td>{formatMinor(entry.newPriceMinor)}</td>}
                {mode === "plain" && (<><td>{CATEGORY_LABEL[entry.category]}</td><td>{formatMinor(entry.newPriceMinor)}</td></>)}
                <td>
                  {[...entry.reasons, ...entry.notes].map((note) => (<small className="plain" key={note}>{note}</small>))}
                  {entry.provisionalKind && <small className="plain">Would otherwise be: {entry.provisionalKind.replace("_", " ")}</small>}
                  {mode === "product" && rows.findIndex((other) => other.productSlug === entry.productSlug) === rows.indexOf(entry) && entry.requirements.map((need) => (<small className="plain" key={need}>Needs: {need}</small>))}
                  <small className="plain">Line {entry.row.lineNumber}</small>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  return (
    <section className="admin-panel stock-update" aria-labelledby="stock-update-title">
      <span className="admin-kicker">CATALOG · STOCK</span>
      <h2 id="stock-update-title">Stock List Update</h2>
      <p>Paste or upload the latest supplier stock list. Existing products, images, specifications and URLs are preserved. Only approved changes are applied.</p>
      <div className={`bulk-images-env ${supabaseEnvironmentLabel.toLowerCase() === "production" ? "production" : "development"}`} role="status">
        <span>Environment</span>
        <strong>{supabaseEnvironmentLabel.toUpperCase()}</strong>
        <small>Preview only — this tool does not write to the catalog yet</small>
      </div>

      <label className="stock-field">
        <span>Stock list</span>
        <textarea value={text} rows={10} placeholder={"Samsung\n\nA07 4/64 black/green @ 36900\nA57 12/512 lilac/navy/grey @ 204500\n\nMotorola\n\nG77 8/256 black/green @ 91800"} onChange={(event) => { setText(event.target.value); setParsed(null); setDelta(null); }} />
      </label>
      <label className="stock-field">
        <span>Or upload a file (.txt, .csv, .xlsx)</span>
        <input type="file" accept=".txt,.csv,.xlsx" onChange={(event) => void onFile(event.target.files?.[0])} />
        {fileName && <small>Loaded {fileName}</small>}
      </label>

      <div className="bulk-images-bulk">
        <button type="button" className="admin-secondary" disabled={busy || !text.trim()} onClick={() => void runParse()}>{busy && !parsed ? "Working…" : "Parse Stock List"}</button>
        <button type="button" className="admin-secondary" disabled={busy || !parsed || parsed.rows.length === 0} onClick={() => void runCompare()}>{busy && parsed ? "Comparing…" : "Compare With Catalog"}</button>
        <button type="button" className="admin-primary" disabled title="Apply is enabled in a later, separately approved phase">Apply Selected Changes</button>
      </div>
      {error && <p className="bulk-images-error" role="alert">{error}</p>}

      {parsed && !delta && (
        <div className="bulk-images-devreport" aria-label="Parse result">
          <strong>Parsed — nothing compared yet</strong>
          <p>{parsed.rows.length} variant row(s) · {parsed.summary.headings} heading(s) · {parsed.excluded.length} excluded line(s) · {parsed.rows.filter((row) => row.needsReview).length} row(s) flagged for review</p>
        </div>
      )}

      {delta && counts && plan && (
        <>
          <div className="stock-cards" aria-label="Delta summary">
            {cards.map(([label, value]) => (
              <div className="stock-card" key={label}>
                <strong>{value}</strong>
                <span>{label}</span>
              </div>
            ))}
          </div>
          <p className="stock-hint">
            Matched variants {counts.matchedVariants} · New products {counts.newProducts} ({counts.newProductVariants} variants) · Parsed models {counts.parsedProducts}. Missing items are review-only and are never hidden, deleted or unpublished.
          </p>

          <div className="stock-tabs" role="tablist">
            {TABS.map((item) => {
              const total = item.id === "missing" ? delta.missing.length : item.id === "blocked" ? entriesFor("blocked").length + delta.excluded.length : entriesFor(item.id).length;
              return (
                <button key={item.id} type="button" role="tab" aria-selected={tab === item.id} className={tab === item.id ? "active" : ""} onClick={() => setTab(item.id)}>
                  {item.label} <span>{total}</span>
                </button>
              );
            })}
          </div>

          {tab === "price_change" && entryRows("price_change", "price")}
          {tab === "new_variant" && entryRows("new_variant", "variant")}
          {tab === "new_product" && entryRows("new_product", "product")}
          {tab === "ambiguous" && entryRows("ambiguous", "variant")}
          {tab === "unchanged" && entryRows("unchanged", "price")}
          {tab === "blocked" && (
            <>
              {entryRows("blocked", "plain")}
              {delta.excluded.length > 0 && (
                <ul className="stock-excluded">
                  {delta.excluded.map((line) => (<li key={line.lineNumber}>Line {line.lineNumber}: “{line.line}” — {line.reason}</li>))}
                </ul>
              )}
            </>
          )}
          {tab === "missing" &&
            (delta.missing.length ? (
              <div className="bulk-images-table">
                <table>
                  <thead><tr><th>Product</th><th>Scope</th><th>Variant</th><th>SKU</th><th>Price</th><th>Stock</th><th>State</th></tr></thead>
                  <tbody>
                    {delta.missing.map((entry) => (
                      <tr key={entry.id}>
                        <td><strong>{entry.productTitle}</strong></td>
                        <td>{entry.scope === "product" ? "Whole product" : "Variant"}</td>
                        <td>{entry.label}</td>
                        <td>{entry.sku ? <code>{entry.sku}</code> : "—"}</td>
                        <td>{formatMinor(entry.priceMinor)}</td>
                        <td>{entry.stock ?? "—"}</td>
                        <td>{entry.publicationStatus ?? "—"}{entry.isActive === false ? " · hidden" : ""}<small className="plain">Review only — not selectable</small></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="stock-empty">Every existing product and variant is in the new list.</p>
            ))}

          <div className="bulk-images-devreport stock-plan" aria-label="Apply plan">
            <strong>Apply plan — what WOULD happen (nothing is written)</strong>
            <p>
              {plan.counts.priceUpdates} price update(s) · {plan.counts.newVariants} new variant(s) · {plan.counts.newProducts} new product(s) with {plan.counts.newProductVariants} variant(s) · {plan.missingReviewOnly} missing item(s) review-only, no action
            </p>
            <ul>
              {plan.actions.slice(0, 25).map((action, index) => (
                <li key={index}>
                  {action.op === "update_price" && `Update price only: ${action.productTitle} · ${action.label} (${action.sku}) ${formatMinor(action.fromMinor)} → ${formatMinor(action.toMinor)}`}
                  {action.op === "create_variant" && `Add variant: ${action.productTitle} · ${[action.ram, action.storage, action.color].filter(Boolean).join(" / ")} at ${formatMinor(action.priceMinor)} (${action.sku})`}
                  {action.op === "create_product" && `Create draft product: ${action.productTitle} with ${action.variants.length} variant(s) — needs an image and publication validation`}
                </li>
              ))}
              {plan.actions.length > 25 && <li>…and {plan.actions.length - 25} more</li>}
            </ul>
            <p className="stock-hint">Preserved for every existing product: {plan.preserved.join("; ")}.</p>
          </div>
        </>
      )}
    </section>
  );
}

const isSelectableKind = (kind: DeltaEntry["kind"]) => kind === "price_change" || kind === "new_variant" || kind === "new_product";
