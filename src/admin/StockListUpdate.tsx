import { useEffect, useMemo, useRef, useState } from "react";
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
  type CatalogDeltaProduct,
  type StockDelta,
} from "../lib/stockListDelta";
import { loadActiveBrands, loadCatalogForDelta } from "../lib/stockListDeltaDb";
import {
  applyResolutions,
  clearDraft,
  comparisonAuthorizesApply,
  describeResolution,
  draftFromState,
  loadDraft,
  makeComparisonStamp,
  resolutionOptions,
  saveDraft,
  type ComparisonStamp,
  type DraftStorage,
  type Resolution,
  type ResolutionRecord,
} from "../lib/stockListDraft";

// Admin "Stock List Update": parse -> compare -> delta preview -> selection -> apply PLAN.
// This phase performs NO database write; "Apply Selected Changes" is intentionally disabled.
// The Owner's working draft (list text, decisions, checkbox choices) is autosaved to localStorage and restored on reload.
// A comparison is NEVER restored: it is recomputed from the live catalog by a fresh read-only Compare.

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

function browserStorage(): DraftStorage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

const clock = (iso: string | null) => {
  if (!iso) return "";
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleString("en-PK", { dateStyle: "medium", timeStyle: "short" });
};

export function StockListUpdate() {
  // Read once, before the first render, so the autosave below can never overwrite a draft that has not been restored yet.
  const [initial] = useState(() => loadDraft(browserStorage()));
  const restored = initial.status === "restored" ? initial.draft : null;
  const [text, setText] = useState(restored?.text ?? "");
  const [fileName, setFileName] = useState(restored?.fileName ?? "");
  const [resolutions, setResolutions] = useState<Record<string, ResolutionRecord>>(restored?.resolutions ?? {});
  const [overrides, setOverrides] = useState<Record<string, boolean>>(restored?.selectionOverrides ?? {});
  const [parsed, setParsed] = useState<ParsedStockList | null>(null);
  const [catalog, setCatalog] = useState<CatalogDeltaProduct[] | null>(null);
  const [stamp, setStamp] = useState<ComparisonStamp | null>(null);
  const [lastComparedAt, setLastComparedAt] = useState<string | null>(restored?.lastComparedAt ?? null);
  const [tab, setTab] = useState<TabId>("price_change");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState(initial.status === "reset" ? initial.reason : "");
  const [wasRestored, setWasRestored] = useState(Boolean(restored));
  const [savedAt, setSavedAt] = useState<string | null>(restored?.savedAt || null);
  const [saveFailed, setSaveFailed] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);

  // Resolutions are applied to the parsed rows, then classified against the in-memory catalog from the last live Compare.
  const resolved = useMemo(() => (parsed ? applyResolutions(parsed, resolutions) : null), [parsed, resolutions]);
  const delta = useMemo(() => (resolved && catalog ? buildStockDelta(resolved.parsed, catalog) : null), [resolved, catalog]);
  const selected = useMemo(() => {
    const base = delta ? defaultSelection(delta) : new Set<string>();
    if (!delta || !resolved) return base;
    for (const entry of delta.entries) {
      const key = resolved.rowKeys[Number(entry.id.slice(4))];
      if (key !== undefined && key in overrides) {
        if (overrides[key] && isSelectable(entry)) base.add(entry.id);
        else base.delete(entry.id);
      }
    }
    return base;
  }, [delta, resolved, overrides]);
  const plan = useMemo(() => (delta ? buildApplyPlan(delta, selected) : null), [delta, selected]);
  // A future Apply must require this to be true. It is false after any reload (the stamp is memory-only) and after any later edit.
  const applyAuthorized = comparisonAuthorizesApply(stamp, text, resolutions);

  // Autosave (debounced) + a final flush when the page is hidden or the Stock Update screen unmounts.
  const wasParsed = parsed !== null;
  const latest = useRef(draftFromState({ text, fileName, wasParsed, lastComparedAt, resolutions, selectionOverrides: overrides }));
  const currentDraft = draftFromState({ text, fileName, wasParsed, lastComparedAt, resolutions, selectionOverrides: overrides });
  useEffect(() => {
    latest.current = currentDraft;
  });
  // Nothing is written until this tab has actually changed something, so merely opening (or closing) an untouched
  // Stock Update screen can never overwrite or delete a draft saved earlier or from another tab.
  const touched = useRef(false);
  const mounted = useRef(false);
  useEffect(() => {
    if (!mounted.current) {
      mounted.current = true;
      return;
    }
    touched.current = true;
    const timer = window.setTimeout(() => {
      const ok = saveDraft(browserStorage(), latest.current);
      setSaveFailed(!ok);
      if (ok) setSavedAt(new Date().toISOString());
    }, 400);
    return () => window.clearTimeout(timer);
  }, [text, fileName, wasParsed, lastComparedAt, resolutions, overrides]);
  useEffect(() => {
    const flush = () => {
      if (touched.current) saveDraft(browserStorage(), latest.current);
    };
    window.addEventListener("pagehide", flush);
    return () => {
      window.removeEventListener("pagehide", flush);
      flush();
    };
  }, []);

  // A restored draft that had been parsed is re-parsed (read-only brand lookup) so only Compare remains to be clicked.
  useEffect(() => {
    if (!restored?.wasParsed || !supabase || !restored.text.trim()) return;
    let cancelled = false;
    loadActiveBrands(supabase)
      .then((brands) => {
        if (!cancelled) setParsed(parseStockList(restored.text, brands));
      })
      .catch(() => {
        if (!cancelled) setError("The restored list could not be re-parsed automatically — click Parse Stock List.");
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs once for the draft read at mount
  }, []);

  function changeText(next: string, name?: string) {
    setText(next);
    if (name !== undefined) setFileName(name);
    setParsed(null);
    setCatalog(null);
    setStamp(null);
    setWasRestored(false);
  }

  async function onFile(file: File | undefined) {
    if (!file) return;
    setError("");
    try {
      const table = await readTable(file);
      changeText(file.name.toLowerCase().endsWith(".txt") ? table.map((row) => row.join(" ")).join("\n") : tableToStockText(table), file.name);
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
      setCatalog(null);
      setStamp(null);
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
      const fresh = await loadCatalogForDelta(supabase);
      const next = buildStockDelta(applyResolutions(parsed, resolutions).parsed, fresh);
      setCatalog(fresh);
      const now = new Date();
      setStamp(makeComparisonStamp(text, resolutions, now));
      setLastComparedAt(now.toISOString());
      setWasRestored(false);
      setTab(next.counts.priceChanges ? "price_change" : next.counts.newVariants ? "new_variant" : next.counts.newProducts ? "new_product" : next.counts.ambiguous ? "ambiguous" : "unchanged");
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : "The catalog comparison failed.");
    } finally {
      setBusy(false);
    }
  }

  function toggle(rowKey: string | undefined, on: boolean) {
    if (rowKey === undefined) return;
    setOverrides((current) => ({ ...current, [rowKey]: on }));
  }

  function resolve(rowKey: string, entry: DeltaEntry, resolution: Resolution) {
    const label = [entry.productTitle, entry.label].filter(Boolean).join(" · ");
    setResolutions((current) => ({ ...current, [rowKey]: { rowKey, resolution, sourceLine: entry.row.sourceLine, label, decidedAt: new Date().toISOString() } }));
  }

  function undoResolution(rowKey: string) {
    setResolutions((current) => {
      const next = { ...current };
      delete next[rowKey];
      return next;
    });
  }

  function discardDraft() {
    const cleared = clearDraft(browserStorage());
    setText("");
    setFileName("");
    setResolutions({});
    setOverrides({});
    setParsed(null);
    setCatalog(null);
    setStamp(null);
    setLastComparedAt(null);
    setSavedAt(null);
    setError("");
    setWasRestored(false);
    setConfirmClear(false);
    setTab("price_change");
    setNotice(cleared ? "Draft cleared. Nothing in the catalog was changed." : "Page reset, but the browser would not let the saved draft be removed.");
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

  const rowKeyOf = (entry: DeltaEntry) => resolved?.rowKeys[Number(entry.id.slice(4))];
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
              {kind === "ambiguous" && <th>Resolve</th>}
            </tr>
          </thead>
          <tbody>
            {rows.map((entry) => (
              <tr key={entry.id} className={selected.has(entry.id) ? "included" : undefined}>
                {isSelectableKind(kind) && (
                  <td>
                    <input type="checkbox" aria-label={`Apply ${entry.productTitle} ${entry.label}`} checked={selected.has(entry.id)} disabled={!isSelectable(entry)} onChange={(event) => toggle(rowKeyOf(entry), event.target.checked)} />
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
                {kind === "ambiguous" && (
                  <td className="stock-resolve">
                    {(() => {
                      const key = rowKeyOf(entry);
                      return key === undefined ? null : <ResolverActions entry={entry} onResolve={(resolution) => resolve(key, entry, resolution)} />;
                    })()}
                  </td>
                )}
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

      {(wasRestored || notice) && (
        <div className="stock-draft-status restored" role="status">
          <strong>{wasRestored ? "Draft restored" : notice}</strong>
          {wasRestored && (
            <span>
              Saved {clock(savedAt) || "earlier"} · your list, decisions and checkbox choices are back. The comparison is not restored — click {parsed ? "" : "Parse Stock List, then "}Compare With Catalog to check against the current catalog.
            </span>
          )}
        </div>
      )}

      <label className="stock-field">
        <span>Stock list</span>
        <textarea value={text} rows={10} placeholder={"Samsung\n\nA07 4/64 black/green @ 36900\nA57 12/512 lilac/navy/grey @ 204500\n\nMotorola\n\nG77 8/256 black/green @ 91800"} onChange={(event) => changeText(event.target.value)} />
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
        {confirmClear ? (
          <span className="stock-clear-confirm" role="alertdialog" aria-label="Confirm clear draft">
            <span>Clear the saved draft and reset this page? Catalog data is not touched.</span>
            <button type="button" className="admin-secondary danger" onClick={discardDraft}>Yes, clear draft</button>
            <button type="button" className="admin-secondary" onClick={() => setConfirmClear(false)}>Keep draft</button>
          </span>
        ) : (
          <button type="button" className="admin-secondary" disabled={busy || (!text && !fileName && !Object.keys(resolutions).length && !Object.keys(overrides).length)} onClick={() => setConfirmClear(true)}>Clear Draft</button>
        )}
      </div>
      <p className="stock-hint stock-save-state" aria-live="polite">
        {saveFailed ? "⚠ Autosave failed (browser storage unavailable) — your draft will not survive a refresh." : savedAt ? `Draft autosaved ${clock(savedAt)} · stored only in this browser` : "Draft autosaves in this browser as you work"}
      </p>
      {error && <p className="bulk-images-error" role="alert">{error}</p>}

      {parsed && !delta && (
        <div className="bulk-images-devreport" aria-label="Parse result">
          <strong>Parsed — nothing compared yet</strong>
          <p>{parsed.rows.length} variant row(s) · {parsed.summary.headings} heading(s) · {parsed.excluded.length} excluded line(s) · {parsed.rows.filter((row) => row.needsReview).length} row(s) flagged for review</p>
        </div>
      )}

      {Object.keys(resolutions).length > 0 && (
        <div className="bulk-images-devreport stock-decisions" aria-label="Owner decisions">
          <strong>Owner decisions ({Object.keys(resolutions).length}) — saved with the draft</strong>
          <ul>
            {Object.values(resolutions).map((record) => (
              <li key={record.rowKey}>
                <span>
                  {record.label || record.sourceLine}: {describeResolution(record.resolution)}
                  {resolved?.unmatched.includes(record.rowKey) && <small className="plain"> — not applied (no longer matches the current list, or not parsed yet)</small>}
                  {delta && resolutionOutcome(delta, record)}
                </span>
                <button type="button" className="admin-secondary" onClick={() => undoResolution(record.rowKey)}>Undo</button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {delta && !applyAuthorized && (
        <p className="stock-hint">Your decisions changed since the last comparison. The classification below is refreshed, but click Compare With Catalog again before any future Apply.</p>
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

const KIND_LABEL: Record<DeltaEntry["kind"], string> = {
  unchanged: "Unchanged",
  price_change: "Price change",
  new_variant: "New variant",
  new_product: "New product",
  ambiguous: "Ambiguous",
  blocked: "Blocked",
};

/** Every row that now comes from the decision's source line (all sibling colours), with the tab each one landed in. */
function resolutionOutcome(delta: StockDelta, record: ResolutionRecord) {
  if (record.resolution.type === "skip_row") return null;
  const rows = delta.entries.filter((entry) => entry.row.sourceLine === record.sourceLine);
  if (!rows.length) return null;
  return (
    <small className="plain stock-outcome">
      Now {rows.length} row(s) from this source line: {rows.map((entry) => `${entry.productTitle} · ${entry.label} · ${formatMinor(entry.newPriceMinor)} → ${KIND_LABEL[entry.kind]}`).join("  |  ")}
    </small>
  );
}

function ResolverActions({ entry, onResolve }: { entry: DeltaEntry; onResolve: (resolution: Resolution) => void }) {
  const [replacement, setReplacement] = useState("");
  const options = resolutionOptions(entry.row);
  return (
    <div className="stock-resolver">
      {options.colorIssue && (
        <>
          <button type="button" className="admin-secondary" onClick={() => onResolve({ type: "accept_color_as_entered" })}>Use as entered</button>
          <span className="stock-replace">
            <input type="text" value={replacement} maxLength={40} placeholder="Correct colour" aria-label={`Replacement colour for ${entry.productTitle} ${entry.label}`} onChange={(event) => setReplacement(event.target.value)} />
            <button type="button" className="admin-secondary" disabled={!replacement.trim()} onClick={() => onResolve({ type: "replace_color", color: replacement.trim() })}>Replace colour</button>
          </span>
        </>
      )}
      {options.token && <button type="button" className="admin-secondary" onClick={() => onResolve({ type: "move_token_to_model", token: options.token as string })}>Move {options.token.toUpperCase()} to model name</button>}
      {options.physicalRam !== null && <button type="button" className="admin-secondary" onClick={() => onResolve({ type: "set_physical_ram", ramGb: options.physicalRam as number })}>Physical RAM: {options.physicalRam} GB</button>}
      <button type="button" className="admin-secondary" onClick={() => onResolve({ type: "skip_row" })}>Skip</button>
    </div>
  );
}

const isSelectableKind = (kind: DeltaEntry["kind"]) => kind === "price_change" || kind === "new_variant" || kind === "new_product";
