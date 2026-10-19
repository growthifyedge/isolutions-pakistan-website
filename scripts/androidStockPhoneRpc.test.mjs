import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { createCatalogTestDatabase, signInAsOwner } from "./support/catalogTestDatabase.mjs";

// Executes the REAL per-phone migration in an in-memory Postgres (PGlite). No DEV / PROD database is involved.
// The catalog tables are the real column / constraint definitions (phase 3A + later column migrations), and the
// functions the RPC depends on (admin check, stock sum, SKU sequences + trigger, updated_at trigger) are read
// verbatim from their migration files, so the test exercises the same SKU and admin logic as the live database.

const MIGRATIONS = new URL("../supabase/migrations/", import.meta.url);
const read = (file) => readFileSync(new URL(file, MIGRATIONS), "utf8");
const MIGRATION = read("202610180001_android_stock_update_per_phone.sql");
// Follow-up: the same function with its eight error messages typed as text (see that file).
const MESSAGES_FIX = read("202610190001_android_stock_update_per_phone_messages.sql");

/** The text of `create [or replace] function public.<name>(` ... `$$;` from a migration file (fails loudly if absent). */
function extractFunction(file, name) {
  const source = read(file);
  const start = source.search(new RegExp(`create (or replace )?function public\\.${name}\\(`));
  assert.ok(start >= 0, `${name} not found in ${file}`);
  const end = source.indexOf("\n$$;", start);
  assert.ok(end > start, `end of ${name} not found in ${file}`);
  return source.slice(start, end + 4).replace(/^create function/, "create or replace function");
}

const SKU_FILE = "202609240003_catalog_sku_sequences.sql";
const FOUNDATION = "202608200004_phase_3a_full_foundation_rls_repair.sql";

const ADMIN = "00000000-0000-4000-8000-000000000001";
const INACTIVE_ADMIN = "00000000-0000-4000-8000-000000000002";
const NO_ROLE = "00000000-0000-4000-8000-000000000003";

async function makeDb() {
  const db = new PGlite();
  await db.exec(`
    create schema auth;
    create schema extensions;
    create table auth.users (id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    create function extensions.gen_random_uuid() returns uuid language sql as $$ select gen_random_uuid() $$;
    create role anon nologin;
    create role authenticated nologin;

    create type public.app_role as enum ('owner', 'admin');
    create type public.product_publication_status as enum ('draft', 'published', 'archived');
    create type public.pta_status as enum ('approved', 'not_approved', 'not_applicable', 'unknown');
    create type public.product_condition as enum ('brand_new', 'used', 'open_box', 'refurbished', 'unknown');
    create type public.delivery_scope as enum ('karachi_only', 'nationwide');
    create type public.inventory_movement_reason as enum ('initial', 'purchase', 'sale', 'return', 'correction', 'damage', 'other');
    create type public.catalog_data_class as enum ('development', 'real');

    create table public.profiles (
      id uuid primary key references auth.users(id) on delete cascade,
      display_name text, role public.app_role, is_active boolean not null default true,
      created_at timestamptz not null default now(), updated_at timestamptz not null default now()
    );
    create table public.brands (
      id uuid primary key default extensions.gen_random_uuid(), name text not null, slug text not null unique,
      is_active boolean not null default true, data_class public.catalog_data_class not null default 'development'
    );
    create table public.categories (
      id uuid primary key default extensions.gen_random_uuid(), name text not null, slug text not null unique,
      is_active boolean not null default true, data_class public.catalog_data_class not null default 'development'
    );
    create table public.products (
      id uuid primary key default extensions.gen_random_uuid(),
      brand_id uuid references public.brands(id) on delete restrict,
      category_id uuid not null references public.categories(id) on delete restrict,
      title text not null, slug text not null unique,
      publication_status public.product_publication_status not null default 'draft',
      default_warranty text, default_delivery_scope public.delivery_scope, published_at timestamptz,
      data_class public.catalog_data_class not null default 'development',
      created_at timestamptz not null default now(), updated_at timestamptz not null default now()
    );
    create table public.product_variants (
      id uuid primary key default extensions.gen_random_uuid(),
      product_id uuid not null references public.products(id) on delete cascade,
      sku text not null unique,
      ram_display text, storage_display text, color_finish text,
      price_minor bigint not null, compare_at_price_minor bigint,
      pta_status public.pta_status not null default 'unknown',
      condition public.product_condition not null default 'unknown',
      warranty_override text, carrier_jv text, delivery_scope public.delivery_scope,
      is_active boolean not null default true, sort_order integer not null default 0,
      created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
      condition_grade text, battery_health_percent smallint, battery_cycle_count integer, sim_configuration text,
      constraint variants_sku_not_blank check (char_length(trim(sku)) > 0),
      constraint variants_price_nonnegative check (price_minor >= 0),
      constraint variants_compare_price_strictly_greater check (compare_at_price_minor is null or compare_at_price_minor > price_minor),
      constraint variants_explicit_combination_unique unique nulls not distinct
        (product_id, ram_display, storage_display, color_finish, pta_status, condition, carrier_jv,
         condition_grade, battery_health_percent, battery_cycle_count)
    );
    create table public.inventory_movements (
      id bigint generated always as identity primary key,
      variant_id uuid not null references public.product_variants(id) on delete restrict,
      quantity_delta integer not null,
      reason public.inventory_movement_reason not null,
      reference text, note text,
      actor_id uuid references auth.users(id) on delete set null,
      created_at timestamptz not null default now(),
      constraint inventory_delta_nonzero check (quantity_delta <> 0)
    );
    create table public.product_specifications (
      id uuid primary key default extensions.gen_random_uuid(),
      product_id uuid not null references public.products(id) on delete cascade,
      specification_group text, label text not null, value text not null, sort_order integer not null default 0,
      created_at timestamptz not null default now(), updated_at timestamptz not null default now()
    );
    create table public.product_media (
      id uuid primary key default extensions.gen_random_uuid(),
      product_id uuid not null references public.products(id) on delete cascade,
      variant_id uuid references public.product_variants(id) on delete cascade,
      cloudinary_public_id text, alt_text text not null, sort_order integer not null default 0,
      is_primary boolean not null default false,
      created_at timestamptz not null default now(), updated_at timestamptz not null default now()
    );
    create table public.product_media_variant_assignments (
      media_id uuid not null references public.product_media(id) on delete cascade,
      variant_id uuid not null references public.product_variants(id) on delete cascade,
      created_at timestamptz not null default now(),
      primary key (media_id, variant_id)
    );
  `);

  // Real functions, verbatim from the migrations.
  await db.exec(extractFunction(FOUNDATION, "set_updated_at"));
  await db.exec(extractFunction(FOUNDATION, "is_catalog_admin"));
  await db.exec(extractFunction(FOUNDATION, "current_inventory"));
  for (const line of read(SKU_FILE).match(/create sequence public\.catalog_sku_[a-z]+_seq[^;]*;/g)) await db.exec(line);
  await db.exec(extractFunction(SKU_FILE, "catalog_sku_prefix"));
  await db.exec(extractFunction(SKU_FILE, "next_catalog_sku"));
  await db.exec(extractFunction(SKU_FILE, "assign_catalog_variant_sku"));
  await db.exec(`
    create trigger variants_set_updated_at before update on public.product_variants for each row execute function public.set_updated_at();
    create trigger products_set_updated_at before update on public.products for each row execute function public.set_updated_at();
    create trigger product_variants_assign_catalog_sku before insert or update of sku on public.product_variants for each row execute function public.assign_catalog_variant_sku();
  `);

  await db.exec(MIGRATION);
  await db.exec(MESSAGES_FIX);
  await seed(db);
  return db;
}

async function seed(db) {
  await db.exec(`
    insert into auth.users (id) values ('${ADMIN}'), ('${INACTIVE_ADMIN}'), ('${NO_ROLE}');
    insert into public.profiles (id, role, is_active) values ('${ADMIN}', 'admin', true), ('${INACTIVE_ADMIN}', 'admin', false), ('${NO_ROLE}', null, true);
    insert into public.brands (name, slug, is_active, data_class) values
      ('Samsung', 'samsung', true, 'real'), ('Xiaomi', 'xiaomi', true, 'real'), ('Apple', 'apple', true, 'real'), ('Nokia', 'nokia', true, 'real');
    insert into public.categories (name, slug, is_active, data_class) values
      ('Mobile Phones', 'mobile-phones', true, 'real'), ('Tablets', 'tablets', true, 'real');
  `);
  const product = async (slug, title, brand, category = "mobile-phones", dataClass = "real", status = "published") =>
    (await db.query(
      `insert into public.products (brand_id, category_id, title, slug, publication_status, data_class, published_at, updated_at)
       select b.id, c.id, $2, $1, $5::public.product_publication_status, $4::public.catalog_data_class, case when $5 = 'published' then '2026-10-01T00:00:00Z'::timestamptz end, '2026-10-01T00:00:00Z'
       from public.brands b, public.categories c where b.slug = $3 and c.slug = $6 returning id`,
      [slug, title, brand, dataClass, status, category],
    )).rows[0].id;
  const variant = async (productId, ram, storage, color, price, { active = true, pta = "approved", condition = "brand_new", warranty = "1 Year", delivery = "karachi_only", compareAt = null, stock = 10 } = {}) => {
    const row = (await db.query(
      `insert into public.product_variants (product_id, sku, ram_display, storage_display, color_finish, price_minor, compare_at_price_minor, pta_status, condition, warranty_override, delivery_scope, is_active)
       values ($1, '', $2, $3, $4, $5, $6, $7::public.pta_status, $8::public.product_condition, $9, $10::public.delivery_scope, $11) returning id, sku`,
      [productId, ram, storage, color, price, compareAt, pta, condition, warranty, delivery, active],
    )).rows[0];
    if (stock) await db.query(`insert into public.inventory_movements (variant_id, quantity_delta, reason, reference) values ($1, $2, 'initial', 'seed')`, [row.id, stock]);
    return row.id;
  };

  const a07 = await product("samsung-a07", "Samsung A07", "samsung");
  const black = await variant(a07, "4 GB", "64 GB", "Black", 3690000, { compareAt: 3990000 });
  const green = await variant(a07, "4 GB", "64 GB", "Green", 3690000, { stock: 5 });
  const blue = await variant(a07, "4 GB", "128 GB", "Blue", 4190000, { active: false, stock: 0 });
  const media = (await db.query(`insert into public.product_media (product_id, cloudinary_public_id, alt_text, is_primary) values ($1, 'isolutions/a07', 'Samsung A07', true) returning id`, [a07])).rows[0].id;
  await db.query(`insert into public.product_media_variant_assignments (media_id, variant_id) values ($1, $2)`, [media, black]);
  await db.query(`insert into public.product_specifications (product_id, specification_group, label, value) values ($1, 'Display', 'Screen Size', '6.7 inches')`, [a07]);

  const note15 = await product("xiaomi-redmi-note-15-pro", "Xiaomi Redmi Note 15 Pro", "xiaomi");
  const nBlack = await variant(note15, "8 GB", "256 GB", "Black", 8500000);
  const nWhite = await variant(note15, "8 GB", "256 GB", "White", 8500000, { pta: "not_approved" });

  const unknownFacts = await product("xiaomi-redmi-15", "Xiaomi Redmi 15", "xiaomi", "mobile-phones", "real", "draft");
  const uBlack = await variant(unknownFacts, "6 GB", "128 GB", "Black", 4000000, { pta: "unknown", condition: "unknown" });

  const iphone = await product("apple-iphone-17", "Apple iPhone 17", "apple");
  const iBlack = await variant(iphone, "8 GB", "256 GB", "Black", 30000000);
  const samsungIphoneTitle = await product("samsung-iphone-case-phone", "Samsung iPhone Lookalike", "samsung");
  const nokia = await product("nokia-105", "Nokia 105", "nokia");
  const tablet = await product("samsung-tab-a9", "Samsung Tab A9", "samsung", "tablets");
  const devPhone = await product("samsung-test-phone", "Samsung Test Phone", "samsung", "mobile-phones", "development");
  for (const id of [samsungIphoneTitle, nokia, tablet, devPhone]) await variant(id, "4 GB", "64 GB", "Black", 2000000);

  Object.assign(ids, { a07, black, green, blue, media, note15, nBlack, nWhite, unknownFacts, uBlack, iphone, iBlack, samsungIphoneTitle, nokia, tablet, devPhone });
}

const ids = {};

const asUser = (db, userId) => db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [userId ?? ""]);

async function call(db, payload, user = ADMIN) {
  await asUser(db, user);
  return (await db.query(`select public.apply_android_stock_phone($1::jsonb) as r`, [JSON.stringify(payload)])).rows[0].r;
}

/** The phone's variants exactly as Check List saw them (every variant, active and hidden). */
async function expectedFor(db, productId) {
  const rows = (await db.query(`select id, price_minor, is_active from public.product_variants where product_id = $1 order by id`, [productId])).rows;
  return { variants: rows.map((row) => ({ id: row.id, price_minor: Number(row.price_minor), is_active: row.is_active })) };
}

const stockOf = async (db, variantId) => Number((await db.query(`select public.current_inventory($1) as s`, [variantId])).rows[0].s);

/** Everything in the database (for "nothing changed" assertions). */
async function everything(db) {
  const q = async (sql) => (await db.query(sql)).rows;
  return {
    products: await q(`select * from public.products order by id`),
    variants: await q(`select * from public.product_variants order by id`),
    movements: await q(`select * from public.inventory_movements order by id`),
    media: await q(`select * from public.product_media order by id`),
    specs: await q(`select * from public.product_specifications order by id`),
    links: await q(`select * from public.product_media_variant_assignments order by media_id, variant_id`),
  };
}

async function rejects(db, payload, pattern, user = ADMIN) {
  const before = await everything(db);
  await assert.rejects(call(db, payload, user), (error) => {
    assert.match(error.message, pattern);
    // The Owner must always get the function's own reason, never a database parsing error about it.
    assert.doesNotMatch(error.message, /malformed array literal/);
    return true;
  });
  assert.deepEqual(await everything(db), before, "nothing may change when the call fails");
}

const A07_FACTS = { pta_status: "approved", condition: "brand_new", warranty_override: "1 Year", delivery_scope: "karachi_only" };

// ---------------------------------------------------------------------------
// Successful update
// ---------------------------------------------------------------------------

test("one call applies price, show, hide, stock 30 and a new variant for one phone, and touches nothing else", async () => {
  const db = await makeDb();
  const before = await everything(db);
  const result = await call(db, {
    product_id: ids.a07,
    expected: await expectedFor(db, ids.a07),
    steps: [
      { kind: "price", variant_id: ids.black, from_minor: 3690000, to_minor: 3590000 },
      { kind: "show", variant_ids: [ids.blue] },
      { kind: "hide", variant_ids: [ids.green] },
      { kind: "set_stock", variant_id: ids.black, to_stock: 30 },
      { kind: "set_stock", variant_id: ids.blue, to_stock: 30 },
      { kind: "add_variant", ram: "6 GB", storage: "128 GB", color: "Lilac", price_minor: 4590000, stock: 30, inherited: A07_FACTS },
    ],
  });

  assert.equal(result.status, "updated");
  assert.equal(result.price_updates, 1);
  assert.equal(result.shown, 1);
  assert.equal(result.hidden, 1);
  assert.equal(result.stock_corrections, 2);
  assert.equal(result.new_variants.length, 1);
  assert.match(result.new_variants[0].sku, /^MB[0-9]{3}$/);

  const after = await everything(db);
  const v = (id) => after.variants.find((row) => row.id === id);
  const old = (id) => before.variants.find((row) => row.id === id);
  // Same rows, same SKUs; only the planned column changed.
  assert.equal(v(ids.black).price_minor, 3590000);
  assert.equal(v(ids.black).sku, old(ids.black).sku);
  assert.equal(v(ids.blue).is_active, true);
  assert.equal(v(ids.green).is_active, false, "hidden, not deleted");
  assert.equal(v(ids.green).price_minor, old(ids.green).price_minor);
  assert.equal(await stockOf(db, ids.black), 30);
  assert.equal(await stockOf(db, ids.blue), 30);
  assert.equal(await stockOf(db, ids.green), 5, "a hidden variant keeps its stock");

  const created = v(result.new_variants[0].id);
  assert.deepEqual(
    [created.ram_display, created.storage_display, created.color_finish, Number(created.price_minor), created.pta_status, created.condition, created.warranty_override, created.delivery_scope, created.is_active, created.sim_configuration, created.compare_at_price_minor],
    ["6 GB", "128 GB", "Lilac", 4590000, "approved", "brand_new", "1 Year", "karachi_only", true, null, null],
  );
  assert.equal(await stockOf(db, created.id), 30);

  // Ledger: one opening row (+30) for the new variant, one correction per changed stock; nothing edited or removed.
  const added = after.movements.slice(before.movements.length);
  assert.deepEqual(after.movements.slice(0, before.movements.length), before.movements);
  assert.deepEqual(
    added.map((row) => [row.variant_id, row.quantity_delta, row.reason, row.reference, row.actor_id]).sort(),
    [
      [created.id, 30, "initial", "android_stock_update", ADMIN],
      [ids.black, 20, "correction", "android_stock_update", ADMIN],
      [ids.blue, 30, "correction", "android_stock_update", ADMIN],
    ].sort(),
  );

  // Phone row, images, specifications, colour-image links and every other phone: untouched.
  assert.deepEqual(after.products, before.products);
  assert.deepEqual(after.media, before.media);
  assert.deepEqual(after.specs, before.specs);
  assert.deepEqual(after.links, before.links);
  const others = (rows) => rows.filter((row) => row.product_id !== ids.a07);
  assert.deepEqual(others(after.variants), others(before.variants));
});

test("stock is set to exactly 30 after earlier sales, and no row is written when it is already 30", async () => {
  const db = await makeDb();
  await db.query(`insert into public.inventory_movements (variant_id, quantity_delta, reason, reference) values ($1, -3, 'sale', 'order:test')`, [ids.black]);
  assert.equal(await stockOf(db, ids.black), 7);
  await call(db, { product_id: ids.a07, expected: await expectedFor(db, ids.a07), steps: [{ kind: "set_stock", variant_id: ids.black, to_stock: 30 }] });
  assert.equal(await stockOf(db, ids.black), 30);
  const rows = (await db.query(`select quantity_delta from public.inventory_movements where variant_id = $1 and reference = 'android_stock_update'`, [ids.black])).rows;
  assert.deepEqual(rows.map((row) => row.quantity_delta), [23]);

  const result = await call(db, { product_id: ids.a07, expected: await expectedFor(db, ids.a07), steps: [{ kind: "set_stock", variant_id: ids.black, to_stock: 30 }] });
  assert.equal(result.stock_corrections, 0);
  assert.equal((await db.query(`select count(*)::int as c from public.inventory_movements where variant_id = $1 and reference = 'android_stock_update'`, [ids.black])).rows[0].c, 1);
});

test("hiding every variant of a phone never deletes it and never changes its publication", async () => {
  const db = await makeDb();
  const before = await everything(db);
  await call(db, { product_id: ids.a07, expected: await expectedFor(db, ids.a07), steps: [{ kind: "hide", variant_ids: [ids.black, ids.green] }] });
  const after = await everything(db);
  assert.equal(after.variants.length, before.variants.length);
  assert.deepEqual(after.products, before.products);
  assert.equal(after.variants.filter((row) => row.product_id === ids.a07 && row.is_active).length, 0);
});

// ---------------------------------------------------------------------------
// Forced failures: the whole phone rolls back, other phones are unaffected
// ---------------------------------------------------------------------------

test("a failure on the LAST write rolls back every earlier write of that phone (prices, visibility, new variant, stock)", async () => {
  const db = await makeDb();
  // Test-only fault: the stock correction for the Green variant fails after all other writes of the phone succeeded.
  await db.exec(`
    create function public.test_fail_green() returns trigger language plpgsql as $$
    begin if new.variant_id = '${ids.green}' and new.reason = 'correction' then raise exception 'forced test failure'; end if; return new; end $$;
    create trigger test_fail_green before insert on public.inventory_movements for each row execute function public.test_fail_green();
  `);
  const skuBefore = (await db.query(`select last_value from public.catalog_sku_mb_seq`)).rows[0].last_value;
  await rejects(db, {
    product_id: ids.a07,
    expected: await expectedFor(db, ids.a07),
    steps: [
      { kind: "price", variant_id: ids.black, from_minor: 3690000, to_minor: 3590000 },
      { kind: "show", variant_ids: [ids.blue] },
      { kind: "add_variant", ram: "6 GB", storage: "128 GB", color: "Lilac", price_minor: 4590000, stock: 30, inherited: A07_FACTS },
      { kind: "set_stock", variant_id: ids.black, to_stock: 30 },
      { kind: "set_stock", variant_id: ids.green, to_stock: 30 },
    ],
  }, /forced test failure/);
  // Sequences are not transactional: the SKU number used by the rolled-back variant is skipped (a harmless gap).
  const skuAfter = (await db.query(`select last_value from public.catalog_sku_mb_seq`)).rows[0].last_value;
  assert.ok(Number(skuAfter) > Number(skuBefore));
});

test("a read-back mismatch (an unplanned column change) rolls the phone back", async () => {
  const db = await makeDb();
  await db.exec(`
    create function public.test_side_effect() returns trigger language plpgsql as $$
    begin new.sort_order := new.sort_order + 1; return new; end $$;
    create trigger test_side_effect before update of price_minor on public.product_variants for each row execute function public.test_side_effect();
  `);
  await rejects(db, {
    product_id: ids.a07,
    expected: await expectedFor(db, ids.a07),
    steps: [{ kind: "price", variant_id: ids.black, from_minor: 3690000, to_minor: 3590000 }],
  }, /android_stock_phone_verification_failed: .*changed outside price \/ visibility/);
});

test("one failing phone does not undo or block another phone", async () => {
  const db = await makeDb();
  const ok = await call(db, { product_id: ids.a07, expected: await expectedFor(db, ids.a07), steps: [{ kind: "price", variant_id: ids.black, from_minor: 3690000, to_minor: 3590000 }] });
  assert.equal(ok.status, "updated");
  await rejects(db, { product_id: ids.note15, expected: await expectedFor(db, ids.note15), steps: [{ kind: "set_stock", variant_id: ids.nBlack, to_stock: 25 }] }, /stock must be set to 30/);
  const later = await call(db, { product_id: ids.note15, expected: await expectedFor(db, ids.note15), steps: [{ kind: "set_stock", variant_id: ids.nBlack, to_stock: 30 }] });
  assert.equal(later.status, "updated");
  assert.equal(Number((await db.query(`select price_minor from public.product_variants where id = $1`, [ids.black])).rows[0].price_minor), 3590000);
  assert.equal(await stockOf(db, ids.nBlack), 30);
});

// ---------------------------------------------------------------------------
// Authorization and scope
// ---------------------------------------------------------------------------

test("only an active catalog admin can call it", async () => {
  const db = await makeDb();
  const payload = { product_id: ids.a07, expected: await expectedFor(db, ids.a07), steps: [{ kind: "set_stock", variant_id: ids.black, to_stock: 30 }] };
  await rejects(db, payload, /android_stock_phone_admin_required/, null);
  await rejects(db, payload, /android_stock_phone_admin_required/, INACTIVE_ADMIN);
  await rejects(db, payload, /android_stock_phone_admin_required/, NO_ROLE);
});

test("execute is granted to signed-in users only (never anon / public); the admin check is inside", async () => {
  const grants = (await (await makeDb()).query(`
    select grantee, privilege_type from information_schema.routine_privileges
    where routine_schema = 'public' and routine_name = 'apply_android_stock_phone' and grantee in ('anon', 'authenticated', 'PUBLIC') order by grantee`)).rows;
  assert.deepEqual(grants, [{ grantee: "authenticated", privilege_type: "EXECUTE" }]);
});

test("iPhones, Apple, feature-phone brands, tablets and development products are refused", async () => {
  const db = await makeDb();
  for (const productId of [ids.iphone, ids.samsungIphoneTitle, ids.nokia, ids.tablet, ids.devPhone]) {
    const expected = await expectedFor(db, productId);
    await rejects(db, { product_id: productId, expected, steps: [{ kind: "set_stock", variant_id: expected.variants[0].id, to_stock: 30 }] }, /android_stock_phone_not_android/);
  }
  await rejects(db, { product_id: "00000000-0000-4000-8000-0000000000ff", expected: { variants: [] }, steps: [{ kind: "hide", variant_ids: [ids.black] }] }, /android_stock_phone_not_found/);
});

test("a variant of another phone can never be changed through this phone", async () => {
  const db = await makeDb();
  await rejects(db, { product_id: ids.a07, expected: await expectedFor(db, ids.a07), steps: [{ kind: "price", variant_id: ids.nBlack, from_minor: 8500000, to_minor: 8000000 }] }, /does not belong to this phone/);
  await rejects(db, { product_id: ids.a07, expected: await expectedFor(db, ids.a07), steps: [{ kind: "hide", variant_ids: [ids.iBlack] }] }, /does not belong to this phone/);
});

// ---------------------------------------------------------------------------
// Changed since Check List
// ---------------------------------------------------------------------------

test("a price, visibility or variant-set change since Check List refuses the phone", async () => {
  const db = await makeDb();
  const expected = await expectedFor(db, ids.a07);
  const steps = [{ kind: "set_stock", variant_id: ids.black, to_stock: 30 }];

  await db.query(`update public.product_variants set price_minor = 3700000 where id = $1`, [ids.green]);
  await rejects(db, { product_id: ids.a07, expected, steps }, /android_stock_phone_changed_since_check/);
  await db.query(`update public.product_variants set price_minor = 3690000 where id = $1`, [ids.green]);

  await db.query(`update public.product_variants set is_active = true where id = $1`, [ids.blue]);
  await rejects(db, { product_id: ids.a07, expected, steps }, /android_stock_phone_changed_since_check/);
  await db.query(`update public.product_variants set is_active = false where id = $1`, [ids.blue]);

  await db.query(`insert into public.product_variants (product_id, sku, ram_display, storage_display, color_finish, price_minor) values ($1, '', '8 GB', '256 GB', 'Gold', 5000000)`, [ids.a07]);
  await rejects(db, { product_id: ids.a07, expected, steps }, /android_stock_phone_changed_since_check: .*different set of variants/);

  const partial = { variants: expected.variants.slice(1) };
  await rejects(db, { product_id: ids.a07, expected: partial, steps }, /android_stock_phone_changed_since_check/);
});

test("a price step whose from-price is not the current price is refused", async () => {
  const db = await makeDb();
  await rejects(db, { product_id: ids.a07, expected: await expectedFor(db, ids.a07), steps: [{ kind: "price", variant_id: ids.black, from_minor: 1, to_minor: 3590000 }] }, /price changed since Check List/);
});

// ---------------------------------------------------------------------------
// Variant consistency
// ---------------------------------------------------------------------------

test("a new variant is refused when the sibling variants disagree on PTA / condition (never guessed)", async () => {
  const db = await makeDb();
  await rejects(db, {
    product_id: ids.note15,
    expected: await expectedFor(db, ids.note15),
    steps: [{ kind: "add_variant", ram: "12 GB", storage: "512 GB", color: "Purple", price_minor: 9900000, stock: 30, inherited: { pta_status: "approved", condition: "brand_new", warranty_override: "1 Year", delivery_scope: "karachi_only" } }],
  }, /do not agree on PTA, condition, warranty or delivery/);
});

test("a new variant is refused when the siblings' PTA / condition is unknown", async () => {
  const db = await makeDb();
  await rejects(db, {
    product_id: ids.unknownFacts,
    expected: await expectedFor(db, ids.unknownFacts),
    steps: [{ kind: "add_variant", ram: "8 GB", storage: "256 GB", color: "Blue", price_minor: 4500000, stock: 30, inherited: { pta_status: "unknown", condition: "unknown", warranty_override: "1 Year", delivery_scope: "karachi_only" } }],
  }, /no PTA \/ condition to copy/);
});

test("a new variant is refused when the payload's copied facts differ from the siblings", async () => {
  const db = await makeDb();
  await rejects(db, {
    product_id: ids.a07,
    expected: await expectedFor(db, ids.a07),
    steps: [{ kind: "add_variant", ram: "6 GB", storage: "128 GB", color: "Lilac", price_minor: 4590000, stock: 30, inherited: { ...A07_FACTS, pta_status: "not_approved" } }],
  }, /copied PTA \/ condition \/ warranty \/ delivery do not match/);
});

test("a new variant that already exists (any case / spacing, active or hidden) or is listed twice is refused", async () => {
  const db = await makeDb();
  const expected = await expectedFor(db, ids.a07);
  const add = (color, storage = "64 GB") => ({ kind: "add_variant", ram: "4 GB", storage, color, price_minor: 3690000, stock: 30, inherited: A07_FACTS });
  await rejects(db, { product_id: ids.a07, expected, steps: [add(" black ")] }, /already exists on this phone/);
  await rejects(db, { product_id: ids.a07, expected, steps: [add("BLUE", "128 GB")] }, /already exists on this phone/);
  await rejects(db, { product_id: ids.a07, expected, steps: [add("Mint"), add("mint")] }, /listed twice/);
});

test("a new variant needs RAM, storage and colour and an opening stock of exactly 30", async () => {
  const db = await makeDb();
  const expected = await expectedFor(db, ids.a07);
  await rejects(db, { product_id: ids.a07, expected, steps: [{ kind: "add_variant", ram: "4 GB", storage: "64 GB", color: "", price_minor: 3690000, stock: 30, inherited: A07_FACTS }] }, /needs RAM, storage and colour/);
  await rejects(db, { product_id: ids.a07, expected, steps: [{ kind: "add_variant", ram: "4 GB", storage: "64 GB", color: "Mint", price_minor: 3690000, stock: 10, inherited: A07_FACTS }] }, /opening stock must be 30/);
});

// ---------------------------------------------------------------------------
// Step rules
// ---------------------------------------------------------------------------

test("step rules: stock 30 only, listed variants are never hidden, no double show/hide, compare-at respected", async () => {
  const db = await makeDb();
  const expected = await expectedFor(db, ids.a07);
  const go = (steps, pattern) => rejects(db, { product_id: ids.a07, expected, steps }, pattern);
  await go([{ kind: "set_stock", variant_id: ids.black, to_stock: 25 }], /stock must be set to 30/);
  await go([{ kind: "hide", variant_ids: [ids.black] }, { kind: "set_stock", variant_id: ids.black, to_stock: 30 }], /listed and hidden at the same time/);
  await go([{ kind: "hide", variant_ids: [ids.black] }, { kind: "price", variant_id: ids.black, from_minor: 3690000, to_minor: 3590000 }], /listed and hidden at the same time/);
  await go([{ kind: "set_stock", variant_id: ids.blue, to_stock: 30 }], /only set for variants that are visible after the update/);
  await go([{ kind: "show", variant_ids: [ids.black] }], /already visible/);
  await go([{ kind: "hide", variant_ids: [ids.blue] }], /already hidden/);
  await go([{ kind: "hide", variant_ids: [ids.green] }, { kind: "show", variant_ids: [ids.green] }], /shown or hidden more than once/);
  await go([{ kind: "price", variant_id: ids.black, from_minor: 3690000, to_minor: 3990000 }], /not below the compare-at price/);
  await go([{ kind: "price", variant_id: ids.black, from_minor: 3690000, to_minor: 3690000 }], /equals the current price/);
  await go([{ kind: "price", variant_id: ids.black, from_minor: 3690000, to_minor: 0 }], /positive amount/);
  await go([{ kind: "set_stock", variant_id: ids.black, to_stock: 30 }, { kind: "set_stock", variant_id: ids.black, to_stock: 30 }], /more than one stock change/);
  await go([{ kind: "delete", variant_ids: [ids.black] }], /Unknown step kind "delete"/);
  await rejects(db, { product_id: ids.a07, expected, steps: [] }, /android_stock_phone_invalid_payload/);
  await rejects(db, { product_id: "not-a-uuid", expected, steps: [{ kind: "hide", variant_ids: [ids.green] }] }, /product_id is not a uuid/);
});

test("a hidden variant listed again is shown, priced and stocked in one call", async () => {
  const db = await makeDb();
  await call(db, {
    product_id: ids.a07,
    expected: await expectedFor(db, ids.a07),
    steps: [
      { kind: "price", variant_id: ids.blue, from_minor: 4190000, to_minor: 3990000 },
      { kind: "show", variant_ids: [ids.blue] },
      { kind: "set_stock", variant_id: ids.blue, to_stock: 30 },
    ],
  });
  const row = (await db.query(`select is_active, price_minor from public.product_variants where id = $1`, [ids.blue])).rows[0];
  assert.deepEqual([row.is_active, Number(row.price_minor)], [true, 3990000]);
  assert.equal(await stockOf(db, ids.blue), 30);
});

// ---------------------------------------------------------------------------
// Retry
// ---------------------------------------------------------------------------

test("retrying the same plan never duplicates variants, SKUs or stock rows", async () => {
  const db = await makeDb();
  const payload = {
    product_id: ids.a07,
    expected: await expectedFor(db, ids.a07),
    steps: [
      { kind: "price", variant_id: ids.black, from_minor: 3690000, to_minor: 3590000 },
      { kind: "set_stock", variant_id: ids.black, to_stock: 30 },
      { kind: "add_variant", ram: "6 GB", storage: "128 GB", color: "Lilac", price_minor: 4590000, stock: 30, inherited: A07_FACTS },
    ],
  };
  await call(db, payload);
  const once = await everything(db);
  // The same (now stale) plan again: refused as a whole, nothing written.
  await rejects(db, payload, /android_stock_phone_changed_since_check/);
  // A fresh plan from the current website (what a new Check List would produce) re-sets stock only.
  const fresh = await call(db, { product_id: ids.a07, expected: await expectedFor(db, ids.a07), steps: [{ kind: "set_stock", variant_id: ids.black, to_stock: 30 }] });
  assert.equal(fresh.stock_corrections, 0);
  const twice = await everything(db);
  assert.equal(twice.variants.length, once.variants.length);
  assert.equal(twice.movements.length, once.movements.length);
  assert.equal(new Set(twice.variants.map((row) => row.sku)).size, twice.variants.length);
});

// ---------------------------------------------------------------------------
// Full replay: every real migration (scripts/support/catalogTestDatabase.mjs), Supabase default privileges,
// called as the "authenticated" role exactly like the browser's RPC call.
// ---------------------------------------------------------------------------

async function replayedPhone() {
  const db = await createCatalogTestDatabase({ supabaseDefaultPrivileges: true });
  const owner = await signInAsOwner(db);
  const variant = (color, price) => ({ ram: "8 GB", storage: "256 GB", color, price_minor: price, stock: 10, pta_status: "approved", condition: "brand_new", warranty: "1 Year", delivery_scope: "karachi_only" });
  const created = (await db.query(`select public.apply_catalog_bulk_import_v2($1::jsonb) as r`, [JSON.stringify({ products: [
    { action: "Create", product_type: "Mobile Phone", brand: "Samsung", category: "Mobile Phones", title: "Samsung Galaxy A57", variants: [variant("Black", 9000000), variant("Lilac", 9000000)] },
  ] })])).rows[0].r;
  const productId = created.products[0].id;
  const rows = (await db.query(`select id, color_finish from public.product_variants where product_id = $1`, [productId])).rows;
  const byColor = Object.fromEntries(rows.map((row) => [row.color_finish, row.id]));
  return { db, owner, productId, black: byColor.Black, lilac: byColor.Lilac };
}

async function callAsRole(db, role, payload) {
  await db.exec(`set role ${role}`);
  try {
    return (await db.query(`select public.apply_android_stock_phone($1::jsonb) as r`, [JSON.stringify(payload)])).rows[0].r;
  } finally {
    await db.exec("reset role");
  }
}

test("full replay: a signed-in admin (authenticated role) updates one phone through the real schema and SKU trigger", async () => {
  const { db, owner, productId, black, lilac } = await replayedPhone();
  const expected = await expectedFor(db, productId);
  const result = await callAsRole(db, "authenticated", {
    product_id: productId,
    expected,
    steps: [
      { kind: "price", variant_id: black, from_minor: 9000000, to_minor: 8800000 },
      { kind: "hide", variant_ids: [lilac] },
      { kind: "set_stock", variant_id: black, to_stock: 30 },
      { kind: "add_variant", ram: "12 GB", storage: "512 GB", color: "Navy", price_minor: 10500000, stock: 30, inherited: A07_FACTS },
    ],
  });
  assert.equal(result.status, "updated");
  assert.match(result.new_variants[0].sku, /^MB[0-9]{3}$/);
  assert.equal(await stockOf(db, black), 30);
  assert.equal(await stockOf(db, result.new_variants[0].id), 30);
  assert.equal(await stockOf(db, lilac), 10, "hidden variant keeps its stock");
  const actors = (await db.query(`select distinct actor_id from public.inventory_movements where reference = 'android_stock_update'`)).rows;
  assert.deepEqual(actors.map((row) => row.actor_id), [owner]);
  const product = (await db.query(`select publication_status from public.products where id = $1`, [productId])).rows[0];
  assert.equal(product.publication_status, "draft", "publication untouched");
});

test("full replay: visitors (anon) cannot execute it, and a non-admin signed-in user is refused", async () => {
  const { db, productId, black } = await replayedPhone();
  const payload = { product_id: productId, expected: await expectedFor(db, productId), steps: [{ kind: "set_stock", variant_id: black, to_stock: 30 }] };
  await assert.rejects(callAsRole(db, "anon", payload), /permission denied/);
  const { rows } = await db.query(`insert into auth.users (email) values ('customer@example.test') returning id`);
  await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [rows[0].id]);
  await assert.rejects(callAsRole(db, "authenticated", payload), /android_stock_phone_admin_required/);
  assert.equal(await stockOf(db, black), 10);
});

test("full replay: a forced failure on the last write leaves the phone exactly as it was", async () => {
  const { db, productId, black, lilac } = await replayedPhone();
  await db.exec(`
    create function public.test_fail_lilac() returns trigger language plpgsql as $$
    begin if new.variant_id = '${lilac}' and new.reason = 'correction' then raise exception 'forced test failure'; end if; return new; end $$;
    create trigger test_fail_lilac before insert on public.inventory_movements for each row execute function public.test_fail_lilac();
  `);
  const before = await everything(db);
  await assert.rejects(callAsRole(db, "authenticated", {
    product_id: productId,
    expected: await expectedFor(db, productId),
    steps: [
      { kind: "price", variant_id: black, from_minor: 9000000, to_minor: 8800000 },
      { kind: "set_stock", variant_id: black, to_stock: 30 },
      { kind: "add_variant", ram: "12 GB", storage: "512 GB", color: "Navy", price_minor: 10500000, stock: 30, inherited: A07_FACTS },
      { kind: "set_stock", variant_id: lilac, to_stock: 30 },
    ],
  }), /forced test failure/);
  assert.deepEqual(await everything(db), before);
});

// ---------------------------------------------------------------------------
// Error messages (fix 202610190001): every refusal arrives as the function's own readable reason
// ---------------------------------------------------------------------------

test("every refusal is the function's own message, never 'malformed array literal' (the 2026-10-18 DEV failure)", async () => {
  const db = await makeDb();
  const noVariants = (await db.query(
    `insert into public.products (brand_id, category_id, title, slug, data_class) select b.id, c.id, 'Samsung Empty', 'samsung-empty', 'real' from public.brands b, public.categories c where b.slug = 'samsung' and c.slug = 'mobile-phones' returning id`,
  )).rows[0].id;
  const add = (extra = {}) => ({ kind: "add_variant", ram: "8 GB", storage: "128 GB", color: "", price_minor: 6100000, stock: 30, inherited: A07_FACTS, ...extra });
  const cases = [
    // The DEV case: a colourless line (Realme C75x 8/128, Note 60x 4/128, Note 70 6/128).
    [ids.a07, [add()], /^android_stock_phone_rejected: "Samsung A07": A new variant needs RAM, storage and colour/],
    [noVariants, [add({ color: "Black" })], /^android_stock_phone_rejected: "Samsung Empty": This phone has no existing variant to copy PTA \/ condition from/],
    [ids.note15, [add({ color: "Purple" })], /^android_stock_phone_rejected: "Xiaomi Redmi Note 15 Pro": The existing variants of this phone do not agree on PTA, condition, warranty or delivery/],
    [ids.unknownFacts, [add({ color: "Blue" })], /^android_stock_phone_rejected: "Xiaomi Redmi 15": The existing variants of this phone have no PTA \/ condition to copy/],
  ];
  for (const [productId, steps, pattern] of cases) await rejects(db, { product_id: productId, expected: await expectedFor(db, productId), steps }, pattern);
});

test("read-back messages are readable too: an unplanned change to the phone row rolls the phone back with a clear reason", async () => {
  const db = await makeDb();
  await db.exec(`
    create function public.test_touch_product() returns trigger language plpgsql as $$
    begin update public.products set default_warranty = 'changed by test' where id = new.product_id; return new; end $$;
    create trigger test_touch_product after update of price_minor on public.product_variants for each row execute function public.test_touch_product();
  `);
  await rejects(db, {
    product_id: ids.a07,
    expected: await expectedFor(db, ids.a07),
    steps: [{ kind: "price", variant_id: ids.black, from_minor: 3690000, to_minor: 3590000 }],
  }, /^android_stock_phone_verification_failed: "Samsung A07": the phone row changed/);
});

test("the message fix changes only the eight message lines of the function (same rules, steps, locks and grants)", () => {
  const body = (sql) => sql.slice(sql.indexOf("\nbegin;\n"));
  const before = body(MIGRATION).split("\n");
  const after = body(MESSAGES_FIX).split("\n");
  assert.equal(after.length, before.length);
  const changed = before.map((line, index) => [line, after[index]]).filter(([a, b]) => a !== b);
  assert.equal(changed.length, 8);
  for (const [a, b] of changed) {
    assert.match(a, /v_errors := v_errors \|\| '[^']*';/);
    assert.equal(b, a.replace(/(v_errors := v_errors \|\| '[^']*')(;)/, "$1::text$2"));
  }
  assert.doesNotMatch(MESSAGES_FIX, /v_errors \|\| '[^']*';/, "no untyped literal is appended to the error list any more");
});

// ---------------------------------------------------------------------------
// Static guarantees of the migration file
// ---------------------------------------------------------------------------

test("the migration defines one function and writes only product_variants and inventory_movements (no delete, drop or table change)", () => {
  const sql = MIGRATION.replace(/--.*$/gm, "");
  assert.doesNotMatch(sql, /\bdelete\s+from\b|\btruncate\b|\bdrop\s+(table|function|trigger|policy|column)\b|\balter\s+table\b|\bcreate\s+table\b/i);
  assert.equal((sql.match(/create or replace function/gi) ?? []).length, 1);
  const updated = [...new Set([...sql.matchAll(/\bupdate\s+(public\.[a-z_]+)/gi)].map((m) => m[1]))];
  const inserted = [...new Set([...sql.matchAll(/insert\s+into\s+(public\.[a-z_]+)/gi)].map((m) => m[1]))];
  assert.deepEqual(updated, ["public.product_variants"]);
  assert.deepEqual(inserted.sort(), ["public.inventory_movements", "public.product_variants"]);
  assert.match(sql, /security definer/);
  assert.match(sql, /set search_path = ''/);
});
