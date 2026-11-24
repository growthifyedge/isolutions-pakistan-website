// Shared isolated test database for apply_product_variant_edits (migration 202611240001): the REAL migration in an
// in-memory Postgres (PGlite). No DEV / PROD database is involved; helper functions are read verbatim from migrations.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";

const MIGRATIONS = new URL("../../supabase/migrations/", import.meta.url);
const read = (file) => readFileSync(new URL(file, MIGRATIONS), "utf8");
export const MIGRATION = read("202611240001_product_variant_editor.sql");
function extractFunction(file, name) {
  const source = read(file);
  const start = source.search(new RegExp(`create (or replace )?function public\\.${name}\\(`));
  assert.ok(start >= 0, `${name} not found in ${file}`);
  const end = source.indexOf("\n$$;", start);
  return source.slice(start, end + 4).replace(/^create function/, "create or replace function");
}
const FOUNDATION = "202608200004_phase_3a_full_foundation_rls_repair.sql";
const SKU = "202609240003_catalog_sku_sequences.sql";
export const OWNER = "00000000-0000-4000-8000-000000000001";
export const ADMIN = "00000000-0000-4000-8000-000000000002";
export const INACTIVE_OWNER = "00000000-0000-4000-8000-000000000003";

export async function makeDb() {
  const db = new PGlite();
  await db.exec(`
    create schema auth; create schema extensions;
    create table auth.users (id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    create function extensions.gen_random_uuid() returns uuid language sql as $$ select gen_random_uuid() $$;
    create role anon nologin; create role authenticated nologin;
    create type public.app_role as enum ('owner', 'admin');
    create type public.product_publication_status as enum ('draft', 'published', 'archived');
    create type public.pta_status as enum ('approved', 'not_approved', 'not_applicable', 'unknown');
    create type public.product_condition as enum ('brand_new', 'used', 'open_box', 'refurbished', 'unknown');
    create type public.delivery_scope as enum ('karachi_only', 'nationwide');
    create type public.inventory_movement_reason as enum ('initial', 'purchase', 'sale', 'return', 'correction', 'damage', 'other');
    create type public.catalog_data_class as enum ('development', 'real');
    create table public.profiles (id uuid primary key references auth.users(id), display_name text, role public.app_role, is_active boolean not null default true, created_at timestamptz not null default now(), updated_at timestamptz not null default now());
    create table public.brands (id uuid primary key default extensions.gen_random_uuid(), name text not null, slug text not null unique, is_active boolean not null default true, data_class public.catalog_data_class not null default 'development');
    create table public.categories (id uuid primary key default extensions.gen_random_uuid(), name text not null, slug text not null unique, is_active boolean not null default true, data_class public.catalog_data_class not null default 'development');
    create table public.products (id uuid primary key default extensions.gen_random_uuid(), brand_id uuid references public.brands(id), category_id uuid not null references public.categories(id), title text not null, slug text not null unique, publication_status public.product_publication_status not null default 'draft', default_warranty text, default_delivery_scope public.delivery_scope, published_at timestamptz, data_class public.catalog_data_class not null default 'development', created_at timestamptz not null default now(), updated_at timestamptz not null default now());
    create table public.product_variants (
      id uuid primary key default extensions.gen_random_uuid(), product_id uuid not null references public.products(id) on delete cascade, sku text not null unique,
      ram_display text, storage_display text, color_finish text, price_minor bigint not null, compare_at_price_minor bigint,
      pta_status public.pta_status not null default 'unknown', condition public.product_condition not null default 'unknown',
      warranty_override text, carrier_jv text, delivery_scope public.delivery_scope, is_active boolean not null default true, sort_order integer not null default 0,
      created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
      condition_grade text, battery_health_percent smallint, battery_cycle_count integer, sim_configuration text,
      constraint variants_sku_catalog_format check (sku ~ '^(MB|AC|GD|MC|IP)[0-9]{3}$'),
      constraint variants_price_nonnegative check (price_minor >= 0),
      constraint variants_compare_price_strictly_greater check (compare_at_price_minor is null or compare_at_price_minor > price_minor),
      constraint variants_condition_grade_valid check (condition_grade is null or (condition_grade = 'A++' and condition = 'used')),
      constraint variants_explicit_combination_unique unique nulls not distinct (product_id, ram_display, storage_display, color_finish, pta_status, condition, carrier_jv, condition_grade, battery_health_percent, battery_cycle_count)
    );
    create table public.inventory_movements (id bigint generated always as identity primary key, variant_id uuid not null references public.product_variants(id) on delete restrict, quantity_delta integer not null, reason public.inventory_movement_reason not null, reference text, note text, actor_id uuid references auth.users(id), created_at timestamptz not null default now(), constraint inventory_delta_nonzero check (quantity_delta <> 0));
    create table public.product_specifications (id uuid primary key default extensions.gen_random_uuid(), product_id uuid not null references public.products(id) on delete cascade, specification_group text, label text not null, value text not null, sort_order integer not null default 0, created_at timestamptz not null default now(), updated_at timestamptz not null default now());
    create table public.product_media (id uuid primary key default extensions.gen_random_uuid(), product_id uuid not null references public.products(id) on delete cascade, variant_id uuid references public.product_variants(id), cloudinary_public_id text, secure_url text, width integer, height integer, bytes bigint, alt_text text not null, sort_order integer not null default 0, is_primary boolean not null default false, created_at timestamptz not null default now(), updated_at timestamptz not null default now());
    create table public.product_media_variant_assignments (media_id uuid not null references public.product_media(id) on delete cascade, variant_id uuid not null references public.product_variants(id) on delete cascade, created_at timestamptz not null default now(), primary key (media_id, variant_id));
    create table public.order_items (id uuid primary key default extensions.gen_random_uuid(), variant_id uuid references public.product_variants(id), sku_snapshot text not null, variant_attributes_snapshot jsonb not null, quantity integer not null, unit_price_minor bigint not null);
  `);
  for (const name of ["set_updated_at", "is_catalog_admin", "current_inventory"]) await db.exec(extractFunction(FOUNDATION, name));
  await db.exec(extractFunction("202611200001_site_content_homepage_banners.sql", "is_site_owner"));
  await db.exec(extractFunction("202611190001_publication_new_iphone_warranty_optional.sql", "validate_product_for_publication"));
  for (const line of read(SKU).match(/create sequence public\.catalog_sku_[a-z]+_seq[^;]*;/g)) await db.exec(line);
  for (const name of ["catalog_sku_prefix", "next_catalog_sku", "assign_catalog_variant_sku"]) await db.exec(extractFunction(SKU, name));
  await db.exec(`
    create trigger variants_set_updated_at before update on public.product_variants for each row execute function public.set_updated_at();
    create trigger product_variants_assign_catalog_sku before insert or update of sku on public.product_variants for each row execute function public.assign_catalog_variant_sku();
  `);
  await db.exec(MIGRATION);
  await seed(db);
  return db;
}

export const ids = {};
async function seed(db) {
  await db.exec(`
    insert into auth.users (id) values ('${OWNER}'), ('${ADMIN}'), ('${INACTIVE_OWNER}');
    insert into public.profiles (id, role, is_active) values ('${OWNER}', 'owner', true), ('${ADMIN}', 'admin', true), ('${INACTIVE_OWNER}', 'owner', false);
    insert into public.brands (name, slug, is_active, data_class) values ('Samsung', 'samsung', true, 'real');
    insert into public.categories (name, slug, is_active, data_class) values ('Mobile Phones', 'mobile-phones', true, 'real'), ('Tablets', 'tablets', true, 'real');
  `);
  const product = async (slug, title, category, status, dataClass = "real") =>
    (await db.query(
      `insert into public.products (brand_id, category_id, title, slug, publication_status, data_class, published_at)
       select b.id, c.id, $2, $1, 'draft', $4::public.catalog_data_class, null from public.brands b, public.categories c where b.slug = 'samsung' and c.slug = $3 returning id`,
      [slug, title, category, dataClass],
    )).rows[0].id;
  const variant = async (productId, ram, storage, color, price, { active = true, stock = 7, warranty = "1 Year" } = {}) => {
    const row = (await db.query(
      `insert into public.product_variants (product_id, sku, ram_display, storage_display, color_finish, price_minor, pta_status, condition, warranty_override, delivery_scope, is_active)
       values ($1, '', $2, $3, $4, $5, 'approved', 'brand_new', $6, 'karachi_only', $7) returning id, sku`,
      [productId, ram, storage, color, price * 100, warranty, active],
    )).rows[0];
    if (stock) await db.query(`insert into public.inventory_movements (variant_id, quantity_delta, reason, reference) values ($1, $2, 'initial', 'seed')`, [row.id, stock]);
    return row;
  };
  ids.s26 = await product("samsung-s26-ultra", "Samsung S26 Ultra", "mobile-phones");
  for (const [key, storage, color, price, active] of [["b256", "256 GB", "Black", 389500, true], ["v256", "256 GB", "Volt", 389500, true], ["k512", "512 GB", "Black", 448000, true], ["v512", "512 GB", "Volt", 443000, false]])
    ids[key] = await variant(ids.s26, "12 GB", storage, color, price, { active });
  ids.media = (await db.query(`insert into public.product_media (product_id, cloudinary_public_id, secure_url, width, height, bytes, alt_text, is_primary) values ($1, 'isolutions/s26', 'https://res.cloudinary.com/x/image/upload/s26', 800, 800, 1000, 'S26', true) returning id`, [ids.s26])).rows[0].id;
  await db.query(`insert into public.product_media_variant_assignments (media_id, variant_id) values ($1, $2)`, [ids.media, ids.v256.id]);
  await db.query(`insert into public.product_specifications (product_id, specification_group, label, value) values ($1, 'Battery', 'Capacity', '5000 mAh')`, [ids.s26]);
  await db.query(`insert into public.order_items (variant_id, sku_snapshot, variant_attributes_snapshot, quantity, unit_price_minor) values ($1, $2, '{"color":"Volt"}', 1, 38950000)`, [ids.v256.id, ids.v256.sku]);
  await db.query(`insert into public.inventory_movements (variant_id, quantity_delta, reason, reference) values ($1, -1, 'sale', 'order:1')`, [ids.v256.id]);
  await db.query(`update public.products set publication_status = 'published' where id = $1`, [ids.s26]);

  ids.tab = await product("samsung-tab-a9", "Samsung Tab A9", "tablets");
  ids.tabGrey = await variant(ids.tab, "4 GB", "64 GB", "Grey", 40000);
  ids.devPhone = await product("samsung-dev", "Samsung Dev", "mobile-phones", "draft", "development");
  ids.devBlack = await variant(ids.devPhone, "4 GB", "64 GB", "Black", 20000);
}

export const as = (db, user) => db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [user ?? ""]);
export async function expected(db, productId) {
  const rows = (await db.query(
    `select id, ram_display, storage_display, color_finish, price_minor, compare_at_price_minor, pta_status::text as pta_status, condition::text as condition,
            warranty_override, delivery_scope::text as delivery_scope, is_active, public.current_inventory(id) as stock
     from public.product_variants where product_id = $1 order by id`, [productId])).rows;
  return { variants: rows.map((row) => ({ ...row, price_minor: Number(row.price_minor), compare_at_price_minor: row.compare_at_price_minor === null ? null : Number(row.compare_at_price_minor), stock: Number(row.stock) })) };
}
export async function call(db, payload, user = OWNER) {
  await as(db, user);
  return (await db.query(`select public.apply_product_variant_edits($1::jsonb) as r`, [JSON.stringify(payload)])).rows[0].r;
}
export async function everything(db) {
  const q = async (sql) => (await db.query(sql)).rows;
  return {
    products: await q(`select * from public.products order by id`), variants: await q(`select * from public.product_variants order by id`),
    movements: await q(`select * from public.inventory_movements order by id`), media: await q(`select * from public.product_media order by id`),
    specs: await q(`select * from public.product_specifications order by id`), links: await q(`select * from public.product_media_variant_assignments order by media_id`),
    orders: await q(`select * from public.order_items order by id`),
  };
}
export async function rejects(db, payload, pattern, user = OWNER) {
  const before = await everything(db);
  await assert.rejects(call(db, payload, user), (error) => {
    assert.match(error.message, pattern);
    return true;
  });
  assert.deepEqual(await everything(db), before, "nothing may change when the call fails");
}
export const stockOf = async (db, id) => Number((await db.query(`select public.current_inventory($1) as s`, [id])).rows[0].s);
