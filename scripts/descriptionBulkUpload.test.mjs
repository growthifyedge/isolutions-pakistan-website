import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ExcelJS from "exceljs";
import {
  descriptionConfirmationPhrase,
  descriptionRowsFromCsv,
  descriptionRowsFromTable,
  descriptionRowsFromXlsx,
  descriptionTemplateXlsx,
  normalizeText,
  planDescriptionUpload,
  runDescriptionUpload,
  selectDescriptionWrites,
} from "../src/lib/descriptionBulkUpload.ts";

const DEV = { supabaseUrl: "https://acwatgxkcyrdxpcljxjb.supabase.co", buildMode: "development" };
const PROD = { supabaseUrl: "https://nlxfwppywxumymbjkvwt.supabase.co", buildMode: "production" };

const catalog = [
  { id: "p-empty", title: "JBL Tune 660NC", slug: "jbl-tune-660nc", content: null, short_description: null, publication_status: "published" },
  { id: "p-filled", title: "Mini Fan Y05", slug: "mini-fan-y05", content: "Old text.", short_description: null, publication_status: "published" },
  { id: "p-same", title: "Tumbler Stopper", slug: "tumbler-stopper", content: "Same.\n\nText.", short_description: null, publication_status: "draft" },
];

test("reading: template headers and the Phase 2 file headers are both accepted; extra columns are ignored", () => {
  const template = descriptionRowsFromTable([
    ["Product Name", "Product Slug or Product ID", "Product content", "Short description"],
    ["JBL Tune 660NC", "jbl-tune-660nc", "One.\r\n\r\nTwo.  ", "Short"],
  ]);
  assert.deepEqual(template.fileErrors, []);
  assert.deepEqual(template.rows[0], { rowNumber: 2, productName: "JBL Tune 660NC", productKey: "jbl-tune-660nc", content: "One.\n\nTwo.", shortDescription: "Short" });
  const phase2 = descriptionRowsFromTable([
    ["#", "SKU(s)", "Product Name (search in Admin)", "Slug", "Description — paste into Product content, then click Save description", "Done?"],
    [1, "AC047", "JBL Tune 660NC", "jbl-tune-660nc", "Para one.\n\nPara two.", ""],
    [],
  ]);
  assert.deepEqual(phase2.fileErrors, []);
  assert.equal(phase2.rows.length, 1);
  assert.equal(phase2.rows[0].productName, "JBL Tune 660NC");
  assert.equal(phase2.rows[0].content, "Para one.\n\nPara two.");
  assert.equal(phase2.rows[0].shortDescription, "");
  assert.match(descriptionRowsFromTable([["Product Name", "Value"]]).fileErrors[0], /Missing column\(s\): Product Slug or Product ID, Product content/);
  assert.equal(descriptionRowsFromCsv("﻿Product Slug or Product ID,Product content\r\nmini-fan-y05,\"A, b\"\r\n").rows[0].content, "A, b");
});

test("reading: xlsx uses the Descriptions sheet and never the HOLD sheet; the template round-trips", async () => {
  const workbook = new ExcelJS.Workbook();
  workbook.addWorksheet("HOLD (do not upload)").addRow(["Slug", "Description"]).commit?.();
  workbook.getWorksheet("HOLD (do not upload)").addRow(["whoop-peak-5-0-bundle", "never"]);
  const sheet = workbook.addWorksheet("Descriptions");
  sheet.addRow(["Product Name (search in Admin)", "Slug", "Description — paste"]);
  sheet.addRow(["JBL Tune 660NC", "jbl-tune-660nc", "Text"]);
  const parsed = await descriptionRowsFromXlsx(await workbook.xlsx.writeBuffer());
  assert.deepEqual(parsed.rows.map((row) => row.productKey), ["jbl-tune-660nc"]);
  const template = await descriptionRowsFromXlsx(await descriptionTemplateXlsx());
  assert.deepEqual(template.fileErrors, ["The file has no description rows."], "template has the headers and no data rows");
});

test("planning: exact ID/slug + name match; new, replace, unchanged, not found, invalid, duplicate", () => {
  const rows = [
    { rowNumber: 2, productName: "JBL Tune 660NC", productKey: "jbl-tune-660nc", content: "New.", shortDescription: "" },
    { rowNumber: 3, productName: "", productKey: "p-filled", content: "Newer.", shortDescription: "" },
    { rowNumber: 4, productName: "Tumbler Stopper", productKey: "tumbler-stopper", content: "Same.\n\nText.", shortDescription: "" },
    { rowNumber: 5, productName: "JBL Tune 660", productKey: "jbl-tune-660nc", content: "x", shortDescription: "" },
    { rowNumber: 6, productName: "", productKey: "JBL-TUNE-660NC", content: "x", shortDescription: "" },
    { rowNumber: 7, productName: "", productKey: "mini-fan-y05", content: "", shortDescription: "" },
    { rowNumber: 8, productName: "", productKey: "jbl-tune-660nc", content: "Again.", shortDescription: "" },
  ];
  const plan = planDescriptionUpload(rows, catalog);
  assert.deepEqual(plan.rows.map((row) => row.category), ["New Description", "Replace", "Unchanged", "Product Not Found", "Product Not Found", "Invalid Row", "Invalid Row"]);
  assert.match(plan.rows[3].messages[0], /does not match/);
  assert.match(plan.rows[6].messages[0], /earlier row/);
  assert.deepEqual(plan.rows[0].patch, { content: "New." }, "never publication_status; no short description when the cell is empty");
  assert.equal(plan.exactMatchProducts, 3);
  assert.deepEqual(selectDescriptionWrites(plan, new Set()).map((row) => row.rowNumber), [2]);
  assert.deepEqual(selectDescriptionWrites(plan, new Set([3])).map((row) => row.rowNumber), [2, 3], "Replace only when ticked");
});

function fakeDeps(env, overrides = {}) {
  const db = new Map(catalog.map((product) => [product.id, { ...product }]));
  const writes = [];
  return {
    db,
    writes,
    deps: {
      ...env,
      readProduct: async (id) => {
        const row = db.get(id);
        return { content: row.content, short_description: row.short_description, publication_status: row.publication_status };
      },
      readSnapshot: async (id) => `variants+stock+media+specs:${id}`,
      updateDescription: async (id, patch) => {
        writes.push([id, patch]);
        Object.assign(db.get(id), patch);
      },
      ...overrides,
    },
  };
}

const twoRowPlan = () => planDescriptionUpload([
  { rowNumber: 2, productName: "", productKey: "jbl-tune-660nc", content: "New.", shortDescription: "" },
  { rowNumber: 3, productName: "", productKey: "mini-fan-y05", content: "Newer.", shortDescription: "" },
], catalog);

test("saving: verified read-back; only content is written; publication status stays published", async () => {
  const { deps, writes, db } = fakeDeps(DEV);
  const result = await runDescriptionUpload(twoRowPlan(), { replace: new Set([3]), typed: "" }, deps);
  assert.equal(result.outcome, "verified");
  assert.deepEqual(writes, [["p-empty", { content: "New." }], ["p-filled", { content: "Newer." }]]);
  assert.equal(db.get("p-empty").publication_status, "published");
  assert.ok(result.products.every((product) => product.checks.every((check) => check.ok)));
});

test("saving: PRODUCTION needs the typed phrase; wrong environment is blocked", async () => {
  const prod = fakeDeps(PROD);
  const blocked = await runDescriptionUpload(twoRowPlan(), { replace: new Set(), typed: "" }, prod.deps);
  assert.equal(blocked.outcome, "blocked");
  assert.equal(prod.writes.length, 0);
  const ok = await runDescriptionUpload(twoRowPlan(), { replace: new Set(), typed: descriptionConfirmationPhrase(1) }, prod.deps);
  assert.equal(ok.outcome, "verified");
  assert.equal(descriptionConfirmationPhrase(39), "APPLY 39 DESCRIPTIONS");
  const mismatch = fakeDeps({ supabaseUrl: PROD.supabaseUrl, buildMode: "development" });
  assert.equal((await runDescriptionUpload(twoRowPlan(), { replace: new Set(), typed: "" }, mismatch.deps)).outcome, "blocked");
  assert.equal(mismatch.writes.length, 0);
});

test("saving: stale preview is skipped; a status or snapshot change is reported as failed", async () => {
  const stale = fakeDeps(DEV);
  stale.db.get("p-empty").content = "Someone typed this meanwhile.";
  const staleResult = await runDescriptionUpload(twoRowPlan(), { replace: new Set(), typed: "" }, stale.deps);
  assert.equal(staleResult.products[0].status, "skipped");
  assert.equal(stale.writes.length, 0);

  let calls = 0;
  const drift = fakeDeps(DEV, { readSnapshot: async () => `snapshot-${calls++}` });
  const driftResult = await runDescriptionUpload(twoRowPlan(), { replace: new Set(), typed: "" }, drift.deps);
  assert.equal(driftResult.outcome, "partial");
  assert.equal(driftResult.products[0].checks.find((check) => check.name.startsWith("Prices")).ok, false);

  const unpublish = fakeDeps(DEV, {});
  unpublish.deps.updateDescription = async (id, patch) => Object.assign(unpublish.db.get(id), patch, { publication_status: "draft" });
  const unpublishResult = await runDescriptionUpload(twoRowPlan(), { replace: new Set(), typed: "" }, unpublish.deps);
  assert.equal(unpublishResult.products[0].checks.find((check) => check.name === "Publication status").ok, false);
});

test("normalizeText keeps paragraphs and removes CRLF / trailing spaces", () => {
  assert.equal(normalizeText("  a  \r\n\r\nb\t\n"), "a\n\nb");
  assert.equal(normalizeText(null), "");
});

test("source: the DB adapter writes only content/short_description; the page is routed and listed in the nav", () => {
  const db = readFileSync(new URL("../src/lib/descriptionBulkUploadDb.ts", import.meta.url), "utf8");
  const writeBlock = db.match(/updateDescription:[\s\S]*$/)[0];
  assert.equal(writeBlock.includes("publication_status"), false, "never sends publication_status");
  assert.equal(/product_variants|product_media|inventory_movements|product_specifications/.test(writeBlock), false);
  assert.match(db, /\.from\("products"\)\.update\(values\)\.eq\("id", productId\)/);
  const app = readFileSync(new URL("../src/admin/AdminApp.tsx", import.meta.url), "utf8");
  assert.match(app, /\["Descriptions", "\/admin\/description-upload", FileText\]/);
  assert.match(app, /path === "\/admin\/description-upload"\)\s*page = \(\s*<AdminLayout section="Descriptions">\s*<DescriptionBulkUpload \/>/);
});
