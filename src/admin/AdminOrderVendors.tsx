import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2 } from "lucide-react";
import { formatPkrMinor } from "../lib/catalog";
import { orderStatusLabel, type OrderStatus } from "../lib/orderRules";
import { supabase } from "../lib/supabase";
import {
  FULFILMENT_STATUSES, type FulfilmentStatus, type VendorCode, canReassign, isReleasedToVendors, liveFulfilments,
  orderPartiallyCancelled, releaseBlocker, suggestVendor, vendorErrorMessage,
} from "../lib/vendorOrders";
import {
  VENDOR_NOTIFICATION_COLUMNS, VENDOR_NOTIFICATION_FUNCTION, type VendorNotification, hasDeliverableNotification,
  notificationLabel,
} from "../lib/vendorNotifications";

// Admin Orders: Two-Vendor assignment, release and per-vendor status (migrations 202611150002 + 202611150003).
// Every write goes through an Admin RPC that re-checks the rules (D1 assign-before-release, D3 reassign only while
// Received, D7 per-vendor status). Before release each item is preselected with its suggested vendor; nothing is
// saved until the Admin clicks Confirm & Release, which saves every item's vendor and releases the vendor parts in
// ONE server-side call (admin_confirm_and_release_order): it either fully succeeds or changes nothing.

export type Vendor = { id: string; code: VendorCode; name: string; sort_order: number };
export type VendorOrderItem = {
  id: string; product_id: string | null; vendor_id: string | null; product_title_snapshot: string; sku_snapshot: string;
  quantity: number; line_total_minor: number; products?: { categories: { slug: string } | null } | null;
};
export type Fulfilment = {
  id: string; vendor_id: string; status: FulfilmentStatus; released_at: string; stock_restored_at: string | null; updated_at: string;
};
export type VendorOrder = {
  id: string; order_number: string; status: OrderStatus; order_items: VendorOrderItem[]; order_fulfilments?: Fulfilment[];
};


const dateTime = (date: string) => new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(date));
const suggestion = (item: VendorOrderItem) => suggestVendor({ productId: item.product_id, categorySlug: item.products?.categories?.slug });
type Confirm = { kind: "part"; part: Fulfilment; status: FulfilmentStatus } | { kind: "cancel-open" } | null;

export function AdminOrderVendors({ order, vendors, disabled, onChanged }: {
  order: VendorOrder; vendors: Vendor[]; disabled: boolean; onChanged: () => Promise<void>;
}) {
  const byId = useMemo(() => new Map(vendors.map((vendor) => [vendor.id, vendor])), [vendors]);
  const byCode = useMemo(() => new Map(vendors.map((vendor) => [vendor.code, vendor])), [vendors]);
  const savedCode = (item: VendorOrderItem) => (item.vendor_id ? byId.get(item.vendor_id)?.code ?? "" : "") as VendorCode | "";
  const savedKey = order.order_items.map((item) => `${item.id}:${item.vendor_id ?? ""}`).join("|");
  const [draft, setDraft] = useState<Record<string, VendorCode | "">>({});
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [confirm, setConfirm] = useState<Confirm>(null);
  // Start from what is saved whenever the order or its saved assignment changes; before release an unsaved item is
  // preselected with its suggested vendor (the Admin can change it; nothing is assigned at checkout).
  useEffect(() => {
    const preselect = !isReleasedToVendors(order);
    setDraft(Object.fromEntries(order.order_items.map((item) =>
      [item.id, savedCode(item) || (preselect ? suggestion(item) ?? "" : "")])));
    setConfirm(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [order.id, savedKey, vendors.length]);
  useEffect(() => { setMessage(null); }, [order.id]);

  // Vendor email status (migration 202611160001). Best-effort and read-only here: any error (table not there yet,
  // function not deployed, provider not configured) only hides the status line; it never affects order actions.
  const [notes, setNotes] = useState<VendorNotification[]>([]);
  const loadNotes = async () => {
    if (!supabase) return [];
    const { data, error } = await supabase.from("vendor_order_notifications").select(VENDOR_NOTIFICATION_COLUMNS).eq("order_id", order.id);
    const rows = error ? [] : (data ?? []) as VendorNotification[];
    setNotes(rows);
    return rows;
  };
  const deliverNotes = async (rows: VendorNotification[]) => {
    if (!supabase || !hasDeliverableNotification(rows)) return;
    try { await supabase.functions.invoke(VENDOR_NOTIFICATION_FUNCTION, { body: {} }); } catch { /* retried later */ }
    await loadNotes();
  };
  const fulfilmentKey = (order.order_fulfilments ?? []).map((part) => part.id).join("|");
  useEffect(() => {
    let active = true;
    void loadNotes().then((rows) => { if (active) void deliverNotes(rows); });
    return () => { active = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [order.id, fulfilmentKey]);
  const noteByPart = new Map(notes.map((note) => [note.fulfilment_id, note]));
  const retryNote = async (note: VendorNotification) => {
    if (!supabase) return;
    const { error } = await supabase.rpc("admin_retry_vendor_notification", { p_id: note.id });
    if (error) { setMessage({ tone: "error", text: "Could not re-queue the email." }); return; }
    await deliverNotes(await loadNotes());
  };

  const released = isReleasedToVendors(order);
  const parts = [...liveFulfilments(order)].sort((left, right) =>
    (byId.get(left.vendor_id)?.sort_order ?? 0) - (byId.get(right.vendor_id)?.sort_order ?? 0));
  const partByVendor = new Map((order.order_fulfilments ?? []).map((part) => [part.vendor_id, part]));
  const changed = order.order_items.filter((item) => (draft[item.id] ?? "") !== savedCode(item));
  const dirty = changed.length > 0;
  const blocker = releaseBlocker(order.order_items.map((item) => ({ vendor: draft[item.id] || null })));
  const assignable = !released && order.status !== "completed" && order.status !== "cancelled";
  const releasable = !released && (order.status === "new" || order.status === "confirmed");
  const locked = disabled || busy;

  const run = async (call: () => PromiseLike<{ error: { message: string } | null }>, ok: string) => {
    if (!supabase || busy) return;
    setBusy(true); setMessage(null); setConfirm(null);
    const { error } = await call();
    setMessage(error ? { tone: "error", text: vendorErrorMessage(error.message) } : { tone: "ok", text: ok });
    setBusy(false);
    await onChanged();
  };
  // After release (D3): move items between vendor parts that are still Received.
  const moveItems = () => run(() => supabase!.rpc("admin_assign_order_items", {
    p_order_id: order.id,
    p_assignments: changed.map((item) => ({ item_id: item.id, vendor: draft[item.id] || null })),
  }), "Items moved.");
  const releaseNames = vendors.filter((vendor) => order.order_items.some((item) => draft[item.id] === vendor.code))
    .map((vendor) => vendor.name).join(" and ");
  // Before release: one atomic call saves every item's vendor and releases the vendor parts.
  const confirmAndRelease = () => run(() => supabase!.rpc("admin_confirm_and_release_order", {
    p_order_id: order.id,
    p_assignments: order.order_items.map((item) => ({ item_id: item.id, vendor: draft[item.id] || null })),
  }), `Released to ${releaseNames}. Each vendor now sees only its own items on the Staff Dashboard.`);
  const setPartStatus = (part: Fulfilment, status: FulfilmentStatus) => run(
    () => supabase!.rpc("admin_set_fulfilment_status", { p_fulfilment_id: part.id, p_status: status }),
    `${byId.get(part.vendor_id)?.name ?? "Vendor"} changed to ${orderStatusLabel(status)}.`);
  const cancelOpen = () => run(() => supabase!.rpc("admin_cancel_open_fulfilments", { p_order_id: order.id }),
    "All open vendor parts cancelled.");

  // D3 in the UI: a released item can move only between vendor parts that are still Received.
  const targetAllowed = (item: VendorOrderItem, code: VendorCode) => {
    const source = item.vendor_id ? partByVendor.get(item.vendor_id)?.status ?? null : null;
    const target = byCode.get(code) ? partByVendor.get(byCode.get(code)!.id)?.status ?? null : null;
    return savedCode(item) === code || canReassign(source, target);
  };
  const openParts = parts.filter((part) => part.status === "confirmed" || part.status === "processing" || part.status === "in_transit");

  if (!vendors.length) return <section className="ao-vendors"><h3>Vendors</h3><p className="ao-vendor-note">Vendor assignment is available once migration 202611150002 is applied to this database.</p></section>;

  return <section className="ao-vendors" aria-label="Vendors">
    <div className="ao-vendor-head">
      <h3>Vendors</h3>
      {released ? <span className="ao-vendor-tag">Released to {parts.length === 1 ? "1 vendor" : `${parts.length} vendors`}</span> : <span className="ao-vendor-tag pending">Not released</span>}
    </div>
    {message ? <p className={`ao-vendor-msg ${message.tone}`} role={message.tone === "ok" ? "status" : "alert"}>{message.text}</p> : null}
    {released && orderPartiallyCancelled(order) ? <p className="ao-partial"><AlertTriangle aria-hidden="true" />Partially cancelled: one vendor part is cancelled, the rest continues. Order totals are unchanged.</p> : null}

    {released ? <div className="ao-parts">{parts.map((part) => {
      const vendor = byId.get(part.vendor_id);
      const lines = order.order_items.filter((item) => item.vendor_id === part.vendor_id);
      return <article key={part.id} className={`ao-part ${part.status} vendor-${vendor?.code ?? "unknown"}`}>
        <div className="ao-part-head">
          <span className="ao-part-vendor"><span className="ao-vendor-mark" aria-hidden="true">{(vendor?.name ?? "V").charAt(0)}</span><strong>{vendor?.name ?? "Vendor"}</strong></span>
          <span className={`order-status ${part.status}`}>{orderStatusLabel(part.status)}</span>
        </div>
        <ul>{lines.map((item) => <li key={item.id}><span>{item.quantity} × {item.product_title_snapshot}</span><small>{formatPkrMinor(item.line_total_minor)}</small></li>)}</ul>
        <div className="ao-part-total"><span>Items subtotal</span><strong>{formatPkrMinor(lines.reduce((sum, item) => sum + item.line_total_minor, 0))}</strong></div>
        <p className="ao-part-meta">Released {dateTime(part.released_at)}{part.stock_restored_at ? " · stock returned" : ""}</p>
        {(() => {
          const note = noteByPart.get(part.id);
          const label = notificationLabel(note);
          if (!note || !label) return null;
          return <p className={`ao-part-email ${label.tone}`}>{label.text}
            {note.status === "failed" ? <button type="button" className="ao-link" disabled={locked} onClick={() => void retryNote(note)}>Retry email</button> : null}
          </p>;
        })()}
        <label className="ao-part-status"><span>Vendor status</span>
          <select value={part.status} disabled={locked || part.status === "cancelled"} onChange={(event) => {
            const next = event.target.value as FulfilmentStatus;
            if (next === "cancelled") setConfirm({ kind: "part", part, status: next }); else void setPartStatus(part, next);
          }}>{FULFILMENT_STATUSES.map((status) => <option key={status} value={status}>{orderStatusLabel(status)}</option>)}</select>
        </label>
        {part.status === "cancelled" ? <small className="ao-vendor-note">Cancelled vendor parts are final.</small> : null}
      </article>;
    })}</div> : null}

    {!released && assignable ? <div className="ao-assign">
      <p className="ao-vendor-note">Each item is preselected with its suggested vendor (Home Gadgets = Piyavey; everything else, incl. watches / bands = iSolutions Pakistan). Change any item if needed, then confirm.</p>
      <ul>{order.order_items.map((item) => {
        const suggested = suggestion(item);
        const value = draft[item.id] ?? "";
        return <li key={item.id}>
          <div><strong>{item.product_title_snapshot}</strong><small>{item.sku_snapshot} · Qty {item.quantity} · {formatPkrMinor(item.line_total_minor)}{suggested ? value === suggested ? " · Suggested" : ` · Suggested: ${byCode.get(suggested)?.name ?? suggested}` : " · No suggestion (unknown category)"}</small></div>
          <select aria-label={`Vendor for ${item.product_title_snapshot}`} value={value} disabled={locked}
            onChange={(event) => setDraft((current) => ({ ...current, [item.id]: event.target.value as VendorCode | "" }))}>
            <option value="">Choose vendor…</option>
            {vendors.map((vendor) => <option key={vendor.id} value={vendor.code}>{vendor.name}</option>)}
          </select>
        </li>;
      })}</ul>
      {releasable ? <button type="button" className="ao-apply ao-release" disabled={locked || Boolean(blocker)} onClick={() => void confirmAndRelease()}>
        <CheckCircle2 aria-hidden="true" />{busy ? "Releasing…" : "Confirm & Release"}
      </button> : null}
      {blocker ? <small className="ao-vendor-note pending">{blocker}</small>
        : !releasable ? <small className="ao-vendor-note pending">Only New or Received orders can be released to vendors.</small> : null}
    </div> : null}

    {released ? <details className="ao-move">
      <summary>Move items between vendors</summary>
      <div className="ao-assign">
        <p className="ao-vendor-note">Only while both vendor parts are still Received.</p>
        <ul>{order.order_items.map((item) => <li key={item.id}>
          <div><strong>{item.product_title_snapshot}</strong><small>{item.sku_snapshot} · Qty {item.quantity}</small></div>
          <select aria-label={`Vendor for ${item.product_title_snapshot}`} value={draft[item.id] ?? ""} disabled={locked}
            onChange={(event) => setDraft((current) => ({ ...current, [item.id]: event.target.value as VendorCode | "" }))}>
            {vendors.map((vendor) => <option key={vendor.id} value={vendor.code} disabled={!targetAllowed(item, vendor.code)}>{vendor.name}</option>)}
          </select>
        </li>)}</ul>
        <button type="button" className="ao-apply" disabled={locked || !dirty} onClick={() => void moveItems()}>{busy ? "Saving…" : "Move items"}</button>
      </div>
    </details> : null}

    {!released && !assignable ? <p className="ao-vendor-note">Not released to vendors. Delivered and cancelled orders keep their existing status handling.</p> : null}

    {released && openParts.length ? <button type="button" className="ao-apply danger ao-cancel-open" disabled={locked} onClick={() => setConfirm({ kind: "cancel-open" })}>Cancel all open vendor parts</button> : null}

    {confirm ? <div className="ao-overlay" onClick={() => setConfirm(null)}>
      <div className="ao-dialog" role="dialog" aria-modal="true" aria-labelledby="ao-vendor-confirm" onClick={(event) => event.stopPropagation()}>
        <h2 id="ao-vendor-confirm">{confirm.kind === "part" ? `Cancel the ${byId.get(confirm.part.vendor_id)?.name ?? "vendor"} part of ${order.order_number}?` : `Cancel all open vendor parts of ${order.order_number}?`}</h2>
        <div className="ao-warning"><AlertTriangle aria-hidden="true" /><div><strong>This cannot be undone.</strong><p>{confirm.kind === "part"
          ? "Only this vendor's items are cancelled and their stock is returned once. The other vendor is not affected."
          : "Every Received / In Process / In Transit vendor part is cancelled and its stock returned once. Delivered parts stay Delivered."}</p></div></div>
        <div className="ao-dialog-actions">
          <button type="button" className="admin-secondary" onClick={() => setConfirm(null)}>Keep</button>
          <button type="button" className="ao-apply danger" onClick={() => void (confirm.kind === "part" ? setPartStatus(confirm.part, confirm.status) : cancelOpen())}>Yes, cancel</button>
        </div>
      </div>
    </div> : null}
  </section>;
}
