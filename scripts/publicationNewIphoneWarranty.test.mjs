import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createCatalogTestDatabase, signInAsOwner } from "./support/catalogTestDatabase.mjs";
import { pdpProductInformation } from "../src/lib/pdpCustomerFacts.ts";

// Executes the REAL migrations (including 202611190001_publication_new_iphone_warranty_optional.sql) in an in-memory
// Postgres (PGlite). No DEV / PROD database is involved.
// Owner rule (2026-11-18): warranty is optional for New and Used iPhones. A missing warranty stays NULL and never
// blocks publication; a stated warranty is kept. Android and every other category keep their current rules.

const COMMERCIAL = "variant_commercial_facts_unresolved";
const IMAGE = "primary_product_media_required";
const MIGRATION = "202611190001_publication_new_iphone_warranty_optional.sql";

async function makeDb() {
  const db = await createCatalogTestDatabase();
  await signInAsOwner(db);
  await db.exec(`
    insert into public.brands (name, slug, is_active, data_class)
    select v.name, v.slug, true, 'real' from (values ('Apple', 'apple-test'), ('Samsung', 'samsung-test')) as v(name, slug)
    where not exists (select 1 from public.brands b where lower(b.name) = lower(v.name));
    update public.brands set is_active = true, data_class = 'real' where lower(name) in ('apple', 'samsung');
    update public.categories set is_active = true, data_class = 'real' where slug in ('mobile-phones', 'mobile-accessories');
  `);
  let n = 0;
  const product = async (title, { brand = "Apple", category = "mobile-phones", warranty = null } = {}) =>
    (await db.query(
      `insert into public.products (brand_id, category_id, title, slug, publication_status, data_class, default_warranty)
       select (select id from public.brands where name = $3 and data_class = 'real' limit 1), c.id, $1, $2, 'draft', 'real', $5
       from public.categories c where c.slug = $4 limit 1 returning id`,
      [title, `p-${(n += 1)}`, brand, category, warranty],
    )).rows[0].id;
  const variant = (productId, { condition = "brand_new", pta = "approved", price = 30000000, scope = "karachi_only", active = true, warranty = null } = {}) =>
    db.query(
      `insert into public.product_variants (product_id, sku, storage_display, color_finish, price_minor, pta_status, condition, delivery_scope, is_active, warranty_override)
       values ($1, '', '256 GB', $2, $3, $4::public.pta_status, $5::public.product_condition, $6::public.delivery_scope, $7, $8)`,
      [productId, `Colour ${(n += 1)}`, price, pta, condition, scope, active, warranty],
    );
  const image = (productId) =>
    db.query(
      `insert into public.product_media (product_id, cloudinary_public_id, cloudinary_asset_id, cloudinary_version, secure_url, width, height, bytes, format, alt_text, is_primary)
       values ($1, $2, $3, 1, 'https://res.cloudinary.com/test/image/upload/v1/x.jpg', 1000, 1000, 1000, 'jpg', 'Front', true)`,
      [productId, `isolutions-test/products/${productId}/front-${(n += 1)}`, `asset-${n}`],
    );
  const listing = async (title, variants, options = {}) => {
    const id = await product(title, options);
    for (const facts of variants) await variant(id, facts);
    if (options.image !== false) await image(id);
    return id;
  };
  const validate = async (id) => (await db.query(`select is_valid, errors from public.validate_product_for_publication($1)`, [id])).rows[0];
  const publish = (id) => db.query(`update public.products set publication_status = 'published' where id = $1`, [id]);
  const warranties = async (id) => ({
    product: (await db.query(`select default_warranty from public.products where id = $1`, [id])).rows[0].default_warranty,
    variants: (await db.query(`select warranty_override from public.product_variants where product_id = $1 order by warranty_override nulls last`, [id])).rows.map((r) => r.warranty_override),
  });
  return { db, listing, validate, publish, warranties };
}

test("New iPhone with NULL warranty passes and publishes; warranty stays NULL (no default inserted)", async () => {
  const { db, listing, validate, publish, warranties } = await makeDb();
  const id = await listing("Apple iPhone 18 Pro Max", [{}, { pta: "not_approved" }, { active: false }]);
  assert.deepEqual(await validate(id), { is_valid: true, errors: [] });
  await publish(id);
  assert.equal((await db.query(`select publication_status from public.products where id = $1`, [id])).rows[0].publication_status, "published");
  assert.deepEqual(await warranties(id), { product: null, variants: [null, null, null] }, "no warranty value is invented");
});

test("New iPhone with a stated warranty (product default or variant) passes and keeps it unchanged", async () => {
  const { listing, validate, publish, warranties } = await makeDb();
  const id = await listing("Apple iPhone 18 Pro", [{ warranty: "2 Years" }, {}], { warranty: "1 Year" });
  assert.deepEqual(await validate(id), { is_valid: true, errors: [] });
  await publish(id);
  assert.deepEqual(await warranties(id), { product: "1 Year", variants: ["2 Years", null] });
});

test("New iPhone keeps every other blocker: PTA, condition, price, delivery, active variant, image", async () => {
  const { listing, validate, publish } = await makeDb();
  const blocked = async (title, variants, errors, options) =>
    assert.deepEqual((await validate(await listing(title, variants, options))).errors, errors, title);
  await blocked("Apple iPhone 17 PTA unknown", [{ pta: "unknown" }], [COMMERCIAL]);
  await blocked("Apple iPhone 17 price 0", [{ price: 0 }], [COMMERCIAL]);
  await blocked("Apple iPhone 17 no delivery", [{ scope: null }], [COMMERCIAL]);
  await blocked("Apple iPhone 17 no active variant", [{ active: false }], ["active_variant_required"]);
  await blocked("Apple iPhone 17 no image", [{}], [IMAGE], { image: false });
  await blocked("Apple iPhone 17 condition unknown", [{ condition: "unknown" }], [COMMERCIAL]);
  const id = await listing("Apple iPhone 17 trigger", [{ pta: "unknown" }]);
  await assert.rejects(publish(id), /product_publication_validation_failed/, "the publication trigger still enforces the validator");
});

test("Used iPhone rule unchanged: NULL warranty passes; a stated warranty is kept", async () => {
  const { listing, validate, warranties } = await makeDb();
  assert.deepEqual(await validate(await listing("Apple iPhone 15 (Used)", [{ condition: "used" }])), { is_valid: true, errors: [] });
  const stated = await listing("Apple iPhone 15 Pro (Used)", [{ condition: "used", warranty: "Checking warranty" }]);
  assert.deepEqual(await validate(stated), { is_valid: true, errors: [] });
  assert.deepEqual((await warranties(stated)).variants, ["Checking warranty"]);
});

test("no wider exemption: mixed, open-box, refurbished or mis-titled Apple phones still need a warranty", async () => {
  const { listing, validate } = await makeDb();
  const needsWarranty = async (title, variants) => assert.deepEqual((await validate(await listing(title, variants))).errors, [COMMERCIAL], title);
  await needsWarranty("Apple iPhone 16 mixed", [{}, { condition: "used" }]);
  await needsWarranty("Apple iPhone 16 open box", [{ condition: "open_box" }]);
  await needsWarranty("Apple iPhone 16 refurbished", [{ condition: "refurbished" }]);
  await needsWarranty("Apple iPhone 16 (Used)", [{ condition: "brand_new" }]);
  await needsWarranty("Apple iPhone 16 Used without suffix", [{ condition: "used" }]);
  await needsWarranty("Apple iPhone 16 mixed inactive", [{}, { condition: "used", active: false }]);
});

test("Android keeps the warranty requirement; with a warranty it passes", async () => {
  const { listing, validate } = await makeDb();
  assert.deepEqual((await validate(await listing("Samsung Galaxy A57", [{}], { brand: "Samsung" }))).errors, [COMMERCIAL], "Android without warranty is blocked");
  assert.deepEqual((await validate(await listing("Samsung Galaxy S24 (Used)", [{ condition: "used" }], { brand: "Samsung" }))).errors, [COMMERCIAL]);
  assert.deepEqual(await validate(await listing("Samsung Galaxy A36", [{}], { brand: "Samsung", warranty: "1 Year" })), { is_valid: true, errors: [] });
  assert.deepEqual(await validate(await listing("Samsung Galaxy A26", [{ warranty: "1 Year" }], { brand: "Samsung" })), { is_valid: true, errors: [] });
});

test("the migration only replaces the validator, changes no data and keeps every original check", async () => {
  const sql = await readFile(new URL(`../supabase/migrations/${MIGRATION}`, import.meta.url), "utf8");
  const body = sql.replace(/^--.*$/gm, "");
  assert.equal((body.match(/create or replace function/g) ?? []).length, 1);
  assert.match(body, /create or replace function public\.validate_product_for_publication\(p_product_id uuid\)/);
  assert.doesNotMatch(body, /\b(insert into|update public|delete from|alter table|drop |grant |revoke )/i, "no data, schema or permission change");
  for (const check of ["real_catalog_classification_required", "title_required", "active_real_brand_required", "active_real_category_required", "active_variant_required", "laptops_apple_brand_required", COMMERCIAL, IMAGE])
    assert.match(body, new RegExp(`'${check}'`));
  for (const fact of ["price_minor <= 0", "delivery_scope is null", "pta_status = 'unknown'", "condition = 'unknown'", "not v_used_iphone", "not v_new_iphone", "not v_tablet_macbook", "not v_accessory", "condition <> 'brand_new'", "condition <> 'used'"])
    assert.ok(body.includes(fact), fact);
  assert.match(body, /set search_path = ''/);
});

test("PDP: a stored warranty is shown; NULL or blank warranty leaves no Warranty row or placeholder", () => {
  const iphone = { brand: { id: "b", name: "Apple", slug: "apple" }, category: { id: "c", name: "Mobile Phones", slug: "mobile-phones" } };
  const base = { condition: "brand_new", ptaStatus: "approved", simConfiguration: "dual_esim", batteryHealthPercent: null };
  const shown = pdpProductInformation(iphone, { ...base, warranty: "1 Year" });
  assert.deepEqual(shown.find((row) => row.key === "warranty"), { key: "warranty", label: "Warranty", value: "1 Year", tone: null });
  for (const warranty of [null, "", "   "]) {
    const rows = pdpProductInformation(iphone, { ...base, warranty });
    assert.equal(rows.some((row) => row.key === "warranty"), false, `no Warranty row for ${JSON.stringify(warranty)}`);
    assert.equal(JSON.stringify(rows).match(/no warranty|not specified/i), null);
  }
});
