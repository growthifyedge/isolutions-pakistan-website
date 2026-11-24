import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PDP_PRODUCT_FILL, PDP_PRODUCT_MIN_SCALE, isPdpProductCutout, pdpProductFill, pdpProductInsetScale } from "../src/lib/pdpProductInset.ts";

// RGBA sample: `pixel(x, y)` for every position.
const sample = (width, height, pixel) => {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) data.set(pixel(x, y), (y * width + x) * 4);
  return { data, width, height };
};
const TRANSPARENT = [0, 0, 0, 0];
const WHITE = [255, 255, 255, 255];
const PHONE = [40, 40, 50, 255];
const inBox = (box, inside, outside) => (x, y) => (x >= box[0] && x < box[1] && y >= box[2] && y < box[3] ? inside : outside);
const busyPhoto = (x, y) => [(x * 7) % 200, (y * 5) % 180, 90, 255];
// The displayed canvas image: the product touches the left/right edges (4:5 canvas, transparent bands top/bottom).
const DISPLAYED_EDGE_TO_EDGE = sample(32, 40, inBox([0, 32, 2, 38], PHONE, TRANSPARENT));

test("a transparent cut-out that touches the canvas edges is shown at 88%", () => {
  assert.equal(PDP_PRODUCT_FILL, 0.88);
  const original = sample(32, 40, inBox([0, 32, 2, 38], PHONE, TRANSPARENT));
  assert.equal(pdpProductInsetScale(original, DISPLAYED_EDGE_TO_EDGE), 0.88);
});

test("S26 FE Graphite: a transparent cut-out with almost no margin is still a cut-out (transparent corners ≥ 2%)", () => {
  const original = sample(32, 40, (x, y) => ((x < 3 || x > 28) && (y < 3 || y > 36) ? TRANSPARENT : PHONE));
  assert.equal(isPdpProductCutout(original), true);
  assert.equal(pdpProductInsetScale(original, sample(32, 40, () => PHONE)), 0.88);
});

test("a product uploaded on a plain white background is a cut-out", () => {
  const original = sample(32, 32, inBox([6, 26, 2, 30], PHONE, WHITE));
  assert.equal(isPdpProductCutout(original), true);
  assert.equal(pdpProductInsetScale(original, DISPLAYED_EDGE_TO_EDGE), 0.88);
});

test("photos are never scaled — even when the canvas padded them with transparent bands (water bottle case)", () => {
  const photo = sample(32, 32, busyPhoto);
  assert.equal(isPdpProductCutout(photo), false);
  const paddedOnCanvas = sample(32, 40, inBox([0, 32, 4, 36], [120, 120, 120, 255], TRANSPARENT));
  assert.equal(pdpProductInsetScale(photo, paddedOnCanvas), 1);
  // Lifestyle photo with a little white along one edge only (< 50% of the ring): still a photo.
  assert.equal(isPdpProductCutout(sample(32, 24, (x, y) => (y === 0 ? WHITE : busyPhoto(x, y)))), false);
});

test("a product that already has space is shrunk less or not at all; never below the minimum; never enlarged", () => {
  const original = sample(32, 40, inBox([4, 28, 4, 36], PHONE, TRANSPARENT));
  assert.equal(pdpProductFill(sample(32, 40, inBox([1, 31, 2, 38], PHONE, TRANSPARENT))), 0.9375);
  assert.equal(pdpProductInsetScale(original, sample(32, 40, inBox([1, 31, 2, 38], PHONE, TRANSPARENT))), 0.939);
  assert.equal(pdpProductInsetScale(original, sample(32, 40, inBox([3, 29, 4, 36], PHONE, TRANSPARENT))), 1);
  assert.ok(PDP_PRODUCT_MIN_SCALE <= PDP_PRODUCT_FILL);
});

test("unreadable or empty samples → 1 (unchanged)", () => {
  const bad = { data: new Uint8ClampedArray(8), width: 2, height: 1 };
  assert.equal(pdpProductInsetScale(bad, DISPLAYED_EDGE_TO_EDGE), 1);
  assert.equal(pdpProductInsetScale(sample(32, 40, () => TRANSPARENT), bad), 1);
  assert.equal(pdpProductInsetScale(sample(32, 40, inBox([0, 32, 2, 38], PHONE, TRANSPARENT)), sample(32, 40, () => TRANSPARENT)), 1);
});

test("PDP wiring: main image only, CSS scale only; Cloudinary canvas and backdrop sampler unchanged", () => {
  const app = readFileSync(new URL("../src/StorefrontApp.tsx", import.meta.url), "utf8").replace(/\r\n/g, "\n");
  const css = readFileSync(new URL("../src/styles.css", import.meta.url), "utf8");
  const cloud = readFileSync(new URL("../src/lib/cloudinary.ts", import.meta.url), "utf8");
  assert.ok(cloud.includes('const PRODUCT_CANVAS = "$ow_iw_mul_0.97,$oh_ih_mul_0.97/e_trim:10/if_w_lt_$ow_or_h_lt_$oh/c_pad,ar_4:5,b_transparent/if_end/";'), "Cloudinary canvas unchanged");
  assert.match(app, /resolve\(colour\.startsWith\("rgb\("\) \? colour : null\)/, "backdrop sampler unchanged");
  assert.match(app, /pdpProductInset\(delivered\.src, delivered\["data-fallback-src"\]\)/, "the original upload is measured too");
  assert.match(app, /original && displayed \? pdpProductInsetScale\(original, displayed\) : 1/);
  assert.match(app, /\$\{mainImageInset < 1 \? " has-product-inset" : ""\}/);
  assert.match(app, /"--pdp-product-scale": String\(mainImageInset\)/);
  assert.equal((app.match(/has-product-inset/g) ?? []).length, 1, "main image only (thumbnails unchanged)");
  assert.match(css, /\.pdp-main-image\.has-product-inset img \{ scale:var\(--pdp-product-scale,1\);/);
  assert.doesNotMatch(css, /has-product-inset[^{]*\{[^}]*(width|height|aspect-ratio|padding)\s*:/, "the box size is not changed");
});
