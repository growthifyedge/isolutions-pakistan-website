import { useEffect, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronRight,
  Image,
  ListPlus,
  Plus,
  RefreshCw,
  ShoppingBag,
} from "lucide-react";
import { formatPkrMinor } from "../lib/catalog";
import {
  LOW_STOCK_MAX_UNITS,
  OPEN_ORDER_STATUSES,
  dashboardGreeting,
  startOfLocalDayIso,
  summarizeDashboard,
  type DashboardInventoryRow,
  type DashboardOrder,
  type DashboardProduct,
  type DashboardSummary,
} from "../lib/adminDashboard";
import { supabase } from "../lib/supabase";

const PAGE_SIZE = 1000;
const statusLabel = (status: DashboardOrder["status"]) =>
  status === "new" ? "New" : status[0].toUpperCase() + status.slice(1);
const orderTime = (date: string) =>
  new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }).format(new Date(date));
const count = (value: number | null | undefined) => (typeof value === "number" ? value : null);

// PostgREST caps each response (max_rows); page through so counts never silently truncate.
async function fetchAllRows<T>(page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>) {
  const rows: T[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await page(from, from + PAGE_SIZE - 1);
    if (error) throw new Error(error.message);
    rows.push(...(data ?? []));
    if (!data || data.length < PAGE_SIZE) return rows;
  }
}

type DashboardData = { summary: DashboardSummary; recentOrders: DashboardOrder[] };

async function loadDashboard(now: Date): Promise<DashboardData> {
  if (!supabase) throw new Error("Supabase is not configured.");
  const client = supabase;
  const exactHead = { count: "exact" as const, head: true };
  const [products, inventory, today, open, fresh, recent, enquiriesOpen, enquiriesNew] = await Promise.all([
    fetchAllRows<DashboardProduct>((from, to) =>
      client
        .from("products")
        .select("id,publication_status,data_class,product_media(is_primary,cloudinary_public_id),product_variants(id,is_active)")
        .eq("data_class", "real")
        .order("id")
        .range(from, to)),
    fetchAllRows<DashboardInventoryRow>((from, to) =>
      client.from("admin_variant_inventory").select("variant_id,quantity_on_hand").order("variant_id").range(from, to)),
    client.from("orders").select("id", exactHead).gte("created_at", startOfLocalDayIso(now)),
    client.from("orders").select("id", exactHead).in("status", [...OPEN_ORDER_STATUSES]),
    client.from("orders").select("id", exactHead).eq("status", "new"),
    client
      .from("orders")
      .select("id,order_number,customer_name,total_minor,status,created_at")
      .order("created_at", { ascending: false })
      .limit(5),
    client.from("contact_messages").select("id", exactHead).neq("status", "resolved"),
    client.from("contact_messages").select("id", exactHead).eq("status", "new"),
  ]);
  const failed = [today, open, fresh, recent, enquiriesOpen, enquiriesNew].find((result) => result.error);
  if (failed?.error) throw new Error(failed.error.message);
  const counts = [today.count, open.count, fresh.count, enquiriesOpen.count, enquiriesNew.count].map(count);
  if (counts.some((value) => value === null)) throw new Error("A dashboard count could not be read.");
  const [ordersToday, openOrders, newOrders, openEnquiries, newEnquiries] = counts as number[];
  return {
    summary: summarizeDashboard({
      products,
      inventory,
      orderCounts: { today: ordersToday, open: openOrders, new: newOrders },
      enquiryCounts: { open: openEnquiries, new: newEnquiries },
    }),
    recentOrders: (recent.data ?? []) as DashboardOrder[],
  };
}

type Kpi = { label: string; value: number | undefined; note: string; href?: string; tone?: "alert" };

export function AdminDashboard() {
  const [now] = useState(() => new Date());
  const [data, setData] = useState<DashboardData | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let active = true;
    loadDashboard(new Date())
      .then((next) => { if (active) { setData(next); setError(""); } })
      .catch((reason: unknown) => {
        if (!active) return;
        setData(null);
        setError(reason instanceof Error ? reason.message : "Dashboard data could not be loaded.");
      })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [reloadKey]);
  const refresh = () => { setLoading(true); setReloadKey((key) => key + 1); };

  const summary = data?.summary;
  const kpis: Kpi[] = [
    { label: "Published products", value: summary?.publishedProducts, note: "Live on the storefront", href: "/admin/products" },
    { label: "Draft products", value: summary?.draftProducts, note: "Not visible to customers", href: "/admin/catalog-readiness" },
    { label: "Low stock", value: summary?.lowStockVariants, note: `Live variants with ${LOW_STOCK_MAX_UNITS} or fewer units`, href: "/admin/products", tone: summary?.lowStockVariants ? "alert" : undefined },
    { label: "Out of stock", value: summary?.outOfStockVariants, note: "Live variants with no units", href: "/admin/products", tone: summary?.outOfStockVariants ? "alert" : undefined },
    { label: "Orders today", value: summary?.ordersToday, note: "Placed since midnight", href: "/admin/orders" },
    { label: "Pending orders", value: summary?.openOrders, note: "New, confirmed or processing", href: "/admin/orders", tone: summary?.openOrders ? "alert" : undefined },
  ];

  return (
    <div className="ops-dashboard">
      <div className="admin-heading ops-heading">
        <div>
          <span className="admin-kicker">STORE OPERATIONS</span>
          <h1>{dashboardGreeting(now)}</h1>
          <p>Here’s what needs your attention today.</p>
        </div>
        <button type="button" className="admin-secondary ops-refresh" onClick={refresh} disabled={loading}>
          <RefreshCw aria-hidden="true" /> {loading ? "Refreshing…" : "Refresh"}
        </button>
      </div>

      {error ? (
        <div className="ops-error" role="alert">
          <AlertTriangle aria-hidden="true" />
          <span>Dashboard data could not be loaded: {error}</span>
          <button type="button" onClick={refresh}>Retry</button>
        </div>
      ) : null}

      <section className="ops-kpis" aria-label="Store figures" aria-busy={loading}>
        {kpis.map((kpi) => {
          const body = (
            <>
              <small>{kpi.label}</small>
              <strong>{kpi.value ?? "—"}</strong>
              <span>{kpi.note}</span>
            </>
          );
          const className = `ops-kpi${kpi.tone === "alert" ? " is-alert" : ""}`;
          return kpi.href && summary ? (
            <a className={className} href={kpi.href} key={kpi.label}>{body}</a>
          ) : (
            <article className={className} key={kpi.label}>{body}</article>
          );
        })}
      </section>

      <div className="ops-grid">
        <section className="admin-panel ops-orders">
          <div className="panel-title">
            <div>
              <span className="admin-kicker">LATEST</span>
              <h2>Recent orders</h2>
            </div>
            <a href="/admin/orders">
              All orders <ChevronRight />
            </a>
          </div>
          {loading && !data ? (
            <p className="ops-empty">Loading orders…</p>
          ) : data?.recentOrders.length ? (
            <ul className="ops-order-list">
              {data.recentOrders.map((order) => (
                <li key={order.id}>
                  <a href="/admin/orders">
                    <span className="ops-order-id">
                      <strong>{order.order_number}</strong>
                      <small>{orderTime(order.created_at)}</small>
                    </span>
                    <span className="ops-order-customer">{order.customer_name}</span>
                    <span className={`order-status ${order.status}`}>{statusLabel(order.status)}</span>
                    <strong className="ops-order-total">{formatPkrMinor(order.total_minor)}</strong>
                    <ChevronRight aria-hidden="true" />
                  </a>
                </li>
              ))}
            </ul>
          ) : data ? (
            <div className="ops-empty">
              <ShoppingBag aria-hidden="true" />
              <strong>No orders yet.</strong>
              <span>New storefront orders will appear here as soon as they are placed.</span>
            </div>
          ) : (
            <p className="ops-empty">Orders are unavailable until the dashboard loads.</p>
          )}
        </section>

        <div className="ops-side">
          <aside className="readiness ops-attention" aria-label="Needs attention">
            <span className="admin-kicker">NEEDS ATTENTION</span>
            <h2>
              {summary && !summary.attention.length
                ? summary.catalogEmpty ? "Ready to begin." : "All clear."
                : "Today’s list."}
            </h2>
            {loading && !summary ? (
              <p className="ops-attention-note">Checking catalog, stock, orders and enquiries…</p>
            ) : summary ? (
              summary.attention.length ? (
                <ul>
                  {summary.attention.map((item) => (
                    <li key={item.key}>
                      <a className={`ops-attention-row ${item.tone}`} href={item.href}>
                        <i aria-hidden="true" />
                        <span>
                          {item.label}
                          <small>{item.detail}</small>
                        </span>
                        <ChevronRight aria-hidden="true" />
                      </a>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="ops-attention-note">
                  <CheckCircle2 aria-hidden="true" />
                  {summary.catalogEmpty
                    ? "Catalog setup is ready. Add or import products to begin."
                    : "No pending orders, stock alerts or open enquiries."}
                </p>
              )
            ) : (
              <p className="ops-attention-note">Unavailable until the dashboard loads.</p>
            )}
          </aside>

          <section className="admin-panel ops-actions" aria-label="Quick actions">
            <span className="admin-kicker">QUICK ACTIONS</span>
            <div>
              <a href="/admin/products/new"><Plus aria-hidden="true" /> Add product</a>
              <a href="/admin/bulk-import"><ListPlus aria-hidden="true" /> Bulk import</a>
              <a href="/admin/orders"><ShoppingBag aria-hidden="true" /> Manage orders</a>
              <a href="/admin/media"><Image aria-hidden="true" /> Media library</a>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
