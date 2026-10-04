// Admin dashboard figures, derived only from real database rows (no fixtures, no estimates).
// Catalog figures count data_class = 'real' products only, so development test records never
// appear. Stock figures cover active variants of published products (what customers can buy).

/** A live variant with 1..LOW_STOCK_MAX_UNITS units on hand counts as low stock. */
export const LOW_STOCK_MAX_UNITS = 2;
/** Orders still being handled (not completed, not cancelled). */
export const OPEN_ORDER_STATUSES = ["new", "confirmed", "processing"] as const;

export type DashboardProduct = {
  id: string;
  publication_status: "draft" | "published" | "archived";
  data_class: "real" | "development";
  product_media: { is_primary: boolean; cloudinary_public_id: string | null }[];
  product_variants: { id: string; is_active: boolean }[];
};
export type DashboardInventoryRow = { variant_id: string; quantity_on_hand: number | string };
export type DashboardOrder = {
  id: string;
  order_number: string;
  customer_name: string;
  total_minor: number;
  status: "new" | "confirmed" | "processing" | "completed" | "cancelled";
  created_at: string;
};
export type DashboardOrderCounts = { today: number; open: number; new: number };
export type DashboardEnquiryCounts = { open: number; new: number };

export type AttentionItem = {
  key: "drafts" | "missing-images" | "out-of-stock" | "low-stock" | "new-orders" | "enquiries";
  label: string;
  detail: string;
  count: number;
  href: string;
  tone: "urgent" | "warning" | "neutral";
};

export type DashboardSummary = {
  publishedProducts: number;
  draftProducts: number;
  productsMissingImages: number;
  lowStockVariants: number;
  outOfStockVariants: number;
  liveVariants: number;
  ordersToday: number;
  openOrders: number;
  newOrders: number;
  openEnquiries: number;
  newEnquiries: number;
  catalogEmpty: boolean;
  attention: AttentionItem[];
};

const plural = (count: number, one: string, many: string) => (count === 1 ? one : many);

export function hasPrimaryImage(product: Pick<DashboardProduct, "product_media">) {
  return product.product_media.some((media) => media.is_primary && Boolean(media.cloudinary_public_id));
}

export function summarizeDashboard(input: {
  products: DashboardProduct[];
  inventory: DashboardInventoryRow[];
  orderCounts: DashboardOrderCounts;
  enquiryCounts: DashboardEnquiryCounts;
}): DashboardSummary {
  const real = input.products.filter((product) => product.data_class === "real");
  const published = real.filter((product) => product.publication_status === "published");
  const drafts = real.filter((product) => product.publication_status === "draft");
  const productsMissingImages = real.filter(
    (product) => product.publication_status !== "archived" && !hasPrimaryImage(product),
  ).length;

  const onHand = new Map(input.inventory.map((row) => [row.variant_id, Number(row.quantity_on_hand) || 0]));
  const liveVariants = published.flatMap((product) => product.product_variants.filter((variant) => variant.is_active));
  const quantityOf = (variantId: string) => onHand.get(variantId) ?? 0;
  const outOfStockVariants = liveVariants.filter((variant) => quantityOf(variant.id) <= 0).length;
  const lowStockVariants = liveVariants.filter((variant) => {
    const quantity = quantityOf(variant.id);
    return quantity > 0 && quantity <= LOW_STOCK_MAX_UNITS;
  }).length;

  const { today: ordersToday, open: openOrders, new: newOrders } = input.orderCounts;
  const { open: openEnquiries, new: newEnquiries } = input.enquiryCounts;

  const attention: AttentionItem[] = [
    {
      key: "new-orders", count: newOrders, href: "/admin/orders", tone: "urgent",
      label: `${newOrders} new ${plural(newOrders, "order", "orders")}`,
      detail: "Waiting to be confirmed",
    },
    {
      key: "out-of-stock", count: outOfStockVariants, href: "/admin/products", tone: "urgent",
      label: `${outOfStockVariants} live ${plural(outOfStockVariants, "variant", "variants")} out of stock`,
      detail: "Published but cannot be bought",
    },
    {
      key: "low-stock", count: lowStockVariants, href: "/admin/products", tone: "warning",
      label: `${lowStockVariants} live ${plural(lowStockVariants, "variant", "variants")} low on stock`,
      detail: `${LOW_STOCK_MAX_UNITS} or fewer units left`,
    },
    {
      key: "enquiries", count: openEnquiries, href: "/admin/contact-enquiries", tone: "warning",
      label: `${openEnquiries} open ${plural(openEnquiries, "enquiry", "enquiries")}`,
      detail: newEnquiries ? `${newEnquiries} not yet opened` : "In progress",
    },
    {
      key: "missing-images", count: productsMissingImages, href: "/admin/products?missing=images", tone: "neutral",
      label: `${productsMissingImages} ${plural(productsMissingImages, "product", "products")} missing a main image`,
      detail: "Required before publishing",
    },
    {
      key: "drafts", count: drafts.length, href: "/admin/catalog-readiness", tone: "neutral",
      label: `${drafts.length} draft ${plural(drafts.length, "product", "products")}`,
      detail: "Not visible to customers yet",
    },
  ];

  return {
    publishedProducts: published.length,
    draftProducts: drafts.length,
    productsMissingImages,
    lowStockVariants,
    outOfStockVariants,
    liveVariants: liveVariants.length,
    ordersToday,
    openOrders,
    newOrders,
    openEnquiries,
    newEnquiries,
    catalogEmpty: real.length === 0,
    attention: attention.filter((item) => item.count > 0),
  };
}

/** Greeting for the viewer's local time: morning before 12:00, afternoon before 17:00. */
export function dashboardGreeting(date: Date) {
  const hour = date.getHours();
  if (hour < 12) return "Good morning.";
  if (hour < 17) return "Good afternoon.";
  return "Good evening.";
}

/** Midnight at the start of the viewer's local day, as an ISO timestamp for order queries. */
export function startOfLocalDayIso(date: Date) {
  const start = new Date(date);
  start.setHours(0, 0, 0, 0);
  return start.toISOString();
}
