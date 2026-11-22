import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createCatalogTestDatabase, signInAsOwner } from "./support/catalogTestDatabase.mjs";

// Executes the REAL migrations (including 202611060001_publication_accessories_no_warranty.sql) in an in-memory
// Postgres (PGlite). No DEV / PROD database is involved.
// Owner rule (2026-11-06): Mobile Accessories need no warranty to publish (missing warranty stays NULL).
// PTA, condition, price, delivery, active variant and primary image stay required; other categories unchanged.

const COMMERCIAL = "variant_commercial_facts_unresolved";
const IMAGE = "primary_product_media_required";
const MIGRATION = "202611060001_publication_accessories_no_warranty.sql";

async function makeDb() {
  const db = await createCatalogTestDatabase();
  await signInAsOwner(db);
  await db.exec(`
    insert into public.brands (name, slug, is_active, data_class)
    select v.name, v.slug, true, 'real' from (values ('Apple', 'apple-test'), ('Samsung', 'samsung-test')) as v(name, slug)
    where not exists (select 1 from public.brands b where lower(b.name) = lower(v.name));
    update public.brands set is_active = true, data_class = 'real' where lower(name) in ('apple', 'samsung');
    update public.categories set is_active = true, data_class = 'real'
    where slug in ('mobile-phones', 'mobile-accessories', 'gadgets', 'tablets', 'laptops');
  `);
  let n = 0;
  const product = async (title, { brand = "Apple", category = "mobile-accessories", warranty = null } = {}) =>
    (await db.query(
      `insert into public.products (brand_id, category_id, title, slug, publication_status, data_class, default_warranty)
       select (select id from public.brands where name = $3 and data_class = 'real' limit 1), c.id, $1, $2, 'draft', 'real', $5
       from public.categories c where c.slug = $4 limit 1 returning id`,
      [title, `p-${(n += 1)}`, brand, category, warranty],
    )).rows[0].id;
  const variant = async (productId, { condition = "brand_new", pta = "not_applicable", price = 500000, scope = "nationwide", active = true, warranty = null } = {}) =>
    db.query(
      `insert into public.product_variants (product_id, sku, color_finish, price_minor, pta_status, condition, delivery_scope, is_active, warranty_override)
       values ($1, '', $2, $3, $4::public.pta_status, $5::public.product_condition, $6::public.delivery_scope, $7, $8)`,
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
  return { db, listing, validate, publish };
}

test("Accessory with NULL warranty and valid facts passes and publishes; warranty stays NULL and SKU is AC", async () => {
  const { db, listing, validate, publish } = await makeDb();
  const id = await listing("Apple AirTag", [{}, { active: false }]);
  assert.deepEqual(await validate(id), { is_valid: true, errors: [] });
  await publish(id);
  assert.deepEqual((await db.query(`select publication_status, default_warranty from public.products where id = $1`, [id])).rows[0], {
    publication_status: "published",
    default_warranty: null,
  });
  const variants = (await db.query(`select sku, warranty_override from public.product_variants where product_id = $1 order by sku`, [id])).rows;
  assert.deepEqual(variants.map((v) => v.warranty_override), [null, null], "no warranty value is invented");
  for (const v of variants) assert.match(v.sku, /^AC\d{3}$/);
});

test("Accessory without a brand and with NULL warranty also passes", async () => {
  const { listing, validate } = await makeDb();
  assert.deepEqual(await validate(await listing("Redmi Buds Test", [{}], { brand: "None" })), { is_valid: true, errors: [] });
});

test("Owner-confirmed accessory warranty is kept unchanged and still passes", async () => {
  const { db, listing, validate, publish } = await makeDb();
  const id = await listing("Samsung 25W Charger", [{ warranty: "6 Month Warranty" }, {}], { brand: "Samsung", warranty: "1 Year" });
  assert.deepEqual(await validate(id), { is_valid: true, errors: [] });
  await publish(id);
  assert.equal((await db.query(`select default_warranty from public.products where id = $1`, [id])).rows[0].default_warranty, "1 Year");
  const overrides = (await db.query(`select warranty_override from public.product_variants where product_id = $1 order by warranty_override nulls last`, [id])).rows;
  assert.deepEqual(overrides.map((r) => r.warranty_override), ["6 Month Warranty", null]);
});

test("Accessory keeps every other blocker: PTA, condition, price, delivery, active variant, image", async () => {
  const { listing, validate, publish } = await makeDb();
  const blocked = async (title, variants, errors, options) =>
    assert.deepEqual((await validate(await listing(title, variants, options))).errors, errors, title);
  await blocked("Acc PTA unknown", [{ pta: "unknown" }], [COMMERCIAL]);
  await blocked("Acc condition unknown", [{ condition: "unknown" }], [COMMERCIAL]);
  await blocked("Acc price 0", [{ price: 0 }], [COMMERCIAL]);
  await blocked("Acc no delivery", [{ scope: null }], [COMMERCIAL]);
  await blocked("Acc one bad variant", [{}, { pta: "unknown" }], [COMMERCIAL]);
  await blocked("Acc no active variant", [{ active: false }], ["active_variant_required"]);
  await blocked("Acc no image", [{}], [IMAGE], { image: false });
  const id = await listing("Acc trigger check", [{ condition: "unknown" }]);
  await assert.rejects(publish(id), /product_publication_validation_failed/, "the publication trigger still enforces the validator");
});

test("other categories are unchanged: phones need warranty; gadgets, used iPhone, tablets, MacBooks keep their exemptions", async () => {
  const { listing, validate } = await makeDb();
  const phoneFacts = { pta: "approved", scope: "karachi_only" };
  assert.deepEqual((await validate(await listing("Samsung A57", [phoneFacts], { brand: "Samsung", category: "mobile-phones" }))).errors, [COMMERCIAL], "Android still needs a warranty");
  // Since 202611190001 (Owner rule 2026-11-18) a New iPhone needs no warranty (publicationNewIphoneWarranty.test.mjs).
  assert.deepEqual(await validate(await listing("Apple iPhone 16", [phoneFacts], { category: "mobile-phones" })), { is_valid: true, errors: [] }, "New iPhone warranty optional");
  assert.deepEqual(await validate(await listing("Samsung A36", [phoneFacts], { brand: "Samsung", category: "mobile-phones", warranty: "1 Year" })), { is_valid: true, errors: [] });
  assert.deepEqual(await validate(await listing("Apple iPhone 13 (Used)", [{ ...phoneFacts, condition: "used" }], { category: "mobile-phones" })), { is_valid: true, errors: [] }, "Used iPhone exemption kept");
  assert.deepEqual(await validate(await listing("Gadget Lamp", [{ pta: "unknown", condition: "unknown" }], { brand: "None", category: "gadgets" })), { is_valid: true, errors: [] }, "gadget exemption kept");
  assert.deepEqual(await validate(await listing("Apple iPad Air", [{ scope: "karachi_only" }], { category: "tablets" })), { is_valid: true, errors: [] }, "tablet exemption kept");
  assert.deepEqual(await validate(await listing("Apple MacBook Air", [{ scope: "karachi_only" }], { category: "laptops" })), { is_valid: true, errors: [] }, "MacBook exemption kept");
  assert.deepEqual((await validate(await listing("Samsung Book", [{ scope: "karachi_only" }], { brand: "Samsung", category: "laptops" }))).errors, ["laptops_apple_brand_required", COMMERCIAL], "Apple-only laptops kept (non-Apple laptop also gets no warranty exemption)");
});

test("the migration only replaces the validator, changes no data and keeps every original check", async () => {
  const sql = await readFile(new URL(`../supabase/migrations/${MIGRATION}`, import.meta.url), "utf8");
  const body = sql.replace(/^--.*$/gm, "");
  assert.equal((body.match(/create or replace function/g) ?? []).length, 1);
  assert.match(body, /create or replace function public\.validate_product_for_publication\(p_product_id uuid\)/);
  assert.doesNotMatch(body, /\b(insert into|update public|delete from|alter table|drop )/i, "no data or schema change");
  for (const check of ["real_catalog_classification_required", "title_required", "active_real_brand_required", "active_real_category_required", "active_variant_required", "laptops_apple_brand_required", COMMERCIAL, IMAGE])
    assert.match(body, new RegExp(`'${check}'`));
  for (const fact of ["price_minor <= 0", "delivery_scope is null", "pta_status = 'unknown'", "condition = 'unknown'", "v_category_slug = 'mobile-accessories'", "not v_accessory"])
    assert.ok(body.includes(fact), fact);
});
