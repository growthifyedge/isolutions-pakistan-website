import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const schema = await readFile(
  "supabase/migrations/202608200001_phase_3a_catalog_foundation.sql",
  "utf8",
);
const rls = await readFile(
  "supabase/migrations/202608200002_phase_3a_rls.sql",
  "utf8",
);
const devData = await readFile("src/data/adminDevelopmentData.ts", "utf8");
const adminApp = await readFile("src/admin/AdminApp.tsx", "utf8");
const mediaMigration = await readFile(
  "supabase/migrations/202608210001_phase_3b_cloudinary_media.sql",
  "utf8",
);
const mediaManager = await readFile("src/admin/MediaManager.tsx", "utf8");
const cloudinaryClient = await readFile("src/lib/cloudinary.ts", "utf8");
const uploadFunction = await readFile(
  "supabase/functions/cloudinary-upload-signature/index.ts",
  "utf8",
);
const deleteFunction = await readFile(
  "supabase/functions/cloudinary-delete-media/index.ts",
  "utf8",
);
const adminFunction = await readFile(
  "supabase/functions/_shared/admin.ts",
  "utf8",
);

test("sellable combinations are explicit rows and impossible combinations are absent", () => {
  assert.match(schema, /Each row is one explicit sellable combination/);
  assert.match(
    schema,
    /unique nulls not distinct \(product_id, ram_display, storage_display, color_finish, carrier_jv\)/,
  );
  assert.doesNotMatch(devData, /storage: "512 GB", finish: "Silver"/);
});

test("commercial money is stored as BIGINT minor units", () => {
  assert.match(schema, /price_minor bigint not null/);
  assert.match(schema, /compare_at_price_minor bigint/);
  assert.doesNotMatch(
    schema,
    /price_(?:minor )?(?:real|double precision|numeric\([^)]*,\s*[1-9])/i,
  );
  assert.match(devData, /BigInt\(minor\)/);
});

test("PTA unknown remains a distinct controlled state", () => {
  assert.match(
    schema,
    /create type public\.pta_status as enum \('approved', 'not_approved', 'not_applicable', 'unknown'\)/,
  );
  assert.match(schema, /pta_status = 'unknown'/);
});

test("publication validation blocks unresolved commercial facts", () => {
  for (const rule of [
    "active_variant_required",
    "variant_commercial_facts_unresolved",
    "delivery_scope is null",
    "price_minor <= 0",
    "condition = 'unknown'",
  ])
    assert.match(
      schema,
      new RegExp(rule.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
    );
  assert.match(schema, /product_publication_validation_failed/);
});

test("inventory is numeric, movement-based, and not availability text", () => {
  assert.match(schema, /quantity_delta integer not null/);
  assert.match(schema, /inventory_delta_nonzero/);
  assert.doesNotMatch(schema, /in stock|now available/i);
});

test("public reads exclude drafts and public writes are not granted", () => {
  assert.match(
    rls,
    /publication_status = 'published' and published_at is not null/,
  );
  assert.doesNotMatch(rls, /grant (?:insert|update|delete)[^;]+ to anon/i);
  assert.match(
    rls,
    /revoke all on all tables in schema public from anon, authenticated/,
  );
});

test("Admin authorization is database-backed and RLS covers every exposed table", () => {
  assert.match(schema, /from public\.profiles/);
  assert.match(
    schema,
    /role in \('owner'::public\.app_role, 'admin'::public\.app_role\)/,
  );
  for (const table of [
    "profiles",
    "brands",
    "categories",
    "products",
    "product_variants",
    "inventory_movements",
    "product_specifications",
    "product_media",
  ])
    assert.match(
      rls,
      new RegExp(`alter table public\\.${table} enable row level security`),
    );
  assert.doesNotMatch(rls, /email/i);
  assert.match(adminApp, /rpc\("is_catalog_admin"\)/);
  assert.match(adminApp, /Verified Owner \/ Admin/);
  assert.doesNotMatch(adminApp, /Profile verification required/);
});

test("only database-authorized Admin identities can request Cloudinary operations", () => {
  assert.match(uploadFunction, /requireCatalogAdmin\(request\)/);
  assert.match(deleteFunction, /requireCatalogAdmin\(request\)/);
  assert.match(adminFunction, /rpc\("is_catalog_admin"\)/);
  assert.match(adminFunction, /client\.auth\.getUser\(\)/);
});

test("media metadata excludes image binary and base64 payloads", () => {
  assert.match(mediaManager, /containsBinaryMediaData\(metadata\)/);
  assert.match(mediaMigration, /Image binary and base64 data are forbidden/);
  assert.doesNotMatch(mediaMigration, /\b(bytea|blob)\b/i);
});

test("source validation checks type, size, and image file signatures", () => {
  assert.match(cloudinaryClient, /MAX_SOURCE_IMAGE_BYTES = 25 \* 1024 \* 1024/);
  assert.match(
    cloudinaryClient,
    /image\/jpeg.*image\/png.*image\/webp.*image\/avif/s,
  );
  assert.match(cloudinaryClient, /file\.slice\(0, 12\)\.arrayBuffer\(\)/);
  assert.match(
    cloudinaryClient,
    /file contents do not match a supported image format/,
  );
});

test("primary image, reorder, and variant association are database enforced", () => {
  assert.match(schema, /product_media_one_primary_per_product/);
  assert.match(mediaMigration, /ensure_primary_media_after_delete/);
  assert.match(mediaMigration, /reorder_product_media/);
  assert.match(mediaMigration, /media_reorder_set_mismatch/);
  assert.match(mediaMigration, /media_variant_must_belong_to_product/);
});

test("publication requires a complete primary Cloudinary image", () => {
  assert.match(mediaMigration, /primary_product_media_required/);
  assert.match(
    mediaMigration,
    /is_primary and cloudinary_public_id is not null/,
  );
  assert.match(
    mediaMigration,
    /secure_url is not null and width > 0 and height > 0 and bytes > 0/,
  );
});

test("Cloudinary master and delivery policies stay distinct", () => {
  assert.match(uploadFunction, /c_limit,w_3000,h_3000,q_90,fl_force_strip/);
  assert.doesNotMatch(uploadFunction, /(?:^|,)fl_strip(?:,|$)/m);
  assert.doesNotMatch(uploadFunction, /f_auto/);
  assert.match(cloudinaryClient, /q_auto,f_auto/);
  assert.match(adminFunction, /"SHA-256"/);
  assert.doesNotMatch(uploadFunction, /overwrite|unique_filename|use_filename/);
  const formFields = [...mediaManager.matchAll(/form\.set\("([^"]+)"/g)].map(
    (match) => match[1],
  );
  assert.deepEqual(formFields, [
    "file",
    "api_key",
    "signature",
    "folder",
    "timestamp",
    "transformation",
  ]);
  assert.doesNotMatch(
    mediaManager,
    /form\.set\("(?:overwrite|unique_filename|use_filename|expiresAt|cloud_name|resource_type)"/,
  );
});

test("Cloudinary secrets never enter frontend source", async () => {
  const frontend = [
    adminApp,
    mediaManager,
    cloudinaryClient,
    await readFile("src/lib/supabase.ts", "utf8"),
  ].join("\n");
  assert.doesNotMatch(
    frontend,
    /CLOUDINARY_API_SECRET|CLOUDINARY_API_KEY|service[_-]?role/i,
  );
  assert.match(adminFunction, /CLOUDINARY_API_SECRET/);
});

test("delete flow removes Cloudinary asset before metadata and preserves a primary fallback", () => {
  assert.ok(
    deleteFunction.indexOf("/image/destroy") <
      deleteFunction.indexOf("metadata_delete_failed"),
  );
  assert.match(mediaMigration, /if old\.is_primary then/);
  assert.match(mediaMigration, /order by sort_order, created_at, id limit 1/);
});
