import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { initialPdpSelection, mediaForVariant, variantForMedia } from "../src/lib/pdpMediaSync.ts";

// Realme C75x as the storefront returns it: Blue listed first, Coral Pink primary, Oceanic Blue gallery.
const blue = { id: "v-blue", sku: "MB314", ram: "8 GB", storage: "128 GB", color: "Blue", priceMinor: 6100000, quantity: 30 };
const pink = { id: "v-pink", sku: "MB313", ram: "8 GB", storage: "128 GB", color: "Pink", priceMinor: 6100000, quantity: 30 };
const media = (id, isPrimary, variantIds = []) => ({ id, variantId: null, variantIds, publicId: id, url: `https://cdn/${id}`, alt: id, width: 844, height: 844, format: "png", isPrimary });
const c75x = (linked = true) => ({
  variants: [blue, pink],
  media: [media("coral", true, linked ? ["v-pink"] : []), media("oceanic", false, linked ? ["v-blue"] : [])],
});
const sameConfig = () => true;

test("page load: selected colour and first image agree (primary's colour is selected)", () => {
  const initial = initialPdpSelection(c75x());
  assert.equal(initial.variantId, "v-pink");
  assert.equal(initial.media.id, "coral");
});

test("page load: if the primary's colour is out of stock, the first in-stock colour and ITS image", () => {
  const product = c75x();
  product.variants = [blue, { ...pink, quantity: 0 }];
  const initial = initialPdpSelection(product);
  assert.equal(initial.variantId, "v-blue");
  assert.equal(initial.media.id, "oceanic");
});

test("colour change shows that colour's exact image; never another colour's image", () => {
  assert.equal(mediaForVariant(c75x(), "v-pink").id, "coral");
  assert.equal(mediaForVariant(c75x(), "v-blue").id, "oceanic");
  // A colour with no image of its own falls back to a SHARED image, not to another colour's image.
  const product = { variants: [blue, pink], media: [media("coral", true, ["v-pink"]), media("box", false)] };
  assert.equal(mediaForVariant(product, "v-blue").id, "box");
});

test("thumbnail click selects the matching colour; shared images keep the selection", () => {
  const product = c75x();
  assert.equal(variantForMedia(product, product.media[1], pink, sameConfig).id, "v-blue");
  assert.equal(variantForMedia(product, product.media[0], blue, sameConfig).id, "v-pink");
  assert.equal(variantForMedia(product, product.media[0], pink, sameConfig).id, "v-pink");
  assert.equal(variantForMedia(product, media("box", false), pink, sameConfig), null);
  // An image whose colour is sold out does not switch to an unavailable variant.
  const soldOut = { ...product, variants: [{ ...blue, quantity: 0 }, pink] };
  assert.equal(variantForMedia(soldOut, product.media[1], pink, sameConfig), null);
});

test("thumbnail click with several storages: only the selected storage's in-stock colour, never a storage switch", () => {
  const black128 = { ...blue, id: "b128", color: "Black", storage: "128 GB" };
  const red128 = { ...blue, id: "r128", color: "Red", storage: "128 GB" };
  const red256 = { ...blue, id: "r256", color: "Red", storage: "256 GB" };
  const black256 = { ...blue, id: "b256", color: "Black", storage: "256 GB" };
  const green256 = { ...blue, id: "g256", color: "Green", storage: "256 GB" };
  const redImage = media("red", false, ["r128", "r256"]);
  const greenImage = media("green", false, ["g256"]);
  const in128 = (variant) => variant.storage === "128 GB";
  const in256 = (variant) => variant.storage === "256 GB";
  const product = { variants: [black128, red128, red256, black256, green256], media: [media("black", true, ["b128", "b256"]), redImage, greenImage] };
  assert.equal(variantForMedia(product, redImage, black128, in128).id, "r128");
  // Green exists only in 256 GB: on 128 GB the selection (storage, variant, price) stays.
  assert.equal(variantForMedia(product, greenImage, black128, in128), null);
  assert.equal(variantForMedia(product, greenImage, black256, in256).id, "g256");
  // Red sold out in 128 GB: no switch to the in-stock 256 GB Red, and never to the sold-out one.
  const sold128 = { ...product, variants: [black128, { ...red128, quantity: 0 }, red256, black256, green256] };
  assert.equal(variantForMedia(sold128, redImage, black128, in128), null);
});

test("without colour associations nothing is guessed: primary on load, every colour keeps the shared images", () => {
  const product = c75x(false);
  const initial = initialPdpSelection(product);
  assert.equal(initial.variantId, "v-blue"); // first in-stock variant, as before
  assert.equal(initial.media.id, "coral"); // the primary
  assert.equal(mediaForVariant(product, "v-blue").id, "coral");
  assert.equal(variantForMedia(product, product.media[1], blue, sameConfig), null);
});

test("legacy single variantId association is honoured; gallery order is not changed", () => {
  const product = { variants: [blue, pink], media: [{ ...media("coral", true), variantId: "v-pink" }, { ...media("oceanic", false), variantId: "v-blue" }] };
  assert.equal(mediaForVariant(product, "v-blue").id, "oceanic");
  assert.deepEqual(product.media.map((item) => item.id), ["coral", "oceanic"]);
});

test("the PDP uses the sync helper for load, colour change, thumbnails and arrows", () => {
  const source = readFileSync(new URL("../src/StorefrontApp.tsx", import.meta.url), "utf8");
  assert.match(source, /initialPdpSelection\(next\)/);
  assert.match(source, /setImage\(mediaForVariant\(product, candidate\.id\)\?\.url \?\? ""\)/);
  assert.match(source, /onClick=\{\(\) => showMedia\(item\)\}/);
  assert.match(source, /showMedia\(gallery\[nextIndex\]\)/);
});
