import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  addLocalFiles,
  assignProduct,
  emptyReview,
  filterReviewSets,
  reviewSetStates,
  selectAllEligible,
} from "../src/lib/bulkProductImagesReview.ts";
import { planBulkUpload } from "../src/lib/bulkImageUpload.ts";
import { SUPABASE_ENVIRONMENTS } from "../src/lib/supabaseEnvironment.ts";

const DEV_URL = `https://${SUPABASE_ENVIRONMENTS.development.supabaseProjectRef}.supabase.co`;
const NOKIA = "nokia-hmd-106-2026";
const catalog = [
  { id: NOKIA, title: "Nokia HMD 106 2026", slug: "nokia-hmd-106-2026", brand: "Nokia", hasPrimary: false, mediaCount: 0 },
  { id: "a07", title: "Samsung Galaxy A07", slug: "samsung-galaxy-a07", brand: "Samsung", hasPrimary: false, mediaCount: 0 },
];
const jpeg = (name) => new File([new Uint8Array([0xff, 0xd8, 0xff, 0xe0])], name, { type: "image/jpeg" });

/** A review as it looks after loading a Shopify export: 150 unmatched Shopify sets already in the table. */
function shopifyHeavyReview() {
  const sets = [];
  const decisions = {};
  for (let n = 0; n < 150; n += 1) {
    const setId = `shopify:accessory-${n}`;
    const image = { id: `${setId}:1`, label: `Position 1 - ${n}.jpg`, previewUrl: null, sourceUrl: `https://cdn.shopify.com/${n}.jpg`, sourcePosition: 1, invalidReason: null };
    sets.push({
      setId,
      sourceKind: "shopify",
      title: `Accessory ${String(n).padStart(3, "0")}`,
      handle: `accessory-${n}`,
      shopifyStatus: "active",
      match: { sourceId: setId, label: setId, status: "unmatched", detectedBrand: null, detectedModel: "", productId: null, candidateProductIds: [], productHasPrimary: false, defaultSelected: false, reason: "No product." },
      images: [image],
    });
    decisions[setId] = { productId: null, confirmed: false, included: false, dismissed: null, existingMode: "skip", selectedImageIds: [image.id], primaryImageId: image.id };
  }
  return { sets, decisions, nextLocalId: 1 };
}

const files = () => [jpeg("IMG_4471.jpg"), jpeg("IMG_4472.jpg")];
const addTwo = (review = emptyReview(), list = files()) => ({ list, review: addLocalFiles(review, list, catalog, { previewUrls: list.map((_, i) => `blob:preview-${i}`) }) });
const localSets = (review) => review.sets.filter((set) => set.sourceKind === "local");

test("two arbitrary local files that match nothing are retained as ONE visible Local source set, Unmatched, with both File objects", () => {
  const { list, review } = addTwo();
  const sets = localSets(review);
  assert.equal(sets.length, 1);
  assert.equal(sets[0].images.length, 2);
  assert.deepEqual(sets[0].images.map((image) => image.file), list, "the File objects are kept");
  const state = reviewSetStates(review, catalog).get(sets[0].setId);
  assert.equal(state.status, "unmatched");
  assert.equal(state.targetId, null);
  assert.equal(review.decisions[sets[0].setId].included, false);
  assert.deepEqual(review.decisions[sets[0].setId].selectedImageIds.length, 2);
});

test("the local set is visible in All, Relevant and Unmatched even behind many unmatched Shopify sets, and searchable by any filename", () => {
  const { review } = addTwo(shopifyHeavyReview());
  const states = reviewSetStates(review, catalog);
  const localId = localSets(review)[0].setId;
  for (const filter of ["all", "relevant", "unmatched"]) {
    const visible = filterReviewSets(review, states, catalog, filter, "");
    assert.equal(visible[0].setId, localId, `${filter}: local sets are listed first, inside the first table page`);
    assert.equal(visible[0].sourceKind, "local");
  }
  assert.deepEqual(filterReviewSets(review, states, catalog, "all", "IMG_4472").map((set) => set.setId), [localId], "second filename is searchable");
  assert.deepEqual(filterReviewSets(review, states, catalog, "unmatched", "img_4471").map((set) => set.setId), [localId]);
});

test("Choose Product is available (status unmatched) and assigning to Nokia HMD 106 2026 keeps both images in one set", () => {
  const before = addTwo(shopifyHeavyReview());
  const setId = localSets(before.review)[0].setId;
  assert.equal(reviewSetStates(before.review, catalog).get(setId).status, "unmatched");
  const assigned = assignProduct(before.review, setId, NOKIA, catalog);
  const sets = localSets(assigned);
  assert.equal(sets.length, 1);
  assert.equal(sets[0].images.length, 2);
  assert.deepEqual(sets[0].images.map((image) => image.file), before.list);
  const state = reviewSetStates(assigned, catalog).get(sets[0].setId);
  assert.equal(state.targetId, NOKIA);
  assert.equal(state.status, "confirmed");
  assert.equal(assigned.decisions[sets[0].setId].selectedImageIds.length, 2);
  assert.ok(assigned.decisions[sets[0].setId].primaryImageId);
  // Once assigned it is eligible and the DEV uploader plan carries both File objects (planning only).
  const ready = selectAllEligible(assigned, catalog);
  const withoutShopify = { ...ready, decisions: ready.decisions };
  const plan = planBulkUpload({ ...withoutShopify, sets: localSets(withoutShopify), decisions: { [sets[0].setId]: ready.decisions[sets[0].setId] } }, catalog, DEV_URL, "development");
  assert.equal(plan.enabled, true);
  assert.equal(plan.products[0].productId, NOKIA);
  assert.deepEqual(plan.products[0].images.map((image) => image.source), before.list);
});

test("files added in separate steps and files that auto-match still behave as before", () => {
  const first = addTwo();
  const second = addLocalFiles(first.review, [jpeg("Samsung Galaxy A07.jpg")], catalog, { previewUrls: ["blob:x"] });
  assert.equal(localSets(second).length, 2);
  assert.equal(second.sets.flatMap((set) => set.images).length, 3, "every added file is represented");
  const mixed = addLocalFiles(emptyReview(), [jpeg("Samsung Galaxy A07.jpg"), jpeg("IMG_1.jpg"), jpeg("IMG_2.jpg")], catalog, { previewUrls: [null, null, null] });
  assert.equal(mixed.sets.flatMap((set) => set.images).length, 3);
  assert.equal(localSets(mixed).length, 3, "a batch with an auto-match keeps unmatched files as separate single-file sets");
});

test("every added file is always represented in the review (file count equals image count)", () => {
  for (const names of [["a.jpg", "b.jpg"], ["same.jpg", "same.jpg"], ["x.jpg"], ["a.jpg", "b.jpg", "c.jpg", "d.jpg", "e.jpg", "f.jpg", "g.jpg", "h.jpg", "i.jpg", "j.jpg", "k.jpg"]]) {
    const review = addLocalFiles(emptyReview(), names.map(jpeg), catalog, { previewUrls: names.map(() => null) });
    assert.equal(review.sets.flatMap((set) => set.images).length, names.length, names.join());
    assert.equal(new Set(review.sets.map((set) => set.setId)).size, review.sets.length, "set ids are unique");
  }
});

test("adding and assigning local files never touches Supabase or Cloudinary", async () => {
  const calls = [];
  const original = globalThis.fetch;
  globalThis.fetch = (...args) => (calls.push(args), Promise.reject(new Error("network blocked")));
  try {
    const { review } = addTwo(shopifyHeavyReview());
    filterReviewSets(review, reviewSetStates(review, catalog), catalog, "all", "IMG");
    assignProduct(review, localSets(review)[0].setId, NOKIA, catalog);
  } finally {
    globalThis.fetch = original;
  }
  assert.deepEqual(calls, []);
  const lib = await readFile("src/lib/bulkProductImagesReview.ts", "utf8");
  assert.doesNotMatch(lib, /supabase\.(from|rpc|functions)|\.insert\(|\.rpc\(|\bfetch\(|XMLHttpRequest|api\.cloudinary\.com/);
});
