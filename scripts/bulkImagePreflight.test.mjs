import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  CLOUDINARY_ROOTS,
  cloudinaryFolderProblem,
  cloudinaryPublicIdProblem,
  planBulkUpload,
  resolveUploadTarget,
  runBulkUpload,
  uploadWarning,
} from "../src/lib/bulkImageUpload.ts";
import { PRODUCTION_CONFIRMATION_TEXT, confirmationSatisfied, evaluateBulkPreflight, runBulkPreflight } from "../src/lib/bulkImagePreflight.ts";
import { SUPABASE_ENVIRONMENTS } from "../src/lib/supabaseEnvironment.ts";

const DEV_REF = SUPABASE_ENVIRONMENTS.development.supabaseProjectRef;
const PROD_REF = SUPABASE_ENVIRONMENTS.production.supabaseProjectRef;
const DEV_URL = `https://${DEV_REF}.supabase.co`;
const PROD_URL = `https://${PROD_REF}.supabase.co`;
const P1 = "11111111-1111-1111-1111-111111111111";
const P2 = "22222222-2222-2222-2222-222222222222";

const product = (id, extra = {}) => ({ id, title: `Product ${id.slice(0, 2)}`, slug: id, brand: "Brand", hasPrimary: false, mediaCount: 0, ...extra });
const image = (n, extra = {}) => ({ id: `img-${n}`, label: `Position ${n}`, previewUrl: null, sourceUrl: `https://cdn.shopify.com/s/files/1/a${n}.jpg`, sourcePosition: n, invalidReason: null, ...extra });
const match = (productId, status = "matched") => ({ sourceId: "x", label: "x", status, detectedBrand: "Brand", detectedModel: "M", productId, candidateProductIds: [], productHasPrimary: false, defaultSelected: true, reason: "ok" });
const setOf = (setId, productId, images, status = "matched", extra = {}) => ({ setId, sourceKind: "shopify", title: `Set ${setId}`, handle: setId, shopifyStatus: "active", match: match(productId, status), images, ...extra });
const decisionOf = (productId, images, extra = {}) => ({ productId, confirmed: true, included: true, dismissed: null, existingMode: "skip", selectedImageIds: images.map((entry) => entry.id), primaryImageId: images[0]?.id ?? null, ...extra });
const reviewOf = (...entries) => ({ sets: entries.map((entry) => entry.set), decisions: Object.fromEntries(entries.map((entry) => [entry.set.setId, entry.decision])), nextLocalId: 1 });
const entry = (setId, productId, images, status = "matched", dec = {}) => ({ set: setOf(setId, productId, images, status), decision: decisionOf(productId, images, dec) });
const catalog = () => [product(P1), product(P2)];
const validReview = () => reviewOf(entry("s1", P1, [image(1), image(2)]), entry("s2", P2, [image(3)]));

const input = (overrides = {}) => ({
  review: validReview(),
  catalog: catalog(),
  catalogLoaded: true,
  supabaseUrl: DEV_URL,
  buildMode: "development",
  runtimeRefs: [DEV_REF],
  ...overrides,
});
const prodInput = (overrides = {}) => input({ supabaseUrl: PROD_URL, buildMode: "production", runtimeRefs: [PROD_REF], ...overrides });

function sig(productId, root = CLOUDINARY_ROOTS.production) {
  return { cloudName: "demo-cloud", apiKey: "k", signature: "s", signedParameters: { folder: `${root}${productId}`, timestamp: 1, transformation: "t" } };
}

// ---------- Environment pairs ----------

test("1-6. exact DEV and PROD pairs are allowed; mismatched, unknown and lookalike combinations are blocked", () => {
  const dev = resolveUploadTarget(DEV_URL, "development");
  assert.deepEqual([dev.allowed, dev.environment, dev.projectRef, dev.cloudinaryRoot], [true, "development", DEV_REF, "isolutions-development/products/"]);
  const prod = resolveUploadTarget(PROD_URL, "production");
  assert.deepEqual([prod.allowed, prod.environment, prod.projectRef, prod.cloudinaryRoot], [true, "production", PROD_REF, "isolutions-production/products/"]);
  assert.match(resolveUploadTarget(DEV_URL, "production").reason, /production-mode build is connected to the DEVELOPMENT/);
  assert.match(resolveUploadTarget(PROD_URL, "development").reason, /development-mode build is connected to the PRODUCTION/);
  for (const [url, mode] of [
    ["https://abcdefghijklmnopqrst.supabase.co", "development"],
    [`https://${DEV_REF}.supabase.co.evil.test`, "development"],
    [`http://${DEV_REF}.supabase.co`, "development"],
    [`https://x${PROD_REF}.supabase.co`, "production"],
    [undefined, "production"],
    ["", "development"],
    [DEV_URL, "staging"],
    [DEV_URL, undefined],
    [PROD_URL, ""],
  ])
    assert.equal(resolveUploadTarget(url, mode).allowed, false, `${url} ${mode}`);
});

// ---------- Cloudinary roots ----------

test("7-10. the Cloudinary folder and returned public_id must sit under the environment's own root", () => {
  assert.equal(cloudinaryFolderProblem("development", `isolutions-development/products/${P1}`, P1), null);
  assert.equal(cloudinaryFolderProblem("production", `isolutions-production/products/${P1}`, P1), null);
  for (const [environment, folder] of [
    ["production", `isolutions-development/products/${P1}`],
    ["development", `isolutions-production/products/${P1}`],
    ["production", `isolutions-production/bundles/${P1}`],
    ["production", `isolutions-production/products/${P2}`],
    ["production", `other/isolutions-production/products/${P1}`],
    ["development", `isolutions-development/products/${P1}/extra`],
    ["production", ""],
  ])
    assert.match(cloudinaryFolderProblem(environment, folder, P1), /not "isolutions-/, `${environment} ${folder}`);
  assert.equal(cloudinaryPublicIdProblem("production", `isolutions-production/products/${P1}/abc`, P1), null);
  assert.match(cloudinaryPublicIdProblem("production", `isolutions-development/products/${P1}/abc`, P1), /not under "isolutions-production\/products\//);
  assert.match(cloudinaryPublicIdProblem("development", undefined, P1), /undefined/);
});

function runnerDeps(environment, options = {}) {
  const root = CLOUDINARY_ROOTS[environment];
  const log = [];
  const rows = [];
  let counter = 0;
  return {
    log,
    rows,
    deps: {
      supabaseUrl: environment === "production" ? PROD_URL : DEV_URL,
      buildMode: environment,
      requestSignature: async (productId) => (log.push(["signature"]), sig(productId, options.signRoot ?? root)),
      upload: async (signature) => {
        log.push(["upload"]);
        return {
          public_id: `${options.publicRoot ?? root}${signature.signedParameters.folder.split("/").at(-1)}/img${++counter}`,
          asset_id: "a",
          version: 1700000000,
          secure_url: "https://res.cloudinary.com/demo/image/upload/v1/x.jpg",
          width: 10,
          height: 10,
          bytes: 100,
          format: "jpg",
        };
      },
      insertMedia: async (payload) => {
        log.push(["insert"]);
        const row = { id: `m${rows.length + 1}`, product_id: payload.product_id, cloudinary_public_id: payload.cloudinary_public_id, secure_url: payload.secure_url, sort_order: payload.sort_order, is_primary: payload.is_primary };
        rows.push(row);
        return { id: row.id };
      },
      setPrimary: async () => {},
      readMedia: async (productId) => rows.filter((row) => row.product_id === productId).map((row) => ({ ...row })),
    },
  };
}
const plannedFor = (environment) => planBulkUpload(validReview(), catalog(), environment === "production" ? PROD_URL : DEV_URL, environment).products;

test("7-10. the runner accepts the right root, and blocks a wrong signed folder or a wrong returned public_id without inserting", async () => {
  for (const environment of ["development", "production"]) {
    const ok = runnerDeps(environment);
    const good = await runBulkUpload(plannedFor(environment), ok.deps);
    assert.equal(good.outcome, "all_verified", environment);
    const other = environment === "production" ? "development" : "production";
    const wrongFolder = runnerDeps(environment, { signRoot: CLOUDINARY_ROOTS[other] });
    const folderResult = await runBulkUpload(plannedFor(environment), wrongFolder.deps);
    assert.equal(folderResult.summary.verified, 0);
    assert.equal(folderResult.products[0].failure.stage, "authorization");
    assert.match(folderResult.products[0].failure.message, /signed Cloudinary folder/);
    assert.ok(!wrongFolder.log.some(([kind]) => kind === "upload" || kind === "insert"), "no upload and no insert for a wrong folder");
    const wrongId = runnerDeps(environment, { publicRoot: CLOUDINARY_ROOTS[other] });
    const idResult = await runBulkUpload(plannedFor(environment), wrongId.deps);
    assert.equal(idResult.products[0].failure.stage, "validation");
    assert.match(idResult.products[0].failure.message, /public_id/);
    assert.ok(idResult.products[0].orphan, "the uploaded asset is reported as an orphan");
    assert.ok(!wrongId.log.some(([kind]) => kind === "insert"), "no product_media insert for a wrong public_id");
    assert.equal(wrongId.rows.length, 0);
  }
});

// ---------- Preflight ----------

test("11. PROD preflight passes a valid resolved state and reports the structured result", async () => {
  const calls = [];
  const result = await runBulkPreflight(prodInput(), { requestSignature: async (id) => (calls.push(id), sig(id)) });
  assert.equal(result.passed, true, result.errors.join("; "));
  assert.deepEqual(result.errors, []);
  assert.equal(result.environment, "production");
  assert.equal(result.projectRef, PROD_REF);
  assert.equal(result.buildMode, "production");
  assert.equal(result.productCount, 2);
  assert.equal(result.imageCount, 3);
  assert.deepEqual(result.actions, { newMedia: 2, addImages: 0, makePrimary: 0 });
  assert.deepEqual(result.unresolved, { review: 0, multiple: 0, conflict: 0, invalid: 0 });
  assert.deepEqual(result.mediaSnapshot, { catalogProducts: 2, productsWithMedia: 0, productsWithPrimary: 0 });
  assert.deepEqual(result.cloudinary, { cloudName: "demo-cloud", folder: `isolutions-production/products/${P1}`, root: "isolutions-production/products/" });
  assert.deepEqual(calls, [P1], "one signature, for the first selected product only");
});

test("12-15. Review, Multiple, Conflict and Invalid included sets block the preflight with counts", () => {
  const cases = [
    ["review", reviewOf(entry("s1", P1, [image(1)], "review", { confirmed: false })), /Review is unresolved/],
    ["multiple", reviewOf(entry("s1", null, [image(1)], "multiple", { productId: null, confirmed: false })), /Multiple matches are unresolved/],
    ["conflict", reviewOf(entry("s1", P1, [image(1)]), entry("s2", P1, [image(2)])), /Conflict is unresolved/],
    ["invalid", reviewOf(entry("s1", P1, [image(1, { invalidReason: "bad" })], "invalid", { selectedImageIds: [], primaryImageId: null })), /invalid/i],
  ];
  for (const [key, review, pattern] of cases) {
    const result = evaluateBulkPreflight(input({ review }));
    assert.equal(result.passed, false, key);
    assert.ok(result.unresolved[key] >= 1, key);
    assert.ok(result.errors.some((error) => pattern.test(error)), `${key}: ${result.errors.join(" | ")}`);
  }
});

test("16. two included sets targeting the same product block the preflight", () => {
  const result = evaluateBulkPreflight(input({ review: reviewOf(entry("s1", P1, [image(1)]), entry("s2", P1, [image(2)])) }));
  assert.equal(result.passed, false);
  assert.ok(result.errors.length >= 1);
});

test("preflight also blocks: no selection, unloaded catalog, unmatched primary rules, existing-primary without a mode, a foreign Supabase ref in the runtime", () => {
  assert.ok(evaluateBulkPreflight(input({ review: { sets: [], decisions: {}, nextLocalId: 1 } })).errors.some((error) => /Select at least one/.test(error)));
  assert.ok(evaluateBulkPreflight(input({ catalogLoaded: false })).errors.some((error) => /catalog is not loaded/.test(error)));
  assert.ok(evaluateBulkPreflight(input({ catalog: [] })).errors.some((error) => /catalog is not loaded/.test(error)));
  assert.ok(evaluateBulkPreflight(input({ review: reviewOf(entry("s1", P1, [image(1), image(2)], "matched", { primaryImageId: null })) })).errors.some((error) => /Primary/.test(error)));
  const withPrimary = catalog().map((item) => (item.id === P1 ? { ...item, hasPrimary: true, mediaCount: 1 } : item));
  assert.ok(evaluateBulkPreflight(input({ catalog: withPrimary })).errors.some((error) => /already has a primary image/.test(error)));
  const foreign = evaluateBulkPreflight(prodInput({ runtimeRefs: [PROD_REF, DEV_REF] }));
  assert.equal(foreign.passed, false);
  assert.ok(foreign.errors.some((error) => error.includes(DEV_REF)));
  const foreignDev = evaluateBulkPreflight(input({ runtimeRefs: [DEV_REF, PROD_REF] }));
  assert.ok(foreignDev.errors.some((error) => error.includes(PROD_REF)));
  assert.equal(evaluateBulkPreflight(input({ buildMode: "production" })).passed, false, "DEV project in a production-mode build");
  assert.equal(evaluateBulkPreflight(prodInput({ buildMode: "development" })).passed, false, "PROD project in a development-mode build");
  assert.equal(evaluateBulkPreflight(input()).passed, true);
});

test("17. media that changed since review blocks the affected product at run time (and the snapshot shows what the review saw)", async () => {
  const pre = evaluateBulkPreflight(input());
  assert.equal(pre.plan.products[0].expected.count, 0);
  const { deps, log } = runnerDeps("development");
  const original = deps.readMedia;
  deps.readMedia = async () => (log.push(["read"]), [{ id: "old", product_id: P1, cloudinary_public_id: "x", secure_url: "https://res.cloudinary.com/x", sort_order: 0, is_primary: true }]);
  const result = await runBulkUpload(pre.plan.products.slice(0, 1), deps);
  assert.equal(result.products[0].status, "blocked");
  assert.match(result.products[0].message, /Media changed since review/);
  assert.ok(!log.some(([kind]) => kind === "signature" || kind === "upload" || kind === "insert"));
  deps.readMedia = original;
});

// ---------- Signature-only check ----------

test("18-19, 28. the signature-only check uploads nothing, and a wrong folder / failed request blocks PROD", async () => {
  const calls = [];
  const deps = { requestSignature: async (id) => (calls.push(["signature", id]), sig(id)) };
  assert.deepEqual(Object.keys(deps), ["requestSignature"], "the preflight dependency type has no upload/insert capability");
  await runBulkPreflight(prodInput(), deps);
  assert.deepEqual(calls, [["signature", P1]]);

  const wrong = await runBulkPreflight(prodInput(), { requestSignature: async (id) => sig(id, CLOUDINARY_ROOTS.development) });
  assert.equal(wrong.passed, false);
  assert.match(wrong.errors.at(-1), /Signature check failed.*isolutions-production\/products\//);
  assert.equal(wrong.cloudinary, null);

  const failed = await runBulkPreflight(prodInput(), { requestSignature: async () => { throw new Error("forbidden"); } });
  assert.equal(failed.passed, false);
  assert.match(failed.errors.at(-1), /Signature check failed: forbidden\. PRODUCTION upload is blocked/);

  const noCloud = await runBulkPreflight(prodInput(), { requestSignature: async (id) => ({ ...sig(id), cloudName: "" }) });
  assert.equal(noCloud.passed, false);

  // Blocked sync checks never reach Cloudinary; DEV never makes the signature request.
  const sigCalls = [];
  const dev = await runBulkPreflight(input(), { requestSignature: async (id) => (sigCalls.push(id), sig(id, CLOUDINARY_ROOTS.development)) });
  assert.equal(dev.passed, true);
  assert.deepEqual(sigCalls, []);
  const blockedFirst = await runBulkPreflight(prodInput({ catalogLoaded: false }), { requestSignature: async (id) => (sigCalls.push(id), sig(id)) });
  assert.equal(blockedFirst.passed, false);
  assert.deepEqual(sigCalls, []);

  const source = await readFile("src/lib/bulkImagePreflight.ts", "utf8");
  assert.doesNotMatch(source, /uploadToCloudinary|insertMedia|\.insert\(|\.delete\(|\.rpc\(|\bfetch\(|XMLHttpRequest|api\.cloudinary\.com/);
});

// ---------- Confirmation ----------

test("20-21. PROD requires the exact text PRODUCTION; DEV needs no typed text; unknown never confirms", () => {
  assert.equal(PRODUCTION_CONFIRMATION_TEXT, "PRODUCTION");
  assert.equal(confirmationSatisfied("production", "PRODUCTION"), true);
  for (const typed of ["", "production", "Production", "PRODUCTION ", " PRODUCTION", "PROD", "PRODUCTIO", "DEVELOPMENT"]) assert.equal(confirmationSatisfied("production", typed), false, typed);
  assert.equal(confirmationSatisfied("development", ""), true);
  assert.equal(confirmationSatisfied("development", "anything"), true);
  assert.equal(confirmationSatisfied(null, "PRODUCTION"), false);
  assert.equal(uploadWarning("production"), "This will write production media.");
  assert.match(uploadWarning("development"), /DEV/);
});

// ---------- UI ----------

test("22. the UI exposes exactly one action, labelled for the actual environment, and a typed confirmation only for production", async () => {
  const panel = await readFile("src/admin/BulkProductImages.tsx", "utf8");
  assert.match(panel, /const uploadTarget = resolveUploadTarget\(import\.meta\.env\.VITE_SUPABASE_URL, BUILD_MODE\)/);
  assert.match(panel, /const UPLOAD_LABEL = uploadTarget\.environment === "production" \? "PROD" : "DEV"/);
  assert.equal((panel.match(/Upload Selected Images to \$\{UPLOAD_LABEL\}/g) ?? []).length, 1, "one environment-labelled action");
  assert.doesNotMatch(panel, /Upload Selected Images to (DEV|PROD)(?!\w)(?!\})/, "no hard-coded second button");
  assert.match(panel, /uploadTarget\.allowed \? \(\s*<button[^>]*>[\s\S]*?Upload Selected Images to \$\{UPLOAD_LABEL\}[\s\S]*?\) : \(\s*<button type="button" className="admin-primary" disabled>\s*Upload unavailable/);
  assert.match(panel, /uploadTarget\.environment === "production" && \(\s*<label className="bulk-images-typed">/);
  assert.match(panel, /disabled=\{!confirmationSatisfied\(uploadTarget\.environment, typedConfirmation\)\}/);
  assert.match(panel, /runBulkPreflight\(/);
  assert.match(panel, /<div className="bulk-images-prod-banner">PRODUCTION<\/div>/);
  assert.doesNotMatch(panel, new RegExp(PROD_REF), "no project ref hard-coded in the UI");
  assert.doesNotMatch(panel, new RegExp(DEV_REF));
  const lib = await readFile("src/lib/bulkImageUpload.ts", "utf8");
  assert.doesNotMatch(lib, /\.delete\(|\.update\(|\.upsert\(|\.rpc\(|cloudinary-delete-media|is_published|product_variants|import\.meta\.env|service[_-]?role/);
});
