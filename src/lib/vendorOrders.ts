// Two-Vendor Order Management (migration 202611150002). Pure helpers shared by Admin Orders, the Staff
// Dashboard and the tests. The database is the real gate: these only mirror its rules for the UI.
import { ACCESSORIES_EXTRA_PRODUCT_IDS } from "./collections.ts";
import type { OrderStatus } from "./orderRules.ts";

export const VENDOR_CODES = ["isolutions", "piyavey"] as const;
export type VendorCode = (typeof VENDOR_CODES)[number];
export const VENDOR_LABELS: Record<VendorCode, string> = { isolutions: "iSolutions Pakistan", piyavey: "Piyavey" };
export const vendorLabel = (code: string | null | undefined) =>
  code && code in VENDOR_LABELS ? VENDOR_LABELS[code as VendorCode] : code || "Unassigned";

/** Vendor fulfilment statuses (a vendor part never goes back to New). */
export type FulfilmentStatus = Exclude<OrderStatus, "new">;
export const FULFILMENT_STATUSES: FulfilmentStatus[] = ["confirmed", "processing", "in_transit", "completed", "cancelled"];

/**
 * Suggested vendor for an order line (Owner rule 2026-11-14). Piyavey handles Home Gadgets only: products in the
 * `gadgets` category, EXCEPT the watches / bands that stay in that category but are shown in Mobile Accessories
 * (ACCESSORIES_EXTRA_PRODUCT_IDS, matched by product ID). Everything else (mobile phones, accessories, tablets,
 * iPads, MacBooks, watches / bands) is iSolutions Pakistan. Unknown category = no suggestion.
 * This is only a suggestion: the Admin confirms it, nothing is assigned at checkout.
 */
export function suggestVendor(item: { productId: string | null; categorySlug: string | null | undefined }): VendorCode | null {
  if (!item.categorySlug) return null;
  if (item.categorySlug === "gadgets" && !(item.productId && ACCESSORIES_EXTRA_PRODUCT_IDS.includes(item.productId))) return "piyavey";
  return "isolutions";
}

export type FulfilmentLike = { status: FulfilmentStatus; hasItems: boolean };

/**
 * Parent order status from its vendor parts, mirrored from derive_order_status_from_fulfilments: parts without
 * items are ignored; all cancelled = Cancelled; no active part left = Delivered; otherwise the earliest active stage.
 */
export function deriveOrderStatus(fulfilments: readonly FulfilmentLike[]): OrderStatus | null {
  const live = fulfilments.filter((part) => part.hasItems).map((part) => part.status);
  if (!live.length) return null;
  if (live.every((status) => status === "cancelled")) return "cancelled";
  for (const stage of ["confirmed", "processing", "in_transit"] as const) if (live.includes(stage)) return stage;
  return "completed";
}

/** Some vendor parts cancelled while another part is still going or delivered. */
export function isPartiallyCancelled(fulfilments: readonly FulfilmentLike[]) {
  const live = fulfilments.filter((part) => part.hasItems);
  return live.some((part) => part.status === "cancelled") && live.some((part) => part.status !== "cancelled");
}

type OrderWithParts = {
  order_items: ReadonlyArray<{ vendor_id: string | null }>;
  order_fulfilments?: ReadonlyArray<{ vendor_id: string; status: FulfilmentStatus }>;
};
/** The order has vendor parts (released to vendors, 202611150002). */
export const isReleasedToVendors = (order: { order_fulfilments?: readonly unknown[] }) => Boolean(order.order_fulfilments?.length);
/** Vendor parts that still carry items (a reassignment can empty one; empty parts are kept but not shown). */
export function liveFulfilments<T extends OrderWithParts>(order: T): NonNullable<T["order_fulfilments"]>[number][] {
  return (order.order_fulfilments ?? []).filter((part) => order.order_items.some((item) => item.vendor_id === part.vendor_id));
}
export const orderPartiallyCancelled = (order: OrderWithParts) =>
  isPartiallyCancelled(liveFulfilments(order).map((part) => ({ status: part.status, hasItems: true })));

/** D1: release needs at least one item and every item assigned to a vendor. */
export function releaseBlocker(items: ReadonlyArray<{ vendor: VendorCode | null }>): string | null {
  if (!items.length) return "This order has no items.";
  const missing = items.filter((item) => !item.vendor).length;
  return missing ? `Assign ${missing === 1 ? "1 item" : `${missing} items`} to a vendor before release.` : null;
}

/** D3: after release an item may move only while its own and the target vendor part are still Received. */
export function canReassign(source: FulfilmentStatus | null, target: FulfilmentStatus | null) {
  return source === "confirmed" && (target === null || target === "confirmed");
}

/** Readable messages for the vendor RPC error codes (Admin and Staff). */
export function vendorErrorMessage(message: string) {
  if (message.includes("order_items_unassigned")) return "Assign every item to a vendor before releasing the order.";
  if (message.includes("order_already_released_to_vendors")) return "This order is already released to vendors. Reload the page.";
  if (message.includes("order_not_releasable")) return "Only New or Received orders can be released to vendors.";
  if (message.includes("fulfilment_not_reassignable")) return "Items can move to another vendor only while both vendor parts are still Received.";
  if (message.includes("order_item_vendor_required")) return "A released item must stay assigned to a vendor.";
  if (message.includes("order_not_assignable")) return "Delivered or cancelled orders cannot be assigned to vendors.";
  if (message.includes("fulfilment_cancelled_is_final")) return "This vendor part is cancelled. Cancelled parts are final.";
  if (message.includes("split_order_status_managed_per_vendor")) return "This order is released to vendors. Change each vendor's status instead.";
  if (message.includes("fulfilment_has_no_items")) return "This vendor part has no items any more.";
  if (message.includes("vendor_invalid")) return "Choose a valid vendor.";
  return message;
}
