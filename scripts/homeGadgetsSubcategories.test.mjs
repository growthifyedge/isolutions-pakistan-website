// Home Gadgets subcategories (migration 202611090001) — replayed in an in-memory PGlite database only, with hosted
// Supabase's default grants. Never touches DEV or PROD.
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createCatalogTestDatabase, signInAsOwner } from "./support/catalogTestDatabase.mjs";
import { HOME_GADGET_SUBCATEGORIES } from "../src/lib/homeGadgetSubcategories.ts";

const db = await createCatalogTestDatabase({ supabaseDefaultPrivileges: true });
const ownerId = await signInAsOwner(db);
const one = async (sql, params = []) => (await db.query(sql, params)).rows[0];
const all = async (sql, params = []) => (await db.query(sql, params)).rows;

const variant = (overrides = {}) => ({
  source: "row", sku: null, ram: null, storage: null, color: null, price_minor: 79_800, compare_at_price_minor: null, stock: 30,
  pta_status: "not_applicable", condition: "brand_new", condition_grade: null, battery_health_percent: null, battery_cycle_count: null,
  sim_configuration: null, warranty: null, delivery_scope: "nationwide", ...overrides,
});
const gadget = (title) => ({ action: "Create", source: title, product_type: "Gadget", brand: null, title, category: "Gadgets", specifications: [], variants: [variant()] });
const accessory = (title) => ({ action: "Create", source: title, product_type: "Accessory", brand: "Samsung", title, category: "Accessories",
  specifications: [], variants: [variant({ warranty: "1 Year" })] });

const TITLES = ["SUB Spice Rack", "SUB Lunch Box", "SUB Travel Pouch", "SUB Draft Stool", "SUB Unassigned Gadget"];
await db.query(`select public.apply_catalog_bulk_import_v2($1::jsonb)`, [JSON.stringify({ products: [...TITLES.map(gadget), accessory("SUB Phone Case")] })]);
const product = async (title) => one(`select p.id, v.sku from public.products p join public.product_variants v on v.product_id = p.id where p.title = $1`, [title]);
const P = Object.fromEntries(await Promise.all([...TITLES, "SUB Phone Case"].map(async (title) => [title, await product(title)])));
let mediaCount = 0;
for (const title of [...TITLES, "SUB Phone Case"]) {
  mediaCount += 1;
  await db.query(`insert into public.product_media (product_id, cloudinary_public_id, cloudinary_asset_id, cloudinary_version, secure_url, width, height, bytes, format, alt_text, is_primary)
    values ($1, $2, $2, 1, 'https://res.cloudinary.com/test/image/upload/' || $2, 800, 800, 1000, 'jpg', $3, true)`, [P[title].id, `test/sub-${mediaCount}`, title]);
}
// Everything published except the draft stool.
for (const title of [...TITLES.filter((t) => t !== "SUB Draft Stool"), "SUB Phone Case"])
  await db.query(`update public.products set publication_status = 'published' where id = $1`, [P[title].id]);

const customerId = (await one(`insert into auth.users (email) values ('sub-customer@example.test') returning id`)).id;
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
const assign = (rows) => one(`select public.admin_assign_product_subcategories($1::jsonb) as r`, [JSON.stringify(rows)]);
const subOf = async (title) => (await one(`select sc.slug from public.products p left join public.product_subcategories sc on sc.id = p.subcategory_id where p.id = $1`, [P[title].id])).slug;
const snapshot = async () => all(`select p.id, p.title, p.slug, p.category_id, p.brand_id, p.publication_status, p.published_at, p.content, p.short_description,
    (select jsonb_agg(jsonb_build_object('sku', v.sku, 'price', v.price_minor, 'active', v.is_active) order by v.sku) from public.product_variants v where v.product_id = p.id) as variants,
    (select coalesce(sum(m.quantity_delta), 0) from public.inventory_movements m join public.product_variants v on v.id = m.variant_id where v.product_id = p.id) as stock,
    (select count(*) from public.product_media m where m.product_id = p.id) as media
  from public.products p order by p.id`);
const search = (args = "") => all(`select title, subcategory from public.search_public_catalog(${args}) order by title`);

test("seeds exactly the 10 Owner-approved subcategories under gadgets, matching the storefront list", async () => {
  const rows = await all(`select sc.name, sc.slug, sc.sort_order, sc.is_active, c.slug as category
    from public.product_subcategories sc join public.categories c on c.id = sc.category_id order by sc.sort_order`);
  assert.deepEqual(rows.map((r) => ({ name: r.name, slug: r.slug })), HOME_GADGET_SUBCATEGORIES.map((s) => ({ name: s.name, slug: s.slug })));
  assert.deepEqual(rows.map((r) => r.sort_order), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  assert.ok(rows.every((r) => r.is_active && r.category === "gadgets"));
  // The gadgets category itself is untouched.
  const gadgets = await one(`select name, slug, is_active, parent_id from public.categories where slug = 'gadgets'`);
  assert.deepEqual(gadgets, { name: "Gadgets", slug: "gadgets", is_active: true, parent_id: null });
});

test("the migration assigns nothing: every product starts with subcategory_id NULL", async () => {
  assert.equal(Number((await one(`select count(*) as n from public.products where subcategory_id is not null`)).n), 0);
});

test("a subcategory's parent must be gadgets", async () => {
  await assert.rejects(db.query(`insert into public.product_subcategories (category_id, name, slug)
    select id, 'Bad', 'bad-parent' from public.categories where slug = 'mobile-accessories'`), /product_subcategories_parent_must_be_gadgets/);
  await assert.rejects(db.query(`update public.product_subcategories set category_id = (select id from public.categories where slug = 'mobile-phones')
    where slug = 'kitchen-dining'`), /product_subcategories_parent_must_be_gadgets/);
});

test("referential integrity: own category only, no category move while assigned, used subcategory cannot be deleted", async () => {
  const kitchen = (await one(`select id from public.product_subcategories where slug = 'kitchen-dining'`)).id;
  // A Mobile Accessories product cannot point at a gadgets subcategory.
  await assert.rejects(db.query(`update public.products set subcategory_id = $1 where id = $2`, [kitchen, P["SUB Phone Case"].id]), /products_subcategory_same_category_fkey/);
  await assert.rejects(db.query(`update public.products set subcategory_id = gen_random_uuid() where id = $1`, [P["SUB Lunch Box"].id]), /products_subcategory_same_category_fkey/);
  await db.query(`update public.products set subcategory_id = $1 where id = $2`, [kitchen, P["SUB Lunch Box"].id]);
  await assert.rejects(db.query(`update public.products set category_id = (select id from public.categories where slug = 'mobile-accessories') where id = $1`, [P["SUB Lunch Box"].id]),
    /products_subcategory_same_category_fkey/);
  await assert.rejects(db.query(`delete from public.product_subcategories where id = $1`, [kitchen]), /products_subcategory_same_category_fkey/);
  await db.query(`update public.products set subcategory_id = null where id = $1`, [P["SUB Lunch Box"].id]);
});

test("RLS: visitors read active rows only; nobody but migrations writes the list", async () => {
  await db.query(`update public.product_subcategories set is_active = false where slug = 'kids-toys'`);
  try {
    for (const [role, userId] of [["anon", null], ["authenticated", customerId], ["authenticated", ownerId]]) {
      await as(role, userId, async () => {
        const slugs = (await all(`select slug from public.product_subcategories order by sort_order`)).map((r) => r.slug);
        if (userId === ownerId) assert.equal(slugs.length, 10);
        else assert.deepEqual(slugs, HOME_GADGET_SUBCATEGORIES.map((s) => s.slug).filter((s) => s !== "kids-toys"));
        await assert.rejects(db.query(`insert into public.product_subcategories (category_id, name, slug) select id, 'X', 'x-sub' from public.categories where slug = 'gadgets'`), /permission denied/);
        await assert.rejects(db.query(`update public.product_subcategories set name = 'Renamed' where slug = 'home-living'`), /permission denied/);
        await assert.rejects(db.query(`delete from public.product_subcategories where slug = 'home-living'`), /permission denied/);
      });
    }
    const rls = await one(`select relrowsecurity from pg_class where oid = 'public.product_subcategories'::regclass`);
    assert.equal(rls.relrowsecurity, true);
  } finally {
    await db.query(`update public.product_subcategories set is_active = true where slug = 'kids-toys'`);
  }
});

test("Admin RPC: visitors and customers are refused; anon cannot even execute it", async () => {
  const anonExec = await one(`select has_function_privilege('anon', 'public.admin_assign_product_subcategories(jsonb)', 'EXECUTE') as ok`);
  assert.equal(anonExec.ok, false);
  await as("anon", null, async () => {
    await assert.rejects(assign([{ sku: P["SUB Spice Rack"].sku, subcategory: "kitchen-dining" }]), /permission denied/);
  });
  await as("authenticated", customerId, async () => {
    await assert.rejects(assign([{ sku: P["SUB Spice Rack"].sku, subcategory: "kitchen-dining" }]), /catalog_admin_required/);
  });
  assert.equal(await subOf("SUB Spice Rack"), null);
});

test("Admin RPC validates every row and writes nothing when any row is invalid", async () => {
  const before = await snapshot();
  const cases = [
    [[{ sku: "GD999", subcategory: "kitchen-dining" }], /SKU GD999 not found/],
    [[{ sku: P["SUB Spice Rack"].sku, subcategory: "" }], /has no subcategory/],
    [[{ sku: P["SUB Spice Rack"].sku, subcategory: "garden" }], /subcategory garden not found/],
    [[{ sku: P["SUB Phone Case"].sku, subcategory: "kitchen-dining" }], /is not in the category of subcategory/],
    [[{ sku: P["SUB Spice Rack"].sku, subcategory: "kitchen-dining" }, { sku: P["SUB Spice Rack"].sku.toLowerCase(), subcategory: "kitchen-dining" }], /appears more than once/],
    [[{ sku: P["SUB Spice Rack"].sku, subcategory: "kitchen-dining", expected_current: "home-living" }], /changed after the preview/],
    // One bad row among good ones: the good rows are not saved either.
    [[{ sku: P["SUB Spice Rack"].sku, subcategory: "kitchen-dining" }, { sku: "GD999", subcategory: "kitchen-dining" }], /SKU GD999 not found/],
    [[], /subcategory_assignments_required/],
  ];
  for (const [rows, error] of cases) await assert.rejects(assign(rows), error);
  await db.query(`update public.product_subcategories set is_active = false where slug = 'kids-toys'`);
  await assert.rejects(assign([{ sku: P["SUB Spice Rack"].sku, subcategory: "kids-toys" }]), /is not active/);
  await db.query(`update public.product_subcategories set is_active = true where slug = 'kids-toys'`);
  assert.deepEqual(await snapshot(), before);
  assert.equal(Number((await one(`select count(*) as n from public.products where subcategory_id is not null`)).n), 0);
});

test("Admin RPC saves only subcategory_id; published products stay published and drafts stay drafts", async () => {
  const before = await snapshot();
  const result = (await assign([
    { sku: P["SUB Spice Rack"].sku, subcategory: "kitchen-dining", expected_current: null },
    { sku: P["SUB Lunch Box"].sku, subcategory: "Kitchen-Dining" },
    { sku: P["SUB Travel Pouch"].sku, subcategory: "bags-travel" },
    { sku: P["SUB Draft Stool"].sku, subcategory: "sports-outdoors" },
  ])).r;
  assert.deepEqual(result, { total: 4, updated: 4, unchanged: 0 });
  assert.deepEqual(await snapshot(), before, "no other product column, variant, stock or media changed");
  assert.equal(await subOf("SUB Spice Rack"), "kitchen-dining");
  assert.equal(await subOf("SUB Draft Stool"), "sports-outdoors");
  assert.equal(await subOf("SUB Unassigned Gadget"), null);
  // Same file again: nothing changes.
  const again = (await assign([{ sku: P["SUB Spice Rack"].sku, subcategory: "kitchen-dining", expected_current: "kitchen-dining" }])).r;
  assert.deepEqual(again, { total: 1, updated: 0, unchanged: 1 });
});

test("search_public_catalog filters by subcategory and returns it; drafts never appear", async () => {
  await as("anon", null, async () => {
    const kitchen = await search(`p_subcategory_slugs => array['kitchen-dining']`);
    assert.deepEqual(kitchen.map((r) => r.title), ["SUB Lunch Box", "SUB Spice Rack"]);
    assert.ok(kitchen.every((r) => r.subcategory.slug === "kitchen-dining" && r.subcategory.name === "Kitchen & Dining"));
    assert.deepEqual((await search(`p_subcategory_slugs => array['kitchen-dining','bags-travel']`)).map((r) => r.title), ["SUB Lunch Box", "SUB Spice Rack", "SUB Travel Pouch"]);
    // The draft stool has a subcategory but is never public.
    assert.deepEqual(await search(`p_subcategory_slugs => array['sports-outdoors']`), []);
    assert.deepEqual(await search(`p_subcategory_slugs => array['no-such-subcategory']`), []);
    // No subcategory filter: exactly the published set as before, unassigned products included (subcategory null).
    const everything = await search(`p_category_slugs => array['gadgets']`);
    assert.deepEqual(everything.map((r) => r.title), ["SUB Lunch Box", "SUB Spice Rack", "SUB Travel Pouch", "SUB Unassigned Gadget"]);
    assert.equal(everything.find((r) => r.title === "SUB Unassigned Gadget").subcategory, null);
    assert.equal((await search(`p_subcategory_slugs => array['kitchen-dining'], p_category_slugs => array['mobile-accessories']`)).length, 0);
  });
  // Old 13-argument calls (current storefront, no subcategory) still resolve to the new function.
  await as("anon", null, async () => {
    const rows = await all(`select title from public.search_public_catalog(null, null, array['gadgets'], null, null, null, null, null, null, null, null, 48, 0) order by title`);
    assert.equal(rows.length, 4);
  });
  // An inactive subcategory is neither returned nor filterable.
  await db.query(`update public.product_subcategories set is_active = false where slug = 'bags-travel'`);
  await as("anon", null, async () => {
    assert.deepEqual(await search(`p_subcategory_slugs => array['bags-travel']`), []);
    assert.equal((await search(`p_search => 'Travel Pouch'`))[0].subcategory, null);
  });
  await db.query(`update public.product_subcategories set is_active = true where slug = 'bags-travel'`);
});

test("assigning a subcategory never re-validates or unpublishes (publication trigger is not involved)", async () => {
  const fn = await one(`select pg_get_functiondef('public.validate_product_for_publication(uuid)'::regprocedure) as d`);
  assert.equal(/subcategory/.test(fn.d), false);
  const trigger = await one(`select pg_get_triggerdef(t.oid) as d from pg_trigger t where t.tgname = 'products_enforce_publication'`);
  assert.match(trigger.d, /UPDATE OF publication_status/);
  const statuses = await all(`select title, publication_status from public.products where title like 'SUB %' order by title`);
  assert.deepEqual(statuses.find((r) => r.title === "SUB Draft Stool").publication_status, "draft");
  assert.ok(statuses.filter((r) => r.title !== "SUB Draft Stool").every((r) => r.publication_status === "published"));
});

test("RPC grants: search_public_catalog stays public; the assignment RPC is for signed-in admins only", async () => {
  const exec = async (role, signature) => (await one(`select has_function_privilege($1, $2, 'EXECUTE') as ok`, [role, signature])).ok;
  const search14 = "public.search_public_catalog(text,text,text[],text[],bigint,bigint,text[],text[],public.pta_status[],boolean,public.delivery_scope[],integer,integer,text[])";
  assert.equal(await exec("anon", search14), true);
  assert.equal(await exec("authenticated", search14), true);
  assert.equal(await exec("anon", "public.admin_assign_product_subcategories(jsonb)"), false);
  assert.equal(await exec("authenticated", "public.admin_assign_product_subcategories(jsonb)"), true);
  // Only one search_public_catalog exists (no ambiguous overload left behind).
  assert.equal(Number((await one(`select count(*) as n from pg_proc where proname = 'search_public_catalog'`)).n), 1);
  const definer = await one(`select prosecdef, proconfig from pg_proc where proname = 'admin_assign_product_subcategories'`);
  assert.equal(definer.prosecdef, true);
  assert.deepEqual(definer.proconfig, ['search_path=""']);
});

test("storefront RPC parameters: p_subcategory_slugs is sent only when a subcategory is chosen", () => {
  // catalog.ts imports the browser Supabase client, so its source is checked instead of importing it.
  const source = readFileSync(new URL("../src/lib/catalog.ts", import.meta.url), "utf8");
  assert.match(source, /\.\.\.\(filters\.subcategories\?\.length \? \{ p_subcategory_slugs: filters\.subcategories \} : \{\}\)/);
  assert.equal((source.match(/p_subcategory_slugs/g) ?? []).length, 1);
});

test("the migration is additive and assigns no product data", () => {
  const sql = readFileSync(new URL("../supabase/migrations/202611090001_home_gadgets_subcategories.sql", import.meta.url), "utf8")
    .replace(/--.*$/gm, "");
  assert.equal(/update\s+public\.products\s+set\s+(?!subcategory_id)/i.test(sql), false);
  assert.equal(/delete\s+from\s+public\.products/i.test(sql), false);
  assert.equal(/publication_status\s*=/i.test(sql.replace(/p\.publication_status = 'published'/g, "")), false);
});
