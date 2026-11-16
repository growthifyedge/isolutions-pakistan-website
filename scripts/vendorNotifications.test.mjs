// Staff order email notifications (202611160001 + the vendor-order-notifications Edge Function) against the replayed
// migrations (never a live database) and a fake email transport (nothing is ever sent). Covers: iSolutions-only,
// Piyavey-only and mixed releases, duplicate-release protection, delivery failure + retry/backoff/give-up/re-queue,
// lease expiry, cross-vendor privacy of the email content, and that enqueue/email problems never affect a release.
import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { createCatalogTestDatabase, signInAsOwner } from "./support/catalogTestDatabase.mjs";
import { suggestVendor } from "../src/lib/vendorOrders.ts";
import { hasDeliverableNotification, notificationLabel } from "../src/lib/vendorNotifications.ts";
import {
  deliverClaimed, itemFacts, parseNotificationPayload, renderVendorNotification, staffDashboardUrl,
} from "../supabase/functions/_shared/vendorNotificationEmail.ts";

const db = await createCatalogTestDatabase({ supabaseDefaultPrivileges: true });
const ownerId = await signInAsOwner(db);
const one = async (sql, params = []) => (await db.query(sql, params)).rows[0];
const all = async (sql, params = []) => (await db.query(sql, params)).rows;
const vendorId = async (code) => (await one(`select id from public.vendors where code = $1`, [code])).id;
const ISOL = await vendorId("isolutions");
const PIYA = await vendorId("piyavey");

const user = async (email, role, vendor = null) => {
  const { id } = await one(`insert into auth.users (email) values ($1) returning id`, [email]);
  await db.query(`update public.profiles set role = $2, vendor_id = $3, is_active = true where id = $1`, [id, role, vendor]);
  return id;
};
const isolStaff = await user("vn-isol@example.test", "staff", ISOL);
const piyaStaff = await user("vn-piya@example.test", "staff", PIYA);
const customerId = await user("vn-customer@example.test", null);

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

const product = async (title, type, price) => {
  await db.query(`select public.apply_catalog_bulk_import_v2($1::jsonb)`, [JSON.stringify({ products: [{
    action: "Create", source: title, product_type: type, brand: "Samsung", title, category: null, specifications: [],
    variants: [{ source: "row", sku: null, ram: null, storage: null, color: "Black", price_minor: price,
      compare_at_price_minor: null, stock: 200, pta_status: "not_applicable", condition: "brand_new", condition_grade: null,
      battery_health_percent: null, battery_cycle_count: null, sim_configuration: null, warranty: "1 Year", delivery_scope: "nationwide" }],
  }] })]);
  const { id } = await one(`select id from public.products where title = $1`, [title]);
  await db.query(`insert into public.product_media (product_id, cloudinary_public_id, cloudinary_asset_id, cloudinary_version,
      secure_url, width, height, bytes, format, alt_text, is_primary)
    values ($1, $2, $2, 1, 'https://res.cloudinary.com/test/image/upload/x', 800, 800, 1000, 'jpg', 'x', true)`, [id, `test/${id}`]);
  await db.query(`update public.products set publication_status = 'published' where id = $1`, [id]);
  const variant = (await one(`select id from public.product_variants where product_id = $1`, [id])).id;
  const category = (await one(`select c.slug from public.products p join public.categories c on c.id = p.category_id where p.id = $1`, [id])).slug;
  return { id, variant, category, title };
};
const KETTLE = await product("TEST VN Kettle", "Gadget", 123_400);
const BLENDER = await product("TEST VN Blender", "Gadget", 98_700);
const CABLE = await product("TEST VN Cable", "Accessory", 45_600);
const PRODUCTS = [KETTLE, BLENDER, CABLE];

const CUSTOMER = { name: "TEST VN Secret Customer", address: "TEST VN Secret Street 42", city: "Karachi" };
let phone = 0;
const place = (lines) => as("anon", null, async () => (await db.query(
  `select * from public.create_storefront_order($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb)`,
  [CUSTOMER.name, `0314${String(++phone).padStart(7, "0")}`, "vn-secret@example.test", CUSTOMER.city, null, CUSTOMER.address,
    null, "TEST VN secret note", "cash_on_delivery", "standard",
    JSON.stringify(lines.map(([p, quantity]) => ({ variant_id: p.variant, quantity })))],
)).rows[0].order_id);
const payloadFor = async (orderId) => (await all(`select id, product_id from public.order_items where order_id = $1`, [orderId]))
  .map((row) => { const p = PRODUCTS.find((c) => c.id === row.product_id); return { item_id: row.id, vendor: suggestVendor({ productId: p.id, categorySlug: p.category }) }; });
const release = async (orderId, who = ownerId) => as("authenticated", who, async () =>
  all(`select * from public.admin_confirm_and_release_order($1, $2::jsonb)`, [orderId, JSON.stringify(await payloadFor(orderId))]));
const notes = (orderId) => all(`select n.*, v.code from public.vendor_order_notifications n join public.vendors v on v.id = n.vendor_id
  where n.order_id = $1 order by v.sort_order`, [orderId]);
const orderNumber = async (orderId) => (await one(`select order_number from public.orders where id = $1`, [orderId])).order_number;
const parts = (orderId) => all(`select f.id, v.code from public.order_fulfilments f join public.vendors v on v.id = f.vendor_id where f.order_id = $1 order by v.sort_order`, [orderId]);

// Worker RPCs as the Admin session (what the Edge Function does with the Admin's JWT).
const claim = (limit = 50) => as("authenticated", ownerId, () => all(`select * from public.admin_claim_vendor_notifications($1)`, [limit]));
const complete = (id, lease, ok, error = null, providerId = null) => as("authenticated", ownerId, async () =>
  (await one(`select public.admin_complete_vendor_notification($1, $2, $3, $4, $5) as done`, [id, lease, ok, error, providerId])).done);
const makeDue = (id) => db.query(`update public.vendor_order_notifications set next_attempt_at = now() - interval '1 second' where id = $1`, [id]);
// Settle everything queued by earlier tests so each test claims only its own rows.
const drain = async () => { for (const row of await claim()) await complete(row.id, row.lease_id, true, null, "drained"); };

const fakeTransport = (fail = () => false) => {
  const sent = [];
  return { sent, transport: { name: "fake", async send(email) {
    if (fail(email)) throw new Error("smtp 421 temporarily unavailable");
    sent.push(email); return { ok: true, providerMessageId: `fake-${sent.length}` };
  } } };
};

test("vendor mailboxes are the Owner-provided addresses", async () => {
  assert.deepEqual(await all(`select code, notification_email from public.vendors order by sort_order`), [
    { code: "isolutions", notification_email: "ordersisolution@gmail.com" },
    { code: "piyavey", notification_email: "isolutionspiyave@gmail.com" },
  ]);
});

test("iSolutions-only release queues exactly one email to iSolutions", async () => {
  await drain();
  const id = await place([[CABLE, 2]]);
  assert.deepEqual(await notes(id), [], "nothing is queued before release");
  await release(id);
  const rows = await notes(id);
  assert.deepEqual(rows.map((r) => [r.code, r.recipient, r.status, r.attempts]), [["isolutions", "ordersisolution@gmail.com", "pending", 0]]);
  assert.equal(rows[0].fulfilment_id, (await parts(id))[0].id);
  assert.deepEqual(rows[0].payload.items.map((i) => [i.title, i.quantity]), [[CABLE.title, 2]]);
  assert.equal(rows[0].payload.order_number, await orderNumber(id));
});

test("Piyavey-only release queues exactly one email to Piyavey", async () => {
  await drain();
  const id = await place([[KETTLE, 1], [BLENDER, 3]]);
  await release(id);
  const rows = await notes(id);
  assert.deepEqual(rows.map((r) => [r.code, r.recipient]), [["piyavey", "isolutionspiyave@gmail.com"]]);
  assert.deepEqual(rows[0].payload.items.map((i) => [i.title, i.quantity]).sort(), [[BLENDER.title, 3], [KETTLE.title, 1]]);
});

test("mixed release: one separate email per vendor, each with only its own items and no prices or customer data", async () => {
  await drain();
  const id = await place([[KETTLE, 1], [CABLE, 1]]);
  await release(id);
  const rows = await notes(id);
  assert.deepEqual(rows.map((r) => r.recipient), ["ordersisolution@gmail.com", "isolutionspiyave@gmail.com"]);
  const { sent, transport } = fakeTransport();
  const summary = await deliverClaimed(await claim(), transport, async (rowId, lease, result) => {
    assert.equal(await complete(rowId, lease, result.ok, null, result.providerMessageId), true);
  }, "https://isolutionspakistan.com");
  assert.deepEqual(summary, { sent: 2, failed: 0 });
  const isol = sent.find((e) => e.to === "ordersisolution@gmail.com");
  const piya = sent.find((e) => e.to === "isolutionspiyave@gmail.com");
  const number = await orderNumber(id);
  for (const [email, own, other, vendorName] of [[isol, CABLE, KETTLE, "iSolutions Pakistan"], [piya, KETTLE, CABLE, "Piyavey"]]) {
    const body = `${email.subject}\n${email.text}\n${email.html}`;
    assert.ok(body.includes(number) && body.includes(vendorName) && body.includes(own.title), "order, vendor and own items");
    assert.ok(body.includes("https://isolutionspakistan.com/staff"), "Staff Dashboard link");
    assert.ok(!body.includes(other.title), "never the other vendor's items");
    for (const secret of [CUSTOMER.name, CUSTOMER.address, "vn-secret@example.test", "TEST VN secret note", "0314", "Rs", "1,234", "456"])
      assert.ok(!body.includes(secret), `no ${secret}`);
  }
  assert.deepEqual((await notes(id)).map((r) => [r.status, r.attempts, Boolean(r.sent_at)]), [["sent", 1, true], ["sent", 1, true]]);
  assert.deepEqual(await claim(), [], "a sent email is never claimed again");
});

test("duplicate release protection: a repeated release or retry never queues a second email", async () => {
  await drain();
  const id = await place([[KETTLE, 1], [CABLE, 1]]);
  await release(id);
  await assert.rejects(release(id), /order_already_released_to_vendors/);
  await assert.rejects(as("authenticated", ownerId, () => all(`select * from public.admin_release_order_to_vendors($1)`, [id])), /order_already_released_to_vendors/);
  assert.equal((await notes(id)).length, 2);
  await assert.rejects(db.query(`insert into public.vendor_order_notifications (fulfilment_id, order_id, vendor_id, recipient, payload)
    select fulfilment_id, order_id, vendor_id, recipient, payload from public.vendor_order_notifications where order_id = $1`, [id]),
  /vendor_order_notifications_fulfilment_key/);
  // Two overlapping workers: the second claim gets nothing while the first holds the lease.
  const first = await claim();
  assert.equal(first.length, 2);
  assert.deepEqual(await claim(), []);
  for (const row of first) assert.equal(await complete(row.id, row.lease_id, true), true);
  assert.equal(await complete(first[0].id, first[0].lease_id, true), false, "a second completion is ignored");
});

test("delivery failure: retried with backoff, gives up after max attempts, Admin can re-queue", async () => {
  await drain();
  const id = await place([[CABLE, 1]]);
  await release(id);
  const [row] = await notes(id);
  const failing = fakeTransport(() => true);
  let [claimed] = await claim();
  await deliverClaimed([claimed], failing.transport, (rowId, lease, result) => complete(rowId, lease, result.ok, result.ok ? null : result.error));
  let [state] = await notes(id);
  assert.deepEqual([state.status, state.attempts, state.last_error], ["pending", 1, "smtp 421 temporarily unavailable"]);
  assert.ok(new Date(state.next_attempt_at) > new Date(Date.now() + 50_000), "first retry about 1 minute later");
  assert.deepEqual(await claim(), [], "not due yet");
  const expected = [5, 15, 60, 240];
  for (let attempt = 2; attempt <= 5; attempt += 1) {
    await makeDue(row.id);
    [claimed] = await claim();
    assert.equal(claimed.attempts, attempt);
    await complete(claimed.id, claimed.lease_id, false, "provider down");
    [state] = await notes(id);
    const minutes = (new Date(state.next_attempt_at) - new Date(state.updated_at)) / 60_000;
    assert.ok(Math.abs(minutes - expected[attempt - 2]) < 0.1, `backoff after attempt ${attempt}`);
  }
  await makeDue(row.id);
  [claimed] = await claim();
  await complete(claimed.id, claimed.lease_id, false, "x".repeat(2000));
  [state] = await notes(id);
  assert.deepEqual([state.status, state.attempts, state.last_error.length], ["failed", 6, 500]);
  await makeDue(row.id);
  assert.deepEqual(await claim(), [], "a failed email is not retried automatically");

  for (const who of [isolStaff, customerId]) await assert.rejects(as("authenticated", who, () => db.query(`select public.admin_retry_vendor_notification($1)`, [row.id])), /catalog_admin_required/);
  assert.equal((await as("authenticated", ownerId, () => one(`select public.admin_retry_vendor_notification($1) as ok`, [row.id]))).ok, true);
  const ok = fakeTransport();
  await deliverClaimed(await claim(), ok.transport, (rowId, lease, result) => complete(rowId, lease, result.ok));
  [state] = await notes(id);
  assert.deepEqual([state.status, state.attempts, ok.sent.length], ["sent", 1, 1]);
  assert.equal((await as("authenticated", ownerId, () => one(`select public.admin_retry_vendor_notification($1) as ok`, [row.id]))).ok, false, "a sent email is never re-queued");
});

test("a worker that dies mid-send loses its lease; the stale worker cannot overwrite the new attempt", async () => {
  await drain();
  const id = await place([[CABLE, 1]]);
  await release(id);
  const [dead] = await claim();
  await db.query(`update public.vendor_order_notifications set locked_until = now() - interval '1 second' where id = $1`, [dead.id]);
  const [again] = await claim();
  assert.equal(again.id, dead.id);
  assert.notEqual(again.lease_id, dead.lease_id);
  assert.equal(again.attempts, 2);
  assert.equal(await complete(dead.id, dead.lease_id, false, "late failure"), false);
  assert.equal(await complete(again.id, again.lease_id, true), true);
  assert.equal((await notes(id))[0].status, "sent");
});

test("one bad row or transport error never stops the other emails", async () => {
  await drain();
  const a = await place([[CABLE, 1]]);
  const b = await place([[KETTLE, 1]]);
  await release(a); await release(b);
  const original = (await notes(a))[0].payload;
  await db.query(`update public.vendor_order_notifications set payload = '{"order_number": ""}'::jsonb where order_id = $1`, [a]);
  const { sent, transport } = fakeTransport();
  const summary = await deliverClaimed(await claim(), transport, (rowId, lease, result) => complete(rowId, lease, result.ok, result.ok ? null : result.error));
  assert.deepEqual(summary, { sent: 1, failed: 1 });
  assert.deepEqual(sent.map((e) => e.to), ["isolutionspiyave@gmail.com"]);
  assert.deepEqual((await notes(a)).map((r) => [r.status, r.last_error]), [["pending", "payload_order_number_missing"]]);
  // A transport that returns garbage or rejects is also reported as a failure, not thrown.
  await makeDue((await notes(a))[0].id);
  await db.query(`update public.vendor_order_notifications set payload = $2::jsonb where order_id = $1`, [a, JSON.stringify(original)]);
  const odd = await deliverClaimed(await claim(), { name: "odd", send: async () => undefined }, (rowId, lease, result) => complete(rowId, lease, result.ok, result.ok ? null : result.error));
  assert.deepEqual(odd, { sent: 0, failed: 1 });
  assert.equal((await notes(a))[0].last_error, "transport_invalid_result");
});

test("Confirm & Release still succeeds when enqueueing fails or a vendor has no mailbox", async () => {
  await db.exec(`create function public.test_fail_outbox() returns trigger language plpgsql as $$ begin raise exception 'test_outbox_down'; end $$;
    create trigger test_fail_outbox before insert on public.vendor_order_notifications for each row execute function public.test_fail_outbox();`);
  try {
    const id = await place([[KETTLE, 1], [CABLE, 1]]);
    const result = await release(id);
    assert.deepEqual(result.map((r) => r.vendor_code), ["isolutions", "piyavey"]);
    assert.equal((await parts(id)).length, 2);
    assert.deepEqual(await notes(id), []);
  } finally {
    await db.exec(`drop trigger test_fail_outbox on public.vendor_order_notifications; drop function public.test_fail_outbox();`);
  }
  await db.query(`update public.vendors set notification_email = null where code = 'piyavey'`);
  try {
    const id = await place([[KETTLE, 1], [CABLE, 1]]);
    await release(id);
    assert.equal((await parts(id)).length, 2);
    assert.deepEqual((await notes(id)).map((r) => r.code), ["isolutions"]);
  } finally {
    await db.query(`update public.vendors set notification_email = 'isolutionspiyave@gmail.com' where code = 'piyavey'`);
  }
});

test("a failed release queues nothing (the outbox row is part of the release transaction)", async () => {
  const id = await place([[KETTLE, 1], [CABLE, 1]]);
  await db.exec(`create function public.test_fail_release() returns trigger language plpgsql as $$
      begin if (select count(*) from public.order_fulfilments where order_id = new.order_id) >= 1 then raise exception 'test_release_failure'; end if; return null; end $$;
    create trigger test_fail_release after insert on public.order_fulfilments for each row execute function public.test_fail_release();`);
  try {
    await assert.rejects(release(id), /test_release_failure/);
    assert.deepEqual(await parts(id), []);
    assert.deepEqual(await notes(id), []);
  } finally {
    await db.exec(`drop trigger test_fail_release on public.order_fulfilments; drop function public.test_fail_release();`);
  }
});

test("only an Admin session or the service role can read or work the outbox", async () => {
  await drain();
  const id = await place([[CABLE, 1]]);
  await release(id);
  for (const who of [isolStaff, piyaStaff, customerId]) {
    await assert.rejects(as("authenticated", who, () => all(`select * from public.admin_claim_vendor_notifications(5)`)), /catalog_admin_required/);
    await assert.rejects(as("authenticated", who, () => db.query(`select public.admin_complete_vendor_notification(gen_random_uuid(), gen_random_uuid(), true)`)), /catalog_admin_required/);
    assert.deepEqual(await as("authenticated", who, () => all(`select id from public.vendor_order_notifications`)), [], "RLS hides every row");
    await assert.rejects(as("authenticated", who, () => db.query(`update public.vendor_order_notifications set status = 'sent'`)), /permission denied/);
  }
  await assert.rejects(as("anon", null, () => all(`select * from public.admin_claim_vendor_notifications(5)`)), /permission denied/);
  await assert.rejects(as("anon", null, () => all(`select * from public.vendor_order_notifications`)), /permission denied/);
  assert.equal((await notes(id))[0].status, "pending", "nothing above changed the row");
  // The service role (a future scheduled worker) may claim; the Admin can read the status rows.
  const viaService = await as("service_role", null, () => all(`select * from public.admin_claim_vendor_notifications(50)`), "service_role");
  assert.ok(viaService.some((r) => r.recipient === "ordersisolution@gmail.com"));
  for (const r of viaService) await complete(r.id, r.lease_id, true);
  assert.equal((await as("authenticated", ownerId, () => all(`select status from public.vendor_order_notifications where order_id = $1`, [id])))[0].status, "sent");
});

test("rendering: strict payload, header-safe subject, escaped HTML, safe dashboard link", () => {
  assert.throws(() => parseNotificationPayload(null), /payload_invalid/);
  assert.throws(() => parseNotificationPayload({ order_number: "A", vendor_name: "V", items: [] }), /payload_items_missing/);
  assert.throws(() => parseNotificationPayload({ order_number: "A", vendor_name: "V", items: [{ title: "x", quantity: 0 }] }), /payload_item_invalid/);
  const email = renderVendorNotification({ recipient: "v@example.test", lease_id: "lease-1", payload: {
    order_number: "ISP-ORD-1\r\nBcc: evil@example.test", vendor_name: "Piyavey", released_at: "",
    items: [{ title: "<script>alert(1)</script>", sku: "GD1", variant: { color: "Black", storage: "256GB", junk: { x: 1 } }, quantity: 2 }],
  } });
  assert.ok(!/[\r\n]/.test(email.subject));
  assert.ok(!email.html.includes("<script>") && email.html.includes("&lt;script&gt;"));
  assert.ok(email.text.includes("1. <script>alert(1)</script>\n   SKU: GD1\n   Quantity: 2\n   Storage: 256GB\n   Colour: Black"));
  assert.ok(!email.text.includes("junk") && !email.html.includes("junk"), "unknown variant keys are never shown");
  assert.equal(email.idempotencyKey, "lease-1");
  assert.equal(staffDashboardUrl(undefined), "https://isolutionspakistan.com/staff");
  assert.equal(staffDashboardUrl("javascript:alert(1)"), "https://isolutionspakistan.com/staff");
  assert.equal(staffDashboardUrl("http://localhost:5173/"), "http://localhost:5173/staff");
});

test("product facts: readable labels, placeholders and raw codes hidden, nothing invented", () => {
  // Same shape as the DEV test order ISP-ORD-000009 snapshots.
  const phone = { title: "Realme C75x", sku: "MB313", quantity: 1, variant: {
    ram: "8 GB", storage: "128 GB", color: "Pink", ptaStatus: "approved", condition: "brand_new", warranty: "1 Year" } };
  const gadget = { title: "Tumbler Stopper", sku: "GD003", quantity: 1, variant: { ptaStatus: "unknown", condition: "unknown" } };
  assert.deepEqual(itemFacts(phone).map((f) => `${f.label}: ${f.value}`), [
    "SKU: MB313", "Quantity: 1", "RAM: 8 GB", "Storage: 128 GB", "Colour: Pink", "Condition: New", "PTA Status: Approved", "Warranty: 1 Year"]);
  assert.deepEqual(itemFacts(gadget).map((f) => `${f.label}: ${f.value}`), ["SKU: GD003", "Quantity: 1"]);
  assert.deepEqual(itemFacts({ title: "X", sku: "", quantity: 3, variant: null }), [{ label: "Quantity", value: "3" }]);
  const odd = itemFacts({ title: "X", sku: "unknown", quantity: 1, variant: {
    ram: "null", storage: " ", color: "space_black", ptaStatus: "not_applicable", condition: "mint", warranty: "N/A", extra: "Secret" } });
  assert.deepEqual(odd, [{ label: "Quantity", value: "1" }], "placeholders, raw codes, unmapped enums and unknown keys are omitted");
  assert.deepEqual(itemFacts({ title: "X", sku: "S1", quantity: 1, variant: { ptaStatus: "not_approved", condition: "open_box", ram: 12 } })
    .map((f) => f.value), ["S1", "1", "12", "Open Box", "Not Approved"]);

  for (const [item, vendor] of [[phone, "iSolutions Pakistan"], [gadget, "Piyavey"]]) {
    const email = renderVendorNotification({ recipient: "v@example.test", lease_id: "l", payload: {
      order_number: "ISP-ORD-000009", vendor_name: vendor, released_at: "", items: [item] } }, "https://isolutions-development-cb1ea.web.app");
    const body = `${email.text}\n${email.html}`;
    for (const raw of ["brand_new", "approved ", "unknown", "undefined", "null"]) assert.ok(!email.text.includes(raw), `text: no ${raw}`);
    assert.ok(!/>(brand_new|approved|unknown|null|undefined)</.test(email.html), "html: no raw codes");
    for (const part of ["New Order Assigned", "ISP-ORD-000009", vendor, item.title, item.sku, "Open Staff Dashboard",
      "https://isolutions-development-cb1ea.web.app/staff", "Automated notification from iSolutions Pakistan. Please do not reply."])
      assert.ok(body.includes(part), `includes ${part}`);
    assert.ok(email.html.includes("max-width:600px") && email.html.includes('name="viewport"'), "mobile-friendly single column");
    assert.ok(!/<img|<script|<link|@import|url\(/i.test(email.html), "no external images, scripts or fonts");
  }
});

test("Admin status helpers", () => {
  const base = { id: "n", fulfilment_id: "f", attempts: 0, next_attempt_at: new Date(0).toISOString(), last_error: null, sent_at: null };
  assert.equal(notificationLabel(undefined), null);
  assert.deepEqual(notificationLabel({ ...base, status: "pending" }), { tone: "wait", text: "Email queued" });
  assert.deepEqual(notificationLabel({ ...base, status: "pending", attempts: 2 }), { tone: "wait", text: "Email retrying (attempt 2 failed)" });
  assert.deepEqual(notificationLabel({ ...base, status: "sent", attempts: 1 }), { tone: "ok", text: "Email sent" });
  assert.deepEqual(notificationLabel({ ...base, status: "failed", attempts: 6 }), { tone: "error", text: "Email failed after 6 attempts" });
  assert.equal(hasDeliverableNotification([{ ...base, status: "sent" }]), false);
  assert.equal(hasDeliverableNotification([{ ...base, status: "pending", next_attempt_at: new Date(Date.now() + 60_000).toISOString() }]), false);
  assert.equal(hasDeliverableNotification([{ ...base, status: "pending" }]), true);
});

test("wiring: server-side only, no provider secrets in the browser, sending never blocks Confirm & Release", async () => {
  const fn = await readFile(new URL("../supabase/functions/vendor-order-notifications/index.ts", import.meta.url), "utf8");
  assert.ok(fn.includes("requireCatalogAdmin(request)"));
  assert.ok(fn.indexOf("configured: false") < fn.indexOf("admin_claim_vendor_notifications"), "unconfigured: returns before claiming");
  assert.ok(!/SERVICE_ROLE/.test(fn), "no service-role key");
  const admin = await readFile(new URL("../src/admin/AdminOrderVendors.tsx", import.meta.url), "utf8");
  const release = admin.slice(admin.indexOf("const confirmAndRelease"), admin.indexOf("const setPartStatus"));
  assert.ok(release.includes("admin_confirm_and_release_order") && !release.includes("functions.invoke"), "release does not wait for email");
  assert.ok(/try \{ await supabase\.functions\.invoke\(VENDOR_NOTIFICATION_FUNCTION/.test(admin), "delivery kick is best-effort");
  for (const file of ["../src/admin/AdminOrderVendors.tsx", "../src/lib/vendorNotifications.ts"]) {
    const source = await readFile(new URL(file, import.meta.url), "utf8");
    assert.ok(!/smtp|password|api[_-]?key|secret/i.test(source), `${file}: no provider credentials`);
  }
});
