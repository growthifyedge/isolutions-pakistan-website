# iSolutions Pakistan — Project Handoff

**Purpose:** This file is the authoritative continuation reference for the next Claude Code / ChatGPT session on this project. Read this before touching any code.

**Last updated:** 2026-11-22 FINAL SESSION HANDOVER (pointer only: PROD Worker `bdfbd8a1`, DEV/PROD migrations 79, `#DCEAF9` published CLOSED, Same Model Specs / Category Search PASS, Auto-Fit APPROVED, Warranty + Smart Parser CLOSED, Banner Editor HOLD, Gmail QA SKIPPED/HOLD; git 73, HEAD `4a11c9f` — see the top section and `PROJECT_HANDOVER.md` §0 top row). Previous: 2026-11-21 DEV → PROD ROLLOUT (pointer only: approved scope LIVE on DEV + PROD, migrations DEV 79 / PROD 79, PROD Worker `57bf2522`, rollback `584d37bb`; Banner Editor HOLD not deployed; `#DCEAF9` not yet published; no commit — see the top section and `PROJECT_HANDOVER.md` §0, §4V). Previous: 2026-11-21 End-of-Day (pointer only: Same Model Specs iPhone + Android — final approval = ChatGPT-verified final sheet, one Apply click, no tick/typed phrase, Spec Upload tabs, PDP Auto-Fit + white-gap matching, Global PDP Background — Admin simplified to Solid Colour only, default `#DCEAF9` (Owner-selected), Owner final QA + DEV/PROD rollout pending, label removed; all localhost; git 71, HEAD `4a11c9f`; see the top section and `PROJECT_HANDOVER.md` §0, §4U). Previous: 2026-11-20 End-of-Session (pointer only: Banner Editor localhost complete, deployment HOLD; iPhone Model Shared Specs localhost complete, migration `202611200002` NOT applied — see the top section and `PROJECT_HANDOVER.md` §0, §4S, §4T) · 2026-11-19 Final Checkpoint (pointer only: iPhone Warranty Optional fix PROD LIVE, migrations 77/77, Worker `584d37bb` — see the top section and `PROJECT_HANDOVER.md` §0, §4R, §4R.1) · 2026-11-18 End-of-Day (pointer only: iPhone Warranty Optional fix LOCALHOST ONLY, migration `202611190001` NOT applied; Simple Website Editor planning completed — see the top section and `PROJECT_HANDOVER.md` §4R, §4S) · 2026-11-18 (pointer only: iPhone Stock Smart Parser fix PROD DEPLOYED, Worker `aaae9f19`, HEAD `4a11c9f` — see the top section and `PROJECT_HANDOVER.md` §4Q) · 2026-11-17 (pointer only: Admin New Order Gmail Alert PROD DEPLOYED, HEAD `4a11c9f` — see the top section and `PROJECT_HANDOVER.md`) · 2026-11-15 (pointer only: PROD Gmail Staff Email Notifications deployed — see the top section and `PROJECT_HANDOVER.md`) · 2026-10-16 later (live official-source Specs & Images workflow DEPRECATED; Specifications Bulk Upload BUILT locally, apply never run, uncommitted) · 2026-10-16 (Realme C75x Specs + Images reference implementation COMPLETE in DEV; reusable system NOT built) · 2026-10-15 (Android Stock Update complete + live at commit 69d8aaa; PROD run verified; Android Specifications & Images audit + proposed architecture, nothing built) · 2026-10-14 (Android Stock Update simplified: Android-only, hide/show planning, Update Website still DISABLED) · 2026-10-13 (Admin Stock List Update preview/plan tool BUILT, no write) · 2026-10-12 (safe PROD specification apply path BUILT, not executed) · 2026-10-11 (PROD bulk images COMPLETED 82/82, 267 images) · 2026-10-10 environment-aware uploader + PROD preflight IMPLEMENTED (no PROD write) · DEV bulk upload VERIFIED + PROD rollout plan (newest section first; older sections below are history — where they conflict with the top section, the top section wins)

---

## 2026-11-22 FINAL SESSION HANDOVER (newest pointer; authoritative) — wins over everything below

- **Authoritative detail:** `PROJECT_HANDOVER.md` §0 top row ("FINAL SESSION HANDOVER (2026-11-22)") and §14.
- **Git (VERIFIED):** `feature/checkout-orders-shipping`, HEAD `4a11c9f`, 25 unpushed, **73 uncommitted** (22 M / 51 ??), nothing staged. Migrations local 79 = **DEV 79 = PROD 79**, 0 pending. CLI linked to PROD — always `--remote=<ref>`.
- **Deployments (VERIFIED):** **PROD Worker `bdfbd8a1-7550-4366-809e-3b73fa6412d5`** (entry `index-CCYdk5ET.js`; rollback `57bf2522` → `584d37bb`); **DEV** entry `index-BseYczYw.js`. Built from `E:\iso-export-rollout-1121-src`; **Git ≠ PROD**.
- **Owner-confirmed PROD QA:** Global PDP Background `#DCEAF9` **PUBLISHED — CLOSED**; Same Model Specs (iPhone 18 Pro Max both products 29 specs, 29 approved, future sharing) **PASS**; Admin Category + Subcategory Search **PASS**; PDP Auto-Fit/Zoom **APPROVED**; iPhone Warranty + Smart Parser **CLOSED**. Read-only evidence matches (published `pdp_gallery` = `#DCEAF9`; PROD specs +29 only).
- **HOLD / SKIPPED:** Homepage Banner Editor **HOLD**; Gmail QA **SKIPPED/HOLD (not CLOSED)**. Removed from pending by Owner: Mobile Menu, `HK Approved`, PTA localhost issue.
- **Remaining (Owner instruction each):** focused commit(s) so Git matches PROD + push; Gmail QA when resumed; Banner Editor when released; optional DEV parity (`#DCEAF9` + approved specs not on DEV).
- **Risks:** Git ≠ PROD (never deploy a plain `git archive` of HEAD); CLI linked to PROD; export folders hold env files (keep); pre-existing `phase4` test failure.

## 2026-11-22 PROD Owner role + preview wording (previous pointer; VERIFIED)

- **Root cause:** PROD had no `owner` profile; the Owner's account was `admin`, so Owner-only RPCs (`is_site_owner`, `is_catalog_owner`) refused it → Publish disabled. Owner confirmed the account → one guarded update `9b251828-7abd-4d1b-a4a3-9bd51ef28a68` `admin` → **`owner`**; other profiles unchanged; no live rule checks exactly `admin`.
- **Code:** PDP background Admin reports `owner_required` correctly (not as "migration not applied"); "Preview in this browser"; PDP notice "Preview". Banner Editor HOLD untouched.
- **Live:** DEV entry `index-BseYczYw.js`; **PROD Worker `bdfbd8a1-7550-4366-809e-3b73fa6412d5`** (rollback `57bf2522`); byte-identical, routes 200, data unchanged. Detail: `PROJECT_HANDOVER.md` §0 top row.
- **Owner next:** Publish `#DCEAF9` (DEV then PROD). No commit/push.

## 2026-11-21 DEV → PROD ROLLOUT (previous pointer; Owner-authorized; VERIFIED)

- **Authoritative detail:** `PROJECT_HANDOVER.md` §0 (rollout row) and §4V.
- **LIVE on DEV + PROD:** Global PDP Background (Admin → Media, Solid Colour only, default `#DCEAF9` — **not yet published**, live PDPs keep the built-in look until the Owner publishes); PDP Image Auto-Fit + white-gap matching + responsive fixes + label removal; Same Model Specs (final verified sheet workflow; no approved specs yet); Spec Upload Single Product + Same Model tabs; Admin Catalog Category + Subcategory filter.
- **Database:** `202611200001` + `202611200002` applied with explicit refs (dry-run first) → **DEV 79 / PROD 79**; fingerprints (products, variants, specs, orders, stock) **identical before/after** on both; anon refused for publish/spec apply; nothing published.
- **Frontend:** DEV Firebase entry `index-Mkbq-BY5.js`; **PROD Worker `57bf2522-6acc-40d0-9de5-78cd40500a30`** (rollback `584d37bb-06b6-4105-8900-7e0e0c5bf26f`), entry `index-C6BpcY8H.js`, byte-identical live; routes 200, `www` 301, homepage 7 built-in slides, PDPs + 375 px checked; no console errors; no order placed.
- **HOLD isolated:** Homepage Banner Editor UI, homepage reader and Edge Function `cloudinary-upload-signature` NOT deployed; its shared tables are inert. PTA variant issue SKIPPED. Gmail / Smart Parser / CLOSED modules untouched.
- **Source:** clean export `E:\iso-export-rollout-1121-src` = PROD-live source (Worker `584d37bb`) + approved scope; export full suite 1282/1284 (1 pre-existing `phase4` failure, 1 skipped). **No commit/push**; git 73, HEAD `4a11c9f`; Git ≠ PROD.
- **Next (Owner):** signed-in Admin QA DEV → PROD; Publish `#DCEAF9` DEV → PROD; first final verified sheet; focused commit (separate approval).

## 2026-11-21 End-of-Day (previous pointer) — Same Model Specs, Spec Upload tabs, PDP Auto-Fit, Global PDP Background (localhost only)

- **Authoritative detail:** `PROJECT_HANDOVER.md` §0, §4U, §11, §14.
- **Git / environments (VERIFIED read-only):** Branch `feature/checkout-orders-shipping`, **HEAD `4a11c9f`** (unchanged), upstream `a61eb43`, **25 local commits not pushed** (push NOT approved), **nothing staged**, `git status --short` = **71** (the 66 of 2026-11-20 + 5 new: `scripts/pdpMediaSync.test.mjs` modified; `scripts/pdpGalleryBackground.test.mjs`, `src/admin/PdpBackgroundSetting.tsx`, `src/lib/pdpGalleryBackground.ts`, `src/lib/pdpGalleryBackgroundDb.ts` untracked). Local migrations **79** files; DB history not re-queried (last verified **DEV 77 / PROD 77**); **`202611200001` + `202611200002` NOT applied** (both edited today as files). PROD Worker unchanged **`584d37bb`** (rollback `aaae9f19`; not re-checked, no deployment); DEV frontend not redeployed. Supabase CLI still linked to PROD `nlxfwppywxumymbjkvwt`. **No commit, push, migration, deployment, database write or cleanup.**
- **PROD LIVE vs LOCALHOST:** PROD unchanged since the 2026-11-19 iPhone Warranty fix. **Localhost only:** Banner Editor (HOLD), Same Model Specifications, Spec Upload tabs, PDP Image Auto-Fit + white-gap colour matching, Global PDP Background, label removal.
- **Same Model Specifications — iPhone + Android (LOCALHOST COMPLETE):** same model = same common specs; PTA / `(Used)` / storage / trailing colour / brand / Galaxy-Moto series words ignored; Pro, Pro+, Plus, Max, Ultra, Lite, FE, 5G keep models apart. Owner approval (tick + typed phrase) saves the approved list (`model_common_specifications`) and adds missing specs to every product of the model (add-only); **future products** get approved specs automatically (deferred trigger); **unverified specs never copied**; **corrections** only when the Owner ticks them (only products still showing the old approved value follow). RPC `apply_model_common_specifications` (Owner only). Migration `202611200002` edited, NOT applied. The 29 iPhone 18 Pro Max specs still need verification before approval.
- **Spec Upload:** `/admin/spec-upload` now has **Single Product** (existing upload, unchanged) + **Same Model (iPhone + Android)** tabs; separate Model Specs sidebar item removed; old address opens the Same Model tab.
- **PDP Image Auto-Fit + white-gap colour matching (LOCALHOST):** image box follows the image's shape (portrait ~1.85–1.9× larger), never cropped/stretched; even non-white image edges colour the box (tiny cached 32 px sample). **Mobile PDP Owner QA PASS (OWNER-REPORTED).**
- **Global PDP Background (LOCALHOST COMPLETE; Owner QA PENDING):** Admin → Media section: Default / Solid colour / Background image (desktop landscape + mobile portrait), live preview, Preview on Localhost, Reset to Default, Owner-only Publish (typed `PUBLISH PDP BACKGROUND`). Scope `pdp_gallery` added to migration `202611200001` (not applied) → preview-only mode until DEV rollout. **"ISOLUTIONS SELECTED" label removed.**
- **Global PDP Background — OWNER DECISION (2026-11-21, OWNER-REPORTED; latest — wins over the bullet above):** **Solid Colour `#DCEAF9`** selected by the Owner (desktop screenshot visually preferred over `#EDF4FC`). The **Background Image** option stays available (not removed). **Transparent product images** preferred for a clean presentation. **Final Owner approval and DEV/PROD rollout PENDING** — nothing published (migration `202611200001` not applied). Later same-day localhost fixes (Claude-verified, uncommitted, files already in the 71): the background never shows through the product image (normal blending, no multiply); the image box keeps the image's shape at 67 / 100 / 125 % browser zoom; on phones the preview notice is one compact line and a desktop-only background image is cropped from its bottom edge; preview data is per browser + address (the LAN phone address needs its own Admin preview).
- **Global PDP Background — SIMPLIFIED to Solid Colour only (2026-11-21, Owner instruction; LOCALHOST, VERIFIED; latest — wins over both bullets above):** Admin → Media → Global PDP background now offers **only Solid Colour** (colour picker + hex), default **`#DCEAF9`**; **Live preview, Preview on Localhost, Reset to Default (= `#DCEAF9`) and Owner-only Publish kept**. **Removed from the Admin:** Default and Background image choices, Desktop/Mobile image Upload / Replace / Remove (and their unused Admin CSS). An older stored "default"/"image" value opens as a solid colour (its colour, else `#DCEAF9`). **Kept on purpose (not unused):** storefront + `src/lib/pdpGalleryBackground.ts` still read "default"/"image" values and migration `202611200001` is untouched, so an older value never breaks a page. Storefront unchanged: nothing published = built-in look (the Owner must Publish `#DCEAF9` after DEV rollout). Product images, Auto-Fit and gallery unchanged. QA: focused tests 57/57, `tsc -b` + ESLint PASS, Admin section checked in an offline harness, PDP desktop + 375 px with `#DCEAF9`. **Owner final QA PENDING; DEV/PROD rollout PENDING.**
- **Same Model Specifications — FINAL APPROVAL WORKFLOW (2026-11-21, Owner decision; LOCALHOST, VERIFIED; latest — wins over the Same Model bullet above):** the Owner gives the specification Excel/CSV to ChatGPT; ChatGPT verifies it against official sources and returns the **final verified sheet, which is already APPROVED**. Admin → Spec Upload → **Same Model**: choose the exact model → upload the final sheet (reading the file **never writes**) → preview → **one "Apply approved sheet" click** (+ a summary confirm). **Removed:** "I verified…" tick, typed `APPROVE …` phrase, per-correction ticks and the "copy from a product" source (product specs are unverified). **Applied:** existing exact-model products get missing specs (add-only, never overwritten); future exact-model products get the approved list automatically (existing deferred trigger). **Corrections:** a sheet value different from the saved approved value corrects it automatically; only products still showing the old approved value follow; any other stored value is kept (conflict). **Never applied:** rows whose optional **Status** column is not Verified/Approved, blank / `TBD` / `N/A` / `?` values, variant facts; unknown sections and duplicate labels block the sheet; ambiguous titles never match. Server RPC `apply_model_common_specifications` (Owner only, exact model re-checked) and migration `202611200002` **unchanged, NOT applied**. QA: model specs + Spec Upload + security **42/42** (new end-to-end sheet test incl. correction + future product), `tsc -b` + ESLint PASS, page checked in an offline harness (file select = no RPC call). **Owner QA PENDING; DEV/PROD rollout PENDING** (with `202611200002`).
- **Other:** Banner Editor **HOLD**; Mobile Menu **PENDING**.
- **QA (VERIFIED):** focused suites PASS (model specs 18, Spec Upload/security 40, PDP 33, PDP background + banners 48 incl. in-memory migration replay); `tsc -b` PASS; ESLint 0 errors; dev build PASS; **full suite 1366 / 1367** (only the pre-existing `phase4.test.mjs` Cartesian failure).
- **Localhost:** `http://127.0.0.1:5173/` (DEV data); LAN `http://192.168.1.101:5174/` (same Wi-Fi; stop when not needed).
- **Next session (2026-11-22), each step separately approved:** (1) Global PDP Background — Owner final QA of the Solid-Colour-only Admin + approval of `#DCEAF9`; (2) Same Model Specifications — Owner QA of the final-sheet workflow; the 29 iPhone 18 Pro Max specs go through ChatGPT verification as a final sheet; (3) DEV rollout of `202611200001` + `202611200002` + Edge Function + DEV frontend (explicit DEV ref) -> DEV QA -> PROD; (4) Banner Editor HOLD; (5) Mobile Menu scope; (6) older open items (warranty visual QA, focused commit to match Worker `584d37bb`, Smart Parser QA, `HK Approved`, Gmail inbox/retry); (7) push only on Owner instruction.

## 2026-11-20 End-of-Session (previous pointer) — Banner Editor + iPhone Model Shared Specs (localhost only)

- **Authoritative detail:** `PROJECT_HANDOVER.md` §0, §4S, §4T, §11, §14.
- **Git / environments:** Branch `feature/checkout-orders-shipping`, **HEAD `4a11c9f`** (unchanged), upstream `a61eb43`, **25 local commits not pushed** (push NOT approved), **nothing staged**, `git status --short` = **66** before and after this documentation update (the 4 handover docs were already modified) = the 50 entries of 2026-11-19 + **16 new**: modified `scripts/homepagePerformance.test.mjs`, `scripts/securityRls.test.mjs`, `src/StorefrontApp.tsx`, `src/styles.css`, `supabase/functions/cloudinary-upload-signature/index.ts`; untracked `scripts/homepageBanners.test.mjs`, `scripts/iphoneModelSpecs.test.mjs`, `src/admin/BannerManager.tsx`, `src/admin/IphoneModelSpecs.tsx`, `src/lib/bannerPreviewStore.ts`, `src/lib/homepageBanners.ts`, `src/lib/homepageBannersDb.ts`, `src/lib/iphoneModelSpecs.ts`, `src/lib/iphoneModelSpecsDb.ts`, `supabase/migrations/202611200001_site_content_homepage_banners.sql`, `supabase/migrations/202611200002_iphone_model_shared_specifications.sql`. Already-modified `src/admin/AdminApp.tsx` and `src/admin/admin.css` gained the two new Admin routes/nav items and their CSS. Local migration folder **79** files; database history **not re-queried** (last verified **DEV 77 / PROD 77**, last `202611190001`); **`202611200001` and `202611200002` are NOT applied anywhere**. PROD Worker unchanged **`584d37bb-06b6-4105-8900-7e0e0c5bf26f`** (rollback `aaae9f19-5ebc-4fac-aa62-27cf290b7679`); DEV frontend not redeployed. Supabase CLI still linked to PROD `nlxfwppywxumymbjkvwt`. Localhost Vite server `npm run dev` running at `http://127.0.0.1:5173/` (reads DEV). No commit, push, migration, upload, deployment, database write or cleanup in this session.
- **Homepage Banner & Slider Editor (Website Editor Phase 2 + the Phase 1 foundation it needs) — LOCALHOST DEVELOPMENT COMPLETE; DEPLOYMENT HOLD.** Admin route `/admin/homepage-banners` (nav "Homepage Banners"), Owner only (server-side). Existing 7 slides = built-in default and fallback (nothing published / read fails / unusable data). Desktop + mobile image upload/replace (signed Cloudinary `<root>/site/<uuid>`), add/remove, Up/Down order, enable/disable, optional heading / button text / internal link, live Desktop/Mobile preview (real homepage in a scaled frame), **Preview on Localhost** (real homepage `/?bannerPreview=1`, browser-local only, survives refresh, labelled "Localhost preview — not published", **Exit Preview**), Save Draft / Publish / Restore-to-draft. Carousel logic, timing, lazy loading and the 7 banners unchanged. Localhost QA fixes done: preview link + exit; editor/preview overlap (sticky preview under the sticky Admin top bar); preview UI (root cause: bare `<header>` tags picked up the storefront `header` rule — replaced by classed divs; no horizontal scrollbar/clipping; verified 1440/1280/390, Banner 7, both modes). Migration **`202611200001` file only** (tables `site_content_versions` + `site_assets`, RLS, Owner-only RPCs, published-only public read `get_published_site_content`, server validator). Edge Function `cloudinary-upload-signature` gained an Owner-only `siteAsset` target — **source only, not deployed**. Until the migration is applied the editor runs in **preview-only mode** (Save/Publish/Restore/upload disabled). Owner final localhost visual QA after the last fix — pending (OWNER-REPORTED items only when the Owner confirms). Details §4S.
- **iPhone Model-Based Shared Specifications — LOCALHOST DEVELOPMENT COMPLETE; migration `202611200002` NOT applied.** Rule: same iPhone model = same common specs, whatever PTA, New/Used, colour, storage or "Apple" in the title. Admin route `/admin/iphone-model-specs` (nav "iPhone Model Specs"): choose model -> give specs once (copy from a product of that model, or one Section/Label/Value CSV/XLSX) -> preview of every exact matching product (add / already present / conflicts kept) -> typed confirmation `APPLY <n> SPECS TO <m> PRODUCTS`. Reuses `product_specifications` storage and the Spec Upload planner; PDP unchanged. Add-only, never overwrites, never renames titles/URLs, variant facts never shared; Owner only and exact model re-checked on the server. Read-only PROD finding: `Apple iPhone 18 Pro Max` (PTA Approved) has **29** specs, `iPhone 18 Pro Max` (Non-PTA, slug `apple-iphone`) has **0**. **Pending:** (1) accuracy verification of those existing 29 specs against an official source before sharing them; (2) Owner decision on automatic sharing for future iPhones (today a newly added product of the model needs the model page re-run; only missing specs are added); (3) DEV apply of `202611200002` -> DEV QA -> PROD. Details §4T.
- **Mobile Menu improvement — PENDING** (Owner-listed; not started in this session; no design or code change made; scope to be defined by the Owner).
- **QA (VERIFIED):** focused tests PASS (homepage banners 24, homepage performance 8, security RLS 7, iPhone model specs 11); `tsc -b` PASS; ESLint 0 errors on changed files (4 pre-existing warnings in unchanged carousel/collection code); `build:dev` PASS; full suite **1350 / 1351** — the only failure is the pre-existing, unrelated `phase4.test.mjs` "variants remain explicit rows without Cartesian generation".
- **Pending (each separately approved):** (1) **Banner Editor (HOLD):** Owner final localhost QA -> DEV apply `202611200001` (explicit DEV ref; CLI is linked to PROD) + deploy Edge Function `cloudinary-upload-signature` to DEV + DEV frontend (`build:dev` + guard) -> DEV QA -> PROD; (2) **iPhone Model Specs:** verify the 29 existing iPhone 18 Pro Max specs; decide future automatic sharing; DEV apply `202611200002` -> DEV QA -> PROD; (3) **Mobile Menu improvement** — pending, scope from the Owner; (4) still open from 2026-11-19: PROD visual QA (PDP warranty row + signed-in Add Product); focused Git commit so Git matches PROD Worker `584d37bb`; DEV frontend redeploy; Smart Parser PROD Check Changes QA; `HK Approved` preservation; Admin Gmail inbox check + first real retry; (5) Git push of 25 local commits — Owner instruction only. The mandatory DEV step stays in force. CLOSED modules stay CLOSED.

## 2026-11-19 Final Checkpoint (previous pointer) — iPhone Warranty Optional fix PROD LIVE

- **Authoritative detail:** `PROJECT_HANDOVER.md` §0, §4R, §4R.1, §11, §14.
- **iPhone Warranty Optional fix — PROD LIVE (Owner-approved rollout, VERIFIED unless marked).** New + Used iPhone warranty optional: supplied/existing warranty kept exactly (no backfill, clear or overwrite); absent → NULL/blank, no default, no Needs Review; a missing warranty no longer blocks publishing; PDP hides the warranty row when none exists; Android and all other categories unchanged.
- **Migrations DEV 77 / PROD 77 / local 77** (last `202611190001`, applied with explicit `--remote` project refs after dry-runs listing only that file; validator md5 `f2f1e4ff…` on both; before/after data fingerprints identical on both).
- **PROD Worker** `isolutions-pakistan-test` **`584d37bb-06b6-4105-8900-7e0e0c5bf26f`** · **rollback `aaae9f19-5ebc-4fac-aa62-27cf290b7679`** (clean export `E:\iso-export-iphone-warranty-prod` = `4a11c9f` + live parser file + the 3 warranty files). **PROD deployment verification PASS** (live HTML, entry and Admin chunk byte-identical; key routes 200; `www` 301).
- **Pending visual QA:** PDP warranty row and signed-in Add Product screen. **DEV frontend not redeployed.** Behavioural validator call not run (read-only role lacks EXECUTE; not bypassed).
- **Git:** before the documentation update `git status --short` = **50**, HEAD **`4a11c9f`**, nothing staged, **no commit, no push**; after it = **50** (the 4 handover docs were already modified). Git does **not** match PROD Worker `584d37bb`. Supabase CLI still linked to PROD.
- **Agent iPhone data checklist:** `PROJECT_HANDOVER.md` §4R.1 — mandatory: model, storage, colour, price, New/Used, PTA (page choice or list words); optional: SIM (`Physical Dual` only); not read: warranty, RAM, grade, battery, cycles, quantity.
- **Next (each separately approved):** (1) visual QA on PROD; (2) focused Git commit (warranty files + `src/lib/iphoneStockUpdate.ts` + tests + migrations `202611060001` / `202611190001`); (3) DEV frontend redeploy; (4) Smart Parser PROD Check Changes QA; (5) optional supplier-warranty wording parsing (Owner sample needed); (6) `HK Approved` preservation — pending; (7) Admin Gmail inbox check + first retry — pending; (8) Website Editor — HOLD; (9) push of 25 local commits — Owner instruction only. Mandatory DEV step stays in force.

## 2026-11-18 End-of-Day (previous pointer; warranty item superseded 2026-11-19) — iPhone Warranty fix (localhost) + Website Editor plan

- **Authoritative detail:** `PROJECT_HANDOVER.md` §0, §4R, §4S, §11, §14.
- **Git (VERIFIED read-only 2026-11-19):** HEAD `4a11c9f`, 25 local commits not pushed, nothing staged, `git status --short` = **50**. Local migrations 77; DB last verified DEV 76 / PROD 76. Supabase CLI linked to PROD.
- **iPhone Warranty Optional fix — LOCALHOST ONLY, NOT PROD LIVE:** New + Used iPhone warranty optional (kept when supplied; NULL, no default, when absent; no PDP placeholder; existing data unchanged; Android/others unchanged). Files: `src/lib/manualProduct.ts`, `src/admin/AddProduct.tsx`, `src/admin/AdminCatalog.tsx`, new `scripts/publicationNewIphoneWarranty.test.mjs`, 4 updated tests, migration **`202611190001_publication_new_iphone_warranty_optional.sql` (file only, NOT applied)**. Focused 129/129 PASS, `tsc -b` + ESLint PASS, full suite **1315 / 1316 PASS** (VERIFIED re-run 2026-11-19; the only failure is the unrelated pre-existing `phase4.test.mjs` "variants remain explicit rows without Cartesian generation").
- **Simple Website Editor:** planning completed, implementation NOT started — HOLD; Owner-only; pending decisions Bundle Offers, external links, announcement pause.
- **DEV step stays mandatory** (Owner's direct-PROD preference is not authorization). Owner-reported: DNS fixed, iPhone zoom CLOSED, one iPhone title edited + republished. Pending: Smart Parser QA/commit/DEV deploy, `HK Approved` wording, Admin Gmail inbox + first retry.

## 2026-11-18 (previous pointer) — iPhone Stock Smart Parser fix PROD DEPLOYED

**Current state lives in `PROJECT_HANDOVER.md` (§0, §4Q, §11, §14), which wins on any conflict.**
- **Git:** Branch `feature/checkout-orders-shipping`, **HEAD `4a11c9f`** (unchanged), upstream `a61eb43`, **25 local commits not pushed** (push NOT approved), nothing staged, `git status --short` = **44** before this documentation update (the 42 entries of 2026-11-17 + `src/lib/iphoneStockUpdate.ts` + `scripts/iphoneStockUpdate.test.mjs`, both **uncommitted**); still **44** after it (the 4 handover docs were already modified). Migrations unchanged (DEV 76 / PROD 76).
- **Status:** **iPhone Stock Smart Parser fix — PROD DEPLOYED (2026-11-18, Owner-approved, VERIFIED).** The iPhone Stock Update parser now reads the supplier block format: colour line (above or below the model) + model without storage + one `storage @ price` line per storage; flexible spacing, case, storage and price notation. Original input `HK -Approved Burgundy` / `IPhone 18Pro Max` / `256Gb @578,500` / `512Gb @567,400` → Apple iPhone 18 Pro Max, Burgundy, 256 GB Rs 578,500 + 512 GB Rs 567,400. **`HK Approved` is kept as a note only — never mapped to PTA Approved / Non-PTA**; PTA still comes from the page choice or a PTA word. Missing colour/storage, two storages, clashing PTA or a bare `Approved` → Needs Review (never guessed). New/Used matching, stock rules and the plan are unchanged. **Localhost QA PASS; 65/65 focused tests PASS** (`iphoneStockUpdate` + `iphoneStockPhoneRpc`). **PROD:** clean export `E:\iso-export-iphone-parser-prod` = `4a11c9f` + only `src/lib/iphoneStockUpdate.ts` (`wrangler.jsonc` + `.env.production.local` copied from `E:\iso-export-admin-alert-prod`) → `npm ci` → `build:prod` → guard OK for PROD, blocked for DEV → `npx wrangler@4.150.0 deploy` → Cloudflare Worker `isolutions-pakistan-test` **version `aaae9f19-5ebc-4fac-aa62-27cf290b7679`** (rollback **`1babe760-cd9d-43eb-8c2f-e314ef4c6839`** = `4a11c9f`). Only the Admin chunk changed in content (`AdminApp-DD1fGwSS.js`, entry `index-Dvk9D_9p.js`). **PROD verification PASS (read-only):** live entry + Admin chunk + root HTML byte-identical to the build; `/`, `/shop`, `/admin/iphone-stock-update`, `/admin/orders`, `/staff`, `/checkout` → 200 on the root domain and `workers.dev`; `www` → 301 root. **Pending:** actual PROD Admin **Check Changes** QA (needs Owner sign-in; Check Changes only, never Update Website); **DEV parser deployment** (DEV still runs the old parser); **Git commit of the parser + test files** (Owner approval — Git does not yet match PROD Worker `aaae9f19`). **No database write, migration, stock update, commit or push.**
- **Next:** Owner signs in to PROD Admin → iPhone Stock Update → pastes the original HK Approved input → **Check Changes only** (QA); then, each separately approved: commit `src/lib/iphoneStockUpdate.ts` + `scripts/iphoneStockUpdate.test.mjs` (temporary index, nothing else), DEV parser deployment, push. The 2026-11-17 pending items (PROD Admin New Order Alert inbox check on the next genuine order) still stand.

## 2026-11-17 (previous pointer) — Admin New Order Gmail Alert + retry scheduler PROD DEPLOYED

This file's detailed history stops at 2026-10-16. **Current state lives in `PROJECT_HANDOVER.md` (§0, §4P, §11, §14), which wins on any conflict.**
- **Git:** Branch `feature/checkout-orders-shipping`, **HEAD `4a11c9f`**, upstream `a61eb43`, **25 local commits not pushed** (Git push NOT approved), **nothing staged**, `git status --short` = **42** (all preserved). **Commit A `46c9958`** = Vendor Gmail Notifications (12 files). **Commit B `4a11c9f`** = Admin New Order Alert + retry scheduler (10 files). Migrations **DEV 76 / PROD 76** (last `202611180001_admin_order_notification_retry_schedule.sql`). PROD Cloudflare Worker `isolutions-pakistan-test` version **`1babe760-cd9d-43eb-8c2f-e314ef4c6839`** (rollback **`a0a36ed7-74bc-4891-932b-771ab84e3d72`**). Supabase CLI still linked to PROD `nlxfwppywxumymbjkvwt`.
- **Status:** Order Management: **PROD LIVE, QA CLOSED**. Vendor Gmail Notifications: **PROD inbox delivery PASS (OWNER-CONFIRMED 2026-11-16)**. Admin New Order Gmail Alert: **PROD DEPLOYED**; DEV inbox delivery **PASS (OWNER-CONFIRMED; first landed in Spam, marked Not Spam)**; **PROD actual inbox delivery PENDING** (next genuine order). Automatic retry scheduler: **PROD LIVE**, runs every minute, idle verification PASS; an actual retry delivery is **not yet verified**. No PROD test order was created during this rollout. GTM/GA4 and all existing HOLD/CLOSED decisions are unchanged.
- **Emails:** sender `ordersisolution@gmail.com`; Admin alert → `isolutionpakistan89@gmail.com`; vendors → `ordersisolution@gmail.com` (iSolutions), `isolutionspiyave@gmail.com` (Piyavey). Off switches: delete `ADMIN_ORDER_EMAIL_PROVIDER` / `VENDOR_EMAIL_PROVIDER`.
- `E:\iso-export-admin-alert-prod` contains `.env.production.local` — never expose; no cleanup without Owner instruction.
- **Next:** PROD Admin inbox verification on the next genuine order. No push, test orders, migrations or deployments without Owner approval.

## 2026-11-15 (historical pointer) — PROD Gmail Staff Email Notifications DEPLOYED

This file's detailed history stops at 2026-10-16. **Current state lives in `PROJECT_HANDOVER.md` (§0, §4O.8, §11, §14), which wins on any conflict.** Summary of the latest verified checkpoint:
- **Git:** branch `feature/checkout-orders-shipping`, HEAD `066ea1a`, 23 local commits not pushed, nothing staged, `git status` 54. The email-notification files deployed to PROD are still **uncommitted**.
- **Migrations:** DEV 74 / PROD 74 (last `202611160001_vendor_order_notifications.sql`).
- **PROD hosting:** Cloudflare Workers Static Assets, Worker `isolutions-pakistan-test`, version **`a0a36ed7-74bc-4891-932b-771ab84e3d72`** (rollback `f3374f81-55f1-4e63-b313-dc3d19536435`). Firebase PROD hosting is historical (HTTP 509) — **never deploy to Firebase**.
- **Gmail Notifications:** Gmail API (sender `ordersisolution@gmail.com`), Edge Function `vendor-order-notifications` (ACTIVE, `verify_jwt=false`, server-side Admin check), Admin email status + Retry. **PROD DEPLOYED; DEV actual inbox delivery PASS (Owner-reported); PROD actual inbox delivery PENDING.** Every real PROD Confirm & Release now sends real vendor emails; kill switch = remove secret `VENDOR_EMAIL_PROVIDER`.
- **Pending decisions, NOT authorized:** first real PROD email verification; focused Git commit of the email files. Order Management QA stays CLOSED.

## 2026-10-16 later — Specs & Images live-source workflow DEPRECATED · Specifications Bulk Upload BUILT (local only)

> **No DB write (DEV or PROD), no spec apply run, no image upload, no publish, nothing committed / pushed / deployed.** Everything below is uncommitted on `feature/checkout-orders-shipping` (on top of the uncommitted C75x work in the next section). The only DB access this session was one read-only DEV query (`begin transaction read only … rollback`) of the 15 Confirmed phones' spec/media counts and colours.

### A. Current active flow — Specifications Bulk Upload (Admin → **Spec Upload**, `/admin/spec-upload`)

- **Code:** `src/lib/specificationBulkUpload.ts` (pure logic + runner), `src/admin/SpecificationBulkUpload.tsx` (page), CSS `.spec-upload*` in `admin.css`, nav entry + route in `src/admin/AdminApp.tsx`. Tests: `scripts/specificationBulkUpload.test.mjs`.
- **Template (XLSX + CSV downloads):** columns **Product Name · Product Slug or Product ID · Section · Label · Value**. Both templates are **headers only** (no data row). XLSX: `Specifications` sheet (headers + Section dropdown of `SPEC_SECTIONS`: Display, Performance, Software, Camera, Battery, Connectivity, Build, Audio, Security, Other) and `Instructions` sheet with a one-line example labelled "EXAMPLE — for reference only, NOT imported". The reader uses the `Specifications` sheet (fallback: first sheet that is not `Instructions`), so the example can never import.
- **Matching (no guessing):** exact Product ID or exact Slug → exactly one product, AND Product Name must equal that product's title (case/spacing ignored). Otherwise **Product Not Found** with the reason. No fuzzy / name-only / similar-model matching.
- **Preview categories (read-only):** **New Spec · Already Present · Conflict · Product Not Found · Invalid Row**, plus an **Exact Match products** count (interpretation of the Owner's "Exact Match"; Owner may want it changed). Invalid = empty fields, section not in the list (so RAM/Memory rows are rejected), label > 120 / value > 600 chars, control chars, same product + label twice in the file. A label stored under a different section = Conflict that can never be overwritten.
- **Apply:** default = add New Spec rows only. A Conflict is overwritten only if its row is ticked **and** "I confirm overwriting" is ticked; typed phrase `APPLY <n> SPECS`; build mode must match its Supabase project (`commercialWriteTarget`, DEV or PROD). Each product's specs are re-read and re-planned right before writing (changed since preview = blocked, nothing written). Writes only `product_specifications` (insert new rows / update one row's `value`) via `specificationApplyDbDeps`; never deletes. Read-back uses `verifySpecificationWrite` (values stored, no other spec row changed, product row + variants + prices + stock + media + publication identical).
- **Status:** never run against any database. Targeted tests 51/51 earlier + 3 template tests pass, `tsc -b` clean. Full suite / lint / builds NOT re-run after this work (last full run before it: 827/827, lint 0 errors, both builds OK).
- **Owner next step:** visually review `/admin/spec-upload` on localhost (`npm run dev`), then decide on a DEV trial upload, then commit.

### B. Deprecated — live official-source Specs & Images workflow

- `/admin/specs-images` removed from the nav; the route now shows only a "Deprecated" notice linking to Spec Upload (the batch preview, Owner Decisions and the C75x DEV buttons are no longer rendered anywhere).
- `scripts/fetch-official-sources.mjs` refuses to run unless `--deprecated-ok` is passed.
- **Nothing deleted** (kept for reference, now inactive): `officialSourceMapping.ts`, `officialSourceMappingDb.ts`, `officialSourceReaders.ts` (per-brand readers: realme ×2 layouts, Tecno, Honor, Oppo, Motorola, Shopify/VgoTel, Samsung JSON-LD), `officialSpecPreview.ts` (shared spec preview + typical/rated battery, charger "and below", chipset-tail rules), `officialImageCandidates.ts` (crop/empty-canvas analysis `computeSquareFraming` / `analyzeRender`, banner/duplicate/marketing rejection, colour mapping), `officialBatchPreview.ts`, `officialOwnerDecisions.ts` (+ browser draft key `isolutions.specs-images.owner-decisions.v1`), `robotsTxt.ts`, admin components `OfficialSpecsImages.tsx`, `OfficialBatchPreview.tsx`, `OfficialOwnerDecisions.tsx`, the C75x files, data `src/data/officialSourceSnapshots.json` + `realmeC75xOfficialSpecs.json`, and their tests (`officialBatchPreview`, `officialBatchRefinement`, `officialOwnerDecisions`, `realmeC75x*`, `officialSourceMapping`). The C75x modules now delegate to the shared ones; C75x behaviour verified unchanged by tests. Delete or fold these before any commit if the Owner prefers.
- **Last batch-preview result (for the record, DEV catalog):** 15 Confirmed phones → 2 Ready (Realme C75x, VgoTel New 17) / 13 Needs Attention; 138 specs ready, 14 suggested images. Blockers: not in DEV catalog (7), no usable product image (Tecno ×3, ZTE ×2, Honor X5c+, Oppo Reno 16f), page states several values (Motorola ×2 network, Oppo Wi-Fi/weight), no spec table (ZTE ×2, Samsung A37 buy page), region-sensitive UK values (Motorola ×2), image colour not proven (Motorola), file name vs colour (VgoTel New 16 Pro, Samsung A37), Samsung colour mapping. Honor X5c+ spec page shows the X5c image (similar model, excluded).

### C. Still true / reminders

- DEV has 8 of the 15 Confirmed phones (Honor X5c+, Oppo Reno 16f 5G, Realme C75x, Samsung A37, Tecno Go 3, Tecno Spark 50 Pro, VgoTel New 16 Pro, VgoTel New 17); PROD has all 17 drafts. DEV Realme C75x = published, 15 specs, 2 colour-linked images.
- No image-system work was done in this session after the deprecation; Bulk Product Images flow unchanged.
- The user's own `npm run dev` (Vite on 127.0.0.1:5173) was running during this session.

---

## 2026-10-16 — Realme C75x Specs + Images reference implementation COMPLETE (DEV only; reusable system NOT built)

> **DEV only. PROD untouched** (PROD C75x is still the 2026-10-15 draft: MB302/MB303, 0 specs, 0 media). Nothing committed, pushed or deployed. All code below is uncommitted on `feature/checkout-orders-shipping`. Read-back (read-only SQL, 2026-10-16) and the local storefront check passed.

### A. Final DEV state — Realme C75x (`abf1f282-4def-49ac-8691-b9c395a1c046`, slug `realme-c75x`)

- **Created and published in DEV.** Created as a draft through the existing `apply_catalog_bulk_import_v2` "Create" RPC (product + variants + specs in one atomic call; server-assigned SKUs), with values copied read-only from PROD C75x. Published 2026-10-15 19:50 UTC through the existing admin "Validate & publish" flow; `validate_product_for_publication` = valid.
- **2 variants:** MB313 **Pink** and MB314 **Blue**, both 8 GB / 128 GB, **Rs 61,000**, **stock 30**, PTA approved, brand new, 1 Year warranty, Karachi only, active. (DEV SKUs differ from PROD MB302/MB303, as expected.)
- **15 approved specs stored**, source **Realme Pakistan official page** `https://www.realme.com/pk/realme-c75x/specs` (snapshot sha256 `d52b8909…`): Refresh Rate up to 120Hz · Resolution HD+ (1604 x 720 pixels) · Screen Size 6.67 inches · **Chipset MediaTek Helio G81 Ultra** · Operating System Android 15 · UI realme UI 6.0 · Battery Capacity 5600 mAh · Wired Charging 45W · Bluetooth 5.0 · GPS Supported · Network 4G LTE · USB Port USB Type-C · **Wi-Fi 5** · Weight 196 g · Expandable Storage Supported. Chipset and Wi-Fi were Needs Attention by the extractor rules ("Ultra" tail; "802.11a/b/g/n/ac (Wi-Fi 5, Wi-Fi 4)") and approved by the Owner from the exact official wording. RAM / storage / colour / packing-list rows are never copied into specs.
- **Exactly 2 final media rows**, both cropped derivatives of the approved official mobile renders (`image01.realme.net`, colour named by the page's own colour list):
  - **Coral Pink = main** (`16e522b8…`, sort 2, 844 × 844 PNG), linked to **Pink** (MB313).
  - **Oceanic Blue = gallery** (`782a8ad3…`, sort 3, 846 × 846 PNG), linked to **Blue** (MB314).
  - The original 1080 × 2415 renders had excessive empty white canvas (phone ≈ 600 × 729 px) and rendered tiny on the storefront. The crop removed only that canvas: the phone's bounding box (luma < 240) is centred on a square white canvas with an 8% margin; **source pixels preserved 1:1** (verified pixel-identical), **no upscaling**, **lossless PNG**. Storefront delivery uses `c_limit`, so Cloudinary never upscales either.
  - The 2 uncropped rows were removed through the existing `cloudinary-delete-media` Edge Function only after the new rows were verified. **No duplicate / obsolete media remains.** Desktop banner images were never used.
- **Storefront colour ↔ image sync implemented and verified** on the real DEV data (local storefront, 2026-10-16): default selected colour and first image match on load (Pink + Coral Pink) · Pink → Coral Pink image · Blue → Oceanic Blue image · thumbnail click selects the matching colour · gallery arrows keep colour and image in sync · 2 thumbnails only. Storefront specs section and the product page were visually verified by the Owner.

**C75x is now the approved reference pattern** for the future reusable / batch Specs + Images system.

### B. Code (uncommitted)

- **Mapping + admin page:** `src/lib/officialSourceMapping.ts` (23 target phones, Owner decisions applied: 15 Confirmed / 7 Needs Attention / 1 No Official Source), `src/lib/officialSourceMappingDb.ts` (select-only), `src/admin/OfficialSpecsImages.tsx` at **`/admin/specs-images`** (sidebar "Specs & Images"), styles in `admin.css`.
- **C75x specs:** `src/lib/realmeC75xSpecPreview.ts` (realme reader; reuses `extractSpecifications`; Owner-approved Chipset / Wi-Fi apply only to the exact wording they were made on), `src/admin/RealmeC75xSpecPreview.tsx`, snapshot `src/data/realmeC75xOfficialSpecs.json` made by `scripts/fetch-realme-c75x-specs.mjs` (robots.txt checked, one request).
- **C75x images:** `src/lib/realmeC75xImagePreview.ts` (reads the page's Nuxt colour list; only `image01.realme.net`), `src/admin/RealmeC75xImagePreview.tsx`.
- **Temporary DEV-only C75x actions** (hidden unless the build mode is development AND the project is DEV; duplicate-safe; existing authenticated flows only): `src/lib/realmeC75xDevApply.ts` + `src/admin/RealmeC75xDevApply.tsx` ("Create & Apply C75x in DEV"), `src/lib/realmeC75xDevImageFix.ts` + `src/admin/RealmeC75xDevImageFix.tsx` ("Fix C75x images in DEV"). These are one-product scaffolding: fold them into the reusable system or delete them before any commit/deploy.
- **Storefront:** `src/lib/pdpMediaSync.ts` + PDP wiring in `src/StorefrontApp.tsx` (sync uses only the stored colour association `variantId` / `variantIds`; nothing is inferred from file names or alt text; an unassociated image is shared by every colour).
- **Tests:** `officialSourceMapping`, `realmeC75xSpecPreview`, `realmeC75xImagePreview`, `realmeC75xDevApply`, `realmeC75xDevImageFix`, `pdpMediaSync` (`.test.mjs`). Last run: `npm test` **791 / 791**, `tsc -b` clean, lint 0 errors (1 pre-existing warning), `build:dev` / `build:prod` OK (`dist/` = DEV build).

### C. Not built yet / next session

- **The proper reusable multi-product system is NOT built.** Everything above is C75x-specific.
- **Next session starts by converting the proven C75x pattern into a reusable system for the Confirmed Android phones** (source pinning → per-brand reader → shared label dictionary via `extractSpecifications` → Ready / Already Present / Conflict / Needs Attention preview → create-only spec apply → official image candidates → 1:1 square crop → add-only upload with colour links → read-back), DEV first.
- **Ambiguous phones stay Needs Attention** (see §D of the 2026-10-15 audit and `officialSourceMapping.ts`). **No guessing and no similar-model matching remain mandatory**; Owner approval per non-obvious value and per image set.
- **Writes need an authenticated admin.** The Supabase CLI link is DEV and is for read-only queries; running an admin RPC from the CLI by assuming the Owner's identity was blocked as a security bypass. Writes go through the admin app.

---

## 2026-10-15 — Project state + Android Specifications & Images audit (READ-ONLY; nothing built yet)

> This section supersedes the 2026-10-14 notes below wherever they conflict (e.g. "Update Website STILL DISABLED" is no longer true). The audit below wrote nothing: no DB write, no download/upload, no code change, no commit/push/deploy.

### A. Current project state (Android Stock Update — COMPLETE and LIVE)

- **Commit:** `69d8aaa001961481cdaa5bd0549d36ede47eaf82` "feat: finalize Android stock update write path" on `feature/checkout-orders-shipping`, pushed to origin. PROD hosting (`https://isolutions-pakistan-production.web.app`) runs this code (progress UI deployed last; live bundle byte-identical to the build). DEV hosting not redeployed.
- **Latest-list binding rules active:** the latest Android list is the final truth. Every listed Android item gets its list price, visibility ON and **stock = 30** (existing, returning, new variant, new phone); every absent visible Android item is hidden (`product_variants.is_active = false`, never deleted). "Reviewed" ticks are review marks only; **no Skip**; any Needs Attention row blocks Update Website. Not Android Phones (iPhone, tablets, feature phones, accessories) untouched.
- **Write path:** `src/lib/stockUpdateApply.ts` + `stockUpdateApplyDb.ts`. Gates: matching build/project pair, fresh Check List, typed `UPDATE <n> CHANGES`, re-read + re-plan before writing (nothing written if anything changed), read-back verification. Writes only variant `price_minor` / `is_active`, new variant rows (server SKU) + opening stock, stock correction rows (`inventory_movements`, reason `correction`, reference `android_stock_update`, delta = 30 − current at write time), and RPC `apply_catalog_bulk_import_v2` action **Create** only for new phones (draft). Images, specs, URLs, SKUs, PTA, condition, publication preserved.
- **Progress UI live:** completed/total counter, percentage, bar, current step, failure details, leave-page warning, double-run guard.
- **PROD update verified (read-only, 2026-10-15 00:17–00:21 PKT):** 183 price updates · 205 stock corrections to 30 · 22 new variants (opening stock 30) · 17 new draft phones / 40 variants (stock 30) · 57 variants hidden · 0 unhidden. All 267 visible variants at stock 30. No duplicate stock rows, product titles or variant configurations. Catalog moved 82 → 99 products, 262 → 324 variants.
- **Brands:** ZTE and VgoTel added (migration `202610150001_android_brands_zte_vgotel.sql`, guarded insert-only) on DEV (DEV's existing `Vgotel` row was renamed to `VgoTel`, slug unchanged) and on PROD (inserted, 14 → 16 brands, nothing else changed).
- **Known follow-ups:** the Owner should confirm the on-page result of the PROD run ("Website updated and checked" or the listed failures) and run one fresh read-only Check List (expect everything Same). The 17 new phones are drafts and need images + specs before publishing.

### B. PROD Android catalog status (read-only audit, 2026-10-15)

- **99 Android phones:** **82 published**, **17 new drafts** (created by the 2026-10-15 Stock Update run).
- **23 phones with no specifications:** all 17 drafts + 6 published: Honor X5c, Honor X5c+, Oppo Reno 16f 5G, Samsung A37, Tecno Go 3, Xiaomi Redmi 15.
- **Thin published specs (≤ 7 rows), 12 phones:** Honor T10 (5), itel A50c (5), Oppo A6c (6), Oppo Reno 15 5G (6), Realme 16 5G (1), Realme C100i (7), Samsung A57 (3), Samsung S24 Ultra (7), Samsung S26 (6), Vivo Y05 (5), Vivo Y11d (5), Vivo Y31d (5). PROD stores **943** specification rows in 10 sections (Display, Performance, Software, Camera, Battery, Connectivity, Build, Audio, Security, Other); about 33 distinct labels in use (most common: Battery Capacity, Refresh Rate, Screen Size, Main Camera, Wired Charging, Protection, Chipset, UI, Display Type, Front Camera).
- **Images:** **17 drafts have no images** (exactly the drafts). **267 existing images** on the 82 published phones (2–5 each; every published phone has a valid primary), all under Cloudinary `isolutions-production/products`, formats jpg 211 / png 53 / webp 3, widths 160–3000 px. 75 multi-colour phones, **0 colour-linked images** (`product_media_variant_assignments` unused).
- **The 17 new draft phones (0 specs, 0 images):** Infinix Note 60 · itel A100c SE · Motorola Edge 50 Ultra · Motorola Edge 70 · Motorola Razr 50 · Realme C75x · Realme Note 80 · Samsung S26 FE · Tecno Spark 40 Pro Plus · Tecno Spark 50 Pro · VgoTel New 16 Pro · VgoTel New 17 · VgoTel ONYX2 · Xiaomi Note 13 Pro · ZTE A35e · ZTE A36 · ZTE Focus Pro 5G.

### C. Existing spec + media mechanics (inspected)

- **Specs table** `product_specifications(product_id, specification_group, label, value, sort_order)`, `UNIQUE NULLS NOT DISTINCT (product_id, specification_group, label)`, non-blank label/value. Existing review/apply tool (`specificationReview.ts`, `specificationApply.ts`, `SpecificationMigration.tsx`) was built for the Shopify-sourced 82-title batch, PROD-only, and can create **and update**; the new flow must be create-only.
- **Media:** `product_media` (cloudinary ids, secure_url, width, height, bytes, format, is_primary, sort_order; one primary per product). Upload = Edge Function `cloudinary-upload-signature` (Admin-only, secret never in browser) → browser posts to Cloudinary; `uploadToCloudinary(source: Blob | string)` already accepts a **remote URL**, so Cloudinary can fetch an official image server-side (no local download). Bulk Product Images (`bulkImageUpload.ts`) has modes `new` / `add` / `add_make_primary`, environment target, PRODUCTION confirmation and read-back verification. Colour linking via RPC `set_product_media_color_assignment`.
- **Publish-without-image protection already exists:** `validate_product_for_publication` (enforced by trigger `products_enforce_publication`) requires a primary `product_media` row with Cloudinary id, secure_url, width, height and bytes. Drafts cannot be published without a valid primary image; no change needed.

### D. Official-source feasibility (read-only web check, ~60 requests, robots honoured, no CAPTCHA/login bypass, no third-party evidence)

| Brand | Specs | Images | Notes |
|---|---|---|---|
| Samsung | Automatic (PK per-SKU product page has the full spec table; `/specs/` pages are JS-filled) | Automatic, per colour (JSON-LD, Scene7 per SKU) | Product URL contains the SKU — must be confirmed once. No IP/fingerprint fields. S26 page is combined S26/S26+ (ambiguous). |
| Oppo | Automatic (PK, server-rendered table, model code CPH####) | Manual (combined two-colour image) | Region differences (e.g. Reno16 F battery/charging) → use PK page |
| Vivo | Automatic (PK, excellent table incl. IP, fingerprint) | Manual (hashed names) | |
| Tecno | Automatic (`/pak/` tech-specs pages) | Automatic, one image per colour | "Go 3" is probably "SPARK Go 3" (naming flag) |
| Realme | Automatic, brand reader (PK, server-rendered) | Manual | Slugs irregular (`realme-note80`) |
| Honor | Automatic, brand reader (values in `data-value`) | Manual (X5c Plus page shows X5c image) | X5c only on global site; T10 is "HONOR CHOICE T10" (naming flag) |
| Motorola | Automatic, brand reader (embedded JSON) — URLs need manual pinning | Automatic, colour mapping manual | No PK site; specs differ by region |
| Xiaomi | Needs Attention by default (fragile embedded JSON) | Manual | "Note 13 Pro" = "Redmi Note 13 Pro" (PK page is 4G); Redmi 15 PK page is 4G — 4G vs 5G must be confirmed |
| itel | Automatic, global data only | Manual (press room exists) | PK site does not resolve; **A100c SE: no official page** (only A100C) |
| VgoTel | Automatic via the store's own product data | Automatic, one image per colour | **Source unconfirmed / Needs Attention:** vgotel.com is a Shopify store mentioning "SSH Telecom" warranty — may be a distributor, Owner must confirm it counts as official |
| Infinix | Manual (pages empty without a browser) | Manual | |
| ZTE | Manual (site unreachable from this network) | Manual | **A36: no consumer product page**; Focus Pro 5G is "nubia Focus Pro 5G" |
| Nothing | Automatic, brand reader (domain only assessed) | Automatic, per colour | |

Rough outcome for the 23 no-spec phones: ~13 automatable (S26 FE, A37, Spark 40 Pro Plus, Spark 50 Pro, C75x, Note 80, X5c+, Reno 16f 5G, 3 Motorola with region flags, 3 VgoTel if the source is approved); ~6 manual decision (Note 13 Pro, Redmi 15, Go 3, X5c, Note 60, ZTE A35e); ~2 no official source (itel A100c SE, ZTE A36); ZTE Focus Pro 5G depends on reaching the ZTE site.

**Rights:** every manufacturer site shows "All rights reserved" and none grants reuse of images or spec text. **Manufacturer image/spec reuse rights are NOT assumed** — Owner decision or written brand/distributor permission required before automating reuse.

### E. Proposed combined Specifications + Images architecture (NOT built)

Hard rules: **no guessing, no AI-generated specs, no paid API, no inferred values, no "similar model" data, exact model match only**; no saved spec or image without source evidence; uncertain or conflicting = Needs Attention / blank; existing approved specs and existing images are never overwritten; products, variants, prices, stock, URLs, SKUs and publication data untouched; Stock Update flow not touched.

1. **Source pinning (Owner-confirmed, once per phone):** official model name, exact official URL, region (PK preferred), and model code where the page shows one (Samsung SM-…, Oppo CPH…). **Ambiguous model names require manual confirmation** (Redmi naming, 4G vs 5G, Spark Go 3, Honor Choice T10, combined S26/S26+ page). No fuzzy matching.
2. **Fetcher:** allow-listed manufacturer domains only, robots.txt honoured, ~1 request per 2 s, no login/challenge bypass; each fetch kept as a dated, hashed snapshot. Start as a local tool that produces a review file (no new server infrastructure).
3. **Per-brand extractors** → fixed label dictionary mapping official labels to our Section/Label; unknown labels dropped, never guessed; values normalised only in format (e.g. "5,000mAh" → "5000 mAh") with the verbatim source snippet kept. RAM/storage stay on variants, not specs.
4. **Spec categories:** Ready to Apply (exact page, clear value, label missing on the phone) · Already Present (same value stored) · Conflict (different approved value stored — shown, never overwritten) · Needs Attention (ambiguous name, combined page, several values, non-PK page for region-sensitive fields such as battery/charging/storage, unclear parse) · No Official Source.
5. **Review + apply:** a new admin "Official Specs & Images" page with evidence links and Owner approval. **Create-only spec apply** reusing the existing gated spec path (environment pair, approved-row fingerprint, typed confirmation, read-back proving products/variants/prices/stock/media/publication unchanged) — never update, never delete.
6. **Images:** candidates (official URL, size, colour) previewed directly from the official source; Owner picks the primary and gallery and links colours. Upload **"add" mode only** (existing images never touched) via the signed Cloudinary path fetching the official URL. Primary = front render of the first available colour; gallery = other colours' fronts, then back/side, each colour-linked. Minimum 800 px; Owner visual approval required (watermarks and lifestyle composites cannot be detected reliably); a combined multi-colour image is never the primary unless the Owner accepts it. No retailer, watermarked, AI-generated or guessed images.
7. **Evidence/source tracking proposal:** one small append-only evidence table (source URL, fetched at, content hash, snippet, approved by, approved at) per saved spec row or image — requires a migration and Owner approval; without it, evidence lives only in an exported file.
8. **Publishing:** no change needed — the database already blocks publishing without a valid primary image; drafts stay drafts until the Owner publishes.

**Suggested build order:** (1) Owner decisions: reuse rights, VgoTel as a source, official names/URLs for flagged phones → (2) evidence table migration → (3) fetcher + first extractors: Samsung, Oppo, Vivo, Tecno, Realme, Honor, VgoTel → (4) review page → (5) create-only spec apply → (6) image upload by official URL. Then Motorola, Xiaomi, itel; Infinix and ZTE stay manual.

---

## 2026-10-14 — Android Stock Update simplified: Android-only, latest list = website availability (uncommitted; Update Website STILL DISABLED)

> **No PROD write, no DEV write, no import, no product/media/specification change, no commit/push/deploy.** `Update Website` is disabled (`<button … disabled title=…>`). The page still only READS brands / products / variants / media counts / spec counts / stock.

- **Owner flow (one page, 4 steps):** 1 **Paste List** → **Check List** (reads the list, reads the current website data and compares — ONE click; the old Parse + Compare pair is gone) → 2 **Review Changes** (summary cards + tabs) → 3 **Update Website** (disabled). Page title "Android Stock Update", helper "Paste the latest Android stock list. We’ll check what changed before updating the website." Route unchanged: Admin → Stock Update (`/admin/stock-update`).
- **Android only.** Website side: `isAndroidCatalogProduct` (stockListDelta.ts) = category `mobile-phones` (slug or name), brand present and not Apple / Nokia / HMD, title not matching `iphone` — the same rule the Android warranty backfill used. iPhones, tablets, feature phones and accessories on the website are never matched and never hidden. List side: `rowCategory` now returns `iphone` for Apple-brand / iPhone rows; every non-`smartphone` row is listed under **Not Android Phones** (information only; never compared, never applied) together with gift-box lines. Those product types get their own flows later.
- **Latest list = truth for Android visibility (hide, never delete):** variant absent from the list → `hide_variant` (`product_variants.is_active = false`); whole phone absent → `hide_product` (= `is_active = false` on each currently visible variant; the `products` row, `publication_status`, `published_at`, slug/URL, media and specifications are untouched — `search_public_catalog` and the public RLS both require an active variant, so the phone disappears from listings and from its own page). Hidden item back in a later list → `show_variant` (`is_active = true`, same variant row, same SKU) — shown in **Back On Website** (card/tab only when > 0). Already hidden and still absent → no action ("Already hidden — stays hidden"). A phone with a **Needs Attention** row keeps everything visible ("held") until the Owner fixes that row. Draft (never published) phones: nothing is hidden or shown; a note says it still needs an image and publishing. `PLAN_OPERATIONS` = update_price · create_variant · create_product · show_variant · hide_variant · hide_product — **no delete / archive / unpublish operation exists.**
- **Why `is_active` and not `publication_status`:** it is the existing admin mechanism ("Hidden from the store" in the product editor), reversible without re-running publication validation, keeps `published_at` (storefront ordering) and never writes the `products` row. Archiving / drafting was rejected: the trigger nulls `published_at` and re-publishing re-runs the validator.
- **Simple wording lives in `src/lib/stockUpdateWording.ts`:** KIND_LABEL unchanged→**Same**, price_change→**Price Changed**, new_variant→**New Variants**, new_product→**New Phones**, ambiguous→**Needs Attention**, blocked→**Not Android Phones**; HIDE_LABEL **Will Be Hidden**; SHOW_AGAIN_LABEL **Back On Website**. `explainReason` turns parser reasons into sentences ("We couldn't understand this color", "Please confirm the RAM (the list shows extended RAM)", "5G looks like part of the phone name", "Please check this line — …"). Fix buttons: **Use this color** · **Change color** · **Use 3GB RAM** · **Add 5G to phone name** · **Skip** · **Undo**. Internal kind names (`ambiguous`, `blocked`, delta, plan …) stay in code only. Engine notes were rewritten in plain words ("Matched to “X” on the website", "Not the same as: …", "Currently hidden on the website — it will be shown again").
- **Safety guard:** Check List refuses a list with 0 readable rows (an empty list would otherwise plan to hide every Android phone).
- **Selection:** price changes, new variants, returning variants and hides of visible items are ticked by default; new phones only when complete. Hide ticks are overrides keyed `hide:<missing id>` in the same draft `selectionOverrides`. **Draft persistence unchanged** (`isolutions.stock-update.draft.v1`, autosave, fingerprint, gated untouched-tab rule): restored text, fixes and ticks come back ("Your list is back"), nothing is auto-parsed any more, and the Owner must click Check List again (`comparisonAuthorizesApply` is still the only gate). "Clear Draft" is now **Clear List** (same two-step confirm).
- **Preserved by every planned operation:** product ids / slugs / URLs, SKUs, images, specification rows, PTA / condition, publication state, stock. A price update writes `product_variants.price_minor` only; hide/show write `product_variants.is_active` only. `PRESERVED_GUARANTEES` says so on the page ("Nothing is ever deleted…").
- **Code:** `src/lib/stockListDelta.ts` (engine: Android filter, hide/show/held planning, plain notes), `src/lib/stockUpdateWording.ts` (new), `src/lib/stockListDeltaDb.ts` (+ `categorySlug` in the read-only snapshot), `src/admin/StockListUpdate.tsx` (rewritten 3-step page), `src/admin/admin.css` (`.stock-step*`, `.stock-muted`, `.stock-warning`), tests `scripts/stockListDelta.test.mjs` (rewritten), `scripts/stockUpdateWording.test.mjs` (new: label mapping, explanations, forbidden-word scan over wording + engine notes + the page's JSX text/attributes, old buttons gone), `scripts/stockListDraft.test.mjs` (wording assertions updated).
- **Results:** `npm test` 717/717 pass (was 702) · `tsc -b` clean · `npm run lint` 0 errors (1 pre-existing warning in StorefrontApp.tsx) · `npm run build:dev` OK · `npm run build:prod` OK (both show rolldown's pre-existing "direct eval" help note from a dependency). Stock tests: stockListDelta 31, stockUpdateWording 4, stockListDraft 31.
- **Visual check:** real component in a temporary Vite harness (`vite.harness.config.ts` + `harness/`, deleted afterwards) with Supabase and the catalog adapter stubbed, desktop 1280 px and 390 px: four-step page; cards/tabs; Needs Attention fixes re-classify rows live (Wood → Same, ZTE "5g black/brown" → both colours Price Changed, 3+5 → Same); Will Be Hidden lists whole phones and single variants with the "held" reason for a phone with an open attention row; Back On Website row for a hidden variant that returned; Not Android Phones lists iPhone / tablet / Nokia / gift box; refresh restores the list, 3 fixes and 1 untick and shows no results until Check List; Clear List two-step confirm resets the page; no page-level horizontal overflow at 390 px (tables scroll inside); the rendered page contains none of Delta / Ambiguous / Blocked / Apply Plan / Fingerprint / Source Resolution / Classification / Catalog Snapshot / Owner Decisions.
- **Known behaviour to tell the Owner:** on a line like `Focus Pro 8/256 5g black/brown`, the Brown row shows as a New Phone ("ZTE Focus Pro", note "Different from the existing: ZTE Focus Pro 5G") until **Add 5G to phone name** is clicked on the Black row; then both colours re-classify. Phones with an open attention row are never hidden.
- **Still separate / unauthorised:** the actual Update Website write (must be gated like the specification apply: matching PROD/DEV mode + project, a stamp from a live Check of exactly this text + fixes, typed confirmation; hide/show = `product_variants.update({ is_active })` only, price = `price_minor` only), iPhone / used iPhone / box-pack iPhone, feature phone, tablet and accessory stock flows.
- **Owner next step:** review on localhost (`npm run dev` → Admin → Stock Update); approve the commit; approve the write phase separately.

---

## 2026-10-13 (later) — Stock Update draft persistence + ambiguity-resolution model (uncommitted; Apply STILL DISABLED)

> **No PROD write, no DEV write, no import, no product/media/specification change, no commit/push/deploy.** `Apply Selected Changes` remains disabled. Refreshing `/admin/stock-update` no longer wipes the Owner's work.

- **Code:** `src/lib/stockListDraft.ts` (pure: storage, validation, row keys, resolutions, stale-comparison stamp), `src/admin/StockListUpdate.tsx` (autosave/restore/Clear Draft/resolver UI), CSS appended to `admin.css`, tests `scripts/stockListDraft.test.mjs` (22).
- **Storage:** `localStorage` key **`isolutions.stock-update.draft.v1`**, schema `version: 1`. Browser-local only (not synced between devices). Autosave is debounced 400 ms and also flushed on `pagehide`/unmount; it is gated so an *untouched* tab never writes or deletes (opening/closing a blank Stock Update tab cannot erase a draft saved elsewhere). Multi-tab = last writer wins.
- **Persisted:** raw list text (typed/pasted, or CSV/XLSX/TXT converted to text), file name, `wasParsed`, `lastComparedAt` (informational only), Owner **resolutions**, Owner **checkbox overrides**, `savedAt`, `sourceFingerprint` (FNV-1a of the text; mismatch on load = damaged → discarded). **Never persisted:** catalog snapshot, delta, apply plan, any "comparison current/authorised" flag, credentials, tokens, Supabase data.
- **Restore rules:** `loadDraft` never throws. Corrupt JSON, wrong/old/new `version`, bad fingerprint or bad shape → key removed, page opens empty with a notice. Individually malformed resolutions/overrides are dropped, valid ones kept. A valid draft shows **"Draft restored"** (saved time) and restores text, decisions and checkbox choices. If the draft had been parsed it is **re-parsed automatically** (read-only brand lookup); the Owner must still click **Compare With Catalog** — the comparison is never restored or auto-run.
- **Stale-comparison safety:** a `ComparisonStamp` (text fingerprint + decisions fingerprint + time) exists **only in React memory**, created by a live Compare in this page session. `comparisonAuthorizesApply(stamp, text, resolutions)` is the single gate a future Apply must use: false after any reload (no stamp), false after any later text or decision change (UI shows "click Compare again before any future Apply"). Re-classification after a resolution runs live against the in-memory catalog from the last Compare, but does not renew the stamp.
- **Clear Draft:** inline two-step confirm ("Yes, clear draft" / "Keep draft"); removes the stored key and resets text, parse, comparison, decisions and checkbox choices. Touches no database data. `clearDraftAfterVerifiedApply(storage, {written, readBackVerified})` is ready for the future Apply phase and clears only when **both** are true.
- **Checkbox model:** selection = default selection (engine) + Owner **overrides** keyed by a content-based **row key** (`hash(sourceLine):colour:occurrence`, no line numbers/delta ids), so choices survive re-parse and line shifts.
- **Ambiguity-resolution model** (`Resolution`, keyed by row key, persisted with `label`/`sourceLine`/`decidedAt`): `accept_color_as_entered` (Wood), `replace_color {color}` (i.blue → Owner value, normalised), `set_physical_ram {ramGb}` (3+5→3, 4+4→4, 4+8→4; first term; ≤64), `move_token_to_model {token}` (`5g Black/Brown` → model `Focus Pro 5G`, colours Black / Brown; applies to every colour of that source line, rebuilds title/slug), `skip_row` (row removed, listed as "Skipped by Owner" under Blocked exclusions). `applyResolutions(parsed, resolutions)` is pure; a decision whose condition no longer holds (list edited) is **not forced** and is reported as "not applied". Resolver UI is live in the **Ambiguous** tab (Resolve column) with an **Owner decisions** panel (Undo restores the row). Resolved rows leave Ambiguous and are re-classified into Price change / New variant / New product / Blocked / still Ambiguous.
- **Visual check:** the real component was exercised in a temporary harness with Supabase stubbed (admin login not used; harness deleted). Desktop + 390 px: restored banner, Clear Draft, resolver and decisions panel usable, no page-level horizontal overflow (tables scroll inside their container). Refresh simulation: paste → Parse → Compare → resolutions + a checkbox → refresh → text, 4 decisions and the checkbox restored, **no cards/tabs until Compare is clicked again**, Apply disabled throughout. Not yet checked against the real DEV/PROD backend by the Owner.
- **Owner next step:** deploy only on explicit approval; then on PROD paste the list, Parse, Compare, resolve the 9 Ambiguous rows, refresh to confirm they persist.

---

## 2026-10-13 — Permanent Admin "Stock List Update" workflow built (preview + apply PLAN only; Apply NOT implemented, uncommitted)

> **No database write has occurred — not in PROD, not in DEV.** The tool is read-only: it reads brands/products/variants/media/spec counts/stock and computes a delta. No import, no commit, no push, no deploy. The "Apply Selected Changes" button is intentionally **disabled** until a separately approved Apply phase.

- **Shopify is no longer the recurring stock source.** The recurring workflow is: Stock List -> Parse -> Validate -> Compare -> Delta Preview -> Owner Approval -> Apply Selected Changes. Shopify exports stay reference-only (legacy images/descriptions).
- **Where:** Admin -> **Stock Update** (`/admin/stock-update`). Code: `src/lib/stockListDelta.ts` (pure parser wrapper, delta engine, selection model, apply-plan generator), `src/lib/stockListDeltaDb.ts` (read-only selects), `src/admin/StockListUpdate.tsx` (UI), tests `scripts/stockListDelta.test.mjs`.
- **Parser rules (one parser, not two):** reuses the existing `normalizeStockLines` (catalogSheet.ts): brand heading lines, `model RAM/Storage colour/colour @ price`, one variant per colour, per-colour prices kept, RAM/storage 4/64 .. 16/1Tb (1TB -> "1 TB"), canonical model casing (`A7pro` -> `A7 Pro`, `S26FE` -> `S26 FE`), duplicates and conflicting duplicates flagged, unrecognised colours / missing price flagged, nothing invented. CSV/XLSX are converted to the same raw text (`tableToStockText`; header columns Brand/Model/RAM/Storage/Color/Price used when present, otherwise each row is one line).
- **Category exceptions (never part of the smartphone delta, never applied):** Tablet (e.g. Xiaomi Pad), Accessory / gift box (listed as excluded lines), Feature phone (Nokia / HMD brands or no RAM/storage), other product types (watch/laptop), unknown category. All reported under **Blocked** and need an Owner category decision.
- **Identity rules:** product = brand + model compared case/space/punctuation-insensitively with `+` = `plus` (`X5c plus` == `X5c+`), accepted only when exactly one existing product matches; different models are never merged (Edge 70 vs Edge 70 Fusion; the near-name is shown as a note). Variant = RAM + Storage + Colour (+ PTA/Condition/Grade/Battery/Cycles only when the list states them; blank list facts match anything, the importer's rule). More than one match -> Ambiguous.
- **Delta classes:** Unchanged · Price change (current/new/difference) · New variant (existing product, new RAM/storage/colour) · New product (grouped; shows what is still required: SKU assigned on import MB###, image, PTA/condition defaults, stock default 10, optional specs, publication validation) · Ambiguous (held, not selectable; shows what it would otherwise be) · Blocked. **Missing from list** = existing products/variants absent from the list: review only, never selectable, never hidden/deleted/unpublished. A new price at/above an existing compare-at price is held (DB rule `compare_at > price`).
- **Selection defaults:** safe price changes and safe new variants selected; new products selected only when RAM/storage/colour/price are complete; missing/ambiguous/blocked/unchanged are never selectable.
- **Preservation guarantees (in the plan):** product IDs/slugs/URLs, SKUs of existing variants, images/media, specification rows, PTA/condition, publication state and existing stock of every matched product are untouched. A price update writes `product_variants.price_minor` only.
- **What Apply will eventually write (not built):** price_change -> `product_variants.price_minor` only; new_variant -> one `product_variants` row (server-assigned SKU, inherits product PTA/condition/warranty/delivery) + opening stock movement; new_product -> draft `products` row + variants + opening stock (images/validation/publish remain separate steps). Missing items: no action. It must be gated like the specification Apply (matching PROD/DEV mode + project, fingerprint of the previewed selection, typed confirmation).
- **Owner next step:** open Admin -> Stock Update, paste the current Android/mobile list, Parse, Compare, review the tabs. The real current list was NOT available to the build, so no real comparison was run.

---

## 2026-10-12 (newest) — Safe PROD specification apply path built (preview + gated apply; NOT executed, uncommitted)

> **No specification DB write has occurred — not in PROD, not in DEV.** No insert/update, no product/variant/media/commercial/publication change, no deploy, no commit, no push. PROD was only read (one `begin transaction read only … rollback` SQL snapshot). The Owner has not yet clicked Apply.

- **Reused storage (no second system):** `public.product_specifications (product_id, specification_group, label, value, sort_order)`, `unique nulls not distinct (product_id, specification_group, label)`, RLS = catalog admins insert/update/delete. Mapping = the importer's: Product Key = product slug, **Section → specification_group**, Specification Name → label. The Android Bulk Import RPC is NOT reused (it replaces whole products); the apply uses the same table with direct admin-RLS writes, like the other bulk tools (commercial defaults, publish).
- **New code:** `src/lib/specificationApply.ts` (pure: `selectApprovedRows`, `planSpecificationApply`/`planProduct`, `approvedFingerprint`, `specApplyBlocker`, confirmation phrase, `verifySpecificationWrite`, `runSpecificationApply`), `src/lib/specificationApplyDb.ts` (adapters: reads + `insert` rows + `update({ value })` on product_specifications ONLY), UI in `src/admin/SpecificationMigration.tsx`, tests `scripts/specificationApply.test.mjs` (13). Two old source-scan assertions that required the Apply button to be permanently `disabled` were changed to require the new gate (`disabled={Boolean(applyBlocker)}`).
- **UI:** `Preview approved specification apply (N)` (read-only) → cards Approved specs ready / Products affected / Create / Update / Unchanged / Blocked (+ excluded counts, duplicates, mapping failures, invalid rows, first blocked reasons). `Apply approved specifications` is enabled only when: preview done · Blocked = 0 · build mode and Supabase project are the matching **PRODUCTION** pair · the approved-row fingerprint equals the one previewed (any approve/reject/edit/resolve/skip after the preview makes it stale) · at least one Create/Update. Click → PRODUCTION dialog → type `APPLY <creates+updates> SPECS` → write.
- **What is eligible:** only rows with review status **Approved**, from the source currently chosen for the product (`usable`). Review, Conflict, Rejected, Proposed and skipped/unresolved-source rows are never considered. Each row needs: exactly one catalog product with that slug (judged against the WHOLE catalog) whose id equals the row's, product in the 82-title Android batch, Section ∈ the 10 approved sections, non-empty name (≤120) / value (≤600), no control characters, no duplicate Product+Section+Name (any duplicate → Blocked).
- **Write design:** per product, in order: re-read the product's specs and re-plan (changed since preview → that product is Blocked, nothing written) → snapshot product row + variants/media/stock → ONE `insert` for all its Create rows (atomic: a failure creates none of them) → one `update({value})` per Update row (individual failures reported per row) → read back everything. **Verified only if:** every written row reads back with the exact group/label/value, no row was deleted or added unexpectedly, unrelated specification rows are identical, the product row is identical (including `updated_at`), and variants/prices/SKUs/PTA/condition/stock/media are identical. New rows get `sort_order` after the product's existing rows (section order, then name). Nothing is ever deleted or upserted; a stored row that differs from an approved row only by letter case is Blocked, not overwritten. A failure on one product never stops the others; the result lists failed/blocked products and failed rows individually.
- **EXACT PROD preview (read-only, rebuilt from the real export: 4 conflict sources resolved, honor-x5c skipped, 917 High + 26 safe Review approved, Tecno Camon 50 Ultra Protection = `IP68, IP69, IP69K`):** approved rows detected **943** · products receiving specs **76** · **Create 943 · Update 0 · Unchanged 0 · Blocked 0** · duplicates 0 · product-mapping failures 0 · invalid/empty rows 0 · PROD currently stores 0 specification rows (all products). Excluded: **21 Review, 10 Conflict**, 0 Rejected/Proposed; the skipped Honor X5c source contributes **0** rows (and 0 approved rows come from any honor-x5c handle). Rows by section: Display 246, Camera 158, Battery 149, Connectivity 101, Software 82, Build 75, Performance 53, Security 49, Audio 22, Other 8 (1–23 rows per product). Fingerprint `943:d7750acf1eb6d4f2`. Products with NO approved spec (6): Honor X5c, Honor X5c+, Oppo Reno 16f 5G, Samsung A37, Tecno Go 3, Xiaomi Redmi 15 — they stay without specifications.
- **Android completion status:** 82 products / 262 variants imported, all 82 published, 267 images verified, PTA Approved + Brand New applied. Specifications: 943 approved rows ready; **0 stored**. Still open: 21 Review + 10 Conflict rows, the skipped Honor X5c/X5c+ source, the 6 products above, Oppo Reno 16f 5G and Tecno Go 3 (no Shopify source).
- **Caveat the Owner must respect:** the review state lives only in the browser tab. Apply must be run from the SAME tab/session that holds the 943 approved rows (reloading the Shopify export and re-approving reproduces the same fingerprint only if the same decisions are made). Previewing again right before Apply is required anyway.
- **Exact next Owner step (after Owner approval to commit + deploy):** open the tool on PROD → load the export → resolve/skip sources as before → Approve all high-confidence → Approve safe review specs → `Preview approved specification apply` (expect Approved 943 · Products 76 · Create 943 · Update 0 · Unchanged 0 · Blocked 0) → `Apply approved specifications` → type `APPLY 943 SPECS`.

---

## 2026-10-11 (newest) — "Approve safe review specs" (deterministic Review classifier) added (uncommitted)

> Review state only. **No DB write (DEV/PROD), no specification insert, Apply still disabled, no media/product change, no deploy, no commit, no push.** The 917 approved High rows and the 10 Conflict rows are never touched. Extraction rules unchanged.

- **Why these rows are Review, not High:** the extractor marks a row Review when the sentence has hedged/variant wording ("around", "version", "variant"…), several values in one sentence, a chipset name ending in Pro/Plus/Max/Ultra, a camera chain, or the value only comes from a generic metafield. Many are perfectly factual (e.g. "IP68 & IP69"), a few are not (Samsung A37/A57 pre-launch articles).
- **New:** `src/lib/specificationReviewSafety.ts` (`classifyReviewProposal`, `approveSafeReviewSpecs`, `otherProductNamed`) and, in the tool, `Approve safe review specs (N)` (N = what the classifier calls safe), a result panel (Safe Review specs approved · Review specs still unresolved · Conflict specs untouched · rows skipped, with counts per reason) and a per-row badge on every Review row: "Safe to approve" or "Manual: <reason>" (hover for detail).
- **A Review row is auto-approved only if ALL hold:** status Proposed, confidence Review, not a Conflict, source resolved (skipped/unresolved sources have no rows), value comes from a Body-HTML sentence (not a generic metafield), the evidence names no other product (a different known brand directly followed by a phone model word, e.g. "CMF Phone 2 Pro"), no speculative/forward-looking wording in the evidence (expect/expected, likely, anticipated, rumour, reportedly, probably, might, may, could, upcoming, leaked, "will launch/feature…"), no alternatives (value with " / " or an "or" between the values in the evidence), no 4G/5G version/variant mix-up, no hedge ("around", "approximately", "typically", "depending on…") attached to the proposed number, the source description does not itself name another product (contamination) and is not forward-looking throughout (≥ 3 speculative sentences), and no Section + Name already approved for the product.
- **Reason categories:** Speculative evidence · Multiple possible values · Different product named in evidence · Variant ambiguity · Source contamination · Manual review required (metafield-only / non-Review).
- **Real export (Owner's state: 82 targeted, 79 sources, 917 High approved, 47 Review, 10 Conflict; Honor `honor-x5c` left unresolved; conflicts resolved with `nothing-phone-3a-pro`, `tecno-spark-51`, `realme-15-pro-5g`, `samsung-s23-ultra`):** 47 Review rows → **26 safe, 21 manual** — exactly the Owner's classification (0 mismatches). Safe: Honor X6c Chipset; Infinix GT 50 Pro Wired 45W + Wireless 30W; Motorola Edge 70 Fusion Protection; Nothing Phone 1 Network; Nothing Phone 2A Chipset; Nothing Phone 3A Lite Wired 33W + Network + Chipset; Nothing Phone 3A Pro Network; Oppo A6 Protection; Oppo A6s Protection + Network; Oppo A6s Pro Chipset; Oppo Reno 15 Pro 5G Protection + SIM; Realme 15 Pro 5G Display Type + Screen Size; Samsung A07 Expandable Storage; Samsung Fold 8 Ultra Rear Camera Setup; Tecno Camon 50 Ultra Protection; Vivo V70 FE / X300 FE / Y500 Protection; Xiaomi 17T Chipset; Xiaomi Note 15 Expandable Storage. Manual (21): Samsung A57 ×9 (8 Speculative evidence, Wired Charging "25W / 45W" = Multiple possible values); Samsung A37 ×8 (Speculative evidence); Samsung A07 Battery Capacity + Network (Variant ambiguity); Nothing Phone 2 Pro Chipset (Different product named — "CMF Phone 2 Pro") and Network (Source contamination). After the click: Approved 943, Review remaining 21, Conflict remaining 10, export would hold 943 rows.
- **Note for the Owner (not changed):** the Tecno Camon 50 Ultra Protection row is proposed as "IP68, IP69" but its evidence reads "IP68, IP69, & IP69K" — the extractor does not capture the "K". It is on the Owner's safe list so it is approved; edit that value (Owner Edit) if "IP69K" is wanted.
- **What remains manual:** the 21 rows above, the 10 Conflict rows, the unresolved Honor X5c/X5c+ source, Redmi 15 and Honor X5c (no stated specs), Oppo Reno 16f 5G and Tecno Go 3 (no Shopify source).
- **Checks:** `npm test` **619 / 619** · `tsc -b` clean · lint 0 errors (1 pre-existing warning) · `build:dev` and `build:prod` OK (`dist/` = DEV). New tests: `scripts/specificationReviewSafety.test.mjs` (11 tests incl. the real-export classification).
- **Exact next Owner click (after commit + deploy):** Needs Review → `Approve safe review specs (26)`, then handle the remaining 21 Review and 10 Conflict rows (or leave them unapproved), then export.

---

## 2026-10-11 (newest) — "Leave unresolved" source action + clearer bulk approval in the Specification Migration tool (uncommitted)

> Local review state only. **No DB write (DEV/PROD), no specification insert, no media change, no publish, no deploy, no commit, no push.** Extraction rules are unchanged.

- **Situation:** 82 targeted, 79 safely matched sources, 3 need review, 1 Multiple source left (`honor-x5c`, a combined Honor X5c 4/64 + Honor X5c+ 4/128 listing — it must not be force-matched to either product).
- **Root cause:** none found in the logic. Bulk approval (`approveAllHighConfidence`) never depended on other sources: on the real export with the same state (79 sources, Honor Multiple unresolved) the button was enabled and approved every High row, both in code and in a browser run of the real export. The button is only disabled when no High row is still waiting (e.g. all already approved), which looked like a dead button, and nothing on screen said what an unresolved source does.
- **Added:** `Leave unresolved` on Review/Conflict list entries and `Leave unresolved (skip source)` on Multiple entries (existing `skipSet`): the source is mapped to no product, excluded from extraction, can contribute no approvable/exportable row; a "Skipped sources" panel lists them with `Restore to the decision list`. The unresolved panel now says "N source(s) unresolved — it will be skipped. Safe specifications for resolved products can still be approved."
- **Bulk approval:** `Approve all high-confidence specs (N waiting)` is enabled whenever proposals exist, is independent of any source decision, approves only High / non-Conflict / non-Review / non-rejected rows with a unique Section + Name from Matched or Owner-Confirmed sources, and now reports what happened ("Approved N … X Review and Y Conflict rows stay manual … Z unresolved/skipped source(s) contribute no rows").
- **Summary cards:** Skipped / unresolved sources · Approved specs · Review specs remaining · Conflict specs remaining · Products with no approved specs (plus the existing ones). `reviewSummary` gained `reviewRemaining`, `conflictRemaining`, `skippedSources`, `productsWithNoApproved`, `highAwaitingApproval`.
- **Real export check (Honor X5c skipped, conflicts resolved with the first source of each):** 79 safe sources → 901 High approved, 46 Review and 10 Conflict remain, 76 products with approved specs, 6 without (Honor X5c, Honor X5c+, Xiaomi Redmi 15, Honor X5c and the products with no usable source); zero rows for `honor-x5c`. With the Owner's live conflict choices the High total is 917.
- **Checks:** `npm test` **608 / 608** · `tsc -b` clean · lint 0 errors (1 pre-existing warning) · `build:dev` and `build:prod` OK (`dist/` = DEV). New file `scripts/specificationSkipSource.test.mjs` (6 tests incl. a real-export test).
- **Exact next Owner click:** (after this is committed and deployed) in the migration tool click `Leave unresolved (skip source)` on `honor-x5c`, then `Approve all high-confidence specs`; the Honor X5c / X5c+ specifications must be added by hand later.

---

## 2026-10-11 (newest) — Source-conflict comparator added to the Legacy Shopify Specification Migration tool (uncommitted)

> Local review state only. **No DB write (DEV/PROD), no specification insert, no media change, no publish, no deploy, no commit, no push.** Extraction rules are unchanged.

- **What:** `src/lib/specificationSourceConflicts.ts` (pure) + a "Source conflicts — N products" section in `SpecificationMigration.tsx` replacing the flat Conflict rows (Review and Multiple rows stay in the flat list). Conflict Handles are grouped per catalog product (N competing sources). Each source card shows Shopify title, Handle, Shopify status, image count, description length, a short preview, extracted spec counts (High / Review / Conflict) and key fields (chipset, display size, battery, charging, OS/UI, camera summary). Buttons: `Use this source` per source and `Use recommended source` per product (enabled only when the recommendation is safe). Choosing uses the existing `chooseSourceSet`: the chosen source becomes **Confirmed**, competitors **Not Used**, specs are extracted from it, "Need source review" drops, and the product is listed as "✓ Resolved". Nothing is auto-selected.
- **Recommendation rules (deterministic, no outside knowledge):** rank by (1) exact normalised Shopify title match to the target, (2) exact model-token match (brand ignored), (3) more directly supported extractable specs, (4) fewer internal spec conflicts, (5) fuller Body HTML, (6) more images. It is **safe** only when decided by a unique exact-title / model-token match, or when specs clearly win on a title tie (margin ≥ 5 and ≥ 30%, no more internal conflicts) AND the sources do not contradict each other on chipset, display size, battery or charging (different key facts can mean different devices). Otherwise the card says "No safe recommendation" with the best-ranked source and why, and the Use-recommended button is disabled.
- **Real comparison (current `products_export_1 (3).zip`, 82 PROD products, after confirming the 22 Review rows) — 4 conflict products / 9 Handles:**
  - **Nothing Phone 3A Pro** (3): `nothing-phone-3a-pro` "Nothing phone 3A pro" 17 High/1 Review/0 Conflict, 3 images, 2,268 chars; `nothing-phone-3a-pro-1` 5/0/0, 3 images, 1,723; `nothing-phone-3a-pro-2` 5/0/0, 2 images, 1,452. Recommended `nothing-phone-3a-pro` — titles tie, 18 specs vs 5; **safe**.
  - **Realme 15 Pro 5G** (2): `realme-15-pro-5g` (draft) 10/2/0, 4 images, 3,010 chars — Snapdragon 7 Gen 4, 6.8 in, 7000 mAh, 80W; `realme-15-pro-5g-1` (draft) 14/1/0, 2 images, 1,738 — MediaTek Dimensity 6080+, 6.6 in, 5000 mAh, 33W. Best-ranked `realme-15-pro-5g-1` (15 vs 12) but **no safe recommendation**: the two sources state different chipset, display, battery and charging (they may be different devices).
  - **Samsung S23 Ultra** (2): `samsung-s23-ultra` (active) 10/0/0, 4 images, 2,213 chars; `samsung-s23-ultra-1` (draft) 6/0/0, 5 images, 1,838, whose description starts "PTA Approved | A++ Condition | Physical SIM + eSIM" (looks like a used-device listing — Owner to judge). Best-ranked `samsung-s23-ultra` (10 vs 6) but **no safe recommendation** (margin too small).
  - **Tecno Spark 50** (2): `tecno-spark-51` (active) 17/0/0, 5 images, 2,933 chars; `tecno-spark-50` (draft) 9/0/0, 5 images, 2,564. Recommended `tecno-spark-51` — titles tie, 17 vs 9, no contradictions; **safe**.
  - So 2 of 4 have a safe recommendation (Nothing Phone 3A Pro, Tecno Spark 50); 2 need the Owner's own choice (Realme 15 Pro 5G, Samsung S23 Ultra).
- **Checks:** `npm test` **602 / 602** (+8 in `scripts/specificationConflicts.test.mjs`, incl. the real-export test that renders the four grouped decisions) · `tsc -b` clean · `npm run lint` 0 errors (1 pre-existing warning) · `build:dev` and `build:prod` OK · `dist/` = DEV build. Local DEV UI (mocked data): grouped card, recommendation shown, `Use recommended source` resolved only that product, "Need source review" dropped, no write requests.
- **Exact next Owner action:** open the Legacy Shopify Specification Migration section → Load & Extract → Confirm all review suggestions → in "Source conflicts — 4 products": Nothing Phone 3A Pro and Tecno Spark 50 → `Use recommended source` (or compare and pick); Realme 15 Pro 5G and Samsung S23 Ultra → read the two cards and click `Use this source` on the correct one. Then continue with Honor X5c+ (Multiple), approve High-confidence specs, review the rest and export. Commit/push of this change is separate.

---

## 2026-10-11 (newest) — Legacy Shopify Specification Migration tool IMPLEMENTED · review/export only · NO writes performed

> One-time tool. **No DB write (DEV or PROD), no specification insert, no media change, no publish, no deploy, no commit, no push.** The only database access was read-only selects (and read-only SQL against PROD/DEV for the counts below).

**Facts**
- The original Android master Excel is gone; the authoritative current import workbook `Downloads\iSolutions_Android_PROD_UPLOAD_READY_262.xlsx` (82 products / 262 variants) has an EMPTY `Specifications` sheet (0 rows). The 279-row master snapshot has no specification columns either.
- **PROD before migration: 0 `product_specifications` rows for all 82 Android products** (confirmed by a read-only query; DEV also 0 for its 81 matching titles).
- Shopify was used only as a ONE-TIME candidate source (`Downloads\products_export_1 (3).zip`: Body HTML + a few metafields). It is not part of any future routine workflow.

**What was added**
- `src/lib/productSpecificationExtraction.ts` — deterministic extractor: `htmlToText`, `extractSpecifications`, `parseShopifyDescriptions` (per-Handle Body HTML + metafield columns). Only values stated in the text are proposed; nothing is inferred from the model name or general knowledge; marketing prose is ignored. Every proposal has source type (Shopify Body HTML / Shopify Metafield), the Handle, an evidence snippet and a confidence (High = one clear statement; Review = several values in one sentence, hedged wording ("expect", "variant", "version"…), chipset names with a trailing Pro/Plus/Max, metafield-only values, camera chains). Identical repeats are de-duplicated (the more specific wording wins); different values in different sentences are a **Conflict** (no value chosen, both snippets kept). Normalisation is presentation only (5,000mAh → 5000 mAh, 6.67-inch → 6.67 inches, 120Hz, 33W; chipset names kept as written, a trailing "5G" is not part of a chipset name). A "5G" inside a model/chipset name, "4.5G", 2160Hz PWM, "Bluetooth 5.x", comparisons ("over standard 60Hz") and process nodes ("4nm") are not proposed as specs.
- Fields (sections Display, Performance, Software, Camera, Battery, Connectivity, Build, Audio, Security, Other): Screen Size, Display Type, Resolution, Refresh Rate, Peak Brightness (only if "peak"), Chipset, Operating System, UI, Main / Ultrawide / Telephoto / Macro / Front Camera (MP only when tied to its lens), Rear Camera Setup (Review), Battery Capacity, Wired / Wireless / Reverse Charging, Network, Wi-Fi, Bluetooth, NFC, GPS, USB Port, SIM, Dimensions, Weight, Protection (IP), Display Protection, Speakers, Audio Jack, Fingerprint Sensor, Face Unlock, Expandable Storage. RAM/storage are NOT duplicated (they are variants).
- `src/lib/specificationReview.ts` — review state (pure): approve / reject / restore, edit value (marked **Owner Edited**, original value + evidence kept, must be re-approved), resolve conflict (explicit Owner choice → approved, "Owner Resolved"), `approveAllHighConfidence` (High only; never Review or Conflict; optionally per product), duplicate Section+Name blocking, summary counts, `mergeSpecReviews` (keeps Owner decisions when re-extracting after source resolution), `approvedSpecificationRows` + `buildSpecificationsWorkbook`.
- `src/admin/SpecificationMigration.tsx` — Bulk Import page, section "Legacy Shopify Specification Migration" (labelled "Legacy Shopify source — one-time migration"). Choose Shopify ZIP/CSV → Load & Extract Specifications → resolve sources (Confirm all review suggestions / Confirm match / Use this source / choose product — existing matching logic, not weakened; only Matched or Owner-Confirmed sources are extracted) → review table (filters All / High / Needs Review / Conflict / Approved / Rejected / No Specs, search, group by product, per-product "Approve all High-confidence") → Export approved Specifications workbook. **"Apply approved specifications" is disabled in this task.** Shows the environment, stored spec rows (read-only select) and a would-insert preview.
- **Export format:** a NEW .xlsx with one sheet `Specifications` and exactly the importer's headers `Product Key | Section | Specification Name | Specification Value` (Product Key = product slug). It can be merged into the Android workbook later; the existing workbook is never overwritten. Approved rows are the new authoritative specification source after Shopify disappears.
- Future Android flow (Shopify not needed): Android Excel → delta compare against PROD → create/update variants → preserve media → local images only for new products → PTA Approved + Brand New → import/update the `Specifications` sheet → validate → publish ready products.

**Real coverage (current code, 82 PROD Android products vs `products_export_1 (3).zip`)**
- Matching (existing logic): 53 exact Matched · 22 Review (all 22 become usable after "Confirm all review suggestions", as in the image workflow) · 4 Conflict products · 1 Multiple · 3 no source.
- **After confirming the 22:** 75 products have a safely matched/confirmed source; 73 have ≥1 proposal; **2 have none (Xiaomi Redmi 15, Honor X5c — the Shopify text states no specification)**; 7 products need a source decision/have no source (Nothing Phone 3A Pro, Realme 15 Pro 5G, Samsung S23 Ultra, Tecno Spark 50 = Conflict; Honor X5c+ = Multiple; Oppo Reno 16f 5G, Tecno Go 3 = no Shopify source). Proposals: **917 total = 863 High · 44 Review · 10 Conflict**; per product min 1 / median 13 / max 23. Exact-matched-only (before confirming Review): 53 products, 51 with proposals, 617 High · 18 Review · 2 Conflict.
- Nothing was approved, rejected or written.

**Checks:** `npm test` **594 / 594** (+20 in `scripts/specificationExtraction.test.mjs`, incl. a real-export test skipped if the ZIP is absent) · `tsc -b` clean · `npm run lint` 0 errors (1 pre-existing warning) · `build:dev` and `build:prod` OK · `dist/` is the DEV build. Local DEV UI with mocked data: summary cards, bulk approval of High only, Conflict row with "Use …" choices, No Specs list, export button, Apply disabled, no non-GET request.

**Exact next Owner action:** (1) Commit/push this code (uncommitted) and open the Bulk Import page in the admin you use. (2) In "Legacy Shopify Specification Migration" choose `products_export_1 (3).zip` → Load & Extract → `Confirm all review suggestions` → resolve the 4 Conflict products and the Honor X5c+ source. (3) Review: `Approve all high-confidence specs`, then go through Needs Review and Conflict rows (edit/reject/resolve); add specs by hand later for Redmi 15, Honor X5c and the two products with no Shopify source. (4) `Export approved Specifications workbook` and send/keep the file. (5) Separately approve the actual bulk specification import (not built yet).

---

## 2026-10-11 (newest) — Bulk publish for the Android batch IMPLEMENTED · nothing published

> **No publish (DEV or PROD), no PROD/DEV write, no deploy, no commit, no push** while implementing. The PROD figures below come from a read-only query (`begin transaction read only … rollback`).

**Commercial defaults succeeded in PROD:** 82 products / 262 variants now PTA Approved + Brand New; the read-only publication check reported 82 checked, 82 fully ready, `variant_commercial_facts_unresolved` = 0, Samsung A07 valid with no blockers. Nothing was published by that workflow. PROD media (267 rows) is uploaded and verified.

**What was added (publish workflow)**
- `src/lib/bulkPublish.ts` (pure): `buildPublishPreview`, `publishConfirmationPhrase` / `publishConfirmationSatisfied`, `runBulkPublish`, `verifyPublish`. `src/lib/bulkPublishDb.ts`: Supabase adapters. `src/admin/AndroidBulkPublish.tsx`: section "Publish ready Android products" on the Bulk Import page, right under "Apply Android commercial defaults" (wired in `AdminApp.tsx`).
- **Targeting:** the same exact 82-title list (`androidImportBatch.ts`, via `selectAndroidBatch`). Apple products, accessories, unrelated products and duplicate-title products are never targeted; unresolvable ones are skipped and reported.
- **Existing mechanism reused (no weaker parallel validation):** the editor's "Validate & publish" = RPC `validate_product_for_publication(p_product_id)` → must return `is_valid` → `products.update({ publication_status: "published" })`; the database trigger `products_enforce_publication` re-validates and stamps `published_at`. The bulk adapter calls the identical RPC and sends ONLY `publication_status: "published"` (no flag columns such as is_featured/is_flash_sale).
- **Flow:** `Preview publication` (read-only: target / draft / already published / fully ready / blocked / skipped, with the exact blocker codes) → `Publish ready products` (disabled until a preview shows ready > 0 and the environment is valid) → confirmation → sequential run. Per product: re-read the product (already published → counted, not touched; not draft → skipped) → re-run the validator (blocked → not written, reported) → snapshot → publish → read back. A product is **Verified** only if publication_status = published, published_at is set, the product's other fields (title, slug, brand, category, defaults, flags…) are identical, and variants (price, compare-at, SKU, PTA, condition, RAM/storage/colour, delivery…), media count and stock ledger are unchanged. Statuses: Pending / Validating / Publishing / Verified / Blocked / Failed / Already published / Skipped. One failure never stops the batch; no false all-success message. Progress: "Product N of M: <title>"; the page is guarded with the existing unload guard while running.
- **Confirmation:** PRODUCTION shows the red banner, Supabase project, target / ready / already published / blocked / skipped, "This will publish products to the live storefront." and requires the exact phrase **`PUBLISH <ready count>`** (e.g. `PUBLISH 82`; derived from the live ready count). DEV needs only a plain confirmation.
- **Environment guard:** reuses `commercialWriteTarget` (exact pairing: DEV `acwatgxkcyrdxpcljxjb` ↔ development build, PROD `nlxfwppywxumymbjkvwt` ↔ production build). Unknown / mismatched / DEV-in-PROD / PROD-in-DEV publishes nothing (also re-checked inside the runner).

**PROD read-only preview (2026-10-11):** target products **82** · draft **82** · already published **0** · fully ready **82** · blocked **0** · skipped **0** · batch titles missing 0 · targets with Unknown PTA/Condition 0 · media rows 267. Samsung A07: valid, no blockers.

**Checks:** `npm test` **574 / 574** (+15 in `scripts/bulkPublish.test.mjs`: exact-batch targeting, Apple/unrelated excluded, blocked/already-published handling, changed-since-preview revalidation, real validator reused, failure isolation, read-back verification, exact typed phrase, environment mismatch, only publication state changes, commercial defaults never publish, A07 publishable after defaults, 82-ready fixture, progress + unload guard) · `tsc -b` clean · `npm run lint` 0 errors (1 pre-existing warning) · `build:dev` and `build:prod` OK · `dist/` left as the DEV build. Local DEV UI (mocked data): publish disabled before preview; preview showed ready/blocked/already published with the exact blocker; dialog had no typed field on DEV; only the validator RPC (a read) and selects were called.

**Exact next Owner action:** these changes are uncommitted and not deployed. (1) Commit/push, then open the PRODUCTION admin (PROD hosting deploy, or `npm run build:prod && npm run preview:prod`; each needs its own approval). (2) Bulk Import page → "Publish ready Android products" → `Preview publication`; expect 82 target / 82 draft / 82 ready / 0 blocked. (3) `Publish ready products`, type `PUBLISH 82`, confirm. (4) Check the result: 82 published + verified, 0 blocked, 0 failed. Publishing makes the products live on the storefront; it never re-runs any upload or commercial-default write.

---

## 2026-10-11 (newest) — Bulk commercial facts for the Android batch: IMPLEMENTED, PROD write NOT run

> **No DB write (DEV or PROD), no publish, no deploy, no commit, no push.** The PROD preview below is a read-only query (`begin transaction read only … rollback`). The PROD update is waiting for the Owner's explicit go-ahead.

**Business rule (do not re-ask per product):** every imported Android phone in this batch is **PTA Approved** and **Brand New (box pack)**.
- Canonical schema values (existing enums, nothing invented): `pta_status = 'approved'` (UI "PTA Approved"), `condition = 'brand_new'` (UI "Brand New"; this is the "New / Box Pack" state). Product-level mirrors: `products.default_pta_status = 'approved'`, `products.default_condition = 'brand_new'`.

**What was added**
- `src/lib/commercialDefaults.ts` (pure): canonical values, `commercialWriteTarget` (exact build-mode ↔ Supabase pairing, same rule as the image uploader: DEV `acwatgxkcyrdxpcljxjb`, PROD `nlxfwppywxumymbjkvwt`; unknown/mismatched blocked), `selectAndroidBatch`, `planCommercialDefaults` (dry run), `verifyCommercialUpdate`, `runCommercialDefaults` (product-by-product write loop). `src/lib/commercialDefaultsDb.ts`: the only Supabase adapters — two `update`s (variants: `pta_status` + `condition` only; products: `default_pta_status` + `default_condition` only) plus selects. `src/lib/androidImportBatch.ts`: the exact 82 imported Android titles.
- **Product editor** (`AdminCatalog.tsx`, Variants & Pricing tab): `Apply commercial defaults to all variants` — uses the product's Default PTA / Default condition (button disabled until both are set), confirmation "Apply to N variants? PTA … Condition …", then "Applied to N variants." after read-back verification. Per-product action may overwrite explicit values.
- **Batch action** (`AndroidCommercialDefaults.tsx`, shown under Bulk Import): `Preview (read-only)` → counts → `Apply Android commercial defaults` → confirmation (environment, project, target products/variants, PTA, Condition; PRODUCTION needs the typed word `PRODUCTION`) → progress → verified result → read-only publication check (`validate_product_for_publication` per target, nothing published, Samsung A07 shown explicitly).
- **Targeting (no provenance column exists):** products whose title exactly equals one of the 82 batch titles (case/space-insensitive) — never by brand/category alone. Ambiguous (duplicate-title), Apple-branded or non-`real` products are skipped. iPhones, accessories and every other product are never targeted.
- **Batch write policy:** fills Unknown → desired; a product with a variant that already carries a different explicit PTA/Condition, used-phone grade facts, or whose change would create two identical variants is SKIPPED and listed. Already-correct variants are never written.
- **Verification (per product, read-back):** variant count; PTA/Condition equal desired on targets and none Unknown; untargeted variants untouched; SKU, prices (incl. compare-at), RAM/storage/colour, carrier, delivery, warranty, SIM, used facts, active flag, sort order identical; media count unchanged; stock-ledger rows and sum unchanged; product defaults match. A product is "updated" only if every check passes; an interrupted/changed product is reported failed and the others continue. Each product's variants are re-read right before its write ("changed since preview" blocks it).
- Only `product_variants.pta_status/condition` and `products.default_pta_status/default_condition` are ever written. No price, stock, SKU, media, title, brand, category, delivery or publication write exists (source-scan tested).

**PROD read-only preview (2026-10-11, no writes):** target products **82** (all 82 batch titles found, 0 missing, 0 skipped) · target variants **262** (SKUs MB001–MB262, all active) · PTA Unknown **262** · Condition Unknown **262** · already correct **0** · variants to change **262** · product defaults to set **82** · conflicting explicit values **0** · used-phone grade facts **0** · identical-variant collisions **0** · products without variants **0** · existing media rows on targets **267** (will not change) · targets already published **0**.
- **Publication check (read-only, PROD, current state):** 82/82 products fail `validate_product_for_publication` ONLY with `variant_commercial_facts_unresolved` (media is already in place). **Samsung A07: `variant_commercial_facts_unresolved` is its only blocker**, so it should become valid after the update. Not yet run post-update.

**Checks:** `npm test` **559 / 559** (+11 in `scripts/commercialDefaults.test.mjs`) · `tsc -b` clean · `npm run lint` 0 errors (1 pre-existing warning) · `build:dev` OK · `build:prod` OK · `dist/` left as the DEV build. Local DEV UI (mocked data): preview showed 3 products / 6 variants and excluded an Apple product; the confirmation listed environment/project/targets/PTA/Condition; no write requests were made.

**Exact next Owner action:** (1) open the PRODUCTION admin → Bulk Import page → `Apply Android commercial defaults` → `Preview (read-only)`; expect Target products 82 / variants 262 / will change 262. (2) Only if the counts match, click `Apply Android commercial defaults`, type `PRODUCTION`, confirm. (3) Check the result (82 products updated, 262 variants, 0 failed) and the publication check (`variant_commercial_facts_unresolved` should be 0; Samsung A07 valid). (4) Publishing stays a separate decision. Opening the PROD admin needs the new code deployed to PROD hosting or `npm run build:prod && npm run preview:prod` — both are separate approvals; the code in this section is uncommitted.

---

## 2026-10-11 — Pre-commit hardening applied (code ready for commit review)

> Small fixes from the final review. **No upload, no DEV/PROD write, no deploy, no commit, no push.** The verified Bulk Product Images workflow and the uploader/preflight logic are unchanged.

- **Stale Vite shadow files removed:** deleted the gitignored `vite.config.js` and `vite.config.d.ts` (Vite loads `.js` before `.ts`, so bare `vite`/`npx vite build`/`vite --mode production` bypassed every guard). New regression test `scripts/configShadow.test.mjs` fails if either file exists next to `vite.config.ts`. `vite.config.ts` itself is unchanged. If a tool ever regenerates them, delete them again.
- **beforeunload guard:** new `src/lib/unloadGuard.ts` (`installUnloadGuard`); `BulkProductImages.tsx` installs it only while `uploading` is true and removes it when the run ends (effect cleanup). Idle pages are never blocked. Tested: none when idle, one while active (calls `preventDefault` + `returnValue = ""`), removed afterwards, no stacking across runs. Upload execution is untouched.
- **Partial-retry warning (documentation + UI note):** if a product was partly saved, untick the images that were already saved before retrying; uploading a saved image again creates another Cloudinary asset and `product_media` row. There is no automatic de-duplication, no source hashing and no schema change. The upload result now shows this note whenever a product has saved images but is not Verified.
- **Two-tab warning (handoff only):** do NOT run the bulk uploader from more than one browser tab at the same time. The submit latch is per tab; there is no cross-tab locking (the per-product pre-write media re-read narrows, but does not close, the race).
- **Selection Summary wording:** "Selection is valid" → "Selection review is valid: N images for M products ready for preflight on <ENV>. The upload panel below is the final check." The upload panel (and preflight) remains the only write gate.
- **Checks:** `npm test` **548 / 548** (+3 in `configShadow.test.mjs`) · `tsc -b` clean · `npm run lint` 0 errors (1 pre-existing `StorefrontApp.tsx` warning) · `build:dev` OK · `build:prod` OK · `dist/` left as the DEV build (`preview-dist.mjs development --check` OK). Environment-separation and serve-guard tests still pass; no `vite.config.js` / `vite.config.d.ts` present.
- **Status:** 36 uncommitted paths on `feature/checkout-orders-shipping` (HEAD `9e793c3`). Ready for commit review; commit/push/PROD-hosting deploy each still need the Owner's explicit go-ahead (a hosting deploy only exposes the Admin workflow and never re-runs media upload).

---

# 2026-10-10 — PROD BULK PRODUCT IMAGES COMPLETED

> **The PRODUCTION bulk image upload finished successfully and is verified. Do NOT upload these images again.** This section was recorded from the Owner's report; it only documents state — no upload, write, commit, push or deploy happened while updating it.

## Final PROD result
- Catalog products: **82** · products attempted **82** · **verified 82** · failed **0** · partial **0**
- Images uploaded **267** · images failed **0**
- UI final result: **`PROD upload verified`**
- All 82 selected PROD products passed post-write read-back verification.
- PROD catalog now has media for all 82 products involved in this import.

## PROD preparation state before upload
- Shopify export: `C:\Users\User\Downloads\products_export_1 (3).zip` — 1850 CSV rows · 585 source sets (Handles) · 1726 source images.
- Initial PROD catalog: 82 products, 0 existing primary images.
- Initial matching: 53 exact Matched · 22 Review · 4 Conflict products / 9 source sets · 1 Multiple · 2 without a safe source.
- Bulk review: `Confirm all review suggestions` → 22 confirmed, 0 skipped, Review → 0.
- Conflict: all 4 conflict products resolved manually with `Use This Source Set`.
- Multiple: Honor X5C+ chosen for the X5C+ source set → Multiple → 0.
- Manual missing products: **Oppo Reno 16f 5G** and **Tecno Go 3** — local images added for both before the run.
- Final selection before upload: 82 products · 82 image sets · 267 images · Ready 82 · Needs review 0 · Conflicts 0 · Existing images 0.

## PROD environment / safety (as used)
- PROD preview showed: badge PRODUCTION · reference catalog 82 products · PROD Supabase `nlxfwppywxumymbjkvwt` · only the PROD uploader (DEV uploader not active).
- The environment-aware uploader/preflight provided: exact build-mode ↔ Supabase pairing; PROD Cloudinary folder validation (`isolutions-production/products/`); signed-folder validation; returned `public_id` root validation; PROD preflight (incl. signature-only Cloudinary check); typed `PRODUCTION` confirmation; sequential product upload; per-product read-back verification; Failed/Partial/Verified/Blocked reporting; no destructive delete by default; no price, inventory, variant or publication changes.

## DEV history (kept — see the sections below)
- Main DEV batch: 73 attempted · 71 verified · 2 partial · 206 uploaded · 3 failed. The partials (Nokia HMD 102, Nokia HMD 106 2026) were later resolved with smaller local gallery images.
- Motorola Moto Edge Fusion one-product test verified the upload pipeline first.

## Current project status
Bulk Product Images is **proven end-to-end in DEV and PROD**. Workflow: load Shopify ZIP/CSV → `Confirm all review suggestions` → resolve Conflict/Multiple manually → add local images for missing products → Select all eligible → environment-aware preflight → confirm → product-by-product upload → read-back verification.
- PROD media is uploaded and verified. A PROD **hosting** deploy is only needed to expose the new Admin workflow/code, never to apply media again.

## Current code / git (recorded 2026-10-11)
- Branch `feature/checkout-orders-shipping` · HEAD `9e793c3` (unchanged — nothing from the Bulk Product Images / environment-safety work is committed or pushed).
- `git status --short`: 34 paths — 12 modified (`CLAUDE_HANDOFF.md`, `firebase.json`, `package.json`, `scripts/bulkCatalog.test.mjs`, `scripts/phase3a.test.mjs`, `src/admin/AdminApp.tsx`, `src/admin/MediaManager.tsx`, `src/admin/admin.css`, `src/lib/bulkCatalog.ts`, `src/lib/supabase.ts`, `tsconfig.node.json`, `vite.config.ts`) and 22 untracked (the new bulk-image / environment-safety libs, admin panel, scripts and tests).
- Checks re-run: `npm test` **545 / 545** · `tsc -b` clean · `npm run lint` 0 errors (1 pre-existing `StorefrontApp.tsx` warning) · `build:dev` OK · `build:prod` OK. `dist/` left as the DEV build.

## Next recommended step (NOT another image upload)
1. Review the current uncommitted code and decide whether to commit and push the completed Bulk Product Images + environment-safety work.
2. Decide separately whether to deploy PROD hosting with the new Admin workflow (`npm run build:prod`, predeploy guard must pass, explicit Owner approval).

---

## 2026-10-10 (newest) — "Confirm all review suggestions" added (review-only; no upload run)

> Faster PROD review preparation without weakening matching. **No PROD write, no Cloudinary upload, no PROD deploy, no commit, no push.** The PROD uploader was not run. Matching rules are unchanged.

- **What:** a button `Confirm all review suggestions` above the Source Sets table, first in the row: `Confirm all review suggestions` · `Select all eligible` · `Deselect all`. It is disabled when no eligible Review set exists. Code: `eligibleReviewSetIds` / `confirmAllReviewSuggestions` in `src/lib/bulkProductImagesReview.ts`; handler `confirmAllReview` in `BulkProductImages.tsx`.
- **Exact eligibility (all must hold):** current status = Review (so it is not Invalid, Multiple, Conflict, Unmatched, Not used or Skipped); the matcher's own Review result (`match.status === "review"`) has exactly ONE candidate product and the set's target is still that candidate (an Owner-changed target is not touched); not already confirmed; the source has a valid image; the target product exists in the catalog; and no other active source set targets the same product (such a set would already be a Conflict). It only accepts suggestions the existing matcher already produced — no new equivalence rules.
- **Effect:** identical to clicking `Confirm Match` on each eligible row (tested for equality). Images, Primary, Existing-image mode are preserved; an already-included set stays included (a newly confirmed product without a primary becomes included, exactly as per-row Confirm Match). Conflict, Multiple, Unmatched, Invalid and Not used rows keep the same decision objects.
- **Message (live state, nothing hard-coded):** `Confirmed N review suggestions. M skipped[ — manual review still required]. Review complete. Remaining manual actions: X Conflict product(s), Y Multiple, Z Missing.`
- **PROD 82-product fixture (real `products_export_1 (3).zip` vs the 82 PROD titles, current matcher):** Review 22 → **22 confirmed, 0 skipped**; Review now 0; Matched/Confirmed 53 → 75; **Conflict unchanged (9 sets / 4 products), Multiple 1, Missing 2 (Oppo Reno 16f 5G, Tecno Go 3)**. Remaining manual actions: 4 Conflict products (use `Use This Source Set`), 1 Multiple (product-choice UI), 2 Missing (Local Images / Missing Images). Oppo Reno 16f 5G and Tecno Go 3 are NOT Review rows under the current rules — they have no safe source and stay manual.
- **Tests:** `npm test` **545 / 545** (+8 in `scripts/bulkReviewConfirm.test.mjs`, incl. the real-fixture test, which is skipped if the ZIP is absent) · `tsc -b` clean · lint 0 errors (1 pre-existing warning) · `build:dev` and `build:prod` OK (`dist/` left as the DEV build).
- **Local PROD-mode check (approved flag, mocked read-only catalog of the 82 PROD titles, no real PROD contact):** header PRODUCTION; only `Upload Selected Images to PROD`; with a 7-set sample (3 Review, 2 Conflict, 1 Multiple, 1 exact) the click moved Review 3 → 0 and Matched 1 → 4, Conflict (1 product) and Multiple (1) unchanged, button became disabled, selection summary 4 products / 5 images, notice shown, no dialog, no preflight, no non-GET request, no Cloudinary XHR.
- **Next Owner action (PROD review):** open the PRODUCTION admin → Media → Bulk Product Images → load `products_export_1 (3).zip` → `Confirm all review suggestions` (expect 22 confirmed) → resolve the 4 Conflict products with `Use This Source Set` → choose the product for the 1 Multiple → add local images for Oppo Reno 16f 5G and Tecno Go 3 (and any oversized originals) → `Select all eligible` → check the Selection Summary → first PROD run with ONE product (`Keep only this set`) → read the preflight cloud/folder → type `PRODUCTION` → verify → then the rest. Do not run the PROD uploader without the Owner's explicit go-ahead.

---

## 2026-10-10 (newest) — Environment-aware bulk image uploader + PROD preflight/confirmation IMPLEMENTED (PROD upload NOT performed)

> **Status:** the plan from the section below is implemented locally and tested. **Nothing was written to PROD, nothing uploaded to PROD Cloudinary, no PROD deploy, no new DEV bulk upload, no commit, no push** (HEAD `9e793c3`, all work uncommitted). The first real PROD upload still needs the Owner's explicit go-ahead.

### What changed
- `src/lib/devBulkImageUpload.ts` → **`src/lib/bulkImageUpload.ts`** (types `BulkUpload*`, `planBulkUpload`, `runBulkUpload`). **`resolveUploadTarget(supabaseUrl, buildMode)`** is the only write gate: it needs a known project, build mode == that project's environment, and exactly (development ↔ `acwatgxkcyrdxpcljxjb`) or (production ↔ `nlxfwppywxumymbjkvwt`). Unknown / lookalike / missing / mismatched (DEV project in a production build, PROD project in a development build) are blocked — in the plan, the preflight AND again inside the runner for every product.
- **Cloudinary roots** (`CLOUDINARY_ROOTS`): DEV `isolutions-development/products/`, PROD `isolutions-production/products/`. The signed folder must equal `<root><productId>` and the returned `public_id` must start with `<root><productId>/`. A wrong folder blocks the product before any upload (no insert); a wrong returned `public_id` is reported as an orphan and nothing is inserted. The old "folder must not contain production" rule is gone.
- **`src/lib/bulkImagePreflight.ts`** (new): `evaluateBulkPreflight` (sync) + `runBulkPreflight`. Returns `{ passed, errors[], warnings[], environment, projectRef, buildMode, productCount, imageCount, actions{newMedia,addImages,makePrimary}, unresolved{review,multiple,conflict,invalid}, mediaSnapshot, cloudinary, plan }`. Checks: environment/project/build-mode pair; catalog loaded + existing-media snapshot; ≥1 selected product; Review/Multiple/Conflict/Invalid = 0; valid sources; primary rules; existing-primary mode explicit; no duplicate target sets; no foreign Supabase ref in the active bundle config (`runtimeRefs`). **PRODUCTION only:** a signature-only Cloudinary check — ONE `cloudinary-upload-signature` request for the first selected product, verifies the folder is under `isolutions-production/products/`, shows cloud name + folder. The preflight dependency type has NO upload/insert/delete capability.
- **UI (`BulkProductImages.tsx`):** exactly one action, labelled for the real environment — `Upload Selected Images to DEV` on a development build, `Upload Selected Images to PROD` on a production build, a disabled "Upload unavailable" on anything else. Click → preflight (failures listed, nothing uploaded) → confirmation. **PRODUCTION dialog:** red PRODUCTION banner, Supabase ref, Cloudinary cloud + folder, product/image counts, new/add/make-primary counts, unresolved = 0, "This will write production media.", and the confirm button stays disabled until the Owner types exactly `PRODUCTION`. DEV dialog has no typed text. The review controls stay locked during a run.
- **Serve/mode guard:** `serveModeProblem` in `src/lib/supabaseEnvironment.ts`, called from `vite.config.ts` for every `serve` (dev server and preview): `vite --mode production` and `vite preview --mode production` now fail at config load with `[environment guard] Refusing to start …` unless `ISOLUTIONS_PROD_PREVIEW=1`, which only `scripts/preview-dist.mjs` sets — after `previewDistProblem` proves `dist/` references only the requested environment's project. Scripts: `dev` (unchanged, development mode), `preview` → `preview:dev`, `preview:dev` (needs a `build:dev` dist, port 4173), `preview:prod` (needs a `build:prod` dist, port 4174). Existing build guard (`buildEnvironmentProblem`) and the Firebase predeploy guard are untouched.
- Preserved (all existing tests pass): sequential multi-product processing, per-product media re-read, multi-image galleries, Add Images / Add and make primary, one primary, no delete by default, Failed/Partial/Verified/Blocked, continue after a product failure, orphan reporting, read-back verification, "Media changed since review" block, Select all eligible / Deselect all / Keep only this set, Local Images behaviour.

### Verification (2026-10-10)
- `npm test` **537 / 537** (was 521; +16: environment/Cloudinary/preflight/confirmation/UI-gating tests in `scripts/bulkImagePreflight.test.mjs`, serve-guard tests in `scripts/serveGuard.test.mjs` including a real `vite --mode production` being refused) · `tsc -b` clean · `npm run lint` 0 errors (1 pre-existing StorefrontApp warning) · `build:dev` OK (dist → only `acwatgxkcyrdxpcljxjb`) · `build:prod` OK (dist → only `nlxfwppywxumymbjkvwt`). `dist/` was left as the DEV build.
- Local DEV UI (dev server, mocked read-only catalog, no writes): header DEVELOPMENT, only `Upload Selected Images to DEV` (no PROD text), preflight → DEV dialog without typed input, Cancel; no non-GET requests, no Cloudinary XHR.
- Local PROD UI (production-mode server started with the approved flag, **mocked network — no real PROD contact**): header PRODUCTION, only `Upload Selected Images to PROD`; preflight made exactly one (mocked) signature request and no upload; dialog showed PRODUCTION banner, `nlxfwppywxumymbjkvwt`, cloud/folder `isolutions-production/products/…`, 2 products/3 images, unresolved 0, "This will write production media."; confirm stayed disabled for `""`, `production`, `PRODUCTION ` and enabled only for `PRODUCTION`; a signature with a DEV folder produced "Preflight failed — nothing was uploaded". Servers stopped afterwards.
- The REAL PROD signature endpoint, PROD Cloudinary root value, cloud name, PROD RLS/Admin profile were NOT exercised (no PROD credentials/sign-in used).

### Known limitations
- Source files are not recorded on `product_media`, so re-uploading identical images cannot be detected automatically (media-present block + Add modes only).
- The PROD `CLOUDINARY_FOLDER_ROOT` secret value is still unread; the signature-only check proves it at run time. Same Cloudinary cloud for DEV and PROD is unknown (the preflight shows `cloudName`).
- Cloudinary rejects some very large Shopify originals (fetch by URL); expect a few "source file size" failures and replace them with smaller local files.
- PROD admin code is not deployed. Running the PROD Admin locally needs PROD sign-in and a production build served by `npm run preview:prod` (static dist; admin login still needs a PROD Owner/Admin account).

### Exact next Owner action
1. Decide how to open the PROD Admin: (a) deploy the new admin build to PROD hosting (separate explicit approval, `firebase deploy --only hosting --project production` — the predeploy guard must pass), or (b) `npm run build:prod` then `npm run preview:prod` and open `http://127.0.0.1:4174/admin/media` (signs in against PROD Supabase).
2. In PRODUCTION admin: load the Shopify ZIP → resolve Review/Multiple/Conflict → add local images for manual/oversized products → **first run: one product only** (Keep only this set → Upload Selected Images to PROD → read the preflight cloud/folder → type PRODUCTION) and send the verification summary → then Select all eligible for the rest.
3. Do not re-upload the verified DEV batch.

---

## 2026-10-10 (latest) — DEV bulk image upload VERIFIED end-to-end · PROD rollout is PLAN ONLY

> **Status: the Bulk Product Images DEV workflow is verified end-to-end. PROD is NOT enabled.** Nothing has been written to PROD, no PROD Cloudinary upload, no PROD deploy, no commit, no push. All code below is still UNCOMMITTED on `feature/checkout-orders-shipping` (HEAD `9e793c3`, 29 modified/untracked paths). DEV Supabase `acwatgxkcyrdxpcljxjb` · DEV Firebase `isolutions-development-cb1ea` · PROD Supabase `nlxfwppywxumymbjkvwt` · PROD Firebase `isolutions-pakistan-production`.

### A. Final verified DEV result
- **Main DEV bulk run:** 73 products attempted · **71 verified** · 0 failed · **2 partial** · **206 images uploaded** · 3 images failed.
- **Nokia HMD 102 (partial → resolved):** Position 1 uploaded; Position 2 failed (Cloudinary rejected the Shopify source file size). Replacement local blue image uploaded as gallery. Final retry: 1 product attempted · 1 verified · 1 image uploaded · 0 failed · "DEV upload verified". Existing primary retained.
- **Nokia HMD 106 2026 (partial → resolved):** Positions 1–2 uploaded; Position 3 failed (source file size); Position 4 not attempted (product stopped after the failure). Local green + purple replacements uploaded with Existing Image mode = Add Images (gallery). Final retry: 1 product · 1 verified · 2 images uploaded · 0 failed · "DEV upload verified". Existing primary retained.
- **Motorola Moto Edge Fusion:** 2 DEV media rows · 1 primary · 1 gallery · verified (the earlier one-product test).
- **DO NOT re-upload the DEV batch.** Treat DEV as verified evidence that the pipeline works. A product that now has media defaults to "Skip" and is excluded from Select all eligible.
- **Uploader behaviour proven:** multiple products; multi-image gallery sets; one primary preserved; Add Images; Add and make primary; per-product partial failures; continues after a product failure; read-back verification; blocks PROD and unknown environments; detects "Media changed since review"; never deletes existing media by default.
- **Known cause of the 3 failed images:** Cloudinary rejects some Shopify CDN originals as too large when fetched by URL (`safeCloudinaryUploadError` → "rejected the source file size"). Workaround that worked: upload a smaller local file for that position. Expect the same on PROD; the end-of-run summary lists them.

### B. UI fixes verified today
1. **Local Images visibility:** local sets sort first in every filter; an unmatched local batch is always visible; search checks every local filename; 2–10 valid unmatched files added together with no auto-match stay as ONE local set; File objects are preserved. (Root cause: unmatched Local sets sorted behind hundreds of unmatched Shopify sets beyond the 60-row page.)
2. **Keep only this set:** keeps Existing Image mode, include state, image selections and Primary; shows a result line (also when nothing changed or when refused, with the reason); works for Local sets whose product has an existing primary.
3. **assignProduct:** re-confirming the SAME product (Confirm Match / Use This Source Set) no longer resets Existing Image mode or drops the include state; a different product starts again from "skip".

### C. Latest verified checks (run 2026-10-10 after the last fixes)
- `npm test` **521 / 521** pass · `tsc -b` clean · `npm run lint` 0 errors (1 pre-existing `StorefrontApp.tsx` hook warning) · `build:dev` OK (dist references only `acwatgxkcyrdxpcljxjb`) · `build:prod` OK (dist references only `nlxfwppywxumymbjkvwt`). `dist/` was left as the DEV build.

### D. PROD rollout plan (NOT implemented — read/plan only)
**Facts from the code:** the uploader is `src/lib/devBulkImageUpload.ts` (guard `devUploadGuard` hard-codes `DEV_UPLOAD_PROJECT_REF`; the runner rejects any signed folder containing "production"; confirm text and UI say "DEV"). The signed folder comes from the Edge Function `cloudinary-upload-signature`: `${CLOUDINARY_FOLDER_ROOT || "isolutions-development"}/products/<productId>`; PROD has the secret `CLOUDINARY_FOLDER_ROOT` set but its VALUE has not been read (expected `isolutions-production`; must be proven, not assumed). `productMediaPayload` already forces `public_id` to contain `/products/<productId>/`. `vite.config.ts` guards `build` only; `vite serve` (npm run dev) has no mode guard. `.firebaserc` aliases: `development` → `isolutions-development-cb1ea`, `production` → `isolutions-pakistan-production`; `firebase.json` predeploy runs `scripts/check-hosting-environment.mjs`. PROD currently has 82 draft Android products and 0 `product_media` rows.

**1. Code changes required (small, mostly rename + generalise):**
- Rename `devBulkImageUpload.ts` → `bulkImageUpload.ts` (and `DevBulk*` types → `BulkUpload*`); replace `devUploadGuard` with `uploadTargetGuard(supabaseUrl, buildMode)` that resolves the environment from the URL via `environmentForSupabaseUrl`, requires `import.meta.env.MODE` to equal that environment's name, and returns `{ environment, supabaseProjectRef, expectedFolderRoot }`. Allowed = exactly the two known pairs (development↔`acwatgxkcyrdxpcljxjb`, production↔`nlxfwppywxumymbjkvwt`); anything else is blocked.
- Replace the "folder must not contain production" rule with a per-environment positive rule: folder must start with `isolutions-development/products/` (DEV) or `isolutions-production/products/` (PROD) and end with `/<productId>`; after upload the returned `public_id` must start with the same root (add to the payload check, not just the folder).
- Make UI strings environment-aware (button "Upload Selected Images to DEV|PRODUCTION", confirm dialog, progress, report). Keep the DEV/PROD badge already shown by `referenceCatalogEnvironment`.
- Add `bulkImagePreflight.ts` (pure + injected reads) and a typed PROD confirmation (see 7–8).
- Add a `serve` guard in `vite.config.ts` (refuse `--mode production` dev servers unless an explicit `ALLOW_PROD_ADMIN_LOCAL=1`) so local PROD access is deliberate.
- Update tests: environment matrix (dev/prod/unknown/lookalike × mode), folder-root matrix (DEV folder in PROD blocked, PROD folder in DEV blocked), PROD confirmation text, preflight checks; keep all 521 existing tests green. No migration, no Edge Function code change.

**2. DEV-only guards that become explicit environment-aware guards:** `DEV_UPLOAD_PROJECT_REF`; `devUploadGuard`; the `/production/i` folder rejection; `DEV_UPLOAD_WARNING`; panel strings; the test assertions that forbid the PROD ref in the lib (replace with "PROD ref only appears via `SUPABASE_ENVIRONMENTS`").

**3. Cloudinary rules for PROD:** folder root must be the PROD root (`isolutions-production`, to be confirmed by the signature-only preflight below); folders are `<root>/products/<productId>`; transformation `c_limit,w_3000,h_3000,q_90,fl_force_strip` unchanged; secrets stay in Edge Function secrets only. Whether PROD uses the same Cloudinary cloud as DEV is NOT known (the cloud name is a function secret, not read) — the preflight displays the `cloudName` returned by the signature and the Owner must recognise it.

**4. Supabase for PROD:** exactly `nlxfwppywxumymbjkvwt`, from `.env.production.local` via `npm run build:prod` (or `--mode production` locally). **5. Firebase PROD:** `isolutions-pakistan-production` (`firebase deploy --only hosting --project production`, only with explicit approval; the predeploy guard must pass).

**6. Cross-environment prevention (layers):** (a) build guard `buildEnvironmentProblem` (mode ↔ project, distinct keys); (b) hosting predeploy guard (bundle ref ↔ Firebase project); (c) NEW runtime guard in the uploader (MODE ↔ URL ↔ allowed pair); (d) NEW per-environment Cloudinary folder-root allow-list checked on the signature AND on the returned `public_id`; (e) per-product pre-write media re-read (existing); (f) preflight shows project ref + folder + cloud name before any write; (g) typed confirmation for PROD; (h) no DEV project reference in a production bundle and vice versa (existing `check:hosting-env`).

**7. PROD preflight (read-only; runs when the Owner clicks Upload, before the confirmation):** target environment = PRODUCTION · exact Supabase project match · build mode = production · catalog loaded (count) · existing-media snapshot (products with media / with primary) · selected source sets and products · unresolved Review/Multiple/Conflict = 0 · Invalid sources = 0 · image counts per product and total · primary rules (exactly one primary for no-primary products) · existing-primary mode per product · no duplicate target source sets · no media already present for "new" products (re-read) · duplicate-media screen (a product that already has media is only touched via explicit Add modes; source files are not recorded on `product_media`, so identical re-uploads cannot be detected automatically — rely on the media-present block) · **signature-only Cloudinary check:** request ONE signed upload for the first product (no upload happens) and verify folder root = PROD root and show cloudName · the active bundle references no DEV Supabase ref. Any failure blocks with one reason.

**8. PROD confirmation dialog:** red "PRODUCTION" banner · Supabase project `nlxfwppywxumymbjkvwt` · Cloudinary cloud + folder root · N products · M images · existing-media actions (X add as gallery, Y add and make primary) · unresolved = 0 · "This will write PRODUCTION media: it uploads images to Cloudinary and inserts product_media records. Nothing is deleted or published." · the Owner must type `PRODUCTION` to enable the confirm button.

**9. PROD runner:** reuse the verified runner unchanged in behaviour (product-by-product; pre-write media read; upload; insert; RPC `set_product_media_primary` for make-primary; read-back verification; continue after product failure; Verified/Failed/Partial/Blocked; orphan `public_id` report; no delete; no publish/price/inventory/variant writes).

**10. Canary:** no new temporary UI. A PROD canary is technically JUSTIFIED as the first run only because three things differ from DEV and cannot be proven by DEV or by read-only checks: the PROD `CLOUDINARY_FOLDER_ROOT` secret value / Cloudinary credentials, PROD RLS + the Owner/Admin profile for `product_media` insert and `set_product_media_primary`, and PROD Edge Function behaviour. The signature-only preflight proves the folder root and cloud name without a write; the remaining risk is closed by running the NORMAL uploader once with a single product (select one set → "Keep only this set" → upload), reading the verification, then Select all eligible for the rest. It is an operational step with the same UI, not extra code. Blast radius is small: PROD products are drafts with 0 media rows.

**11. Owner workflow (target):** build/open PRODUCTION admin → load Shopify ZIP → resolve Review/Multiple/Conflict → add local images for missing/manual products (and small local replacements for any "source file size" failures) → Select all eligible → PROD preflight → type PRODUCTION → Upload Selected Images to PRODUCTION → monitor → read the verification summary. Admin sign-in is separate per environment. Local access to PROD admin without any hosting deploy is possible via `vite --mode production` once the serve guard exists; deploying the new admin code to PROD hosting is a separate approval.

**12. Recommended next implementation step:** implement the environment-aware uploader refactor + preflight + typed confirmation + serve guard + tests (items 1–2, 6–8) with PROD writes still impossible until the Owner explicitly approves the first run; verify on DEV only (no new DEV bulk upload; the preflight's signature-only check may be run against DEV).

---

## 2026-10-10 — Final verified state (end of day)

Summary of today's verified state. Details are in the "Step 3 correction: product image sets" section directly below.

### 1. Status
- **Bulk Product Images Step 3 is implemented locally** (uncommitted). Branch `feature/checkout-orders-shipping`, HEAD `9e793c3`.

### 2. Corrected state model
- One product supports **multiple gallery images**.
- One Shopify Handle = **one source image set**. All valid images in the chosen set remain available.
- The lowest Image Position is the default **Primary**; the remaining images are **gallery** images.
- Changing Primary does **not** deselect gallery images.
- **Conflict** = different source sets/Handles target the same iSolutions product.
- **"Use This Source Set"** keeps the whole selected set and marks competing sets **Not Used**.

### 3. Missing Images workflow
- Catalog products with no usable Shopify source appear in a separate **Missing Images** section.
- Multiple local images can be selected for one product. One image is Primary; the others remain gallery images.
- Current manual products: **Oppo Reno 16f 5G**, **Tecno Go 3**.

### 4. Real Shopify export status
- File: `C:\Users\User\Downloads\products_export_1 (3).zip`
- **585** source sets, **1,726** images.
- **53** Matched · **22** Review · **4** Conflict products (**9** competing sets) · **1** Multiple · **2** manual / no safe Shopify source.
- **80/82** catalog products coverable.
- **53** matched sets selected by default, containing **157** images.

### 5. Review UI behaviour
- Review Images gallery, with a Primary selector and include/exclude for each gallery image.
- Use This Source Set; Change Product / manual assignment.
- Missing Images local upload.
- Existing-primary products are skipped by default. "Add Images" and "Add and make primary" are explicit choices only.
- **Apply Selected Images is still disabled.**

### 6. Environment status
- The environment separation fix is implemented locally.
- `build:dev` points only to DEV Supabase (`acwatgxkcyrdxpcljxjb`); `build:prod` points only to PROD Supabase (`nlxfwppywxumymbjkvwt`).
- **The live DEV site still needs a safe redeploy before any real DEV write or upload test.**

### 7. Tests / build
- `npm test` **490/490** pass · TypeScript clean · lint 0 errors (only the old `StorefrontApp.tsx` warning) · `build:dev` passes · `build:prod` passes.
- No DEV writes · no PROD writes · no Cloudinary uploads · no commit · no push · no deploy.

### 8. Tomorrow's exact first step
1. **Signed-in localhost visual verification on `/admin/media`** (DEV build). Check that:
   - Review Images shows multiple thumbnails;
   - changing Primary keeps the gallery images;
   - Use This Source Set keeps all images from the chosen Handle;
   - Missing Images supports multiple local images.
2. Then, **only after Owner approval**:
   1. Safe DEV redeploy with `npm run build:dev` → `firebase deploy --only hosting --project development`.
   2. One-product DEV upload test.
   3. Later, the PROD bulk image upload.

---

## 2026-10-10 — Bulk Product Images Step 3 correction: product image sets (review only)

Supersedes the "one row = one image" model in the 2026-10-09 (later) section below. Everything else there (Priority A, Shopify ZIP loading, environment badge, read-only catalog) still holds.

### 1. Git state
- Branch `feature/checkout-orders-shipping`, HEAD **`9e793c3`**. All work is uncommitted. No commit / push / deploy, no DEV or PROD writes, no Cloudinary calls. `dist/` = last **DEV** build.

### 2. State model (`src/lib/bulkProductImagesReview.ts`, rewritten)
- The review is a list of **source sets**, each with images and an Owner decision. A decision holds: target product, confirmed, included, dismissed (`not_used` / `skipped`), existing-image mode, selected image ids, and one primary image id.
  - **Shopify set** = one Handle with **all** its images (sorted by Image Position, duplicate URLs dropped, each URL validated). The lowest position is the default Primary; the rest are selected gallery images.
  - **Local set** = Owner files for one product. Files matched to the same product, files manually assigned to it, and Missing Images uploads all join **one** set. They never conflict with each other.
- **Conflict** = two or more **different active source sets** target the same product: Shopify Handle vs Handle, or Shopify vs local. Several images inside one set are never a conflict. "Use This Source Set" keeps every image of that set and marks the competing sets **Not Used** (Restore is available).
- The Step 1 matcher and its rules are **unchanged**. Global local files are matched one file at a time, so files for the same product group into one set instead of being flagged as a conflict. `buildImageAssignmentPlan` (single image per product) is no longer used by the review. It is left intact with its tests.
- **Primary:** `setPrimaryImage` moves only the flag. The primary cannot be deselected; choose another primary first. Gallery images can be unticked and re-ticked (they stay in source order). Local images can also be removed, and a local set can be cleared.
- **Existing primary image:** default **Skip**. "Add images" adds gallery images only and keeps the existing primary. "Add and make primary" inserts every image as gallery, then switches the chosen image to primary via `set_product_media_primary`; old media is kept. Both are explicit choices. Nothing is deleted or replaced.
- **Insert plan** (`planImageSet`, display only, nothing executed): the primary goes first (reusing `planPrimaryAssignment`), gallery images follow, and sort orders continue after the product's existing media.
- **Validation per included set:**
  - exactly one target product, a valid source, and only valid images selected;
  - at least one selected image;
  - exactly one selected Primary when the product has no primary (or with "Add and make primary");
  - no unresolved competing source set; Review / Multiple / Conflict resolved;
  - existing-primary products need Add images or Add and make primary.
  
  The environment must be known and at least one set must be included. **Several images for one product are allowed.**
- **Catalog coverage** (catalog perspective): total, with usable source, selected for images, still missing, existing primary, needs manual action. There is also a breakdown by best source (matched / confirmed / review / conflict / multiple / none).

### 3. UI (`src/admin/BulkProductImages.tsx`, rewritten)
- **Sources:** Shopify CSV / ZIP and Local Images are both kept. The two sources now **combine** in one review: a new Shopify load replaces only the Shopify sets, and local loads add to the review. A **Clear review** button resets everything.
- **Catalog coverage cards**, then **Source sets** cards (Loaded + image count, Matched, Review, Multiple, Conflict + products, Unmatched + skipped, Invalid, Included + images).
- **Table columns:** Include Set?, Source, Shopify Title / Files, Handle, Detected Brand, Detected Model, Matched iSolutions Product, Images (selected/total + thumbnail strip), Primary Preview, Status, Issue, Action.
- **Actions by status:**

  | Status | Actions |
  |---|---|
  | Matched | Review Images |
  | Review | Confirm Match, Change Product, Review Images |
  | Multiple | Use <candidate>, Choose Product, Review Images |
  | Conflict | Use This Source Set, Review Images |
  | Unmatched | Choose Product, Skip (no forced local upload) |
  | Not used / Skipped | Restore |
  | Existing image | Skip / Add images / Add and make primary (select) |
  | Local sets | Remove set |

- **Review Images** opens a gallery editor. Every image has a thumbnail, an Include box and a Primary radio, plus Remove for local images. Invalid images are shown with their reason.
- **Missing Images** section (catalog perspective): products with no primary, no usable Shopify set, and not a candidate of an unresolved Multiple. Each row shows title, brand, current image status, the pending local thumbnails (Make primary / Remove), **Upload Images** (multiple files, contents validated, invalid files rejected with a message), Include and **Clear selected set**. It has search and pages of 20.
- Local preview object URLs are revoked once they are no longer shown (`retainOnly`) and on unmount.
- **Apply Selected Images** is still always `disabled`: "Not enabled until upload testing is approved."
- CSS: about 50 more `.bulk-images-*` lines in `admin.css`.

### 4. Real export (`products_export_1 (3).zip` vs the 82 PROD titles; test 14)
- 585 sets / **1,726 images**.
- Coverage by best source: **53 matched · 22 review · 4 conflict products (9 sets) · 1 multiple · 2 none**. The matching rules were not loosened.
- The 53 matched sets start included with **157 images**: 53 primaries plus gallery images. They validate with no blockers.
- Catalog coverage: with usable source **80** · selected **53** · still missing **2** · existing primary **0** · needs manual action **29** (22 + 4 + 1 + 2).
- **Missing Images = exactly Oppo Reno 16f 5G and Tecno Go 3.** Both are ready for local gallery uploads; their Shopify candidates stay manual. The Oppo Handle can also be assigned with Choose Product.

### 5. Tests / build
- `scripts/bulkProductImagesReview.test.mjs` was rewritten with 15 tests covering items 1–15 of the brief, plus ZIP loading, object URLs, the environment label and Apply staying disabled.
- `npm test` **490/490** · `tsc -b` clean · lint 0 errors (only the pre-existing `StorefrontApp.tsx` warning) · `build:prod` → only `nlxfwppywxumymbjkvwt` · `build:dev` → only `acwatgxkcyrdxpcljxjb`, hosting guard OK.

### 6. Localhost
- Port 4173 (DEV dist) shows "Development store connected", no console errors and no Supabase requests while signed out. The built `AdminApp-*.js` contains Missing Images, Use This Source Set, Review Images, Upload Images and Add and make primary.
- **Not visually verified:** the signed-in `/admin/media`. It needs the Owner's DEV Admin sign-in, which was not available in this session. The behaviour is covered by the unit tests.

### 7. Known limitations
- Product-level gallery only: no variant or colour images.
- Review state is in memory and is lost on reload.
- Local `File` objects are not kept for the future Apply. Files must be re-selected once Apply exists, or Apply must hold them.
- A Shopify set whose position-1 image URL is invalid is treated as invalid as a whole (Step 1 rule; the real export has 0 such sets).
- Local filename grouping relies on the Step 1 stem rules. "Brand Model (1).jpg" and " - Copy" variants group together; "Brand Model-2.jpg" does not, by design (it could collide with real model numbers). Use Missing Images or Choose Product for those files.

### 8. Exact next step
1. The Owner signs in on localhost (DEV build) and visually checks `/admin/media`: the real ZIP, the gallery editor, a conflict choice, and Missing Images uploads for Tecno Go 3 / Oppo Reno 16f 5G.
2. Safe DEV redeploy with Owner approval: `npm run build:dev` → `firebase deploy --only hosting --project development`.
3. Only after separate approval: wire Apply for a **one-product DEV upload test**. It walks the `validation.plans[].inserts` order: `requestProductUploadSignature` → `uploadToCloudinary` (Shopify URL or File) → `productMediaPayload` → insert, plus `set_product_media_primary` where `makePrimaryAfterInsert`. Then flip `BULK_IMAGE_APPLY_ENABLED`.
4. The PROD 82-product batch needs its own approval.

---

## 2026-10-09 (later) — Bulk Product Images Step 3: review UI (no uploads, no writes)

### 1. Git state
- Branch `feature/checkout-orders-shipping`, HEAD still **`9e793c3`**. Everything from today (Priority 1, Steps 1–3) is **uncommitted**. No commit / push / deploy. No DEV or PROD writes. No Cloudinary calls.
- `dist/` now holds the last **DEV** build (`npm run build:dev`), not PROD.

### 2. Priority A — DEV redeploy prep (re-verified, NOT deployed)
- `npm run build:dev` → the only Supabase URL in the bundle is `https://acwatgxkcyrdxpcljxjb.supabase.co`. The PROD ref string `nlxfwppywxumymbjkvwt` appears once, only as the label constant in the shared environment map (`supabaseEnvironment.ts`), not as a connection URL. `GCLOUD_PROJECT=isolutions-development-cb1ea npm run check:hosting-env` → OK.
- **The live DEV site is still the old PROD-wired bundle.** It must be redeployed with `npm run build:dev` → `firebase deploy --only hosting --project development` (Owner approval) **before any real DEV upload test**.

### 3. Step 3 — what was built
- `src/lib/bulkProductImagesReview.ts` (new, pure, no I/O): review state over the Step 1/2 modules. It does not duplicate matching or upload logic. It uses `matchImageSources` / `localImageSources` / `buildImageAssignmentPlan` (productImageMatching), `parseShopifyProductsCsv` / `shopifyImageSources` (shopifyProductCsv), `planPrimaryAssignment` (productMediaPayload), `validateSourceImage` (cloudinary) and `environmentForSupabaseUrl` (supabaseEnvironment). `BULK_IMAGE_APPLY_ENABLED = false`.
- `src/admin/BulkProductImages.tsx` (new): the "Bulk Product Images" panel at the top of `/admin/media`, above the unchanged `MediaLibrary`. It is separate from `BulkImport.tsx`. `MediaManager.tsx` was not touched in Step 3.
- `src/admin/AdminApp.tsx`: +2 lines (import + render on `/admin/media`). `src/admin/admin.css`: +90 lines of `.bulk-images-*` styles.
- `scripts/bulkProductImagesReview.test.mjs` (new, 12 tests). `scripts/support/prodCatalogTitles.mjs` (new): the 82 PROD titles fixture, moved out of `bulkProductImages.test.mjs`, which now imports it. The tests themselves are unchanged.

**Behaviour**
- **Reference catalog:** read-only `products.select("id,title,slug,brand:brands(name),product_media(is_primary)")`, paged by 1000. It is the only database call in the panel. The badge shows **DEVELOPMENT / PRODUCTION / UNKNOWN** from the shared map. UNKNOWN blocks validation and Apply.
- **Shopify CSV / ZIP:** accepts `.csv` or `.zip`. Inside a ZIP it finds the CSV whose header has Handle + Image Src. It rejects a ZIP with no Products CSV or with more than one, and caps files at 50 MB. Rows are grouped by Handle, the lowest Image Position is the primary candidate and duplicate URLs are ignored. Thumbnails load directly from the Shopify CDN with `?width=160`, `loading="lazy"` and `referrerPolicy="no-referrer"`; nothing is proxied or downloaded. The default filter is **Relevant**, which hides sources that touch no catalog product. The table shows 60 rows plus "Show more".
- **Local Images:** multi-select of JPEG/PNG/WebP/AVIF (same types as MediaManager). The declared type and size are checked, then the magic bytes via `validateSourceImage`. Invalid files are rejected and get no preview. Valid files get object-URL previews, which are revoked on a new load, a source switch and unmount.
- **Rows / statuses:** Matched (selected only if the product has no primary), Review (suggestion, not selected, **Confirm** / Change product), Multiple (not selected, one "Use <candidate>" button each + picker), Conflict (not selected, **Use this image** marks the other sources "Not used", or Not used), Unmatched (Choose product), Invalid, Not used (Restore).
- **Manual picker:** search by title / brand / slug. Assigning a product recomputes conflicts live, so an assignment can create a conflict with an existing match.
- **Existing image:** the row is skipped by default. It can only be used if the Owner ticks **"Add and make primary"**. Nothing is ever replaced or deleted.
- **Validator** (selection summary: Selected products / Ready / Needs review / Conflicts / Existing images + blockers). It requires:
  - a known environment and at least one selected row;
  - exactly one target product per selected row and a valid source;
  - Review / Multiple / Conflict rows explicitly resolved, and no duplicate targets;
  - an explicit override for any product that already has a primary image.
  
  It then runs `buildImageAssignmentPlan` and shows the `planPrimaryAssignment` result per item.
- **Apply Selected Images** is always `disabled`: "Not enabled until upload testing is approved." The panel and module contain no insert/update/delete/rpc/functions.invoke/fetch/Cloudinary code (test 15 checks this).

### 4. Real Shopify coverage (`products_export_1 (3).zip` vs the 82 PROD titles fixture; test 17)
- 1,850 CSV rows → 585 Shopify products. Rows: 53 matched · 22 review · 9 conflict (**4 products**) · 1 multiple · 489 unmatched · 11 invalid. **53 rows start selected.** Relevant view = 85 rows.
- Catalog coverage: **53 Matched · 22 Review · 4 Conflict · 1 Multiple · 2 without a source (Oppo Reno 16f 5G, Tecno Go 3) = 80 / 82**. The 2 stay manual; matching rules were not loosened. The Owner can assign them through the picker if they decide the Shopify listing is the same model.
- Test 17 reads the ZIP from `C:/Users/User/Downloads/products_export_1 (3).zip`, or from env `BULK_IMAGES_SHOPIFY_ZIP`. It is skipped, not failed, if the file is absent. The ZIP is not copied into the repo.
- On localhost, the UI will show **DEV** catalog coverage, which differs from the 82-product PROD numbers.

### 5. Tests / build
- `npm test` **487/487 pass** (475 + 12 new) · `tsc -b` clean · `npm run lint` 0 errors (the only warning is the pre-existing `StorefrontApp.tsx` exhaustive-deps one) · `build:prod` OK (bundle only `nlxfwppywxumymbjkvwt`) · `build:dev` OK (bundle only `acwatgxkcyrdxpcljxjb`).

### 6. Localhost UI result — partially verified
- DEV build served at `localhost:4173` (`npm run preview`): the login page shows "Development store connected", there are no console errors, and the only requests are localhost GETs (no Supabase or Cloudinary writes). The built `AdminApp-*.js` contains the panel.
- **Not yet verified in the browser:** the authenticated `/admin/media` panel (selecting the ZIP, counts, thumbnails, filters, picker). The Admin sign-in must be done by the Owner; it was not done this session. The panel logic is covered by the 12 unit tests.

### 7. Known limitations
- One primary image per product; no gallery or colour images yet.
- The review state is in memory only and is lost on reload.
- The full CSV is parsed in the browser (about 0.7 s for the real export in Node).
- Shopify `?width=` thumbnails depend on the Shopify CDN.
- The Shopify listing status (active/draft) is shown but does not affect matching.
- An object-URL preview can be created for a file that is later shown as unmatched (it is still revoked on cleanup).

### 8. Exact next step
1. The Owner signs in on localhost (`npm run build:dev` + `npm run preview`, or `npm run dev`) and visually checks `/admin/media` with the real ZIP.
2. With Owner approval: **safe DEV redeploy** — `npm run build:dev` → `firebase deploy --only hosting --project development` (the predeploy guard must pass).
3. Only after separate Owner approval: wire Apply for a **one-image DEV upload test**. Per row: re-read media → `planPrimaryAssignment` → `requestProductUploadSignature` → `uploadToCloudinary` (Shopify URL or File) → `productMediaPayload` → insert (+ `set_product_media_primary` only for explicit make-primary). Then set `BULK_IMAGE_APPLY_ENABLED`.
4. The PROD 82-product batch needs its own separate approval.

---

## 2026-10-09 — DEV/PROD build separation + Bulk Product Images Steps 1–2

### 1. Git state
- Branch `feature/checkout-orders-shipping`, HEAD still **`9e793c3`** (pushed). **All work below is uncommitted** — no commit/push/deploy, no DEV/PROD writes, no Cloudinary uploads were made today.
- Modified: `CLAUDE_HANDOFF.md`, `firebase.json`, `package.json`, `tsconfig.node.json`, `vite.config.ts`, `src/lib/supabase.ts`, `src/lib/bulkCatalog.ts` (only `csvRows` exported), `src/admin/MediaManager.tsx`, `scripts/phase3a.test.mjs`, `scripts/bulkCatalog.test.mjs`.
- New: `src/lib/supabaseEnvironment.ts`, `scripts/check-hosting-environment.mjs`, `scripts/environmentSeparation.test.mjs`, `src/lib/productImageMatching.ts`, `src/lib/shopifyProductCsv.ts`, `src/lib/productMediaPayload.ts`, `src/lib/productMediaUpload.ts`, `scripts/bulkProductImages.test.mjs`, `scripts/productMediaUpload.test.mjs`.

### 2. Priority 1 — DEV/PROD environment separation (implemented + verified locally; NOT deployed)
**Cause (verified):** plain `vite build` = mode `production`, which loads `.env.local` (DEV) and then `.env.production.local` (PROD, wins) → every build was PROD-wired. The Firebase active project for this directory is `isolutions-development-cb1ea`, so a bare `firebase deploy` put that PROD-wired build on DEV hosting. Also: a stale, git-ignored `vite.config.js` (Aug 19) shadows `vite.config.ts` in Vite's default lookup — scripts now pass `--config vite.config.ts` explicitly (the stale file was left in place; delete only with Owner approval).

**Fix:**
- `src/lib/supabaseEnvironment.ts` — single map (public ids only): development = Supabase `acwatgxkcyrdxpcljxjb` ↔ Firebase `isolutions-development-cb1ea`; production = Supabase `nlxfwppywxumymbjkvwt` ↔ Firebase `isolutions-pakistan-production`.
- `vite.config.ts` build guard: throws unless mode is exactly `development`/`production` **and** the resolved `VITE_SUPABASE_URL` is that mode's project; a production build whose publishable key equals the development key also fails (mixed config).
- `firebase.json` hosting `predeploy` runs `node scripts/check-hosting-environment.mjs`: scans `dist/assets/*.js` for `<ref>.supabase.co` and blocks the deploy unless exactly one ref is present and it matches the target Firebase project (`GCLOUD_PROJECT`).
- `src/lib/supabase.ts` — Admin environment badge derived from the shared map; an unlisted project now shows **"Unknown"** (previously anything non-PROD showed "Development").

**Exact build/deploy commands:**
- DEV: `npm run build:dev` (= `tsc -b && vite build --config vite.config.ts --mode development`, uses `.env.local`) → `firebase deploy --only hosting --project development`
- PROD: `npm run build:prod` (= `… --mode production`, uses `.env.production.local`) → `firebase deploy --only hosting --project production`
- `npm run build` = `npm run build:prod`. Manual check: `GCLOUD_PROJECT=<firebase project id> npm run check:hosting-env`.

**Verified locally:** `build:dev` bundle contains only `acwatgxkcyrdxpcljxjb`; `build:prod` only `nlxfwppywxumymbjkvwt`; DEV bundle has the same size as PROD (production-optimized); predeploy guard passes matching targets and BLOCKS DEV-build→PROD-hosting and PROD-build→DEV-hosting; DEV build with URL forced to PROD and an unsupported mode both fail; localhost `/admin/login` shows "Development store connected". `dist/` currently holds the last **PROD** build.

**⚠ Still open:** the live DEV site (`isolutions-development-cb1ea.web.app`) still serves the old PROD-wired bundle until it is redeployed with `npm run build:dev` (needs Owner approval). Until then, DEV-hosted Admin = PROD data. Limitation: `sb_publishable_…` keys carry no project ref, so a DEV build cannot prove its key is DEV (the PROD build checks only that its key differs from DEV's).

### 3. Bulk Product Images — architecture (read-only inspection, confirmed)
- `product_media` (one-primary partial unique index, complete-Cloudinary-reference check, unique public/asset ids, admin-only RLS writes, public reads published only); `set_product_media_primary` / `reorder_product_media` RPCs; delete trigger promotes next image to primary; publication requires a valid primary Cloudinary image. Multiple images per product + colour assignments already supported. No bulk media code existed; no Shopify code existed.
- PROD (read-only, `begin transaction read only … rollback`): 82 real draft products, all titled "Brand Model", **0 product_media rows**. PROD Edge Functions `cloudinary-upload-signature` + `cloudinary-delete-media` ACTIVE; PROD secret names include `CLOUDINARY_FOLDER_ROOT` (values not read).
- **No migration and no Edge Function change are needed.** Cloudinary's upload API accepts an https URL as `file` (not part of the signature), so Shopify CDN images can be ingested through the existing signed upload — Cloudinary fetches them; the browser never downloads them. Shopify URLs are never hot-linked (publication needs a Cloudinary `public_id`).
- Owner decisions: a product that already has a primary image is **skipped** unless the Owner explicitly chooses "add and make primary" (insert non-primary, then `set_product_media_primary`); old media is never deleted by the bulk flow. First version = one primary image per product; no variant/colour images.

### 4. Step 1 — pure matching + Shopify CSV (done; no I/O)
- `src/lib/productImageMatching.ts`: exact key = `catalogSlug` (case-insensitive; spaces/hyphens/underscores/dots equivalent; `+` = `plus`; copy markers "(1)" / " - Copy" stripped) → **Matched** (only these start selected, and only when the product has no primary). Review tier (both sides normalized; never auto-selected) strips bracketed specs, RAM/storage (`8/256`, `8GB/256GB`, `4+8GB`, `128GB` — a model's own `+` survives), 4G/5G, PTA/warranty/box/dual-SIM words, basic colours, family words Galaxy/Redmi/Poco, Samsung **`Z`** (only right after Samsung/Galaxy), and splits joined tokens (`2pro`→2 pro, `17tpro`→17t pro, `flip5`→flip 5). Statuses: matched / review / multiple / conflict (several sources → one product) / unmatched / invalid. Never prefix/fuzzy matching (X5c vs X5c+, Note 15 Pro vs Pro+, Phone 3A/3A Lite/3A Pro, A6/A6s, C100/C100i/x, Y05/Y05e stay apart). `buildImageAssignmentPlan` validates Owner choices (one image per product, invalid rows rejected, manual assignment of unmatched rows allowed, existing-primary products skipped unless explicit).
- `src/lib/shopifyProductCsv.ts`: Shopify Products export → grouped by Handle (Title/Vendor from first row), primary = lowest Image Position, Variant Image ignored; image URL must be https Shopify CDN (`cdn.shopify.com` or a store domain `/cdn/shop/`) and JPEG/PNG/WebP/AVIF. Vendor used as brand only if it is a catalog brand; brand inferred from a family word is review-only.
- `src/lib/productMediaPayload.ts`: Cloudinary response → `product_media` insert (same fields as MediaManager), rejects responses outside `…/products/<productId>/`, bad dimensions/format/URL, blank alt, binary data; `planPrimaryAssignment` implements the Owner-approved primary rule.
- **Real Shopify export (Owner-confirmed file: `C:\Users\User\Downloads\products_export_1 (3).zip` — the other `products_export_1*.zip` files in Downloads are NOT to be used):** 1,850 CSV rows → 585 Shopify products, 574 with images, **574/574 valid URLs** (all `cdn.shopify.com`), Vendor = store name "iSolutionPakistan" on all (so title/handle drive matching). Read in memory only.
- **Coverage of the 82 PROD products: 80/82 coverable** — **53 Matched** (safe, no action) · **22 Review** (Owner confirms: Honor X9D, Nothing Phone 2 Pro, Oppo Reno 15 Pro 5G, Samsung A07/A17/A27/A37/A56/A57, Samsung Flip 5/Flip 6/Fold 5/Fold 6/Fold 8 Ultra, Samsung S24 Ultra/S26/S26 Ultra, Xiaomi A5/A7 Pro/Note 14 Pro/Note 15/Note 15 Pro) · **4 Conflict** (Owner picks one Shopify product: Nothing Phone 3A Pro ← `nothing-phone-3a-pro` / `-1` / `-2`; Samsung S23 Ultra ← `samsung-s23-ultra` (active) / `samsung-s23-ultra-1` (draft); Tecno Spark 50 ← `tecno-spark-50` (draft) / `tecno-spark-51` (active); Realme 15 Pro 5G ← `realme-15-pro-5g` / `-1` (both draft)) · **1 Multiple** ("Honor X5C+", handle `honor-x5c` → title says X5c+, stale handle says X5c; correct pick is **X5c+** — Honor X5c is matched separately) · **2 none, kept manual/unmatched by Owner decision:** Oppo Reno 16f 5G (Shopify "Oppo 16f 5g"), Tecno Go 3 (Shopify "Tecno Spark GO 3" may be a different model).

### 5. Step 2 — shared signed upload helper (done)
- `src/lib/productMediaUpload.ts` (moved verbatim from MediaManager): `requestProductUploadSignature(client, productId)`, `cloudinaryUploadForm(source, data)` (only file/api_key/signature + signed folder/timestamp/transformation; `source` = File or https URL), `uploadToCloudinary(data, source, { onProgress, createRequest })`, `safeCloudinaryUploadError`. Client and request factory are injected (no import-time env; testable offline).
- `MediaManager.tsx` now calls the helper; its validation, metadata (`is_primary: media.length === 0`, `sort_order: media.length`, filename alt text), binary guard, insert, replace (inherit primary → delete old asset via Edge Function), delete, make-primary, reorder and colour association are unchanged. Source-text assertions in `phase3a.test.mjs` / `bulkCatalog.test.mjs` were retargeted to the helper (same intent). Localhost smoke: Admin + MediaManager + helper load with no console errors; no real upload was run.

### 6. Tests / build (2026-10-09)
- `npm test` **475/475 pass** (442 at `9e793c3` + 7 environment + 19 bulk-image matching/Shopify/payload + 7 upload helper).
- `tsc -b` clean · `npm run lint` 0 errors (only the pre-existing `StorefrontApp.tsx` exhaustive-deps warning) · `build:dev` / `build:prod` OK with the correct single Supabase ref each.

### 7. Exact next step (tomorrow) — Step 3: Bulk Product Images UI (no uploads without approval)
1. New `src/admin/BulkProductImages.tsx` panel at the top of `/admin/media` (keep it out of `BulkImport.tsx` — `bulkCatalog.test.mjs` forbids Cloudinary code there); render from `AdminApp.tsx` `/admin/media`; styles in `admin.css`.
2. Read-only load of products (`id,title,brand,publication_status`) + existing `product_media` (primary flag) under Admin RLS.
3. Two sources: multi-select local images, and Shopify Products CSV/ZIP (ZIP read in-browser with `jszip`, already a dependency).
4. Review table: Image, Filename/Handle, Detected Brand, Detected Model, Matched Product (picker for review/multiple/conflict/unmatched), Status, Primary?, Action; counts (Files, Matched, Needs review, Unmatched, Invalid, Ready to upload) + search/filter.
5. Upload only after an explicit confirm that shows the connected environment (DEVELOPMENT/PRODUCTION); per row: re-read media → `planPrimaryAssignment` → `requestProductUploadSignature` → `uploadToCloudinary` (file or Shopify URL) → `productMediaPayload` → insert (+ `set_product_media_primary` only for explicit make-primary). Result summary: uploaded / products updated / skipped / unmatched / failed + any uploaded-but-unsaved `public_id`s.
6. Verify on localhost against DEV (matching/review only); a single-image DEV upload test only with Owner approval; PROD 82-product batch only with separate Owner approval and after DEV hosting is redeployed with `build:dev`.
- Still pending before publishing PROD products: PTA Status and Condition on all 262 variants (still `unknown`); VgoTel/ZTE brands + V70 FE Activated (see 2026-10-07 §6).

---

## 2026-10-07 — Android PROD catalog import + permanent master-import workflow

### 1. Git / branch / commit state
- Branch `feature/checkout-orders-shipping`, HEAD **`9e793c3` feat: add validated master catalog import workflow**, pushed and in sync with `origin/feature/checkout-orders-shipping` (remote `origin` = GitHub `growthifyedge/isolutions-pakistan-website`). Working tree clean before this handover edit. `master` not updated.
- Previous commits on the branch: `3dde556` navbar/trust ticker, `03e4eb3` checkout coupons, `ae4eaed` admin dashboard, `937b900` production Firebase alias.

### 2. Bulk Import — permanent "Prepare Import Workbook" workflow (in `9e793c3`)
Admin → Bulk Import now starts with **Prepare Import Workbook**:
Upload Master Excel → Detect & Normalize → Review mapping / warnings → Generate Valid Workbook → self-validation with the importer's own parser → Download Ready XLSX / Preview Generated Import → **Apply separately** (Apply is still the first and only database write).
- Rows go through the importer's own `catalogRowFromRecord` + `validateCatalogSheet`; the workbook is written by the Download Template builder (`buildCatalogWorkbook` via `buildCatalogImportWorkbook`); the exact bytes are read back with `readCatalogWorkbook` (`validateGeneratedCatalogWorkbook`). **Download/Preview stay disabled unless that self-validation passes** ("Validated with iSolutions importer"; on failure "Generated workbook failed internal validation" + parser errors).
- Master headers matched by name (case/punctuation-insensitive): required Brand, Model (/Product Title), Price (/Price PKR/PKR Price); Stock (/Stock Qty/Qty/Quantity), Warranty, Category, PTA, Condition, BH, Cycle Count, SIM, Compare-at, Delivery optional. Source Date/Action/Product Type/SKU/Slug ignored and shown as such; unknown columns listed as ignored; two columns for one field = blocking error.
- Blank stock → numeric default (input starts at **10**); explicit valid whole numbers kept (incl. 0); invalid text blocks the row.
- Duplicate v2 variant identities (Brand+title, RAM, Storage, Color, PTA, Condition, Grade, BH, CC — not Warranty/Price/SIM/Stock) block **all** members; including only one member clears it.
- Unknown brand → "Brand does not exist in target catalog: X"; category must exist and match Product Type; blocked rows start unchecked and Generate requires an explicit "Leave the N unchecked rows out" confirmation.
- Models via project `canonicalModel` (A7pro → A7 Pro, V70FE → V70 FE, Note 15pro+ → Note 15 Pro+, Phone 3A lite → Phone 3A Lite …); brand casing from the catalog (Itel → itel). Extended RAM `N+M` → physical `N GB` with a visible Warning (`physicalRamFromExtended`); other forms blocked. (The exact-template Upload Excel reader still flags extended RAM as before.)
- Action strategy: Create New Catalog / Replace Existing Catalog / Auto from target catalog (checked against existing product titles). SKU/Slug always blank (server assigns), PTA/Condition/BH/CC/SIM blank unless supplied, Mobile Phone → Karachi Only, Notes not exported.
- Header shows the reference catalog the build is connected to: DEVELOPMENT / PRODUCTION (from `supabaseEnvironmentLabel`).
- Master files written with namespace-prefixed OOXML (which ExcelJS cannot open — the cause of the earlier "could not be read as an .xlsx workbook" failures) are read via a read-only in-memory compatibility pass (`src/lib/xlsxCompatibility.ts`, `jszip`). The exact-template Upload Excel path is unchanged.
- Files: `src/lib/catalogMasterImport.ts` (new), `src/lib/xlsxCompatibility.ts` (new), `src/admin/PrepareImportWorkbook.tsx` (new), `scripts/catalogMasterImport.test.mjs` (new), `src/lib/catalogWorkbook.ts`, `src/lib/catalogSheet.ts`, `src/admin/BulkImport.tsx`, `src/admin/admin.css`, `package.json` + `package-lock.json` (`jszip ^3.10.2` declared; it was already installed via ExcelJS).

### 3. Test / build status (at `9e793c3`)
- `npm test`: **442 / 442 pass** (428 previous + 14 new). The "6 pre-existing failing tests" note in Section 12 is superseded — baseline before this work was 428/428.
- `tsc -b` clean; `npm run build` OK. Only known warnings: `lottie-web` direct `eval` (pre-existing, third-party), chunk-size (non-blocking), one `react-hooks/exhaustive-deps` lint warning in `StorefrontApp.tsx` (pre-existing).

### 4. Deployment state (proved 2026-10-08 by reading the public sites, read-only)
- **DEV hosting `isolutions-development-cb1ea.web.app`** serves `assets/index-N3NonMR3.js` = the local `dist/` build of `9e793c3` (local `dist/` built 2026-10-07 22:27, `.firebase/hosting.ZGlzdA.cache` written 22:28). Its Admin bundle contains Prepare Import Workbook.
- **⚠ The DEV-hosted build is wired to the PRODUCTION Supabase project (`nlxfwppywxumymbjkvwt`), not DEV (`acwatgxkcyrdxpcljxjb`).** `vite build` uses `.env.production.local` (PROD) by default; `.env.local` (DEV) is only used by `npm run dev`. This is why the workflow showed "Reference catalog: PRODUCTION" and how the PROD import below was run. Anyone using the DEV site's Admin is currently working on **PROD data**. Decide/fix before the next DEV deploy (e.g. `vite build --mode development` with a DEV env file for DEV hosting) — do not assume DEV hosting = DEV database.
- **PROD hosting `isolutions-pakistan-production.web.app`** still serves the older bundle `assets/index-DqKGUZ6X.js` (PROD-wired) **without** Prepare Import Workbook — no evidence of a PROD hosting deploy of `9e793c3`. No explicit PROD deploy command is recorded locally.
- No Supabase migrations were added or applied in this work.

### 5. Final PROD Android import result (Apply completed; verified read-only in PROD on 2026-10-08)
- Owner-reported Apply result: products created **82**, replaced 0; variants created **262**, updated 0, hidden 0; assigned SKUs **MB001–MB262**; products missing images **82**.
- Pre-Apply: workflow review Total 262 · Ready 261 · Warnings 1 · Blocked 0 · Included 262 rows / 82 products; generated workbook Rows 262 · Products 82 · Excluded 0 · File errors 0 · Rows needing review 0 · "Validated with iSolutions importer"; Preview Create 82 · Replace 0 · variants create 262 / update 0 / hide 0 · review 0.
- PROD database now (read-only check): 82 real products, all **draft**, all in **Mobile Phones**; 262 active variants, SKUs MB001–MB262 only, `catalog_sku_mb_seq` last_value 262 (next MB263, MB999 ceiling); stock 10 on every variant; delivery `karachi_only` on all; PTA `unknown` and Condition `unknown` on all 262 (not supplied — not fabricated); warranty "1 Year" ×261, "Official Warranty" ×1; **0 product_media rows**; 0 orders.
- Batch rules used: Action Create, Product Type Mobile Phone, Category Mobile Phones, Karachi Only, Stock 10, SKU blank (server-assigned), PTA/Condition/SIM blank, warranty from master.

### 6. Excluded / deferred Android records (NOT in PROD yet — do not forget)
- **VgoTel** (4 products / 8 rows: Onyx, New 16 Pro, New 17, Smart 9 Pro) and **ZTE** (4 products / 8 rows: A36, A56, V80 Max, V80 Pro) — brands missing from PROD (active PROD brands: Apple, Google, Honor, Infinix, itel, Motorola, Nothing, OnePlus, Oppo, Realme, Samsung, Tecno, Vivo, Xiaomi; DEV has them as `Vgotel` and `ZTE`). Import later, after the Owner adds the brands in PROD. ZTE A36 RAM correction: 4+8GB → **4 GB**.
- **Vivo V70 FE 8/256 Silver Rs 110,000 "Activated" (activation date 25-Apr-2026)** — same v2 identity as the normal 8/256 Silver when PTA/Condition are blank; create later as a separate/special Admin product (Owner decides title and facts; DEV precedent "Vivo V70 FE 8/256 Silver Activated").
- Imported normal V70 FE (product "Vivo V70 FE"): 8/256 Silver Rs 119,500 (MB259), 12/256 Blue Rs 137,000 (MB260), 12/256 Silver Rs 137,000 (MB261).
- Realme Note 60x physical RAM used: 3+5GB → **3 GB**, 4+4GB → **4 GB**.
- The original master `iSolutions_Android_Catalog_2026-09-14_final_v2.xlsx` and the PROD template were no longer in Downloads on 2026-10-07; a snapshot of the 279 master rows exists only in git-ignored `scratch/android-prod-upload/master-snapshot-279.json`. Tablets (5), keypad phones (22) and the held Tecno Spark 50 Pro row from that master were never part of this batch.

### 7. Current catalog state
- **PROD:** 82 draft Android Mobile Phone products / 262 variants, no images, PTA/Condition unresolved → nothing publishable yet.
- **DEV:** still holds its earlier test/working catalog (≈116 products incl. the earlier Android list, Vivo V70 FE Activated/Non-Active test products) — keep it; no cleanup until the Owner starts that phase.

### 8. Exact next task — Bulk Product Images
Goal: a reusable Admin **bulk image assignment** workflow (not 82 manual one-by-one uploads).
- Owner uploads many images / a folder / a ZIP; filenames identify Brand + Model (e.g. `Samsung-A07.jpg`, `Samsung-A17.jpg`, `Vivo-V70-FE.jpg`, `Nothing-Phone-3A-Pro.jpg`).
- Match to existing products (reuse the importer's normalization: brand casing, `canonicalModel`, `catalogSlug`); statuses **Matched / Unmatched / Multiple matches – Review**; never auto-assign ambiguous matches; Owner reviews before upload.
- Bulk upload to Cloudinary through the existing signed Edge Function path, then assign as **primary** product image; start with one primary image per product; colour/variant-specific images later.
- **Before writing code, inspect:** `src/admin/MediaManager.tsx`, `src/admin/MediaLibrary.tsx`, `src/lib/cloudinary.ts`, the signed-upload Supabase Edge Function(s), `product_media` schema + primary-image rules/constraints (Phase 3B migrations, `202609100001_product_media_color_assignments.sql`), `validate_product_for_publication`, and any existing bulk-media code. Cloudinary secrets stay in Edge Function secrets only; no binaries in Postgres/Git/Hosting.
- Resolve the DEV-hosting-points-at-PROD issue (Section 4 above) before any further DEV deploy.
- Publishing will additionally need PTA Status and Condition set on every active variant (currently `unknown`) — images alone will not make these products publishable.

### 8b. Bulk Product Images — DEV bulk uploader (implemented 2026-10-10, UNCOMMITTED, bulk run NOT yet performed)
- **Verified earlier:** the one-product DEV upload test passed end-to-end for **Motorola Moto Edge Fusion** (Cloudinary upload, 2 `product_media` rows = 1 Primary + 1 gallery, sort_order, URLs, read-back, no duplicates). That product now has **2 DEV media rows** and is an existing-media product (default mode "Skip", excluded from Select all eligible, blocked if included).
- **Replaced:** the temporary one-product test (`devImageUploadTest.ts`, its panel and test file) is gone. New: `src/lib/devBulkImageUpload.ts` (guard, plan, runner, verification) + `scripts/devBulkImageUpload.test.mjs`. The disabled "Apply Selected Images" button is removed; there is NO production upload option.
- **Owner flow:** Load Shopify ZIP/CSV → review/resolve (Confirm Match, Use This Source Set, Choose Product) → add local images in Missing Images → **Select all eligible** (or Deselect all / Keep only this set) → check Selection Summary → **Upload Selected Images to DEV** → confirm dialog → progress → result. Review controls are locked (`<fieldset disabled>`) during a run; a latch prevents double submit.
- **Eligibility:** DEV Supabase `acwatgxkcyrdxpcljxjb` exactly (PROD/unknown/lookalike blocked, re-checked inside the runner per product); ≥1 included set; each included set Matched/Confirmed with one confirmed product, no unresolved Review/Multiple/Conflict/Invalid, ≥1 valid selected image with a valid source, one Primary unless the product already has one; existing-primary products need an explicit "Add images" or "Add and make primary". One concise blocking reason is shown.
- **Execution:** product by product. Before each product: environment re-check and a fresh `product_media` read; if count/primary differ from the review → blocked with "Media changed since review — re-review required" and nothing is written. Per image: signature → Cloudinary (Shopify https URL or File) → payload validation → `product_media` insert (`variant_id` null). "Add and make primary" inserts as gallery, then calls the existing `set_product_media_primary` RPC (old primary stays as gallery). Never deletes/replaces media, never publishes, no price/variant/inventory writes.
- **Failures:** a failing product stops only itself (Failed if nothing saved, Partial if some rows saved or an orphan exists); the batch continues. Orphaned Cloudinary `public_id`s are listed and never auto-deleted. Final summary: attempted/verified/failed/partial/saved-not-verified/blocked, images uploaded/failed, orphans. "DEV upload verified" only if every product verified.
- **Verification per product:** row count = before + inserted; existing rows kept; inserted rows exist; exactly one primary (new Primary, or the old one for Add Images); sort_order; https secure_url; no duplicate ids/public_ids; old primary demoted-not-deleted for make-primary. Status Verified only after read-back passes.
- **After a run:** verified sets are un-included and the DEV catalog is re-read, so freshly uploaded products are recognised as existing-media.
- **Validation:** `npm test` 509/509, `tsc -b` clean, lint 0 errors (1 pre-existing StorefrontApp warning), `build:dev` (only DEV ref) and `build:prod` (only PROD ref) OK; `dist/` holds the DEV build. Localhost: module loads, no new code errors; Admin needs a login so the signed-in UI was not exercised by Claude.
- **Limitations:** no automatic duplicate merging; a changed product is blocked, not auto-reconciled; orphaned assets need manual cleanup; PROD upload is intentionally not built.
- **Next Owner action:** on localhost sign in → Admin → Media → Bulk Product Images, load the ZIP, resolve what you want, Select all eligible, read the Selection Summary and "Ready: N images for M products", click Upload Selected Images to DEV and send me the result. No commit/push/deploy yet.

### 9. Safety / business rules needed tomorrow
- Mobile Phone SKU prefix **MB**; SKUs assigned server-side only, immutable, never reused (per-prefix sequences, max 999).
- One Products row = one variant; product identity = Brand + title (case-insensitive); Replace Existing hides (never deletes) active variants absent from the file.
- Server import limits: 500 products / 5,000 variants per import. New products import as **draft**; images not required for import.
- Publication requires an active real category, active variant(s) with price > 0, delivery scope, PTA ≠ unknown, Condition ≠ unknown, a warranty, and a valid primary Cloudinary image.
- Mobile Phones are Karachi Only; Android (non-Apple) phones default to "1 Year" warranty unless an explicit warranty is supplied (explicit values such as "Official Warranty" are never overwritten).
- Never fabricate PTA / Condition / SIM. Read-only PROD checks: `npx supabase db query --linked --project-ref nlxfwppywxumymbjkvwt -f <file>.sql` with `begin transaction read only; … rollback;` (local link stays on DEV). No DEV/PROD writes, imports, migrations, deploys, commits or pushes without explicit Owner approval.

---

> **Note on how this project gets shipped:** Git commit state and database/hosting deployment state are independent. This project's workflow applies Supabase migrations by pasting them into the live Supabase SQL Editor, and deploys Firebase Hosting via the Firebase CLI — both can happen without a Git commit existing for the change. Do not infer live deployment/migration status from `git log`/`git status` alone; verify the live systems directly (see Section 3).

---

## 1. Project Overview

- **Brand:** iSolutions Pakistan
- **Type:** Ecommerce storefront + Admin Studio
- **Stack:** React + Vite + TypeScript, Supabase (Postgres/Auth/RLS/Edge Functions), Cloudinary (media), Firebase Hosting (development environment deployment target)
- This is an established, in-progress production-style project. Do not rebuild, restart, or broadly refactor — continue from current state.

## 2. Important Paths / URLs

- Project root: `E:\iSolutions Pakistan-Website`
- Local dev: `npm run dev` → `http://localhost:5173`
- Storefront checkout: `http://localhost:5173/checkout`
- Order success: `http://localhost:5173/order-success`
- Admin: `http://localhost:5173/admin`
- Admin Orders: `http://localhost:5173/admin/orders`
- Firebase development URL: `https://isolutions-development-cb1ea.web.app` (Firebase project `isolutions-development-cb1ea`) — last deployed with the delivery-fee frontend (see Section 3).
- Admin Bulk Import: `http://localhost:5173/admin/bulk-import` (Bulk Upload v2 staging, see Section 16)
- Supabase project ref: `acwatgxkcyrdxpcljxjb`

## 3. Current Deployment State

**Checkout status: FINAL / VERIFIED / LOCKED** (Checkout, Orders, Shipping Methods, delivery fees).

- **Supabase migration `202609230001_checkout_standard_delivery_fee.sql` is APPLIED to the live database** (applied manually via the SQL Editor). Verified live, independent of Git:
  - Read-only RPC probe with an empty customer name → `HTTP 400 customer_name_required` (11-arg function present, normal validation).
  - Brandless orderability probe (no insert — valid customer fields + deliberately invalid city, so every item is validated and the city check fails before any `INSERT`): brandless "Clear Mobile Case" → `delivery_city_invalid` (passed orderability), branded Apple charger control → `delivery_city_invalid`, nonexistent variant → `variant_not_orderable`. Only `202609230001` restores the optional-brand LEFT JOIN, so this confirms it is live.
  - Real test order **ISP-ORD-000003** (see Section 13) stored `delivery_fee_minor = 20000`, `shipping_surcharge_minor = 0`, `total_minor = 719900`.
- **Firebase development hosting was redeployed with the delivery-fee frontend** (build of commit `2e42146`, bundle `index-Dq8R6hFB.js`) and verified on the hosted site: Rs 9,999 Standard Rs 200 / Fast Rs 400, Rs 10,000 Standard FREE / Fast Rs 200, no "To be confirmed" text anywhere in the served bundle.
- **The Bulk Upload v2 commits (`2ec8f00`, `32a34cd`, `d8a7859`) are NOT deployed.** They only change Admin Bulk Import; the storefront bundle is unaffected. Deploy only when explicitly asked.
- Git: all work is committed locally on branch `feature/checkout-orders-shipping` — checkout/orders/shipping (`ce92dd9`, `15c8e17`, `4534fa8`, `6aec780`, `2e42146`) and Bulk Upload v2 (`2ec8f00`, `32a34cd`, `d8a7859`, plus the handoff update commit). `master` is untouched at `885059e`. **No Git remote is configured**, so nothing has been pushed. *(Superseded 2026-10-07: remote `origin` now exists and the branch is pushed up to `9e793c3` — see the top section.)*
- Earlier history: `202609220003_checkout_shipping_methods.sql` (Standard/Fast shipping methods, 11-arg RPC) was applied live earlier and the Firebase dev site was redeployed with that build (user-confirmed "Deployed all good"). Its original below-threshold fee handling is superseded by `202609230001`.

## 4. Locked Business Rules

**Delivery eligibility (do not change):**
- Mobile phones: Karachi only
- Gadgets/accessories: nationwide Pakistan
- Mixed cart containing any Karachi-only mobile: entire order becomes Karachi-only (no split shipments, no "Other city" option)

**Shipping and delivery fees (FINAL / VERIFIED / LOCKED):**
- Two methods: Standard Delivery, Fast Delivery. Fees are based on the merchandise subtotal before shipping.

  | Subtotal | Standard Delivery | Fast Delivery |
  |---|---|---|
  | Below Rs 10,000 | Rs 200 | Rs 400 total (Rs 200 base + Rs 200 Fast surcharge) |
  | Rs 10,000 or above | FREE | Rs 200 (Rs 0 base + Rs 200 Fast surcharge) |

- Minor units (paisa): Rs 10,000 = 1,000,000; Rs 200 = 20,000; Rs 400 = 40,000
- `delivery_fee_minor` is the final fee (base + surcharge) and is always known for new orders; `shipping_surcharge_minor` is 20,000 for Fast and 0 for Standard (already included in `delivery_fee_minor`)
- Shipping method selection never changes geographic eligibility — Fast Delivery cannot bypass the Karachi-only rule
- Constants live in `src/lib/orders.ts` (`FREE_STANDARD_DELIVERY_THRESHOLD_MINOR`, `STANDARD_DELIVERY_FEE_MINOR`, `FAST_DELIVERY_SURCHARGE_MINOR`, display helper `calculateDeliveryFeeMinor()`) and are mirrored as literals inside the SQL RPC — client-submitted fees/totals are never trusted; the server recalculates everything from authoritative catalog prices

**Payments:**
- Active: Cash on Delivery, Bank Transfer
- Coming Soon (disabled tiles): Credit/Debit Card, Installments

## 5. Checkout State — FINAL / VERIFIED / LOCKED

File: `src/StorefrontApp.tsx` (`CheckoutPage`, `OrderSuccessPage`)

- 3-step sticky progress indicator: Customer Details → Delivery Details → Payment Method (IntersectionObserver-driven active step)
- Customer Details: Full Name, WhatsApp/Phone, optional Email
- Delivery Details: City (locked to Karachi and hidden dropdown when cart requires it; otherwise Karachi / Other city in Pakistan), conditional "City Name" field when Other city is selected, Area/Landmark, Full Delivery Address, Order Notes
- Delivery eligibility notice (karachi / mixed / nationwide messaging) — unchanged, locked
- **"Delivery Method" section** (between the eligibility notice and Payment Method) — two selectable cards:
  - Standard Delivery: "FREE" (green badge) at/above Rs 10,000; "Rs 200" (coral badge) below it, with "Free on orders Rs 10,000 or above."
  - Fast Delivery ("Priority" label): "Rs 400" below Rs 10,000 with "Rs 200 delivery + Rs 200 Fast surcharge."; "Rs 200" at/above Rs 10,000 with "Priority delivery for an additional Rs 200."
  - A threshold hint line above the cards: "Add Rs X more to unlock FREE Standard Delivery." / "You've unlocked FREE Standard Delivery." once qualified
  - Default selection: Standard Delivery (never defaults to paid Fast)
- Payment Method: Cash on Delivery / Bank Transfer selectable tiles; Credit/Debit Card and Installments shown disabled as "Coming soon"
- Order Summary (right rail): Subtotal, Delivery Method, Delivery (always a known final fee: FREE / Rs 200 / Rs 400), and Total (subtotal + delivery). Helper line: "Your delivery fee is confirmed above."
- Place Order → calls `createStorefrontOrder()` (`src/lib/orders.ts`) → Supabase RPC `create_storefront_order` → on success, confirmation is saved to `sessionStorage`, cart is cleared (`clearStorefrontCart()`), redirect to `/order-success`
- `/order-success`: reads the saved confirmation (privacy-scoped — only available immediately after checkout), shows Order number, Payment method, Subtotal, Delivery Method, the server-calculated final Delivery fee (FREE / Rs X), Total, and (if Fast was selected) a "Fast Delivery selected (includes Rs 200 priority surcharge)" note

## 6. Order Backend

Tables (from `202609200001_checkout_orders_phase_1.sql`, extended by `202609220003_checkout_shipping_methods.sql`; RPC finalized by `202609230001_checkout_standard_delivery_fee.sql` — all **applied and live**):
- `public.orders` — customer/delivery/payment fields, `subtotal_minor`, `delivery_fee_minor` (final fee = base + surcharge; always set for new orders, NULL only on legacy orders created before `202609230001`), `total_minor`, `status`, `shipping_method` (`standard`/`fast`, check-constrained) and `shipping_surcharge_minor` (bigint, default 0)
- `public.order_items` — immutable per-line snapshots (title, SKU, variant attributes, price, delivery scope, image) captured at order time, independent of later catalog changes
- `public.storefront_order_number_seq` → order numbers formatted `ISP-ORD-000001` style

RPC: `public.create_storefront_order(...)`
- `SECURITY DEFINER`, `set search_path = ''`, all references fully qualified
- Validates: customer fields, email format, payment method, shipping method, item array shape/limits/duplicates
- Resolves authoritative price/delivery-scope/publication/stock per variant server-side — client only sends `variant_id` + `quantity`
- Optional brand: `LEFT JOIN brands` + `(brand_id IS NULL OR brand valid)` — restored by `202609230001` after `202609220003` had accidentally reverted it to an inner join
- Enforces Karachi-only / nationwide / mixed classification from real delivery scopes, not client claims
- Computes the final delivery fee server-side per the rules in Section 4 (base Rs 200 below Rs 10,000 / Rs 0 at or above, plus Rs 200 for Fast) — client cannot submit a fee or total
- Inserts `orders` + `order_items` atomically, returns safe confirmation data (no general table access)
- `anon`/`authenticated` only have `EXECUTE` on the RPC; direct `INSERT`/`UPDATE`/`DELETE`/general `SELECT` on `orders`/`order_items` is revoked. Admin (`is_catalog_admin()`) has `SELECT` on both and `UPDATE` on `orders` (status only, via RLS policy, not column-restricted at the DB level but the Admin UI only ever writes `status`)

## 7. Brand Rule (Locked)

- `brand_id` may be `NULL` — brandless published products are fully supported in both Admin and the public catalog
- If a brand **is** assigned, it must exist, have `data_class = 'real'`, and `is_active = true` for the product to be orderable
- Orderability check uses `LEFT JOIN brands` + `(brand_id IS NULL OR brand valid)` — do not reintroduce a mandatory-brand `INNER JOIN` or NOT NULL constraint

## 8. Admin Orders

File: `src/admin/AdminOrders.tsx`, route `/admin/orders`, security via existing Admin auth + `is_catalog_admin()` + RLS (no service-role key in browser).

Current features:
- Orders list, newest first; search by order #/customer/phone; filters for status/payment/city with clear-filters; loading/empty/filtered-empty/error+retry states
- Order detail panel: Customer, Delivery (Destination, Classification, Shipping Method, Address, Area/Landmark, Notes), Order items (snapshot-based, never live product data), Totals (Subtotal, Delivery Method, Delivery Fee — the stored final fee: FREE / Rs X; legacy orders with no stored fee show "Not recorded (legacy order)" — and Total)
- No manual delivery-fee editing (by design)
- Status update dropdown (`new → confirmed → processing → completed → cancelled`), persists via Supabase update, confirmed to survive a page refresh
- **Admin Order Detail header layout was fixed this project and must not be reverted.** Root cause history: the header previously broke because CSS Grid tracks with `fr` units hit a Chromium subpixel/zoom text-wrap bug, and separately because a **global, unscoped `header { ... }` selector in `src/styles.css`** (the storefront's own sticky-nav CSS) was leaking into `.order-detail > header` since the admin rule didn't explicitly override every property the global rule set. The fix in `src/admin/admin.css` (`.order-detail > header` block) now explicitly resets `display`, `height`, `grid-template-columns`, `padding`, `justify-content`, `align-items`, `box-shadow`, `z-index`, `background` so nothing from the global header rule can leak through again. **Do not remove these explicit resets, and do not reintroduce a grid/flex layout for this header without keeping full property resets.**

## 9. Migrations

Applied to live Supabase (do not edit retroactively):
- `202609200001_checkout_orders_phase_1.sql` — creates `orders`/`order_items`, order number sequence, original `create_storefront_order` RPC
- `202609220001_checkout_optional_brand_fix.sql` — fixes brandless-product orderability (`LEFT JOIN brands`)
- `202609220002_admin_order_status_workflow.sql` — adds `confirmed`/`processing`/`completed`/`cancelled` statuses
- `202609220003_checkout_shipping_methods.sql` — adds `shipping_method`/`shipping_surcharge_minor` columns + constraints, replaces `create_storefront_order` with the 11-arg version that accepts `p_shipping_method`. (It unintentionally reverted the brand join to an inner join — fixed by the next migration.)
- `202609230001_checkout_standard_delivery_fee.sql` — **applied via the Supabase SQL Editor and verified live (see Section 3).** `create or replace` of the same 11-arg `create_storefront_order` (signature, `SECURITY DEFINER`, `search_path = ''`, grants unchanged): sets the Rs 200 base delivery fee below Rs 10,000 so `delivery_fee_minor` is always known for new orders (Section 4), and restores the optional-brand `LEFT JOIN` so brandless published products remain orderable. Also updates the `delivery_fee_minor`/`shipping_surcharge_minor` column comments.

**Rule for all future changes:** never edit an applied migration file. Always create a new migration with the next sequential timestamp prefix. Note that this project applies migrations via the Supabase SQL Editor, not necessarily `supabase db push` — a migration file being untracked/uncommitted in Git does not mean it hasn't been applied live; verify with a read-only check (e.g. probe the RPC/table via the REST API) rather than assuming from Git state.

## 10. Important Files

- `src/StorefrontApp.tsx` — storefront routes including `CheckoutPage`, `OrderSuccessPage`
- `src/styles.css` — global storefront CSS (also loaded on `/admin` routes via `src/main.tsx` — see the header-leak note in Section 8 before adding any new bare-tag selectors here)
- `src/lib/cart.ts` — client cart (localStorage key `isolutions-storefront-cart`)
- `src/lib/orders.ts` — `createStorefrontOrder()`, shipping/order confirmation types, delivery-fee constants and `calculateDeliveryFeeMinor()` display helper
- `src/lib/storefrontContact.ts` — centralized WhatsApp contact config (locked design)
- `src/admin/AdminOrders.tsx` — Admin Orders list/detail
- `src/admin/AdminApp.tsx` — Admin shell/routing/auth wrapper
- `src/admin/admin.css` — Admin-only styles
- `supabase/migrations/202609200001_checkout_orders_phase_1.sql`
- `supabase/migrations/202609220001_checkout_optional_brand_fix.sql`
- `supabase/migrations/202609220002_admin_order_status_workflow.sql`
- `supabase/migrations/202609220003_checkout_shipping_methods.sql`
- `supabase/migrations/202609230001_checkout_standard_delivery_fee.sql` (applied and live; current `create_storefront_order` definition)
- `src/lib/catalogSheet.ts` — Bulk Upload v2 `CatalogSheetRow` contract, `normalizeStockLines()`, staging profiles (Section 16)
- `src/lib/catalogWorkbook.ts` — Bulk Upload v2 Excel writer/reader, validation, category mapping, bridge into the Bulk Import preview (Section 16)
- `src/admin/BulkImport.tsx` — Admin Bulk Import screen (legacy import + v2 Excel staging block)
- `src/lib/bulkCatalog.ts` — legacy bulk parser/preview helpers (still used by the legacy import path)

## 11. Locked / Do Not Touch Without Explicit Instruction

- Header/navigation (desktop sticky header, mobile compact header)
- Search drawer
- Wishlist drawer
- Cart drawer
- WhatsApp floating button (`src/lib/storefrontContact.ts` is the single source of truth)
- Homepage locked sections (legacy tech block and old laptop promo stay removed; Home About section stays restored)
- Footer
- Checkout, Orders, Shipping Methods and delivery-fee rules (Sections 4–8) — FINAL / VERIFIED / LOCKED
- Checkout visual system / design language (`.checkout-card`, `.checkout-payment-tile`, `.checkout-shipping-*`, `.checkout-summary*` in `src/styles.css`)
- Admin Order Detail header CSS fix (Section 8) — do not revert to a grid/flex layout without full property resets
- All applied migrations (Section 9)

## 12. Known Non-Blocking Warnings

- `react-hooks/exhaustive-deps` warning in `src/StorefrontApp.tsx` (~line 2924 at last check) for a `useEffect` missing `collection.*` dependencies — pre-existing, not introduced by recent work
- `lottie-web` direct-`eval` warnings during `vite build` (from the `lottie-web` package itself, not project code)
- "Some chunks are larger than 500 kB after minification" build warning (pre-existing, not addressed — would need code-splitting if ever tackled). `exceljs.min` (~930 kB) is its own lazily loaded Admin-only chunk.
- *(Superseded 2026-10-07: the full suite is 442/442 passing at `9e793c3`.)* `npm test`: **6 pre-existing failing tests** (source-text assertions that drifted from earlier committed code, e.g. they expect `persistChangedVariantPrices` but the code is `persistChangedVariantPricing`): `batchDefaultsReadiness` "inventory default 10 does not regress"; `bulkInventoryAutomation` "new variant with omitted inventory…" and "Bulk Preview renders default…"; `phase4` "storefront does not import the fictional mock catalog", "variants remain explicit rows…", "variant create, save, reload…". They fail identically on a clean checkout without the Bulk Upload v2 work. Not fixed yet — review each (stale vs real regression) before changing.
- `npm audit`: moderate `uuid` advisory (GHSA-w5hq-g745-h8pq) via `exceljs` 4.4.0. It affects uuid v3/v5/v6 with a buffer argument; ExcelJS only calls `uuid` v4 without a buffer, so it is not reachable. Do not run `npm audit fix` (it downgrades ExcelJS to 3.4.0).

## 13. Latest Validation

- `npm run lint` → pass, only the pre-existing warning above
- `npm run build` (`tsc -b && vite build`) → pass, only pre-existing lottie-web/chunk-size warnings
- UI verification directly against `http://localhost:5173/checkout` (no static repros):
  - Rs 9,999 + Standard → Delivery Rs 200, Total Rs 10,199
  - Rs 9,999 + Fast → Delivery Rs 400, Total Rs 10,399
  - Rs 10,000 + Standard → FREE, Total Rs 10,000
  - Rs 10,000 + Fast → Delivery Rs 200, Total Rs 10,200
  - Accessory-only cart → nationwide notice, both city options; mobile-only cart (+ Fast) → Karachi-locked, no Other city; mixed cart → Karachi-only mixed notice
- Supabase migration `202609230001` → **APPLIED** via SQL Editor and verified live (read-only RPC probe + brandless orderability probe, see Section 3)
- **Latest real verified order: ISP-ORD-000003** (live Supabase, placed via the real checkout)
  - 1 × Apple 20W USB-C Charger, Karachi, Standard Delivery, Cash on Delivery
  - Subtotal Rs 6,999 (authoritative DB price) · Delivery Rs 200 (`delivery_fee_minor = 20000`, `shipping_surcharge_minor = 0`) · Total Rs 7,199 (`total_minor = 719900`)
  - Checkout, Order Success and Admin Orders all showed the same stored values
  - Order status set to **Cancelled** in Admin Orders; persistence after refresh verified
- Brandless check: published brandless "Clear Mobile Case" passes server-side orderability (no order created)
- Firebase development hosting → redeployed with the delivery-fee frontend and verified on the hosted site (Section 3)

## 14. Currently NOT Implemented / Future Only

- Inventory deduction/reservation on order
- Courier/shipping API integration
- Payment gateway (Credit/Debit Card, Installments)
- Bank transfer receipt/proof verification
- Automated email/SMS/WhatsApp notifications
- Invoices
- Returns/refunds
- Customer accounts
- Internal admin notes on orders
- Manual admin delivery-fee editing

## 15. Instructions for the Next Session

- Read this file (`CLAUDE_HANDOFF.md`) first, before exploring the codebase.
- Checkout, Orders, Shipping Methods and delivery fees (Sections 4–8) are FINAL / VERIFIED / LOCKED and deployed — do not redo them or re-apply their migrations.
- Current active work stream is **Bulk Upload v2** — see Section 16 for the state, locked rules and the exact next steps.
- Inspect current code before editing — do not guess.
- Do not rebuild, restart, or broadly refactor the existing architecture.
- Do not redo work that's already complete (see Sections 4–10 for what's done).
- Validate UI changes against the real running app (`http://localhost:5173` and `/admin/orders`), not static HTML repro pages.
- Do not deploy to Firebase unless explicitly asked.
- Do not edit applied migrations — always add a new one.
- Do not assume Git history reflects live deployment/migration state on this project — verify live systems directly (read-only) before concluding something is or isn't live.
- Keep changes minimal and targeted to the specific request; don't touch the locked areas in Section 11 without explicit instruction.
- Run `npm run lint` and `npm run build` after any meaningful code change.

## 16. Bulk Upload v2 (Admin Bulk Import) — state as of 2026-09-24 (historical)

> *Superseded 2026-10-07:* categories were finalized (Mobile Phones / Accessories / Gadgets > Laptops, Tablets), Phase 2 shipped (`apply_catalog_bulk_import_v2`, server-assigned MB/AC/GD/MC/IP SKUs, used-phone facts, SIM Configuration, Replace Existing hide/reactivate), Excel Apply is enabled, the Prepare Import Workbook flow was added, and the first PROD Android import is done. The SKU format below (`APPLE-IPHONE-…`) and the "Next steps" list are obsolete. See the top section for current state.

### Locked workflow
Rough Data → Normalize → Generate fixed Excel → Owner review/edit → Upload Excel → Preview → Create / Replace Existing → Import → Upload Images → Publish

### Completed (committed locally, not deployed, no DB changes)
- **Phase 1A — stock normalizer** (`2ec8f00`): `src/lib/catalogSheet.ts`
  - `CatalogSheetRow` contract + per-field status (`explicit` / `inferred` / `default` / `blank` / `needs_review`) + row review reasons
  - `normalizeStockLines(text, { brands })` parses lines like `Samsung A16 6/128 Black; 42500` and `iPhone 15 Pro 256 Natural; 265000; Used; Non-PTA; BH 89%; Cycles 312` (also `@` separator, `Qty/Stock N`, `PTA Approved`, `Non-PTA`, `Brand New`/`Box Pack`, `Used`, `BH 89`/`BH 89%`, `Cycle`/`Cycles`, comma / `Rs` / `k` prices, brand heading lines)
  - Model excludes brand; Product Title = Brand + Model; slug/SKU deterministic and case-insensitive; **canonical model casing** (iPhone, iPad, Galaxy, Redmi, Poco, Pixel, SE/FE/XL, 4G/5G, upper-cased codes like A16/S25/X7)
  - Brands only from the supplied active-brand list (+ model families Galaxy→Samsung, Redmi/Poco→Xiaomi, iPhone/iPad/MacBook/AirPods→Apple, Pixel→Google, only if that brand is active). Unknown brand → Needs Review. Never creates brands.
  - **Stock default = 10**; explicit Qty/Stock overrides
  - **Used phones:** Condition base = `used`, Condition Grade = `A++`, optional Battery Health (1–100), optional Cycle Count (≥0), PTA Approved / Non-PTA. Blank BH/CC stay blank. No JV field.
  - Generated SKU includes PTA/condition/BH/CC tokens, e.g. `APPLE-IPHONE-15-PRO-256-NATURAL-NONPTA-USED-BH89-C312`
- **Phase 1B — Excel staging** (`32a34cd`): `src/lib/catalogWorkbook.ts`, `exceljs` 4.4.0 (dynamic import, separate chunk)
  - Workbook sheets: **Products** (fixed 20 columns: Action, Product Type, Brand, Model / Product Title, RAM, Storage, Color, PTA Status, Condition, Battery Health, Cycle Count, Warranty, Delivery Scope, Price, Compare-at Price, Stock, SKU, Category, Slug, Notes), **Specifications** (Product Key = slug, Section, Specification Name, Specification Value), hidden **Lists** (DB brands/categories + fixed dropdown lists + template marker `isolutions-catalog-v1`)
  - Text-formatted RAM/Storage/SKU/Slug, numeric PKR prices, frozen header, autofilter, dropdown validation, colour flags (red review / yellow inferred / orange required-blank)
  - Reader: header matching case-insensitive; missing sheet/column or wrong template = blocking error; blank Stock → 10; unknown dropdown values / unknown brand or category → Needs Review; duplicate SKU (case-insensitive) and duplicate variant (incl. PTA/condition/BH/CC) → Needs Review; spec rows must reference a Products slug
  - Admin UI (`/admin/bulk-import`, top block "Bulk Upload v2 · Excel staging"): raw stock textarea, **Normalize & Preview**, **Generate Excel**, **Download Blank Template**, **Upload Excel**; feeds the existing preview with **CREATE / REPLACE EXISTING / NEEDS REVIEW** product statuses
  - **Excel/raw staging is preview only — Apply is disabled for staging data until Phase 2.** The legacy structured/CSV import path is unchanged.
- **Staging validation + profiles** (`d8a7859`)
  - Staging profile dropdown: **None / Mixed Stock** (default) and **Android Box Pack / PTA Approved** (fills blanks only: Product Type Mobile Phone, Condition Brand New, PTA Approved, Delivery Karachi Only; explicit row values always win; Stock stays 10 unless Qty given). Applies to the raw-stock path (and is written into generated Excel), not to uploaded Excel.
  - Staging preview requires only SKU, Price, Stock (`catalogStagingMissingFacts`). **Blank Warranty / PTA / Condition / BH / CC do not block staging.**
  - **Mobile Phone delivery auto-resolves to Karachi Only**; Mobile Phone + Nationwide → Needs Review.
  - **Category mapping uses existing active DB categories only** (`categoriesForProductType` in `catalogWorkbook.ts`); exactly one match required, otherwise Needs Review. **No automatic category or brand creation.**
- Tests: `scripts/stockNormalizer.test.mjs` (15) + `scripts/catalogWorkbook.test.mjs` (17) = **32/32 pass**. Run: `node --test scripts/stockNormalizer.test.mjs scripts/catalogWorkbook.test.mjs`
- **Not yet browser-tested on the real Admin page** (needs an Owner admin sign-in). ExcelJS itself was verified in the browser (dev server + production build chunk).

### LOCKED FINAL CATEGORY DESIGN (first task next session — not done yet)
- Main categories: **Mobile Phones**, **Accessories**, **Gadgets**
- Product Types: **Mobile Phone, Accessory, Gadget, Tablet, Laptop**
- Intended mapping: Mobile Phone → Mobile Phones · Accessory → Accessories · Gadget → Gadgets · iPad / Tablet → Gadgets · MacBook / Laptop → Gadgets
- **The live database does not match yet.** Active real categories seen via the public API on 2026-09-24: `Accessories`, `Laptops`, `Mobile Accessories`, `Smartphones` (no "Mobile Phones" or "Gadgets" category; "Accessories" vs "Mobile Accessories" is ambiguous). Admin may see additional inactive/development categories.
- Code impact when resolved: update `PRODUCT_TYPE_CATEGORY_NAMES` in `src/lib/catalogWorkbook.ts` (Tablet/Laptop → Gadgets), add `Laptop` to `CatalogProductType` / `CATALOG_LISTS.productType`, and update tests. Category changes are a DB change (new migration or Owner-approved data change) and may affect storefront collections, filters and delivery-scope defaults — inspect `src/lib/collections.ts` and storefront category usage first. **Do not change categories without an explicit Owner decision.**

### Locked rules for Phase 2 (not implemented yet)
- **Replace Existing:** the latest imported variant set is final truth for that product; missing old variants become **inactive (`is_active = false`), never hard-deleted**; matching must include inactive variants so re-imported ones are reactivated; preserve product specs, media, SEO/content and historical order integrity (`order_items.variant_id` is `on delete restrict`; public reads, `search_public_catalog` and checkout already ignore inactive variants). Products not in the file are untouched.
- **Specs:** product/model level, saved once per model, reused on later stock refresh; normal Replace Existing must not overwrite specs; new models will later need specification enrichment.
- **Media:** manual image upload after import; existing media preserved; importer never deletes media.
- **Blank optional values** stay blank and never erase existing optional values unless an explicit clear action exists; only the locked Stock = 10 default may be applied.
- New products are created as drafts; publish only after validation (primary image required).

### Next steps (in order)
1. Finalize the category structure/mapping above (Owner decision + DB change + mapping code/tests).
2. Browser-test the current Phase 1B staging page with an Owner admin sign-in (both profile examples, Generate Excel → edit → Upload → preview statuses, incl. REPLACE EXISTING for an existing product).
3. Then design/implement Phase 2:
   - DB support for Condition Grade (A++), Battery Health, Cycle Count on `product_variants` (+ variant uniqueness key including them) — new migration
   - New `apply_catalog_bulk_import_v2` RPC with Create / Replace Existing (keep the current RPC for rollback)
   - Safely deactivate missing variants (no hard delete); reactivate re-imported ones
   - Enable actual Excel Apply/import in the UI
   - Decide how blank PTA / Condition / Warranty are handled at import vs publish (the current RPC requires them)
