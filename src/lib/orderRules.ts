// Storefront order rules shared by the cart, checkout and Admin Orders. The server
// (create_storefront_order, 202610010002) enforces the same limits; these only keep the
// browser from offering something the server will reject.

/** Most units of one variant a single order line may contain. */
export const MAX_ORDER_LINE_QUANTITY = 20;

/** Highest cart quantity for a variant: its stock, never above the per-line maximum. */
export function cartLineLimit(inventory: number) {
  return Math.max(0, Math.min(Math.floor(inventory), MAX_ORDER_LINE_QUANTITY));
}

export const PHONE_VALIDATION_MESSAGE =
  "Please enter a valid WhatsApp / phone number with 10–15 digits, e.g. 03001234567.";

/** 10–15 digits; only digits, spaces, "+", "-" and brackets (03001234567, +92 300 1234567). */
export function isValidOrderPhone(phone: string) {
  const value = phone.trim();
  const digits = value.replace(/\D/g, "").length;
  return /^[0-9+() -]+$/.test(value) && digits >= 10 && digits <= 15;
}

export type OrderStatus = "new" | "confirmed" | "processing" | "in_transit" | "completed" | "cancelled";

/** Every order status in workflow order (database values; `in_transit` needs 202611140002). */
export const ORDER_STATUSES: OrderStatus[] = ["new", "confirmed", "processing", "in_transit", "completed", "cancelled"];

/**
 * Owner-approved display names (Phase 2). Database values are unchanged:
 * confirmed = Received (released to staff), processing = In Process, completed = Delivered.
 */
export const ORDER_STATUS_LABELS: Record<OrderStatus, string> = {
  new: "New",
  confirmed: "Received",
  processing: "In Process",
  in_transit: "In Transit",
  completed: "Delivered",
  cancelled: "Cancelled",
};
export const orderStatusLabel = (status: OrderStatus) => ORDER_STATUS_LABELS[status] ?? status;

/** Active stages (Received / In Process / In Transit): the staff Active tab and open-order counts. */
export const STAFF_ACTIVE_STATUSES: OrderStatus[] = ["confirmed", "processing", "in_transit"];

/**
 * Staff status changes of their own vendor part, mirrored from staff_set_fulfilment_status (202611150002),
 * which is the real gate: Received -> In Process -> In Transit -> Delivered; Cancelled from any active stage.
 */
export const STAFF_STATUS_TRANSITIONS: Partial<Record<OrderStatus, OrderStatus[]>> = {
  confirmed: ["processing", "cancelled"],
  processing: ["in_transit", "cancelled"],
  in_transit: ["completed", "cancelled"],
};
export const staffCanSetStatus = (current: OrderStatus, next: OrderStatus) =>
  (STAFF_STATUS_TRANSITIONS[current] ?? []).includes(next);

export const SPLIT_ORDER_STATUS_MESSAGE =
  "This order is released to vendors. Its status follows the vendor parts; change each vendor's status instead.";

export const CANCELLED_ORDER_FINAL_MESSAGE =
  "This order is cancelled. Cancelled orders are final and their status cannot be changed.";

/** Cancelled is terminal: the database rejects any change away from it (order_cancelled_is_final). */
export function canChangeOrderStatus(current: OrderStatus) {
  return current !== "cancelled";
}

// ---- Admin Orders bulk status update (Phase 1, existing statuses only) ----

/** Statuses Admin may apply to several selected orders at once. "New" is never re-applied. */
export const BULK_ORDER_STATUSES = ["confirmed", "processing", "in_transit", "completed", "cancelled"] as const;
export type BulkOrderStatus = (typeof BULK_ORDER_STATUSES)[number];

/** Rows per update request, so the id list stays well inside URL limits. */
export const BULK_ORDER_CHUNK_SIZE = 50;

export type BulkOrderPlan = {
  /** Orders that will be written. */
  eligible: string[];
  /** Cancelled orders: final, never changed by a bulk action. */
  skippedCancelled: string[];
  /** Orders already in the target status: nothing to write. */
  unchanged: string[];
  /** Orders released to vendors (202611150002): their status follows the vendor parts, never a bulk action. */
  skippedVendor: string[];
};

/** Splits the selection into what will be written and what is safely left alone. */
export function planBulkStatusUpdate(
  orders: Array<{ id: string; status: OrderStatus; releasedToVendors?: boolean }>,
  target: BulkOrderStatus,
): BulkOrderPlan {
  const plan: BulkOrderPlan = { eligible: [], skippedCancelled: [], unchanged: [], skippedVendor: [] };
  for (const order of orders) {
    if (order.releasedToVendors) plan.skippedVendor.push(order.id);
    else if (order.status === "cancelled") (target === "cancelled" ? plan.unchanged : plan.skippedCancelled).push(order.id);
    else if (order.status === target) plan.unchanged.push(order.id);
    else plan.eligible.push(order.id);
  }
  return plan;
}

export function chunkOrderIds(ids: string[], size = BULK_ORDER_CHUNK_SIZE) {
  const chunks: string[][] = [];
  for (let index = 0; index < ids.length; index += size) chunks.push(ids.slice(index, index + size));
  return chunks;
}

/**
 * One bulk request counts an order as saved only when the database returned that order with the
 * new status. Orders RLS silently skipped, or that were cancelled meanwhile (the request excludes
 * cancelled rows), come back as notSaved instead of being reported as done.
 */
export function verifyBulkOrderStatusChunk(
  result: { data: Array<{ id: string; status: string }> | null; error: { message: string } | null },
  requestedIds: string[],
  status: BulkOrderStatus,
): { saved: string[]; notSaved: string[]; error: string | null } {
  if (result.error) {
    const message = result.error.message.includes("order_cancelled_is_final") ? CANCELLED_ORDER_FINAL_MESSAGE
      : result.error.message.includes("split_order_status_managed_per_vendor") ? SPLIT_ORDER_STATUS_MESSAGE : result.error.message;
    return { saved: [], notSaved: [...requestedIds], error: message };
  }
  const returned = new Set((result.data ?? []).filter((row) => row.status === status).map((row) => row.id));
  return {
    saved: requestedIds.filter((id) => returned.has(id)),
    notSaved: requestedIds.filter((id) => !returned.has(id)),
    error: null,
  };
}

export const ORDER_STATUS_NOT_SAVED_MESSAGE =
  "The status was not saved. Your Admin session may have expired; reload the page and try again.";

/**
 * Admin status changes count as saved only when the database returns exactly the updated row
 * with the new status: row-level security can silently match zero rows without an error.
 * Returns an error message, or null when the update is confirmed.
 */
export function verifyOrderStatusUpdate(
  result: { data: Array<{ id: string; status: string }> | null; error: { message: string } | null },
  orderId: string,
  status: OrderStatus,
): string | null {
  if (result.error)
    return result.error.message.includes("order_cancelled_is_final") ? CANCELLED_ORDER_FINAL_MESSAGE
      : result.error.message.includes("split_order_status_managed_per_vendor") ? SPLIT_ORDER_STATUS_MESSAGE : result.error.message;
  const [row, ...rest] = result.data ?? [];
  return row && rest.length === 0 && row.id === orderId && row.status === status
    ? null
    : ORDER_STATUS_NOT_SAVED_MESSAGE;
}
