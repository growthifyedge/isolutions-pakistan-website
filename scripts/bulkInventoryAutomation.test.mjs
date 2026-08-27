import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  bulkInventoryPreview,
  parseBulkCatalog,
} from "../src/lib/bulkCatalog.ts";

const [admin, migration] = await Promise.all([
  readFile("src/admin/BulkImport.tsx", "utf8"),
  readFile(
    "supabase/migrations/202608270004_phase_4_default_inventory_bulk_persistence.sql",
    "utf8",
  ),
]);

test("new variant with omitted inventory previews and initializes exactly 10", () => {
  assert.deepEqual(bulkInventoryPreview(null, false), {
    label: "Inventory: 10 (default for new variant)",
    mode: "default_new",
  });
  assert.match(migration, /else 10 - v_current_inventory/);
});

test("new variant with Owner inventory uses the supplied quantity", () => {
  assert.equal(
    bulkInventoryPreview(7, false).label,
    "Inventory: 7 (Owner supplied)",
  );
  assert.match(
    migration,
    /\(v_variant ->> 'inventory'\)::integer - v_current_inventory/,
  );
});

test("existing variant with omitted inventory preserves current quantity", () => {
  assert.equal(
    bulkInventoryPreview(null, true).label,
    "Inventory: preserve existing",
  );
  assert.match(
    migration,
    /if v_is_new_variant or \(v_variant ->> 'inventory'\) is not null then/,
  );
});

test("existing variant with explicit inventory is corrected to Owner quantity", () => {
  assert.equal(bulkInventoryPreview(23, true).mode, "owner_supplied");
  assert.match(migration, /phase4_bulk_import/);
});

test("repeated identical import cannot add another default 10", () => {
  assert.match(migration, /v_is_new_variant := v_match_count = 0/);
  assert.match(migration, /if v_is_new_variant or/);
  assert.doesNotMatch(
    migration,
    /if \(v_variant ->> 'inventory'\) is null then\s+insert/s,
  );
});

test("repeated repair/apply is idempotent and preserves genuine history", () => {
  assert.match(migration, /public\.current_inventory\(v\.id\) = 0/);
  assert.match(
    migration,
    /not exists \(\s*select 1 from public\.inventory_movements existing/s,
  );
});

test("default inventory is an auditable +10 ledger movement", () => {
  const ledger = [10];
  assert.equal(
    ledger.reduce((sum, delta) => sum + delta, 0),
    10,
  );
  assert.match(
    migration,
    /insert into public\.inventory_movements\(variant_id, quantity_delta, reason, reference, note, actor_id\)/,
  );
  assert.match(migration, /phase4_bulk_default_inventory/);
});

test("Bulk Preview renders default, preserve, and Owner-supplied labels", () => {
  assert.match(admin, /inventoryLabel: inventoryIntent\.label/);
  assert.match(admin, /variant\.inventoryLabel/);
  assert.equal(
    bulkInventoryPreview(null, false).label.includes("default"),
    true,
  );
  assert.equal(
    bulkInventoryPreview(null, true).label.includes("preserve"),
    true,
  );
  assert.equal(
    bulkInventoryPreview(4, false).label.includes("Owner supplied"),
    true,
  );
});

test("Bulk Apply persists exact price without a manual price-save step", () => {
  assert.match(admin, /price_minor: variant\.priceMinor/);
  assert.match(migration, /\(v_variant ->> 'price_minor'\)::bigint/);
  assert.doesNotMatch(migration, /::real|double precision|numeric\s*\(/i);
});

test("integer PKR protection remains exact", () => {
  const parsed = parseBulkCatalog(
    "Synthetic Price Device\nBrand: Synthetic\nCategory: Synthetic Category\nPrice: 223000",
  );
  assert.equal(parsed.products[0].variants[0].priceMinor, 22300000);
});

test("draft repair is restricted to the four Owner-approved real draft slugs", () => {
  for (const slug of [
    "apple-17-pro-max",
    "iphone-17e",
    "google-pixel-8-pro",
    "mi-band-10",
  ])
    assert.match(migration, new RegExp(slug));
  assert.match(migration, /p\.data_class = 'real'/);
  assert.match(migration, /p\.publication_status = 'draft'/);
});

test("Motorola G77 and Apple MacBook Neo inventory are untouched", () => {
  assert.doesNotMatch(migration, /motorola-g77/);
  assert.doesNotMatch(migration, /macbook-neo/);
});

test("anonymous and non-admin mutation remain blocked", () => {
  assert.match(migration, /if not public\.is_catalog_admin\(\)/);
  assert.match(
    migration,
    /revoke all on function public\.apply_catalog_bulk_import\(jsonb\) from public/,
  );
  assert.match(
    migration,
    /grant execute on function public\.apply_catalog_bulk_import\(jsonb\) to authenticated/,
  );
});

test("development and unrelated inventory remain isolated", () => {
  assert.match(migration, /p\.data_class = 'real'/);
  assert.match(migration, /p\.slug = any \(array\[/);
  assert.doesNotMatch(migration, /data_class = 'development'/);
});
