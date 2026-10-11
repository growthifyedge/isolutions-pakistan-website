import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  approvedFingerprint,
  planSpecificationApply,
  runSpecificationApply,
  selectApprovedRows,
  specApplyBlocker,
  specApplyConfirmationPhrase,
  specApplyConfirmationSatisfied,
  specApplyWriteCount,
  verifySpecificationWrite,
} from "../src/lib/specificationApply.ts";

const PROD_URL = "https://nlxfwppywxumymbjkvwt.supabase.co";
const DEV_URL = "https://acwatgxkcyrdxpcljxjb.supabase.co";

const proposal = (over = {}) => ({
  id: `${over.productId ?? "p1"}|${over.section ?? "Display"}|${over.name ?? "Screen Size"}`,
  productId: "p1",
  productTitle: "Phone One",
  productKey: "phone-one",
  handle: "phone-one-shopify",
  section: "Display",
  name: "Screen Size",
  value: "6.7 inches",
  originalValue: "6.7 inches",
  confidence: "High",
  sourceType: "Body HTML",
  evidence: "6.7 inch display",
  status: "approved",
  ownerEdited: false,
  ownerResolved: false,
  alternatives: [],
  ...over,
});
const review = (...proposals) => ({ proposals, productsWithoutSpecs: [] });
const catalog = [
  { id: "p1", slug: "phone-one", title: "Phone One" },
  { id: "p2", slug: "phone-two", title: "Phone Two" },
];
const rowsOf = (...proposals) => selectApprovedRows(review(...proposals)).rows;

// ---------------- Selection ----------------

test("1-6. only Approved rows are selected; Review, Conflict, Rejected, Proposed and skipped sources are excluded", () => {
  const base = review(
    proposal(),
    proposal({ name: "Display Type", value: "AMOLED", status: "proposed", confidence: "Review" }),
    proposal({ name: "Refresh Rate", value: "", status: "conflict", confidence: "Review", alternatives: [{ value: "90 Hz", evidence: "a", sourceType: "Body HTML" }, { value: "120 Hz", evidence: "b", sourceType: "Body HTML" }] }),
    proposal({ name: "Brightness", value: "800 nits", status: "rejected" }),
    proposal({ name: "Resolution", value: "FHD+", status: "proposed" }),
  );
  const picked = selectApprovedRows(base);
  assert.deepEqual(picked.rows.map((row) => row.name), ["Screen Size"]);
  assert.deepEqual(picked.excluded, { review: 1, conflict: 1, rejected: 1, proposed: 1, skippedSource: 0 });
  // A skipped / unresolved source: the product has no chosen handle, so its approved row can never be applied.
  const skipped = selectApprovedRows(review(proposal({ handle: "honor-x5c" })), new Map());
  assert.equal(skipped.rows.length, 0);
  assert.equal(skipped.excluded.skippedSource, 1);
  const wrongSource = selectApprovedRows(review(proposal({ handle: "other-handle" })), new Map([["p1", "phone-one-shopify"]]));
  assert.equal(wrongSource.rows.length, 0);
  const chosen = selectApprovedRows(review(proposal()), new Map([["p1", "phone-one-shopify"]]));
  assert.equal(chosen.rows.length, 1);
});

// ---------------- Mapping / validity / duplicates ----------------

test("7. an exact single catalog product match is required", () => {
  const ok = planSpecificationApply(rowsOf(proposal()), catalog, []);
  assert.equal(ok.totals.blocked, 0);
  const wrongKey = planSpecificationApply(rowsOf(proposal({ productKey: "phone-1" })), catalog, []);
  assert.equal(wrongKey.entries[0].kind, "blocked");
  assert.match(wrongKey.entries[0].blockers.join(" "), /does not match the catalog product/);
  const unknown = planSpecificationApply(rowsOf(proposal({ productId: "ghost" })), catalog, []);
  assert.equal(unknown.entries[0].kind, "blocked");
  assert.equal(unknown.totals.mappingFailures, 1);
  const ambiguous = planSpecificationApply(rowsOf(proposal()), [...catalog, { id: "p9", slug: "phone-one", title: "Phone One (copy)" }], []);
  assert.equal(ambiguous.entries[0].kind, "blocked");
  assert.match(ambiguous.entries[0].blockers.join(" "), /matches 2 catalog products/);
  const outsideBatch = planSpecificationApply(rowsOf(proposal()), catalog, [], new Set(["p2"]));
  assert.equal(outsideBatch.entries[0].kind, "blocked");
  assert.match(outsideBatch.entries[0].blockers.join(" "), /not part of the imported Android batch/);
});

test("invalid rows are blocked (section, name, value, length, control characters)", () => {
  const plan = planSpecificationApply(
    rowsOf(
      proposal({ section: "Gadgets", name: "A" }),
      proposal({ name: "Blank", value: "   " }),
      proposal({ name: "", value: "x" }),
      proposal({ name: "Long", value: "x".repeat(601) }),
      proposal({ name: "Ctl", value: "a\u0001b" }),
    ),
    catalog,
    [],
  );
  assert.equal(plan.totals.blocked, 5);
  assert.equal(plan.totals.invalidRows, 5);
  assert.equal(plan.totals.create, 0);
});

test("8. duplicates of Product + Section + Name are never written twice", () => {
  const identical = planSpecificationApply(rowsOf(proposal(), proposal({ id: "dup" })), catalog, []);
  assert.equal(identical.totals.create, 1);
  assert.equal(identical.totals.duplicates, 1);
  assert.equal(identical.totals.blocked, 1);
  const differing = planSpecificationApply(rowsOf(proposal(), proposal({ id: "dup2", value: "6.8 inches" })), catalog, []);
  assert.equal(differing.totals.duplicates, 1);
  assert.match(differing.entries.find((entry) => entry.kind === "blocked").blockers.join(" "), /different value/);
  const caseVariant = planSpecificationApply(rowsOf(proposal(), proposal({ id: "dup3", name: "screen size" })), catalog, []);
  assert.equal(caseVariant.totals.duplicates, 1);
});

// ---------------- Classification ----------------

const stored = (over = {}) => ({ id: "s1", product_id: "p1", specification_group: "Display", label: "Screen Size", value: "6.7 inches", sort_order: 0, ...over });

test("9-12. Create / Update / Unchanged / Blocked classification", () => {
  const rows = rowsOf(proposal(), proposal({ name: "Display Type", value: "AMOLED" }), proposal({ name: "Refresh Rate", value: "120 Hz" }), proposal({ productId: "p2", productKey: "phone-two", productTitle: "Phone Two", name: "Chipset", section: "Performance", value: "Dimensity 7300" }));
  const existing = [stored(), stored({ id: "s2", label: "Display Type", value: "LCD", sort_order: 1 })];
  const plan = planSpecificationApply(rows, catalog, existing);
  const kind = (name, productId = "p1") => plan.entries.find((entry) => entry.productId === productId && entry.name === name).kind;
  assert.equal(kind("Screen Size"), "unchanged");
  assert.equal(kind("Display Type"), "update");
  assert.equal(kind("Refresh Rate"), "create");
  assert.equal(kind("Chipset", "p2"), "create");
  assert.deepEqual({ ...plan.totals }, { approvedRows: 4, productsAffected: 2, create: 2, update: 1, unchanged: 1, blocked: 0, duplicates: 0, mappingFailures: 0, invalidRows: 0 });
  // New rows are appended after the existing ones.
  assert.equal(plan.entries.find((entry) => entry.name === "Refresh Rate").sortOrder, 2);
  // Case/spacing variants of a stored row are blocked, not overwritten.
  const variant = planSpecificationApply(rowsOf(proposal({ name: "screen  size" })), catalog, existing);
  assert.equal(variant.entries[0].kind, "blocked");
  // Stored rows that are not approved are not part of the plan at all (never deleted).
  assert.equal(planSpecificationApply(rowsOf(proposal({ name: "Display Type", value: "AMOLED" })), catalog, existing).entries.length, 1);
  // 0 stored rows => every valid approved row is a Create.
  const empty = planSpecificationApply(rows, catalog, []);
  assert.equal(empty.totals.create, 4);
  assert.equal(empty.totals.productsAffected, 2);
});

// ---------------- Environment / confirmation ----------------

test("13. PRODUCTION-only guard, typed confirmation, stale-preview and blocked gating", () => {
  const plan = planSpecificationApply(rowsOf(proposal()), catalog, []);
  const fingerprint = plan.fingerprint;
  assert.equal(specApplyBlocker({ environment: "production", allowed: true, plan, currentFingerprint: fingerprint }), null);
  assert.match(specApplyBlocker({ environment: "development", allowed: true, plan, currentFingerprint: fingerprint }), /PRODUCTION/);
  assert.match(specApplyBlocker({ environment: null, allowed: false, plan, currentFingerprint: fingerprint }), /PRODUCTION/);
  assert.match(specApplyBlocker({ environment: "production", allowed: false, plan, currentFingerprint: fingerprint }), /PRODUCTION/);
  assert.match(specApplyBlocker({ environment: "production", allowed: true, plan: null, currentFingerprint: fingerprint }), /preview first/);
  assert.match(specApplyBlocker({ environment: "production", allowed: true, plan, currentFingerprint: "changed" }), /changed since the preview/);
  const blockedPlan = planSpecificationApply(rowsOf(proposal({ productKey: "nope" })), catalog, []);
  assert.match(specApplyBlocker({ environment: "production", allowed: true, plan: blockedPlan, currentFingerprint: blockedPlan.fingerprint }), /Blocked/);
  const nothing = planSpecificationApply(rowsOf(proposal()), catalog, [stored()]);
  assert.match(specApplyBlocker({ environment: "production", allowed: true, plan: nothing, currentFingerprint: nothing.fingerprint }), /Nothing to write/);
  assert.equal(specApplyConfirmationPhrase(943), "APPLY 943 SPECS");
  assert.equal(specApplyConfirmationSatisfied("production", "APPLY 943 SPECS", 943), true);
  assert.equal(specApplyConfirmationSatisfied("production", "apply 943 specs", 943), false);
  assert.equal(specApplyConfirmationSatisfied("production", "APPLY 942 SPECS", 943), false);
  assert.equal(specApplyConfirmationSatisfied("development", "APPLY 943 SPECS", 943), false);
  assert.equal(specApplyConfirmationSatisfied(null, "APPLY 943 SPECS", 943), false);
  // Any change to the approved set changes the fingerprint.
  assert.notEqual(approvedFingerprint(rowsOf(proposal())), approvedFingerprint(rowsOf(proposal({ value: "6.8 inches" }))));
  assert.equal(approvedFingerprint(rowsOf(proposal(), proposal({ name: "Display Type", value: "AMOLED" }))), approvedFingerprint(rowsOf(proposal({ name: "Display Type", value: "AMOLED" }), proposal())));
});

// ---------------- In-memory database ----------------

function fakeDb({ specs = [], failInsertFor = new Set(), failUpdateIds = new Set(), corrupt = {} } = {}) {
  const state = { specs: specs.map((spec) => ({ ...spec })), products: { p1: { id: "p1", title: "Phone One", slug: "phone-one", publication_status: "published", updated_at: "t0" }, p2: { id: "p2", title: "Phone Two", slug: "phone-two", publication_status: "published", updated_at: "t0" } }, ops: [], next: 100 };
  const deps = {
    supabaseUrl: PROD_URL,
    buildMode: "production",
    catalog,
    readSpecs: async (productId) => state.specs.filter((spec) => spec.product_id === productId).map((spec) => ({ ...spec })),
    readProduct: async (productId) => ({ ...state.products[productId] }),
    readSnapshot: async () => ({ variants: [], mediaCount: 0, stockRows: 0, stockSum: 0 }),
    insertSpecs: async (productId, rows) => {
      state.ops.push({ op: "insert", table: "product_specifications", productId, count: rows.length });
      if (failInsertFor.has(productId)) throw new Error("insert rejected");
      for (const row of rows) if (!corrupt.dropInsert) state.specs.push({ id: `n${state.next++}`, product_id: productId, ...(corrupt.mangleValue ? { ...row, value: `${row.value}!` } : row) });
      if (corrupt.touchProduct) state.products[productId].updated_at = "t1";
      if (corrupt.alterOther) state.specs.find((spec) => spec.id === corrupt.alterOther).value = "tampered";
    },
    updateSpecValue: async (id, value) => {
      state.ops.push({ op: "update", table: "product_specifications", id, fields: ["value"] });
      if (failUpdateIds.has(id)) throw new Error("update rejected");
      state.specs.find((spec) => spec.id === id).value = value;
    },
  };
  return { state, deps };
}

const approvedBoth = () =>
  rowsOf(proposal(), proposal({ name: "Display Type", value: "AMOLED" }), proposal({ productId: "p2", productKey: "phone-two", productTitle: "Phone Two", name: "Chipset", section: "Performance", value: "Dimensity 7300" }));

test("14. the preview performs no writes at all", async () => {
  const { state } = fakeDb();
  planSpecificationApply(approvedBoth(), catalog, state.specs);
  assert.deepEqual(state.ops, []);
  const db = await readFile("src/lib/specificationApplyDb.ts", "utf8");
  const loaders = db.slice(0, db.indexOf("export function specificationApplyDbDeps")).replace(/\/\*[\s\S]*?\*\//g, "");
  assert.doesNotMatch(loaders, /\.insert\(|\.update\(|\.upsert\(|\.delete\(|\.rpc\(/);
  const ui = await readFile("src/admin/SpecificationMigration.tsx", "utf8");
  const previewFn = ui.slice(ui.indexOf("async function previewApply"), ui.indexOf("async function applySpecifications"));
  assert.doesNotMatch(previewFn, /runSpecificationApply|specificationApplyDbDeps|\.insert\(|\.update\(/);
});

test("15. a PRODUCTION apply writes only specification rows, creates and updates only", async () => {
  const { state, deps } = fakeDb({ specs: [{ id: "s2", product_id: "p1", specification_group: "Display", label: "Display Type", value: "LCD", sort_order: 0 }, { id: "keep", product_id: "p1", specification_group: "Camera", label: "Front Camera", value: "16 MP", sort_order: 1 }] });
  const plan = planSpecificationApply(approvedBoth(), catalog, state.specs);
  assert.equal(specApplyWriteCount(plan), 3);
  const result = await runSpecificationApply(plan, deps);
  assert.equal(result.outcome, "verified");
  assert.deepEqual(result.summary, { products: 2, verified: 2, unchanged: 0, blocked: 0, failed: 0, rowsWritten: 3, rowsFailed: 0 });
  assert.ok(state.ops.every((operation) => operation.table === "product_specifications" && (operation.op === "insert" || (operation.op === "update" && operation.fields.join() === "value"))));
  assert.equal(state.ops.filter((operation) => operation.op === "insert").length, 2);
  assert.equal(state.ops.filter((operation) => operation.op === "update").length, 1);
  assert.equal(state.specs.find((spec) => spec.id === "s2").value, "AMOLED");
  assert.equal(state.specs.find((spec) => spec.id === "keep").value, "16 MP", "unrelated rows stay");
  assert.equal(state.specs.length, 4);
  assert.deepEqual(state.products.p1, { id: "p1", title: "Phone One", slug: "phone-one", publication_status: "published", updated_at: "t0" });
  // A second run is a no-op: everything is Unchanged.
  const again = planSpecificationApply(approvedBoth(), catalog, state.specs);
  assert.equal(specApplyWriteCount(again), 0);
  const before = state.ops.length;
  assert.equal((await runSpecificationApply(again, deps)).summary.products, 0);
  assert.equal(state.ops.length, before);
  // Source-level scope: the adapters only insert / update(value) on product_specifications.
  const db = (await readFile("src/lib/specificationApplyDb.ts", "utf8")).replace(/\/\*[\s\S]*?\*\//g, "");
  assert.doesNotMatch(db, /\.delete\(|\.upsert\(|\.rpc\(|storage|functions\.invoke|cloudinary/i);
  const writes = [...db.matchAll(/client\s*\.from\("([a-z_]+)"\)\s*\.(insert|update)\(/g)].map((match) => `${match[1]}.${match[2]}`);
  assert.deepEqual(writes.sort(), ["product_specifications.insert", "product_specifications.update"]);
  assert.match(db, /\.update\(\{ value \}\)/);
  const lib = (await readFile("src/lib/specificationApply.ts", "utf8")).replace(/\/\*[\s\S]*?\*\//g, "");
  assert.doesNotMatch(lib, /\.delete\(|\.upsert\(|\.rpc\(|product_media|product_variants|publication_status\s*:/);
});

test("13b. the write loop itself refuses DEVELOPMENT, unknown projects and mode mismatches, and Blocked plans", async () => {
  const plan = planSpecificationApply(rowsOf(proposal()), catalog, []);
  for (const [supabaseUrl, buildMode] of [[DEV_URL, "development"], [PROD_URL, "development"], [DEV_URL, "production"], ["https://example.supabase.co", "production"], [undefined, "production"]]) {
    const { state, deps } = fakeDb();
    const result = await runSpecificationApply(plan, { ...deps, supabaseUrl, buildMode });
    assert.equal(result.outcome, "blocked", `${supabaseUrl} ${buildMode}`);
    assert.deepEqual(state.ops, []);
  }
  const blockedPlan = planSpecificationApply(rowsOf(proposal(), proposal({ id: "d", name: "Display Type", value: "x", productKey: "wrong" })), catalog, []);
  const { state, deps } = fakeDb();
  const result = await runSpecificationApply(blockedPlan, deps);
  assert.equal(result.outcome, "blocked");
  assert.deepEqual(state.ops, [], "a Blocked row stops everything");
});

test("a product that changed since the preview is blocked, not written", async () => {
  const { state, deps } = fakeDb();
  const plan = planSpecificationApply(approvedBoth(), catalog, []);
  state.specs.push({ id: "late", product_id: "p1", specification_group: "Display", label: "Screen Size", value: "6.7 inches", sort_order: 0 });
  const result = await runSpecificationApply(plan, deps);
  const p1 = result.products.find((product) => product.productId === "p1");
  assert.equal(p1.status, "blocked");
  assert.match(p1.message, /changed since the preview/);
  assert.equal(state.specs.filter((spec) => spec.product_id === "p1").length, 1, "nothing was written for the changed product");
  assert.equal(result.products.find((product) => product.productId === "p2").status, "verified", "other products continue");
  assert.equal(result.outcome, "issues");
});

test("partial failures are reported per row and per product; success is never claimed", async () => {
  const { state, deps } = fakeDb({ failInsertFor: new Set(["p2"]), specs: [{ id: "u1", product_id: "p1", specification_group: "Display", label: "Display Type", value: "LCD", sort_order: 0 }], failUpdateIds: new Set(["u1"]) });
  const plan = planSpecificationApply(approvedBoth(), catalog, state.specs);
  const result = await runSpecificationApply(plan, deps);
  assert.equal(result.outcome, "issues");
  assert.equal(result.summary.failed, 2);
  const p2 = result.products.find((product) => product.productId === "p2");
  assert.equal(p2.status, "failed");
  assert.equal(p2.rows[0].status, "failed");
  assert.match(p2.rows[0].message, /insert rejected/);
  const p1 = result.products.find((product) => product.productId === "p1");
  assert.equal(p1.status, "failed");
  assert.deepEqual(p1.rows.map((row) => [row.name, row.status]).sort(), [["Display Type", "failed"], ["Screen Size", "written"]]);
  assert.equal(state.specs.find((spec) => spec.id === "u1").value, "LCD");
});

test("16. read-back verification catches a missing, mangled or collateral change", async () => {
  const cases = [
    ["dropped insert", { dropInsert: true }, /read back exactly/],
    ["mangled value", { mangleValue: true }, /read back exactly/],
    ["touched product row", { touchProduct: true }, /Product row unchanged/],
    ["altered unrelated row", { alterOther: "keep" }, /Unrelated specification rows unchanged/],
  ];
  for (const [label, corrupt, expected] of cases) {
    const { deps } = fakeDb({ specs: [{ id: "keep", product_id: "p1", specification_group: "Camera", label: "Front Camera", value: "16 MP", sort_order: 0 }], corrupt });
    const plan = planSpecificationApply(rowsOf(proposal()), catalog, [{ id: "keep", product_id: "p1", specification_group: "Camera", label: "Front Camera", value: "16 MP", sort_order: 0 }]);
    const result = await runSpecificationApply(plan, deps);
    assert.equal(result.products[0].status, "failed", label);
    assert.match(result.products[0].message, /read-back verification FAILED/, label);
    assert.ok(result.products[0].checks.some((check) => !check.ok && expected.test(check.name)), label);
  }
  const entries = planSpecificationApply(rowsOf(proposal()), catalog, []).entries;
  const same = { id: "p1", title: "x" };
  const snapshot = { variants: [], mediaCount: 0, stockRows: 0, stockSum: 0 };
  const after = [{ id: "n1", product_id: "p1", specification_group: "Display", label: "Screen Size", value: "6.7 inches", sort_order: 0 }];
  assert.ok(verifySpecificationWrite(entries, [], after, same, same, snapshot, snapshot).every((check) => check.ok));
  assert.ok(verifySpecificationWrite(entries, [], [], same, same, snapshot, snapshot).some((check) => !check.ok));
  assert.ok(verifySpecificationWrite(entries, [], after, same, { ...same, title: "y" }, snapshot, snapshot).some((check) => !check.ok));
  assert.ok(verifySpecificationWrite(entries, [], after, same, same, snapshot, { ...snapshot, mediaCount: 1 }).some((check) => !check.ok));
});

test("the apply UI keeps the preview step, the PRODUCTION gate and the typed confirmation", async () => {
  const ui = await readFile("src/admin/SpecificationMigration.tsx", "utf8");
  assert.match(ui, /Preview approved specification apply/);
  assert.match(ui, /disabled=\{Boolean\(applyBlocker\)/);
  assert.match(ui, /specApplyConfirmationPhrase/);
  assert.match(ui, /selectApprovedRows\(specReview, usable\)/);
  assert.doesNotMatch(ui, /\.insert\(|\.update\(|\.upsert\(|\.delete\(|\.rpc\(|product_media|product_variants/);
});
