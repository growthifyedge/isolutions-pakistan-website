import { type FormEvent, useEffect, useMemo, useRef, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { ArrowLeft, Bell, Check, LogOut, MapPin, MessageCircle, Phone, RefreshCw, Store, X } from "lucide-react";
import { formatPkrMinor } from "../lib/catalog";
import { type OrderStatus, STAFF_STATUS_TRANSITIONS, orderStatusLabel } from "../lib/orderRules";
import {
  STAFF_ACTION_LABELS, STAFF_POLL_MS, splitStaffOrders, staffErrorMessage, telHref, unseenOrderIds, whatsappHref,
} from "../lib/staffOrders";
import { supabase } from "../lib/supabase";
import "./staff.css";

// Staff Orders Dashboard (Phase 2, vendor-scoped since 202611150002). The database decides what this account may see
// and change: staff_list_fulfilments returns only this staff account's vendor parts (its own items and item subtotal,
// never other vendors' lines or whole-order totals), and the only writes are the staff_set_fulfilment_status and
// staff_mark_fulfilment_seen RPCs. Staff have no direct table access. Nothing here can edit prices, customers or stock.
// Each card is one vendor part of an order ("fulfilment"); `id` below is the fulfilment id.

type OrderItem = {
  id: string; product_title_snapshot: string; sku_snapshot: string;
  variant_attributes_snapshot: Record<string, string | null>;
  quantity: number; unit_price_minor: number; line_total_minor: number;
};
type StaffOrder = {
  id: string; order_number: string; customer_name: string; phone: string; email: string | null;
  city: string; other_city: string | null; full_delivery_address: string; area_landmark: string | null; order_notes: string | null;
  payment_method: "cash_on_delivery" | "bank_transfer"; shipping_method: "standard" | "fast";
  /** Sum of this vendor's own lines only (D5: no whole-order totals, fees or coupons for staff). */
  vendor_subtotal_minor: number;
  status: OrderStatus; created_at: string; released_at: string; order_items: OrderItem[]; is_seen: boolean;
};
/** One row of staff_list_fulfilments (202611150002). */
type FulfilmentRow = Omit<StaffOrder, "id" | "created_at" | "order_items"> & {
  fulfilment_id: string; order_id: string; order_created_at: string; items: OrderItem[];
};
const toStaffOrder = (row: FulfilmentRow): StaffOrder => ({
  ...row, id: row.fulfilment_id, created_at: row.order_created_at, order_items: row.items ?? [],
  vendor_subtotal_minor: Number(row.vendor_subtotal_minor),
});
type StatusEvent = { id: number; event: "status_changed" | "released"; from_status: OrderStatus | null; to_status: OrderStatus; actor_role: string | null; created_at: string };
type Access = "checking" | "signed-out" | "denied" | "ready";

const paymentLabel = (value: StaffOrder["payment_method"]) => value === "cash_on_delivery" ? "Cash on Delivery" : "Bank Transfer";
const dateTime = (date: string) => new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(date));
const humanize = (value: string) => value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
const attributeName = (key: string) => ({ ram: "RAM", ptaStatus: "PTA" }[key] ?? humanize(key));
const itemAttributes = (item: OrderItem) => Object.entries(item.variant_attributes_snapshot ?? {})
  .filter(([, value]) => value && value.trim()).map(([key, value]) => `${attributeName(key)}: ${humanize(value!)}`).join(" · ");
const BRAND_LOGO = "/assets/branding/isolutions-pakistan-logo-v2-256.webp";
/** Fulfilment progress shown as steps (display only; the allowed changes come from STAFF_STATUS_TRANSITIONS). */
const PROGRESS_STEPS: OrderStatus[] = ["confirmed", "processing", "in_transit", "completed"];
const place = (order: StaffOrder) => order.city === "Karachi" ? "Karachi" : order.other_city || "Other city";
const itemCount = (order: StaffOrder) => order.order_items.reduce((sum, item) => sum + item.quantity, 0);

export function StaffApp() {
  const [access, setAccess] = useState<Access>("checking");
  const [accessMessage, setAccessMessage] = useState("");
  const [session, setSession] = useState<Session | null>(null);
  const [vendorName, setVendorName] = useState("");

  useEffect(() => {
    document.title = "Staff Orders | iSolutions Pakistan";
    const robots = document.createElement("meta");
    robots.name = "robots"; robots.content = "noindex, nofollow";
    document.head.appendChild(robots);
    return () => robots.remove();
  }, []);

  const verify = async (current: Session | null) => {
    setSession(current);
    if (!supabase || !current) { setAccess("signed-out"); return; }
    const { data, error } = await supabase.rpc("is_order_staff");
    if (error) { setAccess("denied"); setAccessMessage(staffErrorMessage(error.message)); return; }
    if (data === true) {
      const vendor = await supabase.rpc("staff_current_vendor");
      setVendorName(((vendor.data ?? []) as Array<{ name: string }>)[0]?.name ?? "");
      setAccess("ready"); setAccessMessage(""); return;
    }
    setAccess("denied");
    setAccessMessage("This account is not an active Staff account of a vendor. The Staff Dashboard needs a Staff login.");
  };

  useEffect(() => {
    if (!supabase) { setAccess("signed-out"); setAccessMessage("Supabase is not configured."); return; }
    void supabase.auth.getSession().then(({ data }) => verify(data.session));
    const { data } = supabase.auth.onAuthStateChange((event, current) => {
      if (event === "SIGNED_OUT") { setSession(null); setAccess("signed-out"); }
      else if (event === "TOKEN_REFRESHED") setSession(current);
    });
    return () => data.subscription.unsubscribe();
  }, []);

  const signOut = async () => { await supabase?.auth.signOut(); setSession(null); setAccess("signed-out"); };

  if (access === "checking") return <div className="staff-app"><div className="staff-center">Checking your sign-in…</div></div>;
  if (access === "ready" && session) return <StaffDashboard session={session} vendorName={vendorName} onSignOut={signOut} />;
  if (access === "denied") return <div className="staff-app"><div className="staff-center staff-card-box">
    <img className="staff-login-logo" src={BRAND_LOGO} alt="iSolutions Pakistan" width={72} height={72} />
    <h1>Staff Orders</h1><p className="staff-error" role="alert">{accessMessage}</p>
    <button type="button" className="staff-btn primary" onClick={() => void signOut()}>Sign out</button>
  </div></div>;
  return <StaffLogin onSignedIn={verify} message={accessMessage} />;
}

function StaffLogin({ onSignedIn, message }: { onSignedIn: (session: Session | null) => Promise<void>; message: string }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!supabase || busy) return;
    setBusy(true); setError("");
    const { data, error: signInError } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    setBusy(false);
    if (signInError) { setError("Sign-in failed. Check the email and password."); return; }
    setPassword("");
    await onSignedIn(data.session);
  };
  return <div className="staff-app"><form className="staff-center staff-card-box staff-login" onSubmit={(event) => void submit(event)}>
    <img className="staff-login-logo" src={BRAND_LOGO} alt="" width={72} height={72} />
    <span className="staff-kicker">iSolutions Pakistan</span>
    <h1>Staff Orders</h1>
    <p>Sign in with your Staff account.</p>
    {message ? <p className="staff-error" role="alert">{message}</p> : null}
    <label>Email<input type="email" autoComplete="username" required value={email} onChange={(event) => setEmail(event.target.value)} /></label>
    <label>Password<input type="password" autoComplete="current-password" required value={password} onChange={(event) => setPassword(event.target.value)} /></label>
    {error ? <p className="staff-error" role="alert">{error}</p> : null}
    <button type="submit" className="staff-btn primary" disabled={busy}>{busy ? "Signing in…" : "Sign in"}</button>
  </form></div>;
}

function StaffDashboard({ session, vendorName, onSignOut }: { session: Session; vendorName: string; onSignOut: () => Promise<void> }) {
  const [orders, setOrders] = useState<StaffOrder[]>([]);
  const [seen, setSeen] = useState<Set<string>>(() => new Set());
  const [tab, setTab] = useState<"active" | "history">("active");
  const [openId, setOpenId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [banner, setBanner] = useState("");
  const knownUnseen = useRef<Set<string> | null>(null);

  const load = async () => {
    if (!supabase) return;
    const result = await supabase.rpc("staff_list_fulfilments");
    if (result.error) {
      setError(staffErrorMessage(result.error.message));
      setLoading(false);
      return;
    }
    const rows = ((result.data ?? []) as unknown as FulfilmentRow[]).map(toStaffOrder);
    const seenIds = new Set(rows.filter((row) => row.is_seen).map((row) => row.id));
    // In-app notice when new unseen orders arrive while the dashboard is open.
    const unseenNow = unseenOrderIds(rows, seenIds);
    if (knownUnseen.current) {
      const fresh = unseenNow.filter((id) => !knownUnseen.current!.has(id)).length;
      if (fresh) setBanner(`${fresh} new ${fresh === 1 ? "order" : "orders"} received`);
    }
    knownUnseen.current = new Set(unseenNow);
    setOrders(rows); setSeen(seenIds); setError(""); setLoading(false);
  };

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => { if (document.visibilityState === "visible") void load(); }, STAFF_POLL_MS);
    const onVisible = () => { if (document.visibilityState === "visible") void load(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => { window.clearInterval(timer); document.removeEventListener("visibilitychange", onVisible); };
  }, []);

  const { active, history } = useMemo(() => splitStaffOrders(orders), [orders]);
  const unseen = useMemo(() => new Set(unseenOrderIds(orders, seen)), [orders, seen]);
  const shown = tab === "active" ? active : history;
  const open = orders.find((order) => order.id === openId) ?? null;

  const openOrder = async (order: StaffOrder) => {
    setOpenId(order.id);
    window.scrollTo({ top: 0 });
    if (!supabase || seen.has(order.id)) return;
    const { error: seenError } = await supabase.rpc("staff_mark_fulfilment_seen", { p_fulfilment_id: order.id });
    if (!seenError) {
      setSeen((current) => new Set(current).add(order.id));
      knownUnseen.current?.delete(order.id);
    }
  };

  return <div className="staff-app">
    <header className="staff-top">
      <div className="staff-brand">
        <img className="staff-logo" src={BRAND_LOGO} alt="" width={40} height={40} />
        <div><strong>iSolutions Pakistan</strong><span>Staff Orders</span></div>
      </div>
      <div className="staff-top-actions">
        <button type="button" className="staff-icon" aria-label="Refresh" onClick={() => void load()}><RefreshCw /></button>
        <button type="button" className="staff-icon" aria-label={`Sign out ${session.user.email ?? ""}`} onClick={() => void onSignOut()}><LogOut /></button>
      </div>
    </header>

    <div className="staff-hero">
      <div><span className="staff-hero-label"><Store aria-hidden="true" />Vendor</span><strong className="staff-hero-vendor">{vendorName || "Vendor"}</strong></div>
      <dl className="staff-hero-stats">
        <div><dt>Active</dt><dd>{loading ? "–" : active.length}</dd></div>
        <div className={unseen.size ? "attention" : ""}><dt>New</dt><dd>{loading ? "–" : unseen.size}</dd></div>
      </dl>
    </div>

    {banner ? <div className="staff-banner" role="status"><Bell aria-hidden="true" /><span>{banner}</span><button type="button" aria-label="Dismiss" onClick={() => setBanner("")}><X /></button></div> : null}
    {error ? <div className="staff-error-box" role="alert">{error}<button type="button" onClick={() => void load()}>Retry</button></div> : null}

    <div className={`staff-layout${open ? " has-detail" : ""}`}>
      <section className="staff-list" aria-label="Orders">
        <div className="staff-tabs" role="tablist">
          <button type="button" role="tab" aria-selected={tab === "active"} className={tab === "active" ? "active" : ""} onClick={() => setTab("active")}>
            Active <span className="staff-count">{active.length}</span>{unseen.size ? <span className="staff-badge" aria-label={`${unseen.size} new`}>{unseen.size} new</span> : null}
          </button>
          <button type="button" role="tab" aria-selected={tab === "history"} className={tab === "history" ? "active" : ""} onClick={() => setTab("history")}>
            History <span className="staff-count">{history.length}</span>
          </button>
        </div>
        {loading ? <p className="staff-empty">Loading orders…</p> : shown.length ? <ul className="staff-cards">
          {shown.map((order) => <li key={order.id}>
            <article className={`staff-card${order.id === openId ? " open" : ""}${unseen.has(order.id) ? " unseen" : ""}`}>
              <button type="button" className="staff-card-main" onClick={() => void openOrder(order)} aria-label={`Open ${order.order_number}`}>
                <span className="staff-card-row"><strong>{order.order_number}</strong><span className={`staff-status ${order.status}`}>{orderStatusLabel(order.status)}</span></span>
                <span className="staff-card-name">{unseen.has(order.id) ? <span className="staff-new">NEW</span> : null}{order.customer_name}</span>
                <span className="staff-card-row muted"><span><MapPin aria-hidden="true" />{place(order)}</span><span>{itemCount(order)} {itemCount(order) === 1 ? "item" : "items"} · <b>{formatPkrMinor(order.vendor_subtotal_minor)}</b></span></span>
                <small>{dateTime(order.released_at)}</small>
              </button>
              <ContactButtons phone={order.phone} compact />
            </article>
          </li>)}
        </ul> : <p className="staff-empty">{tab === "active" ? "No active orders right now." : "No delivered or cancelled orders yet."}</p>}
      </section>
      {open ? <OrderDetail key={open.id} order={open} onBack={() => setOpenId(null)} onChanged={load} /> : <aside className="staff-detail-empty">Select an order to see its details.</aside>}
    </div>
  </div>;
}

function ContactButtons({ phone, compact = false }: { phone: string; compact?: boolean }) {
  const tel = telHref(phone);
  const wa = whatsappHref(phone);
  return <div className={`staff-contact${compact ? " compact" : ""}`}>
    {tel ? <a className="staff-btn call" href={tel}><Phone aria-hidden="true" />Call</a> : null}
    {wa ? <a className="staff-btn whatsapp" href={wa} target="_blank" rel="noopener noreferrer"><MessageCircle aria-hidden="true" />WhatsApp</a> : null}
  </div>;
}

function OrderDetail({ order, onBack, onChanged }: { order: StaffOrder; onBack: () => void; onChanged: () => Promise<void> }) {
  const [events, setEvents] = useState<StatusEvent[] | null>(null);
  const [confirm, setConfirm] = useState<OrderStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const nextSteps = STAFF_STATUS_TRANSITIONS[order.status] ?? [];
  const forward = nextSteps.filter((status) => status !== "cancelled");
  const canCancel = nextSteps.includes("cancelled");

  useEffect(() => {
    if (!supabase) return;
    let current = true;
    void supabase.rpc("staff_fulfilment_history", { p_fulfilment_id: order.id })
      .then(({ data }) => { if (current) setEvents((data ?? []) as StatusEvent[]); });
    return () => { current = false; };
  }, [order.id, order.status]);

  const apply = async (next: OrderStatus) => {
    if (!supabase || busy) return;
    setConfirm(null); setBusy(true); setMessage(null);
    const { data, error } = await supabase.rpc("staff_set_fulfilment_status", { p_fulfilment_id: order.id, p_status: next });
    const row = ((data ?? []) as Array<{ id: string; status: OrderStatus }>)[0];
    if (error) setMessage({ tone: "error", text: staffErrorMessage(error.message) });
    else if (!row || row.id !== order.id || row.status !== next) setMessage({ tone: "error", text: "The status was not saved. Refresh and try again." });
    else setMessage({ tone: "ok", text: `Status changed to ${orderStatusLabel(next)}.` });
    setBusy(false);
    await onChanged();
  };
  // Delivered and Cancelled move the order to History, so they are confirmed first.
  const request = (next: OrderStatus) => next === "completed" || next === "cancelled" ? setConfirm(next) : void apply(next);

  return <section className="staff-detail" aria-label={`Order ${order.order_number}`}>
    <div className="staff-detail-head">
      <button type="button" className="staff-back" onClick={onBack}><ArrowLeft aria-hidden="true" />Orders</button>
      <span className={`staff-status ${order.status}`}>{orderStatusLabel(order.status)}</span>
    </div>
    <h2>{order.order_number}</h2>
    <p className="staff-muted">Placed {dateTime(order.created_at)} · Received {dateTime(order.released_at)}</p>
    {order.status === "cancelled" ? null : <ol className="staff-steps" aria-label="Progress">{PROGRESS_STEPS.map((step, index) => {
      const reached = PROGRESS_STEPS.indexOf(order.status) >= index;
      return <li key={step} className={`${reached ? "done" : ""}${order.status === step ? " current" : ""}`} aria-current={order.status === step ? "step" : undefined}>
        <span className="staff-step-dot">{reached ? <Check aria-hidden="true" /> : index + 1}</span><span className="staff-step-label">{orderStatusLabel(step)}</span>
      </li>;
    })}</ol>}

    {message ? <p className={`staff-message ${message.tone}`} role={message.tone === "ok" ? "status" : "alert"}>{message.text}</p> : null}

    <div className="staff-block">
      <h3>Customer</h3>
      <p className="staff-strong">{order.customer_name}</p>
      <p>{order.phone}{order.email ? ` · ${order.email}` : ""}</p>
      <ContactButtons phone={order.phone} />
    </div>

    <div className="staff-block">
      <h3>Delivery</h3>
      <p className="staff-strong">{order.city}{order.other_city ? ` · ${order.other_city}` : ""}</p>
      <p>{order.full_delivery_address}</p>
      {order.area_landmark ? <p><span className="staff-label">Landmark</span> {order.area_landmark}</p> : null}
      <p><span className="staff-label">Shipping</span> {order.shipping_method === "fast" ? "Fast Delivery" : "Standard Delivery"}</p>
      {order.order_notes ? <p className="staff-note"><span className="staff-label">Customer note</span> {order.order_notes}</p> : null}
    </div>

    <div className="staff-block">
      <h3>Items</h3>
      <ul className="staff-items">{order.order_items.map((item) => <li key={item.id}>
        <div><strong>{item.product_title_snapshot}</strong><small>{item.sku_snapshot}{itemAttributes(item) ? ` · ${itemAttributes(item)}` : ""}</small></div>
        <div className="staff-item-price"><span>{item.quantity} × {formatPkrMinor(item.unit_price_minor)}</span><strong>{formatPkrMinor(item.line_total_minor)}</strong></div>
      </li>)}</ul>
    </div>

    <div className="staff-block staff-totals">
      <h3>Payment</h3>
      <p><span>Method</span><strong>{paymentLabel(order.payment_method)}</strong></p>
      <p className="staff-total"><span>Your items subtotal</span><strong>{formatPkrMinor(order.vendor_subtotal_minor)}</strong></p>
      <p className="staff-muted">Your items only. Delivery fee, discounts and the amount to collect are confirmed by the Owner/Admin.</p>
    </div>

    <div className="staff-block">
      <h3>Status history</h3>
      {events === null ? <p className="staff-muted">Loading…</p> : events.length ? <ol className="staff-history">{events.map((event) => <li key={event.id}>
        <strong>{event.event === "released" ? "Received (released to your team)" : orderStatusLabel(event.to_status)}</strong>
        <small>{event.actor_role === "staff" ? "Staff" : event.actor_role ? "Admin" : "System"} · {dateTime(event.created_at)}</small>
      </li>)}</ol> : <p className="staff-muted">No history yet.</p>}
    </div>

    {forward.length || canCancel ? <div className="staff-actions">
      {forward.map((next) => <button key={next} type="button" className="staff-btn primary big" disabled={busy} onClick={() => request(next)}>{busy ? "Saving…" : STAFF_ACTION_LABELS[next]}</button>)}
      {canCancel ? <button type="button" className="staff-btn danger-outline" disabled={busy} onClick={() => request("cancelled")}>{STAFF_ACTION_LABELS.cancelled}</button> : null}
    </div> : <p className="staff-final">This order is {orderStatusLabel(order.status)} and is kept in History.</p>}

    {confirm ? <div className="staff-overlay" onClick={() => setConfirm(null)}>
      <div className="staff-dialog" role="dialog" aria-modal="true" aria-labelledby="staff-confirm-title" onClick={(event) => event.stopPropagation()}>
        <h2 id="staff-confirm-title">{confirm === "cancelled" ? `Cancel ${order.order_number}?` : `Mark ${order.order_number} as Delivered?`}</h2>
        <p>{confirm === "cancelled"
          ? "Cancelled orders are final and cannot be reopened. The stock of your items in this order is returned to inventory automatically. Other vendors' items are not affected."
          : "The order moves to History. Only the Owner/Admin can change it after this."}</p>
        <div className="staff-dialog-actions">
          <button type="button" className="staff-btn" onClick={() => setConfirm(null)}>Go back</button>
          <button type="button" className={`staff-btn ${confirm === "cancelled" ? "danger" : "primary"}`} onClick={() => void apply(confirm)}>
            {confirm === "cancelled" ? "Yes, cancel order" : "Yes, delivered"}
          </button>
        </div>
      </div>
    </div> : null}
  </section>;
}
