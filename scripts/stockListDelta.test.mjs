import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  PLAN_OPERATIONS,
  buildApplyPlan,
  buildStockDelta,
  defaultSelection,
  isAndroidCatalogProduct,
  isHideSelectable,
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
  category: "Mobile Phones", categorySlug: "mobile-phones", publicationStatus: "published", mediaCount: 3, specCount: 10, variants, ...extra,
});
const catalog = () => [
  product("Samsung A07", [variant("4 GB", "64 GB", "Black", 36900), variant("4 GB", "64 GB", "Green", 36900)]),
  product("Xiaomi A7 Pro", [variant("6 GB", "128 GB", "Black", 36500), variant("6 GB", "128 GB", "Blue", 36500)]),
  product("Honor X5c+", [variant("4 GB", "128 GB", "Black", 30000)]),
  product("Motorola Edge 70 Fusion", [variant("8 GB", "256 GB", "Grey", 90000)]),
  product("Samsung A37", [variant("8 GB", "128 GB", "Black", 100000)]),
];
/** Everything on the website that is NOT an Android phone: this tool must never see it. */
const nonAndroid = () => [
  product("Apple iPhone 15", [variant("6 GB", "128 GB", "Black", 250000)], { id: "p-iphone", slug: "apple-iphone-15", brand: "Apple" }),
  product("Xiaomi Pad 7", [variant("8 GB", "256 GB", "Grey", 79500)], { id: "p-pad", slug: "xiaomi-pad-7", category: "Tablets", categorySlug: "tablets" }),
  product("Nokia 105", [variant(null, null, "Black", 7000)], { id: "p-nokia", slug: "nokia-105", brand: "Nokia" }),
  product("Baseus Charger", [variant(null, null, "White", 1500)], { id: "p-acc", slug: "baseus-charger", brand: "Baseus", category: "Accessories", categorySlug: "mobile-accessories" }),
];
const run = (text, cat = catalog()) => buildStockDelta(parseStockList(text, brands), cat);
const kinds = (delta) => delta.entries.map((e) => e.kind);
const ops = (plan) => plan.actions.map((a) => a.op);
const FULL_LIST = "Samsung\nA07 4/64 black/green @ 36900\nA37 8/128 black @ 100000\n\nXiaomi\nA7pro 6/128 black/blue @ 36500\n\nHonor\nX5c plus 4/128 black @ 30000\n\nMotorola\nEdge 70 Fusion 8/256 grey @ 90000";

// ---------------------------------------------------------------------------
// Parsing (unchanged parser, one parser only)
// ---------------------------------------------------------------------------

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

test("CSV/XLSX tables are turned into the same raw list", () => {
  const text = tableToStockText([["Brand", "Model", "RAM", "Storage", "Color", "Price"], ["Samsung", "A07", "4", "64", "black,green", "36900"], ["Samsung", "A57", "12", "512", "lilac", "204500"]]);
  const parsed = parseStockList(text, brands);
  assert.deepEqual(parsed.rows.map((r) => [r.model, r.ram, r.storage, r.color, r.priceMinor]), [
    ["A07", "4 GB", "64 GB", "Black", 3690000], ["A07", "4 GB", "64 GB", "Green", 3690000], ["A57", "12 GB", "512 GB", "Lilac", 20450000],
  ]);
});

// ---------------------------------------------------------------------------
// Android only
// ---------------------------------------------------------------------------

test("Android-only: iPhone, tablet, gift box and feature phone lines are Not Android Phones, never compared", () => {
  const text = "Apple\niPhone 15 6/128 black @ 250000\n17 pro max 12/256 black @ 400000\n\nMI Xiaomi Pad\nPad 2 4g 8/256 grey @ 79500\n\nRealme\nGift box @ 1500\n\nNokia\n105 @ 7000";
  const parsed = parseStockList(text, brands);
  assert.deepEqual(parsed.rows.map(rowCategory), ["iphone", "iphone", "tablet", "feature_phone"]);
  assert.equal(parsed.excluded.length, 1);
  assert.match(parsed.excluded[0].reason, /gift box/i);
  const delta = buildStockDelta(parsed, catalog());
  assert.equal(delta.counts.blocked, 4);
  assert.equal(delta.counts.notAndroid, 5);
  assert.ok(delta.entries.every((e) => e.kind === "blocked" && !e.selectable && e.productId === null));
  assert.ok(delta.entries.every((e) => /not part of this Android update/.test(e.reasons[0])));
  assert.equal(buildApplyPlan(delta, new Set(delta.entries.map((e) => e.id))).actions.length, 0);
});

test("Android-only: iPhones, tablets, feature phones and accessories ON THE WEBSITE are never matched and never hidden", () => {
  assert.deepEqual(nonAndroid().map(isAndroidCatalogProduct), [false, false, false, false]);
  assert.ok(catalog().every(isAndroidCatalogProduct));
  const delta = run("Apple\niPhone 15 6/128 black @ 200000", [...catalog(), ...nonAndroid()]);
  // The iPhone line is outside the update even though the website has that iPhone.
  assert.equal(delta.entries[0].kind, "blocked");
  // Only the 5 Android phones are reported absent; the iPhone/tablet/Nokia/accessory are untouched.
  assert.deepEqual(delta.missing.map((m) => m.productTitle).sort(), ["Honor X5c+", "Motorola Edge 70 Fusion", "Samsung A07", "Samsung A37", "Xiaomi A7 Pro"]);
  const plan = buildApplyPlan(delta, new Set(delta.missing.map((m) => m.id)));
  assert.ok(plan.actions.every((a) => !["p-iphone", "p-pad", "p-nokia", "p-acc"].includes(a.productId)));
});

test("an Android line that cannot be read fully needs attention (not Not Android Phones) and can only be skipped", () => {
  const delta = run("Samsung\nA07 4/64 black");
  assert.equal(delta.entries[0].kind, "ambiguous");
  assert.equal(delta.counts.blocked, 0);
  assert.ok(delta.entries[0].reasons.some((r) => /Price or model missing/.test(r)));
  assert.equal(delta.entries[0].selectable, false);
});

// ---------------------------------------------------------------------------
// Matching + simple result groups
// ---------------------------------------------------------------------------

test("harmless spelling differences map to the existing phone only when identity is proven", () => {
  const delta = run("Xiaomi\nA7pro 6/128 black @ 36500\n\nHonor\nX5c plus 4/128 black @ 30000");
  assert.deepEqual(kinds(delta), ["unchanged", "unchanged"]);
  assert.equal(delta.entries[0].productTitle, "Xiaomi A7 Pro");
  assert.equal(delta.entries[1].productTitle, "Honor X5c+");
  assert.ok(delta.entries[1].notes.some((note) => /Matched to/.test(note)));
});

test("Edge 70 is never merged with Edge 70 Fusion", () => {
  const delta = run("Motorola\nEdge 70 12/256 grey @ 99000");
  assert.equal(delta.entries[0].kind, "new_product");
  assert.equal(delta.entries[0].productId, null);
  assert.ok(delta.entries[0].notes.some((note) => /Edge 70 Fusion/.test(note)));
  assert.ok(delta.missing.some((m) => m.productTitle === "Motorola Edge 70 Fusion"));
});

test("Same: an unchanged visible variant is not selectable and produces no action", () => {
  const delta = run("Samsung\nA07 4/64 black @ 36900");
  assert.equal(delta.entries[0].kind, "unchanged");
  assert.equal(delta.counts.unchanged, 1);
  assert.equal(isSelectable(delta.entries[0]), false);
});

test("Price Changed: changes only the price (current, new and difference shown)", () => {
  const delta = run("Samsung\nA07 4/64 black @ 37500");
  const entry = delta.entries[0];
  assert.equal(entry.kind, "price_change");
  assert.equal(entry.currentPriceMinor, 3690000);
  assert.equal(entry.newPriceMinor, 3750000);
  assert.equal(entry.diffMinor, 60000);
  assert.ok(entry.selectable && entry.defaultSelected);
  const plan = buildApplyPlan(delta, defaultSelection(delta));
  const price = plan.actions.find((a) => a.op === "update_price");
  assert.deepEqual(price.writes, ["product_variants.price_minor (price only)"]);
  assert.equal(price.variantId, entry.variantId);
  assert.equal(price.sku, entry.sku);
  // No other write for that variant/phone: not a show, not a hide, not a create.
  assert.deepEqual(plan.actions.filter((a) => a.productId === "p-Samsung A07" && a.op !== "update_price").map((a) => a.op), ["hide_variant"]);
  assert.equal(plan.actions.find((a) => a.op === "hide_variant").label, "4 GB / 64 GB / Green");
});

test("New Variants: a new variant on an existing phone does not recreate the phone", () => {
  const delta = run("Samsung\nA07 4/128 black @ 43500");
  const entry = delta.entries[0];
  assert.equal(entry.kind, "new_variant");
  assert.equal(entry.productId, "p-Samsung A07");
  const plan = buildApplyPlan(delta, defaultSelection(delta));
  assert.ok(plan.actions.some((a) => a.op === "create_variant" && a.productId === "p-Samsung A07"));
  assert.equal(plan.counts.newProducts, 0);
});

test("New Phones: reports what is still required and groups its variants", () => {
  const delta = run("Samsung\nA97 8/256 black/blue @ 120000");
  assert.equal(delta.counts.newProducts, 1);
  assert.equal(delta.counts.newProductVariants, 2);
  assert.ok(delta.entries[0].requirements.some((r) => /Image/.test(r)));
  const plan = buildApplyPlan(delta, new Set(delta.entries.map((e) => e.id)));
  const created = plan.actions.filter((a) => a.op === "create_product");
  assert.equal(created.length, 1);
  assert.match(created[0].status, /Draft/);
  assert.equal(created[0].variants.length, 2);
});

test("incomplete new phone is not selected by default", () => {
  const delta = run("Samsung\nA98 black @ 120000");
  assert.notEqual(delta.entries[0].defaultSelected, true);
});

test("duplicate input lines need attention and are not selectable", () => {
  const delta = run("Samsung\nA07 4/64 black @ 37500\nA07 4/64 black @ 37500");
  const dup = delta.entries.filter((e) => e.kind === "ambiguous");
  assert.ok(dup.length >= 1);
  assert.ok(dup.every((e) => !e.selectable));
});

test("a line matching two existing phones needs attention and holds both phones from hiding", () => {
  const cat = [...catalog(), { ...product("Samsung A07", [variant("4 GB", "64 GB", "Black", 1)]), id: "dup", slug: "samsung-a07-2" }];
  const delta = run("Samsung\nA07 4/64 black @ 36900", cat);
  assert.equal(delta.entries[0].kind, "ambiguous");
  assert.equal(delta.entries[0].selectable, false);
  const held = delta.missing.filter((m) => m.productTitle === "Samsung A07");
  assert.equal(held.length, 2);
  assert.ok(held.every((m) => m.action === "held" && !m.selectable));
});

test("a new price at or above compare-at needs attention, is not applied, and holds that phone from hiding", () => {
  const cat = catalog();
  cat[0].variants[0].compareAtPriceMinor = 3800000;
  const delta = run("Samsung\nA07 4/64 black @ 38000", cat);
  assert.equal(delta.entries[0].kind, "ambiguous");
  assert.equal(delta.entries[0].provisionalKind, "price_change");
  assert.equal(delta.entries[0].selectable, false);
  const green = delta.missing.find((m) => m.sku === cat[0].variants[1].sku);
  assert.equal(green.action, "held");
});

// ---------------------------------------------------------------------------
// Latest list = current website availability (hide, never delete; show again when back)
// ---------------------------------------------------------------------------

test("Will Be Hidden: an Android variant missing from the list is hidden (is_active = false), not deleted", () => {
  const delta = run("Samsung\nA07 4/64 black @ 36900");
  const green = delta.missing.find((m) => m.scope === "variant" && m.productTitle === "Samsung A07");
  assert.ok(green, "the Green variant is missing");
  assert.equal(green.action, "hide");
  assert.ok(green.selectable && green.defaultSelected && green.isVisible);
  assert.ok(defaultSelection(delta).has(green.id));
  const plan = buildApplyPlan(delta, defaultSelection(delta));
  const hide = plan.actions.find((a) => a.op === "hide_variant");
  assert.equal(hide.variantId, green.variantId);
  assert.equal(hide.sku, green.sku);
  assert.match(hide.writes[0], /is_active = false/);
  assert.match(hide.writes[0], /not deleted/);
});

test("Will Be Hidden: an Android phone entirely missing from the list is hidden as a whole, not deleted or unpublished", () => {
  const delta = run("Samsung\nA07 4/64 black/green @ 36900");
  const a7 = delta.missing.find((m) => m.scope === "product" && m.productTitle === "Xiaomi A7 Pro");
  assert.equal(a7.action, "hide");
  assert.equal(a7.variantIds.length, 2, "every visible variant is switched off");
  assert.equal(delta.counts.willHide, 4);
  assert.equal(delta.counts.missingProducts, 4);
  const plan = buildApplyPlan(delta, defaultSelection(delta));
  const hides = plan.actions.filter((a) => a.op === "hide_product");
  assert.deepEqual(hides.map((a) => a.productTitle).sort(), ["Honor X5c+", "Motorola Edge 70 Fusion", "Samsung A37", "Xiaomi A7 Pro"]);
  assert.equal(plan.counts.hideProducts, 4);
  for (const hide of hides) {
    assert.match(hide.writes[0], /is_active = false/);
    assert.match(hide.writes[0], /products row, images, specifications and URL are untouched/);
    assert.doesNotMatch(hide.writes.join(" "), /publication_status|archived|delete/);
  }
});

test("the Owner can untick a hide; only ticked hides are planned", () => {
  const delta = run("Samsung\nA07 4/64 black @ 36900");
  const selected = defaultSelection(delta);
  const green = delta.missing.find((m) => m.scope === "variant");
  selected.delete(green.id);
  const plan = buildApplyPlan(delta, selected);
  assert.ok(plan.actions.every((a) => a.op !== "hide_variant"));
  assert.ok(plan.actions.filter((a) => a.op === "hide_product").length > 0);
});

test("an item that is already hidden stays hidden: no action, not selectable", () => {
  const cat = catalog();
  cat[0].variants[1].isActive = false; // Green already hidden by a previous update
  cat[1].variants.forEach((v) => (v.isActive = false)); // whole Xiaomi A7 Pro already hidden
  const delta = run("Samsung\nA07 4/64 black @ 36900", cat);
  const green = delta.missing.find((m) => m.sku === cat[0].variants[1].sku);
  assert.equal(green.action, "already_hidden");
  assert.equal(isHideSelectable(green), false);
  const a7 = delta.missing.find((m) => m.productTitle === "Xiaomi A7 Pro");
  assert.equal(a7.action, "already_hidden");
  assert.equal(a7.variantIds.length, 0);
  assert.equal(delta.counts.alreadyHidden, 2);
  const plan = buildApplyPlan(delta, new Set(delta.missing.map((m) => m.id)));
  assert.ok(plan.actions.every((a) => a.productId !== "p-Xiaomi A7 Pro"));
  assert.ok(plan.actions.every((a) => !(a.op === "hide_variant" && a.variantId === green.variantId)));
  assert.equal(plan.ignoredSelections.filter((i) => /already hidden/.test(i.reason)).length, 2);
});

test("a draft (never published) phone is not on the website, so nothing is hidden for it", () => {
  const cat = catalog();
  cat[4].publicationStatus = "draft";
  const delta = run("Samsung\nA07 4/64 black/green @ 36900", cat);
  const a37 = delta.missing.find((m) => m.productTitle === "Samsung A37");
  assert.equal(a37.action, "already_hidden");
  assert.equal(a37.isVisible, false);
});

test("Back On Website: a hidden variant that returns in the list is shown again (is_active = true), same SKU", () => {
  const cat = catalog();
  cat[0].variants[1].isActive = false;
  const delta = run("Samsung\nA07 4/64 black/green @ 36900", cat);
  const green = delta.entries[1];
  assert.equal(green.kind, "unchanged");
  assert.equal(green.showAgain, true);
  assert.ok(isSelectable(green) && green.defaultSelected);
  assert.equal(delta.counts.showAgain, 1);
  const plan = buildApplyPlan(delta, defaultSelection(delta));
  const show = plan.actions.find((a) => a.op === "show_variant");
  assert.equal(show.variantId, cat[0].variants[1].id);
  assert.equal(show.sku, cat[0].variants[1].sku);
  assert.match(show.writes[0], /is_active = true/);
  assert.equal(plan.counts.showAgain, 1);
});

test("Back On Website: a whole phone that was hidden returns with every listed variant switched on, nothing recreated", () => {
  const cat = catalog();
  cat[1].variants.forEach((v) => (v.isActive = false));
  const delta = run("Xiaomi\nA7pro 6/128 black/blue @ 36500", cat);
  assert.deepEqual(delta.entries.map((e) => [e.kind, e.showAgain, e.productId]), [["unchanged", true, "p-Xiaomi A7 Pro"], ["unchanged", true, "p-Xiaomi A7 Pro"]]);
  const plan = buildApplyPlan(delta, defaultSelection(delta));
  assert.equal(plan.actions.filter((a) => a.op === "show_variant").length, 2);
  assert.equal(plan.actions.filter((a) => a.op === "create_product" || a.op === "create_variant").length, 0);
});

test("a returning variant with a new price gets both: price update and show again", () => {
  const cat = catalog();
  cat[0].variants[1].isActive = false;
  const delta = run("Samsung\nA07 4/64 black @ 36900\nA07 4/64 green @ 37900", cat);
  const plan = buildApplyPlan(delta, defaultSelection(delta));
  assert.deepEqual(ops(plan).filter((op) => op !== "hide_product").sort(), ["show_variant", "update_price"]);
});

test("hide -> return -> hide round trip across three lists keeps the same variant ids and never creates or deletes", () => {
  const cat = catalog();
  const greenId = cat[0].variants[1].id;
  const plans = [];
  // List 1: Green absent -> hide.
  let delta = run("Samsung\nA07 4/64 black @ 36900", cat);
  plans.push(buildApplyPlan(delta, defaultSelection(delta)));
  assert.ok(plans[0].actions.some((a) => a.op === "hide_variant" && a.variantId === greenId));
  // List 2 (Green now hidden on the website): Green back -> show, same id.
  cat[0].variants[1].isActive = false;
  delta = run("Samsung\nA07 4/64 black/green @ 36900", cat);
  plans.push(buildApplyPlan(delta, defaultSelection(delta)));
  assert.ok(plans[1].actions.some((a) => a.op === "show_variant" && a.variantId === greenId));
  // List 3 (Green visible again): absent again -> hide, same id.
  cat[0].variants[1].isActive = true;
  delta = run("Samsung\nA07 4/64 black @ 36900", cat);
  plans.push(buildApplyPlan(delta, defaultSelection(delta)));
  assert.ok(plans[2].actions.some((a) => a.op === "hide_variant" && a.variantId === greenId));
  for (const plan of plans) assert.ok(plan.actions.every((a) => !a.op.startsWith("create_")), "nothing is created or deleted in a hide/show cycle");
});

test("a complete list that matches the website changes nothing and hides nothing", () => {
  const delta = run(FULL_LIST);
  assert.equal(delta.counts.unchanged, 7);
  assert.equal(delta.missing.length, 0);
  assert.equal(delta.counts.willHide, 0);
  assert.equal(buildApplyPlan(delta, defaultSelection(delta)).actions.length, 0);
});

// ---------------------------------------------------------------------------
// Preservation + safety
// ---------------------------------------------------------------------------

test("existing identity, images, specs, SKU, PTA, condition, URL and publication are preserved by every operation", () => {
  const cat = catalog();
  cat[0].variants[1].isActive = false;
  const delta = run("Samsung\nA07 4/64 black @ 37500\nA07 4/64 green @ 36900\nA07 4/128 blue @ 43500", cat);
  assert.ok(delta.entries.every((e) => e.productId === "p-Samsung A07" && e.productSlug === "samsung-a07"));
  assert.equal(delta.entries[0].mediaCount, 3);
  assert.equal(delta.entries[0].specCount, 10);
  const plan = buildApplyPlan(delta, defaultSelection(delta));
  const writes = plan.actions.flatMap((a) => a.writes).join(" | ");
  assert.doesNotMatch(writes, /product_media|product_specifications|products\.slug|publication_status|pta_status|condition|delete/i);
  for (const action of plan.actions) if (action.op === "update_price" || action.op === "show_variant") assert.match(action.sku, /^MB\d{3}$/);
  const preserved = plan.preserved.join(" | ");
  for (const word of ["Images", "Specification", "SKUs", "PTA", "Publication", "slugs", "Nothing is ever deleted"]) assert.match(preserved, new RegExp(word));
});

test("no delete operation exists anywhere in the plan model", () => {
  assert.ok(PLAN_OPERATIONS.every((op) => !/delete|remove|archive|unpublish/.test(op)));
  const cat = catalog();
  cat[0].variants[1].isActive = false;
  const delta = run("Samsung\nA07 4/64 black @ 37500\nA07 4/64 green @ 36900\nA07 4/128 blue @ 43500\nA97 8/256 black @ 120000\nNokia\n105 @ 7000", cat);
  const everything = new Set([...delta.entries.map((e) => e.id), ...delta.missing.map((m) => m.id)]);
  const plan = buildApplyPlan(delta, everything);
  assert.ok(plan.actions.length >= 6);
  assert.ok(plan.actions.every((a) => PLAN_OPERATIONS.includes(a.op)));
  assert.equal(plan.writesPerformed, false);
});

test("default ticks: price changes, new variants, returning variants and hides of visible items; never attention, non-Android, held, already hidden or same", () => {
  const cat = catalog();
  cat[1].variants[1].isActive = false;
  const delta = run("Samsung\nA07 4/64 black @ 37500\nA07 4/64 green @ 36900\nA07 4/128 black @ 43500\nXiaomi\nA7pro 6/128 blue @ 36500\nNokia\n105 @ 7000", cat);
  const selected = defaultSelection(delta);
  for (const entry of delta.entries) {
    assert.equal(selected.has(entry.id), entry.kind === "price_change" || entry.kind === "new_variant" || (entry.kind === "unchanged" && entry.showAgain), entry.id);
  }
  for (const entry of delta.missing) assert.equal(selected.has(entry.id), entry.action === "hide", entry.id);
});

test("the engine, its database adapter and the UI contain no write call", () => {
  for (const file of ["../src/lib/stockListDelta.ts", "../src/lib/stockListDeltaDb.ts", "../src/lib/stockUpdateWording.ts", "../src/admin/StockListUpdate.tsx"]) {
    const source = readFileSync(new URL(file, import.meta.url), "utf8");
    assert.doesNotMatch(source, /\.(insert|update|upsert)\s*\(|\.rpc\s*\(/, file);
    if (!file.endsWith(".tsx")) assert.doesNotMatch(source, /\.delete\s*\(/, file);
  }
  const ui = readFileSync(new URL("../src/admin/StockListUpdate.tsx", import.meta.url), "utf8");
  assert.match(ui, /Update Website/);
  assert.match(ui, /<button type="button" className="admin-primary" disabled title=/);
  // An unreadable list never leads to a check (it would otherwise plan to hide every Android phone).
  assert.match(ui, /if \(!parsedNow\.rows\.length\)/);
});
