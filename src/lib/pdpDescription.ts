/**
 * PDP "Product Information" text for Gadgets: the Owner's description (products.content) shown as clean paragraphs.
 * Display only — the stored text is never changed. A blank line starts a new paragraph, a single line break stays a line
 * break, and runs of spaces/tabs inside a line show as one space. The result is plain text: React renders it, never HTML.
 */
import type { CatalogProduct, CatalogVariant } from "./catalog.ts";
import { formatPkrMinor } from "./money.ts";

export const isGadgetProduct = (product: Pick<CatalogProduct, "category">) => product.category?.slug === "gadgets";

/** Paragraphs, each a list of lines. Empty when the text is blank. */
export function descriptionParagraphs(text: string | null | undefined): string[][] {
  const plain = (text ?? "").replace(/\r\n?/g, "\n").trim();
  if (!plain) return [];
  return plain
    .split(/\n[ \t]*\n\s*/)
    .map((paragraph) =>
      paragraph
        .split("\n")
        .map((line) => line.replace(/[ \t\u00a0]+/g, " ").trim())
        .filter(Boolean),
    )
    .filter((lines) => lines.length > 0);
}

export type GadgetWhatsappOrderInput = {
  whatsappNumber: string | null | undefined;
  productTitle: string;
  /** Selected variant label (storage / colour) when the product has one; omitted otherwise. */
  variantLabel?: string | null;
  quantity: number;
  /** The unit price as shown on the page, in minor units. */
  unitPriceMinor: number;
  productUrl: string;
};

/**
 * Gadgets PDP "Order on WhatsApp": a wa.me link with an order enquiry for the selected product. Only what the page shows
 * (name, variant, quantity, price, link) — no customer details. It creates no website order. Null when the number is invalid.
 */
export function gadgetWhatsappOrderUrl(input: GadgetWhatsappOrderInput): string | null {
  const number = input.whatsappNumber?.trim() ?? "";
  if (!/^\d{10,15}$/.test(number)) return null;
  const quantity = Number.isSafeInteger(input.quantity) && input.quantity > 0 ? input.quantity : 1;
  const lines = [
    "Assalam o Alaikum, mujhe ye product order karna hai:",
    `Product: ${input.productTitle.trim()}`,
    ...(input.variantLabel?.trim() ? [`Variant: ${input.variantLabel.trim()}`] : []),
    `Quantity: ${quantity}`,
    `Price: ${formatPkrMinor(input.unitPriceMinor)} each`,
    `Link: ${input.productUrl}`,
  ];
  return `https://wa.me/${number}?text=${encodeURIComponent(lines.join("\n"))}`;
}

export type GadgetDeliveryRules = { freeThresholdMinor: number; standardFeeMinor: number; fastSurchargeMinor: number };
export type GadgetDeliveryRow = { key: "standard" | "fast"; label: string; price: string; offer: string };
export type GadgetDeliveryInfo = {
  /** Card heading from the stored delivery scope: nationwide is the only scope that says "Across Pakistan". */
  heading: string;
  rows: GadgetDeliveryRow[];
  note: string;
};

/** Delivery facts for the Gadgets PDP, built only from the stored delivery scope and the checkout shipping rules. */
export function gadgetDeliveryInfo(scope: CatalogVariant["deliveryScope"] | undefined, rules: GadgetDeliveryRules): GadgetDeliveryInfo {
  const threshold = formatPkrMinor(rules.freeThresholdMinor);
  return {
    heading: scope === "nationwide" ? "Delivery Across Pakistan" : scope === "karachi_only" ? "Delivery in Karachi Only" : "Delivery",
    rows: [
      { key: "standard", label: "Standard Delivery", price: formatPkrMinor(rules.standardFeeMinor), offer: `Free on orders of ${threshold} or more` },
      {
        key: "fast",
        label: "Fast Delivery",
        price: formatPkrMinor(rules.standardFeeMinor + rules.fastSurchargeMinor),
        offer: `${formatPkrMinor(rules.fastSurchargeMinor)} on orders of ${threshold} or more`,
      },
    ],
    note: "Final delivery charges are calculated at checkout based on your order total.",
  };
}
