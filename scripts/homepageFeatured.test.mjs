// Homepage Featured Products — homepage_featured_products against the replayed migrations
// (see scripts/support/catalogTestDatabase.mjs). Nothing here touches the live database.
import assert from "node:assert/strict";
import test from "node:test";
import { createCatalogTestDatabase, signInAsOwner } from "./support/catalogTestDatabase.mjs";

const variant = (overrides = {}) => ({
  source: "Products row 2", sku: null, ram: "8 GB", storage: "256 GB", color: "Black",
  price_minor: 5_000_000, compare_at_price_minor: null, stock: null,
  pta_status: "approved", condition: "brand_new", condition_grade: null,
  battery_health_percent: null, battery_cycle_count: null,
  warranty: "1 Year Official", delivery_scope: "karachi_only", ...overrides,
});
const product = (title, overrides = {}) => ({
  action: "Create", source: "Products rows 2", product_type: "Mobile Phone",
  brand: "Samsung", title, category: "Mobile Phones",
  specifications: [], variants: [variant()], ...overrides,
});

const db = await createCatalogTestDatabase();
await signInAsOwner(db);
const all = async (sql, params = []) => (await db.query(sql, params)).rows;
const importProducts = (products) =>
  db.query(`select public.apply_catalog_bulk_import_v2($1::jsonb)`, [JSON.stringify({ products })]);
const idOf = async (title) => (await all(`select id from public.products where title = $1`, [title]))[0].id;

// Gives each named product a primary Cloudinary image, then publishes it at a fixed time.
async function publish(title, publishedAt, { featured = false } = {}) {
  const id = await idOf(title);
  await db.query(
    `insert into public.product_media (product_id, alt_text, is_primary, cloudinary_public_id, cloudinary_asset_id, cloudinary_version, secure_url, width, height, bytes, format)
     values ($1::uuid, 'Front', true, 'test/' || $1::text, 'asset-' || $1::text, 1, 'https://example.test/' || $1::text || '.jpg', 800, 800, 1000, 'jpg')`,
    [id],
  );
  await db.query(
    `update public.products set publication_status = 'published', published_at = $2::timestamptz, is_featured = $3 where id = $1`,
    [id, publishedAt, featured],
  );
  return id;
}
const featuredTitles = async (limit) =>
  (await all(
    limit === undefined
      ? `select title from public.homepage_featured_products()`
      : `select title from public.homepage_featured_products($1)`,
    limit === undefined ? [] : [limit],
  )).map((row) => row.title);

// 120 newer, published, non-featured products push an old featured product out of the
// newest-100 page that the homepage previously filtered on the client.
const fillers = Array.from({ length: 120 }, (_, index) => `Samsung Filler ${String(index + 1).padStart(3, "0")}`);
await importProducts(fillers.slice(0, 60).map((title) => product(title)));
await importProducts(fillers.slice(60).map((title) => product(title)));
for (const [index, title] of fillers.entries())
  await publish(title, new Date(Date.UTC(2026, 5, 1, 0, index)).toISOString());

await importProducts([
  product("Samsung Old Featured"),
  product("Samsung Featured A"),
  product("Samsung Featured B", { variants: [variant({ color: "Black", stock: 0 }), variant({ color: "Blue", stock: 4 })] }),
  product("Samsung Draft Featured"),
  product("Samsung Sold Out Featured"),
  product("Samsung No Image Featured"),
  product("Samsung Inactive Variant Featured"),
  product("Samsung Zero Price Featured"),
]);
await publish("Samsung Old Featured", "2020-01-01T00:00:00Z", { featured: true });
await publish("Samsung Featured A", "2025-03-01T00:00:00Z", { featured: true });
await publish("Samsung Featured B", "2025-02-01T00:00:00Z", { featured: true });
await db.query(`update public.products set is_featured = true where title = 'Samsung Draft Featured'`);
// Ineligible after publication: sold out, image removed, variant deactivated, price zeroed.
const soldOut = await publish("Samsung Sold Out Featured", "2025-06-01T00:00:00Z", { featured: true });
await db.query(
  `insert into public.inventory_movements (variant_id, quantity_delta, reason, reference, note)
   select v.id, -public.current_inventory(v.id), 'correction', 'homepage-featured-test', 'sell out' from public.product_variants v where v.product_id = $1`,
  [soldOut],
);
const noImage = await publish("Samsung No Image Featured", "2025-06-02T00:00:00Z", { featured: true });
await db.query(`delete from public.product_media where product_id = $1`, [noImage]);
const inactive = await publish("Samsung Inactive Variant Featured", "2025-06-03T00:00:00Z", { featured: true });
await db.query(`update public.product_variants set is_active = false where product_id = $1`, [inactive]);
const zeroPrice = await publish("Samsung Zero Price Featured", "2025-06-04T00:00:00Z", { featured: true });
await db.query(`update public.product_variants set price_minor = 0 where product_id = $1`, [zeroPrice]);

test("an old featured product outside the newest-100 page is still eligible", async () => {
  const newest100 = (await all(`select title from public.search_public_catalog(p_limit => 100)`)).map((row) => row.title);
  assert.equal(newest100.length, 100);
  assert.ok(!newest100.includes("Samsung Old Featured"));
  assert.ok((await featuredTitles()).includes("Samsung Old Featured"));
});

test("only published, featured, imaged, priced, in-stock products qualify (1-3 shows only those)", async () => {
  assert.deepEqual(await featuredTitles(), ["Samsung Featured A", "Samsung Featured B", "Samsung Old Featured"]);
});

test("a featured product with one sold-out and one in-stock variant qualifies", async () => {
  const [row] = await all(`select variants from public.homepage_featured_products() where title = 'Samsung Featured B'`);
  assert.deepEqual(row.variants.map((item) => item.quantity).sort(), [0, 4]);
});

test("returned rows keep the public catalog card shape", async () => {
  const [row] = await all(`select * from public.homepage_featured_products() where title = 'Samsung Featured A'`);
  assert.equal(row.is_featured, true);
  assert.equal(row.brand.name, "Samsung");
  assert.equal(row.category.slug, "mobile-phones");
  assert.equal(row.media[0].isPrimary, true);
  assert.equal(row.variants[0].priceMinor, 5_000_000);
  assert.equal(row.variants[0].quantity, 10);
});

test("4+ eligible products return the newest 4; the limit is clamped to 1-12", async () => {
  await importProducts(["C", "D", "E"].map((suffix) => product(`Samsung Featured ${suffix}`)));
  await publish("Samsung Featured C", "2025-04-01T00:00:00Z", { featured: true });
  await publish("Samsung Featured D", "2025-05-01T00:00:00Z", { featured: true });
  await publish("Samsung Featured E", "2025-01-01T00:00:00Z", { featured: true });
  assert.deepEqual(await featuredTitles(), ["Samsung Featured D", "Samsung Featured C", "Samsung Featured A", "Samsung Featured B"]);
  assert.equal((await featuredTitles(100)).length, 6);
  assert.deepEqual(await featuredTitles(0), ["Samsung Featured D"]);
});

test("0 eligible products returns an empty result", async () => {
  await db.query(`update public.products set is_featured = false where is_featured`);
  assert.deepEqual(await featuredTitles(), []);
});

test("anonymous storefront visitors may call the read-only RPC", async () => {
  const [row] = await all(`select
    has_function_privilege('anon', 'public.homepage_featured_products(integer)', 'execute') as anon,
    has_function_privilege('authenticated', 'public.homepage_featured_products(integer)', 'execute') as authenticated`);
  assert.deepEqual(row, { anon: true, authenticated: true });
});
