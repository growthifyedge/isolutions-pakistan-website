// In-memory Postgres (PGlite) built by replaying this project's real migrations, for testing
// SQL behaviour (triggers, constraints, RPCs) without touching the live Supabase database.
//
// Replay-only adjustments (the migration files themselves are never changed):
// * Minimal Supabase stand-ins: anon/authenticated/service_role roles, auth.users, auth.uid()
//   (driven by the request.jwt.claim.sub setting) and extensions.gen_random_uuid().
// * One-off data repairs that target rows created through Admin on the live database are
//   skipped, because those rows do not exist in a fresh database.
// * 202608270002 contains schema changes behind a data guard; its guard only warns here.
// * 202608300001 is written with single-dollar quoting ("do $"), which Postgres rejects; it is
//   replayed with "$$" quoting.
// * 202609240001 hard-codes live category ids, so the locked category structure it produces is
//   seeded directly instead.
import { readdirSync, readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";

const MIGRATIONS = new URL("../../supabase/migrations/", import.meta.url);

const SKIPPED = new Set([
  "202608260002_phase_4_macbook_neo_price_repair.sql",
  "202608260003_phase_4_macbook_neo_identifier_price_repair.sql",
  "202608310001_phase_4_motorola_g77_test_deal.sql",
  "202609010003_phase_4_apple_charger_commercial_facts.sql",
  "202609010004_phase_4_remaining_mobile_accessories.sql",
  // Guarded to the live catalog's 105 products / 305 variants; tested on seeded data instead.
  "202610010001_android_mobile_warranty_backfill.sql",
]);

const PRELUDE = `
create role anon; create role authenticated; create role service_role;
create schema auth;
create table auth.users (id uuid primary key default gen_random_uuid(), email text,
  raw_user_meta_data jsonb default '{}'::jsonb, raw_app_meta_data jsonb default '{}'::jsonb);
create function auth.uid() returns uuid language sql stable as
  $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
create function auth.role() returns text language sql stable as
  $$ select nullif(current_setting('request.jwt.claim.role', true), '') $$;
create function auth.jwt() returns jsonb language sql stable as
  $$ select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
create schema extensions;
create function extensions.gen_random_uuid() returns uuid language sql volatile as
  $$ select pg_catalog.gen_random_uuid() $$;
`;

// End state of 202609240001 (plus the brands the live catalog uses).
const LOCKED_CATEGORIES = `
insert into public.categories (name, slug, data_class, is_active, sort_order) values
  ('Mobile Phones', 'mobile-phones', 'real', true, 1),
  ('Accessories', 'mobile-accessories', 'real', true, 2),
  ('Gadgets', 'gadgets', 'real', true, 3)
on conflict (slug) do update set name = excluded.name, data_class = 'real', is_active = true, parent_id = null;
insert into public.categories (name, slug, data_class, is_active, sort_order, parent_id)
select v.name, v.slug, 'real', true, v.sort_order, (select id from public.categories where slug = 'gadgets')
from (values ('Laptops', 'laptops', 1), ('Tablets', 'tablets', 2)) as v(name, slug, sort_order)
on conflict (slug) do update set parent_id = excluded.parent_id, data_class = 'real', is_active = true;
update public.categories set is_active = false
where slug not in ('mobile-phones', 'mobile-accessories', 'gadgets', 'laptops', 'tablets');
`;

function prepare(name, sql) {
  let text = sql.replace(/create extension if not exists pgcrypto with schema extensions;/gi, "");
  if (name === "202608270002_phase_4_product_defaults_inheritance.sql")
    text = text.replace("raise exception 'Apple 17 Pro Max delivery repair aborted", "raise notice 'Apple 17 Pro Max delivery repair aborted");
  if (name === "202608300001_phase_4_product_default_consistency_repair.sql")
    text = text.replace(/^do \$$/m, () => "do $$").replace(/^\$;$/m, () => "$$;");
  return text;
}

/** Returns a fresh database with every migration applied (see the adjustments above). */
export async function createCatalogTestDatabase() {
  const db = new PGlite();
  await db.exec(PRELUDE);
  const files = readdirSync(MIGRATIONS).filter((name) => name.endsWith(".sql")).sort();
  for (const name of files) {
    if (SKIPPED.has(name)) continue;
    if (name === "202609240001_category_structure_final.sql") {
      await db.exec(LOCKED_CATEGORIES);
      continue;
    }
    try {
      await db.exec(prepare(name, readFileSync(new URL(name, MIGRATIONS), "utf8")));
    } catch (error) {
      throw new Error(`Migration ${name} failed during replay: ${error.message}`);
    }
  }
  return db;
}

/** Creates an Owner profile and makes it the current auth.uid() for the session. */
export async function signInAsOwner(db) {
  const { rows } = await db.query(`insert into auth.users (email) values ('owner@example.test') returning id`);
  const id = rows[0].id;
  await db.query(`update public.profiles set role = 'owner', is_active = true where id = $1`, [id]);
  await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [id]);
  return id;
}

export async function signOut(db) {
  await db.query(`select set_config('request.jwt.claim.sub', '', false)`);
}
