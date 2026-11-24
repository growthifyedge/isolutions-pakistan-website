// PDP product inset (Owner request 2026-11-24): a product cut-out that touches the edges of its 4:5 canvas looked too
// close to the image box. The main PDP image of a product cut-out is shown slightly smaller (about 12%) so there is even
// space on all four sides. The box, the 4:5 canvas, the PDP background and the image itself are unchanged (CSS scale
// only: nothing is cropped, replaced or re-uploaded).
//
// Which images: decided from the ORIGINAL upload (a 32 px copy without the canvas step), because the canvas itself adds
// transparent padding to photos too. A product cut-out was uploaded with a transparent background, or with a plain
// white / transparent edge. A lifestyle or studio photo (opaque, busy edges) is never scaled.

/** The product fills at most this share of the image's width and height after the inset. */
export const PDP_PRODUCT_FILL = 0.88;
/** Never shrink more than this (a product that already has space around it is shrunk less, or not at all). */
export const PDP_PRODUCT_MIN_SCALE = 0.85;

export type RgbaSample = { data: ArrayLike<number>; width: number; height: number };

const valid = (sample: RgbaSample) => sample.width >= 4 && sample.height >= 4 && sample.data.length >= sample.width * sample.height * 4;
const isPlain = (data: ArrayLike<number>, offset: number) =>
  data[offset + 3] < 128 || (data[offset] >= 240 && data[offset + 1] >= 240 && data[offset + 2] >= 240);

/** A product cut-out: the original has a transparent background (≥ 2% of pixels) or a plain edge (≥ 50% of the outer ring). */
export function isPdpProductCutout(original: RgbaSample): boolean {
  if (!valid(original)) return false;
  const { data, width, height } = original;
  let transparent = 0;
  let ring = 0;
  let plain = 0;
  for (let y = 0; y < height; y += 1)
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4;
      if (data[offset + 3] < 250) transparent += 1;
      if (x === 0 || y === 0 || x === width - 1 || y === height - 1) {
        ring += 1;
        if (isPlain(data, offset)) plain += 1;
      }
    }
  return transparent / (width * height) >= 0.02 || plain / ring >= 0.5;
}

/** How much of the displayed image (on its canvas) the product fills: the larger of its width and height shares. */
export function pdpProductFill(displayed: RgbaSample): number {
  if (!valid(displayed)) return 0;
  const { data, width, height } = displayed;
  let left = width;
  let top = height;
  let right = -1;
  let bottom = -1;
  for (let y = 0; y < height; y += 1)
    for (let x = 0; x < width; x += 1)
      if (!isPlain(data, (y * width + x) * 4)) {
        if (x < left) left = x;
        if (x > right) right = x;
        if (y < top) top = y;
        if (y > bottom) bottom = y;
      }
  return right < 0 ? 0 : Math.max((right - left + 1) / width, (bottom - top + 1) / height);
}

/** Scale for the main PDP image. 1 = unchanged (photos, products that already have space, unreadable samples). */
export function pdpProductInsetScale(original: RgbaSample, displayed: RgbaSample): number {
  if (!isPdpProductCutout(original)) return 1;
  const fill = pdpProductFill(displayed);
  if (!fill) return 1;
  const scale = PDP_PRODUCT_FILL / fill;
  return scale >= 0.995 ? 1 : Math.max(PDP_PRODUCT_MIN_SCALE, Math.round(scale * 1000) / 1000);
}
