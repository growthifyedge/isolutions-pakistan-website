// Global PDP Background (2026-11-21): pure helpers + migration 202611200001 ('pdp_gallery' scope) replayed in an
// in-memory database (scripts/support/catalogTestDatabase.mjs). Nothing here touches DEV or PROD.
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import {
  DEFAULT_PDP_BACKGROUND,
  parsePdpGalleryBackground,
  pdpBackgroundPreviewKeys,
  pdpBackgroundStyle,
  validatePdpGalleryBackground,
} from "../src/lib/pdpGalleryBackground.ts";
import { createCatalogTestDatabase, signInAsOwner, signOut } from "./support/catalogTestDatabase.mjs";

const readText = (path) => readFileSync(new URL(path, import.meta.url), "utf8").replace(/\r\n/g, "\n");
const app = readText("../src/StorefrontApp.tsx");
const css = readText("../src/styles.css");
const adminApp = readText("../src/admin/AdminApp.tsx");
const setting = readText("../src/admin/PdpBackgroundSetting.tsx");

const uploaded = (name) => ({ src: `https://res.cloudinary.com/demo/image/upload/v1/isolutions-development/site/11111111-2222-3333-4444-555555555555/${name}`, publicId: `isolutions-development/site/11111111-2222-3333-4444-555555555555/${name}` });

test("parse / validate: default, colour and image settings; anything unusable = built-in look", () => {
  assert.deepEqual(parsePdpGalleryBackground(DEFAULT_PDP_BACKGROUND), DEFAULT_PDP_BACKGROUND);
  assert.deepEqual(parsePdpGalleryBackground({ mode: "color", color: "#eaf2fb", desktop: null, mobile: null }), { mode: "color", color: "#EAF2FB", desktop: null, mobile: null });
  const image = { mode: "image", color: null, desktop: uploaded("desk"), mobile: null };
  assert.deepEqual(parsePdpGalleryBackground(image), image);
  for (const bad of [null, "x", { mode: "fancy" }, { mode: "color", color: null }, { mode: "image", desktop: null },
    { mode: "image", desktop: { src: "https://evil.example/a.jpg", publicId: "a" } }, { mode: "image", desktop: { src: "local-preview:img-1", publicId: null } }])
    assert.equal(parsePdpGalleryBackground(bad), null, JSON.stringify(bad));
  // Browser-local preview images only in preview mode.
  const local = { mode: "image", color: null, desktop: { src: "local-preview:img-a", publicId: null }, mobile: { src: "local-preview:img-b", publicId: null } };
  assert.deepEqual(parsePdpGalleryBackground(local, { allowLocalPreview: true }), local);
  assert.deepEqual(pdpBackgroundPreviewKeys(local), ["img-a", "img-b"]);
  assert.match(validatePdpGalleryBackground({ mode: "color", color: "blue", desktop: null, mobile: null })[0], /hex/);
});

test("style: colour, desktop landscape + mobile portrait (mobile falls back to desktop), default = none", () => {
  assert.equal(pdpBackgroundStyle(DEFAULT_PDP_BACKGROUND, "demo"), null);
  assert.equal(pdpBackgroundStyle(null, "demo"), null);
  assert.deepEqual(pdpBackgroundStyle({ mode: "color", color: "#EAF2FB", desktop: null, mobile: null }, "demo"), { "--pdp-bg-color": "#EAF2FB" });
  const both = pdpBackgroundStyle({ mode: "image", color: "#FFFFFF", desktop: uploaded("desk"), mobile: uploaded("mob") }, "demo");
  assert.match(both["--pdp-bg-desktop"], /^url\("https:\/\/res\.cloudinary\.com\/demo\/image\/upload\/c_limit,w_1800,q_auto,f_auto\/.*\/desk"\)$/);
  assert.match(both["--pdp-bg-mobile"], /c_limit,w_1000,q_auto,f_auto\/.*\/mob"\)$/);
  const desktopOnly = pdpBackgroundStyle({ mode: "image", color: null, desktop: uploaded("desk"), mobile: null }, "demo");
  assert.equal(desktopOnly["--pdp-bg-mobile"], desktopOnly["--pdp-bg-desktop"]);
  const local = pdpBackgroundStyle({ mode: "image", color: null, desktop: { src: "local-preview:img-a", publicId: null }, mobile: null }, "demo", new Map([["img-a", "blob:x"]]));
  assert.equal(local["--pdp-bg-desktop"], 'url("blob:x")');
});

test("PDP: background on the main image box only, product image still contain, label removed, preview labelled", () => {
  assert.doesNotMatch(app, /ISOLUTIONS SELECTED/);
  assert.match(app, /\$\{pdpBackground\.style \? " has-global-background" : ""\}/);
  assert.match(app, /\.\.\.\(pdpBackground\.style \?\? \{\}\)/);
  assert.match(app, /PDP background from this browser only — not published\. The live website is unchanged\./);
  assert.equal((app.match(/has-global-background/g) ?? []).length, 1, "main image box only");
  const block = css.slice(css.indexOf("/* Global PDP Background (2026-11-21"));
  assert.match(block, /\.pdp-showcase \.pdp-main-image\.has-global-background \{\n  background-color:var\(--pdp-bg-color,#FFFFFF\);\n  background-image:var\(--pdp-bg-desktop,none\);\n  background-size:cover;/);
  assert.match(block, /@media \(max-width:600px\) \{\n  \.pdp-showcase \.pdp-main-image\.has-global-background \{ background-image:var\(--pdp-bg-mobile,var\(--pdp-bg-desktop,none\)\); \}/);
  assert.doesNotMatch(block, /object-fit|\.pdp-thumbnails|\.product-image|\.product-card/);
  assert.match(css, /\.pdp-main-image img \{ object-fit:contain;/);
});

test("Admin: inside Media (no new page or sidebar item), Reset to Default, live preview, Owner publish with typed confirmation", () => {
  assert.match(adminApp, /<AdminLayout section="Media">[\s\S]*?<PdpBackgroundSetting \/>\s*<BulkProductImages \/>\s*<MediaLibrary \/>/);
  assert.doesNotMatch(adminApp, /\["(PDP Background|Gallery Background)"/);
  assert.match(setting, /Reset to Default/);
  assert.match(setting, /Live preview/);
  assert.match(setting, /const CONFIRM = "PUBLISH PDP BACKGROUND";/);
});

test("Admin (Owner decision 2026-11-21): Solid Colour only, default #DCEAF9; no Default / Background image modes or uploads", async () => {
  const { OWNER_PDP_BACKGROUND_COLOR } = await import("../src/lib/pdpGalleryBackground.ts");
  assert.equal(OWNER_PDP_BACKGROUND_COLOR, "#DCEAF9");
  assert.match(setting, /const OWNER_DEFAULT = solidColour\(OWNER_PDP_BACKGROUND_COLOR\);/);
  assert.match(setting, /mode: "color", color, desktop: null, mobile: null/);
  assert.match(setting, /type="color"/);
  assert.match(setting, /aria-label="Hex colour"/);
  assert.match(setting, /setValue\(OWNER_DEFAULT\)/, "Reset returns to #DCEAF9");
  for (const removed of [/Background image/, /Desktop background/, /Mobile background/, /type="file"/, /Replace/, />\s*Remove\s*</, /uploadBannerImage/, /putPreviewImage/, /role="radiogroup"/, /"default", "Default"/])
    assert.doesNotMatch(setting, removed, String(removed));
});

test("Admin access (PROD fix 2026-11-22): server answer decides; owner_required is not reported as a missing migration; preview wording is environment-neutral", () => {
  // Every server refusal keeps Publish disabled; each gets its own message.
  assert.match(setting, /const installed = access === "ok";/);
  assert.match(setting, /access === "owner_required"\n\s+\? `Only the Owner account can publish\./);
  assert.match(setting, /access === "not_installed"\n\s+\? "Publishing is not available yet: the database update \(migration 202611200001\) is not applied on this database\."/);
  assert.match(setting, /setAccess\(code === "not_installed" \|\| code === "owner_required" \? code : "failed"\)/);
  assert.match(setting, /disabled=\{Boolean\(blocker\) \|\| busy\}/);
  assert.match(setting, /\{access === "not_installed" && <strong>Preview mode: nothing is saved to the database\.<\/strong>\}/);
  // No "localhost" wording on the PDP background Admin or the PDP preview notice (works the same on DEV / PROD).
  assert.doesNotMatch(setting, /localhost/i);
  assert.match(setting, /Preview in this browser/);
  const notice = app.slice(app.indexOf("pdp-bg-preview-label"), app.indexOf("Exit Preview</a>", app.indexOf("pdp-bg-preview-label")));
  assert.match(notice, /<strong>Preview<\/strong>/);
  assert.doesNotMatch(notice, /localhost/i);
  // The Owner-only rule itself is unchanged (server-side, no client bypass).
  const dbLib = readFileSync(new URL("../src/lib/pdpGalleryBackgroundDb.ts", import.meta.url), "utf8");
  assert.match(dbLib, /if \(error\?\.code === "42501" \|\| \/owner_required\/\.test\(message\)\) return new PdpBackgroundError\("owner_required"/);
});

// ---------- migration behaviour (in-memory replay) ----------

const db = await createCatalogTestDatabase({ supabaseDefaultPrivileges: true });
const ownerId = await signInAsOwner(db);
const one = async (sql, params = []) => (await db.query(sql, params)).rows[0];
const asRole = async (role, fn) => {
  await db.query(`set role ${role}`);
  try { return await fn(); } finally { await db.query("reset role"); }
};
const actAs = (id) => db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [id]);
const save = (value) => asRole("authenticated", () => one(`select public.save_site_content_draft('pdp_gallery', $1::jsonb) as r`, [JSON.stringify(value)]));

test("nothing published: public read is NULL (built-in look)", async () => {
  await signOut(db);
  assert.equal((await asRole("anon", () => one(`select public.get_published_site_content('pdp_gallery') as c`))).c, null);
  await actAs(ownerId);
});

test("server validation: modes, hex colour, registered uploaded images only", async () => {
  await actAs(ownerId);
  const cases = [
    [{ mode: "fancy" }, /mode_invalid/],
    [{ mode: "color", color: "blue" }, /color_invalid/],
    [{ mode: "color" }, /color_required/],
    [{ mode: "image" }, /desktop_image_required/],
    [{ mode: "image", desktop: { src: "https://evil.example/a.jpg", publicId: "x" } }, /desktop_asset_not_registered/],
    [{ mode: "image", desktop: { src: "local-preview:img-1" } }, /desktop_invalid/],
    [{ mode: "default", extra: 1 }, /content_unknown_key/],
  ];
  for (const [value, pattern] of cases) await assert.rejects(save(value), pattern, JSON.stringify(value));
});

test("Owner publishes colour, then image; public read returns it; Admin and visitors cannot write", async () => {
  await actAs(ownerId);
  await save({ mode: "color", color: "#EAF2FB", desktop: null, mobile: null });
  await asRole("authenticated", () => one(`select public.publish_site_content('pdp_gallery') as r`));
  const color = await asRole("anon", () => one(`select public.get_published_site_content('pdp_gallery') as c`));
  assert.deepEqual(parsePdpGalleryBackground(color.c), { mode: "color", color: "#EAF2FB", desktop: null, mobile: null });

  const desk = uploaded("desk"), mob = uploaded("mob");
  for (const image of [desk, mob])
    await asRole("authenticated", () => one(`select public.register_site_asset($1, $2, 1600, 1000, 1000, 'png') as r`, [image.publicId, image.src]));
  await save({ mode: "image", color: null, desktop: desk, mobile: mob });
  await asRole("authenticated", () => one(`select public.publish_site_content('pdp_gallery') as r`));
  const image = await asRole("anon", () => one(`select public.get_published_site_content('pdp_gallery') as c`));
  assert.deepEqual(parsePdpGalleryBackground(image.c), { mode: "image", color: null, desktop: desk, mobile: mob });
  // Homepage banners are a separate scope: still nothing published there.
  assert.equal((await asRole("anon", () => one(`select public.get_published_site_content('homepage') as c`))).c, null);

  const { rows: [{ id: adminId }] } = await db.query(`insert into auth.users (email) values ('admin-bg@example.test') returning id`);
  await db.query(`update public.profiles set role = 'admin', is_active = true where id = $1`, [adminId]);
  await actAs(adminId);
  await assert.rejects(save(DEFAULT_PDP_BACKGROUND), /owner_required/);
  await assert.rejects(asRole("authenticated", () => one(`select public.publish_site_content('pdp_gallery') as r`)), /owner_required/);
  await signOut(db);
  await assert.rejects(asRole("anon", () => one(`select public.save_site_content_draft('pdp_gallery', '{}'::jsonb) as r`)), /permission denied/);
  await actAs(ownerId);
  // Reset to Default = publishing the default setting.
  await save(DEFAULT_PDP_BACKGROUND);
  await asRole("authenticated", () => one(`select public.publish_site_content('pdp_gallery') as r`));
  const reset = await asRole("anon", () => one(`select public.get_published_site_content('pdp_gallery') as c`));
  assert.deepEqual(parsePdpGalleryBackground(reset.c), DEFAULT_PDP_BACKGROUND);
});
