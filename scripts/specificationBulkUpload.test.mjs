import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  SPEC_UPLOAD_HEADERS,
  findProduct,
  planSpecificationUpload,
  rowsFromCsv,
  rowsFromTable,
  rowsFromXlsx,
  runSpecificationUpload,
  selectWrites,
  specUploadConfirmationPhrase,
  specUploadTemplateCsv,
  specUploadTemplateXlsx,
  summarizeUpload,
} from "../src/lib/specificationBulkUpload.ts";

const DEV_URL = "https://acwatgxkcyrdxpcljxjb.supabase.co";
const PROD_URL = "https://nlxfwppywxumymbjkvwt.supabase.co";

const catalog = [
  { id: "p1", slug: "realme-c75x", title: "Realme C75x" },
  { id: "p2", slug: "tecno-spark-50-pro", title: "Tecno Spark 50 Pro" },
  { id: "p3", slug: "tecno-spark-50-pro-plus", title: "Tecno Spark 50 Pro Plus" },
  { id: "p4", slug: "apple-iphone-13-used", title: "Apple iPhone 13 (Used)" },
  { id: "p5", slug: "apple-macbook-air-m3", title: "Apple MacBook Air M3" },
  { id: "p6", slug: "apple-20w-usb-c-charger", title: "Apple 20W USB-C Charger" },
];
const stored = [
  { id: "s1", product_id: "p1", specification_group: "Battery", label: "Battery Capacity", value: "5600 mAh", sort_order: 0 },
  { id: "s2", product_id: "p1", specification_group: "Display", label: "Screen Size", value: "6.67 inches", sort_order: 1 },
  { id: "s3", product_id: "p1", specification_group: "Other", label: "Weight", value: "196 g", sort_order: 2 },
];
const row = (n, productName, productKey, section, label, value) => ({ rowNumber: n, productName, productKey, section, label, value });

test("CSV template: the five column headers only, no product / specification row", () => {
  const csv = specUploadTemplateCsv();
  assert.equal(csv, `${SPEC_UPLOAD_HEADERS.join(",")}\r\n`);
  const read = rowsFromCsv(csv);
  assert.deepEqual(read.rows, []);
  assert.deepEqual(read.fileErrors, ["The file has no specification rows."]);
});

test("XLSX template: Specifications sheet = headers only; the Instructions example is labelled and never imported", async () => {
  const bytes = await specUploadTemplateXlsx();
  const { loadExcelJs } = await import("../src/lib/catalogWorkbook.ts");
  const ExcelJS = await loadExcelJs();
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(bytes);
  assert.deepEqual(workbook.worksheets.map((sheet) => sheet.name), ["Specifications", "Instructions"]);
  const specs = workbook.getWorksheet("Specifications");
  assert.equal(specs.actualRowCount, 1);
  assert.deepEqual(specs.getRow(1).values.slice(1), [...SPEC_UPLOAD_HEADERS]);
  const help = workbook.getWorksheet("Instructions");
  const lines = [];
  help.eachRow((row) => lines.push(String(row.getCell(1).value ?? "")));
  assert.ok(lines.some((line) => /^EXAMPLE — for reference only, NOT imported/.test(line)));
  assert.ok(lines.some((line) => line.includes("Product Name: Realme C75x") && line.includes("Value: 5600 mAh")));
  // Uploading the untouched template imports nothing.
  const read = await rowsFromXlsx(bytes);
  assert.deepEqual(read.rows, []);
  assert.deepEqual(read.fileErrors, ["The file has no specification rows."]);
  // Even without a Specifications sheet, the Instructions sheet is never read as data.
  workbook.removeWorksheet(specs.id);
  const onlyHelp = await rowsFromXlsx(await workbook.xlsx.writeBuffer());
  assert.deepEqual(onlyHelp.rows, []);
  assert.deepEqual(onlyHelp.fileErrors, ["The workbook has no sheet."]);
});

test("XLSX template filled in by the Owner reads back exactly", async () => {
  const { loadExcelJs } = await import("../src/lib/catalogWorkbook.ts");
  const ExcelJS = await loadExcelJs();
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(await specUploadTemplateXlsx());
  workbook.getWorksheet("Specifications").addRow(["Realme C75x", "realme-c75x", "Battery", "Wired Charging", "45W"]);
  const read = await rowsFromXlsx(await workbook.xlsx.writeBuffer());
  assert.deepEqual(read.fileErrors, []);
  assert.deepEqual(read.rows, [{ rowNumber: 2, productName: "Realme C75x", productKey: "realme-c75x", section: "Battery", label: "Wired Charging", value: "45W" }]);
});

test("reading: free column order, blank lines skipped, missing columns refused", () => {
  const ok = rowsFromTable([["Value", "Label", "Section", "Product Slug or Product ID", "Product Name"], [], ["45W", "Wired Charging", "Battery", "realme-c75x", "Realme C75x"]]);
  assert.deepEqual(ok.rows, [row(3, "Realme C75x", "realme-c75x", "Battery", "Wired Charging", "45W")]);
  assert.match(rowsFromTable([["Product Name", "Label", "Value"]]).fileErrors[0], /Missing column\(s\): Product Slug or Product ID, Section/);
  assert.match(rowsFromCsv("").fileErrors[0], /empty/);
  assert.equal(rowsFromCsv('Product Name,Product Slug or Product ID,Section,Label,Value\r\nRealme C75x,realme-c75x,Camera,Main Camera,"50 MP, f/1.8"\r\n').rows[0].value, "50 MP, f/1.8");
});

test("product matching: exact id or slug, and the name must equal the title — nothing fuzzy", () => {
  assert.equal(findProduct(row(2, "Realme C75x", "p1", "", "", ""), catalog).product?.id, "p1");
  assert.equal(findProduct(row(2, "realme  c75x", "realme-c75x", "", "", ""), catalog).product?.id, "p1");
  assert.equal(findProduct(row(2, "Realme C75", "realme-c75", "", "", ""), catalog).product, null);
  assert.equal(findProduct(row(2, "Realme C75x", "Realme C75x", "", "", ""), catalog).product, null, "name in the key column is not a slug");
  const wrongName = findProduct(row(2, "Tecno Spark 50 Pro", "tecno-spark-50-pro-plus", "", "", ""), catalog);
  assert.equal(wrongName.product, null);
  assert.match(wrongName.message, /is "Tecno Spark 50 Pro Plus", not "Tecno Spark 50 Pro"/);
  assert.match(findProduct(row(2, "A", "dup", "", "", ""), [{ id: "x", slug: "dup", title: "A" }, { id: "y", slug: "dup", title: "A" }]).message, /matches 2 products/);
});

test("categories: New Spec, Already Present, Conflict, Product Not Found, Invalid Row; Exact Match products", () => {
  const plan = planSpecificationUpload(
    [
      row(2, "Realme C75x", "realme-c75x", "Battery", "Wired Charging", "45W"),
      row(3, "Realme C75x", "realme-c75x", "Battery", "battery capacity", " 5600  mAh"),
      row(4, "Realme C75x", "p1", "Display", "Screen Size", "6.72 inches"),
      row(5, "Realme C75x", "realme-c75x", "Build", "Weight", "197 g"),
      row(6, "Realme C75", "realme-c75", "Battery", "Battery Capacity", "5000 mAh"),
      row(7, "Realme C75x", "realme-c75x", "Memory", "RAM", "8 GB"),
      row(8, "Realme C75x", "realme-c75x", "Battery", "Wired Charging", "45W"),
      row(9, "Tecno Spark 50 Pro", "tecno-spark-50-pro", "Battery", "Battery Capacity", "6000 mAh"),
      row(10, "Tecno Spark 50 Pro", "tecno-spark-50-pro", "Display", "", "120Hz"),
    ],
    catalog,
    stored,
  );
  const by = (n) => plan.rows.find((entry) => entry.rowNumber === n);
  assert.equal(by(2).category, "New Spec");
  assert.equal(by(3).category, "Already Present");
  assert.equal(by(4).category, "Conflict");
  assert.equal(by(4).overwritable, true);
  assert.equal(by(5).category, "Conflict", "same label stored under another section");
  assert.equal(by(5).overwritable, false);
  assert.equal(by(6).category, "Product Not Found");
  assert.equal(by(7).category, "Invalid Row");
  assert.equal(by(8).category, "Invalid Row", "duplicate label for the same product");
  assert.equal(by(9).category, "New Spec");
  assert.equal(by(10).category, "Invalid Row");
  assert.deepEqual(plan.counts, { "New Spec": 2, "Already Present": 1, Conflict: 2, "Product Not Found": 1, "Invalid Row": 3 });
  assert.equal(plan.exactMatchProducts, 2);
});

test("selection: new specs are added; a Conflict is overwritten only when its row is ticked", () => {
  const plan = planSpecificationUpload([row(2, "Realme C75x", "p1", "Battery", "Wired Charging", "45W"), row(3, "Realme C75x", "p1", "Display", "Screen Size", "6.72 inches"), row(4, "Realme C75x", "p1", "Build", "Weight", "197 g")], catalog, stored);
  assert.equal(selectWrites(plan, new Set()).total, 1);
  assert.equal(selectWrites(plan, new Set([3])).total, 2);
  assert.equal(selectWrites(plan, new Set([3, 4])).total, 2, "a different-section conflict is never overwritten");
});

/**
 * In-memory database with only the operations the uploader may use. applyProductSpecs behaves like
 * apply_product_specifications: all or nothing per product, refuses stale values and existing labels.
 */
function fakeDb(initial = stored) {
  const specs = initial.map((spec) => ({ ...spec }));
  const products = Object.fromEntries(catalog.map((product) => [product.id, { ...product, publication_status: "published", price: 1 }]));
  const snapshot = { products: [{ id: "p1" }], variants: [{ id: "v1", price_minor: 6100000, is_active: true }], stock: { v1: 30 }, media: [{ id: "m1" }] };
  const calls = [];
  const failFor = new Set();
  let nextId = 100;
  return {
    specs,
    calls,
    failFor,
    deps: (url, mode) => ({
      supabaseUrl: url,
      buildMode: mode,
      readSpecs: async (productId) => specs.filter((spec) => spec.product_id === productId).map((spec) => ({ ...spec })),
      readProduct: async (productId) => ({ ...products[productId] }),
      readSnapshot: async () => JSON.parse(JSON.stringify(snapshot)),
      applyProductSpecs: async (productId, inserts, updates) => {
        calls.push(["apply", productId, inserts.length, updates.length]);
        const mine = specs.filter((spec) => spec.product_id === productId);
        if (failFor.has(productId)) throw new Error("apply_product_specifications_stale: simulated refusal");
        for (const update of updates) if (!mine.some((spec) => spec.id === update.id && spec.value === update.expected_value)) throw new Error("apply_product_specifications_stale");
        for (const insert of inserts) if (mine.some((spec) => spec.label.toLowerCase() === insert.label.toLowerCase())) throw new Error("already exists");
        // Validated as a whole: only now is anything changed (all or nothing).
        for (const update of updates) mine.find((spec) => spec.id === update.id).value = update.value;
        let order = mine.reduce((max, spec) => Math.max(max, spec.sort_order), -1) + 1;
        for (const insert of inserts) specs.push({ id: `n${nextId++}`, product_id: productId, ...insert, sort_order: order++ });
        return { inserted: inserts.length, updated: updates.length };
      },
    }),
  };
}

test("save: blocked without the matching build/project pair; PRODUCTION needs the exact phrase, DEVELOPMENT does not", async () => {
  const plan = planSpecificationUpload([row(2, "Realme C75x", "p1", "Battery", "Wired Charging", "45W")], catalog, stored);
  const db = fakeDb();
  const mismatch = await runSpecificationUpload(plan, { overwrite: new Set(), typed: "APPLY 1 SPECS" }, catalog, db.deps(PROD_URL, "development"));
  assert.equal(mismatch.outcome, "blocked");
  const unknown = await runSpecificationUpload(plan, { overwrite: new Set(), typed: "APPLY 1 SPECS" }, catalog, db.deps("https://unknown.supabase.co", "development"));
  assert.equal(unknown.outcome, "blocked");
  for (const typed of ["", "APPLY 2 SPECS", "apply 1 specs"]) {
    const prod = await runSpecificationUpload(plan, { overwrite: new Set(), typed }, catalog, db.deps(PROD_URL, "production"));
    assert.equal(prod.outcome, "blocked");
    assert.match(prod.message, /Type APPLY 1 SPECS/);
  }
  assert.deepEqual(db.calls, []);
  const prod = await runSpecificationUpload(plan, { overwrite: new Set(), typed: "APPLY 1 SPECS" }, catalog, fakeDb().deps(PROD_URL, "production"));
  assert.equal(prod.outcome, "verified");
  const dev = await runSpecificationUpload(plan, { overwrite: new Set(), typed: "" }, catalog, fakeDb().deps(DEV_URL, "development"));
  assert.equal(dev.outcome, "verified", "DEVELOPMENT saves with the button alone");
});

test("save: adds new specs and the ticked overwrite in ONE call per product; matching values unchanged; read-back verified", async () => {
  const plan = planSpecificationUpload(
    [row(2, "Realme C75x", "p1", "Battery", "Wired Charging", "45W"), row(3, "Realme C75x", "p1", "Display", "Screen Size", "6.72 inches"), row(4, "Realme C75x", "p1", "Battery", "Battery Capacity", "5600 mAh")],
    catalog,
    stored,
  );
  const db = fakeDb();
  const overwrite = new Set([3]);
  const result = await runSpecificationUpload(plan, { overwrite, typed: "" }, catalog, db.deps(DEV_URL, "development"));
  assert.equal(result.outcome, "verified", JSON.stringify(result));
  assert.deepEqual(db.calls, [["apply", "p1", 1, 1]]);
  assert.equal(db.specs.length, 4);
  assert.equal(db.specs.find((spec) => spec.label === "Wired Charging").sort_order, 3);
  assert.equal(db.specs.find((spec) => spec.id === "s2").value, "6.72 inches");
  assert.equal(db.specs.find((spec) => spec.id === "s1").value, "5600 mAh");
  assert.ok(result.products[0].checks.some((check) => /Product row unchanged/.test(check.name) && check.ok));
  assert.deepEqual(summarizeUpload(plan, overwrite, result), { New: 1, Updated: 1, "Already Present": 1, Skipped: 0, Failed: 0 });
  // Without the tick the stored value is kept and the row counts as Skipped.
  const keep = fakeDb();
  const kept = await runSpecificationUpload(plan, { overwrite: new Set(), typed: "" }, catalog, keep.deps(DEV_URL, "development"));
  assert.equal(keep.specs.find((spec) => spec.id === "s2").value, "6.67 inches");
  assert.deepEqual(summarizeUpload(plan, new Set(), kept), { New: 1, Updated: 0, "Already Present": 1, Skipped: 1, Failed: 0 });
});

test("save: the overwrite sends the previewed value, so a concurrent change is refused, not overwritten", async () => {
  const plan = planSpecificationUpload([row(2, "Realme C75x", "p1", "Display", "Screen Size", "6.72 inches")], catalog, stored);
  const db = fakeDb();
  const deps = db.deps(DEV_URL, "development");
  const sent = [];
  const apply = deps.applyProductSpecs;
  deps.applyProductSpecs = async (productId, inserts, updates) => {
    sent.push(...updates);
    db.specs.find((spec) => spec.id === "s2").value = "6.7 inches"; // someone else changes it just before the save
    return apply(productId, inserts, updates);
  };
  const result = await runSpecificationUpload(plan, { overwrite: new Set([2]), typed: "" }, catalog, deps);
  assert.deepEqual(sent, [{ id: "s2", expected_value: "6.67 inches", value: "6.72 inches" }]);
  assert.equal(result.products[0].status, "failed");
  assert.match(result.products[0].message, /Not saved: .*all or nothing/);
  assert.equal(db.specs.find((spec) => spec.id === "s2").value, "6.7 inches", "the other writer's value is kept");
});

test("save: one product refused (rolled back) never blocks the other products; Android, iPhone and non-phone products alike", async () => {
  const plan = planSpecificationUpload(
    [
      row(2, "Realme C75x", "realme-c75x", "Battery", "Wired Charging", "45W"),
      row(3, "Realme C75x", "realme-c75x", "Display", "Screen Size", "6.72 inches"),
      row(4, "Apple iPhone 13 (Used)", "apple-iphone-13-used", "Camera", "Main Camera", "12 MP"),
      row(5, "Apple MacBook Air M3", "apple-macbook-air-m3", "Performance", "Chipset", "Apple M3"),
      row(6, "Apple 20W USB-C Charger", "apple-20w-usb-c-charger", "Other", "Output", "20W"),
      row(7, "Apple MacBook Air M3", "apple-macbook-air-m3", "Memory", "RAM", "8 GB"),
      row(8, "MacBook Air", "apple-macbook-air-m3", "Build", "Weight", "1.24 kg"),
    ],
    catalog,
    stored,
  );
  const db = fakeDb();
  db.failFor.add("p1");
  const overwrite = new Set([3]);
  const result = await runSpecificationUpload(plan, { overwrite, typed: "" }, catalog, db.deps(DEV_URL, "development"));
  const status = Object.fromEntries(result.products.map((product) => [product.productId, product.status]));
  assert.deepEqual(status, { p1: "failed", p4: "verified", p5: "verified", p6: "verified" });
  assert.equal(result.outcome, "issues");
  assert.deepEqual(db.specs.filter((spec) => spec.product_id === "p1"), stored, "the refused product is unchanged (no partial save)");
  assert.deepEqual(db.specs.filter((spec) => spec.product_id !== "p1").map((spec) => [spec.product_id, spec.label]), [["p4", "Main Camera"], ["p5", "Chipset"], ["p6", "Output"]]);
  // Row 7 (bad section) and row 8 (wrong product name) are reported, not saved; they never block p5.
  assert.deepEqual(summarizeUpload(plan, overwrite, result), { New: 3, Updated: 0, "Already Present": 0, Skipped: 2, Failed: 2 });
});

test("save: a read-back that does not match is reported as failed, never verified", async () => {
  const plan = planSpecificationUpload([row(2, "Realme C75x", "p1", "Battery", "Wired Charging", "45W")], catalog, stored);
  const db = fakeDb();
  const deps = db.deps(DEV_URL, "development");
  deps.applyProductSpecs = async () => ({ inserted: 1, updated: 0 }); // claims success but stores nothing
  const result = await runSpecificationUpload(plan, { overwrite: new Set(), typed: "" }, catalog, deps);
  assert.equal(result.products[0].status, "failed");
  assert.match(result.products[0].message, /read-back FAILED/);
  assert.equal(result.outcome, "issues");
});

test("save: a product whose specs changed after the preview is skipped and not written", async () => {
  const plan = planSpecificationUpload([row(2, "Realme C75x", "p1", "Battery", "Wired Charging", "45W")], catalog, stored);
  const db = fakeDb([...stored, { id: "s9", product_id: "p1", specification_group: "Battery", label: "Wired Charging", value: "33W", sort_order: 9 }]);
  const result = await runSpecificationUpload(plan, { overwrite: new Set(), typed: "" }, catalog, db.deps(DEV_URL, "development"));
  assert.equal(result.products[0].status, "blocked");
  assert.deepEqual(db.calls, []);
  assert.deepEqual(summarizeUpload(plan, new Set(), result), { New: 0, Updated: 0, "Already Present": 0, Skipped: 1, Failed: 0 });
});

test("the uploader writes only through apply_product_specifications and never deletes", () => {
  const source = readFileSync(new URL("../src/lib/specificationBulkUpload.ts", import.meta.url), "utf8");
  assert.doesNotMatch(source, /\.from\(|\.delete\(|\.rpc\(|uploadToCloudinary|runBulkUpload|publication_status\s*:/);
  const adapter = readFileSync(new URL("../src/lib/specificationBulkUploadDb.ts", import.meta.url), "utf8");
  assert.deepEqual([...adapter.matchAll(/\.rpc\("(\w+)"/g)].map((match) => match[1]), ["apply_product_specifications"]);
  assert.doesNotMatch(adapter, /\.from\(|\.delete\(|\.insert\(|\.update\(|\.upsert\(/);
  const page = readFileSync(new URL("../src/admin/SpecificationBulkUpload.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(page, /insertSpecs|updateSpecValue|overwriteConfirmed/, "no direct per-row writes or second overwrite confirmation");
  assert.match(page, /typedConfirmation && \(/, "the typed phrase input is shown only for PRODUCTION");
});

test("navigation: Spec Upload is in the Admin menu; no deprecated Specs & Images entry", () => {
  const app = readFileSync(new URL("../src/admin/AdminApp.tsx", import.meta.url), "utf8");
  assert.match(app, /\["Spec Upload", "\/admin\/spec-upload"/);
  assert.doesNotMatch(app, /\["Specs & Images"/);
  assert.doesNotMatch(app, /<OfficialSpecsImages/);
});
