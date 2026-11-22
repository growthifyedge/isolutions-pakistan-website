// Admin → Catalog → Products: Category + Subcategory filter (2026-11-21, localhost). Pure helpers + wiring checks.
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import {
  NO_CATEGORY_FILTER,
  adminProductMatchesCategory,
  adminProductMatchesQuery,
  countBy,
  subcategoriesForCategory,
  withCategory,
} from "../src/lib/adminProductSearch.ts";

const catalog = readFileSync(new URL("../src/admin/AdminCatalog.tsx", import.meta.url), "utf8").replace(/\r\n/g, "\n");

const PHONES = "cat-phones";
const GADGETS = "cat-gadgets";
const KITCHEN = "sub-kitchen";
const CLEANING = "sub-cleaning";
const OLD = "sub-old";
const subcategories = [
  { id: CLEANING, name: "Cleaning", category_id: GADGETS, is_active: true, sort_order: 2 },
  { id: KITCHEN, name: "Kitchen", category_id: GADGETS, is_active: true, sort_order: 1 },
  { id: OLD, name: "Old", category_id: GADGETS, is_active: false, sort_order: 3 },
];
const product = (title, category_id, subcategory_id, sku) => ({
  title, slug: title.toLowerCase().replace(/\s+/g, "-"), brand: null, category_id, subcategory_id,
  product_variants: [{ sku, storage_display: null, color_finish: null }],
});
const products = [
  product("iPhone 15", PHONES, null, "MB001"),
  product("Galaxy A57", PHONES, null, "MB002"),
  product("Water Nozzle", GADGETS, CLEANING, "GD001"),
  product("Chopper", GADGETS, KITCHEN, "GD002"),
  product("Mop", GADGETS, null, "GD003"),
];
const list = (filter, query = "") =>
  products.filter((p) => adminProductMatchesQuery(p, query) && adminProductMatchesCategory(p, filter)).map((p) => p.title);

test("no filter = every product", () => {
  assert.deepEqual(list(NO_CATEGORY_FILTER), products.map((p) => p.title));
});

test("category shows all its products (with or without a subcategory)", () => {
  assert.deepEqual(list({ categoryId: GADGETS, subcategoryId: "" }), ["Water Nozzle", "Chopper", "Mop"]);
  assert.deepEqual(list({ categoryId: PHONES, subcategoryId: "" }), ["iPhone 15", "Galaxy A57"]);
});

test("subcategory shows only that subcategory's products", () => {
  assert.deepEqual(list({ categoryId: GADGETS, subcategoryId: KITCHEN }), ["Chopper"]);
  assert.deepEqual(list({ categoryId: GADGETS, subcategoryId: CLEANING }), ["Water Nozzle"]);
});

test("name / SKU search combines with the filters; no match = empty list", () => {
  assert.deepEqual(list({ categoryId: GADGETS, subcategoryId: "" }, "gd00"), ["Water Nozzle", "Chopper", "Mop"]);
  assert.deepEqual(list({ categoryId: GADGETS, subcategoryId: "" }, "MB001"), []);
  assert.deepEqual(list({ categoryId: PHONES, subcategoryId: "" }, "galaxy"), ["Galaxy A57"]);
  assert.deepEqual(list({ categoryId: GADGETS, subcategoryId: KITCHEN }, "nozzle"), []);
});

test("a product without subcategory_id (older database) only matches when no subcategory is chosen", () => {
  const legacy = { category_id: GADGETS };
  assert.equal(adminProductMatchesCategory(legacy, { categoryId: GADGETS, subcategoryId: "" }), true);
  assert.equal(adminProductMatchesCategory(legacy, { categoryId: GADGETS, subcategoryId: KITCHEN }), false);
});

test("subcategory options: own category only, stored order, inactive only while used", () => {
  assert.deepEqual(subcategoriesForCategory(GADGETS, subcategories, products).map((s) => s.name), ["Kitchen", "Cleaning"]);
  assert.deepEqual(subcategoriesForCategory(PHONES, subcategories, products), []);
  assert.deepEqual(subcategoriesForCategory("", subcategories, products), []);
  const usingOld = [...products, product("Old thing", GADGETS, OLD, "GD009")];
  assert.deepEqual(subcategoriesForCategory(GADGETS, subcategories, usingOld).map((s) => s.name), ["Kitchen", "Cleaning", "Old"]);
});

test("changing category clears a subcategory of another category; All categories resets both", () => {
  assert.deepEqual(withCategory({ categoryId: GADGETS, subcategoryId: KITCHEN }, PHONES, subcategories), { categoryId: PHONES, subcategoryId: "" });
  assert.deepEqual(withCategory({ categoryId: GADGETS, subcategoryId: KITCHEN }, GADGETS, subcategories), { categoryId: GADGETS, subcategoryId: KITCHEN });
  assert.deepEqual(withCategory({ categoryId: GADGETS, subcategoryId: KITCHEN }, "", subcategories), NO_CATEGORY_FILTER);
});

test("counts per category and subcategory", () => {
  assert.equal(countBy(products, "category_id").get(GADGETS), 3);
  assert.equal(countBy(products, "subcategory_id").get(KITCHEN), 1);
  assert.equal(countBy(products, "subcategory_id").has(""), false);
});

test("Products list wiring: existing tables reused, filters + search combined, Clear filters, bulk selection unchanged", () => {
  assert.match(catalog, /\.from\("categories"\)\n\s+\.select\("id,name,slug,data_class,is_active"\)/);
  assert.match(catalog, /\.from\("product_subcategories"\)\n\s+\.select\("id,name,category_id,is_active,sort_order"\)/);
  assert.match(catalog, /category_id,brand:brands\(name\)/);
  assert.match(catalog, /\$\{columns\},subcategory_id/);
  assert.match(catalog, /adminProductMatchesQuery\(p, query\) &&\n\s+adminProductMatchesCategory\(p, filter\) &&/);
  assert.match(catalog, /<option value="">All categories<\/option>/);
  assert.match(catalog, /aria-label="Filter by subcategory"/);
  assert.match(catalog, /setQuery\(""\);\n\s+setFilter\(NO_CATEGORY_FILTER\);/);
  assert.match(catalog, /No products match these filters\./);
  // Bulk selection still works on the shown (filtered) list; the Brands & categories page link is kept.
  assert.match(catalog, /selectAllDrafts\(current, shown\)/);
  assert.match(catalog, /href="\/admin\/taxonomy"/);
});
