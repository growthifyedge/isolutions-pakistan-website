import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { askSellerWhatsappUrl, isIphoneProduct, pdpProductInformation, pdpWarrantyText, simCustomerLabel } from "../src/lib/pdpCustomerFacts.ts";

const iphone = { brand: { id: "b", name: "Apple", slug: "apple" }, category: { id: "c", name: "Mobile Phones", slug: "mobile-phones" } };
const android = { brand: { id: "b", name: "Samsung", slug: "samsung" }, category: { id: "c", name: "Mobile Phones", slug: "mobile-phones" } };
const appleAccessory = { brand: { id: "b", name: "Apple", slug: "apple" }, category: { id: "c", name: "Chargers", slug: "chargers" } };
const variant = (condition, ptaStatus, extra = {}) => ({ condition, ptaStatus, warranty: null, simConfiguration: null, batteryHealthPercent: null, ...extra });
const rows = (product, v) => pdpProductInformation(product, v).map((row) => `${row.label}: ${row.value ?? "ASK"}${row.tone ? ` (${row.tone})` : ""}`);

test("iPhone = Apple brand in Mobile Phones only", () => {
  assert.equal(isIphoneProduct(iphone), true);
  assert.equal(isIphoneProduct(android), false);
  assert.equal(isIphoneProduct(appleAccessory), false);
  assert.equal(isIphoneProduct({ brand: null, category: iphone.category }), false);
});

test("Used + PTA Approved, nothing else saved: SIM and Battery Health ask the seller, no warranty row", () => {
  assert.deepEqual(rows(iphone, variant("used", "approved")), ["Condition: Used", "PTA Status: PTA Approved (positive)", "SIM Type: ASK", "Battery Health: ASK"]);
});

test("Used with saved Dual Physical SIM and battery health", () => {
  assert.deepEqual(rows(iphone, variant("used", "approved", { simConfiguration: "dual_physical_sim", batteryHealthPercent: 87 })),
    ["Condition: Used", "PTA Status: PTA Approved (positive)", "SIM Type: Dual Physical SIM", "Battery Health: 87%"]);
});

test("New + PTA Not Approved: red tone, Battery Health hidden, saved warranty shown", () => {
  assert.deepEqual(rows(iphone, variant("brand_new", "not_approved", { simConfiguration: "physical_plus_esim", warranty: "1 Year" })),
    ["Condition: New", "PTA Status: PTA Not Approved (negative)", "SIM Type: Physical SIM + eSIM", "Warranty: 1 Year"]);
});

test("unknown facts are asked, never guessed; PTA not applicable is left out", () => {
  assert.deepEqual(rows(iphone, variant("unknown", "unknown")), ["Condition: ASK", "PTA Status: ASK", "SIM Type: ASK", "Battery Health: ASK"]);
  assert.deepEqual(rows(iphone, variant("used", "not_applicable")), ["Condition: Used", "SIM Type: ASK", "Battery Health: ASK"]);
  assert.deepEqual(pdpProductInformation(iphone, undefined), []);
});

test("fields missing from older RPC data (undefined) count as not supplied", () => {
  assert.deepEqual(rows(iphone, { condition: "used", ptaStatus: "approved", warranty: null }), ["Condition: Used", "PTA Status: PTA Approved (positive)", "SIM Type: ASK", "Battery Health: ASK"]);
});

test("customer SIM labels for every canonical value; unknown or empty values are not shown", () => {
  assert.deepEqual(["physical_sim", "esim", "physical_plus_esim", "dual_esim", "dual_physical_sim"].map(simCustomerLabel),
    ["Physical SIM", "eSIM", "Physical SIM + eSIM", "Dual eSIM", "Dual Physical SIM"]);
  assert.equal(simCustomerLabel("triple_sim"), null);
  assert.equal(simCustomerLabel(null), null);
});

test("battery health outside 1-100 or non-integer is not shown", () => {
  for (const value of [0, 101, 87.5, -3]) assert.deepEqual(rows(iphone, variant("used", "approved", { batteryHealthPercent: value })).at(-1), "Battery Health: ASK");
});

test("Android and non-phone products get no Product Information block", () => {
  assert.deepEqual(pdpProductInformation(android, variant("brand_new", "approved", { warranty: "1 Year" })), []);
  assert.deepEqual(pdpProductInformation(appleAccessory, variant("brand_new", "approved")), []);
});

test("warranty: saved text shown as stored, NULL / blank hidden (no generic fallback)", () => {
  assert.equal(pdpWarrantyText({ warranty: "1 Year" }), "1 Year");
  assert.equal(pdpWarrantyText({ warranty: "  1 Year Official  " }), "1 Year Official");
  assert.equal(pdpWarrantyText({ warranty: null }), null);
  assert.equal(pdpWarrantyText({ warranty: "   " }), null);
  assert.equal(pdpWarrantyText(undefined), null);
});

test("Ask Seller link: Owner number, field, storage, colour and product URL, URL-encoded", () => {
  const url = askSellerWhatsappUrl({ whatsappNumber: "923132344912", productTitle: "Apple iPhone 13 Pro (Used)", storage: "256GB", color: "Graphite", field: "Battery Health", productUrl: "https://example.web.app/product/apple-iphone-13-pro-used" });
  assert.ok(url.startsWith("https://wa.me/923132344912?text="));
  const message = decodeURIComponent(url.split("?text=")[1]);
  assert.equal(message, "Assalam o Alaikum, mujhe Apple iPhone 13 Pro (Used), 256GB, Graphite ki Battery Health confirm karni hai.\nProduct: https://example.web.app/product/apple-iphone-13-pro-used");
  assert.ok(!/[ \n,:/?&#]/.test(url.split("?text=")[1]), "message is URL-encoded");
});

test("Ask Seller link leaves out missing storage / colour", () => {
  const url = askSellerWhatsappUrl({ whatsappNumber: "923132344912", productTitle: "Apple iPhone 15 (Used)", storage: null, color: "  ", field: "SIM Type", productUrl: "https://x/product/a" });
  assert.equal(decodeURIComponent(url.split("?text=")[1]), "Assalam o Alaikum, mujhe Apple iPhone 15 (Used) ki SIM Type confirm karni hai.\nProduct: https://x/product/a");
});

test("missing or invalid WhatsApp number gives no link", () => {
  for (const number of [null, undefined, "", "0313 2344912", "+923132344912", "123"])
    assert.equal(askSellerWhatsappUrl({ whatsappNumber: number, productTitle: "t", field: "SIM Type", productUrl: "u" }), null);
});

test("PDP source: no 'Warranty Support' fallback; block uses the helpers and the configured number", () => {
  const source = readFileSync(new URL("../src/StorefrontApp.tsx", import.meta.url), "utf8");
  assert.equal(source.includes("Warranty Support"), false);
  assert.match(source, /pdpWarrantyText\(variant\)/);
  assert.match(source, /warrantyText && !isIphoneProduct\(product\)/, "iPhones: no separate Warranty card (shown once in Product Information)");
  assert.match(source, /pdpProductInformation\(product, variant\)/);
  assert.match(source, /whatsappNumber: storefrontContact\.whatsappNumber/);
  assert.match(source, /target="_blank" rel="noopener noreferrer"/);
});

test("migration only adds the two variant keys to search_public_catalog", () => {
  const sql = readFileSync(new URL("../supabase/migrations/202610230002_public_catalog_variant_sim_battery.sql", import.meta.url), "utf8")
    .split("\n").filter((line) => !line.trim().startsWith("--")).join("\n");
  assert.match(sql, /'simConfiguration', v\.sim_configuration, 'batteryHealthPercent', v\.battery_health_percent/);
  assert.match(sql, /create or replace function public\.search_public_catalog\(/);
  assert.doesNotMatch(sql, /drop function|condition_grade|battery_cycle_count|insert into|update public|delete from|alter table|create policy/i);
});
