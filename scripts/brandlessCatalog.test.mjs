import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { parseBulkCatalog } from "../src/lib/bulkCatalog.ts";

const [migration, admin, bulkImport, storefront, catalogType] = await Promise.all([
  readFile("supabase/migrations/202609010002_phase_4_brandless_products.sql", "utf8"),
  readFile("src/admin/AdminCatalog.tsx", "utf8"),
  readFile("src/admin/BulkImport.tsx", "utf8"),
  readFile("src/StorefrontApp.tsx", "utf8"),
  readFile("src/lib/catalog.ts", "utf8"),
]);

test("forward migration removes only the product brand NOT NULL requirement", () => {
  assert.match(migration, /alter table public\.products alter column brand_id drop not null/);
  assert.doesNotMatch(migration, /drop (?:table|type)|drop constraint/i);
});

test("publication permits null brand while retaining real-brand and Cloudinary checks", () => {
  assert.match(migration, /v_product\.brand_id is not null and not exists[\s\S]*active_real_brand_required/);
  assert.match(migration, /primary_product_media_required/);
  assert.match(migration, /cloudinary_public_id is not null[\s\S]*secure_url is not null[\s\S]*width > 0[\s\S]*height > 0[\s\S]*bytes > 0/);
});

test("public catalog includes brandless products only without a brand filter", () => {
  assert.match(migration, /left join public\.brands b on b\.id = p\.brand_id/);
  assert.match(migration, /p\.brand_id is null or \(b\.data_class = 'real' and b\.is_active\)/);
  assert.match(migration, /p_brand_slugs is null or b\.slug = any\(p_brand_slugs\)/);
  assert.match(migration, /case when b\.id is null then null else jsonb_build_object/);
  assert.match(catalogType, /brand: \{ id: string; name: string; slug: string \} \| null/);
  assert.match(storefront, /!product\.brand \|\|[\s\S]*excludeBrands/);
});

test("Admin saves an intentional no-brand selection as null", () => {
  assert.match(admin, /<option value="">No brand<\/option>/);
  assert.match(admin, /brand_id: draft\.brand_id \|\| null/);
  assert.doesNotMatch(admin, /!draft\.brand_id \|\|/);
});

test("rough and CSV imports preserve an omitted brand as null intent", () => {
  const rough = parseBulkCatalog("Local Cable\nCategory: Mobile Accessories\n1m Black 1500").products[0];
  assert.equal(rough.brand, "");
  assert.equal(rough.brandExplicit, false);
  const csv = parseBulkCatalog("product_title,brand,category,price_pkr\nLocal Charger,,Mobile Accessories,2500").products[0];
  assert.equal(csv.brand, "");
  assert.equal(csv.brandExplicit, false);
  assert.match(bulkImport, /\? "CREATE BRAND"[\s\S]*: "NO BRAND"/);
});

test("explicit and ambiguous brand resolution remains canonical", () => {
  const explicit = parseBulkCatalog("Apple Cable\nBrand: Apple\nCategory: Mobile Accessories\n1m White 3500").products[0];
  assert.equal(explicit.brand, "Apple");
  assert.equal(explicit.brandExplicit, true);
  assert.match(migration, /ambiguous_real_brand/);
  assert.match(migration, /real_brand_identity_mismatch/);
  assert.match(migration, /brand_id is not distinct from v_brand_id/);
  assert.doesNotMatch(migration, /product_brand_required/);
});