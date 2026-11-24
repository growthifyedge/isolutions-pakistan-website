// Promotional Popup (2026-11-23, localhost): pure helpers, storefront / Admin source checks and migration
// 202611230001 ('promo_popup' scope) replayed in an in-memory database (scripts/support/catalogTestDatabase.mjs).
// Nothing here touches DEV or PROD.
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import {
  EMPTY_PROMO_POPUP,
  PROMO_POPUP_DELAY_MS,
  isPromoPopupShowable,
  parsePromoPopup,
  promoPopupFileProblem,
  promoPopupImageSources,
  promoPopupPreviewKey,
  toInternalPath,
  validatePromoPopup,
} from "../src/lib/promoPopup.ts";
import { createCatalogTestDatabase, signInAsOwner, signOut } from "./support/catalogTestDatabase.mjs";

const readText = (path) => readFileSync(new URL(path, import.meta.url), "utf8").replace(/\r\n/g, "\n");
const appRoot = readText("../src/App.tsx");
const popup = readText("../src/PromoPopup.tsx");
const popupCss = readText("../src/promoPopup.css");
const setting = readText("../src/admin/PromoPopupSetting.tsx");
const adminApp = readText("../src/admin/AdminApp.tsx");
const dbLib = readText("../src/lib/promoPopupDb.ts");
const migration = readText("../supabase/migrations/202611230001_site_content_promo_popup.sql");

const uploaded = (name) => ({
  src: `https://res.cloudinary.com/demo/image/upload/v1/isolutions-development/site/11111111-2222-3333-4444-555555555555/${name}`,
  publicId: `isolutions-development/site/11111111-2222-3333-4444-555555555555/${name}`,
});

test("parse / validate: ON needs image + link; internal links only; local preview images only in preview mode", () => {
  const on = { enabled: true, image: uploaded("promo"), link: "/product/apple-iphone-17-pro-max" };
  assert.deepEqual(parsePromoPopup(on), on);
  assert.deepEqual(parsePromoPopup(EMPTY_PROMO_POPUP), EMPTY_PROMO_POPUP);
  assert.deepEqual(parsePromoPopup({ enabled: false, image: uploaded("x"), link: null }), { enabled: false, image: uploaded("x"), link: null });
  for (const bad of [null, "x", {}, { enabled: "yes" }, { enabled: true, image: null, link: "/shop" }, { enabled: true, image: uploaded("a"), link: null },
    { enabled: true, image: uploaded("a"), link: "https://evil.example/" }, { enabled: true, image: uploaded("a"), link: "//evil.example" },
    { enabled: true, image: { src: "https://evil.example/a.jpg", publicId: "a" }, link: "/shop" },
    { enabled: true, image: { src: "local-preview:img-1", publicId: null }, link: "/shop" }])
    assert.equal(parsePromoPopup(bad), null, JSON.stringify(bad));
  const local = { enabled: true, image: { src: "local-preview:img-abc", publicId: null }, link: "/collections/deals" };
  assert.deepEqual(parsePromoPopup(local, { allowLocalPreview: true }), local);
  assert.equal(promoPopupPreviewKey(local), "img-abc");
  assert.match(validatePromoPopup({ enabled: true, image: null, link: null })[0], /Upload a popup image/);
});

test("showable only when ON with image and link", () => {
  assert.equal(isPromoPopupShowable(null), false);
  assert.equal(isPromoPopupShowable(EMPTY_PROMO_POPUP), false);
  assert.equal(isPromoPopupShowable({ enabled: false, image: uploaded("a"), link: "/shop" }), false);
  assert.equal(isPromoPopupShowable({ enabled: true, image: uploaded("a"), link: "/shop" }), true);
});

test("destination: pasted site address becomes a path; other sites stay invalid", () => {
  assert.equal(toInternalPath("  https://isolutionspakistan.com/product/x?y=1  "), "/product/x?y=1");
  assert.equal(toInternalPath("https://www.isolutionspakistan.com"), "/");
  assert.equal(toInternalPath("https://isolutionspakistan.com.evil.example/x"), "https://isolutionspakistan.com.evil.example/x");
  assert.equal(toInternalPath("/collections/deals"), "/collections/deals");
});

test("file rules: JPG / PNG / WebP up to 10 MB", () => {
  assert.equal(promoPopupFileProblem({ type: "image/jpeg", size: 1000 }), null);
  assert.equal(promoPopupFileProblem({ type: "image/png", size: 1000 }), null);
  assert.equal(promoPopupFileProblem({ type: "image/webp", size: 1000 }), null);
  assert.match(promoPopupFileProblem({ type: "image/gif", size: 1000 }), /JPG, PNG or WebP/);
  assert.match(promoPopupFileProblem({ type: "image/avif", size: 1000 }), /JPG, PNG or WebP/);
  assert.match(promoPopupFileProblem({ type: "image/png", size: 11 * 1024 * 1024 }), /10 MB/);
});

test("image delivery: Cloudinary resize only (c_limit, never cropped) with srcset", () => {
  const sources = promoPopupImageSources(uploaded("promo"), "demo");
  assert.match(sources.src, /\/image\/upload\/c_limit,w_720,q_auto,f_auto\/isolutions-development\/site\//);
  assert.match(sources.srcSet, /c_limit,w_480.* 480w, .*c_limit,w_720.* 720w, .*c_limit,w_1080.* 1080w, .*c_limit,w_1440.* 1440w, .*c_limit,w_1800.* 1800w$/);
  assert.doesNotMatch(sources.srcSet, /c_fill|c_crop|g_/);
  assert.equal(promoPopupImageSources({ src: "local-preview:img-x", publicId: null }, "demo", new Map()), null);
});

test("storefront: homepage only, separate chunk after page load, failure-safe", () => {
  assert.match(appRoot, /const PromoPopup = lazy\(\(\) => import\("\.\/PromoPopup"\)\.catch\(\(\) => \(\{ default: \(\) => null \}\)\)\);/);
  assert.match(appRoot, /if \(location\.pathname === "\/"\)\n\s+return \(\n\s+<>\n\s+<StorefrontApp \/>\n\s+<HomepagePromoPopup \/>/);
  assert.match(appRoot, /window\.addEventListener\("load", start, \{ once: true \}\)/);
  // StorefrontApp itself is not changed by this feature.
  assert.doesNotMatch(readText("../src/StorefrontApp.tsx"), /PromoPopup|promoPopup/);
});

test("storefront: 3 s after the visit, once per session, close via × / Esc / backdrop, image opens the link", () => {
  assert.equal(PROMO_POPUP_DELAY_MS, 3000);
  assert.match(popup, /const openedAt = 0;/);
  assert.match(popup, /Math\.max\(0, PROMO_POPUP_DELAY_MS - elapsed\)/);
  assert.match(popup, /if \(!preview && seenThisSession\(\)\) return;/);
  assert.match(popup, /window\.sessionStorage\.setItem\(PROMO_POPUP_SESSION_KEY, "1"\)/);
  assert.match(popup, /if \(!active \|\| !isPromoPopupShowable\(setting\)\) return;/);
  assert.match(popup, /await preload\(sources\);/);
  assert.match(popup, /<a className="promo-popup-link" href=\{ready\.link\}>/);
  assert.match(popup, /className="promo-popup-close" aria-label="Close" onClick=\{\(\) => setReady\(null\)\}/);
  assert.match(popup, /if \(event\.key === "Escape"\) setReady\(null\);/);
  assert.match(popup, /role="dialog" aria-modal="true"/);
  assert.match(popup, /\.catch\(\(\) => undefined\); \/\/ Any failure = no popup/);
  // No cart, checkout, catalog, price or stock module is imported by the popup.
  const imports = popup.split("\n").filter((line) => /^import |^\} from /.test(line)).join("\n");
  assert.doesNotMatch(imports, /cart|checkout|catalog|price|stock|orders/i);
});

test("storefront CSS (size fix 2026-11-23): ~900 px desktop, 94% phones, never taller than the screen, image proportions kept", () => {
  // Box width = smallest of target, side limit and available height × image ratio; image fills the box exactly.
  assert.match(popupCss, /--promo-target: 900px;\n\s+--promo-side: 92vw;\n\s+--promo-close: 40px;\n\s+--promo-bar: calc\(var\(--promo-close\) \+ 8px\);\n\s+--promo-max-h: calc\(100vh - 48px - var\(--promo-bar\)\);/);
  assert.match(popupCss, /width: min\(var\(--promo-target\), var\(--promo-side\), calc\(var\(--promo-max-h\) \* var\(--promo-ratio, 1\)\)\);/);
  assert.match(popupCss, /\.promo-popup \{ --promo-max-h: calc\(100dvh - 48px - var\(--promo-bar\)\); \}/);
  assert.match(popupCss, /@media \(max-width: 600px\) \{\n\s+\.promo-popup \{\n\s+--promo-target: 94vw;\n\s+--promo-side: 94vw;\n\s+--promo-close: 34px;/);
  assert.match(popupCss, /\.promo-popup-link img \{\n\s+display: block;\n\s+width: 100%;\n\s+height: auto;\n\s+object-fit: contain;/);
  assert.doesNotMatch(popupCss, /object-fit: cover|aspect-ratio:/);
  // Final UI fix (real-phone review): × (40 px desktop / 34 px phones) and the Preview label sit in a strip above the
  // image (padding-top = --promo-bar), never on the promotion; × keeps a ~48 px tap area.
  assert.match(popupCss, /padding-top: var\(--promo-bar\);/);
  assert.match(popupCss, /\.promo-popup-close \{\n\s+position: absolute;\n\s+top: 0;\n\s+right: 0;/);
  assert.match(popupCss, /width: var\(--promo-close\);\n\s+height: var\(--promo-close\);/);
  assert.match(popupCss, /\.promo-popup-close::before \{ content: ""; position: absolute; inset: -6px;/);
  assert.match(popupCss, /\.promo-popup-preview-tag \{\n\s+position: absolute;\n\s+left: 0;\n\s+top: calc\(\(var\(--promo-close\) - 24px\) \/ 2\);/);
  assert.match(popup, /\{preview && <span className="promo-popup-preview-tag">Preview · not published<\/span>\}/);
  assert.match(popup, /closeButton\.current\?\.focus\(\{ focusVisible: false \} as FocusOptions\);/);
  // Dark overlay kept.
  assert.match(popupCss, /background: rgba\(9, 15, 28, 0\.62\);/);
  assert.match(popupCss, /prefers-reduced-motion/);
  // The ratio comes from the loaded image; Admin frames use the same rule scaled to the frame.
  assert.match(popup, /resolve\(image\.naturalWidth \/ image\.naturalHeight\)/);
  assert.match(popup, /style=\{\{ "--promo-ratio": ready\.ratio \} as CSSProperties\}/);
  assert.match(popup, /const SIZES = "\(max-width: 600px\) 94vw, min\(900px, 92vw\)";/);
  assert.match(setting, /"--promo-ratio": ratio/);
});

test("Admin: Marketing → Promotional Popup page with upload, link, ON/OFF, desktop + mobile preview, Owner Save", () => {
  assert.match(adminApp, /\["Promotions", "\/admin\/promotions", CircleDollarSign\],\n\s+\["Promotional Popup", "\/admin\/promotional-popup", Megaphone\],/);
  assert.match(adminApp, /path === "\/admin\/promotional-popup"/);
  assert.match(setting, /MARKETING · PROMOTIONAL POPUP · OWNER ONLY/);
  assert.match(setting, /accept=\{PROMO_POPUP_IMAGE_TYPES\.join\(","\)\}/);
  assert.match(setting, /role="switch"/);
  assert.match(setting, /\{frame\("desktop"\)\}\n\s+\{frame\("mobile"\)\}/);
  assert.match(setting, /disabled=\{Boolean\(blocker\) \|\| Boolean\(busy\)\}/);
  assert.match(setting, /access === "not_installed"\n\s+\? "Saving is not available yet: the database update \(migration 202611230001\)/);
  // Browser-only preview images can never be saved.
  assert.match(setting, /: usesLocalImage\n\s+\? "This image is a browser-only preview/);
  // Saving available: the saved setting is always loaded (a browser preview written on first render must not hide it).
  assert.match(setting, /const stored = state\.draft \?\? state\.published \?\? EMPTY_PROMO_POPUP;\n\s+setValue\(stored\);/);
  assert.doesNotMatch(setting, /if \(!readBrowserPreview\(\)\)/);
  // Typed confirmation on Production only.
  assert.match(setting, /const needsTypedConfirmation = supabaseEnvironmentLabel === "Production";/);
  // Server decides access; upload uses the site-asset Edge Function path.
  assert.match(dbLib, /supabase\.rpc\("promo_popup_installed"\)/);
  assert.match(dbLib, /functions\.invoke<UploadSignature>\("cloudinary-upload-signature", \{ body: \{ siteAsset: true \} \}\)/);
});

test("migration file: prepared scope change only; homepage / pdp_gallery branches kept", () => {
  assert.match(migration, /PREPARED ONLY — not applied to DEV or PROD/);
  assert.match(migration, /check \(scope in \('announcement_bar', 'homepage', 'pdp_gallery', 'promo_popup'\)\)/);
  // No product, price, stock or order object is written or altered.
  assert.doesNotMatch(migration, /\b(insert\s+into|update|delete\s+from|alter\s+table)\s+public\.(products|product_variants|inventory_movements|orders|order_items|shipping_methods)\b/i);
  assert.match(migration, /if p_scope = 'pdp_gallery' then return public\.validate_pdp_gallery_content\(p_content\); end if;/);
});

// ---------- migration behaviour (in-memory replay of every migration, 202611230001 included) ----------

const db = await createCatalogTestDatabase({ supabaseDefaultPrivileges: true });
const ownerId = await signInAsOwner(db);
const one = async (sql, params = []) => (await db.query(sql, params)).rows[0];
const asRole = async (role, fn) => {
  await db.query(`set role ${role}`);
  try { return await fn(); } finally { await db.query("reset role"); }
};
const actAs = (id) => db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [id]);
const save = (value) => asRole("authenticated", () => one(`select public.save_site_content_draft('promo_popup', $1::jsonb) as r`, [JSON.stringify(value)]));
const publish = () => asRole("authenticated", () => one(`select public.publish_site_content('promo_popup') as r`));
const publicRead = async () => (await asRole("anon", () => one(`select public.get_published_site_content('promo_popup') as c`))).c;
const register = (image, format = "png") =>
  asRole("authenticated", () => one(`select public.register_site_asset($1, $2, 1080, 1350, 1000, $3) as r`, [image.publicId, image.src, format]));

test("nothing published: no popup (public read NULL); probe reports install + Owner", async () => {
  await signOut(db);
  assert.equal(await publicRead(), null);
  await assert.rejects(asRole("anon", () => one(`select public.promo_popup_installed() as r`)), /permission denied/);
  await actAs(ownerId);
  const probe = await asRole("authenticated", () => one(`select public.promo_popup_installed() as r`));
  assert.deepEqual(probe.r, { installed: true, owner: true });
});

test("server validation: ON needs a registered JPG/PNG/WebP image and an internal link", async () => {
  await actAs(ownerId);
  const gif = uploaded("anim");
  await register(gif, "avif");
  const cases = [
    [{ enabled: "yes" }, /enabled_invalid/],
    [{ enabled: true }, /image_required.*link_required|link_required.*image_required/],
    [{ enabled: true, image: uploaded("never-uploaded"), link: "/shop" }, /image_asset_not_registered/],
    [{ enabled: true, image: gif, link: "/shop" }, /image_asset_not_registered/],
    [{ enabled: true, image: { src: "local-preview:img-1" }, link: "/shop" }, /image_invalid/],
    [{ enabled: false, link: "https://evil.example" }, /link_invalid/],
    [{ enabled: false, link: "//evil.example" }, /link_invalid/],
    [{ enabled: false, extra: 1 }, /content_unknown_key/],
  ];
  for (const [value, pattern] of cases) await assert.rejects(save(value), pattern, JSON.stringify(value));
});

test("Owner saves ON → public; OFF → hidden; Admin and visitors cannot write; other scopes unchanged", async () => {
  await actAs(ownerId);
  const image = uploaded("promo");
  await register(image, "webp");
  await save({ enabled: true, image, link: "/collections/deals" });
  await publish();
  assert.deepEqual(parsePromoPopup(await publicRead()), { enabled: true, image, link: "/collections/deals" });

  await save({ enabled: false, image, link: "/collections/deals" });
  await publish();
  assert.equal(await publicRead(), null);

  // Homepage banners and the PDP background are separate scopes: still nothing published there.
  assert.equal((await asRole("anon", () => one(`select public.get_published_site_content('homepage') as c`))).c, null);
  assert.equal((await asRole("anon", () => one(`select public.get_published_site_content('pdp_gallery') as c`))).c, null);

  const { rows: [{ id: adminId }] } = await db.query(`insert into auth.users (email) values ('admin-popup@example.test') returning id`);
  await db.query(`update public.profiles set role = 'admin', is_active = true where id = $1`, [adminId]);
  await actAs(adminId);
  await assert.rejects(save(EMPTY_PROMO_POPUP), /owner_required/);
  await assert.rejects(publish(), /owner_required/);
  assert.deepEqual((await asRole("authenticated", () => one(`select public.promo_popup_installed() as r`))).r, { installed: true, owner: false });
  await signOut(db);
  await assert.rejects(asRole("anon", () => one(`select public.save_site_content_draft('promo_popup', '{}'::jsonb) as r`)), /permission denied/);
  await actAs(ownerId);
});
