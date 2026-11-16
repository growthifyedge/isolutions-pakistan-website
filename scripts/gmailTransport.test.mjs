// Gmail API transport (supabase/functions/_shared/gmailTransport.ts) + the one-time authorization helper
// (scripts/gmail-oauth-authorize.mjs). Every Google request goes to a MOCK fetch: nothing reaches Google, no email
// is sent, no token is real. The queue-integration test uses the replayed migrations (never a live database).
import assert from "node:assert/strict";
import test from "node:test";
import path from "node:path";
import { readFile } from "node:fs/promises";
import { createCatalogTestDatabase, signInAsOwner } from "./support/catalogTestDatabase.mjs";
import { suggestVendor } from "../src/lib/vendorOrders.ts";
import { deliverClaimed, renderVendorNotification } from "../supabase/functions/_shared/vendorNotificationEmail.ts";
import {
  GMAIL_SEND_SCOPE, GMAIL_SEND_URL, GOOGLE_TOKEN_URL, buildMimeMessage, createGmailTransport, gmailConfigFromEnv,
} from "../supabase/functions/_shared/gmailTransport.ts";
import {
  buildAuthUrl, createPkce, exchangeCode, formatEnvFile, parseClientFile, resolveOutputPath, REPO_ROOT,
} from "./gmail-oauth-authorize.mjs";

const CONFIG = {
  clientId: "1234567890-testclient.apps.googleusercontent.com",
  clientSecret: "TEST-client-secret-should-never-leak",
  refreshToken: "1//TEST-refresh-token-should-never-leak",
  sender: "ordersisolution@gmail.com",
};
const SECRETS = [CONFIG.clientSecret, CONFIG.refreshToken, "ya29.TEST-access-token"];

const reply = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
const tokenOk = (n = 1) => reply(200, { access_token: `ya29.TEST-access-token-${n}`, expires_in: 3599, scope: GMAIL_SEND_SCOPE, token_type: "Bearer" });
/** Scripted mock fetch: each entry answers one call (a function may throw to simulate a network failure). */
function mockFetch(script) {
  const calls = [];
  const fetch = async (url, init) => {
    calls.push({ url, ...init });
    const next = script.shift();
    if (!next) throw new Error("unexpected extra request");
    return typeof next === "function" ? next(url, init) : next;
  };
  return { calls, fetch };
}
const decode = (raw) => Buffer.from(raw.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
const parts = (mime) => [...mime.matchAll(/Content-Transfer-Encoding: base64\r\n\r\n([A-Za-z0-9+/=\r\n]+?)\r\n--/g)]
  .map((m) => Buffer.from(m[1].replace(/\r\n/g, ""), "base64").toString("utf8"));
const leaks = (value) => SECRETS.some((secret) => JSON.stringify(value).includes(secret));

const ROW = { id: "6f0c2a1e-0000-4000-8000-000000000001", lease_id: "9a1b2c3d-0000-4000-8000-000000000002",
  recipient: "isolutionspiyave@gmail.com", attempts: 1, payload: {
    order_number: "ISP-ORD-00042", vendor_name: "Piyavey", released_at: "",
    items: [{ title: "Kettle — Ünïcode ✓", sku: "GD7", variant: { color: "Black" }, quantity: 2 }] } };
const EMAIL = renderVendorNotification(ROW, "https://isolutionspakistan.com");

test("configuration: all secrets required, sender validated, Gmail is opt-in", () => {
  const env = { GMAIL_OAUTH_CLIENT_ID: CONFIG.clientId, GMAIL_OAUTH_CLIENT_SECRET: CONFIG.clientSecret, GMAIL_OAUTH_REFRESH_TOKEN: CONFIG.refreshToken };
  assert.deepEqual(gmailConfigFromEnv((k) => env[k]), CONFIG, "sender defaults to ordersisolution@gmail.com");
  for (const missing of Object.keys(env)) assert.equal(gmailConfigFromEnv((k) => (k === missing ? "" : env[k])), null, `${missing} missing`);
  assert.equal(gmailConfigFromEnv((k) => ({ ...env, GMAIL_SENDER_ADDRESS: "x@y.z\r\nBcc: evil@example.test" })[k]), null);
});

test("request construction: token refresh, users.messages.send, RFC 5322 message", async () => {
  const { calls, fetch } = mockFetch([tokenOk(), reply(200, { id: "18c0ffee", threadId: "t", labelIds: ["SENT"] })]);
  const result = await createGmailTransport(CONFIG, { fetch }).send(EMAIL);
  assert.deepEqual(result, { ok: true, providerMessageId: "18c0ffee" });

  const [token, send] = calls;
  assert.equal(token.url, GOOGLE_TOKEN_URL);
  assert.equal(token.method, "POST");
  assert.deepEqual(Object.fromEntries(new URLSearchParams(token.body)), {
    grant_type: "refresh_token", client_id: CONFIG.clientId, client_secret: CONFIG.clientSecret, refresh_token: CONFIG.refreshToken });
  assert.ok(token.signal instanceof AbortSignal, "every Google call has a timeout");

  assert.equal(send.url, GMAIL_SEND_URL);
  assert.equal(send.headers.Authorization, "Bearer ya29.TEST-access-token-1");
  const { raw, ...rest } = JSON.parse(send.body);
  assert.deepEqual(rest, {}, "only the raw message is sent");
  assert.ok(/^[A-Za-z0-9_-]+$/.test(raw), "base64url without padding");
  const mime = decode(raw);
  const headers = mime.slice(0, mime.indexOf("\r\n\r\n"));
  assert.match(headers, /^From: =\?UTF-8\?B\?[A-Za-z0-9+/=]+\?= <ordersisolution@gmail\.com>$/m);
  assert.match(headers, /^To: <isolutionspiyave@gmail\.com>$/m);
  assert.match(headers, /^Message-ID: <vendor-notification\.6f0c2a1e-0000-4000-8000-000000000001@isolutionspakistan\.com>$/m);
  const subject = headers.match(/^Subject: =\?UTF-8\?B\?([A-Za-z0-9+/=]+)\?=$/m);
  assert.equal(Buffer.from(subject[1], "base64").toString("utf8"), EMAIL.subject);
  assert.ok(!/^(Cc|Bcc):/mi.test(headers));
  const [text, html] = parts(mime);
  assert.equal(text, EMAIL.text);
  assert.equal(html, EMAIL.html);
  assert.ok(text.includes("Ünïcode ✓") && text.includes("https://isolutionspakistan.com/staff"));
});

test("header injection: hostile subject / recipient can never add a header", async () => {
  const hostile = renderVendorNotification({ ...ROW, payload: { ...ROW.payload, order_number: "X\r\nBcc: evil@example.test" } });
  const mime = buildMimeMessage({ ...hostile, subject: "A\r\nBcc: evil@example.test" }, CONFIG.sender);
  assert.ok(!/^Bcc:/mi.test(mime.slice(0, mime.indexOf("\r\n\r\n"))));
  assert.throws(() => buildMimeMessage({ ...EMAIL, to: "a@b.c\r\nBcc: evil@example.test" }, CONFIG.sender), /gmail_recipient_invalid/);
  assert.throws(() => buildMimeMessage({ ...EMAIL, to: "a@b.c, evil@example.test" }, CONFIG.sender), /gmail_recipient_invalid/);
  const { calls, fetch } = mockFetch([]);
  assert.deepEqual(await createGmailTransport(CONFIG, { fetch }).send({ ...EMAIL, to: "nope" }), { ok: false, error: "gmail_recipient_invalid" });
  assert.equal(calls.length, 0, "an invalid message never reaches Google");
});

test("token refresh: cached until near expiry, refreshed afterwards, 401 refreshes once", async () => {
  let clock = 1_000_000;
  const { calls, fetch } = mockFetch([tokenOk(1), reply(200, { id: "a" }), reply(200, { id: "b" }),
    tokenOk(2), reply(200, { id: "c" }),
    reply(401, { error: { status: "UNAUTHENTICATED" } }), tokenOk(3), reply(200, { id: "d" })]);
  const gmail = createGmailTransport(CONFIG, { fetch, now: () => clock });
  assert.equal((await gmail.send(EMAIL)).ok, true);
  assert.equal((await gmail.send(EMAIL)).ok, true);
  assert.equal(calls.filter((c) => c.url === GOOGLE_TOKEN_URL).length, 1, "token reused");
  clock += 3_599_000 - 30_000;   // inside the 60 s safety margin
  assert.equal((await gmail.send(EMAIL)).providerMessageId, "c");
  assert.equal(calls.filter((c) => c.url === GOOGLE_TOKEN_URL).length, 2, "refreshed before expiry");
  const retried = await gmail.send(EMAIL);
  assert.deepEqual(retried, { ok: true, providerMessageId: "d" }, "401 → refresh → resend");
  assert.equal(calls.at(-1).headers.Authorization, "Bearer ya29.TEST-access-token-3");
});

test("missing / revoked credentials: prepare fails before any claim, later sends fail fast, no secret leaks", async () => {
  const echo = { error: "invalid_grant", error_description: `Token ${CONFIG.refreshToken} has been expired or revoked.` };
  const { calls, fetch } = mockFetch([reply(400, echo)]);
  const gmail = createGmailTransport(CONFIG, { fetch });
  const ready = await gmail.prepare();
  assert.deepEqual(ready, { ok: false, error: "gmail_auth_revoked:http_400:invalid_grant" });
  const after = await gmail.send(EMAIL);
  assert.equal(after.ok, false);
  assert.match(after.error, /^gmail_auth_revoked/);
  assert.equal(calls.length, 1, "no further Google calls after a revoked grant");
  assert.ok(!leaks([ready, after]));

  for (const [status, body, expected] of [
    [401, { error: "invalid_client" }, /^gmail_auth_revoked:http_401:invalid_client$/],
    [500, { error: "internal_failure" }, /^gmail_token_failed:http_500/],
  ]) {
    const mock = mockFetch([reply(status, body)]);
    assert.match((await createGmailTransport(CONFIG, { fetch: mock.fetch }).prepare()).error, expected);
  }
  const offline = mockFetch([() => { throw new Error(`connect failed ${CONFIG.clientSecret}`); }]);
  assert.deepEqual(await createGmailTransport(CONFIG, { fetch: offline.fetch }).prepare(), { ok: false, error: "gmail_token_unreachable" });
  const narrow = mockFetch([reply(200, { access_token: "ya29.TEST-access-token", expires_in: 3600, scope: "openid" })]);
  assert.deepEqual(await createGmailTransport(CONFIG, { fetch: narrow.fetch }).prepare(), { ok: false, error: "gmail_scope_missing" });
  const twice = mockFetch([tokenOk(1), reply(401, {}), tokenOk(2), reply(401, {})]);
  const stuck = createGmailTransport(CONFIG, { fetch: twice.fetch });
  assert.match((await stuck.send(EMAIL)).error, /^gmail_unauthorized:http_401/);
  assert.match((await stuck.send(EMAIL)).error, /^gmail_auth_revoked/, "a second 401 halts the batch");
  assert.equal(twice.calls.length, 4);
});

test("Gmail API errors: definite vs ambiguous outcomes, rate limits halt the batch, never reported as sent", async () => {
  const cases = [
    [reply(400, { error: { status: "INVALID_ARGUMENT", errors: [{ reason: "invalidArgument", message: CONFIG.refreshToken }] } }), "gmail_rejected:http_400:invalidArgument"],
    [reply(403, { error: { errors: [{ reason: "insufficientPermissions" }] } }), "gmail_rejected:http_403:insufficientPermissions"],
    [reply(500, { error: { status: "INTERNAL" } }), "gmail_outcome_unknown:http_500:INTERNAL"],
    [reply(503, null), "gmail_outcome_unknown:http_503"],
    [() => { throw new DOMException("timed out", "TimeoutError"); }, "gmail_outcome_unknown:network_or_timeout"],
    [reply(200, { id: 42 }), null],   // accepted but no readable id → sent without a provider id
  ];
  for (const [answer, error] of cases) {
    const { fetch } = mockFetch([tokenOk(), answer]);
    const result = await createGmailTransport(CONFIG, { fetch }).send(EMAIL);
    assert.deepEqual(result, error ? { ok: false, error } : { ok: true });
    assert.ok(!leaks(result));
  }
  for (const limited of [reply(429, { error: { status: "RESOURCE_EXHAUSTED" } }), reply(403, { error: { errors: [{ reason: "userRateLimitExceeded" }] } })]) {
    const { calls, fetch } = mockFetch([tokenOk(), limited]);
    const gmail = createGmailTransport(CONFIG, { fetch });
    assert.match((await gmail.send(EMAIL)).error, /^gmail_rate_limited/);
    assert.match((await gmail.send(EMAIL)).error, /^gmail_rate_limited/, "rest of the batch is not sent to Google");
    assert.equal(calls.length, 2);
  }
});

test("queue integration: release → Gmail (mocked) → sent / retry statuses; a Gmail outage never affects the release", async () => {
  const db = await createCatalogTestDatabase({ supabaseDefaultPrivileges: true });
  const ownerId = await signInAsOwner(db);
  const one = async (sql, params = []) => (await db.query(sql, params)).rows[0];
  const all = async (sql, params = []) => (await db.query(sql, params)).rows;
  const as = async (role, userId, run) => {
    await db.exec(`set role ${role}`);
    await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [userId ?? ""]);
    try { return await run(); } finally {
      await db.exec(`reset role`);
      await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [ownerId]);
    }
  };
  const product = async (title, type) => {
    await db.query(`select public.apply_catalog_bulk_import_v2($1::jsonb)`, [JSON.stringify({ products: [{
      action: "Create", source: title, product_type: type, brand: "Samsung", title, category: null, specifications: [],
      variants: [{ source: "row", sku: null, ram: null, storage: null, color: "Black", price_minor: 123_400,
        compare_at_price_minor: null, stock: 50, pta_status: "not_applicable", condition: "brand_new", condition_grade: null,
        battery_health_percent: null, battery_cycle_count: null, sim_configuration: null, warranty: "1 Year", delivery_scope: "nationwide" }],
    }] })]);
    const { id } = await one(`select id from public.products where title = $1`, [title]);
    await db.query(`insert into public.product_media (product_id, cloudinary_public_id, cloudinary_asset_id, cloudinary_version,
        secure_url, width, height, bytes, format, alt_text, is_primary)
      values ($1, $2, $2, 1, 'https://res.cloudinary.com/test/image/upload/x', 800, 800, 1000, 'jpg', 'x', true)`, [id, `test/${id}`]);
    await db.query(`update public.products set publication_status = 'published' where id = $1`, [id]);
    const variant = (await one(`select id from public.product_variants where product_id = $1`, [id])).id;
    const category = (await one(`select c.slug from public.products p join public.categories c on c.id = p.category_id where p.id = $1`, [id])).slug;
    return { id, variant, category };
  };
  const KETTLE = await product("TEST GM Kettle", "Gadget");
  const CABLE = await product("TEST GM Cable", "Accessory");
  const order = await as("anon", null, async () => (await db.query(
    `select * from public.create_storefront_order($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb)`,
    ["TEST GM Secret Customer", "03140000099", "gm-secret@example.test", "Karachi", null, "TEST GM Secret Street", null,
      "TEST GM note", "cash_on_delivery", "standard", JSON.stringify([{ variant_id: KETTLE.variant, quantity: 1 }, { variant_id: CABLE.variant, quantity: 1 }])],
  )).rows[0].order_id);
  const assignments = (await all(`select id, product_id from public.order_items where order_id = $1`, [order])).map((row) => {
    const p = [KETTLE, CABLE].find((c) => c.id === row.product_id);
    return { item_id: row.id, vendor: suggestVendor({ productId: p.id, categorySlug: p.category }) };
  });

  // Gmail is completely down while the Admin releases: the release itself never calls Gmail and succeeds.
  const released = await as("authenticated", ownerId, async () =>
    all(`select * from public.admin_confirm_and_release_order($1, $2::jsonb)`, [order, JSON.stringify(assignments)]));
  assert.equal(released.length, 2, "both vendor parts released");
  const statuses = () => all(`select v.code, n.status, n.attempts, n.last_error, n.provider_message_id from public.vendor_order_notifications n
    join public.vendors v on v.id = n.vendor_id where n.order_id = $1 order by v.sort_order`, [order]);
  assert.deepEqual((await statuses()).map((r) => [r.code, r.status]), [["isolutions", "pending"], ["piyavey", "pending"]]);

  // Revoked authorization: the Edge Function's prepare() fails first, so nothing is claimed and no attempt is used.
  const revoked = createGmailTransport(CONFIG, { fetch: mockFetch([reply(400, { error: "invalid_grant" })]).fetch });
  assert.equal((await revoked.prepare()).ok, false);
  assert.deepEqual((await statuses()).map((r) => [r.status, r.attempts]), [["pending", 0], ["pending", 0]]);

  const claim = () => as("authenticated", ownerId, () => all(`select * from public.admin_claim_vendor_notifications(10)`));
  const complete = (id, leaseId, result) => as("authenticated", ownerId, () => db.query(
    `select public.admin_complete_vendor_notification($1, $2, $3, $4, $5)`,
    [id, leaseId, result.ok, result.ok ? null : result.error, result.ok ? result.providerMessageId ?? null : null]));

  // Attempt 1: iSolutions accepted; Piyavey's connection drops after sending (ambiguous) → retried, NOT marked sent.
  const recipients = [];
  const first = mockFetch([tokenOk(), (url, init) => { recipients.push(decode(JSON.parse(init.body).raw).match(/^To: <(.+)>$/m)[1]); return reply(200, { id: "gm-1" }); },
    (url, init) => { recipients.push(decode(JSON.parse(init.body).raw).match(/^To: <(.+)>$/m)[1]); throw new Error("connection reset"); }]);
  const gmail = createGmailTransport(CONFIG, { fetch: first.fetch });
  assert.equal((await gmail.prepare()).ok, true);
  assert.deepEqual(await deliverClaimed(await claim(), gmail, complete, "https://isolutionspakistan.com"), { sent: 1, failed: 1 });
  assert.deepEqual(recipients, ["ordersisolution@gmail.com", "isolutionspiyave@gmail.com"], "one separate email per vendor");
  const afterFirst = await statuses();
  assert.deepEqual(afterFirst.map((r) => [r.code, r.status, r.attempts, r.provider_message_id]),
    [["isolutions", "sent", 1, "gm-1"], ["piyavey", "pending", 1, null]]);
  assert.equal(afterFirst[1].last_error, "gmail_outcome_unknown:network_or_timeout");
  for (const call of first.calls.filter((c) => c.url === GMAIL_SEND_URL)) {
    const mime = decode(JSON.parse(call.body).raw);
    const content = parts(mime).join("\n");
    for (const secret of ["TEST GM Secret Customer", "03140000099", "gm-secret@example.test", "TEST GM Secret Street", "TEST GM note", "1,234", "Rs "])
      assert.ok(!content.includes(secret) && !mime.includes(secret), `no customer data / price: ${secret}`);
  }

  // Retry after backoff: only Piyavey is re-sent; the sent iSolutions row is never sent again.
  await db.query(`update public.vendor_order_notifications set next_attempt_at = now() - interval '1 second' where order_id = $1`, [order]);
  const second = mockFetch([tokenOk(), reply(200, { id: "gm-2" })]);
  assert.deepEqual(await deliverClaimed(await claim(), createGmailTransport(CONFIG, { fetch: second.fetch }), complete), { sent: 1, failed: 0 });
  assert.match(decode(JSON.parse(second.calls[1].body).raw), /^To: <isolutionspiyave@gmail\.com>$/m);
  assert.deepEqual((await statuses()).map((r) => [r.code, r.status, r.provider_message_id]), [["isolutions", "sent", "gm-1"], ["piyavey", "sent", "gm-2"]]);
  assert.ok(!leaks(await statuses()), "no secret reaches the Admin-visible status");
});

test("Edge Function wiring: Gmail opt-in, credentials checked before claiming, no secret in any response", async () => {
  const fn = await readFile(new URL("../supabase/functions/vendor-order-notifications/index.ts", import.meta.url), "utf8");
  assert.ok(fn.includes(`case "gmail"`) && fn.includes("gmailConfigFromEnv"));
  assert.ok(fn.indexOf("configured: false") < fn.indexOf("transport.prepare()"));
  assert.ok(fn.indexOf("transport.prepare()") < fn.indexOf("admin_claim_vendor_notifications"), "prepare before claim");
  assert.ok(!/console\.|SERVICE_ROLE/.test(fn), "no logging, no service-role key");
  const transport = await readFile(new URL("../supabase/functions/_shared/gmailTransport.ts", import.meta.url), "utf8");
  assert.ok(!/console\.|Deno\./.test(transport), "transport never logs and reads env only through the injected getter");
  assert.ok(!/gmail\.(readonly|modify|compose)|mail\.google\.com/.test(transport), "send-only scope");
  for (const file of ["../src/admin/AdminOrderVendors.tsx", "../src/lib/vendorNotifications.ts"]) {
    const source = await readFile(new URL(file, import.meta.url), "utf8");
    assert.ok(!/GMAIL_OAUTH|refresh_token|gmailTransport/i.test(source), `${file}: nothing Gmail in the browser bundle`);
  }
});

test("one-time authorization helper: loopback + PKCE, send-only scope, secrets only in a file outside the repo", async () => {
  const pkce = createPkce();
  assert.match(pkce.verifier, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(pkce.method, "S256");
  const url = new URL(buildAuthUrl({ clientId: CONFIG.clientId, redirectUri: "http://127.0.0.1:53111/oauth2callback", challenge: pkce.challenge, state: "st" }));
  assert.equal(url.origin + url.pathname, "https://accounts.google.com/o/oauth2/v2/auth");
  assert.deepEqual(Object.fromEntries(url.searchParams), {
    client_id: CONFIG.clientId, redirect_uri: "http://127.0.0.1:53111/oauth2callback", response_type: "code", scope: GMAIL_SEND_SCOPE,
    access_type: "offline", prompt: "consent", login_hint: "ordersisolution@gmail.com",
    code_challenge: pkce.challenge, code_challenge_method: "S256", state: "st" });
  assert.ok(!url.searchParams.has("client_secret"));

  assert.deepEqual(parseClientFile(JSON.stringify({ installed: { client_id: CONFIG.clientId, client_secret: CONFIG.clientSecret } })),
    { clientId: CONFIG.clientId, clientSecret: CONFIG.clientSecret });
  assert.throws(() => parseClientFile(JSON.stringify({ web: { client_id: CONFIG.clientId } })), /client_type_not_desktop/);
  assert.throws(() => parseClientFile("{"), /client_file_not_json/);

  assert.throws(() => resolveOutputPath(path.join(REPO_ROOT, "gmail.env"), { exists: () => false }), /output_inside_repository/);
  assert.throws(() => resolveOutputPath(path.join(REPO_ROOT, "supabase", ".env"), { exists: () => false }), /output_inside_repository/);
  assert.throws(() => resolveOutputPath(undefined, { home: "C:\\Users\\Owner", exists: () => true }), /output_exists/);
  assert.equal(resolveOutputPath(undefined, { home: path.resolve(REPO_ROOT, "..", "owner-home"), exists: () => false }),
    path.resolve(REPO_ROOT, "..", "owner-home", "isolutions-gmail-secrets.env"));

  const env = formatEnvFile({ ...CONFIG });
  assert.match(env, /^VENDOR_EMAIL_PROVIDER=gmail$/m);
  assert.match(env, /^GMAIL_SENDER_ADDRESS=ordersisolution@gmail\.com$/m);
  assert.match(env, new RegExp(`^GMAIL_OAUTH_REFRESH_TOKEN=${CONFIG.refreshToken.replace(/[/.]/g, "\\$&")}$`, "m"));
  assert.throws(() => formatEnvFile({ ...CONFIG, refreshToken: "a\nB=1" }), /secret_value_invalid/);

  const { calls, fetch } = mockFetch([reply(200, { access_token: "ya29.x", refresh_token: CONFIG.refreshToken, scope: GMAIL_SEND_SCOPE, expires_in: 3599 })]);
  assert.deepEqual(await exchangeCode({ code: "4/code", verifier: pkce.verifier, ...CONFIG, redirectUri: "http://127.0.0.1:1/oauth2callback", fetchImpl: fetch }),
    { refreshToken: CONFIG.refreshToken, scopes: [GMAIL_SEND_SCOPE] });
  assert.equal(Object.fromEntries(new URLSearchParams(calls[0].body)).code_verifier, pkce.verifier);
  for (const [answer, expected] of [
    [reply(400, { error: "invalid_grant", error_description: CONFIG.clientSecret }), /^token_exchange_failed:http_400:invalid_grant$/],
    [reply(200, { access_token: "x", refresh_token: "r", scope: "openid" }), /gmail_send_scope_not_granted/],
    [reply(200, { access_token: "x", scope: GMAIL_SEND_SCOPE }), /no_refresh_token_returned/],
  ]) {
    const error = await exchangeCode({ code: "c", verifier: "v", ...CONFIG, redirectUri: "r", fetchImpl: mockFetch([answer]).fetch }).catch((e) => e);
    assert.match(error.message, expected);
    assert.ok(!error.message.includes(CONFIG.clientSecret));
  }
  const script = await readFile(new URL("./gmail-oauth-authorize.mjs", import.meta.url), "utf8");
  assert.ok(!/console\.log\([^)]*(refreshToken|clientSecret|access_token|code\b)/.test(script), "never prints a secret");
  assert.ok(!/urn:ietf:wg:oauth:2\.0:oob/.test(script), "no deprecated out-of-band flow");
});
