// Delivers queued Admin "New Order Alert" emails (outbox: migration 202611170001). NOT YET DEPLOYED.
//
// Called best-effort (fire-and-forget) by the storefront right after a successful checkout, and by Admin Orders when
// it opens (backup drain). It takes NO input: it only drains rows that the checkout transaction itself queued, so a
// caller can never choose a recipient, content or order, and repeated calls cannot send an email twice (each row is
// leased once and marked sent only on Gmail's confirmation). Deploy with --no-verify-jwt (anonymous checkout calls it).
//
// Database access uses the service role INSIDE this function only (SUPABASE_SERVICE_ROLE_KEY is injected by the
// Supabase Edge runtime; it is never sent to or stored in the browser, Git or logs). The claim / complete RPCs accept
// only the service role or an Admin session.
//
// Kill switch / enablement: ADMIN_ORDER_EMAIL_PROVIDER=gmail (separate from VENDOR_EMAIL_PROVIDER, so vendor emails are
// unaffected). Unset → { configured: false } WITHOUT claiming: queued rows wait untouched. Gmail credentials are the
// existing GMAIL_* secrets shared with vendor-order-notifications.
import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { type ClaimedAdminRow, deliverAdminClaimed } from "../_shared/adminOrderNotificationEmail.ts";
import type { SendResult } from "../_shared/vendorNotificationEmail.ts";
import { createGmailTransport, gmailConfigFromEnv } from "../_shared/gmailTransport.ts";

const CLAIM_LIMIT = 10;

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return Response.json({ error: "method_not_allowed" }, { status: 405, headers: corsHeaders });
  try {
    if ((Deno.env.get("ADMIN_ORDER_EMAIL_PROVIDER") ?? "").trim().toLowerCase() !== "gmail")
      return Response.json({ configured: false }, { headers: corsHeaders });
    const config = gmailConfigFromEnv((name) => Deno.env.get(name));
    const url = Deno.env.get("SUPABASE_URL");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!config || !url || !serviceKey) return Response.json({ configured: false }, { headers: corsHeaders });

    const client = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

    // Nothing due → return before contacting Google (keeps anonymous calls cheap).
    const { data: due, error: dueError } = await client.rpc("admin_has_due_admin_order_notifications");
    if (dueError) throw new Error("claim_failed");
    if (!due) return Response.json({ configured: true, sent: 0, failed: 0 }, { headers: corsHeaders });

    // Credentials are checked BEFORE claiming: a revoked authorization leaves queued rows untouched.
    const transport = createGmailTransport(config);
    const ready = await transport.prepare();
    if (!ready.ok) return Response.json({ configured: true, ready: false, sent: 0, failed: 0 }, { headers: corsHeaders });

    const { data, error } = await client.rpc("admin_claim_admin_order_notifications", { p_limit: CLAIM_LIMIT });
    if (error) throw new Error("claim_failed");
    const complete = async (id: string, leaseId: string, result: SendResult) => {
      await client.rpc("admin_complete_admin_order_notification", {
        p_id: id, p_lease_id: leaseId, p_ok: result.ok,
        p_error: result.ok ? null : result.error,
        p_provider_message_id: result.ok ? result.providerMessageId ?? null : null,
      });
    };
    const summary = await deliverAdminClaimed((data ?? []) as ClaimedAdminRow[], transport, complete, Deno.env.get("PUBLIC_SITE_URL"));
    return Response.json({ configured: true, ready: true, ...summary }, { headers: corsHeaders });
  } catch (error) {
    const code = error instanceof Error && error.message === "claim_failed" ? "claim_failed" : "notification_failed";
    return Response.json({ error: code }, { status: 500, headers: corsHeaders });
  }
});
