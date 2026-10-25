import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolveCollection } from "../src/lib/collections.ts";

const taxonomy = {
  brands: [
    { id: "b1", name: "Apple", slug: "apple" },
    { id: "b2", name: "Samsung", slug: "samsung" },
    { id: "b3", name: "Lenovo", slug: "lenovo" },
  ],
  categories: [
    { id: "c1", name: "Gadgets", slug: "gadgets" },
    { id: "c2", name: "Laptops", slug: "laptops" },
    { id: "c3", name: "Tablets", slug: "tablets" },
    { id: "c4", name: "Mobile Phones", slug: "mobile-phones" },
  ],
};
const resolve = (search = "") => resolveCollection("/collections/laptops-tablets", taxonomy, search);

test("Tablets & MacBooks: the existing URL, tablets + laptops (only Apple laptops can be published)", () => {
  const all = resolve();
  assert.equal(all.title, "Tablets & MacBooks");
  assert.deepEqual(all.breadcrumbs.at(-1), { label: "Tablets & MacBooks" });
  assert.deepEqual([...all.filters.categories].sort(), ["laptops", "tablets"]);
  assert.equal(all.available, true);
});

test("MacBooks show Apple laptops only; the older ?type=laptops link shows the same MacBooks", () => {
  for (const search of ["?type=macbooks", "?type=laptops", "?type=macbooks&brand=apple"]) {
    const macbooks = resolve(search);
    assert.equal(macbooks.title, "MacBooks");
    assert.deepEqual(macbooks.filters.categories, ["laptops"]);
    assert.deepEqual(macbooks.filters.brands, ["apple"]);
    assert.equal(macbooks.available, true);
  }
  assert.equal(resolve("?type=laptops&brand=lenovo").available, false, "a Windows laptop brand link shows nothing");
});

test("iPad and Android Tablets are unchanged", () => {
  assert.deepEqual([resolve("?type=ipad").filters.categories, resolve("?type=ipad").filters.brands], [["tablets"], ["apple"]]);
  const android = resolve("?type=android-tablets");
  assert.deepEqual([android.filters.categories, android.excludeBrands], [["tablets"], ["apple"]]);
  assert.deepEqual(resolveCollection("/collections/home-gadgets", taxonomy).filters.categories, ["gadgets"]);
  assert.deepEqual(resolveCollection("/collections/macbook", taxonomy).filters, { categories: ["laptops"], brands: ["apple"] });
});

test("Storefront menu: Tablets & MacBooks with iPad, Android Tablets and MacBooks; no Windows laptop brands", () => {
  const app = readFileSync(new URL("../src/StorefrontApp.tsx", import.meta.url), "utf8");
  assert.match(app, /label="Tablets & MacBooks"/);
  assert.match(app, /heading: "MacBooks", href: "\/collections\/laptops-tablets\?type=macbooks"/);
  assert.equal(/Laptops & Tablets|laptops &amp; tablets/i.test(app), false);
  assert.equal(/\{ label: "(?:Acer|HP|Dell)", slug:/.test(app), false);
});
