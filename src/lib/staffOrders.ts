// Staff Orders Dashboard helpers (Phase 2). Pure functions only, so they are unit-tested without a
// browser. Access control lives in the database (202611140002); these only shape the UI.
import { type OrderStatus, STAFF_ACTIVE_STATUSES } from "./orderRules.ts";

/** How often the staff dashboard re-checks for released orders (and on tab focus). */
export const STAFF_POLL_MS = 30_000;

/** Button text for each status a staff member can move an order to. */
export const STAFF_ACTION_LABELS: Partial<Record<OrderStatus, string>> = {
  processing: "Start processing",
  in_transit: "Mark In Transit",
  completed: "Mark Delivered",
  cancelled: "Cancel order",
};

export const isStaffActive = (status: OrderStatus) => STAFF_ACTIVE_STATUSES.includes(status);

/** Active = Received / In Process / In Transit; History = Delivered / Cancelled. */
export function splitStaffOrders<T extends { status: OrderStatus }>(orders: T[]) {
  return {
    active: orders.filter((order) => isStaffActive(order.status)),
    history: orders.filter((order) => !isStaffActive(order.status)),
  };
}

/**
 * New Orders badge: active released orders this staff account has not opened yet. Independent of
 * the order status — an order still "Received" stops counting once it has been opened.
 */
export function unseenOrderIds<T extends { id: string; status: OrderStatus }>(orders: T[], seen: ReadonlySet<string>) {
  return orders.filter((order) => isStaffActive(order.status) && !seen.has(order.id)).map((order) => order.id);
}

/** Digits for dialling, keeping a leading "+" if the customer typed one. */
export function telHref(phone: string) {
  const value = phone.trim();
  const digits = value.replace(/\D/g, "");
  return digits ? `tel:${value.startsWith("+") ? "+" : ""}${digits}` : null;
}

/**
 * WhatsApp link in international format. Pakistani numbers are normalised:
 * 03001234567 -> 923001234567, 3001234567 -> 923001234567, +92 300 1234567 -> 923001234567,
 * 0092... -> 92...; other numbers with 10–15 digits are used as typed.
 */
export function whatsappHref(phone: string) {
  let digits = phone.replace(/\D/g, "");
  if (digits.startsWith("00")) digits = digits.slice(2);
  if (/^03\d{9}$/.test(digits)) digits = `92${digits.slice(1)}`;
  else if (/^3\d{9}$/.test(digits)) digits = `92${digits}`;
  return digits.length >= 10 && digits.length <= 15 ? `https://wa.me/${digits}` : null;
}

/** Plain-language message for the database errors the staff RPCs raise. */
export function staffErrorMessage(message: string) {
  if (message.includes("staff_access_required")) return "This account is not an active Staff account. Please sign in again or contact the Owner.";
  if (message.includes("order_not_available")) return "This order is not available to staff any more. Refresh the list.";
  if (message.includes("order_status_transition_not_allowed")) return "This status change is not allowed for this order. Refresh the list; it may have been updated already.";
  if (message.includes("order_cancelled_is_final") || message.includes("fulfilment_cancelled_is_final"))
    return "This order is cancelled. Cancelled orders are final.";
  if (/function .*does not exist|could not find the function|schema cache/i.test(message))
    return "The Staff Dashboard is not enabled on this database yet (migration pending).";
  return message;
}
