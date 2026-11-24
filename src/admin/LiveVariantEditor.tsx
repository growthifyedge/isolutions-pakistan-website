import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, Plus, ShieldCheck, Trash2 } from "lucide-react";
import { supabase } from "../lib/supabase";
import { formatPkrMinor, pkrMajorInputFromMinor } from "../lib/money";
import { conditionLabel, deliveryLabel, ptaLabel } from "../lib/variantFacts";
import {
  LIVE_KIND_LABEL,
  LIVE_OPENING_STOCK,
  buildLiveReview,
  inheritedFacts,
  liveConfirmationPhrase,
  liveEditEnvironmentBlocker,
  liveVariantLabel,
  verifyLiveSave,
  type LiveKind,
  type LiveReview,
  type LiveVariant,
  type NewVariantInput,
} from "../lib/liveVariantEdit";
import { readLiveVariants, saveLiveReview } from "../lib/liveVariantEditDb";

const BUILD_MODE: string = import.meta.env.MODE;
const SUPABASE_URL: string | undefined = import.meta.env.VITE_SUPABASE_URL;
const emptyRow = (): NewVariantInput => ({ ram: "", storage: "", color: "", price: "" });

/**
 * Variants & Pricing for a LIVE Android phone, iPhone, tablet or MacBook: edit prices in the table (and add Android
 * variants), review Old vs New, then ONE server-checked save through the product's Stock Update function.
 * Stock, compare-at, PTA, condition, warranty and delivery are read-only here.
 */
export function LiveVariantEditor({ productId, title, kind, stockPage, onSaved }: { productId: string; title: string; kind: LiveKind; stockPage: { href: string; label: string } | null; onSaved: () => void }) {
  const [variants, setVariants] = useState<LiveVariant[] | null>(null);
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [prices, setPrices] = useState<Record<string, string>>({});
  const [rows, setRows] = useState<NewVariantInput[]>([]);
  const [review, setReview] = useState<LiveReview | null>(null);
  const [confirmation, setConfirmation] = useState("");
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string; details: string[] } | null>(null);
  const [loadError, setLoadError] = useState("");
  const environmentBlocker = liveEditEnvironmentBlocker(SUPABASE_URL, BUILD_MODE);
  const openingStock = LIVE_OPENING_STOCK[kind];

  const load = useCallback(async () => {
    if (!supabase) return;
    try {
      const [fresh, stock] = await Promise.all([
        readLiveVariants(supabase, productId),
        supabase.from("admin_variant_inventory").select("variant_id,quantity_on_hand").eq("product_id", productId),
      ]);
      setVariants(fresh);
      setQuantities(Object.fromEntries((stock.data ?? []).map((row) => [row.variant_id as string, Number(row.quantity_on_hand)])));
      setPrices(Object.fromEntries(fresh.map((variant) => [variant.id, pkrMajorInputFromMinor(variant.priceMinor)])));
      setLoadError("");
    } catch (problem) {
      setLoadError(problem instanceof Error ? problem.message : String(problem));
    }
  }, [productId]);
  useEffect(() => {
    void load();
  }, [load]);

  // Any edit after Review makes the review stale: it must be reviewed again before saving.
  const edited = () => {
    setReview(null);
    setConfirmation("");
    setResult(null);
  };
  const changedIds = useMemo(
    () => new Set((variants ?? []).filter((variant) => (prices[variant.id] ?? "").trim() !== pkrMajorInputFromMinor(variant.priceMinor)).map((variant) => variant.id)),
    [variants, prices],
  );
  const copied = useMemo(() => (variants && kind === "android" ? inheritedFacts(variants) : null), [variants, kind]);

  if (loadError) return <p className="live-variant-error" role="alert">{loadError}</p>;
  if (!variants) return <p>Loading variants…</p>;

  const runReview = () => {
    setResult(null);
    setConfirmation("");
    setReview(buildLiveReview({ kind, productId, title, variants, priceInputs: prices, newRows: rows }));
  };
  const discard = () => {
    setPrices(Object.fromEntries(variants.map((variant) => [variant.id, pkrMajorInputFromMinor(variant.priceMinor)])));
    setRows([]);
    edited();
  };
  const phrase = review ? liveConfirmationPhrase(review) : "";
  const saveBlocker =
    environmentBlocker ??
    (!review ? "Click Review changes first." : review.problems.length ? "Fix the problems listed above first." : review.changeCount === 0 ? "Nothing to save — no price was changed." : confirmation.trim() !== phrase ? `Type ${phrase} to confirm.` : null);

  const save = async () => {
    if (!supabase || !review || saveBlocker) return;
    setSaving(true);
    setResult(null);
    const before = variants;
    try {
      await saveLiveReview(supabase, review);
      const after = await readLiveVariants(supabase, productId);
      const issues = verifyLiveSave(review, after, before);
      setResult(
        issues.length
          ? { ok: false, text: "Saved by the server, but the check after saving found differences — please look at the variants below.", details: issues }
          : { ok: true, text: `Saved: ${review.changes.length} price change${review.changes.length === 1 ? "" : "s"}${review.additions.length ? `, ${review.additions.length} new variant${review.additions.length === 1 ? "" : "s"} (opening stock ${openingStock})` : ""}.`, details: [] },
      );
      setReview(null);
      setConfirmation("");
      setRows([]);
      await load();
      onSaved();
    } catch (problem) {
      const unknown = Boolean(problem && typeof problem === "object" && "saved" in problem && (problem as { saved: unknown }).saved === "unknown");
      const text = problem instanceof Error ? problem.message : String(problem);
      const stale = /changed_since_check|changed since/i.test(text);
      setResult({
        ok: false,
        text: unknown
          ? "No answer from the website — the change may or may not be saved. Reload this page and check the prices before trying again."
          : stale
            ? "Nothing was saved: this product was changed by someone else since this page loaded. Reload the variants and make your changes again."
            : "Nothing was saved — the server refused the change.",
        details: [text],
      });
      if (stale) setReview(null);
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="live-variant-editor" aria-label="Edit live variants">
      <div className="validation-callout">
        <ShieldCheck />
        <div>
          <strong>Live product — prices{kind === "android" ? " and new variants" : ""} are saved through the {LIVE_KIND_LABEL[kind]} server check</strong>
          <p>
            Change prices in the table{kind === "android" ? " and add new variants" : ""}, then Review changes and Save once. Nothing is saved until you confirm. Stock, compare-at price, PTA,
            condition, warranty and delivery of a live product are read-only here.
            {kind !== "android" && stockPage && <> New variants and hidden variants: <a href={stockPage.href}>{stockPage.label}</a>.</>}
          </p>
        </div>
      </div>

      <div className="live-variant-table-wrap">
        <table className="live-variant-table">
          <thead>
            <tr>
              <th>SKU</th>
              <th>RAM</th>
              <th>Storage</th>
              <th>Colour</th>
              <th>Price (Rs)</th>
              <th>Compare-at</th>
              <th>Stock</th>
              <th>PTA</th>
              <th>Condition</th>
              <th>Warranty</th>
              <th>Delivery</th>
              <th>Website</th>
            </tr>
          </thead>
          <tbody>
            {variants.map((variant) => {
              const locked = !variant.isActive && kind !== "android";
              return (
                <tr key={variant.id} className={[variant.isActive ? "" : "is-hidden", changedIds.has(variant.id) ? "is-changed" : ""].filter(Boolean).join(" ") || undefined}>
                  <td><code>{variant.sku}</code></td>
                  <td>{variant.ram ?? "—"}</td>
                  <td>{variant.storage ?? "—"}</td>
                  <td>{variant.color ?? "—"}</td>
                  <td>
                    <input
                      inputMode="numeric"
                      aria-label={`Price for ${variant.sku} ${liveVariantLabel(variant)}`}
                      value={prices[variant.id] ?? ""}
                      disabled={locked || saving}
                      title={locked ? `Hidden: change its price on the ${LIVE_KIND_LABEL[kind]} page (shows it again)` : undefined}
                      onChange={(event) => {
                        setPrices({ ...prices, [variant.id]: event.target.value });
                        edited();
                      }}
                    />
                    {changedIds.has(variant.id) && <small>was {formatPkrMinor(variant.priceMinor)}</small>}
                  </td>
                  <td>{variant.compareAtPriceMinor === null ? "—" : formatPkrMinor(variant.compareAtPriceMinor)}</td>
                  <td>{quantities[variant.id] ?? 0}</td>
                  <td>{ptaLabel(variant.ptaStatus)}</td>
                  <td>{conditionLabel(variant.condition)}</td>
                  <td>{variant.warrantyOverride ?? "—"}</td>
                  <td>{deliveryLabel(variant.deliveryScope)}</td>
                  <td>{variant.isActive ? "Visible" : "Hidden"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {kind === "android" && (
        <div className="live-variant-new">
          <h3>Add new variant</h3>
          {copied?.facts ? (
            <p>
              A new variant copies this phone's <strong>{ptaLabel(copied.facts.pta_status)}</strong>, <strong>{conditionLabel(copied.facts.condition)}</strong>, warranty{" "}
              <strong>{copied.facts.warranty_override ?? "—"}</strong> and <strong>{deliveryLabel(copied.facts.delivery_scope)}</strong>. Opening stock is fixed at{" "}
              <strong>{openingStock}</strong> (Android Stock Update rule); a SKU is given automatically.
            </p>
          ) : (
            <p className="live-variant-error">{copied?.problem}</p>
          )}
          {rows.map((row, index) => (
            <div className="live-variant-new-row" key={index}>
              <label>RAM<input value={row.ram} placeholder="12" disabled={saving} onChange={(event) => { setRows(rows.map((item, at) => (at === index ? { ...item, ram: event.target.value } : item))); edited(); }} /></label>
              <label>Storage<input value={row.storage} placeholder="512" disabled={saving} onChange={(event) => { setRows(rows.map((item, at) => (at === index ? { ...item, storage: event.target.value } : item))); edited(); }} /></label>
              <label>Colour<input value={row.color} placeholder="Cobalt" disabled={saving} onChange={(event) => { setRows(rows.map((item, at) => (at === index ? { ...item, color: event.target.value } : item))); edited(); }} /></label>
              <label>Price (Rs)<input value={row.price} inputMode="numeric" placeholder="440000" disabled={saving} onChange={(event) => { setRows(rows.map((item, at) => (at === index ? { ...item, price: event.target.value } : item))); edited(); }} /></label>
              <span className="live-variant-fixed">Stock {openingStock} (fixed)</span>
              <button type="button" className="admin-secondary" aria-label={`Remove new variant ${index + 1}`} disabled={saving} onClick={() => { setRows(rows.filter((_, at) => at !== index)); edited(); }}><Trash2 /></button>
            </div>
          ))}
          <button type="button" className="admin-secondary" disabled={saving || !copied?.facts} onClick={() => { setRows([...rows, emptyRow()]); edited(); }}>
            <Plus /> Add new variant
          </button>
        </div>
      )}

      <div className="live-variant-actions">
        <button type="button" className="admin-primary" disabled={saving} onClick={runReview}>Review changes</button>
        <button type="button" className="admin-secondary" disabled={saving} onClick={discard}>Discard changes</button>
      </div>

      {review && (
        <div className="live-variant-review" aria-label="Review changes">
          <h3>Review changes — nothing is saved yet</h3>
          {review.problems.length > 0 && (
            <div className="live-variant-problems" role="alert">
              <strong><AlertTriangle /> Fix before saving</strong>
              <ul>{review.problems.map((problem) => <li key={problem}>{problem}</li>)}</ul>
            </div>
          )}
          {review.changes.length > 0 && (
            <table className="live-variant-table">
              <thead><tr><th>SKU</th><th>Variant</th><th>Old price</th><th>New price</th><th>Difference</th></tr></thead>
              <tbody>
                {review.changes.map((change) => (
                  <tr key={change.variantId}>
                    <td><code>{change.sku}</code></td>
                    <td>{change.label}{change.hidden ? " (hidden — stays hidden)" : ""}</td>
                    <td>{formatPkrMinor(change.fromMinor)}</td>
                    <td><strong>{formatPkrMinor(change.toMinor)}</strong></td>
                    <td className={change.toMinor < change.fromMinor ? "is-down" : "is-up"}>{change.toMinor < change.fromMinor ? "−" : "+"}{formatPkrMinor(Math.abs(change.toMinor - change.fromMinor))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {review.additions.length > 0 && (
            <table className="live-variant-table">
              <thead><tr><th>New variant</th><th>Price</th><th>Opening stock</th><th>PTA</th><th>Condition</th><th>Warranty</th><th>Delivery</th></tr></thead>
              <tbody>
                {review.additions.map((add) => (
                  <tr key={add.row}>
                    <td>{add.ram} / {add.storage} / {add.color}</td>
                    <td><strong>{formatPkrMinor(add.priceMinor)}</strong></td>
                    <td><strong>{add.stock}</strong> (fixed)</td>
                    <td>{ptaLabel(add.inherited.pta_status)}</td>
                    <td>{conditionLabel(add.inherited.condition)}</td>
                    <td>{add.inherited.warranty_override ?? "—"}</td>
                    <td>{deliveryLabel(add.inherited.delivery_scope)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {review.notes.length > 0 && <ul className="live-variant-notes">{review.notes.map((note) => <li key={note}>{note}</li>)}</ul>}
          {!review.problems.length && review.changeCount === 0 && <p>No price was changed.</p>}
          <p className="live-variant-untouched">Every other variant, all stock, compare-at prices, PTA, condition, warranty, delivery, images and specifications stay exactly as they are.</p>
          {!review.problems.length && review.changeCount > 0 && (
            <div className="live-variant-confirm">
              <label>
                <span>Type <strong>{phrase}</strong> to confirm</span>
                <input value={confirmation} disabled={saving || Boolean(environmentBlocker)} onChange={(event) => setConfirmation(event.target.value)} />
              </label>
              <button type="button" className="admin-primary" disabled={Boolean(saveBlocker) || saving} onClick={() => void save()}>
                {saving ? "Saving…" : `Save ${review.changeCount} change${review.changeCount === 1 ? "" : "s"}`}
              </button>
              {saveBlocker && <small>{saveBlocker}</small>}
            </div>
          )}
        </div>
      )}

      {result && (
        <div className={result.ok ? "live-variant-result ok" : "live-variant-result failed"} role="status">
          {result.ok ? <CheckCircle2 /> : <AlertTriangle />}
          <div>
            <strong>{result.text}</strong>
            {result.details.length > 0 && <ul>{result.details.map((detail) => <li key={detail}>{detail}</li>)}</ul>}
          </div>
        </div>
      )}
    </section>
  );
}
