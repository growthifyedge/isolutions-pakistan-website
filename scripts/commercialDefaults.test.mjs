import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { ANDROID_IMPORT_BATCH_TITLES } from "../src/lib/androidImportBatch.ts";
import {
  ANDROID_BATCH_DESIRED,
  CANONICAL_CONDITION,
  CANONICAL_PTA,
  commercialWriteTarget,
  planCommercialDefaults,
  runCommercialDefaults,
  selectAndroidBatch,
  verifyCommercialUpdate,
} from "../src/lib/commercialDefaults.ts";
import { SUPABASE_ENVIRONMENTS } from "../src/lib/supabaseEnvironment.ts";
import { PROD_TITLES } from "./support/prodCatalogTitles.mjs";

const DEV_URL = `https://${SUPABASE_ENVIRONMENTS.development.supabaseProjectRef}.supabase.co`;
const PROD_URL = `https://${SUPABASE_ENVIRONMENTS.production.supabaseProjectRef}.supabase.co`;

const product = (id, title, extra = {}) => ({ id, title, slug: id, brandName: title.split(" ")[0], dataClass: "real", publicationStatus: "draft", defaultPta: "unknown", defaultCondition: "unknown", ...extra });
let skuCounter = 0;
const variant = (productId, n, extra = {}) => ({
  id: `${productId}-v${n}`,
  product_id: productId,
  sku: `MB${String(++skuCounter).padStart(3, "0")}`,
  ram_display: `${4 + n} GB`,
  storage_display: `${64 * (n + 1)} GB`,
  color_finish: ["Black", "Blue", "Silver", "Green", "Gold", "Red", "White"][n % 7],
  carrier_jv: null,
  price_minor: 5_000_000 + n * 100_000,
  compare_at_price_minor: 5_500_000 + n * 100_000,
  pta_status: "unknown",
  condition: "unknown",
  condition_grade: null,
  battery_health_percent: null,
  battery_cycle_count: null,
  sim_configuration: null,
  warranty_override: null,
  delivery_scope: "karachi_only",
  is_active: true,
  sort_order: n,
  ...extra,
});
const sevenVariants = (productId) => Array.from({ length: 7 }, (_, n) => variant(productId, n));

/** In-memory database implementing the injected adapters; counts every write. */
function fakeDb({ products, variants, media = {}, stock = {}, dropUpdateFor = null, throwOnUpdateFor = null }) {
  const state = { products: new Map(products.map((p) => [p.id, { ...p }])), variants: variants.map((v) => ({ ...v })), writes: [] };
  const deps = {
    supabaseUrl: DEV_URL,
    buildMode: "development",
    readSnapshot: async (productId) => {
      const own = state.variants.filter((v) => v.product_id === productId).map((v) => ({ ...v }));
      const rows = own.flatMap((v) => stock[v.id] ?? []);
      return { variants: own, mediaCount: media[productId] ?? 0, stockRows: rows.length, stockSum: rows.reduce((a, b) => a + b, 0) };
    },
    readProduct: async (productId) => ({ defaultPta: state.products.get(productId).defaultPta, defaultCondition: state.products.get(productId).defaultCondition }),
    updateVariants: async (productId, ids, values) => {
      state.writes.push({ table: "product_variants", productId, ids, values });
      if (throwOnUpdateFor === productId) throw new Error("row-level security violated");
      for (const v of state.variants) if (v.product_id === productId && ids.includes(v.id) && v.id !== dropUpdateFor) Object.assign(v, values);
    },
    updateProductDefaults: async (productId, values) => {
      state.writes.push({ table: "products", productId, values });
      state.products.get(productId).defaultPta = values.default_pta_status;
      state.products.get(productId).defaultCondition = values.default_condition;
    },
  };
  return { state, deps };
}

const planFor = (productList, variantList, options = { overwriteExplicit: false }) => planCommercialDefaults(productList, variantList, ANDROID_BATCH_DESIRED, options);

test("canonical values are the existing enums: pta_status approved, condition brand_new", () => {
  assert.equal(CANONICAL_PTA, "approved");
  assert.equal(CANONICAL_CONDITION, "brand_new");
  assert.deepEqual(ANDROID_BATCH_DESIRED, { pta: "approved", condition: "brand_new" });
});

test("1-2, 5-7. one product with 7 variants: PTA Approved and Brand New on all 7; prices, SKUs, RAM/storage/colour, stock, media untouched", async () => {
  const p = product("a07", "Samsung A07");
  const before = sevenVariants("a07");
  const { state, deps } = fakeDb({ products: [p], variants: before, media: { a07: 4 }, stock: Object.fromEntries(before.map((v, i) => [v.id, [10 + i]])) });
  const plan = planFor([p], before);
  assert.deepEqual([plan.totals.variants, plan.totals.unknownPta, plan.totals.unknownCondition, plan.totals.variantsToChange], [7, 7, 7, 7]);
  const result = await runCommercialDefaults(plan, deps);
  assert.equal(result.outcome, "verified");
  assert.deepEqual(result.summary, { productsUpdated: 1, variantsUpdated: 7, alreadyCorrect: 0, skipped: 0, failed: 0 });
  assert.equal(state.variants.length, 7);
  for (const [i, v] of state.variants.entries()) {
    assert.equal(v.pta_status, "approved");
    assert.equal(v.condition, "brand_new");
    for (const field of ["sku", "price_minor", "compare_at_price_minor", "ram_display", "storage_display", "color_finish", "carrier_jv", "delivery_scope", "is_active", "sort_order", "warranty_override", "sim_configuration"])
      assert.equal(v[field], before[i][field], field);
  }
  assert.deepEqual(state.products.get("a07"), { ...p, defaultPta: "approved", defaultCondition: "brand_new" }, "product-level defaults mirror the variants; nothing else on the product");
  assert.ok(result.products[0].checks.every((c) => c.ok));
  // Only two kinds of writes, with only the commercial fields.
  assert.deepEqual(new Set(state.writes.map((w) => `${w.table}:${Object.keys(w.values).sort().join(",")}`)), new Set(["product_variants:condition,pta_status", "products:default_condition,default_pta_status"]));
});

test("8. already-correct variants are not written; mixed Unknown/already rows only change the Unknown ones", async () => {
  const p = product("p1", "Honor X6c", { defaultPta: "approved", defaultCondition: "brand_new" });
  const variants = [variant("p1", 0, { pta_status: "approved", condition: "brand_new" }), variant("p1", 1), variant("p1", 2, { pta_status: "approved" })];
  const { state, deps } = fakeDb({ products: [p], variants });
  const plan = planFor([p], variants);
  assert.deepEqual(plan.products[0].changeIds, ["p1-v1", "p1-v2"]);
  assert.equal(plan.totals.variantsAlreadyCorrect, 1);
  await runCommercialDefaults(plan, deps);
  assert.deepEqual(state.writes.map((w) => w.ids), [["p1-v1", "p1-v2"]], "the already-correct variant is never in a write");
  const done = planFor([p], state.variants);
  assert.equal(done.products[0].status, "already_correct");
  const second = fakeDb({ products: [p], variants: state.variants });
  const rerun = await runCommercialDefaults(done, second.deps);
  assert.deepEqual([rerun.summary.alreadyCorrect, rerun.summary.productsUpdated, second.state.writes.length], [1, 0, 0], "re-running writes nothing");
});

test("9-10. unknown environment and wrong DEV/PROD pairing are blocked with zero writes", async () => {
  assert.equal(commercialWriteTarget(DEV_URL, "development").allowed, true);
  assert.equal(commercialWriteTarget(PROD_URL, "production").allowed, true);
  for (const [url, mode] of [[PROD_URL, "development"], [DEV_URL, "production"], ["https://abcdefghijklmnopqrst.supabase.co", "development"], [undefined, "development"], [`https://${SUPABASE_ENVIRONMENTS.development.supabaseProjectRef}.supabase.co.evil.test`, "development"], [DEV_URL, undefined]]) {
    assert.equal(commercialWriteTarget(url, mode).allowed, false, `${url} ${mode}`);
    const p = product("p1", "Honor X6c");
    const v = [variant("p1", 0)];
    const { state, deps } = fakeDb({ products: [p], variants: v });
    const result = await runCommercialDefaults(planFor([p], v), { ...deps, supabaseUrl: url, buildMode: mode });
    assert.equal(result.outcome, "blocked");
    assert.deepEqual(state.writes, []);
  }
});

test("11. the preview/plan makes zero writes and reads nothing but what it is given", () => {
  const p = product("p1", "Honor X6c");
  const frozen = Object.freeze(sevenVariants("p1").map((v) => Object.freeze(v)));
  const plan = planFor([p], frozen);
  assert.equal(plan.totals.variantsToChange, 7);
  assert.equal(frozen.every((v) => v.pta_status === "unknown"), true);
});

test("12-14. the batch targets only the exact imported Android title set; iPhones and unrelated products are never touched", async () => {
  assert.deepEqual([...ANDROID_IMPORT_BATCH_TITLES], PROD_TITLES, "the in-app batch list equals the image-workflow PROD fixture");
  assert.equal(ANDROID_IMPORT_BATCH_TITLES.length, 82);
  const products = [
    product("a", "Samsung A07"),
    product("b", "  honor   x6c "),
    product("ip", "iPhone 15", { brandName: "Apple" }),
    product("acc", "Anker 20W Charger", { brandName: "Anker" }),
    product("old", "Samsung Galaxy S21 Ultra Test", { brandName: "Samsung" }),
    product("apple-same", "Samsung A17", { brandName: "Apple" }),
    product("draftish", "Infinix Hot 70", { dataClass: "demo" }),
    product("dup1", "Nothing Phone 1"),
    product("dup2", "Nothing Phone 1"),
  ];
  const selection = selectAndroidBatch(products);
  assert.deepEqual(selection.targets.map((t) => t.id).sort(), ["a", "b"]);
  assert.deepEqual(selection.skipped.map((s) => s.product.id).sort(), ["apple-same", "draftish", "dup1", "dup2"]);
  assert.ok(selection.missingTitles.length > 70);
  const variants = products.flatMap((p) => sevenVariants(p.id).slice(0, 2));
  const { state, deps } = fakeDb({ products, variants });
  const plan = planFor(selection.targets, variants.filter((v) => selection.targets.some((t) => t.id === v.product_id)));
  await runCommercialDefaults(plan, deps);
  const untouched = state.variants.filter((v) => !["a", "b"].includes(v.product_id));
  assert.ok(untouched.length > 0 && untouched.every((v) => v.pta_status === "unknown" && v.condition === "unknown"));
  assert.ok(state.writes.every((w) => (w.table === "products" ? ["a", "b"].includes(w.productId) : ["a", "b"].includes(w.productId))));
  for (const id of ["ip", "acc", "old", "apple-same", "draftish", "dup1", "dup2"]) assert.equal(state.products.get(id).defaultPta, "unknown");
});

test("batch mode never overwrites a different explicit value or an impossible change; the per-product action may", () => {
  const p = product("p1", "Honor X6c");
  const explicit = [variant("p1", 0), variant("p1", 1, { condition: "used" })];
  const batch = planFor([p], explicit);
  assert.equal(batch.products[0].status, "skipped");
  assert.match(batch.products[0].reason, /different explicit/);
  assert.equal(planFor([p], explicit, { overwriteExplicit: true }).products[0].status, "change");
  const graded = [variant("p1", 0, { condition: "used", condition_grade: "A++" })];
  assert.match(planFor([p], graded, { overwriteExplicit: true }).products[0].reason, /grade facts/);
  const collide = [variant("p1", 0, { ram_display: "8 GB", storage_display: "128 GB", color_finish: "Black", pta_status: "approved" }), variant("p1", 1, { ram_display: "8 GB", storage_display: "128 GB", color_finish: "Black", pta_status: "not_approved" })];
  assert.match(planFor([p], collide, { overwriteExplicit: true }).products[0].reason, /identical variants/);
  assert.equal(planFor([p], []).products[0].status, "skipped");
});

test("15. post-write verification catches an incomplete update and never reports success", async () => {
  const p = product("p1", "Honor X6c");
  const v = sevenVariants("p1");
  const { deps } = fakeDb({ products: [p], variants: v, dropUpdateFor: "p1-v3" });
  const result = await runCommercialDefaults(planFor([p], v), deps);
  assert.equal(result.outcome, "issues");
  assert.equal(result.products[0].status, "failed");
  assert.match(result.products[0].message, /read-back verification FAILED/);
  assert.equal(result.products[0].checks.find((c) => c.name === "PTA and Condition set on targets").ok, false);
  assert.equal(result.summary.variantsUpdated, 0);
  // Direct verification of side effects.
  const snap = (variants, extra = {}) => ({ variants, mediaCount: 2, stockRows: 1, stockSum: 5, ...extra });
  const ok = [{ ...v[0], pta_status: "approved", condition: "brand_new" }];
  const base = snap([v[0]]);
  assert.ok(verifyCommercialUpdate(base, snap(ok), ANDROID_BATCH_DESIRED, [v[0].id]).every((c) => c.ok));
  assert.equal(verifyCommercialUpdate(base, snap([{ ...ok[0], price_minor: 1 }]), ANDROID_BATCH_DESIRED, [v[0].id]).find((c) => c.name.startsWith("Prices")).ok, false);
  assert.equal(verifyCommercialUpdate(base, snap([{ ...ok[0], sku: "X" }]), ANDROID_BATCH_DESIRED, [v[0].id]).find((c) => c.name.startsWith("Prices")).ok, false);
  assert.equal(verifyCommercialUpdate(base, snap(ok, { mediaCount: 1 }), ANDROID_BATCH_DESIRED, [v[0].id]).find((c) => c.name === "Media count unchanged").ok, false);
  assert.equal(verifyCommercialUpdate(base, snap(ok, { stockSum: 6 }), ANDROID_BATCH_DESIRED, [v[0].id]).find((c) => c.name === "Stock ledger unchanged").ok, false);
  assert.equal(verifyCommercialUpdate(base, snap([]), ANDROID_BATCH_DESIRED, [v[0].id]).find((c) => c.name === "Variant count unchanged").ok, false);
});

test("one product failing, or changing since the preview, never stops or corrupts the others", async () => {
  const products = [product("p1", "Honor X6c"), product("p2", "Honor X8D"), product("p3", "Honor X9D")];
  const variants = products.flatMap((p) => sevenVariants(p.id).slice(0, 2));
  const { state, deps } = fakeDb({ products, variants, throwOnUpdateFor: "p1" });
  const plan = planFor(products, variants);
  // p2 changes between preview and write
  state.variants.find((v) => v.id === "p2-v0").pta_status = "not_approved";
  const result = await runCommercialDefaults(plan, deps);
  const byId = Object.fromEntries(result.products.map((r) => [r.productId, r]));
  assert.equal(byId.p1.status, "failed");
  assert.match(byId.p1.message, /Update failed: row-level security violated/);
  assert.equal(byId.p2.status, "failed");
  assert.match(byId.p2.message, /changed since preview/);
  assert.equal(byId.p3.status, "updated");
  assert.equal(result.outcome, "issues");
  assert.ok(!state.writes.some((w) => w.productId === "p2"), "a changed product is not written");
});

/** Mirrors the SQL rule in validate_product_for_publication for the commercial-facts blocker. */
const publicationErrors = (variants) => (variants.some((v) => v.is_active && (v.pta_status === "unknown" || v.condition === "unknown")) ? ["variant_commercial_facts_unresolved"] : []);

test("16. the Samsung A07 variant_commercial_facts_unresolved blocker clears after the update", async () => {
  const p = product("a07", "Samsung A07");
  const v = sevenVariants("a07");
  const { state, deps } = fakeDb({ products: [p], variants: v });
  assert.deepEqual(publicationErrors(state.variants), ["variant_commercial_facts_unresolved"]);
  await runCommercialDefaults(planFor([p], v), deps);
  assert.deepEqual(publicationErrors(state.variants), []);
});

test("17. no publish, price, stock, SKU, media or title write exists in the code paths", async () => {
  const lib = await readFile("src/lib/commercialDefaults.ts", "utf8");
  const db = await readFile("src/lib/commercialDefaultsDb.ts", "utf8");
  const batchUi = await readFile("src/admin/AndroidCommercialDefaults.tsx", "utf8");
  const editor = await readFile("src/admin/AdminCatalog.tsx", "utf8");
  assert.doesNotMatch(lib, /\.from\(|\.update\(|\.insert\(|\.delete\(|\.rpc\(|publication_status:|published_at|supabase\./, "the planning/run library has no database access of its own");
  // Every write in the adapter is one of the two sanctioned updates.
  assert.equal((db.match(/\.update\(/g) ?? []).length, 2);
  assert.doesNotMatch(db, /\.insert\(|\.delete\(|\.upsert\(|\.rpc\(|publication_status|published_at|price_minor:|sku:|title:/);
  assert.match(db, /\.update\(values\)\.eq\("product_id", productId\)\.in\("id", variantIds\)/);
  // Batch UI: no direct writes, only selects + the read-only validation RPC.
  assert.doesNotMatch(batchUi, /\.update\(|\.insert\(|\.delete\(|\.upsert\(|published_at/);
  assert.equal((batchUi.match(/\.rpc\(/g) ?? []).length, 1);
  assert.match(batchUi, /\.rpc\("validate_product_for_publication"/);
  assert.match(batchUi, /Apply Android commercial defaults/);
  assert.match(batchUi, /Preview \(read-only\)/);
  assert.match(batchUi, /confirmationSatisfied\(target\.environment, typed\)/);
  // Product editor action.
  assert.match(editor, />\s*Apply commercial defaults to all variants\s*</);
  assert.match(editor, /Apply to \{variants\.length\} variant/);
});
