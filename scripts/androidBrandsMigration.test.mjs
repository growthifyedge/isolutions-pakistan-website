import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { buildStockDelta, parseStockList } from "../src/lib/stockListDelta.ts";
import { buildWritePlan } from "../src/lib/stockUpdateApply.ts";

// Executes the REAL migration file in an in-memory Postgres (PGlite). No DEV / PROD database is involved.
const MIGRATION = readFileSync(new URL("../supabase/migrations/202610150001_android_brands_zte_vgotel.sql", import.meta.url), "utf8");

const EXISTING = ["Apple", "Samsung", "Xiaomi", "Motorola", "Honor", "Nothing", "Google", "Tecno", "Infinix", "Vivo", "Oppo", "Realme", "itel", "OnePlus"];

/** The parts of the real schema the migration touches or must leave alone (brands as in phase 3A + data_class from phase 4). */
async function makeDb(extraBrands = []) {
  const db = new PGlite();
  await db.exec(`
    create type public.catalog_data_class as enum ('development', 'real');
    create table public.brands (
      id uuid primary key default gen_random_uuid(),
      name text not null,
      slug text not null unique,
      description text,
      logo_reference text,
      is_active boolean not null default true,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      data_class public.catalog_data_class not null default 'development',
      constraint brands_name_not_blank check (char_length(trim(name)) > 0),
      constraint brands_slug_format check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$')
    );
    create table public.products (id uuid primary key default gen_random_uuid(), brand_id uuid references public.brands(id), title text not null, slug text not null unique);
    create table public.product_variants (id uuid primary key default gen_random_uuid(), product_id uuid references public.products(id), sku text not null, price_minor bigint not null, is_active boolean not null);
  `);
  for (const name of EXISTING) {
    await db.query(`insert into public.brands (name, slug, logo_reference, is_active, data_class, updated_at) values ($1, $2, $3, true, 'real', '2026-09-02T00:00:00Z')`, [name, name.toLowerCase(), `/assets/brands/${name.toLowerCase()}.svg`]);
  }
  for (const [name, slug, active, cls] of extraBrands) {
    await db.query(`insert into public.brands (name, slug, is_active, data_class, updated_at) values ($1, $2, $3, $4, '2026-09-02T00:00:00Z')`, [name, slug, active, cls]);
  }
  await db.exec(`
    insert into public.products (brand_id, title, slug) select id, 'Samsung A07', 'samsung-a07' from public.brands where slug = 'samsung';
    insert into public.product_variants (product_id, sku, price_minor, is_active) select id, 'MB001', 3690000, true from public.products;
  `);
  return db;
}

const snapshot = async (db) => ({
  brands: (await db.query(`select id, name, slug, description, logo_reference, is_active, data_class::text, created_at, updated_at from public.brands order by slug`)).rows,
  products: (await db.query(`select * from public.products order by id`)).rows,
  variants: (await db.query(`select * from public.product_variants order by id`)).rows,
});

async function runMigration(db) {
  try {
    await db.exec(MIGRATION);
  } catch (error) {
    await db.exec("rollback").catch(() => {});
    throw error;
  }
}

test("adds exactly ZTE and VgoTel (real, active, exact names) and touches nothing else", async () => {
  const db = await makeDb();
  const before = await snapshot(db);
  await runMigration(db);
  const after = await snapshot(db);
  const added = after.brands.filter((row) => !before.brands.some((old) => old.id === row.id));
  assert.deepEqual(added.map((row) => [row.name, row.slug, row.is_active, row.data_class, row.logo_reference, row.description]), [
    ["VgoTel", "vgotel", true, "real", null, null],
    ["ZTE", "zte", true, "real", null, null],
  ]);
  // Every existing brand row is byte-for-byte identical (including updated_at); products and variants untouched.
  assert.deepEqual(after.brands.filter((row) => before.brands.some((old) => old.id === row.id)), before.brands);
  assert.deepEqual(after.products, before.products);
  assert.deepEqual(after.variants, before.variants);
  assert.equal(after.brands.length, EXISTING.length + 2);
});

test("re-running is safe: no duplicate, no change", async () => {
  const db = await makeDb();
  await runMigration(db);
  const once = await snapshot(db);
  await runMigration(db);
  assert.deepEqual(await snapshot(db), once);
  const counts = (await db.query(`select lower(name) as n, count(*)::int as c from public.brands where lower(name) in ('zte', 'vgotel') group by 1 order by 1`)).rows;
  assert.deepEqual(counts, [{ n: "vgotel", c: 1 }, { n: "zte", c: 1 }]);
});

test("an existing look-alike (e.g. a 'Zte' development row) stops the migration and nothing changes — never a duplicate, never an edit", async () => {
  const db = await makeDb([["Zte", "zte", false, "development"]]);
  const before = await snapshot(db);
  await assert.rejects(runMigration(db), /brand_guard: ZTE already exists as "Zte"/);
  assert.deepEqual(await snapshot(db), before, "VgoTel was not added either: the whole migration rolled back");
});

test("a slug already used by a different brand stops the migration and nothing changes", async () => {
  const db = await makeDb([["Vgo Tel Mobiles", "vgotel", true, "real"]]);
  const before = await snapshot(db);
  await assert.rejects(runMigration(db), /brand_guard: VgoTel already exists as "Vgo Tel Mobiles"/);
  assert.deepEqual(await snapshot(db), before);
});

test("the migration contains no update / delete and touches only public.brands", () => {
  const sql = MIGRATION.replace(/--.*$/gm, "");
  assert.doesNotMatch(sql, /\bupdate\s+public\.|\bdelete\s+from\b|\btruncate\b|\bdrop\b|\balter\b/i);
  const written = [...sql.matchAll(/insert\s+into\s+(public\.[a-z_]+)/gi)].map((m) => m[1]);
  assert.deepEqual(written, ["public.brands"]);
});

// ---------------------------------------------------------------------------
// Proof: with the brands present, the Android Stock Update planner no longer blocks ZTE / VgoTel phones.
// ---------------------------------------------------------------------------

const LIST = [
  "ZTE",
  "V80 Pro 8/256 black/peach @ 54500",
  "A56 4/128 black/gold @ 26500",
  "",
  "Vgotel",
  "Onyx 3/32 black/green @ 13500",
  "New 17 4/64 black/blue @ 18500",
].join("\n");

const catalog = [
  { id: "p1", slug: "samsung-a07", title: "Samsung A07", brand: "Samsung", category: "Mobile Phones", categorySlug: "mobile-phones", publicationStatus: "published", mediaCount: 3, specCount: 5,
    variants: [{ id: "v1", sku: "MB001", ram: "4 GB", storage: "64 GB", color: "Black", priceMinor: 3690000, compareAtPriceMinor: null, stock: 30, ptaStatus: "approved", condition: "brand_new", conditionGrade: null, batteryHealth: null, cycleCount: null, isActive: true, warrantyOverride: "1 Year", deliveryScope: "karachi_only" }] },
];

function plan(activeBrands) {
  const delta = buildStockDelta(parseStockList(LIST, activeBrands.map((name) => ({ name }))), catalog);
  return { delta, plan: buildWritePlan(delta, catalog, activeBrands) };
}

test("before: without the brands, every ZTE / VgoTel row is blocked (Brand not recognised -> Needs Attention) and no phone can be created", () => {
  const { delta, plan: before } = plan(EXISTING);
  assert.equal(before.steps.filter((s) => s.kind === "create_phone").length, 0);
  const phoneRows = delta.entries.filter((e) => e.kind !== "blocked");
  assert.equal(phoneRows.length, 8);
  assert.ok(phoneRows.every((e) => e.kind === "ambiguous" && e.reasons.includes("Brand not recognised")));
  assert.equal(before.blocked.length, 8);
  // The planner's own brand guard is a second line of defence for a brand the parser did recognise but the database lacks.
  const guarded = buildWritePlan(buildStockDelta(parseStockList(LIST, [...EXISTING, "ZTE", "VgoTel"].map((name) => ({ name }))), catalog), catalog, EXISTING);
  assert.equal(guarded.blocked.filter((b) => /“(ZTE|VgoTel)” is not set up on the website yet/.test(b.reason)).length, 8);
});

test("after the migration: the active brand list from the database unblocks every ZTE / VgoTel phone, with exact brand names", async () => {
  const db = await makeDb();
  await runMigration(db);
  // Same query the page uses (stockListDeltaDb.loadActiveBrands): active, real, by name.
  const activeBrands = (await db.query(`select name from public.brands where is_active and data_class = 'real' order by name`)).rows.map((row) => row.name);
  const { delta, plan: after } = plan(activeBrands);
  assert.equal(after.blocked.filter((b) => /not set up/.test(b.reason)).length, 0);
  assert.equal(after.blocked.length, 0);
  assert.equal(delta.counts.ambiguous, 0);
  const phones = after.steps.filter((s) => s.kind === "create_phone").map((s) => [s.payload.brand, s.payload.title, s.payload.variants.length]);
  assert.deepEqual(phones, [["ZTE", "ZTE V80 Pro", 2], ["ZTE", "ZTE A56", 2], ["VgoTel", "VgoTel Onyx", 2], ["VgoTel", "VgoTel New 17", 2]]);
  // The "Vgotel" heading in the list resolves to the exact display name "VgoTel".
  assert.ok(delta.entries.every((e) => ["ZTE", "VgoTel"].includes(e.row.brand)));
  assert.ok(after.steps.filter((s) => s.kind === "create_phone").every((s) => s.payload.variants.every((v) => v.stock === 30)));
});
