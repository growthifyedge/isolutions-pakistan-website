import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  TABLET_NEW_VARIANT_STOCK,
  buildTabletPlan,
  checkFingerprint,
  compareTabletList,
  emptyDecisions,
  parseTabletList,
} from "../src/lib/tabletStockUpdate.ts";
import { TABLET_WRITE_ENVIRONMENTS, runTabletUpdate, tabletUpdateBlocker } from "../src/lib/tabletStockApply.ts";

const DEV_URL = "https://acwatgxkcyrdxpcljxjb.supabase.co";
const PROD_URL = "https://nlxfwppywxumymbjkvwt.supabase.co";
const BRANDS = ["Apple", "Samsung", "Xiaomi", "Oppo", "Lenovo"].map((name) => ({ name }));

const OWNER_LIST = "Macbook Air M5 Now Available\n\n420500\n\n16-512Gb Midnight\n\nGalaxy Tab A8 4/64; 43,000\nDocomo D-52C 4/64; 26,500\nOppo Pad Air 4/64; 31,000\nLenovo Tab 4/64; 29,800";

const variant = (id, extra = {}) => ({
  id, sku: `IP${id.slice(-3).padStart(3, "0")}`, ram: "4 GB", storage: "64 GB", color: null, priceMinor: 4000000, compareAtPriceMinor: null, stock: 7,
  ptaStatus: "not_applicable", condition: "brand_new", conditionGrade: null, batteryHealth: null, cycleCount: null, isActive: true, ...extra,
});
const product = (id, title, extra = {}) => ({
  id, slug: title.toLowerCase().replace(/[^a-z0-9]+/g, "-"), title, brand: "Samsung", category: "Tablets", categorySlug: "tablets",
  publicationStatus: "published", mediaCount: 1, specCount: 0, variants: [variant(`${id}-v001`)], ...extra,
});
const select = (extra = {}) => ({ productType: "tablet", condition: "brand_new", connectivity: "wifi", ...extra });
const compare = (text, catalog = [], selection = select(), decisions = emptyDecisions()) => compareTabletList(parseTabletList(text, BRANDS), catalog, selection, decisions);
const kinds = (comparison) => comparison.entries.map((entry) => entry.kind);

// ---------------------------------------------------------------------------
// Parser
// ---------------------------------------------------------------------------

test("Parser: the Owner's MacBook block (heading, price line, configuration line) is ONE configuration", () => {
  const parsed = parseTabletList(OWNER_LIST, BRANDS);
  assert.deepEqual(parsed.unread, []);
  const macbook = parsed.lines[0];
  assert.deepEqual(
    [macbook.baseTitle, macbook.brand, macbook.ram, macbook.storage, macbook.colorWritten, macbook.priceMinor],
    ["Apple MacBook Air M5", "Apple", "16 GB", "512 GB", "Midnight", 42050000],
  );
  assert.match(macbook.notes.join(" "), /Now Available/);
});

test("Parser: one-line tablets — model, RAM/storage, no colour (stays blank), price after ';'", () => {
  const parsed = parseTabletList(OWNER_LIST, BRANDS);
  assert.deepEqual(parsed.lines.slice(1).map((line) => [line.baseTitle, line.brand, line.ram, line.storage, line.colorWritten, line.priceMinor]), [
    ["Samsung Galaxy Tab A8", "Samsung", "4 GB", "64 GB", null, 4300000],
    ["Docomo D-52C", null, "4 GB", "64 GB", null, 2650000],
    ["Oppo Pad Air", "Oppo", "4 GB", "64 GB", null, 3100000],
    ["Lenovo Tab", "Lenovo", "4 GB", "64 GB", null, 2980000],
  ]);
});

test("Parser: other formats — config then price, '@' prices, storage-only, colours split on '/'", () => {
  const parsed = parseTabletList("iPad Air M2\n8/256 Blue/Grey\n@ 210,000\n512GB Purple @ 260,000\nXiaomi Pad 2 WiFi 8/256 Grey 52,000", BRANDS);
  assert.deepEqual(parsed.unread, []);
  assert.deepEqual(parsed.lines.map((line) => [line.baseTitle, line.ram, line.storage, line.colorWritten, line.priceMinor / 100]), [
    ["Apple iPad Air M2", "8 GB", "256 GB", "Blue", 210000],
    ["Apple iPad Air M2", "8 GB", "256 GB", "Grey", 210000],
    ["Apple iPad Air M2", null, "512 GB", "Purple", 260000],
    ["Xiaomi Pad 2 WiFi", "8 GB", "256 GB", "Grey", 52000],
  ]);
  assert.equal(parsed.lines[3].listedConnectivity, "wifi");
});

test("Parser: ambiguous pairing is never guessed", () => {
  const parsed = parseTabletList(
    [
      "Macbook Air M5",
      "420500", //               2 price
      "430500", //               3 second price in a row: both unclear
      "16-512Gb Midnight", //    4 configuration without a price (nothing pairs with it)
      "Macbook Pro M4",
      "16/512 Black", //         6 config first ...
      "500000", //               7 ... then price: pair (sets the order)
      "650000", //               8 price before the next config: the other order, unclear
      "24/1TB Silver",
      "8/128 Gold", //           10 no model above
      "Macbook Air M4 420000", // 11 a price on a model line without RAM/storage
    ].join("\n").replace("8/128 Gold", "\n8/128 Gold").replace("Macbook Air M4", "\nMacbook Air M4"),
    BRANDS,
  );
  assert.deepEqual(parsed.lines.map((line) => [line.baseTitle, line.storage, line.priceMinor / 100]), [["Apple MacBook Pro M4", "512 GB", 500000]]);
  const reasons = parsed.unread.map((item) => `${item.line} => ${item.reason}`).join("\n");
  assert.match(reasons, /^420500 => Two prices in a row/m);
  assert.match(reasons, /^430500 => Two prices in a row/m);
  assert.match(reasons, /^16-512Gb Midnight => A configuration without a price/m);
  assert.match(reasons, /^650000 => .*different order/m);
  assert.match(reasons, /^24\/1TB Silver => .*different order/m);
  assert.match(reasons, /Macbook Air M4 420000 => A price on a model line without RAM\/storage/);
});

// ---------------------------------------------------------------------------
// Product type, brand, connectivity / PTA, condition
// ---------------------------------------------------------------------------

test("Owner's list as Tablets (WiFi, New): known brands are new products; the unknown brand waits; the MacBook is refused", () => {
  const comparison = compare(OWNER_LIST);
  const byTitle = Object.fromEntries(comparison.entries.map((entry) => [entry.line.baseTitle, entry]));
  assert.equal(byTitle["Samsung Galaxy Tab A8"].kind, "new_product");
  assert.equal(byTitle["Samsung Galaxy Tab A8"].pta, "not_applicable");
  assert.equal(byTitle["Oppo Pad Air"].kind, "new_product");
  assert.equal(byTitle["Lenovo Tab"].kind, "new_product");
  assert.equal(byTitle["Docomo D-52C"].kind, "attention");
  assert.match(byTitle["Docomo D-52C"].reasons.join(" "), /brand .* not recognised/);
  assert.equal(byTitle["Apple MacBook Air M5"].kind, "attention");
  assert.match(byTitle["Apple MacBook Air M5"].reasons.join(" "), /Apple product — choose iPad \(or MacBook\)/);
});

test("MacBook type: Apple MacBooks only, PTA Not Applicable; Windows laptops and tablets are refused", () => {
  const comparison = compare("Macbook Air M5 16/512 Midnight; 420,500\nLenovo ThinkPad 16/512; 300,000\nGalaxy Tab A8 4/64; 43,000", [], select({ productType: "macbook", connectivity: null }));
  assert.deepEqual(kinds(comparison), ["new_product", "attention", "attention"]);
  assert.equal(comparison.entries[0].pta, "not_applicable");
  assert.match(comparison.entries[1].reasons.join(" "), /only Apple MacBooks are sold; Windows laptops are never added/);
  assert.match(comparison.entries[2].reasons.join(" "), /not an Apple MacBook/);
  const plan = buildTabletPlan(comparison, []);
  assert.deepEqual(plan.products.map((item) => [item.payload.product_type, item.payload.category, item.payload.brand, item.categorySlug]), [["Laptop", "Laptops", "Apple", "laptops"]]);
});

test("iPad type: Apple iPads only; Android tablets are refused", () => {
  const comparison = compare("iPad Air M2 8/256 Blue; 210,000\nGalaxy Tab A8 4/64; 43,000", [], select({ productType: "ipad" }));
  assert.deepEqual(kinds(comparison), ["new_product", "attention"]);
  assert.match(comparison.entries[1].reasons.join(" "), /not an Apple iPad/);
});

test("Connectivity and PTA: from the Owner's choice, words on the line must agree, unclear waits", () => {
  const list = "Galaxy Tab A8 4/64; 43,000";
  assert.equal(compare(list, [], select({ connectivity: "cellular_pta" })).entries[0].pta, "approved");
  assert.equal(compare(list, [], select({ connectivity: "cellular_non_pta" })).entries[0].pta, "not_approved");
  assert.match(compare(list, [], select({ connectivity: null })).entries[0].reasons.join(" "), /Connectivity is not clear/);
  // The line says 4G (cellular) but the Owner chose WiFi Only.
  assert.match(compare("Galaxy Tab A8 4G 4/64; 43,000").entries[0].reasons.join(" "), /The list says Cellular but you chose WiFi Only/);
  // The line says 4G and nothing is chosen: PTA must still be given.
  assert.match(compare("Galaxy Tab A8 4G 4/64; 43,000", [], select({ connectivity: null })).entries[0].reasons.join(" "), /choose Cellular — PTA Approved or Cellular — Non-PTA/);
  assert.equal(compare("Galaxy Tab A8 4G 4/64 PTA; 43,000", [], select({ connectivity: null })).entries[0].pta, "approved");
  assert.match(compare("Galaxy Tab A8 WiFi 5G 4/64; 43,000", [], select({ connectivity: null })).entries[0].reasons.join(" "), /Both WiFi and Cellular/);
});

test("Product type and condition are required choices (or words on the line for New / Used)", () => {
  assert.match(compare("Galaxy Tab A8 4/64; 43,000", [], select({ productType: null })).entries[0].reasons.join(" "), /Choose iPad, Tablet or MacBook/);
  assert.match(compare("Galaxy Tab A8 4/64; 43,000", [], select({ condition: null })).entries[0].reasons.join(" "), /Choose New or Used/);
  const used = compare("Galaxy Tab A8 Used 4/64; 43,000", [], select({ condition: null }));
  assert.equal(used.entries[0].productTitle, "Samsung Galaxy Tab A8 (Used)");
});

// ---------------------------------------------------------------------------
// Matching against the website
// ---------------------------------------------------------------------------

test("Exact matching: price update keeps stock; hidden variant is shown again; RAM is part of the variant", () => {
  const catalog = [product("p1", "Samsung Galaxy Tab A8", { variants: [variant("p1-v001", { priceMinor: 4000000 }), variant("p1-v002", { ram: "3 GB", priceMinor: 3500000, isActive: false })] })];
  const comparison = compare("Galaxy Tab A8 4/64; 43,000\nGalaxy Tab A8 3/64; 36,000\nGalaxy Tab A8 6/64; 50,000", catalog);
  assert.deepEqual(kinds(comparison), ["price_change", "show_again", "new_variant"]);
  const plan = buildTabletPlan(comparison, catalog);
  assert.equal(plan.products.length, 1);
  assert.deepEqual(plan.products[0].payload.steps, [
    { kind: "price", variant_id: "p1-v001", from_minor: 4000000, to_minor: 4300000 },
    { kind: "show", variant_id: "p1-v002", from_minor: 3500000, to_minor: 3600000 },
    { kind: "add_variant", ram: "6 GB", storage: "64 GB", color: null, price_minor: 5000000, stock: TABLET_NEW_VARIANT_STOCK, pta_status: "not_applicable", condition: "brand_new" },
  ]);
  assert.deepEqual(plan.products[0].payload.expected.variants.map((item) => item.id), ["p1-v001", "p1-v002"]);
});

test("New and Used are separate; a product with the other condition's variants is never touched", () => {
  const catalog = [product("p1", "Samsung Galaxy Tab A8", { variants: [variant("p1-v001", { condition: "used" })] })];
  const comparison = compare("Galaxy Tab A8 4/64; 43,000", catalog);
  assert.equal(comparison.entries[0].kind, "attention");
  assert.match(comparison.entries[0].reasons.join(" "), /never updated by a New list/);
  const used = compare("Galaxy Tab A8 4/64; 43,000", [product("p2", "Samsung Galaxy Tab A8 (Used)", { variants: [variant("p2-v001", { condition: "used" })] })], select({ condition: "used" }));
  assert.equal(used.entries[0].kind, "price_change");
});

test("Existing DEV-style drafts (condition unknown) are held, never normalised", () => {
  const catalog = [product("d1", "Samsung Tab A11 WiFi", { publicationStatus: "draft", variants: [variant("d1-v001", { condition: "unknown", ptaStatus: "unknown" })] })];
  const comparison = compare("Samsung Tab A11 WiFi 4/64; 30,000", catalog);
  assert.equal(comparison.entries[0].kind, "attention");
  assert.equal(buildTabletPlan(comparison, catalog).products.length, 0);
});

test("Unclear identity waits: blank RAM / colour on one side, duplicate titles, other category, duplicate lines", () => {
  const blankRam = [product("p1", "Samsung Galaxy Tab A8", { variants: [variant("p1-v001", { ram: null })] })];
  assert.match(compare("Galaxy Tab A8 4/64; 43,000", blankRam).entries[0].reasons.join(" "), /may be the same item/);
  const colored = [product("p1", "Samsung Galaxy Tab A8", { variants: [variant("p1-v001", { color: "Grey" })] })];
  assert.match(compare("Galaxy Tab A8 4/64; 43,000", colored).entries[0].reasons.join(" "), /may be the same item/);
  const twice = [product("p1", "Samsung Galaxy Tab A8"), product("p2", "Samsung Galaxy Tab A8")];
  assert.match(compare("Galaxy Tab A8 4/64; 43,000", twice).entries[0].reasons.join(" "), /More than one product/);
  const phone = [product("p1", "Samsung Galaxy Tab A8", { category: "Mobile Phones", categorySlug: "mobile-phones" })];
  assert.match(compare("Galaxy Tab A8 4/64; 43,000", phone).entries[0].reasons.join(" "), /not in Tablets/);
  const dup = compare("Galaxy Tab A8 4/64; 43,000\nGalaxy Tab A8 4/64; 44,000");
  assert.deepEqual(kinds(dup), ["attention", "attention"]);
  const windows = [product("w1", "Apple MacBook Air M5", { brand: "Lenovo", category: "Laptops", categorySlug: "laptops" })];
  assert.match(compare("Macbook Air M5 16/512 Midnight; 420,500", windows, select({ productType: "macbook" })).entries[0].reasons.join(" "), /only Apple MacBooks are updated/);
});

test("A look-alike new product needs the Owner's confirmation; an unknown colour needs 'Keep'", () => {
  // The same model exists only as the Used listing; A8 vs A9 (different digits) is never a look-alike.
  const catalog = [product("p1", "Samsung Galaxy Tab A8 (Used)", { variants: [variant("p1-v001", { condition: "used" })] }), product("p2", "Samsung Galaxy Tab A9")];
  const comparison = compare("Galaxy Tab A8 4/64; 43,000", catalog);
  assert.equal(comparison.entries[0].kind, "attention");
  assert.deepEqual(comparison.entries[0].confirmNewProduct, ["Samsung Galaxy Tab A8 (Used)"]);
  const confirmed = compare("Galaxy Tab A8 4/64; 43,000", catalog, select(), { colors: {}, newProducts: { samsunggalaxytaba8: true } });
  assert.equal(confirmed.entries[0].kind, "new_product");
  const odd = compare("Galaxy Tab A8 4/64 Blushh; 43,000");
  assert.equal(odd.entries[0].kind, "attention");
  assert.equal(odd.entries[0].colorDecision.written, "Blushh");
  const kept = compare("Galaxy Tab A8 4/64 Blushh; 43,000", [], select(), { colors: { [odd.entries[0].line.lineKey]: "Blushh" }, newProducts: {} });
  assert.equal(kept.entries[0].kind, "new_product");
});

test("Plan: new products are drafts with stock 20, Karachi only, blank warranty / SIM / grade; facts not given stay blank", () => {
  const plan = buildTabletPlan(compare("Galaxy Tab A8 4/64; 43,000\niPad Air M2 8/256 Blue; 210,000"), []);
  assert.equal(plan.products.length, 1);
  assert.deepEqual(plan.products[0].payload, {
    source: "Tablets & MacBooks Stock Update: Samsung Galaxy Tab A8",
    action: "Create",
    product_type: "Tablet",
    brand: "Samsung",
    category: "Tablets",
    title: "Samsung Galaxy Tab A8",
    variants: [{
      source: "Line 1: 4 GB / 64 GB",
      ram: "4 GB", storage: "64 GB", color: null, price_minor: 4300000, stock: 20, pta_status: "not_applicable", condition: "brand_new",
      condition_grade: null, battery_health_percent: null, battery_cycle_count: null, sim_configuration: null, warranty: null, delivery_scope: "karachi_only",
    }],
  });
  assert.equal(plan.held.length, 1, "the iPad line is held: an Apple product on a Tablet list");
});

test("Fingerprint changes with the list, every choice and every decision", () => {
  const base = checkFingerprint("x", select(), emptyDecisions());
  assert.notEqual(base, checkFingerprint("y", select(), emptyDecisions()));
  assert.notEqual(base, checkFingerprint("x", select({ productType: "ipad" }), emptyDecisions()));
  assert.notEqual(base, checkFingerprint("x", select({ connectivity: "cellular_pta" }), emptyDecisions()));
  assert.notEqual(base, checkFingerprint("x", select(), { colors: {}, newProducts: { a: true } }));
});

// ---------------------------------------------------------------------------
// Write path (offline fake database) and the switch
// ---------------------------------------------------------------------------

test("Update Website is approved for DEV and PROD; build mode and project must match", () => {
  assert.deepEqual([...TABLET_WRITE_ENVIRONMENTS], ["development", "production"]);
  const plan = buildTabletPlan(compare("Galaxy Tab A8 4/64; 43,000"), []);
  const base = { supabaseUrl: DEV_URL, buildMode: "development", enabled: true, checkIsCurrent: true, plan };
  assert.match(tabletUpdateBlocker({ ...base, enabled: false }), /switched off/);
  assert.equal(tabletUpdateBlocker(base), null);
  assert.equal(tabletUpdateBlocker({ ...base, supabaseUrl: PROD_URL, buildMode: "production" }), null);
  assert.match(tabletUpdateBlocker({ ...base, supabaseUrl: PROD_URL, buildMode: "development" }), /Blocked/);
  const page = readFileSync(new URL("../src/admin/TabletStockUpdate.tsx", import.meta.url), "utf8");
  assert.match(page, /const TABLET_UPDATE_WEBSITE_ENABLED = true;/);
  assert.equal(page.includes("testWriteEnvironments"), false);
  assert.match(page, /window\.confirm\(`Update the \$\{supabaseEnvironmentLabel\.toUpperCase\(\)\} website now\?/);
  const app = readFileSync(new URL("../src/admin/AdminApp.tsx", import.meta.url), "utf8");
  assert.match(app, /\["Tablets & MacBooks", "\/admin\/tablet-stock-update", Tablet\]/);
  assert.match(app, /path === "\/admin\/tablet-stock-update"/);
});

function fakeDb(catalog) {
  const variants = new Map();
  const stock = new Map();
  const products = new Map();
  for (const item of catalog) {
    products.set(item.id, { id: item.id, title: item.title, publication_status: item.publicationStatus });
    for (const row of item.variants) {
      variants.set(row.id, { id: row.id, product_id: item.id, sku: row.sku, ram_display: row.ram, storage_display: row.storage, color_finish: row.color, price_minor: row.priceMinor, is_active: row.isActive, pta_status: row.ptaStatus, condition: row.condition, delivery_scope: "karachi_only", warranty_override: null, condition_grade: null, battery_health_percent: null, battery_cycle_count: null, sim_configuration: null, compare_at_price_minor: null });
      stock.set(row.id, row.stock);
    }
  }
  let next = 100;
  const calls = [];
  const snapshot = (productId) => ({
    productId,
    product: { ...products.get(productId) },
    media: [],
    specifications: [],
    variants: Object.fromEntries([...variants.values()].filter((row) => row.product_id === productId).map((row) => [row.id, { ...row }])),
    stock: Object.fromEntries([...variants.values()].filter((row) => row.product_id === productId).map((row) => [row.id, stock.get(row.id)])),
  });
  const deps = {
    supabaseUrl: DEV_URL,
    buildMode: "development",
    testWriteEnvironments: ["development"],
    readSnapshot: async (productId) => snapshot(productId),
    applyProduct: async (payload) => {
      calls.push(["apply", payload.product_id]);
      const created = [];
      for (const step of payload.steps) {
        if (step.kind === "price" || step.kind === "show") Object.assign(variants.get(step.variant_id), { price_minor: step.to_minor, is_active: true });
        else {
          const id = `new-${(next += 1)}`;
          variants.set(id, { id, product_id: payload.product_id, sku: `IP${next}`, ram_display: step.ram, storage_display: step.storage, color_finish: step.color, price_minor: step.price_minor, is_active: true, pta_status: step.pta_status, condition: step.condition, delivery_scope: "karachi_only", warranty_override: null, condition_grade: null, battery_health_percent: null, battery_cycle_count: null, sim_configuration: null, compare_at_price_minor: null });
          stock.set(id, step.stock);
          created.push({ id, sku: `IP${next}` });
        }
      }
      return { status: "updated", new_variants: created };
    },
    createProduct: async (payload) => {
      calls.push(["create", payload.title]);
      const id = `prod-${(next += 1)}`;
      products.set(id, { id, title: payload.title, publication_status: "draft" });
      const skus = payload.variants.map((row) => {
        const variantId = `new-${(next += 1)}`;
        variants.set(variantId, { id: variantId, product_id: id, sku: `${payload.category === "Laptops" ? "MC" : "IP"}${next}`, ram_display: row.ram, storage_display: row.storage, color_finish: row.color, price_minor: row.price_minor, is_active: true, pta_status: row.pta_status, condition: row.condition, delivery_scope: row.delivery_scope });
        stock.set(variantId, row.stock);
        return { product: payload.title, sku: variants.get(variantId).sku };
      });
      return { products: [{ id, title: payload.title, action: "Create" }], assigned_skus: skus };
    },
    readCreatedProduct: async (productId) => {
      const snap = snapshot(productId);
      return { publicationStatus: snap.product.publication_status, variants: Object.values(snap.variants).map((row) => ({ sku: row.sku, ram: row.ram_display, storage: row.storage_display, color: row.color_finish, pta: row.pta_status, delivery: row.delivery_scope, stock: snap.stock[row.id] })) };
    },
  };
  return { deps, calls, variants, stock };
}

test("Update Website (offline): existing product updated and verified; new product created as a draft; held lines untouched", async () => {
  const catalog = [product("p1", "Samsung Galaxy Tab A8", { variants: [variant("p1-v001", { priceMinor: 4000000 })] })];
  const comparison = compare("Galaxy Tab A8 4/64; 43,000\nGalaxy Tab A8 6/128; 55,000\nOppo Pad Air 4/64; 31,000\nDocomo D-52C 4/64; 26,500", catalog);
  const plan = buildTabletPlan(comparison, catalog);
  const db = fakeDb(catalog);
  const result = await runTabletUpdate(db.deps, plan);
  assert.equal(result.outcome, "finished");
  assert.deepEqual(result.products.map((item) => [item.productTitle, item.status]), [["Samsung Galaxy Tab A8", "updated"], ["Oppo Pad Air", "updated"], ["Docomo D-52C", "held"]]);
  assert.equal(db.variants.get("p1-v001").price_minor, 4300000);
  assert.equal(db.stock.get("p1-v001"), 7, "existing stock kept");
  assert.ok(result.products[0].checks.every((item) => item.ok), JSON.stringify(result.products[0].checks.filter((item) => !item.ok)));
  assert.deepEqual(db.calls, [["apply", "p1"], ["create", "Oppo Pad Air"]]);

  const blocked = await runTabletUpdate({ ...fakeDb(catalog).deps, supabaseUrl: PROD_URL, buildMode: "production", testWriteEnvironments: [] }, plan);
  assert.equal(blocked.outcome, "blocked");
  assert.match(blocked.message, /not approved.*Nothing was written/);
});

// ---------------------------------------------------------------------------
// Smart Paste: natural supplier / WhatsApp lists (Owner examples 2026-10-28)
// ---------------------------------------------------------------------------

const OWNER_MACBOOK = "Macbook Air M5 16-256Gb\n\nSkyBlue 397,000\nSilver @402,000\nMidnight @397,000";
const OWNER_TABLETS = "Samsung A11 8-128Gb @59,000\n\nSamsung Tab S10 Lite 6-128Gb@98,500\n6-256Gb @115,000";
const facts = (parsed) => parsed.lines.map((line) => [line.lineNumber, line.baseTitle, line.ram, line.storage, line.colorWritten, line.priceMinor / 100]);

test("Smart Paste: Owner MacBook example — model + RAM/storage heading, then one colour + price per line", () => {
  const parsed = parseTabletList(OWNER_MACBOOK, BRANDS);
  assert.deepEqual(parsed.unread, []);
  assert.deepEqual(facts(parsed), [
    [3, "Apple MacBook Air M5", "16 GB", "256 GB", "Skyblue", 397000],
    [4, "Apple MacBook Air M5", "16 GB", "256 GB", "Silver", 402000],
    [5, "Apple MacBook Air M5", "16 GB", "256 GB", "Midnight", 397000],
  ]);
  // Three distinct variants of ONE new draft product; "Skyblue" is an unknown colour and waits for the Owner's "Keep".
  const selection = select({ productType: "macbook", connectivity: null });
  const held = compare(OWNER_MACBOOK, [], selection);
  assert.deepEqual(kinds(held), ["attention", "new_product", "new_product"]);
  assert.match(held.entries[0].reasons.join(" "), /“Skyblue” is not a known colour/);
  const kept = compare(OWNER_MACBOOK, [], selection, { colors: { [held.entries[0].line.lineKey]: "Skyblue" }, newProducts: {} });
  assert.deepEqual(kinds(kept), ["new_product", "new_product", "new_product"]);
  const plan = buildTabletPlan(kept, []);
  assert.equal(plan.products.length, 1);
  assert.deepEqual(plan.products[0].payload.variants.map((item) => [item.ram, item.storage, item.color, item.price_minor / 100, item.stock, item.pta_status, item.warranty]), [
    ["16 GB", "256 GB", "Skyblue", 397000, 20, "not_applicable", null],
    ["16 GB", "256 GB", "Silver", 402000, 20, "not_applicable", null],
    ["16 GB", "256 GB", "Midnight", 397000, 20, "not_applicable", null],
  ]);
});

test("Smart Paste: Owner tablet example — one-line entries and a second storage under the same model", () => {
  const parsed = parseTabletList(OWNER_TABLETS, BRANDS);
  assert.deepEqual(parsed.unread, []);
  assert.deepEqual(facts(parsed), [
    [1, "Samsung A11", "8 GB", "128 GB", null, 59000],
    [3, "Samsung Tab S10 Lite", "6 GB", "128 GB", null, 98500],
    [4, "Samsung Tab S10 Lite", "6 GB", "256 GB", null, 115000],
  ]);
  assert.match(parsed.lines[2].notes.join(" "), /read from line 3 above/);
  const comparison = compare(OWNER_TABLETS);
  assert.deepEqual(kinds(comparison), ["new_product", "new_product", "new_product"]);
  // Nothing guessed: colour and warranty stay blank; PTA comes from the Owner's WiFi choice.
  const plan = buildTabletPlan(comparison, []);
  assert.deepEqual(plan.products.map((item) => [item.productTitle, item.payload.variants.length]), [["Samsung A11", 1], ["Samsung Tab S10 Lite", 2]]);
  assert.ok(plan.products.flatMap((item) => item.payload.variants).every((item) => item.color === null && item.warranty === null && item.pta_status === "not_applicable"));
});

test("Smart Paste: several products and configurations in one list, mixed separators and spacing", () => {
  const list = [
    "Macbook Air M5",
    "16-256Gb",
    "  SkyBlue   Rs 397,000",
    "silver - 402,000",
    "16/512GB",
    "Midnight: 450,000",
    "",
    "Galaxy Tab S9 FE 8/128 @ 95,000",
    "8GB-256GB @105,000",
    "Lenovo Tab 4/64; 29,800",
  ].join("\n");
  const parsed = parseTabletList(list, BRANDS);
  assert.deepEqual(parsed.unread, []);
  assert.deepEqual(facts(parsed), [
    [3, "Apple MacBook Air M5", "16 GB", "256 GB", "Skyblue", 397000],
    [4, "Apple MacBook Air M5", "16 GB", "256 GB", "Silver", 402000],
    [6, "Apple MacBook Air M5", "16 GB", "512 GB", "Midnight", 450000],
    [8, "Samsung Galaxy Tab S9 FE", "8 GB", "128 GB", null, 95000],
    [9, "Samsung Galaxy Tab S9 FE", "8 GB", "256 GB", null, 105000],
    [10, "Lenovo Tab", "4 GB", "64 GB", null, 29800],
  ]);
});

test("Smart Paste: colours split on '/' share the line's price; two colours with different prices stay separate", () => {
  const parsed = parseTabletList("iPad Air M3 8/128\nBlue/Grey 210,000\nPurple 215,000", BRANDS);
  assert.deepEqual(parsed.unread, []);
  assert.deepEqual(facts(parsed).map((row) => [row[4], row[5]]), [["Blue", 210000], ["Grey", 210000], ["Purple", 215000]]);
});

test("Smart Paste: missing price / storage / model and unclear grouping wait for the Owner (never guessed)", () => {
  const reasonsOf = (text) => parseTabletList(text, BRANDS).unread.map((item) => `${item.line} => ${item.reason}`).join("\n");
  // A colour without a price.
  assert.match(reasonsOf("Macbook Air M5 16-256Gb\nSilver\nMidnight 397,000"), /^Silver => A colour without a price/m);
  // A colour + price under a model heading without RAM/storage.
  assert.match(reasonsOf("Macbook Air M5\nSilver 402,000"), /^Silver 402,000 => A colour and price under “Apple MacBook Air M5”, but no RAM\/storage/m);
  // A colour + price with nothing above it.
  assert.match(reasonsOf("Silver 402,000"), /^Silver 402,000 => A colour and price without a model and RAM\/storage/m);
  // The configuration already has a colour, then colour + price lines: which price is for which colour is unclear.
  const twice = reasonsOf("Macbook Air M5 16-256Gb Midnight\nSilver 402,000");
  assert.match(twice, /^Macbook Air M5 16-256Gb Midnight => This configuration already has a colour/m);
  assert.match(twice, /^Silver 402,000 => A colour and price/m);
  // A storage line without a price under a one-line entry.
  assert.match(reasonsOf("Samsung Tab S10 Lite 6-128Gb@98,500\n6-256Gb"), /^6-256Gb => A configuration without a price under “Samsung Tab S10 Lite”/m);
  // A storage line with a price but no model anywhere above.
  assert.match(reasonsOf("6-256Gb @115,000"), /^6-256Gb @115,000 => A configuration without a model heading above it/m);
  // A new model line breaks the colour group: its price never attaches to the previous model.
  const parsed = parseTabletList("Macbook Air M5 16-256Gb\nSilver 402,000\nGalaxy Tab A9 @45,000", BRANDS);
  assert.deepEqual(facts(parsed), [[2, "Apple MacBook Air M5", "16 GB", "256 GB", "Silver", 402000]]);
  assert.match(parsed.unread.map((item) => item.reason).join(" "), /A price on a model line without RAM\/storage/);
});

test("Smart Paste: model words, brands and connectivity words are never read as colours", () => {
  const parsed = parseTabletList("Macbook Air M5 16-256Gb\nLenovo 402,000\nWiFi 402,000\nPro 402,000", BRANDS);
  assert.deepEqual(parsed.lines, []);
  assert.ok(parsed.unread.length >= 3);
});

test("Smart Paste: the same colour twice (with two prices) waits as a duplicate", () => {
  const comparison = compare("Macbook Air M5 16-256Gb\nSilver 397,000\nSilver 402,000", [], select({ productType: "macbook", connectivity: null }));
  assert.deepEqual(kinds(comparison), ["attention", "attention"]);
  assert.match(comparison.entries[0].reasons.join(" "), /listed more than once \(lines 2, 3\)/);
});

test("Smart Paste: Used + existing product — exact title, price only, stock kept, missing variants untouched", () => {
  const macbook = (id, extra) => variant(id, { ram: "16 GB", storage: "256 GB", ptaStatus: "not_applicable", condition: "used", stock: 3, ...extra });
  const catalog = [
    product("m1", "Apple MacBook Air M5 (Used)", {
      brand: "Apple", category: "Laptops", categorySlug: "laptops",
      variants: [macbook("m1-v001", { color: "Silver", priceMinor: 39000000 }), macbook("m1-v002", { color: "Starlight", priceMinor: 38000000 })],
    }),
  ];
  const comparison = compare("Macbook Air M5 16-256Gb Used\nSilver @402,000\nMidnight 397,000", catalog, select({ productType: "macbook", condition: null, connectivity: null }));
  assert.deepEqual(comparison.entries.map((entry) => [entry.productTitle, entry.kind, entry.stock]), [
    ["Apple MacBook Air M5 (Used)", "price_change", 3],
    ["Apple MacBook Air M5 (Used)", "new_variant", null],
  ]);
  const plan = buildTabletPlan(comparison, catalog);
  assert.deepEqual(plan.products[0].payload.steps.map((step) => step.kind), ["price", "add_variant"]);
  assert.ok(!plan.products[0].payload.steps.some((step) => step.variant_id === "m1-v002"));
  // The same list as New never touches the Used product.
  const asNew = compare("Macbook Air M5 16-256Gb\nSilver @402,000", catalog, select({ productType: "macbook", connectivity: null }));
  assert.equal(asNew.entries[0].productTitle, "Apple MacBook Air M5");
  assert.notEqual(asNew.entries[0].productId, "m1");
});
