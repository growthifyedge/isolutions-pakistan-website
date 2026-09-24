import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  applyBatchDefaults,
  matchingActiveRealCategoryTaxonomy,
  parseBulkCatalog,
  unresolvedVariantFacts,
} from "../src/lib/bulkCatalog.ts";

const completeFourVariantCsv = `product_title,brand,category,slug,sku,ram,storage,color,price_pkr,compare_at_price_pkr,pta_status,condition,warranty,delivery,inventory
Motorola G77,Motorola,Smartphones,motorola-g77,MOTO-G77-8-256-BLACK,8GB,256GB,Black,89999,94999,approved,brand_new,1 Year,nationwide,5
Motorola G77,Motorola,Smartphones,motorola-g77,MOTO-G77-8-256-GREEN,8GB,256GB,Green,89999,94999,approved,brand_new,1 Year,nationwide,4
Motorola G77,Motorola,Smartphones,motorola-g77,MOTO-G77-16-512-BLACK,16GB,512GB,Black,109999,119999,approved,brand_new,1 Year,nationwide,3
Motorola G77,Motorola,Smartphones,motorola-g77,MOTO-G77-16-512-GREEN,16GB,512GB,Green,109999,119999,approved,brand_new,1 Year,nationwide,2`;

test("four complete explicit variants preview with canonical facts", () => {
  const parsed = parseBulkCatalog(completeFourVariantCsv);
  const [product] = applyBatchDefaults(parsed.products, {
    brand: null,
    category: null,
    ptaStatus: null,
    condition: null,
    warranty: null,
    deliveryScope: null,
    inventory: null,
  });
  assert.equal(parsed.errors.length, 0);
  assert.equal(product.variants.length, 4);
  // Supplied SKUs are parsed as written; the preview only accepts them as the existing
  // SKU of a matched variant (new variants get a database-assigned SKU).
  assert.deepEqual(
    product.variants.map((variant) => variant.sku),
    [
      "MOTO-G77-8-256-BLACK",
      "MOTO-G77-8-256-GREEN",
      "MOTO-G77-16-512-BLACK",
      "MOTO-G77-16-512-GREEN",
    ],
  );
  for (const variant of product.variants) {
    assert.deepEqual(unresolvedVariantFacts(variant, { existingVariant: false }), []);
    assert.ok(variant.priceMinor > 0);
    assert.ok(variant.compareAtPriceMinor > variant.priceMinor);
    assert.ok(Number.isInteger(variant.inventory));
  }
});

test("preview reports exact missing publication facts before write", () => {
  const [product] = applyBatchDefaults(
    parseBulkCatalog("Example Phone\nCategory: Smartphones\n8 / 256 Black 90000").products,
    { brand: null, category: null, ptaStatus: null, condition: null, warranty: null, deliveryScope: null, inventory: null },
  );
  const variant = product.variants[0];
  assert.deepEqual(
    unresolvedVariantFacts(variant, { existingVariant: false }),
    ["PTA Status", "Condition", "Warranty", "Delivery", "Inventory"],
  );
});

test("real labeled fixture groups four variant blocks into one ready product", () => {
  const input = `Product Title: Motorola G77
Brand: Motorola
Category: Mobile Phones
Variants:

1.
SKU: MOTO-G77-8-256-BLACK
Price PKR: 94500
Compare-at Price PKR: 99500
RAM: 8GB
Storage: 256GB
Color: Black

2.
SKU: MOTO-G77-8-256-GREEN
Price PKR: 94500
Compare At Price: 99500
RAM: 8GB
Storage: 256GB
Color / Finish: Green

3.
SKU: MOTO-G77-16-512-BLACK
Price PKR: 104500
Compare-at Price: 109500
RAM: 16GB
Storage: 512GB
Color: Black

4.
SKU: MOTO-G77-16-512-GREEN
Price PKR: 104500
Compare-at Price PKR: 109500
RAM: 16GB
Storage: 512GB
Color: Green`;
  const parsed = parseBulkCatalog(input);
  const resolved = applyBatchDefaults(parsed.products, {
    brand: null,
    category: null,
    ptaStatus: "approved",
    condition: "brand_new",
    warranty: "1 year official warranty",
    deliveryScope: "karachi_only",
    inventory: 10,
  });
  assert.equal(parsed.errors.length, 0);
  assert.equal(resolved.length, 1);
  const [product] = resolved;
  assert.equal(product.title, "Motorola G77");
  assert.equal(product.brand, "Motorola");
  assert.equal(product.category, "Mobile Phones");
  assert.equal(product.variants.length, 4);
  for (const variant of product.variants) {
    assert.equal(variant.inventory, 10);
    assert.equal(variant.ptaStatus, "approved");
    assert.equal(variant.condition, "brand_new");
    assert.equal(variant.deliveryScope, "karachi_only");
    assert.equal(variant.warranty, "1 year official warranty");
    assert.ok(variant.compareAtPriceMinor > variant.priceMinor);
    assert.equal(variant.warnings.length, 0);
  }
});

test("batch Brand and Category fill unresolved product identity only", () => {
  const parsed = parseBulkCatalog("Motorola G77\n8 / 256 Black 94500");
  const [product] = applyBatchDefaults(parsed.products, {
    brand: "Motorola",
    category: "Mobile Phones",
    ptaStatus: "approved",
    condition: "brand_new",
    warranty: "1 year official warranty",
    deliveryScope: "karachi_only",
    inventory: 10,
  });
  assert.equal(product.brand, "Motorola");
  assert.equal(product.category, "Mobile Phones");
  assert.equal(product.brandExplicit, true);
  assert.equal(product.categoryExplicit, true);
});

test("existing Mobile Phones category resolves through its canonical slug", () => {
  const categories = [
    { id: "mobile-phones", name: "Mobile Phones", slug: "mobile-phones", data_class: "real", is_active: true },
    { id: "dev-mobile-phones", name: "Mobile Phones", slug: "mobile-phones-dev", data_class: "development", is_active: true },
  ];
  assert.deepEqual(
    matchingActiveRealCategoryTaxonomy(categories, "mobile-phones").map((item) => item.id),
    ["mobile-phones"],
  );
  assert.deepEqual(
    matchingActiveRealCategoryTaxonomy(categories, "Mobile Phones").map((item) => item.id),
    ["mobile-phones"],
  );
});

test("bulk RPC validates first and persists structured variant identity", async () => {
  const migration = await readFile(
    "supabase/migrations/202609090004_bulk_import_structured_fixture_followup.sql",
    "utf8",
  );
  assert.match(migration, /Missing PTA Status/);
  assert.match(migration, /Missing Delivery/);
  assert.match(migration, /set sku = btrim/);
  assert.match(migration, /ram_display = nullif/);
  assert.match(migration, /storage_display = nullif/);
  assert.match(migration, /color_finish = nullif/);
  assert.match(migration, /apply_catalog_bulk_import_phase4_legacy/);
  assert.match(migration, /SKU disagrees with structured RAM\/Storage/);
});

test("existing explicit variants expose compact edit and retain inventory workflow", async () => {
  const admin = await readFile("src/admin/AdminCatalog.tsx", "utf8");
  assert.match(admin, /Edit explicit variant/);
  assert.match(admin, /Variant details saved/);
  assert.match(admin, /Inventory remains in the Inventory tab/);
  assert.match(admin, /await load\(\)/);
  assert.match(admin, /Delete this variant\?/);
});

test("preview reuses the matched existing product category", async () => {
  const preview = await readFile("src/admin/BulkImport.tsx", "utf8");
  assert.match(preview, /matchingActiveRealCategoryTaxonomy\(categories, product\.category\)/);
  assert.match(preview, /item\.id === existing\.category_id/);
  assert.match(preview, /realCategories = \[existingCategory\]/);
  assert.match(preview, /"REUSE CATEGORY"/);
});

test("legacy import uses server-assigned SKUs (202609240004)", async () => {
  const migration = await readFile(
    "supabase/migrations/202609240004_legacy_bulk_import_server_sku.sql",
    "utf8",
  );
  const bulkImport = await readFile("src/admin/BulkImport.tsx", "utf8");
  const parser = await readFile("src/lib/bulkCatalog.ts", "utf8");
  // New variants must arrive without a SKU; the old long-SKU checks and builder are gone.
  assert.match(migration, /SKU is assigned automatically; leave it blank for a new variant/);
  assert.doesNotMatch(migration, /SKU disagrees with structured/);
  assert.doesNotMatch(migration, /Missing SKU/);
  assert.match(migration, /drop function if exists public\.catalog_variant_sku/);
  // The post-write sync never touches the SKU of an existing variant.
  assert.doesNotMatch(migration, /set sku =/);
  assert.match(migration, /set ram_display = nullif/);
  assert.match(migration, /apply_catalog_bulk_import_phase4_legacy/);
  assert.match(migration, /apply 202609240003_catalog_sku_sequences\.sql first/);
  // Client: no SKU generation; SKU is not a required fact; new variants send a blank SKU.
  assert.doesNotMatch(parser, /generatedVariantSku/);
  assert.doesNotMatch(bulkImport, /generatedVariantSku/);
  assert.doesNotMatch(parser, /missing\.push\("SKU"\)/);
  assert.match(bulkImport, /const skuResolved = match\?\.sku \?\? "";/);
});

test("Admin editor never sends a SKU and shows existing SKUs read-only", async () => {
  const admin = await readFile("src/admin/AdminCatalog.tsx", "utf8");
  assert.doesNotMatch(admin, /sku: newVariant/);
  assert.doesNotMatch(admin, /setNewVariant\(\{ \.\.\.newVariant, sku/);
  assert.match(admin, /SKU assigned automatically\./);
  assert.match(admin, /value=\{variantEditing\.sku\} readOnly/);
  assert.doesNotMatch(admin, /setVariantEditing\(\{ \.\.\.variantEditing, sku/);
  const update = admin.slice(admin.indexOf("const saveVariantDetails"), admin.indexOf("const deleteVariant"));
  assert.doesNotMatch(update, /\bsku\b/);
});
