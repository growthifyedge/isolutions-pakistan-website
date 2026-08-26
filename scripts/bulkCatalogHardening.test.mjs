import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { parseBulkCatalog } from "../src/lib/bulkCatalog.ts";

const [adminSource, hardeningMigration] = await Promise.all([
  readFile("src/admin/BulkImport.tsx", "utf8"),
  readFile(
    "supabase/migrations/202608270003_phase_4_bulk_import_hardening.sql",
    "utf8",
  ),
]);

const product = (body) => parseBulkCatalog(body).products[0];
const base = (title, body) =>
  `${title}\nBrand: Synthetic\nCategory: Test Category\n${body}`;

const fixtures = [
  [
    "storage plus one color",
    base("Phone One", "256 GB Blue 108000"),
    (p) => assert.equal(p.variants[0].storage, "256 GB"),
  ],
  [
    "storage plus grouped colors",
    base("Phone Two", "256 GB Blue/Black/White 108000"),
    (p) => assert.equal(p.variants.length, 3),
  ],
  [
    "RAM/storage compact slash",
    base("Phone Three", "12/128 Cream 112000"),
    (p) =>
      assert.deepEqual(
        [p.variants[0].ram, p.variants[0].storage],
        ["12 GB", "128 GB"],
      ),
  ],
  [
    "RAM/storage with grouped colors",
    base("Phone Four", "8/256 Black/Green 94500"),
    (p) => assert.equal(p.variants.length, 2),
  ],
  [
    "RAM/storage and no color",
    base("Phone Five", "12/512 GB 305000"),
    (p) => assert.equal(p.variants[0].color, null),
  ],
  [
    "slash-separated commercial fields",
    base("Phone Six", "512 GB / Blue / PTA Approved / 472000"),
    (p) => assert.equal(p.variants[0].ptaStatus, "approved"),
  ],
  [
    "different price per color",
    base("Phone Seven", "256 GB Blue 100000\n256 GB Black 101000"),
    (p) =>
      assert.deepEqual(
        p.variants.map((v) => v.priceMinor),
        [10000000, 10100000],
      ),
  ],
  [
    "explicit Non-PTA variant",
    base("Phone Eight", "256 GB Blue Non-PTA 90000"),
    (p) => assert.equal(p.variants[0].ptaStatus, "not_approved"),
  ],
  [
    "product PTA inheritance",
    base("Phone Nine", "PTA: Approved\n256 GB Blue 100000"),
    (p) => assert.equal(p.variants[0].ptaSource, "inherited by variant"),
  ],
  [
    "mixed PTA variants",
    base(
      "Phone Ten",
      "256 GB Blue PTA Approved 100000\n256 GB Blue Non-PTA 80000",
    ),
    (p) =>
      assert.deepEqual(
        p.variants.map((v) => v.ptaStatus),
        ["approved", "not_approved"],
      ),
  ],
  [
    "laptop storage/color",
    base("Laptop One", "512 GB Silver 223000\n1 TB Black 250000"),
    (p) => assert.equal(p.variants.length, 2),
  ],
  [
    "single-price wearable",
    base("Band One", "Price: 14000"),
    (p) =>
      assert.deepEqual(
        [p.variants[0].ram, p.variants[0].storage, p.variants[0].color],
        [null, null, null],
      ),
  ],
  [
    "single-price accessory",
    base("Charger One", "Price: 6500"),
    (p) => assert.equal(p.variants[0].priceMinor, 650000),
  ],
  [
    "SKU and price only",
    base("Cable One", "SKU: CAB-001\nPrice: 1200"),
    (p) => assert.equal(p.variants[0].sku, "CAB-001"),
  ],
  [
    "inventory supplied",
    base("Stocked One", "Price: 1000\nInventory: 7"),
    (p) => assert.equal(p.variants[0].inventory, 7),
  ],
  [
    "stock alias supplied",
    base("Stocked Two", "Price: 1000\nStock: 8"),
    (p) => assert.equal(p.variants[0].inventory, 8),
  ],
  [
    "inventory omitted",
    base("Unstocked", "Price: 1000"),
    (p) => assert.equal(p.variants[0].inventory, null),
  ],
  [
    "warranty inherited",
    base("Warranty One", "Warranty: 1 year\nPrice: 1000"),
    (p) => assert.equal(p.variants[0].warrantySource, "inherited by variant"),
  ],
  [
    "warranty omitted",
    base("Warranty Two", "Price: 1000"),
    (p) => assert.equal(p.variants[0].warranty, null),
  ],
  [
    "delivery inherited",
    base("Delivery One", "Delivery: Karachi only\nPrice: 1000"),
    (p) => assert.equal(p.variants[0].deliveryScope, "karachi_only"),
  ],
  [
    "delivery omitted",
    base("Delivery Two", "Price: 1000"),
    (p) => assert.equal(p.variants[0].deliveryScope, null),
  ],
  [
    "condition inherited",
    base("Condition One", "Condition: Brand New\nPrice: 1000"),
    (p) => assert.equal(p.variants[0].conditionSource, "inherited by variant"),
  ],
  [
    "compare-at exact integer",
    base("Compare One", "Price: 1000\nCompare at: 1,200"),
    (p) => assert.equal(p.variants[0].compareAtPriceMinor, 120000),
  ],
  [
    "Owner note preserved",
    base("Note One", "Note: Physical eSIM support\nPrice: 1000"),
    (p) => assert.deepEqual(p.notes, ["Physical eSIM support"]),
  ],
  [
    "specification fact preserved",
    base("Spec One", "Specification: Material = Aluminum\nPrice: 1000"),
    (p) =>
      assert.deepEqual(
        [p.specifications[0].label, p.specifications[0].value],
        ["Material", "Aluminum"],
      ),
  ],
  [
    "SEO and description labels",
    base(
      "SEO One",
      "Description: Neutral facts\nSEO Title: Search title\nSEO Description: Search facts\nPrice: 1000",
    ),
    (p) => assert.equal(p.seoTitle, "Search title"),
  ],
  [
    "strange whitespace normalized",
    "Space Phone\n  Brand :   Synthetic  \n Category: Test Category\n256   GB   Blue   108000",
    (p) => assert.equal(p.brand, "Synthetic"),
  ],
  [
    "comma-formatted price",
    base("Comma One", "256 GB Blue 108,000"),
    (p) => assert.equal(p.variants[0].priceMinor, 10800000),
  ],
  [
    "Unicode styled labels normalized",
    "Unicode One\n𝐁𝐫𝐚𝐧𝐝： Synthetic\n𝐂𝐚𝐭𝐞𝐠𝐨𝐫𝐲： Test Category\nＰｒｉｃｅ： 14000",
    (p) => assert.equal(p.variants[0].priceMinor, 1400000),
  ],
  [
    "unknown input is preserved and blocking",
    base("Unknown One", "Mystery commercial claim\nPrice: 1000"),
    (p) =>
      assert.equal(
        p.diagnostics.find((d) => d.line === "Mystery commercial claim")
          ?.blocksApply,
        true,
      ),
  ],
  [
    "ambiguous triple capacity blocks safely",
    base("Ambiguous One", "12/128/256 Blue 100000"),
    (p) => assert.match(p.warnings.join(" "), /ambiguous commercial line/),
  ],
  [
    "explicit slug normalized",
    base("Slug One", "Slug: Custom Product Slug\nPrice: 1000"),
    (p) => assert.equal(p.slug, "custom-product-slug"),
  ],
  [
    "explicit brand overrides title",
    "Arbitrary First Word Product\nBrand: Synthetic\nCategory: Test Category\nPrice: 1000",
    (p) => assert.equal(p.brand, "Synthetic"),
  ],
];

for (const [name, input, verify] of fixtures) {
  test(`fixture: ${name}`, () => {
    const parsed = parseBulkCatalog(input);
    assert.equal(parsed.errors.length, 0);
    verify(parsed.products[0]);
  });
}

test("CSV equivalent preserves explicit commercial facts", () => {
  const csv = parseBulkCatalog(
    "product_title,brand,category,sku,ram,storage,color,price_pkr,compare_at_price_pkr,pta_status,condition,warranty,delivery_scope,inventory,note,specification_label,specification\nCSV Phone,Synthetic,Test Category,CSV-1,8 GB,256 GB,Blue,100000,110000,approved,brand new,1 year,karachi only,4,eSIM fact,Material,Aluminum",
  );
  const item = csv.products[0];
  assert.equal(csv.format, "csv");
  assert.equal(item.variants[0].inventory, 4);
  assert.equal(item.variants[0].priceMinor, 10000000);
  assert.equal(item.notes[0], "eSIM fact");
  assert.equal(item.specifications[0].value, "Aluminum");
});

test("CSV rows group into one product without Cartesian variants", () => {
  const csv = parseBulkCatalog(
    "product_title,brand,category,storage,color,price_pkr\nCSV Laptop,Synthetic,Laptops,256 GB,Silver,223000\nCSV Laptop,Synthetic,Laptops,512 GB,Black,256000",
  );
  assert.equal(csv.products.length, 1);
  assert.equal(csv.products[0].variants.length, 2);
});

test("one operation parses smartphone, RAM phone, laptop, wearable, and accessory", () => {
  const batch = `Synthetic Phone\nBrand: Synthetic\nCategory: Smartphones\n256 GB Blue/Black 100000\n\nSynthetic RAM Phone\nBrand: Synthetic\nCategory: Smartphones\n8/256 Green 120000\n\nSynthetic Laptop\nBrand: Synthetic\nCategory: Laptops\n512 GB Silver 223000\n\nSynthetic Band\nBrand: Synthetic\nCategory: Wearables\nPrice: 14000\n\nSynthetic Charger\nBrand: Synthetic\nCategory: Accessories\nSKU: SYN-CHARGER\nPrice: 6500`;
  const parsed = parseBulkCatalog(batch);
  assert.equal(parsed.products.length, 5);
  assert.deepEqual(
    parsed.products.map((item) => item.variants.length),
    [2, 1, 1, 1, 1],
  );
});

test("repeated parsing is deterministic and price-idempotent", () => {
  const input = base("Repeat One", "256 GB Blue 108000");
  assert.deepEqual(parseBulkCatalog(input), parseBulkCatalog(input));
  assert.equal(product(input).variants[0].priceMinor, 10800000);
});

test("preview proposes explicit new taxonomy and never writes", () => {
  assert.match(adminSource, /"CREATE BRAND"/);
  assert.match(adminSource, /"CREATE CATEGORY"/);
  assert.match(adminSource, /No database writes performed/);
  assert.match(adminSource, /developmentBrand/);
});

test("authorized apply preserves notes and upserts specifications idempotently", () => {
  assert.match(adminSource, /content: product\.notes/);
  assert.match(adminSource, /specifications: product\.specifications/);
  assert.match(hardeningMigration, /content = coalesce/);
  assert.match(
    hardeningMigration,
    /insert into public\.product_specifications/,
  );
  assert.match(
    hardeningMigration,
    /on conflict \(product_id, specification_group, label\)/,
  );
  assert.match(hardeningMigration, /data_class = 'real' and is_active/);
});
