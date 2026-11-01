import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const storefront = readFileSync(new URL("../src/StorefrontApp.tsx", import.meta.url), "utf8");
const shopSource = storefront.slice(storefront.indexOf("function Shop("), storefront.indexOf("function CheckoutPage("));
const collectionSource = storefront.slice(
  storefront.indexOf("function CollectionPage("),
  storefront.indexOf("const labelize ="),
);

test("collection pages use the shared header without redundant copy", () => {
  assert.match(collectionSource, /<CollectionHeader\s/);
  assert.doesNotMatch(collectionSource, /THE COLLECTION/);
  assert.doesNotMatch(collectionSource, /Published products/);
  assert.doesNotMatch(collectionSource, /collection\?\.description/);
});

test("iPhone New / Used tabs stay on the collection page", () => {
  assert.match(collectionSource, /href="\/collections\/mobile-phones\/iphone\/new"/);
  assert.match(collectionSource, /href="\/collections\/mobile-phones\/iphone\/used"/);
});

test("Mobile Phones brand pages swap the Shop hero for the white header; general Shop keeps its hero", () => {
  assert.match(shopSource, /params\.get\("category"\) === MOBILE_PHONES_CATEGORY_SLUG && Boolean\(params\.get\("brand"\)\)/);
  assert.match(shopSource, /mobileBrandPage \? \(\s*<CollectionHeader/);
  assert.match(shopSource, /className="shop-hero container"/);
  assert.match(shopSource, /`\$\{singleMobileBrand\} Phones`/);
  assert.match(shopSource, /\{ label: "Mobile Phones", href: "\/collections\/mobile-phones" \}, \{ label: singleMobileBrand \}/);
});

test("the shared header shows a breadcrumb, the title and the product count", () => {
  const header = storefront.slice(storefront.indexOf("function CollectionHeader("), storefront.indexOf("function Shop("));
  assert.match(header, /className="collection-breadcrumbs container"/);
  assert.match(header, /<h1>\{title\}<\/h1>/);
  assert.match(header, /className="collection-count"/);
  assert.match(header, /`\$\{count\} product\$\{count === 1 \? "" : "s"\}`/);
});
