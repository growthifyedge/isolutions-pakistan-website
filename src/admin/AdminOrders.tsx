import { useEffect, useMemo, useState } from "react";
import { ChevronRight, Search, X } from "lucide-react";
import { formatPkrMinor } from "../lib/catalog";
import {
  CANCELLED_ORDER_FINAL_MESSAGE,
  type OrderStatus,
  canChangeOrderStatus,
  verifyOrderStatusUpdate,
} from "../lib/orderRules";
import { supabase } from "../lib/supabase";

type PaymentMethod = "cash_on_delivery" | "bank_transfer";
type ShippingMethod = "standard" | "fast";
type DeliveryScope = "karachi_only" | "nationwide";
type OrderItem = {
  id: string; product_title_snapshot: string; sku_snapshot: string;
  variant_attributes_snapshot: Record<string, string | null>;
  quantity: number; unit_price_minor: number; line_total_minor: number;
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
};

const statuses: OrderStatus[] = ["new", "confirmed", "processing", "completed", "cancelled"];
const statusLabel = (status: OrderStatus) => status === "new" ? "New" : status[0].toUpperCase() + status.slice(1);
const paymentLabel = (payment: PaymentMethod) => payment === "cash_on_delivery" ? "Cash on Delivery" : "Bank Transfer";
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

  const loadOrders = async () => {
    if (!supabase) { setError("Supabase is not configured."); setLoading(false); return; }
    setLoading(true); setError("");
    const { data, error: loadError } = await supabase
      .from("orders")
      // "*" keeps this working before and after the coupon migration (coupon columns are optional).
      .select("*,order_items(id,product_title_snapshot,sku_snapshot,variant_attributes_snapshot,quantity,unit_price_minor,line_total_minor,delivery_scope_snapshot,image_url_snapshot)")
      .order("created_at", { ascending: false });
    if (loadError) setError(loadError.message);
    else { const rows = (data ?? []) as unknown as Order[]; setOrders(rows); setSelectedId((current) => current ?? rows[0]?.id ?? null); }
    setLoading(false);
  };
  useEffect(() => { void loadOrders(); }, []);

  const shownOrders = useMemo(() => {
    const value = query.trim().toLowerCase();
    return orders.filter((order) =>
      (statusFilter === "all" || order.status === statusFilter) &&
      (paymentFilter === "all" || order.payment_method === paymentFilter) &&
      (cityFilter === "all" || order.city === cityFilter) &&
      (!value || `${order.order_number} ${order.customer_name} ${order.phone}`.toLowerCase().includes(value)),
    );
  }, [orders, query, statusFilter, paymentFilter, cityFilter]);
  const selected = orders.find((order) => order.id === selectedId) ?? null;
  const filtersActive = Boolean(query || statusFilter !== "all" || paymentFilter !== "all" || cityFilter !== "all");
  const clearFilters = () => { setQuery(""); setStatusFilter("all"); setPaymentFilter("all"); setCityFilter("all"); };
  const updateStatus = async (status: OrderStatus) => {
    if (!supabase || !selected || saving || selected.status === status) return;
    if (!canChangeOrderStatus(selected.status)) { setError(CANCELLED_ORDER_FINAL_MESSAGE); return; }
    setSaving(true); setError("");
    // Success only when the database returns the updated row (RLS can match zero rows silently).
    const result = await supabase.from("orders").update({ status }).eq("id", selected.id).select("id,status");
    const updateError = verifyOrderStatusUpdate(result, selected.id, status);
    if (updateError) setError(updateError);
    else setOrders((current) => current.map((order) => order.id === selected.id ? { ...order, status } : order));
    setSaving(false);
  };

  return <>
    <div className="admin-heading compact orders-heading"><div><span className="admin-kicker">CHECKOUT / ORDERS</span><h1>Orders</h1><p>Review secure storefront orders, payment method, delivery information, and immutable item snapshots.</p></div></div>
    <div className="orders-tools">
      <div className="orders-search"><Search aria-hidden="true" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search order #, customer or phone" aria-label="Search orders" /></div>
      <label>Status<select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as "all" | OrderStatus)}><option value="all">All statuses</option>{statuses.map((status) => <option key={status} value={status}>{statusLabel(status)}</option>)}</select></label>
      <label>Payment<select value={paymentFilter} onChange={(event) => setPaymentFilter(event.target.value as "all" | PaymentMethod)}><option value="all">All payments</option><option value="cash_on_delivery">Cash on Delivery</option><option value="bank_transfer">Bank Transfer</option></select></label>
      <label>City<select value={cityFilter} onChange={(event) => setCityFilter(event.target.value as "all" | "Karachi" | "Other city in Pakistan")}><option value="all">All cities</option><option value="Karachi">Karachi</option><option value="Other city in Pakistan">Other city</option></select></label>
      {filtersActive ? <button type="button" className="admin-secondary orders-clear" onClick={clearFilters}>Clear filters</button> : null}
    </div>
    {error ? <div className="orders-error" role="alert">{error}<button type="button" onClick={() => void loadOrders()}>Retry</button></div> : null}
    {loading ? <div className="orders-state">Loading orders…</div> : <div className="orders-layout">
      <div className="orders-list"><div className="orders-list-head" aria-hidden="true"><span>Order</span><span>Customer</span><span>City</span><span>Payment</span><span>Status</span><span>Total</span><span>Items</span><span /></div>
      {shownOrders.length ? shownOrders.map((order) => <button type="button" className={`order-row${order.id === selectedId ? " active" : ""}`} onClick={() => setSelectedId(order.id)} key={order.id}><div className="order-row-order"><strong>{order.order_number}</strong><small>{dateTime(order.created_at)}</small></div><div className="order-row-customer"><strong>{order.customer_name}</strong><small>{order.phone}</small></div><span>{order.city}</span><span className="order-row-payment">{paymentLabel(order.payment_method)}</span><span className={`order-status ${order.status}`}>{statusLabel(order.status)}</span><strong>{formatPkrMinor(order.total_minor)}</strong><span className="order-row-items">{order.order_items.length}</span><ChevronRight aria-hidden="true" /></button>) : <div className="orders-state">{filtersActive ? "No orders match the selected filters." : "No orders found."}</div>}</div>
      <aside className="order-detail" aria-live="polite">{selected ? <><header><div className="order-detail-title"><span className="admin-kicker">ORDER</span><h2>{selected.order_number}</h2><p>{dateTime(selected.created_at)} · {paymentLabel(selected.payment_method)}</p></div><button type="button" aria-label="Close order detail" onClick={() => setSelectedId(null)}><X /></button></header><label className="order-status-control"><span>Order status</span><select value={selected.status} disabled={saving || !canChangeOrderStatus(selected.status)} onChange={(event) => void updateStatus(event.target.value as OrderStatus)}>{statuses.map((status) => <option key={status} value={status}>{statusLabel(status)}</option>)}</select>{saving ? <small>Saving status…</small> : !canChangeOrderStatus(selected.status) ? <small>{CANCELLED_ORDER_FINAL_MESSAGE}</small> : null}</label><section><h3>Customer</h3><dl><div><dt>Full name</dt><dd>{selected.customer_name}</dd></div><div><dt>WhatsApp / Phone</dt><dd>{selected.phone}</dd></div>{selected.email ? <div><dt>Email</dt><dd>{selected.email}</dd></div> : null}</dl></section><section><h3>Delivery</h3><dl><div><dt>Destination</dt><dd>{selected.city}{selected.other_city ? ` · ${selected.other_city}` : ""}</dd></div><div><dt>Classification</dt><dd>{deliveryClassificationLabel(selected.delivery_classification)}</dd></div><div><dt>Shipping Method</dt><dd>{shippingMethodLabel(selected.shipping_method)}</dd></div><div><dt>Address</dt><dd>{selected.full_delivery_address}</dd></div>{selected.area_landmark ? <div><dt>Area / Landmark</dt><dd>{selected.area_landmark}</dd></div> : null}{selected.order_notes ? <div><dt>Notes</dt><dd>{selected.order_notes}</dd></div> : null}</dl></section><section><h3>Order items</h3><div className="order-items">{selected.order_items.map((item) => <article key={item.id}>{item.image_url_snapshot ? <img src={item.image_url_snapshot} alt="" /> : <div className="order-item-image" />}<div><strong>{item.product_title_snapshot}</strong><small>{item.sku_snapshot}{itemAttributes(item) ? ` · ${itemAttributes(item)}` : ""}</small><small>{item.delivery_scope_snapshot === "karachi_only" ? "Karachi Only" : "Nationwide"}</small></div><div><span>{item.quantity} × {formatPkrMinor(item.unit_price_minor)}</span><strong>{formatPkrMinor(item.line_total_minor)}</strong></div></article>)}</div></section><section className="order-totals">{selected.coupon_code_snapshot ? <div className="order-coupon"><span>Coupon</span><strong>{selected.coupon_code_snapshot}</strong></div> : null}<div><span>{selected.coupon_code_snapshot ? "Original subtotal" : "Subtotal"}</span><strong>{formatPkrMinor(selected.subtotal_minor)}</strong></div>{Number(selected.discount_minor) > 0 ? <div className="order-discount"><span>Coupon discount</span><strong>−{formatPkrMinor(selected.discount_minor ?? 0)}</strong></div> : null}<div><span>Delivery Method</span><strong>{shippingMethodLabel(selected.shipping_method)}</strong></div><div><span>Delivery Fee</span><strong>{deliveryFeeDisplay(selected)}</strong></div>{Number(selected.shipping_discount_minor) > 0 ? <div className="order-discount"><span>Shipping discount</span><strong>−{formatPkrMinor(selected.shipping_discount_minor ?? 0)}</strong></div> : null}<div><span>{selected.coupon_code_snapshot ? "Final charged total" : "Total"}</span><strong>{formatPkrMinor(selected.total_minor)}</strong></div></section></> : <div className="orders-detail-empty">Select an order to view its secure customer, delivery, and snapshot details.</div>}</aside>
    </div>}
  </>;
}
