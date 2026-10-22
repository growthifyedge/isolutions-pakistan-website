import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  MEDIA_CHANGED_MESSAGE,
  createSubmitLatch,
  resolveUploadTarget,
  planBulkUpload,
  runBulkUpload,
} from "../src/lib/bulkImageUpload.ts";
import { deselectAll, keepOnlySet, reviewSetStates, selectAllEligible, validateBulkImageSelection, referenceCatalogEnvironment } from "../src/lib/bulkProductImagesReview.ts";
import { SUPABASE_ENVIRONMENTS } from "../src/lib/supabaseEnvironment.ts";

const DEV_URL = `https://${SUPABASE_ENVIRONMENTS.development.supabaseProjectRef}.supabase.co`;
const PROD_URL = `https://${SUPABASE_ENVIRONMENTS.production.supabaseProjectRef}.supabase.co`;
const UNKNOWN_URL = "https://abcdefghijklmnopqrst.supabase.co";
const PRODUCT_ID = "7d1c2b9e-4f1a-4c55-9d1e-0a6b3c2d1e0f";

const product = (extra = {}) => ({ id: PRODUCT_ID, title: "Apple iPhone 15", slug: "apple-iphone-15", brand: "Apple", hasPrimary: false, mediaCount: 0, ...extra });
const image = (n, extra = {}) => ({
  id: `img-${n}`,
  label: `Position ${n} - a${n}.jpg`,
  previewUrl: null,
  sourceUrl: `https://cdn.shopify.com/s/files/1/a${n}.jpg?v=1`,
  sourcePosition: n,
  invalidReason: null,
  ...extra,
});
const match = (status = "matched", productId = PRODUCT_ID) => ({ sourceId: "set", label: "x", status, detectedBrand: "Apple", detectedModel: "iPhone 15", productId, candidateProductIds: [], productHasPrimary: false, defaultSelected: true, reason: "ok" });
function shopifySet(setId, images, extra = {}, matchStatus = "matched") {
  return { setId, sourceKind: "shopify", title: "Apple iPhone 15", handle: "iphone-15", shopifyStatus: "active", match: match(matchStatus), images, ...extra };
}
const decision = (images, extra = {}) => ({
  productId: PRODUCT_ID,
  confirmed: true,
  included: true,
  dismissed: null,
  existingMode: "skip",
  selectedImageIds: images.map((entry) => entry.id),
  primaryImageId: images[0]?.id ?? null,
  ...extra,
});
function reviewOf(...entries) {
  return { sets: entries.map((entry) => entry.set), decisions: Object.fromEntries(entries.map((entry) => [entry.set.setId, entry.decision])), nextLocalId: 1 };
}
function single(images = [image(1), image(2), image(3)], { set = {}, dec = {}, matchStatus } = {}) {
  return reviewOf({ set: shopifySet("s1", images, set, matchStatus), decision: decision(images, dec) });
}
const modeOf = (url) => (url === PROD_URL ? "production" : "development");
const plan = (review, catalog = [product()], ...rest) => {
  const url = rest.length ? rest[0] : DEV_URL;
  return planBulkUpload(review, catalog, url, rest[1] ?? modeOf(url));
};

function manyProducts() {
  const catalog = [];
  const entries = [];
  const add = (n, { matchStatus = "matched", dec = {}, prod = {}, images } = {}) => {
    const id = `p${n}`;
    const imgs = images ?? [image(n * 10 + 1), image(n * 10 + 2)];
    catalog.push(product({ id, title: `Product ${n}`, ...prod }));
    const set = shopifySet(`s${n}`, imgs, { match: { ...match(matchStatus, id) } });
    entries.push({ set, decision: decision(imgs, { productId: id, ...dec }) });
  };
  add(1);
  add(2);
  add(3, { matchStatus: "review", dec: { confirmed: false, included: false } });
  add(4, { dec: { included: false }, prod: { hasPrimary: true, mediaCount: 1 } });
  add(5, { images: [image(51, { invalidReason: "Bad type." })], dec: { included: false, selectedImageIds: [], primaryImageId: null } });
  add(6, { dec: { included: false, dismissed: "not_used" } });
  add(7, { dec: { included: false } });
  return { catalog, review: reviewOf(...entries) };
}

// ---------- Guard ----------

test("17-18. unknown, lookalike, missing and mismatched environments block the whole upload; exact DEV is allowed", () => {
  assert.match(plan(single(), [product()], PROD_URL, "development").reason, /development-mode build is connected to the PRODUCTION/);
  for (const url of [UNKNOWN_URL, undefined, null, "", "http://acwatgxkcyrdxpcljxjb.supabase.co", "https://acwatgxkcyrdxpcljxjb.supabase.co.evil.test"]) {
    const result = plan(single(), [product()], url, "development");
    assert.equal(result.enabled, false, String(url));
    assert.match(result.reason, /UNKNOWN/);
    assert.deepEqual(result.products, []);
  }
  assert.equal(resolveUploadTarget(DEV_URL, "development").allowed, true);
  assert.equal(plan(single()).enabled, true);
});

test("17-18. the runner re-checks the environment and writes nothing for a mismatched or unknown target", async () => {
  const products = plan(single()).products;
  for (const [url, mode] of [[PROD_URL, "development"], [DEV_URL, "production"], [UNKNOWN_URL, "development"], [undefined, "development"], [DEV_URL, undefined]]) {
    const { deps, log } = fakeDeps({ supabaseUrl: url, buildMode: mode });
    const result = await runBulkUpload(products, deps);
    assert.equal(result.outcome, "blocked", `${url} ${mode}`);
    assert.deepEqual(log, []);
  }
});

// ---------- Eligibility ----------

test("1, 23. several products are supported; several images of one source set are not a conflict", () => {
  const { catalog, review } = manyProducts();
  const result = plan(selectAllEligible(review, catalog), catalog);
  assert.equal(result.enabled, true);
  assert.deepEqual(result.products.map((entry) => entry.productId), ["p1", "p2", "p7"]);
  assert.equal(result.totals.products, 3);
  assert.equal(result.totals.images, 6);
  assert.ok(result.products.every((entry) => entry.images.length === 2));
});

test("2-6. zero selection and unresolved Review / Multiple / Conflict / Invalid included sets block with one concise reason", () => {
  const { catalog, review } = manyProducts();
  assert.match(plan(deselectAll(review), catalog).reason, /Select at least one/);
  assert.match(plan(keepOnlySet(review, "s3"), catalog).reason, /Review is unresolved/);
  const multiple = single([image(1)], { dec: { productId: null, confirmed: false }, matchStatus: "multiple" });
  assert.match(plan(multiple).reason, /Multiple matches are unresolved/);
  const a = [image(1)];
  const b = [image(2)];
  const conflict = reviewOf({ set: shopifySet("s1", a), decision: decision(a) }, { set: shopifySet("s2", b, { handle: "o" }), decision: decision(b) });
  assert.match(plan(conflict).reason, /Conflict is unresolved/);
  assert.match(plan(single([image(1, { invalidReason: "Bad type." })])).reason, /invalid/i);
  const mixed = reviewOf(
    { set: shopifySet("s1", a), decision: decision(a) },
    { set: shopifySet("s9", [image(9)], { match: match("review", "p9") }), decision: decision([image(9)], { productId: "p9", confirmed: false }) },
  );
  const reason = plan(mixed, [product(), product({ id: "p9", title: "Nine" })]).reason;
  assert.match(reason, /Review is unresolved/);
  assert.doesNotMatch(reason, /\n/);
  assert.match(plan(single([image(1)], { dec: { primaryImageId: null } })).reason, /exactly one selected image as Primary/);
});

test("existing-primary behaviour follows the explicit Owner choice", () => {
  const catalog = [product({ hasPrimary: true, mediaCount: 2 })];
  assert.match(plan(single(), catalog).reason, /already has a primary image/);
  const add = plan(single([image(1), image(2)], { dec: { existingMode: "add" } }), catalog);
  assert.equal(add.products[0].mode, "add");
  assert.deepEqual(add.products[0].images.map((entry) => [entry.sortOrder, entry.insertAsPrimary, entry.finalPrimary]), [[2, false, false], [3, false, false]]);
  const make = plan(single([image(1), image(2)], { dec: { existingMode: "add_make_primary", primaryImageId: "img-2" } }), catalog);
  assert.equal(make.products[0].mode, "add_make_primary");
  assert.deepEqual(make.products[0].images.map((entry) => [entry.imageId, entry.sortOrder, entry.insertAsPrimary, entry.finalPrimary]), [["img-2", 2, false, true], ["img-1", 3, false, false]]);
  assert.deepEqual(make.products[0].expected, { count: 2, hasPrimary: true });
});

// ---------- Execution ----------

function fakeDeps(options = {}) {
  const log = [];
  const store = new Map(Object.entries(options.initial ?? {}).map(([id, rows]) => [id, rows.map((row) => ({ ...row }))]));
  const rowsOf = (productId) => store.get(productId) ?? store.set(productId, []).get(productId);
  let nextId = 1;
  let uploads = 0;
  const failUpload = options.failUpload ?? (() => false);
  const failInsert = options.failInsert ?? (() => false);
  const deps = {
    supabaseUrl: DEV_URL,
    buildMode: "development",
    ...options,
    requestSignature: async (productId) => {
      log.push(["signature", productId]);
      return { cloudName: "demo", apiKey: "k", signature: "s", signedParameters: { folder: options.folder ?? `isolutions-development/products/${productId}`, timestamp: 1, transformation: "t" } };
    },
    upload: async (signature, source, onProgress) => {
      const index = uploads++;
      const productId = signature.signedParameters.folder.split("/").at(-1);
      log.push(["upload", productId, typeof source === "string" ? source : "blob"]);
      onProgress?.(50);
      if (failUpload(productId, index)) throw new Error("Cloudinary rejected the upload.");
      return {
        public_id: `${signature.signedParameters.folder}/img${index}`,
        asset_id: `asset${index}`,
        version: 1700000000 + index,
        secure_url: `https://res.cloudinary.com/demo/image/upload/v1/${index}.jpg`,
        width: 800,
        height: 600,
        bytes: 12345,
        format: "jpg",
      };
    },
    insertMedia: async (payload) => {
      log.push(["insert", payload.product_id, payload.sort_order, payload.is_primary]);
      if (failInsert(payload.product_id, payload.sort_order)) throw new Error("row-level security violated");
      const row = { id: `media-${nextId++}`, product_id: payload.product_id, cloudinary_public_id: payload.cloudinary_public_id, secure_url: payload.secure_url, sort_order: payload.sort_order, is_primary: payload.is_primary };
      rowsOf(payload.product_id).push(row);
      options.afterInsert?.(row, rowsOf(payload.product_id));
      return { id: row.id };
    },
    setPrimary: async (mediaId) => {
      log.push(["setPrimary", mediaId]);
      if (options.failPrimary) throw new Error("rpc failed");
      for (const rows of store.values()) if (rows.some((row) => row.id === mediaId)) for (const row of rows) row.is_primary = row.id === mediaId;
    },
    readMedia: async (productId) => {
      log.push(["read", productId]);
      if (options.readFails && log.filter((entry) => entry[0] === "read" && entry[1] === productId).length > 1) throw new Error("network down");
      return rowsOf(productId).map((row) => ({ ...row }));
    },
  };
  return { deps, log, store };
}
const mediaRow = (id, productId, sort, primary) => ({ id, product_id: productId, cloudinary_public_id: `isolutions-development/products/${productId}/${id}`, secure_url: `https://res.cloudinary.com/demo/${id}.jpg`, sort_order: sort, is_primary: primary });
const kinds = (log) => log.map((entry) => entry[0]);
const bulk = () => {
  const { catalog, review } = manyProducts();
  return { catalog, planned: plan(selectAllEligible(review, catalog), catalog).products };
};

test("1, 7, 8, 14. several products upload all selected images, one primary each, and every product is read back", async () => {
  const { planned } = bulk();
  const { deps, store } = fakeDeps();
  const result = await runBulkUpload(planned, deps);
  assert.equal(result.outcome, "all_verified");
  assert.equal(result.summary.attempted, 3);
  assert.equal(result.summary.verified, 3);
  assert.equal(result.summary.imagesUploaded, 6);
  assert.deepEqual(result.summary.orphans, []);
  for (const id of ["p1", "p2", "p7"]) {
    const rows = store.get(id);
    assert.equal(rows.length, 2);
    assert.equal(rows.filter((row) => row.is_primary).length, 1);
    assert.deepEqual(rows.map((row) => row.sort_order), [0, 1]);
  }
  assert.ok(result.products.every((entry) => entry.checks.length >= 7 && entry.checks.every((check) => check.ok)));
});

test("Shopify HTTPS URLs and local Files are handed to the shared uploader unchanged", async () => {
  const file = new Blob([new Uint8Array([0xff, 0xd8, 0xff])], { type: "image/jpeg" });
  const local = [image(1, { sourceUrl: null, file })];
  const review = reviewOf({ set: shopifySet("s1", local, { sourceKind: "local" }), decision: decision(local) });
  const sources = [];
  const { deps } = fakeDeps();
  const upload = deps.upload;
  deps.upload = async (signature, source, onProgress) => (sources.push(source), upload(signature, source, onProgress));
  assert.equal((await runBulkUpload(plan(review).products, deps)).outcome, "all_verified");
  assert.equal(sources[0], file);
  const shopify = fakeDeps();
  await runBulkUpload(plan(single([image(4)])).products, shopify.deps);
  assert.equal(shopify.log.find((entry) => entry[0] === "upload")[2], "https://cdn.shopify.com/s/files/1/a4.jpg?v=1");
});

test("9. Add Images keeps the existing primary and every existing row", async () => {
  const initial = { [PRODUCT_ID]: [mediaRow("old1", PRODUCT_ID, 0, true), mediaRow("old2", PRODUCT_ID, 1, false)] };
  const planned = plan(single([image(1), image(2)], { dec: { existingMode: "add" } }), [product({ hasPrimary: true, mediaCount: 2 })]).products;
  const { deps, store, log } = fakeDeps({ initial });
  const result = await runBulkUpload(planned, deps);
  assert.equal(result.outcome, "all_verified");
  const rows = store.get(PRODUCT_ID);
  assert.deepEqual(rows.map((row) => [row.id, row.is_primary]).slice(0, 2), [["old1", true], ["old2", false]]);
  assert.equal(rows.length, 4);
  assert.equal(rows.filter((row) => row.is_primary).length, 1);
  assert.ok(!kinds(log).includes("setPrimary"));
});

test("10, 21. Add and make primary switches the primary through the existing RPC and deletes nothing", async () => {
  const initial = { [PRODUCT_ID]: [mediaRow("old1", PRODUCT_ID, 0, true)] };
  const planned = plan(single([image(1), image(2)], { dec: { existingMode: "add_make_primary", primaryImageId: "img-2" } }), [product({ hasPrimary: true, mediaCount: 1 })]).products;
  const { deps, store, log } = fakeDeps({ initial });
  const result = await runBulkUpload(planned, deps);
  assert.equal(result.outcome, "all_verified");
  const rows = store.get(PRODUCT_ID);
  assert.equal(rows.length, 3);
  assert.equal(rows.find((row) => row.is_primary).sort_order, 1);
  assert.equal(rows.find((row) => row.id === "old1").is_primary, false);
  assert.deepEqual(kinds(log).filter((kind) => kind === "setPrimary"), ["setPrimary"]);
  assert.ok(result.products[0].checks.some((check) => check.name === "Old primary kept as gallery" && check.ok));
  // RPC failure -> Partial, listed, never "verified"
  const failing = await runBulkUpload(planned, fakeDeps({ initial, failPrimary: true }).deps);
  assert.equal(failing.products[0].status, "partial");
  assert.equal(failing.products[0].failure.stage, "primary");
});

test("11-13. one product's failure does not stop later products; partial state and orphans are reported", async () => {
  const { planned } = bulk();
  // p1: second upload fails -> partial (1 saved). p2: insert fails -> partial + orphan. p7: fine.
  const { deps, log } = fakeDeps({ failUpload: (id, index) => id === "p1" && index === 1, failInsert: (id) => id === "p2" });
  const result = await runBulkUpload(planned, deps);
  const byId = Object.fromEntries(result.products.map((entry) => [entry.productId, entry]));
  assert.equal(byId.p1.status, "partial");
  assert.equal(byId.p1.failure.stage, "upload");
  assert.equal(byId.p1.inserted.length, 1);
  assert.match(byId.p1.message, /Image 2 of 2 .*failed at upload/);
  assert.match(byId.p1.message, new RegExp(byId.p1.inserted[0].mediaId));
  assert.equal(byId.p2.status, "partial");
  assert.equal(byId.p2.failure.stage, "insert");
  assert.match(byId.p2.orphan.publicId, /products\/p2\//);
  assert.match(byId.p2.message, /ORPHANED Cloudinary asset/);
  assert.equal(byId.p7.status, "verified");
  assert.equal(result.outcome, "issues");
  assert.notEqual(result.message, "All 3 product(s) uploaded and verified.");
  assert.deepEqual({ attempted: result.summary.attempted, verified: result.summary.verified, partial: result.summary.partial, failed: result.summary.failed }, { attempted: 3, verified: 1, partial: 2, failed: 0 });
  assert.equal(result.summary.orphans.length, 1);
  assert.equal(result.summary.imagesUploaded, 3);
  assert.equal(result.summary.imagesFailed, 3);
  assert.equal(log.filter((entry) => entry[0] === "upload" && entry[1] === "p2").length, 1, "p2 stops after its failed insert");
  // A product whose very first upload fails has nothing saved -> Failed, and the batch continues.
  const failed = await runBulkUpload(planned, fakeDeps({ failUpload: (id) => id === "p1" }).deps);
  assert.equal(failed.products[0].status, "failed");
  assert.equal(failed.products[2].status, "verified");
});

test("14. read-back problems are never reported as verified", async () => {
  const { planned } = bulk();
  const dup = await runBulkUpload(planned.slice(0, 1), fakeDeps({ afterInsert: (row, rows) => row.sort_order === 1 && rows.push({ ...row, id: "dup" }) }).deps);
  assert.equal(dup.products[0].status, "saved");
  assert.equal(dup.outcome, "issues");
  const noPrimary = await runBulkUpload(planned.slice(0, 1), fakeDeps({ afterInsert: (row) => (row.is_primary = false) }).deps);
  assert.equal(noPrimary.products[0].checks.find((check) => check.name === "Exactly one primary").ok, false);
  const unreadable = await runBulkUpload(planned.slice(0, 1), fakeDeps({ readFails: true }).deps);
  assert.equal(unreadable.products[0].status, "saved");
  assert.match(unreadable.products[0].message, /NOT verified/);
});

test("15. progress counters and per-product statuses are correct", async () => {
  const { planned } = bulk();
  const snapshots = [];
  const { deps } = fakeDeps({ failUpload: (id, index) => id === "p1" && index === 1, onProgress: (progress) => snapshots.push(progress) });
  await runBulkUpload(planned, deps);
  const last = snapshots.at(-1);
  assert.equal(last.productsTotal, 3);
  assert.equal(last.productsDone, 3);
  assert.equal(last.imagesTotal, 6);
  assert.equal(last.imagesDone, 6, "stopped images still count as handled so the counter reaches its total");
  assert.equal(last.current, null);
  assert.deepEqual(Object.values(last.statuses), ["partial", "verified", "verified"]);
  assert.ok(snapshots.some((entry) => entry.statuses.s1 === "uploading" && entry.statuses.s2 === "pending"));
  assert.ok(snapshots.some((entry) => entry.current?.title === "Product 2" && entry.current.imageTotal === 2));
  assert.ok(snapshots.every((entry, index) => index === 0 || entry.imagesDone >= snapshots[index - 1].imagesDone));
});

test("16. double-submit is blocked by the latch", () => {
  const latch = createSubmitLatch();
  assert.equal(latch.tryAcquire(), true);
  assert.equal(latch.tryAcquire(), false);
  latch.release();
  assert.equal(latch.tryAcquire(), true);
});

test("19. Motorola regression: a product that now has media is recognised and never blindly re-uploaded", async () => {
  const MOTO = "moto-edge-fusion";
  const catalog = [product({ id: MOTO, title: "Motorola Moto Edge Fusion", hasPrimary: true, mediaCount: 2 })];
  const images = [image(1), image(2)];
  const review = reviewOf({ set: shopifySet("s1", images, { match: match("matched", MOTO) }), decision: decision(images, { productId: MOTO }) });
  // After a refresh the catalog shows primary + 2 media: default "skip" is not eligible, Select all eligible leaves it out, upload is blocked.
  assert.match(plan(review, catalog).reason, /already has a primary image/);
  assert.equal(selectAllEligible(deselectAll(review), catalog).decisions.s1.included, false);
  // Reviewed while it had no media, but DEV changed meanwhile: the pre-write re-check blocks it.
  const stale = plan(review, [product({ id: MOTO, title: "Motorola Moto Edge Fusion", hasPrimary: false, mediaCount: 0 })]).products;
  const initial = { [MOTO]: [mediaRow("m1", MOTO, 0, true), mediaRow("m2", MOTO, 1, false)] };
  const { deps, log, store } = fakeDeps({ initial });
  const result = await runBulkUpload(stale, deps);
  assert.equal(result.products[0].status, "blocked");
  assert.match(result.products[0].message, new RegExp(MEDIA_CHANGED_MESSAGE));
  assert.deepEqual(kinds(log), ["read"], "no signature, upload or insert");
  assert.equal(store.get(MOTO).length, 2);
  assert.equal(result.outcome, "issues");
});

test("20-21, 24. no publish/price/variant/inventory write, no destructive media operation, no PROD reference", async () => {
  const lib = await readFile("src/lib/bulkImageUpload.ts", "utf8");
  assert.doesNotMatch(lib, /\.delete\(|\.update\(|\.upsert\(|\.rpc\(|cloudinary-delete-media|is_published|product_variants|import\.meta\.env|service[_-]?role|CLOUDINARY_API_SECRET/);
  assert.doesNotMatch(lib, /\.from\(|price_|inventory_|stock_/);
  assert.doesNotMatch(lib, new RegExp(SUPABASE_ENVIRONMENTS.production.supabaseProjectRef));
  assert.doesNotMatch(lib, /isolutions-pakistan-production/);
  assert.match(lib, /This will write product_media records to DEV and upload images to Cloudinary\./);
  const panel = await readFile("src/admin/BulkProductImages.tsx", "utf8");
  assert.match(panel, /Upload Selected Images to \$\{UPLOAD_LABEL\}/);
  assert.doesNotMatch(panel, /DEV-only upload test|\(one product\)|Apply Selected Images|Upload Selected Product to DEV/);
  assert.doesNotMatch(panel, /\.delete\(|\.upsert\(|\.update\(|cloudinary-delete-media|functions\.invoke|\bfetch\(|XMLHttpRequest|api\.cloudinary\.com/);
  assert.equal((panel.match(/\.rpc\(/g) ?? []).length, 1);
  assert.match(panel, /\.rpc\("set_product_media_primary", \{ p_media_id: mediaId \}\)/);
  assert.equal((panel.match(/\.insert\(/g) ?? []).length, 1);
  assert.doesNotMatch(panel, new RegExp(SUPABASE_ENVIRONMENTS.production.supabaseProjectRef));
  assert.match(panel, /<fieldset className="bulk-images-lock" disabled=\{uploading\}>/, "review controls are locked during a run");
});

// ---------- Bulk selection controls (review-only) ----------

const statuses = (review, catalog) => Object.fromEntries([...reviewSetStates(review, catalog)].map(([id, state]) => [id, state.status]));
const includedIds = (review) => review.sets.filter((set) => review.decisions[set.setId].included).map((set) => set.setId);

test("22. Deselect all clears only include flags", () => {
  const { catalog, review } = manyProducts();
  const next = deselectAll(review);
  assert.deepEqual(includedIds(next), []);
  assert.deepEqual(statuses(next, catalog), statuses(review, catalog));
  for (const set of review.sets) {
    const before = review.decisions[set.setId];
    assert.deepEqual({ ...next.decisions[set.setId], included: before.included }, before);
  }
  assert.equal(next.sets, review.sets);
});

test("22. Select all eligible includes only resolved Matched/Confirmed sets and never resolves anything", () => {
  const { catalog, review } = manyProducts();
  const next = selectAllEligible(deselectAll(review), catalog);
  assert.deepEqual(includedIds(next), ["s1", "s2", "s7"]);
  assert.deepEqual(statuses(next, catalog), statuses(review, catalog));
  assert.equal(next.decisions.s3.confirmed, false);
  const withMode = { ...next, decisions: { ...next.decisions, s4: { ...next.decisions.s4, existingMode: "add" } } };
  assert.ok(includedIds(selectAllEligible(withMode, catalog)).includes("s4"));
  const conflict = reviewOf(...["a", "b"].map((id, i) => ({ set: shopifySet(id, [image(i + 1)]), decision: decision([image(i + 1)], { included: false }) })));
  assert.deepEqual(includedIds(selectAllEligible(conflict, [product()])), []);
});

test("22. Keep only this set leaves one included set with its gallery, Primary and statuses intact", () => {
  const { catalog, review } = manyProducts();
  const many = selectAllEligible(review, catalog);
  assert.ok(includedIds(many).length > 1);
  const chosen = { ...many, decisions: { ...many.decisions, s2: { ...many.decisions.s2, primaryImageId: "img-22" } } };
  const next = keepOnlySet(chosen, "s2");
  assert.deepEqual(includedIds(next), ["s2"]);
  assert.deepEqual(next.decisions.s2.selectedImageIds, ["img-21", "img-22"]);
  assert.equal(next.decisions.s2.primaryImageId, "img-22");
  assert.deepEqual(next.sets, chosen.sets);
  assert.deepEqual(statuses(next, catalog), statuses(chosen, catalog));
  const validation = validateBulkImageSelection(next, catalog, referenceCatalogEnvironment(DEV_URL));
  assert.equal(validation.selectedProducts, 1);
  assert.equal(validation.selectedSets, 1);
  assert.equal(validation.selectedImages, 2);
  const planned = plan(next, catalog);
  assert.equal(planned.enabled, true);
  assert.equal(planned.products.length, 1);
  assert.equal(planned.products[0].images.find((entry) => entry.finalPrimary).imageId, "img-22");
  assert.equal(keepOnlySet(many, "s5"), many);
  assert.equal(keepOnlySet(many, "s6"), many);
  assert.equal(keepOnlySet(many, "missing"), many);
  const review3 = keepOnlySet(many, "s3");
  assert.equal(review3.decisions.s3.confirmed, false);
  assert.match(plan(review3, catalog).reason, /Review is unresolved/);
});

test("22. selection controls are pure review state; the panel is manual upload only (Shopify import removed)", async () => {
  const lib = await readFile("src/lib/bulkProductImagesReview.ts", "utf8");
  assert.doesNotMatch(lib, /supabase\.from|\.insert\(|\.rpc\(|fetch\(|XMLHttpRequest|cloudinary\.com/);
  const panel = await readFile("src/admin/BulkProductImages.tsx", "utf8");
  assert.doesNotMatch(panel, /Shopify|readShopifyExport|parseShopifyReview|Load & Match|loadAndMatch|Catalog coverage|Source sets/);
  assert.doesNotMatch(panel, /Select all eligible|Deselect all|Confirm all review suggestions/);
  assert.equal((panel.match(/>\s*Keep only this set\s*</g) ?? []).length, 1, "Missing Images local set only");
  assert.match(panel, /Manual Product Image Upload/);
  assert.match(panel, /<ImagePlus \/> Upload Images/, "per-product upload in Missing Images");
  assert.match(panel, /setPrimaryImage\(current, set\.setId, image\.id\)/, "primary selection");
  assert.match(panel, /<MissingImages /);
});
