import { useEffect, useMemo, useState } from "react";
import { supabase, supabaseEnvironmentLabel } from "../lib/supabase";
import { loadActiveBrands, loadCatalogForDelta } from "../lib/stockListDeltaDb";
import { formatMinor, identityKey, type CatalogDeltaProduct } from "../lib/stockListDelta";
import {
  CONDITION_LABEL,
  CONNECTIVITY_LABEL,
  PRODUCT_TYPE_LABEL,
  PTA_LABEL,
  TABLET_NEW_VARIANT_STOCK,
  buildTabletPlan,
  checkFingerprint,
  compareTabletList,
  emptyDecisions,
  parseTabletList,
  variantLabel,
  type TabletComparison,
  type TabletCondition,
  type TabletConnectivity,
  type TabletDecisions,
  type TabletEntry,
  type TabletEntryKind,
  type TabletProductType,
  type TabletSelection,
} from "../lib/tabletStockUpdate";
import { runTabletUpdate, tabletUpdateBlocker, type TabletUpdateResult } from "../lib/tabletStockApply";
import { tabletUpdateDbDeps } from "../lib/tabletStockApplyDb";
import { installUnloadGuard } from "../lib/unloadGuard";

// Admin "Tablets & MacBooks Stock Update" (New + Used): Paste List -> Check Changes -> Update Website.
// Check Changes is read-only. Update Website writes product by product (one all-or-nothing database call each) and only
// after a fresh check of exactly this list, choices and decisions. Products with any line that needs attention are held.
// Existing variants keep their stock; products and variants missing from the list are never touched.

/** Owner gate: ON (approved 2026-10-26). Which websites may write is decided by TABLET_WRITE_ENVIRONMENTS (DEV only). */
const TABLET_UPDATE_WEBSITE_ENABLED = true;

const BUILD_MODE: string = import.meta.env.MODE;
const SUPABASE_URL: string | undefined = import.meta.env.VITE_SUPABASE_URL;
const DRAFT_KEY = "isolutions.tablet-stock-update.draft.v1";

type Draft = { text: string; selection: TabletSelection; decisions: TabletDecisions };

const pick = <T extends string>(value: unknown, options: readonly T[]): T | null => (options.includes(value as T) ? (value as T) : null);

function readDraft(): Draft {
  const empty: Draft = { text: "", selection: { productType: null, condition: null, connectivity: null }, decisions: emptyDecisions() };
  try {
    const raw = window.localStorage.getItem(DRAFT_KEY);
    if (!raw) return empty;
    const value = JSON.parse(raw) as Partial<Draft>;
    return {
      text: typeof value.text === "string" ? value.text : "",
      selection: {
        productType: pick(value.selection?.productType, ["ipad", "tablet", "macbook"] as const),
        condition: pick(value.selection?.condition, ["brand_new", "used"] as const),
        connectivity: pick(value.selection?.connectivity, ["wifi", "cellular_pta", "cellular_non_pta"] as const),
      },
      decisions: { colors: { ...(value.decisions?.colors ?? {}) }, newProducts: { ...(value.decisions?.newProducts ?? {}) } },
    };
  } catch {
    return empty;
  }
}

function writeDraft(draft: Draft) {
  try {
    window.localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
  } catch {
    /* the list still works without saving */
  }
}

const SECTIONS: { kind: TabletEntryKind; title: string; help: string }[] = [
  { kind: "attention", title: "Needs Review", help: "These lines are not written until you decide. Their whole product waits; every other product still updates." },
  { kind: "new_product", title: "New Products", help: `Created as drafts (not on the storefront until images are added and you publish). Every variant starts with stock ${TABLET_NEW_VARIANT_STOCK}, Karachi only.` },
  { kind: "new_variant", title: "New Variants", help: `Added to an existing product with stock ${TABLET_NEW_VARIANT_STOCK}, Karachi only.` },
  { kind: "price_change", title: "Price Updates", help: "Only the price changes. Stock stays exactly as it is." },
  { kind: "show_again", title: "Show Again", help: "Hidden now and listed again: shown with the latest price. Stock stays exactly as it is." },
];

const STATUS_LABEL = { updated: "Updated", failed: "Not saved", unknown: "Check again", needs_check: "Saved — check again", held: "Held for review" } as const;

export function TabletStockUpdate() {
  const [initial] = useState(readDraft);
  const [text, setText] = useState(initial.text);
  const [selection, setSelection] = useState<TabletSelection>(initial.selection);
  const [decisions, setDecisions] = useState<TabletDecisions>(initial.decisions);
  const [catalog, setCatalog] = useState<CatalogDeltaProduct[] | null>(null);
  const [comparison, setComparison] = useState<TabletComparison | null>(null);
  const [checkedFingerprint, setCheckedFingerprint] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [writing, setWriting] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [result, setResult] = useState<TabletUpdateResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => writeDraft({ text, selection, decisions }), [text, selection, decisions]);
  useEffect(() => (writing ? installUnloadGuard(window) : undefined), [writing]);

  const fingerprint = checkFingerprint(text, selection, decisions);
  const checkIsCurrent = checkedFingerprint === fingerprint;
  const plan = useMemo(() => (comparison && catalog ? buildTabletPlan(comparison, catalog) : null), [comparison, catalog]);
  const blocker = tabletUpdateBlocker({ supabaseUrl: SUPABASE_URL, buildMode: BUILD_MODE, enabled: TABLET_UPDATE_WEBSITE_ENABLED, checkIsCurrent, plan });

  async function check(nextDecisions: TabletDecisions = decisions) {
    if (!supabase) {
      setError("The website connection is not configured.");
      return;
    }
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const [brands, products] = await Promise.all([loadActiveBrands(supabase), loadCatalogForDelta(supabase)]);
      const parsed = parseTabletList(text, brands);
      setCatalog(products);
      setComparison(compareTabletList(parsed, products, selection, nextDecisions));
      setCheckedFingerprint(checkFingerprint(text, selection, nextDecisions));
    } catch (problem) {
      setError(`Could not read the website: ${problem instanceof Error ? problem.message : String(problem)}`);
    } finally {
      setBusy(false);
    }
  }

  /** A decision re-runs the check, so the page always shows what would really be written. */
  function decide(next: TabletDecisions) {
    setDecisions(next);
    if (comparison) void check(next);
  }

  const keepColor = (entry: TabletEntry) => decide({ ...decisions, colors: { ...decisions.colors, [entry.line.lineKey]: entry.colorDecision?.written as string } });
  const confirmNewProduct = (entry: TabletEntry) => entry.productTitle && decide({ ...decisions, newProducts: { ...decisions.newProducts, [identityKey(entry.productTitle)]: true } });
  const undoDecisions = () => decide(emptyDecisions());

  async function update() {
    if (!supabase || !plan || blocker) return;
    if (!window.confirm(`Update the ${supabaseEnvironmentLabel.toUpperCase()} website now? ${plan.changeCount} change(s) on ${plan.products.length} product(s). Held products are not touched.`)) return;
    setWriting(true);
    setResult(null);
    try {
      const outcome = await runTabletUpdate({ supabaseUrl: SUPABASE_URL, buildMode: BUILD_MODE, ...tabletUpdateDbDeps(supabase) }, plan, (done, total, current) => setProgress(current ? `Updating ${done + 1} of ${total}: ${current}` : `Finished ${done} of ${total}`));
      setResult(outcome);
      setCheckedFingerprint(null);
    } finally {
      setWriting(false);
    }
  }

  const choice = <T extends string>(name: string, value: T | null, options: Record<T, string>, onChange: (value: T) => void) => (
    <div className="bulk-images-bulk" role="radiogroup" aria-label={name}>
      <strong>{name}</strong>
      {(Object.keys(options) as T[]).map((key) => (
        <label key={key}>
          <input type="radio" name={name} checked={value === key} onChange={() => onChange(key)} /> {options[key]}
        </label>
      ))}
    </div>
  );

  function rows(kind: TabletEntryKind) {
    const list = comparison?.entries.filter((entry) => entry.kind === kind) ?? [];
    if (!list.length) return null;
    const section = SECTIONS.find((item) => item.kind === kind);
    return (
      <div key={kind} style={{ marginTop: 16 }}>
        <h4>
          {kind === "new_product"
            ? `${section?.title} (${new Set(list.map((entry) => entry.productKey)).size}) — ${list.length} variant${list.length === 1 ? "" : "s"}`
            : `${section?.title} (${list.length})`}
        </h4>
        <p className="stock-hint">{section?.help}</p>
        <div className="bulk-images-table">
          <table>
            <thead>
              <tr>
                <th>Product</th>
                <th>RAM / Storage / Colour</th>
                <th>{kind === "price_change" || kind === "show_again" ? "Price now → new" : "Price"}</th>
                <th>{kind === "attention" ? "What to do" : "Notes"}</th>
              </tr>
            </thead>
            <tbody>
              {list.map((entry) => (
                <tr key={entry.id}>
                  <td>
                    <strong>{entry.productTitle ?? entry.line.baseTitle ?? "—"}</strong>
                    <small className="plain">Line {entry.line.lineNumber}: {entry.line.sourceLine}</small>
                    {entry.sku && <small className="plain"><code>{entry.sku}</code> · stock {entry.stock ?? 0}</small>}
                  </td>
                  <td>{variantLabel(entry)}{entry.condition && entry.pta && <small className="plain">{CONDITION_LABEL[entry.condition]} · {PTA_LABEL[entry.pta]}</small>}</td>
                  <td>{kind === "price_change" || kind === "show_again" ? `${formatMinor(entry.currentPriceMinor)} → ${formatMinor(entry.priceMinor)}` : formatMinor(entry.priceMinor)}</td>
                  <td className="stock-resolve">
                    {entry.reasons.map((reason) => (<small className="plain stock-held-note" key={reason}>{reason}</small>))}
                    {entry.notes.map((note) => (<small className="plain" key={note}>{note}</small>))}
                    {entry.colorDecision && (
                      <span className="bulk-images-bulk">
                        <button type="button" className="admin-secondary" disabled={busy || writing} onClick={() => keepColor(entry)}>Keep “{entry.colorDecision.written}”</button>
                      </span>
                    )}
                    {entry.confirmNewProduct && (
                      <span className="bulk-images-bulk">
                        <button type="button" className="admin-secondary" disabled={busy || writing} onClick={() => confirmNewProduct(entry)}>This is a new product</button>
                      </span>
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
  const decisionCount = Object.keys(decisions.colors).length + Object.keys(decisions.newProducts).length;
  const isMacbook = selection.productType === "macbook";

  return (
    <section className="admin-panel stock-update" aria-labelledby="tablet-stock-title">
      <span className="admin-kicker">CATALOG · TABLETS &amp; MACBOOKS STOCK</span>
      <h2 id="tablet-stock-title">Tablets &amp; MacBooks Stock Update (New + Used)</h2>
      <p>Paste the iPad, tablet or MacBook list, check the changes, then update the website. New and Used are separate products. Prices are updated, stock is kept, and products missing from the list are never touched.</p>
      <div className={`bulk-images-env ${supabaseEnvironmentLabel.toLowerCase() === "production" ? "production" : "development"}`} role="status">
        <span>Website</span>
        <strong>{supabaseEnvironmentLabel.toUpperCase()}</strong>
        <small>Check Changes only reads the website.</small>
      </div>

      <div className="stock-step" aria-labelledby="tablet-step-1">
        <h3 id="tablet-step-1"><span className="stock-step-number">1</span> Paste List</h3>
        {choice<TabletProductType>("Product Type", selection.productType, PRODUCT_TYPE_LABEL, (productType) => setSelection({ ...selection, productType }))}
        {choice<TabletCondition>("Condition", selection.condition, CONDITION_LABEL, (condition) => setSelection({ ...selection, condition }))}
        {isMacbook ? (
          <p className="stock-hint">MacBooks: PTA is Not Applicable. Only Apple MacBooks are added — Windows laptops never are.</p>
        ) : (
          choice<TabletConnectivity>("Connectivity", selection.connectivity, CONNECTIVITY_LABEL, (connectivity) => setSelection({ ...selection, connectivity }))
        )}
        <p className="stock-hint">Applies to every line that does not say New / Used, WiFi / 4G / 5G or PTA / Non-PTA itself.</p>
        <label className="stock-field">
          <span>Latest stock list</span>
          <textarea value={text} rows={12} placeholder={"Paste your iPad, tablet or MacBook list here..."} onChange={(event) => setText(event.target.value)} />
        </label>
        <div className="bulk-images-bulk">
          <button type="button" className="admin-primary" disabled={busy || writing || !text.trim()} onClick={() => void check()}>{busy ? "Checking…" : "Check Changes"}</button>
          {decisionCount > 0 && <button type="button" className="admin-secondary" disabled={busy || writing} onClick={undoDecisions}>Undo my {decisionCount} decision(s)</button>}
        </div>
        {error && <p className="bulk-images-error" role="alert">{error}</p>}
      </div>

      {comparison && counts && (
        <div className="stock-step" aria-labelledby="tablet-step-2">
          <h3 id="tablet-step-2"><span className="stock-step-number">2</span> Check Changes</h3>
          {!checkIsCurrent && <p className="stock-hint stock-warning">You changed the list or a choice since this check. Click Check Changes again.</p>}
          <div className="stock-cards" aria-label="Summary">
            {([
              ["New products", plan?.counts.newProducts ?? 0],
              ["New variants", counts.new_variant + counts.new_product],
              ["Price updates", counts.price_change],
              ["Show again", counts.show_again],
              ["Same (no change)", counts.same],
              ["Needs review", counts.attention + counts.unread],
            ] as const).map(([label, value]) => (
              <div className="stock-card" key={label}>
                <strong>{value}</strong>
                <span>{label}</span>
              </div>
            ))}
          </div>
          {SECTIONS.map((section) => rows(section.kind))}
          {comparison.unread.length > 0 && (
            <div style={{ marginTop: 16 }}>
              <h4>Lines not understood ({comparison.unread.length})</h4>
              <ul className="stock-excluded">
                {comparison.unread.map((line) => (<li key={`${line.lineNumber}:${line.reason}`}>Line {line.lineNumber}: “{line.line}” — {line.reason}</li>))}
              </ul>
            </div>
          )}
          {counts.same > 0 && <p className="stock-hint">{counts.same} line(s) are the same as the website and need no change.</p>}
        </div>
      )}

      {comparison && plan && (
        <div className="stock-step" aria-labelledby="tablet-step-3">
          <h3 id="tablet-step-3"><span className="stock-step-number">3</span> Update Website</h3>
          <p>
            {plan.counts.priceUpdates} price update(s) · {plan.counts.shownAgain} shown again · {plan.counts.newVariants} new variant(s) · {plan.counts.newProducts} new product(s) with {plan.counts.newProductVariants} variant(s) — {plan.changeCount} change(s) on {plan.products.length} product(s).
          </p>
          <p className="stock-hint">Nothing is hidden or deleted. Stock of existing variants is not changed. Products that are not in this list are not touched.</p>
          {plan.held.length > 0 && (
            <div className="bulk-images-devreport stock-decisions" aria-label="Held for review">
              <strong>Held for review ({plan.held.length}) — nothing is written for these</strong>
              <ul>
                {plan.held.map((item) => (
                  <li key={item.key}>
                    <span>
                      {item.productTitle}
                      {item.reasons.map((reason) => (<small className="plain" key={reason}>{reason}</small>))}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <p className={`stock-hint${blocker ? " stock-warning" : ""}`} aria-live="polite">{blocker ?? "Ready. Each product is saved on its own: all of its changes or none."}</p>
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
              <thead><tr><th>Product</th><th>Result</th><th>Details</th></tr></thead>
              <tbody>
                {result.products.map((product) => (
                  <tr key={product.key}>
                    <td><strong>{product.productTitle}</strong>{product.newSkus.length > 0 && <small className="plain">New SKUs: {product.newSkus.join(", ")}</small>}</td>
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
          <p className="stock-hint">Click Check Changes again to confirm: updated products then show as Same.</p>
        </div>
      )}
    </section>
  );
}
