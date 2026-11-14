// One-click Confirm & Release (202611150003) against the replayed migrations (never a live database), with hosted
// Supabase default privileges. Covers: single-item, one-vendor and mixed-vendor orders, Admin override of the
// suggestion, atomic rollback when any step fails, unauthorized callers, repeated submission (no duplicate parts),
// legacy / non-releasable orders and unchanged behaviour after release (reassign, per-vendor status, stock return).
import assert from "node:assert/strict";
import test from "node:test";
import { createCatalogTestDatabase, signInAsOwner } from "./support/catalogTestDatabase.mjs";
import { suggestVendor } from "../src/lib/vendorOrders.ts";

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
const isolStaff = await user("cr-isol@example.test", "staff", ISOL);
const piyaStaff = await user("cr-piya@example.test", "staff", PIYA);
const customerId = await user("cr-customer@example.test", null);

async function as(role, userId, run) {
  await db.exec(`set role ${role}`);
  await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [userId ?? ""]);
  try { return await run(); } finally {
    await db.exec(`reset role`);
    await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [ownerId]);
  }
}

const product = async (title, type) => {
  await db.query(`select public.apply_catalog_bulk_import_v2($1::jsonb)`, [JSON.stringify({ products: [{
    action: "Create", source: title, product_type: type, brand: "Samsung", title, category: null, specifications: [],
    variants: [{ source: "row", sku: null, ram: null, storage: null, color: "Black", price_minor: 100_000,
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
const KETTLE = await product("TEST CR Kettle", "Gadget");
const CABLE = await product("TEST CR Cable", "Accessory");
const CHARGER = await product("TEST CR Charger", "Accessory");
const stock = async (p) => Number((await one(`select public.current_inventory($1) as n`, [p.variant])).n);

let phone = 0;
const place = (lines) => as("anon", null, async () => (await db.query(
  `select * from public.create_storefront_order($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb)`,
  ["TEST CR Customer", `0313${String(++phone).padStart(7, "0")}`, null, "Karachi", null, "TEST Address 1", null, null,
    "cash_on_delivery", "standard", JSON.stringify(lines.map(([p, quantity]) => ({ variant_id: p.variant, quantity })))],
)).rows[0].order_id);
const items = (orderId) => all(`select oi.id, oi.product_id, oi.vendor_id from public.order_items oi where oi.order_id = $1 order by oi.created_at, oi.id`, [orderId]);
const parts = (orderId) => all(`select f.id, v.code, f.status from public.order_fulfilments f join public.vendors v on v.id = f.vendor_id where f.order_id = $1 order by v.sort_order`, [orderId]);
const orderStatus = async (orderId) => (await one(`select status from public.orders where id = $1`, [orderId])).status;
// The payload the Admin UI sends: every item with its chosen (by default: suggested) vendor.
const suggested = async (orderId, override = {}) => (await items(orderId)).map((row) => {
  const p = [KETTLE, CABLE, CHARGER].find((candidate) => candidate.id === row.product_id);
  return { item_id: row.id, vendor: override[row.product_id] ?? suggestVendor({ productId: p.id, categorySlug: p.category }) };
});
const confirm = (orderId, payload, who = ownerId) => as("authenticated", who, () =>
  all(`select * from public.admin_confirm_and_release_order($1, $2::jsonb)`, [orderId, JSON.stringify(payload)]));
const staffOrders = (who) => as("authenticated", who, () => all(`select order_id from public.staff_list_fulfilments()`));

test("single-item order: assigned and released in one call", async () => {
  const id = await place([[CABLE, 1]]);
  const result = await confirm(id, await suggested(id));
  assert.deepEqual(result.map((row) => [row.vendor_code, row.status]), [["isolutions", "confirmed"]]);
  assert.deepEqual((await items(id)).map((row) => row.vendor_id), [ISOL]);
  assert.equal(await orderStatus(id), "confirmed");
  assert.ok((await staffOrders(isolStaff)).some((row) => row.order_id === id));
  assert.ok(!(await staffOrders(piyaStaff)).some((row) => row.order_id === id));
});

test("several items for one vendor: one vendor part", async () => {
  const id = await place([[CABLE, 1], [CHARGER, 2]]);
  await confirm(id, await suggested(id));
  assert.deepEqual((await parts(id)).map((row) => row.code), ["isolutions"]);
  assert.deepEqual((await items(id)).map((row) => row.vendor_id), [ISOL, ISOL]);
});

test("mixed-vendor order: one part per vendor, each staff sees only its own", async () => {
  const id = await place([[KETTLE, 1], [CABLE, 1]]);
  await confirm(id, await suggested(id));
  assert.deepEqual((await parts(id)).map((row) => [row.code, row.status]), [["isolutions", "confirmed"], ["piyavey", "confirmed"]]);
  assert.ok((await staffOrders(isolStaff)).some((row) => row.order_id === id));
  assert.ok((await staffOrders(piyaStaff)).some((row) => row.order_id === id));
});

test("Admin override of the suggestion is saved", async () => {
  const id = await place([[KETTLE, 1], [CABLE, 1]]);
  await confirm(id, await suggested(id, { [KETTLE.id]: "isolutions" }));
  assert.deepEqual((await parts(id)).map((row) => row.code), ["isolutions"]);
  assert.deepEqual((await items(id)).map((row) => row.vendor_id), [ISOL, ISOL]);
});

test("atomic: any failure leaves no saved vendor and no vendor part", async () => {
  const id = await place([[KETTLE, 1], [CABLE, 1]]);
  const unchanged = async () => {
    assert.deepEqual((await items(id)).map((row) => row.vendor_id), [null, null]);
    assert.deepEqual(await parts(id), []);
    assert.equal(await orderStatus(id), "new");
  };
  const payload = await suggested(id);
  await assert.rejects(confirm(id, payload.slice(0, 1)), /order_items_unassigned/); await unchanged();
  await assert.rejects(confirm(id, [payload[0], { ...payload[1], vendor: null }]), /order_items_unassigned/); await unchanged();
  await assert.rejects(confirm(id, [payload[0], { ...payload[1], vendor: "nobody" }]), /vendor_invalid/); await unchanged();
  await assert.rejects(confirm(id, [...payload, payload[0]]), /order_item_duplicate/); await unchanged();
  await assert.rejects(confirm(id, { not: "an array" }), /vendor_assignments_invalid/); await unchanged();
  // A failure in the release step, after the item vendors were already written in this call, rolls them back too.
  await db.exec(`create function public.test_fail_release() returns trigger language plpgsql as $$ begin raise exception 'test_release_failure'; end $$;
    create trigger test_fail_release before insert on public.order_fulfilments for each row execute function public.test_fail_release();`);
  try {
    await assert.rejects(confirm(id, payload), /test_release_failure/);
    await unchanged();
  } finally {
    await db.exec(`drop trigger test_fail_release on public.order_fulfilments; drop function public.test_fail_release();`);
  }
  await confirm(id, payload);
  assert.equal((await parts(id)).length, 2);
});

test("only the Admin can confirm and release", async () => {
  const id = await place([[KETTLE, 1], [CABLE, 1]]);
  const payload = await suggested(id);
  for (const who of [isolStaff, piyaStaff, customerId]) await assert.rejects(confirm(id, payload, who), /catalog_admin_required/);
  await assert.rejects(as("anon", null, () => db.query(`select * from public.admin_confirm_and_release_order($1, $2::jsonb)`, [id, JSON.stringify(payload)])), /permission denied/);
  assert.deepEqual((await items(id)).map((row) => row.vendor_id), [null, null]);
  assert.deepEqual(await parts(id), []);
});

test("repeated submission creates no duplicate vendor parts", async () => {
  const id = await place([[KETTLE, 1], [CABLE, 1]]);
  const payload = await suggested(id);
  await confirm(id, payload);
  await assert.rejects(confirm(id, payload), /order_already_released_to_vendors/);
  await assert.rejects(confirm(id, await suggested(id, { [KETTLE.id]: "isolutions" })), /order_already_released_to_vendors/);
  assert.deepEqual((await parts(id)).map((row) => row.code), ["isolutions", "piyavey"]);
  assert.deepEqual(Object.fromEntries((await items(id)).map((row) => [row.product_id, row.vendor_id])), { [KETTLE.id]: PIYA, [CABLE.id]: ISOL });
});

test("delivered / cancelled (legacy) orders are not released", async () => {
  for (const status of ["completed", "cancelled"]) {
    const id = await place([[CABLE, 1]]);
    await db.query(`update public.orders set status = $2 where id = $1`, [id, status]);
    await assert.rejects(confirm(id, await suggested(id)), /order_not_releasable/);
    assert.deepEqual(await parts(id), []);
    assert.deepEqual((await items(id)).map((row) => row.vendor_id), [null]);
  }
});

test("after release: reassignment, per-vendor status and exactly-once stock return are unchanged", async () => {
  const id = await place([[KETTLE, 2], [CABLE, 1], [CHARGER, 1]]);
  await confirm(id, await suggested(id));
  const charger = (await items(id)).find((row) => row.product_id === CHARGER.id).id;
  // D3 reassignment still uses admin_assign_order_items.
  await as("authenticated", ownerId, () => all(`select * from public.admin_assign_order_items($1, $2::jsonb)`,
    [id, JSON.stringify([{ item_id: charger, vendor: "piyavey" }])]));
  assert.equal((await items(id)).find((row) => row.id === charger).vendor_id, PIYA);
  const piya = (await parts(id)).find((row) => row.code === "piyavey").id;
  const before = await stock(KETTLE);
  await as("authenticated", ownerId, () => all(`select * from public.admin_set_fulfilment_status($1, 'cancelled')`, [piya]));
  await as("authenticated", ownerId, () => all(`select * from public.admin_set_fulfilment_status($1, 'cancelled')`, [piya])); // repeat: no-op
  await assert.rejects(as("authenticated", ownerId, () => all(`select * from public.admin_set_fulfilment_status($1, 'confirmed')`, [piya])), /fulfilment_cancelled_is_final/);
  assert.equal(await stock(KETTLE), before + 2, "Piyavey's kettles returned once");
  assert.equal((await parts(id)).find((row) => row.code === "isolutions").status, "confirmed");
  assert.equal(await orderStatus(id), "confirmed");
});
