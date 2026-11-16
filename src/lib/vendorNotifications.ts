// Admin Orders: vendor email notification status (outbox rows from migration 202611160001).
// Display-only helpers; sending happens in the vendor-order-notifications Edge Function.

export type VendorNotificationStatus = "pending" | "sending" | "sent" | "failed";
export type VendorNotification = {
  id: string; fulfilment_id: string; status: VendorNotificationStatus; attempts: number;
  next_attempt_at: string; last_error: string | null; sent_at: string | null;
};

export const VENDOR_NOTIFICATION_FUNCTION = "vendor-order-notifications";
export const VENDOR_NOTIFICATION_COLUMNS = "id,fulfilment_id,status,attempts,next_attempt_at,last_error,sent_at";

export function notificationLabel(note: VendorNotification | undefined) {
  if (!note) return null;
  if (note.status === "sent") return { tone: "ok", text: "Email sent" } as const;
  if (note.status === "failed") return { tone: "error", text: `Email failed after ${note.attempts} attempts` } as const;
  if (note.attempts > 0) return { tone: "wait", text: `Email retrying (attempt ${note.attempts} failed)` } as const;
  return { tone: "wait", text: "Email queued" } as const;
}

/** Worth asking the Edge Function to deliver now: something is queued, or a lease / retry time has passed. */
export const hasDeliverableNotification = (notes: VendorNotification[], now = Date.now()) =>
  notes.some((note) => (note.status === "pending" || note.status === "sending") && Date.parse(note.next_attempt_at) <= now);
