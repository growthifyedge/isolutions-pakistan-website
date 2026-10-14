import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildStockDelta, parseStockList, tableToStockText } from "../src/lib/stockListDelta.ts";
import {
  DRAFT_STORAGE_KEY,
  applyResolutions,
  buildRowKeys,
  clearDraft,
  clearDraftAfterVerifiedApply,
  comparisonAuthorizesApply,
  draftFromState,
  fingerprintText,
  loadDraft,
  makeComparisonStamp,
  resolutionOptions,
  saveDraft,
} from "../src/lib/stockListDraft.ts";

const brands = ["Motorola", "Samsung", "Realme", "ZTE", "Xiaomi"].map((name) => ({ name }));

// A fake localStorage so "reload" = a fresh loadDraft() over the same backing store.
const memoryStorage = (initial = {}) => {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (key) => (data.has(key) ? data.get(key) : null),
    setItem: (key, value) => void data.set(key, String(value)),
    removeItem: (key) => void data.delete(key),
    raw: () => data.get(DRAFT_STORAGE_KEY),
    has: () => data.has(DRAFT_STORAGE_KEY),
  };
};

const LIST = [
  "Motorola", "Edge 50 Ultra 12/512 wood @ 100000", "",
  "Samsung", "A57 8/256 i.blue/black @ 90000", "A07 4/64 black @ 36900", "",
  "Realme", "Note 60x 3+5/64 black @ 20000", "Note 60x 4+4/64 blue @ 21000", "",
  "ZTE", "A36 4+8/64 blue @ 20000", "Focus Pro 8/256 5g black/brown @ 50000",
].join("\n");

const parse = (text = LIST) => parseStockList(text, brands);
const record = (rowKey, resolution) => ({ rowKey, resolution, sourceLine: "", label: "", decidedAt: "2026-10-13T00:00:00.000Z" });
const rowWhere = (parsed, predicate) => {
  const keys = buildRowKeys(parsed.rows);
  const index = parsed.rows.findIndex(predicate);
  assert.ok(index >= 0, "row found");
  return { row: parsed.rows[index], key: keys[index], index };
};
const draftOf = (over = {}) => draftFromState({ text: LIST, fileName: "", wasParsed: false, lastComparedAt: null, resolutions: {}, selectionOverrides: {}, ...over });
const reload = (storage) => loadDraft(storage);
const catalog = () => [
  { id: "p-a07", slug: "samsung-a07", title: "Samsung A07", brand: "Samsung", category: "Mobile Phones", publicationStatus: "published", mediaCount: 3, specCount: 5,
    variants: [{ id: "v1", sku: "MB001", ram: "4 GB", storage: "64 GB", color: "Black", priceMinor: 3500000, compareAtPriceMinor: null, stock: 10, ptaStatus: "approved", condition: "brand_new", conditionGrade: null, batteryHealth: null, cycleCount: null, isActive: true }] },
];

test("raw stock list survives a simulated reload", () => {
  const storage = memoryStorage();
  assert.equal(saveDraft(storage, draftOf()), true);
  const loaded = reload(storage);
  assert.equal(loaded.status, "restored");
  assert.equal(loaded.draft.text, LIST);
  assert.equal(loaded.draft.sourceFingerprint, fingerprintText(LIST));
});

test("file-derived raw text (CSV/XLSX conversion) survives reload together with the file name", () => {
  const text = tableToStockText([["Brand", "Model", "RAM", "Storage", "Color", "Price"], ["Samsung", "A07", "4", "64", "black,green", "36900"]]);
  const storage = memoryStorage();
  saveDraft(storage, draftOf({ text, fileName: "stock-13-oct.xlsx", wasParsed: true }));
  const { draft } = reload(storage);
  assert.equal(draft.text, text);
  assert.equal(draft.fileName, "stock-13-oct.xlsx");
  assert.equal(draft.wasParsed, true);
  assert.equal(parse(draft.text).rows.length, 2);
});

test("checkbox selections survive reload and are keyed by content, not by position", () => {
  const parsed = parse();
  const keys = buildRowKeys(parsed.rows);
  const storage = memoryStorage();
  saveDraft(storage, draftOf({ selectionOverrides: { [keys[0]]: false, [keys[1]]: true } }));
  const { draft } = reload(storage);
  assert.deepEqual(draft.selectionOverrides, { [keys[0]]: false, [keys[1]]: true });
  // Re-parsing the same text yields the same keys, so the overrides still point at the same rows.
  assert.deepEqual(buildRowKeys(parse(draft.text).rows), keys);
  // Inserting a line above does not shift the keys (they do not use line numbers).
  const shifted = buildRowKeys(parse(`Samsung\nA99 4/64 black @ 10000\n\n${LIST}`).rows);
  assert.ok(keys.every((key) => shifted.includes(key)));
});

test("skip decisions survive reload and keep the row out of the delta", () => {
  const parsed = parse();
  const { key } = rowWhere(parsed, (row) => row.color === "Wood");
  const storage = memoryStorage();
  saveDraft(storage, draftOf({ resolutions: { [key]: record(key, { type: "skip_row" }) } }));
  const { draft } = reload(storage);
  assert.deepEqual(draft.resolutions[key].resolution, { type: "skip_row" });
  const resolved = applyResolutions(parse(draft.text), draft.resolutions);
  assert.equal(resolved.parsed.rows.some((row) => row.color === "Wood"), false);
  assert.ok(resolved.skipped.some((line) => /Skipped by Owner/.test(line.reason)));
  assert.equal(resolved.rowKeys.length, resolved.parsed.rows.length);
});

test("accepted unusual colour persists and clears only the colour warning", () => {
  const parsed = parse();
  const { row, key } = rowWhere(parsed, (r) => r.color === "Wood");
  assert.ok(row.reviewReasons.some((reason) => /not recognised/.test(reason)));
  assert.equal(resolutionOptions(row).colorIssue, true);
  const storage = memoryStorage();
  saveDraft(storage, draftOf({ resolutions: { [key]: record(key, { type: "accept_color_as_entered" }) } }));
  const { draft } = reload(storage);
  const resolved = applyResolutions(parse(draft.text), draft.resolutions);
  const after = resolved.parsed.rows.find((r) => r.model === "Edge 50 Ultra");
  assert.equal(after.color, "Wood");
  assert.deepEqual(after.reviewReasons, []);
  assert.equal(after.needsReview, false);
  assert.deepEqual(resolved.unmatched, []);
});

test("replace_color with an Owner-provided value persists", () => {
  const parsed = parse();
  const { key } = rowWhere(parsed, (r) => r.color === "I.blue");
  const storage = memoryStorage();
  saveDraft(storage, draftOf({ resolutions: { [key]: record(key, { type: "replace_color", color: "ice blue" }) } }));
  const { draft } = reload(storage);
  const resolved = applyResolutions(parse(draft.text), draft.resolutions);
  const after = resolved.parsed.rows.find((r) => r.model === "A57" && r.color !== "Black");
  assert.equal(after.color, "Ice Blue");
  assert.equal(after.reviewReasons.some((reason) => /Colour/.test(reason)), false);
});

test("physical RAM resolution persists (3+5 -> 3 GB, 4+4 -> 4 GB, 4+8 -> 4 GB)", () => {
  const parsed = parse();
  const picks = [["Note 60x", "3+5 GB", 3], ["Note 60x", "4+4 GB", 4], ["A36", "4+8 GB", 4]];
  const resolutions = {};
  for (const [model, ram, gb] of picks) {
    const { row, key } = rowWhere(parsed, (r) => r.model === model && r.ram === ram);
    assert.equal(resolutionOptions(row).physicalRam, gb);
    resolutions[key] = record(key, { type: "set_physical_ram", ramGb: gb });
  }
  const storage = memoryStorage();
  saveDraft(storage, draftOf({ resolutions }));
  const { draft } = reload(storage);
  const resolved = applyResolutions(parse(draft.text), draft.resolutions);
  assert.deepEqual(resolved.parsed.rows.filter((r) => ["Note 60x", "A36"].includes(r.model)).map((r) => r.ram), ["3 GB", "4 GB", "4 GB"]);
  assert.ok(resolved.parsed.rows.filter((r) => r.model !== "Edge 50 Ultra").every((r) => !r.reviewReasons.some((reason) => /extended/.test(reason))));
});

test("model-token resolution persists: Focus Pro + 5g -> model 'Focus Pro 5G', colours Black / Brown", () => {
  const parsed = parse();
  const { row, key } = rowWhere(parsed, (r) => r.color === "5g Black");
  assert.equal(resolutionOptions(row).token, "5g");
  const storage = memoryStorage();
  saveDraft(storage, draftOf({ resolutions: { [key]: record(key, { type: "move_token_to_model", token: "5g" }) } }));
  const { draft } = reload(storage);
  const resolved = applyResolutions(parse(draft.text), draft.resolutions);
  const focus = resolved.parsed.rows.filter((r) => r.lineNumber === row.lineNumber);
  assert.deepEqual(focus.map((r) => [r.model, r.productTitle, r.slug, r.color]), [
    ["Focus Pro 5G", "ZTE Focus Pro 5G", "zte-focus-pro-5g", "Black"],
    ["Focus Pro 5G", "ZTE Focus Pro 5G", "zte-focus-pro-5g", "Brown"],
  ]);
  assert.ok(focus.every((r) => r.reviewReasons.length === 0));
  assert.equal(resolved.rowKeys.length, resolved.parsed.rows.length);
});

test("skip-row resolution persists for any ambiguous row", () => {
  const parsed = parse();
  const { key } = rowWhere(parsed, (r) => r.ram === "4+8 GB");
  const storage = memoryStorage();
  saveDraft(storage, draftOf({ resolutions: { [key]: record(key, { type: "skip_row" }) } }));
  const resolved = applyResolutions(parse(), reload(storage).draft.resolutions);
  assert.equal(resolved.parsed.rows.some((r) => r.model === "A36"), false);
});

test("resolved rows leave Ambiguous and are re-classified by the delta engine", () => {
  const parsed = parse("Samsung\nA07 4/64 black/5g @ 37000");
  const before = buildStockDelta(parsed, catalog());
  assert.ok(before.entries.some((entry) => entry.kind === "ambiguous"));
  const { key } = rowWhere(parsed, (r) => r.color === "5g");
  const resolved = applyResolutions(parsed, { [key]: record(key, { type: "skip_row" }) });
  const after = buildStockDelta(resolved.parsed, catalog());
  assert.equal(after.counts.ambiguous, 0);
  assert.equal(after.counts.priceChanges, 1);
  assert.equal(after.counts.excluded, 1);
});

test("a decision that no longer matches the edited list is reported, never forced", () => {
  const parsed = parse();
  const { key } = rowWhere(parsed, (r) => r.color === "Wood");
  const edited = parse(LIST.replace("wood", "black"));
  const resolved = applyResolutions(edited, { [key]: record(key, { type: "accept_color_as_entered" }) });
  assert.deepEqual(resolved.unmatched, [key]);
  // A decision whose condition no longer holds is also reported (colour fixed in the source).
  const fixed = parse(LIST.replace("i.blue", "blue"));
  const k2 = rowWhere(parsed, (r) => r.color === "I.blue").key;
  assert.deepEqual(applyResolutions(fixed, { [k2]: record(k2, { type: "replace_color", color: "x" }) }).unmatched, [k2]);
});

test("invalid stored JSON safely resets and never throws", () => {
  const storage = memoryStorage({ [DRAFT_STORAGE_KEY]: "{not json" });
  const loaded = loadDraft(storage);
  assert.equal(loaded.status, "reset");
  assert.equal(storage.has(), false);
  assert.equal(loadDraft(storage).status, "none");
  for (const junk of ["null", "[]", "42", '"x"', "{}", '{"version":1}', '{"version":1,"text":5}']) {
    assert.equal(loadDraft(memoryStorage({ [DRAFT_STORAGE_KEY]: junk })).status, "reset", junk);
  }
});

test("a draft whose text no longer matches its fingerprint is treated as damaged", () => {
  const storage = memoryStorage();
  saveDraft(storage, draftOf());
  const tampered = JSON.parse(storage.raw());
  tampered.text = `${tampered.text}\nSamsung\nA1 4/64 black @ 1`;
  assert.equal(loadDraft(memoryStorage({ [DRAFT_STORAGE_KEY]: JSON.stringify(tampered) })).status, "reset");
});

test("an incompatible draft version safely resets", () => {
  const storage = memoryStorage();
  saveDraft(storage, draftOf());
  for (const version of [0, 2, "1", null]) {
    const stored = { ...JSON.parse(storage.raw()), version };
    const target = memoryStorage({ [DRAFT_STORAGE_KEY]: JSON.stringify(stored) });
    assert.equal(loadDraft(target).status, "reset", String(version));
    assert.equal(target.has(), false);
  }
});

test("malformed individual decisions are dropped, valid ones kept", () => {
  const storage = memoryStorage();
  saveDraft(storage, draftOf({ resolutions: { good: record("good", { type: "skip_row" }) } }));
  const stored = JSON.parse(storage.raw());
  stored.resolutions.bad1 = { rowKey: "bad1", resolution: { type: "delete_everything" } };
  stored.resolutions.bad2 = { rowKey: "bad2", resolution: { type: "set_physical_ram", ramGb: "3" } };
  stored.resolutions.bad3 = { rowKey: "other", resolution: { type: "skip_row" } };
  stored.selectionOverrides = { a: true, b: "yes" };
  const { draft } = loadDraft(memoryStorage({ [DRAFT_STORAGE_KEY]: JSON.stringify(stored) }));
  assert.deepEqual(Object.keys(draft.resolutions), ["good"]);
  assert.deepEqual(draft.selectionOverrides, { a: true });
});

test("missing or throwing storage never crashes", () => {
  const throwing = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("quota"); }, removeItem: () => { throw new Error("blocked"); } };
  assert.equal(loadDraft(null).status, "none");
  assert.equal(loadDraft(throwing).status, "none");
  assert.equal(saveDraft(throwing, draftOf()), false);
  assert.equal(saveDraft(null, draftOf()), false);
  assert.equal(clearDraft(throwing), false);
});

test("Clear Draft removes the saved state; an empty working state stores nothing", () => {
  const storage = memoryStorage();
  saveDraft(storage, draftOf());
  assert.equal(storage.has(), true);
  assert.equal(clearDraft(storage), true);
  assert.equal(storage.has(), false);
  assert.equal(loadDraft(storage).status, "none");
  saveDraft(storage, draftOf());
  saveDraft(storage, draftOf({ text: "" }));
  assert.equal(storage.has(), false);
});

test("a future Apply may clear the draft only after a verified write + read-back", () => {
  const storage = memoryStorage();
  saveDraft(storage, draftOf());
  assert.equal(clearDraftAfterVerifiedApply(storage, { written: true, readBackVerified: false }), false);
  assert.equal(clearDraftAfterVerifiedApply(storage, { written: false, readBackVerified: true }), false);
  assert.equal(storage.has(), true);
  assert.equal(clearDraftAfterVerifiedApply(storage, { written: true, readBackVerified: true }), true);
  assert.equal(storage.has(), false);
});

test("a restored draft carries no comparison and cannot authorise Apply", () => {
  const parsed = parse();
  const { key } = rowWhere(parsed, (r) => r.color === "Wood");
  const resolutions = { [key]: record(key, { type: "accept_color_as_entered" }) };
  const live = makeComparisonStamp(LIST, resolutions);
  assert.equal(comparisonAuthorizesApply(live, LIST, resolutions), true);

  const storage = memoryStorage();
  saveDraft(storage, draftOf({ resolutions, lastComparedAt: live.comparedAt }));
  const stored = JSON.parse(storage.raw());
  for (const forbidden of ["comparison", "stamp", "delta", "plan", "catalog", "applyAuthorized", "resolutionFingerprint"]) {
    assert.equal(forbidden in stored, false, forbidden);
  }
  const { draft } = loadDraft(storage);
  // The restored page has no stamp at all -> nothing to authorise with.
  assert.equal(comparisonAuthorizesApply(null, draft.text, draft.resolutions), false);
  // An old stamp is rejected as soon as the text or any decision changes.
  assert.equal(comparisonAuthorizesApply(live, `${LIST}\n`, resolutions), false);
  assert.equal(comparisonAuthorizesApply(live, LIST, {}), false);
  assert.equal(comparisonAuthorizesApply(live, LIST, { [key]: record(key, { type: "skip_row" }) }), false);
});

test("a restored draft can be re-compared against the current catalog", () => {
  const storage = memoryStorage();
  saveDraft(storage, draftOf({ text: "Samsung\nA07 4/64 black @ 37500", wasParsed: true }));
  const { draft } = loadDraft(storage);
  const resolved = applyResolutions(parse(draft.text), draft.resolutions);
  const delta = buildStockDelta(resolved.parsed, catalog());
  assert.equal(delta.counts.priceChanges, 1);
  // The catalog moved on since the draft was saved: the same restored text gives a different (fresh) answer.
  const moved = catalog();
  moved[0].variants[0].priceMinor = 3750000;
  assert.equal(buildStockDelta(resolved.parsed, moved).counts.unchanged, 1);
  // Compare always yields a fresh stamp that matches the restored inputs.
  assert.equal(comparisonAuthorizesApply(makeComparisonStamp(draft.text, draft.resolutions), draft.text, draft.resolutions), true);
});

test("the real list pattern from the Owner round-trips with every resolution type at once", () => {
  const parsed = parse();
  const pick = (predicate, resolution) => { const { key } = rowWhere(parsed, predicate); return [key, record(key, resolution)]; };
  const resolutions = Object.fromEntries([
    pick((r) => r.color === "Wood", { type: "accept_color_as_entered" }),
    pick((r) => r.color === "I.blue", { type: "replace_color", color: "Ice Blue" }),
    pick((r) => r.ram === "3+5 GB", { type: "set_physical_ram", ramGb: 3 }),
    pick((r) => r.ram === "4+4 GB", { type: "set_physical_ram", ramGb: 4 }),
    pick((r) => r.ram === "4+8 GB", { type: "skip_row" }),
    pick((r) => r.color === "5g Black", { type: "move_token_to_model", token: "5g" }),
  ]);
  const storage = memoryStorage();
  saveDraft(storage, draftOf({ resolutions, wasParsed: true }));
  const { draft } = loadDraft(storage);
  assert.deepEqual(draft.resolutions, resolutions);
  const resolved = applyResolutions(parse(draft.text), draft.resolutions);
  assert.deepEqual(resolved.unmatched, []);
  assert.equal(resolved.parsed.rows.filter((r) => r.reviewReasons.length > 0).length, 0);
});

test("source: Apply stays disabled, no database write is reachable from the draft code", () => {
  for (const file of ["../src/lib/stockListDraft.ts", "../src/admin/StockListUpdate.tsx"]) {
    const source = readFileSync(new URL(file, import.meta.url), "utf8");
    assert.doesNotMatch(source, /\.(insert|update|upsert)\s*\(|\.rpc\s*\(/, file);
    if (!file.endsWith(".tsx")) assert.doesNotMatch(source, /\.delete\s*\(/, file); // the UI uses Set.delete in-memory
    assert.doesNotMatch(source, /service[_-]?role|password|access_token|apikey/i, file);
  }
  const ui = readFileSync(new URL("../src/admin/StockListUpdate.tsx", import.meta.url), "utf8");
  assert.match(ui, /<button type="button" className="admin-primary" disabled title=/);
  assert.match(ui, /STEP\.clear/);
  // An untouched tab must never overwrite/delete a saved draft (autosave and the pagehide/unmount flush are gated).
  assert.match(ui, /if \(touched\.current\) saveDraft\(/);
  assert.match(ui, /touched\.current = true;/);
  assert.match(ui, /WORDING\.listBack/);
});

// ---------------------------------------------------------------------------
// Source-line-level resolutions must keep every sibling colour of that line.
// ---------------------------------------------------------------------------

const FOCUS = "ZTE\nFocus Pro 8/256 5g black/brown @ 56500";
const tokenResolution = (parsed) => {
  const keys = buildRowKeys(parsed.rows);
  const resolutions = {};
  parsed.rows.forEach((row, index) => {
    const token = resolutionOptions(row).token;
    if (token) resolutions[keys[index]] = record(keys[index], { type: "move_token_to_model", token });
  });
  return resolutions;
};
const shape = (rows) => rows.map((r) => [r.productTitle, r.ram, r.storage, r.color, r.priceMinor]);
const fiveGCatalog = (...colors) => [{ id: "p-f", slug: "zte-focus-pro-5g", title: "ZTE Focus Pro 5G", brand: "ZTE", category: "Mobile Phones", publicationStatus: "published", mediaCount: 1, specCount: 1,
  variants: colors.map(([color, price], i) => ({ id: `f${i}`, sku: `MB10${i}`, ram: "8 GB", storage: "256 GB", color, priceMinor: price * 100, compareAtPriceMinor: null, stock: 10, ptaStatus: "approved", condition: "brand_new", conditionGrade: null, batteryHealth: null, cycleCount: null, isActive: true })) }];

test("Focus Pro 5g black/brown @ 56500: move token keeps BOTH colours, RAM, storage and price", () => {
  const parsed = parse(FOCUS);
  const resolved = applyResolutions(parsed, tokenResolution(parsed));
  assert.deepEqual(shape(resolved.parsed.rows), [
    ["ZTE Focus Pro 5G", "8 GB", "256 GB", "Black", 5650000],
    ["ZTE Focus Pro 5G", "8 GB", "256 GB", "Brown", 5650000],
  ]);
  assert.ok(resolved.parsed.rows.every((r) => r.model === "Focus Pro 5G" && r.reviewReasons.length === 0));
  assert.deepEqual(resolved.unmatched, []);
});

test("a 3-colour source line keeps all 3 child variants, once each", () => {
  const parsed = parse("ZTE\nFocus Pro 8/256 5g black/brown/blue @ 56500");
  const resolved = applyResolutions(parsed, tokenResolution(parsed));
  assert.deepEqual(resolved.parsed.rows.map((r) => r.color), ["Black", "Brown", "Blue"]);
  assert.equal(new Set(resolved.rowKeys).size, resolved.rowKeys.length);
  assert.ok(resolved.parsed.rows.every((r) => r.model === "Focus Pro 5G" && r.priceMinor === 5650000));
});

test("the token may sit first, in the middle, last, upper-case or separated differently: no sibling is ever dropped", () => {
  for (const colors of ["5g/black/brown", "black/5g/brown", "black/brown 5g", "5G Black/Brown", "5g black / brown", "5g black, brown", "5g black & brown"]) {
    const parsed = parse(`ZTE\nFocus Pro 8/256 ${colors} @ 56500`);
    const resolutions = tokenResolution(parsed);
    assert.ok(Object.keys(resolutions).length >= 1, colors);
    const rows = applyResolutions(parsed, resolutions).parsed.rows;
    assert.deepEqual(rows.map((r) => r.color).sort(), ["Black", "Brown"], colors);
    assert.ok(rows.every((r) => r.productTitle === "ZTE Focus Pro 5G" && r.priceMinor === 5650000), colors);
  }
});

test("only the resolved source line is transformed; other lines and their colours are untouched", () => {
  const parsed = parse("ZTE\nA36 4/64 blue/green @ 20000\nFocus Pro 8/256 5g black/brown @ 56500\nBlade 6/128 red/gold @ 30000");
  const rows = applyResolutions(parsed, tokenResolution(parsed)).parsed.rows;
  assert.deepEqual(rows.map((r) => [r.productTitle, r.color]), [
    ["ZTE A36", "Blue"], ["ZTE A36", "Green"], ["ZTE Focus Pro 5G", "Black"], ["ZTE Focus Pro 5G", "Brown"], ["ZTE Blade", "Red"], ["ZTE Blade", "Gold"],
  ]);
});

test("single-colour lines still work (token row is the whole line)", () => {
  const parsed = parse("ZTE\nFocus Pro 8/256 5g black @ 56500");
  const rows = applyResolutions(parsed, tokenResolution(parsed)).parsed.rows;
  assert.deepEqual(shape(rows), [["ZTE Focus Pro 5G", "8 GB", "256 GB", "Black", 5650000]]);
});

test("the two-colour move-token decision survives save/restore and still yields both variants", () => {
  const parsed = parse(FOCUS);
  const resolutions = tokenResolution(parsed);
  const storage = memoryStorage();
  saveDraft(storage, draftOf({ text: FOCUS, wasParsed: true, resolutions }));
  const { draft } = reload(storage);
  const rows = applyResolutions(parse(draft.text), draft.resolutions).parsed.rows;
  assert.deepEqual(shape(rows), [
    ["ZTE Focus Pro 5G", "8 GB", "256 GB", "Black", 5650000],
    ["ZTE Focus Pro 5G", "8 GB", "256 GB", "Brown", 5650000],
  ]);
});

test("after Compare both colours are classified (never dropped), wherever each lands", () => {
  const parsed = parse(FOCUS);
  const rows = applyResolutions(parsed, tokenResolution(parsed)).parsed;
  const landing = (catalog) => buildStockDelta(rows, catalog).entries.map((e) => `${e.row.color}:${e.kind}`);
  assert.deepEqual(landing([]), ["Black:new_product", "Brown:new_product"]);
  assert.deepEqual(landing(fiveGCatalog(["Black", 49000], ["Brown", 49000])), ["Black:price_change", "Brown:price_change"]);
  assert.deepEqual(landing(fiveGCatalog(["Black", 49000], ["Brown", 56500])), ["Black:price_change", "Brown:unchanged"]);
  assert.deepEqual(landing(fiveGCatalog(["Black", 49000])), ["Black:price_change", "Brown:new_variant"]);
  for (const catalog of [[], fiveGCatalog(["Black", 49000], ["Brown", 56500])]) {
    const delta = buildStockDelta(rows, catalog);
    assert.equal(delta.entries.length, 2);
    assert.equal(new Set(delta.entries.map((e) => e.id)).size, 2);
  }
});

test("the decisions panel lists every row that now comes from the resolved source line", () => {
  const ui = readFileSync(new URL("../src/admin/StockListUpdate.tsx", import.meta.url), "utf8");
  assert.match(ui, /function resolutionOutcome/);
  assert.match(ui, /row\(s\) from this line/);
});
