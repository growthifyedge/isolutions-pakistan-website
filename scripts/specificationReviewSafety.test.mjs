import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { csvRows } from "../src/lib/bulkCatalog.ts";
import { chooseSourceSet, confirmAllReviewSuggestions, emptyReview, parseShopifyReview, skipSet } from "../src/lib/bulkProductImagesReview.ts";
import { htmlToText, extractSpecifications, parseShopifyDescriptions } from "../src/lib/productSpecificationExtraction.ts";
import { approveAllHighConfidence, buildSpecReview, approvedSpecificationRows } from "../src/lib/specificationReview.ts";
import { approveSafeReviewSpecs, classifyReviewProposal, otherProductNamed } from "../src/lib/specificationReviewSafety.ts";
import { imageMatchKey } from "../src/lib/productImageMatching.ts";
import { reviewSetStates } from "../src/lib/bulkProductImagesReview.ts";
import { PROD_TITLES } from "./support/prodCatalogTitles.mjs";

const proposal = (extra = {}) => ({
  id: "p|Display|Screen Size", productId: "p", productTitle: "Acme One", productKey: "acme-one", handle: "acme-one", section: "Display", name: "Screen Size", value: "6.7 inches", originalValue: "6.7 inches",
  confidence: "Review", sourceType: "Shopify Body HTML", evidence: "The Acme One has a 6.7-inch AMOLED display.", status: "proposed", ownerEdited: false, ownerResolved: false, alternatives: [], ...extra,
});
const ctx = (extra = {}) => ({ brand: "Acme", sourceText: "The Acme One is a phone. It has a nice display.", ...extra });
const verdict = (extra, context) => classifyReviewProposal(proposal(extra), ctx(context));

test("direct factual evidence is safe", () => {
  assert.deepEqual(verdict(), { safe: true });
  assert.deepEqual(verdict({ name: "Protection", section: "Build", value: "IP68, IP69", evidence: "IP68 & IP69 Water and Dust Resistance" }), { safe: true }, "'&' states both ratings");
  assert.deepEqual(verdict({ name: "Network", section: "Connectivity", value: "5G, 4G LTE", evidence: "Secure 5G/4G/LTE Long-term Network Usage" }), { safe: true });
  assert.deepEqual(verdict({ name: "Expandable Storage", section: "Other", value: "Supported", evidence: "Expandable Storage via microSD card (up to 1TB-2TB, depending on region)" }), { safe: true }, "a hedge that qualifies a different number does not block a boolean value");
  assert.deepEqual(verdict({ name: "Wired Charging", section: "Battery", value: "33W", evidence: "33W Fast Charging (reaches 50% in approximately 20 mins)" }), { safe: true });
  assert.deepEqual(verdict({ name: "Display Type", section: "Display", value: "AMOLED", evidence: "The 6.8-inch AMOLED screen curves around all four sides." }), { safe: true }, "'around' not attached to the value");
});

test("speculative wording blocks: expected, likely, anticipated, expect, may", () => {
  for (const word of ["is expected to offer", "is likely to offer", "is anticipated to offer", "so expect", "may offer"]) {
    const result = verdict({ evidence: `A 6.7-inch display ${word} a vivid panel.` });
    assert.equal(result.safe, false, word);
    assert.equal(result.category, "Speculative evidence", word);
  }
  assert.equal(verdict({ evidence: "It will launch with a 6.7-inch screen." }).category, "Speculative evidence");
});

test("a hedge directly on the number (typically / around) blocks a variant-dependent claim", () => {
  const typically = verdict({ name: "Battery Capacity", section: "Battery", value: "5000 mAh", evidence: "Typically 5,000 mAh in most markets." });
  assert.equal(typically.safe, false);
  assert.equal(typically.category, "Speculative evidence");
  assert.equal(verdict({ name: "Wired Charging", section: "Battery", value: "45W", evidence: "Around 45W fast charging." }).safe, false);
  const variant = verdict({ name: "Battery Capacity", section: "Battery", value: "6000 mAh", evidence: "6,000 mAh Battery in the 5G version (and typically 5,000 mAh in the 4G variant)." });
  assert.equal(variant.safe, false);
  assert.equal(variant.category, "Variant ambiguity");
  assert.equal(verdict({ name: "Network", section: "Connectivity", value: "5G, 4G LTE", evidence: "Available as a 5G version and a 4G variant." }).category, "Variant ambiguity");
});

test("'or' alternatives and rows carrying several values block", () => {
  for (const [value, evidence, name] of [["25W / 45W", "supported by 25W or upgraded 45W fast charging.", "Wired Charging"], ["IP67, IP68", "a build rated IP67 or IP68.", "Protection"], ["6.5 inches / 6.6 inches", "a 6.5-inch or 6.6-inch panel.", "Screen Size"]]) {
    const result = verdict({ value, evidence: `Built with ${evidence}`, name });
    assert.equal(result.safe, false, value);
    assert.equal(result.category, "Multiple possible values", value);
  }
  assert.equal(verdict({ value: "IP67, IP68", evidence: "Rated IP67 or IP68 depending on the build.", name: "Protection" }).category, "Multiple possible values");
});

test("evidence naming another product blocks, and so does a source that names one", () => {
  const evidence = verdict({ name: "Chipset", section: "Performance", value: "MediaTek Dimensity 7300 Pro", evidence: "The CMF Phone 2 Pro is powered by the MediaTek Dimensity 7300 Pro chipset." }, { brand: "Nothing" });
  assert.equal(evidence.safe, false);
  assert.equal(evidence.category, "Different product named in evidence");
  assert.match(evidence.detail, /CMF Phone/);
  const generic = verdict({ name: "Network", section: "Connectivity", value: "5G, 4G LTE", evidence: "Secure 5G/4G/LTE Long-term Network Usage" }, { brand: "Nothing", sourceText: "Nothing Phone 2 Pro. The CMF Phone 2 Pro is powered by a chip. Secure 5G/4G/LTE Long-term Network Usage." });
  assert.equal(generic.safe, false);
  assert.equal(generic.category, "Source contamination");
  // The product's own brand, same-maker sub-brands and component makers are not "another product".
  assert.equal(otherProductNamed("The Nothing Phone 3A Lite is great.", "Nothing"), null);
  assert.equal(otherProductNamed("The Redmi Note 15 and Xiaomi Poco X7.", "Xiaomi"), null);
  assert.equal(otherProductNamed("A Sony IMX896 sensor and a Samsung GN9 sensor.", "Nothing"), null);
  assert.equal(otherProductNamed("Better than the Samsung Galaxy S25.", "Oppo"), "Samsung Galaxy");
});

test("a forward-looking source (expect / likely / anticipated throughout) blocks even its plain-sounding sentences", () => {
  const source = "We expect a big phone. It is likely fast. The chip is anticipated to be new. A 5,000mAh battery.";
  const result = verdict({ name: "Battery Capacity", section: "Battery", value: "5000 mAh", evidence: "A 5,000mAh battery." }, { sourceText: source });
  assert.equal(result.safe, false);
  assert.equal(result.category, "Speculative evidence");
  assert.match(result.detail, /forward-looking/);
});

test("metafield-only, non-Review, conflict and empty rows are never safe", () => {
  assert.equal(verdict({ sourceType: "Shopify Metafield", evidence: "Display technology: amoled" }).category, "Manual review required");
  assert.equal(verdict({ confidence: "High" }).safe, false);
  assert.equal(verdict({ status: "conflict", alternatives: [{ value: "a", evidence: "x", sourceType: "Shopify Body HTML" }] }).safe, false);
  assert.equal(verdict({ value: "  " }).safe, false);
  assert.equal(verdict({ status: "approved" }).safe, false);
});

test("approveSafeReviewSpecs: approves only safe Review rows and leaves High, Conflict and rejected rows exactly as they were", () => {
  const entry = (id, title, html) => ({ productId: id, productTitle: title, productKey: id, handle: id, extraction: extractSpecifications({ productTitle: title, shopifyTitle: title, bodyHtml: html }) });
  const base = buildSpecReview([
    entry("a", "Acme One", "<p>Powered by MediaTek Dimensity 7300 Pro.</p><p>5,000mAh battery.</p><p>A 5,000mAh battery or a 5,200mAh battery.</p><p>Rated IP68 & IP69.</p>"),
    entry("b", "Acme Two", "<p>Expect a 6.6-inch AMOLED display.</p><p>Likely MediaTek Dimensity 9000 Pro.</p>"),
  ]);
  const highApproved = approveAllHighConfidence(base);
  const before = JSON.stringify(highApproved.proposals.filter((p) => p.status === "approved" || p.status === "conflict" || p.status === "rejected"));
  const result = approveSafeReviewSpecs(highApproved, (p) => ({ brand: "Acme", sourceText: htmlToText(p.handle === "a" ? "<p>Powered by MediaTek Dimensity 7300 Pro.</p>" : "<p>Expect a 6.6-inch AMOLED display. Likely MediaTek Dimensity 9000 Pro. We expect more. It is anticipated.</p>") }));
  assert.ok(result.approved >= 2, "the chipset and the IP rating of product a");
  const approvedNow = result.review.proposals.filter((p) => p.status === "approved");
  assert.ok(approvedNow.some((p) => p.productId === "a" && p.name === "Chipset"));
  assert.ok(approvedNow.some((p) => p.productId === "a" && p.name === "Protection"));
  assert.ok(!approvedNow.some((p) => p.productId === "b"), "speculative product b stays manual");
  assert.ok(result.blocked.every((b) => b.category && b.id));
  // Pre-existing approved / conflict rows are byte-for-byte untouched.
  const untouched = JSON.stringify(result.review.proposals.filter((p) => highApproved.proposals.find((o) => o.id === p.id && (o.status === "approved" || o.status === "conflict" || o.status === "rejected"))));
  assert.equal(untouched, before);
  assert.ok(result.review.proposals.filter((p) => p.status === "conflict").length >= 1, "the 5,000 / 5,200 mAh conflict is untouched");
  // No duplicate Section + Name and the export has one row per spec.
  const exported = approvedSpecificationRows(result.review);
  assert.deepEqual(exported.errors, []);
  const keys = exported.rows.map((r) => `${r.productKey}|${r.section}|${r.name}`);
  assert.equal(new Set(keys).size, keys.length);
  // Running it twice approves nothing new.
  assert.equal(approveSafeReviewSpecs(result.review, () => ({ brand: "Acme", sourceText: "" })).approved, 0);
});

test("a skipped / unresolved source has no proposals to approve", () => {
  const review = buildSpecReview([]);
  assert.deepEqual(approveSafeReviewSpecs(review, () => ctx()).blocked, []);
  assert.equal(approveSafeReviewSpecs(review, () => ctx()).approved, 0);
});

test("the review tool writes nothing: no database, spec insert, media or apply", async () => {
  for (const file of ["src/lib/specificationReviewSafety.ts"]) {
    const code = (await readFile(file, "utf8")).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    assert.doesNotMatch(code, /supabase|\.from\(|\.insert\(|\.update\(|\.upsert\(|\.delete\(|\.rpc\(|\bfetch\(|cloudinary|product_media|writeFile/i, file);
  }
  const ui = await readFile("src/admin/SpecificationMigration.tsx", "utf8");
  assert.doesNotMatch(ui, /\.insert\(|\.update\(|\.upsert\(|\.delete\(|\.rpc\(|functions\.invoke|cloudinary|product_media|product_variants/i);
  assert.match(ui, /Approve safe review specs \(\{safeReviewCount\}\)/);
  assert.match(ui, /Safe Review specs approved: \{safeResult\.approved\}/);
  assert.match(ui, /Review specs still unresolved/);
  assert.match(ui, /Conflict specs untouched/);
  assert.match(ui, /Wrong \/ speculative \/ ambiguous rows skipped/);
  assert.match(ui, /Manual: \$\{/);
  assert.match(ui, /disabled=\{Boolean\(applyBlocker\)/, "Apply approved specifications is gated by the preview / environment blocker");
});

// ---------------- Real export ----------------

const REAL_ZIP = process.env.BULK_IMAGES_SHOPIFY_ZIP ?? "C:/Users/User/Downloads/products_export_1 (3).zip";
const EXPECTED_SAFE = [
  "Honor X6c|Chipset|MediaTek Helio G81 Ultra", "Infinix GT 50 Pro|Wired Charging|45W", "Infinix GT 50 Pro|Wireless Charging|30W", "Motorola Edge 70 Fusion|Protection|IP68, IP69", "Nothing Phone 1|Network|5G, 4G LTE",
  "Nothing Phone 2A|Chipset|MediaTek Dimensity 7200 Pro", "Nothing Phone 3A Lite|Wired Charging|33W", "Nothing Phone 3A Lite|Network|5G, 4G LTE", "Nothing Phone 3A Lite|Chipset|MediaTek Dimensity 7300 Pro",
  "Nothing Phone 3A Pro|Network|5G, 4G LTE", "Oppo A6|Protection|IP69, IP68, IP66", "Oppo A6s|Protection|IP69, IP68, IP66", "Oppo A6s|Network|5G, 4G LTE", "Oppo A6s Pro|Chipset|MediaTek Helio G100 Max",
  "Oppo Reno 15 Pro 5G|Protection|IP69, IP68, IP66", "Oppo Reno 15 Pro 5G|SIM|Dual SIM, eSIM", "Realme 15 Pro 5G|Display Type|AMOLED", "Realme 15 Pro 5G|Screen Size|6.8 inches", "Samsung A07|Expandable Storage|Supported",
  "Samsung Fold 8 Ultra|Rear Camera Setup|200 MP + 50 MP + 10 MP", "Tecno Camon 50 Ultra|Protection|IP68, IP69", "Vivo V70 FE|Protection|IP68, IP69", "Vivo X300 FE|Protection|IP68, IP69", "Vivo Y500|Protection|IP68, IP69",
  "Xiaomi 17T|Chipset|MediaTek Dimensity 8500 Ultra", "Xiaomi Note 15|Expandable Storage|Supported",
];

test("the Owner's real review state (917 High / 47 Review / 10 Conflict) classifies exactly as 26 safe + 21 manual", { skip: existsSync(REAL_ZIP) ? false : `export not found at ${REAL_ZIP}` }, async () => {
  const JSZip = (await import("jszip")).default;
  const zip = await JSZip.loadAsync(await readFile(REAL_ZIP));
  const text = await zip.file("products_export_1.csv").async("string");
  const catalog = PROD_TITLES.map((title) => ({ id: imageMatchKey(title), title, slug: imageMatchKey(title), brand: title.split(" ")[0], hasPrimary: true, mediaCount: 3 }));
  const descriptions = parseShopifyDescriptions(csvRows(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text));
  let review = confirmAllReviewSuggestions(parseShopifyReview(emptyReview(), text, catalog).review, catalog).review;
  for (const handle of ["nothing-phone-3a-pro", "tecno-spark-51", "realme-15-pro-5g", "samsung-s23-ultra"]) review = chooseSourceSet(review, `shopify:${handle}`, catalog);
  review = skipSet(review, "shopify:honor-x5c");
  const states = reviewSetStates(review, catalog);
  const entries = [];
  for (const set of review.sets) {
    const st = states.get(set.setId);
    const product = st.targetId && catalog.find((c) => c.id === st.targetId);
    if (!product || !["matched", "confirmed"].includes(st.status)) continue;
    const d = descriptions.get(set.handle);
    entries.push({ productId: product.id, productTitle: product.title, productKey: product.slug, handle: set.handle, extraction: extractSpecifications({ productTitle: product.title, shopifyTitle: d.title, bodyHtml: d.bodyHtml, metafields: d.metafields }) });
  }
  const high = approveAllHighConfidence(buildSpecReview(entries));
  assert.equal(high.proposals.filter((p) => p.status === "approved").length, 917);
  const reviewRows = high.proposals.filter((p) => p.confidence === "Review" && p.status === "proposed");
  const conflictRows = high.proposals.filter((p) => p.status === "conflict");
  assert.equal(reviewRows.length, 47);
  assert.equal(conflictRows.length, 10);
  const brandOf = (id) => catalog.find((c) => c.id === id).brand;
  const result = approveSafeReviewSpecs(high, (p) => ({ brand: brandOf(p.productId), sourceText: htmlToText(descriptions.get(p.handle).bodyHtml) }));
  const approvedReview = result.review.proposals.filter((p) => p.confidence === "Review" && p.status === "approved").map((p) => `${p.productTitle}|${p.name}|${p.value}`).sort();
  assert.deepEqual(approvedReview, [...EXPECTED_SAFE].sort());
  assert.equal(result.approved, 26);
  assert.equal(result.blocked.length, 21);
  const manual = result.review.proposals.filter((p) => p.confidence === "Review" && p.status === "proposed");
  assert.equal(manual.length, 21);
  const manualTitles = manual.map((p) => `${p.productTitle}`);
  assert.equal(manualTitles.filter((t) => t === "Samsung A57").length, 9);
  assert.equal(manualTitles.filter((t) => t === "Samsung A37").length, 8);
  assert.equal(manualTitles.filter((t) => t === "Samsung A07").length, 2);
  assert.equal(manualTitles.filter((t) => t === "Nothing Phone 2 Pro").length, 2);
  const category = (title, name) => result.blocked.find((b) => b.id === manual.find((p) => p.productTitle === title && p.name === name).id).category;
  assert.equal(category("Nothing Phone 2 Pro", "Chipset"), "Different product named in evidence");
  assert.equal(category("Nothing Phone 2 Pro", "Network"), "Source contamination");
  assert.equal(category("Samsung A07", "Battery Capacity"), "Variant ambiguity");
  assert.equal(category("Samsung A07", "Network"), "Variant ambiguity");
  assert.equal(category("Samsung A57", "Wired Charging"), "Multiple possible values");
  assert.equal(category("Samsung A37", "Battery Capacity"), "Speculative evidence");
  // The 917 High rows and the 10 Conflict rows are untouched.
  assert.equal(result.review.proposals.filter((p) => p.confidence === "High" && p.status === "approved").length, 917);
  assert.equal(result.review.proposals.filter((p) => p.status === "conflict").length, 10);
  assert.ok(result.review.proposals.every((p) => p.status !== "rejected"));
  assert.deepEqual(approvedSpecificationRows(result.review).errors, []);
  assert.equal(approvedSpecificationRows(result.review).rows.length, 917 + 26);
});
