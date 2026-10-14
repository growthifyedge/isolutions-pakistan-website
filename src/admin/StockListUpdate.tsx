import { useEffect, useMemo, useRef, useState } from "react";
import { supabase, supabaseEnvironmentLabel } from "../lib/supabase";
import { csvRows } from "../lib/bulkCatalog";
import { loadExcelJs } from "../lib/catalogWorkbook";
import {
  buildApplyPlan,
  buildStockDelta,
  defaultSelection,
  formatDiff,
  formatMinor,
  isHideSelectable,
  isSelectable,
  parseStockList,
  tableToStockText,
  type DeltaEntry,
  type MissingEntry,
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
  hasDraftContent,
  loadDraft,
  makeComparisonStamp,
  resolutionOptions,
  saveDraft,
  type ComparisonStamp,
  type DraftStorage,
  type Resolution,
  type ResolutionRecord,
} from "../lib/stockListDraft";
import { ACTION, CATEGORY_LABEL, HIDE_LABEL, KIND_LABEL, PAGE_HELP, PAGE_TITLE, SHOW_AGAIN_LABEL, STEP, TOKEN_EXPLANATION, WORDING, explainReason } from "../lib/stockUpdateWording";

// Admin "Android Stock Update": Paste List -> Check List -> Review Changes -> Update Website.
// This phase performs NO database write; "Update Website" is intentionally disabled.
// The Owner's working list (text, fixes, ticks) is autosaved to localStorage and restored on reload.
// A check is NEVER restored: it is recomputed from the live website data by a fresh read-only Check List.

type TabId = "price_change" | "new_variant" | "new_product" | "show_again" | "hide" | "ambiguous" | "blocked";

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

const hideKey = (entry: MissingEntry) => `hide:${entry.id}`;

export function StockListUpdate() {
  // Read once, before the first render, so the autosave below can never overwrite a list that has not been restored yet.
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

  // The Owner's fixes are applied to the parsed rows, then compared against the website data from the last live Check.
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
    for (const entry of delta.missing) {
      const key = hideKey(entry);
      if (key in overrides) {
        if (overrides[key] && isHideSelectable(entry)) base.add(entry.id);
        else base.delete(entry.id);
      }
    }
    return base;
  }, [delta, resolved, overrides]);
  const plan = useMemo(() => (delta ? buildApplyPlan(delta, selected) : null), [delta, selected]);
  // A future Update Website must require this to be true. It is false after any reload (the stamp is memory-only) and after any later edit.
  const checkIsCurrent = comparisonAuthorizesApply(stamp, text, resolutions);

  // Autosave (debounced) + a final flush when the page is hidden or the screen unmounts.
  const wasParsed = parsed !== null;
  const latest = useRef(draftFromState({ text, fileName, wasParsed, lastComparedAt, resolutions, selectionOverrides: overrides }));
  const currentDraft = draftFromState({ text, fileName, wasParsed, lastComparedAt, resolutions, selectionOverrides: overrides });
  useEffect(() => {
    latest.current = currentDraft;
  });
  // Nothing is written until this tab has actually changed something, so merely opening (or closing) an untouched
  // page can never overwrite or delete a list saved earlier or from another tab.
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
      if (ok) setSavedAt(hasDraftContent(latest.current) ? new Date().toISOString() : null);
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

  /** Check List = read the pasted list + read the current website data (read-only) and compare them, in one step. */
  async function runCheck() {
    if (!supabase) return setError("Supabase is not configured.");
    setBusy(true);
    setError("");
    try {
      const brands = await loadActiveBrands(supabase);
      const parsedNow = parseStockList(text, brands);
      if (!parsedNow.rows.length) {
        setParsed(null);
        setCatalog(null);
        setStamp(null);
        setError("We couldn't read any phone lines from this list, so nothing was checked.");
        return;
      }
      const fresh = await loadCatalogForDelta(supabase);
      const next = buildStockDelta(applyResolutions(parsedNow, resolutions).parsed, fresh);
      setParsed(parsedNow);
      setCatalog(fresh);
      const now = new Date();
      setStamp(makeComparisonStamp(text, resolutions, now));
      setLastComparedAt(now.toISOString());
      setWasRestored(false);
      const { counts } = next;
      setTab(counts.ambiguous ? "ambiguous" : counts.priceChanges ? "price_change" : counts.newVariants ? "new_variant" : counts.newProducts ? "new_product" : counts.willHide ? "hide" : counts.showAgain ? "show_again" : "price_change");
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : "The check failed.");
    } finally {
      setBusy(false);
    }
  }

  function toggle(key: string | undefined, on: boolean) {
    if (key === undefined) return;
    setOverrides((current) => ({ ...current, [key]: on }));
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

  function discardList() {
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
    setNotice(cleared ? WORDING.cleared : WORDING.clearFailed);
  }

  const counts = delta?.counts;
  const rowKeyOf = (entry: DeltaEntry) => resolved?.rowKeys[Number(entry.id.slice(4))];
  const entriesFor = (kind: DeltaEntry["kind"]) => delta?.entries.filter((entry) => entry.kind === kind) ?? [];
  const showAgainEntries = delta?.entries.filter((entry) => entry.showAgain && entry.kind !== "ambiguous") ?? [];

  const cards: Array<[string, number]> = counts
    ? [
        [KIND_LABEL.unchanged, counts.unchanged],
        [KIND_LABEL.price_change, counts.priceChanges],
        [KIND_LABEL.new_variant, counts.newVariants],
        [KIND_LABEL.new_product, counts.newProducts],
        [HIDE_LABEL, counts.willHide],
        ...(counts.showAgain ? ([[SHOW_AGAIN_LABEL, counts.showAgain]] as Array<[string, number]>) : []),
        [KIND_LABEL.ambiguous, counts.ambiguous],
        [KIND_LABEL.blocked, counts.notAndroid],
      ]
    : [];

  const tabs: Array<{ id: TabId; label: string; total: number }> = delta && counts
    ? [
        { id: "price_change", label: KIND_LABEL.price_change, total: counts.priceChanges },
        { id: "new_variant", label: KIND_LABEL.new_variant, total: counts.newVariants },
        { id: "new_product", label: KIND_LABEL.new_product, total: counts.newProducts },
        { id: "hide", label: HIDE_LABEL, total: counts.willHide },
        ...(counts.showAgain ? [{ id: "show_again" as const, label: SHOW_AGAIN_LABEL, total: counts.showAgain }] : []),
        { id: "ambiguous", label: KIND_LABEL.ambiguous, total: counts.ambiguous },
        { id: "blocked", label: KIND_LABEL.blocked, total: counts.notAndroid },
      ]
    : [];

  function entryNotes(entry: DeltaEntry, rows: DeltaEntry[], mode: "price" | "variant" | "product" | "attention") {
    const options = resolutionOptions(entry.row);
    const explanations = [...new Set(entry.reasons.map((reason) => (options.token && /colour/i.test(reason) ? TOKEN_EXPLANATION(options.token) : explainReason(reason))))];
    return (
      <>
        {explanations.map((note) => (<small className="plain" key={note}>{note}</small>))}
        {entry.notes.map((note) => (<small className="plain" key={note}>{note}</small>))}
        {mode === "attention" && entry.provisionalKind && <small className="plain">{WORDING.wouldBe(KIND_LABEL[entry.provisionalKind])}</small>}
        {mode === "product" && rows.findIndex((other) => other.productSlug === entry.productSlug) === rows.indexOf(entry) && entry.requirements.map((need) => (<small className="plain" key={need}>{need}</small>))}
        <small className="plain">Line {entry.row.lineNumber}</small>
      </>
    );
  }

  function entryRows(kind: DeltaEntry["kind"], mode: "price" | "variant" | "product" | "attention") {
    const rows = entriesFor(kind);
    if (!rows.length) return <p className="stock-empty">{WORDING.nothingHere}</p>;
    const ticks = mode !== "attention";
    return (
      <div className="bulk-images-table">
        <table>
          <thead>
            <tr>
              {ticks && <th>Update</th>}
              <th>Phone</th>
              <th>RAM / Storage / Color</th>
              {mode === "price" && (<><th>SKU</th><th>Now</th><th>New</th><th>Change</th></>)}
              {mode !== "price" && <th>Price</th>}
              <th>{mode === "attention" ? "What's wrong" : "Notes"}</th>
              {mode === "attention" && <th>What to do</th>}
            </tr>
          </thead>
          <tbody>
            {rows.map((entry) => (
              <tr key={entry.id} className={selected.has(entry.id) ? "included" : undefined}>
                {ticks && (
                  <td>
                    <input type="checkbox" aria-label={`Update ${entry.productTitle} ${entry.label}`} checked={selected.has(entry.id)} disabled={!isSelectable(entry)} onChange={(event) => toggle(rowKeyOf(entry), event.target.checked)} />
                  </td>
                )}
                <td>
                  <strong>{entry.productTitle}</strong>
                  {entry.mediaCount !== null && <small className="plain">{entry.mediaCount} image(s) · {entry.specCount} spec(s) kept</small>}
                </td>
                <td>{entry.label}</td>
                {mode === "price" && (<><td><code>{entry.sku}</code></td><td>{formatMinor(entry.currentPriceMinor)}</td><td>{formatMinor(entry.newPriceMinor)}</td><td>{formatDiff(entry.diffMinor)}</td></>)}
                {mode !== "price" && <td>{formatMinor(entry.newPriceMinor)}</td>}
                <td>{entryNotes(entry, rows, mode)}</td>
                {mode === "attention" && (
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

  function showAgainRows() {
    if (!showAgainEntries.length) return <p className="stock-empty">{WORDING.nothingHere}</p>;
    return (
      <div className="bulk-images-table">
        <table>
          <thead><tr><th>Update</th><th>Phone</th><th>RAM / Storage / Color</th><th>SKU</th><th>Price</th><th>Notes</th></tr></thead>
          <tbody>
            {showAgainEntries.map((entry) => (
              <tr key={entry.id} className={selected.has(entry.id) ? "included" : undefined}>
                <td><input type="checkbox" aria-label={`Show ${entry.productTitle} ${entry.label} again`} checked={selected.has(entry.id)} disabled={!isSelectable(entry)} onChange={(event) => toggle(rowKeyOf(entry), event.target.checked)} /></td>
                <td><strong>{entry.productTitle}</strong></td>
                <td>{entry.label}</td>
                <td><code>{entry.sku}</code></td>
                <td>{formatMinor(entry.newPriceMinor)}</td>
                <td>
                  {entry.notes.map((note) => (<small className="plain" key={note}>{note}</small>))}
                  {entry.kind === "price_change" && <small className="plain">Also listed under {KIND_LABEL.price_change}</small>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  function hideRows() {
    if (!delta) return null;
    const order: Record<MissingEntry["action"], number> = { hide: 0, held: 1, already_hidden: 2 };
    const rows = [...delta.missing].sort((a, b) => order[a.action] - order[b.action] || a.productTitle.localeCompare(b.productTitle));
    if (!rows.length) return <p className="stock-empty">{WORDING.nothingHidden}</p>;
    return (
      <div className="bulk-images-table">
        <table>
          <thead><tr><th>Update</th><th>Phone</th><th>What</th><th>RAM / Storage / Color</th><th>SKU</th><th>Price</th><th>Why</th></tr></thead>
          <tbody>
            {rows.map((entry) => (
              <tr key={entry.id} className={selected.has(entry.id) ? "included" : entry.action !== "hide" ? "stock-muted" : undefined}>
                <td><input type="checkbox" aria-label={`Hide ${entry.productTitle} ${entry.label}`} checked={selected.has(entry.id)} disabled={!isHideSelectable(entry)} onChange={(event) => toggle(hideKey(entry), event.target.checked)} /></td>
                <td>
                  <strong>{entry.productTitle}</strong>
                  <small className="plain">{entry.mediaCount} image(s) · {entry.specCount} spec(s) kept</small>
                </td>
                <td>{entry.scope === "product" ? "Whole phone" : "One variant"}</td>
                <td>{entry.label}</td>
                <td>{entry.sku ? <code>{entry.sku}</code> : "—"}</td>
                <td>{formatMinor(entry.priceMinor)}</td>
                <td>
                  <small className="plain">{entry.action === "held" ? WORDING.heldHide : entry.action === "already_hidden" ? WORDING.alreadyHidden : entry.reason}</small>
                  {entry.publicationStatus !== "published" && <small className="plain">{WORDING.notPublished}</small>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  function notAndroidRows() {
    if (!delta || !parsed) return null;
    const rows = entriesFor("blocked");
    if (!rows.length && !parsed.excluded.length) return <p className="stock-empty">{WORDING.nothingHere}</p>;
    return (
      <>
        {rows.length > 0 && (
          <div className="bulk-images-table">
            <table>
              <thead><tr><th>Line</th><th>What it is</th><th>Price</th></tr></thead>
              <tbody>
                {rows.map((entry) => (
                  <tr key={entry.id} className="stock-muted">
                    <td><strong>{entry.productTitle}</strong><small className="plain">Line {entry.row.lineNumber}: {entry.row.sourceLine}</small></td>
                    <td>{CATEGORY_LABEL[entry.category]}</td>
                    <td>{formatMinor(entry.newPriceMinor)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {parsed.excluded.length > 0 && (
          <ul className="stock-excluded">
            {parsed.excluded.map((line) => (<li key={line.lineNumber}>Line {line.lineNumber}: “{line.line}” — {line.reason}</li>))}
          </ul>
        )}
        <p className="stock-hint">These lines are not Android phones, so this update leaves them alone. iPhones, tablets, feature phones and accessories will have their own update later.</p>
      </>
    );
  }

  return (
    <section className="admin-panel stock-update" aria-labelledby="stock-update-title">
      <span className="admin-kicker">CATALOG · ANDROID STOCK</span>
      <h2 id="stock-update-title">{PAGE_TITLE}</h2>
      <p>{PAGE_HELP}</p>
      <div className={`bulk-images-env ${supabaseEnvironmentLabel.toLowerCase() === "production" ? "production" : "development"}`} role="status">
        <span>Website</span>
        <strong>{supabaseEnvironmentLabel.toUpperCase()}</strong>
        <small>{WORDING.checkingOnly}</small>
      </div>

      {(wasRestored || notice) && (
        <div className="stock-draft-status restored" role="status">
          <strong>{wasRestored ? WORDING.listBack : notice}</strong>
          {wasRestored && <span>{WORDING.listBackDetail(clock(savedAt))}</span>}
        </div>
      )}

      <div className="stock-step" aria-labelledby="stock-step-1">
        <h3 id="stock-step-1"><span className="stock-step-number">1</span> {STEP.paste}</h3>
        <label className="stock-field">
          <span>Latest Android stock list</span>
          <textarea value={text} rows={10} placeholder={"Samsung\n\nA07 4/64 black/green @ 36900\nA57 12/512 lilac/navy/grey @ 204500\n\nMotorola\n\nG77 8/256 black/green @ 91800"} onChange={(event) => changeText(event.target.value)} />
        </label>
        <label className="stock-field">
          <span>Or upload a file (.txt, .csv, .xlsx)</span>
          <input type="file" accept=".txt,.csv,.xlsx" onChange={(event) => void onFile(event.target.files?.[0])} />
          {fileName && <small>Loaded {fileName}</small>}
        </label>

        <div className="bulk-images-bulk">
          <button type="button" className="admin-primary" disabled={busy || !text.trim()} onClick={() => void runCheck()}>{busy ? "Checking…" : STEP.check}</button>
          {confirmClear ? (
            <span className="stock-clear-confirm" role="alertdialog" aria-label="Confirm clear list">
              <span>{WORDING.clearConfirm}</span>
              <button type="button" className="admin-secondary danger" onClick={discardList}>{WORDING.clearYes}</button>
              <button type="button" className="admin-secondary" onClick={() => setConfirmClear(false)}>{WORDING.clearNo}</button>
            </span>
          ) : (
            <button type="button" className="admin-secondary" disabled={busy || (!text && !fileName && !Object.keys(resolutions).length && !Object.keys(overrides).length)} onClick={() => setConfirmClear(true)}>{STEP.clear}</button>
          )}
        </div>
        <p className="stock-hint stock-save-state" aria-live="polite">
          {saveFailed ? WORDING.autosaveFailed : savedAt ? WORDING.autosaved(clock(savedAt)) : WORDING.autosave}
        </p>
        {error && <p className="bulk-images-error" role="alert">{error}</p>}
      </div>

      {delta && counts && plan && parsed && (
        <>
          <div className="stock-step" aria-labelledby="stock-step-2">
            <h3 id="stock-step-2"><span className="stock-step-number">2</span> {STEP.review}</h3>
            <p className="stock-hint">
              Checked {clock(lastComparedAt) || "just now"} against the {supabaseEnvironmentLabel.toLowerCase()} website · {counts.parsedRows} line(s) read · {counts.matchedProducts} phone(s) matched.
            </p>
            {!checkIsCurrent && <p className="stock-hint stock-warning">{WORDING.changedSinceCheck}</p>}

            <div className="stock-cards" aria-label="Summary">
              {cards.map(([label, value]) => (
                <div className="stock-card" key={label}>
                  <strong>{value}</strong>
                  <span>{label}</span>
                </div>
              ))}
            </div>

            <div className="stock-tabs" role="tablist">
              {tabs.map((item) => (
                <button key={item.id} type="button" role="tab" aria-selected={tab === item.id} className={tab === item.id ? "active" : ""} onClick={() => setTab(item.id)}>
                  {item.label} <span>{item.total}</span>
                </button>
              ))}
            </div>

            {tab === "price_change" && entryRows("price_change", "price")}
            {tab === "new_variant" && entryRows("new_variant", "variant")}
            {tab === "new_product" && entryRows("new_product", "product")}
            {tab === "hide" && (
              <>
                <p className="stock-hint">Android phones on the website that are not in this list. They are hidden, not deleted, and come back when they are in a later list.</p>
                {hideRows()}
              </>
            )}
            {tab === "show_again" && showAgainRows()}
            {tab === "ambiguous" && (
              <>
                <p className="stock-hint">Use the buttons to fix a row, or correct the line in your list above and click {STEP.check} again.</p>
                {entryRows("ambiguous", "attention")}
              </>
            )}
            {tab === "blocked" && notAndroidRows()}

            {Object.keys(resolutions).length > 0 && (
              <div className="bulk-images-devreport stock-decisions" aria-label="Your fixes">
                <strong>Your fixes ({Object.keys(resolutions).length}) — saved with your list</strong>
                <ul>
                  {Object.values(resolutions).map((record) => (
                    <li key={record.rowKey}>
                      <span>
                        {record.label || record.sourceLine}: {describeResolution(record.resolution)}
                        {resolved?.unmatched.includes(record.rowKey) && <small className="plain"> — not used (this line is no longer in the list)</small>}
                        {resolutionOutcome(delta, record)}
                      </span>
                      <button type="button" className="admin-secondary" onClick={() => undoResolution(record.rowKey)}>{ACTION.undo}</button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>

          <div className="stock-step" aria-labelledby="stock-step-3">
            <h3 id="stock-step-3"><span className="stock-step-number">3</span> {STEP.update}</h3>
            <p>
              Ticked changes: {plan.counts.priceUpdates} price update(s) · {plan.counts.newVariants} new variant(s) · {plan.counts.newProducts} new phone(s) with {plan.counts.newProductVariants} variant(s) · {plan.counts.hideProducts} phone(s) and {plan.counts.hideVariants} variant(s) hidden · {plan.counts.showAgain} shown again.
            </p>
            <p className="stock-hint">{WORDING.nothingDeleted}</p>
            <div className="bulk-images-bulk">
              <button type="button" className="admin-primary" disabled title={WORDING.updateDisabled}>{STEP.update}</button>
            </div>
            <p className="stock-hint">{WORDING.updateDisabled}</p>
          </div>
        </>
      )}
    </section>
  );
}

/** Every row that now comes from the fixed line (all sibling colours), with the group each one landed in. */
function resolutionOutcome(delta: StockDelta, record: ResolutionRecord) {
  if (record.resolution.type === "skip_row") return null;
  const rows = delta.entries.filter((entry) => entry.row.sourceLine === record.sourceLine);
  if (!rows.length) return null;
  return (
    <small className="plain stock-outcome">
      Now {rows.length} row(s) from this line: {rows.map((entry) => `${entry.productTitle} · ${entry.label} · ${formatMinor(entry.newPriceMinor)} → ${KIND_LABEL[entry.kind]}`).join("  |  ")}
    </small>
  );
}

function ResolverActions({ entry, onResolve }: { entry: DeltaEntry; onResolve: (resolution: Resolution) => void }) {
  const [replacement, setReplacement] = useState("");
  const options = resolutionOptions(entry.row);
  return (
    <div className="stock-resolver">
      {options.token && <button type="button" className="admin-secondary" onClick={() => onResolve({ type: "move_token_to_model", token: options.token as string })}>{ACTION.addToken(options.token)}</button>}
      {options.colorIssue && !options.token && <button type="button" className="admin-secondary" onClick={() => onResolve({ type: "accept_color_as_entered" })}>{ACTION.keepColor}</button>}
      {options.colorIssue && (
        <span className="stock-replace">
          <input type="text" value={replacement} maxLength={40} placeholder="Correct color" aria-label={`Correct color for ${entry.productTitle} ${entry.label}`} onChange={(event) => setReplacement(event.target.value)} />
          <button type="button" className="admin-secondary" disabled={!replacement.trim()} onClick={() => onResolve({ type: "replace_color", color: replacement.trim() })}>{ACTION.changeColor}</button>
        </span>
      )}
      {options.physicalRam !== null && <button type="button" className="admin-secondary" onClick={() => onResolve({ type: "set_physical_ram", ramGb: options.physicalRam as number })}>{ACTION.ramOption(options.physicalRam)}</button>}
      <button type="button" className="admin-secondary" onClick={() => onResolve({ type: "skip_row" })}>{ACTION.skip}</button>
    </div>
  );
}
