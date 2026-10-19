import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as wording from "../src/lib/stockUpdateWording.ts";
import { describeResolution } from "../src/lib/stockListDraft.ts";
import { PRESERVED_GUARANTEES, buildStockDelta, parseStockList } from "../src/lib/stockListDelta.ts";

// Words the Owner must never see on the Android Stock Update page.
const FORBIDDEN = [
  /\bdelta\b/i, /\bambiguous\b/i, /\bblocked\b/i, /apply plan/i, /apply selected/i, /\bfingerprint/i, /source resolution/i,
  /\bclassification\b/i, /catalog snapshot/i, /owner decisions/i, /comparison authori[sz]ation/i, /apply authori[sz]ation/i,
  /category exception/i, /\binvalid\b/i, /\bparse\b/i, /\bresolution type\b/i,
];
const check = (text, where) => {
  for (const pattern of FORBIDDEN) assert.doesNotMatch(text, pattern, `${where}: "${text}"`);
};
const strings = (value, path = "wording") => {
  if (typeof value === "string") return [[path, value]];
  if (typeof value === "function") return [];
  if (value && typeof value === "object") return Object.entries(value).flatMap(([key, child]) => strings(child, `${path}.${key}`));
  return [];
};

test("simple label mapping: every internal result kind has the Owner wording from the brief", () => {
  assert.deepEqual(wording.KIND_LABEL, {
    unchanged: "Same",
    price_change: "Price Changed",
    new_variant: "New Variants",
    new_product: "New Phones",
    ambiguous: "Needs Attention",
    blocked: "Not Android Phones",
  });
  assert.equal(wording.HIDE_LABEL, "Will Be Hidden");
  assert.equal(wording.PAGE_TITLE, "Android Stock Update");
  assert.equal(wording.PAGE_HELP, "Paste the latest Android stock list. We’ll check what changed before updating the website.");
  assert.deepEqual(wording.STEP, { paste: "Paste List", check: "Check List", review: "Review Changes", update: "Update Website", clear: "Clear List" });
});

test("attention explanations and actions are plain sentences", () => {
  assert.equal(wording.explainReason('Colour "Wood" not recognised — verify'), "We couldn't understand this color");
  assert.equal(wording.explainReason('Multi-word colour value "ice blue" — verify'), "We couldn't understand this color");
  assert.match(wording.explainReason("RAM uses extended/virtual notation — verify physical RAM"), /^Please confirm the RAM/);
  assert.equal(wording.explainReason("Price or model missing — cannot compare"), "Please check this line — the price or phone name is missing");
  assert.equal(wording.explainReason("something the engine has never said"), "Please check this line");
  assert.equal(wording.TOKEN_EXPLANATION("5g"), "5G looks like part of the phone name");
  assert.equal(wording.ACTION.keepColor, "Use this color");
  assert.equal(wording.ACTION.changeColor, "Change color");
  assert.equal(wording.ACTION.ramOption(3), "Use 3GB RAM");
  assert.equal(wording.ACTION.ramOption(4), "Use 4GB RAM");
  assert.equal(wording.ACTION.addToken("5g"), "Add 5G to phone name");
  assert.equal("skip" in wording.ACTION, false, "there is no Skip action");
});

test("no technical word appears in any Owner-facing string (wording module, fix descriptions, guarantees, engine notes)", () => {
  for (const [path, value] of strings(wording)) check(value, path);
  for (const [, value] of strings(wording)) if (typeof value === "string") check(value, "wording");
  check(wording.WORDING.listBackDetail("today"), "listBackDetail");
  check(wording.WORDING.autosaved("today"), "autosaved");
  check(wording.WORDING.wouldBe("Price Changed"), "wouldBe");
  check(wording.ACTION.ramOption(3), "ramOption");
  check(wording.ACTION.addToken("5g"), "addToken");
  for (const resolution of [{ type: "accept_color_as_entered" }, { type: "replace_color", color: "Blue" }, { type: "set_physical_ram", ramGb: 3 }, { type: "move_token_to_model", token: "5g" }]) {
    check(describeResolution(resolution), resolution.type);
  }
  for (const line of PRESERVED_GUARANTEES) check(line, "preserved");
  // Reasons the engine itself adds for the Owner (category lines, missing items, notes).
  const brands = ["Samsung", "Nokia", "Apple"].map((name) => ({ name }));
  const catalog = [{ id: "p", slug: "samsung-a07", title: "Samsung A07", brand: "Samsung", category: "Mobile Phones", publicationStatus: "published", mediaCount: 1, specCount: 1,
    variants: [{ id: "v1", sku: "MB001", ram: "4 GB", storage: "64 GB", color: "Black", priceMinor: 3690000, compareAtPriceMinor: null, stock: 1, ptaStatus: "approved", condition: "brand_new", conditionGrade: null, batteryHealth: null, cycleCount: null, isActive: false },
      { id: "v2", sku: "MB002", ram: "4 GB", storage: "64 GB", color: "Green", priceMinor: 3690000, compareAtPriceMinor: null, stock: 1, ptaStatus: "approved", condition: "brand_new", conditionGrade: null, batteryHealth: null, cycleCount: null, isActive: true }] }];
  const delta = buildStockDelta(parseStockList("Samsung\nA07 4/64 black @ 36900\nA07 4/64 blue\nNokia\n105 @ 7000\nApple\niPhone 15 6/128 black @ 250000\nGift box @ 1500", brands), catalog);
  for (const entry of delta.entries) {
    for (const note of entry.notes) check(note, `note ${entry.id}`);
    if (entry.kind === "blocked") for (const reason of entry.reasons) check(reason, `reason ${entry.id}`);
    for (const need of entry.requirements) check(need, `requirement ${entry.id}`);
    // Every attention reason has a plain explanation.
    if (entry.kind === "ambiguous") for (const reason of entry.reasons) check(wording.explainReason(reason), `explained ${entry.id}`);
  }
  for (const entry of delta.missing) check(entry.reason, `missing ${entry.id}`);
  for (const line of delta.excluded) check(line.reason, "excluded");
});

test("the page source shows no technical label where the Owner reads it (JSX text, titles, placeholders, labels)", () => {
  const raw = readFileSync(new URL("../src/admin/StockListUpdate.tsx", import.meta.url), "utf8");
  // Code comments are not Owner-facing; strip them so the scan sees only JSX and code.
  const ui = raw.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  // Literal text between tags: everything the Owner reads that is not an expression (code spans contain ";" or "=").
  const textNodes = [...ui.matchAll(/>([^<>{}]+)</g)].map((m) => m[1].trim()).filter((node) => node && !/[;=]/.test(node));
  assert.ok(textNodes.length > 20, "the scan found JSX text");
  for (const node of textNodes) check(node, "jsx text");
  for (const match of ui.matchAll(/(?:title|placeholder|aria-label)=(?:"([^"]*)"|\{"([^"]*)"\}|\{`([^`]*)`\})/g)) check(match[1] ?? match[2] ?? match[3] ?? "", "attribute");
  for (const match of ui.matchAll(/\{"([^"]+)"\}/g)) check(match[1], "jsx string");
  // Headline wording from the brief is present.
  for (const expected of ["Android Stock Update", "Paste List", "Check List", "Review Changes", "Update Website", "Clear List"]) {
    assert.ok(ui.includes(expected) || Object.values(wording.STEP).includes(expected) || expected === wording.PAGE_TITLE, expected);
  }
  // The old two-click flow and its technical buttons are gone.
  for (const gone of ["Parse Stock List", "Compare With Catalog", "Apply Selected Changes", "Owner decisions", "Delta summary", "Apply plan"]) assert.ok(!ui.includes(gone), gone);
});

test("price, multiple-price and duplicate-line reasons have their own plain sentence", () => {
  assert.equal(wording.explainReason("Price appears unusually high — verify."), "Please check the price — it looks unusual");
  assert.match(wording.explainReason("Multiple/ambiguous prices detected; review price-to-color mapping."), /more than one price/);
  assert.equal(wording.explainReason("Duplicate variant (same as line 54)"), "This variant appears more than once in the list");
});

test("Safe Partial Updates wording: fix buttons, results and save errors are plain sentences", () => {
  assert.equal(wording.ACTION.matchTo("Xiaomi Redmi Note 15 Pro"), "Yes, this is Xiaomi Redmi Note 15 Pro");
  assert.equal(wording.ACTION.newPhone, "This is a new phone");
  assert.deepEqual(Object.keys(wording.STATUS_LABEL).sort(), ["failed", "held", "needs_check", "unknown", "updated"]);
  for (const resolution of [{ type: "accept_correction", productId: "x", productTitle: "Xiaomi Redmi Note 15 Pro" }, { type: "confirm_new_phone" }]) check(describeResolution(resolution), resolution.type);
  assert.match(wording.explainSaveError("android_stock_phone_changed_since_check: x"), /changed on the website after your check/);
  assert.match(wording.explainSaveError("android_stock_phone_busy: x"), /Someone else/);
  assert.match(wording.explainSaveError('android_stock_phone_rejected: "A07": stock must be set to 30'), /did not accept.*stock must be set to 30/);
  assert.match(wording.explainSaveError("No answer from the website (Failed to fetch)"), /Click Check List/);
  assert.equal(wording.explainSaveError("boom"), "Not saved: boom");
  for (const message of ["android_stock_phone_changed_since_check", "android_stock_phone_busy", "android_stock_phone_admin_required", "android_stock_phone_not_android", "android_stock_phone_variant_exists", "No answer from the website"]) check(wording.explainSaveError(message), message);
  assert.equal(wording.explainReason("Looks like “Xiaomi Redmi Note 15 Pro” — correct the line, or confirm it is a new phone"), "Looks like “Xiaomi Redmi Note 15 Pro” — correct the line, or confirm it is a new phone");
  check(wording.WORDING.confirmBody(10, 4, 2, "PRODUCTION"), "confirmBody");
  check(wording.WORDING.planSummary(4, 2), "planSummary");
});
