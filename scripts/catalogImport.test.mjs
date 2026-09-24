import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  canApplyCatalogImport,
  catalogImportConfirmation,
  catalogImportCounts,
  matchImportVariant,
} from "../src/lib/catalogImport.ts";

const existing = (overrides) => ({
  id: overrides.sku, is_active: true, carrier_jv: null, ram_display: null, storage_display: "256 GB", color_finish: "Natural",
  pta_status: "not_approved", condition: "used", condition_grade: "A++", battery_health_percent: null, battery_cycle_count: null, ...overrides,
});
const row = (overrides) => ({
  ram: null, storage: "256 GB", color: "Natural", ptaStatus: "not_approved", condition: "used",
  conditionGrade: "A++", batteryHealth: null, cycleCount: null, ...overrides,
});

test("matching mirrors the import function: attributes, wildcard blanks, unknown fill-in, never SKU", () => {
  const units = [existing({ sku: "MB001", battery_health_percent: 89 }), existing({ sku: "MB002", battery_health_percent: 92 })];
  assert.equal(matchImportVariant(units, row({ batteryHealth: 92 })).match.sku, "MB002");
  // A blank Battery Health cannot tell two used units apart.
  assert.deepEqual(matchImportVariant(units, row({ batteryHealth: null })), { match: null, ambiguous: true });
  // A different Battery Health is a different unit → new variant.
  assert.deepEqual(matchImportVariant(units, row({ batteryHealth: 75 })), { match: null, ambiguous: false });
  // Blank PTA ("unknown") matches; an existing unknown PTA can be filled in.
  assert.equal(matchImportVariant([existing({ sku: "MB003" })], row({ ptaStatus: "unknown" })).match.sku, "MB003");
  assert.equal(matchImportVariant([existing({ sku: "MB004", pta_status: "unknown" })], row({ ptaStatus: "approved" })).match.sku, "MB004");
  // Colour / storage must be equal (case-insensitive); hidden variants can match.
  assert.equal(matchImportVariant([existing({ sku: "MB005", is_active: false })], row({ color: "natural" })).match.sku, "MB005");
  assert.equal(matchImportVariant([existing({ sku: "MB006" })], row({ storage: "512 GB" })).match, null);
  // With several candidates, an exact match on the supplied facts wins over an unknown one.
  const mixed = [existing({ sku: "MB007", pta_status: "unknown" }), existing({ sku: "MB008", pta_status: "approved" })];
  assert.equal(matchImportVariant(mixed, row({ ptaStatus: "approved" })).match.sku, "MB008");
});

const preview = (overrides = {}) => ({
  action: "CREATE", blocked: [], hiddenVariants: [],
  variants: [{ action: "CREATE VARIANT", warnings: [] }], ...overrides,
});

test("28. Apply is disabled whenever anything needs review; counts feed the confirmation", () => {
  const ready = [
    preview(),
    preview({ action: "REPLACE EXISTING", hiddenVariants: [{ sku: "MB001" }],
      variants: [{ action: "UPDATE VARIANT", warnings: [] }, { action: "REACTIVATE VARIANT", warnings: [] }, { action: "CREATE VARIANT", warnings: [] }] }),
  ];
  assert.equal(canApplyCatalogImport("catalog_sheet", ready, []), true);
  assert.equal(canApplyCatalogImport("catalog_sheet", [...ready, preview({ blocked: ["Brand must be an existing active brand"] })], []), false);
  assert.equal(canApplyCatalogImport("catalog_sheet", [preview({ variants: [{ action: "NEEDS REVIEW", warnings: ["Missing Price"] }] })], []), false);
  assert.equal(canApplyCatalogImport("catalog_sheet", [preview({ action: "NEEDS REVIEW" })], []), false);
  assert.equal(canApplyCatalogImport("catalog_sheet", ready, ["Missing required sheet \"Products\"."]), false);
  assert.equal(canApplyCatalogImport("catalog_sheet", [], []), false);
  assert.equal(canApplyCatalogImport("rough_text", ready, []), false, "only Excel v2 previews use this path");

  const counts = catalogImportCounts(ready);
  assert.deepEqual(counts, {
    productsToCreate: 1, productsToReplace: 1, variantsToCreate: 2, variantsToUpdate: 1,
    variantsToReactivate: 1, variantsToHide: 1, rowsNeedingReview: 0,
  });
  assert.equal(catalogImportConfirmation(counts), [
    "Products to create: 1", "Products to replace: 1", "Variants to create: 2",
    "Variants to update: 2 (1 brought back)", "Variants to hide: 1", "Rows needing review: 0",
  ].join("\n"));
});

test("Bulk Import wires Apply Import to the v2 function with blank SKUs for new variants", () => {
  const source = readFileSync(new URL("../src/admin/BulkImport.tsx", import.meta.url), "utf8").replace(/\r\n/g, "\n");
  assert.ok(source.includes('supabase.rpc("apply_catalog_bulk_import_v2"'));
  assert.ok(source.includes("canApplyCatalogImport(format, preview, parseErrors)"));
  assert.ok(source.includes("confirm(`Apply this import?\\n\\n${catalogImportConfirmation(counts)}`)"));
  assert.ok(source.includes('sku: variant.skuResolved || null,'));
  assert.ok(source.includes('{stagingOnly ? "Apply Import" : "Apply approved batch"}'));
  assert.ok(source.includes("Products imported successfully"));
  assert.ok(source.includes('href="/admin/products?missing=images"'));
  assert.ok(source.includes("View Products Missing Images"));
  assert.ok(source.includes('"REACTIVATE VARIANT"'));
  assert.ok(source.includes("HIDE VARIANT"));
  assert.ok(!source.includes("database import arrives in Phase 2"));
  // The legacy path still uses the legacy function.
  assert.ok(source.includes('supabase.rpc("apply_catalog_bulk_import", {'));
  const admin = readFileSync(new URL("../src/admin/AdminCatalog.tsx", import.meta.url), "utf8");
  assert.ok(admin.includes('get("missing") === "images"'));
});
