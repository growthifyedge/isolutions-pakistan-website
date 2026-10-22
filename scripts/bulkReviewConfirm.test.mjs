import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  catalogCoverage,
  confirmAllReviewSuggestions,
  confirmMatch,
  eligibleReviewSetIds,
  emptyReview,
  missingImageProducts,
  parseShopifyReview,
  readShopifyExport,
  reviewSetStates,
  summarizeReview,
} from "../src/lib/bulkProductImagesReview.ts";
import { imageMatchKey } from "../src/lib/productImageMatching.ts";
import { PROD_TITLES } from "./support/prodCatalogTitles.mjs";

const product = (id, extra = {}) => ({ id, title: `Product ${id}`, slug: id, brand: "Brand", hasPrimary: false, mediaCount: 0, ...extra });
const catalog = ["p1", "p2", "p3", "p4", "p5", "p6", "p7", "p8", "p9"].map((id) => product(id));
const image = (setId, n, extra = {}) => ({ id: `${setId}#${n}`, label: `Position ${n}`, previewUrl: null, sourceUrl: `https://cdn.shopify.com/${setId}-${n}.jpg`, sourcePosition: n, invalidReason: null, ...extra });
const matchOf = (status, productId, candidates) => ({
  sourceId: "x",
  label: "x",
  status,
  detectedBrand: "Brand",
  detectedModel: "M",
  productId,
  candidateProductIds: candidates ?? (productId ? [productId] : []),
  productHasPrimary: false,
  defaultSelected: status === "matched",
  reason: "r",
});
function setOf(setId, status, productId, { images = [image(setId, 1), image(setId, 2), image(setId, 3)], candidates, decision = {} } = {}) {
  const set = { setId, sourceKind: "shopify", title: `Set ${setId}`, handle: setId, shopifyStatus: "active", match: matchOf(status, productId, candidates), images };
  const valid = images.filter((entry) => !entry.invalidReason);
  return {
    set,
    decision: {
      productId: status === "multiple" || status === "unmatched" || status === "invalid" ? null : productId,
      confirmed: status === "matched",
      included: status === "matched",
      dismissed: null,
      existingMode: "skip",
      selectedImageIds: valid.map((entry) => entry.id),
      primaryImageId: valid[0]?.id ?? null,
      ...decision,
    },
  };
}
const reviewOf = (...entries) => ({ sets: entries.map((entry) => entry.set), decisions: Object.fromEntries(entries.map((entry) => [entry.set.setId, entry.decision])), nextLocalId: 1 });
const statuses = (review) => Object.fromEntries([...reviewSetStates(review, catalog)].map(([id, state]) => [id, state.status]));

const mixed = () =>
  reviewOf(
    setOf("r1", "review", "p1"),
    setOf("r2", "review", "p2", { decision: { included: true } }),
    setOf("r3", "review", "p3", { images: [image("r3", 1), image("r3", 2)] }),
    setOf("m5", "matched", "p5"),
    setOf("mul", "multiple", null, { candidates: ["p6", "p7"] }),
    setOf("c1", "matched", "p8"),
    setOf("c2", "matched", "p8", { decision: { included: false } }),
    setOf("inv", "invalid", null, { images: [image("inv", 1, { invalidReason: "bad" })], decision: { selectedImageIds: [], primaryImageId: null } }),
    setOf("un", "unmatched", null),
    setOf("nu", "review", "p9", { decision: { dismissed: "not_used" } }),
    // a Review suggestion for a product another active set already targets -> Conflict, never bulk-confirmed
    setOf("rc", "review", "p4"),
    setOf("m4", "matched", "p4"),
  );

test("1-2. three safe Review suggestions (exactly one suggested product each) are all confirmed", () => {
  const review = reviewOf(setOf("r1", "review", "p1"), setOf("r2", "review", "p2"), setOf("r3", "review", "p3"));
  assert.deepEqual(eligibleReviewSetIds(review, catalog), ["r1", "r2", "r3"]);
  const result = confirmAllReviewSuggestions(review, catalog);
  assert.deepEqual([result.confirmed, result.skipped], [3, 0]);
  assert.deepEqual(statuses(result.review), { r1: "confirmed", r2: "confirmed", r3: "confirmed" });
  assert.ok(Object.values(result.review.decisions).every((decision) => decision.confirmed));
});

test("3-8. Multiple, Conflict, Invalid, Unmatched, Not used and duplicate-target Review sets are skipped", () => {
  const before = mixed();
  const beforeStatuses = statuses(before);
  assert.deepEqual(beforeStatuses, { r1: "review", r2: "review", r3: "review", m5: "matched", mul: "multiple", c1: "conflict", c2: "conflict", inv: "invalid", un: "unmatched", nu: "not_used", rc: "conflict", m4: "conflict" });
  assert.deepEqual(eligibleReviewSetIds(before, catalog), ["r1", "r2", "r3"]);
  const result = confirmAllReviewSuggestions(before, catalog);
  assert.deepEqual([result.confirmed, result.skipped], [3, 0]);
  const after = statuses(result.review);
  for (const id of ["mul", "c1", "c2", "inv", "un", "nu", "rc", "m4", "m5"]) assert.equal(after[id], beforeStatuses[id], `${id} unchanged`);
  for (const id of ["mul", "c1", "c2", "inv", "un", "nu", "rc", "m4", "m5"]) assert.equal(result.review.decisions[id], before.decisions[id], `${id} decision untouched (same object)`);
});

test("9-11. images, Primary and included state are preserved", () => {
  const before = mixed();
  const result = confirmAllReviewSuggestions(before, catalog);
  for (const id of ["r1", "r2", "r3"]) {
    const was = before.decisions[id];
    const now = result.review.decisions[id];
    assert.deepEqual(now.selectedImageIds, was.selectedImageIds, id);
    assert.equal(now.primaryImageId, was.primaryImageId, id);
    assert.equal(now.existingMode, was.existingMode, id);
    assert.equal(now.productId, was.productId, id);
  }
  assert.equal(result.review.decisions.r2.included, true, "an already included set stays included");
  assert.deepEqual(result.review.sets, before.sets, "no source set or image is added, removed or changed");
  // A set whose primary the Owner changed keeps that primary.
  const custom = { ...before, decisions: { ...before.decisions, r1: { ...before.decisions.r1, primaryImageId: "r1#3", selectedImageIds: ["r1#2", "r1#3"] } } };
  const customResult = confirmAllReviewSuggestions(custom, catalog);
  assert.equal(customResult.review.decisions.r1.primaryImageId, "r1#3");
  assert.deepEqual(customResult.review.decisions.r1.selectedImageIds, ["r1#2", "r1#3"]);
});

test("a Review set whose suggestion the Owner already changed or confirmed, or with two candidates, is not eligible", () => {
  const changed = reviewOf(setOf("r1", "review", "p1", { decision: { productId: "p2" } }));
  assert.deepEqual(eligibleReviewSetIds(changed, catalog), []);
  const twoCandidates = reviewOf(setOf("r1", "review", "p1", { candidates: ["p1", "p2"] }));
  assert.deepEqual(eligibleReviewSetIds(twoCandidates, catalog), []);
  const confirmed = confirmAllReviewSuggestions(reviewOf(setOf("r1", "review", "p1")), catalog).review;
  assert.deepEqual(eligibleReviewSetIds(confirmed, catalog), [], "already confirmed");
  const unknownProduct = reviewOf(setOf("r1", "review", "ghost"));
  assert.deepEqual(eligibleReviewSetIds(unknownProduct, catalog), []);
});

test("15-16. counts update correctly and the action has nothing to do (disabled) when no Review set is eligible", () => {
  const before = mixed();
  const summaryBefore = summarizeReview(before, reviewSetStates(before, catalog));
  const result = confirmAllReviewSuggestions(before, catalog);
  const summaryAfter = summarizeReview(result.review, reviewSetStates(result.review, catalog));
  assert.equal(summaryBefore.review, 3);
  assert.equal(summaryAfter.review, 0);
  assert.equal(summaryAfter.confirmed, summaryBefore.confirmed + 3);
  assert.equal(summaryAfter.conflict, summaryBefore.conflict);
  assert.equal(summaryAfter.multiple, summaryBefore.multiple);
  assert.deepEqual(eligibleReviewSetIds(result.review, catalog), [], "the button is disabled afterwards");
  assert.equal(confirmAllReviewSuggestions(result.review, catalog).confirmed, 0);
  assert.deepEqual(eligibleReviewSetIds(emptyReview(), catalog), []);
  // Skipped count = Review sets that stayed Review.
  const stuck = reviewOf(setOf("r1", "review", "p1"), setOf("r2", "review", "p1"));
  assert.deepEqual(statuses(stuck), { r1: "conflict", r2: "conflict" });
  const stuckResult = confirmAllReviewSuggestions(stuck, catalog);
  assert.deepEqual([stuckResult.confirmed, stuckResult.skipped], [0, 0]);
});

test("equals clicking Confirm Match on each eligible row", () => {
  const before = mixed();
  let manual = before;
  for (const id of ["r1", "r2", "r3"]) manual = confirmMatch(manual, id, catalog);
  assert.deepEqual(confirmAllReviewSuggestions(before, catalog).review, manual);
});

test("13-14. no database or Cloudinary access", async () => {
  const calls = [];
  const original = globalThis.fetch;
  globalThis.fetch = (...args) => (calls.push(args), Promise.reject(new Error("network blocked")));
  try {
    confirmAllReviewSuggestions(mixed(), catalog);
  } finally {
    globalThis.fetch = original;
  }
  assert.deepEqual(calls, []);
  const lib = await readFile("src/lib/bulkProductImagesReview.ts", "utf8");
  assert.doesNotMatch(lib, /supabase\.(from|rpc|functions)|\.insert\(|\.rpc\(|\bfetch\(|XMLHttpRequest|api\.cloudinary\.com/);
  // The Shopify Load & Match review (and its bulk buttons) was removed from the panel; the pure review helpers stay shared.
  const panel = await readFile("src/admin/BulkProductImages.tsx", "utf8");
  assert.doesNotMatch(panel, /Confirm all review suggestions|confirmAllReview|Remaining manual actions|Select all eligible|Deselect all/);
});

const REAL_ZIP = process.env.BULK_IMAGES_SHOPIFY_ZIP ?? "C:/Users/User/Downloads/products_export_1 (3).zip";
test(
  "17. real Shopify export vs the 82 PROD products: Review suggestions bulk-confirm; Conflict / Multiple / Missing stay manual",
  { skip: existsSync(REAL_ZIP) ? false : `Owner-confirmed export not found at ${REAL_ZIP}` },
  async () => {
    const prod = PROD_TITLES.map((title) => ({ id: imageMatchKey(title), title, slug: imageMatchKey(title), brand: title.split(" ")[0], hasPrimary: false, mediaCount: 0 }));
    const bytes = new Uint8Array(await readFile(REAL_ZIP));
    const exported = await readShopifyExport({ name: "products_export_1 (3).zip", size: bytes.byteLength, arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) });
    const review = parseShopifyReview(emptyReview(), exported.text, prod).review;
    const states = reviewSetStates(review, prod);
    const before = summarizeReview(review, states);
    const eligible = eligibleReviewSetIds(review, prod);
    // Whatever the current matcher produces: every Review set with exactly one suggestion is eligible, nothing else is.
    assert.equal(eligible.length, before.review);
    const result = confirmAllReviewSuggestions(review, prod);
    const afterStates = reviewSetStates(result.review, prod);
    const after = summarizeReview(result.review, afterStates);
    console.log(`PROD fixture: Review ${before.review} -> confirmed ${result.confirmed}, skipped ${result.skipped}; Review now ${after.review}, Conflict sets ${after.conflict} (${after.conflictProducts} products), Multiple ${after.multiple}`);
    assert.equal(result.confirmed + result.skipped, before.review);
    assert.equal(after.review, result.skipped);
    assert.equal(after.confirmed, before.confirmed + result.confirmed);
    assert.deepEqual([after.conflict, after.conflictProducts, after.multiple, after.invalid, after.unmatched], [before.conflict, before.conflictProducts, before.multiple, before.invalid, before.unmatched]);
    assert.deepEqual(
      missingImageProducts(result.review, afterStates, prod).map((entry) => entry.product.title),
      ["Oppo Reno 16f 5G", "Tecno Go 3"],
    );
    const coverage = catalogCoverage(result.review, afterStates, prod);
    assert.equal(coverage.none, 2);
    assert.equal(coverage.conflict, 4);
    assert.equal(coverage.multiple, 1);
  },
);
