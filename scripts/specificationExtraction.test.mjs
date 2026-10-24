import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { csvRows } from "../src/lib/bulkCatalog.ts";
import { SPECIFICATION_HEADERS, loadExcelJs } from "../src/lib/catalogWorkbook.ts";
import { emptyReview, parseShopifyReview, reviewSetStates, confirmAllReviewSuggestions, assignProduct } from "../src/lib/bulkProductImagesReview.ts";
import { extractSpecifications, htmlToText, parseShopifyDescriptions } from "../src/lib/productSpecificationExtraction.ts";
import {
  approveAllHighConfidence,
  approveProposal,
  approvalBlocker,
  approvedSpecificationRows,
  buildSpecReview,
  buildSpecificationsWorkbook,
  editProposalValue,
  rejectProposal,
  resolveConflict,
  reviewSummary,
} from "../src/lib/specificationReview.ts";

const extract = (html, extra = {}) => extractSpecifications({ productTitle: "Acme Phone 5", shopifyTitle: "Acme Phone 5", bodyHtml: html, ...extra });
const find = (result, name) => result.specs.find((spec) => spec.name === name);
const entry = (id, title, html, handle = id) => ({ productId: id, productTitle: title, productKey: id, handle, extraction: extract(html, { productTitle: title, shopifyTitle: title }) });

const FULL = `<p>📱 Acme Phone 5 — Everyday power</p>
<p>🖥️ 6.67-inch AMOLED Display</p><p>Smooth 120Hz refresh rate.</p>
<p>⚡ Powered by MediaTek Dimensity 7300 for fast apps.</p>
<p>🔋 5,000mAh Battery with 33W fast charging.</p>
<p>🤖 Runs Android 15 out of the box.</p>
<p>📡 NFC, Bluetooth 5.3 and 5G Connectivity.</p>
<p>📸 50MP main camera and 16MP front camera.</p>`;

test("1-6. direct chipset, battery, charging, screen size, refresh rate and OS extraction", () => {
  const result = extract(FULL);
  assert.equal(find(result, "Chipset").value, "MediaTek Dimensity 7300");
  assert.equal(find(result, "Battery Capacity").value, "5000 mAh");
  assert.equal(find(result, "Wired Charging").value, "33W");
  assert.equal(find(result, "Screen Size").value, "6.67 inches");
  assert.equal(find(result, "Refresh Rate").value, "120Hz");
  assert.equal(find(result, "Operating System").value, "Android 15");
  assert.equal(find(result, "Display Type").value, "AMOLED");
  assert.equal(find(result, "Main Camera").value, "50 MP");
  assert.equal(find(result, "Front Camera").value, "16 MP");
  assert.equal(find(result, "Bluetooth").value, "Bluetooth 5.3");
  assert.equal(find(result, "Network").value, "5G");
  assert.ok(result.specs.every((spec) => spec.confidence === "High" && spec.sourceType === "Shopify Body HTML"));
  // Sections follow the project's naming.
  assert.deepEqual([...new Set(result.specs.map((spec) => spec.section))].sort(), ["Battery", "Camera", "Connectivity", "Display", "Performance", "Software"]);
});

test("7. NFC is proposed only when the text states it, and a negation is not turned into support", () => {
  assert.equal(find(extract("<p>Includes NFC for contactless payments.</p>"), "NFC").value, "Supported");
  assert.equal(find(extract("<p>This model has no NFC and no GPS.</p>"), "NFC"), undefined);
  assert.equal(find(extract("<p>Sold without NFC.</p>"), "NFC"), undefined);
});

test("8-9. nothing is invented from absent fields, the model name or marketing prose", () => {
  const prose = "<p>📱 Samsung Galaxy A07 5G — Power Meets Performance</p><p>A stunning, powerful, blazing fast phone with an immersive display, a smooth experience and a long-lasting battery. Stylish design, great value.</p><p>✔ Brand New Box Pack</p>";
  const result = extract(prose, { productTitle: "Samsung A07", shopifyTitle: "Samsung Galaxy A07 5G" });
  assert.deepEqual(result.specs, [], "no field is stated, so none is proposed (the 5G in the product name is not a network statement)");
  assert.deepEqual(result.conflicts, []);
  // Model name alone never yields a chipset, size or camera.
  assert.deepEqual(extract("<p>Nothing Phone 4A Pro</p>", { productTitle: "Nothing Phone 4A Pro" }).specs, []);
  // RAM / storage are not duplicated into specifications.
  assert.equal(extract("<p>8GB RAM and 256GB storage.</p>").specs.length, 0);
});

test("10. the same value stated twice is de-duplicated", () => {
  const result = extract("<p>Big 5,000mAh battery.</p><p>All-day power from the 5000 mAh cell.</p>");
  assert.equal(result.specs.filter((spec) => spec.name === "Battery Capacity").length, 1);
  assert.equal(find(result, "Battery Capacity").value, "5000 mAh");
  assert.equal(result.conflicts.length, 0);
  const named = extract("<p>Powered by Dimensity 7100.</p><p>The MediaTek Dimensity 7100 chipset is efficient.</p>");
  assert.equal(find(named, "Chipset").value, "MediaTek Dimensity 7100", "the more specific wording subsumes the shorter one");
});

test("11. conflicting values in different sentences are flagged, never chosen", () => {
  const result = extract("<p>A 5,000mAh battery keeps you going.</p><p>Specs: battery 5,200mAh.</p>");
  assert.equal(find(result, "Battery Capacity"), undefined);
  assert.equal(result.conflicts.length, 1);
  assert.deepEqual(result.conflicts[0].alternatives.map((alt) => alt.value).sort(), ["5000 mAh", "5200 mAh"]);
  assert.ok(result.conflicts[0].alternatives.every((alt) => alt.evidence.length > 5));
  // Several values in ONE sentence are proposed together for review instead.
  const same = extract("<p>Expect a 6.5-inch or 6.6-inch display.</p>");
  assert.equal(find(same, "Screen Size").confidence, "Review");
});

test("12. every proposal carries source type, evidence and a confidence", () => {
  const result = extract(FULL);
  for (const spec of result.specs) {
    assert.ok(["Shopify Body HTML", "Shopify Metafield"].includes(spec.sourceType));
    assert.ok(spec.evidence.length > 3);
    assert.ok(["High", "Review"].includes(spec.confidence));
  }
  assert.match(find(result, "Battery Capacity").evidence, /5,000mAh Battery with 33W fast charging/);
  assert.doesNotMatch(find(result, "Battery Capacity").evidence, /[📱🔋⚡]/u, "pictographs are stripped from the quoted evidence");
  const meta = extractSpecifications({ productTitle: "Acme Phone 5", bodyHtml: "", metafields: { "Display technology": "amoled", "Ingress protection (IP) rating": "ip68", "Processor family": "mediatek-helio", Color: "red" } });
  assert.deepEqual(meta.specs.map((spec) => [spec.name, spec.value, spec.sourceType, spec.confidence]), [["Display Type", "AMOLED", "Shopify Metafield", "Review"], ["Protection", "IP68", "Shopify Metafield", "Review"]]);
  assert.match(meta.specs[0].evidence, /^Display technology: amoled$/);
  // Body and metafield agreeing is one proposal; disagreeing is a conflict.
  const agree = extractSpecifications({ productTitle: "Acme Phone 5", bodyHtml: "<p>Vivid AMOLED display.</p>", metafields: { "Display technology": "amoled" } });
  assert.equal(agree.specs.filter((spec) => spec.name === "Display Type").length, 1);
  const disagree = extractSpecifications({ productTitle: "Acme Phone 5", bodyHtml: "<p>Vivid AMOLED display.</p>", metafields: { "Display technology": "lcd" } });
  assert.equal(disagree.conflicts[0].name, "Display Type");
});

test("normalisation changes presentation, not meaning", () => {
  assert.equal(find(extract("<p>6.67 inch display</p>"), "Screen Size").value, "6.67 inches");
  assert.equal(find(extract("<p>Up to 144Hz refresh rate</p>"), "Refresh Rate").value, "up to 144Hz");
  assert.equal(find(extract("<p>90-120Hz adaptive display</p>"), "Refresh Rate").value, "90-120Hz");
  assert.equal(find(extract("<p>Snapdragon 7s Gen 3 processor</p>"), "Chipset").value, "Snapdragon 7s Gen 3");
  assert.equal(find(extract("<p>MediaTek Helio G99 Ultimate</p>"), "Chipset").value, "MediaTek Helio G99 Ultimate");
  assert.equal(find(extract("<p>Fast 45W charging</p>"), "Wired Charging").value, "45W");
  assert.equal(find(extract("<p>Bluetooth 5.x support</p>"), "Bluetooth"), undefined, "5.x is not a version");
  assert.equal(find(extract("<p>2160Hz PWM dimming</p>"), "Refresh Rate"), undefined);
  assert.equal(find(extract("<p>4.5G network support</p>"), "Network"), undefined);
  assert.equal(find(extract("<p>Android 16 with 7 years of updates up to Android 23</p>"), "Operating System").value, "Android 16");
  assert.equal(find(extract("<p>A big 6,000 mAh battery, far above the 5,000 mAh most phones cap at.</p>"), "Battery Capacity").value, "6000 mAh");
});

test("charging wattages are attributed to the nearest keyword; wireless / reverse are separate fields", () => {
  const r = extract("<p>45W wired charging, 15W wireless charging and 5W reverse charging.</p>");
  assert.equal(find(r, "Wired Charging").value, "45W");
  assert.equal(find(r, "Wireless Charging").value, "15W");
  assert.equal(find(r, "Reverse Charging").value, "5W");
  assert.ok(r.specs.every((spec) => spec.confidence === "High"));
  assert.equal(find(extract("<p>Charges at 30W.</p>"), "Wired Charging"), undefined, "no charging keyword -> nothing proposed");
});

test("camera lenses are only proposed when the MP number is tied to its lens", () => {
  const r = extract("<p>50MP Main (OIS) + 12MP Ultra-wide + 5MP Macro, 16MP Selfie.</p>");
  assert.equal(find(r, "Main Camera").value, "50 MP");
  assert.equal(find(r, "Ultrawide Camera").value, "12 MP");
  assert.equal(find(r, "Macro Camera").value, "5 MP");
  assert.equal(find(r, "Front Camera").value, "16 MP");
  const chain = extract("<p>Triple camera 50MP + 8MP + 2MP.</p>");
  assert.equal(find(chain, "Rear Camera Setup").value, "50 MP + 8 MP + 2 MP");
  assert.equal(find(chain, "Rear Camera Setup").confidence, "Review");
  assert.equal(find(extract("<p>Capture 48MP photos.</p>"), "Main Camera"), undefined);
});

test("htmlToText is safe and readable", () => {
  const text = htmlToText("<p>A &amp; B&nbsp;C</p><script>alert(1)</script><p>x<br>y</p><style>p{}</style>&#128241;");
  assert.equal(text.includes("alert"), false);
  assert.match(text, /A & B C\nx\ny/);
});

// ---------------- Source matching ----------------

const CATALOG = [
  { id: "a07", title: "Samsung A07", slug: "samsung-a07", brand: "Samsung", hasPrimary: true, mediaCount: 3 },
  { id: "a17", title: "Samsung A17", slug: "samsung-a17", brand: "Samsung", hasPrimary: true, mediaCount: 3 },
  { id: "x6", title: "Samsung Fold 8 Ultra", slug: "samsung-fold-8-ultra", brand: "Samsung", hasPrimary: true, mediaCount: 3 },
];
const CSV = [
  "Handle,Title,Body (HTML),Vendor,Status,Image Src,Image Position,Display technology (product.metafields.shopify.display-technology)",
  "samsung-a07,Samsung A07,<p>Powered by MediaTek Dimensity 6300. 50MP main camera.</p>,Samsung,active,https://cdn.shopify.com/a.jpg,1,amoled",
  "samsung-a17,Samsung A17,<p>Powered by Exynos 1330.</p>,Samsung,active,https://cdn.shopify.com/b.jpg,1,",
  "samsung-a17-copy,Samsung A17,<p>Powered by Exynos 9999.</p>,Samsung,active,https://cdn.shopify.com/c.jpg,1,",
  "untitled-fold,Samsung Galaxy Z fold 8 ultra,<p>5000mAh battery.</p>,Samsung,active,https://cdn.shopify.com/d.jpg,1,",
].join("\n");

function sourcesFor(review, catalog = CATALOG) {
  const descriptions = parseShopifyDescriptions(csvRows(CSV));
  const states = reviewSetStates(review, catalog);
  const out = [];
  for (const set of review.sets) {
    const state = states.get(set.setId);
    if (!state.targetId || !["matched", "confirmed"].includes(state.status)) continue;
    const d = descriptions.get(set.handle);
    const product = catalog.find((c) => c.id === state.targetId);
    out.push({ productId: product.id, productTitle: product.title, productKey: product.slug, handle: set.handle, extraction: extractSpecifications({ productTitle: product.title, shopifyTitle: d.title, bodyHtml: d.bodyHtml, metafields: d.metafields }) });
  }
  return out;
}

test("13-16. only Matched or Owner-Confirmed Shopify sources are extracted; Review, Multiple and Conflict wait", () => {
  const parsed = parseShopifyReview(emptyReview(), CSV, CATALOG);
  const states = reviewSetStates(parsed.review, CATALOG);
  const statusOf = (handle) => states.get(`shopify:${handle}`).status;
  assert.equal(statusOf("samsung-a07"), "matched");
  assert.equal(statusOf("samsung-a17"), "conflict");
  assert.equal(statusOf("samsung-a17-copy"), "conflict");
  const initial = sourcesFor(parsed.review);
  assert.deepEqual(initial.map((s) => s.productId), ["a07"], "Conflict sources and unmatched ones are not extracted");
  assert.equal(statusOf("untitled-fold"), "review");
  // Owner decisions make a source usable.
  const confirmed = confirmAllReviewSuggestions(parsed.review, CATALOG);
  assert.deepEqual(sourcesFor(confirmed.review).map((s) => s.productId).sort(), ["a07", "x6"]);
  // The metafield column of the handle is read.
  assert.equal(parseShopifyDescriptions(csvRows(CSV)).get("samsung-a07").metafields["Display technology"], "amoled");
});

test("a Multiple source (several candidate products) is not extracted until the Owner chooses a product", () => {
  const matchOf = (status, productId, candidates) => ({ sourceId: "s", label: "s", status, detectedBrand: "Honor", detectedModel: "X5C+", productId, candidateProductIds: candidates, productHasPrimary: false, defaultSelected: false, reason: "r" });
  const set = { setId: "shopify:honor-multi", sourceKind: "shopify", title: "Honor X5C+", handle: "honor-multi", shopifyStatus: "active", match: matchOf("multiple", null, ["a07", "a17"]), images: [{ id: "i", label: "i", previewUrl: null, sourceUrl: "https://cdn.shopify.com/x.jpg", sourcePosition: 1, invalidReason: null }] };
  const decision = { productId: null, confirmed: false, included: false, dismissed: null, existingMode: "skip", selectedImageIds: ["i"], primaryImageId: "i" };
  const review = { sets: [set], decisions: { [set.setId]: decision }, nextLocalId: 1 };
  assert.equal(reviewSetStates(review, CATALOG).get(set.setId).status, "multiple");
  const descriptions = parseShopifyDescriptions([["Handle", "Title", "Body (HTML)"], ["honor-multi", "Honor X5C+", "<p>Powered by Helio G81 Ultra.</p>"]]);
  const usable = review.sets.filter((s) => ["matched", "confirmed"].includes(reviewSetStates(review, CATALOG).get(s.setId).status));
  assert.equal(usable.length, 0, "nothing is extracted for it");
  assert.ok(descriptions.get("honor-multi").bodyHtml.includes("Helio"), "the text exists but is not used");
  // After the Owner chooses a product it becomes a usable, confirmed source.
  const chosen = assignProduct(review, set.setId, "a07", CATALOG);
  assert.equal(reviewSetStates(chosen, CATALOG).get(set.setId).status, "confirmed");
});

// ---------------- Review state ----------------

const sampleReview = () =>
  buildSpecReview([
    entry("p1", "Acme One", "<p>Powered by Snapdragon 7s Gen 3. 5,000mAh battery. 33W fast charging.</p><p>Expect a 6.5-inch or 6.6-inch display.</p><p>Battery 5,200mAh in the spec table.</p>"),
    entry("p2", "Acme Two", "<p>Marketing only. Smooth and powerful.</p>"),
  ]);

test("17-19. High-confidence bulk approval is safe: Review and Conflict rows are never approved", () => {
  const review = sampleReview();
  const byName = (r, name) => r.proposals.find((p) => p.name === name);
  assert.equal(byName(review, "Battery Capacity").status, "conflict");
  assert.equal(byName(review, "Screen Size").confidence, "Review");
  const next = approveAllHighConfidence(review);
  assert.equal(byName(next, "Chipset").status, "approved");
  assert.equal(byName(next, "Wired Charging").status, "approved");
  assert.equal(byName(next, "Screen Size").status, "proposed", "Review stays manual");
  assert.equal(byName(next, "Battery Capacity").status, "conflict", "Conflict stays manual");
  assert.ok(next.proposals.filter((p) => p.status === "approved").every((p) => p.confidence === "High"));
  // Per-product bulk approval only touches that product.
  const twoProducts = buildSpecReview([entry("p1", "Acme One", "<p>5,000mAh battery.</p>"), entry("p3", "Acme Three", "<p>6,000mAh battery.</p>")]);
  const onlyP3 = approveAllHighConfidence(twoProducts, "p3");
  assert.deepEqual(onlyP3.proposals.map((p) => [p.productId, p.status]), [["p1", "proposed"], ["p3", "approved"]]);
  // A single conflict cannot be approved directly.
  const conflictId = byName(review, "Battery Capacity").id;
  assert.equal(approveProposal(review, conflictId), review);
  assert.match(approvalBlocker(review, byName(review, "Battery Capacity")), /Conflict/);
});

test("20. an Owner edit is marked Owner Edited, keeps the original value and evidence, and needs approval again", () => {
  let review = approveAllHighConfidence(sampleReview());
  const id = review.proposals.find((p) => p.name === "Chipset").id;
  review = editProposalValue(review, id, "  Snapdragon 7s Gen 3 (4nm)  ");
  const row = review.proposals.find((p) => p.id === id);
  assert.equal(row.value, "Snapdragon 7s Gen 3 (4nm)");
  assert.equal(row.originalValue, "Snapdragon 7s Gen 3");
  assert.equal(row.ownerEdited, true);
  assert.equal(row.status, "proposed");
  assert.match(row.evidence, /Snapdragon 7s Gen 3/);
  assert.equal(editProposalValue(review, id, "   "), review, "an empty value is refused");
  assert.equal(editProposalValue(review, id, "Snapdragon 7s Gen 3").proposals.find((p) => p.id === id).ownerEdited, false, "editing back to the original clears the flag");
  // Resolving a conflict is an explicit Owner decision.
  const fresh = sampleReview();
  const conflict = fresh.proposals.find((p) => p.status === "conflict");
  const resolved = resolveConflict(fresh, conflict.id, 1).proposals.find((p) => p.id === conflict.id);
  assert.equal(resolved.status, "approved");
  assert.equal(resolved.ownerResolved, true);
  assert.equal(resolved.value, conflict.alternatives[1].value);
  assert.equal(rejectProposal(fresh, conflict.id).proposals.find((p) => p.id === conflict.id).status, "conflict");
});

test("21. a duplicate Section + Name for one product is blocked at approval and at export", () => {
  const review = buildSpecReview([entry("p1", "Acme One", "<p>5,000mAh battery.</p>")]);
  const row = review.proposals[0];
  const duplicate = { ...row, id: "dup", status: "approved" };
  const withDuplicate = { ...review, proposals: [{ ...row, status: "approved" }, duplicate] };
  assert.match(approvalBlocker({ ...review, proposals: [{ ...row, status: "approved" }, { ...duplicate, status: "proposed" }] }, { ...duplicate, status: "proposed" }), /already sets/);
  const exported = approvedSpecificationRows(withDuplicate);
  assert.ok(exported.errors.some((e) => /duplicate Battery \/ Battery Capacity/.test(e)));
});

test("22. the export uses exactly the importer's Specifications sheet format", async () => {
  const review = approveAllHighConfidence(sampleReview());
  const { rows, errors } = approvedSpecificationRows(review);
  assert.deepEqual(errors, []);
  assert.deepEqual(Object.keys(rows[0]), ["productKey", "section", "name", "value"]);
  assert.deepEqual(rows.map((r) => `${r.productKey}|${r.section}|${r.name}`), ["p1|Performance|Chipset", "p1|Battery|Wired Charging"]);
  const bytes = await buildSpecificationsWorkbook(rows);
  const ExcelJS = await loadExcelJs();
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(bytes);
  assert.deepEqual(workbook.worksheets.map((w) => w.name), ["Specifications"]);
  const sheet = workbook.getWorksheet("Specifications");
  assert.deepEqual(sheet.getRow(1).values.slice(1), [...SPECIFICATION_HEADERS]);
  assert.deepEqual(SPECIFICATION_HEADERS, ["Product Key", "Section", "Specification Name", "Specification Value"]);
  assert.equal(sheet.rowCount, rows.length + 1);
  assert.deepEqual(sheet.getRow(2).values.slice(1), [rows[0].productKey, rows[0].section, rows[0].name, rows[0].value]);
  // Only approved rows are exported; nothing proposed/rejected/conflicting leaks.
  const nothing = approvedSpecificationRows(sampleReview());
  assert.deepEqual(nothing.rows, []);
});

test("summary counts: targeted, matched, proposals, High / Review / Conflict, approved / rejected", () => {
  let review = sampleReview();
  const before = reviewSummary(review, 5, 2);
  assert.deepEqual([before.targetedProducts, before.safelyMatchedProducts, before.needingSourceReview, before.productsWithProposals, before.productsWithNoSpecs, before.conflicts, before.approved], [5, 2, 3, 1, 1, 1, 0]);
  assert.equal(before.high + before.review + before.conflicts, review.proposals.length);
  review = approveAllHighConfidence(review);
  const rejectedId = review.proposals.find((p) => p.name === "Screen Size").id;
  review = rejectProposal(review, rejectedId);
  const after = reviewSummary(review, 5, 2);
  assert.equal(after.approved, review.proposals.filter((p) => p.status === "approved").length);
  assert.equal(after.rejected, 1);
  assert.equal(after.productsWithApproved, 1);
});

// ---------------- No writes ----------------

test("23-24. the review/extraction libraries and the tool make zero database, media or workbook writes", async () => {
  const calls = [];
  const original = globalThis.fetch;
  globalThis.fetch = (...args) => (calls.push(args), Promise.reject(new Error("network blocked")));
  try {
    approveAllHighConfidence(sampleReview());
    await buildSpecificationsWorkbook([{ productKey: "p", section: "Display", name: "Screen Size", value: "6.7 inches" }]);
  } finally {
    globalThis.fetch = original;
  }
  assert.deepEqual(calls, []);
  for (const file of ["src/lib/productSpecificationExtraction.ts", "src/lib/specificationReview.ts"]) {
    const source = await readFile(file, "utf8");
    const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    assert.doesNotMatch(code, /supabase|\.from\(|\.insert\(|\.update\(|\.upsert\(|\.delete\(|\.rpc\(|\bfetch\(|XMLHttpRequest|cloudinary|product_media|writeFile/i, file);
  }
  const ui = await readFile("src/admin/SpecificationMigration.tsx", "utf8");
  assert.doesNotMatch(ui, /\.insert\(|\.update\(|\.upsert\(|\.delete\(|\.rpc\(|functions\.invoke|cloudinary|product_media|product_variants/i);
  assert.match(ui, /Legacy Shopify Specification Migration/);
  assert.match(ui, /one-time migration/i);
  assert.match(ui, /disabled=\{Boolean\(applyBlocker\)[\s\S]{0,300}Apply approved specifications/);
  assert.equal((ui.match(/\.from\(/g) ?? []).length, 1, "the only direct read is product_specifications (products come from the shared read-only loader)");
  // Removed from the Admin UI (Owner decision; Spec Upload replaces it): the component stays on disk, unmounted.
  const app = await readFile("src/admin/AdminApp.tsx", "utf8");
  assert.doesNotMatch(app, /<SpecificationMigration \/>/);
});

test("25. the current-spec read is a read-only select (no write verbs)", async () => {
  const ui = await readFile("src/admin/SpecificationMigration.tsx", "utf8");
  assert.match(ui, /\.from\("product_specifications"\)\s*\.select\(/);
  assert.doesNotMatch(ui, /from\("product_specifications"\)\s*\.(insert|update|upsert|delete)/);
});

// ---------------- Real export (skipped when the one-time export is not on this machine) ----------------

const REAL_ZIP = process.env.BULK_IMAGES_SHOPIFY_ZIP ?? "C:/Users/User/Downloads/products_export_1 (3).zip";
test("the real export extracts only directly stated, evidenced values", { skip: existsSync(REAL_ZIP) ? false : `export not found at ${REAL_ZIP}` }, async () => {
  const JSZip = (await import("jszip")).default;
  const zip = await JSZip.loadAsync(await readFile(REAL_ZIP));
  const text = await zip.file("products_export_1.csv").async("string");
  const descriptions = parseShopifyDescriptions(csvRows(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text));
  assert.ok(descriptions.size > 500);
  let proposals = 0;
  for (const [, d] of descriptions) {
    const result = extractSpecifications({ productTitle: d.title, shopifyTitle: d.title, bodyHtml: d.bodyHtml, metafields: d.metafields });
    for (const spec of result.specs) {
      proposals += 1;
      assert.ok(spec.evidence.length > 3 && spec.value.trim() && spec.section && spec.name);
    }
    const keys = result.specs.map((s) => `${s.section}|${s.name}`);
    assert.equal(new Set(keys).size, keys.length, "at most one proposal per spec per product");
  }
  assert.ok(proposals > 1000);
});
