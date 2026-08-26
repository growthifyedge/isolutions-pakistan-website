import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { parseBulkCatalog } from "../src/lib/bulkCatalog.ts";

const [migration, admin, bulk, phase4] = await Promise.all([
  readFile(
    "supabase/migrations/202608270002_phase_4_product_defaults_inheritance.sql",
    "utf8",
  ),
  readFile("src/admin/AdminCatalog.tsx", "utf8"),
  readFile("src/admin/BulkImport.tsx", "utf8"),
  readFile("supabase/migrations/202608250001_phase_4_real_catalog.sql", "utf8"),
]);

const inherited = parseBulkCatalog(`Apple Example Phone
Category: Smartphones
PTA Approved
Karachi only
256 GB Blue 100000
256 GB Black 100000`).products[0];

test("product-level delivery persists during bulk create and update", () => {
  assert.equal(inherited.defaultDeliveryScope, "karachi_only");
  assert.match(bulk, /default_delivery_scope: product\.defaultDeliveryScope/);
  assert.match(migration, /default_delivery_scope = coalesce/);
});
test("product delivery inherits when variant delivery is omitted", () =>
  assert.ok(
    inherited.variants.every(
      (v) =>
        v.deliveryScope === "karachi_only" &&
        v.deliverySource === "inherited by variant",
    ),
  ));
test("explicit CSV variant delivery overrides product default", () => {
  const row = parseBulkCatalog(
    "product_title,brand,category,storage,color,price_pkr,default_delivery_scope,delivery_scope\nPhone,Brand,Smartphones,256 GB,Blue,100000,karachi_only,nationwide",
  ).products[0].variants[0];
  assert.equal(row.deliveryScope, "nationwide");
  assert.equal(row.deliverySource, "explicit variant override");
});
test("Product Overview saves and reloads default delivery", () => {
  assert.match(
    admin,
    /default_delivery_scope: p\.data\.default_delivery_scope \?\? ""/,
  );
  assert.match(admin, /default_delivery_scope: draft\.default_delivery_scope/);
});
test("Default PTA field saves and reloads exactly", () => {
  assert.match(admin, /Default PTA status/);
  assert.match(
    admin,
    /default_pta_status: p\.data\.default_pta_status \?\? "unknown"/,
  );
  assert.match(admin, /default_pta_status: draft\.default_pta_status/);
});
test("product-level PTA inherits into variants", () =>
  assert.ok(
    inherited.variants.every(
      (v) =>
        v.ptaStatus === "approved" && v.ptaSource === "inherited by variant",
    ),
  ));
test("explicit variant PTA overrides product default", () => {
  const parsed = parseBulkCatalog(
    "Apple Phone\nCategory: Smartphones\nPTA Approved\n256 GB Blue Non-PTA 100000",
  ).products[0];
  assert.equal(parsed.defaultPtaStatus, "approved");
  assert.equal(parsed.variants[0].ptaStatus, "not_approved");
  assert.equal(parsed.variants[0].ptaSource, "explicit variant override");
});
test("mixed PTA variants do not infer a product default", () => {
  const parsed = parseBulkCatalog(
    "Apple Phone\nCategory: Smartphones\n256 GB Blue PTA Approved 200000\n256 GB Blue Non-PTA 150000",
  ).products[0];
  assert.equal(parsed.defaultPtaStatus, null);
  assert.deepEqual(
    parsed.variants.map((v) => v.ptaStatus),
    ["approved", "not_approved"],
  );
  assert.match(migration, /color_finish, pta_status, condition, carrier_jv/);
});
test("missing PTA remains unresolved", () =>
  assert.equal(
    parseBulkCatalog("Apple Phone\nCategory: Smartphones\n256 GB Blue 100000")
      .products[0].variants[0].ptaStatus,
    "unknown",
  ));
test("Bulk Preview identifies product inheritance visibly", () => {
  assert.match(bulk, /variant\.ptaSource/);
  assert.match(bulk, /variant\.deliverySource/);
});
test("repeated imports preserve inherited values idempotently", () => {
  assert.match(migration, /action' = 'UNCHANGED'/);
  assert.match(migration, /skipped_unchanged/);
});
test("omitted variant PTA does not overwrite an existing explicit status", () =>
  assert.match(
    migration,
    /coalesce\(v_variant ->> 'pta_status', 'unknown'\) = 'unknown' then pta_status/,
  ));
test("Apple 17 Pro Max delivery-only repair remains draft and PTA unknown", () => {
  assert.match(migration, /slug = 'apple-17-pro-max'/);
  assert.match(migration, /set default_delivery_scope = 'karachi_only'/);
  assert.doesNotMatch(
    migration,
    /apple-17-pro-max'[\s\S]{0,400}set default_pta_status/,
  );
  assert.doesNotMatch(migration, /set publication_status = 'published'/);
});
test("development isolation remains intact", () =>
  assert.match(phase4, /data_class = 'real'/));
test("Motorola G77 and MacBook Neo are not targeted", () =>
  assert.doesNotMatch(migration, /motorola-g77|apple-macbook-neo/i));
test("anonymous and non-admin mutation remain blocked", () => {
  assert.match(migration, /catalog_admin_required/);
  assert.match(
    migration,
    /revoke all on function public\.apply_catalog_bulk_import\(jsonb\) from public/,
  );
});
test("new products retain draft publication behavior", () =>
  assert.match(
    migration,
    /nullif\(v_product ->> 'short_description', ''\), 'draft'/,
  ));
