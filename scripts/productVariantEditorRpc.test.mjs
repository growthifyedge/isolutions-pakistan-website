// apply_product_variant_edits (migration 202611240001): the REAL migration executed in an in-memory Postgres (PGlite).
// No DEV / PROD database is involved (see scripts/support/variantEditorTestDb.mjs).
import test from "node:test";
import assert from "node:assert/strict";
import { ADMIN, INACTIVE_OWNER, MIGRATION, OWNER, call, everything, expected, ids, makeDb, rejects, stockOf } from "./support/variantEditorTestDb.mjs";

test("Owner saves every kind of change at once; only the sent fields change; history and links kept", async () => {
  const db = await makeDb();
  const exp = await expected(db, ids.s26);
  const movementsBefore = (await db.query(`select * from public.inventory_movements order by id`)).rows;
  const result = await call(db, {
    product_id: ids.s26, expected: exp,
    updates: [
      { variant_id: ids.b256.id, changes: { price_minor: 38500000, compare_at_price_minor: 39900000 } },
      { variant_id: ids.v256.id, changes: { color_finish: "  Cobalt   Violet " } },
      { variant_id: ids.k512.id, changes: { warranty_override: "6 Months", pta_status: "not_approved" } },
      { variant_id: ids.v512.id, changes: { is_active: true, price_minor: 44000000 } },
    ],
    stock: [{ variant_id: ids.k512.id, from_stock: 7, to_stock: 12 }, { variant_id: ids.v256.id, from_stock: 6, to_stock: 0 }],
    adds: [{ ram_display: "12 GB", storage_display: "1 TB", color_finish: "Black", price_minor: 52000000, compare_at_price_minor: null, pta_status: "approved", condition: "brand_new", warranty_override: "1 Year", delivery_scope: "karachi_only", is_active: true, stock: 5 }],
  });
  assert.equal(result.status, "updated");
  assert.equal(result.stock_corrections, 2);
  const rows = Object.fromEntries((await db.query(`select * from public.product_variants where product_id = $1`, [ids.s26])).rows.map((row) => [row.id, row]));
  assert.deepEqual([Number(rows[ids.b256.id].price_minor), Number(rows[ids.b256.id].compare_at_price_minor)], [38500000, 39900000]);
  // Colour rename: the same row (id, SKU), its image link, stock history and order lines stay.
  assert.equal(rows[ids.v256.id].color_finish, "Cobalt Violet");
  assert.equal(rows[ids.v256.id].sku, ids.v256.sku);
  assert.equal((await db.query(`select count(*)::int as n from public.product_media_variant_assignments where variant_id = $1`, [ids.v256.id])).rows[0].n, 1);
  assert.deepEqual((await db.query(`select variant_id, sku_snapshot, variant_attributes_snapshot from public.order_items`)).rows, [{ variant_id: ids.v256.id, sku_snapshot: ids.v256.sku, variant_attributes_snapshot: { color: "Volt" } }]);
  assert.deepEqual([rows[ids.k512.id].warranty_override, rows[ids.k512.id].pta_status, rows[ids.k512.id].color_finish], ["6 Months", "not_approved", "Black"]);
  assert.deepEqual([rows[ids.v512.id].is_active, Number(rows[ids.v512.id].price_minor)], [true, 44000000]);
  assert.equal(await stockOf(db, ids.k512.id), 12);
  assert.equal(await stockOf(db, ids.v256.id), 0);
  // The stock ledger only grows: every earlier movement is untouched.
  const movementsAfter = (await db.query(`select * from public.inventory_movements order by id`)).rows;
  assert.deepEqual(movementsAfter.slice(0, movementsBefore.length), movementsBefore);
  const added_rows = movementsAfter.slice(movementsBefore.length).map((row) => [row.reason, row.quantity_delta, row.reference, row.actor_id]);
  assert.deepEqual(added_rows.sort((a, b) => `${a[0]}${a[1]}`.localeCompare(`${b[0]}${b[1]}`)), [
    ["correction", -6, "variant_editor", OWNER], ["correction", 5, "variant_editor", OWNER], ["initial", 5, "variant_editor", OWNER],
  ]);
  const added = Object.values(rows).find((row) => row.storage_display === "1 TB");
  assert.match(added.sku, /^MB[0-9]{3}$/);
  assert.equal(await stockOf(db, added.id), 5);
  // Untouched: the product row, images, specifications; the publication status stays published.
  assert.equal((await db.query(`select publication_status from public.products where id = $1`, [ids.s26])).rows[0].publication_status, "published");
});

test("Owner only: an Admin, an inactive Owner and an anonymous caller are refused", async () => {
  const db = await makeDb();
  const payload = { product_id: ids.s26, expected: await expected(db, ids.s26), updates: [{ variant_id: ids.b256.id, changes: { price_minor: 38500000 } }] };
  for (const user of [ADMIN, INACTIVE_OWNER, null]) await rejects(db, payload, /variant_editor_owner_required/, user);
  const grants = (await db.query(`select has_function_privilege('anon', 'public.apply_product_variant_edits(jsonb)', 'execute') as anon_exec, has_function_privilege('authenticated', 'public.variant_editor_field(text, jsonb, boolean)', 'execute') as helper_exec`)).rows[0];
  assert.deepEqual(grants, { anon_exec: false, helper_exec: false });
});

test("stale data: a changed price, stock (an order) or variant set since the page loaded refuses everything", async () => {
  const db = await makeDb();
  const exp = await expected(db, ids.s26);
  const payload = { product_id: ids.s26, expected: exp, updates: [{ variant_id: ids.b256.id, changes: { price_minor: 38500000 } }] };
  await db.query(`insert into public.inventory_movements (variant_id, quantity_delta, reason, reference) values ($1, -1, 'sale', 'order:2')`, [ids.k512.id]);
  await rejects(db, payload, /variant_editor_changed_since_load/);
  const fresh = await expected(db, ids.s26);
  await rejects(db, { ...payload, expected: { variants: fresh.variants.slice(1) } }, /different set of variants/);
  await rejects(db, { ...payload, expected: { variants: fresh.variants.map((v) => (v.id === ids.b256.id ? { ...v, color_finish: "Blk" } : v)) } }, /changed since the page loaded/);
  await rejects(db, { ...payload, expected: fresh, stock: [{ variant_id: ids.k512.id, from_stock: 7, to_stock: 9 }] }, /stock changed since the page loaded/);
});

test("duplicates are refused: a rename onto another colour, a RAM/storage change, a new row, spacing/case ignored", async () => {
  const db = await makeDb();
  const exp = await expected(db, ids.s26);
  const base = { product_id: ids.s26, expected: exp };
  await rejects(db, { ...base, updates: [{ variant_id: ids.v256.id, changes: { color_finish: "black" } }] }, /would be the same variant/);
  await rejects(db, { ...base, updates: [{ variant_id: ids.b256.id, changes: { storage_display: "512GB" } }] }, /would be the same variant/);
  const add = { ram_display: "12GB", storage_display: "256 gb", color_finish: "BLACK", price_minor: 1, pta_status: "approved", condition: "brand_new", warranty_override: "1 Year", delivery_scope: "karachi_only", stock: 0 };
  await rejects(db, { ...base, adds: [add] }, /would be the same variant/);
  const fresh = { ...add, color_finish: "Green" };
  await rejects(db, { ...base, adds: [fresh, { ...fresh, color_finish: " green " }] }, /New variant 1 and New variant 2 would be the same variant/);
  // A different PTA / condition is a different variant (allowed).
  await call(db, { ...base, adds: [{ ...add, pta_status: "not_approved", stock: 3 }] });
});

test("field rules: compare-at above price, no unknown PTA, Brand New / Used only, phones Karachi only, no other fields", async () => {
  const db = await makeDb();
  const base = { product_id: ids.s26, expected: await expected(db, ids.s26) };
  const one = (changes) => ({ ...base, updates: [{ variant_id: ids.b256.id, changes }] });
  await rejects(db, one({ compare_at_price_minor: 38950000 }), /compare-at price must be above the price/);
  await rejects(db, one({ price_minor: 40000000, compare_at_price_minor: 39000000 }), /compare-at price must be above the price/);
  await rejects(db, one({ pta_status: "unknown" }), /PTA must be/);
  await rejects(db, one({ condition: "refurbished" }), /Condition must be Brand New or Used/);
  await rejects(db, one({ delivery_scope: "nationwide" }), /Mobile phones are delivered in Karachi only/);
  await rejects(db, one({ sku: "MB999" }), /"sku" cannot be changed here/);
  await rejects(db, one({ price_minor: 0 }), /positive whole amount/);
  await rejects(db, one({ price_minor: 38950000 }), /price_minor is unchanged/);
  await rejects(db, one({}), /no change sent/);
  await rejects(db, { ...base, stock: [{ variant_id: ids.b256.id, from_stock: 7, to_stock: -1 }] }, /stock must be a whole number/);
  await rejects(db, { ...base, stock: [{ variant_id: ids.b256.id, from_stock: 7, to_stock: 100001 }] }, /cannot be more than 100000/);
  await rejects(db, { ...base, stock: [{ variant_id: ids.b256.id, to_stock: 9 }] }, /stock must be a whole number/);
  await rejects(db, { ...base, stock: [{ variant_id: ids.b256.id, from_stock: 7 }] }, /stock must be a whole number/);
  await rejects(db, { ...base, stock: [{ variant_id: ids.b256.id, from_stock: 7, to_stock: "9" }] }, /stock must be a whole number/);
  await rejects(db, { ...base, adds: [{ storage_display: "2 TB", color_finish: "Red", price_minor: 1, pta_status: "approved", condition: "brand_new", delivery_scope: "karachi_only" }] }, /opening stock must be a whole number/);
  await rejects(db, { ...base, adds: [{ storage_display: "2 TB", color_finish: "Red", price_minor: 1, stock: 1 }] }, /pta_status is missing/);
  // Tablets may be delivered nationwide.
  await call(db, { product_id: ids.tab, expected: await expected(db, ids.tab), updates: [{ variant_id: ids.tabGrey.id, changes: { delivery_scope: "nationwide" } }] });
});

test("a published product is never left unpublishable; a draft can be saved freely; development products are refused", async () => {
  const db = await makeDb();
  const base = { product_id: ids.s26, expected: await expected(db, ids.s26) };
  const activeIds = [ids.b256.id, ids.v256.id, ids.k512.id];
  await rejects(db, { ...base, updates: activeIds.map((id) => ({ variant_id: id, changes: { is_active: false } })) }, /variant_editor_unpublishable: .*active_variant_required/);
  await rejects(db, { ...base, updates: [{ variant_id: ids.b256.id, changes: { warranty_override: null } }] }, /variant_editor_unpublishable: .*variant_commercial_facts_unresolved/);
  // The tablet is a draft: hiding its only variant is allowed.
  await call(db, { product_id: ids.tab, expected: await expected(db, ids.tab), updates: [{ variant_id: ids.tabGrey.id, changes: { is_active: false } }] });
  await rejects(db, { product_id: ids.devPhone, expected: await expected(db, ids.devPhone), updates: [{ variant_id: ids.devBlack.id, changes: { price_minor: 1 } }] }, /variant_editor_not_real/);
});

test("the migration is additive: two functions, Owner check, no table / policy / grant change, no data written", () => {
  assert.match(MIGRATION, /if not public\.is_site_owner\(\) then/);
  assert.doesNotMatch(MIGRATION, /\b(alter|drop|truncate)\s+(table|policy|function|trigger|type)\b/i);
  assert.doesNotMatch(MIGRATION, /create\s+(table|policy|trigger)\b/i);
  assert.doesNotMatch(MIGRATION, /delete from/i);
  assert.doesNotMatch(MIGRATION, /grant (insert|update|delete|all) on/i);
  assert.equal((MIGRATION.match(/create or replace function public\./g) ?? []).length, 2);
  assert.match(MIGRATION, /revoke all on function public\.apply_product_variant_edits\(jsonb\) from public, anon;/);
  assert.match(MIGRATION, /revoke all on function public\.variant_editor_field\(text, jsonb, boolean\) from public, anon, authenticated;/);
  // Writes only happen inside the function body (nothing at migration time).
  const outside = MIGRATION.replace(/\$\$[\s\S]*?\$\$/g, "");
  assert.doesNotMatch(outside, /\b(insert into|update public)\b/i);
});
