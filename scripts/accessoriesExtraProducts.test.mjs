import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  ACCESSORIES_EXTRA_DISPLAY_BRAND,
  ACCESSORIES_EXTRA_PRODUCT_IDS,
  accessoryMatchesBrandTab,
  mergeCollectionExtras,
  resolveCollection,
  shouldFetchCollectionBase,
} from "../src/lib/collections.ts";

const brands = [{ id: "b1", name: "Samsung", slug: "samsung" }];
const gadgets = { id: "c1", name: "Gadgets", slug: "gadgets" };
const accessories = { id: "c4", name: "Accessories", slug: "mobile-accessories" };
const phones = { id: "c5", name: "Mobile Phones", slug: "mobile-phones" };

test("the Owner-approved list is exactly 16 unique product IDs", () => {
  assert.equal(ACCESSORIES_EXTRA_PRODUCT_IDS.length, 16);
  assert.equal(new Set(ACCESSORIES_EXTRA_PRODUCT_IDS).size, 16);
  for (const id of ACCESSORIES_EXTRA_PRODUCT_IDS) assert.match(id, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
});

test("PROD today: no published accessory -> the page shows only the 16 extras, never an unfiltered list", () => {
  const collection = resolveCollection("/collections/mobile-accessories", { brands, categories: [gadgets, phones] });
  assert.equal(collection?.available, true);
  assert.deepEqual(collection?.filters.categories, []);
  assert.deepEqual(collection?.extraProducts?.categories, ["gadgets"]);
  assert.equal(collection?.extraProducts?.baseCategory, false);
  assert.equal(shouldFetchCollectionBase(collection), false);
});

test("with published accessories the own category stays and the extras are added", () => {
  const collection = resolveCollection("/collections/mobile-accessories", { brands, categories: [gadgets, accessories, phones] });
  assert.deepEqual(collection?.filters.categories, ["mobile-accessories"]);
  assert.equal(collection?.extraProducts?.baseCategory, true);
  assert.equal(shouldFetchCollectionBase(collection), true);
});

test("type pages and other collections are unchanged (no extras)", () => {
  const taxonomy = { brands, categories: [gadgets, accessories, phones] };
  assert.equal(resolveCollection("/collections/mobile-accessories", taxonomy, "?type=chargers")?.extraProducts, undefined);
  assert.equal(resolveCollection("/collections/mobile-accessories", taxonomy, "?type=audio&brand=samsung")?.extraProducts, undefined);
  const home = resolveCollection("/collections/home-gadgets", taxonomy);
  assert.deepEqual(home?.filters.categories, ["gadgets"]);
  assert.equal(home?.extraProducts, undefined);
  assert.equal(shouldFetchCollectionBase(home), true);
  assert.equal(resolveCollection("/collections/mobile-phones", taxonomy)?.extraProducts, undefined);
});

test("no Gadgets category published -> nothing extra and the old behaviour", () => {
  const collection = resolveCollection("/collections/mobile-accessories", { brands, categories: [phones] });
  assert.equal(collection?.available, false);
  assert.equal(collection?.extraProducts, undefined);
});

test("merge keeps only listed IDs, keeps order and never repeats a product", () => {
  const [a, b] = ACCESSORIES_EXTRA_PRODUCT_IDS;
  const base = [{ id: "acc-1" }, { id: a }];
  const extras = [{ id: "other-gadget" }, { id: b }, { id: a }];
  assert.deepEqual(mergeCollectionExtras(base, extras, ACCESSORIES_EXTRA_PRODUCT_IDS).map((p) => p.id), ["acc-1", a, b]);
  assert.deepEqual(mergeCollectionExtras([], [{ id: "x" }], ACCESSORIES_EXTRA_PRODUCT_IDS), []);
});

test("storefront wires the extras into the collection page and the homepage Accessories section", () => {
  const app = readFileSync(new URL("../src/StorefrontApp.tsx", import.meta.url), "utf8");
  assert.equal((app.match(/mergeCollectionExtras\(/g) ?? []).length, 2);
  assert.equal((app.match(/shouldFetchCollectionBase\(collection\)/g) ?? []).length, 2);
  // Card label: extras in Mobile Accessories say Accessories; everywhere else the database category is shown.
  assert.match(app, /\{categoryLabel \?\? product\.category\.name\}/);
  assert.match(app, /categoryLabel=\{collection\?\.extraProducts\?\.productIds\.includes\(product\.id\) \? collection\.extraProducts\.cardCategory : undefined\}/);
  assert.match(app, /accessoryMatchesBrandTab\(product, tabSlug\)/);
});

test("Accessories card label for the extras; Home Gadgets has no override", () => {
  const taxonomy = { brands, categories: [gadgets, phones] };
  assert.equal(resolveCollection("/collections/mobile-accessories", taxonomy)?.extraProducts?.cardCategory, "Accessories");
  assert.equal(resolveCollection("/collections/home-gadgets", taxonomy)?.extraProducts, undefined);
});

test("Xiaomi tab: the 4 approved Mi / Redmi products by ID only; real brands still match", () => {
  const xiaomiIds = Object.entries(ACCESSORIES_EXTRA_DISPLAY_BRAND).filter(([, slug]) => slug === "xiaomi").map(([id]) => id);
  assert.equal(xiaomiIds.length, 4);
  for (const id of xiaomiIds) assert.ok(ACCESSORIES_EXTRA_PRODUCT_IDS.includes(id));
  assert.equal(accessoryMatchesBrandTab({ id: xiaomiIds[0], brand: null }, "xiaomi"), true);
  assert.equal(accessoryMatchesBrandTab({ id: xiaomiIds[0], brand: null }, "samsung"), false);
  assert.equal(accessoryMatchesBrandTab({ id: "some-other-id", brand: null }, "xiaomi"), false);
  assert.equal(accessoryMatchesBrandTab({ id: "x", brand: { slug: "samsung" } }, "samsung"), true);
  assert.equal(accessoryMatchesBrandTab({ id: "x", brand: { slug: "samsung" } }, "xiaomi"), false);
});
