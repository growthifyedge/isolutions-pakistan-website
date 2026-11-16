// Vendor order notification email: payload validation, rendering and the transport contract.
// Pure TypeScript (no Deno / Node APIs) so the Edge Function and the Node tests share exactly the same code.
//
// The payload is the outbox snapshot written by migration 202611160001: the order number, the vendor's name and
// ONLY that vendor's items (title, SKU, variant, quantity). Rendering uses nothing else, so an email can never
// contain another vendor's items, any price or total, or customer details.

export type NotificationItem = { title: string; sku: string; variant: Record<string, unknown> | null; quantity: number };
export type NotificationPayload = { order_number: string; vendor_name: string; released_at: string; items: NotificationItem[] };
/** idempotencyKey = the attempt's lease id (changes per attempt); notificationId = the stable outbox row id. Gmail has
 * no provider idempotency key, so neither one makes delivery exactly-once (see gmailTransport.ts). */
export type OutgoingEmail = { to: string; subject: string; text: string; html: string; idempotencyKey: string; notificationId?: string };
export type SendResult = { ok: true; providerMessageId?: string } | { ok: false; error: string };
/** A delivery provider (SMTP or HTTP API). Must throw or return ok:false on any failure; never partially succeed. */
export type EmailTransport = { name: string; send(email: OutgoingEmail): Promise<SendResult> };

export const DEFAULT_SITE_URL = "https://isolutionspakistan.com";
export const MAX_ERROR_LENGTH = 500;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** Rejects anything that is not exactly the outbox snapshot shape (a malformed row is reported, never sent). */
export function parseNotificationPayload(value: unknown): NotificationPayload {
  if (!isRecord(value)) throw new Error("payload_invalid");
  const { order_number, vendor_name, released_at, items } = value;
  if (typeof order_number !== "string" || !order_number.trim()) throw new Error("payload_order_number_missing");
  if (typeof vendor_name !== "string" || !vendor_name.trim()) throw new Error("payload_vendor_missing");
  if (!Array.isArray(items) || items.length === 0) throw new Error("payload_items_missing");
  return {
    order_number, vendor_name, released_at: typeof released_at === "string" ? released_at : "",
    items: items.map((item) => {
      if (!isRecord(item) || typeof item.title !== "string" || !Number.isInteger(item.quantity) || Number(item.quantity) < 1)
        throw new Error("payload_item_invalid");
      return {
        title: item.title, sku: typeof item.sku === "string" ? item.sku : "",
        variant: isRecord(item.variant) ? item.variant : null, quantity: Number(item.quantity),
      };
    }),
  };
}

export function staffDashboardUrl(siteUrl: string | undefined) {
  const base = (siteUrl && /^https?:\/\//.test(siteUrl) ? siteUrl : DEFAULT_SITE_URL).replace(/\/+$/, "");
  return `${base}/staff`;
}

const escapeHtml = (value: string) => value.replace(/[&<>"']/g, (char) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!);
// Header-safe: no CR/LF can reach the Subject line.
const oneLine = (value: string) => value.replace(/[\r\n]+/g, " ").trim();

// ---- Product facts ------------------------------------------------------------------------------------------------
// The variant snapshot is written by create_storefront_order: { ram, storage, color, ptaStatus, condition, warranty }
// (nulls stripped). Only these known keys are shown, in this order. Enum values are shown only through an exact
// label map (the storefront's own wording); an enum value without a label (unknown, not_applicable) is left out.
// Free-text values are shown as stored, unless they are a placeholder or look like a raw code (snake_case).
// Nothing is inferred from the title or any other field.
const CONDITION_LABELS: Record<string, string> = { brand_new: "New", used: "Used", open_box: "Open Box", refurbished: "Refurbished" };
const PTA_LABELS: Record<string, string> = { approved: "Approved", not_approved: "Not Approved" };
const VARIANT_FACTS: ReadonlyArray<{ key: string; label: string; labels?: Record<string, string> }> = [
  { key: "ram", label: "RAM" },
  { key: "storage", label: "Storage" },
  { key: "color", label: "Colour" },
  { key: "condition", label: "Condition", labels: CONDITION_LABELS },
  { key: "ptaStatus", label: "PTA Status", labels: PTA_LABELS },
  { key: "warranty", label: "Warranty" },
];
const PLACEHOLDERS = new Set(["", "unknown", "null", "undefined", "nan", "none", "n/a", "na", "-", "--", "—", "tbd",
  "not applicable", "not_applicable", "not available"]);
const RAW_CODE = /^[a-z0-9]+(?:_[a-z0-9]+)+$/;

/** A displayable value, or null when the value is missing, a placeholder or an unmapped code. */
function factValue(raw: unknown, labels?: Record<string, string>): string | null {
  if (typeof raw !== "string" && !(typeof raw === "number" && Number.isFinite(raw))) return null;
  const value = oneLine(String(raw));
  if (PLACEHOLDERS.has(value.toLowerCase())) return null;
  if (labels) return Object.prototype.hasOwnProperty.call(labels, value) ? labels[value] : null;
  return RAW_CODE.test(value) ? null : value;
}

export type ItemFact = { label: string; value: string };

/** SKU, Quantity, then the meaningful variant facts (RAM, Storage, Colour, Condition, PTA Status, Warranty). */
export function itemFacts(item: NotificationItem): ItemFact[] {
  const facts: ItemFact[] = [];
  const sku = factValue(item.sku);
  if (sku) facts.push({ label: "SKU", value: sku });
  facts.push({ label: "Quantity", value: String(item.quantity) });
  for (const fact of VARIANT_FACTS) {
    const value = factValue(item.variant?.[fact.key], fact.labels);
    if (value) facts.push({ label: fact.label, value });
  }
  return facts;
}

// ---- Rendering ----------------------------------------------------------------------------------------------------
// Email-client safe: table layout, inline styles only, no external images, fonts or scripts; a single 600px column
// that shrinks to the screen on mobile. Colours follow the storefront theme (ink #111614, accent #F0643A).
const C = { ink: "#111614", muted: "#66706B", line: "#D9DEDA", soft: "#F4F6F4", accent: "#F0643A", button: "#101A17" };
const FONT = "Arial,Helvetica,sans-serif";
const BRAND = "iSolutions Pakistan";
const FOOTER = "Automated notification from iSolutions Pakistan. Please do not reply.";

function itemCardHtml(item: NotificationItem) {
  const rows = itemFacts(item).map((fact) =>
    `<tr><td style="padding:6px 12px 6px 0;width:38%;font-size:14px;line-height:20px;color:${C.muted};vertical-align:top">${escapeHtml(fact.label)}</td>` +
    `<td style="padding:6px 0;font-size:14px;line-height:20px;color:${C.ink};font-weight:bold;vertical-align:top">${escapeHtml(fact.value)}</td></tr>`).join("");
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border:1px solid ${C.line};border-radius:8px;margin:0 0 12px 0;border-collapse:separate">` +
    `<tr><td style="padding:16px 18px">` +
    `<div style="font-family:${FONT};font-size:17px;line-height:24px;font-weight:bold;color:${C.ink};margin:0 0 8px 0">${escapeHtml(item.title)}</div>` +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="font-family:${FONT};border-top:1px solid ${C.line}">${rows}</table>` +
    `</td></tr></table>`;
}

function summaryRowHtml(label: string, value: string, large = false) {
  return `<tr><td style="padding:5px 12px 5px 0;width:38%;font-size:13px;line-height:20px;color:${C.muted};vertical-align:top">${escapeHtml(label)}</td>` +
    `<td style="padding:5px 0;font-size:${large ? 18 : 15}px;line-height:${large ? 24 : 20}px;color:${C.ink};font-weight:bold;vertical-align:top">${escapeHtml(value)}</td></tr>`;
}

export function renderVendorNotification(
  row: { id?: string; recipient: string; lease_id: string; payload: unknown }, siteUrl?: string,
): OutgoingEmail {
  const payload = parseNotificationPayload(row.payload);
  const link = staffDashboardUrl(siteUrl);
  const units = payload.items.reduce((sum, item) => sum + item.quantity, 0);
  const unitsLabel = `${units} ${units === 1 ? "item" : "items"}`;
  const subject = oneLine(`New order ${payload.order_number} for ${payload.vendor_name} (${unitsLabel})`);
  const orderNumber = oneLine(payload.order_number);
  const vendorName = oneLine(payload.vendor_name);

  const text = [
    "NEW ORDER ASSIGNED",
    BRAND,
    "",
    `Order number: ${orderNumber}`,
    `Assigned to:  ${vendorName}`,
    `Items:        ${unitsLabel}`,
    "",
    "PRODUCT DETAILS",
    ...payload.items.flatMap((item, index) => [
      "",
      `${index + 1}. ${oneLine(item.title)}`,
      ...itemFacts(item).map((fact) => `   ${fact.label}: ${fact.value}`),
    ]),
    "",
    "Open the Staff Dashboard for the delivery details and to update the status:",
    link,
    "",
    "--",
    FOOTER,
  ].join("\n");

  const preheader = `Order ${orderNumber} · ${unitsLabel} assigned to ${vendorName}`;
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8">` +
    `<meta name="viewport" content="width=device-width,initial-scale=1"><meta name="x-apple-disable-message-reformatting">` +
    `<title>New Order Assigned</title></head>` +
    `<body style="margin:0;padding:0;background:#FFFFFF;-webkit-text-size-adjust:100%">` +
    `<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:#FFFFFF">${escapeHtml(preheader)}</div>` +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#FFFFFF"><tr><td align="center" style="padding:24px 12px">` +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;font-family:${FONT};color:${C.ink}">` +
    // Brand header
    `<tr><td style="border-top:4px solid ${C.accent};padding:20px 4px 18px 4px;border-bottom:1px solid ${C.line}">` +
    `<span style="font-size:20px;line-height:26px;font-weight:bold;color:${C.ink};letter-spacing:-0.2px">iSolutions<span style="color:${C.accent}"> Pakistan</span></span>` +
    `<div style="font-size:12px;line-height:18px;color:${C.muted};text-transform:uppercase;letter-spacing:1px;margin-top:2px">Staff Order Notification</div>` +
    `</td></tr>` +
    // Heading + summary
    `<tr><td style="padding:28px 4px 8px 4px">` +
    `<h1 style="margin:0 0 8px 0;font-size:24px;line-height:30px;font-weight:bold;color:${C.ink}">New Order Assigned</h1>` +
    `<p style="margin:0;font-size:15px;line-height:22px;color:${C.muted}">This order has been released to <strong style="color:${C.ink}">${escapeHtml(vendorName)}</strong>. Please prepare the ${units === 1 ? "item" : "items"} below.</p>` +
    `</td></tr>` +
    `<tr><td style="padding:16px 4px 8px 4px">` +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${C.soft};border-radius:8px;border-collapse:separate"><tr><td style="padding:14px 18px">` +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="font-family:${FONT}">` +
    summaryRowHtml("Order number", orderNumber, true) + summaryRowHtml("Assigned to", vendorName) + summaryRowHtml("Items", unitsLabel) +
    `</table></td></tr></table></td></tr>` +
    // Product details
    `<tr><td style="padding:20px 4px 4px 4px">` +
    `<div style="font-size:12px;line-height:18px;font-weight:bold;color:${C.muted};text-transform:uppercase;letter-spacing:1px;margin:0 0 10px 0">Product details</div>` +
    payload.items.map(itemCardHtml).join("") +
    `</td></tr>` +
    // Call to action
    `<tr><td style="padding:12px 4px 8px 4px">` +
    `<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td align="center" bgcolor="${C.button}" style="background:${C.button};border-radius:6px">` +
    `<a href="${escapeHtml(link)}" target="_blank" style="display:inline-block;padding:14px 28px;font-family:${FONT};font-size:15px;line-height:20px;font-weight:bold;color:#FFFFFF;text-decoration:none;border-radius:6px">Open Staff Dashboard</a>` +
    `</td></tr></table>` +
    `<p style="margin:12px 0 0 0;font-size:13px;line-height:19px;color:${C.muted}">Delivery details and status updates are on the Staff Dashboard.</p>` +
    `<p style="margin:6px 0 0 0;font-size:12px;line-height:18px;color:${C.muted};word-break:break-all">If the button does not work, open: <a href="${escapeHtml(link)}" style="color:${C.ink}">${escapeHtml(link)}</a></p>` +
    `</td></tr>` +
    // Footer
    `<tr><td style="padding:24px 4px 0 4px"><div style="border-top:1px solid ${C.line};padding-top:16px;font-size:12px;line-height:18px;color:${C.muted}">${escapeHtml(FOOTER)}</div></td></tr>` +
    `</table></td></tr></table></body></html>`;

  return { to: row.recipient, subject, text, html, idempotencyKey: row.lease_id, ...(row.id ? { notificationId: row.id } : {}) };
}

export const errorText = (error: unknown) =>
  (error instanceof Error ? error.message : typeof error === "string" ? error : "send_failed").slice(0, MAX_ERROR_LENGTH) || "send_failed";

export type ClaimedRow = { id: string; lease_id: string; recipient: string; payload: unknown; attempts: number };
export type CompleteCall = (id: string, leaseId: string, result: SendResult) => Promise<void>;

/**
 * Sends each claimed row and reports every outcome. One failing row (bad payload, provider error, exception) never
 * stops the others, and nothing here throws: the caller has already finished the release.
 */
export async function deliverClaimed(rows: ClaimedRow[], transport: EmailTransport, complete: CompleteCall, siteUrl?: string) {
  const summary = { sent: 0, failed: 0 };
  for (const row of rows) {
    let result: SendResult;
    try {
      result = await transport.send(renderVendorNotification(row, siteUrl));
      if (!result || typeof result.ok !== "boolean") result = { ok: false, error: "transport_invalid_result" };
    } catch (error) {
      result = { ok: false, error: errorText(error) };
    }
    if (!result.ok) result = { ok: false, error: errorText(result.error) };
    try { await complete(row.id, row.lease_id, result); } catch { /* lease expires and the row is retried */ }
    if (result.ok) summary.sent += 1; else summary.failed += 1;
  }
  return summary;
}
