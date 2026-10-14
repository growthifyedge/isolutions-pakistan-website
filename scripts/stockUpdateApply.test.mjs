import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildStockDelta, parseStockList } from "../src/lib/stockListDelta.ts";
import { WRITE_KINDS, buildWritePlan, confirmationPhrase, inheritedFacts, runStockUpdate, updateWebsiteBlocker, verifyProduct } from "../src/lib/stockUpdateApply.ts";

const PROD_URL = "https://nlxfwppywxumymbjkvwt.supabase.co";
const DEV_URL = (() => {
  const source = readFileSync(new URL("../src/lib/supabaseEnvironment.ts", import.meta.url), "utf8");
  const ref = source.match(/development[\s\S]*?supabaseProjectRef:\s*"([a-z0-9]+)"/)?.[1];
  return `https://${ref}.supabase.co`;
})();
const brands = ["Samsung", "Xiaomi", "Motorola", "Honor", "Nokia", "Apple", "ZTE"].map((name) => ({ name }));

// ---------------------------------------------------------------------------
// A small in-memory "database" with the same shape as the real rows.
// ---------------------------------------------------------------------------

let skuCounter = 100;
function makeDb() {
  const products = {};
  const variants = {};
  const media = [];
  const specs = [];
  const movements = [];
  const addProduct = (id, title, brand, rows, extra = {}) => {
    products[id] = { id, title, slug: title.toLowerCase().replace(/\+/g, " plus ").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""), brand, category: extra.category ?? "Mobile Phones", publication_status: extra.publication_status ?? "published", published_at: "2026-10-05T00:00:00Z", updated_at: "2026-10-05T00:00:00Z", default_warranty: null };
    media.push({ id: `m-${id}`, product_id: id, is_primary: true, secure_url: `https://img/${id}.jpg` });
    specs.push({ id: `s-${id}-1`, product_id: id, specification_group: "Display", label: "Size", value: "6.7" }, { id: `s-${id}-2`, product_id: id, specification_group: "Battery", label: "Capacity", value: "5000" });
    rows.forEach(([ram, storage, color, price, active = true, more = {}], index) => {
      const vid = `${id}-v${index}`;
      variants[vid] = { id: vid, product_id: id, sku: `MB${String(++skuCounter).padStart(3, "0")}`, ram_display: ram, storage_display: storage, color_finish: color, price_minor: price * 100, compare_at_price_minor: null, pta_status: "approved", condition: "brand_new", condition_grade: null, battery_health_percent: null, battery_cycle_count: null, sim_configuration: null, warranty_override: "1 Year", delivery_scope: "karachi_only", is_active: active, updated_at: "2026-10-05T00:00:00Z", ...more };
      movements.push({ variant_id: vid, quantity_delta: 10 });
    });
  };
  addProduct("pa07", "Samsung A07", "Samsung", [["4 GB", "64 GB", "Black", 36900], ["4 GB", "64 GB", "Green", 36900], ["4 GB", "128 GB", "Black", 43500, false]]);
  addProduct("pa7p", "Xiaomi A7 Pro", "Xiaomi", [["6 GB", "128 GB", "Black", 36500], ["6 GB", "128 GB", "Blue", 36500]]);
  addProduct("px5c", "Honor X5c+", "Honor", [["4 GB", "128 GB", "Black", 30000]]);
  addProduct("pip", "Apple iPhone 15", "Apple", [["6 GB", "128 GB", "Black", 250000]]);
  addProduct("pnk", "Nokia 105", "Nokia", [[null, null, "Black", 7000]]);

  const stockOf = (vid) => movements.filter((m) => m.variant_id === vid).reduce((sum, m) => sum + m.quantity_delta, 0);
  const catalog = () =>
    Object.values(products).map((p) => ({
      id: p.id, slug: p.slug, title: p.title, brand: p.brand, category: p.category, categorySlug: p.category === "Mobile Phones" ? "mobile-phones" : "tablets", publicationStatus: p.publication_status,
      mediaCount: media.filter((m) => m.product_id === p.id).length, specCount: specs.filter((s) => s.product_id === p.id).length,
      variants: Object.values(variants).filter((v) => v.product_id === p.id).map((v) => ({ id: v.id, sku: v.sku, ram: v.ram_display, storage: v.storage_display, color: v.color_finish, priceMinor: v.price_minor, compareAtPriceMinor: v.compare_at_price_minor, stock: stockOf(v.id), ptaStatus: v.pta_status, condition: v.condition, conditionGrade: v.condition_grade, batteryHealth: v.battery_health_percent, cycleCount: v.battery_cycle_count, isActive: v.is_active, warrantyOverride: v.warranty_override, deliveryScope: v.delivery_scope })),
    }));
  const snapshot = (productId) => {
    const rows = Object.values(variants).filter((v) => v.product_id === productId);
    return { productId, product: structuredClone(products[productId]), media: structuredClone(media.filter((m) => m.product_id === productId)), specifications: structuredClone(specs.filter((s) => s.product_id === productId)), variants: Object.fromEntries(rows.map((v) => [v.id, structuredClone(v)])), stock: Object.fromEntries(rows.map((v) => [v.id, stockOf(v.id)])) };
  };
  const writes = [];
  const touch = (v) => (v.updated_at = "2026-10-15T00:00:00Z");
  const deps = (overrides = {}) => ({
    supabaseUrl: PROD_URL,
    buildMode: "production",
    readCatalog: async () => catalog(),
    readSnapshot: async (id) => snapshot(id),
    updatePrice: async (id, price) => { writes.push(["price", id, price]); variants[id].price_minor = price; touch(variants[id]); },
    setActive: async (ids, productId, active) => { writes.push(["active", ids, active]); for (const id of ids) { assert.equal(variants[id].product_id, productId); variants[id].is_active = active; touch(variants[id]); } },
    insertVariant: async (productId, values) => {
      writes.push(["insertVariant", productId]);
      const id = `${productId}-new${Object.keys(variants).length}`;
      const sku = `MB${String(++skuCounter).padStart(3, "0")}`;
      variants[id] = { id, product_id: productId, sku, ram_display: values.ram, storage_display: values.storage, color_finish: values.color, price_minor: values.priceMinor, compare_at_price_minor: null, pta_status: values.inherited.ptaStatus, condition: values.inherited.condition, condition_grade: null, battery_health_percent: null, battery_cycle_count: null, sim_configuration: null, warranty_override: values.inherited.warrantyOverride, delivery_scope: values.inherited.deliveryScope, is_active: true, updated_at: "2026-10-15T00:00:00Z" };
      return { id, sku };
    },
    insertOpeningStock: async (variantId, quantity) => { writes.push(["stock", variantId, quantity]); movements.push({ variant_id: variantId, quantity_delta: quantity }); },
    readStock: async (variantId) => stockOf(variantId),
    adjustStock: async (variantId, delta) => { writes.push(["adjust", variantId, delta]); movements.push({ variant_id: variantId, quantity_delta: delta, reason: "correction" }); },
    createPhones: async (payload) => {
      writes.push(["rpc", payload]);
      const out = { products: [], assigned_skus: [] };
      for (const p of payload) {
        assert.equal(p.action, "Create");
        const id = `new-${p.title}`;
        products[id] = { id, title: p.title, slug: p.title.toLowerCase(), brand: p.brand, category: "Mobile Phones", publication_status: "draft", published_at: null, updated_at: "x" };
        for (const v of p.variants) {
          const vid = `${id}-${v.color}`;
          const sku = `MB${String(++skuCounter).padStart(3, "0")}`;
          variants[vid] = { id: vid, product_id: id, sku, ram_display: v.ram, storage_display: v.storage, color_finish: v.color, price_minor: v.price_minor, pta_status: v.pta_status, condition: v.condition, is_active: true };
          movements.push({ variant_id: vid, quantity_delta: v.stock });
          out.assigned_skus.push({ product: p.title, sku });
        }
        out.products.push({ id, title: p.title, action: "Create" });
      }
      return out;
    },
    readCreatedPhone: async (id) => { const rows = Object.values(variants).filter((v) => v.product_id === id); return { publicationStatus: products[id].publication_status, variantCount: rows.length, skus: rows.map((v) => v.sku) }; },
    ...overrides,
  });
  return { products, variants, media, specs, movements, catalog, snapshot, deps, writes, stockOf };
}

const LIST = [
  "Samsung", "A07 4/64 black @ 37500", "A07 4/128 black @ 43500", "A07 6/128 black @ 50200", "A97 8/256 black/blue @ 120000", "",
  "Xiaomi", "A7pro 6/128 black/blue @ 36500", "",
  "Apple", "iPhone 15 6/128 black @ 240000", "",
  "Nokia", "105 @ 6500",
].join("\n");

function planFor(db, text = LIST) {
  const catalog = db.catalog();
  const delta = buildStockDelta(parseStockList(text, brands), catalog);
  return { delta, plan: buildWritePlan(delta, catalog), replan: (fresh) => buildWritePlan(buildStockDelta(parseStockList(text, brands), fresh), fresh) };
}

// ---------------------------------------------------------------------------
// Exact plan per result group
// ---------------------------------------------------------------------------

test("each result group maps to its own write; every listed visible variant gets stock 30; Not Android Phones produce none", () => {
  const db = makeDb();
  const { plan } = planFor(db);
  const kinds = plan.steps.map((s) => `${s.kind}:${s.productTitle}:${s.label ?? s.payload?.variants.length}`);
  assert.deepEqual(kinds.sort(), [
    "add_variant:Samsung A07:6 GB / 128 GB / Black",
    "create_phone:Samsung A97:2",
    "hide:Honor X5c+:1 variant(s)",
    "hide:Samsung A07:4 GB / 64 GB / Green",
    "price:Samsung A07:4 GB / 64 GB / Black",
    "set_stock:Samsung A07:4 GB / 128 GB / Black",
    "set_stock:Samsung A07:4 GB / 64 GB / Black",
    "set_stock:Xiaomi A7 Pro:6 GB / 128 GB / Black",
    "set_stock:Xiaomi A7 Pro:6 GB / 128 GB / Blue",
    "show:Samsung A07:4 GB / 128 GB / Black",
  ].sort());
  assert.deepEqual(plan.counts, { priceUpdates: 1, stockUpdates: 4, newVariants: 1, newPhones: 1, newPhoneVariants: 2, hideSteps: 2, hiddenVariants: 2, showSteps: 1, shownVariants: 1, same: 2, notAndroid: 2, blocked: 0 });
  // Hidden variants never get a stock step.
  const hidden = new Set(plan.steps.filter((s) => s.kind === "hide").flatMap((s) => s.variantIds));
  assert.ok(plan.steps.filter((s) => s.kind === "set_stock").every((s) => !hidden.has(s.variantId) && s.toStock === 30));
  // iPhone and Nokia (list AND website) are never in any step.
  assert.ok(plan.steps.every((s) => !["pip", "pnk"].includes(s.productId)));
  assert.ok(plan.steps.every((s) => WRITE_KINDS.includes(s.kind)));
});

test("Price Changed writes price only, on the same variant row", () => {
  const db = makeDb();
  const { plan } = planFor(db);
  const price = plan.steps.find((s) => s.kind === "price");
  assert.equal(price.variantId, "pa07-v0");
  assert.equal(price.sku, db.variants["pa07-v0"].sku);
  assert.equal(price.toMinor, 3750000);
});

test("New Variants inherit PTA / condition / warranty / delivery from the phone's own variants; SIM is never guessed", () => {
  const db = makeDb();
  const { plan } = planFor(db);
  const add = plan.steps.find((s) => s.kind === "add_variant");
  assert.equal(add.productId, "pa07");
  assert.deepEqual(add.inherited, { ptaStatus: "approved", condition: "brand_new", warrantyOverride: "1 Year", deliveryScope: "karachi_only" });
  assert.equal(add.stock, 30);
  assert.equal("sim" in add.inherited, false);
});

test("New Variants are blocked (not guessed) when the phone's variants disagree on PTA or condition", () => {
  const db = makeDb();
  db.variants["pa07-v1"].pta_status = "not_approved";
  assert.match(inheritedFacts(db.catalog().find((p) => p.id === "pa07")), /different PTA or condition/);
  const { plan } = planFor(db);
  assert.ok(plan.blocked.some((b) => /different PTA or condition/.test(b.reason)));
  assert.ok(plan.steps.every((s) => s.kind !== "add_variant"));
});

test("New Phones use the import RPC with action Create only: draft, Mobile Phones, Android defaults, stock 30", () => {
  const db = makeDb();
  const { plan } = planFor(db);
  const phone = plan.steps.find((s) => s.kind === "create_phone");
  assert.deepEqual({ ...phone.payload, variants: undefined }, { source: "Android Stock Update: Samsung A97", action: "Create", product_type: "Mobile Phone", brand: "Samsung", category: "Mobile Phones", title: "Samsung A97", variants: undefined });
  for (const v of phone.payload.variants) {
    assert.deepEqual([v.pta_status, v.condition, v.warranty, v.delivery_scope, v.stock], ["approved", "brand_new", "1 Year", "karachi_only", 30]);
    assert.equal("sku" in v, false, "SKU always assigned by the database");
  }
});

test("Needs Attention blocks the whole Update Website", () => {
  const db = makeDb();
  const { plan } = planFor(db, `${LIST}\nSamsung\nA07 4/64 wood @ 36900`);
  assert.ok(plan.blocked.length >= 1);
  assert.match(updateWebsiteBlocker({ supabaseUrl: PROD_URL, buildMode: "production", checkIsCurrent: true, plan, confirmation: confirmationPhrase(plan) }), /need attention/);
});

// ---------------------------------------------------------------------------
// Gate
// ---------------------------------------------------------------------------

test("gate: environment pair, fresh check, no attention rows, something to do, typed confirmation", () => {
  const db = makeDb();
  const { plan } = planFor(db);
  const ok = { supabaseUrl: PROD_URL, buildMode: "production", checkIsCurrent: true, plan, confirmation: confirmationPhrase(plan) };
  assert.equal(confirmationPhrase(plan), "UPDATE 10 CHANGES");
  assert.equal(updateWebsiteBlocker(ok), null);
  assert.match(updateWebsiteBlocker({ ...ok, buildMode: "development" }), /must match/);
  assert.match(updateWebsiteBlocker({ ...ok, supabaseUrl: "https://unknown.supabase.co" }), /UNKNOWN/);
  assert.match(updateWebsiteBlocker({ ...ok, checkIsCurrent: false }), /Check List again/);
  assert.match(updateWebsiteBlocker({ ...ok, plan: null }), /Check List first/);
  assert.match(updateWebsiteBlocker({ ...ok, confirmation: "update 10 changes" }), /Type UPDATE 10 CHANGES/);
  assert.equal(updateWebsiteBlocker({ ...ok, supabaseUrl: DEV_URL, buildMode: "development" }), null, "DEV with a dev build is a matching pair too");
});

// ---------------------------------------------------------------------------
// Runner + read-back verification (offline fake database)
// ---------------------------------------------------------------------------

test("full run writes exactly the plan and verifies: images, specs, product rows, slugs, SKUs, PTA, condition, publication, stock preserved", async () => {
  const db = makeDb();
  const { plan, replan } = planFor(db);
  const productRowsBefore = structuredClone(db.products);
  const mediaBefore = structuredClone(db.media);
  const specsBefore = structuredClone(db.specs);
  const skusBefore = Object.fromEntries(Object.values(db.variants).map((v) => [v.id, v.sku]));
  const result = await runStockUpdate({ ...db.deps(), replan }, plan);
  assert.equal(result.outcome, "verified", JSON.stringify(result.checks.filter((c) => !c.ok)));
  // What happened, exactly:
  assert.equal(db.variants["pa07-v0"].price_minor, 3750000);
  assert.equal(db.variants["pa07-v1"].is_active, false);
  assert.equal(db.variants["pa07-v2"].is_active, true);
  assert.equal(db.variants["px5c-v0"].is_active, false);
  // Everything else is identical.
  for (const id of ["pa07", "pa7p", "px5c", "pip", "pnk"]) assert.deepEqual(db.products[id], productRowsBefore[id]);
  assert.deepEqual(db.media, mediaBefore);
  assert.deepEqual(db.specs, specsBefore);
  for (const [id, sku] of Object.entries(skusBefore)) assert.equal(db.variants[id].sku, sku);
  for (const v of Object.values(db.variants)) if (skusBefore[v.id]) assert.deepEqual([v.pta_status, v.condition], ["approved", "brand_new"]);
  assert.deepEqual([db.variants["pip-v0"].price_minor, db.variants["pip-v0"].is_active], [25000000, true], "iPhone untouched");
  assert.deepEqual([db.variants["pnk-v0"].price_minor, db.variants["pnk-v0"].is_active], [700000, true], "Nokia untouched");
  // New phone: draft, 2 variants. New variant: one row with opening stock.
  assert.equal(db.products["new-Samsung A97"].publication_status, "draft");
  assert.equal(result.createdPhones[0].skus.length, 2);
  const added = Object.values(db.variants).filter((v) => v.product_id === "pa07" && v.ram_display === "6 GB");
  assert.equal(added.length, 1);
  assert.equal(db.stockOf(added[0].id), 30);
  // Stock rule: every listed, visible Android variant is now 30; hidden ones and non-Android ones keep their stock.
  for (const id of ["pa07-v0", "pa07-v2", "pa7p-v0", "pa7p-v1"]) assert.equal(db.stockOf(id), 30, id);
  for (const id of ["pa07-v1", "px5c-v0", "pip-v0", "pnk-v0"]) assert.equal(db.stockOf(id), 10, id);
  for (const v of Object.values(db.variants).filter((v) => v.product_id === "new-Samsung A97")) assert.equal(db.stockOf(v.id), 30);
  // Stock is set by appending a correction row (30 - current), never by editing or deleting ledger rows.
  assert.deepEqual(db.writes.filter((w) => w[0] === "adjust").map((w) => w[2]), [20, 20, 20, 20]);
  // Write log: only the allowed kinds, never delete.
  assert.deepEqual([...new Set(db.writes.map((w) => w[0]))].sort(), ["active", "adjust", "insertVariant", "price", "rpc", "stock"]);
});

test("stock 30 is computed at write time: an order between Check List and the write is still corrected to exactly 30", async () => {
  const db = makeDb();
  const { plan } = planFor(db);
  // An order takes 2 units of A7 Pro Black after the review. The plan is unchanged (target 30), so the write proceeds.
  const deps = db.deps();
  const replan = (fresh) => buildWritePlan(buildStockDelta(parseStockList(LIST, brands), fresh), fresh);
  db.movements.push({ variant_id: "pa7p-v0", quantity_delta: -2, reason: "sale" });
  const result = await runStockUpdate({ ...deps, replan }, plan);
  assert.equal(result.outcome, "verified", JSON.stringify(result.checks.filter((c) => !c.ok)));
  assert.equal(db.stockOf("pa7p-v0"), 30);
  assert.ok(db.writes.some((w) => w[0] === "adjust" && w[1] === "pa7p-v0" && w[2] === 22));
});

test("a variant already at stock 30 gets no stock step and no ledger row", async () => {
  const db = makeDb();
  db.movements.push({ variant_id: "pa7p-v0", quantity_delta: 20 });
  const { plan, replan } = planFor(db);
  assert.equal(plan.steps.some((s) => s.kind === "set_stock" && s.variantId === "pa7p-v0"), false);
  await runStockUpdate({ ...db.deps(), replan }, plan);
  assert.equal(db.writes.some((w) => w[0] === "adjust" && w[1] === "pa7p-v0"), false);
});

test("verification fails if a stock-30 variant does not end at exactly 30", () => {
  const db = makeDb();
  const { plan } = planFor(db);
  const before = db.snapshot("pa7p");
  db.movements.push({ variant_id: "pa7p-v0", quantity_delta: 19 }); // 29, not 30
  db.movements.push({ variant_id: "pa7p-v1", quantity_delta: 20 });
  const checks = verifyProduct("pa7p", before, db.snapshot("pa7p"), plan.steps);
  assert.ok(checks.some((c) => !c.ok && /stock set to 30/.test(c.name) && /10 -> 29/.test(c.detail)));
  assert.ok(checks.some((c) => c.ok && /stock set to 30/.test(c.name) && /10 -> 30/.test(c.detail)));
});

test("refuses to write when the website changed after the check (fresh re-plan differs)", async () => {
  const db = makeDb();
  const { plan, replan } = planFor(db);
  db.variants["pa07-v0"].price_minor = 3700000; // someone edited the price after Check List
  const result = await runStockUpdate({ ...db.deps(), replan }, plan);
  assert.equal(result.outcome, "blocked");
  assert.match(result.message, /changed since you checked/);
  assert.equal(db.writes.length, 0);
});

test("refuses to write on a mismatched environment or with attention rows", async () => {
  const db = makeDb();
  const { plan, replan } = planFor(db);
  assert.equal((await runStockUpdate({ ...db.deps({ buildMode: "development" }), replan }, plan)).outcome, "blocked");
  const attention = planFor(db, `${LIST}\nSamsung\nA07 4/64 wood @ 36900`);
  assert.equal((await runStockUpdate({ ...db.deps(), replan: attention.replan }, attention.plan)).outcome, "blocked");
  assert.equal(db.writes.length, 0);
});

test("verification catches any unplanned change (e.g. a PTA rewrite or a removed spec)", () => {
  const db = makeDb();
  const { plan } = planFor(db);
  const before = db.snapshot("pa07");
  db.variants["pa07-v0"].price_minor = 3750000;
  db.variants["pa07-v0"].pta_status = "not_approved";
  db.specs.splice(db.specs.findIndex((s) => s.product_id === "pa07"), 1);
  const checks = verifyProduct("pa07", before, db.snapshot("pa07"), plan.steps.filter((s) => s.kind === "price"));
  assert.ok(checks.some((c) => !c.ok && /Specifications/.test(c.name)));
  assert.ok(checks.some((c) => !c.ok && /unexpected change: pta_status/.test(c.detail)));
});

test("a failed step is reported, the rest continue, nothing is deleted, and the run is not called verified", async () => {
  const db = makeDb();
  const { plan, replan } = planFor(db);
  const result = await runStockUpdate({ ...db.deps({ updatePrice: async () => { throw new Error("network"); } }), replan }, plan);
  assert.equal(result.outcome, "failed");
  assert.ok(result.results.some((r) => !r.ok && r.step.kind === "price"));
  assert.equal(db.variants["px5c-v0"].is_active, false, "other steps still ran");
  assert.equal(Object.keys(db.variants).length >= 9, true, "no variant removed");
});

// ---------------------------------------------------------------------------
// Source guarantees
// ---------------------------------------------------------------------------

test("source: the adapter writes only variant price / is_active, one variant insert, stock ledger rows and RPC Create — no delete, no media/spec/product writes", () => {
  const db = readFileSync(new URL("../src/lib/stockUpdateApplyDb.ts", import.meta.url), "utf8");
  assert.doesNotMatch(db, /\.delete\s*\(|\.upsert\s*\(/);
  const writes = [...db.matchAll(/from\("([a-z_]+)"\)\s*\.(insert|update)\(([^)]*)/g)].map((m) => `${m[1]}.${m[2]}`);
  assert.deepEqual(writes.sort(), ["inventory_movements.insert", "inventory_movements.insert", "product_variants.insert", "product_variants.update", "product_variants.update"]);
  assert.match(db, /reason: "correction", reference: "android_stock_update"/);
  assert.doesNotMatch(db, /from\("inventory_movements"\)\s*\.update/);
  assert.match(db, /update\(\{ price_minor: priceMinor \}\)/);
  assert.match(db, /update\(\{ is_active: isActive \}\)/);
  assert.match(db, /rpc\("apply_catalog_bulk_import_v2"/);
  assert.match(db, /Only Create is allowed/);
  assert.doesNotMatch(db, /Replace Existing/);
  assert.doesNotMatch(db, /from\("(products|product_media|product_specifications)"\)\s*\.(insert|update)/);
  const logic = readFileSync(new URL("../src/lib/stockUpdateApply.ts", import.meta.url), "utf8");
  assert.doesNotMatch(logic, /\.delete\s*\(|supabase\.|from\("/);
});

test("source: Update Website is wired ONLY through the gated runner — confirmation, typed phrase, fresh re-plan, environment guard", () => {
  const ui = readFileSync(new URL("../src/admin/StockListUpdate.tsx", import.meta.url), "utf8");
  // Exactly one call site of the runner, inside runUpdate, which re-checks the full gate (incl. the typed phrase) first.
  assert.equal(ui.match(/runStockUpdate\(/g).length, 1);
  const runUpdate = ui.slice(ui.indexOf("async function runUpdate()"), ui.indexOf("function toggle("));
  assert.match(runUpdate, /const blocker = updateWebsiteBlocker\(\{ \.\.\.gate, confirmation: confirmText \}\);\s*if \(blocker\) return/);
  assert.match(runUpdate, /runStockUpdate\(/);
  // The runner re-reads the website (readCatalog) and re-plans from the same fixed rows + brands before writing.
  assert.match(runUpdate, /readCatalog: \(\) => loadCatalogForDelta\(client\)/);
  assert.match(runUpdate, /replan: \(fresh\) => buildWritePlan\(buildStockDelta\(fixedRows, fresh\), fresh, brands\)/);
  assert.match(runUpdate, /supabaseUrl: SUPABASE_URL,\s*buildMode: BUILD_MODE/);
  // After any attempt the check is cleared, so nothing can be sent twice from a stale review.
  assert.match(runUpdate, /setCatalog\(null\);\s*setStamp\(null\);/);
  // The first button only opens the confirmation; the final button needs the typed phrase (finalBlocker).
  assert.match(ui, /onClick=\{\(\) => \{ setConfirming\(true\); setConfirmText\(""\); \}\}>\{STEP\.update\}/);
  assert.match(ui, /disabled=\{Boolean\(finalBlocker\) \|\| writing\} onClick=\{\(\) => void runUpdate\(\)\}/);
  assert.match(ui, /const finalBlocker = updateWebsiteBlocker\(\{ \.\.\.gate, confirmation: confirmText \}\);/);
  // The page itself still makes no direct database write.
  assert.doesNotMatch(ui, /\.(insert|upsert)\s*\(|\.rpc\s*\(|from\("/);
});

test("gate wiring: the page's open/final blockers behave as the Owner rules require", () => {
  const db = makeDb();
  const { plan } = planFor(db);
  const gate = { supabaseUrl: PROD_URL, buildMode: "production", checkIsCurrent: true, plan };
  // Button can open the confirmation (all gates pass with the right phrase supplied internally)...
  assert.equal(updateWebsiteBlocker({ ...gate, confirmation: confirmationPhrase(plan) }), null);
  // ...but the final "Yes" stays off until the Owner types the exact phrase.
  assert.match(updateWebsiteBlocker({ ...gate, confirmation: "" }), /Type UPDATE \d+ CHANGES/);
  // Any Needs Attention row keeps the button itself off.
  const attention = planFor(db, `${LIST}\nSamsung\nA07 4/64 wood @ 36900`);
  assert.match(updateWebsiteBlocker({ ...gate, plan: attention.plan, confirmation: confirmationPhrase(attention.plan) }), /need attention/);
  // A reload (no fresh check) keeps it off.
  assert.match(updateWebsiteBlocker({ ...gate, checkIsCurrent: false, confirmation: confirmationPhrase(plan) }), /Check List again/);
});

test("a new phone whose brand is not set up on the website is blocked per row (the import would reject every new phone)", () => {
  const db = makeDb();
  const catalog = db.catalog();
  const text = "Samsung\nA97 8/256 black @ 120000\n\nZTE\nV80 Pro 8/256 black @ 50000";
  const delta = buildStockDelta(parseStockList(text, brands), catalog);
  const plan = buildWritePlan(delta, catalog, ["Samsung", "Xiaomi", "Honor", "Apple", "Nokia"]);
  assert.deepEqual(plan.steps.filter((s) => s.kind === "create_phone").map((s) => s.productTitle), ["Samsung A97"]);
  assert.ok(plan.blocked.some((b) => /“ZTE” is not set up/.test(b.reason)));
});


// ---------------------------------------------------------------------------
// Live progress (reported from real completed steps only)
// ---------------------------------------------------------------------------

test("progress: counts real completed write steps up to the confirmed total, in the existing write order, then verifies", async () => {
  const db = makeDb();
  const { plan, replan } = planFor(db);
  const events = [];
  const result = await runStockUpdate({ ...db.deps(), replan }, plan, (p) => events.push(p));
  assert.equal(result.outcome, "verified");
  const total = plan.steps.length;
  assert.ok(events.every((e) => e.total === total), "total is the confirmed change count");
  // Phases in order: checking -> saving -> writing -> verifying -> finished.
  const phases = events.map((e) => e.phase).filter((phase, i, all) => phase !== all[i - 1]);
  assert.deepEqual(phases, ["checking", "saving", "writing", "verifying", "finished"]);
  // `done` never goes backwards and only moves during writing, one real step at a time (new phones finish together).
  for (let i = 1; i < events.length; i += 1) assert.ok(events[i].done >= events[i - 1].done);
  const writing = events.filter((e) => e.phase === "writing");
  const doneSteps = [...new Set(writing.map((e) => e.done))];
  assert.equal(writing.at(-1).done, total);
  assert.equal(events.at(-1).done, total);
  assert.equal(events.at(-1).failed, 0);
  assert.equal(doneSteps.length > total - plan.steps.filter((s) => s.kind === "create_phone").length, true);
  // The step labels follow the existing order: price / show / add_variant ... then stock ... then hide ... then new phones last.
  const kinds = writing.map((e) => e.kind).filter((k, i, all) => k && k !== all[i - 1]);
  assert.equal(kinds.at(-1), "create_phone");
  assert.ok(kinds.indexOf("set_stock") > kinds.indexOf("price"));
  assert.ok(kinds.indexOf("hide") > kinds.indexOf("set_stock"));
  // Saving and verifying count phones.
  const saving = events.filter((e) => e.phase === "saving").at(-1);
  assert.deepEqual([saving.checked, saving.toCheck], [plan.touchedProductIds.length, plan.touchedProductIds.length]);
  const verifying = events.filter((e) => e.phase === "verifying").at(-1);
  assert.equal(verifying.checked, verifying.toCheck);
  assert.equal(verifying.toCheck, plan.touchedProductIds.length + result.createdPhones.length);
});

test("progress: the counter moves only AFTER a write call has returned — never while one is in flight", async () => {
  const db = makeDb();
  const { plan, replan } = planFor(db);
  const base = db.deps();
  let inFlight = 0;
  const wrap = (fn) => async (...args) => {
    inFlight += 1;
    await new Promise((resolve) => setTimeout(resolve, 1));
    try {
      return await fn(...args);
    } finally {
      inFlight -= 1;
    }
  };
  const deps = { ...base, replan };
  for (const name of ["updatePrice", "setActive", "insertVariant", "insertOpeningStock", "adjustStock", "createPhones"]) deps[name] = wrap(base[name]);
  let lastDone = 0;
  const violations = [];
  const result = await runStockUpdate(deps, plan, (p) => {
    if (p.done > lastDone && inFlight > 0) violations.push(p.done);
    lastDone = p.done;
  });
  assert.equal(result.outcome, "verified");
  assert.deepEqual(violations, []);
  assert.equal(lastDone, plan.steps.length);
});

test("progress: a failed step is counted, named, and the rest continue; the totals match the result", async () => {
  const db = makeDb();
  const { plan, replan } = planFor(db);
  const events = [];
  const result = await runStockUpdate({ ...db.deps({ updatePrice: async () => { throw new Error("network down"); } }), replan }, plan, (p) => events.push(p));
  assert.equal(result.outcome, "failed");
  const last = events.at(-1);
  assert.equal(last.done, plan.steps.length, "every step finished (ok or failed); nothing retried");
  assert.equal(last.failed, result.results.filter((r) => !r.ok).length);
  assert.deepEqual([last.lastFailure.kind, last.lastFailure.productTitle, last.lastFailure.message], ["price", "Samsung A07", "network down"]);
});

test("progress: a listener that throws can never change or stop the writes", async () => {
  const quiet = makeDb();
  const loud = makeDb();
  const a = planFor(quiet);
  const b = planFor(loud);
  await runStockUpdate({ ...quiet.deps(), replan: a.replan }, a.plan);
  const result = await runStockUpdate({ ...loud.deps(), replan: b.replan }, b.plan, () => { throw new Error("UI broke"); });
  assert.equal(result.outcome, "verified");
  assert.deepEqual(loud.writes.map((w) => w[0]), quiet.writes.map((w) => w[0]), "identical writes with or without progress");
});

test("progress: when the website changed after the check, progress stops at 'checking' with 0 done and nothing is written", async () => {
  const db = makeDb();
  const { plan, replan } = planFor(db);
  db.variants["pa07-v0"].price_minor = 3700000;
  const events = [];
  const result = await runStockUpdate({ ...db.deps(), replan }, plan, (p) => events.push(p));
  assert.equal(result.outcome, "blocked");
  assert.deepEqual(events.map((e) => [e.phase, e.done]), [["checking", 0]]);
  assert.equal(db.writes.length, 0);
});

test("page source: live progress is wired to the runner, double runs are impossible, and closing the tab is warned", () => {
  const ui = readFileSync(new URL("../src/admin/StockListUpdate.tsx", import.meta.url), "utf8");
  assert.match(ui, /writePlan,\s*setProgress,\s*\);/, "runner reports straight into the progress state");
  assert.match(ui, /if \(running\.current\) return;/);
  assert.match(ui, /running\.current = false;/);
  assert.match(ui, /installUnloadGuard\(window\)/);
  assert.match(ui, /role="progressbar"/);
  assert.match(ui, /WORDING\.progressCount\(progress\.done, progress\.total, percent\)/);
  assert.doesNotMatch(ui, /setInterval|setTimeout\([^)]*setProgress/, "no fake timer progress");
  // Exactly one runner call site remains.
  assert.equal(ui.match(/runStockUpdate\(/g).length, 1);
});
