// Catalog → Variants & Pricing, fully editable (Owner-approved 2026-11-23): the page's plan (changed fields only, stock
// separately, new variants, problems) and its payload saved by the REAL apply_product_variant_edits in PGlite.
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import {
  buildVariantEditPlan,
  editConfirmationPhrase,
  editEnvironmentBlocker,
  newRowDefaults,
  rowFromVariant,
  tidyCapacity,
  verifyVariantEdit,
} from "../src/lib/variantEditor.ts";
import { call, everything, expected, ids, makeDb } from "./support/variantEditorTestDb.mjs";

const src = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8").replace(/\r\n/g, "\n");
const v = (sku, storage, color, price, extra = {}) => ({
  id: `id-${sku}`, sku, ram_display: "12 GB", storage_display: storage, color_finish: color, price_minor: price * 100, compare_at_price_minor: null,
  pta_status: "approved", condition: "brand_new", warranty_override: "1 Year", delivery_scope: "karachi_only", is_active: true, stock: 7, ...extra,
});
const s26 = () => [
  v("MB051", "256 GB", "Black", 389500), v("MB052", "256 GB", "Volt", 389500), v("MB053", "256 GB", "Blue", 389500), v("MB054", "256 GB", "White", 389500),
  v("MB055", "512 GB", "Black", 448000), v("MB056", "512 GB", "Volt", 443000, { is_active: false }), v("MB057", "512 GB", "Blue", 448000), v("MB058", "512 GB", "White", 448000),
];
const rowsOf = (variants, edits = {}) => Object.fromEntries(variants.map((variant) => [variant.id, { ...rowFromVariant(variant), ...(edits[variant.sku] ?? {}) }]));
const plan = (variants, edits, newRows = [], mobilePhone = true) => buildVariantEditPlan({ productId: "p1", mobilePhone, variants, rows: rowsOf(variants, edits), newRows });

test("S26 Ultra: 12/256 → 385,000, 512 Black + Blue → 438,000, new Cobalt 12/512 at 440,000 — only those fields are sent", () => {
  const variants = s26();
  const edits = { MB051: { price: "385000" }, MB052: { price: "385,000" }, MB053: { price: "385000" }, MB054: { price: "385000" }, MB055: { price: "438000" }, MB057: { price: "438000" } };
  const cobalt = { ...newRowDefaults(variants, true), color_finish: "Cobalt", storage_display: "512", price: "440000", stock: "30" };
  const p = plan(variants, edits, [cobalt]);
  assert.deepEqual(p.problems, []);
  assert.deepEqual(p.updates.map((u) => [u.sku, u.changes]), [
    ["MB051", { price_minor: 38500000 }], ["MB052", { price_minor: 38500000 }], ["MB053", { price_minor: 38500000 }], ["MB054", { price_minor: 38500000 }], ["MB055", { price_minor: 43800000 }], ["MB057", { price_minor: 43800000 }],
  ]);
  assert.deepEqual(p.updates[0].diffs, [{ field: "price_minor", label: "Price", from: "Rs 389,500", to: "Rs 385,000" }]);
  assert.deepEqual(p.stock, [], "stock untouched");
  assert.deepEqual(p.adds[0].values, { ram_display: "12 GB", storage_display: "512 GB", color_finish: "Cobalt", price_minor: 44000000, compare_at_price_minor: null, pta_status: "approved", condition: "brand_new", warranty_override: "1 Year", delivery_scope: "karachi_only", is_active: true });
  assert.equal(p.adds[0].stock, 30);
  assert.equal(p.changeCount, 7);
  assert.equal(editConfirmationPhrase(p), "SAVE 7 CHANGES");
  assert.equal(p.payload.expected.variants.length, 8);
  assert.ok(!("sku" in p.payload.expected.variants[0]));
});

test("every field: rename, RAM / storage, compare-at, stock (separately), PTA, condition, warranty, visibility", () => {
  const p = plan(s26(), {
    MB052: { color_finish: "Cobalt Violet" },
    MB051: { compare_at: "399000", stock: "12" },
    MB055: { pta_status: "not_approved", condition: "used", warranty_override: "" },
    MB056: { is_active: true },
    MB058: { ram_display: "16gb", storage_display: "1tb" },
  });
  assert.deepEqual(p.problems, []);
  const bySku = Object.fromEntries(p.updates.map((u) => [u.sku, u.changes]));
  assert.deepEqual(bySku, {
    MB051: { compare_at_price_minor: 39900000 },
    MB052: { color_finish: "Cobalt Violet" },
    MB055: { pta_status: "not_approved", condition: "used", warranty_override: null },
    MB056: { is_active: true },
    MB058: { ram_display: "16 GB", storage_display: "1 TB" },
  });
  assert.deepEqual(p.stock.map((s) => [s.sku, s.from, s.to]), [["MB051", 7, 12]]);
  assert.equal(p.changeCount, 9);
});

test("nothing changed → nothing sent; spacing / spelling of the same capacity is not a change; an old unknown fact is kept", () => {
  assert.equal(plan(s26(), { MB051: { ram_display: "12gb", storage_display: " 256  GB ", price: "389500" } }).changeCount, 0);
  assert.equal(tidyCapacity("1tb"), "1 TB");
  const odd = [v("MB051", "256 GB", "Black", 389500, { pta_status: "unknown", condition: "open_box", delivery_scope: null })];
  const p = plan(odd, { MB051: { price: "380000" } }, [], false);
  assert.deepEqual(p.problems, []);
  assert.deepEqual(p.updates[0].changes, { price_minor: 38000000 });
});

test("blocked before saving: bad price, compare-at not above price, bad stock, phone delivery, duplicates, incomplete new row", () => {
  const problems = (edits, rows = [], mobile = true) => plan(s26(), edits, rows, mobile).problems.join(" | ");
  assert.match(problems({ MB051: { price: "38a000" } }), /not an amount/);
  assert.match(problems({ MB051: { price: "" } }), /price is required/);
  assert.match(problems({ MB051: { compare_at: "389500" } }), /compare-at price must be above the price/);
  assert.match(problems({ MB051: { stock: "-1" } }), /stock must be a whole number/);
  assert.match(problems({ MB051: { stock: "100001" } }), /stock must be a whole number/);
  assert.match(problems({ MB051: { delivery_scope: "nationwide" } }), /mobile phones are delivered in Karachi only/);
  assert.equal(problems({ MB051: { delivery_scope: "nationwide" } }, [], false), "");
  assert.match(problems({ MB052: { color_finish: "black" } }), /MB051 and MB052 would be the same variant/);
  assert.match(problems({ MB051: { storage_display: "512gb" } }), /MB051 and MB055 would be the same variant/);
  const base = newRowDefaults(s26(), true);
  assert.match(problems({}, [{ ...base, color_finish: " BLACK ", storage_display: "256GB", price: "1" }]), /MB051 and New variant 1 would be the same variant/);
  assert.match(problems({}, [{ ...base, color_finish: "Green", price: "1" }, { ...base, color_finish: "green", price: "2" }]), /New variant 1 and New variant 2 would be the same variant/);
  assert.match(problems({}, [{ ...base, color_finish: "Green", price: "1", pta_status: "" }]), /choose PTA Approved/);
  assert.match(problems({}, [{ ...base, color_finish: "", storage_display: "", price: "1" }]), /storage or colour is required/);
  // A different PTA is a different variant.
  assert.equal(problems({}, [{ ...base, color_finish: "Black", storage_display: "256 GB", pta_status: "not_approved", price: "1" }]), "");
});

test("environment: saving only where the build matches its Supabase project", () => {
  assert.equal(editEnvironmentBlocker("https://acwatgxkcyrdxpcljxjb.supabase.co", "development"), null);
  assert.equal(editEnvironmentBlocker("https://nlxfwppywxumymbjkvwt.supabase.co", "production"), null);
  assert.match(editEnvironmentBlocker("https://nlxfwppywxumymbjkvwt.supabase.co", "development"), /must match/);
});

test("read-back after saving finds any difference", () => {
  const before = s26();
  const p = plan(before, { MB051: { price: "385000", stock: "9" } });
  const good = before.map((x) => (x.sku === "MB051" ? { ...x, price_minor: 38500000, stock: 9 } : x));
  assert.deepEqual(verifyVariantEdit(p, before, good), []);
  assert.match(verifyVariantEdit(p, before, before).join(" "), /MB051: Price is Rs 389,500, expected Rs 385,000.*MB051: stock is 7, expected 9/);
});

test("security: the page never writes a table; its only write is apply_product_variant_edits; typed confirmation; Owner check", () => {
  const page = src("src/admin/VariantManager.tsx");
  const logic = src("src/lib/variantEditor.ts");
  const db = src("src/lib/variantEditorDb.ts");
  for (const [name, text] of [["page", page], ["logic", logic], ["db", db]]) {
    assert.doesNotMatch(text, /\.(insert|upsert|update|delete)\s*\(/, `${name}: no direct table write`);
    assert.doesNotMatch(text, /service_role|SERVICE_ROLE/);
  }
  assert.deepEqual([...db.matchAll(/\.rpc\("([a-z_]+)"/g)].map((m) => m[1]), ["is_site_owner", "apply_product_variant_edits"]);
  assert.doesNotMatch(page + logic, /\.rpc\(/);
  // Owner decision 2026-11-24: no typed phrase — Save all opens a Confirm/Cancel dialog with the change count; Confirm runs the one save.
  assert.doesNotMatch(page, /editConfirmationPhrase|setConfirmation\(/);
  assert.match(page, /onClick=\{\(\) => setConfirmOpen\(true\)\}/);
  assert.match(page, /role="dialog" aria-modal="true" aria-labelledby="variant-save-confirm-title"/);
  assert.match(page, /Save \{plan\.changeCount\} change/);
  assert.match(page, /onClick=\{\(\) => setConfirmOpen\(false\)\}>Cancel</);
  assert.match(page, /onClick=\{\(\) => void save\(\)\}>Confirm</);
  assert.match(page, /if \(!supabase \|\| !plan\?\.payload \|\| saveBlocker\) return;/, "save() still re-checks every blocker");
  assert.match(page, /owner === false \? "Only the Owner can save variant changes\."/);
  const catalog = src("src/admin/AdminCatalog.tsx");
  assert.match(catalog, /\{variantManagerOn && serverSafeLive \? null : \(\s*<LegacyVariantTools collapsed=\{variantManagerOn\}>/);
});

test("end to end: the page's plan for the seeded S26 Ultra is saved exactly by the real function (isolated database)", async () => {
  const db = await makeDb();
  const exp = (await expected(db, ids.s26)).variants;
  const skus = Object.fromEntries((await db.query(`select id, sku from public.product_variants where product_id = $1`, [ids.s26])).rows.map((r) => [r.id, r.sku]));
  const variants = exp.map((row) => ({ ...row, sku: skus[row.id] }));
  const sku = (key) => ids[key].sku;
  const p = buildVariantEditPlan({
    productId: ids.s26,
    mobilePhone: true,
    variants,
    rows: rowsOf(variants, { [sku("b256")]: { price: "385000", compare_at: "399000" }, [sku("v256")]: { color_finish: "Cobalt Violet", stock: "3" }, [sku("v512")]: { is_active: true } }),
    newRows: [{ ...newRowDefaults(variants, true), color_finish: "Cobalt", storage_display: "512 GB", price: "440000", stock: "30" }],
  });
  assert.deepEqual(p.problems, []);
  await call(db, p.payload);
  const after = (await expected(db, ids.s26)).variants.map((row) => ({ ...row, sku: skus[row.id] ?? "NEW" }));
  assert.deepEqual(verifyVariantEdit(p, variants, after), []);
  // Saving the same (now stale) plan again is refused and changes nothing.
  const snapshot = await everything(db);
  await assert.rejects(call(db, p.payload), /variant_editor_changed_since_load/);
  assert.deepEqual(await everything(db), snapshot);
});

test("Discount %: Price = Compare-at × (1 − Discount % / 100), whole rupees; Price typed → Discount %; empty = no calculation", async () => {
  const { applyPricingEdit, discountFromPrices, parseDiscount, priceFromDiscount } = await import("../src/lib/variantEditor.ts");
  assert.equal(priceFromDiscount("1000", "20"), "800");
  assert.equal(priceFromDiscount("389500", "3.5"), "375868", "rounded to whole rupees");
  assert.equal(priceFromDiscount("1000", "99"), "10");
  for (const [compare, discount] of [["", "20"], ["0", "20"], ["abc", "20"], ["1000", "100"], ["1000", "-5"], ["1000", "20.555"], ["1000", "x"]]) assert.equal(priceFromDiscount(compare, discount), null, `${compare} / ${discount}`);
  assert.equal(discountFromPrices("800", "1000"), "20");
  assert.equal(discountFromPrices("385000", "399000"), "3.51");
  for (const [price, compare] of [["800", ""], ["800", "0"], ["1000", "1000"], ["1200", "1000"], ["", "1000"]]) assert.equal(discountFromPrices(price, compare), "", `no wrong discount: ${price} / ${compare}`);
  assert.equal(parseDiscount("0"), 0);
  assert.equal(parseDiscount("99.5"), null);
  const base = { ...rowFromVariant(s26()[0]), price: "1000", compare_at: "", discount: "" };
  // Compare-at alone (empty Discount %): no automatic calculation.
  assert.deepEqual(applyPricingEdit(base, "compare_at", "1250"), { ...base, compare_at: "1250" });
  // Discount typed: Price recalculated; Compare-at changed afterwards: Price follows the Discount %.
  const discounted = applyPricingEdit({ ...base, compare_at: "1000" }, "discount", "20");
  assert.deepEqual([discounted.price, discounted.discount], ["800", "20"]);
  assert.deepEqual([applyPricingEdit(discounted, "compare_at", "1500").price], ["1200"]);
  // Price typed by hand: Discount % follows (or empty without a valid Compare-at).
  assert.equal(applyPricingEdit(discounted, "price", "750").discount, "25");
  assert.equal(applyPricingEdit(base, "price", "750").discount, "");
  // An invalid Discount % never changes the Price.
  assert.equal(applyPricingEdit(discounted, "discount", "150").price, "800");
});

test("Discount %: nothing applied to existing variants; only the Owner's edit is saved, as a price change (the % is never stored)", () => {
  const variants = s26().map((variant) => (variant.sku === "MB051" ? { ...variant, compare_at_price_minor: 40000000 } : variant));
  const rows = rowsOf(variants);
  assert.equal(rows["id-MB051"].discount, "2.63", "shown from the saved prices (2.625 % rounded)");
  assert.equal(plan(variants, {}).changeCount, 0, "no automatic change");
  const edited = buildVariantEditPlan({ productId: "p1", mobilePhone: true, variants, newRows: [], rows: { ...rows, "id-MB051": { ...rows["id-MB051"], discount: "5", price: "380000" } } });
  assert.deepEqual(edited.problems, []);
  assert.deepEqual(edited.updates.map((update) => [update.sku, update.changes]), [["MB051", { price_minor: 38000000 }]]);
  assert.ok(!JSON.stringify(edited.payload).includes("discount"), "no discount field is sent");
  // Discount 0 % would make Price = Compare-at: refused by the existing rule, never saved.
  const zero = buildVariantEditPlan({ productId: "p1", mobilePhone: true, variants, newRows: [], rows: { ...rows, "id-MB051": { ...rows["id-MB051"], discount: "0", price: "400000" } } });
  assert.match(zero.problems.join(" "), /compare-at price must be above the price/);
  const invalid = buildVariantEditPlan({ productId: "p1", mobilePhone: true, variants, newRows: [], rows: { ...rows, "id-MB051": { ...rows["id-MB051"], discount: "120" } } });
  assert.match(invalid.problems.join(" "), /Discount % must be a number from 0 to 99/);
});
