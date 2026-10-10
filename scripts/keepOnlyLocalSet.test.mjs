import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  addLocalFiles,
  assignProduct,
  chooseSourceSet,
  confirmMatch,
  emptyReview,
  keepOnlyBlockReason,
  keepOnlySet,
  parseShopifyReview,
  referenceCatalogEnvironment,
  reviewSetStates,
  setExistingMode,
  validateBulkImageSelection,
} from "../src/lib/bulkProductImagesReview.ts";
import { planBulkUpload } from "../src/lib/bulkImageUpload.ts";

const DEV_URL = "https://acwatgxkcyrdxpcljxjb.supabase.co";
const DEV = referenceCatalogEnvironment(DEV_URL);
const catalog = [
  { id: "nokia", title: "Nokia HMD 106 2026", slug: "nokia-hmd-106-2026", brand: "Nokia", hasPrimary: true, mediaCount: 2 },
  { id: "a07", title: "Samsung Galaxy A07", slug: "samsung-galaxy-a07", brand: "Samsung", hasPrimary: false, mediaCount: 0 },
  { id: "a17", title: "Samsung Galaxy A17", slug: "samsung-galaxy-a17", brand: "Samsung", hasPrimary: false, mediaCount: 0 },
];
const CSV = [
  "Handle,Title,Vendor,Status,Image Src,Image Position",
  "nokia-hmd-106-2026,Nokia HMD 106 2026,Nokia,active,https://cdn.shopify.com/a.jpg,1",
  "nokia-hmd-106-2026,,,,https://cdn.shopify.com/b.jpg,2",
  "samsung-galaxy-a07,Samsung Galaxy A07,Samsung,active,https://cdn.shopify.com/c.jpg,1",
  "samsung-galaxy-a17,Samsung Galaxy A17,Samsung,active,https://cdn.shopify.com/d.jpg,1",
].join("\n");
const jpeg = (name) => new File([new Uint8Array([0xff, 0xd8, 0xff, 0xe0])], name, { type: "image/jpeg" });

/** Real Owner flow: Shopify export loaded, two arbitrary local files added, assigned to Nokia, source set chosen. */
function nokiaFlow(mode) {
  const files = [jpeg("IMG_1.jpg"), jpeg("IMG_2.jpg")];
  let review = parseShopifyReview(emptyReview(), CSV, catalog).review;
  review = addLocalFiles(review, files, catalog, { previewUrls: [null, null] });
  const setId = review.sets.find((set) => set.sourceKind === "local").setId;
  review = assignProduct(review, setId, "nokia", catalog);
  review = chooseSourceSet(review, setId, catalog);
  if (mode) review = setExistingMode(review, setId, mode);
  return { review, setId, files };
}
const includedIds = (review) => review.sets.filter((set) => review.decisions[set.setId].included).map((set) => set.setId);
const statuses = (review) => Object.fromEntries([...reviewSetStates(review, catalog)].map(([id, state]) => [id, state.status]));

for (const mode of ["add", "add_make_primary"]) {
  test(`confirmed Local set + existing primary + ${mode}: Keep only this set includes it, excludes every other set and preserves everything`, () => {
    const { review, setId, files } = nokiaFlow(mode);
    // Other matched Shopify sets are still included before the click.
    assert.ok(includedIds(review).length > 1);
    const beforeDecision = review.decisions[setId];
    const next = keepOnlySet(review, setId);
    assert.notEqual(next, review);
    assert.deepEqual(includedIds(next), [setId]);
    assert.equal(statuses(next)[setId], "confirmed");
    assert.deepEqual(statuses(next), statuses(review), "no status changes");
    const decision = next.decisions[setId];
    assert.deepEqual(decision.selectedImageIds, beforeDecision.selectedImageIds);
    assert.equal(decision.selectedImageIds.length, 2);
    assert.equal(decision.primaryImageId, beforeDecision.primaryImageId);
    assert.equal(decision.existingMode, mode);
    assert.deepEqual(next.sets.find((set) => set.setId === setId).images.map((image) => image.file), files, "both File objects kept");

    const validation = validateBulkImageSelection(next, catalog, DEV);
    assert.deepEqual(
      { products: validation.selectedProducts, sets: validation.selectedSets, images: validation.selectedImages, ready: validation.ready, existing: validation.existingImages },
      { products: 1, sets: 1, images: 2, ready: 1, existing: 1 },
    );
    assert.deepEqual(validation.blockers, []);
    const plan = planBulkUpload(next, catalog, DEV_URL, "development");
    assert.equal(plan.enabled, true, plan.reason ?? "");
    assert.equal(plan.products[0].mode, mode);
    assert.equal(plan.products[0].images.length, 2);
    assert.equal(plan.products[0].images.filter((image) => image.finalPrimary).length, mode === "add" ? 0 : 1);
  });
}

test("Keep only works when the Existing-image mode is chosen before or after Use This Source Set", () => {
  const { review, setId } = nokiaFlow("add");
  // Re-confirming the same product (Confirm Match / Use This Source Set) must not reset the Owner's mode.
  const again = chooseSourceSet(confirmMatch(review, setId, catalog), setId, catalog);
  assert.equal(again.decisions[setId].existingMode, "add");
  assert.equal(again.decisions[setId].included, true);
  assert.equal(keepOnlySet(again, setId).decisions[setId].existingMode, "add");
  // A different product starts again from "skip".
  const other = assignProduct(again, setId, "a07", catalog);
  assert.equal(other.decisions[setId].existingMode, "skip");
  assert.equal(other.decisions[setId].included, true, "a product without a primary is included");
});

test("a no-op or refused Keep only is detectable (same review object) and explains why", () => {
  const { review, setId } = nokiaFlow("add");
  const once = keepOnlySet(review, setId);
  assert.equal(keepOnlySet(once, setId), once, "already the only included set");
  assert.equal(keepOnlyBlockReason(once, setId), null);
  assert.match(keepOnlyBlockReason(once, "missing"), /no longer exists/);
  const dismissed = { ...once, decisions: { ...once.decisions, [setId]: { ...once.decisions[setId], dismissed: "skipped" } } };
  assert.match(keepOnlyBlockReason(dismissed, setId), /Skipped/);
  assert.equal(keepOnlySet(dismissed, setId), dismissed);
  const noProduct = { ...once, decisions: { ...once.decisions, [setId]: { ...once.decisions[setId], productId: null } } };
  assert.match(keepOnlyBlockReason(noProduct, setId), /choose a product/);
});

test("a set still in Conflict is kept alone but stays Conflict and blocks upload with the real reason (it is not silently 'Confirmed')", () => {
  const files = [jpeg("IMG_1.jpg"), jpeg("IMG_2.jpg")];
  let review = parseShopifyReview(emptyReview(), CSV, catalog).review;
  review = addLocalFiles(review, files, catalog, { previewUrls: [null, null] });
  const setId = review.sets.find((set) => set.sourceKind === "local").setId;
  review = setExistingMode(assignProduct(review, setId, "nokia", catalog), setId, "add");
  assert.equal(statuses(review)[setId], "conflict");
  const next = keepOnlySet(review, setId);
  assert.deepEqual(includedIds(next), [setId]);
  assert.equal(statuses(next)[setId], "conflict");
  assert.match(planBulkUpload(next, catalog, DEV_URL, "development").reason, /Conflict is unresolved/);
});

test("Keep only never writes to Supabase or Cloudinary", async () => {
  const calls = [];
  const original = globalThis.fetch;
  globalThis.fetch = (...args) => (calls.push(args), Promise.reject(new Error("network blocked")));
  try {
    const { review, setId } = nokiaFlow("add_make_primary");
    keepOnlySet(review, setId);
  } finally {
    globalThis.fetch = original;
  }
  assert.deepEqual(calls, []);
  const lib = await readFile("src/lib/bulkProductImagesReview.ts", "utf8");
  assert.doesNotMatch(lib, /supabase\.(from|rpc|functions)|\.insert\(|\.rpc\(|\bfetch\(|XMLHttpRequest|api\.cloudinary\.com/);
  const panel = await readFile("src/admin/BulkProductImages.tsx", "utf8");
  assert.match(panel, /function keepOnly\(setId: string\)/);
  assert.match(panel, /Keep only this set: not applied/);
});
