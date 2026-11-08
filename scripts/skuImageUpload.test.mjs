// Bulk Image Upload by SKU — matching, preview rules, ZIP/folder reading, upload runner, retry and read-back.
// Offline: database, Cloudinary and storage are in-memory fakes.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import JSZip from "jszip";
import {
  buildSkuPreview,
  ledgerKey,
  parseSkuFileName,
  parseSkuRange,
  runSkuImageUpload,
  skuInRange,
  skuUploadReportCsv,
  sniffImageFormat,
} from "../src/lib/skuImageUpload.ts";
import { describeImage, imageDimensions, readPickedFiles, readZipFile } from "../src/lib/skuImageFiles.ts";
import { SUPABASE_ENVIRONMENTS } from "../src/lib/supabaseEnvironment.ts";

const PROD_URL = `https://${SUPABASE_ENVIRONMENTS.production.supabaseProjectRef}.supabase.co`;
const DEV_URL = `https://${SUPABASE_ENVIRONMENTS.development.supabaseProjectRef}.supabase.co`;
const ROOT = { production: "isolutions-production/products/", development: "isolutions-development/products/" };

// ---------- synthetic image bytes (valid headers) ----------
function png(width, height, seed = 0) {
  const bytes = new Uint8Array(40 + seed);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
  new DataView(bytes.buffer).setUint32(16, width);
  new DataView(bytes.buffer).setUint32(20, height);
  bytes[39 + seed] = seed;
  return bytes;
}
function jpeg(width, height, seed = 0) {
  const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0, 0, 0xff, 0xc0, 0x00, 0x11, 0x08, height >> 8, height & 255, width >> 8, width & 255, 3, seed, 0, 0, 0, 0, 0, 0, 0, 0, 0xff, 0xd9]);
  return bytes;
}
function webp(width, height) {
  const bytes = new Uint8Array(40);
  bytes.set([...Buffer.from("RIFF"), 0, 0, 0, 0, ...Buffer.from("WEBPVP8X")]);
  const w = width - 1, h = height - 1;
  bytes.set([w & 255, (w >> 8) & 255, (w >> 16) & 255, h & 255, (h >> 8) & 255, (h >> 16) & 255], 24);
  return bytes;
}
const blob = (bytes, type = "image/jpeg") => new Blob([bytes], { type });

let fileSeq = 0;
async function file(name, bytes = jpeg(1000, 1000, fileSeq % 250), extra = {}) {
  const described = await describeImage(fileSeq++, name, name, blob(bytes));
  return { ...described, ...extra };
}

// ---------- catalog / fakes ----------
const pid = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const product = (n, sku, media = [], extra = {}) => ({ id: pid(n), title: `Product ${sku}`, category: "gadgets", publicationStatus: "draft", skus: [sku], media, ...extra });
const mediaRow = (productId, n, primary, sort, env = "production") => ({ id: `old-${productId}-${n}`, product_id: productId, cloudinary_public_id: `${ROOT[env]}${productId}/old${n}`, secure_url: "https://res.cloudinary.com/x/old.jpg", sort_order: sort, is_primary: primary });

function fakeBackend({ env = "production", failUpload = () => false, failInsert = () => false, folderFor = (id) => `${ROOT[env]}${id}`, readFail = () => false } = {}) {
  const media = new Map();
  const calls = { signatures: 0, uploads: 0, inserts: 0, reads: 0, active: 0, maxActive: 0 };
  let seq = 0;
  const ledgerStore = {};
  const deps = {
    supabaseUrl: env === "production" ? PROD_URL : DEV_URL,
    buildMode: env,
    requestSignature: async (productId) => {
      calls.signatures++;
      return { cloudName: "isolutions", apiKey: "k", signature: "s", signedParameters: { folder: folderFor(productId), timestamp: 1, transformation: "t" } };
    },
    upload: async (signature, source) => {
      calls.uploads++;
      calls.active++;
      calls.maxActive = Math.max(calls.maxActive, calls.active);
      await new Promise((resolve) => setTimeout(resolve, 2));
      calls.active--;
      const productId = signature.signedParameters.folder.split("/").pop();
      if (failUpload(productId, source)) throw new Error("network down");
      seq++;
      return { public_id: `${signature.signedParameters.folder}/up${seq}`, asset_id: `a${seq}`, version: 1, secure_url: `https://res.cloudinary.com/isolutions/image/upload/v1/up${seq}.jpg`, width: 1000, height: 1000, bytes: source.size, format: "jpg", extra_field: "ignored" };
    },
    insertMedia: async (payload) => {
      calls.inserts++;
      if (failInsert(payload)) throw new Error("insert rejected");
      const rows = media.get(payload.product_id) ?? [];
      if (payload.is_primary && rows.some((row) => row.is_primary)) throw new Error("duplicate key value violates unique constraint product_media_one_primary_per_product");
      const row = { id: `m${++seq}`, product_id: payload.product_id, cloudinary_public_id: payload.cloudinary_public_id, secure_url: payload.secure_url, sort_order: payload.sort_order, is_primary: payload.is_primary, alt_text: payload.alt_text };
      media.set(payload.product_id, [...rows, row]);
      return { id: row.id };
    },
    readMedia: async (productId) => {
      calls.reads++;
      if (readFail(productId)) throw new Error("read failed");
      return [...(media.get(productId) ?? [])].sort((a, b) => a.sort_order - b.sort_order).map(({ alt_text, ...row }) => row);
    },
    ledger: { get: (key) => ledgerStore[key], set: (key, entry) => { ledgerStore[key] = entry; } },
    fileFor: () => null,
  };
  return { deps, media, calls, ledgerStore };
}
/** Catalog as the page would re-read it from the fake database. */
const reread = (catalog, media) => catalog.map((entry) => ({ ...entry, media: [...(media.get(entry.id) ?? entry.media)].map(({ alt_text, ...row }) => row) }));

const options = (extra = {}) => ({ environment: "production", range: parseSkuRange("GD032", "GD223").range, addToProductsWithImages: false, ledger: {}, ...extra });

// ---------- filenames and ranges ----------
test("SKU filenames: number, separators, case, default image 1; others rejected", () => {
  assert.deepEqual(parseSkuFileName("GD032-01.jpg"), { sku: "GD032", number: 1 });
  assert.deepEqual(parseSkuFileName("gd032_12.PNG"), { sku: "GD032", number: 12 });
  assert.deepEqual(parseSkuFileName("GD032 3.webp"), { sku: "GD032", number: 3 });
  assert.deepEqual(parseSkuFileName("GD032.jpeg"), { sku: "GD032", number: 1 });
  assert.deepEqual(parseSkuFileName("folder/sub/MB001-02.jpg"), { sku: "MB001", number: 2 });
  for (const bad of ["GD032-01.gif", "GD032-01.avif", "photo.jpg", "GD32-01.jpg", "GD032-00.jpg", "GD032-01 (1).jpg", "GD032-1a.jpg", "Product GD032.jpg"]) assert.equal(parseSkuFileName(bad), null, bad);
});

test("SKU range: same prefix and width, inclusive, protects the 25 existing gadgets", () => {
  const { range } = parseSkuRange("GD032", "GD223");
  assert.equal(range.label, "GD032–GD223");
  assert.ok(skuInRange("GD032", range) && skuInRange("GD223", range) && skuInRange("GD100", range));
  for (const sku of ["GD031", "GD010", "GD001", "GD224", "AC032", "GD0032"]) assert.equal(skuInRange(sku, range), false, sku);
  assert.match(parseSkuRange("GD032", "").error, /both ends/);
  assert.match(parseSkuRange("GD032", "AC100").error, /same prefix/);
  assert.match(parseSkuRange("GD200", "GD100").error, /not be higher/);
  assert.deepEqual(parseSkuRange("", ""), { range: null, error: null });
});

test("real format and pixel size come from the file bytes, not the name", async () => {
  assert.equal(sniffImageFormat(png(10, 10)), "png");
  assert.equal(sniffImageFormat(jpeg(10, 10)), "jpeg");
  assert.equal(sniffImageFormat(webp(10, 10)), "webp");
  assert.equal(sniffImageFormat(new Uint8Array([0x47, 0x49, 0x46, 0x38, 0, 0, 0, 0, 0, 0, 0, 0])), null);
  assert.deepEqual(imageDimensions(png(1200, 800), "png"), { width: 1200, height: 800 });
  assert.deepEqual(imageDimensions(jpeg(640, 480), "jpeg"), { width: 640, height: 480 });
  assert.deepEqual(imageDimensions(webp(1500, 900), "webp"), { width: 1500, height: 900 });
  const fake = await describeImage(0, "GD032-01.jpg", "GD032-01.jpg", blob(new TextEncoder().encode("not an image at all")));
  assert.match(fake.readError, /not a JPG, PNG or WebP/);
  const real = await describeImage(1, "GD032-01.jpg", "GD032-01.jpg", blob(png(900, 900)));
  assert.equal(real.format, "png");
  assert.match(real.sha256, /^[0-9a-f]{64}$/);
});

// ---------- preview ----------
test("preview: matching, primary rule, order, unmatched, range, duplicates, conflicts, errors, existing images", async () => {
  const catalog = [
    product(1, "GD032"),
    product(2, "GD033", [mediaRow(pid(2), 1, true, 0), mediaRow(pid(2), 2, false, 4)]),
    product(3, "GD034"),
    product(4, "GD035"),
    product(5, "GD010"),
    product(6, "GD036", [], { skus: ["GD036", "GD037"] }),
  ];
  const same = jpeg(900, 900, 201);
  const files = [
    await file("GD032-02.jpg"),
    await file("GD032-01.png", png(1200, 1200, 3)),
    await file("GD032-03.jpg", jpeg(500, 500, 7)), // low resolution warning
    await file("GD032-04.jpg", same), // same picture also named for GD034 → both held back
    await file("GD034-01.jpg", same),
    await file("GD034-02.jpg", jpeg(900, 900, 202)),
    await file("GD034-03.jpg", jpeg(900, 900, 202)), // identical copy within product → skipped
    await file("GD033-01.jpg"), // product has images → skipped by default
    await file("GD035-01.jpg", jpeg(800, 800, 11)),
    await file("GD035_1.jpg", jpeg(800, 800, 12)), // same number, different picture → product blocked
    await file("GD010-01.jpg"), // outside the range (protected watch)
    await file("GD999-01.jpg"), // in range, no such SKU
    await file("holiday.jpg"),
    await file("GD036-02.jpg", jpeg(1000, 1000, 13)),
    await file("GD037-01.jpg", jpeg(1000, 1000, 14)), // two variant SKUs of one product join one set
    await file("GD032-05.jpg", jpeg(200, 200, 15)), // too small
    await file("GD032-06.png", jpeg(1000, 1000, 16)), // JPEG named .png → warning only
  ];
  const preview = buildSkuPreview(files, catalog, options());
  const by = (sku) => preview.products.find((entry) => entry.skus.includes(sku));

  const p1 = by("GD032");
  assert.equal(p1.status, "ready");
  assert.deepEqual(p1.images.map((image) => image.name), ["GD032-01.png", "GD032-02.jpg", "GD032-03.jpg", "GD032-06.png"]);
  assert.deepEqual(p1.images.map((image) => image.role), ["primary", "gallery", "gallery", "gallery"]);
  assert.deepEqual(p1.images.map((image) => image.sortOrder), [0, 1, 2, 3]);
  assert.match(p1.images[2].warning, /Low resolution/);
  assert.match(p1.images[3].warning, /really JPEG/);

  const p2 = by("GD033");
  assert.equal(p2.status, "skipped");
  assert.match(p2.reason, /Already has 2 images/);
  const p2add = buildSkuPreview(files, catalog, options({ addToProductsWithImages: true })).products.find((entry) => entry.skus.includes("GD033"));
  assert.equal(p2add.status, "ready");
  assert.equal(p2add.images[0].role, "gallery", "a product with a primary keeps it");
  assert.equal(p2add.images[0].sortOrder, 5, "appended after the highest existing sort_order");

  const p3 = by("GD034");
  assert.deepEqual(p3.images.map((image) => image.name), ["GD034-02.jpg"]);
  assert.equal(p3.images[0].role, "primary", "the lowest remaining image becomes primary");
  assert.equal(by("GD035").status, "blocked");
  assert.match(by("GD035").reason, /both use image number 1/);
  assert.deepEqual(by("GD036").images.map((image) => image.name), ["GD037-01.jpg", "GD036-02.jpg"]);
  assert.equal(by("GD010"), undefined);

  assert.deepEqual(preview.unmatched.map((entry) => entry.name).sort(), ["GD010-01.jpg", "GD999-01.jpg", "holiday.jpg"]);
  assert.match(preview.unmatched.find((entry) => entry.name === "GD010-01.jpg").reason, /outside the SKU range GD032–GD223/);
  assert.deepEqual(preview.duplicates.map((entry) => entry.name).sort(), ["GD032-04.jpg", "GD034-01.jpg", "GD034-03.jpg"]);
  assert.deepEqual(preview.errors.map((entry) => entry.name), ["GD032-05.jpg"]);
  assert.equal(preview.totals.readyProducts, 3);
  assert.equal(preview.totals.imagesToUpload, 4 + 1 + 2);
});

test("preview: PRODUCTION without a SKU range blocks every product; DEV does not need one", async () => {
  const catalog = [product(1, "GD032")];
  const files = [await file("GD032-01.jpg")];
  const prod = buildSkuPreview(files, catalog, options({ range: null }));
  assert.equal(prod.products[0].status, "blocked");
  assert.match(prod.products[0].reason, /PRODUCTION uploads need a SKU range/);
  assert.equal(buildSkuPreview(files, catalog, options({ range: null, environment: "development" })).products[0].status, "ready");
});

test("preview: a SKU shared by two products is an error, never guessed", async () => {
  const catalog = [product(1, "GD032"), product(2, "GD032")];
  const preview = buildSkuPreview([await file("GD032-01.jpg")], catalog, options());
  assert.equal(preview.products.length, 0);
  assert.match(preview.errors[0].reason, /more than one product/);
});

// ---------- ZIP and folder input ----------
test("ZIP and folder input: images read, folders inside the ZIP kept, system and non-image files ignored", async () => {
  const zip = new JSZip();
  zip.file("Piyave/GD032-01.jpg", jpeg(1000, 1000, 1));
  zip.file("Piyave/GD032-02.png", png(1000, 1000, 2));
  zip.file("GD033-01.webp", webp(800, 800));
  zip.file("__MACOSX/Piyave/._GD032-01.jpg", "junk");
  zip.file("Piyave/.DS_Store", "junk");
  zip.file("Piyave/notes.txt", "hello");
  const bytes = await zip.generateAsync({ type: "uint8array" });
  const read = await readZipFile(Object.assign(new Blob([bytes]), { name: "batch.zip" }), 10);
  assert.equal(read.error, null);
  assert.deepEqual(read.files.map((entry) => entry.name).sort(), ["GD032-01.jpg", "GD032-02.png", "GD033-01.webp"]);
  assert.deepEqual(read.files.map((entry) => entry.index).sort(), [10, 11, 12]);
  assert.ok(read.files.every((entry) => entry.sha256 && entry.width && !entry.readError));
  assert.deepEqual(read.ignored, ["Piyave/notes.txt"]);
  assert.match(read.files.find((entry) => entry.name === "GD032-01.jpg").path, /^batch\.zip\/Piyave\//);
  const broken = await readZipFile(Object.assign(new Blob([new Uint8Array([1, 2, 3])]), { name: "x.zip" }));
  assert.match(broken.error, /could not be read/);

  const picked = [
    Object.assign(blob(jpeg(1000, 1000, 5)), { name: "GD040-01.jpg", webkitRelativePath: "Images/GD040/GD040-01.jpg" }),
    Object.assign(blob(new Uint8Array([1])), { name: "Thumbs.db", webkitRelativePath: "Images/Thumbs.db" }),
    Object.assign(blob(new Uint8Array([1])), { name: "manifest.csv", webkitRelativePath: "Images/manifest.csv" }),
  ];
  const folder = await readPickedFiles(picked);
  assert.deepEqual(folder.files.map((entry) => entry.path), ["Images/GD040/GD040-01.jpg"]);
  assert.deepEqual(folder.ignored, ["Images/manifest.csv"]);
});

// ---------- upload runner ----------
async function setup(count, perProduct = 3, backendOptions = {}) {
  const catalog = Array.from({ length: count }, (_, i) => product(i + 1, `GD${String(32 + i).padStart(3, "0")}`));
  const files = [];
  for (const entry of catalog) for (let n = 1; n <= perProduct; n++) files.push(await file(`${entry.skus[0]}-0${n}.jpg`, jpeg(1000, 1000, files.length % 250)));
  const backend = fakeBackend(backendOptions);
  const blobs = new Map(files.map((entry) => [entry.index, entry.file]));
  backend.deps.fileFor = (index) => blobs.get(index) ?? null;
  return { catalog, files, backend };
}

test("upload: every product verified, primary first, order kept, at most 3 products at a time, progress complete", async () => {
  const { catalog, files, backend } = await setup(7, 3);
  const progress = [];
  backend.deps.onProgress = (state) => progress.push(state);
  const preview = buildSkuPreview(files, catalog, options());
  const result = await runSkuImageUpload(preview, backend.deps);
  assert.equal(result.outcome, "all_verified", result.message);
  assert.equal(result.summary.imagesSaved, 21);
  assert.ok(backend.calls.maxActive <= 3 && backend.calls.maxActive >= 2, `max parallel ${backend.calls.maxActive}`);
  for (const entry of catalog) {
    const rows = backend.media.get(entry.id);
    assert.deepEqual(rows.map((row) => [row.sort_order, row.is_primary]), [[0, true], [1, false], [2, false]]);
    assert.ok(rows.every((row) => row.cloudinary_public_id.startsWith(`${ROOT.production}${entry.id}/`)));
    assert.equal(rows[0].alt_text, entry.title);
    assert.equal(rows[1].alt_text, `${entry.title} – image 2`);
  }
  const last = progress.at(-1);
  assert.equal(last.imagesDone, last.imagesTotal);
  assert.equal(last.productsDone, 7);
  assert.ok(result.products.every((entry) => entry.checks.every((check) => check.ok)));
});

test("upload: gallery failure → partial (other images saved); primary failure → nothing else uploaded", async () => {
  const { catalog, files, backend } = await setup(2, 3, {});
  const failing = new Set([files[1].index, files[3].index]); // GD032 image 2 (gallery), GD033 image 1 (primary)
  const fileFor = backend.deps.fileFor;
  backend.deps.upload = ((upload) => async (signature, source) => {
    if ([...failing].some((index) => fileFor(index) === source)) throw new Error("network down");
    return upload(signature, source);
  })(backend.deps.upload);
  const result = await runSkuImageUpload(buildSkuPreview(files, catalog, options()), backend.deps);
  const [a, b] = result.products;
  assert.equal(a.status, "partial");
  assert.deepEqual(a.images.map((image) => image.status), ["saved", "failed", "saved"]);
  assert.equal(b.status, "failed");
  assert.deepEqual(b.images.map((image) => image.status), ["failed", "not_attempted", "not_attempted"]);
  assert.equal(backend.media.get(catalog[1].id), undefined, "no gallery image without its primary");
  assert.equal(result.outcome, "issues");
  assert.equal(result.summary.imagesFailed, 2);
  assert.equal(result.summary.imagesNotAttempted, 2);
});

test("retry: re-reads the database; saved images skipped, Cloudinary-only images saved without re-upload, failed ones uploaded", async () => {
  const { catalog, files, backend } = await setup(2, 3);
  // Run 1: GD032 image 2 fails at Cloudinary; GD032 image 3 uploads but its row insert fails; GD033 fine.
  const fileFor = backend.deps.fileFor;
  let uploadFailOnce = true;
  backend.deps.upload = ((upload) => async (signature, source) => {
    if (uploadFailOnce && fileFor(files[1].index) === source) {
      uploadFailOnce = false;
      throw new Error("timeout");
    }
    return upload(signature, source);
  })(backend.deps.upload);
  let insertFailOnce = true;
  backend.deps.insertMedia = ((insert) => async (payload) => {
    if (insertFailOnce && payload.product_id === catalog[0].id && payload.sort_order === 2) {
      insertFailOnce = false;
      throw new Error("connection reset");
    }
    return insert(payload);
  })(backend.deps.insertMedia);
  const first = await runSkuImageUpload(buildSkuPreview(files, catalog, options()), backend.deps);
  assert.deepEqual(first.products[0].images.map((image) => image.status), ["saved", "failed", "failed"]);
  assert.equal(first.products[1].status, "verified");
  const recorded = backend.ledgerStore[ledgerKey("production", catalog[0].id, files[2].sha256)];
  assert.ok(recorded.cloudinary && !recorded.mediaId, "the Cloudinary result is recorded although the row was not saved");
  assert.deepEqual(Object.keys(recorded.cloudinary).sort(), ["asset_id", "bytes", "format", "height", "public_id", "secure_url", "version", "width"]);

  // Retry: fresh read of the database + the recorded results.
  const uploadsBefore = backend.calls.uploads;
  const retryPreview = buildSkuPreview(files, reread(catalog, backend.media), options({ ledger: backend.ledgerStore }));
  const p1 = retryPreview.products[0];
  const p2 = retryPreview.products[1];
  assert.equal(p1.status, "ready", "rows created by this tool do not count as foreign images");
  assert.deepEqual(p1.images.map((image) => image.state), ["already_uploaded", "new", "save_only"]);
  assert.equal(p2.status, "done");
  assert.equal(retryPreview.totals.imagesToUpload, 2);
  const second = await runSkuImageUpload(retryPreview, backend.deps);
  assert.equal(second.outcome, "all_verified", second.message);
  assert.equal(backend.calls.uploads - uploadsBefore, 1, "only the image that never reached Cloudinary is uploaded again");
  const rows = backend.media.get(catalog[0].id);
  assert.deepEqual(rows.map((row) => [row.sort_order, row.is_primary]), [[0, true], [1, false], [2, false]], "retried images take their original slots");
  assert.equal(rows.find((row) => row.sort_order === 1).alt_text, `${catalog[0].title} – image 2`);
  assert.equal(new Set(rows.map((row) => row.cloudinary_public_id)).size, 3);
  assert.equal(rows[2].cloudinary_public_id, recorded.cloudinary.public_id, "the recorded Cloudinary asset is the one saved");

  // A third pass finds nothing to do.
  const third = buildSkuPreview(files, reread(catalog, backend.media), options({ ledger: backend.ledgerStore }));
  assert.deepEqual(third.products.map((entry) => entry.status), ["done", "done"]);
  assert.equal(third.totals.imagesToUpload, 0);
});

test("retry never trusts a record whose row is gone, and an unknown row blocks the product", async () => {
  const { catalog, files, backend } = await setup(1, 1);
  await runSkuImageUpload(buildSkuPreview(files, catalog, options()), backend.deps);
  // Someone deleted the row in the Media tab: the record alone does not count as uploaded.
  backend.media.set(catalog[0].id, []);
  const again = buildSkuPreview(files, reread(catalog, backend.media), options({ ledger: backend.ledgerStore }));
  assert.equal(again.products[0].images[0].state, "new");
  // Media changes between preview and upload → blocked, nothing written.
  backend.media.set(catalog[0].id, [mediaRow(catalog[0].id, 9, true, 0)]);
  const insertsBefore = backend.calls.inserts;
  const result = await runSkuImageUpload(again, backend.deps);
  assert.equal(result.products[0].status, "blocked");
  assert.match(result.products[0].message, /changed since the preview/);
  assert.equal(backend.calls.inserts, insertsBefore);
});

test("upload is blocked for unknown environments, mismatched builds and foreign Cloudinary folders", async () => {
  const { catalog, files, backend } = await setup(1, 2);
  const preview = buildSkuPreview(files, catalog, options());
  for (const [url, mode] of [["https://abcdefghijklmnopqrst.supabase.co", "production"], [PROD_URL, "development"], [DEV_URL, "production"]]) {
    const result = await runSkuImageUpload(preview, { ...backend.deps, supabaseUrl: url, buildMode: mode });
    assert.equal(result.outcome, "blocked");
  }
  assert.equal(backend.calls.uploads, 0);
  const wrong = fakeBackend({ folderFor: (id) => `isolutions-development/products/${id}` });
  wrong.deps.fileFor = backend.deps.fileFor;
  const result = await runSkuImageUpload(preview, wrong.deps);
  assert.equal(result.products[0].status, "failed");
  assert.match(result.products[0].images[0].message, /is not "isolutions-production\/products\//);
  assert.equal(wrong.calls.uploads, 0);
});

test("read-back problems are reported as NOT verified", async () => {
  const { catalog, files, backend } = await setup(1, 2);
  let reads = 0;
  const read = backend.deps.readMedia;
  backend.deps.readMedia = async (productId) => {
    reads++;
    const rows = await read(productId);
    return reads === 1 ? rows : rows.map((row) => ({ ...row, sort_order: row.sort_order + 10 }));
  };
  const result = await runSkuImageUpload(buildSkuPreview(files, catalog, options()), backend.deps);
  assert.equal(result.products[0].status, "not_verified");
  assert.match(result.products[0].message, /Image order/);
});

test("CSV report lists every file with its decision and result", async () => {
  const { catalog, files, backend } = await setup(1, 2);
  const extra = [await file("holiday.jpg"), await file("GD010-01.jpg")];
  const preview = buildSkuPreview([...files, ...extra], catalog, options());
  const result = await runSkuImageUpload(preview, backend.deps);
  const csv = skuUploadReportCsv(preview, result, "production");
  const lines = csv.trim().split("\r\n");
  assert.equal(lines.length, 1 + 4);
  assert.match(lines[0], /^environment,file_name,path,sku,image_number,product_id/);
  assert.match(lines[1], /GD032-01\.jpg.*upload,primary,0,saved,m\d+/);
  assert.ok(lines.some((line) => /holiday\.jpg.*unmatched/.test(line)));
});

test("existing Media page keeps its uploader; the SKU section is added on top and writes only through the shared flow", async () => {
  const page = await readFile(new URL("../src/admin/BulkProductImages.tsx", import.meta.url), "utf8");
  assert.match(page, /<SkuImageUpload \/>/);
  assert.match(page, /Manual Product Image Upload/);
  const section = await readFile(new URL("../src/admin/SkuImageUpload.tsx", import.meta.url), "utf8");
  for (const forbidden of ["cloudinary-delete-media", "set_product_media_primary", ".delete(", ".update(", '"published"', "service_role"]) assert.equal(section.includes(forbidden), false, forbidden);
  assert.match(section, /requestProductUploadSignature/);
  assert.match(section, /PRODUCTION_CONFIRMATION_TEXT/);
  const lib = await readFile(new URL("../src/lib/skuImageUpload.ts", import.meta.url), "utf8");
  for (const forbidden of ["delete", "setPrimary", "variant_assign"]) assert.equal(new RegExp(`\\b${forbidden}\\(`).test(lib), false, forbidden);
});
