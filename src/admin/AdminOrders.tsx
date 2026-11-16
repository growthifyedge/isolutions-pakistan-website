import { useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, Bell, CheckCircle2, ChevronRight, RefreshCw, Search, X } from "lucide-react";
import { formatPkrMinor } from "../lib/catalog";
import {
  BULK_ORDER_STATUSES,
  type BulkOrderStatus,
  CANCELLED_ORDER_FINAL_MESSAGE,
  ORDER_STATUSES,
  SPLIT_ORDER_STATUS_MESSAGE,
  type OrderStatus,
  canChangeOrderStatus,
  chunkOrderIds,
  planBulkStatusUpdate,
  verifyBulkOrderStatusChunk,
  orderStatusLabel,
  verifyOrderStatusUpdate,
} from "../lib/orderRules";
import { supabase } from "../lib/supabase";
import { requestAdminOrderNotification } from "../lib/adminOrderNotifications";
import { isReleasedToVendors, liveFulfilments, orderPartiallyCancelled, vendorLabel } from "../lib/vendorOrders";
import { AdminOrderVendors, type Fulfilment, type Vendor, type VendorOrderItem } from "./AdminOrderVendors";
import "./adminOrders.css";

const BRAND_LOGO = "/assets/branding/isolutions-pakistan-logo-v2-256.webp";

type PaymentMethod = "cash_on_delivery" | "bank_transfer";
type ShippingMethod = "standard" | "fast";
type DeliveryScope = "karachi_only" | "nationwide";
type OrderItem = VendorOrderItem & {
  variant_attributes_snapshot: Record<string, string | null>;
  unit_price_minor: number;
  delivery_scope_snapshot: DeliveryScope; image_url_snapshot: string | null;
};
type Order = {
  id: string; order_number: string; customer_name: string; phone: string;
  email: string | null; city: string; other_city: string | null;
  full_delivery_address: string; area_landmark: string | null; order_notes: string | null;
  payment_method: PaymentMethod; shipping_method: ShippingMethod; shipping_surcharge_minor: number;
  delivery_classification: "karachi_only" | "mixed" | "nationwide";
  subtotal_minor: number; delivery_fee_minor: number | null; total_minor: number;
  coupon_code_snapshot?: string | null; discount_minor?: number; shipping_discount_minor?: number;
  status: OrderStatus; created_at: string; order_items: OrderItem[];
  /** First release to staff/vendors (202611140002); undefined before that migration. */
  released_at?: string | null;
  /** Vendor parts (202611150002); undefined before that migration, empty until released to vendors. */
  order_fulfilments?: Fulfilment[];
};
type StatusEvent = {
  id: number; order_id: string; event: "status_changed" | "released" | "item_reassigned"; from_status: OrderStatus | null;
  to_status: OrderStatus; actor_role: "owner" | "admin" | "staff" | null; created_at: string;
  /** Vendor events (202611150002): NULL / undefined = whole-order event. */
  fulfilment_id?: string | null; vendor_id?: string | null; from_vendor_id?: string | null;
};
type StaffUpdate = StatusEvent & { orders: { order_number: string } | null };
type BulkNotice = { tone: "success" | "warning" | "error"; title: string; lines: string[] };

const statuses = ORDER_STATUSES;
const statusLabel = orderStatusLabel;
/** New / Received order not yet released to vendors (vendor staff cannot see it). */
const awaitingRelease = (order: Order) => order.order_fulfilments !== undefined && !isReleasedToVendors(order) && (order.status === "new" || order.status === "confirmed");
const ORDER_SELECT_VENDORS = "*,order_items(id,product_id,vendor_id,product_title_snapshot,sku_snapshot,variant_attributes_snapshot,quantity,unit_price_minor,line_total_minor,delivery_scope_snapshot,image_url_snapshot,products(categories(slug))),order_fulfilments(id,vendor_id,status,released_at,stock_restored_at,updated_at)";
const ORDER_SELECT_LEGACY = "*,order_items(id,product_id,product_title_snapshot,sku_snapshot,variant_attributes_snapshot,quantity,unit_price_minor,line_total_minor,delivery_scope_snapshot,image_url_snapshot)";
const actorLabel = (role: StatusEvent["actor_role"]) => role === "staff" ? "Staff" : role === "owner" ? "Owner" : role === "admin" ? "Admin" : "System";
/** Staff updates the Admin has already looked at, per Admin account and browser. */
const STAFF_UPDATES_POLL_MS = 60_000;
const seenKey = (userId: string) => `isp-admin-staff-updates-seen:${userId}`;
const readSeen = (userId: string) => { try { return localStorage.getItem(seenKey(userId)); } catch { return null; } };
const writeSeen = (userId: string, value: string) => { try { localStorage.setItem(seenKey(userId), value); } catch { /* storage unavailable */ } };
const paymentLabel = (payment: PaymentMethod) => payment === "cash_on_delivery" ? "Cash on Delivery" : "Bank Transfer";
const paymentShortLabel = (payment: PaymentMethod) => payment === "cash_on_delivery" ? "COD" : "Bank";
const shippingMethodLabel = (method: ShippingMethod) => method === "fast" ? "Fast Delivery" : "Standard Delivery";
const dateTime = (date: string) => new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(date));
const humanizeValue = (value: string) => value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
const attributeLabel = (key: string) => ({ ram: "RAM", storage: "Storage", color: "Color", ptaStatus: "PTA Status", condition: "Condition", warranty: "Warranty" }[key] ?? humanizeValue(key));
const itemAttributes = (item: OrderItem) => Object.entries(item.variant_attributes_snapshot ?? {})
  .filter(([, value]) => value && value.trim())
  .map(([key, value]) => `${attributeLabel(key)}: ${humanizeValue(value!)}`)
  .join(" · ");
const deliveryClassificationLabel = (value: Order["delivery_classification"]) => value === "karachi_only" ? "Karachi Only" : value === "nationwide" ? "Nationwide" : "Mixed";
const deliveryFeeDisplay = (order: Order) => {
  // Orders created before the fixed Rs 200 base delivery fee may have no stored fee.
  if (order.delivery_fee_minor === null) return "Not recorded (legacy order)";
  return order.delivery_fee_minor === 0 ? "FREE" : formatPkrMinor(order.delivery_fee_minor);
};
const cityDisplay = (order: Order) => order.city === "Karachi" ? "Karachi" : order.other_city || "Other city";
const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;
const orderNumbers = (ids: string[], byId: Map<string, Order>, limit = 8) => {
  const numbers = ids.map((id) => byId.get(id)?.order_number ?? id);
  return numbers.length > limit ? `${numbers.slice(0, limit).join(", ")} +${numbers.length - limit} more` : numbers.join(", ");
};

export function AdminOrders() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | OrderStatus>("all");
  const [paymentFilter, setPaymentFilter] = useState<"all" | PaymentMethod>("all");
  const [cityFilter, setCityFilter] = useState<"all" | "Karachi" | "Other city in Pakistan">("all");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  // Bulk selection (order ids), the chosen bulk action, the open confirmation and the last result.
  const [checkedIds, setCheckedIds] = useState<Set<string>>(() => new Set());
  const [bulkStatus, setBulkStatus] = useState<"" | BulkOrderStatus>("");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [bulkNotice, setBulkNotice] = useState<BulkNotice | null>(null);
  const headerCheckbox = useRef<HTMLInputElement>(null);
  const detailRef = useRef<HTMLElement>(null);
  // Phase 2: status history of the open order, release to staff, and staff status-change updates.
  const [history, setHistory] = useState<StatusEvent[] | null>(null);
  const [historyNote, setHistoryNote] = useState("");
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [adminId, setAdminId] = useState<string | null>(null);
  const [staffUpdates, setStaffUpdates] = useState<StaffUpdate[]>([]);
  const [updatesOpen, setUpdatesOpen] = useState(false);
  const busyRef = useRef(false);
  const newestStaffEventRef = useRef<number | null | undefined>(undefined);

  const loadOrders = async (quiet = false) => {
    if (!supabase) { setError("Supabase is not configured."); setLoading(false); return; }
    if (!quiet) setLoading(true);
    setError("");
    // "*" keeps this working before and after the coupon migration (coupon columns are optional). Vendor columns
    // need 202611150002; without it the legacy select is used and the vendor panel explains why it is unavailable.
    const [vendorResult, vendorOrders] = await Promise.all([
      supabase.from("vendors").select("id,code,name,sort_order").order("sort_order"),
      supabase.from("orders").select(ORDER_SELECT_VENDORS).order("created_at", { ascending: false }),
    ]);
    const { data, error: loadError } = vendorOrders.error
      ? await supabase.from("orders").select(ORDER_SELECT_LEGACY).order("created_at", { ascending: false })
      : vendorOrders;
    setVendors(vendorResult.error || vendorOrders.error ? [] : (vendorResult.data ?? []) as Vendor[]);
    if (loadError) setError(loadError.message);
    else { const rows = (data ?? []) as unknown as Order[]; setOrders(rows); setSelectedId((current) => current ?? rows[0]?.id ?? null); }
    setLoading(false);
  };
  useEffect(() => { void loadOrders(); requestAdminOrderNotification(); }, []);

  // Search, payment and city narrow the list; the status chips show counts within that view.
  const baseOrders = useMemo(() => {
    const value = query.trim().toLowerCase();
    return orders.filter((order) =>
      (paymentFilter === "all" || order.payment_method === paymentFilter) &&
      (cityFilter === "all" || order.city === cityFilter) &&
      (!value || `${order.order_number} ${order.customer_name} ${order.phone}`.toLowerCase().includes(value)),
    );
  }, [orders, query, paymentFilter, cityFilter]);
  const shownOrders = useMemo(
    () => baseOrders.filter((order) => statusFilter === "all" || order.status === statusFilter),
    [baseOrders, statusFilter],
  );
  const statusCounts = useMemo(() => {
    const counts = new Map<OrderStatus, number>();
    for (const order of baseOrders) counts.set(order.status, (counts.get(order.status) ?? 0) + 1);
    return counts;
  }, [baseOrders]);
  const byId = useMemo(() => new Map(orders.map((order) => [order.id, order])), [orders]);
  const selected = orders.find((order) => order.id === selectedId) ?? null;
  const selectedKey = selected ? `${selected.id}:${selected.status}:${selected.released_at ?? ""}:${(selected.order_fulfilments ?? []).map((part) => part.status).join(",")}:${selected.order_items.map((item) => item.vendor_id ?? "").join(",")}` : "";
  const vendorName = (id: string | null | undefined) => (id ? vendors.find((vendor) => vendor.id === id)?.name : null) ?? vendorLabel(null);
  const filtersActive = Boolean(query || statusFilter !== "all" || paymentFilter !== "all" || cityFilter !== "all");
  const clearFilters = () => { setQuery(""); setStatusFilter("all"); setPaymentFilter("all"); setCityFilter("all"); };

  // Selection only ever covers orders on screen: when filters hide an order it leaves the selection,
  // so a bulk action never touches an order the Admin cannot see.
  useEffect(() => {
    const visible = new Set(shownOrders.map((order) => order.id));
    setCheckedIds((current) => {
      const next = new Set([...current].filter((id) => visible.has(id)));
      return next.size === current.size ? current : next;
    });
  }, [shownOrders]);
  const checkedOrders = shownOrders.filter((order) => checkedIds.has(order.id));
  const allVisibleChecked = shownOrders.length > 0 && checkedOrders.length === shownOrders.length;
  useEffect(() => {
    if (headerCheckbox.current) headerCheckbox.current.indeterminate = checkedOrders.length > 0 && !allVisibleChecked;
  }, [checkedOrders.length, allVisibleChecked]);
  const toggleChecked = (id: string) => setCheckedIds((current) => {
    const next = new Set(current);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  const toggleAllVisible = () => setCheckedIds(allVisibleChecked ? new Set() : new Set(shownOrders.map((order) => order.id)));
  const clearSelection = () => { setCheckedIds(new Set()); setBulkStatus(""); setConfirmOpen(false); };

  // Orders released to vendors are never changed by a bulk action (their status follows the vendor parts, D7).
  const plan = bulkStatus ? planBulkStatusUpdate(checkedOrders.map((order) => ({ ...order, releasedToVendors: isReleasedToVendors(order) })), bulkStatus) : null;

  useEffect(() => { busyRef.current = saving || confirmOpen; }, [saving, confirmOpen]);
  useEffect(() => { void supabase?.auth.getSession().then(({ data }) => setAdminId(data.session?.user.id ?? null)); }, []);

  // Status history of the open order (reloaded when its status or release changes).
  useEffect(() => {
    const orderId = selectedKey.split(":")[0];
    setHistory(null); setHistoryNote("");
    if (!supabase || !orderId) return;
    let current = true;
    void supabase.from("order_status_events").select("*")
      .eq("order_id", orderId).order("id", { ascending: true })
      .then(({ data, error: historyError }) => {
        if (!current) return;
        if (historyError) setHistoryNote("Status history is available once the Staff Dashboard migration is applied.");
        else setHistory((data ?? []) as StatusEvent[]);
      });
    return () => { current = false; };
  }, [selectedKey]);

  // Staff status changes since this Admin last marked them seen (per Admin account, per browser).
  // New staff activity also refreshes the list, so staff updates appear here without re-entering them.
  const checkStaffUpdates = async () => {
    if (!supabase || !adminId) return;
    let since = readSeen(adminId);
    if (!since) { since = new Date().toISOString(); writeSeen(adminId, since); }
    // Vendor staff changes only (fulfilment events); the parent order change they cause is not counted twice.
    const { data, error: updatesError } = await supabase.from("order_status_events")
      .select("id,order_id,event,from_status,to_status,actor_role,created_at,fulfilment_id,vendor_id,orders(order_number)")
      .eq("actor_role", "staff").eq("event", "status_changed").not("fulfilment_id", "is", null).gt("created_at", since)
      .order("created_at", { ascending: false }).limit(50);
    if (updatesError) return; // history table not present yet (before 202611140002): no badge
    const rows = (data ?? []) as unknown as StaffUpdate[];
    const newest = rows[0]?.id ?? null;
    if (newestStaffEventRef.current !== undefined && newest !== null && newest !== newestStaffEventRef.current && !busyRef.current) void loadOrders(true);
    newestStaffEventRef.current = newest;
    setStaffUpdates(rows);
  };
  useEffect(() => {
    if (!adminId) return;
    void checkStaffUpdates();
    const timer = window.setInterval(() => { if (document.visibilityState === "visible") void checkStaffUpdates(); }, STAFF_UPDATES_POLL_MS);
    const onFocus = () => { void checkStaffUpdates(); };
    window.addEventListener("focus", onFocus);
    return () => { window.clearInterval(timer); window.removeEventListener("focus", onFocus); };
    // Polling restarts only when the signed-in Admin changes; checkStaffUpdates reads live refs/state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [adminId]);
  const markStaffUpdatesSeen = () => {
    if (adminId && staffUpdates[0]) writeSeen(adminId, staffUpdates[0].created_at);
    setStaffUpdates([]); setUpdatesOpen(false);
  };

  const openDetail = (id: string) => {
    setSelectedId(id);
    // Single-column layout: bring the detail panel into view.
    if (window.matchMedia("(max-width: 1100px)").matches) requestAnimationFrame(() => detailRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
  };

  const updateStatus = async (status: OrderStatus) => {
    if (!supabase || !selected || saving || selected.status === status) return;
    if (!canChangeOrderStatus(selected.status)) { setError(CANCELLED_ORDER_FINAL_MESSAGE); return; }
    if (isReleasedToVendors(selected)) { setError(SPLIT_ORDER_STATUS_MESSAGE); return; }
    setSaving(true); setError("");
    // Success only when the database returns the updated row (RLS can match zero rows silently).
    const result = await supabase.from("orders").update({ status }).eq("id", selected.id).select("id,status");
    const updateError = verifyOrderStatusUpdate(result, selected.id, status);
    if (updateError) setError(updateError);
    else setOrders((current) => current.map((order) => order.id === selected.id ? { ...order, status } : order));
    setSaving(false);
    if (!updateError) void loadOrders(true); // picks up released_at set by the database
  };

  const applyBulkStatus = async () => {
    if (!supabase || !bulkStatus || !plan || saving) return;
    const target = bulkStatus;
    setConfirmOpen(false); setSaving(true); setBulkNotice(null); setError("");
    const saved: string[] = []; const notSaved: string[] = []; let failure: string | null = null; let notAttempted: string[] = [];
    const chunks = chunkOrderIds(plan.eligible);
    for (let index = 0; index < chunks.length; index += 1) {
      const chunk = chunks[index];
      // Cancelled rows are excluded in the request itself: an order cancelled meanwhile is simply not
      // matched (reported as not saved) instead of failing the whole request. RLS still applies.
      const result = await supabase.from("orders").update({ status: target }).in("id", chunk).neq("status", "cancelled").select("id,status");
      const outcome = verifyBulkOrderStatusChunk(result, chunk, target);
      saved.push(...outcome.saved);
      if (outcome.error) { failure = outcome.error; notAttempted = chunks.slice(index).flat(); break; }
      notSaved.push(...outcome.notSaved);
    }
    const label = statusLabel(target);
    const lines: string[] = [];
    if (saved.length) lines.push(`Updated: ${orderNumbers(saved, byId)}`);
    if (notSaved.length) lines.push(`Not saved (${notSaved.length}): ${orderNumbers(notSaved, byId)}. They may have been cancelled meanwhile, or your Admin session expired.`);
    if (failure) lines.push(`Stopped with an error: ${failure}. Not changed (${notAttempted.length}): ${orderNumbers(notAttempted, byId)}.`);
    if (plan.skippedCancelled.length) lines.push(`Skipped ${plan.skippedCancelled.length} cancelled ${plan.skippedCancelled.length === 1 ? "order" : "orders"} (cancelled orders are final).`);
    if (plan.unchanged.length) lines.push(`${plural(plan.unchanged.length, "order")} already ${label}: no change needed.`);
    if (plan.skippedVendor.length) lines.push(`Skipped ${plural(plan.skippedVendor.length, "order")} released to vendors (change each vendor's status in the order).`);
    const problems = notSaved.length + notAttempted.length;
    setBulkNotice({
      tone: problems === 0 ? "success" : saved.length ? "warning" : "error",
      title: problems === 0
        ? `${plural(saved.length, "order")} changed to ${label}.`
        : `${saved.length} of ${plan.eligible.length} orders changed to ${label}. ${problems} not saved.`,
      lines,
    });
    // Keep only the orders that still need attention selected, then reload the truth from the database.
    const keep = new Set([...notSaved, ...notAttempted]);
    setCheckedIds(keep);
    if (!keep.size) setBulkStatus("");
    setSaving(false);
    await loadOrders(true);
  };

  useEffect(() => {
    if (!confirmOpen) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") setConfirmOpen(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [confirmOpen]);

  const cancelling = bulkStatus === "cancelled";

  return <div className="admin-orders">
    <div className="ao-heading">
      <div className="ao-brand">
        <img className="ao-logo" src={BRAND_LOGO} alt="" width={52} height={52} />
        <div><span className="admin-kicker">iSolutions Pakistan · Order Management</span><h1>Orders</h1><p>{loading ? "Loading…" : `${plural(orders.length, "order")} · newest first`}</p></div>
      </div>
      <div className="ao-heading-actions">
        {staffUpdates.length ? <button type="button" className="ao-staff-updates" aria-expanded={updatesOpen} onClick={() => setUpdatesOpen((open) => !open)}><Bell aria-hidden="true" />Staff updates<span>{staffUpdates.length}</span></button> : null}
        <button type="button" className="admin-secondary ao-refresh" onClick={() => { void loadOrders(true); void checkStaffUpdates(); }} disabled={loading || saving}><RefreshCw aria-hidden="true" />Refresh</button>
      </div>
    </div>
    {updatesOpen && staffUpdates.length ? <div className="ao-updates" role="region" aria-label="Staff updates">
      <ul>{staffUpdates.map((update) => <li key={update.id}><button type="button" onClick={() => { openDetail(update.order_id); setUpdatesOpen(false); }}>
        <strong>{update.orders?.order_number ?? "Order"}</strong>
        <span>{update.vendor_id ? `${vendorName(update.vendor_id)}: ` : ""}{update.from_status ? `${statusLabel(update.from_status)} → ` : ""}{statusLabel(update.to_status)}</span>
        <small>{dateTime(update.created_at)}</small>
      </button></li>)}</ul>
      <button type="button" className="ao-link" onClick={markStaffUpdatesSeen}>Mark all as seen</button>
    </div> : null}

    <div className="ao-chips" role="group" aria-label="Filter by status">
      <button type="button" className={statusFilter === "all" ? "active" : ""} aria-pressed={statusFilter === "all"} onClick={() => setStatusFilter("all")}>All<span>{baseOrders.length}</span></button>
      {statuses.map((status) => <button type="button" key={status} className={`${status}${statusFilter === status ? " active" : ""}`} aria-pressed={statusFilter === status} onClick={() => setStatusFilter(status)}>{statusLabel(status)}<span>{statusCounts.get(status) ?? 0}</span></button>)}
    </div>

    <div className="ao-tools">
      <div className="ao-search"><Search aria-hidden="true" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search order #, customer or phone" aria-label="Search orders" /></div>
      <label><span>Payment</span><select value={paymentFilter} onChange={(event) => setPaymentFilter(event.target.value as "all" | PaymentMethod)}><option value="all">All payments</option><option value="cash_on_delivery">Cash on Delivery</option><option value="bank_transfer">Bank Transfer</option></select></label>
      <label><span>City</span><select value={cityFilter} onChange={(event) => setCityFilter(event.target.value as "all" | "Karachi" | "Other city in Pakistan")}><option value="all">All cities</option><option value="Karachi">Karachi</option><option value="Other city in Pakistan">Other city</option></select></label>
      {filtersActive ? <button type="button" className="ao-clear" onClick={clearFilters}>Clear filters</button> : null}
    </div>

    {error ? <div className="orders-error" role="alert">{error}<button type="button" onClick={() => void loadOrders()}>Retry</button></div> : null}
    {bulkNotice ? <div className={`ao-notice ${bulkNotice.tone}`} role={bulkNotice.tone === "success" ? "status" : "alert"}>
      {bulkNotice.tone === "success" ? <CheckCircle2 aria-hidden="true" /> : <AlertTriangle aria-hidden="true" />}
      <div><strong>{bulkNotice.title}</strong>{bulkNotice.lines.map((line) => <p key={line}>{line}</p>)}</div>
      <button type="button" aria-label="Dismiss" onClick={() => setBulkNotice(null)}><X /></button>
    </div> : null}

    {checkedOrders.length ? <div className="ao-bulkbar" role="region" aria-label="Bulk actions">
      <strong>{plural(checkedOrders.length, "order")} selected</strong>
      <label><span className="ao-sr">Change status to</span><select value={bulkStatus} disabled={saving} onChange={(event) => setBulkStatus(event.target.value as "" | BulkOrderStatus)}><option value="">Change status to…</option>{BULK_ORDER_STATUSES.map((status) => <option key={status} value={status}>{statusLabel(status)}</option>)}</select></label>
      <button type="button" className={`ao-apply${cancelling ? " danger" : ""}`} disabled={!bulkStatus || saving} onClick={() => setConfirmOpen(true)}>{saving ? "Applying…" : "Apply"}</button>
      <button type="button" className="ao-link" disabled={saving} onClick={clearSelection}>Clear selection</button>
    </div> : null}

    {loading ? <div className="orders-state">Loading orders…</div> : <div className="ao-layout">
      <div className="ao-list" role="table" aria-label="Orders">
        <div className="ao-row ao-head" role="row">
          <label className="ao-check" role="columnheader"><input ref={headerCheckbox} type="checkbox" checked={allVisibleChecked} disabled={!shownOrders.length || saving} onChange={toggleAllVisible} aria-label="Select all visible orders" /></label>
          <div className="ao-cells" aria-hidden="true"><span>Order</span><span>Customer</span><span>City</span><span>Payment</span><span>Total</span><span>Status</span></div>
        </div>
        {shownOrders.length ? shownOrders.map((order) => <div role="row" key={order.id} className={`ao-row${order.id === selectedId ? " active" : ""}${checkedIds.has(order.id) ? " checked" : ""}`}>
          <label className="ao-check"><input type="checkbox" checked={checkedIds.has(order.id)} disabled={saving} onChange={() => toggleChecked(order.id)} aria-label={`Select ${order.order_number}`} /></label>
          <button type="button" className="ao-cells" onClick={() => openDetail(order.id)} aria-label={`Open ${order.order_number}`}>
            <span className="ao-order"><strong>{order.order_number}</strong><small>{dateTime(order.created_at)}</small></span>
            <span className="ao-customer"><strong>{order.customer_name}</strong><small>{order.phone}</small></span>
            <span className="ao-city">{cityDisplay(order)}</span>
            <span className="ao-payment">{paymentShortLabel(order.payment_method)}</span>
            <span className="ao-total"><strong>{formatPkrMinor(order.total_minor)}</strong><small>{plural(order.order_items.length, "item")}</small></span>
            <span className="ao-status-cell"><span className="ao-status-stack"><span className={`order-status ${order.status}`}>{statusLabel(order.status)}</span>{awaitingRelease(order) ? <small className="ao-unreleased">Not released</small> : null}{isReleasedToVendors(order) ? <small className="ao-vendor-count">{orderPartiallyCancelled(order) ? "Partially cancelled" : `${plural(liveFulfilments(order).length, "vendor")}`}</small> : null}</span><ChevronRight aria-hidden="true" /></span>
          </button>
        </div>) : <div className="orders-state">{filtersActive ? "No orders match the selected filters." : "No orders found."}</div>}
      </div>
      <aside ref={detailRef} className="order-detail ao-detail" aria-live="polite">{selected ? <><header><div className="order-detail-title"><span className="admin-kicker">ORDER</span><h2>{selected.order_number}</h2><p>{dateTime(selected.created_at)} · {paymentLabel(selected.payment_method)}</p></div><button type="button" aria-label="Close order detail" onClick={() => setSelectedId(null)}><X /></button></header><div className="ao-summary"><div><span>Customer</span><strong>{selected.customer_name}</strong><small>{selected.phone}</small></div><div><span>Payment</span><strong>{formatPkrMinor(selected.total_minor)}</strong><small>{paymentLabel(selected.payment_method)}</small></div><div><span>Delivery</span><strong>{selected.city === "Karachi" ? "Karachi" : selected.other_city || selected.city}</strong><small>{shippingMethodLabel(selected.shipping_method)}</small></div></div>{isReleasedToVendors(selected) ? <div className="order-status-control ao-status-derived"><span>Order status</span><strong><span className={`order-status ${selected.status}`}>{statusLabel(selected.status)}</span>{orderPartiallyCancelled(selected) ? <small className="ao-partial-chip">Partially cancelled</small> : null}</strong><small>Follows the vendor parts (earliest active stage). Change each vendor below.</small></div> : <label className="order-status-control"><span>Order status</span><select value={selected.status} disabled={saving || !canChangeOrderStatus(selected.status)} onChange={(event) => void updateStatus(event.target.value as OrderStatus)}>{statuses.map((status) => <option key={status} value={status}>{statusLabel(status)}</option>)}</select>{saving ? <small>Saving status…</small> : !canChangeOrderStatus(selected.status) ? <small>{CANCELLED_ORDER_FINAL_MESSAGE}</small> : null}</label>}{selected.order_fulfilments === undefined ? null : <AdminOrderVendors order={selected} vendors={vendors} disabled={saving} onChanged={() => loadOrders(true)} />}<details className="ao-expand"><summary>Customer &amp; delivery details</summary><div className="ao-detail-block"><h4>Customer</h4><dl><div><dt>Full name</dt><dd>{selected.customer_name}</dd></div><div><dt>WhatsApp / Phone</dt><dd>{selected.phone}</dd></div>{selected.email ? <div><dt>Email</dt><dd>{selected.email}</dd></div> : null}</dl></div><div className="ao-detail-block"><h4>Delivery</h4><dl><div><dt>Destination</dt><dd>{selected.city}{selected.other_city ? ` · ${selected.other_city}` : ""}</dd></div><div><dt>Classification</dt><dd>{deliveryClassificationLabel(selected.delivery_classification)}</dd></div><div><dt>Shipping Method</dt><dd>{shippingMethodLabel(selected.shipping_method)}</dd></div><div><dt>Address</dt><dd>{selected.full_delivery_address}</dd></div>{selected.area_landmark ? <div><dt>Area / Landmark</dt><dd>{selected.area_landmark}</dd></div> : null}{selected.order_notes ? <div><dt>Notes</dt><dd>{selected.order_notes}</dd></div> : null}</dl></div></details><details className="ao-expand"><summary>Items &amp; totals <small>{plural(selected.order_items.length, "item")} · {formatPkrMinor(selected.total_minor)}</small></summary><div className="order-items">{selected.order_items.map((item) => <article key={item.id}>{item.image_url_snapshot ? <img src={item.image_url_snapshot} alt="" /> : <div className="order-item-image" />}<div><strong>{item.product_title_snapshot}</strong><small>{item.sku_snapshot}{itemAttributes(item) ? ` · ${itemAttributes(item)}` : ""}</small><small>{item.delivery_scope_snapshot === "karachi_only" ? "Karachi Only" : "Nationwide"}{selected.order_fulfilments === undefined ? "" : ` · ${vendorName(item.vendor_id)}`}</small></div><div><span>{item.quantity} × {formatPkrMinor(item.unit_price_minor)}</span><strong>{formatPkrMinor(item.line_total_minor)}</strong></div></article>)}</div><section className="order-totals">{selected.coupon_code_snapshot ? <div className="order-coupon"><span>Coupon</span><strong>{selected.coupon_code_snapshot}</strong></div> : null}<div><span>{selected.coupon_code_snapshot ? "Original subtotal" : "Subtotal"}</span><strong>{formatPkrMinor(selected.subtotal_minor)}</strong></div>{Number(selected.discount_minor) > 0 ? <div className="order-discount"><span>Coupon discount</span><strong>−{formatPkrMinor(selected.discount_minor ?? 0)}</strong></div> : null}<div><span>Delivery Method</span><strong>{shippingMethodLabel(selected.shipping_method)}</strong></div><div><span>Delivery Fee</span><strong>{deliveryFeeDisplay(selected)}</strong></div>{Number(selected.shipping_discount_minor) > 0 ? <div className="order-discount"><span>Shipping discount</span><strong>−{formatPkrMinor(selected.shipping_discount_minor ?? 0)}</strong></div> : null}<div><span>{selected.coupon_code_snapshot ? "Final charged total" : "Total"}</span><strong>{formatPkrMinor(selected.total_minor)}</strong></div></section></details><details className="ao-expand"><summary>Status history{history?.length ? <small>{plural(history.length, "event")}</small> : null}</summary><div className="ao-history">{history === null ? <p>{historyNote || "Loading…"}</p> : history.length ? <ol>{history.map((event) => <li key={event.id}><strong>{event.vendor_id ? `${vendorName(event.vendor_id)}: ` : ""}{event.event === "item_reassigned" ? `item moved from ${vendorName(event.from_vendor_id)}` : event.event === "released" ? (event.vendor_id ? "Released (Received)" : "Released to staff") : `${event.from_status ? `${statusLabel(event.from_status)} → ` : ""}${statusLabel(event.to_status)}`}</strong><small>{actorLabel(event.actor_role)} · {dateTime(event.created_at)}</small></li>)}</ol> : <p>No status changes recorded yet.</p>}</div></details></> : <div className="orders-detail-empty">Select an order to view its customer, delivery and item details.</div>}</aside>
    </div>}

    {confirmOpen && plan && bulkStatus ? <div className="ao-overlay" onClick={() => setConfirmOpen(false)}>
      <div className="ao-dialog" role="dialog" aria-modal="true" aria-labelledby="ao-confirm-title" onClick={(event) => event.stopPropagation()}>
        <h2 id="ao-confirm-title">{cancelling ? `Cancel ${plural(plan.eligible.length, "order")}?` : `Change ${plural(plan.eligible.length, "order")} to ${statusLabel(bulkStatus)}?`}</h2>
        {plan.eligible.length ? <p className="ao-dialog-orders">{orderNumbers(plan.eligible, byId, 12)}</p> : <p>No selected order needs this change.</p>}
        {cancelling && plan.eligible.length ? <div className="ao-warning"><AlertTriangle aria-hidden="true" /><div><strong>This cannot be undone.</strong><p>Cancelled orders are final. The stock of these orders is returned to inventory automatically, once per order.</p></div></div> : null}
        {plan.skippedVendor.length ? <p className="ao-dialog-note">{plural(plan.skippedVendor.length, "order")} released to vendors will be skipped (their status follows the vendor parts).</p> : null}
        {plan.eligible.length && bulkStatus !== "cancelled" ? <p className="ao-dialog-note">Vendor staff see an order only after its items are assigned and it is released to vendors.</p> : null}
        {plan.skippedCancelled.length ? <p className="ao-dialog-note">{plural(plan.skippedCancelled.length, "cancelled order")} will be skipped (cancelled orders are final).</p> : null}
        {plan.unchanged.length ? <p className="ao-dialog-note">{plural(plan.unchanged.length, "order")} already {statusLabel(bulkStatus)}: no change.</p> : null}
        <div className="ao-dialog-actions">
          <button type="button" className="admin-secondary" onClick={() => setConfirmOpen(false)}>{cancelling ? "Keep orders" : "Back"}</button>
          <button type="button" className={`ao-apply${cancelling ? " danger" : ""}`} disabled={!plan.eligible.length} onClick={() => void applyBulkStatus()} autoFocus={!cancelling}>{cancelling ? `Yes, cancel ${plural(plan.eligible.length, "order")}` : `Change to ${statusLabel(bulkStatus)}`}</button>
        </div>
      </div>
    </div> : null}
  </div>;
}
