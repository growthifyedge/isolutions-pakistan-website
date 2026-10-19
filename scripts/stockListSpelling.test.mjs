import test from "node:test";
import assert from "node:assert/strict";
import { AUTO_APPLY_SPELLING_CORRECTIONS, buildStockDelta, nameWords, oneWordCorrection, parseStockList } from "../src/lib/stockListDelta.ts";
import { applyResolutions, buildRowKeys, describeResolution, draftFromState, loadDraft, saveDraft } from "../src/lib/stockListDraft.ts";
import { buildWritePlan } from "../src/lib/stockUpdateApply.ts";

// Android Stock Update, Phase 2: spelling suggestions (never guessed, never applied without the Owner), "looks like an
// existing phone" holds, and the Owner's identity decisions. Pure planning only: no database.

const brands = ["Samsung", "Xiaomi", "Motorola", "Tecno", "Apple"].map((name) => ({ name }));

let n = 0;
const variant = (ram, storage, color, price, extra = {}) => ({
  id: `v${++n}`, sku: `MB${String(n).padStart(3, "0")}`, ram, storage, color, priceMinor: price * 100, compareAtPriceMinor: null,
  stock: 10, ptaStatus: "approved", condition: "brand_new", conditionGrade: null, batteryHealth: null, cycleCount: null, isActive: true,
  warrantyOverride: "1 Year", deliveryScope: "karachi_only", ...extra,
});
const product = (title, variants, extra = {}) => ({
  id: `p-${title}`, slug: title.toLowerCase().replace(/\+/g, " plus ").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""), title, brand: title.split(" ")[0],
  category: "Mobile Phones", categorySlug: "mobile-phones", publicationStatus: "published", mediaCount: 3, specCount: 10, variants, ...extra,
});
const note15Pro = (extra = {}, variants = null) =>
  product("Xiaomi Redmi Note 15 Pro", variants ?? [variant("8 GB", "256 GB", "Black", 85000), variant("8 GB", "256 GB", "White", 85000)], extra);
const samsungA07 = () => product("Samsung A07", [variant("4 GB", "64 GB", "Black", 36900)]);

const run = (text, catalog, decisions) => buildStockDelta(parseStockList(text, brands), catalog, decisions);
const PR = "Xiaomi\nRedmi Note 15 Pr 8/256 black @ 84000";

// ---------------------------------------------------------------------------
// The one-word rule
// ---------------------------------------------------------------------------

test("one-word rule: shortened word or one wrong letter only; digits, known words and whole words never", () => {
  const known = new Set(["xiaomi", "redmi", "note", "15", "pro", "lite", "max"]);
  const fix = (a, b) => oneWordCorrection(nameWords(a), nameWords(b), known);
  assert.deepEqual(fix("Xiaomi Redmi Note 15 Pr", "Xiaomi Redmi Note 15 Pro"), { from: "pr", to: "pro" });
  assert.deepEqual(fix("Xiaomi Redmii Note 15 Pro", "Xiaomi Redmi Note 15 Pro"), { from: "redmii", to: "redmi" });
  assert.deepEqual(fix("Xiaomi Redmi Ntoe 15 Pro", "Xiaomi Redmi Note 15 Pro"), { from: "ntoe", to: "note" }, "two neighbouring letters swapped");
  assert.equal(fix("Xiaomi Redmi Note 16 Pro", "Xiaomi Redmi Note 15 Pro"), null, "numbers are never corrected");
  assert.equal(fix("Samsung A56", "Samsung A57"), null, "words with digits are never corrected");
  assert.equal(fix("Xiaomi Redmi Note 15 4G", "Xiaomi Redmi Note 15 5G"), null);
  assert.equal(fix("Xiaomi Redmi Note 15", "Xiaomi Redmi Note 15 Pro"), null, "a missing whole word is never added");
  assert.equal(fix("Xiaomi Redmi Note 15 Pro Max", "Xiaomi Redmi Note 15 Pro"), null, "an extra whole word is never removed");
  assert.equal(fix("Xiaomi Redmi Note 15 P", "Xiaomi Redmi Note 15 Pro"), null, "one letter is too short to complete");
  assert.equal(fix("Xiaomi Redmi Note 15 Lite", "Xiaomi Redmi Note 15 Life"), null, "a real model word is never 'corrected'");
  assert.equal(fix("Xiaomi Redmi Note 15 Mxa", "Xiaomi Redmi Note 15 Max"), null, "3-letter words only by shortening");
  assert.equal(fix("Xiaomi Redmii Note 15 Pr", "Xiaomi Redmi Note 15 Pro"), null, "two different words: no suggestion");
  assert.equal(fix("Xiaomi Redmi Note 15 Pro+", "Xiaomi Redmi Note 15 Pro"), null, "+ is the word plus");
});

// ---------------------------------------------------------------------------
// Suggestions wait for the Owner
// ---------------------------------------------------------------------------

test("Redmi Note 15 Pr: one clear suggestion, Needs Attention until the Owner confirms, the real phone is held (never hidden)", () => {
  const catalog = [note15Pro(), samsungA07()];
  const delta = run(PR, catalog);
  const [entry] = delta.entries;
  assert.equal(AUTO_APPLY_SPELLING_CORRECTIONS, false);
  assert.equal(entry.kind, "ambiguous");
  assert.equal(entry.attention, "spelling");
  assert.equal(entry.productId, null, "not matched until confirmed");
  assert.deepEqual([entry.suggestion.productTitle, entry.suggestion.from, entry.suggestion.to, entry.suggestion.variantId], ["Xiaomi Redmi Note 15 Pro", "pr", "pro", catalog[0].variants[0].id]);
  assert.match(entry.reasons.at(-1), /Looks like a spelling mistake for “Xiaomi Redmi Note 15 Pro”/);
  assert.equal(delta.counts.spellingSuggestions, 1);
  assert.equal(delta.counts.notMatched, 1);
  assert.equal(delta.missing.find((m) => m.productTitle === "Xiaomi Redmi Note 15 Pro").action, "held");
  assert.equal(delta.missing.find((m) => m.productTitle === "Samsung A07").action, "hide", "unrelated phones follow the normal rule");
  assert.equal(delta.counts.newProducts, 0, "never a duplicate phone");
});

test("a misspelt brand-line word (Redmii) is suggested the same way", () => {
  const delta = run("Xiaomi\nRedmii Note 15 Pro 8/256 black @ 85000", [note15Pro()]);
  assert.equal(delta.entries[0].attention, "spelling");
  assert.deepEqual([delta.entries[0].suggestion.from, delta.entries[0].suggestion.to], ["redmii", "redmi"]);
});

test("two possible phones (Note 15 Pro and Note 15 Pro+): no suggestion, both held, Owner decides", () => {
  const delta = run(PR, [note15Pro(), product("Xiaomi Redmi Note 15 Pro+", [variant("8 GB", "256 GB", "Black", 99000)])]);
  const [entry] = delta.entries;
  assert.equal(entry.kind, "ambiguous");
  assert.equal(entry.attention, "looks_like_existing");
  assert.equal(entry.suggestion, null);
  assert.deepEqual(entry.nearTitles.sort(), ["Xiaomi Redmi Note 15 Pro", "Xiaomi Redmi Note 15 Pro+"]);
  assert.deepEqual(delta.missing.map((m) => m.action), ["held", "held"]);
});

test("Note 15 Pr when Note 15 also exists: no suggestion (Pr might be noise), both held", () => {
  const delta = run(PR, [note15Pro(), product("Xiaomi Redmi Note 15", [variant("8 GB", "256 GB", "Black", 70000)])]);
  assert.equal(delta.entries[0].attention, "looks_like_existing");
  assert.equal(delta.entries[0].suggestion, null);
  assert.deepEqual(delta.missing.map((m) => m.action), ["held", "held"]);
});

test("a missing whole word (Note 15 vs Note 15 Pro) is never corrected: it waits for the Owner and the Pro is held", () => {
  const delta = run("Xiaomi\nRedmi Note 15 8/256 black @ 70000", [note15Pro()]);
  assert.equal(delta.entries[0].kind, "ambiguous");
  assert.equal(delta.entries[0].attention, "looks_like_existing");
  assert.equal(delta.entries[0].suggestion, null);
  assert.equal(delta.missing[0].action, "held");
});

test("the suggested phone must have exactly this RAM / storage / colour, otherwise no suggestion (never a new variant by guess)", () => {
  const delta = run("Xiaomi\nRedmi Note 15 Pr 12/512 purple @ 99000", [note15Pro()]);
  const [entry] = delta.entries;
  assert.equal(entry.attention, "looks_like_existing");
  assert.equal(entry.suggestion, null);
  assert.match(entry.reasons.at(-1), /has no 12 GB \/ 512 GB \/ Purple variant/);
  assert.equal(delta.counts.newVariants, 0);
});

test("a different number (Note 16 Pro vs Note 15 Pro) is never corrected", () => {
  const delta = run("Xiaomi\nRedmi Note 16 Pro 8/256 black @ 85000", [note15Pro()]);
  assert.equal(delta.entries[0].suggestion, null);
  assert.notEqual(delta.entries[0].attention, "spelling");
});

test("archived phones are never a correction target; a hidden variant is never auto-safe", () => {
  const archived = run(PR, [note15Pro({ publicationStatus: "archived" })]);
  assert.equal(archived.entries[0].suggestion, null);
  const hidden = run(PR, [note15Pro({}, [variant("8 GB", "256 GB", "Black", 85000, { isActive: false })])]);
  assert.equal(hidden.entries[0].attention, "spelling");
  assert.equal(hidden.entries[0].suggestion.autoSafe, false);
});

test("no suggestion when another line already lists the same variant exactly", () => {
  const delta = run("Xiaomi\nRedmi Note 15 Pro 8/256 black @ 85000\nRedmi Note 15 Pr 8/256 black @ 84000", [note15Pro()]);
  const typo = delta.entries[1];
  assert.equal(delta.entries[0].kind, "unchanged");
  assert.equal(typo.kind, "ambiguous");
  assert.equal(typo.attention, "looks_like_existing");
  assert.equal(typo.suggestion, null);
  assert.match(typo.reasons.at(-1), /another line already lists that variant/);
});

test("non-Android lines are never compared or corrected", () => {
  const delta = run("Apple\niPhone 15 Pr 6/128 black @ 250000", [product("Apple iPhone 15 Pro", [variant("6 GB", "128 GB", "Black", 250000)], { brand: "Apple" })]);
  assert.equal(delta.entries[0].kind, "blocked");
  assert.equal(delta.entries[0].suggestion, null);
  assert.equal(delta.missing.length, 0);
});

test("a line that looks like nothing on the website stays a normal new phone", () => {
  const delta = run("Tecno\nSpark Go 3 4/64 black @ 20000", [note15Pro(), samsungA07()]);
  assert.equal(delta.entries[0].kind, "new_product");
  assert.equal(delta.entries[0].attention, null);
  assert.equal(delta.counts.notMatched, 0);
});

// ---------------------------------------------------------------------------
// The Owner's decisions
// ---------------------------------------------------------------------------

test("after the Owner confirms the suggestion, the line updates that exact existing variant (no new phone, no new variant)", () => {
  const catalog = [note15Pro()];
  const delta = run(PR, catalog, [{ matchProductId: catalog[0].id }]);
  const [entry] = delta.entries;
  assert.equal(entry.kind, "price_change");
  assert.equal(entry.variantId, catalog[0].variants[0].id);
  assert.equal(entry.sku, catalog[0].variants[0].sku);
  assert.equal(entry.suggestion.to, "pro");
  assert.ok(entry.notes.some((note) => /Spelling corrected by you: “pr” → “pro”/.test(note)));
  // The phone's White variant is not in the list: hidden as usual (the phone itself was matched).
  assert.deepEqual(delta.missing.map((m) => [m.label, m.action]), [["8 GB / 256 GB / White", "hide"]]);

  const plan = buildWritePlan(delta, catalog, ["Xiaomi"]);
  assert.equal(plan.blocked.length, 0);
  assert.deepEqual(plan.steps.map((step) => [step.kind, step.variantId ?? step.variantIds?.join(",")]), [
    ["price", catalog[0].variants[0].id],
    ["set_stock", catalog[0].variants[0].id],
    ["hide", catalog[0].variants[1].id],
  ]);
});

test("a confirmation that no longer fits (another look-alike phone appeared) needs attention again and holds both phones", () => {
  const catalog = [note15Pro(), product("Xiaomi Redmi Note 15 Pro+", [variant("8 GB", "256 GB", "Black", 99000)])];
  const delta = run(PR, catalog, [{ matchProductId: catalog[0].id }]);
  assert.equal(delta.entries[0].kind, "ambiguous");
  assert.equal(delta.entries[0].attention, "decision_stale");
  assert.deepEqual(delta.missing.map((m) => m.action), ["held", "held"]);
});

test("a confirmation for a different phone than the suggestion is never used", () => {
  const delta = run(PR, [note15Pro()], [{ matchProductId: "p-Samsung A07" }]);
  assert.equal(delta.entries[0].attention, "decision_stale");
  assert.equal(delta.entries[0].variantId, null);
});

test("confirming a new phone creates it as a new phone and the look-alike follows the normal list rule", () => {
  const delta = run(PR, [note15Pro()], [{ confirmNewPhone: true }]);
  assert.equal(delta.entries[0].kind, "new_product");
  assert.ok(delta.entries[0].notes.some((note) => /You confirmed this is a new phone/.test(note)));
  assert.equal(delta.missing[0].action, "hide");
});

// ---------------------------------------------------------------------------
// Saved fixes (draft)
// ---------------------------------------------------------------------------

const memoryStorage = () => {
  const map = new Map();
  return { getItem: (key) => map.get(key) ?? null, setItem: (key, value) => map.set(key, value), removeItem: (key) => map.delete(key) };
};

test("the Owner's correction applies to every colour of the line, survives save / restore, and flows into the comparison", () => {
  const text = "Xiaomi\nRedmi Note 15 Pr 8/256 black/white @ 84000";
  const catalog = [note15Pro()];
  const parsed = parseStockList(text, brands);
  const [blackKey] = buildRowKeys(parsed.rows);
  const resolutions = { [blackKey]: { rowKey: blackKey, resolution: { type: "accept_correction", productId: catalog[0].id, productTitle: catalog[0].title }, sourceLine: parsed.rows[0].sourceLine, label: "", decidedAt: "" } };

  const storage = memoryStorage();
  assert.equal(saveDraft(storage, draftFromState({ text, fileName: "", wasParsed: true, lastComparedAt: null, resolutions, selectionOverrides: {} })), true);
  const restored = loadDraft(storage);
  assert.equal(restored.status, "restored");
  assert.deepEqual(restored.draft.resolutions[blackKey].resolution, resolutions[blackKey].resolution);

  const resolved = applyResolutions(parseStockList(restored.draft.text, brands), restored.draft.resolutions);
  assert.deepEqual(resolved.rowDecisions, [{ matchProductId: catalog[0].id }, { matchProductId: catalog[0].id }]);
  assert.deepEqual(resolved.unmatched, []);
  const delta = buildStockDelta(resolved.parsed, catalog, resolved.rowDecisions);
  assert.deepEqual(delta.entries.map((e) => [e.row.color, e.kind, e.variantId]), [
    ["Black", "price_change", catalog[0].variants[0].id],
    ["White", "price_change", catalog[0].variants[1].id],
  ]);
  assert.equal(delta.counts.newProducts, 0);
});

test("confirm-new-phone is saved per line; damaged saved decisions are dropped, never guessed", () => {
  const text = "Xiaomi\nRedmi Note 15 Pr 8/256 black/white @ 84000";
  const parsed = parseStockList(text, brands);
  const [key] = buildRowKeys(parsed.rows);
  const resolved = applyResolutions(parsed, { [key]: { rowKey: key, resolution: { type: "confirm_new_phone" }, sourceLine: "", label: "", decidedAt: "" } });
  assert.deepEqual(resolved.rowDecisions, [{ confirmNewPhone: true }, { confirmNewPhone: true }]);

  const storage = memoryStorage();
  const bad = { [key]: { rowKey: key, resolution: { type: "accept_correction", productId: "", productTitle: "X" }, sourceLine: "", label: "", decidedAt: "" } };
  saveDraft(storage, draftFromState({ text, fileName: "", wasParsed: true, lastComparedAt: null, resolutions: bad, selectionOverrides: {} }));
  assert.deepEqual(loadDraft(storage).draft.resolutions, {});
});

test("lists without decisions behave exactly as before (rowDecisions are all empty)", () => {
  const parsed = parseStockList("Samsung\nA07 4/64 black @ 36900", brands);
  const resolved = applyResolutions(parsed, {});
  assert.deepEqual(resolved.rowDecisions, [undefined]);
  assert.equal(buildStockDelta(resolved.parsed, [samsungA07()], resolved.rowDecisions).entries[0].kind, "unchanged");
});

test("the new fixes are described in plain words", () => {
  assert.equal(describeResolution({ type: "accept_correction", productId: "x", productTitle: "Xiaomi Redmi Note 15 Pro" }), "Matched to “Xiaomi Redmi Note 15 Pro”");
  assert.equal(describeResolution({ type: "confirm_new_phone" }), "Confirmed as a new phone");
});
