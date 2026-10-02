// Pre-deploy RLS / privilege audit against the replayed migrations (never the live database),
// with hosted Supabase's default grants (anon/authenticated get ALL on new public objects), so
// only RLS policies, explicit revokes and in-function admin checks stand between visitors and
// the data. Covers: anonymous visitors, signed-in non-admin customers, inactive admins, Owner.
import assert from "node:assert/strict";
import test from "node:test";
import { createCatalogTestDatabase, signInAsOwner } from "./support/catalogTestDatabase.mjs";

const db = await createCatalogTestDatabase({ supabaseDefaultPrivileges: true });
const ownerId = await signInAsOwner(db);

const one = async (sql, params = []) => (await db.query(sql, params)).rows[0];
const all = async (sql, params = []) => (await db.query(sql, params)).rows;

// --- Fixtures: imported as drafts, then some published like Admin does.
const variant = (overrides = {}) => ({
  source: "row", sku: null, ram: null, storage: null, color: "Black",
  price_minor: 100_000, compare_at_price_minor: null, stock: 10,
  pta_status: "not_applicable", condition: "brand_new", condition_grade: null,
  battery_health_percent: null, battery_cycle_count: null, sim_configuration: null,
  warranty: "1 Year", delivery_scope: "nationwide", ...overrides,
});
const product = (title, overrides = {}) => ({
  action: "Create", source: title, product_type: "Accessory", brand: "Samsung", title,
  category: "Accessories", specifications: [{ group: "General", label: "Material", value: "TEST" }],
  variants: [variant()], ...overrides,
});
await db.query(`select public.apply_catalog_bulk_import_v2($1::jsonb)`, [JSON.stringify({ products: [
  product("SEC Published Case", { variants: [variant(), variant({ color: "Blue" })] }),
  product("SEC Draft Case"),
] })]);

let media = 0;
async function addMedia(productId, title) {
  media += 1;
  return (await one(`insert into public.product_media (product_id, cloudinary_public_id, cloudinary_asset_id, cloudinary_version,
      secure_url, width, height, bytes, format, alt_text, is_primary)
    values ($1, $2, $2, 1, 'https://res.cloudinary.com/test/image/upload/' || $2, 800, 800, 1000, 'jpg', $3, true) returning id`,
  [productId, `test/sec-${media}`, title])).id;
}
const productId = async (title) => (await one(`select id from public.products where title = $1`, [title])).id;
const PUBLISHED = await productId("SEC Published Case");
const DRAFT = await productId("SEC Draft Case");
const PUBLISHED_MEDIA = await addMedia(PUBLISHED, "SEC Published Case");
const DRAFT_MEDIA = await addMedia(DRAFT, "SEC Draft Case");
await db.query(`update public.products set publication_status = 'published', is_featured = true where id = $1`, [PUBLISHED]);
// The draft is marked featured and recommended, so every public RPC has a chance to leak it.
await db.query(`update public.products set is_featured = true where id = $1`, [DRAFT]);
await db.query(`insert into public.product_recommendations (source_product_id, recommended_product_id, relation_type, sort_order, is_active)
  values ($1, $2, 'frequently_bought_together', 1, true)`, [PUBLISHED, DRAFT]);
// One hidden (inactive) variant on the published product.
const HIDDEN_VARIANT = (await one(`update public.product_variants set is_active = false
  where id = (select id from public.product_variants where product_id = $1 and color_finish = 'Blue') returning id`, [PUBLISHED])).id;
const PUBLISHED_VARIANT = (await one(`select id from public.product_variants where product_id = $1 and is_active`, [PUBLISHED])).id;
const DRAFT_VARIANT = (await one(`select id from public.product_variants where product_id = $1`, [DRAFT])).id;

// --- Sessions.
const newUser = async (email) => (await one(`insert into auth.users (email) values ($1) returning id`, [email])).id;
const customerId = await newUser("customer@example.test");
const inactiveAdminId = await newUser("inactive-admin@example.test");
await db.query(`update public.profiles set role = 'admin', is_active = false where id = $1`, [inactiveAdminId]);

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
const VISITORS = [["anon", null], ["authenticated", customerId], ["authenticated", inactiveAdminId]];
const label = (role, userId) => (userId === customerId ? "customer" : userId === inactiveAdminId ? "inactive admin" : role);

/** The statement must either be refused or touch/return no rows. */
async function blocked(sql, params = []) {
  try {
    const { rows } = await db.query(sql, params);
    assert.deepEqual(rows, [], `expected no rows from: ${sql}`);
  } catch (error) {
    if (error instanceof assert.AssertionError) throw error;
    assert.match(error.message, /permission denied|row-level security|catalog_admin_required/, sql);
  }
}

const PRIVATE_TABLES = ["orders", "order_items", "inventory_movements", "contact_messages", "newsletter_subscribers",
  "product_recommendations", "bundles", "bundle_items", "product_media_variant_assignments"];
const ALL_TABLES = (await all(`select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind in ('r', 'p') order by 1`)).map((r) => r.relname);
const rowCounts = async () => Object.fromEntries(await Promise.all(ALL_TABLES.map(async (t) =>
  [t, Number((await one(`select count(*) as n from public.${t}`)).n)])));

test("every public table has RLS; every view runs as the caller", async () => {
  const unprotected = await all(`select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('r', 'p') and not c.relrowsecurity`);
  assert.deepEqual(unprotected, []);
  const definerViews = await all(`select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('v', 'm')
      and not coalesce(c.reloptions @> array['security_invoker=true'], false)`);
  assert.deepEqual(definerViews, []);
});

test("every SECURITY DEFINER function pins an empty search_path", async () => {
  const unsafe = await all(`select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prosecdef and not coalesce(p.proconfig @> array['search_path=""'], false)`);
  assert.deepEqual(unsafe, []);
});

test("SECURITY DEFINER RPCs callable by visitors are exactly the reviewed set", async () => {
  const callable = async (role) => (await all(`select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prosecdef and p.prorettype <> 'trigger'::regtype
      and has_function_privilege($1, p.oid, 'EXECUTE') order by 1`, [role])).map((r) => r.proname);
  // Public storefront RPCs, plus admin RPCs that refuse non-admins themselves (catalog_admin_required).
  const reviewed = ["create_storefront_order", "delete_product_variant", "frequently_bought_together", "homepage_bundles",
    "homepage_featured_products", "is_catalog_admin", "public_catalog_taxonomy", "search_public_catalog",
    "set_product_media_color_assignment", "submit_contact_message", "subscribe_newsletter"];
  assert.deepEqual(await callable("anon"), reviewed);
  assert.deepEqual(await callable("authenticated"),
    [...reviewed, "apply_catalog_bulk_import", "apply_catalog_bulk_import_v2"].sort());
});

test("visitors, customers and inactive admins cannot read Admin, order, stock or contact data", async () => {
  await db.query(`select public.submit_contact_message('SEC', 'sec@example.test', null, 'hello')`);
  for (const [role, userId] of VISITORS) {
    await as(role, userId, async () => {
      for (const table of PRIVATE_TABLES) await blocked(`select * from public.${table}`);
      // The view runs as the caller: at most the publicly visible variants, with no stock behind them.
      for (const row of await all(`select variant_id, quantity_on_hand from public.admin_variant_inventory`).catch(() => []))
        assert.deepEqual([row.variant_id, Number(row.quantity_on_hand)], [PUBLISHED_VARIANT, 0], label(role, userId));
      // Stock levels are not readable directly (anon: refused; signed-in non-admin: RLS hides every movement).
      if (role === "anon") await blocked(`select public.current_inventory($1)`, [PUBLISHED_VARIANT]);
      else assert.equal(Number((await one(`select public.current_inventory($1) as n`, [PUBLISHED_VARIANT])).n), 0, label(role, userId));
      assert.equal((await one(`select public.is_catalog_admin() as a`)).a, false, label(role, userId));
    });
  }
  await as("authenticated", customerId, async () => {
    assert.deepEqual(await all(`select id, role from public.profiles`), [{ id: customerId, role: null }]);
  });
});

test("draft products, hidden variants and their media/specs never reach the public storefront", async () => {
  for (const [role, userId] of VISITORS) {
    await as(role, userId, async () => {
      const who = label(role, userId);
      assert.deepEqual((await all(`select id from public.products`)).map((r) => r.id), [PUBLISHED], who);
      assert.deepEqual((await all(`select id from public.product_variants`)).map((r) => r.id), [PUBLISHED_VARIANT], who);
      assert.deepEqual((await all(`select id from public.product_media`)).map((r) => r.id), [PUBLISHED_MEDIA], who);
      assert.deepEqual((await all(`select distinct product_id from public.product_specifications`)).map((r) => r.product_id), [PUBLISHED], who);

      const search = await all(`select id, variants from public.search_public_catalog()`);
      assert.deepEqual(search.map((r) => r.id), [PUBLISHED], who);
      assert.deepEqual(search[0].variants.map((v) => v.id), [PUBLISHED_VARIANT], who);
      const featured = await all(`select id, variants from public.homepage_featured_products(12)`);
      assert.deepEqual(featured.map((r) => r.id), [PUBLISHED], who);
      assert.deepEqual(featured[0].variants.map((v) => v.id), [PUBLISHED_VARIANT], who);
      assert.deepEqual(await all(`select id from public.frequently_bought_together($1, 4)`, [PUBLISHED]), [], who);
      assert.deepEqual(await all(`select id from public.homepage_bundles(12)`), [], who);
    });
  }
  // The draft slug is invisible to the visitor, so probe it with the slug read as Owner.
  const draftSlug = (await one(`select slug from public.products where id = $1`, [DRAFT])).slug;
  await as("anon", null, async () => {
    assert.deepEqual(await all(`select id from public.search_public_catalog(p_slug => $1)`, [draftSlug]), []);
  });
  // A draft-only brand never appears in the public taxonomy.
  await db.query(`insert into public.brands (name, slug, data_class, is_active) values ('SEC Draft Brand', 'sec-draft-brand', 'real', true)`);
  await db.query(`update public.products set brand_id = (select id from public.brands where slug = 'sec-draft-brand') where id = $1`, [DRAFT]);
  await as("anon", null, async () => {
    const taxonomy = (await one(`select public.public_catalog_taxonomy() as t`)).t;
    assert.ok(!taxonomy.brands.some((b) => b.slug === "sec-draft-brand"));
  });
});

test("visitors cannot change catalog, stock, media, orders, profiles or inquiries (tables and RPCs)", async () => {
  const placed = await as("anon", null, async () => one(
    `select * from public.create_storefront_order('SEC Buyer', '03000000000', null, 'Karachi', null, 'SEC Address', null, null,
      'cash_on_delivery', 'standard', $1::jsonb)`, [JSON.stringify([{ variant_id: PUBLISHED_VARIANT, quantity: 1 }])]));
  const before = await rowCounts();
  const snapshot = async () => ({
    product: await one(`select title, publication_status, is_featured from public.products where id = $1`, [PUBLISHED]),
    draft: await one(`select publication_status from public.products where id = $1`, [DRAFT]),
    variant: await one(`select price_minor, is_active, sku from public.product_variants where id = $1`, [PUBLISHED_VARIANT]),
    stock: Number((await one(`select public.current_inventory($1) as n`, [PUBLISHED_VARIANT])).n),
    order: await one(`select status, total_minor from public.orders where id = $1`, [placed.order_id]),
    media: await one(`select is_primary, sort_order from public.product_media where id = $1`, [PUBLISHED_MEDIA]),
    roles: await all(`select id, role, is_active from public.profiles order by id`),
  });
  const expected = await snapshot();

  for (const [role, userId] of VISITORS) {
    await as(role, userId, async () => {
      // Catalog.
      await blocked(`update public.products set title = 'HACKED', publication_status = 'published' returning id`);
      await blocked(`update public.product_variants set price_minor = 1, is_active = true returning id`);
      await blocked(`delete from public.product_variants returning id`);
      await blocked(`delete from public.products returning id`);
      await blocked(`update public.categories set name = 'HACKED' returning id`);
      await blocked(`update public.brands set name = 'HACKED' returning id`);
      await blocked(`delete from public.product_media returning id`);
      await blocked(`update public.product_specifications set value = 'HACKED' returning id`);
      await blocked(`insert into public.products (title, slug, category_id, data_class)
        select 'HACKED', 'hacked', id, 'real' from public.categories limit 1 returning id`);
      await blocked(`insert into public.brands (name, slug, data_class, is_active) values ('HACKED', 'hacked', 'real', true) returning id`);
      await blocked(`insert into public.product_media_variant_assignments (media_id, variant_id) values ($1, $2) returning media_id`,
        [PUBLISHED_MEDIA, PUBLISHED_VARIANT]);
      // Stock.
      await blocked(`insert into public.inventory_movements (variant_id, quantity_delta, reason, actor_id)
        values ($1, 1000, 'correction', $2) returning id`, [PUBLISHED_VARIANT, userId]);
      await blocked(`delete from public.inventory_movements returning id`);
      // Orders.
      await blocked(`update public.orders set status = 'cancelled' returning id`);
      await blocked(`delete from public.orders returning id`);
      await blocked(`update public.order_items set unit_price_minor = 0 returning id`);
      // Profiles: no self-promotion.
      await blocked(`update public.profiles set role = 'owner', is_active = true returning id`);
      await blocked(`insert into public.profiles (id, role) values (gen_random_uuid(), 'owner') returning id`);
      // Inquiries / newsletter: write-only through their RPCs.
      await blocked(`update public.contact_messages set message = 'HACKED' returning id`);
      await blocked(`delete from public.newsletter_subscribers returning id`);
      // Admin RPCs.
      await blocked(`select public.apply_catalog_bulk_import_v2('{"products": []}'::jsonb)`);
      await blocked(`select public.apply_catalog_bulk_import('{"products": []}'::jsonb)`);
      await blocked(`select public.delete_product_variant($1)`, [PUBLISHED_VARIANT]);
      await blocked(`select public.set_product_media_color_assignment($1, 'Black')`, [PUBLISHED_MEDIA]);
      await blocked(`select public.next_catalog_sku('ACC')`);
      await db.query(`select public.reorder_product_media($1, array[$2]::uuid[])`, [PUBLISHED, PUBLISHED_MEDIA]).catch(() => null);
      await db.query(`select public.set_product_media_primary($1)`, [DRAFT_MEDIA]).catch(() => null);
    });
  }

  assert.deepEqual(await rowCounts(), before);
  assert.deepEqual(await snapshot(), expected);
});

test("Owner keeps Admin access: catalog, stock, orders and inquiries", async () => {
  // As the signed-in Owner through the authenticated role, so RLS applies exactly as in Admin Studio.
  await as("authenticated", ownerId, async () => {
    assert.equal((await one(`select public.is_catalog_admin() as a`)).a, true);
    assert.ok((await all(`select id from public.products`)).some((r) => r.id === DRAFT));
    assert.ok((await all(`select variant_id from public.admin_variant_inventory`)).some((r) => r.variant_id === HIDDEN_VARIANT));
    assert.ok((await all(`select id from public.contact_messages`)).length > 0);
    assert.ok((await all(`select id from public.order_items`)).length > 0);

    const stock = async () => Number((await one(`select public.current_inventory($1) as n`, [PUBLISHED_VARIANT])).n);
    const before = await stock();
    await db.query(`insert into public.inventory_movements (variant_id, quantity_delta, reason, actor_id) values ($1, 3, 'purchase', $2)`,
      [PUBLISHED_VARIANT, ownerId]);
    assert.equal(await stock(), before + 3);
    // Movements are attributed to the signed-in admin; another actor cannot be claimed.
    await assert.rejects(db.query(`insert into public.inventory_movements (variant_id, quantity_delta, reason, actor_id) values ($1, 1, 'purchase', $2)`,
      [PUBLISHED_VARIANT, customerId]), /row-level security/);

    const { id: orderId } = await one(`select id from public.orders order by created_at limit 1`);
    assert.deepEqual(await all(`update public.orders set status = 'confirmed' where id = $1 returning status`, [orderId]), [{ status: "confirmed" }]);
    assert.equal((await one(`update public.products set title = 'SEC Draft Case v2' where id = $1 returning title`, [DRAFT])).title, "SEC Draft Case v2");
    assert.equal(Number((await one(`select public.set_product_media_color_assignment($1, 'Black') as n`, [PUBLISHED_MEDIA])).n), 1);
  });
});
