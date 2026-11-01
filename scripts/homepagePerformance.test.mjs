import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, statSync } from "node:fs";

const storefront = readFileSync(new URL("../src/StorefrontApp.tsx", import.meta.url), "utf8");
const publicFile = (path) => new URL(`../public${path}`, import.meta.url);
const carousel = storefront.slice(storefront.indexOf("function HomeHeroCarousel("));
const heroSource = carousel.slice(0, carousel.indexOf("\n}\n") + 2);

const referenced = (pattern) => [...storefront.matchAll(pattern)].map((match) => match[1]);
const banners = referenced(/(?:desktop|mobile)Src: "(\/assets\/banners\/[^"]+)"/g);
const categories = referenced(/image: "(\/assets\/categories\/[^"]+)"/g);
const logos = referenced(/className="storefront-brand-logo" src="([^"]+)"/g);

test("homepage banners use the optimized WebP copies; the original PNGs are kept", () => {
  assert.equal(banners.length, 14);
  for (const path of banners) {
    assert.match(path, /\.webp$/);
    assert.ok(existsSync(publicFile(path)), `${path} exists`);
    assert.ok(statSync(publicFile(path)).size < 400 * 1024, `${path} stays under 400 KB`);
    assert.ok(existsSync(publicFile(path.replace(/\.webp$/, ".png"))), `${path} original PNG kept`);
  }
});

test("header logo and Shop By Category images use display-sized WebP copies", () => {
  assert.equal(logos.length, 3);
  for (const path of logos) assert.equal(path, "/assets/branding/isolutions-pakistan-logo-v2-256.webp");
  assert.ok(statSync(publicFile(logos[0])).size < 100 * 1024);
  assert.ok(existsSync(publicFile("/assets/branding/isolutions-pakistan-logo-v2.png")), "original logo kept");
  assert.equal(categories.length, 12);
  for (const path of categories) {
    assert.match(path, /-400\.webp$/);
    assert.ok(statSync(publicFile(path)).size < 120 * 1024, `${path} stays under 120 KB`);
    assert.ok(existsSync(publicFile(path.replace(/-400\.webp$/, ".png"))), `${path} original PNG kept`);
  }
});

test("favicon still points at the original logo", () => {
  const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
  assert.match(html, /rel="icon" type="image\/png" href="\/assets\/branding\/isolutions-pakistan-logo-v2\.png"/);
});

test("carousel requests only the first banner up front, at high priority, one variant per device", () => {
  assert.match(heroSource, /useState<ReadonlySet<number>>\(\(\) => new Set\(\[0\]\)\)/);
  assert.match(heroSource, /\{requestedSlides\.has\(index\) && !failedSources\.has\(source\) && \(/);
  assert.match(heroSource, /fetchPriority=\{index === 0 \? "high" : "auto"\}/);
  assert.match(heroSource, /return isMobileBanner && slide\.mobileSrc \? slide\.mobileSrc : slide\.desktopSrc;/);
  assert.match(heroSource, /src=\{source\}/);
  assert.doesNotMatch(heroSource, /<source /);
  assert.doesNotMatch(heroSource, /loading=\{index === 0 \? "eager" : "lazy"\}/);
});

test("carousel prefetches neighbours after the visible banner loads, and all banners when the dots are used", () => {
  assert.match(heroSource, /isReady\(activeSlide\)\s*\?\s*\[activeSlide, targetSlide, \(activeSlide \+ 1\) % count, \(activeSlide - 1 \+ count\) % count\]/);
  assert.match(heroSource, /onPointerEnter=\{\(\) => requestSlides\(homeHeroSlides\.map\(\(_, index\) => index\)\)\}/);
});

test("reliability: the visible banner changes only after the target banner has loaded and decoded", () => {
  assert.match(heroSource, /const \[targetSlide, setTargetSlide\] = useState\(0\)/);
  assert.match(heroSource, /if \(isReady\(targetSlide\)\) setActiveSlide\(targetSlide\);\s*else if \(hasFailed\(targetSlide\)\) setTargetSlide\(activeSlide\);/);
  assert.match(heroSource, /event\.currentTarget\.decode\(\)\.catch\(\(\) => undefined\)\.then\(\(\) => addSource\(setReadySources, source\)\)/);
  assert.match(heroSource, /onError=\{\(\) => addSource\(setFailedSources, source\)\}/);
  // Navigation only ever sets the target; setActiveSlide is called in exactly one place.
  assert.equal(heroSource.match(/setActiveSlide\(/g)?.length, 1);
});

test("reliability: readiness is tracked per file, rapid clicks step from the latest selection", () => {
  assert.match(heroSource, /useState<ReadonlySet<string>>\(\(\) => new Set\(\)\)/);
  assert.match(heroSource, /const step = \(delta: number\) => setTargetSlide\(\(current\) => \(current \+ delta \+ count\) % count\)/);
  assert.match(heroSource, /const showPrevious = \(\) => step\(-1\)/);
  assert.match(heroSource, /const showNext = \(\) => step\(1\)/);
  assert.match(heroSource, /onClick=\{\(\) => goTo\(index\)\}/);
  assert.doesNotMatch(heroSource, /key=\{source\}/);
});

test("reliability: 4-second auto-rotation waits for pending navigation and skips failed banners", () => {
  assert.match(heroSource, /if \(isPaused \|\| targetSlide !== activeSlide \|\|/);
  assert.match(heroSource, /if \(!hasFailed\(next\)\) \{\s*setTargetSlide\(next\);/);
  assert.match(heroSource, /\}, 4000\);/);
});
