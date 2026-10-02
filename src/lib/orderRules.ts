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

export type OrderStatus = "new" | "confirmed" | "processing" | "completed" | "cancelled";

export const CANCELLED_ORDER_FINAL_MESSAGE =
  "This order is cancelled. Cancelled orders are final and their status cannot be changed.";

/** Cancelled is terminal: the database rejects any change away from it (order_cancelled_is_final). */
export function canChangeOrderStatus(current: OrderStatus) {
  return current !== "cancelled";
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
    return result.error.message.includes("order_cancelled_is_final") ? CANCELLED_ORDER_FINAL_MESSAGE : result.error.message;
  const [row, ...rest] = result.data ?? [];
  return row && rest.length === 0 && row.id === orderId && row.status === status
    ? null
    : ORDER_STATUS_NOT_SAVED_MESSAGE;
}
