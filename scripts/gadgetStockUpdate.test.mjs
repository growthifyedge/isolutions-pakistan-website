import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ExcelJS from "exceljs";
import {
  GADGET_EXCEL_HEADERS,
  GADGET_NEW_PRODUCT_STOCK,
  BARE_NUMBER_REASON,
  NO_PRICE_REASON,
  ORPHAN_PRICE_REASON,
  buildGadgetPlan,
  buildGadgetWorkbook,
  compareGadgetSheet,
  gadgetSheetFingerprint,
  gadgetTableFromWorksheet,
  parseGadgetList,
  readGadgetSheet,
} from "../src/lib/gadgetStockUpdate.ts";
import { GADGET_NOT_APPROVED_REASON, GADGET_WRITE_ENVIRONMENTS, gadgetUpdateBlocker, runGadgetUpdate } from "../src/lib/gadgetStockApply.ts";
import { PhoneWriteError } from "../src/lib/stockUpdateApply.ts";
import { descriptionParagraphs, isGadgetProduct } from "../src/lib/pdpDescription.ts";

const DEV_URL = "https://acwatgxkcyrdxpcljxjb.supabase.co";
const PROD_URL = "https://nlxfwppywxumymbjkvwt.supabase.co";

const variant = (id, extra = {}) => ({
  id, sku: `GD${id.slice(-3).padStart(3, "0")}`, ram: null, storage: null, color: null, priceMinor: 500000, compareAtPriceMinor: null, stock: 7,
  ptaStatus: "unknown", condition: "unknown", conditionGrade: null, batteryHealth: null, cycleCount: null, isActive: true, ...extra,
});
const product = (id, title, extra = {}) => ({
  id, slug: title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""), title, brand: null, category: "Gadgets", categorySlug: "gadgets",
  publicationStatus: "published", mediaCount: 1, specCount: 0, content: null, variants: [variant(`${id}-v001`)], ...extra,
});
const row = (rowNumber, name, rupees, description = null) => ({ rowNumber, name, priceText: rupees === null ? "" : String(rupees), priceMinor: rupees === null ? null : rupees * 100, description });
const slugsOf = (catalog) => catalog.map((item) => ({ slug: item.slug, title: item.title }));
const compare = (rows, catalog, extraSlugs = []) => compareGadgetSheet(rows, catalog, [...slugsOf(catalog), ...extraSlugs]);

// ---------------------------------------------------------------------------
// Paste List
// ---------------------------------------------------------------------------

test("Paste List: name and price after @, Rs, PKR, dash, colon, equals or a tab; the name is kept exactly", () => {
  const parsed = parseGadgetList([
    "Product Name\tPrice",
    "Apple AirPods Pro 2 @ 58,000",
    "  Anker PowerCore 10000 - Rs 6,500/-",
    "Samsung 25W Charger: 4200",
    "JBL Go 4 = PKR 9,999",
    "Baseus  Cable\t1,200",
    "Mi Band 9 Rs.8500",
    "",
  ].join("\r\n"));
  assert.deepEqual(parsed.unread, []);
  assert.deepEqual(parsed.lines.map((line) => [line.lineNumber, line.name, line.priceMinor]), [
    [2, "Apple AirPods Pro 2", 5800000],
    [3, "Anker PowerCore 10000", 650000],
    [4, "Samsung 25W Charger", 420000],
    [5, "JBL Go 4", 999900],
    [6, "Baseus  Cable", 120000],
    [7, "Mi Band 9", 850000],
  ]);
});

test("Paste List: a number at the end without @ / Rs / dash / tab is never guessed as a price", () => {
  const parsed = parseGadgetList("Power Bank 10000\nUSB-C Hub 4500.50\nCharger @ 0\nSpeaker @ abc\n: 4500");
  assert.equal(parsed.lines.length, 0);
  assert.deepEqual(parsed.unread.map((line) => [line.lineNumber, line.reason]), [
    [1, NO_PRICE_REASON],
    [2, NO_PRICE_REASON],
    [3, "The price is not a valid amount in rupees."],
    [4, NO_PRICE_REASON],
    [5, "No product name before the price."],
  ]);
});

test("Paste List: the Owner's list with the price on its own line (blank lines between)", () => {
  const parsed = parseGadgetList("Tumbler Stopper\r\n\r\nRs 70\r\n\r\nMini Fan Y05\r\n\r\nRs 750\r\n\r\nCrank Chop Blade Chopper (Box Packing)\r\n\r\nRs 450\r\n");
  assert.deepEqual(parsed.unread, []);
  assert.deepEqual(parsed.lines.map((line) => [line.lineNumber, line.name, line.priceMinor]), [
    [1, "Tumbler Stopper", 7000],
    [5, "Mini Fan Y05", 75000],
    [9, "Crank Chop Blade Chopper (Box Packing)", 45000],
  ]);
});

test("Paste List: separate-line and same-line formats mixed; Rs. / PKR / /- price lines", () => {
  const parsed = parseGadgetList([
    "Mini Fan Y05",
    "Rs. 1,250/-",
    "Desk Lamp X2 - Rs 2,100",
    "Power Bank 10000",
    "",
    "PKR 4500",
    "Neck Fan 3 @ 1,800",
    "Price: Rs 999",
  ].join("\n"));
  assert.deepEqual(parsed.lines.map((line) => [line.lineNumber, line.name, line.priceMinor]), [
    [1, "Mini Fan Y05", 125000],
    [3, "Desk Lamp X2", 210000],
    [4, "Power Bank 10000", 450000],
    [7, "Neck Fan 3", 180000],
  ]);
  assert.deepEqual(parsed.unread.map((line) => [line.lineNumber, line.reason]), [[8, ORPHAN_PRICE_REASON]]);
});

test("Paste List: missing, orphan and ambiguous entries are reported, never paired or guessed", () => {
  const parsed = parseGadgetList([
    "Rs 300", //             1 orphan price at the start
    "Tumbler Stopper", //    2 followed by another name: no price
    "Mini Fan Y05", //       3 paired with line 4
    "Rs 750",
    "Rs 800", //             5 second price in a row: orphan
    "Desk Lamp", //          6 followed by a same-line product: no price
    "Hub - Rs 1,000",
    "Clip Light", //         8 followed by a bare number: no price
    "450", //                9 bare number is never a price
    "Cable Tidy", //        10 followed by a zero price
    "Rs 0",
    "Stand", //             12 last line: no price
  ].join("\n"));
  assert.deepEqual(parsed.lines.map((line) => [line.lineNumber, line.name, line.priceMinor]), [
    [3, "Mini Fan Y05", 75000],
    [7, "Hub", 100000],
  ]);
  assert.deepEqual(parsed.unread.map((line) => [line.lineNumber, line.line, line.reason]), [
    [1, "Rs 300", ORPHAN_PRICE_REASON],
    [2, "Tumbler Stopper", NO_PRICE_REASON],
    [5, "Rs 800", ORPHAN_PRICE_REASON],
    [6, "Desk Lamp", NO_PRICE_REASON],
    [8, "Clip Light", NO_PRICE_REASON],
    [9, "450", BARE_NUMBER_REASON],
    [10, "Cable Tidy", NO_PRICE_REASON],
    [11, "Rs 0", "The price is not a valid amount in rupees."],
    [12, "Stand", NO_PRICE_REASON],
  ]);
});

// ---------------------------------------------------------------------------
// Excel round-trip
// ---------------------------------------------------------------------------

async function roundTrip(lines, fill = () => {}) {
  const workbook = buildGadgetWorkbook(ExcelJS, lines);
  const sheet = workbook.getWorksheet("Gadgets");
  fill(sheet);
  const again = new ExcelJS.Workbook();
  await again.xlsx.load(await workbook.xlsx.writeBuffer());
  return { table: gadgetTableFromWorksheet(again.worksheets[0]), read: readGadgetSheet(gadgetTableFromWorksheet(again.worksheets[0])) };
}

test("Excel: the Owner's separate-line list becomes Product Name / Price / blank Description rows", async () => {
  const { lines } = parseGadgetList("Tumbler Stopper\n\nRs 70\n\nMini Fan Y05\n\nRs 750\n\nCrank Chop Blade Chopper (Box Packing)\n\nRs 450");
  const { table, read } = await roundTrip(lines);
  assert.deepEqual(table[0], [...GADGET_EXCEL_HEADERS]);
  assert.deepEqual(table.slice(1).map((cells) => [cells[0], cells[1], cells[2] ?? ""]), [
    ["Tumbler Stopper", "70", ""],
    ["Mini Fan Y05", "750", ""],
    ["Crank Chop Blade Chopper (Box Packing)", "450", ""],
  ]);
  assert.equal(read.ok, true);
});

test("Excel: Generate Excel writes Product Name, Price and a blank Description; the filled sheet reads back unchanged", async () => {
  const { lines } = parseGadgetList("Apple AirPods Pro 2 @ 58,000\nBaseus  Cable\t1,200");
  const { table, read } = await roundTrip(lines);
  assert.deepEqual(table[0], [...GADGET_EXCEL_HEADERS]);
  assert.deepEqual(table.slice(1).map((cells) => [cells[0], cells[1], cells[2] ?? ""]), [["Apple AirPods Pro 2", "58000", ""], ["Baseus  Cable", "1200", ""]]);
  assert.equal(read.ok, true);
  assert.deepEqual(read.rows.map((item) => [item.rowNumber, item.name, item.priceMinor, item.description]), [[2, "Apple AirPods Pro 2", 5800000, null], [3, "Baseus  Cable", 120000, null]]);

  const description = "Colour: White\r\nMaterial: Plastic\n\nActive Noise Cancellation  and USB-C case.";
  const filled = await roundTrip(lines, (sheet) => {
    sheet.getCell("C2").value = description;
    sheet.getCell("B3").value = 1350;
  });
  assert.equal(filled.read.rows[0].description, "Colour: White\nMaterial: Plastic\n\nActive Noise Cancellation  and USB-C case.");
  assert.equal(filled.read.rows[1].priceMinor, 135000);
  assert.equal(filled.read.rows[1].description, null);
});

test("Excel: a sheet without the Gadgets headings is refused; blank rows are skipped; a bad price is kept for review", () => {
  assert.equal(readGadgetSheet([["Line", "Brand", "Model"]]).ok, false);
  assert.match(readGadgetSheet([["Product Name", "Price", "Description"]]).error, /no products/);
  const read = readGadgetSheet([["product name ", "PRICE", "Description"], ["", "", ""], ["Cable", "Rs 1,200/-", "  "], ["Hub", "12k", ""]]);
  assert.deepEqual(read.rows.map((item) => [item.rowNumber, item.priceMinor, item.description]), [[3, 120000, null], [4, null, null]]);
});

test("Check fingerprint changes when any name, price or description changes", () => {
  const rows = [row(2, "Cable", 1200, "Black")];
  assert.equal(gadgetSheetFingerprint(rows), gadgetSheetFingerprint([row(2, "Cable", 1200, "Black")]));
  assert.notEqual(gadgetSheetFingerprint(rows), gadgetSheetFingerprint([row(2, "Cable", 1200, "Black.")]));
  assert.notEqual(gadgetSheetFingerprint(rows), gadgetSheetFingerprint([row(2, "Cable", 1300, "Black")]));
});

// ---------------------------------------------------------------------------
// Check Changes: matching, duplicates, review
// ---------------------------------------------------------------------------

test("Matching ignores case and extra spaces only; the website name is kept", () => {
  const catalog = [product("p1", "Apple AirPods Pro 2")];
  const { entries } = compare([row(2, "  apple   airpods PRO 2 ", 60000)], catalog);
  assert.equal(entries[0].kind, "update");
  assert.equal(entries[0].productTitle, "Apple AirPods Pro 2");
  assert.match(entries[0].notes.join(" "), /website name is kept/);
  assert.equal(compare([row(2, "Apple AirPods Pro2", 60000)], catalog).entries[0].kind, "new_product", "punctuation/digits are part of the name: no fuzzy match");
});

test("Needs Review: duplicates in the sheet, two website products, another category, several or hidden variants, web-address clashes, bad price", () => {
  const catalog = [
    product("p1", "Twin Charger"),
    product("p2", "twin  charger"),
    product("p3", "Galaxy Buds", { category: "Mobile Accessories", categorySlug: "mobile-accessories" }),
    product("p4", "Smart Watch", { variants: [variant("p4-v001"), variant("p4-v002", { color: "Black" })] }),
    product("p5", "Hidden Lamp", { variants: [variant("p5-v001", { isActive: false })] }),
  ];
  const rows = [
    row(2, "Desk Fan", 3000), row(3, "desk fan", 3100),
    row(4, "Twin Charger", 1000),
    row(5, "Galaxy Buds", 9000),
    row(6, "Smart Watch", 7000),
    row(7, "Hidden Lamp", 2000),
    row(8, "Old Test Gadget", 1500),
    row(9, "Mini Fan+", 900), row(10, "Mini Fan Plus", 950),
    row(11, "Speaker", null),
    row(12, "", 100),
  ];
  const { entries, counts } = compare(rows, catalog, [{ slug: "old-test-gadget", title: "Old Test Gadget (test)" }]);
  const reasons = Object.fromEntries(entries.map((entry) => [entry.row.rowNumber, `${entry.kind}: ${entry.reasons.join(" ")}`]));
  assert.match(reasons[2], /^review: .*more than once \(rows 2, 3\)/);
  assert.match(reasons[3], /^review: .*more than once/);
  assert.match(reasons[4], /^review: 2 products on the website have this name/);
  assert.match(reasons[5], /^review: .*Mobile Accessories\. Only Gadgets/);
  assert.match(reasons[6], /^review: .*2 variants/);
  assert.match(reasons[7], /^review: .*hidden/);
  assert.match(reasons[8], /^review: .*"old-test-gadget" is already used/);
  assert.match(reasons[9], /^review: Rows 9, 10 would get the same web address "mini-fan-plus"/);
  assert.match(reasons[10], /^review: Rows 9, 10/);
  assert.match(reasons[11], /^review: Price is blank/);
  assert.match(reasons[12], /^review: Product Name is blank/);
  assert.equal(counts.review, rows.length);
  const plan = buildGadgetPlan(compare(rows, catalog, [{ slug: "old-test-gadget", title: "x" }]));
  assert.equal(plan.items.length, 0, "nothing in review is ever written");
  assert.equal(plan.held.length, rows.length);
});

test("New product: draft Create of a Gadget, one variant, stock 20, nationwide; every fact the list does not give is null", () => {
  const plan = buildGadgetPlan(compare([row(2, "Baseus  Cable", 1200, "Braided, 1 m")], []));
  assert.equal(plan.items.length, 1);
  const [item] = plan.items;
  assert.equal(item.kind, "new");
  assert.equal(item.description, "Braided, 1 m");
  assert.deepEqual(item.payload, {
    source: "Row 2", action: "Create", product_type: "Gadget", title: "Baseus  Cable",
    variants: [{
      source: "Row 2", ram: null, storage: null, color: null, price_minor: 120000, stock: GADGET_NEW_PRODUCT_STOCK,
      pta_status: null, condition: null, condition_grade: null, battery_health_percent: null, battery_cycle_count: null,
      sim_configuration: null, warranty: null, delivery_scope: "nationwide",
    }],
  });
  assert.equal(GADGET_NEW_PRODUCT_STOCK, 20);
  assert.equal("brand" in item.payload || "category" in item.payload, false, "no brand or category is guessed");
});

test("Existing product: only price and nonblank description are planned; stock is never in the payload; blank description keeps the saved one", () => {
  const catalog = [
    product("p1", "Cable", { content: "Old text" }),
    product("p2", "Hub", { content: "Hub text" }),
    product("p3", "Lamp", { content: "Lamp text" }),
    product("p4", "Fan", { content: null }),
  ];
  const comparison = compare([row(2, "Cable", 6000, null), row(3, "Hub", 5000, "New hub text"), row(4, "Lamp", 5000, "Lamp text"), row(5, "Fan", 5000, null)], catalog);
  assert.deepEqual(comparison.entries.map((entry) => entry.kind), ["update", "update", "same", "same"]);
  assert.deepEqual(comparison.counts, { newProducts: 0, priceUpdates: 1, descriptionUpdates: 1, review: 0, same: 2 });
  assert.match(comparison.entries[0].notes.join(" "), /saved description is kept/);
  const plan = buildGadgetPlan(comparison);
  assert.deepEqual(plan.items.map((item) => item.payload), [
    { product_id: "p1", expected: { title: "Cable", content: "Old text", variant: { id: "p1-v001", price_minor: 500000, is_active: true } }, steps: { price: { from_minor: 500000, to_minor: 600000 } } },
    { product_id: "p2", expected: { title: "Hub", content: "Hub text", variant: { id: "p2-v001", price_minor: 500000, is_active: true } }, steps: { content: { to: "New hub text" } } },
  ]);
  assert.equal(/stock/.test(JSON.stringify(plan.items.map((item) => item.payload))), false, "existing gadgets: no stock in any payload");
});

test("Products missing from the sheet are never planned", () => {
  const catalog = [product("p1", "Cable"), product("p2", "Hub"), product("p3", "Galaxy Buds", { categorySlug: "mobile-accessories" })];
  const plan = buildGadgetPlan(compare([row(2, "Cable", 6000)], catalog));
  assert.deepEqual(plan.items.map((item) => item.productId), ["p1"]);
});

// ---------------------------------------------------------------------------
// Environment guard and confirmation
// ---------------------------------------------------------------------------

test("Update Website is approved for DEV only: PROD stays blocked", () => {
  assert.deepEqual([...GADGET_WRITE_ENVIRONMENTS], ["development"]);
  const plan = buildGadgetPlan(compare([row(2, "Cable", 1200)], []));
  const base = { supabaseUrl: DEV_URL, buildMode: "development", enabled: true, checkIsCurrent: true, plan };
  assert.match(gadgetUpdateBlocker({ ...base, enabled: false }), /switched off/);
  assert.equal(gadgetUpdateBlocker(base), null);
  assert.equal(gadgetUpdateBlocker({ ...base, supabaseUrl: PROD_URL, buildMode: "production" }), GADGET_NOT_APPROVED_REASON);
  assert.match(gadgetUpdateBlocker({ ...base, buildMode: "production" }), /Blocked/);
  assert.match(gadgetUpdateBlocker({ ...base, supabaseUrl: "https://unknown.supabase.co" }), /Blocked/);
});

test("The page: write switch is on, it never passes the test environment hook, it asks before writing and names the website", () => {
  const page = readFileSync(new URL("../src/admin/GadgetStockUpdate.tsx", import.meta.url), "utf8");
  assert.match(page, /const GADGET_UPDATE_WEBSITE_ENABLED = true;/);
  assert.equal(page.includes("testWriteEnvironments"), false);
  assert.match(page, /window\.confirm\(`Update the \$\{supabaseEnvironmentLabel\.toUpperCase\(\)\} website now\?/);
  assert.match(page, /disabled=\{Boolean\(blocker\) \|\| busy \|\| writing\}/);
  const app = readFileSync(new URL("../src/admin/AdminApp.tsx", import.meta.url), "utf8");
  assert.match(app, /\["Gadgets Stock", "\/admin\/gadget-stock-update", PackageCheck\]/);
  assert.match(app, /path === "\/admin\/gadget-stock-update"/);
});

// ---------------------------------------------------------------------------
// Update Website (offline fake database): partial success and safe retry
// ---------------------------------------------------------------------------

function fakeDb(catalog, options = {}) {
  const products = new Map(catalog.map((item) => [item.id, { id: item.id, title: item.title, slug: item.slug, content: item.content, publication_status: item.publicationStatus }]));
  const variants = new Map(catalog.flatMap((item) => item.variants.map((v) => [v.id, { id: v.id, product_id: item.id, sku: v.sku, price_minor: v.priceMinor, is_active: v.isActive, delivery_scope: "nationwide", pta_status: "unknown", condition: "unknown", ram_display: null, storage_display: null, color_finish: null, warranty_override: null, sim_configuration: null, condition_grade: null, battery_health_percent: null, battery_cycle_count: null }])));
  const stock = new Map(catalog.flatMap((item) => item.variants.map((v) => [v.id, v.stock])));
  const calls = [];
  let next = 1;
  const failures = { ...options };
  const snapshot = async (productId) => {
    const p = products.get(productId);
    if (!p) throw new Error("not found");
    const own = [...variants.values()].filter((v) => v.product_id === productId);
    return { productId, product: { ...p }, media: [], specifications: [], variants: Object.fromEntries(own.map((v) => [v.id, { ...v }])), stock: Object.fromEntries(own.map((v) => [v.id, stock.get(v.id)])) };
  };
  return {
    calls, products, variants, stock,
    deps: {
      supabaseUrl: DEV_URL, buildMode: "development", testWriteEnvironments: ["development"],
      readSnapshot: snapshot,
      createProduct: async (payload) => {
        calls.push(["create", payload.title]);
        if ([...products.values()].some((p) => p.title.trim().toLowerCase() === payload.title.trim().toLowerCase())) throw new PhoneWriteError(`Action is Create but "${payload.title}" already exists`, false);
        const id = `new${next}`;
        const vid = `${id}-v`;
        products.set(id, { id, title: payload.title, slug: id, content: null, publication_status: "draft" });
        variants.set(vid, { id: vid, product_id: id, sku: `GD${String(next).padStart(3, "0")}`, price_minor: payload.variants[0].price_minor, is_active: true, delivery_scope: payload.variants[0].delivery_scope, pta_status: "unknown", condition: "unknown", ram_display: null, storage_display: null, color_finish: null, warranty_override: null, sim_configuration: null, condition_grade: null, battery_health_percent: null, battery_cycle_count: null });
        stock.set(vid, payload.variants[0].stock);
        next += 1;
        return { products: [{ id, title: payload.title, action: "Create" }], assigned_skus: [{ product: payload.title, sku: variants.get(vid).sku }] };
      },
      applyProduct: async (payload) => {
        calls.push(["apply", payload.product_id, Object.keys(payload.steps).join("+")]);
        if (failures.applyFails?.includes(payload.product_id)) throw new PhoneWriteError("apply_gadget_stock_product: function does not exist", false);
        if (failures.applyLost?.includes(payload.product_id)) throw new PhoneWriteError("No answer from the website (Failed to fetch)", "unknown");
        const p = products.get(payload.product_id);
        const v = variants.get(payload.expected.variant.id);
        if ((p.content ?? null) !== payload.expected.content || v.price_minor !== payload.expected.variant.price_minor) throw new PhoneWriteError("Changed since Check Changes", false);
        if (payload.steps.price) v.price_minor = payload.steps.price.to_minor;
        if (payload.steps.content) p.content = payload.steps.content.to;
        return { status: "ok" };
      },
    },
  };
}

const catalogFromDb = (db) => [...db.products.values()].map((p) => ({
  id: p.id, slug: p.slug, title: p.title, brand: null, category: "Gadgets", categorySlug: "gadgets", publicationStatus: p.publication_status, mediaCount: 0, specCount: 0, content: p.content,
  variants: [...db.variants.values()].filter((v) => v.product_id === p.id).map((v) => variant(v.id, { sku: v.sku, priceMinor: v.price_minor, stock: db.stock.get(v.id), isActive: v.is_active })),
}));

test("Update Website: existing price + description saved, stock unchanged; new product created with stock 20 and its description", async () => {
  const catalog = [product("p1", "Cable", { content: "Old" })];
  const db = fakeDb(catalog);
  const plan = buildGadgetPlan(compare([row(2, "Cable", 6000, "New cable text"), row(3, "Desk Fan", 3000, "Blue\n\nQuiet motor")], catalog));
  const result = await runGadgetUpdate(db.deps, plan);
  assert.deepEqual(result.products.map((item) => [item.productTitle, item.status]), [["Cable", "updated"], ["Desk Fan", "updated"]]);
  assert.equal(db.stock.get("p1-v001"), 7, "existing stock unchanged");
  assert.equal(db.products.get("p1").content, "New cable text");
  assert.equal(db.products.get("new1").content, "Blue\n\nQuiet motor");
  assert.equal(db.products.get("new1").publication_status, "draft");
  assert.equal(db.stock.get("new1-v"), 20);
  assert.deepEqual(result.products[1].newSkus, ["GD001"]);
  assert.deepEqual(db.calls, [["apply", "p1", "price+content"], ["create", "Desk Fan"], ["apply", "new1", "content"]]);
});

test("Partial success: created but description NOT saved is never reported as Updated; a retry updates the description and never creates twice", async () => {
  const db = fakeDb([], { applyFails: ["new1"] });
  const rows = [row(2, "Desk Fan", 3000, "Blue, quiet motor")];
  const first = await runGadgetUpdate(db.deps, buildGadgetPlan(compare(rows, [])));
  assert.equal(first.products[0].status, "partial");
  assert.match(first.products[0].reasons[0], /description was NOT saved/);
  assert.match(first.products[0].reasons[0], /not created twice/);
  assert.equal(first.counts.updated, 0);
  assert.match(first.message, /1 created without description/);
  assert.equal(db.products.get("new1").content, null);

  // Retry: a fresh Check Changes finds the draft by name -> Description Update, not a new product.
  const again = compare(rows, catalogFromDb(db));
  assert.equal(again.entries[0].kind, "update");
  assert.deepEqual(again.counts, { newProducts: 0, priceUpdates: 0, descriptionUpdates: 1, review: 0, same: 0 });
  const healed = fakeDb(catalogFromDb(db));
  const second = await runGadgetUpdate(healed.deps, buildGadgetPlan(compare(rows, catalogFromDb(healed))));
  assert.equal(second.products[0].status, "updated");
  assert.equal(healed.calls.some((call) => call[0] === "create"), false, "no second create");
  assert.equal(healed.products.get("new1").content, "Blue, quiet motor");
  assert.equal(healed.stock.get("new1-v"), 20);
});

test("Partial success: a lost answer on the description call is 'may not have been saved', not Updated", async () => {
  const db = fakeDb([], { applyLost: ["new1"] });
  const result = await runGadgetUpdate(db.deps, buildGadgetPlan(compare([row(2, "Desk Fan", 3000, "Blue")], [])));
  assert.equal(result.products[0].status, "partial");
  assert.match(result.products[0].reasons[0], /may not have been saved/);
});

test("Safe retry: creating a name that already exists is refused by the server and reported as Not saved", async () => {
  const db = fakeDb([product("p1", "Desk Fan")]);
  const stalePlan = buildGadgetPlan(compare([row(2, "Desk Fan", 3000, "Blue")], [])); // planned before the gadget existed
  const result = await runGadgetUpdate(db.deps, stalePlan);
  assert.equal(result.products[0].status, "failed");
  assert.equal(db.products.size, 1);
  assert.deepEqual(db.calls, [["create", "Desk Fan"]], "no description call after a refused create");
});

test("A failed existing update is Not saved; held rows are reported and never written; blocked environment writes nothing", async () => {
  const catalog = [product("p1", "Cable")];
  const db = fakeDb(catalog, { applyFails: ["p1"] });
  const plan = buildGadgetPlan(compare([row(2, "Cable", 6000), row(3, "", 10)], catalog));
  const result = await runGadgetUpdate(db.deps, plan);
  assert.deepEqual(result.products.map((item) => item.status), ["failed", "held"]);
  assert.equal(db.variants.get("p1-v001").price_minor, 500000);

  const blockedDb = fakeDb(catalog);
  const blocked = await runGadgetUpdate({ ...blockedDb.deps, supabaseUrl: PROD_URL, buildMode: "production", testWriteEnvironments: undefined }, plan);
  assert.equal(blocked.outcome, "blocked");
  assert.match(blocked.message, /not approved.*Nothing was written/);
  assert.deepEqual(blockedDb.calls, []);
});

// ---------------------------------------------------------------------------
// PDP description formatting (gadgets only)
// ---------------------------------------------------------------------------

test("PDP: gadget descriptions become paragraphs and lines; spacing is cleaned for display; text is never HTML", () => {
  assert.deepEqual(descriptionParagraphs("Colour: Black\r\nMaterial:   Aluminium\n\n\n  Features: <b>fast</b> charging  \n"), [
    ["Colour: Black", "Material: Aluminium"],
    ["Features: <b>fast</b> charging"],
  ]);
  assert.deepEqual(descriptionParagraphs("   \n \n"), []);
  assert.deepEqual(descriptionParagraphs(null), []);
  assert.equal(isGadgetProduct({ category: { id: "c", name: "Gadgets", slug: "gadgets" } }), true);
  assert.equal(isGadgetProduct({ category: { id: "c", name: "Mobile Phones", slug: "mobile-phones" } }), false);
});

test("PDP: only gadgets use the paragraph rendering, through React text (no dangerouslySetInnerHTML); other products keep one paragraph", () => {
  const app = readFileSync(new URL("../src/StorefrontApp.tsx", import.meta.url), "utf8");
  assert.match(app, /const gadgetParagraphs = isGadgetProduct\(product\) \? descriptionParagraphs\(product\.content\) : null;/);
  assert.match(app, /<div className="pdp-story-text">/);
  assert.match(app, /\) : \(\s*<p>\{product\.content\}<\/p>\s*\)\}/);
  assert.equal(app.includes("dangerouslySetInnerHTML"), false);
  const css = readFileSync(new URL("../src/styles.css", import.meta.url), "utf8");
  assert.match(css, /\.pdp-story-text p \+ p \{ margin-top:1em; \}/);
});
