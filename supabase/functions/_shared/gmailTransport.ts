// Gmail API transport for vendor order notifications (users.messages.send over HTTPS, OAuth 2.0 refresh token).
// Pure TypeScript (fetch / TextEncoder / btoa only, no Deno or Node APIs) so the Edge Function and the Node tests
// share exactly the same code. Every Google call goes through the injected `fetch`, so the tests never reach Google.
//
// Security rules
//   * Credentials come only from Edge Function secrets (gmailConfigFromEnv). They are never logged, never returned
//     and never stored: every error is built from a fixed code + HTTP status + Google's short reason code, never from
//     a raw response body, and the result is additionally scrubbed of the secret values.
//   * Scope: https://www.googleapis.com/auth/gmail.send only (send, no read access to the mailbox).
//
// Delivery semantics (Gmail has NO idempotency key)
//   * A definite rejection (HTTP 4xx from Gmail) means the message was not accepted → ordinary failure, safe retry.
//   * A network error, timeout or HTTP 5xx after the request was sent is AMBIGUOUS: Gmail may or may not have sent it.
//     It is reported as `gmail_outcome_unknown…`, so the row is retried by the existing backoff (at-least-once: a
//     duplicate staff email is possible, a silently lost one is not). It is never reported as sent.
//   * A stable Message-ID per notification row lets staff recognise a duplicate; it is NOT an exactly-once guarantee.
//   * `prepare()` obtains an access token BEFORE the Edge Function claims any row, so missing / revoked credentials
//     leave queued rows untouched (no attempt used), like the provider-not-configured case.
import type { EmailTransport, OutgoingEmail, SendResult } from "./vendorNotificationEmail.ts";

export const GMAIL_SEND_SCOPE = "https://www.googleapis.com/auth/gmail.send";
export const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
export const GMAIL_SEND_URL = "https://gmail.googleapis.com/gmail/v1/users/me/messages/send";
export const DEFAULT_GMAIL_SENDER = "ordersisolution@gmail.com";
export const SENDER_DISPLAY_NAME = "iSolutions Pakistan Orders";
export const REQUEST_TIMEOUT_MS = 10_000;
/** Refresh this long before Google's stated expiry so a token never expires mid-send. */
export const TOKEN_EXPIRY_MARGIN_MS = 60_000;

export type GmailConfig = { clientId: string; clientSecret: string; refreshToken: string; sender: string };
export type FetchLike = (input: string, init: { method: string; headers: Record<string, string>; body: string; signal?: AbortSignal }) =>
  Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;
export type GmailTransportOptions = { fetch?: FetchLike; now?: () => number; timeoutMs?: number };
export type GmailTransport = EmailTransport & { prepare(): Promise<SendResult> };

// Plain address only: no display name, no CR/LF, no comma / semicolon (a single recipient, never a header injection).
const ADDRESS = /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+$/;
export const isPlainAddress = (value: unknown): value is string =>
  typeof value === "string" && value.length <= 254 && ADDRESS.test(value);

/** Reads the four Gmail secrets. Any missing / malformed value → null (transport unavailable, nothing is claimed). */
export function gmailConfigFromEnv(get: (name: string) => string | undefined): GmailConfig | null {
  const clientId = get("GMAIL_OAUTH_CLIENT_ID")?.trim();
  const clientSecret = get("GMAIL_OAUTH_CLIENT_SECRET")?.trim();
  const refreshToken = get("GMAIL_OAUTH_REFRESH_TOKEN")?.trim();
  const sender = (get("GMAIL_SENDER_ADDRESS")?.trim() || DEFAULT_GMAIL_SENDER).toLowerCase();
  if (!clientId || !clientSecret || !refreshToken || !isPlainAddress(sender)) return null;
  return { clientId, clientSecret, refreshToken, sender };
}

// ---- MIME message (RFC 5322 / 2045 / 2047) ------------------------------------------------------------------------
function base64(bytes: Uint8Array) {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}
const utf8Base64 = (value: string) => base64(new TextEncoder().encode(value));
export const base64Url = (value: string) => utf8Base64(value).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const wrap76 = (value: string) => value.match(/.{1,76}/g)?.join("\r\n") ?? "";
/** RFC 2047 encoded-word: any CR/LF is removed first, so a header value can never start a new header. */
const encodeHeader = (value: string) => `=?UTF-8?B?${utf8Base64(value.replace(/[\r\n]+/g, " ").trim())}?=`;
const safeToken = (value: string) => value.replace(/[^A-Za-z0-9-]/g, "").slice(0, 64);

/** Builds the raw RFC 5322 message (multipart/alternative: plain text + HTML, both base64, UTF-8). */
export function buildMimeMessage(email: OutgoingEmail, sender: string) {
  if (!isPlainAddress(sender)) throw new Error("gmail_sender_invalid");
  if (!isPlainAddress(email.to)) throw new Error("gmail_recipient_invalid");
  const key = safeToken(email.notificationId ?? email.idempotencyKey) || "notification";
  const boundary = `isp-${safeToken(email.idempotencyKey) || "part"}`;
  return [
    `From: ${encodeHeader(SENDER_DISPLAY_NAME)} <${sender}>`,
    `To: <${email.to}>`,
    `Subject: ${encodeHeader(email.subject)}`,
    `Message-ID: <vendor-notification.${key}@isolutionspakistan.com>`,
    `X-iSolutions-Notification: ${key}`,
    "Auto-Submitted: auto-generated",
    "MIME-Version: 1.0",
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    "",
    `--${boundary}`,
    'Content-Type: text/plain; charset="UTF-8"',
    "Content-Transfer-Encoding: base64",
    "",
    wrap76(utf8Base64(email.text)),
    `--${boundary}`,
    'Content-Type: text/html; charset="UTF-8"',
    "Content-Transfer-Encoding: base64",
    "",
    wrap76(utf8Base64(email.html)),
    `--${boundary}--`,
    "",
  ].join("\r\n");
}

// ---- Errors (never a raw body, never a secret) ---------------------------------------------------------------------
const reasonCode = (value: unknown) => (typeof value === "string" ? value.replace(/[^A-Za-z0-9_.-]/g, "").slice(0, 60) : "");
async function googleReason(response: { json(): Promise<unknown> }) {
  try {
    const body = await response.json() as Record<string, unknown> | null;
    if (!body || typeof body !== "object") return "";
    if (typeof body.error === "string") return reasonCode(body.error);                       // OAuth token endpoint
    const error = body.error as { status?: unknown; errors?: Array<{ reason?: unknown }> } | undefined;
    return reasonCode(error?.errors?.[0]?.reason) || reasonCode(error?.status);                // Gmail API
  } catch { return ""; }
}
const fail = (code: string, status?: number, reason?: string): SendResult =>
  ({ ok: false, error: [code, status ? `http_${status}` : "", reason ?? ""].filter(Boolean).join(":") });

const RATE_LIMIT_REASONS = new Set(["rateLimitExceeded", "userRateLimitExceeded", "dailyLimitExceeded", "quotaExceeded", "RESOURCE_EXHAUSTED"]);

export function createGmailTransport(config: GmailConfig, options: GmailTransportOptions = {}): GmailTransport {
  const doFetch: FetchLike = options.fetch ?? ((input, init) => fetch(input, init));
  const now = options.now ?? Date.now;
  const timeoutMs = options.timeoutMs ?? REQUEST_TIMEOUT_MS;
  const secrets = [config.clientSecret, config.refreshToken, config.clientId].filter((value) => value.length >= 8);
  let token: { value: string; expiresAt: number } | null = null;
  // Once Google says "credentials revoked" or "slow down", the rest of this batch fails fast without calling Google.
  let halted: SendResult | null = null;

  const scrub = (result: SendResult): SendResult => {
    if (result.ok) return result;
    let error = result.error;
    for (const secret of secrets) error = error.split(secret).join("[redacted]");
    if (token) error = error.split(token.value).join("[redacted]");
    return { ok: false, error };
  };
  const call = (url: string, headers: Record<string, string>, body: string) =>
    doFetch(url, { method: "POST", headers, body, signal: AbortSignal.timeout(timeoutMs) });

  async function accessToken(force = false): Promise<SendResult & { token?: string }> {
    if (!force && token && token.expiresAt - TOKEN_EXPIRY_MARGIN_MS > now()) return { ok: true, token: token.value };
    token = null;
    let response;
    try {
      response = await call(GOOGLE_TOKEN_URL, { "Content-Type": "application/x-www-form-urlencoded" }, new URLSearchParams({
        grant_type: "refresh_token", client_id: config.clientId, client_secret: config.clientSecret, refresh_token: config.refreshToken,
      }).toString());
    } catch { return fail("gmail_token_unreachable"); }
    if (!response.ok) {
      const reason = await googleReason(response);
      // invalid_grant = refresh token expired / revoked (password change, access removed, 6 months unused);
      // invalid_client / unauthorized_client = client secret rotated or wrong client.
      if (["invalid_grant", "invalid_client", "unauthorized_client"].includes(reason) || response.status === 401) {
        halted = fail("gmail_auth_revoked", response.status, reason);
        return halted;
      }
      return fail("gmail_token_failed", response.status, reason);
    }
    let body: Record<string, unknown> | null = null;
    try { body = await response.json() as Record<string, unknown>; } catch { /* handled below */ }
    const value = body && typeof body.access_token === "string" ? body.access_token : "";
    if (!value) return fail("gmail_token_invalid_response");
    if (typeof body?.scope === "string" && !body.scope.split(" ").includes(GMAIL_SEND_SCOPE)) {
      halted = fail("gmail_scope_missing");
      return halted;
    }
    const seconds = Number(body?.expires_in);
    token = { value, expiresAt: now() + (Number.isFinite(seconds) && seconds > 0 ? seconds : 3600) * 1000 };
    return { ok: true, token: value };
  }

  async function sendOnce(raw: string, bearer: string): Promise<SendResult & { unauthorized?: boolean }> {
    let response;
    try {
      response = await call(GMAIL_SEND_URL, { Authorization: `Bearer ${bearer}`, "Content-Type": "application/json" }, JSON.stringify({ raw }));
    } catch {
      // The request may have reached Gmail before the connection dropped / timed out.
      return fail("gmail_outcome_unknown", undefined, "network_or_timeout");
    }
    if (response.ok) {
      let id: unknown;
      try { id = (await response.json() as Record<string, unknown> | null)?.id; } catch { /* accepted without a readable id */ }
      return typeof id === "string" && id ? { ok: true, providerMessageId: id.slice(0, 200) } : { ok: true };
    }
    const reason = await googleReason(response);
    if (response.status === 401) return { ...fail("gmail_unauthorized", 401, reason), unauthorized: true };
    if (response.status === 429 || RATE_LIMIT_REASONS.has(reason)) {
      halted = fail("gmail_rate_limited", response.status, reason);
      return halted;
    }
    if (response.status >= 500) return fail("gmail_outcome_unknown", response.status, reason);
    return fail("gmail_rejected", response.status, reason);
  }

  return {
    name: "gmail",
    async prepare() {
      const result = await accessToken();
      return scrub(result.ok ? { ok: true } : result);
    },
    async send(email) {
      if (halted) return scrub(halted);
      let raw: string;
      try { raw = base64Url(buildMimeMessage(email, config.sender)); }
      catch (error) { return fail(error instanceof Error ? error.message : "gmail_message_invalid"); }
      const auth = await accessToken();
      if (!auth.ok || !auth.token) return scrub(auth.ok ? fail("gmail_token_invalid_response") : auth);
      let result = await sendOnce(raw, auth.token);
      // 401 = the access token was refused before anything was sent → refresh once and retry (no duplicate risk).
      if (!result.ok && result.unauthorized) {
        const again = await accessToken(true);
        if (!again.ok || !again.token) return scrub(again.ok ? fail("gmail_token_invalid_response") : again);
        result = await sendOnce(raw, again.token);
        if (!result.ok && result.unauthorized) halted = fail("gmail_auth_revoked", 401);
      }
      const { unauthorized: _ignored, ...clean } = result as SendResult & { unauthorized?: boolean };
      void _ignored;
      return scrub(clean as SendResult);
    },
  };
}
