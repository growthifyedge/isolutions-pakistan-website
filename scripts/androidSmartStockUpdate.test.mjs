// Android Smart Stock Update (Owner-approved 2026-11-23): supplier-block parsing, "Only products in this list" mode,
// "All Colours" choices, Skip, and the complete-list hide safety. Pure functions only — nothing touches a database.
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { expandSupplierBlocks, normaliseDashCapacity } from "../src/lib/supplierListBlocks.ts";
import { normalizeStockLines } from "../src/lib/catalogSheet.ts";
import { ALL_COLOURS_REASON, RAM_NOT_IN_LIST, buildStockDelta, parseStockList } from "../src/lib/stockListDelta.ts";
import { applyResolutions, buildRowKeys, describeResolution, draftFromState, sanitizeDraft } from "../src/lib/stockListDraft.ts";
import { MASS_HIDE_MIN_PHONES, buildPhonePlan, confirmationPhrase, massHideProblem, updateWebsiteBlocker } from "../src/lib/stockUpdateApply.ts";
import { explainReason } from "../src/lib/stockUpdateWording.ts";

const brands = [{ name: "Samsung" }, { name: "Xiaomi" }, { name: "Tecno" }, { name: "Infinix" }, { name: "Motorola" }];
const DEV_URL = "https://acwatgxkcyrdxpcljxjb.supabase.co";
const SAMPLE = `Samsung S26 Ultra 12-512Gb

Blk @438,000
Blue @438,000
Cobalt @440,000

256Gb
All Colours
@385,000`;

// The Samsung S26 Ultra as it is on PROD (read-only copy, 2026-11-23) + one unrelated Android phone.
const variant = (sku, storage, color, price, extra = {}) => ({ id: `id-${sku}`, sku, ram: "12 GB", storage, color, priceMinor: price * 100, compareAtPriceMinor: null, stock: 7, ptaStatus: "approved", condition: "brand_new", conditionGrade: null, batteryHealth: null, cycleCount: null, isActive: true, warrantyOverride: null, deliveryScope: "karachi_only", ...extra });
const s26 = () => ({
  id: "p-s26u", slug: "samsung-s26-ultra", title: "Samsung S26 Ultra", brand: "Samsung", category: "Mobile Phones", categorySlug: "android-phones", publicationStatus: "published", mediaCount: 5, specCount: 30,
  variants: [variant("MB051", "256 GB", "Black", 389500), variant("MB052", "256 GB", "Volt", 389500), variant("MB053", "256 GB", "Blue", 389500), variant("MB054", "256 GB", "White", 389500),
    variant("MB055", "512 GB", "Black", 448000), variant("MB056", "512 GB", "Volt", 443000, { isActive: false }), variant("MB057", "512 GB", "Blue", 448000), variant("MB058", "512 GB", "White", 448000)],
});
const other = (n = 1) => ({ id: `p-x${n}`, slug: `xiaomi-phone-${n}`, title: `Xiaomi Phone ${n}`, brand: "Xiaomi", category: "Mobile Phones", categorySlug: "android-phones", publicationStatus: "published", mediaCount: 4, specCount: 20, variants: [variant(`MX${n}`, "256 GB", "Black", 90000, { id: `vx${n}`, ram: "8 GB" })] });
const catalog = () => [s26(), other(1)];
const record = (key, resolution) => ({ [key]: { rowKey: key, resolution, sourceLine: "", label: "", decidedAt: "" } });

function run(text, resolutions = {}, mode = "listed", data = catalog()) {
  const parsed = parseStockList(text, brands);
  const resolved = applyResolutions(parsed, resolutions, { mode });
  const delta = buildStockDelta(resolved.parsed, data, resolved.rowDecisions, { mode });
  const plan = buildPhonePlan(delta, data, ["Samsung", "Xiaomi"]);
  return { parsed, resolved, delta, plan, keys: buildRowKeys(parsed.rows) };
}
const stepsOf = (plan) => plan.phones.flatMap((phone) => phone.steps);
// "Only products in this list": a phone missing from the catalog waits for the Owner's "New phone" confirmation.
const confirmNew = (text) => record(buildRowKeys(parseStockList(text, brands).rows)[0], { type: "confirm_new_phone" });

// ---------- 1. supplier blocks ----------

test("supplier block: the Owner's sample becomes one line per variant, on the Owner's own line numbers", () => {
  const out = expandSupplierBlocks(SAMPLE, brands);
  const lines = out.text.split("\n");
  assert.equal(lines.length, SAMPLE.split("\n").length, "same number of lines");
  assert.equal(lines[2], "Samsung S26 Ultra 12/512GB Blk @ 438,000");
  assert.equal(lines[3], "Samsung S26 Ultra 12/512GB Blue @ 438,000");
  assert.equal(lines[4], "Samsung S26 Ultra 12/512GB Cobalt @ 440,000");
  assert.equal(lines[7], "Samsung S26 Ultra 256GB All Colours @ 385,000", "256Gb sub-heading carries no RAM; price from the next line");
  assert.equal(lines[0], "");
  assert.equal(lines[6], "");
  assert.equal(lines[8], "");
  assert.deepEqual([out.blocks, out.variantLines], [1, 4]);
  assert.equal(out.origins[3].original, "Blk @438,000");
  assert.equal(out.origins[8].original, "All Colours @385,000");
  assert.equal(out.origins[8].heading, "Samsung S26 Ultra 12-512Gb · 256Gb");
});

test("supplier block: lists that are not blocks are left exactly as written", () => {
  for (const text of [
    "Samsung\n\nA07 4/64 black/green @ 36900\nA57 12/512 lilac/navy/grey @ 204500\n\nMotorola\n\nG77 8/256 black/green @ 91800",
    "Samsung S26 Ultra 12/512 Black 438000\nSamsung S26 Ultra 12/512 Blue 438000",
    "Samsung S26 Ultra 12-512Gb\nTecno Spark 40 8/256 Black @ 40,000", // a heading with no colour lines is not a block
    "Gift box @ 1500",
  ]) {
    const out = expandSupplierBlocks(text, brands);
    assert.equal(out.variantLines, 0, text);
    assert.equal(out.text, text.split("\n").map((line) => normaliseDashCapacity(line)).join("\n"), text);
  }
});

test("12-512Gb is read as 12 GB / 512 GB; dashes that are not RAM-storage are untouched", () => {
  assert.equal(normaliseDashCapacity("Samsung S26 Ultra 12-512Gb Black @438,000"), "Samsung S26 Ultra 12/512GB Black @438,000");
  assert.equal(normaliseDashCapacity("Infinix Hot 60 8-256 Blue 45000"), "Infinix Hot 60 8/256GB Blue 45000");
  assert.equal(normaliseDashCapacity("Note 13-5G Black 60000"), "Note 13-5G Black 60000");
  assert.equal(normaliseDashCapacity("A15 2024-2025 Black"), "A15 2024-2025 Black");
  const row = parseStockList("Samsung S26 Ultra 12-512Gb Black @438,000", brands).rows[0];
  assert.deepEqual([row.productTitle, row.ram, row.storage, row.color, row.priceMinor], ["Samsung S26 Ultra", "12 GB", "512 GB", "Black", 43800000]);
});

test("parser: model, RAM, storage, colour (Blk = Black) and price come out of the sample; unknown colours are flagged, never assumed", () => {
  const { rows } = parseStockList(SAMPLE, brands);
  assert.deepEqual(rows.map((row) => [row.lineNumber, row.productTitle, row.ram, row.storage, row.color, row.priceMinor / 100]), [
    [3, "Samsung S26 Ultra", "12 GB", "512 GB", "Black", 438000],
    [4, "Samsung S26 Ultra", "12 GB", "512 GB", "Blue", 438000],
    [5, "Samsung S26 Ultra", "12 GB", "512 GB", "Cobalt", 440000],
    [8, "Samsung S26 Ultra", null, "256 GB", "All Colours", 385000],
  ]);
  assert.match(rows[2].reviewReasons.join(), /Cobalt/);
});

test("Bulk Import's shared parser is unchanged: the same block pasted there is still read line by line", () => {
  const { rows } = normalizeStockLines(SAMPLE, { brands });
  assert.equal(rows.length, 6);
  assert.equal(rows[0].productTitle, "Samsung S26 Ultra 12-512Gb");
});

// ---------- 1b. multiline grouping (Owner-approved 2026-11-24) ----------

const S26_FE = "Samsung S26 FE\n8/256GB\nPistachio @235,000\nGraphite @235,000\nBlueberry @235,000\n8/512GB\nPistachio @299,000\nGraphite @299,000\nBlueberry @299,000";

test("a model-only heading groups the RAM/storage sub-headings and colour @ price lines under it", () => {
  const rows = parseStockList(S26_FE, brands).rows;
  assert.deepEqual(rows.map((row) => [row.brand, row.model, row.ram, row.storage, row.color, row.priceMinor / 100]), [
    ["Samsung", "S26 FE", "8 GB", "256 GB", "Pistachio", 235000], ["Samsung", "S26 FE", "8 GB", "256 GB", "Graphite", 235000], ["Samsung", "S26 FE", "8 GB", "256 GB", "Blueberry", 235000],
    ["Samsung", "S26 FE", "8 GB", "512 GB", "Pistachio", 299000], ["Samsung", "S26 FE", "8 GB", "512 GB", "Graphite", 299000], ["Samsung", "S26 FE", "8 GB", "512 GB", "Blueberry", 299000],
  ]);
  assert.equal(expandSupplierBlocks(S26_FE, brands).blocks, 1);
  // A model-only heading with no capacity sub-heading never invents variants.
  assert.equal(expandSupplierBlocks("Samsung S26 FE\nGraphite @235,000", brands).blocks, 0);
});

test("the model heading attaches through list decoration and sub-heading spellings (8GB/256GB, 8/256, 8+256)", () => {
  const colours = (a, b) => [a, "Pistachio @235,000", "Graphite @235,000", "Blueberry @235,000", b, "Pistachio @299,000", "Graphite @299,000", "Blueberry @299,000"].join("\n");
  for (const [head, a, b] of [["*Samsung S26 FE*", "*8/256GB*", "*8/512GB*"], ["📱 Samsung S26 FE:", "8GB/256GB", "8GB/512GB"], ["Samsung S26 FE", "8/256", "8/512"], ["- Samsung S26 FE", "8+256GB", "8+512GB"]]) {
    const rows = parseStockList(`${head}\n${colours(a, b)}`, brands).rows;
    assert.deepEqual(rows.map((row) => [row.brand, row.model, row.ram, row.storage, row.priceMinor / 100]), [
      ["Samsung", "S26 FE", "8 GB", "256 GB", 235000], ["Samsung", "S26 FE", "8 GB", "256 GB", 235000], ["Samsung", "S26 FE", "8 GB", "256 GB", 235000],
      ["Samsung", "S26 FE", "8 GB", "512 GB", 299000], ["Samsung", "S26 FE", "8 GB", "512 GB", 299000], ["Samsung", "S26 FE", "8 GB", "512 GB", 299000],
    ], head);
  }
  // A lone number is never a sub-heading, and RAM must stay below a real storage size.
  assert.equal(expandSupplierBlocks("Samsung S26 FE\n256\nGraphite @235,000", brands).blocks, 0);
  assert.equal(expandSupplierBlocks("Samsung S26 FE\n16/8\nGraphite @235,000", brands).blocks, 0);
});

// ---------- 1c. RAM/storage + colour list + price on one line (Owner-approved 2026-11-23) ----------

const S26_FE_COMBINED = "Samsung S26 FE\n8/256 GB - Pistachio, Graphite, Blueberry - Rs 235,000\n8/512 GB - Pistachio, Graphite, Blueberry - Rs 299,000";
// The Samsung S26 FE as it is on PROD (read-only, 2026-11-23): MB291–MB296, 8 GB, 256 / 512 GB × Green / Graphite / Blue.
const s26fe = () => ({
  id: "p-s26fe", slug: "samsung-s26-fe", title: "Samsung S26 FE", brand: "Samsung", category: "Mobile Phones", categorySlug: "android-phones", publicationStatus: "published", mediaCount: 5, specCount: 30,
  variants: [["MB291", "256 GB", "Green"], ["MB292", "256 GB", "Graphite"], ["MB293", "256 GB", "Blue"], ["MB294", "512 GB", "Green"], ["MB295", "512 GB", "Graphite"], ["MB296", "512 GB", "Blue"]]
    .map(([sku, storage, color]) => variant(sku, storage, color, storage === "256 GB" ? 249999 : 309999, { ram: "8 GB" })),
});
const feRows = (text) => parseStockList(text, brands).rows.map((row) => [row.brand, row.model, row.ram, row.storage, row.color, row.priceMinor / 100]);
const FE_SIX = [
  ["Samsung", "S26 FE", "8 GB", "256 GB", "Pistachio", 235000], ["Samsung", "S26 FE", "8 GB", "256 GB", "Graphite", 235000], ["Samsung", "S26 FE", "8 GB", "256 GB", "Blueberry", 235000],
  ["Samsung", "S26 FE", "8 GB", "512 GB", "Pistachio", 299000], ["Samsung", "S26 FE", "8 GB", "512 GB", "Graphite", 299000], ["Samsung", "S26 FE", "8 GB", "512 GB", "Blueberry", 299000],
];

test("combined line: 'RAM/storage - colours - price' under a model heading becomes 6 variants of that phone", () => {
  const out = expandSupplierBlocks(S26_FE_COMBINED, brands);
  assert.deepEqual(out.text.split("\n"), ["", "Samsung S26 FE 8/256GB Pistachio, Graphite, Blueberry @ 235,000", "Samsung S26 FE 8/512GB Pistachio, Graphite, Blueberry @ 299,000"]);
  assert.deepEqual([out.blocks, out.variantLines], [1, 2]);
  assert.equal(out.origins[2].heading, "Samsung S26 FE");
  assert.deepEqual(feRows(S26_FE_COMBINED), FE_SIX);
});

test("combined line: spelling variations of the same list give the same 6 variants", () => {
  for (const text of [
    "Samsung S26 FE\n8/256GB – Pistachio, Graphite, Blueberry – Rs. 235,000\n8/512GB – Pistachio, Graphite, Blueberry – Rs. 299,000",
    "*Samsung S26 FE*\n\n*8/256 GB* - Pistachio, Graphite, Blueberry - Rs 235,000/-\n\n*8/512 GB* - Pistachio, Graphite, Blueberry - Rs 299,000/-",
    "Samsung S26 FE:\n8GB/256GB Pistachio/Graphite/Blueberry @235,000\n8GB/512GB Pistachio/Graphite/Blueberry @299,000",
    "Samsung S26 FE\r\n8+256 GB: Pistachio, Graphite & Blueberry 235000\r\n8+512 GB: Pistachio, Graphite & Blueberry 299000",
    "Samsung S26 FE\n8-256GB - Pistachio,Graphite,Blueberry - PKR 235,000\n8-512GB - Pistachio,Graphite,Blueberry - PKR 299,000",
  ]) assert.deepEqual(feRows(text), FE_SIX, text);
});

test("combined line: Graphite matches MB292 / MB295; Pistachio and Blueberry are held, never mapped to another colour", () => {
  const data = [s26fe(), other(1)];
  const { delta, plan } = run(S26_FE_COMBINED, {}, "listed", data);
  const priced = delta.entries.filter((entry) => entry.kind === "price_change").map((entry) => [entry.sku, entry.newPriceMinor / 100]);
  assert.deepEqual(priced, [["MB292", 235000], ["MB295", 299000]]);
  const others = delta.entries.filter((entry) => entry.kind !== "price_change");
  assert.equal(others.length, 4);
  assert.ok(others.every((entry) => entry.kind === "ambiguous" && ["Pistachio", "Blueberry"].includes(entry.row.color)), "Pistachio / Blueberry need the Owner");
  assert.ok(!delta.entries.some((entry) => ["MB291", "MB293", "MB294", "MB296"].includes(entry.sku)), "Green / Blue variants are not touched");
  assert.equal(stepsOf(plan).filter((step) => step.kind === "add_variant" || step.kind === "create_phone").length, 0);
});

test("combined line: anything unclear is left exactly as before (nothing guessed)", () => {
  for (const text of [
    "Samsung S26 FE\n256 - Graphite - Rs 235,000", // no unit and no RAM
    "Samsung S26 FE\n8/256 GB - Graphite, All Colours - Rs 235,000", // All Colours mixed with a colour
    "Samsung S26 FE\n8/256 GB - Pistachio, Graphite", // no price
    "Samsung S26 FE\n8/256 GB - Graphite 5G - Rs 235,000", // not a plain colour label
    "Samsung S26 FE\n16/8 GB - Graphite - Rs 235,000", // RAM above storage
  ]) assert.equal(expandSupplierBlocks(text, brands).variantLines, 0, text);
  // Without a heading the line is never attached to anything.
  assert.equal(expandSupplierBlocks("8/256 GB - Pistachio, Graphite - Rs 235,000", brands).variantLines, 0);
  // A combined line does not change the capacity of the sub-heading block it sits in.
  const mixed = expandSupplierBlocks("Samsung S26 Ultra 12-512Gb\nBlk @438,000\n256GB - Black, White - Rs 385,000\nBlue @438,000", brands).text.split("\n");
  assert.deepEqual(mixed, ["", "Samsung S26 Ultra 12/512GB Blk @ 438,000", "Samsung S26 Ultra 256GB Black, White @ 385,000", "Samsung S26 Ultra 12/512GB Blue @ 438,000"]);
});

test("a phone missing from the catalog: New Phone — Review Required, nothing created until the Owner confirms", () => {
  const text = "Samsung Galaxy Z99\n12/512GB\nBlack @300,000";
  const held = run(text);
  assert.equal(held.delta.entries.length, 1);
  assert.deepEqual([held.delta.entries[0].kind, held.delta.entries[0].attention, held.delta.entries[0].provisionalKind], ["ambiguous", "new_phone_review", "new_product"]);
  assert.match(held.delta.entries[0].reasons.join(" "), /New Phone — Review Required/);
  assert.equal(stepsOf(held.plan).length, 0);
  const confirmed = run(text, record(held.keys[0], { type: "confirm_new_phone" }));
  assert.equal(confirmed.delta.entries[0].kind, "new_product");
  assert.deepEqual(stepsOf(confirmed.plan).map((step) => step.kind), ["create_phone"]);
  // "Complete stock list" mode is unchanged.
  assert.equal(run(text, {}, "complete").delta.entries.find((entry) => entry.row.model === "Galaxy Z99").kind, "new_product");
});

// ---------- 2. "Only products in this list" ----------

test("listed mode on the sample: price overrides, Cobalt + All Colours wait for the Owner, nothing else is touched", () => {
  const { delta, plan } = run(SAMPLE);
  const rows = delta.entries.map((entry) => [entry.kind, entry.label, entry.currentPriceMinor && entry.currentPriceMinor / 100, entry.newPriceMinor / 100]);
  assert.deepEqual(rows, [
    ["price_change", "12 GB / 512 GB / Black", 448000, 438000],
    ["price_change", "12 GB / 512 GB / Blue", 448000, 438000],
    ["ambiguous", "12 GB / 512 GB / Cobalt", null, 440000],
    ["ambiguous", "256 GB / All Colours", null, 385000],
  ]);
  const all = delta.entries[3];
  assert.equal(all.attention, "all_colours");
  assert.deepEqual(all.reasons, [ALL_COLOURS_REASON]);
  assert.deepEqual(all.colourChoices.map((choice) => choice.color).sort(), ["Black", "Blue", "Volt", "White"]);
  assert.equal(delta.missing.length, 0, "nothing is hidden in this mode");
  assert.equal(delta.untouchedPhones, 1);
  assert.equal(plan.phones.length, 0, "the phone waits for the Owner's two choices");
  assert.match(updateWebsiteBlocker({ supabaseUrl: DEV_URL, buildMode: "development", checkIsCurrent: true, plan, confirmation: "", mode: "listed" }), /needs attention/);
});

test("listed mode, Owner's choices made: exactly the approved table — 512 White and Volt and the other phone untouched", () => {
  const { keys } = run(SAMPLE);
  const resolutions = { ...record(keys[3], { type: "select_colours", colors: ["Black", "Blue", "White", "Volt"] }), ...record(keys[2], { type: "accept_color_as_entered" }) };
  const { delta, plan } = run(SAMPLE, resolutions);
  assert.deepEqual(delta.entries.map((entry) => [entry.kind, entry.label, entry.sku, entry.newPriceMinor / 100]), [
    ["price_change", "12 GB / 512 GB / Black", "MB055", 438000],
    ["price_change", "12 GB / 512 GB / Blue", "MB057", 438000],
    ["new_variant", "12 GB / 512 GB / Cobalt", null, 440000],
    ["price_change", "12 GB / 256 GB / Black", "MB051", 385000],
    ["price_change", "12 GB / 256 GB / Blue", "MB053", 385000],
    ["price_change", "12 GB / 256 GB / White", "MB054", 385000],
    ["price_change", "12 GB / 256 GB / Volt", "MB052", 385000],
  ]);
  assert.match(delta.entries[3].notes.join(" "), /RAM 12 GB taken from the existing variant/);
  assert.match(delta.entries[3].notes.join(" "), /Chosen by you from “All Colours”: Black/);
  assert.match(delta.entries[0].notes.join(" "), /From your list: “Blk @438,000” under “Samsung S26 Ultra 12-512Gb”/);
  const steps = stepsOf(plan);
  assert.deepEqual(steps.map((step) => step.kind).sort(), ["add_variant", "price", "price", "price", "price", "price", "price"]);
  const touched = new Set(steps.filter((step) => step.kind === "price").map((step) => step.variantId));
  for (const untouched of ["id-MB056", "id-MB058", "vx1"]) assert.ok(!touched.has(untouched), `${untouched} untouched`);
  assert.ok(!steps.some((step) => ["set_stock", "hide", "show"].includes(step.kind)), "existing stock and visibility are kept");
  const add = steps.find((step) => step.kind === "add_variant");
  assert.deepEqual([add.ram, add.storage, add.color, add.priceMinor, add.stock], ["12 GB", "512 GB", "Cobalt", 44000000, 30]);
  assert.deepEqual(add.inherited, { ptaStatus: "approved", condition: "brand_new", warrantyOverride: null, deliveryScope: "karachi_only" });
  // Compare-at prices are never part of the plan (the database refuses a price at or above an existing compare-at).
  for (const step of steps.filter((item) => item.kind === "price")) assert.deepEqual(Object.keys(step).sort(), ["entryId", "fromMinor", "kind", "label", "productId", "productTitle", "sku", "toMinor", "variantId"]);
  assert.equal(plan.phones.length, 1);
  assert.equal(confirmationPhrase(plan), "UPDATE 7 CHANGES");
  assert.equal(updateWebsiteBlocker({ supabaseUrl: DEV_URL, buildMode: "development", checkIsCurrent: true, plan, confirmation: "UPDATE 7 CHANGES", mode: "listed" }), null);
});

test("Skip: a skipped row is left out and no longer holds the phone (listed mode only)", () => {
  const { keys } = run(SAMPLE);
  const resolutions = { ...record(keys[2], { type: "skip_listed_row" }), ...record(keys[3], { type: "skip_listed_row" }) };
  const { resolved, delta, plan } = run(SAMPLE, resolutions);
  assert.equal(delta.entries.length, 2);
  assert.deepEqual(resolved.skipped.map((line) => line.lineNumber), [5, 8]);
  assert.deepEqual(stepsOf(plan).map((step) => `${step.kind}:${step.sku}`), ["price:MB055", "price:MB057"]);
  assert.equal(describeResolution({ type: "skip_listed_row" }), "Skipped — this row is not changed");
  // In complete mode a skip is never applied (a skipped row would make the phone look missing and hide it).
  const complete = run(SAMPLE, resolutions, "complete");
  assert.equal(complete.delta.entries.length, 4);
  assert.deepEqual(complete.resolved.unmatched.sort(), [keys[2], keys[3]].sort());
});

test("a hidden variant listed in this mode keeps its new price but stays hidden", () => {
  const { delta, plan } = run("Samsung S26 Ultra 12/512 Volt 430000");
  assert.equal(delta.entries[0].kind, "price_change");
  assert.equal(delta.entries[0].showAgain, false);
  assert.match(delta.entries[0].notes.join(" "), /stays hidden/);
  assert.deepEqual(stepsOf(plan).map((step) => step.kind), ["price"]);
});

test("no RAM in the list: matched only when the phone has ONE RAM for that storage; a new colour is never given a RAM", () => {
  const twoRams = s26();
  twoRams.variants.push(variant("MB059", "256 GB", "Black", 370000, { ram: "8 GB" }));
  const { delta } = run("Samsung S26 Ultra 256GB Black 385000", {}, "listed", [twoRams]);
  assert.equal(delta.entries[0].kind, "ambiguous");
  assert.ok(delta.entries[0].reasons.includes(RAM_NOT_IN_LIST));
  assert.equal(explainReason(RAM_NOT_IN_LIST), RAM_NOT_IN_LIST);
  const newColour = run("Samsung S26 Ultra 256GB Green 385000");
  assert.notEqual(newColour.plan.phones.length, 1, "a new colour without RAM is not added");
  assert.equal(stepsOf(newColour.plan).length, 0);
});

test("All Colours: only the ticked colours change; nothing is pre-selected and an empty choice is not accepted", () => {
  const { keys } = run(SAMPLE);
  const two = run(SAMPLE, { ...record(keys[3], { type: "select_colours", colors: ["Black", "Blue"] }), ...record(keys[2], { type: "skip_listed_row" }) });
  assert.deepEqual(stepsOf(two.plan).map((step) => step.sku).sort(), ["MB051", "MB053", "MB055", "MB057"]);
  const none = sanitizeDraft({ ...draftFromState({ text: SAMPLE, fileName: "", wasParsed: true, lastComparedAt: null, resolutions: record(keys[3], { type: "select_colours", colors: [] }), selectionOverrides: {} }) });
  assert.deepEqual(none.resolutions, {}, "an empty colour choice is dropped on load");
  const noPhone = run("Samsung Galaxy Z99 12/512 All Colours 500000");
  assert.equal(noPhone.delta.entries[0].kind, "ambiguous");
  assert.match(noPhone.delta.entries[0].reasons[0], /needs the colours written in the list/);
});

test("duplicates: an existing variant is never added again; the same colour listed twice waits for the Owner", () => {
  const exists = run("Samsung S26 Ultra 12/512 Black 438000");
  assert.deepEqual(stepsOf(exists.plan).map((step) => step.kind), ["price"]);
  const twice = run("Samsung S26 Ultra 12/512 Black 438000\nSamsung S26 Ultra 12/512 Black 437000");
  assert.ok(twice.delta.entries.every((entry) => entry.kind === "ambiguous"));
  assert.equal(stepsOf(twice.plan).length, 0);
});

test("empty or unreadable list: zero writes", () => {
  for (const text of ["", "   \n\n", "hello there", "Gift box @ 1500"]) {
    const { plan, delta } = run(text);
    assert.equal(stepsOf(plan).length, 0, JSON.stringify(text));
    assert.equal(delta.missing.length, 0);
    assert.match(updateWebsiteBlocker({ supabaseUrl: DEV_URL, buildMode: "development", checkIsCurrent: true, plan, confirmation: "", mode: "listed" }), /Nothing to update|needs attention/);
  }
});

// ---------- 3. Complete stock list: hide safety ----------

test("complete mode keeps the original behaviour (hide + stock 30) but asks the Owner to tick the hide", () => {
  const { keys } = run(SAMPLE, {}, "complete");
  const resolutions = { ...record(keys[3], { type: "select_colours", colors: ["Black", "Blue", "White", "Volt"] }), ...record(keys[2], { type: "accept_color_as_entered" }) };
  const { delta, plan } = run(SAMPLE, resolutions, "complete");
  assert.ok(delta.missing.some((entry) => entry.productId === "p-x1" && entry.action === "hide"));
  const kinds = stepsOf(plan).map((step) => step.kind);
  assert.ok(kinds.includes("hide") && kinds.includes("set_stock"));
  const gate = { supabaseUrl: DEV_URL, buildMode: "development", checkIsCurrent: true, plan, confirmation: confirmationPhrase(plan), mode: "complete" };
  assert.match(updateWebsiteBlocker({ ...gate, hideAcknowledged: false }), /Tick the box to confirm that \d+ variant\(s\) will be hidden/);
  assert.equal(updateWebsiteBlocker({ ...gate, hideAcknowledged: true }), null);
  // Older callers (no mode) keep the original gate.
  assert.equal(updateWebsiteBlocker({ supabaseUrl: DEV_URL, buildMode: "development", checkIsCurrent: true, plan, confirmation: confirmationPhrase(plan) }), null);
});

test("complete mode: a short list that would hide many phones is refused (accidental mass hide)", () => {
  const data = [s26(), ...Array.from({ length: 8 }, (_, index) => other(index + 1))];
  const { plan } = run("Samsung S26 Ultra 12/512 Black 438000", {}, "complete", data);
  const problem = massHideProblem(plan);
  assert.match(problem, /would hide 8 phones but updates only 1/);
  assert.match(updateWebsiteBlocker({ supabaseUrl: DEV_URL, buildMode: "development", checkIsCurrent: true, plan, confirmation: confirmationPhrase(plan), mode: "complete", hideAcknowledged: true }), /looks like a partial list/);
  assert.equal(MASS_HIDE_MIN_PHONES, 5);
  // The same list in "Only products in this list" mode updates the one phone and hides nothing.
  const listed = run("Samsung S26 Ultra 12/512 Black 438000", {}, "listed", data);
  assert.deepEqual(stepsOf(listed.plan).map((step) => step.kind), ["price"]);
  assert.equal(listed.delta.untouchedPhones, 8);
});

// ---------- 4. draft + page ----------

test("draft: the mode and the new choices survive a reload; the old 'skip_row' is still dropped", () => {
  const draft = draftFromState({ text: SAMPLE, fileName: "", wasParsed: true, lastComparedAt: null, mode: "complete", selectionOverrides: {}, resolutions: {
    a: { rowKey: "a", resolution: { type: "select_colours", colors: ["Black", " Blue "] }, sourceLine: "", label: "", decidedAt: "" },
    b: { rowKey: "b", resolution: { type: "skip_listed_row" }, sourceLine: "", label: "", decidedAt: "" },
    c: { rowKey: "c", resolution: { type: "skip_row" }, sourceLine: "", label: "", decidedAt: "" },
  } });
  const back = sanitizeDraft(JSON.parse(JSON.stringify(draft)));
  assert.equal(back.mode, "complete");
  assert.deepEqual(back.resolutions.a.resolution, { type: "select_colours", colors: ["Black", "Blue"] });
  assert.deepEqual(back.resolutions.b.resolution, { type: "skip_listed_row" });
  assert.equal(back.resolutions.c, undefined);
});

test("page: safe mode by default, mode is part of the gate, preview has an action per row, colours never pre-ticked", () => {
  const ui = readFileSync(new URL("../src/admin/StockListUpdate.tsx", import.meta.url), "utf8").replace(/\r\n/g, "\n");
  assert.match(ui, /useState<UpdateMode>\(restored\?\.mode \?\? "listed"\)/);
  assert.match(ui, /const gate = \{ supabaseUrl: SUPABASE_URL, buildMode: BUILD_MODE, checkIsCurrent, plan: phonePlan, mode, hideAcknowledged \};/);
  assert.match(ui, /function changeMode\(next: UpdateMode\) \{[\s\S]*?setStamp\(null\);[\s\S]*?setHideAcknowledged\(false\);/);
  assert.match(ui, /<option value="skip">\{PREVIEW\.actionSkip\}<\/option>/);
  assert.match(ui, /const \[picked, setPicked\] = useState<string\[\]>\(\[\]\);/);
  assert.match(ui, /HIDE_WARNING\.acknowledge/);
  assert.match(ui, /hidden=\{mode === "listed"\}/);
  assert.doesNotMatch(ui, /\.(insert|upsert|update)\s*\(|\.rpc\s*\(|from\("/);
});

// ---------- 5. PTA & condition safety (Owner-approved 2026-11-23) ----------

test("PTA words: a standalone PTA / (PTA) / PTA Approved anywhere is read as PTA Approved; Non-PTA and semicolon lines unchanged", async () => {
  const { normalisePtaWords } = await import("../src/lib/supplierListBlocks.ts");
  for (const line of [
    "Samsung S26 Ultra 12/512 Black PTA 438000",
    "Samsung S26 Ultra 12/512 PTA Black 438000",
    "Samsung S26 Ultra PTA 12/512 Black 438000",
    "Samsung S26 Ultra 12/512 Black (PTA) 438000",
    "Samsung S26 Ultra 12/512 Black @438,000 PTA",
    "Samsung S26 Ultra 12/512 Black PTA Approved 438000",
  ]) {
    const row = parseStockList(line, brands).rows[0];
    assert.deepEqual([row.productTitle, row.color, row.ptaStatus, row.priceMinor / 100], ["Samsung S26 Ultra", "Black", "approved", 438000], line);
  }
  assert.equal(normalisePtaWords("Samsung S26 Ultra 12/512 Black Non-PTA 438000"), "Samsung S26 Ultra 12/512 Black Non-PTA 438000");
  assert.equal(normalisePtaWords("Samsung S26 Ultra 12/512 Black; 438000; PTA"), "Samsung S26 Ultra 12/512 Black; 438000; PTA");
  assert.equal(parseStockList("Samsung S26 Ultra 12/512 Black Non PTA 438000", brands).rows[0].ptaStatus, "not_approved");
  // Bulk Import's shared parser is untouched by this (it still reads "Black PTA" as written).
  assert.equal(normalizeStockLines("Samsung S26 Ultra 12/512 Black PTA 438000", { brands }).rows[0].color, "Black Pta");
});

test("a supplier heading may carry PTA / Non-PTA / Used for every colour line under it", () => {
  const nonPta = parseStockList("Samsung S26 Ultra 12-512Gb Non-PTA\n\nBlk @438,000\nBlue @438,000", brands).rows;
  assert.deepEqual(nonPta.map((row) => [row.color, row.ram, row.storage, row.ptaStatus, row.condition]), [["Black", "12 GB", "512 GB", "not_approved", null], ["Blue", "12 GB", "512 GB", "not_approved", null]]);
  const pta = parseStockList("Samsung S26 Ultra PTA 12-512Gb\nBlk @438,000", brands).rows[0];
  assert.deepEqual([pta.productTitle, pta.color, pta.ptaStatus], ["Samsung S26 Ultra", "Black", "approved"]);
  const used = parseStockList("Samsung S26 Ultra 12-512Gb Used\nBlk @300,000", brands).rows[0];
  assert.equal(used.condition, "used");
});

test("new variant stating Non-PTA / Used that would be saved as PTA Approved / Brand New: Needs Attention, nothing written", () => {
  const accept = (text) => {
    const { keys } = run(text);
    return run(text, record(keys[0], { type: "accept_color_as_entered" }));
  };
  const nonPta = accept("Samsung S26 Ultra 12/512 Cobalt Non-PTA 440000");
  assert.equal(nonPta.delta.entries[0].kind, "ambiguous");
  assert.equal(nonPta.delta.entries[0].reasons.at(-1), "This line says Non-PTA, but the new variant would be saved as PTA Approved (copied from this phone's other variants) — add it by hand in Catalog, correct the line, or Skip");
  assert.equal(stepsOf(nonPta.plan).length, 0);
  assert.equal(explainReason(nonPta.delta.entries[0].reasons.at(-1)), nonPta.delta.entries[0].reasons.at(-1), "shown to the Owner as written");
  const used = accept("Samsung S26 Ultra 12/512 Cobalt Used 440000");
  assert.match(used.delta.entries[0].reasons.join(" "), /This line says Used, but the new variant would be saved as Brand New/);
  const both = accept("Samsung S26 Ultra 12/512 Cobalt Non-PTA Used 440000");
  assert.match(both.delta.entries[0].reasons.join(" "), /This line says Non-PTA \/ Used, but the new variant would be saved as PTA Approved \/ Brand New/);
  // Stated facts that match what would be saved are fine (and the plain Cobalt workflow is unchanged).
  for (const text of ["Samsung S26 Ultra 12/512 Cobalt PTA 440000", "Samsung S26 Ultra 12/512 Cobalt 440000"]) {
    const ok = accept(text);
    assert.equal(ok.delta.entries[0].kind, "new_variant", text);
    const add = stepsOf(ok.plan).find((step) => step.kind === "add_variant");
    assert.deepEqual([add.color, add.inherited.ptaStatus, add.inherited.condition], ["Cobalt", "approved", "brand_new"], text);
  }
});

test("new phone stating Non-PTA / Used that would be saved with the Android defaults: Needs Attention, nothing created", () => {
  const nonPta = run("Samsung Galaxy Z99 12/512 Black Non-PTA 300000", confirmNew("Samsung Galaxy Z99 12/512 Black Non-PTA 300000"));
  assert.equal(nonPta.delta.entries[0].kind, "ambiguous");
  assert.match(nonPta.delta.entries[0].reasons.join(" "), /This line says Non-PTA, but the new phone would be saved as PTA Approved \(the Android new-phone default\)/);
  assert.equal(stepsOf(nonPta.plan).length, 0);
  assert.match(run("Samsung Galaxy Z99 12/512 Black Used 300000", confirmNew("Samsung Galaxy Z99 12/512 Black Used 300000")).delta.entries[0].reasons.join(" "), /This line says Used, but the new phone would be saved as Brand New/);
  const ok = run("Samsung Galaxy Z99 12/512 Black PTA 300000", confirmNew("Samsung Galaxy Z99 12/512 Black PTA 300000"));
  assert.equal(ok.delta.entries[0].kind, "new_product");
  const create = stepsOf(ok.plan).find((step) => step.kind === "create_phone");
  assert.deepEqual([create.payload.variants[0].pta_status, create.payload.variants[0].condition], ["approved", "brand_new"]);
});

test("existing variants: a price update never changes PTA / condition; a line stating different facts is held", () => {
  const ok = run("Samsung S26 Ultra 12/512 Black PTA 438000");
  assert.deepEqual(stepsOf(ok.plan).map((step) => [step.kind, step.sku]), [["price", "MB055"]]);
  for (const step of stepsOf(ok.plan)) assert.ok(!("ptaStatus" in step) && !("condition" in step) && !("inherited" in step));
  for (const text of ["Samsung S26 Ultra 12/512 Black Non-PTA 438000", "Samsung S26 Ultra 12/512 Black Used 438000"]) {
    const held = run(text);
    assert.equal(held.delta.entries[0].kind, "ambiguous", text);
    assert.equal(stepsOf(held.plan).length, 0, text);
  }
});

test("second line of defence: the write plan itself refuses a new variant / phone whose stated facts differ", () => {
  const { keys } = run("Samsung S26 Ultra 12/512 Cobalt 440000");
  const resolved = applyResolutions(parseStockList("Samsung S26 Ultra 12/512 Cobalt 440000", brands), record(keys[0], { type: "accept_color_as_entered" }), { mode: "listed" });
  const delta = buildStockDelta(resolved.parsed, catalog(), resolved.rowDecisions, { mode: "listed" });
  delta.entries[0].row = { ...delta.entries[0].row, ptaStatus: "not_approved" }; // as if a row slipped past the comparison
  const plan = buildPhonePlan(delta, catalog(), ["Samsung"]);
  assert.equal(stepsOf(plan).length, 0);
  assert.match(plan.held[0].reasons.join(" "), /This line says Non-PTA/);
  const phone = run("Samsung Galaxy Z99 12/512 Black 300000", confirmNew("Samsung Galaxy Z99 12/512 Black 300000"));
  phone.delta.entries[0].row = { ...phone.delta.entries[0].row, condition: "used" };
  assert.equal(stepsOf(buildPhonePlan(phone.delta, catalog(), ["Samsung"])).length, 0);
});

test("the approved S26 Ultra workflow is unchanged by the PTA safety fix", () => {
  const { keys } = run(SAMPLE);
  const { plan } = run(SAMPLE, { ...record(keys[3], { type: "select_colours", colors: ["Black", "Blue", "White", "Volt"] }), ...record(keys[2], { type: "accept_color_as_entered" }) });
  assert.equal(confirmationPhrase(plan), "UPDATE 7 CHANGES");
  assert.deepEqual(stepsOf(plan).map((step) => step.kind).sort(), ["add_variant", "price", "price", "price", "price", "price", "price"]);
});

// ---------- 6. List-wide PTA / condition choice (Owner-approved 2026-11-23) ----------

const runWith = (text, listFacts, resolutions = {}, mode = "listed", data = catalog()) => {
  const parsed = parseStockList(text, brands);
  const resolved = applyResolutions(parsed, resolutions, { mode });
  const delta = buildStockDelta(resolved.parsed, data, resolved.rowDecisions, { mode, listFacts });
  return { delta, plan: buildPhonePlan(delta, data, ["Samsung", "Xiaomi"]), keys: buildRowKeys(parsed.rows) };
};
const APPROVED_NEW = { ptaStatus: "approved", condition: "brand_new" };

test("default choice (PTA Approved + Brand New) leaves the approved S26 Ultra workflow exactly as it was", () => {
  const { keys } = runWith(SAMPLE, APPROVED_NEW);
  const { delta, plan } = runWith(SAMPLE, APPROVED_NEW, { ...record(keys[3], { type: "select_colours", colors: ["Black", "Blue", "White", "Volt"] }), ...record(keys[2], { type: "accept_color_as_entered" }) });
  assert.equal(confirmationPhrase(plan), "UPDATE 7 CHANGES");
  const add = stepsOf(plan).find((step) => step.kind === "add_variant");
  assert.deepEqual([add.color, add.inherited.ptaStatus, add.inherited.condition], ["Cobalt", "approved", "brand_new"]);
  assert.equal(delta.listFacts.ptaStatus, "approved");
  for (const step of stepsOf(plan).filter((item) => item.kind === "price")) assert.ok(!("inherited" in step));
});

test("All Colours under a different PTA / condition choice says so (the colours exist; their facts are never changed)", () => {
  const { delta, plan } = runWith(SAMPLE, { ptaStatus: "not_approved", condition: "brand_new" });
  const all = delta.entries.find((entry) => entry.label.includes("All Colours"));
  assert.match(all.reasons[0], /^“All Colours” — this phone's colours for this storage have a different PTA \/ condition than this line or your choice above/);
  assert.equal(explainReason(all.reasons[0]), all.reasons[0]);
  assert.equal(stepsOf(plan).length, 0);
});

test("existing variants are never re-faceted: a Non-PTA / Used choice holds the approved / new variant instead of re-pricing it", () => {
  for (const facts of [{ ptaStatus: "not_approved", condition: "brand_new" }, { ptaStatus: "approved", condition: "used" }]) {
    const { delta, plan } = runWith("Samsung S26 Ultra 12/512 Black 438000", facts);
    assert.equal(delta.entries[0].kind, "ambiguous", JSON.stringify(facts));
    assert.match(delta.entries[0].reasons.join(" "), /different PTA\/Condition/);
    assert.equal(stepsOf(plan).length, 0);
  }
});

test("new phones get the chosen values; Used gets no warranty (never assumed); stated words win only when they agree", () => {
  const nonPta = stepsOf(runWith("Samsung Galaxy Z99 12/512 Black 300000", { ptaStatus: "not_approved", condition: "brand_new" }, confirmNew("Samsung Galaxy Z99 12/512 Black 300000")).plan).find((step) => step.kind === "create_phone");
  assert.deepEqual([nonPta.payload.variants[0].pta_status, nonPta.payload.variants[0].condition, nonPta.payload.variants[0].warranty], ["not_approved", "brand_new", "1 Year"]);
  const used = runWith("Samsung Galaxy Z99 12/512 Black 300000", { ptaStatus: "approved", condition: "used" }, confirmNew("Samsung Galaxy Z99 12/512 Black 300000"));
  const usedStep = stepsOf(used.plan).find((step) => step.kind === "create_phone");
  assert.deepEqual([usedStep.payload.variants[0].pta_status, usedStep.payload.variants[0].condition, usedStep.payload.variants[0].warranty], ["approved", "used", null]);
  assert.ok(used.delta.entries[0].requirements.some((need) => /Warranty: none is assumed for a Used phone/.test(need)));
  // A line that states the chosen value is fine; a line that states something else needs the Owner.
  assert.equal(runWith("Samsung Galaxy Z99 12/512 Black Non-PTA 300000", { ptaStatus: "not_approved", condition: "brand_new" }, confirmNew("Samsung Galaxy Z99 12/512 Black Non-PTA 300000")).delta.entries[0].kind, "new_product");
  const clash = runWith("Samsung Galaxy Z99 12/512 Black Non-PTA 300000", APPROVED_NEW, confirmNew("Samsung Galaxy Z99 12/512 Black Non-PTA 300000"));
  assert.equal(clash.delta.entries[0].kind, "ambiguous");
  assert.equal(clash.delta.entries[0].reasons.at(-1), "This line says Non-PTA, but you chose PTA Approved for this list — correct the line, change the choice above, or Skip");
  assert.equal(stepsOf(clash.plan).length, 0);
  assert.equal(explainReason(clash.delta.entries[0].reasons.at(-1)), clash.delta.entries[0].reasons.at(-1));
});

test("new variant: created only when the choice matches the phone's variants; otherwise Needs Attention (database update needed)", () => {
  const accept = (facts) => {
    const { keys } = runWith("Samsung S26 Ultra 12/512 Cobalt 440000", facts);
    return runWith("Samsung S26 Ultra 12/512 Cobalt 440000", facts, record(keys[0], { type: "accept_color_as_entered" }));
  };
  const ok = accept(APPROVED_NEW);
  assert.equal(ok.delta.entries[0].kind, "new_variant");
  const nonPta = accept({ ptaStatus: "not_approved", condition: "brand_new" });
  assert.equal(nonPta.delta.entries[0].kind, "ambiguous");
  assert.match(nonPta.delta.entries[0].reasons.at(-1), /^You chose Non-PTA, but this phone's other variants are PTA Approved — this page can only add a new variant that matches them \(a database update is needed for this\)/);
  assert.equal(stepsOf(nonPta.plan).length, 0);
  assert.equal(stepsOf(accept({ ptaStatus: "approved", condition: "used" }).plan).length, 0);
});

test("second line of defence: the plan refuses a new variant / phone whose effective facts differ from the choice", () => {
  const phone = runWith("Samsung Galaxy Z99 12/512 Black 300000", APPROVED_NEW, confirmNew("Samsung Galaxy Z99 12/512 Black 300000"));
  phone.delta.entries[0].row = { ...phone.delta.entries[0].row, ptaStatus: "not_approved" };
  assert.equal(stepsOf(buildPhonePlan(phone.delta, catalog(), ["Samsung"])).length, 0);
  const { keys } = runWith("Samsung S26 Ultra 12/512 Cobalt 440000", APPROVED_NEW);
  const variantRun = runWith("Samsung S26 Ultra 12/512 Cobalt 440000", APPROVED_NEW, record(keys[0], { type: "accept_color_as_entered" }));
  variantRun.delta.listFacts = { ptaStatus: "not_approved", condition: "brand_new" };
  const plan = buildPhonePlan(variantRun.delta, catalog(), ["Samsung"]);
  assert.equal(stepsOf(plan).length, 0);
  assert.match(plan.held[0].reasons.join(" "), /You chose Non-PTA/);
});

test("the choice is saved with the list and validated on reload; mass-hide protection is unchanged", () => {
  const draft = draftFromState({ text: SAMPLE, fileName: "", wasParsed: true, lastComparedAt: null, mode: "listed", listFacts: { ptaStatus: "not_approved", condition: "used" }, resolutions: {}, selectionOverrides: {} });
  assert.deepEqual(sanitizeDraft(JSON.parse(JSON.stringify(draft))).listFacts, { ptaStatus: "not_approved", condition: "used" });
  assert.equal(sanitizeDraft({ ...JSON.parse(JSON.stringify(draft)), listFacts: { ptaStatus: "maybe", condition: "used" } }).listFacts, undefined);
  const data = [s26(), ...Array.from({ length: 8 }, (_, index) => other(index + 1))];
  const { plan } = runWith("Samsung S26 Ultra 12/512 Black 438000", APPROVED_NEW, {}, "complete", data);
  assert.match(massHideProblem(plan), /would hide 8 phones but updates only 1/);
});

test("page: PTA and Condition choices like iPhone Stock, default PTA Approved + Brand New, a change requires a new check", () => {
  const ui = readFileSync(new URL("../src/admin/StockListUpdate.tsx", import.meta.url), "utf8").replace(/\r\n/g, "\n");
  assert.match(ui, /useState<ListFacts>\(restored\?\.listFacts \?\? DEFAULT_LIST_FACTS\)/);
  assert.match(ui, /<option value="not_approved">\{LIST_FACTS\.ptaOptions\.not_approved\}<\/option>/);
  assert.match(ui, /<option value="used">\{LIST_FACTS\.conditionOptions\.used\}<\/option>/);
  assert.match(ui, /function changeListFacts\(next: ListFacts\) \{[\s\S]*?setStamp\(null\);/);
  assert.doesNotMatch(ui, /\.(insert|upsert|update)\s*\(|\.rpc\s*\(|from\("/);
});
