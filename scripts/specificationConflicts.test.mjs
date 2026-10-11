import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { csvRows } from "../src/lib/bulkCatalog.ts";
import { chooseSourceSet, emptyReview, parseShopifyReview, reviewSetStates, confirmAllReviewSuggestions } from "../src/lib/bulkProductImagesReview.ts";
import { extractSpecifications, parseShopifyDescriptions } from "../src/lib/productSpecificationExtraction.ts";
import { reviewSummary, buildSpecReview } from "../src/lib/specificationReview.ts";
import { buildConflictGroups, recommend } from "../src/lib/specificationSourceConflicts.ts";
import { imageMatchKey } from "../src/lib/productImageMatching.ts";
import { PROD_TITLES } from "./support/prodCatalogTitles.mjs";

const SENTENCES = [
  "<p>Powered by MediaTek Dimensity 7300.</p>",
  "<p>5,000mAh battery.</p>",
  "<p>33W fast charging.</p>",
  "<p>Runs Android 15.</p>",
  "<p>50MP main camera.</p>",
  "<p>16MP front camera.</p>",
  "<p>120Hz refresh rate.</p>",
  "<p>Includes NFC.</p>",
  "<p>Bluetooth 5.3 support.</p>",
  "<p>IP68 protection.</p>",
  "<p>Dual SIM support.</p>",
  "<p>3.5mm headphone jack.</p>",
];
const body = (n) => SENTENCES.slice(0, n).join("");
const row = (handle, title, html, images = 2) =>
  Array.from({ length: images }, (_, i) => `${handle},${i === 0 ? title : ""},"${i === 0 ? html.replace(/"/g, '""') : ""}",Acme,active,https://cdn.shopify.com/${handle}-${i}.jpg,${i + 1}`).join("\n");
const HEADER = "Handle,Title,Body (HTML),Vendor,Status,Image Src,Image Position";
const catalogOf = (...titles) => titles.map((title) => ({ id: imageMatchKey(title), title, slug: imageMatchKey(title), brand: title.split(" ")[0], hasPrimary: true, mediaCount: 3 }));

function scenario(sourcesByProduct) {
  const lines = [HEADER];
  for (const [title, sources] of Object.entries(sourcesByProduct)) for (const source of sources) lines.push(row(source.handle, title, source.html, source.images ?? 2));
  const csv = lines.join("\n");
  const catalog = catalogOf(...Object.keys(sourcesByProduct));
  const review = parseShopifyReview(emptyReview(), csv, catalog).review;
  const descriptions = parseShopifyDescriptions(csvRows(csv));
  return { csv, catalog, review, descriptions };
}

const source = (extra = {}) => ({ setId: "s", handle: "h", shopifyTitle: "Acme Phone 5", shopifyStatus: "active", imageCount: 2, bodyChars: 500, preview: "", specCount: 8, high: 8, review: 0, conflicts: 0, key: { chipset: null, displaySize: null, battery: null, charging: null, os: null, camera: null }, exactTitle: true, modelTokens: true, ...extra });

test("1-2. source rows group per product: 3 rows -> one product, 2 rows -> one product", () => {
  const { review, catalog, descriptions } = scenario({
    "Acme Phone 5": [{ handle: "a-1", html: body(2) }, { handle: "a-2", html: body(3) }, { handle: "a-3", html: body(9) }],
    "Acme Phone 6": [{ handle: "b-1", html: body(4) }, { handle: "b-2", html: body(4) }],
  });
  const groups = buildConflictGroups(review, catalog, descriptions);
  assert.deepEqual(groups.map((g) => [g.productTitle, g.sources.length]), [["Acme Phone 5", 3], ["Acme Phone 6", 2]]);
  const card = groups[0].sources.find((s) => s.handle === "a-3");
  assert.equal(card.shopifyTitle, "Acme Phone 5");
  assert.equal(card.imageCount, 2);
  assert.ok(card.bodyChars > 100);
  assert.equal(card.specCount, card.high + card.review);
  assert.ok(card.preview.length > 0);
  assert.equal(card.key.chipset, "MediaTek Dimensity 7300");
  assert.equal(card.key.battery, "5000 mAh");
  assert.equal(card.key.charging, "33W");
  assert.equal(card.key.os, "Android 15");
  assert.equal(card.key.camera, "50 MP, 16 MP front");
  assert.equal(card.key.displaySize, null, "absent fields stay empty");
});

test("3. the recommendation prefers an exact title match, and says so", () => {
  const exact = source({ setId: "e", handle: "exact", exactTitle: true, specCount: 3 });
  const loose = source({ setId: "l", handle: "loose", exactTitle: false, modelTokens: true, specCount: 20 });
  const result = recommend([loose, exact]);
  assert.equal(result.recommendation.handle, "exact");
  assert.equal(result.safe, true);
  assert.match(result.recommendation.reason, /exact title match, 3 extractable specs, 0 internal conflicts/);
  const tokens = recommend([source({ setId: "t", handle: "tok", exactTitle: false, modelTokens: true }), source({ setId: "n", handle: "none", exactTitle: false, modelTokens: false, specCount: 30 })]);
  assert.equal(tokens.recommendation.handle, "tok");
  assert.match(tokens.recommendation.reason, /model-token match/);
});

test("4. titles tie: clearly more usable specs wins", () => {
  const result = recommend([source({ setId: "a", handle: "a", specCount: 18 }), source({ setId: "b", handle: "b", specCount: 5 })]);
  assert.equal(result.recommendation.handle, "a");
  assert.equal(result.safe, true);
  assert.match(result.recommendation.reason, /titles tie; 18 extractable specs, 0 internal conflicts vs 5 in b/);
});

test("5. internal conflicts are penalised: fewer conflicts ranks first and a conflicted source is never a safe pick", () => {
  const clean = source({ setId: "c", handle: "clean", specCount: 8, conflicts: 0 });
  const messy = source({ setId: "m", handle: "messy", specCount: 8, conflicts: 3 });
  assert.equal(recommend([messy, clean]).recommendation.handle, "clean");
  const moreButMessy = source({ setId: "mm", handle: "more", specCount: 20, conflicts: 2 });
  const fewerButClean = source({ setId: "fc", handle: "fewer", specCount: 8, conflicts: 0 });
  const result = recommend([moreButMessy, fewerButClean]);
  assert.equal(result.safe, false, "more specs but more internal conflicts is not clear-cut");
});

test("6-7. nothing is auto-selected, and ambiguous or contradicting sources get NO safe recommendation", () => {
  const close = recommend([source({ setId: "a", handle: "a", specCount: 10 }), source({ setId: "b", handle: "b", specCount: 6 })]);
  assert.equal(close.safe, false);
  assert.match(close.note, /No safe recommendation/);
  const equal = recommend([source({ setId: "a", handle: "a" }), source({ setId: "b", handle: "b" })]);
  assert.equal(equal.safe, false);
  const a = source({ setId: "a", handle: "a", specCount: 18, key: { chipset: "Snapdragon 7 Gen 4", displaySize: "6.8 inches", battery: "7000 mAh", charging: "80W", os: null, camera: null } });
  const b = source({ setId: "b", handle: "b", specCount: 5, key: { chipset: "MediaTek Dimensity 6080", displaySize: "6.6 inches", battery: "5000 mAh", charging: "33W", os: null, camera: null } });
  const contradict = recommend([a, b]);
  assert.equal(contradict.safe, false, "different chipset / battery: they may be different devices");
  assert.match(contradict.note, /contradict/);
  assert.match(contradict.recommendation.reason, /different .*chipset/);
  // Building groups never changes a decision.
  const { review, catalog, descriptions } = scenario({ "Acme Phone 5": [{ handle: "a-1", html: body(2) }, { handle: "a-2", html: body(9) }] });
  const before = [...reviewSetStates(review, catalog).values()].map((s) => s.status);
  buildConflictGroups(review, catalog, descriptions);
  assert.deepEqual([...reviewSetStates(review, catalog).values()].map((s) => s.status), before);
  assert.deepEqual(before, ["conflict", "conflict"]);
});

test("8-12. Use (recommended) source resolves only that product: chosen Confirmed, competitors Not Used, specs and counts refresh", () => {
  const { review, catalog, descriptions } = scenario({
    "Acme Phone 5": [{ handle: "a-weak", html: body(2) }, { handle: "a-strong", html: body(10) }],
    "Acme Phone 6": [{ handle: "b-1", html: body(4) }, { handle: "b-2", html: body(4) }],
  });
  const groups = buildConflictGroups(review, catalog, descriptions);
  const phone5 = groups.find((g) => g.productTitle === "Acme Phone 5");
  assert.equal(phone5.safe, true);
  assert.equal(groups.find((g) => g.productTitle === "Acme Phone 6").safe, false);
  const usable = (r) => [...reviewSetStates(r, catalog)].filter(([id, s]) => s.targetId && ["matched", "confirmed"].includes(s.status)).length;
  assert.equal(usable(review), 0);
  const after = chooseSourceSet(review, phone5.recommendation.setId, catalog);
  const states = reviewSetStates(after, catalog);
  assert.equal(states.get("shopify:a-strong").status, "confirmed");
  assert.equal(states.get("shopify:a-weak").status, "not_used");
  assert.equal(states.get("shopify:b-1").status, "conflict", "the other product is untouched");
  assert.equal(states.get("shopify:b-2").status, "conflict");
  assert.deepEqual(buildConflictGroups(after, catalog, descriptions).map((g) => g.productTitle), ["Acme Phone 6"]);
  // Spec extraction now uses the chosen source; the "need source review" count drops by one.
  const entries = [...states].filter(([, s]) => s.status === "confirmed").map(([id, s]) => {
    const handle = id.replace("shopify:", "");
    const d = descriptions.get(handle);
    const product = catalog.find((c) => c.id === s.targetId);
    return { productId: product.id, productTitle: product.title, productKey: product.slug, handle, extraction: extractSpecifications({ productTitle: product.title, shopifyTitle: d.title, bodyHtml: d.bodyHtml }) };
  });
  assert.equal(entries.length, 1);
  assert.equal(entries[0].extraction.specs.length, 10);
  const spec = buildSpecReview(entries);
  assert.equal(reviewSummary(spec, 2, 1).needingSourceReview, 1);
  assert.equal(reviewSummary(buildSpecReview([]), 2, 0).needingSourceReview, 2);
});

test("13-15. the comparator and its UI make no database, specification or media write", async () => {
  const lib = await readFile("src/lib/specificationSourceConflicts.ts", "utf8");
  const code = lib.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  assert.doesNotMatch(code, /supabase|\.from\(|\.insert\(|\.update\(|\.upsert\(|\.delete\(|\.rpc\(|\bfetch\(|XMLHttpRequest|cloudinary|product_media|product_specifications|writeFile/i);
  const ui = await readFile("src/admin/SpecificationMigration.tsx", "utf8");
  assert.doesNotMatch(ui, /\.insert\(|\.update\(|\.upsert\(|\.delete\(|\.rpc\(|functions\.invoke|cloudinary|product_media|product_variants/i);
  assert.equal((ui.match(/\.from\(/g) ?? []).length, 1, "still only the read-only product_specifications select");
  assert.match(ui, /Source conflicts — \{conflictGroups\.length\} product/);
  assert.match(ui, /competing sources/);
  assert.match(ui, />\s*Use this source\s*</);
  assert.match(ui, />\s*Use recommended source\s*</);
  assert.match(ui, /disabled=\{!group\.safe \|\| !group\.recommendation\}/, "the recommended-source button is disabled unless the recommendation is safe");
  assert.match(ui, /No safe recommendation\./);
  assert.match(ui, /chooseSourceSet\(current, setId, products\)/);
});

// ---------------- Real export ----------------

const REAL_ZIP = process.env.BULK_IMAGES_SHOPIFY_ZIP ?? "C:/Users/User/Downloads/products_export_1 (3).zip";
test("16. the real export's four conflict products render as four grouped decisions (nothing auto-selected)", { skip: existsSync(REAL_ZIP) ? false : `export not found at ${REAL_ZIP}` }, async () => {
  const JSZip = (await import("jszip")).default;
  const zip = await JSZip.loadAsync(await readFile(REAL_ZIP));
  const text = await zip.file("products_export_1.csv").async("string");
  const catalog = PROD_TITLES.map((title) => ({ id: imageMatchKey(title), title, slug: imageMatchKey(title), brand: title.split(" ")[0], hasPrimary: true, mediaCount: 3 }));
  const descriptions = parseShopifyDescriptions(csvRows(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text));
  const review = confirmAllReviewSuggestions(parseShopifyReview(emptyReview(), text, catalog).review, catalog).review;
  const groups = buildConflictGroups(review, catalog, descriptions);
  assert.deepEqual(groups.map((g) => [g.productTitle, g.sources.length]), [["Nothing Phone 3A Pro", 3], ["Realme 15 Pro 5G", 2], ["Samsung S23 Ultra", 2], ["Tecno Spark 50", 2]]);
  assert.equal(groups.reduce((total, g) => total + g.sources.length, 0), 9);
  for (const group of groups) {
    assert.ok(group.sources.every((s) => s.handle && s.shopifyTitle && s.imageCount > 0 && s.bodyChars > 0));
    assert.ok(group.recommendation, "a ranking exists");
  }
  const states = reviewSetStates(review, catalog);
  assert.ok(groups.flatMap((g) => g.sources).every((s) => states.get(s.setId).status === "conflict"), "still unresolved until the Owner chooses");
  // A contradicting pair (Realme 15 Pro 5G) must not be offered as a safe pick.
  assert.equal(groups.find((g) => g.productTitle === "Realme 15 Pro 5G").safe, false);
});
