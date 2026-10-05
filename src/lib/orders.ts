import { supabase } from "./supabase";

const ORDER_CONFIRMATION_STORAGE_KEY = "isolutions-storefront-order-confirmation";

export type ShippingMethod = "standard" | "fast";

// Rs 10,000 in paisa (minor units). Standard Delivery is free at or above this subtotal.
export const FREE_STANDARD_DELIVERY_THRESHOLD_MINOR = 1_000_000;
// Rs 200 in paisa (minor units). Base delivery fee below the free-delivery threshold.
export const STANDARD_DELIVERY_FEE_MINOR = 20_000;
// Rs 200 in paisa (minor units). Fast Delivery always adds this surcharge.
export const FAST_DELIVERY_SURCHARGE_MINOR = 20_000;

// Display-only mirror of the server-side calculation in create_storefront_order;
// the server recalculates and stores the authoritative fee.
export function calculateDeliveryFeeMinor(subtotalMinor: number, shippingMethod: ShippingMethod) {
  const baseDeliveryFeeMinor = subtotalMinor >= FREE_STANDARD_DELIVERY_THRESHOLD_MINOR ? 0 : STANDARD_DELIVERY_FEE_MINOR;
  return baseDeliveryFeeMinor + (shippingMethod === "fast" ? FAST_DELIVERY_SURCHARGE_MINOR : 0);
}

export type StorefrontOrderConfirmation = {
  orderNumber: string;
  paymentMethod: "cash_on_delivery" | "bank_transfer";
  shippingMethod: ShippingMethod;
  subtotalMinor: number;
  deliveryFeeMinor: number;
  shippingSurchargeMinor: number;
  totalMinor: number;
  couponCode?: string | null;
  discountMinor?: number;
  shippingDiscountMinor?: number;
};

export type CouponPreview = {
  valid: boolean;
  reason: string;
  code: string;
  discountType: "percentage" | "fixed_amount" | "free_shipping" | null;
  subtotalMinor: number;
  eligibleSubtotalMinor: number;
  discountMinor: number;
  deliveryFeeMinor: number;
  shippingDiscountMinor: number;
  totalMinor: number;
};

// Informational preview from validate_storefront_coupon. The order itself is re-validated and
// priced by create_storefront_order, so a stale or edited preview can never change the total.
export async function validateStorefrontCoupon(input: {
  code: string;
  items: Array<{ variantId: string; quantity: number }>;
  shippingMethod: ShippingMethod;
  phone: string | null;
}): Promise<CouponPreview> {
  if (!supabase) throw new Error("Checkout is not configured yet.");
  const { data, error } = await supabase.rpc("validate_storefront_coupon", {
    p_code: input.code,
    p_items: input.items.map((item) => ({ variant_id: item.variantId, quantity: item.quantity })),
    p_shipping_method: input.shippingMethod,
    p_phone: input.phone,
  });
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) throw new Error("We could not check this coupon. Please try again.");
  return {
    valid: Boolean(row.valid),
    reason: String(row.reason ?? "coupon_invalid"),
    code: String(row.code ?? input.code),
    discountType: row.discount_type ?? null,
    subtotalMinor: Number(row.subtotal_minor ?? 0),
    eligibleSubtotalMinor: Number(row.eligible_subtotal_minor ?? 0),
    discountMinor: Number(row.discount_minor ?? 0),
    deliveryFeeMinor: Number(row.delivery_fee_minor ?? 0),
    shippingDiscountMinor: Number(row.shipping_discount_minor ?? 0),
    totalMinor: Number(row.total_minor ?? 0),
  };
}

type CreateStorefrontOrderInput = {
  customerName: string;
  phone: string;
  email: string | null;
  city: "Karachi" | "Other city in Pakistan";
  otherCity: string | null;
  fullDeliveryAddress: string;
  areaLandmark: string | null;
  orderNotes: string | null;
  paymentMethod: "cash_on_delivery" | "bank_transfer";
  shippingMethod: ShippingMethod;
  items: Array<{ variantId: string; quantity: number }>;
  couponCode?: string | null;
};

export async function createStorefrontOrder(input: CreateStorefrontOrderInput) {
  if (!supabase) throw new Error("Checkout is not configured yet.");

  const { data, error } = await supabase.rpc("create_storefront_order", {
    p_customer_name: input.customerName,
    p_phone: input.phone,
    p_email: input.email,
    p_city: input.city,
    p_other_city: input.otherCity,
    p_full_delivery_address: input.fullDeliveryAddress,
    p_area_landmark: input.areaLandmark,
    p_order_notes: input.orderNotes,
    p_payment_method: input.paymentMethod,
    p_shipping_method: input.shippingMethod,
    p_items: input.items.map((item) => ({ variant_id: item.variantId, quantity: item.quantity })),
    // Sent only with a coupon, so a coupon-free checkout calls the same signature as before.
    ...(input.couponCode ? { p_coupon_code: input.couponCode } : {}),
  });
  if (error) throw error;

  const row = Array.isArray(data) ? data[0] : data;
  if (!row?.order_number) throw new Error("We could not confirm your order. Please try again.");

  return {
    orderNumber: row.order_number as string,
    paymentMethod: row.payment_method as StorefrontOrderConfirmation["paymentMethod"],
    shippingMethod: row.shipping_method as ShippingMethod,
    subtotalMinor: Number(row.subtotal_minor),
    deliveryFeeMinor: Number(row.delivery_fee_minor),
    shippingSurchargeMinor: Number(row.shipping_surcharge_minor ?? 0),
    totalMinor: Number(row.total_minor),
    couponCode: (row.coupon_code as string | null) ?? null,
    discountMinor: Number(row.discount_minor ?? 0),
    shippingDiscountMinor: Number(row.shipping_discount_minor ?? 0),
  } satisfies StorefrontOrderConfirmation;
}

export function saveStorefrontOrderConfirmation(confirmation: StorefrontOrderConfirmation) {
  sessionStorage.setItem(ORDER_CONFIRMATION_STORAGE_KEY, JSON.stringify(confirmation));
}

export function readStorefrontOrderConfirmation(): StorefrontOrderConfirmation | null {
  try {
    const parsed = JSON.parse(sessionStorage.getItem(ORDER_CONFIRMATION_STORAGE_KEY) ?? "null");
    return parsed && typeof parsed.orderNumber === "string" &&
      (parsed.paymentMethod === "cash_on_delivery" || parsed.paymentMethod === "bank_transfer") &&
      Number.isFinite(parsed.subtotalMinor) && Number.isFinite(parsed.deliveryFeeMinor) && Number.isFinite(parsed.totalMinor)
      ? parsed as StorefrontOrderConfirmation
      : null;
  } catch {
    return null;
  }
}
