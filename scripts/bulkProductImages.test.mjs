import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  buildImageAssignmentPlan,
  imageFileStem,
  imageMatchKey,
  imageReviewKey,
  localImageSources,
  matchImageSources,
  summarizeImageMatches,
} from "../src/lib/productImageMatching.ts";
import { planPrimaryAssignment, productMediaPayload } from "../src/lib/productMediaPayload.ts";
import { parseShopifyProductsCsv, shopifyImageSources, shopifyImageUrlProblem } from "../src/lib/shopifyProductCsv.ts";
import { PROD_TITLES } from "./support/prodCatalogTitles.mjs";

const product = (title, extra = {}) => ({ id: imageMatchKey(title), title, brand: title.split(" ")[0], hasPrimary: false, ...extra });
const PRODUCTS = PROD_TITLES.map((title) => product(title));
const titleOf = (id, products = PRODUCTS) => products.find((entry) => entry.id === id)?.title ?? null;
const jpeg = (name, size = 200_000) => ({ name, type: "image/jpeg", size });
const matchFiles = (files, products = PRODUCTS) => matchImageSources(localImageSources(files), products);
const matchOne = (name, products) => matchFiles([jpeg(name)], products)[0];

test("fixture holds the 82 PROD products", () => {
  assert.equal(PRODUCTS.length, 82);
  assert.equal(new Set(PRODUCTS.map((entry) => entry.id)).size, 82);
});

test("1. Samsung-A07.jpg matches Samsung A07", () => {
  const row = matchOne("Samsung-A07.jpg");
  assert.equal(row.status, "matched");
  assert.equal(titleOf(row.productId), "Samsung A07");
  assert.equal(row.detectedBrand, "Samsung");
  assert.equal(row.detectedModel, "A07");
  assert.equal(row.defaultSelected, true);
});

test("2. Nothing-Phone-3A-Pro.jpg matches Nothing Phone 3A Pro, never 3A or 3A Lite", () => {
  const row = matchOne("Nothing-Phone-3A-Pro.jpg");
  assert.equal(row.status, "matched");
  assert.equal(titleOf(row.productId), "Nothing Phone 3A Pro");
  assert.equal(row.detectedModel, "Phone 3A Pro");
  assert.equal(titleOf(matchOne("Nothing Phone 3A.png").productId), "Nothing Phone 3A");
  assert.equal(titleOf(matchOne("nothing_phone_3a_lite.webp").productId), "Nothing Phone 3A Lite");
  assert.equal(titleOf(matchOne("Vivo-V70-FE.jpg").productId), "Vivo V70 FE");
});

test("3. spaces, hyphens, underscores, case and copy markers normalize consistently", () => {
  const names = ["Samsung A07.jpg", "Samsung-A07.jpg", "Samsung_A07.jpg", "samsung a07.JPG", "SAMSUNG__A07.jpeg", "Samsung-A07 (1).jpg", "Samsung A07 - Copy.jpg"];
  const keys = names.map((name) => imageMatchKey(imageFileStem(name)));
  assert.deepEqual(new Set(keys), new Set(["samsung-a07"]));
  for (const name of names) assert.equal(titleOf(matchOne(name).productId), "Samsung A07", name);
  // "+" and the word Plus are the same identity; the "+" is never dropped.
  assert.equal(titleOf(matchOne("Honor X5c+.jpg").productId), "Honor X5c+");
  assert.equal(titleOf(matchOne("Honor-X5c-Plus.jpg").productId), "Honor X5c+");
  assert.equal(titleOf(matchOne("Samsung-S26+.jpg").productId), "Samsung S26 Plus");
  assert.equal(titleOf(matchOne("itel_A200+.png").productId), "itel A200+");
  assert.equal(matchOne("itel-A200.png").status, "unmatched");
});

test("near-twin models never match each other", () => {
  const twins = {
    "Honor-X5c.jpg": "Honor X5c",
    "Xiaomi-Note-15-Pro.jpg": "Xiaomi Note 15 Pro",
    "Xiaomi-Note-15-Pro+.jpg": "Xiaomi Note 15 Pro+",
    "Oppo-A6.jpg": "Oppo A6",
    "Oppo-A6s.jpg": "Oppo A6s",
    "Realme-C100.jpg": "Realme C100",
    "Vivo-Y05.jpg": "Vivo Y05",
    "Oppo-Reno-16-5G.jpg": "Oppo Reno 16 5G",
    "Samsung-S26.jpg": "Samsung S26",
    "Nothing-Phone-1.jpg": "Nothing Phone 1",
  };
  for (const [name, title] of Object.entries(twins)) {
    const row = matchOne(name);
    assert.equal(row.status, "matched", name);
    assert.equal(titleOf(row.productId), title, name);
  }
  // A missing suffix is not "close enough": Phone 3 / Oppo A6x do not exist.
  assert.equal(matchOne("Nothing-Phone-3.jpg").status, "unmatched");
  assert.equal(matchOne("Oppo-A6x.jpg").status, "unmatched");
});

test("4. unknown filenames are Unmatched and not selected", () => {
  for (const name of ["Samsung-A99.jpg", "IMG_1234.jpg", "Samsung.jpg", "VgoTel-Onyx.jpg"]) {
    const row = matchOne(name);
    assert.equal(row.status, "unmatched", name);
    assert.equal(row.productId, null);
    assert.equal(row.defaultSelected, false);
  }
});

test("5. ambiguous or inferred matches go to Review, never auto-selected", () => {
  // Suggested match only after removing family / colour / storage / network words.
  for (const name of ["Samsung-Galaxy-A07.jpg", "Samsung A07 Black.jpg", "Samsung A07 4GB 64GB.jpg", "Samsung A07 (4GB-64GB).jpg", "Oppo Reno 15 Pro.jpg"]) {
    const row = matchOne(name);
    assert.equal(row.status, "review", name);
    assert.equal(row.defaultSelected, false, name);
  }
  assert.equal(titleOf(matchOne("Samsung-Galaxy-A07.jpg").productId), "Samsung A07");
  assert.equal(titleOf(matchOne("Oppo Reno 15 Pro.jpg").productId), "Oppo Reno 15 Pro 5G");
  // Two products reduce to the same key → Multiple, no product chosen.
  const withXiaomi15 = [...PRODUCTS, product("Xiaomi 15")];
  const row = matchOne("Xiaomi-Redmi-15-5G.jpg", withXiaomi15);
  assert.equal(row.status, "multiple");
  assert.equal(row.productId, null);
  assert.deepEqual(row.candidateProductIds.map((id) => titleOf(id, withXiaomi15)).sort(), ["Xiaomi 15", "Xiaomi Redmi 15"]);
  assert.equal(row.defaultSelected, false);
  // Identical exact keys on two products (e.g. a duplicate catalog entry) → Multiple.
  const duplicated = [...PRODUCTS, { ...product("Samsung A07"), id: "samsung-a07-duplicate" }];
  assert.equal(matchOne("Samsung-A07.jpg", duplicated).status, "multiple");
});

test("review-tier noise removal keeps model words and a model's own +", () => {
  assert.equal(imageReviewKey("Samsung Galaxy A07 8/256GB PTA Approved Black 5G"), "samsung-a07");
  assert.equal(imageReviewKey("Nothing Phone 3+ 128GB"), "nothing-phone-3-plus");
  assert.equal(imageReviewKey("Vivo V80 Lite 8+8GB"), "vivo-v80-lite");
  assert.equal(imageReviewKey("VgoTel New 16 Pro"), "vgotel-new-16-pro");
});

test("Samsung 'Z' and joined model tokens give Review suggestions only, never Matched", () => {
  const cases = {
    "Samsung Galaxy Z fold 5.jpg": "Samsung Fold 5",
    "Samsung-Galaxy-Z-Fold-6.jpg": "Samsung Fold 6",
    "Samsung Z Flip 6.png": "Samsung Flip 6",
    "Samsung Galaxy Z flip5.jpg": "Samsung Flip 5",
    "Samsung Galaxy Z fold 8 ultra.jpg": "Samsung Fold 8 Ultra",
    "Nothing Phone 2pro.jpg": "Nothing Phone 2 Pro",
    "Xiaomi 17Tpro.jpg": "Xiaomi 17T Pro",
    "Samsung Fold6.jpg": "Samsung Fold 6",
  };
  for (const [name, title] of Object.entries(cases)) {
    const row = matchOne(name);
    assert.equal(row.status, "review", name);
    assert.equal(titleOf(row.productId), title, name);
    assert.equal(row.defaultSelected, false, name);
  }
  assert.equal(imageReviewKey("Samsung Galaxy Z flip5"), "samsung-flip-5");
  assert.equal(imageReviewKey("Nothing Phone 2pro"), "nothing-phone-2-pro");
  // "Z" is only a Samsung family marker; elsewhere it is part of the model.
  assert.equal(imageReviewKey("Vivo Z 10"), "vivo-z-10");
  assert.equal(imageReviewKey("Infinix Zero 40"), "infinix-zero-40");
  // Exact keys are unchanged: joined tokens never become automatic matches.
  assert.equal(imageMatchKey("Nothing Phone 2pro"), "nothing-phone-2pro");
  // Splitting keeps near-twins apart.
  assert.equal(titleOf(matchOne("Nothing Phone 3Apro.jpg").productId), "Nothing Phone 3A Pro");
  assert.equal(matchOne("Nothing Phone 3Apro.jpg").status, "review");
  assert.equal(titleOf(matchOne("Oppo A6spro.jpg").productId), "Oppo A6s Pro");
  // Owner decision 2026-10-09: these stay manual / unmatched.
  assert.equal(matchOne("Oppo 16f 5g.jpg").status, "unmatched");
  assert.equal(matchOne("Tecno Spark GO 3.jpg").status, "unmatched");
});

test("6. unsupported or invalid files are rejected and cannot be planned", () => {
  const rows = matchFiles([
    { name: "Samsung-A07.gif", type: "image/gif", size: 1000 },
    { name: "Samsung-A17.pdf", type: "application/pdf", size: 1000 },
    { name: "Samsung-A27.jpg", type: "image/jpeg", size: 0 },
    { name: "Samsung-A37.png", type: "image/png", size: 26 * 1024 * 1024 },
    { name: "Samsung-A56.avif", type: "image/avif", size: 1000 },
  ]);
  assert.deepEqual(rows.map((row) => row.status), ["invalid", "invalid", "invalid", "invalid", "matched"]);
  assert.match(rows[0].reason, /JPEG, PNG, WebP, or AVIF/);
  assert.match(rows[2].reason, /empty/);
  assert.match(rows[3].reason, /25 MB/);
  assert.ok(rows.slice(0, 4).every((row) => !row.defaultSelected && row.productId === null));
  const plan = buildImageAssignmentPlan(rows, { [rows[0].sourceId]: { productId: "samsung-a07" } }, PRODUCTS);
  assert.equal(plan.items.length, 0);
  assert.equal(plan.problems.length, 1);
});

test("7. several files for one product are a Conflict until the Owner keeps one", () => {
  const rows = matchFiles([jpeg("Samsung-A07.jpg"), jpeg("Samsung_A07_back.jpg"), jpeg("Samsung A07 Black.jpg"), jpeg("Samsung-A17.jpg")]);
  assert.deepEqual(rows.map((row) => row.status), ["conflict", "unmatched", "conflict", "matched"]);
  assert.ok(rows.filter((row) => row.status === "conflict").every((row) => !row.defaultSelected && titleOf(row.productId) === "Samsung A07"));
  const both = buildImageAssignmentPlan(rows, {
    [rows[0].sourceId]: { productId: "samsung-a07" },
    [rows[2].sourceId]: { productId: "samsung-a07" },
  }, PRODUCTS);
  assert.equal(both.problems.length, 1);
  assert.match(both.problems[0], /more than one image selected/);
  const one = buildImageAssignmentPlan(rows, { [rows[0].sourceId]: { productId: "samsung-a07" }, [rows[3].sourceId]: { productId: "samsung-a17" } }, PRODUCTS);
  assert.deepEqual(one.problems, []);
  assert.deepEqual(one.items.map((item) => [item.productId, item.primaryMode]), [["samsung-a07", "primary"], ["samsung-a17", "primary"]]);
  // The Owner may assign an unmatched file manually.
  const manual = buildImageAssignmentPlan(rows, { [rows[1].sourceId]: { productId: "samsung-a07" } }, PRODUCTS);
  assert.deepEqual(manual.items.map((item) => item.productId), ["samsung-a07"]);
});

test("summary counts", () => {
  const rows = matchFiles([jpeg("Samsung-A07.jpg"), jpeg("Samsung-Galaxy-A17.jpg"), jpeg("Unknown.jpg"), { name: "x.gif", type: "image/gif", size: 5 }]);
  assert.deepEqual(summarizeImageMatches(rows), { total: 4, matched: 1, needsReview: 1, unmatched: 1, invalid: 1, readyToUpload: 1 });
  assert.equal(summarizeImageMatches(rows, [rows[0].sourceId, rows[1].sourceId, rows[3].sourceId]).readyToUpload, 2);
});

const PRODUCT_ID = "7d1c2b9e-4f1a-4c55-9d1e-0a6b3c2d1e0f";
const cloudinaryResult = {
  public_id: `isolutions-production/products/${PRODUCT_ID}/abc123`,
  asset_id: "f00dfeedcafe",
  version: 1791113359,
  secure_url: `https://res.cloudinary.com/demo/image/upload/v1791113359/isolutions-production/products/${PRODUCT_ID}/abc123.jpg`,
  width: 2000,
  height: 2000,
  bytes: 345678,
  format: "jpg",
  original_filename: "Samsung-A07",
};

test("8. Cloudinary upload result maps to the product_media payload", () => {
  const payload = productMediaPayload(cloudinaryResult, { productId: PRODUCT_ID, altText: " Samsung A07 ", sortOrder: 0, isPrimary: true });
  assert.deepEqual(payload, {
    product_id: PRODUCT_ID,
    variant_id: null,
    cloudinary_public_id: cloudinaryResult.public_id,
    cloudinary_asset_id: "f00dfeedcafe",
    cloudinary_version: 1791113359,
    secure_url: cloudinaryResult.secure_url,
    width: 2000,
    height: 2000,
    bytes: 345678,
    format: "jpg",
    alt_text: "Samsung A07",
    sort_order: 0,
    is_primary: true,
  });
  const target = { productId: PRODUCT_ID, altText: "Samsung A07", sortOrder: 0, isPrimary: true };
  assert.throws(() => productMediaPayload({ ...cloudinaryResult, public_id: "isolutions-production/products/other-product/abc" }, target), /media folder/);
  assert.throws(() => productMediaPayload({ ...cloudinaryResult, width: 0 }, target), /dimensions/);
  assert.throws(() => productMediaPayload({ ...cloudinaryResult, format: "gif" }, target), /unsupported image format/);
  assert.throws(() => productMediaPayload({ ...cloudinaryResult, secure_url: "http://example.com/a.jpg" }, target), /secure delivery URL/);
  assert.throws(() => productMediaPayload({ ...cloudinaryResult, public_id: `x/products/${PRODUCT_ID}/data:image/png;base64,AAAA` }, target), /Binary image data/);
  assert.throws(() => productMediaPayload(cloudinaryResult, { ...target, altText: "  " }), /Alt text/);
});

test("9. primary assignment: first image becomes primary; existing primary is skipped unless explicitly replaced", () => {
  assert.deepEqual(planPrimaryAssignment({ count: 0, hasPrimary: false }, "primary"), { action: "insert", isPrimary: true, sortOrder: 0, makePrimaryAfterInsert: false });
  assert.deepEqual(planPrimaryAssignment({ count: 2, hasPrimary: true }, "primary"), { action: "skip", reason: "Product already has a primary image." });
  assert.deepEqual(planPrimaryAssignment({ count: 2, hasPrimary: true }, "make_primary"), { action: "insert", isPrimary: false, sortOrder: 2, makePrimaryAfterInsert: true });

  const products = PRODUCTS.map((entry) => (entry.title === "Samsung A07" ? { ...entry, hasPrimary: true } : entry));
  const rows = matchFiles([jpeg("Samsung-A07.jpg")], products);
  assert.equal(rows[0].status, "matched");
  assert.equal(rows[0].productHasPrimary, true);
  assert.equal(rows[0].defaultSelected, false);
  const skipped = buildImageAssignmentPlan(rows, { [rows[0].sourceId]: { productId: "samsung-a07" } }, products);
  assert.deepEqual([skipped.items.length, skipped.skipped.length], [0, 1]);
  const replaced = buildImageAssignmentPlan(rows, { [rows[0].sourceId]: { productId: "samsung-a07", addAndMakePrimary: true } }, products);
  assert.deepEqual(replaced.items, [{ sourceId: rows[0].sourceId, productId: "samsung-a07", primaryMode: "make_primary" }]);
});

test("10. matching and review perform no I/O and do not mutate their inputs", async () => {
  for (const file of ["productImageMatching.ts", "shopifyProductCsv.ts", "productMediaPayload.ts"]) {
    const source = await readFile(`src/lib/${file}`, "utf8");
    assert.doesNotMatch(source, /supabase|fetch\(|XMLHttpRequest|\.insert\(|\.update\(|\.delete\(|\.rpc\(|\.from\(|functions\.invoke/, file);
  }
  const files = [jpeg("Samsung-A07.jpg"), jpeg("Samsung-Galaxy-A17.jpg")];
  const sources = localImageSources(files);
  const before = JSON.stringify([sources, PRODUCTS]);
  const rows = matchImageSources(sources, PRODUCTS);
  buildImageAssignmentPlan(rows, { [rows[0].sourceId]: { productId: rows[0].productId } }, PRODUCTS);
  assert.equal(JSON.stringify([sources, PRODUCTS]), before);
});

// ---------------- Shopify Products CSV ----------------

const SHOPIFY_HEADER = "Handle,Title,Body (HTML),Vendor,Type,Option1 Name,Option1 Value,Variant SKU,Variant Price,Image Src,Image Position,Image Alt Text,Variant Image,Status";
const cdn = (file) => `https://cdn.shopify.com/s/files/1/0001/0002/files/${file}?v=1712345678`;
const shopifyCsv = [
  String.fromCharCode(0xfeff) + SHOPIFY_HEADER,
  `samsung-galaxy-a07,Samsung Galaxy A07 (4GB/64GB),"<p>Great phone,</p>\n<p>second line</p>",Samsung,Mobile,Color,Black,SA07-B,32999,${cdn("a07-back.jpg")},2,Back,${cdn("a07-black-variant.jpg")},active`,
  `samsung-galaxy-a07,,,,,,Blue,SA07-L,32999,${cdn("a07-front.jpg")},1,Front,,`,
  `samsung-galaxy-a07,,,,,,,,,${cdn("a07-front.jpg")},1,Front,,`,
  `samsung-a17,Samsung A17,,iSolutions,Mobile,Title,Default Title,SA17,45999,${cdn("a17.png")},1,,,active`,
  `galaxy-s26-ultra,Galaxy S26 Ultra,,iSolutions,Mobile,Title,Default Title,S26U,399999,https://isolutions.pk/cdn/shop/files/s26u.webp?v=1,1,,,draft`,
  `vivo-v70-fe-8-256,Vivo V70 FE 8/256,,Vivo,Mobile,Title,Default Title,V70A,119500,${cdn("v70fe.jpg")},1,,,active`,
  `vivo-v70-fe-12-256,Vivo V70 FE 12/256,,Vivo,Mobile,Title,Default Title,V70B,137000,${cdn("v70fe-12.jpg")},1,,,active`,
  `nothing-phone-3a-pro,Phone 3A Pro,,Nothing,Mobile,Title,Default Title,N3AP,99999,${cdn("n3ap.jpg")},1,,,active`,
  `old-charger,Fast Charger,,Anker,Accessory,Title,Default Title,CH1,2999,,,,,archived`,
  `animated,Samsung A27,,Samsung,Mobile,Title,Default Title,A27,1,${cdn("a27.gif")},1,,,active`,
].join("\r\n");

test("Shopify CSV: rows grouped per Handle, first-row Title/Vendor, lowest Image Position is primary, variant images ignored", () => {
  const { products, errors, rowCount } = parseShopifyProductsCsv(shopifyCsv);
  assert.deepEqual(errors, []);
  assert.equal(rowCount, 10);
  assert.equal(products.length, 8);
  const a07 = products[0];
  assert.equal(a07.handle, "samsung-galaxy-a07");
  assert.equal(a07.title, "Samsung Galaxy A07 (4GB/64GB)");
  assert.equal(a07.vendor, "Samsung");
  assert.equal(a07.status, "active");
  assert.deepEqual(a07.images.map((image) => image.src), [cdn("a07-front.jpg"), cdn("a07-back.jpg")]);
  assert.equal(a07.primaryImage.src, cdn("a07-front.jpg"));
  assert.ok(!JSON.stringify(products).includes("a07-black-variant"));
  assert.equal(products.find((entry) => entry.handle === "old-charger").primaryImage, null);
});

test("Shopify CSV: non-Shopify exports are rejected with a clear error", () => {
  assert.match(parseShopifyProductsCsv("Name,Price\nA07,1").errors.join(" "), /Handle/);
  assert.deepEqual(parseShopifyProductsCsv("").errors, ["The CSV file is empty."]);
});

test("Shopify image URLs: https Shopify CDN JPEG/PNG/WebP/AVIF only", () => {
  assert.equal(shopifyImageUrlProblem(cdn("a.jpg")), null);
  assert.equal(shopifyImageUrlProblem("https://isolutions.pk/cdn/shop/products/a.PNG?v=2"), null);
  assert.match(shopifyImageUrlProblem("http://cdn.shopify.com/s/files/a.jpg"), /https/);
  assert.match(shopifyImageUrlProblem("https://example.com/images/a.jpg"), /Shopify CDN/);
  assert.match(shopifyImageUrlProblem(cdn("a.gif")), /JPEG, PNG, WebP or AVIF/);
  assert.match(shopifyImageUrlProblem("not a url"), /valid URL/);
});

test("Shopify products match iSolutions products; ambiguous and duplicate targets need review", () => {
  const brands = [...new Set(PRODUCTS.map((entry) => entry.brand))];
  const { products } = parseShopifyProductsCsv(shopifyCsv);
  const rows = matchImageSources(shopifyImageSources(products, brands), PRODUCTS);
  const byHandle = Object.fromEntries(rows.map((row) => [row.sourceId.replace("shopify:", ""), row]));
  // Storage in the title + "Galaxy" → suggested only.
  assert.equal(byHandle["samsung-galaxy-a07"].status, "review");
  assert.equal(titleOf(byHandle["samsung-galaxy-a07"].productId), "Samsung A07");
  // Exact title (store-name Vendor ignored).
  assert.equal(byHandle["samsung-a17"].status, "matched");
  assert.equal(byHandle["samsung-a17"].defaultSelected, true);
  // Brand inferred from "Galaxy" with a store-name Vendor → review, never matched.
  assert.equal(byHandle["galaxy-s26-ultra"].status, "review");
  assert.equal(titleOf(byHandle["galaxy-s26-ultra"].productId), "Samsung S26 Ultra");
  // Two Shopify products (per storage) for one iSolutions product → conflict.
  assert.equal(byHandle["vivo-v70-fe-8-256"].status, "conflict");
  assert.equal(byHandle["vivo-v70-fe-12-256"].status, "conflict");
  // Vendor supplies the brand the title omits → exact.
  assert.equal(byHandle["nothing-phone-3a-pro"].status, "matched");
  assert.equal(titleOf(byHandle["nothing-phone-3a-pro"].productId), "Nothing Phone 3A Pro");
  assert.equal(byHandle["old-charger"].status, "invalid");
  assert.match(byHandle["old-charger"].reason, /No product image/);
  assert.equal(byHandle.animated.status, "invalid");
  assert.ok(rows.filter((row) => row.status !== "matched").every((row) => !row.defaultSelected));
});
