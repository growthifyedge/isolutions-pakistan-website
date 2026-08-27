import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  applyBatchDefaults,
  bulkInventoryPreview,
  parseBulkCatalog,
} from "../src/lib/bulkCatalog.ts";

const [bulk, readiness, app] = await Promise.all([
  readFile("src/admin/BulkImport.tsx", "utf8"),
  readFile(
    "supabase/migrations/202608270005_phase_4_batch_defaults_readiness.sql",
    "utf8",
  ),
  readFile("src/admin/CatalogReadiness.tsx", "utf8"),
]);
const base = () =>
  parseBulkCatalog(
    "Example Phone\nBrand: Example\nCategory: Smartphones\nSKU: EX-1\nPrice: 100000",
  ).products;
const defaults = {
  condition: "brand_new",
  deliveryScope: "karachi_only",
  warranty: "1 year official warranty",
  ptaStatus: "approved",
};

test("batch condition inheritance", () =>
  assert.equal(
    applyBatchDefaults(base(), defaults)[0].variants[0].conditionSource,
    "inherited from batch default",
  ));
test("batch delivery inheritance", () =>
  assert.equal(
    applyBatchDefaults(base(), defaults)[0].variants[0].deliveryScope,
    "karachi_only",
  ));
test("batch warranty inheritance", () =>
  assert.equal(
    applyBatchDefaults(base(), defaults)[0].variants[0].warranty,
    defaults.warranty,
  ));
test("batch PTA inheritance", () =>
  assert.equal(
    applyBatchDefaults(base(), defaults)[0].variants[0].ptaStatus,
    "approved",
  ));
test("explicit product override", () => {
  const rows = parseBulkCatalog(
    "Example Phone\nBrand: Example\nCategory: Smartphones\nCondition: Used\nSKU: EX-1\nPrice: 100000",
  ).products;
  assert.equal(
    applyBatchDefaults(rows, defaults)[0].variants[0].condition,
    "used",
  );
});
test("explicit variant override", () => {
  const rows = parseBulkCatalog(
    "Example Phone\nBrand: Example\nCategory: Smartphones\nSKU: EX-1\nPrice: 100000\nPTA: Non-PTA",
  ).products;
  assert.equal(
    applyBatchDefaults(rows, defaults)[0].variants[0].ptaStatus,
    "not_approved",
  );
});
test("mixed PTA safety preserves explicit variant values", () => {
  const rows = parseBulkCatalog(
    "product_title,brand,category,sku,price,pta_status\nMixed,Example,Phones,A,100000,approved\nMixed,Example,Phones,B,100000,not_approved",
  ).products;
  assert.deepEqual(
    applyBatchDefaults(rows, defaults)[0].variants.map((v) => v.ptaStatus),
    ["approved", "not_approved"],
  );
});
test("missing values remain unresolved", () =>
  assert.equal(
    applyBatchDefaults(base(), {
      condition: null,
      deliveryScope: null,
      warranty: null,
      ptaStatus: null,
    })[0].variants[0].condition,
    "unknown",
  ));
test("existing product bulk update is identity-matched", () =>
  assert.match(bulk, /"UPDATE PRODUCT"/));
test("one apply persists inherited defaults", () =>
  assert.match(
    readiness,
    /update public\.product_variants set[\s\S]*warranty_override/,
  ));
test("SEO title defaults exactly to Product Title", () =>
  assert.match(
    readiness,
    /coalesce\(nullif\(v_product ->> 'seo_title', ''\), btrim\(v_product ->> 'title'\)\)/,
  ));
test("SEO description only copies supplied short description", () =>
  assert.match(
    readiness,
    /coalesce\(nullif\(v_product ->> 'seo_description', ''\), nullif\(v_product ->> 'short_description', ''\)\)/,
  ));
test("SEO automation generates no marketing copy", () =>
  assert.doesNotMatch(readiness, /best|premium|buy now/i));
test("readiness identifies missing media", () =>
  assert.match(readiness, /primary media missing/));
test("readiness identifies unresolved commercial fields", () =>
  assert.match(
    readiness,
    /PTA unresolved[\s\S]*condition unresolved[\s\S]*warranty unresolved[\s\S]*delivery unresolved/,
  ));
test("ready product is marked READY", () =>
  assert.match(readiness, /READY TO PUBLISH/));
test("draft products are never auto-published", () => {
  assert.match(readiness, /publication_status = 'draft'/);
  assert.doesNotMatch(readiness, /set publication_status = 'published'/);
});
test("inventory default 10 does not regress", () =>
  assert.equal(bulkInventoryPreview(null, false).mode, "default_new"));
test("exact integer price protection remains", () =>
  assert.match(readiness, /\(v_variant ->> 'price_minor'\)::bigint/));
test("anonymous and non-admin mutation remains blocked", () =>
  assert.match(
    readiness,
    /is_catalog_admin\(\)[\s\S]*catalog_admin_required[\s\S]*grant execute on function public\.apply_catalog_bulk_import\(jsonb\) to authenticated/,
  ));
test("readiness UI is read-only and routed", () => {
  assert.match(app, /never\s+publishes products/);
  assert.match(bulk, /Batch defaults/);
});
