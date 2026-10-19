import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildStockDelta, parseStockList } from "../src/lib/stockListDelta.ts";
import { explainReason } from "../src/lib/stockUpdateWording.ts";
import { NEW_VARIANT_INCOMPLETE, PhoneWriteError, WRITE_KINDS, buildPhonePlan, buildWritePlan, confirmationPhrase, inheritedFacts, reportCsv, runStockUpdate, updateWebsiteBlocker, verifyProduct } from "../src/lib/stockUpdateApply.ts";

const PROD_URL = "https://nlxfwppywxumymbjkvwt.supabase.co";
const DEV_URL = (() => {
  const source = readFileSync(new URL("../src/lib/supabaseEnvironment.ts", import.meta.url), "utf8");
  const ref = source.match(/development[\s\S]*?supabaseProjectRef:\s*"([a-z0-9]+)"/)?.[1];
  return `https://${ref}.supabase.co`;
})();
const brands = ["Samsung", "Xiaomi", "Motorola", "Honor", "Nokia", "Apple", "ZTE"].map((name) => ({ name }));

// ---------------------------------------------------------------------------
// A small in-memory "database" with the same shape as the real rows. applyPhone / createPhone behave like the real
// database functions: one phone per call, all of its changes or none, refused when the phone changed since the check.
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
  const calls = [];
  const deps = ({ failApply = {}, ...overrides } = {}) => ({
    supabaseUrl: PROD_URL,
    buildMode: "production",
    readSnapshot: async (id) => snapshot(id),
    applyPhone: async (payload) => {
      calls.push(["applyPhone", payload.product_id]);
      if (failApply[payload.product_id]) throw failApply[payload.product_id];
      const current = Object.values(variants).filter((v) => v.product_id === payload.product_id);
      const seen = payload.expected.variants;
      if (seen.length !== current.length || seen.some((e) => { const v = variants[e.id]; return !v || v.price_minor !== e.price_minor || v.is_active !== e.is_active; })) {
        throw new PhoneWriteError("android_stock_phone_changed_since_check: changed", false);
      }
      const newVariants = [];
      for (const step of payload.steps) {
        if (step.kind === "price") variants[step.variant_id].price_minor = step.to_minor;
        if (step.kind === "show" || step.kind === "hide") for (const id of step.variant_ids) variants[id].is_active = step.kind === "show";
        if (step.kind === "add_variant") {
          const id = `${payload.product_id}-new${Object.keys(variants).length}`;
          const sku = `MB${String(++skuCounter).padStart(3, "0")}`;
          variants[id] = { id, product_id: payload.product_id, sku, ram_display: step.ram, storage_display: step.storage, color_finish: step.color, price_minor: step.price_minor, compare_at_price_minor: null, pta_status: step.inherited.pta_status, condition: step.inherited.condition, condition_grade: null, battery_health_percent: null, battery_cycle_count: null, sim_configuration: null, warranty_override: step.inherited.warranty_override, delivery_scope: step.inherited.delivery_scope, is_active: true, updated_at: "2026-10-18T00:00:00Z" };
          movements.push({ variant_id: id, quantity_delta: step.stock, reason: "initial" });
          newVariants.push({ id, sku });
        }
      }
      for (const step of payload.steps) {
        if (step.kind !== "set_stock") continue;
        const delta = step.to_stock - stockOf(step.variant_id);
        if (delta) movements.push({ variant_id: step.variant_id, quantity_delta: delta, reason: "correction" });
      }
      return { status: "updated", new_variants: newVariants };
    },
    createPhone: async (p) => {
      calls.push(["createPhone", p.title]);
      assert.equal(p.action, "Create");
      const id = `new-${p.title}`;
      const out = { products: [{ id, title: p.title, action: "Create" }], assigned_skus: [] };
      products[id] = { id, title: p.title, slug: p.title.toLowerCase(), brand: p.brand, category: "Mobile Phones", publication_status: "draft", published_at: null, updated_at: "x" };
      for (const v of p.variants) {
        const vid = `${id}-${v.color}`;
        const sku = `MB${String(++skuCounter).padStart(3, "0")}`;
        variants[vid] = { id: vid, product_id: id, sku, ram_display: v.ram, storage_display: v.storage, color_finish: v.color, price_minor: v.price_minor, compare_at_price_minor: null, pta_status: v.pta_status, condition: v.condition, warranty_override: v.warranty, delivery_scope: v.delivery_scope, is_active: true };
        movements.push({ variant_id: vid, quantity_delta: v.stock });
        out.assigned_skus.push({ product: p.title, sku });
      }
      return out;
    },
    readCreatedPhone: async (id) => { const rows = Object.values(variants).filter((v) => v.product_id === id); return { publicationStatus: products[id].publication_status, variantCount: rows.length, skus: rows.map((v) => v.sku) }; },
    ...overrides,
  });
  return { products, variants, media, specs, movements, catalog, snapshot, deps, calls, stockOf };
}

const LIST = [
  "Samsung", "A07 4/64 black @ 37500", "A07 4/128 black @ 43500", "A07 6/128 black @ 50200", "A97 8/256 black/blue @ 120000", "",
  "Xiaomi", "A7pro 6/128 black/blue @ 36500", "",
  "Apple", "iPhone 15 6/128 black @ 240000", "",
  "Nokia", "105 @ 6500",
].join("\n");

function planFor(db, text = LIST, activeBrands) {
  const catalog = db.catalog();
  const delta = buildStockDelta(parseStockList(text, brands), catalog);
  return { delta, plan: buildWritePlan(delta, catalog, activeBrands), phonePlan: buildPhonePlan(delta, catalog, activeBrands) };
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
  const hidden = new Set(plan.steps.filter((s) => s.kind === "hide").flatMap((s) => s.variantIds));
  assert.ok(plan.steps.filter((s) => s.kind === "set_stock").every((s) => !hidden.has(s.variantId) && s.toStock === 30));
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

test("New Variants are held (not guessed) when the phone's variants disagree on PTA or condition", () => {
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

test("a new phone whose brand is not set up on the website is held per phone (the import would reject every new phone)", () => {
  const db = makeDb();
  const catalog = db.catalog();
  const text = "Samsung\nA97 8/256 black @ 120000\n\nZTE\nV80 Pro 8/256 black @ 50000";
  const delta = buildStockDelta(parseStockList(text, brands), catalog);
  const plan = buildWritePlan(delta, catalog, ["Samsung", "Xiaomi", "Honor", "Apple", "Nokia"]);
  assert.deepEqual(plan.steps.filter((s) => s.kind === "create_phone").map((s) => s.productTitle), ["Samsung A97"]);
  assert.ok(plan.blocked.some((b) => /“ZTE” is not set up/.test(b.reason)));
});

// ---------------------------------------------------------------------------
// Per-phone plan: held phones never stop the others
// ---------------------------------------------------------------------------

test("phone plan: one entry per phone; each existing phone's payload carries every variant as seen at Check List", () => {
  const db = makeDb();
  const { phonePlan } = planFor(db);
  assert.deepEqual(phonePlan.phones.map((p) => [p.kind, p.productTitle]).sort(), [["existing", "Honor X5c+"], ["existing", "Samsung A07"], ["existing", "Xiaomi A7 Pro"], ["new", "Samsung A97"]].sort());
  assert.equal(phonePlan.changeCount, 10);
  assert.equal(phonePlan.held.length, 0);
  const a07 = phonePlan.phones.find((p) => p.productTitle === "Samsung A07");
  assert.deepEqual(a07.payload.expected.variants.map((v) => [v.id, v.price_minor, v.is_active]), [["pa07-v0", 3690000, true], ["pa07-v1", 3690000, true], ["pa07-v2", 4350000, false]]);
  assert.deepEqual(a07.payload.steps.map((s) => s.kind).sort(), ["add_variant", "hide", "price", "set_stock", "set_stock", "show"]);
  const add = a07.payload.steps.find((s) => s.kind === "add_variant");
  assert.deepEqual(add.inherited, { pta_status: "approved", condition: "brand_new", warranty_override: "1 Year", delivery_scope: "karachi_only" });
  assert.equal(add.stock, 30);
  // iPhone and Nokia never appear.
  assert.ok(phonePlan.phones.every((p) => !["pip", "pnk"].includes(p.productId)));
});

test("phone plan: a phone with a row that needs attention is held entirely (nothing written, nothing hidden); the others still go", () => {
  const db = makeDb();
  const { phonePlan } = planFor(db, `${LIST}\nSamsung\nA07 4/64 wood @ 36900`);
  assert.deepEqual(phonePlan.held.map((h) => h.productTitle), ["Samsung A07"]);
  assert.ok(phonePlan.held[0].reasons.some((r) => /Wood/.test(r)));
  assert.equal(phonePlan.phones.some((p) => p.productId === "pa07"), false, "no price, stock, hide or new variant for the held phone");
  assert.deepEqual(phonePlan.phones.map((p) => p.productTitle).sort(), ["Honor X5c+", "Samsung A97", "Xiaomi A7 Pro"]);
  assert.equal(updateWebsiteBlocker({ supabaseUrl: PROD_URL, buildMode: "production", checkIsCurrent: true, plan: phonePlan, confirmation: confirmationPhrase(phonePlan) }), null);
});

test("phone plan: a sibling-facts problem holds only that phone; an unknown brand holds only that new phone", () => {
  const db = makeDb();
  db.variants["pa07-v1"].pta_status = "not_approved";
  const { phonePlan } = planFor(db, `${LIST}\nZTE\nV80 Pro 8/256 black @ 50000`, ["Samsung", "Xiaomi", "Honor", "Apple", "Nokia"]);
  assert.deepEqual(phonePlan.held.map((h) => [h.productTitle, h.productId]).sort(), [["Samsung A07", "pa07"], ["ZTE V80 Pro", null]]);
  assert.equal(phonePlan.counts.notMatched, 1);
  assert.deepEqual(phonePlan.phones.map((p) => p.productTitle).sort(), ["Honor X5c+", "Samsung A97", "Xiaomi A7 Pro"]);
});

test("phone plan: a line that looks like an existing phone holds that phone, so a typo can never hide or change it", () => {
  const db = makeDb();
  const { phonePlan } = planFor(db, "Xiaomi\nA7 Pr 6/128 black @ 36000");
  assert.deepEqual(phonePlan.held.map((h) => h.productTitle).sort(), ["Xiaomi A7 Pr", "Xiaomi A7 Pro"].sort());
  assert.equal(phonePlan.phones.some((p) => p.productId === "pa7p"), false);
  assert.equal(phonePlan.phones.some((p) => p.kind === "new"), false, "never a duplicate phone");
});

test("phone plan: every phone held means Update Website stays off with a plain reason", () => {
  const db = makeDb();
  const { phonePlan } = planFor(db, "Samsung\nA07 4/64 wood @ 36900");
  const blocker = updateWebsiteBlocker({ supabaseUrl: PROD_URL, buildMode: "production", checkIsCurrent: true, plan: { ...phonePlan, phones: [] }, confirmation: "" });
  assert.match(blocker, /needs attention/);
});

// ---------------------------------------------------------------------------
// Gate
// ---------------------------------------------------------------------------

test("gate: environment pair, fresh check, something to update, typed confirmation", () => {
  const db = makeDb();
  const { phonePlan } = planFor(db);
  const ok = { supabaseUrl: PROD_URL, buildMode: "production", checkIsCurrent: true, plan: phonePlan, confirmation: confirmationPhrase(phonePlan) };
  assert.equal(confirmationPhrase(phonePlan), "UPDATE 10 CHANGES");
  assert.equal(updateWebsiteBlocker(ok), null);
  assert.match(updateWebsiteBlocker({ ...ok, buildMode: "development" }), /must match/);
  assert.match(updateWebsiteBlocker({ ...ok, supabaseUrl: "https://unknown.supabase.co" }), /UNKNOWN/);
  assert.match(updateWebsiteBlocker({ ...ok, checkIsCurrent: false }), /Check List again/);
  assert.match(updateWebsiteBlocker({ ...ok, plan: null }), /Check List first/);
  assert.match(updateWebsiteBlocker({ ...ok, confirmation: "update 10 changes" }), /Type UPDATE 10 CHANGES/);
  assert.equal(updateWebsiteBlocker({ ...ok, supabaseUrl: DEV_URL, buildMode: "development" }), null, "DEV with a dev build is a matching pair too");
});

// ---------------------------------------------------------------------------
// Runner (offline fake database; each phone is all or nothing like the real function)
// ---------------------------------------------------------------------------

test("full run: every phone updated in its own call, read back, and nothing else touched", async () => {
  const db = makeDb();
  const { phonePlan } = planFor(db);
  const productRowsBefore = structuredClone(db.products);
  const mediaBefore = structuredClone(db.media);
  const specsBefore = structuredClone(db.specs);
  const skusBefore = Object.fromEntries(Object.values(db.variants).map((v) => [v.id, v.sku]));
  const result = await runStockUpdate(db.deps(), phonePlan);
  assert.equal(result.outcome, "finished");
  assert.deepEqual(result.counts, { updated: 4, failed: 0, unknown: 0, needs_check: 0, held: 0 }, JSON.stringify(result.phones.filter((p) => p.status !== "updated")));
  assert.equal(db.calls.filter((c) => c[0] === "applyPhone").length, 3, "one call per existing phone");
  assert.equal(db.calls.filter((c) => c[0] === "createPhone").length, 1, "one call per new phone");
  assert.equal(db.variants["pa07-v0"].price_minor, 3750000);
  assert.equal(db.variants["pa07-v1"].is_active, false);
  assert.equal(db.variants["pa07-v2"].is_active, true);
  assert.equal(db.variants["px5c-v0"].is_active, false);
  for (const id of ["pa07", "pa7p", "px5c", "pip", "pnk"]) assert.deepEqual(db.products[id], productRowsBefore[id]);
  assert.deepEqual(db.media, mediaBefore);
  assert.deepEqual(db.specs, specsBefore);
  for (const [id, sku] of Object.entries(skusBefore)) assert.equal(db.variants[id].sku, sku);
  for (const id of ["pa07-v0", "pa07-v2", "pa7p-v0", "pa7p-v1"]) assert.equal(db.stockOf(id), 30, id);
  for (const id of ["pa07-v1", "px5c-v0", "pip-v0", "pnk-v0"]) assert.equal(db.stockOf(id), 10, id);
  const added = Object.values(db.variants).filter((v) => v.product_id === "pa07" && v.ram_display === "6 GB");
  assert.equal(added.length, 1);
  assert.equal(db.stockOf(added[0].id), 30);
  assert.equal(db.products["new-Samsung A97"].publication_status, "draft");
  const a07 = result.phones.find((p) => p.productTitle === "Samsung A07");
  assert.deepEqual(a07.newSkus, [added[0].sku]);
  assert.ok(a07.changes.some((c) => /price Rs 36,900 → Rs 37,500/.test(c)));
});

test("partial success: one phone refused by the database is saved not at all; every other phone still updates", async () => {
  const db = makeDb();
  const { phonePlan } = planFor(db);
  const before = structuredClone(db.variants);
  const result = await runStockUpdate(db.deps({ failApply: { pa07: new PhoneWriteError("android_stock_phone_changed_since_check: changed", false) } }), phonePlan);
  assert.deepEqual(result.counts, { updated: 3, failed: 1, unknown: 0, needs_check: 0, held: 0 });
  const failed = result.phones.find((p) => p.status === "failed");
  assert.equal(failed.productTitle, "Samsung A07");
  assert.match(failed.reasons[0], /changed_since_check/);
  for (const id of ["pa07-v0", "pa07-v1", "pa07-v2"]) assert.deepEqual(db.variants[id], before[id], "the failed phone is exactly as it was");
  assert.equal(Object.values(db.variants).filter((v) => v.product_id === "pa07").length, 3, "no new variant for the failed phone");
  assert.equal(db.variants["px5c-v0"].is_active, false, "other phones went ahead");
  assert.equal(db.stockOf("pa7p-v0"), 30);
});

test("no answer from the website is reported as 'check again', never as saved or failed", async () => {
  const db = makeDb();
  const { phonePlan } = planFor(db);
  const result = await runStockUpdate(db.deps({ failApply: { pa7p: new PhoneWriteError("No answer from the website (Failed to fetch)", "unknown") } }), phonePlan);
  assert.equal(result.phones.find((p) => p.productTitle === "Xiaomi A7 Pro").status, "unknown");
  assert.equal(result.counts.updated, 3);
});

test("a read-back that does not match is reported as saved-but-check-again", async () => {
  const db = makeDb();
  const { phonePlan } = planFor(db);
  const deps = db.deps();
  const apply = deps.applyPhone;
  deps.applyPhone = async (payload) => {
    const out = await apply(payload);
    if (payload.product_id === "px5c") db.variants["px5c-v0"].pta_status = "not_approved"; // an unplanned change
    return out;
  };
  const result = await runStockUpdate(deps, phonePlan);
  const honor = result.phones.find((p) => p.productTitle === "Honor X5c+");
  assert.equal(honor.status, "needs_check");
  assert.ok(honor.reasons.some((r) => /pta_status/.test(r)));
});

test("one failing new phone never stops the other new phones", async () => {
  const db = makeDb();
  const { phonePlan } = planFor(db, `${LIST}\nMotorola\nG99 8/256 black @ 70000`);
  const deps = db.deps();
  const create = deps.createPhone;
  deps.createPhone = async (payload) => {
    if (payload.title === "Samsung A97") throw new PhoneWriteError("bulk_import_v2_validation_failed: test", false);
    return create(payload);
  };
  const result = await runStockUpdate(deps, phonePlan);
  assert.equal(result.phones.find((p) => p.productTitle === "Samsung A97").status, "failed");
  assert.equal(result.phones.find((p) => p.productTitle === "Motorola G99").status, "updated");
  assert.equal(db.products["new-Motorola G99"].publication_status, "draft");
  assert.equal(db.products["new-Samsung A97"], undefined);
});

test("held phones are listed in the report with their reasons and are never written", async () => {
  const db = makeDb();
  const { phonePlan } = planFor(db, `${LIST}\nSamsung\nA07 4/64 wood @ 36900`);
  const result = await runStockUpdate(db.deps(), phonePlan);
  const held = result.phones.find((p) => p.status === "held");
  assert.equal(held.productTitle, "Samsung A07");
  assert.ok(held.reasons.length > 0);
  assert.equal(db.calls.some((c) => c[1] === "pa07"), false);
  assert.equal(db.variants["pa07-v1"].is_active, true, "the held phone's missing variant is not hidden");
});

test("retry after a failure: a fresh check plans only what is still different, so nothing is duplicated", async () => {
  const db = makeDb();
  const first = planFor(db);
  await runStockUpdate(db.deps({ failApply: { pa07: new PhoneWriteError("android_stock_phone_busy", false) } }), first.phonePlan);
  const second = planFor(db);
  assert.deepEqual(second.phonePlan.phones.map((p) => p.productTitle), ["Samsung A07"], "only the failed phone is left; new phone and others are Same now");
  const result = await runStockUpdate(db.deps(), second.phonePlan);
  assert.equal(result.counts.updated, 1);
  assert.equal(Object.values(db.variants).filter((v) => v.product_id === "pa07" && v.ram_display === "6 GB").length, 1, "one new variant, not two");
  assert.equal(Object.values(db.products).filter((p) => p.title === "Samsung A97").length, 1, "one new phone, not two");
  const third = planFor(db);
  assert.equal(third.phonePlan.phones.length, 0, "everything is Same now");
  for (const id of ["pa07-v0", "pa07-v2", "pa7p-v0", "pa7p-v1"]) assert.equal(db.stockOf(id), 30, id);
  assert.equal(db.movements.filter((m) => m.variant_id === "pa7p-v0").length, 2, "one opening row + one correction, no repeat");
});

test("refuses to start on a mismatched environment; nothing is called", async () => {
  const db = makeDb();
  const { phonePlan } = planFor(db);
  const result = await runStockUpdate(db.deps({ buildMode: "development" }), phonePlan);
  assert.equal(result.outcome, "blocked");
  assert.equal(db.calls.length, 0);
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

// ---------------------------------------------------------------------------
// Progress (real finished phones only)
// ---------------------------------------------------------------------------

test("progress: counts finished phones only after each call returns; failures are counted and named; a throwing listener changes nothing", async () => {
  const db = makeDb();
  const { phonePlan } = planFor(db);
  const deps = db.deps({ failApply: { pa7p: new PhoneWriteError("android_stock_phone_busy", false) } });
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
  deps.applyPhone = wrap(deps.applyPhone);
  deps.createPhone = wrap(deps.createPhone);
  const events = [];
  const violations = [];
  let lastDone = 0;
  const result = await runStockUpdate(deps, phonePlan, (p) => {
    events.push(p);
    if (p.done > lastDone && inFlight > 0) violations.push(p.done);
    lastDone = p.done;
  });
  assert.deepEqual(violations, []);
  assert.ok(events.every((e) => e.total === phonePlan.phones.length));
  for (let i = 1; i < events.length; i += 1) assert.ok(events[i].done >= events[i - 1].done);
  assert.equal(events.at(-1).phase, "finished");
  assert.equal(events.at(-1).done, phonePlan.phones.length);
  assert.equal(events.at(-1).failed, 1);
  assert.deepEqual([events.at(-1).lastFailure.productTitle, events.at(-1).lastFailure.message], ["Xiaomi A7 Pro", "android_stock_phone_busy"]);
  assert.equal(result.counts.failed, 1);

  const quiet = makeDb();
  const loud = makeDb();
  await runStockUpdate(quiet.deps(), planFor(quiet).phonePlan);
  const loudResult = await runStockUpdate(loud.deps(), planFor(loud).phonePlan, () => { throw new Error("UI broke"); });
  assert.equal(loudResult.counts.updated, 4);
  assert.deepEqual(loud.calls.map((c) => c[0]), quiet.calls.map((c) => c[0]));
});

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

test("report CSV lists every phone with its result and reason (quotes and commas escaped)", () => {
  const csv = reportCsv([
    { key: "a", productId: "a", productTitle: "Samsung A07", status: "updated", reasons: [], changes: ["4 GB / 64 GB / Black: price Rs 36,900 → Rs 37,500"], newSkus: ["MB120"], checks: [] },
    { key: "b", productId: null, productTitle: 'Xiaomi "A7" Pr', status: "held", reasons: ["Looks like “Xiaomi A7 Pro”"], changes: [], newSkus: [], checks: [] },
  ], { updated: "Updated", failed: "Not saved", unknown: "Check again", needs_check: "Saved — check again", held: "Held for review" });
  assert.equal(csv.split("\r\n")[0], "Phone,Result,Reason,Changes,New SKUs");
  assert.equal(csv.split("\r\n")[1], 'Samsung A07,Updated,,"4 GB / 64 GB / Black: price Rs 36,900 → Rs 37,500",MB120');
  assert.equal(csv.split("\r\n")[2], '"Xiaomi ""A7"" Pr",Held for review,Looks like “Xiaomi A7 Pro”,,');
});

// ---------------------------------------------------------------------------
// Source guarantees
// ---------------------------------------------------------------------------

test("source: the adapter writes only through the two all-or-nothing database functions — no direct table write, no delete", () => {
  const src = readFileSync(new URL("../src/lib/stockUpdateApplyDb.ts", import.meta.url), "utf8");
  assert.doesNotMatch(src, /\.(insert|update|upsert|delete)\s*\(/);
  assert.deepEqual([...src.matchAll(/"(apply_[a-z0-9_]+)"/g)].map((m) => m[1]).sort(), ["apply_android_stock_phone", "apply_catalog_bulk_import_v2"]);
  assert.match(src, /p_batch: \{ products: \[payload\] \}/, "one new phone per call");
  assert.match(src, /Only Create is allowed/);
  assert.doesNotMatch(src, /Replace Existing/);
  const logic = readFileSync(new URL("../src/lib/stockUpdateApply.ts", import.meta.url), "utf8");
  assert.doesNotMatch(logic, /\.delete\s*\(|supabase\.|from\("/);
});

test("source: Update Website is wired ONLY through the gated runner — confirmation, typed phrase, environment guard", () => {
  const ui = readFileSync(new URL("../src/admin/StockListUpdate.tsx", import.meta.url), "utf8");
  assert.equal(ui.match(/runStockUpdate\(/g).length, 1);
  const runUpdate = ui.slice(ui.indexOf("async function runUpdate()"), ui.indexOf("function toggle("));
  assert.match(runUpdate, /const blocker = updateWebsiteBlocker\(\{ \.\.\.gate, confirmation: confirmText \}\);\s*if \(blocker\) return/);
  assert.match(runUpdate, /supabaseUrl: SUPABASE_URL,\s*buildMode: BUILD_MODE/);
  assert.match(runUpdate, /phonePlan,\s*setProgress,\s*\);/, "runner reports straight into the progress state");
  assert.match(runUpdate, /setCatalog\(null\);\s*setStamp\(null\);/, "after any attempt a fresh Check List is required");
  assert.match(ui, /onClick=\{\(\) => \{ setConfirming\(true\); setConfirmText\(""\); \}\}>\{STEP\.update\}/);
  assert.match(ui, /disabled=\{Boolean\(finalBlocker\) \|\| writing\} onClick=\{\(\) => void runUpdate\(\)\}/);
  assert.match(ui, /const finalBlocker = updateWebsiteBlocker\(\{ \.\.\.gate, confirmation: confirmText \}\);/);
  assert.doesNotMatch(ui, /\.(insert|upsert)\s*\(|\.rpc\s*\(|from\("/);
  // The Owner's identity decisions reach the comparison, and the fix buttons exist.
  assert.equal(ui.match(/rowDecisions\)/g).length, 2);
  assert.match(ui, /type: "accept_correction"/);
  assert.match(ui, /type: "confirm_new_phone"/);
  // Progress: double runs impossible, closing warned, no fake timers.
  assert.match(ui, /if \(running\.current\) return;/);
  assert.match(ui, /installUnloadGuard\(window\)/);
  assert.match(ui, /role="progressbar"/);
  assert.doesNotMatch(ui, /setInterval|setTimeout\([^)]*setProgress/);
});

// ---------------------------------------------------------------------------
// Held list: exact reasons, no phone listed twice, page marks held rows
// ---------------------------------------------------------------------------

test("held list: a line with a missing price for an existing phone holds that phone ONCE (not also as 'not matched')", () => {
  const db = makeDb();
  const { phonePlan } = planFor(db, `${LIST}\nSamsung\nA07 4/64 black`);
  const a07 = phonePlan.held.filter((h) => h.productTitle === "Samsung A07" || h.productId === "pa07");
  assert.equal(a07.length, 1, JSON.stringify(phonePlan.held.map((h) => [h.key, h.productTitle])));
  assert.equal(a07[0].productId, "pa07");
  assert.equal(phonePlan.counts.notMatched, 0);
  assert.equal(phonePlan.phones.some((p) => p.productId === "pa07"), false);
});

test("held list: a new variant that cannot copy PTA / condition names its variant, line and the exact rule", () => {
  const db = makeDb();
  for (const id of ["pa07-v0", "pa07-v1", "pa07-v2"]) db.variants[id].condition = "unknown";
  const { phonePlan } = planFor(db);
  const a07 = phonePlan.held.find((h) => h.productId === "pa07");
  assert.ok(a07, "A07 is held");
  assert.deepEqual(a07.reasons, ["New variant 6 GB / 128 GB / Black (line 4): the phone's other variants have no PTA / condition set, so this new variant cannot copy them — set them for this phone in Admin, or add the variant by hand"]);
  assert.equal(explainReason(a07.reasons[0]), a07.reasons[0], "shown exactly, never 'Please check this line'");
});

test("held list: every held reason has an exact plain sentence (no generic 'Please check this line')", () => {
  const db = makeDb();
  for (const id of ["pa07-v0", "pa07-v1", "pa07-v2"]) db.variants[id].condition = "unknown";
  const { phonePlan } = planFor(db, `${LIST}\nXiaomi\nA7 Pr 6/128 black @ 36000\n\nZTE\nV80 Pro 8/256 black @ 50000`, ["Samsung", "Xiaomi", "Honor", "Apple", "Nokia"]);
  const reasons = phonePlan.held.flatMap((h) => h.reasons.map((r) => [h.productTitle, explainReason(r)]));
  assert.ok(reasons.length >= 4);
  assert.deepEqual(reasons.filter(([, r]) => r === "Please check this line"), []);
});

test("page source: rows of held phones are marked in the tabs, and the changes line counts only what will be written", () => {
  const ui = readFileSync(new URL("../src/admin/StockListUpdate.tsx", import.meta.url), "utf8");
  assert.match(ui, /const isHeldEntry = \(entry: DeltaEntry\) =>/);
  assert.match(ui, /WORDING\.heldRow/);
  assert.match(ui, /WORDING\.heldNotHidden/);
  assert.match(ui, /WORDING\.changesWritten\}: \{phonePlan\.counts\.priceUpdates\}/);
  assert.doesNotMatch(ui, /buildApplyPlan|Changes from this list|plan\.counts\./, "no second, different count of changes on the page");
});

test("a colourless line for an existing phone (e.g. 'C75x 8/128 @ 61000') is held with the exact reason, never sent to the database", () => {
  const db = makeDb();
  const { phonePlan, plan } = planFor(db, `${LIST}\nXiaomi\nA7pro 8/256 @ 45000`);
  assert.ok(plan.blocked.some((b) => b.productTitle === "Xiaomi A7 Pro" && b.reason === NEW_VARIANT_INCOMPLETE));
  assert.equal(plan.steps.some((s) => s.kind === "add_variant" && !s.color), false, "no colourless new variant is ever planned");
  const held = phonePlan.held.find((h) => h.productId === "pa7p");
  assert.ok(held, "the phone is held");
  assert.deepEqual(held.reasons, ["New variant 8 GB / 256 GB (line 16): this line has no RAM, storage or colour for it, so it cannot be added as a new variant — add the missing colour (or RAM / storage) to the line"]);
  assert.equal(explainReason(held.reasons[0]), held.reasons[0], "shown exactly");
  assert.equal(phonePlan.phones.some((p) => p.productId === "pa7p"), false);
  assert.deepEqual(phonePlan.phones.map((p) => p.productTitle).sort(), ["Honor X5c+", "Samsung A07", "Samsung A97"], "every other phone still updates");
});
