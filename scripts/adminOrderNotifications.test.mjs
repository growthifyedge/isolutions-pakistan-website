// Admin New Order Alert (202611170001 + the admin-order-notifications Edge Function) against the replayed migrations
// (never a live database) and a fake email transport (nothing is ever sent). Covers: one email per committed order,
// failed checkout queues nothing, duplicate protection, retry/backoff/give-up, lease expiry, no customer data in the
// email, access control, enqueue failure never blocks checkout, and the fire-and-forget storefront trigger.
import assert from "node:assert/strict";
import test from "node:test";
import { createCatalogTestDatabase, signInAsOwner } from "./support/catalogTestDatabase.mjs";
import { adminOrderNotificationUrl, requestAdminOrderNotification } from "../src/lib/adminOrderNotifications.ts";
import {
  adminOrdersUrl, deliverAdminClaimed, formatPlacedAt, formatRs, parseAdminOrderPayload, renderAdminOrderNotification,
} from "../supabase/functions/_shared/adminOrderNotificationEmail.ts";

const ADMIN_MAILBOX = "isolutionpakistan89@gmail.com";
const db = await createCatalogTestDatabase({ supabaseDefaultPrivileges: true });
const ownerId = await signInAsOwner(db);
const one = async (sql, params = []) => (await db.query(sql, params)).rows[0];
const all = async (sql, params = []) => (await db.query(sql, params)).rows;

const user = async (email, role) => {
  const { id } = await one(`insert into auth.users (email) values ($1) returning id`, [email]);
  await db.query(`update public.profiles set role = $2, is_active = true where id = $1`, [id, role]);
  return id;
};
const customerId = await user("ao-customer@example.test", null);

async function as(role, userId, run, jwtRole = "") {
  await db.exec(`set role ${role}`);
  await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [userId ?? ""]);
  await db.query(`select set_config('request.jwt.claim.role', $1, false)`, [jwtRole]);
  try { return await run(); } finally {
    await db.exec(`reset role`);
    await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [ownerId]);
    await db.query(`select set_config('request.jwt.claim.role', '', false)`);
  }
}

const product = async (title, type, price, stock = 200) => {
  await db.query(`select public.apply_catalog_bulk_import_v2($1::jsonb)`, [JSON.stringify({ products: [{
    action: "Create", source: title, product_type: type, brand: "Samsung", title, category: null, specifications: [],
    variants: [{ source: "row", sku: null, ram: null, storage: null, color: "Black", price_minor: price,
      compare_at_price_minor: null, stock, pta_status: "not_applicable", condition: "brand_new", condition_grade: null,
      battery_health_percent: null, battery_cycle_count: null, sim_configuration: null, warranty: "1 Year", delivery_scope: "nationwide" }],
  }] })]);
  const { id } = await one(`select id from public.products where title = $1`, [title]);
  await db.query(`insert into public.product_media (product_id, cloudinary_public_id, cloudinary_asset_id, cloudinary_version,
      secure_url, width, height, bytes, format, alt_text, is_primary)
    values ($1, $2, $2, 1, 'https://res.cloudinary.com/test/image/upload/x', 800, 800, 1000, 'jpg', 'x', true)`, [id, `test/${id}`]);
  await db.query(`update public.products set publication_status = 'published' where id = $1`, [id]);
  const variant = (await one(`select id from public.product_variants where product_id = $1`, [id])).id;
  return { id, variant, title };
};
const KETTLE = await product("TEST AO Kettle", "Gadget", 123_400);
const CABLE = await product("TEST AO Cable", "Accessory", 45_600);
const SCARCE = await product("TEST AO Scarce", "Accessory", 10_000, 1);

const CUSTOMER = { name: "TEST AO Secret Customer", address: "TEST AO Secret Street 42", email: "ao-secret@example.test", note: "TEST AO secret note" };
let phone = 0;
const phoneNo = () => `0315${String(++phone).padStart(7, "0")}`;
const place = (lines, payment = "cash_on_delivery", shipping = "standard") => as("anon", null, async () => (await db.query(
  `select * from public.create_storefront_order($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb)`,
  [CUSTOMER.name, phoneNo(), CUSTOMER.email, "Karachi", null, CUSTOMER.address, "TEST AO landmark", CUSTOMER.note, payment, shipping,
    JSON.stringify(lines.map(([p, quantity]) => ({ variant_id: p.variant, quantity })))],
)).rows[0]);
const notes = (orderId) => all(`select * from public.admin_order_notifications where order_id = $1`, [orderId]);

// Worker RPCs as the service role (what the Edge Function does).
const SERVICE = (run) => as("service_role", null, run, "service_role");
const claim = (limit = 50) => SERVICE(() => all(`select * from public.admin_claim_admin_order_notifications($1)`, [limit]));
const complete = (id, lease, ok, error = null, providerId = null) => SERVICE(async () =>
  (await one(`select public.admin_complete_admin_order_notification($1, $2, $3, $4, $5) as done`, [id, lease, ok, error, providerId])).done);
const hasDue = () => SERVICE(async () => (await one(`select public.admin_has_due_admin_order_notifications() as due`)).due);
const makeDue = (id) => db.query(`update public.admin_order_notifications set next_attempt_at = now() - interval '1 second' where id = $1`, [id]);
const drain = async () => { for (const row of await claim()) await complete(row.id, row.lease_id, true, null, "drained"); };

const fakeTransport = (fail = () => false) => {
  const sent = [];
  return { sent, transport: { name: "fake", async send(email) {
    if (fail(email)) throw new Error("gmail_send_failed:http_400:invalidArgument");
    sent.push(email); return { ok: true, providerMessageId: `fake-${sent.length}` };
  } } };
};

test("a successful checkout queues exactly one Admin alert to the Owner-approved mailbox, before any release", async () => {
  await drain();
  const order = await place([[KETTLE, 1], [CABLE, 2]]);
  const rows = await notes(order.order_id);
  assert.equal(rows.length, 1);
  const [row] = rows;
  assert.deepEqual([row.recipient, row.status, row.attempts], [ADMIN_MAILBOX, "pending", 0]);
  const o = await one(`select * from public.orders where id = $1`, [order.order_id]);
  assert.equal(o.released_at, null, "no Confirm & Release needed");
  assert.equal(row.payload.order_number, order.order_number);
  assert.equal(row.payload.payment_method, "cash_on_delivery");
  assert.equal(Number(row.payload.total_minor), Number(o.total_minor));
  // Items of one checkout share created_at, so their order is not significant: compare as a set.
  assert.deepEqual(row.payload.items.map((i) => [i.title, i.quantity, Number(i.unit_price_minor), Number(i.line_total_minor)])
    .sort((a, b) => a[0].localeCompare(b[0])),
    [[CABLE.title, 2, 45_600, 91_200], [KETTLE.title, 1, 123_400, 123_400]]);
  assert.equal(await hasDue(), true);
});

test("payload and rendered email contain no customer personal information", async () => {
  await drain();
  const order = await place([[CABLE, 1]], "bank_transfer", "fast");
  const [row] = await notes(order.order_id);
  const stored = JSON.stringify(row.payload);
  for (const secret of [CUSTOMER.name, CUSTOMER.address, CUSTOMER.email, CUSTOMER.note, "TEST AO landmark", "0315", "Karachi"])
    assert.ok(!stored.includes(secret), `payload must not contain ${secret}`);
  const { sent, transport } = fakeTransport();
  assert.deepEqual(await deliverAdminClaimed(await claim(), transport, (id, lease, r) => complete(id, lease, r.ok, null, r.providerMessageId),
    "https://isolutionspakistan.com"), { sent: 1, failed: 0 });
  const [email] = sent;
  const body = `${email.subject}\n${email.text}\n${email.html}`;
  for (const secret of [CUSTOMER.name, CUSTOMER.address, CUSTOMER.email, CUSTOMER.note, "TEST AO landmark", "0315"])
    assert.ok(!body.includes(secret), `email must not contain ${secret}`);
  assert.equal(email.to, ADMIN_MAILBOX);
  assert.match(email.subject, new RegExp(`^New Order Alert: ${order.order_number} · Rs [\\d,]+ · Bank Transfer$`));
  for (const expected of ["NEW ORDER ALERT", order.order_number, "Bank Transfer", "Fast Delivery", CABLE.title, "Quantity: 1",
    "Unit price: Rs 456", "Order total:", "https://isolutionspakistan.com/admin/orders"])
    assert.ok(email.text.includes(expected), `text contains ${expected}`);
  assert.ok(email.html.includes("New Order Alert") && email.html.includes("Open Admin Orders"));
  assert.equal((await notes(order.order_id))[0].status, "sent");
});

test("a failed checkout (out of stock) queues nothing and stock is untouched", async () => {
  await drain();
  const before = (await one(`select count(*)::int as n from public.admin_order_notifications`)).n;
  await assert.rejects(place([[SCARCE, 2]]));
  assert.equal((await one(`select count(*)::int as n from public.admin_order_notifications`)).n, before);
  assert.equal(await hasDue(), false);
});

test("duplicate protection: one row per order, a sent alert is never claimed again, repeated drains send nothing", async () => {
  await drain();
  const order = await place([[CABLE, 1]]);
  await assert.rejects(db.query(`insert into public.admin_order_notifications (order_id, recipient, payload) values ($1, $2, '{}'::jsonb)`,
    [order.order_id, ADMIN_MAILBOX]), /admin_order_notifications_order_key/);
  const { sent, transport } = fakeTransport();
  const run = async () => deliverAdminClaimed(await claim(), transport, (id, lease, r) => complete(id, lease, r.ok, null, r.providerMessageId));
  assert.deepEqual(await run(), { sent: 1, failed: 0 });
  assert.deepEqual(await run(), { sent: 0, failed: 0 });
  assert.deepEqual(await run(), { sent: 0, failed: 0 });
  assert.equal(sent.length, 1);
  const [row] = await notes(order.order_id);
  assert.equal(row.status, "sent");
  assert.equal(row.provider_message_id, "fake-1");
  assert.equal(await complete(row.id, row.lease_id ?? "00000000-0000-0000-0000-000000000000", true), false, "stale lease ignored");
});

test("failure retries with backoff, gives up after max attempts, and never touches the order", async () => {
  await drain();
  const order = await place([[KETTLE, 1]]);
  const before = await one(`select status, total_minor from public.orders where id = $1`, [order.order_id]);
  const failing = fakeTransport(() => true);
  const [first] = await claim();
  await deliverAdminClaimed([first], failing.transport, (id, lease, r) => complete(id, lease, r.ok, r.ok ? null : r.error));
  let [row] = await notes(order.order_id);
  assert.deepEqual([row.status, row.attempts], ["pending", 1]);
  assert.match(row.last_error, /gmail_send_failed/);
  const waitMinutes = (Date.parse(row.next_attempt_at) - Date.now()) / 60_000;
  assert.ok(waitMinutes > 0.5 && waitMinutes <= 1.1, "first retry after ~1 minute");
  assert.deepEqual(await claim(), [], "not due yet");
  for (let attempt = 2; attempt <= 6; attempt += 1) {
    await makeDue(row.id);
    await deliverAdminClaimed(await claim(), failing.transport, (id, lease, r) => complete(id, lease, r.ok, r.ok ? null : r.error));
    [row] = await notes(order.order_id);
  }
  assert.deepEqual([row.status, row.attempts], ["failed", 6]);
  await makeDue(row.id);
  assert.deepEqual(await claim(), [], "a failed row is not retried automatically");
  assert.deepEqual(await one(`select status, total_minor from public.orders where id = $1`, [order.order_id]), before);
});

test("a worker that dies mid-send loses its lease and the alert becomes due again", async () => {
  await drain();
  const order = await place([[CABLE, 1]]);
  const [leased] = await claim();
  assert.deepEqual(await claim(), [], "leased row is not claimed twice");
  await db.query(`update public.admin_order_notifications set locked_until = now() - interval '1 second' where id = $1`, [leased.id]);
  const [again] = await claim();
  assert.equal(again.id, leased.id);
  assert.notEqual(again.lease_id, leased.lease_id);
  assert.equal(await complete(leased.id, leased.lease_id, true), false, "old lease cannot complete");
  assert.equal(await complete(again.id, again.lease_id, true), true);
  assert.equal((await notes(order.order_id))[0].status, "sent");
});

test("access control: anon, customers and non-admin users cannot read the outbox or call the worker RPCs", async () => {
  await drain();
  await place([[CABLE, 1]]);
  for (const [role, who] of [["anon", null], ["authenticated", customerId]]) {
    await as(role, who, async () => {
      if (role === "anon") await assert.rejects(db.query(`select * from public.admin_order_notifications`));
      else assert.deepEqual((await db.query(`select * from public.admin_order_notifications`)).rows, []);
      await assert.rejects(db.query(`select * from public.admin_claim_admin_order_notifications(10)`));
      await assert.rejects(db.query(`select public.admin_has_due_admin_order_notifications()`));
      await assert.rejects(db.query(`select public.admin_complete_admin_order_notification(gen_random_uuid(), gen_random_uuid(), true)`));
      await assert.rejects(db.query(`insert into public.admin_order_notifications (order_id, recipient, payload) select id, 'x@y.z', '{}' from public.orders limit 1`));
      await assert.rejects(db.query(`select public.enqueue_admin_order_notification()`));
    });
  }
  const rows = await as("authenticated", ownerId, () => all(`select id from public.admin_order_notifications`));
  assert.ok(rows.length >= 1, "Admin can read alert status");
});

test("an enqueue failure never blocks checkout", async () => {
  await drain();
  await db.exec(`alter table public.admin_order_notifications add constraint ao_test_block check (recipient = 'nobody@example.test') not valid`);
  try {
    const order = await place([[CABLE, 1]]);
    assert.ok(order.order_number, "order still created");
    assert.deepEqual(await notes(order.order_id), []);
    assert.equal((await one(`select count(*)::int as n from public.order_items where order_id = $1`, [order.order_id])).n, 1);
  } finally {
    await db.exec(`alter table public.admin_order_notifications drop constraint ao_test_block`);
  }
});

test("rendering: payload validation, header safety, HTML escaping, amounts and Pakistan time", () => {
  assert.throws(() => parseAdminOrderPayload(null), /payload_invalid/);
  assert.throws(() => parseAdminOrderPayload({ order_number: "X", items: [] }), /payload_items_missing/);
  assert.throws(() => parseAdminOrderPayload({ order_number: "X", total_minor: -1, subtotal_minor: 1, delivery_fee_minor: 0,
    items: [{ title: "a", quantity: 1, unit_price_minor: 1, line_total_minor: 1 }] }), /payload_total_invalid/);
  assert.equal(formatRs(265_000), "Rs 2,650");
  assert.equal(formatRs(1_234_550), "Rs 12,345.50");
  assert.equal(formatPlacedAt("2026-11-16T10:45:00Z"), "16 Nov 2026, 3:45 PM PKT");
  assert.equal(adminOrdersUrl(undefined), "https://isolutionspakistan.com/admin/orders");
  assert.equal(adminOrdersUrl("javascript:alert(1)"), "https://isolutionspakistan.com/admin/orders");
  const email = renderAdminOrderNotification({ id: "n1", recipient: ADMIN_MAILBOX, lease_id: "l1", payload: {
    order_number: "ISP-ORD-1\r\nBcc: evil@example.test", placed_at: "2026-11-16T10:45:00Z", payment_method: "cash_on_delivery",
    shipping_method: "standard", subtotal_minor: 500_000, delivery_fee_minor: 20_000, discount_minor: 50_000, shipping_discount_minor: 0,
    total_minor: 470_000, coupon_code: "SAVE<b>", items: [{ title: "<script>x</script>", sku: "S1", variant: { color: "Blue" },
      quantity: 1, unit_price_minor: 500_000, line_total_minor: 500_000 }] } });
  assert.ok(!/[\r\n]/.test(email.subject));
  assert.ok(!email.html.includes("<script>x</script>") && email.html.includes("&lt;script&gt;"));
  assert.ok(!email.html.includes("SAVE<b>"));
  assert.ok(email.text.includes("Discount (SAVE<b>): - Rs 500") && email.text.includes("Order total: Rs 4,700"));
  assert.ok(email.text.includes("Colour: Blue") && email.text.includes("Payment:      Cash on Delivery"));
});

test("storefront trigger is fire-and-forget: no order data, keepalive, never throws", async () => {
  assert.equal(adminOrderNotificationUrl("https://abc.supabase.co/"), "https://abc.supabase.co/functions/v1/admin-order-notifications");
  assert.equal(adminOrderNotificationUrl(undefined), null);
  const calls = [];
  requestAdminOrderNotification("https://abc.supabase.co", (url, init) => { calls.push([url, init]); return Promise.reject(new Error("offline")); });
  assert.equal(calls.length, 1);
  const [[url, init]] = calls;
  assert.equal(url, "https://abc.supabase.co/functions/v1/admin-order-notifications");
  assert.deepEqual([init.method, init.body, init.keepalive, init.headers["Content-Type"]], ["POST", "{}", true, "text/plain"]);
  assert.doesNotThrow(() => requestAdminOrderNotification("https://abc.supabase.co", () => { throw new Error("sync failure"); }));
  assert.doesNotThrow(() => requestAdminOrderNotification(undefined, undefined));
  await new Promise((resolve) => setTimeout(resolve, 0));
});

// ---- 202611180001: pg_cron safety net (net.http_post is a recording stub here; nothing is sent) -------------------
const DEV_URL = "https://acwatgxkcyrdxpcljxjb.supabase.co/functions/v1/admin-order-notifications";
const dispatch = async () => (await one(`select public.dispatch_admin_order_notifications() as id`)).id;
const calls = async () => Number((await one(`select count(*)::int as n from net.http_request_queue`)).n);
const setUrl = (url) => url === null
  ? db.query(`delete from vault.decrypted_secrets where name = 'admin_order_notifications_url'`)
  : db.query(`insert into vault.decrypted_secrets values ('admin_order_notifications_url', $1)
      on conflict (name) do update set decrypted_secret = excluded.decrypted_secret`, [url]);

test("retry schedule: one cron job every minute that only runs the dispatcher", async () => {
  const jobs = await all(`select * from cron.job where jobname = 'admin-order-notifications-retry'`);
  assert.deepEqual(jobs.map((j) => [j.schedule, j.command]),
    [["* * * * *", "select public.dispatch_admin_order_notifications()"]]);
});

test("dispatcher: nothing due -> no HTTP call; due -> exactly one POST to the configured function URL", async () => {
  await drain();
  await setUrl(DEV_URL);
  const before = await calls();
  assert.equal(await dispatch(), null);
  assert.equal(await calls(), before, "idle minute makes no HTTP call");

  await place([[CABLE, 1]]);
  assert.notEqual(await dispatch(), null);
  assert.equal(await calls(), before + 1);
  const req = await one(`select * from net.http_request_queue order by id desc limit 1`);
  assert.equal(req.url, DEV_URL);
  assert.deepEqual(req.body, {}, "no order data and no credentials are sent");
  assert.deepEqual(Object.keys(req.headers), ["Content-Type"]);
});

test("dispatcher respects backoff: a failed alert is retried only once next_attempt_at has passed", async () => {
  await drain();
  await setUrl(DEV_URL);
  const order = await place([[CABLE, 1]]);
  const [row] = await claim();
  await complete(row.id, row.lease_id, false, "gmail_send_failed:http_500");
  const before = await calls();
  assert.equal(await dispatch(), null, "inside the 1-minute backoff: no call");
  await makeDue((await notes(order.order_id))[0].id);
  assert.notEqual(await dispatch(), null, "due again: the scheduler retries without a checkout or Admin visit");
  assert.equal(await calls(), before + 1);
  await drain();
  assert.equal(await dispatch(), null, "a sent alert is never dispatched again");
});

test("dispatcher: missing or foreign URL makes no call; anon, customers and service_role cannot execute it", async () => {
  await drain();
  await place([[CABLE, 1]]);
  const before = await calls();
  for (const url of [null, "https://evil.example.com/functions/v1/admin-order-notifications",
    "https://acwatgxkcyrdxpcljxjb.supabase.co/functions/v1/vendor-order-notifications"]) {
    await setUrl(url);
    assert.equal(await dispatch(), null);
  }
  assert.equal(await calls(), before);
  await setUrl(DEV_URL);
  for (const [role, who, jwt] of [["anon", null, ""], ["authenticated", customerId, ""], ["authenticated", ownerId, ""], ["service_role", null, "service_role"]])
    await as(role, who, () => assert.rejects(db.query(`select public.dispatch_admin_order_notifications()`)), jwt);
  await drain();
});
