import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  buildApplyPlan,
  buildStockDelta,
  defaultSelection,
  isSelectable,
  parseStockList,
  rowCategory,
  tableToStockText,
} from "../src/lib/stockListDelta.ts";

const brands = ["Samsung", "Xiaomi", "Motorola", "Honor", "Nokia", "HMD", "Vivo", "Realme", "Oppo", "Apple"].map((name) => ({ name }));

let n = 0;
const variant = (ram, storage, color, price, extra = {}) => ({
  id: `v${++n}`, sku: `MB${String(n).padStart(3, "0")}`, ram, storage, color, priceMinor: price * 100, compareAtPriceMinor: null,
  stock: 10, ptaStatus: "approved", condition: "brand_new", conditionGrade: null, batteryHealth: null, cycleCount: null, isActive: true, ...extra,
});
const product = (title, variants, extra = {}) => ({
  id: `p-${title}`, slug: title.toLowerCase().replace(/\+/g, " plus ").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""), title, brand: title.split(" ")[0],
  category: "Mobile Phones", publicationStatus: "published", mediaCount: 3, specCount: 10, variants, ...extra,
});
const catalog = () => [
  product("Samsung A07", [variant("4 GB", "64 GB", "Black", 36900), variant("4 GB", "64 GB", "Green", 36900)]),
  product("Xiaomi A7 Pro", [variant("6 GB", "128 GB", "Black", 36500), variant("6 GB", "128 GB", "Blue", 36500)]),
  product("Honor X5c+", [variant("4 GB", "128 GB", "Black", 30000)]),
  product("Motorola Edge 70 Fusion", [variant("8 GB", "256 GB", "Grey", 90000)]),
  product("Samsung A37", [variant("8 GB", "128 GB", "Black", 100000)]),
];
const run = (text, cat = catalog()) => buildStockDelta(parseStockList(text, brands), cat);
const kinds = (delta) => delta.entries.map((e) => e.kind);

test("multi-color line splits into one variant per colour", () => {
  const parsed = parseStockList("Samsung\n\nA07 4/64 black/green @ 36900", brands);
  assert.deepEqual(parsed.rows.map((r) => [r.brand, r.model, r.ram, r.storage, r.color, r.priceMinor]), [
    ["Samsung", "A07", "4 GB", "64 GB", "Black", 3690000],
    ["Samsung", "A07", "4 GB", "64 GB", "Green", 3690000],
  ]);
});

test("RAM/storage forms 4/64, 8/256, 12/512 and 16/1Tb", () => {
  const parsed = parseStockList("Samsung\nA1 4/64 black @ 10000\nA2 8/256 black @ 20000\nA3 12/512 black @ 30000\nA4 16/1Tb black @ 40000", brands);
  assert.deepEqual(parsed.rows.map((r) => [r.ram, r.storage]), [["4 GB", "64 GB"], ["8 GB", "256 GB"], ["12 GB", "512 GB"], ["16 GB", "1 TB"]]);
});

test("brand sections apply to the lines below them", () => {
  const parsed = parseStockList("Samsung\nA07 4/64 black @ 36900\n\nMotorola\nG77 8/256 black @ 91800", brands);
  assert.deepEqual(parsed.rows.map((r) => r.brand), ["Samsung", "Motorola"]);
});

test("different colours keep their own prices", () => {
  const parsed = parseStockList("Xiaomi\nA7pro 6/128 black/blue @ 36500\nA7pro 6/128 green/orange @ 36000", brands);
  assert.deepEqual(parsed.rows.map((r) => [r.color, r.priceMinor]), [["Black", 3650000], ["Blue", 3650000], ["Green", 3600000], ["Orange", 3600000]]);
});

test("harmless spelling differences map to the existing product only when identity is proven", () => {
  const delta = run("Xiaomi\nA7pro 6/128 black @ 36500\n\nHonor\nX5c plus 4/128 black @ 30000");
  assert.deepEqual(kinds(delta), ["unchanged", "unchanged"]);
  assert.equal(delta.entries[0].productTitle, "Xiaomi A7 Pro");
  assert.equal(delta.entries[1].productTitle, "Honor X5c+");
  assert.ok(delta.entries[1].notes.some((note) => /identity proven/.test(note)));
});

test("Edge 70 is never merged with Edge 70 Fusion", () => {
  const delta = run("Motorola\nEdge 70 12/256 grey @ 99000");
  assert.equal(delta.entries[0].kind, "new_product");
  assert.equal(delta.entries[0].productId, null);
  assert.ok(delta.entries[0].notes.some((note) => /Edge 70 Fusion/.test(note)));
  assert.ok(delta.missing.some((m) => m.productTitle === "Motorola Edge 70 Fusion"));
});

test("unchanged variant", () => {
  const delta = run("Samsung\nA07 4/64 black @ 36900");
  assert.equal(delta.entries[0].kind, "unchanged");
  assert.equal(delta.counts.unchanged, 1);
  assert.equal(isSelectable(delta.entries[0]), false);
});

test("price-only change shows current, new and difference", () => {
  const delta = run("Samsung\nA07 4/64 black @ 37500");
  const entry = delta.entries[0];
  assert.equal(entry.kind, "price_change");
  assert.equal(entry.currentPriceMinor, 3690000);
  assert.equal(entry.newPriceMinor, 3750000);
  assert.equal(entry.diffMinor, 60000);
  assert.ok(entry.selectable && entry.defaultSelected);
});

test("new variant on an existing product does not recreate the product", () => {
  const delta = run("Samsung\nA07 4/128 black @ 43500");
  const entry = delta.entries[0];
  assert.equal(entry.kind, "new_variant");
  assert.equal(entry.productId, "p-Samsung A07");
  const plan = buildApplyPlan(delta, defaultSelection(delta));
  assert.equal(plan.actions[0].op, "create_variant");
  assert.equal(plan.counts.newProducts, 0);
});

test("new product reports what is still required and groups its variants", () => {
  const delta = run("Samsung\nA97 8/256 black/blue @ 120000");
  assert.equal(delta.counts.newProducts, 1);
  assert.equal(delta.counts.newProductVariants, 2);
  assert.ok(delta.entries[0].requirements.some((r) => /Image/.test(r)));
  const plan = buildApplyPlan(delta, defaultSelection(delta));
  assert.equal(plan.actions.length, 1);
  assert.equal(plan.actions[0].op, "create_product");
  assert.match(plan.actions[0].status, /Draft/);
  assert.equal(plan.actions[0].variants.length, 2);
});

test("incomplete new product is not selected by default", () => {
  const delta = run("Samsung\nA98 black @ 120000");
  assert.notEqual(delta.entries[0].defaultSelected, true);
});

test("catalog products absent from the list are reported as missing, review only", () => {
  const delta = run("Samsung\nA07 4/64 black @ 36900");
  const titles = delta.missing.map((m) => `${m.scope}:${m.productTitle}`);
  assert.ok(titles.includes("variant:Samsung A07"), "the Green variant is missing");
  assert.ok(titles.includes("product:Xiaomi A7 Pro"));
  assert.ok(titles.includes("product:Samsung A37"));
  const plan = buildApplyPlan(delta, new Set(delta.missing.map((m) => m.id)));
  assert.equal(plan.actions.length, 0);
  assert.equal(plan.missingReviewOnly, delta.missing.length);
});

test("no destructive operation can exist in an apply plan", () => {
  const delta = run("Samsung\nA07 4/64 black @ 37500\nA07 4/128 black @ 43500\nA97 8/256 black @ 120000");
  const everything = new Set([...delta.entries.map((e) => e.id), ...delta.missing.map((m) => m.id)]);
  const plan = buildApplyPlan(delta, everything);
  assert.ok(plan.actions.every((a) => ["update_price", "create_variant", "create_product"].includes(a.op)));
  assert.equal(plan.writesPerformed, false);
});

test("duplicate input lines are flagged and not selectable", () => {
  const delta = run("Samsung\nA07 4/64 black @ 37500\nA07 4/64 black @ 37500");
  const dup = delta.entries.filter((e) => e.kind === "ambiguous");
  assert.ok(dup.length >= 1);
  assert.ok(dup.every((e) => !e.selectable));
});

test("tablet, gift box, feature phone and unknown categories are separated", () => {
  const text = "MI Xiaomi Pad\nPad 2 4g 8/256 grey @ 79500\n\nRealme\nGift box @ 1500\n\nNokia\n105 @ 7000";
  const parsed = parseStockList(text, brands);
  assert.deepEqual(parsed.rows.map(rowCategory), ["tablet", "feature_phone"]);
  assert.equal(parsed.excluded.length, 1);
  assert.match(parsed.excluded[0].reason, /gift box/i);
  const delta = buildStockDelta(parsed, catalog());
  assert.equal(delta.counts.blocked, 2);
  assert.ok(delta.entries.every((e) => e.kind === "blocked" && !e.selectable));
  assert.equal(delta.counts.excluded, 1);
});

test("ambiguous product identity is blocked from apply", () => {
  const cat = [...catalog(), { ...product("Samsung A07", [variant("4 GB", "64 GB", "Black", 1)]), id: "dup", slug: "samsung-a07-2" }];
  const delta = run("Samsung\nA07 4/64 black @ 36900", cat);
  assert.equal(delta.entries[0].kind, "ambiguous");
  assert.equal(delta.entries[0].selectable, false);
});

test("a new price at or above compare-at is held for review, not applied", () => {
  const cat = catalog();
  cat[0].variants[0].compareAtPriceMinor = 3800000;
  const delta = run("Samsung\nA07 4/64 black @ 38000", cat);
  assert.equal(delta.entries[0].kind, "ambiguous");
  assert.equal(delta.entries[0].provisionalKind, "price_change");
  assert.equal(delta.entries[0].selectable, false);
});

test("apply plan keeps images, specs, SKU, PTA, condition and publication untouched", () => {
  const delta = run("Samsung\nA07 4/64 black @ 37500");
  const plan = buildApplyPlan(delta, defaultSelection(delta));
  const action = plan.actions[0];
  assert.equal(action.op, "update_price");
  assert.deepEqual(action.writes, ["product_variants.price_minor (price only)"]);
  assert.equal(action.sku, delta.entries[0].sku);
  assert.equal(delta.entries[0].mediaCount, 3);
  assert.equal(delta.entries[0].specCount, 10);
  const preserved = plan.preserved.join(" | ");
  for (const word of ["Images", "Specification", "SKUs", "PTA", "Publication", "slugs"]) assert.match(preserved, new RegExp(word));
});

test("default selection: safe price changes and variants only; never missing, ambiguous, blocked or unchanged", () => {
  const delta = run("Samsung\nA07 4/64 black @ 37500\nA07 4/64 green @ 36900\nA07 4/128 black @ 43500\nNokia\n105 @ 7000");
  const selected = defaultSelection(delta);
  for (const entry of delta.entries) {
    assert.equal(selected.has(entry.id), entry.kind === "price_change" || entry.kind === "new_variant");
  }
});

test("CSV/XLSX tables are turned into the same raw list", () => {
  const text = tableToStockText([["Brand", "Model", "RAM", "Storage", "Color", "Price"], ["Samsung", "A07", "4", "64", "black,green", "36900"], ["Samsung", "A57", "12", "512", "lilac", "204500"]]);
  const parsed = parseStockList(text, brands);
  assert.deepEqual(parsed.rows.map((r) => [r.model, r.ram, r.storage, r.color, r.priceMinor]), [
    ["A07", "4 GB", "64 GB", "Black", 3690000], ["A07", "4 GB", "64 GB", "Green", 3690000], ["A57", "12 GB", "512 GB", "Lilac", 20450000],
  ]);
});

test("the delta engine, its database adapter and the UI contain no write call", () => {
  for (const file of ["../src/lib/stockListDelta.ts", "../src/lib/stockListDeltaDb.ts", "../src/admin/StockListUpdate.tsx"]) {
    const source = readFileSync(new URL(file, import.meta.url), "utf8");
    assert.doesNotMatch(source, /\.(insert|update|upsert)\s*\(|\.rpc\s*\(/, file);
    if (!file.endsWith(".tsx")) assert.doesNotMatch(source, /\.delete\s*\(/, file);
  }
  const ui = readFileSync(new URL("../src/admin/StockListUpdate.tsx", import.meta.url), "utf8");
  assert.match(ui, /Apply Selected Changes/);
  assert.match(ui, /<button type="button" className="admin-primary" disabled title=/);
});
