// Checkout coupons v1 (202610050001) against the replayed migrations (never a live database), with
// hosted Supabase's default grants: definitions, server-side validation and pricing, atomic
// redemption inside create_storefront_order, usage limits, cancellation, RLS and admin management.
import assert from "node:assert/strict";
import test from "node:test";
import { createCatalogTestDatabase, signInAsOwner } from "./support/catalogTestDatabase.mjs";
import {
  buildCouponPayload,
  canonicalCouponCode,
  couponFormValuesFrom,
  couponReasonFromError,
  couponReasonMessage,
  couponStatus,
  describeCouponValue,
  generateCouponCode,
  isValidCouponCode,
  suggestedCouponPrefix,
} from "../src/lib/coupons.ts";

const db = await createCatalogTestDatabase({ supabaseDefaultPrivileges: true });
const ownerId = await signInAsOwner(db);
const one = async (sql, params = []) => (await db.query(sql, params)).rows[0];
const all = async (sql, params = []) => (await db.query(sql, params)).rows;

// --- Catalog: Accessories (Rs 1,500 / Rs 2,000), a Karachi-only phone and a Laptop (Gadgets > Laptops).
const variant = (overrides = {}) => ({
  source: "row", sku: null, ram: null, storage: null, color: "Black", price_minor: 150_000, compare_at_price_minor: null,
  stock: 500, pta_status: "not_applicable", condition: "brand_new", condition_grade: null, battery_health_percent: null,
  battery_cycle_count: null, sim_configuration: null, warranty: "1 Year", delivery_scope: "nationwide", ...overrides,
});
const product = (title, overrides = {}) => ({
  action: "Create", source: title, product_type: "Accessory", brand: "Samsung", title, category: "Accessories",
  specifications: [], variants: [variant()], ...overrides,
});
await db.query(`select public.apply_catalog_bulk_import_v2($1::jsonb)`, [JSON.stringify({ products: [
  product("CP Cable"),
  product("CP Case", { variants: [variant({ price_minor: 200_000 })] }),
  product("CP Last Unit", { variants: [variant({ price_minor: 100_000, stock: 1 })] }),
  product("CP Phone", { product_type: "Mobile Phone", category: "Mobile Phones", variants: [
    variant({ ram: "8 GB", storage: "256 GB", price_minor: 900_000, pta_status: "approved", delivery_scope: "karachi_only" }),
  ] }),
  product("CP Laptop", { product_type: "Laptop", brand: "Apple", category: "Laptops", variants: [variant({ ram: "16 GB", storage: "512 GB", price_minor: 1_200_000 })] }),
] })]);
let media = 0;
for (const title of ["CP Cable", "CP Case", "CP Last Unit", "CP Phone", "CP Laptop"]) {
  const { id } = await one(`select id from public.products where title = $1`, [title]);
  media += 1;
  await db.query(`insert into public.product_media (product_id, cloudinary_public_id, cloudinary_asset_id, cloudinary_version,
      secure_url, width, height, bytes, format, alt_text, is_primary)
    values ($1, $2, $2, 1, 'https://res.cloudinary.com/test/image/upload/' || $2, 800, 800, 1000, 'jpg', $3, true)`, [id, `cp/${media}`, title]);
  await db.query(`update public.products set publication_status = 'published' where id = $1`, [id]);
}
const variantOf = async (title) => (await one(
  `select v.id from public.product_variants v join public.products p on p.id = v.product_id where p.title = $1`, [title])).id;
const productOf = async (title) => (await one(`select id from public.products where title = $1`, [title])).id;
const categoryOf = async (slug) => (await one(`select id from public.categories where slug = $1`, [slug])).id;
const CABLE = await variantOf("CP Cable"); // Rs 1,500
const CASE = await variantOf("CP Case"); // Rs 2,000
const LAST = await variantOf("CP Last Unit"); // Rs 1,000, stock 1
const PHONE = await variantOf("CP Phone"); // Rs 9,000, Karachi only
const LAPTOP = await variantOf("CP Laptop"); // Rs 12,000 (Laptops, a Gadgets sub-category)
const ACCESSORIES = await categoryOf("mobile-accessories");
const GADGETS = await categoryOf("gadgets");

// --- Sessions.
const newUser = async (email) => (await one(`insert into auth.users (email) values ($1) returning id`, [email])).id;
const customerId = await newUser("coupon-customer@example.test");
const inactiveAdminId = await newUser("coupon-inactive-admin@example.test");
await db.query(`update public.profiles set role = 'admin', is_active = false where id = $1`, [inactiveAdminId]);
async function as(role, userId, run, headers = "") {
  await db.exec(`set role ${role}`);
  await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [userId ?? ""]);
  await db.query(`select set_config('request.headers', $1, false)`, [headers]);
  try {
    return await run();
  } finally {
    await db.exec(`reset role`);
    await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [ownerId]);
    await db.query(`select set_config('request.headers', '', false)`);
  }
}
const asOwner = (run) => as("authenticated", ownerId, run);
const asAnon = (run, headers) => as("anon", null, run, headers);

// --- Coupons (created through the Admin path: authenticated owner + RLS).
const COLUMNS = ["code", "name", "description", "discount_type", "discount_value", "minimum_order_minor", "maximum_discount_minor",
  "starts_at", "ends_at", "total_usage_limit", "per_customer_usage_limit", "applies_to", "category_id", "product_id", "is_active"];
const couponRow = (fields) => ({ name: `Coupon ${fields.code}`, discount_type: "percentage", applies_to: "all", is_active: true, ...fields });
const insertCoupon = (fields) => {
  const row = couponRow(fields);
  const keys = COLUMNS.filter((key) => key in row);
  return one(`insert into public.coupons (${keys.join(", ")}) values (${keys.map((_, i) => `$${i + 1}`).join(", ")}) returning *`,
    keys.map((key) => row[key]));
};
const createCoupon = (fields) => asOwner(() => insertCoupon(fields));
const day = 24 * 60 * 60 * 1000;
const iso = (offset) => new Date(Date.now() + offset).toISOString();

// --- Storefront calls (anonymous visitor; no trusted IP unless given).
let phoneSequence = 0;
const newPhone = () => `0301${String(1_000_000 + (phoneSequence += 1)).slice(-7)}`;
const cart = (...lines) => JSON.stringify(lines.map(([variant_id, quantity = 1]) => ({ variant_id, quantity })));
const validate = (code, lines, { shipping = "standard", phone = null, headers } = {}) =>
  asAnon(() => one(`select * from public.validate_storefront_coupon($1, $2::jsonb, $3, $4)`, [code, lines, shipping, phone]), headers);
const order = (lines, { coupon = null, phone = newPhone(), shipping = "standard", city = "Karachi", otherCity = null } = {}) =>
  asAnon(() => one(`select * from public.create_storefront_order('CP Buyer', $1, null, $5, $6, 'CP Address', null, null,
    'cash_on_delivery', $2, $3::jsonb, $4)`, [phone, shipping, lines, coupon, city, otherCity]));
const rejectsOrder = (lines, options, reason) => assert.rejects(order(lines, options), new RegExp(reason));
const redemptions = async (couponId) => Number((await one(`select count(*) as n from public.coupon_redemptions where coupon_id = $1`, [couponId])).n);
const orderRow = (id) => one(`select * from public.orders where id = $1`, [id]);
const stockOf = async (variantId) => Number((await one(`select public.current_inventory($1) as n`, [variantId])).n);
const minor = (row) => Object.fromEntries(Object.entries(row).map(([key, value]) => [key, typeof value === "string" && /_minor$/.test(key) ? Number(value) : value]));

test("1/13. a valid percentage coupon (all products) discounts the whole merchandise subtotal", async () => {
  const coupon = await createCoupon({ code: "SAVE10", discount_value: 10 });
  const lines = cart([CABLE, 2], [LAPTOP]); // Rs 3,000 + Rs 12,000 = Rs 15,000 (free standard delivery)
  const preview = minor(await validate("save10", lines));
  assert.equal(preview.valid, true);
  assert.equal(preview.reason, "ok");
  assert.equal(preview.code, "SAVE10");
  assert.equal(preview.discount_type, "percentage");
  assert.deepEqual([preview.subtotal_minor, preview.eligible_subtotal_minor, preview.discount_minor, preview.delivery_fee_minor,
    preview.shipping_discount_minor, preview.total_minor], [1_500_000, 1_500_000, 150_000, 0, 0, 1_350_000]);
  const placed = minor(await order(lines, { coupon: " save10 " }));
  assert.deepEqual([placed.coupon_code, placed.discount_minor, placed.shipping_discount_minor, placed.total_minor],
    ["SAVE10", 150_000, 0, 1_350_000]);
  const stored = minor(await orderRow(placed.order_id));
  assert.deepEqual([stored.coupon_id, stored.coupon_code_snapshot, stored.subtotal_minor, stored.discount_minor, stored.delivery_fee_minor, stored.total_minor],
    [coupon.id, "SAVE10", 1_500_000, 150_000, 0, 1_350_000]);
  assert.equal(await redemptions(coupon.id), 1);
});

test("2. a percentage coupon is capped by its maximum discount and rounded down to whole rupees", async () => {
  await createCoupon({ code: "HALF-CAP", discount_value: 50, maximum_discount_minor: 50_000 });
  const capped = minor(await validate("HALF-CAP", cart([CASE, 2]))); // 50% of Rs 4,000 = Rs 2,000 -> cap Rs 500
  assert.deepEqual([capped.discount_minor, capped.delivery_fee_minor, capped.total_minor], [50_000, 20_000, 370_000]);
  await createCoupon({ code: "SAVE7", discount_value: 7 });
  const rounded = minor(await validate("SAVE7", cart([CABLE]))); // 7% of Rs 1,500 = Rs 105
  assert.equal(rounded.discount_minor, 10_500);
});

test("3/4/30. a fixed discount is capped at the eligible subtotal and the total never goes below zero", async () => {
  await createCoupon({ code: "FLAT500", discount_type: "fixed_amount", discount_value: 50_000 });
  const flat = minor(await order(cart([CABLE]), { coupon: "FLAT500" }));
  assert.deepEqual([flat.subtotal_minor, flat.discount_minor, flat.delivery_fee_minor, flat.total_minor], [150_000, 50_000, 20_000, 120_000]);
  await createCoupon({ code: "FLAT5000", discount_type: "fixed_amount", discount_value: 500_000 });
  const capped = minor(await order(cart([CABLE]), { coupon: "FLAT5000" }));
  assert.deepEqual([capped.discount_minor, capped.total_minor], [150_000, 20_000], "discount stops at the Rs 1,500 subtotal; only delivery is charged");
  assert.ok(capped.total_minor >= 0);
  // The database refuses an order whose discount exceeds the subtotal or whose total does not add up.
  await assert.rejects(db.query(`update public.orders set discount_minor = subtotal_minor + 1 where id = $1`, [capped.order_id]), /orders_discount_within_subtotal/);
  await assert.rejects(db.query(`update public.orders set total_minor = total_minor - 1 where id = $1`, [capped.order_id]), /orders_total_matches_components|orders_total_minor_check/);
});

test("5. a free-shipping coupon removes Standard or Fast delivery and leaves the subtotal unchanged", async () => {
  await createCoupon({ code: "FREESHIP", discount_type: "free_shipping" });
  const fast = minor(await order(cart([CABLE]), { coupon: "FREESHIP", shipping: "fast" }));
  assert.deepEqual([fast.subtotal_minor, fast.delivery_fee_minor, fast.shipping_surcharge_minor, fast.discount_minor, fast.shipping_discount_minor, fast.total_minor],
    [150_000, 40_000, 20_000, 0, 40_000, 150_000]);
  const standard = minor(await order(cart([CABLE]), { coupon: "FREESHIP" }));
  assert.deepEqual([standard.delivery_fee_minor, standard.shipping_discount_minor, standard.total_minor], [20_000, 20_000, 150_000]);
});

test("6/7/8/9. unknown, malformed, disabled, scheduled and expired coupons fail with a clear reason", async () => {
  const lines = cart([CABLE]);
  for (const code of ["NOPE99", "", "   ", "a!", "x".repeat(40)]) {
    const result = await validate(code, lines);
    assert.deepEqual([result.valid, result.reason], [false, "coupon_invalid"], `code ${JSON.stringify(code)}`);
    assert.equal(result.discount_minor, null);
  }
  await createCoupon({ code: "OFF-NOW", discount_value: 10, is_active: false });
  await createCoupon({ code: "SOON10", discount_value: 10, starts_at: iso(day) });
  await createCoupon({ code: "OLD10", discount_value: 10, starts_at: iso(-2 * day), ends_at: iso(-day) });
  for (const [code, reason] of [["OFF-NOW", "coupon_inactive"], ["SOON10", "coupon_not_started"], ["OLD10", "coupon_expired"], ["NOPE99", "coupon_invalid"]]) {
    assert.equal((await validate(code, lines)).reason, reason);
    await rejectsOrder(lines, { coupon: code }, reason);
  }
});

test("10/16. minimum order uses the whole pre-discount merchandise subtotal, even for a category coupon", async () => {
  await createCoupon({ code: "ACC-MIN10K", discount_value: 10, minimum_order_minor: 1_000_000, applies_to: "category", category_id: ACCESSORIES });
  assert.equal((await validate("ACC-MIN10K", cart([CABLE, 4]))).reason, "coupon_minimum_not_met"); // Rs 6,000
  await rejectsOrder(cart([CABLE, 4]), { coupon: "ACC-MIN10K" }, "coupon_minimum_not_met");
  // Rs 1,500 accessory + Rs 12,000 laptop = Rs 13,500 meets the minimum; only the accessory line is discounted.
  const mixed = minor(await validate("ACC-MIN10K", cart([CABLE], [LAPTOP])));
  assert.deepEqual([mixed.valid, mixed.subtotal_minor, mixed.eligible_subtotal_minor, mixed.discount_minor], [true, 1_350_000, 150_000, 15_000]);
});

test("11. the total usage limit is enforced at order creation", async () => {
  const coupon = await createCoupon({ code: "FIRST-ONE", discount_value: 10, total_usage_limit: 1 });
  await order(cart([CABLE]), { coupon: "FIRST-ONE" });
  assert.equal((await validate("FIRST-ONE", cart([CABLE]))).reason, "coupon_usage_limit_reached");
  await rejectsOrder(cart([CABLE]), { coupon: "FIRST-ONE" }, "coupon_usage_limit_reached");
  assert.equal(await redemptions(coupon.id), 1);
});

test("12. the per-customer limit matches the same phone in any format and allows other customers", async () => {
  const coupon = await createCoupon({ code: "ONE-EACH", discount_value: 10, per_customer_usage_limit: 1 });
  await order(cart([CABLE]), { coupon: "ONE-EACH", phone: "0302 7654321" });
  assert.equal((await validate("ONE-EACH", cart([CABLE]), { phone: "+92 302 7654321" })).reason, "coupon_customer_limit_reached");
  assert.equal((await validate("ONE-EACH", cart([CABLE]))).valid, true, "the preview without a phone cannot check the customer limit");
  await rejectsOrder(cart([CABLE]), { coupon: "ONE-EACH", phone: "0092-302-7654321" }, "coupon_customer_limit_reached");
  await order(cart([CABLE]), { coupon: "ONE-EACH", phone: "0303 1112223" });
  assert.equal(await redemptions(coupon.id), 2);
  // Only a peppered hash of the normalised phone is stored, never the number itself.
  const hashes = await all(`select customer_phone_hash from public.coupon_redemptions where coupon_id = $1`, [coupon.id]);
  for (const { customer_phone_hash } of hashes) assert.match(customer_phone_hash, /^[0-9a-f]{64}$/);
});

test("14/15/16. category (including sub-categories) and product scopes discount only eligible lines", async () => {
  await createCoupon({ code: "ACC10", discount_value: 10, applies_to: "category", category_id: ACCESSORIES });
  const accessories = minor(await validate("ACC10", cart([CABLE], [LAPTOP])));
  assert.deepEqual([accessories.eligible_subtotal_minor, accessories.discount_minor], [150_000, 15_000]);
  assert.equal((await validate("ACC10", cart([LAPTOP]))).reason, "coupon_not_applicable");
  await createCoupon({ code: "GADGET10", discount_value: 10, applies_to: "category", category_id: GADGETS });
  const gadgets = minor(await validate("GADGET10", cart([CABLE], [LAPTOP])));
  assert.deepEqual([gadgets.eligible_subtotal_minor, gadgets.discount_minor], [1_200_000, 120_000], "Laptops sit under Gadgets");
  await createCoupon({ code: "CASE300", discount_type: "fixed_amount", discount_value: 30_000, applies_to: "product", product_id: await productOf("CP Case") });
  const caseOnly = minor(await order(cart([CABLE], [CASE]), { coupon: "CASE300" }));
  assert.deepEqual([caseOnly.subtotal_minor, caseOnly.discount_minor], [350_000, 30_000]);
  assert.equal((await validate("CASE300", cart([CABLE]))).reason, "coupon_not_applicable");
  await rejectsOrder(cart([CABLE]), { coupon: "CASE300" }, "coupon_not_applicable");
});

test("17. delivery is priced from the pre-discount subtotal, so a discount never re-adds the delivery fee", async () => {
  await createCoupon({ code: "FLAT1000", discount_type: "fixed_amount", discount_value: 100_000 });
  const placed = minor(await order(cart([CABLE, 7]), { coupon: "FLAT1000" })); // Rs 10,500 -> Rs 9,500 after discount
  assert.deepEqual([placed.subtotal_minor, placed.discount_minor, placed.delivery_fee_minor, placed.total_minor], [1_050_000, 100_000, 0, 950_000]);
  const fast = minor(await order(cart([CABLE, 7]), { coupon: "FLAT1000", shipping: "fast" }));
  assert.deepEqual([fast.delivery_fee_minor, fast.total_minor], [20_000, 970_000]);
});

test("18/19. no coupon (omitted, blank or removed) keeps the unchanged order flow", async () => {
  const legacy = minor(await asAnon(() => one(`select * from public.create_storefront_order('CP Buyer', $1, null, 'Karachi', null,
    'CP Address', null, null, 'cash_on_delivery', 'standard', $2::jsonb)`, [newPhone(), cart([CABLE])])));
  assert.deepEqual([legacy.subtotal_minor, legacy.delivery_fee_minor, legacy.total_minor, legacy.coupon_code, legacy.discount_minor, legacy.shipping_discount_minor],
    [150_000, 20_000, 170_000, null, 0, 0]);
  for (const coupon of ["", "   ", null]) {
    const placed = minor(await order(cart([CABLE]), { coupon }));
    assert.deepEqual([placed.total_minor, placed.coupon_code, placed.discount_minor], [170_000, null, 0]);
    const stored = await orderRow(placed.order_id);
    assert.deepEqual([stored.coupon_id, stored.coupon_code_snapshot], [null, null]);
    assert.equal(Number((await one(`select count(*) as n from public.coupon_redemptions where order_id = $1`, [placed.order_id])).n), 0);
  }
});

test("20. a stale preview cannot bypass order validation: a coupon disabled or expired after preview fails", async () => {
  const coupon = await createCoupon({ code: "STALE10", discount_value: 10 });
  assert.equal((await validate("STALE10", cart([CABLE]))).valid, true);
  await asOwner(() => db.query(`update public.coupons set is_active = false where id = $1`, [coupon.id]));
  await rejectsOrder(cart([CABLE]), { coupon: "STALE10" }, "coupon_inactive");
  await asOwner(() => db.query(`update public.coupons set is_active = true, starts_at = $2, ends_at = $3 where id = $1`, [coupon.id, iso(-2 * day), iso(-1000)]));
  await rejectsOrder(cart([CABLE]), { coupon: "STALE10" }, "coupon_expired");
  assert.equal(await redemptions(coupon.id), 0);
});

test("21. a failed order consumes no coupon usage and takes no stock", async () => {
  const coupon = await createCoupon({ code: "ONCE-SAFE", discount_value: 10, total_usage_limit: 1 });
  const before = await stockOf(LAST);
  await rejectsOrder(cart([LAST, 2]), { coupon: "ONCE-SAFE" }, "variant_out_of_stock");
  await rejectsOrder(cart([PHONE]), { coupon: "ONCE-SAFE", city: "Other city in Pakistan", otherCity: "Lahore" }, "karachi_delivery_required");
  assert.equal(await redemptions(coupon.id), 0);
  assert.equal(await stockOf(LAST), before);
  await order(cart([LAST]), { coupon: "ONCE-SAFE" });
  assert.equal(await redemptions(coupon.id), 1);
});

test("22. each coupon order records exactly one redemption with the authoritative amounts", async () => {
  const coupon = await createCoupon({ code: "RECORD-ONE", discount_value: 20 });
  const placed = minor(await order(cart([CASE]), { coupon: "RECORD-ONE" }));
  const rows = (await all(`select * from public.coupon_redemptions where order_id = $1`, [placed.order_id])).map(minor);
  assert.equal(rows.length, 1);
  assert.deepEqual([rows[0].coupon_id, rows[0].discount_minor, rows[0].shipping_discount_minor], [coupon.id, 40_000, 0]);
  await assert.rejects(db.query(`insert into public.coupon_redemptions (coupon_id, order_id, customer_phone_hash, discount_minor)
    values ($1, $2, repeat('a', 64), 0)`, [coupon.id, placed.order_id]), /coupon_redemptions_order_unique/);
});

test("23. cancelling an order restores stock but not coupon usage", async () => {
  const coupon = await createCoupon({ code: "NO-REPLAY", discount_value: 10, total_usage_limit: 1 });
  const before = await stockOf(CASE);
  const placed = await order(cart([CASE]), { coupon: "NO-REPLAY" });
  assert.equal(await stockOf(CASE), before - 1);
  await asOwner(() => db.query(`update public.orders set status = 'cancelled' where id = $1`, [placed.order_id]));
  assert.equal(await stockOf(CASE), before);
  assert.equal(await redemptions(coupon.id), 1);
  await rejectsOrder(cart([CASE]), { coupon: "NO-REPLAY" }, "coupon_usage_limit_reached");
});

test("24/25. visitors, customers and inactive admins cannot read or manage coupons or redemptions", async () => {
  const target = await createCoupon({ code: "GUARDED", discount_value: 10 });
  const blocked = async (sql, params = []) => {
    try {
      const { rows } = await db.query(sql, params);
      assert.deepEqual(rows, [], sql);
    } catch (error) {
      if (error instanceof assert.AssertionError) throw error;
      assert.match(error.message, /permission denied|row-level security/, sql);
    }
  };
  for (const [role, userId] of [["anon", null], ["authenticated", customerId], ["authenticated", inactiveAdminId]]) {
    await as(role, userId, async () => {
      await blocked(`select * from public.coupons`);
      await blocked(`select * from public.coupon_redemptions`);
      await blocked(`insert into public.coupons (code, name, discount_type, discount_value) values ('HACK', 'x', 'percentage', 100) returning id`);
      await blocked(`update public.coupons set discount_value = 100 where id = $1 returning id`, [target.id]);
      await blocked(`delete from public.coupons where id = $1 returning id`, [target.id]);
      await blocked(`insert into public.coupon_redemptions (coupon_id, order_id, customer_phone_hash, discount_minor)
        select $1, id, repeat('b', 64), 0 from public.orders limit 1 returning id`, [target.id]);
      await assert.rejects(db.query(`select * from public.evaluate_storefront_coupon('GUARDED', '[]'::jsonb, 'standard', null, false)`), /permission denied/);
      await assert.rejects(db.query(`select public.coupon_customer_hash('03001234567')`), /permission denied/);
    });
  }
  const unchanged = await one(`select discount_value, is_active from public.coupons where id = $1`, [target.id]);
  assert.deepEqual([Number(unchanged.discount_value), unchanged.is_active], [10, true]);
  assert.equal(Number((await one(`select count(*) as n from public.coupons where code = 'HACK'`)).n), 0);
});

test("26. an Owner/Admin can create, edit, disable and delete an unused coupon; a used coupon cannot be deleted", async () => {
  const created = await createCoupon({ code: "ADMIN-EDIT", discount_value: 10 });
  const edited = await asOwner(() => one(`update public.coupons set discount_value = 15, name = 'Edited' where id = $1 returning *`, [created.id]));
  assert.deepEqual([Number(edited.discount_value), edited.name], [15, "Edited"]);
  const disabled = await asOwner(() => one(`update public.coupons set is_active = false where id = $1 returning is_active`, [created.id]));
  assert.equal(disabled.is_active, false);
  assert.equal((await validate("ADMIN-EDIT", cart([CABLE]))).reason, "coupon_inactive");
  await asOwner(() => db.query(`delete from public.coupons where id = $1`, [created.id]));
  assert.equal((await one(`select count(*) as n from public.coupons where id = $1`, [created.id])).n, 0);
  const used = await createCoupon({ code: "USED-KEEP", discount_value: 10 });
  await order(cart([CABLE]), { coupon: "USED-KEEP" });
  await assert.rejects(asOwner(() => db.query(`delete from public.coupons where id = $1`, [used.id])), /foreign key/);
  const admins = await all(`select code from public.coupons where id = $1`, [used.id]);
  assert.equal(admins.length, 1);
});

test("27/28. codes are trimmed and upper-cased, matched case-insensitively and unique", async () => {
  const stored = await createCoupon({ code: "  welcome-a8k4 ", name: "  Welcome  ", description: "   ", discount_value: 5 });
  assert.deepEqual([stored.code, stored.name, stored.description], ["WELCOME-A8K4", "Welcome", null]);
  assert.equal((await validate("Welcome-A8K4", cart([CABLE]))).valid, true);
  await assert.rejects(createCoupon({ code: "welcome-a8k4", discount_value: 5 }), /coupons_code_key|duplicate key/);
  for (const code of ["AB", "BAD CODE", "BAD!", "-LEADING", "Ü-CODE", "X".repeat(33)])
    await assert.rejects(createCoupon({ code, discount_value: 5 }), /coupons_code_format/, code);
});

test("29. zero, negative and inconsistent values are rejected by the database", async () => {
  const cases = [
    [{ code: "BAD-PCT0", discount_value: 0 }, /coupons_discount_value_valid/],
    [{ code: "BAD-PCT101", discount_value: 101 }, /coupons_discount_value_valid/],
    [{ code: "BAD-FIX0", discount_type: "fixed_amount", discount_value: 0 }, /coupons_discount_value_valid/],
    [{ code: "BAD-FIXNEG", discount_type: "fixed_amount", discount_value: -500 }, /coupons_discount_value_valid/],
    [{ code: "BAD-FREE", discount_type: "free_shipping", discount_value: 10 }, /coupons_discount_value_valid/],
    [{ code: "BAD-TYPE", discount_type: "bogo", discount_value: 1 }, /coupons_discount_type_check/],
    [{ code: "BAD-MIN", discount_value: 10, minimum_order_minor: -1 }, /coupons_minimum_order_valid/],
    [{ code: "BAD-MAX0", discount_value: 10, maximum_discount_minor: 0 }, /coupons_maximum_discount_valid/],
    [{ code: "BAD-MAXFIX", discount_type: "fixed_amount", discount_value: 100, maximum_discount_minor: 50 }, /coupons_maximum_discount_valid/],
    [{ code: "BAD-DATES", discount_value: 10, starts_at: iso(day), ends_at: iso(-day) }, /coupons_dates_valid/],
    [{ code: "BAD-LIMIT", discount_value: 10, total_usage_limit: 0 }, /coupons_total_usage_limit_valid/],
    [{ code: "BAD-PERCUST", discount_value: 10, per_customer_usage_limit: -1 }, /coupons_per_customer_usage_limit_valid/],
    [{ code: "BAD-SCOPE1", discount_value: 10, applies_to: "category" }, /coupons_scope_valid/],
    [{ code: "BAD-SCOPE2", discount_value: 10, applies_to: "all", category_id: ACCESSORIES }, /coupons_scope_valid/],
    [{ code: "BAD-SCOPE3", discount_value: 10, applies_to: "brand" }, /coupons_scope_valid/],
    [{ code: "BAD-NAME", name: "   ", discount_value: 10 }, /coupons_name_not_blank/],
  ];
  for (const [fields, error] of cases) await assert.rejects(createCoupon(fields), error, fields.code);
});

test("the coupon preview exposes only checkout fields and is rate limited per IP", async () => {
  await createCoupon({ code: "LEAK-CHECK", discount_value: 10, total_usage_limit: 100, per_customer_usage_limit: 3, minimum_order_minor: 100 });
  const result = await validate("LEAK-CHECK", cart([CABLE]));
  assert.deepEqual(Object.keys(result).sort(), ["code", "delivery_fee_minor", "discount_minor", "discount_type", "eligible_subtotal_minor",
    "reason", "shipping_discount_minor", "subtotal_minor", "total_minor", "valid"]);
  const headers = JSON.stringify({ "cf-connecting-ip": "203.0.113.77" });
  for (let attempt = 0; attempt < 30; attempt += 1) await validate(`GUESS${attempt}A`, cart([CABLE]), { headers });
  await assert.rejects(validate("GUESS-LAST", cart([CABLE]), { headers }), /rate_limited/);
  assert.equal((await validate("LEAK-CHECK", cart([CABLE]), { headers: JSON.stringify({ "cf-connecting-ip": "203.0.113.78" }) })).valid, true);
});

test("an invalid cart is reported without pricing", async () => {
  await createCoupon({ code: "CART-CHECK", discount_value: 10 });
  for (const lines of ["[]", cart([CABLE], [CABLE]), JSON.stringify([{ variant_id: CABLE, quantity: 0 }]),
    JSON.stringify([{ variant_id: "00000000-0000-4000-8000-000000000000", quantity: 1 }])])
    assert.equal((await validate("CART-CHECK", lines)).reason, "cart_invalid");
});

// --- Frontend helpers (display/validation only).
test("27. code helpers canonicalise, validate and generate safe professional codes", () => {
  assert.equal(canonicalCouponCode("  save10-x7k2 "), "SAVE10-X7K2");
  assert.equal(isValidCouponCode(" save10 "), true);
  for (const bad of ["", "  ", "AB", "BAD CODE", "BAD!", "-X12", "X".repeat(33)]) assert.equal(isValidCouponCode(bad), false, bad);
  let seed = 0;
  const random = () => ((seed = (seed * 9301 + 49297) % 233280) / 233280);
  for (let index = 0; index < 200; index += 1) {
    const code = generateCouponCode("", "SAVE10", random);
    assert.match(code, /^SAVE10-[A-HJKMNP-Z2-9]{4}$/);
    assert.equal(isValidCouponCode(code), true);
  }
  assert.match(generateCouponCode("eid500", "SAVE", random), /^EID500-[A-Z2-9]{4}$/);
  assert.match(generateCouponCode("WELCOME-OLD1", "SAVE", random), /^WELCOME-[A-Z2-9]{4}$/);
  assert.equal(suggestedCouponPrefix("percentage", "10"), "SAVE10");
  assert.equal(suggestedCouponPrefix("fixed_amount", "500"), "SAVE500");
  assert.equal(suggestedCouponPrefix("free_shipping", ""), "FREESHIP");
});

test("status, value labels and customer messages", () => {
  const now = new Date("2026-10-05T12:00:00Z");
  assert.equal(couponStatus({ is_active: false, starts_at: null, ends_at: null }, now), "disabled");
  assert.equal(couponStatus({ is_active: true, starts_at: "2026-10-06T00:00:00Z", ends_at: null }, now), "scheduled");
  assert.equal(couponStatus({ is_active: true, starts_at: null, ends_at: "2026-10-05T11:00:00Z" }, now), "expired");
  assert.equal(couponStatus({ is_active: true, starts_at: "2026-10-01T00:00:00Z", ends_at: "2026-10-30T00:00:00Z" }, now), "active");
  assert.equal(describeCouponValue({ discount_type: "percentage", discount_value: 10, maximum_discount_minor: 50_000 }), "10% off · max Rs 500");
  assert.equal(describeCouponValue({ discount_type: "fixed_amount", discount_value: 50_000, maximum_discount_minor: null }), "Rs 500 off");
  assert.equal(describeCouponValue({ discount_type: "free_shipping", discount_value: null, maximum_discount_minor: null }), "Free shipping");
  assert.deepEqual(["ok", "coupon_invalid", "coupon_inactive", "coupon_not_started", "coupon_expired", "coupon_minimum_not_met",
    "coupon_usage_limit_reached", "coupon_customer_limit_reached", "coupon_not_applicable"].map(couponReasonMessage),
  ["Coupon applied", "Invalid coupon", "Invalid coupon", "Coupon not active yet", "Coupon expired", "Minimum order not met",
    "Usage limit reached", "Usage limit reached", "Coupon not valid for these products"]);
  assert.equal(couponReasonFromError('new row ... P0001: coupon_expired'), "coupon_expired");
  assert.equal(couponReasonFromError("variant_out_of_stock"), null);
});

test("Admin form validation mirrors the database rules and builds the row to save", () => {
  const base = { ...couponFormValuesFrom(null), code: " save10 ", name: "Ten percent", discountValue: "10" };
  const ok = buildCouponPayload(base);
  assert.equal(ok.ok, true);
  assert.deepEqual([ok.payload.code, ok.payload.discount_value, ok.payload.applies_to, ok.payload.is_active], ["SAVE10", 10, "all", true]);
  const fixed = buildCouponPayload({ ...base, discountType: "fixed_amount", discountValue: "500", maximumDiscount: "100", minimumOrder: "2,000" });
  assert.deepEqual([fixed.payload.discount_value, fixed.payload.maximum_discount_minor, fixed.payload.minimum_order_minor], [50_000, null, 200_000]);
  const free = buildCouponPayload({ ...base, discountType: "free_shipping", discountValue: "99" });
  assert.equal(free.payload.discount_value, null);
  const invalid = buildCouponPayload({ ...base, code: "a b", name: " ", discountValue: "0", startsAt: "2026-10-10T10:00", endsAt: "2026-10-09T10:00",
    totalUsageLimit: "0", appliesTo: "category" });
  assert.equal(invalid.ok, false);
  assert.deepEqual(Object.keys(invalid.errors).sort(), ["categoryId", "code", "discountValue", "endsAt", "name", "totalUsageLimit"]);
  assert.equal(buildCouponPayload({ ...base, discountValue: "101" }).ok, false);
  assert.equal(buildCouponPayload({ ...base, discountType: "fixed_amount", discountValue: "-5" }).ok, false);
  assert.equal(buildCouponPayload({ ...base, maximumDiscount: "0" }).ok, false);
});
