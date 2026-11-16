// Delivers queued vendor order notifications (outbox: migration 202611160001). NOT YET DEPLOYED.
//
// Called best-effort by Admin Orders right after a successful Confirm & Release (and whenever Admin Orders opens),
// with the Admin's own session: the claim/complete RPCs re-check is_catalog_admin, so no service-role key is used.
// Each call drains every due row, so a later call also retries earlier failures.
//
// Provider: Gmail API (VENDOR_EMAIL_PROVIDER=gmail, Owner decision 2026-11-15). Until VENDOR_EMAIL_PROVIDER names an
// implemented transport AND its secrets are all present, this function returns { configured: false } WITHOUT claiming
// anything, so queued rows wait untouched (no attempt is used up). Gmail credentials (GMAIL_OAUTH_CLIENT_ID,
// GMAIL_OAUTH_CLIENT_SECRET, GMAIL_OAUTH_REFRESH_TOKEN, optional GMAIL_SENDER_ADDRESS) live only in Edge Function
// secrets, never in the frontend or Git, and are never logged or returned.
import { corsHeaders } from "../_shared/cors.ts";
import { requireCatalogAdmin } from "../_shared/admin.ts";
import { type ClaimedRow, type EmailTransport, type SendResult, deliverClaimed } from "../_shared/vendorNotificationEmail.ts";
import { createGmailTransport, gmailConfigFromEnv } from "../_shared/gmailTransport.ts";

type PreparedTransport = EmailTransport & { prepare?: () => Promise<SendResult> };

function resolveTransport(provider: string | undefined): PreparedTransport | null {
  switch ((provider ?? "").trim().toLowerCase()) {
    case "gmail": {
      const config = gmailConfigFromEnv((name) => Deno.env.get(name));
      return config ? createGmailTransport(config) : null;   // a missing secret = not configured
    }
    default: return null;
  }
}

// Gmail: ~2.5 messages/s per-user API quota and a daily account sending limit. 10 rows × (10 s timeout) stays well
// inside the 5-minute lease and the Edge Function wall-clock limit; the rest is drained by the next call.
const CLAIM_LIMIT = 10;

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const { client } = await requireCatalogAdmin(request);
    const transport = resolveTransport(Deno.env.get("VENDOR_EMAIL_PROVIDER"));
    if (!transport) return Response.json({ configured: false, sent: 0, failed: 0 }, { headers: corsHeaders });

    // Credentials are checked BEFORE claiming: a revoked / expired authorization leaves queued rows untouched.
    if (transport.prepare) {
      const ready = await transport.prepare();
      if (!ready.ok) return Response.json({ configured: true, ready: false, error: ready.error, sent: 0, failed: 0 }, { headers: corsHeaders });
    }

    const { data, error } = await client.rpc("admin_claim_vendor_notifications", { p_limit: CLAIM_LIMIT });
    if (error) throw new Error("claim_failed");
    const complete = async (id: string, leaseId: string, result: SendResult) => {
      await client.rpc("admin_complete_vendor_notification", {
        p_id: id, p_lease_id: leaseId, p_ok: result.ok,
        p_error: result.ok ? null : result.error,
        p_provider_message_id: result.ok ? result.providerMessageId ?? null : null,
      });
    };
    const summary = await deliverClaimed((data ?? []) as ClaimedRow[], transport, complete, Deno.env.get("PUBLIC_SITE_URL"));
    return Response.json({ configured: true, ready: true, ...summary }, { headers: corsHeaders });
  } catch (error) {
    // Fixed codes only: never echo an exception message that could carry provider details.
    const message = error instanceof Error ? error.message : "notification_failed";
    const code = ["unauthorized", "forbidden", "claim_failed"].includes(message) ? message : "notification_failed";
    const status = code === "unauthorized" ? 401 : code === "forbidden" ? 403 : 500;
    return Response.json({ error: code }, { status, headers: corsHeaders });
  }
});
