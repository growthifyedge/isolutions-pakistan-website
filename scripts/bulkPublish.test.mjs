import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { ANDROID_IMPORT_BATCH_TITLES } from "../src/lib/androidImportBatch.ts";
import { buildPublishPreview, publishConfirmationPhrase, publishConfirmationSatisfied, runBulkPublish, verifyPublish } from "../src/lib/bulkPublish.ts";
import { ANDROID_BATCH_DESIRED, planCommercialDefaults, runCommercialDefaults, selectAndroidBatch } from "../src/lib/commercialDefaults.ts";
import { SUPABASE_ENVIRONMENTS } from "../src/lib/supabaseEnvironment.ts";
import { installUnloadGuard } from "../src/lib/unloadGuard.ts";

const DEV_URL = `https://${SUPABASE_ENVIRONMENTS.development.supabaseProjectRef}.supabase.co`;
const PROD_URL = `https://${SUPABASE_ENVIRONMENTS.production.supabaseProjectRef}.supabase.co`;

const product = (id, title, extra = {}) => ({ id, title, slug: id, brandName: title.split(" ")[0], dataClass: "real", publicationStatus: "draft", defaultPta: "approved", defaultCondition: "brand_new", ...extra });
const variantsFor = (productId, n = 3, extra = {}) =>
  Array.from({ length: n }, (_, i) => ({
    id: `${productId}-v${i}`, product_id: productId, sku: `MB-${productId}-${i}`, ram_display: `${4 + i} GB`, storage_display: "128 GB", color_finish: "Black", carrier_jv: null,
    price_minor: 5_000_000 + i, compare_at_price_minor: null, pta_status: "approved", condition: "brand_new", condition_grade: null, battery_health_percent: null,
    battery_cycle_count: null, sim_configuration: null, warranty_override: null, delivery_scope: "karachi_only", is_active: true, sort_order: i, ...extra,
  }));

/** In-memory database; `validate` mirrors the SQL validator's commercial-facts and primary-image rules. */
function fakeDb({ products, variants, media = {}, publishThrows = new Set(), dropPublish = new Set(), mutateOnPublish = null }) {
  const rows = new Map(products.map((p) => [p.id, { status: p.publicationStatus, publishedAt: null, fields: { title: p.title, slug: p.slug, brand_id: p.brandName, category_id: "cat", default_pta_status: p.defaultPta, default_condition: p.defaultCondition, is_featured: false, is_flash_sale: false } }]));
  const state = { rows, variants: variants.map((v) => ({ ...v })), writes: [], validations: [] };
  const validate = async (id) => {
    state.validations.push(id);
    const errors = [];
    if (state.variants.some((v) => v.product_id === id && v.is_active && (v.pta_status === "unknown" || v.condition === "unknown"))) errors.push("variant_commercial_facts_unresolved");
    if (!(media[id] > 0)) errors.push("primary_product_image_required");
    return { isValid: errors.length === 0, errors };
  };
  const deps = {
    supabaseUrl: DEV_URL,
    buildMode: "development",
    readProduct: async (id) => ({ publicationStatus: rows.get(id).status, publishedAt: rows.get(id).publishedAt, fields: { ...rows.get(id).fields } }),
    validate,
    readSnapshot: async (id) => ({ variants: state.variants.filter((v) => v.product_id === id).map((v) => ({ ...v })), mediaCount: media[id] ?? 0, stockRows: 2, stockSum: 9 }),
    publish: async (id) => {
      state.writes.push({ table: "products", id, values: { publication_status: "published" } });
      if (publishThrows.has(id)) throw new Error("product_publication_validation_failed");
      if (dropPublish.has(id)) return;
      rows.get(id).status = "published";
      rows.get(id).publishedAt = "2026-10-11T00:00:00Z";
      mutateOnPublish?.(id, state);
    },
  };
  return { state, deps, validate };
}

async function previewOf(products, db, titles) {
  const selection = selectAndroidBatch(products, titles);
  const validations = new Map();
  for (const p of selection.targets.filter((x) => x.publicationStatus === "draft")) validations.set(p.id, await db.validate(p.id));
  return buildPublishPreview(selection, validations);
}

const readyProducts = (n) => Array.from({ length: n }, (_, i) => product(`p${i}`, ANDROID_IMPORT_BATCH_TITLES[i]));
const readyData = (products) => ({ products, variants: products.flatMap((p) => variantsFor(p.id)), media: Object.fromEntries(products.map((p) => [p.id, 3])) });

test("24. a fixture of all 82 batch products, fully ready, previews 82 ready and publishes 82 verified", async () => {
  const products = readyProducts(82);
  assert.equal(new Set(products.map((p) => p.title)).size, 82);
  const db = fakeDb(readyData(products));
  const preview = await previewOf(products, db);
  assert.deepEqual(preview.totals, { targets: 82, draft: 82, alreadyPublished: 0, ready: 82, blocked: 0, skipped: 0, missingTitles: 0 });
  assert.equal(db.state.writes.length, 0, "14. the preview makes zero writes");
  const run = await runBulkPublish(preview, db.deps);
  assert.equal(run.outcome, "verified");
  assert.deepEqual(run.summary, { targeted: 82, verified: 82, alreadyPublished: 0, blocked: 0, failed: 0, skipped: 0 });
  assert.ok([...db.state.rows.values()].every((r) => r.status === "published" && r.publishedAt));
  assert.ok(run.products.every((p) => p.checks.length >= 8 && p.checks.every((c) => c.ok)));
});

test("1-3. only the exact Android batch is targeted; unrelated and Apple products are never published", async () => {
  const batch = [product("a", "Samsung A07"), product("b", "Honor X6c")];
  const others = [product("ip", "iPhone 15", { brandName: "Apple" }), product("acc", "Anker 20W Charger"), product("old", "Samsung Galaxy S21 Ultra Test"), product("apple-same", "Samsung A17", { brandName: "Apple" }), product("d1", "Nothing Phone 1"), product("d2", "Nothing Phone 1")];
  const all = [...batch, ...others];
  const db = fakeDb(readyData(all));
  const preview = await previewOf(all, db);
  assert.deepEqual(preview.entries.filter((e) => e.kind === "ready").map((e) => e.productId).sort(), ["a", "b"]);
  assert.deepEqual(preview.entries.filter((e) => e.kind === "skipped").map((e) => e.productId).sort(), ["apple-same", "d1", "d2"]);
  assert.ok(!preview.entries.some((e) => ["ip", "acc", "old"].includes(e.productId)));
  await runBulkPublish(preview, db.deps);
  assert.deepEqual(db.state.writes.map((w) => w.id).sort(), ["a", "b"]);
  for (const id of ["ip", "acc", "old", "apple-same", "d1", "d2"]) assert.equal(db.state.rows.get(id).status, "draft");
});

test("4-6. ready draft products publish; blocked ones are skipped with the exact blocker; already-published ones are not republished", async () => {
  const products = [product("ok", "Samsung A07"), product("blocked", "Honor X6c"), product("live", "Honor X8D", { publicationStatus: "published" }), product("arch", "Honor X9D", { publicationStatus: "archived" })];
  const data = readyData(products);
  data.variants = data.variants.map((v) => (v.product_id === "blocked" ? { ...v, pta_status: "unknown" } : v));
  const db = fakeDb(data);
  const preview = await previewOf(products, db);
  assert.deepEqual(preview.totals, { targets: 4, draft: 2, alreadyPublished: 1, ready: 1, blocked: 1, skipped: 1, missingTitles: 78 });
  assert.deepEqual(preview.entries.find((e) => e.productId === "blocked").blockers, ["variant_commercial_facts_unresolved"]);
  const run = await runBulkPublish(preview, db.deps);
  assert.deepEqual(db.state.writes.map((w) => w.id), ["ok"], "only the ready product is written");
  assert.deepEqual(run.summary, { targeted: 4, verified: 1, alreadyPublished: 1, blocked: 1, failed: 0, skipped: 1 });
  assert.equal(run.outcome, "issues");
  assert.notEqual(run.message.startsWith("Published and verified"), true, "no false all-success message");
  assert.equal(db.state.rows.get("blocked").status, "draft");
});

test("7. a product that changed after the preview is re-read and re-validated, and blocked if it is no longer ready", async () => {
  const products = [product("p1", "Samsung A07"), product("p2", "Honor X6c"), product("p3", "Honor X8D")];
  const db = fakeDb(readyData(products));
  const preview = await previewOf(products, db);
  assert.equal(preview.totals.ready, 3);
  db.state.variants.find((v) => v.id === "p2-v1").condition = "unknown"; // broke after the preview
  db.state.rows.get("p3").status = "published"; // published elsewhere after the preview
  db.state.validations.length = 0;
  const run = await runBulkPublish(preview, db.deps);
  const byId = Object.fromEntries(run.products.map((r) => [r.productId, r]));
  assert.equal(byId.p1.status, "verified");
  assert.equal(byId.p2.status, "blocked");
  assert.match(byId.p2.message, /Blocked since the preview: variant_commercial_facts_unresolved/);
  assert.equal(byId.p3.status, "already_published");
  assert.deepEqual(db.state.writes.map((w) => w.id), ["p1"]);
  assert.ok(db.state.validations.includes("p1") && db.state.validations.includes("p2"), "every ready product is re-validated right before its write");
});

test("8, 15. the existing real validator and publish mechanism are reused (same RPC, same publication_status update)", async () => {
  const products = [product("p1", "Samsung A07")];
  const db = fakeDb(readyData(products));
  const preview = await previewOf(products, db);
  db.state.validations.length = 0;
  await runBulkPublish(preview, db.deps);
  assert.deepEqual(db.state.validations, ["p1"], "the injected validator (the RPC in the app) decides");
  const adapter = await readFile("src/lib/bulkPublishDb.ts", "utf8");
  const editor = await readFile("src/admin/AdminCatalog.tsx", "utf8");
  assert.match(adapter, /client\.rpc\("validate_product_for_publication", \{ p_product_id: productId \}\)/);
  assert.match(editor, /supabase\.rpc\("validate_product_for_publication"/);
  assert.match(adapter, /\.update\(\{ publication_status: "published" \}\)\.eq\("id", productId\)/);
  assert.match(editor, /publication_status: "published",/);
  assert.equal((adapter.match(/\.from\("products"\)\.update\(/g) ?? []).length, 1, "the adapter's only write");
  assert.doesNotMatch(adapter, /\.insert\(|\.delete\(|\.upsert\(|\.rpc\("(?!validate_product_for_publication)|price_minor:|sku:|is_featured:|is_flash_sale:/);
  const lib = await readFile("src/lib/bulkPublish.ts", "utf8");
  assert.doesNotMatch(lib, /\.from\(|\.rpc\(|supabase\.|client\.|fetch\(/, "no weaker parallel validator or database access in the planning library");
});

test("9. one product failing does not stop the later products", async () => {
  const products = [product("p1", "Samsung A07"), product("p2", "Honor X6c"), product("p3", "Honor X8D")];
  const db = fakeDb({ ...readyData(products), publishThrows: new Set(["p2"]) });
  const run = await runBulkPublish(await previewOf(products, db), db.deps);
  const byId = Object.fromEntries(run.products.map((r) => [r.productId, r]));
  assert.deepEqual([byId.p1.status, byId.p2.status, byId.p3.status], ["verified", "failed", "verified"]);
  assert.match(byId.p2.message, /Publish failed: product_publication_validation_failed/);
  assert.equal(run.outcome, "issues");
  assert.equal(run.summary.verified, 2);
  assert.equal(run.summary.failed, 1);
});

test("10. read-back verification is required: a write that did not take, or that changed anything else, is never 'verified'", async () => {
  const products = [product("p1", "Samsung A07"), product("p2", "Honor X6c"), product("p3", "Honor X8D")];
  const db = fakeDb({
    ...readyData(products),
    dropPublish: new Set(["p1"]),
    mutateOnPublish: (id, state) => {
      if (id === "p3") state.variants.find((v) => v.product_id === "p3").price_minor += 1;
      if (id === "p2") state.rows.get("p2").fields.title = "Renamed";
    },
  });
  const run = await runBulkPublish(await previewOf(products, db), db.deps);
  const byId = Object.fromEntries(run.products.map((r) => [r.productId, r]));
  assert.deepEqual([byId.p1.status, byId.p2.status, byId.p3.status], ["failed", "failed", "failed"]);
  assert.match(byId.p1.message, /read-back verification FAILED: Published/);
  assert.equal(byId.p1.checks.find((c) => c.name === "Published").ok, false);
  assert.equal(byId.p2.checks.find((c) => c.name === "Product fields unchanged").ok, false);
  assert.equal(byId.p3.checks.find((c) => c.name.startsWith("Prices")).ok, false);
  assert.equal(run.summary.verified, 0);
  assert.equal(run.outcome, "issues");
});

test("11-12. PROD needs the exact typed phrase PUBLISH <ready count>; DEV needs no typed text; unknown never confirms", () => {
  assert.equal(publishConfirmationPhrase(82), "PUBLISH 82");
  assert.equal(publishConfirmationPhrase(80), "PUBLISH 80");
  assert.equal(publishConfirmationSatisfied("production", "PUBLISH 82", 82), true);
  assert.equal(publishConfirmationSatisfied("production", "PUBLISH 80", 80), true);
  for (const typed of ["", "PUBLISH", "publish 82", "PUBLISH 80", "PUBLISH 83", "PUBLISH 82 ", " PUBLISH 82", "PUBLISH  82", "PRODUCTION"]) assert.equal(publishConfirmationSatisfied("production", typed, 82), false, typed);
  assert.equal(publishConfirmationSatisfied("production", "PUBLISH 0", 0), false, "nothing ready: never");
  assert.equal(publishConfirmationSatisfied("development", "", 5), true);
  assert.equal(publishConfirmationSatisfied("development", "", 0), false);
  assert.equal(publishConfirmationSatisfied(null, "PUBLISH 5", 5), false);
});

test("13. unknown environment and wrong DEV/PROD pairing publish nothing", async () => {
  for (const [url, mode] of [[PROD_URL, "development"], [DEV_URL, "production"], ["https://abcdefghijklmnopqrst.supabase.co", "development"], [undefined, "development"], [DEV_URL, undefined]]) {
    const products = [product("p1", "Samsung A07")];
    const db = fakeDb(readyData(products));
    const preview = await previewOf(products, db);
    const run = await runBulkPublish(preview, { ...db.deps, supabaseUrl: url, buildMode: mode });
    assert.equal(run.outcome, "blocked", `${url} ${mode}`);
    assert.deepEqual(db.state.writes, []);
    assert.equal(db.state.rows.get("p1").status, "draft");
  }
});

test("16-20. publishing changes only the publication state: prices, stock, SKUs, media, variants and product fields stay identical", async () => {
  const products = readyProducts(5);
  const data = readyData(products);
  const db = fakeDb(data);
  const before = JSON.stringify(db.state.variants);
  const fieldsBefore = JSON.stringify([...db.state.rows.values()].map((r) => r.fields));
  const run = await runBulkPublish(await previewOf(products, db), db.deps);
  assert.equal(run.outcome, "verified");
  assert.equal(JSON.stringify(db.state.variants), before, "variants (prices, SKUs, PTA, condition, RAM/storage/colour) untouched");
  assert.equal(JSON.stringify([...db.state.rows.values()].map((r) => r.fields)), fieldsBefore);
  assert.deepEqual(new Set(db.state.writes.map((w) => Object.keys(w.values).join())), new Set(["publication_status"]));
  const snap = { variants: variantsFor("x"), mediaCount: 3, stockRows: 2, stockSum: 9 };
  const state = { publicationStatus: "published", publishedAt: "t", fields: { title: "T" } };
  assert.equal(verifyPublish({ ...state, publicationStatus: "draft", publishedAt: null }, state, snap, { ...snap, mediaCount: 2 }).find((c) => c.name === "Media count unchanged").ok, false);
  assert.equal(verifyPublish({ ...state, publicationStatus: "draft", publishedAt: null }, state, snap, { ...snap, stockSum: 10 }).find((c) => c.name === "Stock ledger unchanged").ok, false);
});

test("21. the commercial-defaults workflow never publishes by itself", async () => {
  const products = readyProducts(3).map((p) => ({ ...p, defaultPta: "unknown", defaultCondition: "unknown" }));
  const data = readyData(products);
  data.variants = data.variants.map((v) => ({ ...v, pta_status: "unknown", condition: "unknown" }));
  const db = fakeDb(data);
  const writes = [];
  const run = await runCommercialDefaults(planCommercialDefaults(products, db.state.variants, ANDROID_BATCH_DESIRED, { overwriteExplicit: false }), {
    supabaseUrl: DEV_URL,
    buildMode: "development",
    readSnapshot: db.deps.readSnapshot,
    readProduct: async (id) => ({ defaultPta: "unknown", defaultCondition: "unknown" }),
    updateVariants: async (id, ids, values) => { writes.push(["variants", values]); for (const v of db.state.variants) if (ids.includes(v.id)) Object.assign(v, values); },
    updateProductDefaults: async (id, values) => { writes.push(["defaults", values]); },
  });
  assert.ok(writes.length > 0);
  assert.ok(writes.every(([, values]) => !("publication_status" in values)));
  assert.ok([...db.state.rows.values()].every((r) => r.status === "draft"));
  assert.ok(run.summary.variantsUpdated >= 0);
  const commercial = await readFile("src/lib/commercialDefaultsDb.ts", "utf8");
  assert.doesNotMatch(commercial, /publication_status/);
});

test("25. Samsung A07 is publishable after the commercial defaults, and not before", async () => {
  const a07 = product("a07", "Samsung A07", { defaultPta: "unknown", defaultCondition: "unknown" });
  const data = readyData([a07]);
  data.variants = data.variants.map((v) => ({ ...v, pta_status: "unknown", condition: "unknown" }));
  const db = fakeDb(data);
  const before = await previewOf([a07], db);
  assert.equal(before.totals.ready, 0);
  assert.deepEqual(before.entries[0].blockers, ["variant_commercial_facts_unresolved"]);
  for (const v of db.state.variants) Object.assign(v, { pta_status: "approved", condition: "brand_new" });
  const after = await previewOf([{ ...a07, defaultPta: "approved", defaultCondition: "brand_new" }], db);
  assert.equal(after.totals.ready, 1);
  const run = await runBulkPublish(after, db.deps);
  assert.equal(run.outcome, "verified");
});

test("preview needs a validator answer: a missing one is blocked, never ready", () => {
  const selection = selectAndroidBatch([product("p1", "Samsung A07")]);
  const preview = buildPublishPreview(selection, new Map());
  assert.equal(preview.totals.ready, 0);
  assert.deepEqual(preview.entries[0].blockers, ["validation_unavailable"]);
});

test("22-23. progress is reported per product and the page is guarded while publishing", async () => {
  const products = [product("p1", "Samsung A07"), product("p2", "Honor X6c")];
  const db = fakeDb(readyData(products));
  const snapshots = [];
  const run = await runBulkPublish(await previewOf(products, db), { ...db.deps, onProgress: (p) => snapshots.push(p) });
  const last = snapshots.at(-1);
  assert.deepEqual([last.done, last.total, last.current], [2, 2, null]);
  assert.deepEqual(Object.values(last.statuses), ["verified", "verified"]);
  assert.ok(snapshots.some((p) => p.current === "Samsung A07" && p.statuses.p2 === "verified" && p.statuses.p1 === "pending"));
  assert.ok(snapshots.some((p) => Object.values(p.statuses).includes("publishing")));
  assert.ok(snapshots.some((p) => Object.values(p.statuses).includes("validating")));
  assert.equal(run.summary.targeted, 2);
  // the unload guard is installed only while `running`
  const panel = await readFile("src/admin/AndroidBulkPublish.tsx", "utf8");
  assert.match(panel, /useEffect\(\(\) => \{\s*if \(!running\) return undefined;\s*return installUnloadGuard\(window\);\s*\}, \[running\]\);/);
  const listeners = new Set();
  const win = { addEventListener: (_t, l) => listeners.add(l), removeEventListener: (_t, l) => listeners.delete(l) };
  assert.equal(listeners.size, 0);
  const remove = installUnloadGuard(win);
  assert.equal(listeners.size, 1);
  remove();
  assert.equal(listeners.size, 0);
});

test("the UI: preview first (publish disabled before it), one environment, exact-phrase dialog, no other write path", async () => {
  const panel = await readFile("src/admin/AndroidBulkPublish.tsx", "utf8");
  assert.match(panel, /"Preview publication"/);
  assert.match(panel, />\s*Publish ready products\s*</);
  assert.match(panel, /const canPublish = Boolean\(target\.allowed && totals && totals\.ready > 0 && !running && !busy\);/);
  assert.match(panel, /This will publish products to the live storefront\./);
  assert.match(panel, /publishConfirmationSatisfied\(target\.environment, typed, totals\.ready\)/);
  assert.match(panel, /Product \{Math\.min\(progress\.done \+ 1, progress\.total\)\} of \{progress\.total\}: \{progress\.current/);
  assert.doesNotMatch(panel, /\.update\(|\.insert\(|\.delete\(|\.upsert\(|\.rpc\(|\.from\(/, "the component itself has no direct database access");
  const app = await readFile("src/admin/AdminApp.tsx", "utf8");
  assert.match(app, /<AndroidCommercialDefaults \/>\s*<AndroidBulkPublish \/>/);
});
