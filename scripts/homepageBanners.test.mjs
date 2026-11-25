// Website Editor — Homepage Banner & Slider (PROJECT_HANDOVER.md §4S).
// Pure helpers, the migration 202611200001 replayed in an in-memory database (scripts/support/catalogTestDatabase.mjs;
// nothing here touches DEV or PROD), the upload Edge Function source and the storefront wiring.
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import {
  DEFAULT_HOMEPAGE_BANNERS,
  bannerErrorMessage,
  bannersToSlides,
  defaultHomepageBanners,
  isInternalLink,
  isLocalPreviewSrc,
  localPreviewKeys,
  moveBanner,
  normalizeBanner,
  parseHomepageContent,
  resolveLocalPreviewImages,
  slidesSignature,
  validateHomepageBanners,
} from "../src/lib/homepageBanners.ts";
import { createCatalogTestDatabase, signInAsOwner, signOut } from "./support/catalogTestDatabase.mjs";

const readText = (path) => readFileSync(new URL(path, import.meta.url), "utf8").replace(/\r\n/g, "\n");
const storefront = readText("../src/StorefrontApp.tsx");
const migration = readText("../supabase/migrations/202611200001_site_content_homepage_banners.sql");
const uploadFunction = readText("../supabase/functions/cloudinary-upload-signature/index.ts");
const adminApp = readText("../src/admin/AdminApp.tsx");
const bannerManager = readText("../src/admin/BannerManager.tsx");
const adminCss = readText("../src/admin/admin.css");
const previewStore = readText("../src/lib/bannerPreviewStore.ts");

// ---------- built-in banners (default + fallback) ----------

test("the 7 existing homepage slides are preserved in their original order as the built-in banners", () => {
  assert.equal(DEFAULT_HOMEPAGE_BANNERS.length, 7);
  assert.deepEqual(
    DEFAULT_HOMEPAGE_BANNERS.map((banner) => banner.desktop.src),
    [
      "/assets/banners/banner-apple-01-desktop.webp",
      "/assets/banners/banner-redmi-note-15-pro-desktop.webp",
      "/assets/banners/banner-tecno-camon-50-pro-desktop-v2.webp",
      "/assets/banners/banner-samsung-galaxy-s26-ultra-desktop.webp",
      "/assets/banners/banner-xiaomi-tv-a-series-2026-desktop.webp",
      "/assets/banners/banner-xiaomi-eco-accessories-desktop.webp",
      "/assets/banners/banner-iphone-18-pro-max-desktop.webp",
    ],
  );
  for (const banner of DEFAULT_HOMEPAGE_BANNERS) {
    assert.equal(banner.enabled, true);
    assert.equal(banner.heading, null);
    assert.equal(banner.buttonText, null);
    assert.equal(banner.link, null);
    assert.match(banner.mobile.src, /-mobile\.webp$/);
  }
  assert.deepEqual(validateHomepageBanners(DEFAULT_HOMEPAGE_BANNERS), []);
});

test("built-in banners become exactly the slides the carousel showed before (no heading, button or link)", () => {
  const slides = bannersToSlides(DEFAULT_HOMEPAGE_BANNERS, "demo-cloud");
  assert.equal(slides.length, 7);
  assert.deepEqual(slides[0], {
    desktopSrc: "/assets/banners/banner-apple-01-desktop.webp",
    mobileSrc: "/assets/banners/banner-apple-01-mobile.webp",
    alt: "Apple products banner",
  });
  assert.deepEqual(Object.keys(slides[6]).sort(), ["alt", "desktopSrc", "mobileSrc"]);
});

test("defaultHomepageBanners returns an editable copy that cannot change the built-in list", () => {
  const copy = defaultHomepageBanners();
  copy[0].desktop.src = "/assets/banners/changed.webp";
  copy[0].alt = "Changed";
  assert.equal(DEFAULT_HOMEPAGE_BANNERS[0].desktop.src, "/assets/banners/banner-apple-01-desktop.webp");
  assert.equal(DEFAULT_HOMEPAGE_BANNERS[0].alt, "Apple products banner");
});

// ---------- editing helpers ----------

test("order up/down swaps neighbours and ignores moves past either end", () => {
  assert.deepEqual(moveBanner(["a", "b", "c"], 1, -1), ["b", "a", "c"]);
  assert.deepEqual(moveBanner(["a", "b", "c"], 1, 1), ["a", "c", "b"]);
  assert.deepEqual(moveBanner(["a", "b", "c"], 0, -1), ["a", "b", "c"]);
  assert.deepEqual(moveBanner(["a", "b", "c"], 2, 1), ["a", "b", "c"]);
});

test("disabled banners are left out of the carousel; uploads use responsive Cloudinary delivery", () => {
  const banners = defaultHomepageBanners().slice(0, 2);
  banners[0].enabled = false;
  banners[1] = {
    ...banners[1],
    heading: "New Redmi",
    buttonText: "Shop now",
    link: "/shop?brand=redmi",
    desktop: { src: "https://res.cloudinary.com/demo-cloud/image/upload/v1/root/site/x/desk.jpg", publicId: "root/site/x/desk" },
    mobile: { src: "https://res.cloudinary.com/demo-cloud/image/upload/v1/root/site/y/mob.jpg", publicId: "root/site/y/mob" },
  };
  const slides = bannersToSlides(banners, "demo-cloud");
  assert.equal(slides.length, 1);
  assert.equal(slides[0].desktopSrc, "https://res.cloudinary.com/demo-cloud/image/upload/c_limit,w_2000,q_auto,f_auto/root/site/x/desk");
  assert.equal(slides[0].mobileSrc, "https://res.cloudinary.com/demo-cloud/image/upload/c_limit,w_1122,q_auto,f_auto/root/site/y/mob");
  assert.equal(slides[0].heading, "New Redmi");
  assert.equal(slides[0].buttonText, "Shop now");
  assert.equal(slides[0].link, "/shop?brand=redmi");
  assert.notEqual(slidesSignature(slides), slidesSignature(bannersToSlides(DEFAULT_HOMEPAGE_BANNERS)));
});

test("links must be internal site paths", () => {
  for (const ok of ["/", "/shop", "/collections/samsung", "/shop?brand=redmi&sort=new", "/product/iphone-18#specs"])
    assert.equal(isInternalLink(ok), true, ok);
  for (const bad of ["https://evil.example", "//evil.example", "javascript:alert(1)", "shop", "/sh op", "/\\evil", "/a<b>", `/${"a".repeat(200)}`])
    assert.equal(isInternalLink(bad), false, bad);
});

test("client validation mirrors the server rules", () => {
  const banners = defaultHomepageBanners();
  assert.deepEqual(validateHomepageBanners([]), ["banners_required"]);
  assert.deepEqual(validateHomepageBanners(Array.from({ length: 13 }, (_, i) => ({ ...banners[0], id: `b${i}` }))), ["banners_too_many"]);
  const broken = [
    { ...banners[0], alt: " " },
    { ...banners[1], buttonText: "Buy", link: null },
    { ...banners[2], link: "https://evil.example" },
    { ...banners[3], desktop: { src: "https://evil.example/x.jpg", publicId: null } },
    { ...banners[4], id: banners[0].id },
  ];
  assert.deepEqual(validateHomepageBanners(broken), [
    "banner_1_alt_invalid",
    "banner_2_button_requires_link",
    "banner_3_link_invalid",
    "banner_4_desktop_src_not_allowed",
    "banner_5_id_duplicate",
  ]);
  assert.deepEqual(validateHomepageBanners(banners.map((banner) => ({ ...banner, enabled: false }))), ["enabled_banner_required"]);
  const local = [{ ...banners[0], desktop: { src: "local-preview:img-abc123", publicId: null } }];
  assert.deepEqual(validateHomepageBanners(local), ["banner_1_desktop_src_not_allowed"]);
  assert.deepEqual(validateHomepageBanners(local, { allowLocalPreview: true }), []);
  assert.match(bannerErrorMessage("banner_2_button_requires_link"), /^Banner 2: a button needs a link\.$/);
});

test("normalizeBanner trims text and turns empty optional fields into null", () => {
  const banner = normalizeBanner({ ...DEFAULT_HOMEPAGE_BANNERS[0], alt: "  Apple  ", heading: "   ", buttonText: " Go ", link: "" });
  assert.equal(banner.alt, "Apple");
  assert.equal(banner.heading, null);
  assert.equal(banner.buttonText, "Go");
  assert.equal(banner.link, null);
});

test("unusable published data is rejected so the storefront keeps the built-in banners", () => {
  assert.equal(parseHomepageContent(null), null);
  assert.equal(parseHomepageContent({ banners: [] }), null);
  assert.equal(parseHomepageContent({ banners: [{ id: "x" }] }), null);
  assert.equal(parseHomepageContent({ banners: [{ ...DEFAULT_HOMEPAGE_BANNERS[0], link: "javascript:alert(1)" }] }), null);
  assert.equal(parseHomepageContent({ banners: DEFAULT_HOMEPAGE_BANNERS }).length, 7);
});

// ---------- storefront wiring ----------

test("storefront: built-in banners are the fallback; published content only; preview never touches the database", () => {
  assert.match(storefront, /const builtInHomeHeroSlides = bannersToSlides\(DEFAULT_HOMEPAGE_BANNERS\);/);
  assert.match(storefront, /fetchPublishedHomepageBanners\(\)/);
  assert.match(storefront, /\.catch\(fallback\)/);
  assert.match(storefront, /banners \? bannersToSlides\(banners, CLOUDINARY_CLOUD_NAME\) : builtInHomeHeroSlides/);
  assert.match(storefront, /const timer = window\.setTimeout\(fallback, PUBLISHED_BANNERS_WAIT_MS\);/);
  assert.match(storefront, /if \(isPreview\) \{[\s\S]*?window\.addEventListener\("storage", onStorage\);[\s\S]*?return \(\) =>/);
  assert.match(storefront, /<HomeHeroCarousel key=\{slidesSignature\(slides\)\} slides=\{slides\} \/>/);
  assert.match(storefront, /<HomeHeroBanners \/>/);
  assert.doesNotMatch(storefront, /<HomeHeroCarousel \/>/);
  // The carousel itself keeps its logic; it only receives the slide list.
  assert.match(storefront, /function HomeHeroCarousel\(\{ slides: homeHeroSlides \}: \{ slides: readonly HomeHeroSlide\[\] \}\)/);
  assert.equal((storefront.match(/assets\/banners\/banner-/g) ?? []).length, 1, "only the Samsung PDP promo still references a banner file directly");
});

test("storefront: banner heading/button/link render only when set, and a swipe never follows a link", () => {
  assert.match(storefront, /\{slide\.link && !slide\.buttonText \? \(/);
  assert.match(storefront, /\{\(slide\.heading \|\| slide\.buttonText\) && \(/);
  assert.match(storefront, /swiped\.current = Math\.abs\(distance\) >= 10;/);
  assert.match(storefront, /onClickCapture=\{\(event\) => \{\s*if \(swiped\.current\) event\.preventDefault\(\);/);
});

// ---------- localhost homepage preview (browser-local only) ----------

test("local preview images: only local-preview:<key> references, never accepted by the live parser", () => {
  assert.equal(isLocalPreviewSrc("local-preview:img-abc123"), true);
  for (const bad of ["blob:http://127.0.0.1:5173/x", "local-preview:", "local-preview:../x", "local-preview:a b"]) assert.equal(isLocalPreviewSrc(bad), false, bad);
  const banners = defaultHomepageBanners().slice(0, 3);
  banners[0].desktop = { src: "local-preview:img-desk", publicId: null };
  banners[1].mobile = { src: "local-preview:img-mob", publicId: null };
  banners[2].desktop = { src: "local-preview:img-gone", publicId: null };
  assert.deepEqual(localPreviewKeys(banners), ["img-desk", "img-mob", "img-gone"]);
  assert.equal(parseHomepageContent({ banners }), null, "visitors' published/cached content can never contain local images");
  assert.equal(parseHomepageContent({ banners }, { allowLocalPreview: true }).length, 3);
  const urls = new Map([["img-desk", "blob:x/1"], ["img-mob", "blob:x/2"]]);
  const resolved = resolveLocalPreviewImages(banners, urls);
  assert.equal(resolved.length, 2, "a banner whose local desktop image is gone is left out");
  assert.equal(resolved[0].desktop.src, "blob:x/1");
  assert.equal(resolved[1].mobile.src, "blob:x/2");
  const missingMobile = resolveLocalPreviewImages([{ ...banners[1], mobile: { src: "local-preview:img-none", publicId: null } }], urls);
  assert.equal(missingMobile[0].mobile, null, "missing local mobile image falls back to the desktop image");
});

test("preview mode: only with ?bannerPreview=1, clearly labelled with Exit Preview, never writes the visitor cache", () => {
  assert.match(storefront, /get\("bannerPreview"\) === "1"/);
  assert.match(storefront, /isPreview \? null : readStoredSlides\(BANNER_CACHE_STORAGE_KEY\)/);
  assert.match(storefront, /const label = isPreview && !isPreviewFrame \? <BannerPreviewLabel \/> : null;/);
  assert.match(storefront, /<strong>Localhost preview<\/strong>/);
  assert.match(storefront, /not published\. The live website is unchanged\./);
  assert.match(storefront, /<a href="\/">Exit Preview<\/a>/);
  const previewBranch = storefront.slice(storefront.indexOf("if (isPreview) {"), storefront.indexOf("let active = true;"));
  assert.doesNotMatch(previewBranch, /writeBannerCache|fetchPublishedHomepageBanners/);
  assert.doesNotMatch(previewStore, /supabase|fetch\(|functions\.invoke/, "local preview images never leave the browser");
});

test("editor: Preview on Localhost opens the real homepage; preview-only edits survive a refresh", () => {
  assert.match(bannerManager, /const HOMEPAGE_PREVIEW_URL = "\/\?bannerPreview=1";/);
  assert.match(bannerManager, /window\.open\(HOMEPAGE_PREVIEW_URL, PREVIEW_TAB_NAME\)/);
  assert.match(bannerManager, /\{isLocalhost \? "Preview on Localhost" : "Preview on homepage"\}/);
  assert.match(bannerManager, /src=\{`\$\{HOMEPAGE_PREVIEW_URL\}&frame=1`\}/);
  assert.match(bannerManager, /const stored = readStoredPreview\(\);\s*setBanners\(stored \?\? defaultHomepageBanners\(\)\);/);
  assert.match(bannerManager, /await putPreviewImage\(key, file\);/);
  // Save Draft / Publish stay blocked while any image is browser-local.
  assert.match(bannerManager, /disabled=\{!writable \|\| !!localErrors\.length \|\| hasLocalImages\}/);
});

test("editor layout: the sticky preview sits below the sticky Admin top bar and never exceeds the screen; no bare <header> (storefront CSS)", () => {
  assert.match(adminCss, /\.admin-topbar \{[^}]*position: sticky;[^}]*top: 0;/);
  assert.match(adminCss, /\.banner-preview \{ position:sticky; top:88px; z-index:1; max-height:calc\(100vh - 168px\); overflow:auto;/);
  assert.match(adminCss, /\.banner-list,\.banner-preview \{ min-width:0; \}/);
  assert.match(adminCss, /\.banner-preview \{ position:static; max-height:none; overflow:visible; \}/);
  // The storefront stylesheet (also loaded on Admin pages) styles every bare <header> as the site header
  // (88 px tall, wide side padding), which pushed the preview off-screen and added a horizontal scrollbar.
  assert.doesNotMatch(bannerManager, /<header[\s>]/);
  assert.doesNotMatch(adminCss, /\.banner-(card|preview) header/);
  assert.match(bannerManager, /const maxFrameHeight = Math\.max\(280, viewportHeight - 300\);/);
});

// ---------- Admin + Edge Function ----------

test("Admin route and navigation entry exist", () => {
  assert.match(adminApp, /\["Homepage Banners", "\/admin\/homepage-banners", GalleryHorizontal\]/);
  assert.match(adminApp, /path === "\/admin\/homepage-banners"\)\s*page = \(\s*<AdminLayout section="Homepage Banners">\s*<BannerManager \/>/);
});

test("upload Edge Function: site images are Owner only and go to <root>/site/<uuid>; product/bundle paths unchanged", () => {
  assert.match(uploadFunction, /if \(siteAsset === true\) \{\s*if \(productId \|\| bundleId\) throw new Error\("invalid_media_target"\);\s*const \{ data: isOwner, error: ownerError \} = await client\.rpc\("is_site_owner"\);\s*if \(ownerError \|\| !isOwner\) throw new Error\("forbidden"\);/);
  assert.match(uploadFunction, /\$\{folderRoot\}\/site\/\$\{crypto\.randomUUID\(\)\}/);
  assert.match(uploadFunction, /\$\{folderRoot\}\/bundles\/\$\{bundleId\}/);
  assert.match(uploadFunction, /\$\{folderRoot\}\/products\/\$\{productId\}/);
});

test("migration touches no commerce object", () => {
  for (const table of ["products", "product_variants", "inventory_movements", "orders", "order_items", "bundles", "product_media"])
    assert.doesNotMatch(migration, new RegExp(`(alter|update|insert into|delete from|drop)\\s+(table\\s+)?public\\.${table}\\b`, "i"), table);
});

// ---------- migration behaviour (in-memory replay) ----------

const db = await createCatalogTestDatabase({ supabaseDefaultPrivileges: true });
const ownerId = await signInAsOwner(db);
const all = async (sql, params = []) => (await db.query(sql, params)).rows;
const one = async (sql, params = []) => (await all(sql, params))[0];
const asRole = async (role, fn) => {
  await db.query(`set role ${role}`);
  try { return await fn(); } finally { await db.query("reset role"); }
};
const content = (banners) => JSON.stringify({ banners });
const builtIn = JSON.parse(JSON.stringify(DEFAULT_HOMEPAGE_BANNERS));
const { rows: [{ id: adminId }] } = await db.query(`insert into auth.users (email) values ('admin@example.test') returning id`);
await db.query(`update public.profiles set role = 'admin', is_active = true where id = $1`, [adminId]);
const actAs = (id) => db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [id]);

test("nothing published: the public read returns NULL (storefront shows the built-in banners)", async () => {
  await signOut(db);
  const row = await asRole("anon", () => one(`select public.get_published_site_content('homepage') as content`));
  assert.equal(row.content, null);
  await actAs(ownerId);
});

test("Owner can save a draft; the draft is not public until published", async () => {
  await actAs(ownerId);
  const saved = await asRole("authenticated", () => one(`select public.save_site_content_draft('homepage', $1::jsonb) as r`, [content(builtIn)]));
  assert.ok(saved.r.id);
  const pub = await asRole("anon", () => one(`select public.get_published_site_content('homepage') as content`));
  assert.equal(pub.content, null);
  const state = await asRole("authenticated", () => one(`select public.get_site_content_admin('homepage') as s`));
  assert.equal(state.s.draft.content.banners.length, 7);
  assert.equal(state.s.published, null);
});

test("server validation rejects bad content", async () => {
  await actAs(ownerId);
  const cases = [
    [{ banners: [] }, /banners_required/],
    [{ banners: builtIn, extra: 1 }, /content_unknown_key/],
    [{ banners: [{ ...builtIn[0], link: "https://evil.example" }] }, /banner_1_link_invalid/],
    [{ banners: [{ ...builtIn[0], link: "//evil.example" }] }, /banner_1_link_invalid/],
    [{ banners: [{ ...builtIn[0], buttonText: "Buy" }] }, /banner_1_button_requires_link/],
    [{ banners: [{ ...builtIn[0], alt: "" }] }, /banner_1_alt_invalid/],
    [{ banners: [{ ...builtIn[0], desktop: { src: "https://evil.example/x.jpg", publicId: null } }] }, /banner_1_desktop_src_not_allowed/],
    [{ banners: [{ ...builtIn[0], desktop: { src: "https://res.cloudinary.com/c/image/upload/v1/r/site/x/y.jpg", publicId: "r/site/x/y" } }] }, /banner_1_desktop_asset_not_registered/],
    [{ banners: [{ ...builtIn[0], enabled: false }] }, /enabled_banner_required/],
    [{ banners: [builtIn[0], builtIn[0]] }, /banner_2_id_duplicate/],
    [{ banners: [{ ...builtIn[0], script: "<b>" }] }, /banner_1_unknown_key/],
  ];
  for (const [value, pattern] of cases)
    await assert.rejects(
      asRole("authenticated", () => db.query(`select public.save_site_content_draft('homepage', $1::jsonb)`, [JSON.stringify(value)])),
      pattern,
    );
  await assert.rejects(
    asRole("authenticated", () => db.query(`select public.save_site_content_draft('announcement_bar', $1::jsonb)`, [content(builtIn)])),
    /scope_not_supported/,
  );
});

test("Admin (non-Owner), signed-out and anonymous users cannot read drafts or write", async () => {
  await actAs(adminId);
  for (const sql of [
    `select public.save_site_content_draft('homepage', '${content(builtIn).replace(/'/g, "''")}'::jsonb)`,
    `select public.publish_site_content('homepage')`,
    `select public.get_site_content_admin('homepage')`,
    `select public.register_site_asset('r/site/00000000-0000-0000-0000-000000000000/a', 'https://res.cloudinary.com/c/image/upload/v1/a.jpg', 10, 10, 10, 'jpg')`,
  ])
    await assert.rejects(asRole("authenticated", () => db.query(sql)), /owner_required/, sql);
  assert.equal((await asRole("authenticated", () => all(`select * from public.site_content_versions`))).length, 0, "RLS hides drafts from Admin");
  assert.equal((await asRole("authenticated", () => one(`select public.is_site_owner() as v`))).v, false);
  await assert.rejects(asRole("authenticated", () => db.query(`update public.site_content_versions set content = '{}'::jsonb`)), /permission denied/);
  await assert.rejects(asRole("authenticated", () => db.query(`insert into public.site_content_versions (scope, status, content) values ('homepage','published','{}')`)), /permission denied/);
  await signOut(db);
  await assert.rejects(asRole("anon", () => db.query(`select public.publish_site_content('homepage')`)), /permission denied/);
  await assert.rejects(asRole("anon", () => db.query(`select * from public.site_content_versions`)), /permission denied/);
  await assert.rejects(asRole("anon", () => db.query(`select public.validate_site_content('homepage', '{}'::jsonb)`)), /permission denied/);
  await actAs(ownerId);
});

test("Publish makes the draft live (enabled banners only); Restore copies a version back into the draft", async () => {
  await actAs(ownerId);
  // Version 1: the built-in banners.
  await asRole("authenticated", () => db.query(`select public.save_site_content_draft('homepage', $1::jsonb)`, [content(builtIn)]));
  await asRole("authenticated", () => db.query(`select public.publish_site_content('homepage')`));
  let pub = await asRole("anon", () => one(`select public.get_published_site_content('homepage') as c`));
  assert.equal(pub.c.banners.length, 7);

  // Version 2: an uploaded banner first, reordered, one disabled, with heading/button/link.
  const asset = await asRole("authenticated", () => one(
    `select public.register_site_asset('isolutions-development/site/11111111-2222-3333-4444-555555555555/abc123',
       'https://res.cloudinary.com/demo/image/upload/v1/isolutions-development/site/11111111-2222-3333-4444-555555555555/abc123.jpg',
       2000, 839, 120000, 'JPG') as a`));
  const uploaded = {
    id: "banner-new", enabled: true, alt: "Big sale", heading: "Big sale", buttonText: "Shop now", link: "/shop",
    desktop: { src: asset.a.src, publicId: asset.a.publicId }, mobile: null,
  };
  const v2 = [uploaded, { ...builtIn[1], enabled: false }, builtIn[0]];
  await asRole("authenticated", () => db.query(`select public.save_site_content_draft('homepage', $1::jsonb)`, [content(v2)]));
  pub = await asRole("anon", () => one(`select public.get_published_site_content('homepage') as c`));
  assert.equal(pub.c.banners.length, 7, "saving a draft does not change the live site");
  await asRole("authenticated", () => db.query(`select public.publish_site_content('homepage')`));
  pub = await asRole("anon", () => one(`select public.get_published_site_content('homepage') as c`));
  assert.deepEqual(pub.c.banners.map((banner) => banner.id), ["banner-new", builtIn[0].id], "disabled banner hidden, order kept");
  assert.equal(pub.c.banners[0].buttonText, "Shop now");

  // History: version 1 archived, version 2 published, no draft left.
  const state = (await asRole("authenticated", () => one(`select public.get_site_content_admin('homepage') as s`))).s;
  assert.equal(state.draft, null);
  assert.deepEqual(state.history.map((version) => version.status).sort(), ["archived", "published"]);
  await assert.rejects(asRole("authenticated", () => db.query(`select public.publish_site_content('homepage')`)), /draft_not_found/);

  // Restore version 1 into the draft; the live site stays on version 2 until Publish.
  const archived = state.history.find((version) => version.status === "archived");
  await asRole("authenticated", () => db.query(`select public.restore_site_content_version('homepage', $1::uuid)`, [archived.id]));
  pub = await asRole("anon", () => one(`select public.get_published_site_content('homepage') as c`));
  assert.equal(pub.c.banners.length, 2);
  await asRole("authenticated", () => db.query(`select public.publish_site_content('homepage')`));
  pub = await asRole("anon", () => one(`select public.get_published_site_content('homepage') as c`));
  assert.equal(pub.c.banners.length, 7);
  assert.equal(pub.c.banners[0].desktop.src, "/assets/banners/banner-apple-01-desktop.webp");
  const counts = await one(`select count(*) filter (where status = 'published') as published, count(*) filter (where status = 'draft') as drafts from public.site_content_versions`);
  assert.equal(Number(counts.published), 1);
  assert.equal(Number(counts.drafts), 0);
});

test("site assets: only Cloudinary site-folder uploads can be registered", async () => {
  await actAs(ownerId);
  await assert.rejects(
    asRole("authenticated", () => db.query(`select public.register_site_asset('isolutions-development/products/x/abc', 'https://res.cloudinary.com/demo/image/upload/v1/a.jpg', 1, 1, 1, 'jpg')`)),
    /check constraint/,
  );
  await assert.rejects(
    asRole("authenticated", () => db.query(`select public.register_site_asset('isolutions-development/site/11111111-2222-3333-4444-555555555555/zz', 'https://evil.example/a.jpg', 1, 1, 1, 'jpg')`)),
    /check constraint/,
  );
});
