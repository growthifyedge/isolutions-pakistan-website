import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { pkrMajorInputFromMinor } from "../src/lib/money.ts";
import { parseUsedPhoneFacts, variantFacts } from "../src/lib/variantFacts.ts";
import { createCatalogTestDatabase, signInAsOwner } from "./support/catalogTestDatabase.mjs";

const admin = readFileSync(new URL("../src/admin/AdminCatalog.tsx", import.meta.url), "utf8").replace(/\r\n/g, "\n");
const facts = (row) => Object.fromEntries(variantFacts(row).map((fact) => [fact.label, fact.value]));

// The imported MB003 row as stored in the development database.
const mb003 = {
  sku: "MB003", ram_display: null, storage_display: "256 GB", color_finish: "Natural",
  price_minor: 26_500_000, compare_at_price_minor: null, pta_status: "not_approved", condition: "used",
  condition_grade: "A++", battery_health_percent: 89, battery_cycle_count: 312,
  delivery_scope: "karachi_only", is_active: true, quantity: 10,
};

test("used variant (MB003) renders every fact", () => {
  assert.deepEqual(facts(mb003), {
    RAM: "—", Storage: "256 GB", Color: "Natural", PTA: "Non-PTA", Condition: "Used", Grade: "A++",
    "Battery Health": "89%", "Cycle Count": "312", Delivery: "Karachi Only", Stock: "10", Status: "Active",
  });
  assert.equal(pkrMajorInputFromMinor(mb003.price_minor), "265000");
  // The row shows SKU, the facts list and a human PTA label.
  assert.ok(admin.includes("<div><dt>SKU</dt><dd>{v.sku}</dd></div>"));
  assert.ok(admin.includes("{variantFacts(v).map((fact) => ("));
  assert.ok(admin.includes("<span>{ptaLabel(v.pta_status)}</span>"));
  assert.equal(facts({ ...mb003, is_active: false }).Status, "Hidden");
});

test("brand-new variant needs no grade / battery facts and shows none", () => {
  const brandNew = { ...mb003, sku: "MB004", pta_status: "approved", condition: "brand_new", condition_grade: null, battery_health_percent: null, battery_cycle_count: null };
  const shown = facts(brandNew);
  assert.deepEqual([shown.Condition, shown.Grade, shown["Battery Health"], shown["Cycle Count"], shown.PTA], ["Brand New", "—", "—", "—", "PTA Approved"]);
  assert.deepEqual(parseUsedPhoneFacts({ condition: "brand_new", conditionGrade: "", batteryHealth: "", cycleCount: "" }),
    { ok: true, values: { condition_grade: null, battery_health_percent: null, battery_cycle_count: null } });
  // A leftover grade is cleared when the condition is not Used.
  assert.equal(parseUsedPhoneFacts({ condition: "brand_new", conditionGrade: "A++", batteryHealth: "", cycleCount: "" }).values.condition_grade, null);
});

test("editing used-phone facts: valid values, blanks stay NULL", () => {
  assert.deepEqual(parseUsedPhoneFacts({ condition: "used", conditionGrade: "A++", batteryHealth: "91", cycleCount: "205" }),
    { ok: true, values: { condition_grade: "A++", battery_health_percent: 91, battery_cycle_count: 205 } });
  assert.deepEqual(parseUsedPhoneFacts({ condition: "used", conditionGrade: "A++", batteryHealth: "", cycleCount: " " }),
    { ok: true, values: { condition_grade: "A++", battery_health_percent: null, battery_cycle_count: null } });
  assert.deepEqual(parseUsedPhoneFacts({ condition: "used", conditionGrade: null, batteryHealth: 100, cycleCount: 0 }),
    { ok: true, values: { condition_grade: null, battery_health_percent: 100, battery_cycle_count: 0 } });
});

test("invalid Battery Health and Cycle Count are blocked with a clear message", () => {
  for (const batteryHealth of ["0", "101", "89.5", "-3", "abc"])
    assert.deepEqual(parseUsedPhoneFacts({ condition: "used", conditionGrade: "A++", batteryHealth, cycleCount: "" }),
      { ok: false, message: "Battery Health must be a whole number from 1 to 100." }, batteryHealth);
  for (const cycleCount of ["-1", "1.5", "many"])
    assert.deepEqual(parseUsedPhoneFacts({ condition: "used", conditionGrade: "A++", batteryHealth: "", cycleCount }),
      { ok: false, message: "Cycle Count must be a whole number of 0 or more." }, cycleCount);
  assert.deepEqual(parseUsedPhoneFacts({ condition: "used", conditionGrade: "A+", batteryHealth: "", cycleCount: "" }),
    { ok: false, message: "Condition Grade must be A++." });
});

test("Admin add and edit forms save the facts; SKU stays read-only / assigned on save", () => {
  // Add form
  assert.ok(admin.includes('<input value="Assigned on save" disabled aria-disabled="true" />'));
  assert.ok(admin.includes("disabled={newVariant.condition !== \"used\"}"));
  assert.ok(admin.includes("value={newVariant.battery_health_percent}"));
  assert.ok(admin.includes("value={newVariant.battery_cycle_count}"));
  const add = admin.slice(admin.indexOf("const addVariant"), admin.indexOf("const saveVariantPrice"));
  assert.ok(add.includes("parseUsedPhoneFacts({") && add.includes("...usedFacts.values,"));
  assert.ok(!/\bsku\b/.test(add.replace("No SKU is sent", "")), "add never sends a SKU");
  // Edit dialog
  assert.ok(admin.includes("<input value={variantEditing.sku} readOnly aria-readonly=\"true\" />"));
  assert.ok(admin.includes("disabled={variantEditing.condition !== \"used\"}"));
  assert.ok(admin.includes("value={variantEditing.batteryHealthInput}"));
  assert.ok(admin.includes("value={variantEditing.cycleCountInput}"));
  const save = admin.slice(admin.indexOf("const saveVariantDetails"), admin.indexOf("const deleteVariant"));
  assert.ok(save.includes("parseUsedPhoneFacts({") && save.includes("...usedFacts.values,"));
  assert.ok(!/\bsku\b/.test(save), "edit never sends a SKU");
  // Price saving and stock movements are untouched.
  assert.ok(admin.includes("Save pricing"));
  assert.ok(admin.includes("Record movement"));
});

test("database accepts the Admin update and enforces the same rules", async () => {
  const db = await createCatalogTestDatabase();
  await signInAsOwner(db);
  await db.query(`select public.apply_catalog_bulk_import_v2($1::jsonb)`, [JSON.stringify({ products: [{
    action: "Create", source: "row 2", product_type: "Mobile Phone", brand: "Apple", title: "Apple iPhone 15 Pro", category: "Mobile Phones",
    specifications: [], variants: [{ source: "row 2", ram: null, storage: "256 GB", color: "Natural", price_minor: 26_500_000, stock: null,
      pta_status: "not_approved", condition: "used", condition_grade: "A++", battery_health_percent: 89, battery_cycle_count: 312,
      warranty: null, delivery_scope: "karachi_only" }],
  }] })]);
  const update = (values) => db.query(`update public.product_variants set condition = $1, condition_grade = $2, battery_health_percent = $3, battery_cycle_count = $4 where sku = 'MB001'`,
    [values.condition, values.condition_grade, values.battery_health_percent, values.battery_cycle_count]);
  await update({ condition: "used", condition_grade: "A++", battery_health_percent: 91, battery_cycle_count: 330 });
  await update({ condition: "used", condition_grade: "A++", battery_health_percent: null, battery_cycle_count: null });
  const row = (await db.query(`select sku, condition_grade, battery_health_percent, battery_cycle_count from public.product_variants where sku = 'MB001'`)).rows[0];
  assert.deepEqual(row, { sku: "MB001", condition_grade: "A++", battery_health_percent: null, battery_cycle_count: null });
  await assert.rejects(update({ condition: "brand_new", condition_grade: "A++", battery_health_percent: null, battery_cycle_count: null }), /variants_condition_grade_valid/);
  await assert.rejects(update({ condition: "used", condition_grade: null, battery_health_percent: 101, battery_cycle_count: null }), /variants_battery_health_range/);
  await assert.rejects(update({ condition: "used", condition_grade: null, battery_health_percent: null, battery_cycle_count: -1 }), /variants_battery_cycle_nonnegative/);
});
