import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { buildPublishPreview, publishConfirmationPhrase, publishConfirmationSatisfied, runBulkPublish } from "../src/lib/bulkPublish.ts";
import { createSubmitLatch } from "../src/lib/bulkImageUpload.ts";
import {
  catalogPublishSelection,
  isDraft,
  previewMatchesSelection,
  pruneSelection,
  readableBlocker,
  selectAllDrafts,
  toggleSelection,
  validateDrafts,
} from "../src/lib/catalogBulkPublish.ts";
import { SUPABASE_ENVIRONMENTS } from "../src/lib/supabaseEnvironment.ts";

const DEV_URL = `https://${SUPABASE_ENVIRONMENTS.development.supabaseProjectRef}.supabase.co`;
const PROD_URL = `https://${SUPABASE_ENVIRONMENTS.production.supabaseProjectRef}.supabase.co`;

/** Catalog fixture: one product per category, with the facts the (fake) server validator looks at. */
const CATALOG = [
  { id: "android", title: "Samsung A07", category: "android-phones", brand: "Samsung", media: 1 },
  { id: "iphone-used", title: "iPhone 13 (Used)", category: "iphones", brand: "Apple", media: 1, used: true, warranty: null },
  { id: "tablet", title: "Samsung Tab S10 Lite", category: "tablets", brand: "Samsung", media: 1, warranty: null },
  { id: "macbook", title: "Apple MacBook Air M5", category: "laptops", brand: "Apple", media: 1, warranty: null },
  { id: "laptop-dell", title: "Dell XPS 13", category: "laptops", brand: "Dell", media: 1 },
  { id: "gadget", title: "Apple Watch SE", category: "gadgets", brand: "Apple", media: 1, pta: "not_applicable" },
  { id: "accessory", title: "Anker 20W Charger", category: "accessories", brand: "Anker", media: 1, pta: "not_applicable" },
  { id: "no-image", title: "Honor X6c", category: "android-phones", brand: "Honor", media: 0 },
  { id: "no-variant", title: "Tecno Spark 40", category: "android-phones", brand: "Tecno", media: 1, variants: 0 },
  { id: "live", title: "Realme C75x", category: "android-phones", brand: "Realme", media: 1, status: "published" },
  { id: "archived", title: "Old Test Phone", category: "android-phones", brand: "Test", media: 1, status: "archived" },
];

const commercial = (p) => ({ id: p.id, title: p.title, slug: p.id, brandName: p.brand, dataClass: "real", publicationStatus: p.status ?? "draft", defaultPta: "approved", defaultCondition: "brand_new" });
const listRow = (p) => ({ id: p.id, publication_status: p.status ?? "draft" });

/**
 * In-memory database. `validate` stands in for validate_product_for_publication (the app never re-implements it);
 * `publish` behaves like the products_enforce_publication trigger: it re-runs the validator and refuses invalid rows.
 */
function fakeDb(catalog = CATALOG, { publishThrows = new Set() } = {}) {
  const facts = new Map(catalog.map((p) => [p.id, { ...p }]));
  const rows = new Map(catalog.map((p) => [p.id, { status: p.status ?? "draft", publishedAt: null, fields: { title: p.title, slug: p.id, category: p.category, brand: p.brand, is_featured: false } }]));
  const variants = new Map(catalog.map((p) => [p.id, Array.from({ length: p.variants ?? 2 }, (_, i) => ({ id: `${p.id}-v${i}`, sku: `${p.id}-${i}`, price_minor: 100_000 + i, pta_status: p.pta ?? "approved", condition: p.used ? "used" : "brand_new", is_active: true }))]));
  const state = { rows, facts, variants, writes: [], validations: [] };
  const validate = async (id) => {
    state.validations.push(id);
    const p = facts.get(id);
    const errors = [];
    if (!(p.media > 0)) errors.push("primary_product_media_required");
    if (!variants.get(id).some((v) => v.is_active)) errors.push("active_variant_required");
    if (p.category === "laptops" && p.brand !== "Apple") errors.push("laptops_apple_brand_required");
    return { isValid: errors.length === 0, errors };
  };
  const deps = {
    supabaseUrl: DEV_URL,
    buildMode: "development",
    readProduct: async (id) => ({ publicationStatus: rows.get(id).status, publishedAt: rows.get(id).publishedAt, fields: { ...rows.get(id).fields } }),
    validate,
    readSnapshot: async (id) => ({ variants: variants.get(id).map((v) => ({ ...v })), mediaCount: facts.get(id).media, stockRows: 1, stockSum: 20 }),
    publish: async (id) => {
      state.writes.push({ table: "products", id, values: { publication_status: "published" } });
      if (publishThrows.has(id)) throw new Error("product_publication_validation_failed");
      const check = await validate(id); // the database trigger
      if (!check.isValid) throw new Error("product_publication_validation_failed");
      rows.get(id).status = "published";
      rows.get(id).publishedAt = "2026-10-29T00:00:00Z";
    },
  };
  return { state, deps, validate };
}

const freshProducts = (db) => CATALOG.map((p) => commercial({ ...p, status: db.state.rows.get(p.id).status }));
async function previewFor(db, ids) {
  const selection = catalogPublishSelection(ids, freshProducts(db));
  return buildPublishPreview(selection, await validateDrafts(selection, db.validate));
}
const ALL_DRAFT_IDS = CATALOG.filter((p) => (p.status ?? "draft") === "draft").map((p) => p.id);

test("1. Draft products from every category can be selected together", () => {
  let selected = new Set();
  for (const id of ["android", "iphone-used", "tablet", "macbook", "gadget", "accessory"]) selected = toggleSelection(selected, listRow(CATALOG.find((p) => p.id === id)), true);
  assert.equal(selected.size, 6);
  selected = toggleSelection(selected, listRow(CATALOG.find((p) => p.id === "tablet")), false);
  assert.equal(selected.size, 5);
});

test("2. Select All Drafts adds only drafts of the shown rows; published / archived can never be selected", () => {
  const rows = CATALOG.map(listRow);
  const all = selectAllDrafts(new Set(), rows);
  assert.deepEqual([...all].sort(), [...ALL_DRAFT_IDS].sort());
  assert.equal(all.size, 9);
  assert.ok(!all.has("live") && !all.has("archived"));
  assert.equal(toggleSelection(new Set(), listRow(CATALOG.find((p) => p.id === "live")), true).size, 0, "a published product cannot be ticked");
  const filtered = selectAllDrafts(new Set(["macbook"]), rows.filter((r) => r.id.startsWith("a")));
  assert.deepEqual([...filtered].sort(), ["accessory", "android", "macbook"], "select all respects the search filter and keeps earlier ticks");
  assert.ok(rows.filter(isDraft).every((r) => r.publication_status === "draft"));
});

test("3-6. a mixed batch: valid products are Ready, invalid ones Needs Review with the exact validator reason, and only Ready ones are written", async () => {
  const db = fakeDb();
  const preview = await previewFor(db, ALL_DRAFT_IDS);
  const kind = Object.fromEntries(preview.entries.map((e) => [e.productId, e.kind]));
  assert.deepEqual(
    Object.keys(kind).filter((id) => kind[id] === "ready").sort(),
    ["accessory", "android", "gadget", "iphone-used", "macbook", "tablet"],
    "used iPhone (no warranty), tablet / MacBook (optional warranty), gadget / accessory (PTA n/a) pass whatever the server validator says",
  );
  const blockers = Object.fromEntries(preview.entries.filter((e) => e.kind === "blocked").map((e) => [e.productId, e.blockers]));
  assert.deepEqual(blockers, { "laptop-dell": ["laptops_apple_brand_required"], "no-image": ["primary_product_media_required"], "no-variant": ["active_variant_required"] });
  assert.equal(db.state.writes.length, 0, "validation never writes");
  const run = await runBulkPublish(preview, db.deps);
  assert.deepEqual(db.state.writes.map((w) => w.id).sort(), ["accessory", "android", "gadget", "iphone-used", "macbook", "tablet"]);
  for (const id of ["laptop-dell", "no-image", "no-variant"]) assert.equal(db.state.rows.get(id).status, "draft", `${id} stays Draft`);
  assert.deepEqual(run.summary, { targeted: 9, verified: 6, alreadyPublished: 0, blocked: 3, failed: 0, skipped: 0 });
  assert.equal(run.outcome, "issues", "9. partial success is reported as partial, never as all-success");
});

test("C. selected products that are no longer Draft are reported, never republished; deleted ids are counted", async () => {
  const db = fakeDb();
  db.state.rows.get("android").status = "published"; // published elsewhere after it was ticked
  const preview = await previewFor(db, ["android", "archived", "tablet", "gone-id"]);
  assert.deepEqual(preview.totals, { targets: 3, draft: 1, alreadyPublished: 1, ready: 1, blocked: 0, skipped: 1, missingTitles: 1 });
  await runBulkPublish(preview, db.deps);
  assert.deepEqual(db.state.writes.map((w) => w.id), ["tablet"]);
});

test("stale preview: a product broken after validation is re-validated before its write and stays Draft; others still publish", async () => {
  const db = fakeDb();
  const preview = await previewFor(db, ["android", "tablet", "macbook"]);
  assert.equal(preview.totals.ready, 3);
  db.state.facts.get("tablet").media = 0; // primary image removed after validation
  const run = await runBulkPublish(preview, db.deps);
  const byId = Object.fromEntries(run.products.map((p) => [p.productId, p]));
  assert.equal(byId.tablet.status, "blocked");
  assert.deepEqual(byId.tablet.blockers, ["primary_product_media_required"]);
  assert.equal(db.state.rows.get("tablet").status, "draft");
  assert.equal(byId.android.status, "verified");
  assert.equal(byId.macbook.status, "verified");
});

test("one product failing at the server does not block the others; the failure is reported per product", async () => {
  const db = fakeDb(CATALOG, { publishThrows: new Set(["android"]) });
  const preview = await previewFor(db, ["android", "gadget", "accessory"]);
  const run = await runBulkPublish(preview, db.deps);
  assert.deepEqual(run.summary, { targeted: 3, verified: 2, alreadyPublished: 0, blocked: 0, failed: 1, skipped: 0 });
  assert.match(run.products.find((p) => p.productId === "android").message, /product_publication_validation_failed/);
  assert.equal(db.state.rows.get("android").status, "draft");
});

test("12. publishing writes only publication_status and verifies prices, variants, media and stock unchanged", async () => {
  const db = fakeDb();
  const preview = await previewFor(db, ["macbook", "gadget"]);
  const run = await runBulkPublish(preview, db.deps);
  assert.ok(db.state.writes.every((w) => w.table === "products" && JSON.stringify(w.values) === '{"publication_status":"published"}'));
  for (const product of run.products) {
    assert.equal(product.status, "verified");
    assert.ok(product.checks.length >= 6 && product.checks.every((c) => c.ok), product.checks.filter((c) => !c.ok).map((c) => c.name).join());
  }
});

test("7. nothing publishes without confirmation; PROD needs the typed phrase with the exact count; unknown environment is blocked", async () => {
  assert.equal(publishConfirmationSatisfied("production", "", 6), false);
  assert.equal(publishConfirmationSatisfied("production", "PUBLISH 5", 6), false);
  assert.equal(publishConfirmationSatisfied("production", publishConfirmationPhrase(6), 6), true);
  assert.equal(publishConfirmationSatisfied("development", "", 6), true);
  assert.equal(publishConfirmationSatisfied(null, "PUBLISH 6", 6), false);
  assert.equal(publishConfirmationSatisfied("development", "", 0), false, "nothing ready -> nothing to confirm");
  const db = fakeDb();
  const preview = await previewFor(db, ["android"]);
  const blocked = await runBulkPublish(preview, { ...db.deps, supabaseUrl: PROD_URL, buildMode: "development" });
  assert.equal(blocked.outcome, "blocked", "build mode / project mismatch blocks before any write");
  assert.equal(db.state.writes.length, 0);
});

test("8. double-click protection: the submit latch admits one run at a time", () => {
  const latch = createSubmitLatch();
  assert.equal(latch.tryAcquire(), true);
  assert.equal(latch.tryAcquire(), false);
  latch.release();
  assert.equal(latch.tryAcquire(), true);
});

test("a preview belongs to its exact selection; any change makes it stale", () => {
  const preview = { entries: [], totals: {} };
  assert.equal(previewMatchesSelection(preview, ["a", "b"], new Set(["b", "a"])), true);
  assert.equal(previewMatchesSelection(preview, ["a", "b"], new Set(["a"])), false);
  assert.equal(previewMatchesSelection(preview, ["a"], new Set(["a", "c"])), false);
  assert.equal(previewMatchesSelection(null, [], new Set()), false);
});

test("after a reload the selection keeps only products that still exist and are still Draft", () => {
  const next = pruneSelection(new Set(["android", "live", "gone"]), CATALOG.map(listRow));
  assert.deepEqual([...next], ["android"]);
});

test("validator codes are shown in plain words with the exact code kept", () => {
  assert.equal(readableBlocker("primary_product_media_required"), "primary image required (primary_product_media_required)");
  assert.equal(readableBlocker("title_required"), "title required (title_required)");
});

test("static: the Catalog reuses the existing validator and engine, adds no validator of its own, and keeps individual publish", async () => {
  const lib = await readFile("src/lib/catalogBulkPublish.ts", "utf8");
  const panel = await readFile("src/admin/CatalogBulkPublish.tsx", "utf8");
  const catalog = await readFile("src/admin/AdminCatalog.tsx", "utf8");
  assert.doesNotMatch(lib, /supabase|SupabaseClient|\.rpc\(|\.from\(|\.update\(|\.insert\(/, "the selection lib never touches the database");
  assert.doesNotMatch(lib, /primary_product_media_required"\s*\)|errors\.push/, "no parallel validator");
  assert.match(panel, /validateForPublication\(client, productId\)/, "Validate Selected uses the existing RPC adapter");
  assert.match(panel, /runBulkPublish\(preview, \{[^}]*publishDbDeps\(client\)/, "Publish Selected uses the existing engine and its only write");
  assert.match(panel, /loadPublishProducts\(client\)/, "statuses are re-read, not taken from the cached list");
  assert.match(panel, /publishConfirmationSatisfied\(target\.environment, typed, preview\.totals\.ready\)/, "publish() re-checks the confirmation");
  assert.match(panel, /publishLatch\.current\.tryAcquire\(\)/);
  assert.match(panel, /validateLatch\.current\.tryAcquire\(\)/);
  assert.doesNotMatch(panel, /\.from\("products"\)\.update|\.rpc\("/, "the panel makes no direct writes / RPCs");
  // Individual "Validate & publish" is unchanged.
  assert.match(catalog, /supabase\.rpc\("validate_product_for_publication", \{\s*p_product_id: productId,\s*\}\)/);
  assert.match(catalog, /publication_status: "published",\s*is_flash_sale: draft\.is_flash_sale/);
  assert.match(catalog, /Validate & publish/);
  // Only Draft rows get a checkbox.
  assert.match(catalog, /\{isDraft\(p\) && \(\s*<input/);
});
