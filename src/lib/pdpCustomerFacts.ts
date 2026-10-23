// Customer-facing PDP facts read only from stored variant data; nothing is inferred from the title,
// model, region or other variants. The Product Information block is for iPhones only (Android PDP stays unchanged).
import type { CatalogProduct, CatalogVariant } from "./catalog";
import { SIM_CONFIGURATIONS } from "./variantFacts.ts";

export type PdpFactTone = "positive" | "negative";
export type PdpInfoKey = "condition" | "pta" | "sim" | "battery" | "warranty";
/** value = the saved fact; value null = applicable but not supplied (Ask Seller). Not-applicable rows are left out. */
export type PdpInfoRow = { key: PdpInfoKey; label: string; value: string | null; tone: PdpFactTone | null };

const CONDITION_LABELS: Partial<Record<CatalogVariant["condition"], string>> = {
  brand_new: "New",
  used: "Used",
  open_box: "Open Box",
  refurbished: "Refurbished",
};
const PTA_FACTS: Partial<Record<CatalogVariant["ptaStatus"], { value: string; tone: PdpFactTone }>> = {
  approved: { value: "PTA Approved", tone: "positive" },
  not_approved: { value: "PTA Not Approved", tone: "negative" },
};
// Customer wording for the canonical SIM values (Admin keeps its own labels in variantFacts.ts).
const SIM_CUSTOMER_LABELS: Record<(typeof SIM_CONFIGURATIONS)[number]["value"], string> = {
  physical_sim: "Physical SIM",
  esim: "eSIM",
  physical_plus_esim: "Physical SIM + eSIM",
  dual_esim: "Dual eSIM",
  dual_physical_sim: "Dual Physical SIM",
};

/** iPhone = Apple brand in the Mobile Phones category (the same pairing the iPhone collection uses). */
export const isIphoneProduct = (product: Pick<CatalogProduct, "brand" | "category">) =>
  product.brand?.slug === "apple" && product.category?.slug === "mobile-phones";

/** Saved warranty text, or null when none is stored (warranty is then hidden). */
export const pdpWarrantyText = (variant: Pick<CatalogVariant, "warranty"> | undefined) =>
  variant?.warranty?.trim() || null;

export const simCustomerLabel = (value: string | null | undefined) =>
  value ? SIM_CUSTOMER_LABELS[value as keyof typeof SIM_CUSTOMER_LABELS] ?? null : null;

const batteryText = (value: number | null | undefined) =>
  typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 100 ? `${value}%` : null;

/**
 * Fixed iPhone Product Information rows for the selected variant (empty for every other product).
 * Not applicable, so left out: PTA "not applicable", Battery Health on New, Warranty when none is stored.
 */
export function pdpProductInformation(
  product: Pick<CatalogProduct, "brand" | "category">,
  variant: Pick<CatalogVariant, "condition" | "ptaStatus" | "warranty" | "simConfiguration" | "batteryHealthPercent"> | undefined,
): PdpInfoRow[] {
  if (!variant || !isIphoneProduct(product)) return [];
  const rows: PdpInfoRow[] = [];
  rows.push({ key: "condition", label: "Condition", value: CONDITION_LABELS[variant.condition] ?? null, tone: null });
  if (variant.ptaStatus !== "not_applicable") {
    const pta = PTA_FACTS[variant.ptaStatus];
    rows.push({ key: "pta", label: "PTA Status", value: pta?.value ?? null, tone: pta?.tone ?? null });
  }
  rows.push({ key: "sim", label: "SIM Type", value: simCustomerLabel(variant.simConfiguration), tone: null });
  if (variant.condition !== "brand_new")
    rows.push({ key: "battery", label: "Battery Health", value: batteryText(variant.batteryHealthPercent), tone: null });
  const warranty = pdpWarrantyText(variant);
  if (warranty) rows.push({ key: "warranty", label: "Warranty", value: warranty, tone: null });
  return rows;
}

export type AskSellerInput = {
  whatsappNumber: string | null | undefined;
  productTitle: string;
  storage?: string | null;
  color?: string | null;
  field: string;
  productUrl: string;
};

/** wa.me link with a field-specific message; null when the WhatsApp number is missing or invalid. */
export function askSellerWhatsappUrl(input: AskSellerInput): string | null {
  const number = input.whatsappNumber?.trim() ?? "";
  if (!/^\d{10,15}$/.test(number)) return null;
  const subject = [input.productTitle, input.storage, input.color].map((part) => part?.trim()).filter(Boolean).join(", ");
  const message = `Assalam o Alaikum, mujhe ${subject} ki ${input.field} confirm karni hai.\nProduct: ${input.productUrl}`;
  return `https://wa.me/${number}?text=${encodeURIComponent(message)}`;
}
