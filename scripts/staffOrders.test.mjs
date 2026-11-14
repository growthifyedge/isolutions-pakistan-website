// Phase 2 Staff Orders Dashboard verification against the replayed migrations (never a live
// database). Uses Supabase's hosted default privileges so a missing revoke cannot hide a hole.
// Since 202611150002 staff work on their own vendor's part of an order (scripts/vendorOrders.test.mjs
// covers vendor isolation, mixed orders, reassignment and partial cancellation). This file keeps the
// Phase 2 guarantees in their vendor form: released_at + historical orders, staff without direct table
// access, forward-only staff transitions, stock restore once on staff cancel, Admin bulk compatibility
// for orders not released to vendors, and the pure UI helpers.
import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { createCatalogTestDatabase, signInAsOwner } from "./support/catalogTestDatabase.mjs";
import {
  BULK_ORDER_STATUSES, ORDER_STATUSES, ORDER_STATUS_LABELS, STAFF_STATUS_TRANSITIONS, staffCanSetStatus,
} from "../src/lib/orderRules.ts";
import { splitStaffOrders, staffErrorMessage, telHref, unseenOrderIds, whatsappHref } from "../src/lib/staffOrders.ts";

const db = await createCatalogTestDatabase({ supabaseDefaultPrivileges: true });
const ownerId = await signInAsOwner(db);
const one = async (sql, params = []) => (await db.query(sql, params)).rows[0];
const all = async (sql, params = []) => (await db.query(sql, params)).rows;

// --- Accounts: Owner (Admin), two iSolutions staff, one inactive staff, one customer, anon.
const ISOL = (await one(`select id from public.vendors where code = 'isolutions'`)).id;
const user = async (email, role, active = true) => {
  const { id } = await one(`insert into auth.users (email) values ($1) returning id`, [email]);
  await db.query(`update public.profiles set role = $2, vendor_id = $3, is_active = $4 where id = $1`, [id, role, role === "staff" ? ISOL : null, active]);
  return id;
};
const staffId = await user("staff@example.test", "staff");
const staff2Id = await user("staff2@example.test", "staff");
const inactiveStaffId = await user("old-staff@example.test", "staff", false);
const customerId = await user("customer@example.test", null);

async function as(role, userId, run) {
  await db.exec(`set role ${role}`);
  await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [userId ?? ""]);
  try { return await run(); } finally {
    await db.exec(`reset role`);
    await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [ownerId]);
  }
}
const asStaff = (run) => as("authenticated", staffId, run);
const asAdmin = (run) => as("authenticated", ownerId, run);

// --- Catalog fixture (published, nationwide, stock 40) + orders placed exactly like checkout.
await db.query(`select public.apply_catalog_bulk_import_v2($1::jsonb)`, [JSON.stringify({ products: [{
  action: "Create", source: "TEST Staff Band", product_type: "Gadget", brand: "Samsung", title: "TEST Staff Band", category: null,
  specifications: [], variants: [{ source: "row", sku: null, ram: null, storage: null, color: "Black", price_minor: 250_000,
    compare_at_price_minor: null, stock: 40, pta_status: "not_applicable", condition: "brand_new", condition_grade: null,
    battery_health_percent: null, battery_cycle_count: null, sim_configuration: null, warranty: "1 Year", delivery_scope: "nationwide" }],
}] })]);
const { id: productId } = await one(`select id from public.products where title = 'TEST Staff Band'`);
await db.query(`insert into public.product_media (product_id, cloudinary_public_id, cloudinary_asset_id, cloudinary_version,
    secure_url, width, height, bytes, format, alt_text, is_primary)
  values ($1, 'test/staff', 'test/staff', 1, 'https://res.cloudinary.com/test/image/upload/test/staff', 800, 800, 1000, 'jpg', 'band', true)`, [productId]);
await db.query(`update public.products set publication_status = 'published' where id = $1`, [productId]);
const BAND = (await one(`select id from public.product_variants where product_id = $1`, [productId])).id;
const stock = async () => Number((await one(`select public.current_inventory($1) as n`, [BAND])).n);

let phone = 0;
const place = () => as("anon", null, async () => (await db.query(
  `select * from public.create_storefront_order($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb)`,
  ["TEST Staff Customer", `0311${String(++phone).padStart(7, "0")}`, null, "Karachi", null, "TEST Address 1", null, null,
    "cash_on_delivery", "standard", JSON.stringify([{ variant_id: BAND, quantity: 1 }])],
)).rows[0].order_id);
const adminSet = (id, status) => asAdmin(() => all(`update public.orders set status = $1 where id = $2 returning id, status, released_at`, [status, id]));
// Release an order to iSolutions (all lines) and return its vendor part id.
const releaseIsol = async (id) => {
  const lines = await all(`select id from public.order_items where order_id = $1`, [id]);
  await asAdmin(() => all(`select * from public.admin_assign_order_items($1, $2::jsonb)`, [id, JSON.stringify(lines.map((l) => ({ item_id: l.id, vendor: "isolutions" })))]));
  return (await asAdmin(() => all(`select * from public.admin_release_order_to_vendors($1)`, [id])))[0].fulfilment_id;
};
const staffSet = (partId, status, who = staffId) => as("authenticated", who, () => all(`select * from public.staff_set_fulfilment_status($1, $2)`, [partId, status]));
const orderRow = (id) => one(`select status, released_at, total_minor from public.orders where id = $1`, [id]);
const events = (id) => all(`select event, from_status, to_status, actor_role from public.order_status_events where order_id = $1 order by id`, [id]);

test("status model: in_transit is valid; labels match the Owner wording; checkout still creates New orders", async () => {
  assert.deepEqual(ORDER_STATUSES, ["new", "confirmed", "processing", "in_transit", "completed", "cancelled"]);
  assert.deepEqual(ORDER_STATUS_LABELS, { new: "New", confirmed: "Received", processing: "In Process", in_transit: "In Transit", completed: "Delivered", cancelled: "Cancelled" });
  assert.deepEqual([...BULK_ORDER_STATUSES], ["confirmed", "processing", "in_transit", "completed", "cancelled"]);
  const id = await place();
  assert.deepEqual({ ...(await orderRow(id)), total_minor: undefined }, { status: "new", released_at: null, total_minor: undefined });
  await assert.rejects(adminSet(id, "shipped"), /orders_status_check/);
});

test("release: Received (or any active status) releases once; New/Delivered/Cancelled never release; released_at is immutable", async () => {
  const a = await place();
  const [row] = await adminSet(a, "confirmed");
  assert.ok(row.released_at, "Received releases the order to staff");
  const releasedAt = (await orderRow(a)).released_at.toISOString();
  await adminSet(a, "processing");
  assert.equal((await orderRow(a)).released_at.toISOString(), releasedAt, "later changes keep the first release time");
  // Nobody can clear or move released_at, not even the Admin with a direct update.
  await asAdmin(() => all(`update public.orders set released_at = null where id = $1`, [a]));
  assert.equal((await orderRow(a)).released_at.toISOString(), releasedAt);
  assert.deepEqual(await events(a), [
    { event: "status_changed", from_status: "new", to_status: "confirmed", actor_role: "owner" },
    { event: "released", from_status: "new", to_status: "confirmed", actor_role: "owner" },
    { event: "status_changed", from_status: "confirmed", to_status: "processing", actor_role: "owner" },
  ]);
  // Delivered / cancelled straight from New: never released, staff never see it.
  const b = await place(); await adminSet(b, "completed");
  const c = await place(); await adminSet(c, "cancelled");
  assert.equal((await orderRow(b)).released_at, null);
  assert.equal((await orderRow(c)).released_at, null);
  // Setting released_at by hand on an unreleasable order is ignored.
  await asAdmin(() => all(`update public.orders set released_at = now() where id = $1`, [b]));
  assert.equal((await orderRow(b)).released_at, null);
});

test("historical confirmed orders stay invisible to staff; only an explicit Admin release to vendors shows them", async () => {
  // Simulate an order confirmed before 202611140002 existed (no release trigger at the time).
  const old = await place();
  await db.exec(`alter table public.orders disable trigger orders_guard_release`);
  await db.query(`update public.orders set status = 'confirmed' where id = $1`, [old]);
  await db.exec(`alter table public.orders enable trigger orders_guard_release`);
  assert.equal((await orderRow(old)).released_at, null);
  const listed = () => asStaff(async () => (await all(`select order_id from public.staff_list_fulfilments()`)).map((r) => r.order_id));
  assert.ok(!(await listed()).includes(old));
  // Staff and customers cannot release; the Admin can, explicitly (all items assigned first).
  await assert.rejects(asStaff(() => all(`select * from public.admin_release_order_to_vendors($1)`, [old])), /catalog_admin_required/);
  await assert.rejects(as("authenticated", customerId, () => all(`select * from public.admin_release_order_to_vendors($1)`, [old])), /catalog_admin_required/);
  await releaseIsol(old);
  await assert.rejects(asAdmin(() => all(`select * from public.admin_release_order_to_vendors($1)`, [old])), /order_already_released_to_vendors/);
  assert.ok((await listed()).includes(old));
  assert.equal((await orderRow(old)).released_at, null, "the historical order-level release marker is not invented");
});

test("staff have no direct table access; staff status RPC is forward only (Received -> In Process -> In Transit -> Delivered)", async () => {
  const id = await place();
  const part = await releaseIsol(id);
  await asStaff(async () => {
    for (const table of ["orders", "order_items", "order_status_events", "order_staff_seen", "inventory_movements", "coupons", "coupon_redemptions", "contact_messages"])
      assert.deepEqual(await all(`select * from public.${table}`).catch(() => []), [], table);
    assert.deepEqual(await all(`update public.orders set status = 'completed', total_minor = 1 where id = $1 returning id`, [id]).catch(() => []), []);
    await assert.rejects(db.query(`insert into public.inventory_movements (variant_id, quantity_delta, reason) values ($1, 5, 'correction')`, [BAND]));
    assert.equal((await one(`select public.is_catalog_admin() as a`)).a, false);
    assert.equal(Number((await one(`select public.current_inventory($1) as n`, [BAND])).n), 0, "stock levels stay hidden");
    assert.deepEqual((await all(`select id, role from public.profiles`)).map((r) => [r.id, r.role]), [[staffId, "staff"]]);
  });
  for (const bad of ["in_transit", "completed", "confirmed", "new", "bogus"])
    await assert.rejects(staffSet(part, bad), /order_status_transition_not_allowed/, bad);
  assert.deepEqual(await staffSet(part, "processing"), [{ id: part, status: "processing" }]);
  for (const bad of ["confirmed", "completed", "new"]) await assert.rejects(staffSet(part, bad), /order_status_transition_not_allowed/, bad);
  assert.deepEqual(await staffSet(part, "in_transit"), [{ id: part, status: "in_transit" }]);
  await assert.rejects(staffSet(part, "processing"), /order_status_transition_not_allowed/);
  assert.deepEqual(await staffSet(part, "completed"), [{ id: part, status: "completed" }]);
  // History parts are read-only for staff.
  for (const bad of ["cancelled", "in_transit", "processing"]) await assert.rejects(staffSet(part, bad), /order_status_transition_not_allowed/, bad);
  // The Admin sees the result on the order, with a staff-attributed history.
  assert.equal((await orderRow(id)).status, "completed");
  assert.deepEqual((await events(id)).filter((e) => e.actor_role === "staff").map((e) => e.to_status), ["processing", "processing", "in_transit", "in_transit", "completed", "completed"],
    "one vendor-part event and one order event per staff change");
  // Other users and inactive staff are refused.
  for (const who of [customerId, ownerId, inactiveStaffId]) await assert.rejects(staffSet(part, "processing", who), /staff_access_required/);
  // The UI mirror matches the database rules.
  assert.deepEqual(STAFF_STATUS_TRANSITIONS, { confirmed: ["processing", "cancelled"], processing: ["in_transit", "cancelled"], in_transit: ["completed", "cancelled"] });
  assert.equal(staffCanSetStatus("confirmed", "in_transit"), false);
  assert.equal(staffCanSetStatus("in_transit", "completed"), true);
  assert.equal(staffCanSetStatus("completed", "cancelled"), false);
});

test("staff cancel from each active stage restores stock exactly once; cancelled stays final", async () => {
  const start = await stock();
  const [a, b, c] = [await place(), await place(), await place()];
  const [pa, pb, pc] = [await releaseIsol(a), await releaseIsol(b), await releaseIsol(c)];
  await staffSet(pb, "processing");
  await staffSet(pc, "processing"); await staffSet(pc, "in_transit");
  assert.equal(await stock(), start - 3);
  for (const part of [pa, pb, pc]) assert.deepEqual(await staffSet(part, "cancelled"), [{ id: part, status: "cancelled" }]);
  assert.equal(await stock(), start);
  for (const [id, part] of [[a, pa], [b, pb], [c, pc]]) {
    assert.equal((await orderRow(id)).status, "cancelled");
    const moves = await all(`select quantity_delta, reason::text from public.inventory_movements where reference = $1 order by id`, [`order:${id}`]);
    assert.deepEqual(moves.map((m) => [m.quantity_delta, m.reason]), [[-1, "sale"], [1, "return"]], id);
    await assert.rejects(staffSet(part, "cancelled"), /order_status_transition_not_allowed/);
    await assert.rejects(adminSet(id, "processing"), /order_cancelled_is_final|split_order_status_managed_per_vendor/);
  }
  assert.equal(await stock(), start);
});

test("Admin bulk updates keep working for orders not released to vendors: In Transit, release marker, one history row per order", async () => {
  const ids = [await place(), await place()];
  const rows = await asAdmin(() => all(`update public.orders set status = 'in_transit' where id = any($1::uuid[]) and status <> 'cancelled' returning id, status, released_at`, [ids]));
  assert.equal(rows.length, 2);
  assert.ok(rows.every((r) => r.status === "in_transit" && r.released_at));
  for (const id of ids) assert.deepEqual((await events(id)).map((e) => [e.event, e.to_status]), [["status_changed", "in_transit"], ["released", "in_transit"]]);
  // Orders not released to vendors never reach staff, whatever their status.
  const listed = await asStaff(async () => (await all(`select order_id from public.staff_list_fulfilments()`)).map((r) => r.order_id));
  assert.ok(!listed.includes(ids[0]) && !listed.includes(ids[1]));
});

test("Admin and Staff UIs use the reviewed calls", async () => {
  const admin = await readFile(new URL("../src/admin/AdminOrderVendors.tsx", import.meta.url), "utf8");
  assert.match(admin, /rpc\("admin_confirm_and_release_order"/);
  const orders = await readFile(new URL("../src/admin/AdminOrders.tsx", import.meta.url), "utf8");
  assert.match(orders, /from\("order_status_events"\)/);
  const staff = await readFile(new URL("../src/staff/StaffApp.tsx", import.meta.url), "utf8");
  assert.match(staff, /rpc\("staff_set_fulfilment_status", \{ p_fulfilment_id: order\.id, p_status: next \}\)/);
  assert.match(staff, /rpc\("staff_mark_fulfilment_seen", \{ p_fulfilment_id: /);
  assert.match(staff, /rpc\("is_order_staff"\)/);
  assert.doesNotMatch(staff, /from\("orders"\)\.update|\.update\(|service_role|\.insert\(/);
  const app = await readFile(new URL("../src/App.tsx", import.meta.url), "utf8");
  assert.match(app, /import\("\.\/staff\/StaffApp"\)/);
});

test("UI helpers: tabs, unseen badge, Call and WhatsApp links, error messages", () => {
  const orders = [{ id: "a", status: "confirmed" }, { id: "b", status: "processing" }, { id: "c", status: "in_transit" }, { id: "d", status: "completed" }, { id: "e", status: "cancelled" }];
  const { active, history } = splitStaffOrders(orders);
  assert.deepEqual(active.map((o) => o.id), ["a", "b", "c"]);
  assert.deepEqual(history.map((o) => o.id), ["d", "e"]);
  assert.deepEqual(unseenOrderIds(orders, new Set()), ["a", "b", "c"]);
  assert.deepEqual(unseenOrderIds(orders, new Set(["a"])), ["b", "c"], "opening a Received order clears it from the badge");
  assert.equal(whatsappHref("0300 1234567"), "https://wa.me/923001234567");
  assert.equal(whatsappHref("+92 300 1234567"), "https://wa.me/923001234567");
  assert.equal(whatsappHref("3001234567"), "https://wa.me/923001234567");
  assert.equal(whatsappHref("0092-300-1234567"), "https://wa.me/923001234567");
  assert.equal(whatsappHref("12"), null);
  assert.equal(telHref("0300-1234567"), "tel:03001234567");
  assert.equal(telHref("+92 300 1234567"), "tel:+923001234567");
  assert.match(staffErrorMessage("order_status_transition_not_allowed"), /not allowed/);
  assert.match(staffErrorMessage("Could not find the function public.staff_set_order_status"), /migration pending/);
});
