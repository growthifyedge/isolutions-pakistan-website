// Admin Products list search: title, slug, brand and variant SKU / storage / colour.
import assert from "node:assert/strict";
import test from "node:test";
import { adminProductMatchesQuery } from "../src/lib/adminProductSearch.ts";

const pixel = {
  title: "Google Pixel 9 Pro", slug: "google-pixel-9-pro", brand: { name: "Google" },
  product_variants: [
    { sku: "MB004", storage_display: "256 GB", color_finish: "Obsidian" },
    { sku: "MB005", storage_display: "512 GB", color_finish: "Porcelain" },
  ],
};
const cable = {
  title: "USB-C Cable", slug: "usb-c-cable", brand: null,
  product_variants: [{ sku: "AC001", storage_display: null, color_finish: null }],
};
const search = (query) => [pixel, cable].filter((p) => adminProductMatchesQuery(p, query)).map((p) => p.title);

test("exact variant SKU returns the parent product once, even with several matching variants", () => {
  assert.deepEqual(search("MB004"), ["Google Pixel 9 Pro"]);
  assert.deepEqual(search("MB00"), ["Google Pixel 9 Pro"]);
  assert.deepEqual(search("AC001"), ["USB-C Cable"]);
});

test("SKU search is case-insensitive and ignores surrounding spaces", () => {
  assert.deepEqual(search("mb004"), ["Google Pixel 9 Pro"]);
  assert.deepEqual(search("  Mb004 "), ["Google Pixel 9 Pro"]);
});

test("a nonexistent SKU returns nothing", () => {
  assert.deepEqual(search("ZZ999"), []);
});

test("title, slug and brand search still work; empty search shows everything", () => {
  assert.deepEqual(search("pixel 9"), ["Google Pixel 9 Pro"]);
  assert.deepEqual(search("usb-c-cable"), ["USB-C Cable"]);
  assert.deepEqual(search("google"), ["Google Pixel 9 Pro"]);
  assert.deepEqual(search(""), ["Google Pixel 9 Pro", "USB-C Cable"]);
});

test("variant storage and colour also match", () => {
  assert.deepEqual(search("512 gb"), ["Google Pixel 9 Pro"]);
  assert.deepEqual(search("porcelain"), ["Google Pixel 9 Pro"]);
});
