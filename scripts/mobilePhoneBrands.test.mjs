import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  MOBILE_PHONES_CATEGORY_SLUG,
  brandDisplayName,
  mobilePhoneBrandHref,
  mobilePhoneBrands,
} from "../src/lib/collections.ts";

const storefront = readFileSync(new URL("../src/StorefrontApp.tsx", import.meta.url), "utf8");

test("Option B: all 14 configured Mobile Phones brands, in a fixed order", () => {
  assert.deepEqual(mobilePhoneBrands.map((brand) => brand.slug), [
    "samsung", "infinix", "oppo", "vivo", "tecno", "apple",
    "xiaomi", "motorola", "honor", "nothing", "google", "realme", "itel", "oneplus",
  ]);
  assert.equal(new Set(mobilePhoneBrands.map((brand) => brand.slug)).size, 14);
});

test("iPhone uses the canonical brand slug apple", () => {
  const iphone = mobilePhoneBrands.find((brand) => brand.label === "iPhone");
  assert.equal(iphone?.slug, "apple");
  assert.equal(mobilePhoneBrands.some((brand) => brand.slug === "iphone"), false);
});

test("brand links use the existing /shop workflow limited to the Mobile Phones category", () => {
  assert.equal(MOBILE_PHONES_CATEGORY_SLUG, "mobile-phones");
  assert.equal(mobilePhoneBrandHref("nothing"), "/shop?brand=nothing&category=mobile-phones");
  for (const brand of mobilePhoneBrands.filter((item) => item.slug !== "apple")) {
    assert.equal(mobilePhoneBrandHref(brand.slug), `/shop?brand=${brand.slug}&category=mobile-phones`);
  }
});

test("iPhone keeps its existing collection with the New / Used tabs", () => {
  assert.equal(mobilePhoneBrandHref("apple"), "/collections/mobile-phones/iphone");
});

test("desktop dropdown and mobile drawer both render the shared list", () => {
  assert.match(storefront, /links=\{mobilePhoneBrands\.map\(\(brand\) => \(\{ label: brand\.label, href: mobilePhoneBrandHref\(brand\.slug\) \}\)\)\}/);
  assert.match(storefront, /\{mobilePhoneBrands\.map\(\(brand\) => \(\s*<a href=\{mobilePhoneBrandHref\(brand\.slug\)\}/);
  assert.doesNotMatch(storefront, /primaryMobileBrands/);
});

test("readable brand names: published taxonomy first, then the configured name, else the slug", () => {
  const published = [{ id: "b1", name: "Nothing", slug: "nothing" }];
  assert.equal(brandDisplayName("nothing", published), "Nothing");
  assert.equal(brandDisplayName("oneplus", []), "OnePlus");
  assert.equal(brandDisplayName("google", []), "Google");
  assert.equal(brandDisplayName("apple", []), "Apple");
  assert.equal(brandDisplayName("unknown-brand", []), "unknown-brand");
});

test("Shop brand empty state: readable name, removable filter, View all mobile phones", () => {
  assert.match(storefront, /className="shop-empty shop-empty-brand"/);
  assert.match(storefront, /onClick=\{\(\) => removeBrandFilter\(slug\)\}/);
  assert.match(storefront, /href="\/collections\/mobile-phones">\s*View all mobile phones/);
  assert.match(storefront, /next\.delete\("brand"\)/);
});
