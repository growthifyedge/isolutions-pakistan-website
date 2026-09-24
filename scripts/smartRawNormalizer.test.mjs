import assert from "node:assert/strict";
import test from "node:test";
import { normalizeRawCatalog } from "../src/lib/bulkCatalog.ts";

const product = (source) => normalizeRawCatalog(source).products[0];

test("normalizes a shared-price color group", () => {
  const parsed = product("Samsung\nA07 4/64 black/green @ 34800");
  assert.equal(parsed.brand, "Samsung");
  assert.equal(parsed.category, "Mobile Phones");
  assert.deepEqual(parsed.variants.map((item) => [item.ram, item.storage, item.color, item.pricePkr]), [
    ["4 GB", "64 GB", "black", "34800"], ["4 GB", "64 GB", "green", "34800"],
  ]);
});

test("maps two color-price groups without guessing", () => {
  const parsed = product("Samsung\nA56 8/256 pink @ 113000/114500 olive");
  assert.deepEqual(parsed.variants.map((item) => [item.color, item.pricePkr]), [
    ["pink", "113000"], ["olive", "114500"],
  ]);
});

test("maps grouped colors to their explicit price groups", () => {
  const parsed = product("Samsung\nS26 Ultra 12/512 blue/white @ 440000/445000 black/volt");
  assert.deepEqual(parsed.variants.map((item) => [item.color, item.pricePkr]), [
    ["blue", "440000"], ["white", "440000"], ["black", "445000"], ["volt", "445000"],
  ]);
});

test("keeps explicit non-PTA and Samsung tablet context", () => {
  const fold = product("Samsung\nFold 8 ultra 12/512 graphite/purple/cream/green @ 485000 Non PTA");
  assert.ok(fold.variants.every((item) => item.ptaStatus === "not_approved"));
  const tab = product("Samsung Tab\nNon Warranty\nA11 wifi 4/64 silver @ 36500");
  assert.equal(tab.brand, "Samsung");
  assert.equal(tab.category, "Tablets");
  assert.equal(tab.defaultWarranty, "Non Warranty");
});

test("flags a missing price and maps power banks to Accessories", () => {
  const missing = product("Infinix\nHot 70 6/128 black/blue/silver/volt @");
  assert.ok(missing.variants.every((item) => item.warnings.includes("Price missing or invalid")));
  const powerBank = product("Itel\nITel Power Bank 100000 mAh @ 20200");
  assert.equal(powerBank.category, "Accessories");
  assert.equal(product("Apple\nMacBook Air M3 16/512 Midnight @ 330000").category, "Laptops");
  assert.equal(product("Apple\niPad Air 11 128 Blue @ 190000").category, "Tablets");
});
