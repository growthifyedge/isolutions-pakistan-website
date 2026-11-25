// Bundle Offers Editor (2026-11-25, localhost): pure helpers, storefront / Admin source checks and migration
// 202611250002 ('bundle_offers' scope) replayed in an in-memory database (scripts/support/catalogTestDatabase.mjs).
// Nothing here touches DEV or PROD.
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import {
  BUILT_IN_BUNDLE_PROMO_IMAGE,
  BUILT_IN_BUNDLE_TILES,
  defaultBundleOffers,
  normalizeBundleOffers,
  parseBundleOffers,
  resolveBundleOffers,
  validateBundleOffers,
} from "../src/lib/bundleOffers.ts";
import { createCatalogTestDatabase, signInAsOwner, signOut } from "./support/catalogTestDatabase.mjs";

const readText = (path) => readFileSync(new URL(path, import.meta.url), "utf8").replace(/\r\n/g, "\n");
const storefront = readText("../src/StorefrontApp.tsx");
const editor = readText("../src/admin/BundleOffersEditor.tsx");
const adminApp = readText("../src/admin/AdminApp.tsx");
const migration = readText("../supabase/migrations/202611250002_site_content_bundle_offers.sql");

const uploaded = (name) => ({
  src: `https://res.cloudinary.com/demo/image/upload/v1/isolutions-development/site/11111111-2222-3333-4444-555555555555/${name}`,
  publicId: `isolutions-development/site/11111111-2222-3333-4444-555555555555/${name}`,
});

test("built-in content = today's four tiles, links and promotional banner (nothing published changes nothing)", () => {
  const resolved = resolveBundleOffers(null, "demo");
  assert.deepEqual(resolved.tiles, BUILT_IN_BUNDLE_TILES.map(({ title, image, href }) => ({ title, image, href })));
  assert.deepEqual(resolved.promo, { image: null, href: null });
  assert.deepEqual(validateBundleOffers(defaultBundleOffers()), []);
  assert.equal(BUILT_IN_BUNDLE_PROMO_IMAGE, "/assets/bundles/bundle-offers-banner.png");
});

test("custom images resize through Cloudinary without cropping; empty slots keep the built-in image", () => {
  const content = defaultBundleOffers();
  content.tiles[1] = { image: uploaded("tile-2"), link: "/collections/deals" };
  content.promo = { image: uploaded("promo"), link: "/collections/bundle-offers" };
  const resolved = resolveBundleOffers(content, "demo");
  assert.equal(resolved.tiles[0].image, BUILT_IN_BUNDLE_TILES[0].image);
  assert.match(resolved.tiles[1].image, /\/image\/upload\/c_limit,w_900,q_auto,f_auto\/isolutions-development\/site\/.+\/tile-2$/);
  assert.equal(resolved.tiles[1].href, "/collections/deals");
  assert.match(resolved.promo.image, /c_limit,w_1400,q_auto,f_auto\/.+\/promo$/);
  assert.equal(resolved.promo.href, "/collections/bundle-offers");
});

test("validation: four tiles, internal links only, uploaded images only; empty promo link = not clickable", () => {
  const bad = defaultBundleOffers();
  bad.tiles[0].link = "https://evil.example";
  bad.tiles[2].image = { src: "https://evil.example/x.png", publicId: "x" };
  bad.promo.link = "//evil.example";
  assert.equal(validateBundleOffers(bad).length, 3);
  assert.equal(parseBundleOffers(bad), null);
  assert.equal(parseBundleOffers({ tiles: [], promo: {} }), null);
  const local = defaultBundleOffers();
  local.tiles[0].image = { src: "local-preview:abc", publicId: null };
  assert.equal(validateBundleOffers(local).length, 1);
  assert.deepEqual(validateBundleOffers(local, { allowLocalPreview: true }), []);
  const blank = defaultBundleOffers();
  blank.promo.link = "   ";
  assert.equal(normalizeBundleOffers(blank).promo.link, null);
});

test("storefront keeps the section markup; Admin reuses the banner upload and is wired under Homepage", () => {
  assert.match(storefront, /fetchPublishedBundleOffers\(\)/);
  assert.match(storefront, /className="home-bundles-promo" aria-label="Bundle Offers promotional banner"/);
  assert.match(storefront, /<a className="home-bundle-card" href=\{bundle\.href\} aria-label=\{bundle\.title\}/);
  assert.match(editor, /uploadBannerImage\(file\)/);
  assert.doesNotMatch(editor, /cloudinary-upload-signature/);
  assert.match(adminApp, /\["Bundle Offers", "\/admin\/bundle-offers", GalleryHorizontal\]/);
  assert.match(adminApp, /path === "\/admin\/bundle-offers"/);
});

test("migration keeps every existing site-content branch", () => {
  assert.match(migration, /check \(scope in \('announcement_bar', 'homepage', 'pdp_gallery', 'promo_popup', 'bundle_offers'\)\)/);
  for (const scope of ["promo_popup", "pdp_gallery", "bundle_offers"]) assert.match(migration, new RegExp(`if p_scope = '${scope}' then return public\\.validate_`));
  for (const scope of ["homepage", "pdp_gallery", "promo_popup", "bundle_offers"]) assert.match(migration, new RegExp(`p_scope = '${scope}' then`));
});

// ---------- migration behaviour (in-memory replay of every migration, 202611250002 included) ----------

const db = await createCatalogTestDatabase({ supabaseDefaultPrivileges: true });
const ownerId = await signInAsOwner(db);
const one = async (sql, params = []) => (await db.query(sql, params)).rows[0];
const asRole = async (role, fn) => {
  await db.query(`set role ${role}`);
  try { return await fn(); } finally { await db.query("reset role"); }
};
const actAs = (id) => db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [id]);
const save = (value) => asRole("authenticated", () => one(`select public.save_site_content_draft('bundle_offers', $1::jsonb) as r`, [JSON.stringify(value)]));
const publish = () => asRole("authenticated", () => one(`select public.publish_site_content('bundle_offers') as r`));
const publicRead = async () => (await asRole("anon", () => one(`select public.get_published_site_content('bundle_offers') as c`))).c;
const register = (image, format = "png") =>
  asRole("authenticated", () => one(`select public.register_site_asset($1, $2, 1456, 1080, 1000, $3) as r`, [image.publicId, image.src, format]));

test("nothing published: public read NULL (built-in section); probe reports install + Owner", async () => {
  await signOut(db);
  assert.equal(await publicRead(), null);
  await assert.rejects(asRole("anon", () => one(`select public.bundle_offers_installed() as r`)), /permission denied/);
  await actAs(ownerId);
  assert.deepEqual((await asRole("authenticated", () => one(`select public.bundle_offers_installed() as r`))).r, { installed: true, owner: true });
});

test("server validation refuses bad tiles, links and unregistered images", async () => {
  await actAs(ownerId);
  const ok = defaultBundleOffers();
  const cases = [
    [{ ...ok, tiles: ok.tiles.slice(0, 3) }, /tiles_must_be_four/],
    [{ ...ok, tiles: ok.tiles.map((tile, index) => (index ? tile : { ...tile, link: "https://evil.example" })) }, /tile_1_link_invalid/],
    [{ ...ok, tiles: ok.tiles.map((tile, index) => (index === 3 ? { ...tile, image: uploaded("never-uploaded") } : tile)) }, /tile_4_image_asset_not_registered/],
    [{ ...ok, promo: { image: { src: "local-preview:x" }, link: null } }, /promo_image_invalid/],
    [{ ...ok, promo: { image: null, link: "//evil.example" } }, /promo_link_invalid/],
    [{ ...ok, extra: 1 }, /content_unknown_key/],
  ];
  for (const [value, pattern] of cases) await assert.rejects(save(value), pattern, JSON.stringify(value));
});

test("Owner saves + publishes → public; Admin and visitors cannot write; other scopes unchanged", async () => {
  await actAs(ownerId);
  const tile = uploaded("tile-1");
  const promo = uploaded("promo");
  await register(tile, "webp");
  await register(promo, "png");
  const content = defaultBundleOffers();
  content.tiles[0] = { image: tile, link: "/collections/deals" };
  content.promo = { image: promo, link: "/collections/bundle-offers" };
  await save(content);
  await publish();
  assert.deepEqual(parseBundleOffers(await publicRead()), content);
  for (const scope of ["homepage", "pdp_gallery", "promo_popup"])
    assert.equal((await asRole("anon", () => one(`select public.get_published_site_content($1) as c`, [scope]))).c, null);

  const { rows: [{ id: adminId }] } = await db.query(`insert into auth.users (email) values ('admin-bundles@example.test') returning id`);
  await db.query(`update public.profiles set role = 'admin', is_active = true where id = $1`, [adminId]);
  await actAs(adminId);
  await assert.rejects(save(defaultBundleOffers()), /owner_required/);
  await assert.rejects(publish(), /owner_required/);
  await signOut(db);
  await assert.rejects(asRole("anon", () => one(`select public.save_site_content_draft('bundle_offers', '{}'::jsonb) as r`)), /permission denied/);
  await actAs(ownerId);
});
