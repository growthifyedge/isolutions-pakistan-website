// Two-Vendor Order Management verification (202611150001 + 202611150002) against the replayed migrations
// (never a live database), with hosted Supabase default privileges so a missing revoke cannot hide a hole.
// Covers: vendor suggestions (incl. the Watches / Bands exception), release only when fully assigned,
// single and mixed-vendor orders, cross-vendor read/write denial, independent vendor transitions, parent status
// derivation, reassignment rules, partial and full cancellation with exactly-once stock returns, repeated and
// "concurrent" cancellation, bulk/direct Admin bypass prevention and legacy order compatibility.
import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { createCatalogTestDatabase, signInAsOwner } from "./support/catalogTestDatabase.mjs";
import { ACCESSORIES_EXTRA_PRODUCT_IDS } from "../src/lib/collections.ts";
import { planBulkStatusUpdate } from "../src/lib/orderRules.ts";
import {
  canReassign, deriveOrderStatus, isPartiallyCancelled, releaseBlocker, suggestVendor, vendorErrorMessage, vendorLabel,
} from "../src/lib/vendorOrders.ts";

const db = await createCatalogTestDatabase({ supabaseDefaultPrivileges: true });
const ownerId = await signInAsOwner(db);
const one = async (sql, params = []) => (await db.query(sql, params)).rows[0];
const all = async (sql, params = []) => (await db.query(sql, params)).rows;

const vendorId = async (code) => (await one(`select id from public.vendors where code = $1`, [code])).id;
const ISOL = await vendorId("isolutions");
const PIYA = await vendorId("piyavey");

const user = async (email, role, vendor = null, active = true) => {
  const { id } = await one(`insert into auth.users (email) values ($1) returning id`, [email]);
  await db.query(`update public.profiles set role = $2, vendor_id = $3, is_active = $4 where id = $1`, [id, role, vendor, active]);
  return id;
};
const isolStaff = await user("isol-staff@example.test", "staff", ISOL);
const isolStaff2 = await user("isol-staff2@example.test", "staff", ISOL);
const piyaStaff = await user("piya-staff@example.test", "staff", PIYA);
const inactiveStaff = await user("old-staff@example.test", "staff", PIYA, false);
const customerId = await user("customer@example.test", null);

async function as(role, userId, run) {
  await db.exec(`set role ${role}`);
  await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [userId ?? ""]);
  try { return await run(); } finally {
    await db.exec(`reset role`);
    await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [ownerId]);
  }
}
const asAdmin = (run) => as("authenticated", ownerId, run);

// --- Catalog fixture: a Home Gadget (category gadgets) and a mobile accessory, both published, stock 200.
const product = async (title, type) => {
  await db.query(`select public.apply_catalog_bulk_import_v2($1::jsonb)`, [JSON.stringify({ products: [{
    action: "Create", source: title, product_type: type, brand: "Samsung", title, category: null, specifications: [],
    variants: [{ source: "row", sku: null, ram: null, storage: null, color: "Black", price_minor: type === "Gadget" ? 300_000 : 100_000,
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
  return { id, variant, category };
};
const KETTLE = await product("TEST Vendor Kettle", "Gadget");
const CABLE = await product("TEST Vendor Cable", "Accessory");
const stock = async (p) => Number((await one(`select public.current_inventory($1) as n`, [p.variant])).n);

let phone = 0;
const place = (lines = [[KETTLE, 2], [CABLE, 1]]) => as("anon", null, async () => (await db.query(
  `select * from public.create_storefront_order($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb)`,
  ["TEST Vendor Customer", `0312${String(++phone).padStart(7, "0")}`, null, "Karachi", null, "TEST Address 9", null, "Ring twice",
    "cash_on_delivery", "standard", JSON.stringify(lines.map(([p, quantity]) => ({ variant_id: p.variant, quantity })))],
)).rows[0].order_id);
const items = (orderId) => all(`select oi.id, oi.product_id, oi.vendor_id from public.order_items oi where oi.order_id = $1 order by oi.created_at, oi.id`, [orderId]);
const itemOf = async (orderId, p) => (await items(orderId)).find((row) => row.product_id === p.id).id;
const assign = (orderId, rows) => asAdmin(() => all(`select * from public.admin_assign_order_items($1, $2::jsonb)`,
  [orderId, JSON.stringify(rows.map(([item_id, vendor]) => ({ item_id, vendor })))]));
const assignByProduct = async (orderId, map) => assign(orderId, await Promise.all(Object.entries(map).map(async ([key, vendor]) =>
  [await itemOf(orderId, key === "kettle" ? KETTLE : CABLE), vendor])));
const release = (orderId) => asAdmin(() => all(`select * from public.admin_release_order_to_vendors($1)`, [orderId]));
const parts = (orderId) => all(`select f.id, v.code, f.status, f.stock_restored_at from public.order_fulfilments f join public.vendors v on v.id = f.vendor_id where f.order_id = $1 order by v.sort_order`, [orderId]);
const part = async (orderId, code) => (await parts(orderId)).find((row) => row.code === code);
const orderRow = (id) => one(`select status, released_at, stock_restored_at, total_minor from public.orders where id = $1`, [id]);
const staffList = (who) => as("authenticated", who, () => all(`select * from public.staff_list_fulfilments()`));
const staffSet = (who, fulfilmentId, status) => as("authenticated", who, () => all(`select * from public.staff_set_fulfilment_status($1, $2)`, [fulfilmentId, status]));
const adminSetPart = (fulfilmentId, status) => asAdmin(() => all(`select * from public.admin_set_fulfilment_status($1, $2)`, [fulfilmentId, status]));
const moves = (orderId) => all(`select variant_id, quantity_delta, reason::text as reason from public.inventory_movements where reference = $1 order by id`, [`order:${orderId}`]);
const releasedMixed = async () => {
  const id = await place();
  await assignByProduct(id, { kettle: "piyavey", cable: "isolutions" });
  await release(id);
  return { id, piya: (await part(id, "piyavey")).id, isol: (await part(id, "isolutions")).id };
};

test("vendors, staff vendor rule and checkout compatibility", async () => {
  assert.deepEqual((await all(`select code, name from public.vendors order by sort_order`)).map((v) => [v.code, v.name]),
    [["isolutions", "iSolutions Pakistan"], ["piyavey", "Piyavey"]]);
  // Every staff account has exactly one vendor; nobody else has one.
  const { id: noVendor } = await one(`insert into auth.users (email) values ('x@example.test') returning id`);
  await assert.rejects(db.query(`update public.profiles set role = 'staff' where id = $1`, [noVendor]), /profiles_vendor_matches_role/);
  await assert.rejects(db.query(`update public.profiles set vendor_id = $2 where id = $1`, [ownerId, ISOL]), /profiles_vendor_matches_role/);
  // Checkout is unchanged: New order, no vendor on any line, no vendor part.
  const id = await place();
  assert.equal((await orderRow(id)).status, "new");
  assert.deepEqual((await items(id)).map((row) => row.vendor_id), [null, null]);
  assert.deepEqual(await parts(id), []);
});

test("vendor suggestions follow the catalog rules, incl. the Watches / Bands exception", () => {
  assert.equal(KETTLE.category, "gadgets");
  assert.equal(CABLE.category, "mobile-accessories");
  assert.equal(suggestVendor({ productId: KETTLE.id, categorySlug: KETTLE.category }), "piyavey");
  assert.equal(suggestVendor({ productId: CABLE.id, categorySlug: CABLE.category }), "isolutions");
  for (const slug of ["mobile-phones", "mobile-accessories", "tablets", "laptops"])
    assert.equal(suggestVendor({ productId: "p", categorySlug: slug }), "isolutions", slug);
  // The 16 watches / bands stay in category gadgets but are shown in Mobile Accessories: iSolutions.
  assert.equal(ACCESSORIES_EXTRA_PRODUCT_IDS.length, 16);
  for (const watch of ACCESSORIES_EXTRA_PRODUCT_IDS) assert.equal(suggestVendor({ productId: watch, categorySlug: "gadgets" }), "isolutions");
  assert.equal(suggestVendor({ productId: "p", categorySlug: null }), null, "unknown category: no guess");
  assert.equal(vendorLabel("piyavey"), "Piyavey");
  assert.equal(vendorLabel(null), "Unassigned");
});

test("D1: nothing is released while any item is unassigned; only the Admin assigns or releases", async () => {
  const id = await place();
  await assert.rejects(release(id), /order_items_unassigned/);
  await assignByProduct(id, { kettle: "piyavey" });
  await assert.rejects(release(id), /order_items_unassigned/);
  assert.deepEqual(await parts(id), []);
  for (const who of [isolStaff, piyaStaff, customerId]) {
    await assert.rejects(as("authenticated", who, () => all(`select * from public.admin_assign_order_items($1, '[]'::jsonb)`, [id])), /catalog_admin_required/);
    await assert.rejects(as("authenticated", who, () => all(`select * from public.admin_release_order_to_vendors($1)`, [id])), /catalog_admin_required/);
  }
  for (const sql of [`select * from public.admin_assign_order_items($1, '[]'::jsonb)`, `select * from public.admin_release_order_to_vendors($1)`,
    `select * from public.staff_list_fulfilments()`, `select public.is_order_staff()`])
    await assert.rejects(as("anon", null, () => db.query(sql, sql.includes("$1") ? [id] : [])), /permission denied/, sql);
  // Bad input is refused as a whole.
  await assert.rejects(assign(id, [[await itemOf(id, CABLE), "nobody"]]), /vendor_invalid/);
  const other = await place();
  await assert.rejects(assign(id, [[await itemOf(other, CABLE), "isolutions"]]), /order_item_not_in_order/);
  const cable = await itemOf(id, CABLE);
  await assert.rejects(assign(id, [[cable, "isolutions"], [cable, "piyavey"]]), /order_item_duplicate/);
  assert.equal((await items(id)).find((row) => row.id === cable).vendor_id, null);
  // Before release an assignment can be cleared again.
  await assignByProduct(id, { cable: "isolutions" });
  await assign(id, [[cable, null]]);
  await assert.rejects(release(id), /order_items_unassigned/);
  // Unassigned items never reach any staff list.
  for (const who of [isolStaff, piyaStaff]) assert.ok(!(await staffList(who)).some((row) => row.order_id === id));
});

test("single-vendor order: one part, only that vendor sees it", async () => {
  const id = await place([[KETTLE, 1]]);
  await assignByProduct(id, { kettle: "piyavey" });
  const released = await release(id);
  assert.deepEqual(released.map((row) => [row.vendor_code, row.status]), [["piyavey", "confirmed"]]);
  assert.equal((await orderRow(id)).status, "confirmed", "parent becomes Received");
  assert.ok((await orderRow(id)).released_at);
  await assert.rejects(release(id), /order_already_released_to_vendors/);
  const piya = (await staffList(piyaStaff)).filter((row) => row.order_id === id);
  assert.equal(piya.length, 1);
  assert.equal(piya[0].vendor_subtotal_minor, 300_000);
  assert.deepEqual((await staffList(isolStaff)).filter((row) => row.order_id === id), []);
});

test("mixed order: each vendor sees only its own items and subtotal, never whole-order financials", async () => {
  const { id } = await releasedMixed();
  assert.deepEqual((await parts(id)).map((row) => [row.code, row.status]), [["isolutions", "confirmed"], ["piyavey", "confirmed"]]);
  const [piya] = (await staffList(piyaStaff)).filter((row) => row.order_id === id);
  const [isol] = (await staffList(isolStaff)).filter((row) => row.order_id === id);
  assert.deepEqual(piya.items.map((item) => [item.product_title_snapshot, item.quantity]), [["TEST Vendor Kettle", 2]]);
  assert.equal(piya.vendor_subtotal_minor, 600_000);
  assert.deepEqual(isol.items.map((item) => [item.product_title_snapshot, item.quantity]), [["TEST Vendor Cable", 1]]);
  assert.equal(isol.vendor_subtotal_minor, 100_000);
  // Delivery details for both; no whole-order money or other vendor's lines.
  assert.equal(piya.phone, isol.phone);
  assert.equal(piya.order_notes, "Ring twice");
  for (const key of ["total_minor", "subtotal_minor", "delivery_fee_minor", "discount_minor", "coupon_code_snapshot", "stock_restored_at"])
    assert.ok(!(key in piya), key);
  assert.ok(!JSON.stringify(piya.items).includes("Cable") && !JSON.stringify(isol.items).includes("Kettle"));
  assert.equal((await orderRow(id)).total_minor, 600_000 + 100_000 + 20_000, "checkout total unchanged (Rs 200 delivery below Rs 10,000)");
});

test("cross-vendor and direct access is denied (reads and writes)", async () => {
  const { id, piya, isol } = await releasedMixed();
  // Staff have no direct table access to orders, items, parts, history, seen markers, vendors or stock.
  for (const who of [isolStaff, piyaStaff, inactiveStaff, customerId])
    await as("authenticated", who, async () => {
      for (const table of ["orders", "order_items", "order_fulfilments", "order_status_events", "order_fulfilment_seen", "order_staff_seen", "vendors", "inventory_movements", "coupons"])
        assert.deepEqual(await all(`select * from public.${table}`).catch(() => []), [], `${who} ${table}`);
      assert.deepEqual(await all(`update public.orders set status = 'completed' where id = $1 returning id`, [id]).catch(() => []), []);
      await assert.rejects(db.query(`update public.order_items set vendor_id = $2 where order_id = $1`, [id, ISOL]));
      await assert.rejects(db.query(`update public.order_fulfilments set status = 'completed' where id = $1`, [piya]));
      await assert.rejects(db.query(`insert into public.order_fulfilments (order_id, vendor_id) values ($1, $2)`, [id, ISOL]));
      await assert.rejects(db.query(`insert into public.order_fulfilment_seen (fulfilment_id, staff_id) values ($1, $2)`, [piya, who]));
      await assert.rejects(db.query(`insert into public.order_status_events (order_id, event, to_status) values ($1, 'status_changed', 'completed')`, [id]));
    });
  // iSolutions staff cannot touch the Piyavey part (and vice versa).
  await assert.rejects(staffSet(isolStaff, piya, "processing"), /order_not_available/);
  await assert.rejects(staffSet(piyaStaff, isol, "processing"), /order_not_available/);
  await assert.rejects(as("authenticated", isolStaff, () => all(`select public.staff_mark_fulfilment_seen($1)`, [piya])), /order_not_available/);
  await assert.rejects(as("authenticated", isolStaff, () => all(`select * from public.staff_fulfilment_history($1)`, [piya])), /order_not_available/);
  // Inactive staff, customers and the Owner are not vendor staff.
  for (const who of [inactiveStaff, customerId, ownerId]) {
    await assert.rejects(staffSet(who, piya, "processing"), /staff_access_required/);
    await assert.rejects(staffList(who), /staff_access_required/);
    assert.equal((await as("authenticated", who, () => one(`select public.is_order_staff() as s`))).s, false);
  }
  assert.equal((await as("authenticated", piyaStaff, () => one(`select public.is_order_staff() as s`))).s, true);
  assert.deepEqual(await as("authenticated", piyaStaff, () => all(`select * from public.staff_current_vendor()`)), [{ code: "piyavey", name: "Piyavey" }]);
  assert.deepEqual((await parts(id)).map((row) => row.status), ["confirmed", "confirmed"], "nothing changed");
  // The Phase 2 order-level staff RPCs no longer exist.
  for (const name of ["staff_set_order_status", "staff_mark_order_seen", "admin_release_orders_to_staff"])
    assert.equal((await one(`select count(*)::int as n from pg_proc where proname = $1`, [name])).n, 0, name);
  // Inactive vendor: its staff lose access.
  await db.query(`update public.vendors set is_active = false where id = $1`, [PIYA]);
  await assert.rejects(staffList(piyaStaff), /staff_access_required/);
  await db.query(`update public.vendors set is_active = true where id = $1`, [PIYA]);
});

test("independent vendor transitions; parent = earliest active stage; Admin sees both", async () => {
  const { id, piya, isol } = await releasedMixed();
  for (const bad of ["in_transit", "completed", "confirmed", "bogus"]) await assert.rejects(staffSet(piyaStaff, piya, bad), /order_status_transition_not_allowed/, bad);
  assert.deepEqual(await staffSet(piyaStaff, piya, "processing"), [{ id: piya, status: "processing" }]);
  assert.equal((await orderRow(id)).status, "confirmed", "iSolutions part still Received");
  await staffSet(piyaStaff, piya, "in_transit");
  await staffSet(piyaStaff, piya, "completed");
  assert.equal((await orderRow(id)).status, "confirmed", "one vendor delivered, the other still Received");
  await staffSet(isolStaff, isol, "processing");
  assert.equal((await orderRow(id)).status, "processing");
  await staffSet(isolStaff2, isol, "in_transit");
  assert.equal((await orderRow(id)).status, "in_transit");
  await assert.rejects(staffSet(piyaStaff, piya, "cancelled"), /order_status_transition_not_allowed/, "delivered parts are History");
  await staffSet(isolStaff, isol, "completed");
  assert.equal((await orderRow(id)).status, "completed");
  // Vendor history (Admin sees all; each vendor its own) and parent history.
  const events = await all(`select e.event, e.to_status, e.actor_role, v.code from public.order_status_events e left join public.vendors v on v.id = e.vendor_id where e.order_id = $1 order by e.id`, [id]);
  assert.deepEqual(events.filter((e) => e.code === "piyavey").map((e) => [e.event, e.to_status, e.actor_role]),
    [["released", "confirmed", "owner"], ["status_changed", "processing", "staff"], ["status_changed", "in_transit", "staff"], ["status_changed", "completed", "staff"]]);
  assert.deepEqual(events.filter((e) => !e.code && e.event === "status_changed").map((e) => e.to_status), ["confirmed", "processing", "in_transit", "completed"]);
  const piyaHistory = await as("authenticated", piyaStaff, () => all(`select * from public.staff_fulfilment_history($1)`, [piya]));
  assert.deepEqual(piyaHistory.map((e) => e.to_status), ["confirmed", "processing", "in_transit", "completed"]);
  // Pure mirror of the database rule.
  const f = (status, hasItems = true) => ({ status, hasItems });
  assert.equal(deriveOrderStatus([f("completed"), f("confirmed")]), "confirmed");
  assert.equal(deriveOrderStatus([f("in_transit"), f("processing")]), "processing");
  assert.equal(deriveOrderStatus([f("completed"), f("cancelled")]), "completed");
  assert.equal(deriveOrderStatus([f("cancelled"), f("cancelled")]), "cancelled");
  assert.equal(deriveOrderStatus([f("processing", false), f("in_transit")]), "in_transit");
  assert.equal(deriveOrderStatus([]), null);
});

test("Admin per-vendor override; split orders cannot be changed by direct/bulk order updates", async () => {
  const { id, piya, isol } = await releasedMixed();
  assert.deepEqual(await adminSetPart(piya, "in_transit"), [{ id: piya, status: "in_transit" }]);
  assert.equal((await orderRow(id)).status, "confirmed");
  await assert.rejects(adminSetPart(piya, "new"), /fulfilment_status_invalid/);
  await assert.rejects(as("authenticated", piyaStaff, () => all(`select * from public.admin_set_fulfilment_status($1, 'completed')`, [piya])), /catalog_admin_required/);
  // Direct single and bulk-style updates of a split order are refused (whole statement), legacy orders still work.
  await assert.rejects(asAdmin(() => all(`update public.orders set status = 'completed' where id = $1 returning id`, [id])), /split_order_status_managed_per_vendor/);
  await assert.rejects(asAdmin(() => all(`update public.orders set status = 'cancelled' where id = $1 returning id`, [id])), /split_order_status_managed_per_vendor/);
  const legacy = [await place(), await place()];
  const rows = await asAdmin(() => all(`update public.orders set status = 'processing' where id = any($1::uuid[]) and status <> 'cancelled' returning id, status`, [legacy]));
  assert.equal(rows.length, 2);
  // Non-status edits of a split order are unaffected.
  assert.equal((await asAdmin(() => all(`update public.orders set order_notes = 'Gate 2' where id = $1 returning id`, [id]))).length, 1);
  assert.deepEqual((await parts(id)).map((row) => row.status), ["confirmed", "in_transit"]);
  // Bulk plan leaves vendor-managed orders out.
  const plan = planBulkStatusUpdate([{ id: "a", status: "confirmed", releasedToVendors: true }, { id: "b", status: "new" }, { id: "c", status: "cancelled" }], "completed");
  assert.deepEqual(plan, { eligible: ["b"], skippedCancelled: ["c"], unchanged: [], skippedVendor: ["a"] });
  await staffSet(isolStaff, isol, "processing");
  assert.equal((await orderRow(id)).status, "processing");
});

test("D3 reassignment: Admin only, only while both parts are Received; history, isolation and seen stay correct", async () => {
  const { id, piya, isol } = await releasedMixed();
  const kettle = await itemOf(id, KETTLE);
  const cable = await itemOf(id, CABLE);
  await as("authenticated", piyaStaff, () => one(`select public.staff_mark_fulfilment_seen($1)`, [piya]));
  await as("authenticated", isolStaff, () => one(`select public.staff_mark_fulfilment_seen($1)`, [isol]));
  await assert.rejects(assign(id, [[kettle, null]]), /order_item_vendor_required/);
  // Move the kettle to iSolutions while both are Received: Piyavey's part becomes empty and disappears for Piyavey.
  await assign(id, [[kettle, "isolutions"]]);
  assert.deepEqual((await staffList(piyaStaff)).filter((row) => row.order_id === id), []);
  const [isolRow] = (await staffList(isolStaff)).filter((row) => row.order_id === id);
  assert.deepEqual(isolRow.items.map((item) => item.product_title_snapshot).sort(), ["TEST Vendor Cable", "TEST Vendor Kettle"]);
  assert.equal(isolRow.is_seen, false, "changed part shows as new again");
  await assert.rejects(staffSet(piyaStaff, piya, "processing"), /order_not_available/, "an emptied part cannot be progressed");
  await assert.rejects(adminSetPart(piya, "processing"), /fulfilment_has_no_items/);
  assert.equal((await part(id, "piyavey")).status, "confirmed", "the record is kept, never deleted");
  const reassigned = await all(`select event, from_vendor_id, vendor_id, order_item_id from public.order_status_events where order_id = $1 and event = 'item_reassigned'`, [id]);
  assert.deepEqual(reassigned, [{ event: "item_reassigned", from_vendor_id: PIYA, vendor_id: ISOL, order_item_id: kettle }]);
  // Staff never see reassignment events in their history.
  assert.ok((await as("authenticated", isolStaff, () => all(`select * from public.staff_fulfilment_history($1)`, [isol]))).every((e) => e.event !== "item_reassigned"));
  // Move it back; then lock: once a part is In Process, nothing moves in or out of it.
  await assign(id, [[kettle, "piyavey"]]);
  assert.equal((await staffList(piyaStaff)).filter((row) => row.order_id === id).length, 1);
  await staffSet(piyaStaff, piya, "processing");
  await assert.rejects(assign(id, [[kettle, "isolutions"]]), /fulfilment_not_reassignable/, "source In Process");
  await assert.rejects(assign(id, [[cable, "piyavey"]]), /fulfilment_not_reassignable/, "target In Process");
  await assert.rejects(as("authenticated", isolStaff, () => all(`select * from public.admin_assign_order_items($1, $2::jsonb)`,
    [id, JSON.stringify([{ item_id: cable, vendor: "piyavey" }])])), /catalog_admin_required/);
  assert.deepEqual((await items(id)).map((row) => row.vendor_id).sort(), [ISOL, PIYA].sort());
  // Pure mirror.
  assert.equal(canReassign("confirmed", null), true);
  assert.equal(canReassign("confirmed", "confirmed"), true);
  assert.equal(canReassign("processing", null), false);
  assert.equal(canReassign("confirmed", "in_transit"), false);
  assert.equal(releaseBlocker([{ vendor: "piyavey" }, { vendor: null }]), "Assign 1 item to a vendor before release.");
  assert.equal(releaseBlocker([{ vendor: "piyavey" }]), null);
});

test("D2 partial cancellation: only that vendor's stock returns, exactly once; the other vendor continues", async () => {
  const kettle0 = await stock(KETTLE); const cable0 = await stock(CABLE);
  const { id, piya, isol } = await releasedMixed();
  assert.deepEqual([await stock(KETTLE), await stock(CABLE)], [kettle0 - 2, cable0 - 1]);
  await staffSet(piyaStaff, piya, "processing");
  assert.deepEqual(await staffSet(piyaStaff, piya, "cancelled"), [{ id: piya, status: "cancelled" }]);
  assert.deepEqual([await stock(KETTLE), await stock(CABLE)], [kettle0, cable0 - 1], "only the Piyavey kettles came back");
  assert.ok((await part(id, "piyavey")).stock_restored_at);
  assert.equal((await orderRow(id)).status, "confirmed", "iSolutions part still Received; order not cancelled");
  assert.equal((await orderRow(id)).stock_restored_at, null);
  // Repeated cancel: refused, no second return.
  await assert.rejects(staffSet(piyaStaff, piya, "cancelled"), /order_status_transition_not_allowed/);
  await assert.rejects(adminSetPart(piya, "processing"), /fulfilment_cancelled_is_final/);
  assert.deepEqual(await adminSetPart(piya, "cancelled"), [{ id: piya, status: "cancelled" }], "re-cancel is a no-op");
  assert.equal(await stock(KETTLE), kettle0);
  // The other vendor delivers: order Delivered with a partial cancellation.
  await staffSet(isolStaff, isol, "processing"); await staffSet(isolStaff, isol, "in_transit"); await staffSet(isolStaff, isol, "completed");
  assert.equal((await orderRow(id)).status, "completed");
  assert.equal(await stock(CABLE), cable0 - 1, "delivered stock stays out");
  assert.deepEqual((await moves(id)).map((m) => [m.variant_id === KETTLE.variant ? "kettle" : "cable", m.quantity_delta, m.reason]),
    [["kettle", -2, "sale"], ["cable", -1, "sale"], ["kettle", 2, "return"]]);
  const f = (status) => ({ status, hasItems: true });
  assert.equal(isPartiallyCancelled([f("completed"), f("cancelled")]), true);
  assert.equal(isPartiallyCancelled([f("cancelled"), f("cancelled")]), false);
  assert.equal(isPartiallyCancelled([f("completed"), { status: "cancelled", hasItems: false }]), false);
});

test("subsequent full cancellation returns only the rest; all-cancelled order is Cancelled; legacy cancel unchanged", async () => {
  const kettle0 = await stock(KETTLE); const cable0 = await stock(CABLE);
  const { id, piya } = await releasedMixed();
  await staffSet(piyaStaff, piya, "cancelled");
  const cancelled = await asAdmin(() => all(`select * from public.admin_cancel_open_fulfilments($1)`, [id]));
  assert.equal(cancelled.length, 1, "only the still-open iSolutions part");
  assert.deepEqual([await stock(KETTLE), await stock(CABLE)], [kettle0, cable0]);
  const row = await orderRow(id);
  assert.equal(row.status, "cancelled");
  assert.ok(row.stock_restored_at, "order-level restore ran and found nothing left to return");
  assert.deepEqual((await moves(id)).filter((m) => m.reason === "return").map((m) => m.quantity_delta).sort(), [1, 2]);
  assert.deepEqual(await asAdmin(() => all(`select * from public.admin_cancel_open_fulfilments($1)`, [id])), [], "repeat: nothing left");
  await assert.rejects(adminSetPart(piya, "confirmed"), /fulfilment_cancelled_is_final/);
  // Cancel-all leaves Delivered parts alone.
  const mixed = await releasedMixed();
  await adminSetPart(mixed.isol, "completed");
  await asAdmin(() => all(`select * from public.admin_cancel_open_fulfilments($1)`, [mixed.id]));
  assert.deepEqual((await parts(mixed.id)).map((p) => [p.code, p.status]), [["isolutions", "completed"], ["piyavey", "cancelled"]]);
  assert.equal((await orderRow(mixed.id)).status, "completed");
  // Legacy (never released to vendors) whole-order cancel: still returns every line exactly once.
  const k = await stock(KETTLE); const c = await stock(CABLE);
  const legacy = await place();
  await asAdmin(() => all(`update public.orders set status = 'processing' where id = $1`, [legacy]));
  await asAdmin(() => all(`update public.orders set status = 'cancelled' where id = $1`, [legacy]));
  await asAdmin(() => all(`update public.orders set status = 'cancelled' where id = $1`, [legacy]));
  assert.deepEqual([await stock(KETTLE), await stock(CABLE)], [k, c]);
  assert.deepEqual((await moves(legacy)).map((m) => [m.quantity_delta, m.reason]).sort(), [[-1, "sale"], [-2, "sale"], [1, "return"], [2, "return"]]);
  await assert.rejects(asAdmin(() => all(`update public.orders set status = 'processing' where id = $1`, [legacy])), /order_cancelled_is_final/);
  // The unique index still forbids any second return for the same order and variant.
  await assert.rejects(db.query(`insert into public.inventory_movements (variant_id, quantity_delta, reason, reference) values ($1, 2, 'return', $2)`,
    [KETTLE.variant, `order:${legacy}`]), /inventory_movements_order_return_once/);
});

test("simultaneous cancellations (vendor + vendor, vendor + Admin) return stock once", async () => {
  const kettle0 = await stock(KETTLE); const cable0 = await stock(CABLE);
  const a = await releasedMixed();
  const results = await Promise.allSettled([staffSet(piyaStaff, a.piya, "cancelled"), staffSet(piyaStaff, a.piya, "cancelled")]);
  assert.deepEqual(results.map((r) => r.status).sort(), ["fulfilled", "rejected"]);
  const b = await releasedMixed();
  const both = await Promise.allSettled([
    staffSet(isolStaff, b.isol, "cancelled"),
    asAdmin(() => all(`select * from public.admin_cancel_open_fulfilments($1)`, [b.id])),
  ]);
  assert.ok(both.some((r) => r.status === "fulfilled"));
  await asAdmin(() => all(`select * from public.admin_cancel_open_fulfilments($1)`, [a.id]));
  for (const id of [a.id, b.id]) {
    assert.equal((await orderRow(id)).status, "cancelled");
    const returns = (await moves(id)).filter((m) => m.reason === "return");
    assert.equal(returns.length, 2, "one return per line");
  }
  assert.deepEqual([await stock(KETTLE), await stock(CABLE)], [kettle0, cable0]);
});

test("seen markers per staff account and per vendor part (D8)", async () => {
  const { id, piya, isol } = await releasedMixed();
  const seen = async (who) => (await staffList(who)).find((row) => row.order_id === id).is_seen;
  assert.equal(await seen(isolStaff), false);
  assert.equal((await as("authenticated", isolStaff, () => one(`select public.staff_mark_fulfilment_seen($1) as ok`, [isol]))).ok, true);
  assert.equal(await seen(isolStaff), true);
  assert.equal(await seen(isolStaff2), false, "another account of the same vendor keeps its own state");
  assert.equal(await seen(piyaStaff), false, "the other vendor is unaffected");
  await staffSet(piyaStaff, piya, "processing");
  assert.equal(await seen(piyaStaff), true, "changing a status marks it seen");
  await assert.rejects(asAdmin(() => all(`select * from public.order_fulfilment_seen`)), /permission denied/, "seen markers are private");
});

test("legacy orders: Phase 2 released orders stay invisible to vendors; legacy processing orders are not released to vendors", async () => {
  const id = await place();
  await asAdmin(() => all(`update public.orders set status = 'confirmed' where id = $1`, [id]));
  assert.ok((await orderRow(id)).released_at, "Phase 2 release time still recorded");
  for (const who of [isolStaff, piyaStaff]) assert.ok(!(await staffList(who)).some((row) => row.order_id === id));
  const busy = await place();
  await asAdmin(() => all(`update public.orders set status = 'processing' where id = $1`, [busy]));
  await assignByProduct(busy, { kettle: "piyavey", cable: "isolutions" });
  await assert.rejects(release(busy), /order_not_releasable/);
  const done = await place();
  await asAdmin(() => all(`update public.orders set status = 'completed' where id = $1`, [done]));
  await assert.rejects(assignByProduct(done, { kettle: "piyavey" }), /order_not_assignable/);
  // A Received legacy order can be released to vendors.
  await assignByProduct(id, { kettle: "piyavey", cable: "isolutions" });
  assert.equal((await release(id)).length, 2);
});

test("error messages and UI wiring", async () => {
  assert.match(vendorErrorMessage("order_items_unassigned"), /Assign every item/);
  assert.match(vendorErrorMessage("fulfilment_not_reassignable"), /Received/);
  const staff = await readFile(new URL("../src/staff/StaffApp.tsx", import.meta.url), "utf8");
  assert.match(staff, /rpc\("staff_list_fulfilments"\)/);
  assert.match(staff, /rpc\("staff_set_fulfilment_status", \{ p_fulfilment_id: order\.id, p_status: next \}\)/);
  assert.match(staff, /rpc\("staff_mark_fulfilment_seen", \{ p_fulfilment_id: /);
  assert.doesNotMatch(staff, /\.from\(|(?<![a-z_])total_minor|\.update\(|\.insert\(|service_role/);
  const admin = await readFile(new URL("../src/admin/AdminOrderVendors.tsx", import.meta.url), "utf8");
  // Pre-release: one atomic Confirm & Release call (202611150003), never assign + release as two browser writes.
  for (const rpc of ["admin_confirm_and_release_order", "admin_assign_order_items", "admin_set_fulfilment_status", "admin_cancel_open_fulfilments"])
    assert.match(admin, new RegExp(`rpc\\("${rpc}"`), rpc);
  assert.doesNotMatch(admin, /rpc\("admin_release_order_to_vendors"/);
  assert.match(admin, /suggestVendor\(/);
});
