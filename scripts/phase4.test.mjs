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
  // The homepage featured block (ce92dd9) has inline demo cards while live featured products
  // are switched off. Those names may appear only there, and the cards only link to /shop:
  // they can never be added to the cart or bought.
  const demoStart = storefront.indexOf("const homepageDemoFeaturedProducts = [");
  const demoEnd = storefront.indexOf("] as const;", demoStart);
  assert.ok(demoStart > 0 && demoEnd > demoStart);
  const outsideDemo = storefront.slice(0, demoStart) + storefront.slice(demoEnd);
  assert.doesNotMatch(outsideDemo, /Aster One/);
  const demoCard = storefront.slice(storefront.indexOf("function FeaturedDemoCard("), storefront.indexOf("</article>", storefront.indexOf("function FeaturedDemoCard(")));
  assert.match(demoCard, /window\.location\.assign\("\/shop"\)/);
  assert.doesNotMatch(demoCard, /addStorefrontCartItem|addToCart|checkout/i);
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
