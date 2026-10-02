// Checkout + Orders backend verification against the replayed migrations (never the live
// database): create_storefront_order validation, COD / Bank Transfer, delivery eligibility,
// shipping fees, totals and snapshots, stock decrement / cancel restore (202610010002), phone and
// quantity limits, Admin Orders access, status updates and RLS for anonymous, signed-in
// non-admin and admin sessions.
import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { createCatalogTestDatabase, signInAsOwner } from "./support/catalogTestDatabase.mjs";
import {
  CANCELLED_ORDER_FINAL_MESSAGE,
  MAX_ORDER_LINE_QUANTITY,
  ORDER_STATUS_NOT_SAVED_MESSAGE,
  PHONE_VALIDATION_MESSAGE,
  canChangeOrderStatus,
  cartLineLimit,
  isValidOrderPhone,
  verifyOrderStatusUpdate,
} from "../src/lib/orderRules.ts";

const db = await createCatalogTestDatabase();
const ownerId = await signInAsOwner(db);
// Supabase grants schema usage to these roles by default; the replay prelude does not.
await db.exec(`grant usage on schema public to anon, authenticated;`);

const one = async (sql, params = []) => (await db.query(sql, params)).rows[0];
const all = async (sql, params = []) => (await db.query(sql, params)).rows;

// --- Catalog fixtures: created as drafts by the real import, then published like Admin does.
const variant = (overrides = {}) => ({
  source: "row", sku: null, ram: null, storage: null, color: "Black",
  price_minor: 100_000, compare_at_price_minor: null, stock: 10,
  pta_status: "not_applicable", condition: "brand_new", condition_grade: null,
  battery_health_percent: null, battery_cycle_count: null, sim_configuration: null,
  warranty: "1 Year", delivery_scope: "nationwide", ...overrides,
});
const product = (title, overrides = {}) => ({
  action: "Create", source: title, product_type: "Accessory", brand: "Samsung", title,
  category: "Accessories", specifications: [], variants: [variant()], ...overrides,
});
await db.query(`select public.apply_catalog_bulk_import_v2($1::jsonb)`, [JSON.stringify({ products: [
  product("TEST Phone", { product_type: "Mobile Phone", category: "Mobile Phones", variants: [
    variant({ ram: "8 GB", storage: "256 GB", price_minor: 5_000_000, pta_status: "approved", delivery_scope: "karachi_only", stock: 50 }),
  ] }),
  product("TEST MacBook Neo", { product_type: "Laptop", brand: "Apple", category: "Laptops", variants: [
    variant({ ram: "16 GB", storage: "512 GB", price_minor: 30_000_000, delivery_scope: "karachi_only" }),
  ] }),
  product("TEST Charger", { variants: [variant({ price_minor: 999_900 })] }),
  product("TEST Cable", { variants: [variant({ price_minor: 100 })] }),
  product("TEST Band", { product_type: "Gadget", category: null, variants: [variant({ price_minor: 250_000 })] }),
  product("TEST Draft Case"),
  // Stock fixtures for the decrement / restore tests.
  product("TEST Last Unit", { variants: [variant({ price_minor: 150_000, stock: 1 })] }),
  product("TEST Pair", { variants: [variant({ price_minor: 120_000, stock: 2 })] }),
  product("TEST Bulk Cable", { variants: [variant({ price_minor: 50_000, stock: 25 })] }),
  product("TEST Cancel Phone", { product_type: "Mobile Phone", category: "Mobile Phones", variants: [
    variant({ ram: "8 GB", storage: "128 GB", price_minor: 3_000_000, pta_status: "approved", delivery_scope: "karachi_only", stock: 5 }),
  ] }),
] })]);

let media = 0;
async function publish(title) {
  const { id } = await one(`select id from public.products where title = $1`, [title]);
  media += 1;
  await db.query(`insert into public.product_media (product_id, cloudinary_public_id, cloudinary_asset_id, cloudinary_version,
      secure_url, width, height, bytes, format, alt_text, is_primary)
    values ($1, $2, $2, 1, 'https://res.cloudinary.com/test/image/upload/' || $2, 800, 800, 1000, 'jpg', $3, true)`,
  [id, `test/media-${media}`, title]);
  await db.query(`update public.products set publication_status = 'published' where id = $1`, [id]);
}
for (const title of ["TEST Phone", "TEST MacBook Neo", "TEST Charger", "TEST Cable", "TEST Band",
  "TEST Last Unit", "TEST Pair", "TEST Bulk Cable", "TEST Cancel Phone"]) await publish(title);

const variantOf = async (title) =>
  (await one(`select v.id from public.product_variants v join public.products p on p.id = v.product_id where p.title = $1`, [title])).id;
const PHONE = await variantOf("TEST Phone");
const NEO = await variantOf("TEST MacBook Neo");
const CHARGER = await variantOf("TEST Charger"); // Rs 9,999
const CABLE = await variantOf("TEST Cable"); // Rs 1
const BAND = await variantOf("TEST Band"); // Rs 2,500
const DRAFT = await variantOf("TEST Draft Case");
const LAST = await variantOf("TEST Last Unit"); // stock 1
const PAIR = await variantOf("TEST Pair"); // stock 2
const BULK = await variantOf("TEST Bulk Cable"); // stock 25
const CANCEL_PHONE = await variantOf("TEST Cancel Phone"); // stock 5
const stockOf = async (variantId) => Number((await one(`select public.current_inventory($1) as n`, [variantId])).n);

// --- Sessions: anon (storefront visitor), customer (signed-in non-admin), owner (Admin Orders).
const { id: customerId } = await one(`insert into auth.users (email) values ('customer@example.test') returning id`);
async function as(role, userId, run) {
  await db.exec(`set role ${role}`);
  await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [userId ?? ""]);
  try {
    return await run();
  } finally {
    await db.exec(`reset role`);
    await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [ownerId]);
  }
}

// Each order gets its own phone so the per-phone rate limit (202610020001) never interferes with
// these checks; rate limiting itself is covered by storefrontRateLimit.test.mjs.
let phoneSequence = 0;
const order = (overrides = {}) => ({
  name: "TEST Customer", phone: `0300${String(++phoneSequence).padStart(7, "0")}`, email: "test@example.test", city: "Karachi", otherCity: null,
  address: "TEST Address, Block 1", landmark: null, notes: "TEST order", payment: "cash_on_delivery",
  shipping: "standard", items: [{ variant_id: PHONE, quantity: 1 }], ...overrides,
});
// Placed as an anonymous storefront visitor, exactly like the checkout page.
const place = (overrides = {}) => {
  const o = order(overrides);
  return as("anon", null, async () => (await db.query(
    `select * from public.create_storefront_order($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb)`,
    [o.name, o.phone, o.email, o.city, o.otherCity, o.address, o.landmark, o.notes, o.payment, o.shipping, JSON.stringify(o.items)],
  )).rows[0]);
};
const rejects = (overrides, code) => assert.rejects(place(overrides), new RegExp(code));
const fee = (row) => [Number(row.subtotal_minor), Number(row.delivery_fee_minor), Number(row.shipping_surcharge_minor), Number(row.total_minor)];

test("valid Karachi COD order: server price, Karachi-only classification, free standard delivery, item snapshot", async () => {
  const row = await place({ items: [{ variant_id: PHONE, quantity: 2 }] });
  assert.match(row.order_number, /^ISP-ORD-\d{6}$/);
  assert.equal(row.payment_method, "cash_on_delivery");
  assert.deepEqual(fee(row), [10_000_000, 0, 0, 10_000_000]);
  const stored = await one(`select * from public.orders where id = $1`, [row.order_id]);
  assert.deepEqual([stored.status, stored.city, stored.other_city, stored.delivery_classification, stored.shipping_method],
    ["new", "Karachi", null, "karachi_only", "standard"]);
  const [item] = await all(`select * from public.order_items where order_id = $1`, [row.order_id]);
  assert.deepEqual([item.product_title_snapshot, item.quantity, Number(item.unit_price_minor), Number(item.line_total_minor), item.delivery_scope_snapshot],
    ["TEST Phone", 2, 5_000_000, 10_000_000, "karachi_only"]);
  assert.match(item.sku_snapshot, /^MB\d{3}$/);
  assert.deepEqual(item.variant_attributes_snapshot, { ram: "8 GB", storage: "256 GB", color: "Black", ptaStatus: "approved", condition: "brand_new", warranty: "1 Year" });
  assert.ok(item.image_url_snapshot.startsWith("https://res.cloudinary.com/"));
});

test("valid Karachi Bank Transfer order with Fast delivery", async () => {
  const row = await place({ payment: "bank_transfer", shipping: "fast" });
  assert.equal(row.payment_method, "bank_transfer");
  assert.equal(row.shipping_method, "fast");
  assert.deepEqual(fee(row), [5_000_000, 20_000, 20_000, 5_020_000]);
});

test("Karachi-only items (mobile phone, MacBook Neo) are blocked outside Karachi", async () => {
  await rejects({ city: "Other city in Pakistan", otherCity: "Lahore" }, "karachi_delivery_required");
  await rejects({ city: "Other city in Pakistan", otherCity: "Lahore", items: [{ variant_id: NEO, quantity: 1 }] }, "karachi_delivery_required");
});

test("mixed cart with a mobile phone: blocked outside Karachi, allowed in Karachi as 'mixed'", async () => {
  const items = [{ variant_id: PHONE, quantity: 1 }, { variant_id: BAND, quantity: 1 }];
  await rejects({ city: "Other city in Pakistan", otherCity: "Multan", items }, "karachi_delivery_required");
  const row = await place({ items });
  assert.equal((await one(`select delivery_classification from public.orders where id = $1`, [row.order_id])).delivery_classification, "mixed");
  assert.deepEqual(fee(row), [5_250_000, 0, 0, 5_250_000]);
});

test("nationwide accessory / gadget order works outside Karachi and stores the city", async () => {
  const row = await place({ city: "Other city in Pakistan", otherCity: " Peshawar ", items: [{ variant_id: BAND, quantity: 1 }, { variant_id: CABLE, quantity: 2 }] });
  const stored = await one(`select city, other_city, delivery_classification from public.orders where id = $1`, [row.order_id]);
  assert.deepEqual([stored.city, stored.other_city, stored.delivery_classification], ["Other city in Pakistan", "Peshawar", "nationwide"]);
  assert.deepEqual(fee(row), [250_200, 20_000, 0, 270_200]);
  await rejects({ city: "Other city in Pakistan", otherCity: "  ", items: [{ variant_id: BAND, quantity: 1 }] }, "other_city_required");
  await rejects({ city: "Lahore", items: [{ variant_id: BAND, quantity: 1 }] }, "delivery_city_invalid");
});

test("shipping fees are exact around the Rs 10,000 threshold", async () => {
  const at = (items, shipping) => place({ items, shipping }).then(fee);
  const below = [{ variant_id: CHARGER, quantity: 1 }]; // Rs 9,999
  const exact = [{ variant_id: CHARGER, quantity: 1 }, { variant_id: CABLE, quantity: 1 }]; // Rs 10,000
  assert.deepEqual(await at(below, "standard"), [999_900, 20_000, 0, 1_019_900]); // Rs 200
  assert.deepEqual(await at(below, "fast"), [999_900, 40_000, 20_000, 1_039_900]); // Rs 400
  assert.deepEqual(await at(exact, "standard"), [1_000_000, 0, 0, 1_000_000]); // FREE
  assert.deepEqual(await at(exact, "fast"), [1_000_000, 20_000, 20_000, 1_020_000]); // Rs 200
});

test("every stored order total equals its line items plus delivery fee", async () => {
  const mismatches = await all(`select o.order_number from public.orders o
    join lateral (select sum(line_total_minor) as lines, bool_and(line_total_minor = unit_price_minor * quantity) as ok
                  from public.order_items i where i.order_id = o.id) i on true
    where o.subtotal_minor <> i.lines or o.total_minor <> o.subtotal_minor + o.delivery_fee_minor or not i.ok`);
  assert.deepEqual(mismatches, []);
  assert.equal((await one(`select count(*)::int as n from public.orders`)).n, 8); // every order placed above
});

test("checkout validation rejects bad input and writes nothing", async () => {
  const before = (await one(`select count(*)::int as n from public.orders`)).n;
  await rejects({ name: "  " }, "customer_name_required");
  await rejects({ phone: "" }, "phone_required");
  await rejects({ email: "not-an-email" }, "email_invalid");
  await rejects({ address: " " }, "delivery_address_required");
  await rejects({ payment: "card" }, "payment_method_unsupported");
  await rejects({ payment: "installments" }, "payment_method_unsupported");
  await rejects({ shipping: "express" }, "shipping_method_unsupported");
  await rejects({ items: [] }, "order_items_invalid");
  await rejects({ items: [{ variant_id: PHONE, quantity: 0 }] }, "order_item_quantity_invalid");
  await rejects({ items: [{ variant_id: PHONE, quantity: 21 }] }, "order_item_quantity_invalid");
  await rejects({ items: [{ variant_id: PHONE, quantity: 1 }, { variant_id: PHONE, quantity: 1 }] }, "order_item_duplicate_variant");
  await rejects({ items: [{ variant_id: DRAFT, quantity: 1 }] }, "variant_not_orderable");
  await rejects({ items: [{ variant_id: "00000000-0000-0000-0000-000000000000", quantity: 1 }] }, "variant_not_orderable");
  assert.equal((await one(`select count(*)::int as n from public.orders`)).n, before);
});

test("hidden (inactive) variants are not orderable", async () => {
  await db.query(`update public.product_variants set is_active = false where id = $1`, [CABLE]);
  await rejects({ items: [{ variant_id: CABLE, quantity: 1 }] }, "variant_not_orderable");
  await db.query(`update public.product_variants set is_active = true where id = $1`, [CABLE]);
});

test("Admin Orders: admin sees orders + items with the exact Admin query and status updates persist", async () => {
  const placed = await place({ payment: "bank_transfer" });
  await as("authenticated", ownerId, async () => {
    const rows = await all(`select id,order_number,customer_name,phone,email,city,other_city,full_delivery_address,area_landmark,order_notes,
        payment_method,shipping_method,shipping_surcharge_minor,delivery_classification,subtotal_minor,delivery_fee_minor,total_minor,status,created_at
      from public.orders order by created_at desc`);
    assert.ok(rows.some((row) => row.id === placed.order_id && row.customer_name === "TEST Customer"));
    const items = await all(`select id,product_title_snapshot,sku_snapshot,variant_attributes_snapshot,quantity,unit_price_minor,line_total_minor,
        delivery_scope_snapshot,image_url_snapshot from public.order_items where order_id = $1`, [placed.order_id]);
    assert.equal(items.length, 1);
    await assert.rejects(db.query(`update public.orders set status = 'shipped' where id = $1`, [placed.order_id]), /orders_status_check/);
    for (const status of ["confirmed", "processing", "completed", "cancelled"]) {
      const updated = await all(`update public.orders set status = $1 where id = $2 returning status`, [status, placed.order_id]);
      assert.deepEqual(updated.map((row) => row.status), [status]);
    }
  });
  assert.equal((await one(`select status from public.orders where id = $1`, [placed.order_id])).status, "cancelled");
});

test("RLS: anonymous visitors and signed-in customers cannot read or change orders", async () => {
  const placed = await place();
  await as("anon", null, async () => {
    await assert.rejects(db.query(`select * from public.orders`), /permission denied/);
    await assert.rejects(db.query(`select * from public.order_items`), /permission denied/);
    await assert.rejects(db.query(`update public.orders set status = 'cancelled'`), /permission denied/);
    await assert.rejects(db.query(`insert into public.orders (order_number, customer_name, phone, city, full_delivery_address, payment_method,
      delivery_classification, subtotal_minor, total_minor) values ('X', 'X', '000', 'Karachi', 'X', 'cash_on_delivery', 'nationwide', 0, 0)`), /permission denied/);
  });
  await as("authenticated", customerId, async () => {
    assert.deepEqual(await all(`select id from public.orders`), []);
    assert.deepEqual(await all(`select id from public.order_items`), []);
    assert.deepEqual(await all(`update public.orders set status = 'cancelled' where id = $1 returning id`, [placed.order_id]), []);
    await assert.rejects(db.query(`delete from public.orders where id = $1`, [placed.order_id]), /permission denied/);
    await assert.rejects(db.query(`insert into public.order_items (order_id, product_id, variant_id, product_title_snapshot, sku_snapshot,
      quantity, unit_price_minor, line_total_minor, delivery_scope_snapshot)
      select $1, product_id, id, 'X', 'X', 1, 0, 0, 'nationwide' from public.product_variants limit 1`, [placed.order_id]), /permission denied/);
  });
  assert.equal((await one(`select status from public.orders where id = $1`, [placed.order_id])).status, "new");
});

test("checkout delivery scopes: looked up per cart product by slug, never from a capped catalog page", async () => {
  const storefront = await readFile(new URL("../src/StorefrontApp.tsx", import.meta.url), "utf8");
  const checkout = storefront.slice(storefront.indexOf("function CheckoutPage"), storefront.indexOf("const placeOrder"));
  assert.match(checkout, /fetchPublicCatalog\(\{ slug, limit: 1 \}\)/);
  assert.doesNotMatch(checkout, /fetchPublicCatalog\(\{ limit: 100 \}\)/);
  // The public catalog search caps a page at 100 products, so a single page cannot cover the catalog.
  const capped = await as("anon", null, () => all(`select slug from public.search_public_catalog(p_limit => 500)`));
  assert.ok(capped.length <= 100);
  // A slug lookup returns that product's variant delivery scopes (what checkout needs).
  const [phone] = await as("anon", null, () => all(`select variants from public.search_public_catalog(p_slug => (select slug from public.products where title = 'TEST Phone'), p_limit => 1)`));
  assert.deepEqual(phone.variants.map((item) => [item.id, item.deliveryScope]), [[PHONE, "karachi_only"]]);
});

// ---------------------------------------------------------------------------
// Stock decrement / cancel restore (202610010002)
// ---------------------------------------------------------------------------

const movementsFor = (orderId) => all(`select variant_id, quantity_delta, reason::text, note from public.inventory_movements
  where reference = $1 order by id`, [`order:${orderId}`]);
const setStatus = (orderId, status) => as("authenticated", ownerId, () =>
  all(`update public.orders set status = $1 where id = $2 returning id, status, stock_restored_at`, [status, orderId]));

test("normal decrement: COD and Bank Transfer orders take stock with one 'sale' movement per line", async () => {
  const before = await stockOf(BULK);
  const cod = await place({ city: "Other city in Pakistan", otherCity: "Lahore", items: [{ variant_id: BULK, quantity: 2 }] });
  const bank = await place({ payment: "bank_transfer", items: [{ variant_id: BULK, quantity: 1 }] });
  assert.equal(await stockOf(BULK), before - 3);
  const [codMove] = await movementsFor(cod.order_id);
  assert.deepEqual([codMove.variant_id, codMove.quantity_delta, codMove.reason, codMove.note],
    [BULK, -2, "sale", `Storefront order ${cod.order_number}`]);
  assert.deepEqual((await movementsFor(bank.order_id)).map((row) => [row.quantity_delta, row.reason]), [[-1, "sale"]]);
});

test("multi-item order decrements every line exactly once", async () => {
  const [phone, band, bulk] = [await stockOf(PHONE), await stockOf(BAND), await stockOf(BULK)];
  const row = await place({ items: [{ variant_id: PHONE, quantity: 2 }, { variant_id: BAND, quantity: 3 }, { variant_id: BULK, quantity: 1 }] });
  assert.deepEqual([await stockOf(PHONE), await stockOf(BAND), await stockOf(BULK)], [phone - 2, band - 3, bulk - 1]);
  assert.deepEqual((await movementsFor(row.order_id)).map((move) => [move.variant_id, move.quantity_delta]).sort(),
    [[PHONE, -2], [BAND, -3], [BULK, -1]].sort());
});

test("insufficient stock on any line fails the whole order: no order, items or stock changes", async () => {
  const counts = async () => one(`select (select count(*) from public.orders)::int as orders,
    (select count(*) from public.order_items)::int as items, (select count(*) from public.inventory_movements)::int as moves`);
  const before = await counts();
  const [pair, band] = [await stockOf(PAIR), await stockOf(BAND)];
  await rejects({ items: [{ variant_id: BAND, quantity: 1 }, { variant_id: PAIR, quantity: 3 }] }, "variant_out_of_stock");
  assert.deepEqual(await counts(), before);
  assert.deepEqual([await stockOf(PAIR), await stockOf(BAND)], [pair, band]);
});

test("two orders competing for the last unit: one succeeds, the other is rejected; stock never below zero", async () => {
  assert.equal(await stockOf(LAST), 1);
  const results = await Promise.allSettled([
    place({ items: [{ variant_id: LAST, quantity: 1 }] }),
    place({ payment: "bank_transfer", items: [{ variant_id: LAST, quantity: 1 }] }),
  ]);
  assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
  assert.match(String(results.find((result) => result.status === "rejected").reason), /variant_out_of_stock/);
  assert.equal(await stockOf(LAST), 0);
  await rejects({ items: [{ variant_id: LAST, quantity: 1 }] }, "variant_out_of_stock");
  // PGlite runs one connection, so the calls above are serialised; the row lock that queues
  // genuinely concurrent orders on Supabase is asserted on the function itself.
  const { prosrc } = await one(`select prosrc from pg_proc where proname = 'create_storefront_order'`);
  assert.match(prosrc, /from public\.product_variants v\s+where v\.id in \([^;]*\)\s+order by v\.id\s+for update;/);
  assert.ok(prosrc.indexOf("for update;") < prosrc.indexOf("quantity_on_hand < v_line.quantity"), "lock is taken before the stock check");
});

test("cancel restores stock exactly once; repeated / later cancellations never restore twice", async () => {
  const start = await stockOf(CANCEL_PHONE);
  const row = await place({ items: [{ variant_id: CANCEL_PHONE, quantity: 2 }] });
  assert.equal(await stockOf(CANCEL_PHONE), start - 2);
  const [cancelled] = await setStatus(row.order_id, "cancelled");
  assert.ok(cancelled.stock_restored_at);
  assert.equal(await stockOf(CANCEL_PHONE), start);
  const moves = await movementsFor(row.order_id);
  assert.deepEqual(moves.map((move) => [move.quantity_delta, move.reason]), [[-2, "sale"], [2, "return"]]);
  assert.equal(moves[1].note, `Order cancelled: ${row.order_number}`);
  // Cancelled -> Cancelled again is harmless: no second restore.
  const [again] = await setStatus(row.order_id, "cancelled");
  assert.deepEqual([again.status, String(again.stock_restored_at)], ["cancelled", String(cancelled.stock_restored_at)]);
  assert.equal(await stockOf(CANCEL_PHONE), start);
  assert.equal((await movementsFor(row.order_id)).length, 2);
  // stock_restored_at cannot be cleared to re-trigger a restore.
  await as("authenticated", ownerId, () => db.query(`update public.orders set stock_restored_at = null where id = $1`, [row.order_id]));
  await setStatus(row.order_id, "cancelled");
  assert.equal(await stockOf(CANCEL_PHONE), start);
  assert.equal((await movementsFor(row.order_id)).length, 2);
  // A second 'return' for the same order and variant is impossible even outside the trigger.
  await assert.rejects(db.query(`insert into public.inventory_movements (variant_id, quantity_delta, reason, reference)
    values ($1, 2, 'return', $2)`, [CANCEL_PHONE, `order:${row.order_id}`]), /inventory_movements_order_return_once/);
});

test("non-cancel statuses never change stock", async () => {
  const row = await place({ items: [{ variant_id: CANCEL_PHONE, quantity: 1 }] });
  const after = await stockOf(CANCEL_PHONE);
  for (const status of ["confirmed", "processing", "completed", "new", "processing"]) {
    await setStatus(row.order_id, status);
    assert.equal(await stockOf(CANCEL_PHONE), after, status);
  }
  assert.equal((await movementsFor(row.order_id)).length, 1);
});

test("an order created before stock decrement existed restores nothing when cancelled", async () => {
  const before = await stockOf(BAND);
  const { id } = await one(`insert into public.orders (order_number, customer_name, phone, city, full_delivery_address, payment_method,
      delivery_classification, subtotal_minor, delivery_fee_minor, total_minor)
    values ('ISP-ORD-LEGACY', 'TEST Legacy', '03000000000', 'Karachi', 'TEST', 'cash_on_delivery', 'nationwide', 250000, 20000, 270000)
    returning id`);
  await db.query(`insert into public.order_items (order_id, product_id, variant_id, product_title_snapshot, sku_snapshot, quantity,
      unit_price_minor, line_total_minor, delivery_scope_snapshot)
    select $1, product_id, id, 'TEST Band', sku, 1, 250000, 250000, 'nationwide' from public.product_variants where id = $2`, [id, BAND]);
  const [row] = await setStatus(id, "cancelled");
  assert.ok(row.stock_restored_at);
  assert.equal(await stockOf(BAND), before);
});

test("max quantity 20 per line: 20 is accepted, 21 rejected", async () => {
  const before = await stockOf(BULK);
  assert.ok(before >= 20);
  await place({ items: [{ variant_id: BULK, quantity: 20 }] });
  assert.equal(await stockOf(BULK), before - 20);
  await rejects({ items: [{ variant_id: BULK, quantity: 21 }] }, "order_item_quantity_invalid");
});

test("phone validation: clear server error for invalid or too-short numbers; valid formats accepted", async () => {
  for (const phone of ["12", "0300123", "abc1234567890", "0300-123-4567x", "1234567890123456"])
    await rejects({ phone }, "phone_invalid");
  await rejects({ phone: "   " }, "phone_required");
  for (const phone of ["03001234567", "+92 300 1234567", "(0300) 123-4567"])
    assert.ok((await place({ phone, items: [{ variant_id: BAND, quantity: 1 }] })).order_number);
  for (const phone of ["12", "0300123", "abc1234567890", "1234567890123456"]) assert.equal(isValidOrderPhone(phone), false, phone);
  for (const phone of ["03001234567", "+92 300 1234567", "(0300) 123-4567"]) assert.equal(isValidOrderPhone(phone), true, phone);
  assert.match(PHONE_VALIDATION_MESSAGE, /10–15 digits/);
});

test("Admin status update is confirmed only when the database returns the updated row", async () => {
  const row = await place({ items: [{ variant_id: BAND, quantity: 1 }] });
  const update = (userId) => as("authenticated", userId, async () => ({
    data: await all(`update public.orders set status = 'confirmed' where id = $1 returning id, status`, [row.order_id]),
    error: null,
  }));
  // Signed-in non-admin: RLS matches zero rows without an error -> not reported as saved.
  assert.equal(verifyOrderStatusUpdate(await update(customerId), row.order_id, "confirmed"), ORDER_STATUS_NOT_SAVED_MESSAGE);
  assert.equal((await one(`select status from public.orders where id = $1`, [row.order_id])).status, "new");
  // Admin: the returned row confirms the save.
  assert.equal(verifyOrderStatusUpdate(await update(ownerId), row.order_id, "confirmed"), null);
  assert.equal(verifyOrderStatusUpdate({ data: null, error: { message: "boom" } }, row.order_id, "confirmed"), "boom");
  assert.equal(verifyOrderStatusUpdate({ data: [{ id: row.order_id, status: "new" }], error: null }, row.order_id, "confirmed"), ORDER_STATUS_NOT_SAVED_MESSAGE);
  const admin = await readFile(new URL("../src/admin/AdminOrders.tsx", import.meta.url), "utf8");
  assert.match(admin, /\.update\(\{ status \}\)\.eq\("id", selected\.id\)\.select\("id,status"\)/);
  assert.match(admin, /verifyOrderStatusUpdate\(result, selected\.id, status\)/);
});

test("cart never holds more than 20 of one variant, even with more stock", async () => {
  const store = new Map();
  globalThis.localStorage = { getItem: (key) => store.get(key) ?? null, setItem: (key, value) => store.set(key, value), removeItem: (key) => store.delete(key) };
  globalThis.window = { dispatchEvent: () => true };
  const cart = await import("../src/lib/cart.ts");
  const item = { productId: "p", productSlug: "p", productTitle: "TEST", variantId: "v", sku: "AC001", quantity: 15, priceMinor: 100, imageUrl: null };
  assert.equal(cart.addStorefrontCartItem(item, 50), 15);
  assert.equal(cart.addStorefrontCartItem(item, 50), MAX_ORDER_LINE_QUANTITY);
  assert.equal(cart.addStorefrontCartItem({ ...item, quantity: 1 }, 50), 20);
  assert.equal(cart.addStorefrontCartItem({ ...item, variantId: "low" }, 3), 3); // stock still limits
  store.set("isolutions-storefront-cart", JSON.stringify([{ ...item, quantity: 35 }])); // saved before the cap
  assert.equal(cart.storefrontCartItemQuantity("v"), 20);
  assert.equal(cartLineLimit(7), 7);
  assert.equal(cartLineLimit(500), 20);
});

test("Cancelled is terminal: every other status is rejected at the database; Cancelled -> Cancelled is harmless", async () => {
  const start = await stockOf(CANCEL_PHONE);
  const row = await place({ payment: "bank_transfer", items: [{ variant_id: CANCEL_PHONE, quantity: 1 }] });
  await setStatus(row.order_id, "cancelled");
  assert.equal(await stockOf(CANCEL_PHONE), start);
  for (const status of ["new", "confirmed", "processing", "completed"])
    await assert.rejects(setStatus(row.order_id, status), /order_cancelled_is_final/, status);
  // Even outside the Admin session (no RLS), the rule holds.
  await assert.rejects(db.query(`update public.orders set status = 'confirmed' where id = $1`, [row.order_id]), /order_cancelled_is_final/);
  assert.deepEqual((await setStatus(row.order_id, "cancelled")).map((order) => order.status), ["cancelled"]);
  assert.equal((await one(`select status from public.orders where id = $1`, [row.order_id])).status, "cancelled");
  // Stock was restored exactly once across all of the above.
  assert.equal(await stockOf(CANCEL_PHONE), start);
  assert.deepEqual((await movementsFor(row.order_id)).map((move) => [move.quantity_delta, move.reason]), [[-1, "sale"], [1, "return"]]);
  // Admin UI: clear message for the database error, and the status control is locked.
  assert.equal(verifyOrderStatusUpdate({ data: null, error: { message: "order_cancelled_is_final" } }, row.order_id, "confirmed"),
    CANCELLED_ORDER_FINAL_MESSAGE);
  assert.equal(canChangeOrderStatus("cancelled"), false);
  for (const status of ["new", "confirmed", "processing", "completed"]) assert.equal(canChangeOrderStatus(status), true);
  const admin = await readFile(new URL("../src/admin/AdminOrders.tsx", import.meta.url), "utf8");
  assert.match(admin, /disabled=\{saving \|\| !canChangeOrderStatus\(selected\.status\)\}/);
  assert.match(admin, /if \(!canChangeOrderStatus\(selected\.status\)\) \{ setError\(CANCELLED_ORDER_FINAL_MESSAGE\); return; \}/);
});
