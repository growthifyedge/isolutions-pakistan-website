// Catalog → Variants & Pricing for a LIVE phone (Owner-approved 2026-11-23, Option A): editable prices + new Android
// variants, Old vs New review, ONE save through the existing server-checked Stock Update function. The S26 Ultra dry run
// executes the REAL apply_android_stock_phone migration in an in-memory Postgres (PGlite); no DEV / PROD database is used.
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import {
  LIVE_OPENING_STOCK,
  buildLiveReview,
  inheritedFacts,
  liveConfirmationPhrase,
  liveEditEnvironmentBlocker,
  liveKindFor,
  productCondition,
  verifyLiveSave,
} from "../src/lib/liveVariantEdit.ts";

const DEV = "https://acwatgxkcyrdxpcljxjb.supabase.co";
const PROD = "https://nlxfwppywxumymbjkvwt.supabase.co";
const src = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8").replace(/\r\n/g, "\n");

// The Samsung S26 Ultra as on PROD (read-only copy, 2026-11-23).
const v = (sku, storage, color, price, extra = {}) => ({
  id: `id-${sku}`, sku, ram: "12 GB", storage, color, priceMinor: price * 100, compareAtPriceMinor: null, isActive: true,
  ptaStatus: "approved", condition: "brand_new", warrantyOverride: "1 Year", deliveryScope: "karachi_only", ...extra,
});
const s26 = () => [
  v("MB051", "256 GB", "Black", 389500), v("MB052", "256 GB", "Volt", 389500), v("MB053", "256 GB", "Blue", 389500), v("MB054", "256 GB", "White", 389500),
  v("MB055", "512 GB", "Black", 448000), v("MB056", "512 GB", "Volt", 443000, { isActive: false }), v("MB057", "512 GB", "Blue", 448000), v("MB058", "512 GB", "White", 448000),
];
const OWNER_EDIT = { "id-MB051": "385000", "id-MB052": "385,000", "id-MB053": "385000", "id-MB054": "385000", "id-MB055": "438000", "id-MB057": "438000" };
const COBALT = { ram: "12", storage: "512", color: "Cobalt", price: "440000" };
const review = (variants, priceInputs, newRows = [], kind = "android", title = "Samsung S26 Ultra") =>
  buildLiveReview({ kind, productId: "p-s26u", title, variants, priceInputs, newRows });

// ---------------------------------------------------------------- pure logic

test("S26 Ultra example: 6 price changes + new Cobalt 12/512 (stock 30, copied facts); everything else untouched", () => {
  const r = review(s26(), OWNER_EDIT, [COBALT]);
  assert.deepEqual(r.problems, []);
  assert.deepEqual(r.changes.map((c) => [c.sku, c.fromMinor / 100, c.toMinor / 100]), [
    ["MB051", 389500, 385000], ["MB052", 389500, 385000], ["MB053", 389500, 385000], ["MB054", 389500, 385000], ["MB055", 448000, 438000], ["MB057", 448000, 438000],
  ]);
  assert.equal(r.additions.length, 1);
  assert.deepEqual({ ...r.additions[0], row: undefined }, {
    row: undefined, ram: "12 GB", storage: "512 GB", color: "Cobalt", priceMinor: 44000000, stock: 30,
    inherited: { pta_status: "approved", condition: "brand_new", warranty_override: "1 Year", delivery_scope: "karachi_only" },
  });
  assert.equal(r.changeCount, 7);
  assert.equal(liveConfirmationPhrase(r), "UPDATE 7 CHANGES");
  assert.equal(r.payload.kind, "android");
  const { payload } = r.payload;
  assert.equal(payload.expected.variants.length, 8, "every variant, as loaded (stale-data guard)");
  assert.deepEqual(payload.steps.map((s) => s.kind), ["price", "price", "price", "price", "price", "price", "add_variant"]);
  assert.ok(!payload.steps.some((s) => ["set_stock", "show", "hide"].includes(s.kind)), "never stock / visibility");
  const touched = new Set(payload.steps.map((s) => s.variant_id).filter(Boolean));
  for (const sku of ["MB056", "MB058"]) assert.ok(!touched.has(`id-${sku}`), `${sku} untouched`);
  assert.equal(LIVE_OPENING_STOCK.android, 30);
});

test("unchanged boxes are not changes; a bad price, a price not below compare-at and an empty save are blocked", () => {
  assert.equal(review(s26(), { "id-MB051": "389500", "id-MB052": " 389500 " }).changeCount, 0);
  assert.equal(review(s26(), {}).payload, null);
  assert.match(review(s26(), { "id-MB051": "38a000" }).problems[0], /is not a price/);
  assert.match(review(s26(), { "id-MB051": "385000.50" }).problems[0], /is not a price/);
  assert.match(review(s26(), { "id-MB051": "0" }).problems[0], /is not a price/);
  const withCompare = s26().map((x) => (x.sku === "MB051" ? { ...x, compareAtPriceMinor: 39000000 } : x));
  assert.match(review(withCompare, { "id-MB051": "395000" }).problems[0], /must be below its compare-at price Rs 390,000/);
  assert.equal(review(withCompare, { "id-MB051": "385000" }).problems.length, 0);
});

test("duplicates are blocked: an existing colour (any spelling / spacing), a hidden one, and the same new row twice", () => {
  assert.match(review(s26(), {}, [{ ram: "12GB", storage: "512gb", color: "blk", price: "1" }]).problems[0], /already exists \(MB055\)/);
  assert.match(review(s26(), {}, [{ ram: "12", storage: "512", color: "Volt", price: "1" }]).problems[0], /already exists \(MB056, hidden\)/);
  assert.match(review(s26(), {}, [COBALT, { ...COBALT, color: " cobalt " }]).problems[0], /is added twice/);
  assert.match(review(s26(), {}, [{ ram: "", storage: "512", color: "Cobalt", price: "x" }]).problems[0], /RAM, price are missing/);
  assert.equal(review(s26(), {}, [{ ram: "", storage: "", color: "", price: "" }]).changeCount, 0, "an empty new row is ignored");
});

test("a hidden Android variant may get a new price but stays hidden (said in the review)", () => {
  const r = review(s26(), { "id-MB056": "440000" });
  assert.deepEqual(r.problems, []);
  assert.equal(r.changes[0].hidden, true);
  assert.match(r.notes[0], /MB056 is hidden on the website: it gets the new price but stays hidden/);
});

test("new variants copy facts only when every visible variant agrees; otherwise blocked (never guessed)", () => {
  const mixed = s26().map((x) => (x.sku === "MB051" ? { ...x, ptaStatus: "not_approved" } : x));
  assert.match(inheritedFacts(mixed).problem, /do not all have the same PTA/);
  assert.match(review(mixed, {}, [COBALT]).problems[0], /do not all have the same PTA/);
  assert.equal(review(mixed, { "id-MB051": "385000" }).problems.length, 0, "price edits still work");
  const unknown = s26().map((x) => ({ ...x, ptaStatus: "unknown" }));
  assert.match(inheritedFacts(unknown).problem, /no PTA \/ condition to copy/);
});

test("iPhone / tablet: visible prices only (hidden and new variants go to their Stock Update page); condition from the title", () => {
  const iphone = [v("IP001", "256 GB", "Black", 300000, { ram: null }), v("IP002", "256 GB", "Blue", 300000, { ram: null, isActive: false })];
  const ok = review(iphone, { "id-IP001": "295000" }, [], "iphone", "Apple iPhone 17");
  assert.deepEqual(ok.problems, []);
  assert.deepEqual(ok.payload, { kind: "iphone", payload: { product_id: "p-s26u", condition: "brand_new", expected: { variants: [{ id: "id-IP001", price_minor: 30000000, is_active: true }, { id: "id-IP002", price_minor: 30000000, is_active: false }] }, steps: [{ kind: "price", variant_id: "id-IP001", from_minor: 30000000, to_minor: 29500000 }] } });
  assert.match(review(iphone, { "id-IP002": "295000" }, [], "iphone", "Apple iPhone 17").problems[0], /is hidden — its price is changed together with showing it again on the iPhone Stock Update page/);
  assert.match(review(iphone, {}, [COBALT], "iphone", "Apple iPhone 17").problems[0], /need PTA and SIM choices — add them on the iPhone Stock Update page/);
  assert.match(review(iphone, { "id-IP001": "295000" }, [], "iphone", "Apple iPhone 15 (Used)").problems[0], /title says Used/);
  assert.equal(productCondition("Apple iPhone 15 Pro (Used)"), "used");
  const tablet = review([v("IP101", "128 GB", "Grey", 90000)], { "id-IP101": "85000" }, [], "tablet", "Samsung Tab A9");
  assert.equal(tablet.payload.kind, "tablet");
  assert.equal(tablet.payload.payload.condition, "brand_new");
});

test("which function: Android / iPhone / tablet+MacBook; Nokia, HMD, an iPhone title or a Gadget is never offered", () => {
  assert.equal(liveKindFor("mobile-phones", "Samsung", "Samsung S26 Ultra"), "android");
  assert.equal(liveKindFor("mobile-phones", "Apple", "Apple iPhone 17"), "iphone");
  assert.equal(liveKindFor("tablets", "Samsung", "Samsung Tab A9"), "tablet");
  assert.equal(liveKindFor("laptops", "Apple", "Apple MacBook Air"), "tablet");
  for (const [brand, title] of [["Nokia", "Nokia 105"], ["HMD", "HMD Pulse"], ["Samsung", "Samsung iPhone Lookalike"], [null, "No brand"]]) assert.equal(liveKindFor("mobile-phones", brand, title), null);
  assert.equal(liveKindFor("gadgets", "Anker", "Anker Charger"), null);
});

test("environment: saving only where the build and its Supabase project match (DEV or PROD), like the Stock Update pages", () => {
  assert.equal(liveEditEnvironmentBlocker(DEV, "development"), null);
  assert.equal(liveEditEnvironmentBlocker(PROD, "production"), null);
  assert.match(liveEditEnvironmentBlocker(PROD, "development"), /Build mode and project must match/);
  assert.match(liveEditEnvironmentBlocker("https://example.supabase.co", "production"), /UNKNOWN/);
});

test("after saving, the read-back must show exactly the planned prices and new variant", () => {
  const r = review(s26(), OWNER_EDIT, [COBALT]);
  const after = s26().map((x) => ({ ...x, priceMinor: (r.changes.find((c) => c.variantId === x.id)?.toMinor) ?? x.priceMinor }));
  const cobalt = { ...v("MB300", "512 GB", "Cobalt", 440000), id: "id-new" };
  assert.deepEqual(verifyLiveSave(r, [...after, cobalt], s26()), []);
  assert.match(verifyLiveSave(r, after, s26()).join(" "), /0 new variant\(s\) found, 1 planned/);
  assert.match(verifyLiveSave(r, [...s26(), cobalt], s26()).join(" "), /MB051: price is Rs 389,500, expected Rs 385,000/);
});

// ---------------------------------------------------------------- source safety

test("security: the live editor never writes a table; its only write is the existing server-checked function", () => {
  const editor = src("src/admin/LiveVariantEditor.tsx");
  const logic = src("src/lib/liveVariantEdit.ts");
  const db = src("src/lib/liveVariantEditDb.ts");
  for (const [name, text] of [["editor", editor], ["logic", logic], ["db", db]]) {
    assert.doesNotMatch(text, /\.(insert|upsert|update|delete)\s*\(/, `${name}: no direct table write`);
    assert.doesNotMatch(text, /\.rpc\s*\(/, `${name}: no new RPC call`);
    assert.doesNotMatch(text, /service_role|SERVICE_ROLE/);
  }
  assert.match(db, /stockUpdateDbDeps\(client\)\.applyPhone\(review\.payload\.payload\)/);
  assert.match(db, /iphoneUpdateDbDeps\(client\)\.applyPhone\(review\.payload\.payload\)/);
  assert.match(db, /tabletUpdateDbDeps\(client\)\.applyProduct\(review\.payload\.payload\)/);
  assert.match(editor, /confirmation\.trim\(\) !== phrase/, "typed confirmation");
  assert.match(editor, /liveEditEnvironmentBlocker\(SUPABASE_URL, BUILD_MODE\)/);
});

test("Catalog editor: superseded by the fully editable table (2026-11-23); the previous tools stay for drafts", () => {
  const catalog = src("src/admin/AdminCatalog.tsx");
  assert.match(catalog, /const variantManagerOn = Boolean\(productId\) && draft\.data_class === "real";/);
  assert.match(catalog, /\{variantManagerOn && productId && \(\s*<VariantManager productId=\{productId\}/);
  // The existing draft editor is still there, unchanged (add form, price save, edit / delete).
  for (const piece of ["onClick={addVariant}", "onClick={() => saveVariantPrice(v.id)}", "setVariantEditing(editableVariant(v))", "setVariantPendingDelete(v)", "Apply commercial defaults to all variants"])
    assert.ok(catalog.includes(piece), piece);
  assert.match(catalog, /const serverSafeLive = Boolean\(productId\) && !manualMode && draft\.publication_status === "published";/);
});

// ---------------------------------------------------------------- dry run on the REAL Android function (PGlite)

const MIGRATIONS = new URL("../supabase/migrations/", import.meta.url);
const read = (file) => readFileSync(new URL(file, MIGRATIONS), "utf8");
function extractFunction(file, name) {
  const source = read(file);
  const start = source.search(new RegExp(`create (or replace )?function public\\.${name}\\(`));
  assert.ok(start >= 0, `${name} not found in ${file}`);
  const end = source.indexOf("\n$$;", start);
  return source.slice(start, end + 4).replace(/^create function/, "create or replace function");
}
const ADMIN = "00000000-0000-4000-8000-000000000001";

async function makeDb() {
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
      constraint variants_compare_price_strictly_greater check (compare_at_price_minor is null or compare_at_price_minor > price_minor),
      constraint variants_explicit_combination_unique unique nulls not distinct (product_id, ram_display, storage_display, color_finish, pta_status, condition, carrier_jv, condition_grade, battery_health_percent, battery_cycle_count)
    );
    create table public.inventory_movements (id bigint generated always as identity primary key, variant_id uuid not null references public.product_variants(id), quantity_delta integer not null, reason public.inventory_movement_reason not null, reference text, note text, actor_id uuid references auth.users(id), created_at timestamptz not null default now(), constraint inventory_delta_nonzero check (quantity_delta <> 0));
    create table public.product_specifications (id uuid primary key default extensions.gen_random_uuid(), product_id uuid not null references public.products(id) on delete cascade, specification_group text, label text not null, value text not null, sort_order integer not null default 0, created_at timestamptz not null default now(), updated_at timestamptz not null default now());
    create table public.product_media (id uuid primary key default extensions.gen_random_uuid(), product_id uuid not null references public.products(id) on delete cascade, variant_id uuid references public.product_variants(id), cloudinary_public_id text, alt_text text not null, sort_order integer not null default 0, is_primary boolean not null default false, created_at timestamptz not null default now(), updated_at timestamptz not null default now());
    create table public.product_media_variant_assignments (media_id uuid not null references public.product_media(id) on delete cascade, variant_id uuid not null references public.product_variants(id) on delete cascade, created_at timestamptz not null default now(), primary key (media_id, variant_id));
  `);
  const FOUNDATION = "202608200004_phase_3a_full_foundation_rls_repair.sql";
  const SKU = "202609240003_catalog_sku_sequences.sql";
  for (const name of ["set_updated_at", "is_catalog_admin", "current_inventory"]) await db.exec(extractFunction(FOUNDATION, name));
  for (const line of read(SKU).match(/create sequence public\.catalog_sku_[a-z]+_seq[^;]*;/g)) await db.exec(line);
  for (const name of ["catalog_sku_prefix", "next_catalog_sku", "assign_catalog_variant_sku"]) await db.exec(extractFunction(SKU, name));
  await db.exec(`
    create trigger variants_set_updated_at before update on public.product_variants for each row execute function public.set_updated_at();
    create trigger product_variants_assign_catalog_sku before insert or update of sku on public.product_variants for each row execute function public.assign_catalog_variant_sku();
  `);
  await db.exec(read("202610180001_android_stock_update_per_phone.sql"));
  await db.exec(read("202610190001_android_stock_update_per_phone_messages.sql"));
  await db.exec(`
    insert into auth.users (id) values ('${ADMIN}'); insert into public.profiles (id, role, is_active) values ('${ADMIN}', 'admin', true);
    insert into public.brands (name, slug, is_active, data_class) values ('Samsung', 'samsung', true, 'real');
    insert into public.categories (name, slug, is_active, data_class) values ('Mobile Phones', 'mobile-phones', true, 'real');
    insert into public.products (brand_id, category_id, title, slug, publication_status, data_class, published_at)
      select b.id, c.id, 'Samsung S26 Ultra', 'samsung-s26-ultra', 'published', 'real', now() from public.brands b, public.categories c;
  `);
  const productId = (await db.query(`select id from public.products`)).rows[0].id;
  for (const x of s26()) {
    const id = (await db.query(
      `insert into public.product_variants (product_id, sku, ram_display, storage_display, color_finish, price_minor, pta_status, condition, warranty_override, delivery_scope, is_active)
       values ($1, '', $2, $3, $4, $5, 'approved', 'brand_new', '1 Year', 'karachi_only', $6) returning id`,
      [productId, x.ram, x.storage, x.color, x.priceMinor, x.isActive],
    )).rows[0].id;
    await db.query(`insert into public.inventory_movements (variant_id, quantity_delta, reason, reference) values ($1, 7, 'initial', 'seed')`, [id]);
  }
  await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [ADMIN]);
  return { db, productId };
}
const loadVariants = async (db, productId) =>
  (await db.query(`select v.*, public.current_inventory(v.id) as stock from public.product_variants v where product_id = $1 order by sku`, [productId])).rows.map((row) => ({
    id: row.id, sku: row.sku, ram: row.ram_display, storage: row.storage_display, color: row.color_finish, priceMinor: Number(row.price_minor),
    compareAtPriceMinor: row.compare_at_price_minor === null ? null : Number(row.compare_at_price_minor), isActive: row.is_active, ptaStatus: row.pta_status,
    condition: row.condition, warrantyOverride: row.warranty_override, deliveryScope: row.delivery_scope, stock: Number(row.stock),
  }));
const call = async (db, payload) => (await db.query(`select public.apply_android_stock_phone($1::jsonb) as r`, [JSON.stringify(payload)])).rows[0].r;

test("dry run on the real Android function: the S26 Ultra example saves exactly as reviewed; stock and other variants untouched", async () => {
  const { db, productId } = await makeDb();
  const before = await loadVariants(db, productId);
  // The test database gives its own SKUs, so the Owner's edits are matched by storage + colour.
  const fixture = Object.fromEntries(s26().map((x) => [x.id, `${x.storage} ${x.color}`]));
  const byConfig = Object.fromEntries(before.map((x) => [`${x.storage} ${x.color}`, x.id]));
  const edits = Object.fromEntries(Object.entries(OWNER_EDIT).map(([key, value]) => [byConfig[fixture[key]], value]));
  assert.equal(Object.keys(edits).filter(Boolean).length, 6);
  const r = buildLiveReview({ kind: "android", productId, title: "Samsung S26 Ultra", variants: before, priceInputs: edits, newRows: [COBALT] });
  assert.deepEqual(r.problems, []);
  const result = await call(db, r.payload.payload);
  assert.equal(result.price_updates, 6);
  assert.equal(result.stock_steps, 0);
  const after = await loadVariants(db, productId);
  assert.deepEqual(verifyLiveSave(r, after, before), []);
  const prices = Object.fromEntries(after.map((x) => [`${x.storage} ${x.color}`, [x.priceMinor / 100, x.stock, x.isActive]]));
  assert.deepEqual(prices, {
    "256 GB Black": [385000, 7, true], "256 GB Volt": [385000, 7, true], "256 GB Blue": [385000, 7, true], "256 GB White": [385000, 7, true],
    "512 GB Black": [438000, 7, true], "512 GB Volt": [443000, 7, false], "512 GB Blue": [438000, 7, true], "512 GB White": [448000, 7, true],
    "512 GB Cobalt": [440000, 30, true],
  });
  const cobalt = after.find((x) => x.color === "Cobalt");
  assert.match(cobalt.sku, /^MB[0-9]{3}$/);
  assert.deepEqual([cobalt.ptaStatus, cobalt.condition, cobalt.warrantyOverride, cobalt.deliveryScope], ["approved", "brand_new", "1 Year", "karachi_only"]);

  // Stale data: the same review saved again is refused by the server (prices changed since the page loaded); nothing changes.
  await assert.rejects(call(db, r.payload.payload), /android_stock_phone_changed_since_check/);
  assert.deepEqual(await loadVariants(db, productId), after);
});
