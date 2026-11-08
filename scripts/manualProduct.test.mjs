import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  checkManualProduct,
  checkSpecEdit,
  emptyManualVariant,
  liveProductProblems,
  runManualCreate,
  safeProductPatch,
  stockMovementTo,
  withVariant,
} from "../src/lib/manualProduct.ts";
import { commercialWriteTarget } from "../src/lib/commercialDefaults.ts";

const catalog = [
  { id: "p1", title: "Xiaomi Redmi Buds 8", slug: "xiaomi-redmi-buds-8", brandName: "Xiaomi" },
  { id: "p2", title: "Mini Fan Y05", slug: "mini-fan-y05", brandName: null },
];
const brands = ["Xiaomi", "Samsung", "JBL"];
const variant = (patch = {}) => ({ ...emptyManualVariant(), price: "1500", stock: "5", delivery: "nationwide", ...patch });
const input = (patch = {}) => ({ category: "gadgets", title: "USB Desk Lamp", brandName: "", content: "One.\r\n\r\nTwo.  ", shortDescription: "", variants: [variant()], specs: [], ...patch });

test("Add Product: a valid gadget becomes ONE Create product for apply_catalog_bulk_import_v2", () => {
  const result = checkManualProduct(input({ variants: [variant({ color: "Black", compareAt: "1800", warranty: "6 Months" }), variant({ color: "White", stock: "0" })] }), catalog, brands);
  assert.equal(result.ok, true, result.errors.join("; "));
  assert.equal(result.slug, "usb-desk-lamp");
  const product = result.payload.products[0];
  assert.equal(result.payload.products.length, 1);
  assert.equal(product.action, "Create");
  assert.equal(product.product_type, "Gadget");
  assert.equal(product.brand, null);
  assert.deepEqual(product.variants.map((v) => [v.color, v.price_minor, v.compare_at_price_minor, v.stock, v.warranty, v.delivery_scope, v.pta_status, v.condition]), [
    ["Black", 150000, 180000, 5, "6 Months", "nationwide", null, null],
    ["White", 150000, null, 0, null, "nationwide", null, null],
  ]);
  assert.ok(product.variants.every((v) => v.sim_configuration === null && v.ram === null && v.storage === null), "phone-only facts are never sent");
  assert.deepEqual(result.description, { content: "One.\n\nTwo.", short_description: null });
});

test("Add Product: accessories need PTA and condition; delivery is always required; blank facts stay null", () => {
  const missing = checkManualProduct(input({ category: "mobile-accessories", variants: [variant({ delivery: "" })] }), catalog, brands);
  assert.equal(missing.ok, false);
  assert.ok(missing.errors.some((e) => /PTA status/.test(e)));
  assert.ok(missing.errors.some((e) => /condition/.test(e)));
  assert.ok(missing.errors.some((e) => /delivery area/.test(e)));
  const ok = checkManualProduct(input({ category: "mobile-accessories", brandName: "JBL", title: "JBL Tune 520BT", variants: [variant({ pta: "not_applicable", condition: "brand_new" })] }), catalog, brands);
  assert.equal(ok.ok, true, ok.errors.join("; "));
  assert.equal(ok.payload.products[0].product_type, "Accessory");
  assert.equal(ok.payload.products[0].brand, "JBL");
});

test("Add Product: duplicates are refused before anything is sent (name + brand, web address)", () => {
  const sameName = checkManualProduct(input({ category: "mobile-accessories", title: " xiaomi  redmi buds 8 ", brandName: "Xiaomi", variants: [variant({ pta: "not_applicable", condition: "brand_new" })] }), catalog, brands);
  assert.equal(sameName.ok, false);
  assert.match(sameName.errors.join(" "), /already exists/);
  assert.equal(sameName.payload, null);
  const sameSlug = checkManualProduct(input({ title: "Mini-Fan Y05", brandName: "Samsung" }), catalog, brands);
  assert.match(sameSlug.errors.join(" "), /web address "mini-fan-y05" is already used/);
  const otherBrand = checkManualProduct(input({ title: "Mini Fan Y05 Pro" }), catalog, brands);
  assert.equal(otherBrand.ok, true);
});

test("Add Product: prices, compare-at, stock, colours, brand, specs are checked", () => {
  const bad = checkManualProduct(input({
    brandName: "Unknown Co",
    variants: [variant({ color: "Black", price: "0" }), variant({ color: "black", price: "abc", stock: "-1" }), variant({ color: "Blue", compareAt: "1000" })],
    specs: [{ section: "Battery", label: "Capacity", value: "" }, { section: "Nope", label: "X", value: "Y" }, { section: "", label: "A", value: "1" }, { section: "", label: "a", value: "2" }],
  }), catalog, brands);
  const text = bad.errors.join(" | ");
  for (const pattern of [/not an active brand/, /price must be more than 0/, /same colour is listed twice/, /price: Enter a non-negative/, /stock must be a whole number/, /compare-at price must be higher/, /name and value are both required/, /unknown section "Nope"/, /listed twice in the same section/]) {
    assert.match(text, pattern);
  }
  assert.equal(checkManualProduct(input({ variants: [] }), catalog, brands).ok, false);
  assert.match(checkManualProduct(input({ category: "" }), catalog, brands).errors[0], /Choose a category/);
});

const live = (patch = {}) => ({
  categorySlug: "mobile-accessories",
  title: "JBL Tune 660NC",
  brandId: "b-jbl",
  activeRealBrandIds: ["b-jbl"],
  variants: [{ id: "v1", is_active: true, price_minor: 1750000, delivery_scope: "nationwide", pta_status: "not_applicable", condition: "brand_new" }],
  hasPrimaryImage: true,
  ...patch,
});

test("Live product rules (checked BEFORE saving) mirror the server publish rules for Gadgets / Accessories", () => {
  assert.deepEqual(liveProductProblems(live()), []);
  assert.match(liveProductProblems(withVariant(live(), "v1", null)).join(" "), /at least one active variant/);
  assert.match(liveProductProblems(withVariant(live(), "v1", { price_minor: 0 })).join(" "), /price above 0/);
  assert.match(liveProductProblems(withVariant(live(), "v1", { delivery_scope: null })).join(" "), /delivery area/);
  assert.match(liveProductProblems(withVariant(live(), "v1", { pta_status: "unknown" })).join(" "), /PTA status and condition/);
  assert.deepEqual(liveProductProblems(withVariant(live({ categorySlug: "gadgets" }), "v1", { pta_status: "unknown", condition: "unknown" })), [], "gadgets are exempt from PTA/condition");
  assert.match(liveProductProblems(live({ hasPrimaryImage: false })).join(" "), /primary image/);
  assert.match(liveProductProblems(live({ title: "  " })).join(" "), /name cannot be empty/);
  assert.match(liveProductProblems(live({ brandId: "b-old" })).join(" "), /active brand/);
  assert.deepEqual(liveProductProblems(live({ brandId: null })), [], "no brand is allowed");
  const hiddenOnly = live({ variants: [{ ...live().variants[0], is_active: false }] });
  assert.match(liveProductProblems(hiddenOnly).join(" "), /at least one active variant/);
});

test("Save changes payload never includes publication status, category, slug or data class", () => {
  const patch = safeProductPatch({ title: " Name ", brand_id: "", slug: "x", category_id: "c", data_class: "development", publication_status: "draft", content: " ", short_description: "S", default_condition: "brand_new", default_pta_status: "unknown", is_featured: true });
  for (const key of ["publication_status", "category_id", "slug", "data_class", "id"]) assert.equal(key in patch, false, key);
  assert.equal(patch.title, "Name");
  assert.equal(patch.brand_id, null);
  assert.equal(patch.content, null);
  assert.equal(patch.is_featured, true);
  assert.equal(patch.is_best_seller, false);
});

test("Set stock: one movement for the difference; invalid or unchanged targets are refused", () => {
  assert.deepEqual(stockMovementTo(10, "25"), { ok: true, delta: 15 });
  assert.deepEqual(stockMovementTo(10, "0"), { ok: true, delta: -10 });
  assert.equal(stockMovementTo(10, "10").ok, false);
  assert.equal(stockMovementTo(10, "-1").ok, false);
  assert.equal(stockMovementTo(10, "2.5").ok, false);
  assert.equal(stockMovementTo(10, "").ok, false);
});

test("Spec edit: required name/value, length limits, no duplicate name in the same section (self excluded)", () => {
  const specs = [{ id: "s1", specification_group: "Battery", label: "Capacity" }, { id: "s2", specification_group: null, label: "Weight" }];
  assert.equal(checkSpecEdit({ section: "Battery", label: "Capacity", value: "500mAh" }, specs, "s1"), null);
  assert.match(checkSpecEdit({ section: "battery", label: "capacity", value: "x" }, specs, null), /already exists/);
  assert.equal(checkSpecEdit({ section: "Build", label: "Capacity", value: "x" }, specs, null), null, "same name in another section is fine");
  assert.match(checkSpecEdit({ section: "", label: "", value: "x" }, specs, null), /both required/);
  assert.match(checkSpecEdit({ section: "", label: "x".repeat(121), value: "x" }, specs, null), /120/);
  assert.equal(checkSpecEdit({ section: "Memory", label: "RAM", value: "8 GB" }, specs, null), null, "older section names stay editable");
});

const DEV = { supabaseUrl: "https://acwatgxkcyrdxpcljxjb.supabase.co", buildMode: "development" };
const validCheck = () => checkManualProduct(input({ variants: [variant({ color: "Black" })], specs: [{ section: "Build", label: "Material", value: "ABS" }] }), catalog, brands);
const readBack = (patch = {}) => ({
  id: "new-1", title: "USB Desk Lamp", slug: "usb-desk-lamp", publication_status: "draft", data_class: "real", category_slug: "gadgets",
  content: "One.\n\nTwo.", short_description: null, variants: [{ sku: "GD032", color: "Black", price_minor: 150000, on_hand: 5 }], spec_count: 1, ...patch,
});

test("Create: one server call, description on the Draft only, full read-back", async () => {
  const calls = [];
  const deps = {
    ...DEV,
    createProduct: async (payload) => { calls.push(["create", payload]); return { products: [{ id: "new-1", title: "USB Desk Lamp", action: "Create" }], assigned_skus: [{ sku: "GD032" }] }; },
    saveDescription: async (id, values) => { calls.push(["description", id, values]); },
    readBack: async () => readBack(),
  };
  const result = await runManualCreate(validCheck(), deps, commercialWriteTarget);
  assert.equal(result.status, "created", result.message);
  assert.equal(result.productId, "new-1");
  assert.deepEqual(calls.map((call) => call[0]), ["create", "description"]);
  assert.deepEqual(calls[1][2], { content: "One.\n\nTwo." });
  assert.ok(result.checks.every((check) => check.ok));
});

test("Create: blocked environment / invalid form never call the server; failures are reported honestly", async () => {
  let called = 0;
  const deps = { ...DEV, createProduct: async () => { called += 1; throw new Error('"USB Desk Lamp" already exists; use Replace Existing'); }, saveDescription: async () => {}, readBack: async () => readBack() };
  assert.equal((await runManualCreate(validCheck(), { ...deps, buildMode: "production" }, commercialWriteTarget)).status, "blocked");
  assert.equal((await runManualCreate(checkManualProduct(input({ title: "" }), catalog, brands), deps, commercialWriteTarget)).status, "blocked");
  assert.equal(called, 0);
  const failed = await runManualCreate(validCheck(), deps, commercialWriteTarget);
  assert.equal(failed.status, "failed");
  assert.match(failed.message, /already exists/);
  const partial = await runManualCreate(validCheck(), {
    ...deps,
    createProduct: async () => ({ products: [{ id: "new-1", title: "USB Desk Lamp", action: "Create" }], assigned_skus: [] }),
    saveDescription: async () => { throw new Error("network"); },
    readBack: async () => readBack({ content: null }),
  }, commercialWriteTarget);
  assert.equal(partial.status, "created_with_problems");
  assert.match(partial.message, /Description NOT saved/);
});

test("Wiring: route + nav; editor guards every write on a live Gadget / Accessory and never resets it to Draft", () => {
  const app = readFileSync(new URL("../src/admin/AdminApp.tsx", import.meta.url), "utf8").replace(/\r\n/g, "\n");
  assert.match(app, /\["Add Product", "\/admin\/products\/add", PackagePlus\]/);
  assert.ok(app.indexOf('path === "/admin/products/add"') < app.indexOf('path.startsWith("/admin/products/")'), "Add Product route comes before the editor route");
  const editor = readFileSync(new URL("../src/admin/AdminCatalog.tsx", import.meta.url), "utf8").replace(/\r\n/g, "\n");
  const saveChanges = editor.match(/const saveChanges = async \(\) => \{[\s\S]*?\n  \};/)[0];
  assert.ok(saveChanges.indexOf("liveProblemsAfter") < saveChanges.indexOf('.from("products").update'), "checked before saving");
  assert.equal(saveChanges.includes("publication_status"), false);
  assert.match(saveChanges, /safeProductPatch\(/);
  for (const name of ["addVariant", "saveVariantPrice", "saveVariantDetails", "deleteVariant"]) {
    const body = editor.match(new RegExp(`const ${name} = async [^\\n]*\\n[\\s\\S]*?\\n  \\};`))[0];
    assert.match(body, /if \(liveGuard\) \{[\s\S]*?liveProblemsAfter/, `${name} is checked before saving`);
  }
  assert.match(editor, /liveGuard \? \(\s*<button className="admin-secondary" onClick=\{\(\) => void saveChanges\(\)\}>/);
  assert.match(editor, /value=\{draft\.category_id\}\s*disabled=\{manualMode \|\| serverSafeLive\}/);
  // Phones / tablets keep their existing Save draft behaviour.
  assert.match(editor, /publication_status: "draft" as const,/);
});
