import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  PLAN_OPERATIONS,
  buildApplyPlan,
  buildStockDelta,
  isAndroidCatalogProduct,
  willHide,
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
  assert.ok(delta.entries.every((e) => e.kind === "blocked" && !e.willUpdate && e.productId === null));
  assert.ok(delta.entries.every((e) => /not part of this Android update/.test(e.reasons[0])));
  // Non-Android lines produce no action at all; the only actions are hides of Android phones absent from this list.
  assert.ok(buildApplyPlan(delta).actions.every((a) => a.op === "hide_product" && !a.entryId.startsWith("row-")));
});

test("Android-only: iPhones, tablets, feature phones and accessories ON THE WEBSITE are never matched and never hidden", () => {
  assert.deepEqual(nonAndroid().map(isAndroidCatalogProduct), [false, false, false, false]);
  assert.ok(catalog().every(isAndroidCatalogProduct));
  const delta = run("Apple\niPhone 15 6/128 black @ 200000", [...catalog(), ...nonAndroid()]);
  // The iPhone line is outside the update even though the website has that iPhone.
  assert.equal(delta.entries[0].kind, "blocked");
  // Only the 5 Android phones are reported absent; the iPhone/tablet/Nokia/accessory are untouched.
  assert.deepEqual(delta.missing.map((m) => m.productTitle).sort(), ["Honor X5c+", "Motorola Edge 70 Fusion", "Samsung A07", "Samsung A37", "Xiaomi A7 Pro"]);
  const plan = buildApplyPlan(delta);
  assert.ok(plan.actions.every((a) => !["p-iphone", "p-pad", "p-nokia", "p-acc"].includes(a.productId)));
});

test("an Android line that cannot be read fully needs attention (not Not Android Phones) and can only be skipped", () => {
  const delta = run("Samsung\nA07 4/64 black");
  assert.equal(delta.entries[0].kind, "ambiguous");
  assert.equal(delta.counts.blocked, 0);
  assert.ok(delta.entries[0].reasons.some((r) => /Price or model missing/.test(r)));
  assert.equal(delta.entries[0].willUpdate, false);
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

test("Edge 70 is never merged with Edge 70 Fusion: it waits for the Owner, and Fusion is held (never hidden) meanwhile", () => {
  const delta = run("Motorola\nEdge 70 12/256 grey @ 99000");
  assert.equal(delta.entries[0].kind, "ambiguous");
  assert.equal(delta.entries[0].attention, "looks_like_existing");
  assert.equal(delta.entries[0].productId, null);
  assert.deepEqual(delta.entries[0].nearTitles, ["Motorola Edge 70 Fusion"]);
  assert.equal(delta.missing.find((m) => m.productTitle === "Motorola Edge 70 Fusion").action, "held");

  // Once the Owner confirms "this is a new phone", it is a new phone and Fusion follows the normal list rule again.
  const confirmed = buildStockDelta(parseStockList("Motorola\nEdge 70 12/256 grey @ 99000", brands), catalog(), [{ confirmNewPhone: true }]);
  assert.equal(confirmed.entries[0].kind, "new_product");
  assert.ok(confirmed.entries[0].notes.some((note) => /Edge 70 Fusion/.test(note)));
  assert.equal(confirmed.missing.find((m) => m.productTitle === "Motorola Edge 70 Fusion").action, "hide");
});

test("Same: an unchanged visible variant needs no price or visibility write", () => {
  const delta = run("Samsung\nA07 4/64 black @ 36900");
  assert.equal(delta.entries[0].kind, "unchanged");
  assert.equal(delta.counts.unchanged, 1);
  assert.equal(delta.entries[0].willUpdate, false);
});

test("Price Changed: changes only the price (current, new and difference shown)", () => {
  const delta = run("Samsung\nA07 4/64 black @ 37500");
  const entry = delta.entries[0];
  assert.equal(entry.kind, "price_change");
  assert.equal(entry.currentPriceMinor, 3690000);
  assert.equal(entry.newPriceMinor, 3750000);
  assert.equal(entry.diffMinor, 60000);
  assert.equal(entry.willUpdate, true);
  const plan = buildApplyPlan(delta);
  const price = plan.actions.find((a) => a.op === "update_price");
  assert.deepEqual(price.writes, ["product_variants.price_minor (price only)"]);
  assert.equal(price.variantId, entry.variantId);
  assert.equal(price.sku, entry.sku);
  // Besides the price: stock to 30 for the listed variant, and the absent Green is hidden. Nothing else.
  assert.deepEqual(plan.actions.filter((a) => a.productId === "p-Samsung A07" && a.op !== "update_price").map((a) => a.op).sort(), ["hide_variant", "set_stock"]);
  const stock = plan.actions.find((a) => a.op === "set_stock");
  assert.deepEqual([stock.variantId, stock.fromStock, stock.toStock], [entry.variantId, 10, 30]);
  assert.equal(plan.actions.find((a) => a.op === "hide_variant").label, "4 GB / 64 GB / Green");
});

test("New Variants: a new variant on an existing phone does not recreate the phone", () => {
  const delta = run("Samsung\nA07 4/128 black @ 43500");
  const entry = delta.entries[0];
  assert.equal(entry.kind, "new_variant");
  assert.equal(entry.productId, "p-Samsung A07");
  const plan = buildApplyPlan(delta);
  assert.ok(plan.actions.some((a) => a.op === "create_variant" && a.productId === "p-Samsung A07"));
  assert.equal(plan.counts.newProducts, 0);
});

test("New Phones: reports what is still required and groups its variants", () => {
  const delta = run("Samsung\nA97 8/256 black/blue @ 120000");
  assert.equal(delta.counts.newProducts, 1);
  assert.equal(delta.counts.newProductVariants, 2);
  assert.ok(delta.entries[0].requirements.some((r) => /Image/.test(r)));
  const plan = buildApplyPlan(delta);
  const created = plan.actions.filter((a) => a.op === "create_product");
  assert.equal(created.length, 1);
  assert.match(created[0].status, /Draft/);
  assert.equal(created[0].variants.length, 2);
});

test("an incomplete new phone cannot be left out: it needs attention (blocks the update) and is never created half-filled", () => {
  const delta = run("Samsung\nA98 8/256 @ 120000");
  assert.equal(delta.entries[0].kind, "ambiguous");
  assert.equal(delta.entries[0].provisionalKind, "new_product");
  assert.ok(delta.entries[0].reasons.some((r) => /New phone is missing RAM/.test(r)));
  assert.equal(buildApplyPlan(delta).actions.some((a) => a.op === "create_product"), false);
});

test("duplicate input lines need attention and are never written", () => {
  const delta = run("Samsung\nA07 4/64 black @ 37500\nA07 4/64 black @ 37500");
  const dup = delta.entries.filter((e) => e.kind === "ambiguous");
  assert.ok(dup.length >= 1);
  assert.ok(dup.every((e) => !e.willUpdate));
});

test("a line matching two existing phones needs attention and holds both phones from hiding", () => {
  const cat = [...catalog(), { ...product("Samsung A07", [variant("4 GB", "64 GB", "Black", 1)]), id: "dup", slug: "samsung-a07-2" }];
  const delta = run("Samsung\nA07 4/64 black @ 36900", cat);
  assert.equal(delta.entries[0].kind, "ambiguous");
  assert.equal(delta.entries[0].willUpdate, false);
  const held = delta.missing.filter((m) => m.productTitle === "Samsung A07");
  assert.equal(held.length, 2);
  assert.ok(held.every((m) => m.action === "held" && !willHide(m)));
});

test("a new price at or above compare-at needs attention, is not applied, and holds that phone from hiding", () => {
  const cat = catalog();
  cat[0].variants[0].compareAtPriceMinor = 3800000;
  const delta = run("Samsung\nA07 4/64 black @ 38000", cat);
  assert.equal(delta.entries[0].kind, "ambiguous");
  assert.equal(delta.entries[0].provisionalKind, "price_change");
  assert.equal(delta.entries[0].willUpdate, false);
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
  assert.ok(willHide(green) && green.isVisible);
  const plan = buildApplyPlan(delta);
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
  const plan = buildApplyPlan(delta);
  const hides = plan.actions.filter((a) => a.op === "hide_product");
  assert.deepEqual(hides.map((a) => a.productTitle).sort(), ["Honor X5c+", "Motorola Edge 70 Fusion", "Samsung A37", "Xiaomi A7 Pro"]);
  assert.equal(plan.counts.hideProducts, 4);
  for (const hide of hides) {
    assert.match(hide.writes[0], /is_active = false/);
    assert.match(hide.writes[0], /products row, images, specifications and URL are untouched/);
    assert.doesNotMatch(hide.writes.join(" "), /publication_status|archived|delete/);
  }
});

test("hides are mandatory: every visible Android item absent from the list is hidden; there is no way to keep it", () => {
  const delta = run("Samsung\nA07 4/64 black @ 36900");
  assert.equal(buildApplyPlan.length, 1, "the plan takes no selection argument");
  const plan = buildApplyPlan(delta);
  const hidden = new Set(plan.actions.filter((a) => a.op === "hide_variant").map((a) => a.variantId).concat(plan.actions.filter((a) => a.op === "hide_product").flatMap((a) => a.variantIds)));
  for (const entry of delta.missing.filter((m) => m.action === "hide")) for (const id of entry.variantIds) assert.ok(hidden.has(id), entry.productTitle);
  assert.equal(plan.counts.hideVariants + plan.counts.hideProducts, delta.counts.willHide);
});

test("an item that is already hidden stays hidden: no action", () => {
  const cat = catalog();
  cat[0].variants[1].isActive = false; // Green already hidden by a previous update
  cat[1].variants.forEach((v) => (v.isActive = false)); // whole Xiaomi A7 Pro already hidden
  const delta = run("Samsung\nA07 4/64 black @ 36900", cat);
  const green = delta.missing.find((m) => m.sku === cat[0].variants[1].sku);
  assert.equal(green.action, "already_hidden");
  assert.equal(willHide(green), false);
  const a7 = delta.missing.find((m) => m.productTitle === "Xiaomi A7 Pro");
  assert.equal(a7.action, "already_hidden");
  assert.equal(a7.variantIds.length, 0);
  assert.equal(delta.counts.alreadyHidden, 2);
  const plan = buildApplyPlan(delta);
  assert.ok(plan.actions.every((a) => a.productId !== "p-Xiaomi A7 Pro"));
  assert.ok(plan.actions.every((a) => !(a.op === "hide_variant" && a.variantId === green.variantId)));
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
  assert.equal(green.willUpdate, true);
  assert.equal(delta.counts.showAgain, 1);
  const plan = buildApplyPlan(delta);
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
  const plan = buildApplyPlan(delta);
  assert.equal(plan.actions.filter((a) => a.op === "show_variant").length, 2);
  assert.equal(plan.actions.filter((a) => a.op === "create_product" || a.op === "create_variant").length, 0);
});

test("a returning variant with a new price gets both: price update and show again", () => {
  const cat = catalog();
  cat[0].variants[1].isActive = false;
  const delta = run("Samsung\nA07 4/64 black @ 36900\nA07 4/64 green @ 37900", cat);
  const plan = buildApplyPlan(delta);
  assert.deepEqual(ops(plan).filter((op) => op !== "hide_product").sort(), ["set_stock", "set_stock", "show_variant", "update_price"]);
});

test("hide -> return -> hide round trip across three lists keeps the same variant ids and never creates or deletes", () => {
  const cat = catalog();
  const greenId = cat[0].variants[1].id;
  const plans = [];
  // List 1: Green absent -> hide.
  let delta = run("Samsung\nA07 4/64 black @ 36900", cat);
  plans.push(buildApplyPlan(delta));
  assert.ok(plans[0].actions.some((a) => a.op === "hide_variant" && a.variantId === greenId));
  // List 2 (Green now hidden on the website): Green back -> show, same id.
  cat[0].variants[1].isActive = false;
  delta = run("Samsung\nA07 4/64 black/green @ 36900", cat);
  plans.push(buildApplyPlan(delta));
  assert.ok(plans[1].actions.some((a) => a.op === "show_variant" && a.variantId === greenId));
  // List 3 (Green visible again): absent again -> hide, same id.
  cat[0].variants[1].isActive = true;
  delta = run("Samsung\nA07 4/64 black @ 36900", cat);
  plans.push(buildApplyPlan(delta));
  assert.ok(plans[2].actions.some((a) => a.op === "hide_variant" && a.variantId === greenId));
  for (const plan of plans) assert.ok(plan.actions.every((a) => !a.op.startsWith("create_")), "nothing is created or deleted in a hide/show cycle");
});

test("a complete list that matches the website: nothing hidden; only stock that is not 30 is corrected", () => {
  const delta = run(FULL_LIST);
  assert.equal(delta.counts.unchanged, 7);
  assert.equal(delta.missing.length, 0);
  assert.equal(delta.counts.willHide, 0);
  const plan = buildApplyPlan(delta);
  assert.deepEqual([...new Set(plan.actions.map((a) => a.op))], ["set_stock"]);
  assert.equal(plan.counts.stockUpdates, 7);
  const at30 = catalog().map((p) => ({ ...p, variants: p.variants.map((v) => ({ ...v, stock: 30 })) }));
  const settled = run(FULL_LIST, at30);
  assert.equal(buildApplyPlan(settled).actions.length, 0, "already 30 everywhere -> nothing to do");
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
  const plan = buildApplyPlan(delta);
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
  const plan = buildApplyPlan(delta);
  assert.ok(plan.actions.length >= 6);
  assert.ok(plan.actions.every((a) => PLAN_OPERATIONS.includes(a.op)));
  assert.equal(plan.writesPerformed, false);
});

test("the list is the final truth: price changes, new variants, returning variants and hides of visible items are always planned; attention, non-Android, held and already-hidden never", () => {
  const cat = catalog();
  cat[1].variants[1].isActive = false;
  const delta = run("Samsung\nA07 4/64 black @ 37500\nA07 4/64 green @ 36900\nA07 4/128 black @ 43500\nXiaomi\nA7pro 6/128 blue @ 36500\nNokia\n105 @ 7000", cat);
  for (const entry of delta.entries) {
    assert.equal(entry.willUpdate, entry.kind === "price_change" || entry.kind === "new_variant" || (entry.kind === "unchanged" && entry.showAgain), entry.id);
  }
  for (const entry of delta.missing) assert.equal(willHide(entry), entry.action === "hide", entry.id);
  const plan = buildApplyPlan(delta);
  assert.equal(plan.counts.priceUpdates, 1);
  assert.equal(plan.counts.newVariants, 1);
  assert.equal(plan.counts.showAgain, 1);
  assert.equal("ignoredSelections" in plan, false);
});

test("the engine, its database adapter and the UI contain no write call", () => {
  for (const file of ["../src/lib/stockListDelta.ts", "../src/lib/stockListDeltaDb.ts", "../src/lib/stockUpdateWording.ts", "../src/admin/StockListUpdate.tsx"]) {
    const source = readFileSync(new URL(file, import.meta.url), "utf8");
    assert.doesNotMatch(source, /\.(insert|update|upsert)\s*\(|\.rpc\s*\(/, file);
    if (!file.endsWith(".tsx")) assert.doesNotMatch(source, /\.delete\s*\(/, file);
  }
  const ui = readFileSync(new URL("../src/admin/StockListUpdate.tsx", import.meta.url), "utf8");
  assert.match(ui, /STEP\.update/);
  // The button can only open a confirmation; it is off while any gate (environment, fresh check, attention rows) fails.
  assert.match(ui, /disabled=\{Boolean\(openBlocker\) \|\| writing \|\| confirming\}/);
  // An unreadable list never leads to a check (it would otherwise plan to hide every Android phone).
  assert.match(ui, /if \(!parsedNow\.rows\.length\)/);
});

test("a phone whose list line has no readable price is held, never hidden", () => {
  const delta = run("Samsung\nA07 4/64 black/green @\n\nXiaomi\nA7pro 6/128 black/blue @ 36500");
  assert.ok(delta.entries.filter((e) => e.productTitle.startsWith("Samsung A07")).every((e) => e.kind === "ambiguous"));
  const a07 = delta.missing.filter((m) => m.productTitle === "Samsung A07");
  assert.equal(a07.length, 1);
  assert.equal(a07[0].action, "held");
  assert.equal(buildApplyPlan(delta).actions.some((a) => a.productId === "p-Samsung A07"), false);
});


// ---------------------------------------------------------------------------
// Stock rule (Owner, 2026-10-15): every Android item in the latest list is visible with stock 30
// ---------------------------------------------------------------------------

const withStock = (stock) => catalog().map((p) => ({ ...p, variants: p.variants.map((v) => ({ ...v, stock })) }));

test("stock 30: Same and Price Changed rows get stock 30 unless already 30, and the new price is always applied", () => {
  const delta = run("Samsung\nA07 4/64 black @ 37500\nA07 4/64 green @ 36900", withStock(12));
  const plan = buildApplyPlan(delta);
  assert.equal(plan.counts.priceUpdates, 1);
  assert.equal(plan.actions.find((a) => a.op === "update_price").toMinor, 3750000);
  assert.deepEqual(plan.actions.filter((a) => a.op === "set_stock").map((a) => [a.label, a.fromStock, a.toStock]), [["4 GB / 64 GB / Black", 12, 30], ["4 GB / 64 GB / Green", 12, 30]]);
  assert.match(plan.actions.find((a) => a.op === "set_stock").writes[0], /inventory_movements/);
});

test("stock 30: a row already at 30 gets no stock action; stock above 30 is brought down to 30", () => {
  const cat = withStock(30);
  cat[0].variants[1].stock = 45;
  const delta = run("Samsung\nA07 4/64 black/green @ 36900", cat);
  const stock = buildApplyPlan(delta).actions.filter((a) => a.op === "set_stock");
  assert.deepEqual(stock.map((a) => [a.label, a.fromStock, a.toStock]), [["4 GB / 64 GB / Green", 45, 30]]);
});

test("stock 30: a hidden item that returns is always shown AND set to 30 — it cannot be kept hidden", () => {
  const cat = withStock(3);
  cat[0].variants[1].isActive = false;
  const delta = run("Samsung\nA07 4/64 black/green @ 36900", cat);
  const green = delta.entries[1];
  assert.equal(green.willUpdate, true);
  const plan = buildApplyPlan(delta);
  assert.ok(plan.actions.some((a) => a.op === "show_variant" && a.variantId === green.variantId));
  assert.ok(plan.actions.some((a) => a.op === "set_stock" && a.variantId === green.variantId && a.toStock === 30));
});

test("page source: ticks are review marks only — the plan is built from the list alone and there is no Skip", () => {
  const ui = readFileSync(new URL("../src/admin/StockListUpdate.tsx", import.meta.url), "utf8");
  assert.match(ui, /buildPhonePlan\(delta, catalog, activeBrands\)/);
  assert.doesNotMatch(ui, /defaultSelection|isSelectable|isHideSelectable|skip_row/);
  assert.match(ui, /<th>Reviewed<\/th>/);
  assert.match(ui, /as reviewed`/);
  assert.doesNotMatch(ui, /disabled=\{!is/);
});

test("stock 30: hidden items (Will Be Hidden) only get is_active = false, never a stock change", () => {
  const delta = run("Samsung\nA07 4/64 black @ 36900", withStock(7));
  const plan = buildApplyPlan(delta);
  const hiddenIds = new Set(plan.actions.filter((a) => a.op === "hide_variant").map((a) => a.variantId).concat(plan.actions.filter((a) => a.op === "hide_product").flatMap((a) => a.variantIds)));
  assert.ok(hiddenIds.size > 0);
  assert.ok(plan.actions.filter((a) => a.op === "set_stock").every((a) => !hiddenIds.has(a.variantId)));
});

test("stock 30: new variants and new phones start at 30; attention and non-Android rows get no stock action", () => {
  const delta = run("Samsung\nA07 4/128 black @ 43500\nA97 8/256 black @ 120000\nA07 4/64 black/5g @ 36900\nNokia\n105 @ 7000", withStock(30));
  const plan = buildApplyPlan(delta);
  assert.equal(plan.actions.find((a) => a.op === "create_variant").stock, 30);
  assert.deepEqual(plan.actions.find((a) => a.op === "create_product").variants.map((v) => v.stock), [30]);
  assert.ok(delta.entries.filter((e) => e.kind === "new_variant" || e.kind === "new_product").every((e) => e.requirements.some((r) => r === "Stock: set to 30")));
  const attentionIds = new Set(delta.entries.filter((e) => e.kind === "ambiguous" || e.kind === "blocked").map((e) => e.variantId).filter(Boolean));
  assert.ok(plan.actions.filter((a) => a.op === "set_stock").every((a) => !attentionIds.has(a.variantId)));
});
