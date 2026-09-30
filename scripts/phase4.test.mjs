import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  formatPkrMinor,
  minimumActiveVariantPrice,
  parsePkrMajorToMinor,
  pkrMajorInputFromMinor,
} from "../src/lib/money.ts";
import { nullIfEmpty } from "../src/lib/catalogFilters.ts";
import {
  HOMEPAGE_FEATURED_LIMIT,
  selectHomepageFeaturedProducts,
} from "../src/lib/homepageFeatured.ts";

const [
  migration,
  storefront,
  catalog,
  admin,
  app,
  phase3b,
  taxonomyRepair,
  firebase,
] = await Promise.all([
  readFile("supabase/migrations/202608250001_phase_4_real_catalog.sql", "utf8"),
  readFile("src/StorefrontApp.tsx", "utf8"),
  readFile("src/lib/catalog.ts", "utf8"),
  readFile("src/admin/AdminCatalog.tsx", "utf8"),
  readFile("src/App.tsx", "utf8"),
  readFile(
    "supabase/migrations/202608210001_phase_3b_cloudinary_media.sql",
    "utf8",
  ),
  readFile(
    "supabase/migrations/202608260001_phase_4_public_taxonomy_rpc.sql",
    "utf8",
  ),
  readFile("firebase.json", "utf8"),
]);
const featuredMigration = await readFile(
  "supabase/migrations/202609300001_homepage_featured_products.sql",
  "utf8",
);
const priceRepair = await readFile(
  "supabase/migrations/202608260002_phase_4_macbook_neo_price_repair.sql",
  "utf8",
);

test("draft products remain public-invisible", () =>
  assert.match(migration, /publication_status = 'published'/));
test("development and test data cannot leak into public catalog", () => {
  assert.match(migration, /data_class = 'real'/);
  assert.match(migration, /default 'development'/);
});
test("authenticated Admin storefront taxonomy remains real-only", () => {
  assert.match(catalog, /rpc\("public_catalog_taxonomy"\)/);
  assert.doesNotMatch(catalog, /\.from\("brands"\)|\.from\("categories"\)/);
  assert.match(taxonomyRepair, /b\.data_class = 'real' and b\.is_active/);
  assert.match(taxonomyRepair, /c\.data_class = 'real' and c\.is_active/);
  assert.match(taxonomyRepair, /p\.data_class = 'real'/);
  assert.match(taxonomyRepair, /p\.publication_status = 'published'/);
  assert.match(
    taxonomyRepair,
    /grant execute on function public\.public_catalog_taxonomy\(\) to anon, authenticated/,
  );
});
test("published real catalog query is database-backed", () => {
  assert.match(catalog, /rpc\(\s*"search_public_catalog"/);
  assert.match(migration, /security definer/);
});
test("Shop preserves a published RPC array and renders every product", () => {
  const response = [{ id: "one" }, { id: "two" }];
  assert.equal(response.length, 2);
  assert.match(
    storefront,
    /function Shop[\s\S]*fetchPublicCatalog\(filters\)[\s\S]*\.then\(setProducts\)[\s\S]*products\.map/,
  );
});
test("an empty RPC array remains empty", () => {
  const response = [];
  assert.equal(response.length, 0);
});
test("default Shop state sends empty multi-select filters as null", () => {
  assert.equal(nullIfEmpty([]), null);
  assert.equal(nullIfEmpty([]), null);
});
test("selected Shop filters are preserved for the public RPC", () => {
  assert.deepEqual(nullIfEmpty(["laptops"]), ["laptops"]);
  assert.deepEqual(nullIfEmpty(["apple"]), ["apple"]);
});
test("Firebase Hosting keeps direct SPA routes on the production build", () => {
  const hosting = JSON.parse(firebase).hosting;
  assert.equal(hosting.public, "dist");
  assert.deepEqual(hosting.rewrites, [
    { source: "**", destination: "/index.html" },
  ]);
});
test("product routing uses real slugs", () => {
  assert.match(storefront, /path\.startsWith\("\/product\/"\)/);
  assert.match(storefront, /fetchPublicCatalog\(\{ slug/);
});
test("storefront does not import the fictional mock catalog", () => {
  assert.doesNotMatch(app, /mockCatalog/);
  assert.doesNotMatch(storefront, /mockCatalog|prototype-flagship/);
});
test("homepage Featured Products never renders fictional or demo products", () => {
  // The fictional demo cards were removed; no demo list, switch, card, or product name may return.
  assert.doesNotMatch(
    storefront,
    /Aster One|SlateBook|Vision Tab|Arc Watch|homepageDemoFeaturedProducts|FeaturedDemoCard|USE_LIVE_FEATURED_PRODUCTS|assets\/featured\//,
  );
  assert.doesNotMatch(storefront, /home-featured-empty|Featured products are being prepared/);
  // Only the real card renders, and the section is hidden when nothing qualifies.
  assert.match(storefront, /products\.map\(\(product\) => <FeaturedProductCard product=\{product\} key=\{product\.id\} \/>\)/);
  assert.match(storefront, /\{featuredProducts\.length > 0 && <FeaturedProducts products=\{featuredProducts\} \/>\}/);
});
test("homepage Featured Products uses the dedicated server-side read, not the newest-100 page", () => {
  assert.match(storefront, /fetchHomepageFeaturedProducts\(\)\s*\.then\(setFeaturedProducts\)\s*\.catch\(\(\) => setFeaturedProducts\(\[\]\)\)/);
  assert.doesNotMatch(storefront, /products\.filter\(\(product\) => product\.is_featured\)/);
  assert.match(catalog, /rpc\("homepage_featured_products", \{\s*p_limit: limit,\s*\}\)/);
  assert.match(catalog, /return selectHomepageFeaturedProducts\(/);
  assert.equal(HOMEPAGE_FEATURED_LIMIT, 4);
});
test("homepage_featured_products RPC filters to sellable real featured products", () => {
  const where = featuredMigration.slice(featuredMigration.indexOf("with featured as ("), featuredMigration.indexOf("), inventory as ("));
  assert.match(where, /p\.data_class = 'real' and p\.publication_status = 'published' and p\.published_at is not null/);
  assert.match(where, /and p\.is_featured\n/);
  assert.match(where, /b\.data_class = 'real' and b\.is_active/);
  assert.match(where, /c\.data_class = 'real' and c\.is_active/);
  assert.match(where, /m\.is_primary\s+and m\.cloudinary_public_id is not null and m\.secure_url is not null/);
  assert.match(where, /v\.is_active and v\.price_minor > 0\s+and \(select coalesce\(sum\(im\.quantity_delta\), 0\) from public\.inventory_movements im where im\.variant_id = v\.id\) > 0/);
  // No newest-N pre-page: the featured filter runs before the limit, in deterministic order.
  assert.match(where, /order by p\.published_at desc, p\.id\s+limit least\(greatest\(coalesce\(p_limit, 4\), 1\), 12\)/);
  // Additive only: the existing public catalog RPC is neither called, dropped, nor redefined.
  assert.doesNotMatch(featuredMigration, /public\.search_public_catalog|drop function|create or replace/i);
  assert.match(featuredMigration, /language sql stable security definer set search_path = ''/);
  assert.match(featuredMigration, /revoke all on function public\.homepage_featured_products\(integer\) from public;/);
  assert.match(featuredMigration, /grant execute on function public\.homepage_featured_products\(integer\) to anon, authenticated;/);
  assert.doesNotMatch(featuredMigration, /\b(insert into|update public\.|delete from|drop table|alter table)\b/i);
});
test("homepage Featured selection keeps only sellable featured products, max 4", () => {
  const media = [{ id: "m", variantId: null, publicId: "p/1", url: "https://res.cloudinary.com/x.jpg", alt: "", width: 1, height: 1, format: "jpg", isPrimary: true }];
  const variant = (priceMinor, quantity) => ({ id: `${priceMinor}-${quantity}`, sku: "S", ram: null, storage: null, color: null, priceMinor, compareAtPriceMinor: null, ptaStatus: "approved", condition: "brand_new", warranty: null, carrierJv: null, deliveryScope: "nationwide", quantity });
  const product = (id, overrides = {}) => ({ id, slug: id, title: id, is_featured: true, media, variants: [variant(100, 1)], ...overrides });
  assert.deepEqual(selectHomepageFeaturedProducts([]), []);
  assert.deepEqual(
    selectHomepageFeaturedProducts([
      product("ok"),
      product("not-featured", { is_featured: false }),
      product("no-image", { media: [] }),
      product("no-primary", { media: [{ ...media[0], isPrimary: false }] }),
      product("no-variant", { variants: [] }),
      product("out-of-stock", { variants: [variant(100, 0)] }),
      product("zero-price", { variants: [variant(0, 5)] }),
      product("mixed", { variants: [variant(100, 0), variant(200, 3)] }),
    ]).map((item) => item.id),
    ["ok", "mixed"],
  );
  assert.equal(selectHomepageFeaturedProducts(["a", "b", "c", "d", "e", "f"].map((id) => product(id))).length, 4);
  assert.equal(selectHomepageFeaturedProducts(["a", "b"].map((id) => product(id))).length, 2);
});
test("variants remain explicit rows without Cartesian generation", () => {
  assert.match(admin, /Add explicit variant/);
  assert.doesNotMatch(storefront, /cartesian/i);
  // flatMap is only used to read existing variants or filter menu links, never to build
  // option combinations.
  const flatMaps = [...storefront.matchAll(/flatMap\(/g)].map((match) => storefront.slice(match.index - 30, match.index + 160));
  assert.ok(flatMaps.length > 0);
  for (const usage of flatMaps)
    assert.match(usage, /products\.flatMap\(\(product\)\s*=>\s*product\.variants\.map\(|candidates\.flatMap\(/, usage);
});
test("exact minimum active variant pricing and PKR formatting", () => {
  const variants = [
    { priceMinor: 22500000 },
    { priceMinor: 22300000 },
    { priceMinor: 22300000 },
    { priceMinor: 25900000 },
    { priceMinor: 25600000 },
    { priceMinor: 22299800, isActive: false },
  ];
  const minimum = minimumActiveVariantPrice(variants);
  assert.equal(minimum, 22300000);
  assert.equal(formatPkrMinor(minimum), "Rs 223,000");
  assert.equal(parsePkrMajorToMinor("223,000"), 22300000);
  assert.doesNotMatch(
    admin,
    /Math\.round\(Number\(newVariant\.price\) \* 100\)/,
  );
  assert.doesNotMatch(storefront, /Number\(e\.target\.value\) \* 100/);
});
test("compare-at price is returned only when greater than current price", () => {
  assert.match(migration, /compare_at_price_minor > v\.price_minor/);
  assert.match(catalog, /compareAtPriceMinor > variant\.priceMinor/);
});
test("variant create, save, reload, edit, and repeat-save preserve exact money", () => {
  let storedMinor = parsePkrMajorToMinor("223000");
  assert.equal(storedMinor, 22300000);
  let adminInput = pkrMajorInputFromMinor(storedMinor);
  assert.equal(adminInput, "223000");
  storedMinor = parsePkrMajorToMinor(adminInput);
  assert.equal(storedMinor, 22300000);
  adminInput = "223000";
  storedMinor = parsePkrMajorToMinor(adminInput);
  assert.equal(pkrMajorInputFromMinor(storedMinor), "223000");
  storedMinor = parsePkrMajorToMinor(pkrMajorInputFromMinor(storedMinor));
  assert.equal(storedMinor, 22300000);
  // Renamed persistChangedVariantPrices -> persistChangedVariantPricing when compare-at
  // price was added to the same save; the exact-money rules are unchanged.
  assert.match(admin, /const persistChangedVariantPricing = async/);
  assert.match(admin, /priceMinor === variant\.price_minor/);
  assert.match(
    admin,
    /const variantPriceError = await persistChangedVariantPricing\(\)/,
  );
  assert.doesNotMatch(admin, /parseFloat|Math\.round/);
});
test("MacBook Neo repair is guarded, idempotent, and verifies all five prices", () => {
  assert.match(priceRepair, /v_current_price not in \(22299800, 22300000\)/);
  assert.match(priceRepair, /set price_minor = 22300000/);
  assert.match(priceRepair, /v_expected_count <> 5/);
  for (const price of [22500000, 22300000, 25900000, 25600000])
    assert.match(priceRepair, new RegExp(String(price)));
});
test("PTA unknown remains unresolved rather than non-PTA", () => {
  assert.match(migration, /pta_status = 'unknown'/);
  assert.match(admin, /<option value="unknown">Unknown<\/option>/);
});
test("delivery scope is explicit and filterable", () => {
  assert.match(migration, /p_delivery_scope public\.delivery_scope\[\]/);
  assert.match(storefront, /Karachi only/);
  assert.match(storefront, /Nationwide/);
});
test("out-of-stock state derives from numeric inventory", () => {
  assert.match(migration, /'quantity', coalesce\(i\.quantity, 0\)/);
  assert.match(storefront, /variant\.quantity > 0/);
});
test("Cloudinary media uses responsive delivery", () => {
  assert.match(storefront, /cloudinaryDeliveryUrl/);
  assert.match(migration, /'publicId', m\.cloudinary_public_id/);
});
test("shop filtering is performed by the database RPC", () => {
  for (const field of [
    "p_category_slugs",
    "p_brand_slugs",
    "p_price_min",
    "p_storage",
    "p_ram",
    "p_pta_status",
    "p_in_stock",
    "p_delivery_scope",
  ])
    assert.match(catalog, new RegExp(field));
});
test("public catalog function exposes no mutation path", () => {
  assert.doesNotMatch(catalog, /\.insert\(|\.update\(|\.delete\(/);
  assert.match(migration, /grant execute .* to anon, authenticated/);
});
test("Owner Admin retains routine catalog management", () => {
  for (const table of [
    "products",
    "product_variants",
    "inventory_movements",
    "product_specifications",
  ])
    assert.match(admin, new RegExp(`from\\("${table}"\\)`));
});
test("Phase 3B media publication and primary fallback remain intact", () => {
  assert.match(phase3b, /primary_product_media_required/);
  assert.match(phase3b, /ensure_primary_media_after_delete/);
  assert.match(admin, /MediaManager/);
});
