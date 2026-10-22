import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  IPHONE_NEW_VARIANT_STOCK,
  buildIphonePlan,
  checkFingerprint,
  compareIphoneList,
  emptyDecisions,
  parseIphoneList,
} from "../src/lib/iphoneStockUpdate.ts";
import { IPHONE_WRITE_ENVIRONMENTS, iphoneUpdateBlocker, runIphoneUpdate } from "../src/lib/iphoneStockApply.ts";
import { PhoneWriteError } from "../src/lib/stockUpdateApply.ts";
import { normalizeColor } from "../src/lib/catalogColors.ts";
import { SKIPPED_NO_COLOUR } from "../src/lib/iphoneStockUpdate.ts";
import { parseStockList } from "../src/lib/stockListDelta.ts";

const BRANDS = [{ name: "Apple" }, { name: "Samsung" }];
const USED_PTA = { condition: "used", pta: "approved" };
const DEV_URL = "https://acwatgxkcyrdxpcljxjb.supabase.co";
const PROD_URL = "https://nlxfwppywxumymbjkvwt.supabase.co";

// The Owner's sample list (2026-10-21), exactly as sent. All lines are Used, PTA Approved (Owner-confirmed).
const SAMPLE = `IPhone 15Pro Max 512Gb
Blue @298,000
Black @298,000

IPhone 15Pro Max 256Gb
Natural @280,000
Blaxk @274,000
Blue @274,000

IPhone 14Pro Max 1TB
Purple @265,000
Black @263,000

IPhone 14Pro Max 512Gb
purple @259,000
black @259,000
White @259,000

IPhone 14Pro Max 256Gb
Purple @230,000
Gold @235,000
Black @230,000
White@230,000`;

let seq = 0;
const variant = (over = {}) => ({
  id: `v${++seq}`,
  sku: `MB${String(500 + seq).padStart(3, "0")}`,
  ram: null,
  storage: "256 GB",
  color: "Black",
  priceMinor: 23000000,
  compareAtPriceMinor: null,
  stock: 7,
  ptaStatus: "approved",
  condition: "used",
  conditionGrade: null,
  batteryHealth: null,
  cycleCount: null,
  isActive: true,
  warrantyOverride: null,
  deliveryScope: "karachi_only",
  ...over,
});
const product = (title, variants, over = {}) => ({
  id: `p-${title}`,
  slug: title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""),
  title,
  brand: "Apple",
  category: "Mobile Phones",
  categorySlug: "mobile-phones",
  publicationStatus: "draft",
  mediaCount: 0,
  specCount: 0,
  variants,
  ...over,
});
const android = product("Samsung A57", [variant({ condition: "brand_new", storage: "256 GB", ram: "8 GB" })], { brand: "Samsung" });

/** The 3 Apple test products on DEV (read-only check 2026-10-21), as the page would load them. */
const devApple = () => [
  product("Apple iPhone 15 Pro", [variant({ sku: "MB003", color: "Natural", ptaStatus: "not_approved", priceMinor: 26500000, conditionGrade: "A++", batteryHealth: 89, cycleCount: 312, stock: 10 })]),
  product("Apple iPhone 15 Pro Max", [variant({ sku: "MB312", color: "Natural Titanium", priceMinor: 25000000, conditionGrade: "A++", batteryHealth: 89, cycleCount: 312, stock: 10 })]),
  product("Apple iPhone 18 Pro Max", [variant({ sku: "MB311", condition: "brand_new", priceMinor: 49000000, stock: 10 })]),
];

const run = (text, catalog, selection = USED_PTA, decisions = emptyDecisions()) => {
  const comparison = compareIphoneList(parseIphoneList(text, BRANDS), catalog, selection, decisions);
  return { comparison, plan: buildIphonePlan(comparison, catalog) };
};

// ---------------------------------------------------------------------------
// The Owner's sample
// ---------------------------------------------------------------------------

test("sample: every colour line is read under its heading (14 colour lines in the sample text), with model, storage and price", () => {
  const parsed = parseIphoneList(SAMPLE, BRANDS);
  assert.equal(parsed.unread.length, 0);
  assert.equal(parsed.lines.length, 14);
  const first = parsed.lines[0];
  assert.equal(first.baseTitle, "Apple iPhone 15 Pro Max");
  assert.equal(first.storage, "512 GB");
  assert.equal(first.colorWritten, "Blue");
  assert.equal(first.priceMinor, 29800000);
  const white = parsed.lines.at(-1);
  assert.equal(white.baseTitle, "Apple iPhone 14 Pro Max");
  assert.equal(white.storage, "256 GB");
  assert.equal(white.colorWritten, "White");
  assert.equal(white.priceMinor, 23000000);
  assert.deepEqual([...new Set(parsed.lines.map((line) => `${line.baseTitle} ${line.storage}`))], [
    "Apple iPhone 15 Pro Max 512 GB",
    "Apple iPhone 15 Pro Max 256 GB",
    "Apple iPhone 14 Pro Max 1 TB",
    "Apple iPhone 14 Pro Max 512 GB",
    "Apple iPhone 14 Pro Max 256 GB",
  ]);
  // Nothing on the lines says New / Used / PTA: it must come from the Owner's choice.
  assert.ok(parsed.lines.every((line) => line.listedCondition === null && line.listedPta === null));
});

test("sample, Used + PTA Approved: Blaxk is read as Black (Owner-confirmed spelling), with a note", () => {
  const { comparison } = run(SAMPLE, [android]);
  const blaxk = comparison.entries.find((entry) => entry.line.sourceLine.startsWith("Blaxk"));
  assert.equal(blaxk.kind, "new_phone");
  assert.equal(blaxk.color, "Black");
  assert.equal(blaxk.colorDecision, null);
  assert.ok(blaxk.notes.includes("“Blaxk” read as “Black” (Owner-confirmed spelling)"));
});

test("sample: two separate Used products, 14 variants, stock 20, blank optional facts", () => {
  const { comparison, plan } = run(SAMPLE, [android]);
  assert.equal(comparison.counts.attention, 0);
  assert.equal(comparison.counts.new_phone, 14);
  assert.deepEqual(plan.phones.map((phone) => phone.payload.title).sort(), ["Apple iPhone 14 Pro Max (Used)", "Apple iPhone 15 Pro Max (Used)"]);
  const variants = plan.phones.flatMap((phone) => phone.payload.variants);
  assert.equal(variants.length, 14);
  for (const item of variants) {
    assert.equal(item.stock, IPHONE_NEW_VARIANT_STOCK);
    assert.equal(item.condition, "used");
    assert.equal(item.pta_status, "approved");
    assert.equal(item.ram, null);
    assert.equal(item.condition_grade, null, "Used never defaults to A++ here");
    assert.equal(item.battery_health_percent, null);
    assert.equal(item.battery_cycle_count, null);
    assert.equal(item.sim_configuration, null);
    assert.equal(item.warranty, null);
    assert.equal(item.delivery_scope, "karachi_only");
  }
  for (const phone of plan.phones) {
    assert.equal(phone.payload.action, "Create");
    assert.equal(phone.payload.category, "Mobile Phones");
    assert.equal(phone.payload.brand, "Apple");
  }
  const fifteen = plan.phones.find((phone) => phone.payload.title === "Apple iPhone 15 Pro Max (Used)");
  assert.deepEqual(fifteen.payload.variants.map((item) => `${item.storage} ${item.color} ${item.price_minor / 100}`), [
    "512 GB Blue 298000",
    "512 GB Black 298000",
    "256 GB Natural 280000",
    "256 GB Black 274000",
    "256 GB Blue 274000",
  ]);
});

// A spelling the Owner has NOT confirmed still waits for the Owner.
const UNCONFIRMED = SAMPLE.replace("Blaxk", "Blakc");

test("an unconfirmed spelling is held, never corrected; its phone waits whole", () => {
  const { comparison, plan } = run(UNCONFIRMED, [android]);
  const entry = comparison.entries.find((item) => item.line.sourceLine.startsWith("Blakc"));
  assert.equal(entry.kind, "attention");
  assert.equal(entry.color, "Blakc");
  assert.equal(entry.colorDecision.written, "Blakc");
  assert.deepEqual(plan.held.map((item) => item.productTitle), ["Apple iPhone 15 Pro Max (Used)"]);
  assert.deepEqual(plan.phones.map((phone) => phone.payload.title), ["Apple iPhone 14 Pro Max (Used)"]);
});

test("the Owner can keep or change an unconfirmed colour, and that decision is shown", () => {
  const first = run(UNCONFIRMED, [android]);
  const entry = first.comparison.entries.find((item) => item.line.sourceLine.startsWith("Blakc"));
  const kept = run(UNCONFIRMED, [android], USED_PTA, { colors: { [entry.line.lineKey]: "Blakc" }, newPhones: {} });
  assert.ok(kept.plan.phones.flatMap((phone) => phone.payload.variants.map((item) => item.color)).includes("Blakc"));
  const changed = run(UNCONFIRMED, [android], USED_PTA, { colors: { [entry.line.lineKey]: "Black" }, newPhones: {} });
  assert.equal(changed.comparison.counts.attention, 0);
  assert.match(changed.comparison.entries.find((item) => item.line.sourceLine.startsWith("Blakc")).notes[0], /changed to “Black” \(your decision\)/);
});

test("a colour decision applies only to the exact line it was made for", () => {
  const first = run(UNCONFIRMED, [android]);
  const entry = first.comparison.entries.find((item) => item.line.sourceLine.startsWith("Blakc"));
  const moved = `\n${UNCONFIRMED}`; // every line number shifts by one
  const { comparison } = run(moved, [android], USED_PTA, { colors: { [entry.line.lineKey]: "Black" }, newPhones: {} });
  assert.equal(comparison.entries.find((item) => item.line.sourceLine.startsWith("Blakc")).kind, "attention");
});

test("without a New/Used and PTA choice nothing is guessed: every line needs attention", () => {
  const { comparison, plan } = run(SAMPLE, [android], { condition: null, pta: null });
  assert.equal(comparison.counts.attention, 14);
  assert.equal(plan.phones.length, 0);
  assert.ok(comparison.entries[0].reasons.some((reason) => /Choose New or Used/.test(reason)));
  assert.ok(comparison.entries[0].reasons.some((reason) => /Choose PTA Approved or Non-PTA/.test(reason)));
});

test("words on the heading or line win over the page choice (Non-PTA, New)", () => {
  const text = "iPhone 16 Pro 256GB Non PTA\nBlack @ 300,000\nWhite New @ 310,000";
  const { comparison } = run(text, [android]);
  assert.equal(comparison.entries[0].pta, "not_approved");
  assert.equal(comparison.entries[0].condition, "used");
  assert.equal(comparison.entries[0].productTitle, "Apple iPhone 16 Pro (Used)");
  assert.equal(comparison.entries[1].condition, "brand_new");
  assert.equal(comparison.entries[1].productTitle, "Apple iPhone 16 Pro");
  // A trailing "PTA" on a heading is a PTA word, never a colour.
  const pta = parseIphoneList("IPhone 15Pro Max 512Gb Used PTA\nBlue @298,000", BRANDS).lines[0];
  assert.equal(pta.listedPta, "approved");
  assert.equal(pta.listedCondition, "used");
  assert.equal(pta.colorWritten, "Blue");
});

test("unreadable lines are listed, never guessed", () => {
  const parsed = parseIphoneList("Blue @ 100,000\niPhone 15 Pro Max\nBlack @ 200,000\nhello\niPhone 15 Pro 8/256\nGold @ x", BRANDS);
  assert.equal(parsed.lines[0].problems[0], "This colour line has no iPhone model heading above it");
  assert.match(parsed.lines[1].problems[0], /model heading above \(line 2\) could not be read/);
  assert.deepEqual(parsed.unread.map((line) => line.lineNumber), [2, 4, 5, 6], "a price that is not a number is not read as a price");
  assert.match(parsed.unread.find((line) => line.lineNumber === 2).reason, /no storage/);
  assert.match(parsed.unread.find((line) => line.lineNumber === 5).reason, /RAM/);
  const { plan } = run("Blue @ 100,000", [android]);
  assert.equal(plan.phones.length, 0);
  assert.equal(plan.held.length, 1);
});

// ---------------------------------------------------------------------------
// New vs Used isolation (DEV data)
// ---------------------------------------------------------------------------

test("DEV: the plain-title Used test product is never matched by a Used list; the (Used) phone needs the Owner's confirmation", () => {
  const catalog = [android, ...devApple()];
  const text = "IPhone 15Pro Max 256Gb\nNatural Titanium @ 250,000";
  const { comparison, plan } = run(text, catalog);
  const entry = comparison.entries[0];
  assert.equal(entry.productTitle, "Apple iPhone 15 Pro Max (Used)");
  assert.equal(entry.productId, null, "never matched to MB312's plain-title product");
  assert.equal(entry.kind, "attention");
  assert.deepEqual(entry.confirmNewPhone, ["Apple iPhone 15 Pro Max"]);
  assert.equal(plan.phones.length, 0);

  const confirmed = run(text, catalog, USED_PTA, { colors: {}, newPhones: { appleiphone15promaxused: true } });
  assert.equal(confirmed.plan.phones.length, 1);
  assert.equal(confirmed.plan.phones[0].kind, "new");
  assert.equal(confirmed.plan.phones[0].payload.title, "Apple iPhone 15 Pro Max (Used)");
  // No step ever targets the existing DEV products.
  const devIds = new Set(devApple().map((item) => item.id));
  assert.ok(confirmed.plan.phones.every((phone) => !devIds.has(phone.productId)));
});

test("DEV: a New list for the plain title is held because that product holds a Used variant (no cross-category update)", () => {
  const catalog = [android, ...devApple()];
  const { comparison, plan } = run("iPhone 15 Pro Max 256GB\nNatural Titanium @ 250,000", catalog, { condition: "brand_new", pta: "approved" });
  const entry = comparison.entries[0];
  assert.equal(entry.productTitle, "Apple iPhone 15 Pro Max");
  assert.equal(entry.kind, "attention");
  assert.match(entry.reasons[0], /MB312/);
  assert.equal(plan.phones.length, 0);
  assert.equal(plan.held.length, 1);
});

test("a Used list never touches the New product of the same model, and a New list never touches the Used one", () => {
  const newPhone = product("Apple iPhone 16", [variant({ condition: "brand_new", color: "Black", priceMinor: 30000000 })]);
  const usedPhone = product("Apple iPhone 16 (Used)", [variant({ color: "Black", priceMinor: 20000000 })]);
  const catalog = [newPhone, usedPhone];
  const used = run("iPhone 16 256GB\nBlack @ 210,000", catalog);
  assert.equal(used.plan.phones[0].productId, usedPhone.id);
  assert.equal(used.plan.phones[0].payload.condition, "used");
  const fresh = run("iPhone 16 256GB\nBlack @ 310,000", catalog, { condition: "brand_new", pta: "approved" });
  assert.equal(fresh.plan.phones[0].productId, newPhone.id);
  assert.equal(fresh.plan.phones[0].payload.condition, "brand_new");
});

test("a New-title product holding Used variants, or a (Used) product holding New ones, is held", () => {
  const wrong = product("Apple iPhone 16 (Used)", [variant({ condition: "brand_new" })]);
  const { comparison } = run("iPhone 16 256GB\nBlack @ 210,000", [wrong]);
  assert.equal(comparison.entries[0].kind, "attention");
  assert.match(comparison.entries[0].reasons[0], /not Used/);
});

test("Apple products outside Mobile Phones, and two products with the same title, are held", () => {
  const tablet = product("Apple iPhone 16 (Used)", [variant()], { categorySlug: "tablets", category: "Tablets" });
  assert.match(run("iPhone 16 256GB\nBlack @ 210,000", [tablet]).comparison.entries[0].reasons[0], /not in Mobile Phones/);
  const twins = [product("Apple iPhone 16 (Used)", [variant()]), product("Apple iPhone 16 (Used)", [variant()], { id: "p-twin" })];
  assert.match(run("iPhone 16 256GB\nBlack @ 210,000", twins).comparison.entries[0].reasons[0], /More than one product/);
});

test("a different model number is never treated as a look-alike", () => {
  const catalog = [product("Apple iPhone 15 Pro Max (Used)", [variant()])];
  // 14 Pro Max is a different model number: plain new phone, no look-alike.
  const other = run("iPhone 14 Pro Max 256GB\nBlack @ 200,000", catalog);
  assert.equal(other.comparison.entries[0].kind, "new_phone");
});

// ---------------------------------------------------------------------------
// Stock rules on an existing Used product
// ---------------------------------------------------------------------------

function usedCatalog() {
  return [
    product("Apple iPhone 15 Pro Max (Used)", [
      variant({ id: "same", sku: "MB601", storage: "256 GB", color: "Blue", priceMinor: 27400000, stock: 3 }),
      variant({ id: "price", sku: "MB602", storage: "256 GB", color: "Natural", priceMinor: 28500000, stock: 2 }),
      variant({ id: "hidden", sku: "MB603", storage: "512 GB", color: "Blue", priceMinor: 30000000, stock: 0, isActive: false }),
      variant({ id: "missing", sku: "MB604", storage: "1 TB", color: "Black", priceMinor: 33000000, stock: 4 }),
      variant({ id: "facts", sku: "MB605", storage: "512 GB", color: "White", priceMinor: 29000000, batteryHealth: 90 }),
    ]),
  ];
}

test("existing Used product: same = no write, price = price only, hidden = shown again with the new price, new = stock 20, missing untouched", () => {
  const text = "IPhone 15Pro Max 256Gb\nBlue @274,000\nNatural @280,000\nBlack @275,000\n\nIPhone 15Pro Max 512Gb\nBlue @298,000";
  const { comparison, plan } = run(text, usedCatalog());
  assert.deepEqual(comparison.entries.map((entry) => entry.kind), ["same", "price_change", "new_variant", "show_again"]);
  assert.equal(plan.phones.length, 1);
  const phone = plan.phones[0];
  assert.equal(phone.kind, "existing");
  assert.deepEqual(phone.payload.steps, [
    { kind: "price", variant_id: "price", from_minor: 28500000, to_minor: 28000000 },
    { kind: "add_variant", storage: "256 GB", color: "Black", price_minor: 27500000, stock: 20, pta_status: "approved", condition: "used", sim_configuration: null },
    { kind: "show", variant_id: "hidden", from_minor: 30000000, to_minor: 29800000 },
  ]);
  // No stock step exists at all, and the missing / same variants are not in any step.
  assert.ok(phone.payload.steps.every((step) => !("to_stock" in step)));
  assert.ok(!JSON.stringify(phone.payload.steps).includes('"missing"'));
  assert.ok(!JSON.stringify(phone.payload.steps).includes('"same"'));
  // Every variant is sent as "expected", so the database refuses the phone if anything changed since the check.
  assert.equal(phone.payload.expected.variants.length, 5);
  assert.equal(plan.counts.same, 1);
  assert.equal(plan.changeCount, 3);
  assert.match(comparison.entries[3].notes[0], /Stock stays 0/);
});

test("a listed variant equal to one with battery / grade details is held, never matched or duplicated", () => {
  const { comparison, plan } = run("IPhone 15Pro Max 512Gb\nWhite @ 290,000", usedCatalog());
  assert.equal(comparison.entries[0].kind, "attention");
  assert.match(comparison.entries[0].reasons[0], /MB605/);
  assert.equal(plan.phones.length, 0);
});

test("the same variant twice in one list holds the phone", () => {
  const { comparison, plan } = run("IPhone 15Pro Max 256Gb\nBlue @274,000\nblue @270,000", usedCatalog());
  assert.ok(comparison.entries.every((entry) => entry.kind === "attention"));
  assert.match(comparison.entries[0].reasons.at(-1), /listed more than once \(lines 2, 3\)/);
  assert.equal(plan.phones.length, 0);
});

test("a price at or above the compare-at price is held", () => {
  const catalog = [product("Apple iPhone 16 (Used)", [variant({ color: "Black", priceMinor: 20000000, compareAtPriceMinor: 22000000 })])];
  const { comparison } = run("iPhone 16 256GB\nBlack @ 225,000", catalog);
  assert.equal(comparison.entries[0].kind, "attention");
});

test("one problem line holds only its own phone; other phones still update", () => {
  const catalog = usedCatalog();
  const text = "IPhone 15Pro Max 256Gb\nNatural @280,000\nBlakc @ 1\n\niPhone 13 128GB\nRed @ 90,000";
  const { plan } = run(text, catalog);
  assert.deepEqual(plan.held.map((item) => item.productTitle), ["Apple iPhone 15 Pro Max (Used)"]);
  assert.deepEqual(plan.phones.map((phone) => phone.productTitle), ["Apple iPhone 13 (Used)"]);
});

test("Check Changes fingerprint changes with text, choices and decisions", () => {
  const base = checkFingerprint("a", USED_PTA, emptyDecisions());
  assert.notEqual(base, checkFingerprint("b", USED_PTA, emptyDecisions()));
  assert.notEqual(base, checkFingerprint("a", { condition: "brand_new", pta: "approved" }, emptyDecisions()));
  assert.notEqual(base, checkFingerprint("a", USED_PTA, { colors: { k: "Black" }, newPhones: {} }));
  assert.equal(base, checkFingerprint("a", USED_PTA, emptyDecisions()));
});

// ---------------------------------------------------------------------------
// Gate and per-phone runner (offline)
// ---------------------------------------------------------------------------

test("Update Website stays off while the Owner gate is off, and needs a matching build/project and a fresh check", () => {
  const { plan } = run("IPhone 15Pro Max 256Gb\nNatural @280,000", usedCatalog());
  const ok = { supabaseUrl: DEV_URL, buildMode: "development", enabled: true, checkIsCurrent: true, plan };
  assert.equal(iphoneUpdateBlocker(ok), null);
  assert.match(iphoneUpdateBlocker({ ...ok, enabled: false }), /switched off/);
  assert.match(iphoneUpdateBlocker({ ...ok, buildMode: "production" }), /Blocked/);
  assert.match(iphoneUpdateBlocker({ ...ok, checkIsCurrent: false }), /Check Changes again/);
  assert.match(iphoneUpdateBlocker({ ...ok, plan: null }), /Check Changes first/);
  assert.match(iphoneUpdateBlocker({ ...ok, supabaseUrl: "https://unknown.supabase.co" }), /Blocked/);
  // Held phones never enable the button on their own.
  const allHeld = run("IPhone 15Pro Max 256Gb\nBlakc @280,000", usedCatalog()).plan;
  assert.match(iphoneUpdateBlocker({ ...ok, plan: allHeld }), /needs attention/);
});

test("Update Website is approved for DEV and PROD only, each with its own matching build", () => {
  assert.deepEqual([...IPHONE_WRITE_ENVIRONMENTS], ["development", "production"]);
  const { plan } = run("IPhone 15Pro Max 256Gb\nNatural @280,000", usedCatalog());
  const prod = { supabaseUrl: PROD_URL, buildMode: "production", enabled: true, checkIsCurrent: true, plan };
  assert.equal(iphoneUpdateBlocker(prod), null);
  // PROD keeps every other guard: build/project pairing, fresh check, held phones, Owner gate.
  assert.match(iphoneUpdateBlocker({ ...prod, buildMode: "development" }), /Blocked/);
  assert.match(iphoneUpdateBlocker({ ...prod, enabled: false }), /switched off/);
  assert.match(iphoneUpdateBlocker({ ...prod, checkIsCurrent: false }), /Check Changes again/);
  assert.match(iphoneUpdateBlocker({ ...prod, plan: null }), /Check Changes first/);
  const allHeld = run("IPhone 15Pro Max 256Gb\nBlakc @280,000", usedCatalog()).plan;
  assert.match(iphoneUpdateBlocker({ ...prod, plan: allHeld }), /needs attention/);
});

test("the page has the Owner gate switched on (approved 2026-10-22 for DEV and PROD)", () => {
  const source = readFileSync(new URL("../src/admin/IphoneStockUpdate.tsx", import.meta.url), "utf8");
  assert.match(source, /const IPHONE_UPDATE_WEBSITE_ENABLED = true;/);
  assert.match(source, /disabled=\{Boolean\(blocker\) \|\| busy \|\| writing\}/, "the button is disabled whenever a blocker exists");
});

test("runner refuses a PROD project with a non-PROD build before any call", async () => {
  const { plan } = run("iPhone 13 128GB\nRed @ 90,000", []);
  const never = async () => assert.fail("no call may be made");
  for (const buildMode of ["development", "test", undefined]) {
    const result = await runIphoneUpdate({ supabaseUrl: PROD_URL, buildMode, readSnapshot: never, applyPhone: never, createPhone: never, readCreatedPhone: never }, plan);
    assert.equal(result.outcome, "blocked");
    assert.match(result.message, /Blocked.*Nothing was written/);
  }
});

test("runner writes on a matching PROD build: new phone created with Create only and read back", async () => {
  const { plan } = run("iPhone 13 128GB\nRed @ 90,000", []);
  const payloads = [];
  const deps = {
    supabaseUrl: PROD_URL,
    buildMode: "production",
    readSnapshot: async () => assert.fail("no existing phone"),
    applyPhone: async () => assert.fail("no existing phone"),
    createPhone: async (payload) => {
      payloads.push(payload);
      return { products: [{ id: "new-1", title: payload.title, action: "Create" }], assigned_skus: [{ product: payload.title, sku: "MB329" }] };
    },
    readCreatedPhone: async () => ({ publicationStatus: "draft", variantCount: 1, skus: ["MB329"], stock: [20], sims: [null] }),
  };
  const result = await runIphoneUpdate(deps, plan);
  assert.equal(payloads.length, 1);
  assert.equal(payloads[0].action, "Create");
  assert.equal(result.phones[0].status, "updated");
  assert.deepEqual(result.phones[0].newSkus, ["MB329"]);
});

function snapshotOf(productRow, variants, stock) {
  return { productId: productRow.id, product: productRow, media: [], specifications: [], variants: Object.fromEntries(variants.map((row) => [row.id, row])), stock };
}

test("runner: each phone is its own call; a refused phone fails alone, a network error is 'check again', held phones are never written", async () => {
  const catalog = [
    product("Apple iPhone 16 (Used)", [variant({ id: "a", color: "Black", priceMinor: 20000000, stock: 5 })]),
    product("Apple iPhone 17 (Used)", [variant({ id: "b", color: "Black", priceMinor: 30000000, stock: 6 })]),
    product("Apple iPhone 13 (Used)", [variant({ id: "c", color: "Black", priceMinor: 9000000, stock: 1 })]),
  ];
  const text = "iPhone 16 256GB\nBlack @ 210,000\n\niPhone 17 256GB\nBlack @ 310,000\n\niPhone 13 256GB\nBlack @ 95,000\n\niPhone 12 128GB\nBlakc @ 50,000";
  const { plan } = run(text, catalog);
  assert.equal(plan.phones.length, 3);
  assert.equal(plan.held.length, 1);

  const rows = { a: { id: "a", sku: "MB701", price_minor: 20000000, is_active: true }, b: { id: "b", sku: "MB702", price_minor: 30000000, is_active: true }, c: { id: "c", sku: "MB703", price_minor: 9000000, is_active: true } };
  const calls = [];
  const deps = {
    supabaseUrl: DEV_URL,
    buildMode: "development",
    readSnapshot: async (productId) => {
      const id = { "p-Apple iPhone 16 (Used)": "a", "p-Apple iPhone 17 (Used)": "b", "p-Apple iPhone 13 (Used)": "c" }[productId];
      return snapshotOf({ id: productId }, [{ ...rows[id] }], { [id]: 5 });
    },
    applyPhone: async (payload) => {
      calls.push(payload.product_id);
      if (payload.product_id === "p-Apple iPhone 17 (Used)") throw new PhoneWriteError("iphone_stock_phone_rejected: test", false);
      if (payload.product_id === "p-Apple iPhone 13 (Used)") throw new PhoneWriteError("No answer from the website", "unknown");
      const step = payload.steps[0];
      rows.a.price_minor = step.to_minor;
      return { status: "updated", new_variants: [] };
    },
    createPhone: async () => assert.fail("no new phone in this list"),
    readCreatedPhone: async () => assert.fail("no new phone in this list"),
  };
  const result = await runIphoneUpdate(deps, plan);
  assert.equal(calls.length, 3, "one call per phone, the held phone is never called");
  assert.deepEqual(result.counts, { updated: 1, failed: 1, unknown: 1, needs_check: 0, held: 1 });
  assert.equal(result.phones.find((phone) => phone.productTitle === "Apple iPhone 16 (Used)").status, "updated");
  assert.match(result.message, /Nothing was hidden or deleted/);
});

test("runner: a read-back that shows a stock change on an existing variant is reported as 'check again'", async () => {
  const catalog = [product("Apple iPhone 16 (Used)", [variant({ id: "a", color: "Black", priceMinor: 20000000, stock: 5 })])];
  const { plan } = run("iPhone 16 256GB\nBlack @ 210,000", catalog);
  let after = false;
  const deps = {
    supabaseUrl: DEV_URL,
    buildMode: "development",
    readSnapshot: async (productId) => snapshotOf({ id: productId }, [{ id: "a", sku: "MB701", price_minor: after ? 21000000 : 20000000, is_active: true }], { a: after ? 20 : 5 }),
    applyPhone: async () => {
      after = true;
      return { status: "updated" };
    },
    createPhone: async () => assert.fail(),
    readCreatedPhone: async () => assert.fail(),
  };
  const result = await runIphoneUpdate(deps, plan);
  assert.equal(result.phones[0].status, "needs_check");
  assert.ok(result.phones[0].reasons.some((reason) => /stock unchanged/.test(reason)));
});

test("runner: a new phone is created with Create only and checked as a draft with stock 20", async () => {
  const { plan } = run("iPhone 13 128GB\nRed @ 90,000\nBlue @ 91,000", []);
  const payloads = [];
  const deps = {
    supabaseUrl: DEV_URL,
    buildMode: "development",
    readSnapshot: async () => assert.fail("no existing phone"),
    applyPhone: async () => assert.fail("no existing phone"),
    createPhone: async (payload) => {
      payloads.push(payload);
      return { products: [{ id: "new-1", title: payload.title, action: "Create" }], assigned_skus: [{ product: payload.title, sku: "MB800" }, { product: payload.title, sku: "MB801" }] };
    },
    readCreatedPhone: async () => ({ publicationStatus: "draft", variantCount: 2, skus: ["MB800", "MB801"], stock: [20, 20], sims: [null, null] }),
  };
  const result = await runIphoneUpdate(deps, plan);
  assert.equal(payloads.length, 1);
  assert.equal(payloads[0].action, "Create");
  assert.equal(result.phones[0].status, "updated");
  assert.deepEqual(result.phones[0].newSkus, ["MB800", "MB801"]);
});

test("runner refuses a mismatched build / project pair before any call", async () => {
  const { plan } = run("iPhone 13 128GB\nRed @ 90,000", []);
  const result = await runIphoneUpdate({ supabaseUrl: DEV_URL, buildMode: "production", readSnapshot: assert.fail, applyPhone: assert.fail, createPhone: assert.fail, readCreatedPhone: assert.fail }, plan);
  assert.equal(result.outcome, "blocked");
});

// ---------------------------------------------------------------------------
// The Owner's real list format (2026-10-21)
// ---------------------------------------------------------------------------

const colorsOf = (text) => parseIphoneList(text, BRANDS).lines.map((line) => `${line.baseTitle} | ${line.storage} | ${line.colorWritten} | ${line.priceMinor / 100}`);

test("a price without @ is read: “White 245,000”", () => {
  assert.deepEqual(colorsOf("IPhone 15Pro Max 256Gb\nWhite 245,000"), ["Apple iPhone 15 Pro Max | 256 GB | White | 245000"]);
});

test("several colours share one price: “White Blue/Blk/Red @112,000” = four variants at 112,000", () => {
  assert.deepEqual(colorsOf("iPhone 13 128GB\nWhite Blue/Blk/Red @112,000"), [
    "Apple iPhone 13 | 128 GB | White | 112000",
    "Apple iPhone 13 | 128 GB | Blue | 112000",
    "Apple iPhone 13 | 128 GB | Black | 112000",
    "Apple iPhone 13 | 128 GB | Red | 112000",
  ]);
  const { plan } = run("iPhone 13 128GB\nWhite Blue/Blk/Red @112,000", [android]);
  assert.equal(plan.phones[0].payload.variants.length, 4);
  assert.ok(plan.phones[0].payload.variants.every((item) => item.price_minor === 11200000 && item.stock === 20));
});

test("price before colours: “@215,000 Purple/Gold/White/Blk”", () => {
  assert.deepEqual(colorsOf("14Pro 512Gb\n@215,000 Purple/Gold/White/Blk"), [
    "Apple iPhone 14 Pro | 512 GB | Purple | 215000",
    "Apple iPhone 14 Pro | 512 GB | Gold | 215000",
    "Apple iPhone 14 Pro | 512 GB | White | 215000",
    "Apple iPhone 14 Pro | 512 GB | Black | 215000",
  ]);
});

test("headings without “iPhone” are read: 14Pro 512Gb, 15 Pro Max 256GB, 13 128gb, 16e 128GB", () => {
  const parsed = parseIphoneList("14Pro 512Gb\nBlack @1\n15 Pro Max 256GB\nBlack @1\n13 128gb\nBlack @1\n16e 128GB\nBlack @1", BRANDS);
  assert.equal(parsed.unread.length, 0);
  assert.deepEqual(parsed.lines.map((line) => `${line.baseTitle} ${line.storage}`), ["Apple iPhone 14 Pro 512 GB", "Apple iPhone 15 Pro Max 256 GB", "Apple iPhone 13 128 GB", "Apple iPhone 16e 128 GB"]);
  // "13 128gb" is a heading, never a price; a short bare number is never a price.
  assert.equal(parseIphoneList("Black 128", BRANDS).lines.length, 0);
});

test("“Physical Dual” on a heading is Dual Physical SIM: SIM information, not colour or model", () => {
  const parsed = parseIphoneList("iPhone 13 256GB Physical Dual\nBlack @120,000\nWhite Blue @118,000", BRANDS);
  assert.equal(parsed.unread.length, 0);
  assert.deepEqual(parsed.lines.map((line) => [line.baseTitle, line.storage, line.colorWritten, line.listedSim]), [
    ["Apple iPhone 13", "256 GB", "Black", "dual_physical_sim"],
    ["Apple iPhone 13", "256 GB", "White", "dual_physical_sim"],
    ["Apple iPhone 13", "256 GB", "Blue", "dual_physical_sim"],
  ]);
  assert.ok(parsed.lines.every((line) => line.problems.length === 0));
});

test("new phone: Physical Dual variants carry dual_physical_sim; lines without SIM wording stay NULL", () => {
  const text = "iPhone 13 256GB Physical Dual\nBlack @120,000\n\niPhone 13 128GB\nBlack @100,000";
  const { comparison, plan } = run(text, [android]);
  assert.equal(comparison.counts.attention, 0);
  assert.equal(plan.phones.length, 1, "SIM is not part of the product identity: one Apple iPhone 13 (Used)");
  const phone = plan.phones[0];
  assert.equal(phone.payload.title, "Apple iPhone 13 (Used)");
  assert.deepEqual(phone.payload.variants.map((item) => [item.storage, item.color, item.sim_configuration, item.stock]), [
    ["256 GB", "Black", "dual_physical_sim", 20],
    ["128 GB", "Black", null, 20],
  ]);
  // Nothing else is filled because a SIM was given.
  assert.ok(phone.payload.variants.every((item) => item.condition_grade === null && item.warranty === null && item.ram === null));
});

test("new variant on an existing phone carries the listed SIM; without SIM wording it is NULL", () => {
  const catalog = [product("Apple iPhone 13 (Used)", [variant({ id: "x", storage: "128 GB", color: "Red", simConfiguration: null })])];
  const { plan } = run("iPhone 13 256GB Physical Dual\nBlack @120,000\n\niPhone 13 256GB\nWhite @110,000", catalog);
  assert.deepEqual(plan.phones[0].payload.steps, [
    { kind: "add_variant", storage: "256 GB", color: "Black", price_minor: 12000000, stock: 20, pta_status: "approved", condition: "used", sim_configuration: "dual_physical_sim" },
    { kind: "add_variant", storage: "256 GB", color: "White", price_minor: 11000000, stock: 20, pta_status: "approved", condition: "used", sim_configuration: null },
  ]);
});

test("existing variant: a conflicting or missing stored SIM is held (never changed); the same SIM updates the price only", () => {
  const catalogWith = (sim) => [product("Apple iPhone 13 (Used)", [variant({ id: "v13", sku: "MB900", storage: "256 GB", color: "Black", priceMinor: 12500000, stock: 4, simConfiguration: sim })])];
  const text = "iPhone 13 256GB Physical Dual\nBlack @120,000";
  for (const sim of [null, "physical_sim", "dual_esim"]) {
    const { comparison, plan } = run(text, catalogWith(sim));
    assert.equal(comparison.entries[0].kind, "attention", String(sim));
    assert.match(comparison.entries[0].reasons[0], /never changes an existing SIM/);
    assert.equal(plan.phones.length, 0);
  }
  // SIM not loaded for some reason: never assumed equal.
  const unknown = run(text, [product("Apple iPhone 13 (Used)", [variant({ id: "v13", sku: "MB900", storage: "256 GB", color: "Black", priceMinor: 12500000 })])]);
  assert.match(unknown.comparison.entries[0].reasons[0], /could not be checked/);
  // Same SIM: price only, stock kept, no SIM in the step.
  const same = run(text, catalogWith("dual_physical_sim"));
  assert.deepEqual(same.plan.phones[0].payload.steps, [{ kind: "price", variant_id: "v13", from_minor: 12500000, to_minor: 12000000 }]);
  // No SIM wording in the list: the stored SIM is left exactly as it is and nothing is held.
  const silent = run("iPhone 13 256GB\nBlack @120,000", catalogWith("physical_sim"));
  assert.equal(silent.comparison.entries[0].kind, "price_change");
});

test("Owner-confirmed spellings (iPhone list only): Blaxk = Black, Purppe = Purple, Blk = Black", () => {
  const parsed = parseIphoneList("iPhone 13 128GB\nBlaxk/Purppe/Blk @100,000", BRANDS);
  assert.deepEqual(parsed.lines.map((line) => [line.colorWritten, line.colorKnown, line.colorNote]), [
    ["Black", true, "“Blaxk” read as “Black” (Owner-confirmed spelling)"],
    ["Purple", true, "“Purppe” read as “Purple” (Owner-confirmed spelling)"],
    ["Black", true, null],
  ]);
  // Black twice on one line is the same variant twice: held, never merged.
  const { comparison, plan } = run("iPhone 13 128GB\nBlaxk/Purppe/Blk @100,000", [android]);
  assert.deepEqual(comparison.entries.map((entry) => entry.kind), ["attention", "new_phone", "attention"]);
  assert.match(comparison.entries[0].reasons.at(-1), /listed more than once/);
  assert.equal(plan.phones.length, 0, "the phone waits as a whole");
});

test("the Android update is unchanged: the shared colour reader and Android list reader still do not know Blaxk / Purppe", () => {
  assert.deepEqual(normalizeColor("Blaxk"), { color: "Blaxk", known: false });
  assert.deepEqual(normalizeColor("Purppe"), { color: "Purppe", known: false });
  const android = parseStockList("Samsung\nA07 4/64 purppe @ 36900", [{ name: "Samsung" }]);
  assert.equal(android.rows[0].color, "Purppe");
});

test("multi-word iPhone colours stay whole; a space splits only single colour words", () => {
  assert.deepEqual(parseIphoneList("iPhone 15 Pro 256GB\nSpace Black/Deep Purple @100,000\nNatural Titanium 250,000\nMidnight Green @90,000", BRANDS).lines.map((line) => line.colorWritten), [
    "Space Black",
    "Deep Purple",
    "Natural Titanium",
    "Midnight Green",
  ]);
  // An unknown word keeps the whole phrase together and waits for the Owner (nothing is split on a guess).
  const unknown = parseIphoneList("iPhone 13 128GB\nWhite Blakc @100,000", BRANDS).lines;
  assert.deepEqual(unknown.map((line) => [line.colorWritten, line.colorKnown]), [["White Blakc", false]]);
});

test("a price with no colour never gets one: it is skipped and shown, never imported", () => {
  const parsed = parseIphoneList("iPhone 13 128GB\n@ 215,000", BRANDS);
  assert.equal(parsed.lines.length, 0);
  assert.deepEqual(parsed.skipped, [{ lineNumber: 2, line: "@ 215,000", model: "Apple iPhone 13 128 GB", reason: SKIPPED_NO_COLOUR }]);
});

test("a decision on one colour of a shared-price line applies to that colour only", () => {
  const first = run("iPhone 13 128GB\nWhite Blakc/Red @100,000", [android]);
  assert.equal(first.comparison.entries.length, 2);
  const [blakc, red] = first.comparison.entries;
  assert.equal(blakc.kind, "attention");
  assert.equal(red.kind, "new_phone", "the line's other colour is read normally (the phone still waits as a whole)");
  assert.notEqual(blakc.line.lineKey, red.line.lineKey);
  assert.equal(first.plan.phones.length, 0);
});

// ---------------------------------------------------------------------------
// Colours on one line, shared price on the next; skipped entries (Owner's list, 2026-10-21)
// ---------------------------------------------------------------------------

const OWNER_EXTRACT = `IPhone 13 256Gb Physical Dual

Green /Red Blue Blk Pink
@122,000

IPhone 14 128Gb
@124,000`;

test("Owner's list: “Green /Red Blue Blk Pink” then “@122,000” = exactly five variants at Rs 122,000, Dual Physical SIM", () => {
  const parsed = parseIphoneList(OWNER_EXTRACT, BRANDS);
  assert.equal(parsed.unread.length, 0);
  assert.deepEqual(parsed.lines.map((line) => [line.baseTitle, line.storage, line.colorWritten, line.priceMinor, line.listedSim]), [
    ["Apple iPhone 13", "256 GB", "Green", 12200000, "dual_physical_sim"],
    ["Apple iPhone 13", "256 GB", "Red", 12200000, "dual_physical_sim"],
    ["Apple iPhone 13", "256 GB", "Blue", 12200000, "dual_physical_sim"],
    ["Apple iPhone 13", "256 GB", "Black", 12200000, "dual_physical_sim"],
    ["Apple iPhone 13", "256 GB", "Pink", 12200000, "dual_physical_sim"],
  ]);
  assert.equal(new Set(parsed.lines.map((line) => line.lineKey)).size, 5, "each colour has its own decision key");
  assert.match(parsed.lines[0].sourceLine, /lines 3–4/);

  const { comparison, plan } = run(OWNER_EXTRACT, [android]);
  assert.equal(comparison.counts.attention, 0);
  assert.equal(comparison.counts.skipped, 1);
  assert.equal(plan.phones.length, 1);
  const phone = plan.phones[0];
  assert.equal(phone.payload.title, "Apple iPhone 13 (Used)");
  assert.deepEqual(phone.payload.variants.map((item) => [item.color, item.price_minor, item.stock, item.condition, item.pta_status, item.sim_configuration]), [
    ["Green", 12200000, 20, "used", "approved", "dual_physical_sim"],
    ["Red", 12200000, 20, "used", "approved", "dual_physical_sim"],
    ["Blue", 12200000, 20, "used", "approved", "dual_physical_sim"],
    ["Black", 12200000, 20, "used", "approved", "dual_physical_sim"],
    ["Pink", 12200000, 20, "used", "approved", "dual_physical_sim"],
  ]);
});

test("Owner's list: “IPhone 14 128Gb” + “@124,000” is skipped — no variant, no guessed colour, nothing changed", () => {
  const parsed = parseIphoneList(OWNER_EXTRACT, BRANDS);
  assert.deepEqual(parsed.skipped, [{ lineNumber: 7, line: "@124,000", model: "Apple iPhone 14 128 GB", reason: SKIPPED_NO_COLOUR }]);
  assert.ok(parsed.lines.every((line) => line.baseTitle !== "Apple iPhone 14"));
  // An existing iPhone 14 (Used) 128 GB variant is not touched by the skipped line.
  const existing = product("Apple iPhone 14 (Used)", [variant({ id: "i14", storage: "128 GB", color: "Black", priceMinor: 12000000, simConfiguration: null })]);
  const { plan } = run(OWNER_EXTRACT, [android, existing]);
  assert.ok(plan.phones.every((item) => item.productId !== existing.id));
  assert.ok(plan.held.every((item) => item.productTitle !== "Apple iPhone 14 (Used)"));
  // The one-line form is skipped the same way.
  assert.deepEqual(parseIphoneList("iPhone 14 128Gb @124,000", BRANDS).skipped.map((line) => line.model), ["Apple iPhone 14 128 GB"]);
});

test("a skipped line never holds the same phone's other lines", () => {
  const { plan, comparison } = run("iPhone 14 128Gb\n@124,000\n\niPhone 14 256GB\nBlack @130,000", [android]);
  assert.equal(comparison.counts.skipped, 1);
  assert.equal(plan.phones.length, 1);
  assert.deepEqual(plan.phones[0].payload.variants.map((item) => `${item.storage} ${item.color}`), ["256 GB Black"]);
});

test("colours that never get a price are listed, never priced from somewhere else", () => {
  const atEnd = parseIphoneList("iPhone 13 128GB\nGreen Red", BRANDS);
  assert.equal(atEnd.lines.length, 0);
  assert.match(atEnd.unread[0].reason, /Colours without a price/);
  const nextHeading = parseIphoneList("iPhone 13 128GB\nGreen Red\niPhone 13 256GB\n@100,000", BRANDS);
  assert.deepEqual(nextHeading.unread.map((line) => line.lineNumber), [2]);
  assert.deepEqual(nextHeading.skipped.map((line) => line.model), ["Apple iPhone 13 256 GB"], "the price under the next heading is not given to the earlier colours");
  const pricedLine = parseIphoneList("iPhone 13 128GB\nGreen Red\nBlue @100,000", BRANDS);
  assert.deepEqual(pricedLine.lines.map((line) => line.colorWritten), ["Blue"]);
  assert.deepEqual(pricedLine.unread.map((line) => line.lineNumber), [2]);
});

test("a misspelt colour on a colour-only line still waits for the Owner (Needs Attention)", () => {
  const { comparison, plan } = run("iPhone 13 128GB\nGreen/Blakc\n@100,000", [android]);
  assert.deepEqual(comparison.entries.map((entry) => [entry.color, entry.kind]), [["Green", "new_phone"], ["Blakc", "attention"]]);
  assert.equal(plan.phones.length, 0);
});

test("colour-only lines need a heading above them", () => {
  const parsed = parseIphoneList("Green Red\n@100,000", BRANDS);
  assert.equal(parsed.lines.length, 0);
  assert.equal(parsed.unread.length, 1);
  assert.equal(parsed.skipped.length, 1);
});
