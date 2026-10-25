import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolveCollection } from "../src/lib/collections.ts";

// DEV / PROD taxonomy shape: Gadgets is top level, Laptops and Tablets are its children, accessories are separate.
const taxonomy = {
  brands: [{ id: "b1", name: "Apple", slug: "apple" }],
  categories: [
    { id: "c1", name: "Gadgets", slug: "gadgets" },
    { id: "c2", name: "Laptops", slug: "laptops" },
    { id: "c3", name: "Tablets", slug: "tablets" },
    { id: "c4", name: "Mobile Accessories", slug: "mobile-accessories" },
    { id: "c5", name: "Mobile Phones", slug: "mobile-phones" },
  ],
};

test("Home Gadgets resolves to the gadgets category only", () => {
  const collection = resolveCollection("/collections/home-gadgets", taxonomy);
  assert.equal(collection?.available, true);
  assert.equal(collection?.title, "Home Gadgets");
  assert.deepEqual(collection?.filters.categories, ["gadgets"]);
  assert.deepEqual(collection?.filters.brands, []);
});

test("Home Gadgets type pages keep the gadgets category and their search term", () => {
  const collection = resolveCollection("/collections/home-gadgets", taxonomy, "?type=smart-home");
  assert.equal(collection?.available, true);
  assert.deepEqual(collection?.filters.categories, ["gadgets"]);
  assert.equal(collection?.filters.search, "Smart Home");
});

test("Mobile Accessories and Laptops & Tablets are unchanged", () => {
  assert.deepEqual(resolveCollection("/collections/mobile-accessories", taxonomy)?.filters.categories, ["mobile-accessories"]);
  const laptopsTablets = resolveCollection("/collections/laptops-tablets", taxonomy);
  assert.deepEqual([...(laptopsTablets?.filters.categories ?? [])].sort(), ["laptops", "tablets"]);
});

test("Gadgets Stock Update: new drafts need a primary image, not Condition / PTA / Warranty", () => {
  const page = readFileSync(new URL("../src/admin/GadgetStockUpdate.tsx", import.meta.url), "utf8");
  assert.match(page, /Created as drafts\. Add a primary image, then validate and publish when ready\. Stock starts at \$\{GADGET_NEW_PRODUCT_STOCK\}\./);
  assert.equal(/Condition, PTA, Warranty/.test(page), false);
});
