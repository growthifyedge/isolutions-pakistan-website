import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  generatedVariantSku,
  normalizeCapacity,
  parseBulkCatalog,
} from "../src/lib/bulkCatalog.ts";

const [rpc, admin, parser, media] = await Promise.all([
  readFile(
    "supabase/migrations/202608270001_phase_4_bulk_catalog_import.sql",
    "utf8",
  ),
  readFile("src/admin/BulkImport.tsx", "utf8"),
  readFile("src/lib/bulkCatalog.ts", "utf8"),
  readFile("src/admin/MediaManager.tsx", "utf8"),
]);

const rough = `Apple 17 Pro Max
Category: Smartphones
256 GB Blue/Orange/Silver 472000
Brand New
Karachi only

Samsung S25 Ultra
Category: Smartphones
12/512 GB Black 305000
12/1 TB Black 328000
PTA Approved
Brand New
Karachi only`;

const parsed = parseBulkCatalog(rough);

test("multi-product rough text parsing", () =>
  assert.equal(parsed.products.length, 2));
test("grouped colors expand only the explicit source line", () => {
  assert.deepEqual(
    parsed.products[0].variants.map((variant) => variant.color),
    ["Blue", "Orange", "Silver"],
  );
  assert.ok(
    parsed.products[0].variants.every(
      (variant) => variant.storage === "256 GB",
    ),
  );
});
test("no Cartesian variants are generated", () =>
  assert.equal(parsed.products[1].variants.length, 2));
test("missing facts remain unresolved", () => {
  const vivo = parseBulkCatalog(
    "Vivo Y05\nCategory: Smartphones\n4/64 Black 37500",
  ).products[0].variants[0];
  assert.equal(vivo.warranty, null);
  assert.equal(vivo.inventory, null);
  assert.equal(vivo.deliveryScope, null);
  assert.equal(vivo.ptaStatus, "unknown");
});
test("safe capacity normalization is deterministic", () => {
  assert.equal(normalizeCapacity("256GB"), "256 GB");
  assert.equal(normalizeCapacity("1 TB"), "1 TB");
});
test("existing product matching uses slug then exact brand plus title", () => {
  assert.match(admin, /product\.slug[\s\S]*products\.filter/);
  assert.match(
    admin,
    /normalized\(item\.title\) === normalized\(product\.title\)/,
  );
});
test("existing variant matching uses SKU then exact explicit attributes", () => {
  assert.match(admin, /item\.sku === variant\.sku/);
  assert.match(admin, /matchesVariant\(item, variant\)/);
  assert.match(rpc, /ambiguous_variant_match/);
});
test("ambiguous matches block apply", () => {
  assert.match(admin, /Ambiguous product match/);
  assert.match(admin, /disabled=\{working \|\| blocked\}/);
});
test("omitted inventory is preserved", () => {
  assert.match(rpc, /if \(v_variant ->> 'inventory'\) is not null then/);
  assert.doesNotMatch(rpc, /coalesce\(.*inventory.*0/);
});
test("PKR conversion remains exact integer-only", () => {
  assert.equal(parsed.products[0].variants[0].priceMinor, 47200000);
  assert.doesNotMatch(parser, /parseFloat|Math\.round|Number\([^)]*\) \* 100/);
});
test("repeated identical import reuses product and variant identities", () => {
  assert.match(rpc, /slug = v_product ->> 'slug'/);
  assert.match(rpc, /sku = v_variant ->> 'sku'/);
});
test("Motorola G77 cannot duplicate through normalized identity matching", () => {
  const sku = generatedVariantSku("motorola-g77", {
    ...parsed.products[0].variants[0],
    ram: "8 GB",
    storage: "256 GB",
    color: "Black",
  });
  assert.equal(sku, "MOTOROLA-G77-8-GB-256-GB-BLACK");
  assert.match(rpc, /brand_id = v_brand_id and lower\(btrim\(title\)\)/);
});
test("Apple MacBook Neo cannot duplicate and prices stay bigint", () => {
  assert.match(
    rpc,
    /price_minor = coalesce\(nullif\(v_variant ->> 'price_minor'/,
  );
  assert.doesNotMatch(rpc, /::real|double precision|numeric\s*\(/i);
});
test("new real taxonomy requires authenticated approved import", () => {
  assert.match(rpc, /data_class, is_active[\s\S]*'real', true/);
  assert.match(rpc, /catalog_admin_required/);
});
test("development taxonomy is never promoted or reused as real", () => {
  assert.match(rpc, /where data_class = 'real'/);
  assert.doesNotMatch(rpc, /update public\.(brands|categories).*data_class/s);
});
test("new products without media remain draft", () => {
  assert.match(rpc, /publication_status[\s\S]*'draft'/);
  assert.doesNotMatch(rpc, /insert into public\.product_media/);
});
test("anonymous users cannot run import", () =>
  assert.match(
    rpc,
    /revoke all on function public\.apply_catalog_bulk_import\(jsonb\) from public/,
  ));
test("non-admin users fail the server authorization check", () =>
  assert.match(rpc, /if not public\.is_catalog_admin\(\)/));
test("Owner and Admin receive authenticated execute permission", () =>
  assert.match(
    rpc,
    /grant execute on function public\.apply_catalog_bulk_import\(jsonb\) to authenticated/,
  ));
test("Phase 3B media workflow remains authoritative", () => {
  assert.match(media, /cloudinary-upload-signature/);
  assert.doesNotMatch(admin, /cloudinary|product_media/);
});
test("rough parser visibly marks uncertain lines for Owner review", () => {
  const uncertain = parseBulkCatalog(
    "Apple Device\nCategory: Smartphones\nPossibly special edition",
  );
  assert.match(uncertain.products[0].warnings.join(" "), /Needs Owner Review/);
});
test("CSV supports partial documented columns without inventing facts", () => {
  const csv = parseBulkCatalog(
    "product_title,brand,category,storage,color,price_pkr\nVivo Y05,Vivo,Smartphones,64 GB,Black,37500",
  );
  assert.equal(csv.format, "csv");
  assert.equal(csv.products[0].variants[0].priceMinor, 3750000);
  assert.equal(csv.products[0].variants[0].inventory, null);
});
