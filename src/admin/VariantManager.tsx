import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, Plus, ShieldCheck, Trash2 } from "lucide-react";
import { supabase } from "../lib/supabase";
import {
  CONDITION_CHOICES,
  applyPricingEdit,
  DELIVERY_CHOICES,
  PTA_CHOICES,
  buildVariantEditPlan,
  display,
  editEnvironmentBlocker,
  newRowDefaults,
  rowFromVariant,
  variantName,
  verifyVariantEdit,
  type EditPlan,
  type EditorVariant,
  type RowInput,
} from "../lib/variantEditor";
import { VariantSaveError, readEditorVariants, readIsOwner, saveVariantEdits } from "../lib/variantEditorDb";

const BUILD_MODE: string = import.meta.env.MODE;
const SUPABASE_URL: string | undefined = import.meta.env.VITE_SUPABASE_URL;
type TextKey = "ram_display" | "storage_display" | "color_finish" | "price" | "compare_at" | "discount" | "warranty_override" | "stock";
const NEW_LABEL: Record<string, string> = { ram_display: "RAM", storage_display: "Storage", color_finish: "Colour", price: "Price", compare_at: "Compare-at price", discount: "Discount %", stock: "Opening stock", pta_status: "PTA", condition: "Condition", delivery_scope: "Delivery" };

/**
 * Catalog → Variants & Pricing (Owner): edit any field of any variant, add variants, review Old → New, then ONE
 * server-checked, all-or-nothing save (apply_product_variant_edits). Works for draft and published products; a
 * published product stays published and can never be left unpublishable.
 */
export function VariantManager({ productId, published, mobilePhone, onSaved }: { productId: string; published: boolean; mobilePhone: boolean; onSaved: () => void }) {
  const [variants, setVariants] = useState<EditorVariant[] | null>(null);
  const [rows, setRows] = useState<Record<string, RowInput>>({});
  const [newRows, setNewRows] = useState<RowInput[]>([]);
  const [plan, setPlan] = useState<EditPlan | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [owner, setOwner] = useState<boolean | null>(null);
  const [loadError, setLoadError] = useState("");
  const [result, setResult] = useState<{ ok: boolean; text: string; details: string[] } | null>(null);
  const environmentBlocker = editEnvironmentBlocker(SUPABASE_URL, BUILD_MODE);

  const load = useCallback(async () => {
    if (!supabase) return;
    try {
      const [fresh, isOwner] = await Promise.all([readEditorVariants(supabase, productId), readIsOwner(supabase)]);
      setVariants(fresh);
      setRows(Object.fromEntries(fresh.map((variant) => [variant.id, rowFromVariant(variant)])));
      setOwner(isOwner);
      setLoadError("");
    } catch (problem) {
      setLoadError(problem instanceof Error ? problem.message : String(problem));
    }
  }, [productId]);
  useEffect(() => {
    void load();
  }, [load]);

  const changed = useMemo(() => {
    const cells = new Set<string>();
    for (const variant of variants ?? []) {
      const now = rows[variant.id];
      if (!now) continue;
      const was = rowFromVariant(variant);
      for (const key of Object.keys(was) as (keyof RowInput)[]) if (String(now[key]).trim() !== String(was[key]).trim()) cells.add(`${variant.id}:${key}`);
    }
    return cells;
  }, [variants, rows]);

  if (loadError) return <p className="live-variant-error" role="alert">{loadError}</p>;
  if (!variants) return <p>Loading variants…</p>;

  const edited = () => {
    setPlan(null);
    setConfirmOpen(false);
    setResult(null);
  };
  // Price, Compare-at and Discount % are linked (Price = Compare-at × (1 − Discount % / 100)); other fields are plain.
  const editRow = (row: RowInput, key: keyof RowInput, value: string | boolean): RowInput =>
    (key === "price" || key === "compare_at" || key === "discount") && typeof value === "string" ? applyPricingEdit(row, key, value) : { ...row, [key]: value };
  const setCell = (id: string, key: keyof RowInput, value: string | boolean) => {
    setRows({ ...rows, [id]: editRow(rows[id], key, value) });
    edited();
  };
  const setNew = (index: number, key: keyof RowInput, value: string | boolean) => {
    setNewRows(newRows.map((row, at) => (at === index ? editRow(row, key, value) : row)));
    edited();
  };
  const review = () => {
    setResult(null);
    setConfirmOpen(false);
    setPlan(buildVariantEditPlan({ productId, mobilePhone, variants, rows, newRows }));
  };
  const discard = () => {
    setRows(Object.fromEntries(variants.map((variant) => [variant.id, rowFromVariant(variant)])));
    setNewRows([]);
    edited();
  };
  // No typed phrase (Owner decision 2026-11-24): Save all opens a Confirm/Cancel dialog showing the change count; every other check stays.
  const saveBlocker =
    environmentBlocker ??
    (owner === false ? "Only the Owner can save variant changes." : null) ??
    (!plan ? "Click Review changes first." : plan.problems.length ? "Fix the problems listed above first." : plan.changeCount === 0 ? "Nothing to save — nothing was changed." : null);

  const save = async () => {
    if (!supabase || !plan?.payload || saveBlocker) return;
    setConfirmOpen(false);
    setSaving(true);
    setResult(null);
    const before = variants;
    try {
      await saveVariantEdits(supabase, plan.payload);
      const after = await readEditorVariants(supabase, productId);
      const issues = verifyVariantEdit(plan, before, after);
      const fieldCount = plan.updates.reduce((sum, update) => sum + update.diffs.length, 0);
      setResult(
        issues.length
          ? { ok: false, text: "Saved by the server, but the check after saving found differences — please look at the variants below.", details: issues }
          : { ok: true, text: `Saved and checked: ${fieldCount} field change${fieldCount === 1 ? "" : "s"}, ${plan.stock.length} stock change${plan.stock.length === 1 ? "" : "s"}, ${plan.adds.length} new variant${plan.adds.length === 1 ? "" : "s"}.`, details: [] },
      );
      setPlan(null);
      setNewRows([]);
      await load();
      onSaved();
    } catch (problem) {
      const text = problem instanceof Error ? problem.message : String(problem);
      const unknown = problem instanceof VariantSaveError && problem.saved === "unknown";
      const stale = /changed_since_load|changed since the page loaded/i.test(text);
      setResult({
        ok: false,
        text: unknown
          ? "No answer from the website — the change may or may not be saved. Reload this page and check before trying again."
          : stale
            ? "Nothing was saved: this product was changed (by someone else or an order) since this page loaded. Reload the variants and make your changes again."
            : "Nothing was saved — the server refused the change.",
        details: [text.replace(/^variant_editor_[a-z_]+: /, "")],
      });
    } finally {
      setSaving(false);
    }
  };

  const cls = (id: string, key: keyof RowInput) => (changed.has(`${id}:${key}`) ? (key === "stock" ? "is-stock-changed" : "is-changed") : undefined);
  const text = (id: string, key: TextKey, label: string, width?: number) => (
    <input className={cls(id, key)} style={width ? { width } : undefined} aria-label={label} value={String(rows[id][key])} disabled={saving} onChange={(event) => setCell(id, key, event.target.value)} />
  );
  const select = (id: string, key: "pta_status" | "condition" | "delivery_scope", label: string, choices: readonly (readonly [string, string])[], current: string | null) => (
    <select className={cls(id, key)} aria-label={label} value={rows[id][key]} disabled={saving} onChange={(event) => setCell(id, key, event.target.value)}>
      {rows[id][key] === "" && <option value="">{current ? `Keep: ${display(key, current)}` : "Not set"}</option>}
      {choices.map(([value, name]) => (
        <option key={value} value={value} disabled={key === "delivery_scope" && mobilePhone && value !== "karachi_only"}>{name}</option>
      ))}
    </select>
  );

  return (
    <section className="live-variant-editor variant-manager" aria-label="Edit variants">
      <div className="validation-callout">
        <ShieldCheck />
        <div>
          <strong>Edit any field, then Review changes and Save all — one server-checked save</strong>
          <p>
            Every change is checked again on the server and saved all together or not at all. Stock changes are recorded in the inventory history. A colour rename keeps the same
            SKU, images, stock and order history.{published ? " This product stays published; a change that would break its publish rules is refused." : ""}
            {mobilePhone ? " Mobile phones are delivered in Karachi only." : ""}
          </p>
          {owner === false && <p className="live-variant-error">You are signed in as Admin: only the Owner can save variant changes.</p>}
          {environmentBlocker && <p className="live-variant-error">{environmentBlocker}</p>}
        </div>
      </div>

      <div className="live-variant-table-wrap">
        <table className="live-variant-table variant-manager-table">
          <thead>
            <tr>
              <th>SKU</th><th>RAM</th><th>Storage</th><th>Colour</th><th>Price (Rs)</th><th>Compare-at (Rs)</th><th>Discount %</th><th>Stock</th>
              <th>PTA</th><th>Condition</th><th>Warranty</th><th>Delivery</th><th>Visible</th>
            </tr>
          </thead>
          <tbody>
            {variants.map((variant) => (
              <tr key={variant.id} className={rows[variant.id].is_active ? undefined : "is-hidden"}>
                <td><code>{variant.sku}</code></td>
                <td>{text(variant.id, "ram_display", `RAM of ${variant.sku}`, 70)}</td>
                <td>{text(variant.id, "storage_display", `Storage of ${variant.sku}`, 80)}</td>
                <td>{text(variant.id, "color_finish", `Colour of ${variant.sku}`, 110)}</td>
                <td>{text(variant.id, "price", `Price of ${variant.sku}`, 100)}</td>
                <td>{text(variant.id, "compare_at", `Compare-at price of ${variant.sku}`, 100)}</td>
                <td>{text(variant.id, "discount", `Discount % of ${variant.sku}`, 62)}</td>
                <td>{text(variant.id, "stock", `Stock of ${variant.sku}`, 64)}</td>
                <td>{select(variant.id, "pta_status", `PTA of ${variant.sku}`, PTA_CHOICES, variant.pta_status)}</td>
                <td>{select(variant.id, "condition", `Condition of ${variant.sku}`, CONDITION_CHOICES, variant.condition)}</td>
                <td>{text(variant.id, "warranty_override", `Warranty of ${variant.sku}`, 90)}</td>
                <td>{select(variant.id, "delivery_scope", `Delivery of ${variant.sku}`, DELIVERY_CHOICES, variant.delivery_scope)}</td>
                <td>
                  <input type="checkbox" className={cls(variant.id, "is_active")} aria-label={`${variant.sku} visible on the website`} checked={rows[variant.id].is_active} disabled={saving} onChange={(event) => setCell(variant.id, "is_active", event.target.checked)} />
                </td>
              </tr>
            ))}
            {newRows.map((row, index) => (
              <tr key={`new-${index}`} className="is-new">
                <td><strong>New</strong></td>
                {(["ram_display", "storage_display", "color_finish", "price", "compare_at", "discount", "stock"] as const).map((key) => (
                  <td key={key}><input aria-label={`${NEW_LABEL[key]} of new variant ${index + 1}`} value={String(row[key])} placeholder={{ ram_display: "12 GB", storage_display: "512 GB", color_finish: "Cobalt", price: "440000", compare_at: "optional", discount: "e.g. 20", stock: "0" }[key]} disabled={saving} onChange={(event) => setNew(index, key, event.target.value)} /></td>
                ))}
                {(["pta_status", "condition", "warranty_override", "delivery_scope"] as const).map((key) =>
                  key === "warranty_override" ? (
                    <td key={key}><input aria-label={`Warranty of new variant ${index + 1}`} value={row.warranty_override} placeholder="optional" disabled={saving} onChange={(event) => setNew(index, key, event.target.value)} /></td>
                  ) : (
                    <td key={key}>
                      <select aria-label={`${NEW_LABEL[key]} of new variant ${index + 1}`} value={row[key]} disabled={saving} onChange={(event) => setNew(index, key, event.target.value)}>
                        <option value="">Choose…</option>
                        {(key === "pta_status" ? PTA_CHOICES : key === "condition" ? CONDITION_CHOICES : DELIVERY_CHOICES).map(([value, name]) => (
                          <option key={value} value={value} disabled={key === "delivery_scope" && mobilePhone && value !== "karachi_only"}>{name}</option>
                        ))}
                      </select>
                    </td>
                  ),
                )}
                <td>
                  <input type="checkbox" aria-label={`New variant ${index + 1} visible on the website`} checked={row.is_active} disabled={saving} onChange={(event) => setNew(index, "is_active", event.target.checked)} />
                  <button type="button" className="variant-manager-remove" aria-label={`Remove new variant ${index + 1}`} disabled={saving} onClick={() => { setNewRows(newRows.filter((_, at) => at !== index)); edited(); }}><Trash2 /></button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="live-variant-actions">
        <button type="button" className="admin-secondary" disabled={saving} onClick={() => { setNewRows([...newRows, newRowDefaults(variants, mobilePhone)]); edited(); }}>
          <Plus /> Add variant
        </button>
        <button type="button" className="admin-primary" disabled={saving} onClick={review}>Review changes</button>
        <button type="button" className="admin-secondary" disabled={saving} onClick={discard}>Discard changes</button>
      </div>

      {plan && (
        <div className="live-variant-review" aria-label="Review changes">
          <h3>Review changes — nothing is saved yet</h3>
          {plan.problems.length > 0 && (
            <div className="live-variant-problems" role="alert">
              <strong><AlertTriangle /> Fix before saving</strong>
              <ul>{plan.problems.map((problem) => <li key={problem}>{problem}</li>)}</ul>
            </div>
          )}
          {plan.updates.length > 0 && (
            <>
              <h4>Field changes</h4>
              <table className="live-variant-table">
                <thead><tr><th>SKU</th><th>Variant</th><th>Field</th><th>Old</th><th>New</th></tr></thead>
                <tbody>
                  {plan.updates.flatMap((update) =>
                    update.diffs.map((diff) => (
                      <tr key={`${update.variantId}-${diff.field}`}>
                        <td><code>{update.sku}</code></td>
                        <td>{update.name.replace(/^\S+ \(|\)$/g, "")}</td>
                        <td>{diff.label}</td>
                        <td>{diff.from}</td>
                        <td><strong>{diff.to}</strong></td>
                      </tr>
                    )),
                  )}
                </tbody>
              </table>
            </>
          )}
          {plan.stock.length > 0 && (
            <div className="variant-manager-stock">
              <h4>Stock adjustments (recorded in the inventory history)</h4>
              <table className="live-variant-table">
                <thead><tr><th>SKU</th><th>Variant</th><th>Stock now</th><th>New stock</th><th>Adjustment</th></tr></thead>
                <tbody>
                  {plan.stock.map((change) => (
                    <tr key={change.variantId}>
                      <td><code>{change.sku}</code></td>
                      <td>{change.name.replace(/^\S+ \(|\)$/g, "")}</td>
                      <td>{change.from}</td>
                      <td><strong>{change.to}</strong></td>
                      <td className={change.to < change.from ? "is-up" : "is-down"}>{change.to > change.from ? "+" : ""}{change.to - change.from}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {plan.adds.length > 0 && (
            <div className="variant-manager-new">
              <h4>New variants (a SKU is given automatically)</h4>
              <table className="live-variant-table">
                <thead><tr><th>Variant</th><th>Price</th><th>Compare-at</th><th>Opening stock</th><th>PTA</th><th>Condition</th><th>Warranty</th><th>Delivery</th><th>Website</th></tr></thead>
                <tbody>
                  {plan.adds.map((add) => (
                    <tr key={add.row}>
                      <td>{variantName(add.values as unknown as EditorVariant)}</td>
                      <td><strong>{display("price_minor", add.values.price_minor)}</strong></td>
                      <td>{display("compare_at_price_minor", add.values.compare_at_price_minor)}</td>
                      <td><strong>{add.stock}</strong></td>
                      <td>{display("pta_status", add.values.pta_status)}</td>
                      <td>{display("condition", add.values.condition)}</td>
                      <td>{display("warranty_override", add.values.warranty_override)}</td>
                      <td>{display("delivery_scope", add.values.delivery_scope)}</td>
                      <td>{display("is_active", add.values.is_active)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {!plan.problems.length && plan.changeCount === 0 && <p>Nothing was changed.</p>}
          <p className="live-variant-untouched">Only the fields listed above change. Every other field, every other variant, images, specifications and order history stay exactly as they are.</p>
          {!plan.problems.length && plan.changeCount > 0 && (
            <div className="live-variant-confirm">
              <button type="button" className="admin-primary" disabled={Boolean(saveBlocker) || saving || confirmOpen} onClick={() => setConfirmOpen(true)}>
                {saving ? "Saving…" : `Save all (${plan.changeCount})`}
              </button>
              {saveBlocker && <small>{saveBlocker}</small>}
            </div>
          )}
        </div>
      )}

      {confirmOpen && plan && !saveBlocker && (
        <div className="bulk-images-dialog-backdrop">
          <div className="bulk-images-dialog" role="dialog" aria-modal="true" aria-labelledby="variant-save-confirm-title">
            <h3 id="variant-save-confirm-title">Save {plan.changeCount} change{plan.changeCount === 1 ? "" : "s"}?</h3>
            <p>All changes are saved together or not at all, and checked again on the server.</p>
            <div className="bulk-images-dialog-actions">
              <button type="button" className="admin-secondary" disabled={saving} onClick={() => setConfirmOpen(false)}>Cancel</button>
              <button type="button" className="admin-primary" disabled={saving} onClick={() => void save()}>Confirm</button>
            </div>
          </div>
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
