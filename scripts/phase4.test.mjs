import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  formatPkrMinor,
  minimumActiveVariantPrice,
  parsePkrMajorToMinor,
} from "../src/lib/money.ts";

const [migration, storefront, catalog, admin, app, phase3b, taxonomyRepair] =
  await Promise.all([
    readFile(
      "supabase/migrations/202608250001_phase_4_real_catalog.sql",
      "utf8",
    ),
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
  ]);

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
  assert.match(catalog, /rpc\("search_public_catalog"/);
  assert.match(migration, /security definer/);
});
test("product routing uses real slugs", () => {
  assert.match(storefront, /path\.startsWith\("\/product\/"\)/);
  assert.match(storefront, /fetchPublicCatalog\(\{ slug/);
});
test("storefront does not import the fictional mock catalog", () => {
  assert.doesNotMatch(app, /mockCatalog/);
  assert.doesNotMatch(storefront, /Aster One|prototype-flagship/);
});
test("variants remain explicit rows without Cartesian generation", () => {
  assert.match(admin, /Add explicit variant/);
  assert.doesNotMatch(storefront, /cartesian|flatMap/);
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
