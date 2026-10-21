import { useEffect, useMemo, useState } from "react";
import { supabase, supabaseEnvironmentLabel } from "../lib/supabase";
import { loadActiveBrands, loadCatalogForDelta } from "../lib/stockListDeltaDb";
import { formatMinor, identityKey, type CatalogDeltaProduct } from "../lib/stockListDelta";
import {
  CONDITION_LABEL,
  IPHONE_NEW_VARIANT_STOCK,
  PTA_LABEL,
  buildIphonePlan,
  checkFingerprint,
  compareIphoneList,
  emptyDecisions,
  parseIphoneList,
  type IphoneComparison,
  type IphoneCondition,
  type IphoneDecisions,
  type IphoneEntry,
  type IphoneEntryKind,
  type IphonePta,
  type IphoneSelection,
} from "../lib/iphoneStockUpdate";
import { iphoneUpdateBlocker, runIphoneUpdate, type IphoneUpdateResult } from "../lib/iphoneStockApply";
import { iphoneUpdateDbDeps, loadVariantSims, withVariantSims } from "../lib/iphoneStockApplyDb";
import { simConfigurationLabel } from "../lib/variantFacts";
import { installUnloadGuard } from "../lib/unloadGuard";

// Admin "iPhone Stock Update" (New + Used): Paste List -> Check Changes -> Update Website.
// Check Changes is read-only. Update Website writes phone by phone (one all-or-nothing database call each) and only after a
// fresh check of exactly this list, choices and decisions. Phones with any line that needs attention are held, never written.
// Existing variants keep their stock; variants missing from the list are never touched.

/** Owner gate (approved 2026-10-22 for DEV, migrations applied). The write itself is still DEV-only (iphoneStockApply). */
const IPHONE_UPDATE_WEBSITE_ENABLED = true;

const BUILD_MODE: string = import.meta.env.MODE;
const SUPABASE_URL: string | undefined = import.meta.env.VITE_SUPABASE_URL;
const DRAFT_KEY = "isolutions.iphone-stock-update.draft.v1";

type Draft = { text: string; selection: IphoneSelection; decisions: IphoneDecisions };

function readDraft(): Draft {
  const empty: Draft = { text: "", selection: { condition: null, pta: null }, decisions: emptyDecisions() };
  try {
    const raw = window.localStorage.getItem(DRAFT_KEY);
    if (!raw) return empty;
    const value = JSON.parse(raw) as Partial<Draft>;
    const condition = value.selection?.condition === "used" || value.selection?.condition === "brand_new" ? value.selection.condition : null;
    const pta = value.selection?.pta === "approved" || value.selection?.pta === "not_approved" ? value.selection.pta : null;
    return {
      text: typeof value.text === "string" ? value.text : "",
      selection: { condition, pta },
      decisions: { colors: { ...(value.decisions?.colors ?? {}) }, newPhones: { ...(value.decisions?.newPhones ?? {}) } },
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

const SECTIONS: { kind: IphoneEntryKind; title: string; help: string }[] = [
  { kind: "attention", title: "Needs your attention", help: "These lines are not written until you decide. Their whole phone waits; every other phone still updates." },
  { kind: "new_phone", title: "New phones", help: `Created as drafts (not on the storefront until images are added and you publish). Every variant starts with stock ${IPHONE_NEW_VARIANT_STOCK}.` },
  { kind: "new_variant", title: "New variants", help: `Added to an existing phone with stock ${IPHONE_NEW_VARIANT_STOCK}.` },
  { kind: "price_change", title: "Price changes", help: "Only the price changes. Stock stays exactly as it is." },
  { kind: "show_again", title: "Shown again", help: "Hidden now and listed again: shown with the latest price. Stock stays exactly as it is." },
];

const STATUS_LABEL = { updated: "Updated", failed: "Not saved", unknown: "Check again", needs_check: "Saved — check again", held: "Held for review" } as const;

export function IphoneStockUpdate() {
  const [initial] = useState(readDraft);
  const [text, setText] = useState(initial.text);
  const [selection, setSelection] = useState<IphoneSelection>(initial.selection);
  const [decisions, setDecisions] = useState<IphoneDecisions>(initial.decisions);
  const [catalog, setCatalog] = useState<CatalogDeltaProduct[] | null>(null);
  const [comparison, setComparison] = useState<IphoneComparison | null>(null);
  const [checkedFingerprint, setCheckedFingerprint] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [writing, setWriting] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [result, setResult] = useState<IphoneUpdateResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => writeDraft({ text, selection, decisions }), [text, selection, decisions]);
  useEffect(() => (writing ? installUnloadGuard(window) : undefined), [writing]);

  const fingerprint = checkFingerprint(text, selection, decisions);
  const checkIsCurrent = checkedFingerprint === fingerprint;
  const plan = useMemo(() => (comparison && catalog ? buildIphonePlan(comparison, catalog) : null), [comparison, catalog]);
  const blocker = iphoneUpdateBlocker({ supabaseUrl: SUPABASE_URL, buildMode: BUILD_MODE, enabled: IPHONE_UPDATE_WEBSITE_ENABLED, checkIsCurrent, plan });

  async function check(nextDecisions: IphoneDecisions = decisions) {
    if (!supabase) {
      setError("The website connection is not configured.");
      return;
    }
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const [brands, loaded, sims] = await Promise.all([loadActiveBrands(supabase), loadCatalogForDelta(supabase), loadVariantSims(supabase)]);
      const products = withVariantSims(loaded, sims);
      const parsed = parseIphoneList(text, brands);
      setCatalog(products);
      setComparison(compareIphoneList(parsed, products, selection, nextDecisions));
      setCheckedFingerprint(checkFingerprint(text, selection, nextDecisions));
    } catch (problem) {
      setError(`Could not read the website: ${problem instanceof Error ? problem.message : String(problem)}`);
    } finally {
      setBusy(false);
    }
  }

  /** A decision re-runs the check, so the page always shows what would really be written. */
  function decide(next: IphoneDecisions) {
    setDecisions(next);
    if (comparison) void check(next);
  }

  const chooseColor = (entry: IphoneEntry, color: string) => decide({ ...decisions, colors: { ...decisions.colors, [entry.line.lineKey]: color } });
  const confirmNewPhone = (entry: IphoneEntry) => entry.productTitle && decide({ ...decisions, newPhones: { ...decisions.newPhones, [identityKey(entry.productTitle)]: true } });
  const undoDecisions = () => decide(emptyDecisions());

  async function update() {
    if (!supabase || !plan || blocker) return;
    if (!window.confirm(`Update the ${supabaseEnvironmentLabel.toUpperCase()} website now? ${plan.changeCount} change(s) on ${plan.phones.length} phone(s). Held phones are not touched.`)) return;
    setWriting(true);
    setResult(null);
    try {
      const outcome = await runIphoneUpdate({ supabaseUrl: SUPABASE_URL, buildMode: BUILD_MODE, ...iphoneUpdateDbDeps(supabase) }, plan, (done, total, current) => setProgress(current ? `Updating ${done + 1} of ${total}: ${current}` : `Finished ${done} of ${total}`));
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

  function rows(kind: IphoneEntryKind) {
    const list = comparison?.entries.filter((entry) => entry.kind === kind) ?? [];
    if (!list.length) return null;
    const section = SECTIONS.find((item) => item.kind === kind);
    return (
      <div key={kind} style={{ marginTop: 16 }}>
        <h4>
          {kind === "new_phone"
            ? `${section?.title} (${new Set(list.map((entry) => entry.phoneKey)).size}) — ${list.length} variant${list.length === 1 ? "" : "s"}`
            : `${section?.title} (${list.length})`}
        </h4>
        <p className="stock-hint">{section?.help}</p>
        <div className="bulk-images-table">
          <table>
            <thead>
              <tr>
                <th>Phone</th>
                <th>Storage / Colour</th>
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
                  <td>{[entry.storage, entry.color].filter(Boolean).join(" ") || "—"}{entry.condition && entry.pta && <small className="plain">{CONDITION_LABEL[entry.condition]} · {PTA_LABEL[entry.pta]}{entry.sim && ` · ${simConfigurationLabel(entry.sim)}`}</small>}</td>
                  <td>{kind === "price_change" || kind === "show_again" ? `${formatMinor(entry.currentPriceMinor)} → ${formatMinor(entry.priceMinor)}` : formatMinor(entry.priceMinor)}</td>
                  <td className="stock-resolve">
                    {entry.reasons.map((reason) => (<small className="plain stock-held-note" key={reason}>{reason}</small>))}
                    {entry.notes.map((note) => (<small className="plain" key={note}>{note}</small>))}
                    {entry.colorDecision && (
                      <span className="bulk-images-bulk">
                        {entry.colorDecision.suggestion && (
                          <button type="button" className="admin-secondary" disabled={busy || writing} onClick={() => chooseColor(entry, entry.colorDecision?.suggestion as string)}>Use “{entry.colorDecision.suggestion}”</button>
                        )}
                        <button type="button" className="admin-secondary" disabled={busy || writing} onClick={() => chooseColor(entry, entry.colorDecision?.written as string)}>Keep “{entry.colorDecision.written}”</button>
                      </span>
                    )}
                    {entry.confirmNewPhone && (
                      <span className="bulk-images-bulk">
                        <button type="button" className="admin-secondary" disabled={busy || writing} onClick={() => confirmNewPhone(entry)}>This is a new phone</button>
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
  const decisionCount = Object.keys(decisions.colors).length + Object.keys(decisions.newPhones).length;

  return (
    <section className="admin-panel stock-update" aria-labelledby="iphone-stock-title">
      <span className="admin-kicker">CATALOG · IPHONE STOCK</span>
      <h2 id="iphone-stock-title">iPhone Stock Update (New + Used)</h2>
      <p>Paste the iPhone list, check the changes, then update the website. New and Used iPhones are separate phones. Prices are updated, stock is kept, and phones missing from the list are never touched.</p>
      <div className={`bulk-images-env ${supabaseEnvironmentLabel.toLowerCase() === "production" ? "production" : "development"}`} role="status">
        <span>Website</span>
        <strong>{supabaseEnvironmentLabel.toUpperCase()}</strong>
        <small>Check Changes only reads the website.</small>
      </div>

      <div className="stock-step" aria-labelledby="iphone-step-1">
        <h3 id="iphone-step-1"><span className="stock-step-number">1</span> Paste List</h3>
        {choice<IphoneCondition>("Condition", selection.condition, { brand_new: "New", used: "Used" }, (condition) => setSelection({ ...selection, condition }))}
        {choice<IphonePta>("PTA", selection.pta, { approved: "PTA Approved", not_approved: "Non-PTA" }, (pta) => setSelection({ ...selection, pta }))}
        <p className="stock-hint">Applies to every line that does not say New / Used or PTA / Non-PTA itself.</p>
        <label className="stock-field">
          <span>Latest iPhone stock list</span>
          <textarea value={text} rows={12} placeholder={"IPhone 15Pro Max 512Gb\nBlue @298,000\nBlack @298,000\n\nIPhone 14Pro Max 256Gb\nPurple @230,000\nGold @235,000"} onChange={(event) => setText(event.target.value)} />
        </label>
        <div className="bulk-images-bulk">
          <button type="button" className="admin-primary" disabled={busy || writing || !text.trim()} onClick={() => void check()}>{busy ? "Checking…" : "Check Changes"}</button>
          {decisionCount > 0 && <button type="button" className="admin-secondary" disabled={busy || writing} onClick={undoDecisions}>Undo my {decisionCount} decision(s)</button>}
        </div>
        {error && <p className="bulk-images-error" role="alert">{error}</p>}
      </div>

      {comparison && counts && (
        <div className="stock-step" aria-labelledby="iphone-step-2">
          <h3 id="iphone-step-2"><span className="stock-step-number">2</span> Check Changes</h3>
          {!checkIsCurrent && <p className="stock-hint stock-warning">You changed the list or a choice since this check. Click Check Changes again.</p>}
          <div className="stock-cards" aria-label="Summary">
            {([
              ["New phones", plan?.counts.newPhones ?? 0],
              ["New variants", counts.new_variant + counts.new_phone],
              ["Price changes", counts.price_change],
              ["Shown again", counts.show_again],
              ["Same (no change)", counts.same],
              ["Needs attention", counts.attention + counts.unread],
              ["Skipped", counts.skipped],
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
                {comparison.unread.map((line) => (<li key={line.lineNumber}>Line {line.lineNumber}: “{line.line}” — {line.reason}</li>))}
              </ul>
            </div>
          )}
          {comparison.skipped.length > 0 && (
            <div style={{ marginTop: 16 }}>
              <h4>Skipped ({comparison.skipped.length})</h4>
              <p className="stock-hint">A price with no colour. Nothing is created and nothing on the website is changed for these lines.</p>
              <ul className="stock-excluded">
                {comparison.skipped.map((line) => (<li key={line.lineNumber}>Line {line.lineNumber}: {line.model ? `${line.model} — ` : ""}“{line.line}”</li>))}
              </ul>
            </div>
          )}
          {counts.same > 0 && <p className="stock-hint">{counts.same} line(s) are the same as the website and need no change.</p>}
        </div>
      )}

      {comparison && plan && (
        <div className="stock-step" aria-labelledby="iphone-step-3">
          <h3 id="iphone-step-3"><span className="stock-step-number">3</span> Update Website</h3>
          <p>
            {plan.counts.priceUpdates} price change(s) · {plan.counts.shownAgain} shown again · {plan.counts.newVariants} new variant(s) · {plan.counts.newPhones} new phone(s) with {plan.counts.newPhoneVariants} variant(s) — {plan.changeCount} change(s) on {plan.phones.length} phone(s).
          </p>
          <p className="stock-hint">Nothing is hidden or deleted. Stock of existing variants is not changed. Phones that are not in this list are not touched.</p>
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
          <p className={`stock-hint${blocker ? " stock-warning" : ""}`} aria-live="polite">{blocker ?? "Ready. Each phone is saved on its own: all of its changes or none."}</p>
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
              <thead><tr><th>Phone</th><th>Result</th><th>Details</th></tr></thead>
              <tbody>
                {result.phones.map((phone) => (
                  <tr key={phone.key}>
                    <td><strong>{phone.productTitle}</strong>{phone.newSkus.length > 0 && <small className="plain">New SKUs: {phone.newSkus.join(", ")}</small>}</td>
                    <td>{STATUS_LABEL[phone.status]}</td>
                    <td>
                      {phone.changes.map((change) => (<small className="plain" key={change}>{change}</small>))}
                      {phone.reasons.map((reason) => (<small className="plain stock-held-note" key={reason}>{reason}</small>))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="stock-hint">Click Check Changes again to confirm: updated phones then show as Same.</p>
        </div>
      )}
    </section>
  );
}
