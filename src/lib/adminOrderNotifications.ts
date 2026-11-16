// Admin "New Order Alert" email trigger (outbox migration 202611170001 + Edge Function admin-order-notifications).
// The order is already committed and queued for email by the database; this only asks the server to deliver now.
// Fire-and-forget: never awaited, never throws, never affects checkout. `keepalive` lets the request finish while the
// page navigates to /order-success. A CORS "simple" request (POST, text/plain, no custom headers) needs no preflight.
// It carries no order data and no credentials: the function takes no input and only drains already-queued rows.

export const ADMIN_ORDER_NOTIFICATION_FUNCTION = "admin-order-notifications";

export function adminOrderNotificationUrl(supabaseUrl: string | undefined) {
  if (!supabaseUrl || !/^https?:\/\//.test(supabaseUrl)) return null;
  return `${supabaseUrl.replace(/\/+$/, "")}/functions/v1/${ADMIN_ORDER_NOTIFICATION_FUNCTION}`;
}

export function requestAdminOrderNotification(
  supabaseUrl: string | undefined = import.meta.env?.VITE_SUPABASE_URL,
  doFetch: typeof fetch | undefined = typeof fetch === "function" ? fetch : undefined,
) {
  const url = adminOrderNotificationUrl(supabaseUrl);
  if (!url || !doFetch) return;
  try {
    void doFetch(url, { method: "POST", body: "{}", headers: { "Content-Type": "text/plain" }, keepalive: true, credentials: "omit" })
      .catch(() => { /* delivered later by the next checkout or Admin Orders */ });
  } catch { /* never affects checkout */ }
}
