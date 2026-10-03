// Storefront anti-abuse rate limits (202610020001) against the replayed migrations (never the
// live database), with hosted Supabase's default grants: create_storefront_order (5 per phone,
// 20 per IP), submit_contact_message and subscribe_newsletter (5 per email, 20 per IP), all per
// 15 minutes, enforced inside the database before anything is written.
import assert from "node:assert/strict";
import test from "node:test";
import { createCatalogTestDatabase, signInAsOwner } from "./support/catalogTestDatabase.mjs";
import { RATE_LIMIT_MESSAGE, isRateLimitError } from "../src/lib/rateLimit.ts";

const db = await createCatalogTestDatabase({ supabaseDefaultPrivileges: true });
await signInAsOwner(db);

const one = async (sql, params = []) => (await db.query(sql, params)).rows[0];
const all = async (sql, params = []) => (await db.query(sql, params)).rows;

await db.query(`select public.apply_catalog_bulk_import_v2($1::jsonb)`, [JSON.stringify({ products: [{
  action: "Create", source: "RL Cable", product_type: "Accessory", brand: "Samsung", title: "RL Cable", category: "Accessories",
  specifications: [], variants: [{
    source: "row", sku: null, ram: null, storage: null, color: "Black", price_minor: 100_000, compare_at_price_minor: null,
    stock: 500, pta_status: "not_applicable", condition: "brand_new", condition_grade: null, battery_health_percent: null,
    battery_cycle_count: null, sim_configuration: null, warranty: "1 Year", delivery_scope: "nationwide",
  }],
}] })]);
const { id: PRODUCT } = await one(`select id from public.products where title = 'RL Cable'`);
await db.query(`insert into public.product_media (product_id, cloudinary_public_id, cloudinary_asset_id, cloudinary_version,
    secure_url, width, height, bytes, format, alt_text, is_primary)
  values ($1, 'test/rl', 'test/rl', 1, 'https://res.cloudinary.com/test/image/upload/test/rl', 800, 800, 1000, 'jpg', 'RL Cable', true)`, [PRODUCT]);
await db.query(`update public.products set publication_status = 'published' where id = $1`, [PRODUCT]);
const { id: VARIANT } = await one(`select id from public.product_variants where product_id = $1`, [PRODUCT]);

// Every request runs as an anonymous storefront visitor. `ip` is either the address Cloudflare puts
// in cf-connecting-ip (the only trusted source) or a full request-headers object.
const headersFor = (ip) => (ip === null ? "" : JSON.stringify(typeof ip === "string" ? { "cf-connecting-ip": ip } : ip));
async function asVisitor(ip, run) {
  await db.exec(`set role anon`);
  await db.query(`select set_config('request.headers', $1, false)`, [headersFor(ip)]);
  try {
    return await run();
  } finally {
    await db.exec(`reset role`);
    await db.query(`select set_config('request.headers', '', false)`);
  }
}
const placeOrder = (phone, { ip = null, quantity = 1, city = "Karachi" } = {}) => asVisitor(ip, async () => (await db.query(
  `select * from public.create_storefront_order('RL Buyer', $1, null, $3, null, 'RL Address', null, null,
    'cash_on_delivery', 'standard', $2::jsonb)`, [phone, JSON.stringify([{ variant_id: VARIANT, quantity }]), city])).rows[0]);
const contact = (email, ip = null) => asVisitor(ip, async () =>
  (await one(`select public.submit_contact_message('RL Visitor', $1, null, 'Hello') as ok`, [email])).ok);
const subscribe = (email, ip = null) => asVisitor(ip, async () =>
  (await one(`select public.subscribe_newsletter($1, 'about_page') as status`, [email])).status);
const isRateLimited = (error) => /rate_limited/.test(error.message);

const stock = async () => Number((await one(`select public.current_inventory($1) as n`, [VARIANT])).n);
const sideEffects = async () => ({
  orders: Number((await one(`select count(*) as n from public.orders`)).n),
  items: Number((await one(`select count(*) as n from public.order_items`)).n),
  movements: Number((await one(`select count(*) as n from public.inventory_movements`)).n),
  stock: await stock(),
  events: Number((await one(`select count(*) as n from public.request_rate_limit_events`)).n),
});
const expireWindow = () => db.query(`update public.request_rate_limit_events set created_at = created_at - interval '16 minutes'`);

test("normal guest checkout: up to 5 orders per phone in 15 minutes are accepted", async () => {
  for (let i = 0; i < 5; i += 1) assert.ok((await placeOrder("03011111111")).order_number);
});

test("a burst from one phone is blocked on the 6th order, also in another phone format", async () => {
  for (let i = 0; i < 5; i += 1) await placeOrder("03022222222");
  await assert.rejects(placeOrder("03022222222"), isRateLimited);
  await assert.rejects(placeOrder("+92 302 2222222"), isRateLimited);
  await assert.rejects(placeOrder("0092-302-2222222"), isRateLimited);
});

test("a blocked order creates no order, items or inventory movement and leaves stock unchanged", async () => {
  for (let i = 0; i < 5; i += 1) await placeOrder("03033333333", { quantity: 2 });
  const before = await sideEffects();
  await assert.rejects(placeOrder("03033333333", { quantity: 2 }), isRateLimited);
  assert.deepEqual(await sideEffects(), before);
});

test("different phones and different IPs never block each other", async () => {
  for (let i = 0; i < 5; i += 1) await placeOrder("03044444444", { ip: "203.0.113.4" });
  await assert.rejects(placeOrder("03044444444", { ip: "203.0.113.4" }), isRateLimited);
  // Another customer on the same shared IP (carrier NAT) still checks out.
  assert.ok((await placeOrder("03044444445", { ip: "203.0.113.4" })).order_number);
  assert.ok((await placeOrder("03044444446", { ip: "198.51.100.9" })).order_number);
});

test("one IP is limited to 20 orders in 15 minutes even across different phones", async () => {
  for (let i = 0; i < 20; i += 1) await placeOrder(`0305${String(i).padStart(7, "0")}`, { ip: "203.0.113.20" });
  await assert.rejects(placeOrder("03059999999", { ip: "203.0.113.20" }), isRateLimited);
  assert.ok((await placeOrder("03059999999", { ip: "203.0.113.21" })).order_number);
});

test("spoofed x-forwarded-for cannot change the trusted IP identity", async () => {
  // Same Cloudflare IP, a different forged x-forwarded-for (and x-real-ip) on every request.
  const forged = (i) => ({ "cf-connecting-ip": "203.0.113.50", "x-forwarded-for": `10.9.${i}.1, 203.0.113.50`, "x-real-ip": `10.8.${i}.1` });
  for (let i = 0; i < 20; i += 1) await placeOrder(`0308${String(i).padStart(7, "0")}`, { ip: forged(i) });
  await assert.rejects(placeOrder("03089999999", { ip: forged(99) }), isRateLimited);
});

test("x-forwarded-for / x-real-ip without cf-connecting-ip give no IP limit; phone limit still applies", async () => {
  const untrusted = { "x-forwarded-for": "203.0.113.60", "x-real-ip": "203.0.113.60" };
  for (let i = 0; i < 25; i += 1) assert.ok((await placeOrder(`0309${String(i).padStart(7, "0")}`, { ip: untrusted })).order_number);
  for (let i = 0; i < 5; i += 1) await placeOrder("03091111111", { ip: untrusted });
  await assert.rejects(placeOrder("03091111111", { ip: untrusted }), isRateLimited);
});

test("a malformed cf-connecting-ip is ignored safely: no IP limit, phone limit still applies", async () => {
  const bad = ["not-an-ip", "999.1.1.1", "203.0.113.70/8", "203.0.113.70, 203.0.113.71", "fe80::1%eth0", ""];
  for (let i = 0; i < 24; i += 1)
    assert.ok((await placeOrder(`0310${String(i).padStart(7, "0")}`, { ip: { "cf-connecting-ip": bad[i % bad.length] } })).order_number);
  for (let i = 0; i < 5; i += 1) await placeOrder("03101111111", { ip: { "cf-connecting-ip": "garbage" } });
  await assert.rejects(placeOrder("03101111111", { ip: { "cf-connecting-ip": "garbage" } }), isRateLimited);
});

test("IPv6: addresses in one /64 share a limit; different /64 networks do not block each other", async () => {
  for (let i = 0; i < 20; i += 1) await placeOrder(`0311${String(i).padStart(7, "0")}`, { ip: `2001:db8:aa:1:${(i + 1).toString(16)}::${i + 7}` });
  await assert.rejects(placeOrder("03119999999", { ip: "2001:db8:aa:1:ffff:ffff:ffff:fffe" }), isRateLimited);
  assert.ok((await placeOrder("03119999999", { ip: "2001:db8:aa:2::1" })).order_number);
  assert.ok((await placeOrder("03119999998", { ip: "2001:db8:bb:1::1" })).order_number);
});

test("an order blocked by the IP limit also creates no order, items or movements and keeps stock", async () => {
  for (let i = 0; i < 20; i += 1) await placeOrder(`0312${String(i).padStart(7, "0")}`, { ip: "203.0.113.80", quantity: 2 });
  const before = await sideEffects();
  await assert.rejects(placeOrder("03129999999", { ip: "203.0.113.80", quantity: 2 }), isRateLimited);
  assert.deepEqual(await sideEffects(), before);
});

test("contact and newsletter identity limits still work when no trusted IP is present", async () => {
  for (let i = 0; i < 5; i += 1) await contact("no-ip@example.test", { "x-forwarded-for": `198.51.100.${i}` });
  await assert.rejects(contact("no-ip@example.test", { "x-forwarded-for": "198.51.100.99" }), isRateLimited);
  for (let i = 0; i < 5; i += 1) await subscribe("no-ip-reader@example.test", { "cf-connecting-ip": "bogus" });
  await assert.rejects(subscribe("no-ip-reader@example.test"), isRateLimited);
});

test("the window expires normally: after 15 minutes the same phone can order again", async () => {
  for (let i = 0; i < 5; i += 1) await placeOrder("03066666666");
  await assert.rejects(placeOrder("03066666666"), isRateLimited);
  await expireWindow();
  assert.ok((await placeOrder("03066666666")).order_number);
});

test("orders rejected after the rate check (e.g. invalid city) roll back and do not use up the quota", async () => {
  const before = await sideEffects();
  for (let i = 0; i < 6; i += 1) await assert.rejects(placeOrder("03077777777", { city: "Lahore" }), /delivery_city_invalid/);
  assert.deepEqual(await sideEffects(), before);
  for (let i = 0; i < 5; i += 1) assert.ok((await placeOrder("03077777777")).order_number);
});

test("contact form: 5 messages per email in 15 minutes, then blocked with nothing stored; other emails unaffected", async () => {
  for (let i = 0; i < 5; i += 1) assert.equal(await contact("visitor@example.test"), true);
  const before = Number((await one(`select count(*) as n from public.contact_messages`)).n);
  await assert.rejects(contact("Visitor@Example.test"), isRateLimited);
  assert.equal(Number((await one(`select count(*) as n from public.contact_messages`)).n), before);
  assert.equal(await contact("someone-else@example.test"), true);
  await expireWindow();
  assert.equal(await contact("visitor@example.test"), true);
});

test("contact form: one IP is limited to 20 messages in 15 minutes", async () => {
  for (let i = 0; i < 20; i += 1) await contact(`ip-contact-${i}@example.test`, "203.0.113.30");
  await assert.rejects(contact("ip-contact-x@example.test", "203.0.113.30"), isRateLimited);
  assert.equal(await contact("ip-contact-x@example.test", "203.0.113.31"), true);
});

test("newsletter: 5 requests per email in 15 minutes, then blocked; other emails unaffected", async () => {
  assert.equal(await subscribe("reader@example.test"), "subscribed");
  for (let i = 0; i < 4; i += 1) assert.equal(await subscribe("reader@example.test"), "already_subscribed");
  await assert.rejects(subscribe("READER@example.test"), isRateLimited);
  assert.equal(await subscribe("other-reader@example.test"), "subscribed");
  await expireWindow();
  assert.equal(await subscribe("reader@example.test"), "already_subscribed");
});

test("newsletter: one IP is limited to 20 requests in 15 minutes", async () => {
  for (let i = 0; i < 20; i += 1) await subscribe(`ip-reader-${i}@example.test`, "203.0.113.40");
  await assert.rejects(subscribe("ip-reader-x@example.test", "203.0.113.40"), isRateLimited);
  assert.equal(await subscribe("ip-reader-x@example.test", "203.0.113.41"), "subscribed");
});

test("privacy: only peppered hashes are stored; the log, pepper and helpers are closed to API roles", async () => {
  const rows = await all(`select scope, identity_hash from public.request_rate_limit_events`);
  assert.ok(rows.length > 0);
  for (const row of rows) assert.match(row.identity_hash, /^[0-9a-f]{64}$/);
  const stored = JSON.stringify(rows);
  // Raw phones are excluded by the 64-hex check above; digit-only probes would randomly match hex hashes.
  for (const raw of ["example.test", "203.0.113", "visitor", "reader"]) assert.ok(!stored.includes(raw), raw);
  // Not the plain sha256 of the identity either (the pepper is mixed in).
  const plain = (await one(`select encode(sha256(convert_to('03011111111', 'UTF8')), 'hex') as h`)).h;
  assert.ok(!rows.some((row) => row.identity_hash === plain));

  for (const role of ["anon", "authenticated"]) {
    await db.exec(`set role ${role}`);
    try {
      for (const table of ["request_rate_limit_events", "request_rate_limit_secret"])
        await assert.rejects(db.query(`select * from public.${table}`), /permission denied/, `${role} ${table}`);
      await assert.rejects(db.query(`select public.enforce_request_rate_limit('order_phone', 'x', 1000, interval '1 second')`), /permission denied/);
      await assert.rejects(db.query(`select public.request_client_ip()`), /permission denied/);
      await assert.rejects(db.query(`select public.normalize_rate_limit_phone('0300')`), /permission denied/);
    } finally {
      await db.exec(`reset role`);
    }
  }
});

test("storefront copy: rate-limit errors map to one friendly message", () => {
  assert.equal(isRateLimitError({ message: "rate_limited" }), true);
  assert.equal(isRateLimitError(new Error("variant_out_of_stock")), false);
  assert.equal(isRateLimitError(null), false);
  assert.match(RATE_LIMIT_MESSAGE, /wait a few minutes/);
});
