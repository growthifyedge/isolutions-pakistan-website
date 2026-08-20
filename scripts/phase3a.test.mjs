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
