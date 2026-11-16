// Admin "New Order Alert" email: payload validation, rendering and delivery loop.
// Pure TypeScript (no Deno / Node APIs) so the Edge Function and the Node tests share exactly the same code.
//
// The payload is the outbox snapshot written by migration 202611170001 at commit of the checkout transaction:
// order number, placed time, payment + shipping method, server-calculated amounts and the items. It never contains
// customer name, phone, email, address, city or notes, so the email cannot show them.
import {
  type EmailTransport, type NotificationItem, type OutgoingEmail, type SendResult,
  DEFAULT_SITE_URL, errorText, itemFacts,
} from "./vendorNotificationEmail.ts";

export type AdminOrderItem = NotificationItem & { unit_price_minor: number; line_total_minor: number };
export type AdminOrderPayload = {
  order_number: string; placed_at: string; payment_method: string; shipping_method: string;
  subtotal_minor: number; delivery_fee_minor: number; discount_minor: number; shipping_discount_minor: number;
  total_minor: number; coupon_code: string | null; items: AdminOrderItem[];
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const minor = (value: unknown, field: string) => {
  const amount = Number(value);
  if (value === null || value === undefined || !Number.isFinite(amount) || !Number.isInteger(amount) || amount < 0)
    throw new Error(`payload_${field}_invalid`);
  return amount;
};

/** Rejects anything that is not exactly the outbox snapshot shape (a malformed row is reported, never sent). */
export function parseAdminOrderPayload(value: unknown): AdminOrderPayload {
  if (!isRecord(value)) throw new Error("payload_invalid");
  if (typeof value.order_number !== "string" || !value.order_number.trim()) throw new Error("payload_order_number_missing");
  if (!Array.isArray(value.items) || value.items.length === 0) throw new Error("payload_items_missing");
  return {
    order_number: value.order_number,
    placed_at: typeof value.placed_at === "string" ? value.placed_at : "",
    payment_method: typeof value.payment_method === "string" ? value.payment_method : "",
    shipping_method: typeof value.shipping_method === "string" ? value.shipping_method : "",
    subtotal_minor: minor(value.subtotal_minor, "subtotal"),
    delivery_fee_minor: minor(value.delivery_fee_minor, "delivery_fee"),
    discount_minor: minor(value.discount_minor ?? 0, "discount"),
    shipping_discount_minor: minor(value.shipping_discount_minor ?? 0, "shipping_discount"),
    total_minor: minor(value.total_minor, "total"),
    coupon_code: typeof value.coupon_code === "string" && value.coupon_code.trim() ? value.coupon_code : null,
    items: value.items.map((item) => {
      if (!isRecord(item) || typeof item.title !== "string" || !Number.isInteger(item.quantity) || Number(item.quantity) < 1)
        throw new Error("payload_item_invalid");
      return {
        title: item.title, sku: typeof item.sku === "string" ? item.sku : "",
        variant: isRecord(item.variant) ? item.variant : null, quantity: Number(item.quantity),
        unit_price_minor: minor(item.unit_price_minor, "unit_price"), line_total_minor: minor(item.line_total_minor, "line_total"),
      };
    }),
  };
}

const escapeHtml = (value: string) => value.replace(/[&<>"']/g, (char) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!);
const oneLine = (value: string) => value.replace(/[\r\n]+/g, " ").trim();

const PAYMENT_LABELS: Record<string, string> = { cash_on_delivery: "Cash on Delivery", bank_transfer: "Bank Transfer" };
const SHIPPING_LABELS: Record<string, string> = { standard: "Standard Delivery", fast: "Fast Delivery" };
export const paymentLabel = (code: string) => PAYMENT_LABELS[code] ?? "Not specified";
export const shippingLabel = (code: string) => SHIPPING_LABELS[code] ?? "Not specified";

/** Rs with thousands separators; paisa shown only when present. */
export function formatRs(amountMinor: number) {
  const rupees = Math.floor(amountMinor / 100);
  const paisa = amountMinor % 100;
  return `Rs ${rupees.toLocaleString("en-US")}${paisa ? `.${String(paisa).padStart(2, "0")}` : ""}`;
}

/** Pakistan time, e.g. "16 Nov 2026, 3:45 PM PKT". Falls back to the raw value if it cannot be parsed. */
export function formatPlacedAt(value: string) {
  const time = Date.parse(value);
  if (!Number.isFinite(time)) return oneLine(value) || "Not available";
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Karachi", day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit", hour12: true,
  }).formatToParts(new Date(time));
  const part = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${part("day")} ${part("month")} ${part("year")}, ${part("hour")}:${part("minute")} ${part("dayPeriod").toUpperCase()} PKT`;
}

export function adminOrdersUrl(siteUrl: string | undefined) {
  const base = (siteUrl && /^https?:\/\//.test(siteUrl) ? siteUrl : DEFAULT_SITE_URL).replace(/\/+$/, "");
  return `${base}/admin/orders`;
}

const C = { ink: "#111614", muted: "#66706B", line: "#D9DEDA", soft: "#F4F6F4", accent: "#F0643A", button: "#101A17" };
const FONT = "Arial,Helvetica,sans-serif";
const FOOTER = "Automated New Order Alert from iSolutions Pakistan. Please do not reply.";

const row = (label: string, value: string, strong = false) =>
  `<tr><td style="padding:5px 12px 5px 0;width:42%;font-size:13px;line-height:20px;color:${C.muted};vertical-align:top">${escapeHtml(label)}</td>` +
  `<td style="padding:5px 0;font-size:${strong ? 18 : 15}px;line-height:${strong ? 24 : 20}px;color:${C.ink};font-weight:bold;vertical-align:top">${escapeHtml(value)}</td></tr>`;

function itemCardHtml(item: AdminOrderItem) {
  const facts = [...itemFacts(item), { label: "Unit price", value: formatRs(item.unit_price_minor) }, { label: "Line total", value: formatRs(item.line_total_minor) }];
  const rows = facts.map((fact) =>
    `<tr><td style="padding:6px 12px 6px 0;width:38%;font-size:14px;line-height:20px;color:${C.muted};vertical-align:top">${escapeHtml(fact.label)}</td>` +
    `<td style="padding:6px 0;font-size:14px;line-height:20px;color:${C.ink};font-weight:bold;vertical-align:top">${escapeHtml(fact.value)}</td></tr>`).join("");
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border:1px solid ${C.line};border-radius:8px;margin:0 0 12px 0;border-collapse:separate">` +
    `<tr><td style="padding:16px 18px"><div style="font-family:${FONT};font-size:17px;line-height:24px;font-weight:bold;color:${C.ink};margin:0 0 8px 0">${escapeHtml(item.title)}</div>` +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="font-family:${FONT};border-top:1px solid ${C.line}">${rows}</table></td></tr></table>`;
}

export function renderAdminOrderNotification(
  input: { id?: string; recipient: string; lease_id: string; payload: unknown }, siteUrl?: string,
): OutgoingEmail {
  const p = parseAdminOrderPayload(input.payload);
  const link = adminOrdersUrl(siteUrl);
  const orderNumber = oneLine(p.order_number);
  const placedAt = formatPlacedAt(p.placed_at);
  const units = p.items.reduce((sum, item) => sum + item.quantity, 0);
  const unitsLabel = `${units} ${units === 1 ? "item" : "items"}`;
  const total = formatRs(p.total_minor);
  const payment = paymentLabel(p.payment_method);
  const subject = oneLine(`New Order Alert: ${orderNumber} · ${total} · ${payment}`);

  const amounts: Array<[string, string]> = [["Subtotal", formatRs(p.subtotal_minor)], ["Delivery", formatRs(p.delivery_fee_minor)]];
  if (p.discount_minor > 0) amounts.push([`Discount${p.coupon_code ? ` (${oneLine(p.coupon_code)})` : ""}`, `- ${formatRs(p.discount_minor)}`]);
  if (p.shipping_discount_minor > 0) amounts.push(["Shipping discount", `- ${formatRs(p.shipping_discount_minor)}`]);

  const text = [
    "NEW ORDER ALERT",
    "iSolutions Pakistan",
    "",
    `Order number: ${orderNumber}`,
    `Placed:       ${placedAt}`,
    `Payment:      ${payment}`,
    `Shipping:     ${shippingLabel(p.shipping_method)}`,
    `Items:        ${unitsLabel}`,
    "",
    "PRODUCTS",
    ...p.items.flatMap((item, index) => [
      "",
      `${index + 1}. ${oneLine(item.title)}`,
      ...itemFacts(item).map((fact) => `   ${fact.label}: ${fact.value}`),
      `   Unit price: ${formatRs(item.unit_price_minor)}`,
      `   Line total: ${formatRs(item.line_total_minor)}`,
    ]),
    "",
    "AMOUNTS",
    ...amounts.map(([label, value]) => `${label}: ${value}`),
    `Order total: ${total}`,
    "",
    "Review the order and customer details in Admin Orders:",
    link,
    "",
    "--",
    FOOTER,
  ].join("\n");

  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8">` +
    `<meta name="viewport" content="width=device-width,initial-scale=1"><title>New Order Alert</title></head>` +
    `<body style="margin:0;padding:0;background:#FFFFFF;-webkit-text-size-adjust:100%">` +
    `<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:#FFFFFF">${escapeHtml(`Order ${orderNumber} · ${total} · ${payment}`)}</div>` +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#FFFFFF"><tr><td align="center" style="padding:24px 12px">` +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;font-family:${FONT};color:${C.ink}">` +
    `<tr><td style="border-top:4px solid ${C.accent};padding:20px 4px 18px 4px;border-bottom:1px solid ${C.line}">` +
    `<span style="font-size:20px;line-height:26px;font-weight:bold;color:${C.ink}">iSolutions<span style="color:${C.accent}"> Pakistan</span></span>` +
    `<div style="font-size:12px;line-height:18px;color:${C.muted};text-transform:uppercase;letter-spacing:1px;margin-top:2px">Admin · New Order Alert</div></td></tr>` +
    `<tr><td style="padding:28px 4px 8px 4px"><h1 style="margin:0 0 8px 0;font-size:24px;line-height:30px;font-weight:bold;color:${C.ink}">New Order Alert</h1>` +
    `<p style="margin:0;font-size:15px;line-height:22px;color:${C.muted}">A customer has placed a new order on the website. It is waiting for review in Admin Orders.</p></td></tr>` +
    `<tr><td style="padding:16px 4px 8px 4px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${C.soft};border-radius:8px;border-collapse:separate"><tr><td style="padding:14px 18px">` +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="font-family:${FONT}">` +
    row("Order number", orderNumber, true) + row("Placed", placedAt) + row("Payment method", payment) +
    row("Shipping", shippingLabel(p.shipping_method)) + row("Items", unitsLabel) + row("Order total", total, true) +
    `</table></td></tr></table></td></tr>` +
    `<tr><td style="padding:20px 4px 4px 4px"><div style="font-size:12px;line-height:18px;font-weight:bold;color:${C.muted};text-transform:uppercase;letter-spacing:1px;margin:0 0 10px 0">Products</div>` +
    p.items.map(itemCardHtml).join("") + `</td></tr>` +
    `<tr><td style="padding:4px 4px 8px 4px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="font-family:${FONT};border-top:1px solid ${C.line}">` +
    amounts.map(([label, value]) => row(label, value)).join("") + row("Order total", total, true) + `</table></td></tr>` +
    `<tr><td style="padding:12px 4px 8px 4px"><table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td align="center" bgcolor="${C.button}" style="background:${C.button};border-radius:6px">` +
    `<a href="${escapeHtml(link)}" target="_blank" style="display:inline-block;padding:14px 28px;font-family:${FONT};font-size:15px;line-height:20px;font-weight:bold;color:#FFFFFF;text-decoration:none;border-radius:6px">Open Admin Orders</a></td></tr></table>` +
    `<p style="margin:12px 0 0 0;font-size:13px;line-height:19px;color:${C.muted}">Customer and delivery details are shown only in Admin Orders (sign-in required).</p></td></tr>` +
    `<tr><td style="padding:24px 4px 0 4px"><div style="border-top:1px solid ${C.line};padding-top:16px;font-size:12px;line-height:18px;color:${C.muted}">${escapeHtml(FOOTER)}</div></td></tr>` +
    `</table></td></tr></table></body></html>`;

  return { to: input.recipient, subject, text, html, idempotencyKey: input.lease_id, ...(input.id ? { notificationId: input.id } : {}) };
}

export type ClaimedAdminRow = { id: string; lease_id: string; recipient: string; payload: unknown; attempts: number };
export type CompleteCall = (id: string, leaseId: string, result: SendResult) => Promise<void>;

/** Sends each claimed row and reports every outcome; one failing row never stops the others, and nothing throws. */
export async function deliverAdminClaimed(rows: ClaimedAdminRow[], transport: EmailTransport, complete: CompleteCall, siteUrl?: string) {
  const summary = { sent: 0, failed: 0 };
  for (const claimed of rows) {
    let result: SendResult;
    try {
      result = await transport.send(renderAdminOrderNotification(claimed, siteUrl));
      if (!result || typeof result.ok !== "boolean") result = { ok: false, error: "transport_invalid_result" };
    } catch (error) {
      result = { ok: false, error: errorText(error) };
    }
    if (!result.ok) result = { ok: false, error: errorText(result.error) };
    try { await complete(claimed.id, claimed.lease_id, result); } catch { /* lease expires and the row is retried */ }
    if (result.ok) summary.sent += 1; else summary.failed += 1;
  }
  return summary;
}
