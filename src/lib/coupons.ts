// Checkout coupons v1 — shared, display/validation helpers only. Discount amounts are always
// computed by the database (evaluate_storefront_coupon / create_storefront_order).
import { formatPkrMinor, parsePkrMajorToMinor } from "./money.ts";

export type CouponDiscountType = "percentage" | "fixed_amount" | "free_shipping";
export type CouponScope = "all" | "category" | "product";
export type CouponStatus = "active" | "scheduled" | "expired" | "disabled";

export const COUPON_CODE_MAX_LENGTH = 32;
/** Mirrors the coupons_code_format check: 3-32 chars, A-Z 0-9 - _, starting with a letter/digit. */
export const COUPON_CODE_PATTERN = /^[A-Z0-9][A-Z0-9_-]{2,31}$/;

export type CouponRow = {
  id: string;
  code: string;
  name: string;
  description: string | null;
  discount_type: CouponDiscountType;
  discount_value: number | null;
  minimum_order_minor: number | null;
  maximum_discount_minor: number | null;
  starts_at: string | null;
  ends_at: string | null;
  total_usage_limit: number | null;
  per_customer_usage_limit: number | null;
  applies_to: CouponScope;
  category_id: string | null;
  product_id: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

export function canonicalCouponCode(input: string) {
  return input.trim().toUpperCase();
}

export function isValidCouponCode(input: string) {
  return COUPON_CODE_PATTERN.test(canonicalCouponCode(input));
}

// Generator alphabet without look-alike characters (no I, L, O, 0, 1).
const GENERATOR_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

function randomSuffix(length: number, random: () => number) {
  let suffix = "";
  for (let index = 0; index < length; index += 1)
    suffix += GENERATOR_ALPHABET[Math.floor(random() * GENERATOR_ALPHABET.length) % GENERATOR_ALPHABET.length];
  return suffix;
}

function secureRandom() {
  const buffer = new Uint32Array(1);
  globalThis.crypto.getRandomValues(buffer);
  return buffer[0] / 0x1_0000_0000;
}

/** Prefix suggestion from the form: SAVE10, SAVE500, FREESHIP. */
export function suggestedCouponPrefix(discountType: CouponDiscountType, discountValue: string) {
  const value = discountValue.trim().replaceAll(",", "");
  if (discountType === "free_shipping") return "FREESHIP";
  if (/^\d+(?:\.\d+)?$/.test(value) && Number(value) > 0) return `SAVE${Math.floor(Number(value))}`;
  return "SAVE";
}

/**
 * A professional code such as SAVE10-X7K2 or EID500-P4N8. Uses the prefix already typed in the
 * code field (text before the first "-") when it is valid, otherwise the suggested prefix.
 * Uniqueness is still enforced by the database unique index on save.
 */
export function generateCouponCode(currentCode: string, fallbackPrefix: string, random: () => number = secureRandom) {
  const typed = canonicalCouponCode(currentCode).split("-")[0].replace(/[^A-Z0-9_]/g, "");
  const prefix = (typed.length >= 2 ? typed : canonicalCouponCode(fallbackPrefix).replace(/[^A-Z0-9_]/g, "") || "SAVE").slice(0, 20);
  return `${prefix}-${randomSuffix(4, random)}`;
}

export function couponStatus(coupon: Pick<CouponRow, "is_active" | "starts_at" | "ends_at">, now = new Date()): CouponStatus {
  if (!coupon.is_active) return "disabled";
  if (coupon.starts_at && new Date(coupon.starts_at) > now) return "scheduled";
  if (coupon.ends_at && new Date(coupon.ends_at) <= now) return "expired";
  return "active";
}

export const couponStatusLabel: Record<CouponStatus, string> = {
  active: "Active",
  scheduled: "Scheduled",
  expired: "Expired",
  disabled: "Disabled",
};

export const couponTypeLabel: Record<CouponDiscountType, string> = {
  percentage: "Percentage",
  fixed_amount: "Fixed amount",
  free_shipping: "Free shipping",
};

export function describeCouponValue(coupon: Pick<CouponRow, "discount_type" | "discount_value" | "maximum_discount_minor">) {
  if (coupon.discount_type === "free_shipping") return "Free shipping";
  if (coupon.discount_type === "percentage")
    return `${coupon.discount_value}% off${coupon.maximum_discount_minor ? ` · max ${formatPkrMinor(coupon.maximum_discount_minor)}` : ""}`;
  return `${formatPkrMinor(coupon.discount_value ?? 0)} off`;
}

// --- Storefront reason codes (returned by validate_storefront_coupon or raised by order creation).
export const COUPON_REASONS = [
  "coupon_invalid",
  "coupon_inactive",
  "coupon_not_started",
  "coupon_expired",
  "coupon_not_applicable",
  "coupon_minimum_not_met",
  "coupon_usage_limit_reached",
  "coupon_customer_limit_reached",
  "cart_invalid",
] as const;
export type CouponReason = (typeof COUPON_REASONS)[number] | "ok";

export function couponReasonMessage(reason: string | null | undefined) {
  switch (reason) {
    case "ok":
      return "Coupon applied";
    case "coupon_not_started":
      return "Coupon not active yet";
    case "coupon_expired":
      return "Coupon expired";
    case "coupon_minimum_not_met":
      return "Minimum order not met";
    case "coupon_usage_limit_reached":
    case "coupon_customer_limit_reached":
      return "Usage limit reached";
    case "coupon_not_applicable":
      return "Coupon not valid for these products";
    case "cart_invalid":
      return "Your cart has changed. Please review it and try again.";
    default:
      return "Invalid coupon";
  }
}

/** The coupon reason inside an order-creation error message, if any. */
export function couponReasonFromError(message: string): CouponReason | null {
  return COUPON_REASONS.find((reason) => reason !== "cart_invalid" && message.includes(reason)) ?? null;
}

// --- Admin form ---------------------------------------------------------------------------
export type CouponFormValues = {
  code: string;
  name: string;
  description: string;
  discountType: CouponDiscountType;
  discountValue: string;
  minimumOrder: string;
  maximumDiscount: string;
  startsAt: string;
  endsAt: string;
  totalUsageLimit: string;
  perCustomerUsageLimit: string;
  appliesTo: CouponScope;
  categoryId: string;
  productId: string;
  isActive: boolean;
};

export type CouponPayload = Omit<CouponRow, "id" | "created_at" | "updated_at">;
export type CouponFormResult = { ok: true; payload: CouponPayload } | { ok: false; errors: Partial<Record<keyof CouponFormValues, string>> };

const optionalMinor = (value: string) => (value.trim() ? parsePkrMajorToMinor(value) : null);
const optionalPositiveInt = (value: string) => {
  const text = value.trim();
  if (!text) return null;
  if (!/^\d+$/.test(text) || Number(text) < 1 || Number(text) > 1_000_000) throw new Error("Enter a whole number of 1 or more.");
  return Number(text);
};
const optionalIso = (value: string) => {
  if (!value.trim()) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error("Enter a valid date and time.");
  return date.toISOString();
};

/** Validates the Admin form and builds the row to save. The database re-checks every rule. */
export function buildCouponPayload(values: CouponFormValues): CouponFormResult {
  const errors: Partial<Record<keyof CouponFormValues, string>> = {};
  const field = <T,>(key: keyof CouponFormValues, read: () => T): T | null => {
    try {
      return read();
    } catch (error) {
      errors[key] = error instanceof Error ? error.message : "Invalid value.";
      return null;
    }
  };

  const code = canonicalCouponCode(values.code);
  if (!code) errors.code = "Enter a coupon code.";
  else if (!COUPON_CODE_PATTERN.test(code))
    errors.code = "Use 3–32 characters: letters, numbers, hyphen or underscore.";
  const name = values.name.trim();
  if (!name) errors.name = "Enter an internal name.";
  else if (name.length > 120) errors.name = "Keep the name under 120 characters.";
  if (values.description.trim().length > 1000) errors.description = "Keep the note under 1,000 characters.";

  let discountValue: number | null = null;
  if (values.discountType === "percentage") {
    const text = values.discountValue.trim();
    if (!/^\d+$/.test(text) || Number(text) < 1 || Number(text) > 100) errors.discountValue = "Enter a whole percentage from 1 to 100.";
    else discountValue = Number(text);
  } else if (values.discountType === "fixed_amount") {
    discountValue = field("discountValue", () => optionalMinor(values.discountValue));
    if (!errors.discountValue && (!discountValue || discountValue <= 0)) errors.discountValue = "Enter an amount above Rs 0.";
  }

  const minimumOrder = field("minimumOrder", () => optionalMinor(values.minimumOrder));
  let maximumDiscount: number | null = null;
  if (values.discountType === "percentage") {
    maximumDiscount = field("maximumDiscount", () => optionalMinor(values.maximumDiscount));
    if (maximumDiscount === 0) errors.maximumDiscount = "Leave empty for no cap, or enter an amount above Rs 0.";
  }
  const startsAt = field("startsAt", () => optionalIso(values.startsAt));
  const endsAt = field("endsAt", () => optionalIso(values.endsAt));
  if (startsAt && endsAt && new Date(endsAt) <= new Date(startsAt)) errors.endsAt = "End must be after the start.";
  const totalUsageLimit = field("totalUsageLimit", () => optionalPositiveInt(values.totalUsageLimit));
  const perCustomerUsageLimit = field("perCustomerUsageLimit", () => optionalPositiveInt(values.perCustomerUsageLimit));
  if (values.appliesTo === "category" && !values.categoryId) errors.categoryId = "Choose a category.";
  if (values.appliesTo === "product" && !values.productId) errors.productId = "Choose a product.";

  if (Object.keys(errors).length) return { ok: false, errors };
  return {
    ok: true,
    payload: {
      code,
      name,
      description: values.description.trim() || null,
      discount_type: values.discountType,
      discount_value: discountValue,
      minimum_order_minor: minimumOrder,
      maximum_discount_minor: values.discountType === "percentage" ? maximumDiscount : null,
      starts_at: startsAt,
      ends_at: endsAt,
      total_usage_limit: totalUsageLimit,
      per_customer_usage_limit: perCustomerUsageLimit,
      applies_to: values.appliesTo,
      category_id: values.appliesTo === "category" ? values.categoryId : null,
      product_id: values.appliesTo === "product" ? values.productId : null,
      is_active: values.isActive,
    },
  };
}

/** A datetime-local input value ("2026-10-05T14:30") in the viewer's time zone. */
export function toDateTimeLocal(iso: string | null) {
  if (!iso) return "";
  const date = new Date(iso);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function couponFormValuesFrom(coupon: CouponRow | null): CouponFormValues {
  const major = (minor: number | null) => (minor === null ? "" : String(minor / 100));
  return {
    code: coupon?.code ?? "",
    name: coupon?.name ?? "",
    description: coupon?.description ?? "",
    discountType: coupon?.discount_type ?? "percentage",
    discountValue: coupon
      ? coupon.discount_type === "fixed_amount" ? major(coupon.discount_value) : String(coupon.discount_value ?? "")
      : "",
    minimumOrder: major(coupon?.minimum_order_minor ?? null),
    maximumDiscount: major(coupon?.maximum_discount_minor ?? null),
    startsAt: toDateTimeLocal(coupon?.starts_at ?? null),
    endsAt: toDateTimeLocal(coupon?.ends_at ?? null),
    totalUsageLimit: coupon?.total_usage_limit ? String(coupon.total_usage_limit) : "",
    perCustomerUsageLimit: coupon?.per_customer_usage_limit ? String(coupon.per_customer_usage_limit) : "",
    appliesTo: coupon?.applies_to ?? "all",
    categoryId: coupon?.category_id ?? "",
    productId: coupon?.product_id ?? "",
    isActive: coupon?.is_active ?? true,
  };
}
