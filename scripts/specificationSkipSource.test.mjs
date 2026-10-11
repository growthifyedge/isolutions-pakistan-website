import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { csvRows } from "../src/lib/bulkCatalog.ts";
import { chooseSourceSet, confirmAllReviewSuggestions, emptyReview, parseShopifyReview, restoreSet, reviewSetStates, skipSet } from "../src/lib/bulkProductImagesReview.ts";
import { extractSpecifications, parseShopifyDescriptions } from "../src/lib/productSpecificationExtraction.ts";
import { approveAllHighConfidence, approvedSpecificationRows, buildSpecReview, reviewSummary } from "../src/lib/specificationReview.ts";
import { buildConflictGroups } from "../src/lib/specificationSourceConflicts.ts";
import { imageMatchKey } from "../src/lib/productImageMatching.ts";
import { PROD_TITLES } from "./support/prodCatalogTitles.mjs";

const catalog = [
  { id: "a07", title: "Samsung A07", slug: "samsung-a07", brand: "Samsung", hasPrimary: true, mediaCount: 3 },
  { id: "a17", title: "Samsung A17", slug: "samsung-a17", brand: "Samsung", hasPrimary: true, mediaCount: 3 },
  { id: "x5c", title: "Honor X5c", slug: "honor-x5c", brand: "Honor", hasPrimary: true, mediaCount: 3 },
  { id: "x5cp", title: "Honor X5c+", slug: "honor-x5c-plus", brand: "Honor", hasPrimary: true, mediaCount: 3 },
];
const image = { id: "i", label: "i", previewUrl: null, sourceUrl: "https://cdn.shopify.com/x.jpg", sourcePosition: 1, invalidReason: null };
const matchOf = (status, productId, candidates) => ({ sourceId: "s", label: "s", status, detectedBrand: "Honor", detectedModel: "X5C", productId, candidateProductIds: candidates, productHasPrimary: false, defaultSelected: false, reason: "r" });
const setOf = (handle, title, match) => ({ setId: `shopify:${handle}`, sourceKind: "shopify", title, handle, shopifyStatus: "active", match, images: [image] });
const decisionOf = (productId, confirmed) => ({ productId, confirmed, included: false, dismissed: null, existingMode: "skip", selectedImageIds: ["i"], primaryImageId: "i" });

const HTML = {
  "samsung-a07": "<p>Powered by MediaTek Dimensity 6300.</p><p>6,000mAh battery.</p><p>25W fast charging.</p><p>Expect a 6.5-inch or 6.6-inch display.</p><p>Battery 5,200mAh in the spec table.</p>",
  "samsung-a17": "<p>Powered by Exynos 1330.</p><p>5,000mAh battery.</p><p>Runs Android 15.</p>",
  "honor-x5c": "<p>Honor X5c 4/64 and Honor X5c+ 4/128 series.</p><p>Powered by MediaTek Helio G81 Ultra.</p><p>5,200mAh battery.</p><p>Runs Android 15.</p>",
};
const descriptions = parseShopifyDescriptions([["Handle", "Title", "Body (HTML)"], ...Object.entries(HTML).map(([handle, html]) => [handle, handle, html])]);

/** a07 + a17 matched; the combined Honor listing is a Multiple source (candidates X5c and X5c+). */
function scenario() {
  const sets = [setOf("samsung-a07", "Samsung A07", matchOf("matched", "a07", ["a07"])), setOf("samsung-a17", "Samsung A17", matchOf("matched", "a17", ["a17"])), setOf("honor-x5c", "Honor X5C", matchOf("multiple", null, ["x5c", "x5cp"]))];
  const decisions = { "shopify:samsung-a07": decisionOf("a07", true), "shopify:samsung-a17": decisionOf("a17", true), "shopify:honor-x5c": decisionOf(null, false) };
  return { sets, decisions, nextLocalId: 1 };
}
function specReviewFor(review) {
  const states = reviewSetStates(review, catalog);
  const entries = [];
  for (const set of review.sets) {
    const state = states.get(set.setId);
    const product = state.targetId && catalog.find((c) => c.id === state.targetId);
    if (!product || !["matched", "confirmed"].includes(state.status)) continue;
    const d = descriptions.get(set.handle);
    entries.push({ productId: product.id, productTitle: product.title, productKey: product.slug, handle: set.handle, extraction: extractSpecifications({ productTitle: product.title, shopifyTitle: d.title, bodyHtml: d.bodyHtml }) });
  }
  return { specReview: buildSpecReview(entries), usable: entries.length };
}

test("1. one unresolved Multiple source does not block bulk approval of the resolved products", () => {
  const review = scenario();
  assert.equal(reviewSetStates(review, catalog).get("shopify:honor-x5c").status, "multiple");
  const { specReview } = specReviewFor(review);
  assert.ok(specReview.proposals.some((p) => p.confidence === "High" && p.status === "proposed"), "there is something to approve");
  const approved = approveAllHighConfidence(specReview);
  const rows = approved.proposals.filter((p) => p.status === "approved");
  assert.ok(rows.length >= 5);
  assert.ok(rows.every((p) => p.confidence === "High" && ["a07", "a17"].includes(p.productId)));
  assert.deepEqual(rows.map((p) => p.productId).filter((id, i, all) => all.indexOf(id) === i).sort(), ["a07", "a17"]);
});

test("2-3. the unresolved source maps to neither Honor product and contributes zero extracted, approved or exported rows", () => {
  const review = scenario();
  const { specReview } = specReviewFor(review);
  assert.ok(!specReview.proposals.some((p) => p.handle === "honor-x5c"));
  assert.ok(!specReview.proposals.some((p) => ["x5c", "x5cp"].includes(p.productId)));
  const exported = approvedSpecificationRows(approveAllHighConfidence(specReview));
  assert.deepEqual(exported.errors, []);
  assert.ok(exported.rows.length > 0);
  assert.ok(exported.rows.every((row) => ["samsung-a07", "samsung-a17"].includes(row.productKey)));
  assert.ok(!exported.rows.some((row) => /honor/.test(row.productKey)));
  // Skipping ("Leave unresolved") keeps it mapped to nothing and keeps it out of extraction.
  const skipped = skipSet(review, "shopify:honor-x5c");
  const states = reviewSetStates(skipped, catalog);
  assert.equal(states.get("shopify:honor-x5c").status, "skipped");
  assert.equal(states.get("shopify:honor-x5c").targetId, null);
  assert.equal(skipped.decisions["shopify:honor-x5c"].productId, null, "not assigned to X5c or X5c+");
  assert.equal(skipped.decisions["shopify:honor-x5c"].dismissed, "skipped");
  const after = specReviewFor(skipped);
  assert.deepEqual(after.specReview.proposals.map((p) => p.id).sort(), specReview.proposals.map((p) => p.id).sort(), "skipping changes nothing for other products");
  // The Owner can still bring it back to the decision list.
  assert.equal(reviewSetStates(restoreSet(skipped, "shopify:honor-x5c"), catalog).get("shopify:honor-x5c").status, "multiple");
});

test("4. Review and Conflict proposals stay unapproved after the bulk action", () => {
  const { specReview } = specReviewFor(scenario());
  const approved = approveAllHighConfidence(specReview);
  const conflict = approved.proposals.filter((p) => p.status === "conflict");
  const review = approved.proposals.filter((p) => p.confidence === "Review" && p.status !== "conflict");
  assert.ok(conflict.length >= 1, "the A07 battery statements conflict");
  assert.ok(review.length >= 1, "the hedged display size is Review");
  assert.ok([...conflict, ...review].every((p) => p.status !== "approved"));
  assert.ok(approved.proposals.filter((p) => p.status === "approved").every((p) => p.alternatives.length === 0));
});

test("5. the summary separates approved, Review remaining, Conflict remaining, skipped sources and products without approved specs", () => {
  const review = skipSet(scenario(), "shopify:honor-x5c");
  const { specReview, usable } = specReviewFor(review);
  const before = reviewSummary(specReview, 4, usable, 1);
  assert.equal(before.approved, 0);
  assert.equal(before.productsWithNoApproved, 4);
  const after = reviewSummary(approveAllHighConfidence(specReview), 4, usable, 1);
  assert.ok(after.approved > 0);
  assert.equal(after.reviewRemaining, before.reviewRemaining);
  assert.equal(after.conflictRemaining, before.conflictRemaining);
  assert.ok(after.conflictRemaining >= 1 && after.reviewRemaining >= 1);
  assert.equal(after.skippedSources, 1);
  assert.equal(after.productsWithApproved, 2);
  assert.equal(after.productsWithNoApproved, 2, "the two Honor products have no approved spec");
  assert.equal(after.highAwaitingApproval, 0);
  assert.equal(before.highAwaitingApproval, after.approved);
});

test("6. no database, media or specification write; the UI wording and enablement are explicit", async () => {
  const lib = await readFile("src/lib/specificationReview.ts", "utf8");
  const code = lib.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  assert.doesNotMatch(code, /supabase|\.from\(|\.insert\(|\.update\(|\.upsert\(|\.delete\(|\.rpc\(|\bfetch\(|cloudinary|product_media/i);
  const ui = await readFile("src/admin/SpecificationMigration.tsx", "utf8");
  assert.doesNotMatch(ui, /\.insert\(|\.update\(|\.upsert\(|\.delete\(|\.rpc\(|functions\.invoke|cloudinary|product_media|product_variants/i);
  assert.equal((ui.match(/\.from\(/g) ?? []).length, 1);
  assert.match(ui, /Leave unresolved/);
  assert.match(ui, /unresolved — \{unresolvedSources === 1 \? "it" : "they"\} will be skipped\. Safe specifications for resolved products can still be approved\./);
  assert.match(ui, /disabled=\{specReview\.proposals\.length === 0\} onClick=\{approveHigh\}/, "bulk approval is never gated on other sources");
  assert.doesNotMatch(ui, /disabled=\{[^}]*unresolved[^}]*\}\s+onClick=\{approveHigh\}/);
  for (const label of ["Approved specs", "Review specs remaining", "Conflict specs remaining", "Skipped / unresolved sources", "Products with no approved specs"]) assert.match(ui, new RegExp(label));
  assert.match(ui, /Skipped sources \(\{skippedSources\.length\}\)/);
});

// ---------------- Real export ----------------

const REAL_ZIP = process.env.BULK_IMAGES_SHOPIFY_ZIP ?? "C:/Users/User/Downloads/products_export_1 (3).zip";
test("real export: with the combined Honor X5c listing left unresolved, every other safe product is bulk-approved", { skip: existsSync(REAL_ZIP) ? false : `export not found at ${REAL_ZIP}` }, async () => {
  const JSZip = (await import("jszip")).default;
  const zip = await JSZip.loadAsync(await readFile(REAL_ZIP));
  const text = await zip.file("products_export_1.csv").async("string");
  const real = PROD_TITLES.map((title) => ({ id: imageMatchKey(title), title, slug: imageMatchKey(title), brand: title.split(" ")[0], hasPrimary: true, mediaCount: 3 }));
  const all = parseShopifyDescriptions(csvRows(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text));
  let review = confirmAllReviewSuggestions(parseShopifyReview(emptyReview(), text, real).review, real).review;
  for (const group of buildConflictGroups(review, real, all)) review = chooseSourceSet(review, group.sources[0].setId, real);
  const before = reviewSetStates(review, real);
  assert.equal(before.get("shopify:honor-x5c").status, "multiple");
  review = skipSet(review, "shopify:honor-x5c");
  const states = reviewSetStates(review, real);
  const entries = [];
  for (const set of review.sets) {
    const st = states.get(set.setId);
    const product = st.targetId && real.find((c) => c.id === st.targetId);
    if (!product || !["matched", "confirmed"].includes(st.status)) continue;
    const d = all.get(set.handle);
    entries.push({ productId: product.id, productTitle: product.title, productKey: product.slug, handle: set.handle, extraction: extractSpecifications({ productTitle: product.title, shopifyTitle: d.title, bodyHtml: d.bodyHtml, metafields: d.metafields }) });
  }
  const approved = approveAllHighConfidence(buildSpecReview(entries));
  const summary = reviewSummary(approved, 82, entries.length, 1);
  console.log(`real export (Honor X5c skipped): safe sources ${entries.length}, approved ${summary.approved}, review remaining ${summary.reviewRemaining}, conflict remaining ${summary.conflictRemaining}, products with approved ${summary.productsWithApproved}, without ${summary.productsWithNoApproved}`);
  assert.equal(entries.length, 79);
  assert.ok(summary.approved > 800);
  assert.ok(!approved.proposals.some((p) => p.handle === "honor-x5c"));
  assert.ok(!approved.proposals.some((p) => ["Honor X5c", "Honor X5c+"].includes(p.productTitle) && p.status === "approved"));
  assert.ok(approved.proposals.filter((p) => p.status === "approved").every((p) => p.confidence === "High"));
  assert.equal(summary.highAwaitingApproval, 0);
});
