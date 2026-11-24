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

// PDP main image auto-fit (2026-11-21): the main image box follows the image's own shape; PDP only, nothing cropped.
test("PDP main image auto-fit: box follows the image shape, contain kept, same image request, PDP only", () => {
  const text = (path) => readFileSync(new URL(path, import.meta.url), "utf8").replace(/\r\n/g, "\n");
  const app = text("../src/StorefrontApp.tsx");
  const css = text("../src/styles.css");
  // Ratio from the stored media size (no jump), corrected by the loaded image; limited to 1:2 .. 2:1.
  assert.match(app, /Math\.min\(2, Math\.max\(0\.5, ratio\)\)/);
  assert.match(app, /pdpImageRatio\(selectedMedia\?\.width, selectedMedia\?\.height\)/);
  assert.match(app, /className=\{`pdp-main-image\$\{mainImageRatio \? " has-image-ratio" : ""\}\$\{mainImageBackdrop \? " has-image-backdrop" : ""\}\$\{pdpBackground\.style \? " has-global-background" : ""\}\$\{mainImageInset < 1 \? " has-product-inset" : ""\}`\}/);
  assert.match(app, /"--pdp-image-ratio": \(1 \/ \(1 \/ mainImageRatio \+ 0\.05\)\)\.toFixed\(4\)/);
  // Same delivery sizes as before (1400 px main, 240 px thumbnails), now on the product canvas for every product.
  assert.match(app, /pdpGalleryImage\(selectedMedia, 1400\)/);
  assert.match(app, /pdpGalleryImage\(item, 240\)/);
  // Before the main image loads, the thumbnail's real shape is used (no jump when switching colours).
  assert.match(app, /\(selectedMedia && thumbnailRatios\[selectedMedia\.id\]\) \|\| pdpImageRatio\(selectedMedia\?\.width, selectedMedia\?\.height\)/);
  assert.equal((app.match(/has-image-ratio/g) ?? []).length, 1, "only the PDP main image uses it");
  // CSS: scoped to the PDP main image, height limited, contain kept (base rules), no stretch / cover.
  const block = css.slice(css.indexOf("/* PDP main image auto-fit"));
  assert.match(block, /\.pdp-showcase \.pdp-main-image\.has-image-ratio \{\n  width:100%;\n  height:auto;\n  aspect-ratio:var\(--pdp-image-ratio\);/);
  assert.match(block, /max-height:min\(84vh,820px\)/);
  assert.doesNotMatch(block, /object-fit:\s*(cover|fill)|\.product-image|\.product-card|\.pdp-thumbnails/);
  assert.match(css, /\.pdp-main-image img \{ object-fit:contain;/);
});

// PDP product canvas (2026-11-24): trimmed product cut-outs on one 4:5 canvas; photos without a margin untouched.
test("PDP product canvas: trim, pad to 4:5 only when a margin was trimmed, original fallback, PDP gallery only", () => {
  const text = (path) => readFileSync(new URL(path, import.meta.url), "utf8").replace(/\r\n/g, "\n");
  const cloud = text("../src/lib/cloudinary.ts");
  const app = text("../src/StorefrontApp.tsx");
  assert.ok(cloud.includes('const PRODUCT_CANVAS = "$ow_iw_mul_0.97,$oh_ih_mul_0.97/e_trim:10/if_w_lt_$ow_or_h_lt_$oh/c_pad,ar_4:5,b_transparent/if_end/";'));
  // The canvas sits before the unchanged final delivery step, so the backdrop sample still finds it.
  assert.match(cloud, /\$\{options\.canvas \? PRODUCT_CANVAS : trim\}c_limit,w_\$\{safeWidth\},q_auto,f_auto\//);
  assert.doesNotMatch(cloud, /c_fill|c_crop|c_thumb|c_scale,w_\$\{/);
  assert.match(app, /cloudinaryDeliveryUrl\(media\.publicId, width, \{ canvas: true \}\) \|\| original/);
  assert.match(app, /if \(fallback && image\.src !== fallback\) image\.src = fallback;/);
  assert.equal((app.match(/canvas: true/g) ?? []).length, 1, "PDP gallery only");
  assert.doesNotMatch(app, /PDP_TRIMMED_GALLERY_SLUGS|trimGallery/);
});

// PDP image backdrop (2026-11-21): even, non-white image edges colour the box; PDP main image only.
test("PDP image backdrop: tiny same-image sample, even non-white gap edges only, safe fallbacks, PDP only", () => {
  const text = (path) => readFileSync(new URL(path, import.meta.url), "utf8").replace(/\r\n/g, "\n");
  const app = text("../src/StorefrontApp.tsx");
  const css = text("../src/styles.css");
  // A 32 px PNG copy of the same Cloudinary image; anything else (fallback URL) is skipped. Cached per image.
  assert.ok(app.includes('src.replace(/\\/c_limit,w_\\d+,q_auto,f_auto\\//, "/c_scale,w_32,f_png/")'), "32 px PNG copy of the same image");
  assert.match(app, /sampleSrc\.startsWith\("https:\/\/res\.cloudinary\.com\/"\)/);
  assert.match(app, /pdpBackdropCache\.set\(sampleSrc, result\)/);
  assert.match(app, /sample\.crossOrigin = "anonymous"/);
  // Gap edges first (left/right for portrait + square, top/bottom for landscape); uneven -> other pair; transparent,
  // white and busy edges keep the box colour.
  assert.match(app, /const \[first, second\] = width > height \? \[ends, sides\] : \[sides, ends\];/);
  assert.match(app, /if \(spread > 12\) return "uneven";/);
  assert.match(app, /mean\.every\(\(value\) => value >= 250\) \? "white"/);
  assert.match(app, /resolve\(colour\.startsWith\("rgb\("\) \? colour : null\)/);
  // Applied only to the matching image (a late answer for another image is ignored); main image only.
  assert.match(app, /const mainImageBackdrop = !pdpBackground\.style && mainImage && imageBackdrop\?\.src === mainImage\.src \? imageBackdrop\.color : null;/);
  assert.equal((app.match(/has-image-backdrop/g) ?? []).length, 1);
  const block = css.slice(css.indexOf("/* PDP image backdrop"));
  assert.match(block, /\.pdp-showcase \.pdp-main-image\.has-image-backdrop \{ background:var\(--pdp-image-backdrop\);/);
  assert.match(block, /\.pdp-showcase \.pdp-main-image\.has-image-backdrop img \{ mix-blend-mode:normal; \}/);
  assert.doesNotMatch(block, /object-fit|\.product-image|\.pdp-thumbnails/);
});
