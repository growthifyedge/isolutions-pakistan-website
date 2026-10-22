import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createCatalogTestDatabase, signInAsOwner } from "./support/catalogTestDatabase.mjs";

// Executes the REAL migrations (including 202610220001_publication_used_iphone_no_warranty.sql) in an in-memory
// Postgres (PGlite). No DEV / PROD database is involved.
// Owner rule (2026-10-22): Used iPhones need no warranty to publish; New iPhones, Android and everything else still do.

const COMMERCIAL = "variant_commercial_facts_unresolved";
const IMAGE = "primary_product_media_required";

async function makeDb() {
  const db = await createCatalogTestDatabase();
  await signInAsOwner(db);
  await db.exec(`
    insert into public.brands (name, slug, is_active, data_class)
    select v.name, v.slug, true, 'real' from (values ('Apple', 'apple-test'), ('Samsung', 'samsung-test')) as v(name, slug)
    where not exists (select 1 from public.brands b where lower(b.name) = lower(v.name));
    update public.brands set is_active = true, data_class = 'real' where lower(name) in ('apple', 'samsung');
    update public.categories set is_active = true, data_class = 'real' where slug in ('mobile-phones', 'tablets');
  `);
  let n = 0;
  const product = async (title, { brand = "Apple", category = "mobile-phones", warranty = null } = {}) =>
    (await db.query(
      `insert into public.products (brand_id, category_id, title, slug, publication_status, data_class, default_warranty)
       select b.id, c.id, $1, $2, 'draft', 'real', $5 from public.brands b, public.categories c
       where b.name = $3 and b.data_class = 'real' and c.slug = $4 limit 1 returning id`,
      [title, `p-${(n += 1)}`, brand, category, warranty],
    )).rows[0].id;
  const variant = async (productId, { condition = "used", pta = "approved", price = 12000000, scope = "karachi_only", active = true, warranty = null } = {}) =>
    (await db.query(
      `insert into public.product_variants (product_id, sku, storage_display, color_finish, price_minor, pta_status, condition, delivery_scope, is_active, warranty_override)
       values ($1, '', '128 GB', $2, $3, $4::public.pta_status, $5::public.product_condition, $6::public.delivery_scope, $7, $8) returning id`,
      [productId, `Colour ${(n += 1)}`, price, pta, condition, scope, active, warranty],
    )).rows[0].id;
  const image = async (productId) =>
    db.query(
      `insert into public.product_media (product_id, cloudinary_public_id, cloudinary_asset_id, cloudinary_version, secure_url, width, height, bytes, format, alt_text, is_primary)
       values ($1, $2, $3, 1, 'https://res.cloudinary.com/test/image/upload/v1/x.jpg', 1000, 1000, 1000, 'jpg', 'Front', true)`,
      [productId, `isolutions-test/products/${productId}/front-${(n += 1)}`, `asset-${n}`],
    );
  /** A product with variants + a primary image. */
  const listing = async (title, variants, options = {}) => {
    const id = await product(title, options);
    for (const facts of variants) await variant(id, facts);
    if (options.image !== false) await image(id);
    return id;
  };
  const validate = async (id) => (await db.query(`select is_valid, errors from public.validate_product_for_publication($1)`, [id])).rows[0];
  const publish = (id) => db.query(`update public.products set publication_status = 'published' where id = $1`, [id]);
  return { db, listing, validate, publish, variant };
}

test("Used iPhone with NULL warranty passes every check and can be published; warranty stays NULL", async () => {
  const { db, listing, validate, publish } = await makeDb();
  const id = await listing("Apple iPhone 13 (Used)", [{}, {}, { active: false }]);
  assert.deepEqual(await validate(id), { is_valid: true, errors: [] });
  await publish(id);
  const row = (await db.query(`select publication_status, default_warranty from public.products where id = $1`, [id])).rows[0];
  assert.deepEqual(row, { publication_status: "published", default_warranty: null });
  const warranties = (await db.query(`select distinct warranty_override from public.product_variants where product_id = $1`, [id])).rows;
  assert.deepEqual(warranties, [{ warranty_override: null }], "no warranty value is invented");
});

test("Used iPhone keeps every other blocker: image, PTA, price, delivery, active variant", async () => {
  const { listing, validate } = await makeDb();
  assert.deepEqual(await validate(await listing("Apple iPhone 14 (Used)", [{}], { image: false })), { is_valid: false, errors: [IMAGE] });
  assert.deepEqual((await validate(await listing("Apple iPhone 14 Pro (Used)", [{ pta: "unknown" }]))).errors, [COMMERCIAL]);
  assert.deepEqual((await validate(await listing("Apple iPhone 15 (Used)", [{ price: 0 }]))).errors, [COMMERCIAL]);
  assert.deepEqual((await validate(await listing("Apple iPhone 15 Pro (Used)", [{ scope: null }]))).errors, [COMMERCIAL]);
  assert.deepEqual((await validate(await listing("Apple iPhone 15 Pro Max (Used)", [{ active: false }]))).errors, ["active_variant_required"]);
});

test("New iPhone with NULL warranty is blocked; with an Owner-set warranty it passes", async () => {
  const { db, listing, validate, publish } = await makeDb();
  const id = await listing("Apple iPhone 16", [{ condition: "brand_new" }]);
  assert.deepEqual(await validate(id), { is_valid: false, errors: [COMMERCIAL] });
  await assert.rejects(publish(id), /product_publication_validation_failed/);
  const withWarranty = await listing("Apple iPhone 16 Pro", [{ condition: "brand_new" }], { warranty: "Test warranty" });
  assert.deepEqual(await validate(withWarranty), { is_valid: true, errors: [] });
  const override = await listing("Apple iPhone 16 Plus", [{ condition: "brand_new", warranty: "Test warranty" }, { condition: "brand_new" }]);
  assert.deepEqual((await validate(override)).errors, [COMMERCIAL], "every active New variant still needs a warranty");
  assert.equal((await db.query(`select publication_status from public.products where id = $1`, [id])).rows[0].publication_status, "draft");
});

test("Android keeps the existing rule, even for a Used Android with a (Used) title", async () => {
  const { listing, validate } = await makeDb();
  assert.deepEqual((await validate(await listing("Samsung A57", [{ condition: "brand_new" }], { brand: "Samsung" }))).errors, [COMMERCIAL]);
  assert.deepEqual((await validate(await listing("Samsung S24 (Used)", [{}], { brand: "Samsung" }))).errors, [COMMERCIAL]);
  assert.deepEqual(await validate(await listing("Samsung A36", [{ condition: "brand_new" }], { brand: "Samsung", warranty: "Test warranty" })), { is_valid: true, errors: [] });
});

test("mixed, unknown, open-box or refurbished conditions, a plain title or another category get no exemption", async () => {
  const { listing, validate } = await makeDb();
  const blocked = async (title, variants, options) => assert.deepEqual((await validate(await listing(title, variants, options))).errors, [COMMERCIAL], title);
  await blocked("Apple iPhone 13 Pro (Used)", [{}, { condition: "brand_new" }]);
  await blocked("Apple iPhone 13 Pro Max (Used)", [{}, { condition: "brand_new", active: false }]);
  await blocked("Apple iPhone 12 (Used)", [{}, { condition: "unknown", active: false }]);
  await blocked("Apple iPhone 12 Pro (Used)", [{ condition: "open_box" }]);
  await blocked("Apple iPhone 12 Mini (Used)", [{ condition: "refurbished" }]);
  await blocked("Apple iPhone 15 Pro", [{}]);
  await blocked("Apple iPhone 11 (Used)", [{}], { category: "tablets" });
  // An unknown-condition active variant is blocked by the condition check itself.
  await blocked("Apple iPhone 11 Pro (Used)", [{ condition: "unknown" }]);
});

test("the migration only replaces the validator and keeps every original check", async () => {
  const sql = await readFile(new URL("../supabase/migrations/202610220001_publication_used_iphone_no_warranty.sql", import.meta.url), "utf8");
  const body = sql.replace(/^--.*$/gm, "");
  assert.equal((body.match(/create or replace function/g) ?? []).length, 1);
  assert.match(body, /create or replace function public\.validate_product_for_publication\(p_product_id uuid\)/);
  assert.doesNotMatch(body, /\b(insert into|update public|delete from|alter table|drop )/i, "no data or schema change");
  for (const check of ["real_catalog_classification_required", "title_required", "active_real_brand_required", "active_real_category_required", "active_variant_required", COMMERCIAL, IMAGE])
    assert.match(body, new RegExp(`'${check}'`));
  for (const fact of ["price_minor <= 0", "delivery_scope is null", "pta_status = 'unknown'", "condition = 'unknown'"]) assert.ok(body.includes(fact), fact);
});
