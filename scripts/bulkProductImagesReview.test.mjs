import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import test from "node:test";
import JSZip from "jszip";
import {
  BULK_IMAGE_APPLY_DISABLED_REASON,
  BULK_IMAGE_APPLY_ENABLED,
  addLocalFiles,
  assignProduct,
  attachLocalImages,
  catalogCoverage,
  chooseSourceSet,
  clearLocalSet,
  confirmMatch,
  createPreviewUrlRegistry,
  emptyReview,
  filterReviewSets,
  localFileProblems,
  localImageContentProblems,
  missingImageProducts,
  parseShopifyReview,
  previewUrlsInReview,
  readShopifyExport,
  referenceCatalogEnvironment,
  removeLocalImage,
  restoreSet,
  reviewSetStates,
  searchCatalogProducts,
  setExistingMode,
  setImageSelected,
  setIncluded,
  setPrimaryImage,
  shopifyThumbnailUrl,
  skipSet,
  summarizeReview,
  validateBulkImageSelection,
} from "../src/lib/bulkProductImagesReview.ts";
import { imageMatchKey } from "../src/lib/productImageMatching.ts";
import { SUPABASE_ENVIRONMENTS } from "../src/lib/supabaseEnvironment.ts";
import { PROD_TITLES } from "./support/prodCatalogTitles.mjs";

const product = (title, extra = {}) => ({
  id: imageMatchKey(title),
  title,
  slug: imageMatchKey(title),
  brand: title.split(" ")[0],
  hasPrimary: false,
  mediaCount: 0,
  ...extra,
});
const CATALOG = PROD_TITLES.map((title) => product(title));
const idOf = (title) => imageMatchKey(title);
const DEV = referenceCatalogEnvironment(`https://${SUPABASE_ENVIRONMENTS.development.supabaseProjectRef}.supabase.co`);
const titleOf = (id, catalog = CATALOG) => catalog.find((entry) => entry.id === id)?.title ?? null;
const stateOf = (review, setId, catalog = CATALOG) => reviewSetStates(review, catalog).get(setId);
const decisionOf = (review, setId) => review.decisions[setId];
const setOf = (review, setId) => review.sets.find((set) => set.setId === setId);

const asUpload = (name, bytes) => ({ name, size: bytes.byteLength, arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) });
const cdn = (file) => `https://cdn.shopify.com/s/files/1/0001/0002/files/${file}?v=1712345678`;
const SHOPIFY_HEADER = "Handle,Title,Body (HTML),Vendor,Type,Option1 Name,Option1 Value,Variant SKU,Variant Price,Image Src,Image Position,Image Alt Text,Variant Image,Status";
const SHOPIFY_CSV = [
  String.fromCharCode(0xfeff) + SHOPIFY_HEADER,
  // One Handle, three images (out of order) + a duplicate row → one source set of 3 images.
  `samsung-a17,Samsung A17,,iSolutionPakistan,Mobile,Title,Default Title,A17,45999,${cdn("a17-back.jpg")},2,,,active`,
  `samsung-a17,,,,,,,,,${cdn("a17-front.jpg")},1,,,`,
  `samsung-a17,,,,,,,,,${cdn("a17-side.jpg")},3,,,`,
  `samsung-a17,,,,,,,,,${cdn("a17-front.jpg")},1,,,`,
  `samsung-galaxy-a07,Samsung Galaxy A07,,iSolutionPakistan,Mobile,Title,Default Title,A07,32999,${cdn("a07.jpg")},1,,,active`,
  // Two DIFFERENT Handles → the same product: a source-set conflict.
  `nothing-phone-3a-pro,Nothing Phone 3A pro,,iSolutionPakistan,Mobile,Title,Default Title,N1,1,${cdn("n3ap.jpg")},1,,,active`,
  `nothing-phone-3a-pro-1,Nothing Phone 3A pro,,iSolutionPakistan,Mobile,Title,Default Title,N2,1,${cdn("n3ap-1a.jpg")},1,,,draft`,
  `nothing-phone-3a-pro-1,,,,,,,,,${cdn("n3ap-1b.jpg")},2,,,`,
  `honor-x5c,Honor X5C+,,iSolutionPakistan,Mobile,Title,Default Title,H1,1,${cdn("x5cplus.jpg")},1,,,active`,
  `oppo-16f-5g,Oppo 16f 5g,,iSolutionPakistan,Mobile,Title,Default Title,O1,1,${cdn("o16f.jpg")},1,,,active`,
  `usb-c-cable,USB-C Cable 1m,,iSolutionPakistan,Accessory,Title,Default Title,C1,999,${cdn("cable.jpg")},1,,,active`,
  `old-charger,Fast Charger,,Anker,Accessory,Title,Default Title,CH1,2999,,,,,archived`,
].join("\r\n");
const zipOf = async (files) => {
  const zip = new JSZip();
  for (const [name, text] of Object.entries(files)) zip.file(name, text);
  return zip.generateAsync({ type: "uint8array" });
};
const loadShopify = async (catalog = CATALOG, start = emptyReview()) => {
  const exported = await readShopifyExport(asUpload("products_export_1.zip", await zipOf({ "products_export_1.csv": SHOPIFY_CSV, "readme.txt": "x" })));
  assert.ok(!("error" in exported), exported.error);
  const parsed = parseShopifyReview(start, exported.text, catalog);
  assert.deepEqual(parsed.errors, []);
  return parsed.review;
};

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1]);
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d]);
const jpegFile = (name) => new File([JPEG], name, { type: "image/jpeg" });
const withLocal = async (review, files, catalog = CATALOG) => {
  const contentProblems = await localImageContentProblems(files);
  return addLocalFiles(review, files, catalog, { contentProblems, previewUrls: files.map((_, index) => `blob:${index + 1}`) });
};
const attach = async (review, productId, files, catalog = CATALOG) => {
  const contentProblems = await localImageContentProblems(files);
  return attachLocalImages(review, productId, files, catalog, { contentProblems, previewUrls: files.map((file) => `blob:${file.name}`) });
};
const A17 = "shopify:samsung-a17";

test("Shopify ZIP loads into one source set per Handle; non-Products ZIPs and other files are rejected", async () => {
  const review = await loadShopify();
  assert.equal(review.sets.length, 8);
  const a17 = setOf(review, A17);
  assert.equal(a17.handle, "samsung-a17");
  assert.equal(a17.shopifyStatus, "active");
  assert.equal(setOf(review, "shopify:old-charger").images.length, 0);
  assert.equal(stateOf(review, "shopify:old-charger").status, "invalid");
  const csv = await readShopifyExport(asUpload("products_export_1.csv", new TextEncoder().encode(SHOPIFY_CSV)));
  assert.equal(parseShopifyReview(emptyReview(), csv.text, CATALOG).review.sets.length, 8);
  assert.match((await readShopifyExport(asUpload("x.zip", await zipOf({ "orders.csv": "Name,Total\n1,2" })))).error, /No Shopify Products CSV/);
  assert.match((await readShopifyExport(asUpload("x.zip", await zipOf({ "a.csv": SHOPIFY_CSV, "b.csv": SHOPIFY_CSV })))).error, /2 Shopify Products CSVs/);
  assert.match((await readShopifyExport(asUpload("x.xlsx", new Uint8Array([1])))).error, /\.csv or \.zip/);
  assert.match((await readShopifyExport(asUpload("broken.zip", new Uint8Array([1, 2, 3])))).error, /could not be read/);
  assert.equal(shopifyThumbnailUrl("https://example.com/a.jpg"), "https://example.com/a.jpg");
});

test("1. one Shopify Handle with 3 images = one set, all 3 retained, lowest Image Position is primary", async () => {
  const review = await loadShopify();
  const set = setOf(review, A17);
  assert.deepEqual(set.images.map((image) => image.sourceUrl), [cdn("a17-front.jpg"), cdn("a17-back.jpg"), cdn("a17-side.jpg")]);
  assert.deepEqual(set.images.map((image) => image.label), ["Position 1 · a17-front.jpg", "Position 2 · a17-back.jpg", "Position 3 · a17-side.jpg"]);
  assert.equal(set.images[0].previewUrl, `${cdn("a17-front.jpg")}&width=160`);
  const decision = decisionOf(review, A17);
  assert.deepEqual(decision.selectedImageIds, set.images.map((image) => image.id));
  assert.equal(decision.primaryImageId, set.images[0].id);
  assert.equal(decision.included, true);
  assert.equal(stateOf(review, A17).status, "matched", "3 images of one Handle are not a conflict");
  const validation = validateBulkImageSelection(review, CATALOG, DEV);
  const plan = validation.plans.find((entry) => entry.setId === A17);
  assert.deepEqual(plan.inserts.map(({ label, sortOrder, isPrimary, makePrimaryAfterInsert }) => [label, sortOrder, isPrimary, makePrimaryAfterInsert]), [
    ["Position 1 · a17-front.jpg", 0, true, false],
    ["Position 2 · a17-back.jpg", 1, false, false],
    ["Position 3 · a17-side.jpg", 2, false, false],
  ]);
});

test("2–3. changing Primary moves only the flag; a gallery image can be deselected; the primary cannot", async () => {
  let review = await loadShopify();
  const [front, back, side] = setOf(review, A17).images.map((image) => image.id);
  review = setPrimaryImage(review, A17, side);
  assert.equal(decisionOf(review, A17).primaryImageId, side);
  assert.deepEqual(decisionOf(review, A17).selectedImageIds, [front, back, side]);
  review = setImageSelected(review, A17, back, false);
  assert.deepEqual(decisionOf(review, A17).selectedImageIds, [front, side]);
  assert.equal(setImageSelected(review, A17, side, false), review, "primary stays selected");
  review = setImageSelected(review, A17, back, true);
  assert.deepEqual(decisionOf(review, A17).selectedImageIds, [front, back, side], "re-selected in source order");
  const plan = validateBulkImageSelection(review, CATALOG, DEV).plans.find((entry) => entry.setId === A17);
  assert.deepEqual(plan.inserts.map((insert) => [insert.label, insert.isPrimary]), [
    ["Position 3 · a17-side.jpg", true],
    ["Position 1 · a17-front.jpg", false],
    ["Position 2 · a17-back.jpg", false],
  ]);
});

test("4. two different Handles → Conflict; choosing one source set keeps all its images and marks the other Not Used", async () => {
  let review = await loadShopify();
  const first = "shopify:nothing-phone-3a-pro";
  const second = "shopify:nothing-phone-3a-pro-1";
  assert.equal(stateOf(review, first).status, "conflict");
  assert.equal(stateOf(review, second).status, "conflict");
  assert.equal(decisionOf(review, first).included || decisionOf(review, second).included, false);
  assert.match(stateOf(review, first).issue, /2 source sets target Nothing Phone 3A Pro/);
  review = chooseSourceSet(review, second, CATALOG);
  assert.equal(stateOf(review, second).status, "confirmed");
  assert.equal(decisionOf(review, second).included, true);
  assert.equal(decisionOf(review, second).selectedImageIds.length, 2, "both images of the chosen Handle stay");
  assert.equal(decisionOf(review, second).primaryImageId, setOf(review, second).images[0].id);
  assert.equal(stateOf(review, first).status, "not_used");
  assert.equal(decisionOf(review, first).included, false);
  assert.equal(stateOf(restoreSet(review, first), first).status, "conflict", "restoring brings the conflict back");
});

test("5–6. local images: several filenames for one product form ONE set (no conflict); manual assignment joins it", async () => {
  let review = await withLocal(emptyReview(), [
    jpegFile("Samsung A07.jpg"),
    jpegFile("Samsung A07 (1).jpg"),
    jpegFile("Samsung-A07 (2).jpg"),
    jpegFile("IMG_1234.jpg"),
    new File(["not an image"], "Samsung-A27.jpg", { type: "image/jpeg" }),
    new File(["GIF89a"], "Samsung-A57.gif", { type: "image/gif" }),
  ]);
  const a07 = review.sets.find((set) => set.sourceKind === "local" && decisionOf(review, set.setId).productId === idOf("Samsung A07"));
  assert.equal(a07.images.length, 3);
  assert.equal(stateOf(review, a07.setId).status, "matched");
  assert.equal(decisionOf(review, a07.setId).included, true);
  assert.equal(decisionOf(review, a07.setId).primaryImageId, a07.images[0].id);
  assert.equal(decisionOf(review, a07.setId).selectedImageIds.length, 3);
  const unknown = review.sets.find((set) => set.title === "IMG_1234.jpg");
  assert.equal(stateOf(review, unknown.setId).status, "unmatched");
  assert.equal(stateOf(review, review.sets.find((set) => set.title === "Samsung-A27.jpg").setId).status, "invalid");
  assert.match(review.sets.find((set) => set.title === "Samsung-A27.jpg").images[0].invalidReason, /do not match a supported image format/);
  assert.match(review.sets.find((set) => set.title === "Samsung-A57.gif").images[0].invalidReason, /JPEG, PNG, WebP, or AVIF/);
  // Owner assigns the unmatched file to Samsung A07: it joins the same set, still exactly one primary.
  review = assignProduct(review, unknown.setId, idOf("Samsung A07"), CATALOG);
  assert.equal(setOf(review, unknown.setId), undefined);
  const joined = setOf(review, a07.setId);
  assert.equal(joined.images.length, 4);
  assert.equal(decisionOf(review, a07.setId).selectedImageIds.length, 4);
  assert.equal(decisionOf(review, a07.setId).primaryImageId, a07.images[0].id);
  assert.equal(validateBulkImageSelection(review, CATALOG, DEV).conflicts, 0);
});

test("7. unmatched Shopify set: Choose Product (whole Handle) or Skip; no forced local upload", async () => {
  let review = await loadShopify();
  const oppo = "shopify:oppo-16f-5g";
  const cable = "shopify:usb-c-cable";
  assert.equal(stateOf(review, oppo).status, "unmatched", "Reno is missing: stays manual");
  assert.equal(decisionOf(review, oppo).included, false);
  review = skipSet(review, cable);
  assert.equal(stateOf(review, cable).status, "skipped");
  assert.equal(setIncluded(review, cable, true), review, "a skipped set without a product cannot be included");
  review = assignProduct(review, oppo, idOf("Oppo Reno 16f 5G"), CATALOG);
  assert.equal(stateOf(review, oppo).status, "confirmed");
  assert.equal(decisionOf(review, oppo).included, true);
  assert.equal(decisionOf(review, oppo).selectedImageIds.length, 1);
  // Assigning a Handle to a product that already has a set creates a conflict.
  review = assignProduct(review, cable, idOf("Samsung A17"), CATALOG);
  assert.equal(stateOf(review, cable).status, "conflict");
  assert.equal(stateOf(review, A17).status, "conflict");
  // Clearing returns it to Unmatched; unknown products and invalid sets are refused.
  assert.equal(stateOf(assignProduct(review, oppo, null, CATALOG), oppo).status, "unmatched");
  assert.equal(assignProduct(review, oppo, "no-such-product", CATALOG), review);
  assert.equal(assignProduct(review, "shopify:old-charger", idOf("Samsung A27"), CATALOG), review);
});

test("8–10. Missing Images: product without a usable Shopify source; several local files, one primary, gallery intact", async () => {
  let review = await loadShopify();
  let states = reviewSetStates(review, CATALOG);
  const missing = missingImageProducts(review, states, CATALOG).map((entry) => entry.product.title);
  assert.ok(missing.includes("Tecno Go 3"));
  assert.ok(missing.includes("Oppo Reno 16f 5G"));
  assert.ok(!missing.includes("Samsung A17"), "has a Shopify source");
  assert.ok(!missing.includes("Honor X5c+"), "candidate of an unresolved Multiple");
  const tecno = idOf("Tecno Go 3");
  const result = await attach(review, tecno, [
    jpegFile("front.jpg"),
    new File([PNG], "back.png", { type: "image/png" }),
    jpegFile("side.jpg"),
    new File(["nope"], "bad.jpg", { type: "image/jpeg" }),
  ]);
  assert.deepEqual(result.rejected.map((entry) => entry.name), ["bad.jpg"]);
  assert.deepEqual(localFileProblems([{ name: "x.gif", type: "image/gif", size: 1 }]), ["Use a JPEG, PNG, WebP, or AVIF image."]);
  review = result.review;
  states = reviewSetStates(review, CATALOG);
  const entry = missingImageProducts(review, states, CATALOG, "tecno go").find((item) => item.product.id === tecno);
  assert.ok(entry.localSetId, "still listed, now with its pending local set");
  const setId = entry.localSetId;
  assert.deepEqual(setOf(review, setId).images.map((image) => image.label), ["front.jpg", "back.png", "side.jpg"]);
  assert.equal(stateOf(review, setId).status, "confirmed");
  assert.equal(decisionOf(review, setId).included, true);
  const [front, back, side] = setOf(review, setId).images.map((image) => image.id);
  assert.equal(decisionOf(review, setId).primaryImageId, front);
  review = setPrimaryImage(review, setId, back);
  assert.equal(decisionOf(review, setId).primaryImageId, back);
  assert.deepEqual(decisionOf(review, setId).selectedImageIds, [front, back, side]);
  // More uploads join the same set; the primary does not change.
  review = (await attach(review, tecno, [jpegFile("box.jpg")])).review;
  assert.equal(setOf(review, setId).images.length, 4);
  assert.equal(decisionOf(review, setId).primaryImageId, back);
  // Remove one image; removing the primary promotes the next selected image; clear drops the set.
  review = removeLocalImage(review, setId, side);
  assert.equal(setOf(review, setId).images.length, 3);
  review = removeLocalImage(review, setId, back);
  assert.equal(decisionOf(review, setId).primaryImageId, front);
  assert.equal(removeLocalImage(review, A17, setOf(review, A17).images[0].id), review, "Shopify images are deselected, never removed");
  review = clearLocalSet(review, setId);
  assert.equal(setOf(review, setId), undefined);
  assert.equal(missingImageProducts(review, reviewSetStates(review, CATALOG), CATALOG).find((item) => item.product.id === tecno).localSetId, null);
});

test("11. existing primary: default Skip; Add Images and Add and make primary only by explicit choice; nothing deleted", async () => {
  const catalog = CATALOG.map((entry) => (entry.title === "Samsung A17" ? { ...entry, hasPrimary: true, mediaCount: 2 } : entry));
  let review = await loadShopify(catalog);
  assert.equal(decisionOf(review, A17).included, false);
  assert.equal(decisionOf(review, A17).existingMode, "skip");
  assert.match(stateOf(review, A17, catalog).issue, /already has a primary image/);
  assert.deepEqual(filterReviewSets(review, reviewSetStates(review, catalog), catalog, "existing").map((set) => set.setId), [A17]);
  // Ticking Include alone is not enough.
  let validation = validateBulkImageSelection(setIncluded(review, A17, true), catalog, DEV);
  assert.ok(validation.blockers.some((blocker) => /Add images" or "Add and make primary/.test(blocker)));
  // Add Images: all gallery, existing primary unchanged, sort orders after existing media.
  review = setExistingMode(review, A17, "add");
  assert.equal(decisionOf(review, A17).included, true);
  validation = validateBulkImageSelection(review, catalog, DEV);
  let plan = validation.plans.find((entry) => entry.setId === A17);
  assert.deepEqual(plan.inserts.map(({ sortOrder, isPrimary, makePrimaryAfterInsert }) => [sortOrder, isPrimary, makePrimaryAfterInsert]), [
    [2, false, false],
    [3, false, false],
    [4, false, false],
  ]);
  // Add and make primary: chosen image inserted as gallery, then made primary (old media kept).
  review = setExistingMode(review, A17, "add_make_primary");
  plan = validateBulkImageSelection(review, catalog, DEV).plans.find((entry) => entry.setId === A17);
  assert.deepEqual(plan.inserts.map(({ sortOrder, isPrimary, makePrimaryAfterInsert }) => [sortOrder, isPrimary, makePrimaryAfterInsert]), [
    [2, false, true],
    [3, false, false],
    [4, false, false],
  ]);
  assert.equal(decisionOf(setExistingMode(review, A17, "skip"), A17).included, false);
});

test("12. validation: many images for one product allowed; unresolved competing source sets and unconfirmed sets blocked", async () => {
  let review = await loadShopify();
  review = await withLocal(review, [jpegFile("Samsung A17.jpg")]);
  const local = review.sets.find((set) => set.sourceKind === "local").setId;
  assert.equal(stateOf(review, local).status, "conflict", "Shopify set and local set for one product compete");
  let validation = validateBulkImageSelection(review, CATALOG, DEV);
  assert.equal(validation.conflicts, 2);
  assert.ok(validation.blockers.some((blocker) => /another source set also targets Samsung A17/.test(blocker)));
  review = chooseSourceSet(review, A17, CATALOG);
  assert.equal(stateOf(review, local).status, "not_used");
  validation = validateBulkImageSelection(review, CATALOG, DEV);
  assert.deepEqual(validation.blockers, []);
  assert.equal(validation.selectedImages, 3, "three images for one product are fine");
  // An unconfirmed Review set that is ticked needs confirmation.
  const a07 = "shopify:samsung-galaxy-a07";
  validation = validateBulkImageSelection(setIncluded(review, a07, true), CATALOG, DEV);
  assert.equal(validation.needsReview, 1);
  assert.ok(validation.blockers.some((blocker) => /confirm the product match/.test(blocker)));
  review = confirmMatch(review, a07, CATALOG);
  assert.equal(stateOf(review, a07).status, "confirmed");
  assert.deepEqual(validateBulkImageSelection(review, CATALOG, DEV).blockers, []);
  // A Multiple set needs a product choice.
  const x5c = "shopify:honor-x5c";
  assert.deepEqual(setOf(review, x5c).match.candidateProductIds.map((id) => titleOf(id)).sort(), ["Honor X5c", "Honor X5c+"]);
  assert.equal(setIncluded(review, x5c, true), review);
  review = assignProduct(review, x5c, idOf("Honor X5c+"), CATALOG);
  assert.equal(stateOf(review, x5c).status, "confirmed");
  // Environment and empty selection.
  assert.match(validateBulkImageSelection(review, CATALOG, referenceCatalogEnvironment("")).blockers[0], /UNKNOWN — Apply is blocked/);
  const none = review.sets.reduce((current, set) => setIncluded(current, set.setId, false), review);
  assert.deepEqual(validateBulkImageSelection(none, CATALOG, DEV).blockers, ["Select at least one image set."]);
});

test("13. counts, catalog coverage and filters", async () => {
  const review = await loadShopify();
  const states = reviewSetStates(review, CATALOG);
  assert.deepEqual(summarizeReview(review, states), {
    loaded: 8, images: 10, matched: 1, confirmed: 0, review: 1, multiple: 1, conflict: 2, conflictProducts: 1,
    unmatched: 2, invalid: 1, notUsed: 0, skipped: 0, included: 1, includedImages: 3, existingImage: 0,
  });
  const coverage = catalogCoverage(review, states, CATALOG);
  assert.deepEqual(
    [coverage.total, coverage.withSource, coverage.selected, coverage.missing, coverage.existingPrimary, coverage.needsManualAction],
    // Sources: A17 (matched), A07 (review), Phone 3A Pro (conflict); Honor X5c and X5c+ are both candidates of the Multiple set.
    [82, 5, 1, 77, 0, 1 + 1 + 2 + 77],
  );
  const titles = (filter, query) => filterReviewSets(review, states, CATALOG, filter, query).map((set) => set.title);
  assert.equal(titles("all").length, 8);
  assert.deepEqual(titles("relevant"), ["Nothing Phone 3A pro", "Nothing Phone 3A pro", "Honor X5C+", "Samsung Galaxy A07", "Samsung A17"]);
  assert.deepEqual(titles("matched"), ["Samsung A17"]);
  assert.deepEqual(titles("unmatched").sort(), ["Oppo 16f 5g", "USB-C Cable 1m"]);
  assert.deepEqual(titles("invalid"), ["Fast Charger"]);
  assert.deepEqual(titles("all", "nothing-phone-3a-pro-1"), ["Nothing Phone 3A pro"], "handle is searchable");
  assert.deepEqual(searchCatalogProducts(CATALOG, "reno 16").map((entry) => entry.title), ["Oppo Reno 16 5G", "Oppo Reno 16f 5G"]);
  assert.deepEqual(searchCatalogProducts(CATALOG, "samsung-s26-plus").map((entry) => entry.title), ["Samsung S26 Plus"]);
});

test("object URLs: retainOnly revokes previews no longer shown; revokeAll on reset/unmount; panel wires both", async () => {
  const revoked = [];
  let next = 0;
  const registry = createPreviewUrlRegistry({ createObjectURL: () => `blob:${++next}`, revokeObjectURL: (url) => revoked.push(url) });
  const urls = [registry.create(new Blob([JPEG])), registry.create(new Blob([PNG])), registry.create(new Blob([JPEG]))];
  let review = await withLocal(emptyReview(), [jpegFile("Samsung A07.jpg"), jpegFile("Samsung A07 (1).jpg")]);
  assert.deepEqual([...previewUrlsInReview(review)], ["blob:1", "blob:2"]);
  registry.retainOnly(previewUrlsInReview(review));
  assert.deepEqual(revoked, [urls[2]]);
  const setId = review.sets[0].setId;
  review = removeLocalImage(review, setId, review.sets[0].images[1].id);
  registry.retainOnly(previewUrlsInReview(review));
  assert.deepEqual(revoked, ["blob:3", "blob:2"]);
  registry.revokeAll();
  assert.deepEqual(revoked, ["blob:3", "blob:2", "blob:1"]);
  assert.equal(registry.size, 0);
  const panel = await readFile(new URL("../src/admin/BulkProductImages.tsx", import.meta.url), "utf8");
  assert.match(panel, /return \(\) => \{\s*active = false;\s*registry\.revokeAll\(\);/);
  assert.match(panel, /previews\.current\.retainOnly\(previewUrlsInReview\(review\)\)/);
});

test("environment label comes from the shared environment map", async () => {
  assert.deepEqual(DEV, { label: SUPABASE_ENVIRONMENTS.development.label.toUpperCase(), known: true });
  assert.deepEqual(referenceCatalogEnvironment(`https://${SUPABASE_ENVIRONMENTS.production.supabaseProjectRef}.supabase.co`), { label: "PRODUCTION", known: true });
  assert.deepEqual(referenceCatalogEnvironment("https://abcdefghijklmnopqrst.supabase.co"), { label: "UNKNOWN", known: false });
  assert.deepEqual(referenceCatalogEnvironment(undefined), { label: "UNKNOWN", known: false });
  const panel = await readFile(new URL("../src/admin/BulkProductImages.tsx", import.meta.url), "utf8");
  assert.match(panel, /referenceCatalogEnvironment\(import\.meta\.env\.VITE_SUPABASE_URL\)/);
});

test("15. no DB / Cloudinary / network write during any review action (runtime + source scan)", async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = (...args) => {
    calls.push(args);
    throw new Error("network is not allowed during review");
  };
  try {
    let review = await loadShopify();
    review = confirmMatch(review, "shopify:samsung-galaxy-a07", CATALOG);
    review = chooseSourceSet(review, "shopify:nothing-phone-3a-pro", CATALOG);
    review = skipSet(review, "shopify:usb-c-cable");
    review = setPrimaryImage(review, A17, setOf(review, A17).images[2].id);
    review = setImageSelected(review, A17, setOf(review, A17).images[1].id, false);
    review = await withLocal(review, [jpegFile("Samsung A07.jpg")]);
    review = (await attach(review, idOf("Tecno Go 3"), [jpegFile("a.jpg"), jpegFile("b.jpg")])).review;
    validateBulkImageSelection(review, CATALOG, DEV);
  } finally {
    globalThis.fetch = originalFetch;
  }
  assert.deepEqual(calls, []);
  // The review library stays pure. The panel's only write is the DEV-guarded one-product upload test.
  const library = await readFile(new URL("../src/lib/bulkProductImagesReview.ts", import.meta.url), "utf8");
  for (const forbidden of [/\.(insert|update|upsert|delete)\(/, /\.rpc\(/, /functions\.invoke/, /fetch\(/, /XMLHttpRequest/, /productMediaUpload/, /uploadToCloudinary/, /requestProductUploadSignature/, /api\.cloudinary\.com/])
    assert.doesNotMatch(library, forbidden, `bulkProductImagesReview.ts must not contain ${forbidden}`);
  const panel = await readFile(new URL("../src/admin/BulkProductImages.tsx", import.meta.url), "utf8");
  for (const forbidden of [/\.(update|upsert|delete)\(/, /functions\.invoke/, /fetch\(/, /XMLHttpRequest/, /api\.cloudinary\.com/])
    assert.doesNotMatch(panel, forbidden, `BulkProductImages.tsx must not contain ${forbidden}`);
  assert.equal((panel.match(/\.insert\(/g) ?? []).length, 1, "the only write is the DEV-guarded product_media insert");
  assert.equal((panel.match(/\.rpc\(/g) ?? []).length, 1, "plus set_product_media_primary for Add and make primary");
  assert.equal((panel.match(/\.from\(/g) ?? []).length, 3, "reference catalog select, DEV test insert and DEV test read-back");
  assert.match(panel, /\.from\("products"\)\s*\.select\("id,title,slug,brand:brands\(name\),product_media\(is_primary\)"\)/);
});

test("16. Apply stays disabled even for a fully valid selection", async () => {
  assert.equal(BULK_IMAGE_APPLY_ENABLED, false);
  const validation = validateBulkImageSelection(await loadShopify(), CATALOG, DEV);
  assert.deepEqual(validation.blockers, []);
  assert.equal(validation.readyForApply, true);
  assert.equal(validation.applyEnabled, false);
  assert.equal(validation.applyDisabledReason, "Not enabled until upload testing is approved.");
  const panel = await readFile(new URL("../src/admin/BulkProductImages.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(panel, /Apply Selected Images|Upload to Production|Upload to PROD/, "no general Apply and no production upload option");
  assert.equal(BULK_IMAGE_APPLY_DISABLED_REASON, "Not enabled until upload testing is approved.");
});

const REAL_ZIP = process.env.BULK_IMAGES_SHOPIFY_ZIP ?? "C:/Users/User/Downloads/products_export_1 (3).zip";
test(
  "14. real Shopify export vs the 82 PROD products: 53/22/4/1 + Oppo Reno 16f 5G and Tecno Go 3 in Missing Images",
  { skip: existsSync(REAL_ZIP) ? false : `Owner-confirmed export not found at ${REAL_ZIP}` },
  async () => {
    const bytes = new Uint8Array(await readFile(REAL_ZIP));
    const exported = await readShopifyExport(asUpload("products_export_1 (3).zip", bytes));
    assert.equal(exported.csvName, "products_export_1.csv");
    const parsed = parseShopifyReview(emptyReview(), exported.text, CATALOG);
    assert.equal(parsed.rowCount, 1850);
    assert.equal(parsed.productCount, 585);
    const review = parsed.review;
    const states = reviewSetStates(review, CATALOG);
    const coverage = catalogCoverage(review, states, CATALOG);
    assert.deepEqual(
      { matched: coverage.matched, review: coverage.review, conflict: coverage.conflict, multiple: coverage.multiple, none: coverage.none },
      { matched: 53, review: 22, conflict: 4, multiple: 1, none: 2 },
    );
    assert.deepEqual(
      { withSource: coverage.withSource, selected: coverage.selected, missing: coverage.missing, existingPrimary: coverage.existingPrimary, needsManualAction: coverage.needsManualAction },
      { withSource: 80, selected: 53, missing: 2, existingPrimary: 0, needsManualAction: 29 },
    );
    assert.deepEqual(missingImageProducts(review, states, CATALOG).map((entry) => entry.product.title), ["Oppo Reno 16f 5G", "Tecno Go 3"]);
    const summary = summarizeReview(review, states);
    assert.deepEqual([summary.loaded, summary.matched, summary.review, summary.conflict, summary.conflictProducts, summary.multiple, summary.included], [585, 53, 22, 9, 4, 1, 53]);
    // Matched sets keep every image of their Handle: one primary + gallery.
    const included = review.sets.filter((set) => review.decisions[set.setId].included);
    assert.ok(included.some((set) => set.images.length > 1), "some Handles carry several images");
    for (const set of included) {
      const decision = review.decisions[set.setId];
      assert.equal(decision.selectedImageIds.length, set.images.filter((image) => !image.invalidReason).length, set.title);
      assert.equal(decision.primaryImageId, set.images[0].id, set.title);
    }
    assert.equal(filterReviewSets(review, states, CATALOG, "relevant").length, 53 + 22 + 9 + 1);
    const validation = validateBulkImageSelection(review, CATALOG, DEV);
    assert.deepEqual(validation.blockers, []);
    assert.equal(validation.plans.length, 53);
    assert.equal(validation.selectedImages, summary.includedImages);
    assert.ok(validation.plans.every((plan) => plan.inserts.filter((insert) => insert.isPrimary).length === 1));
    assert.equal(validation.applyEnabled, false);
    console.log(`real export: ${summary.images} images in ${summary.loaded} sets; ${summary.includedImages} images in the 53 matched sets`);
  },
);
