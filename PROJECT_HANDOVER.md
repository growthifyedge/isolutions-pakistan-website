# iSolutions Pakistan Website — Project Handover

**Prepared:** 2026-10-19 · **Fully updated 2026-10-26** · **Updated 2026-10-29** (Smart Paste rollout, PROD tablet/MacBook uploads) · **Updated 2026-10-30** (tablet/MacBook specifications CLOSED, Admin Catalog Bulk Publish `704dc83` live DEV + PROD and CLOSED, 5 new PROD gadget drafts; next task = gadget primary images + Bulk Publish) · **Updated 2026-10-31** (Premium Mobile PDP `e63e639` live DEV + PROD and CLOSED; GD005–GD009 images + publishing CLOSED (Owner-reported); domain connection in progress; Owner catalog workflow decision) · **Updated 2026-11-01** (Mobile footer + YouTube icon + Feedback-4 `5b32024` live DEV + PROD and CLOSED; root domain `isolutionspakistan.com` connected to Firebase PROD; next task = Mobile Phones Brand Collections, paused on an Owner decision) by Claude Code (Developer) for fresh Claude Code and GPT Analyzer chats.
**Verified from:** git, the code, read-only database queries on PROD and DEV, read-only public RPC calls and HTTP/bundle checks of the live DEV and PROD sites (latest 2026-11-01: `5b32024` commit/push, clean-export DEV + PROD deploys, live file checks on DEV, PROD and `isolutionspakistan.com`, public DNS lookups via 8.8.8.8; no database query since 2026-10-30).
Items marked **(Owner-reported)** were done or seen by the Owner, not by Claude. No passwords, keys or secrets are in this file.

**Source priority:** this file > `GPT_PROJECT_BRIEF.md` > `GPT_ANALYZER_HANDOFF.md` > `CLAUDE_HANDOFF.md` (old long history, last updated 2026-10-16). Claude's auto-memory folder also holds older project notes — they are **not** authoritative (Owner rule: no project facts in long-term memory).

---

## 0. Status at a glance (2026-11-01)

| Area | Status |
|---|---|
| Git | Branch `feature/checkout-orders-shipping`, HEAD **`5b32024`** (mobile footer, YouTube icon, Feedback-4) on top of the handover-docs commit `0813fc5`; pushed — local and origin both `5b32024` (verified 2026-11-01), no staged changes. Not merged to `master`. This 2026-11-01 handover update is **local and uncommitted** until the Owner approves a commit |
| Uncommitted | **36 original entries** — preserve them (§3); identical list before and after the `5b32024` commit (verified 2026-11-01) — plus the 3 edited handover docs until they are committed (`git status --short` = 39 while uncommitted; 36 after a handover commit) |
| Supabase CLI | **Linked to PROD `nlxfwppywxumymbjkvwt`** (`supabase/.temp/project-ref`, verified 2026-11-01). DEV = `acwatgxkcyrdxpcljxjb` |
| Migration history | **DEV 66 and PROD 66**, both ending at `202610270001`. No migration since 2026-10-26 (Bulk Publish, Premium Mobile PDP and the footer fix needed none). Last queried 2026-10-30 |
| Hosting | **DEV and PROD both run `5b32024`** — DEV `index-Df-LmKmr.js` / `AdminApp-bByDaa3O.js`, PROD `index-CKMM72rE.js` / `AdminApp-ItkWqdLa.js`, same CSS `index-DB5UrX-t.css`. Clean `git archive` exports, environment guard PASS (verified 2026-11-01, §4). **No pending application deployment** |
| **Mobile footer + YouTube icon + Feedback-4** | **Live DEV + PROD (`5b32024`) — CLOSED** (§9.5). Owner real Android footer QA PASS and Owner confirmed everything looks good (Owner-reported). Do not reopen or repeat its QA |
| **Premium Mobile PDP** | **Live DEV + PROD (`e63e639`) — CLOSED** (§9.4). Android, New iPhone, Used iPhone. Owner desktop + real Android mobile review PASS; Owner confirmed the real PROD Android mobile PDP is OK (Owner-reported) |
| **Admin Catalog Bulk Publish** | **Live DEV + PROD (`704dc83`, still in `e63e639`) — CLOSED** (§5C). Owner DEV + PROD QA PASS (Owner-reported) |
| **Tablet / MacBook specifications** | **CLOSED.** 25 specs on PROD (MacBook Air M5 8, Samsung A11 7, Samsung Tab S10 Lite 10); S10 Lite RAM corrected (IP002 6/128, IP003 8/256). Claude read-only verified 2026-10-30 (§4, §8) |
| Gadgets Stock Update | **Live DEV + PROD** with writes on DEV + PROD; Gadgets PDP V3 and Home Gadgets collection live (§5A). **GD005–GD009 primary images + publishing — CLOSED** (5/5 published, Owner-reported 2026-10-31, §5A) |
| **Domain `isolutionspakistan.com`** | **Root domain CONNECTED** to Firebase PROD `isolutions-pakistan-production` (GoDaddy DNS). Root A = `199.36.158.100`; HTTPS works and serves the `5b32024` PROD build (Claude-verified 2026-11-01); Firebase status Connected and SSL issued (Owner-reported). **`www` CNAME still → `shops.myshopify.com`** (separate pending Owner decision); `portal` A = `76.76.21.21` unchanged (§4, §11) |
| Catalog operations | **Owner-run through Admin Studio** (uploads, stock, specs, images, publishing) — not development tasks (§2) |
| Tablets & MacBooks Stock Update | **Live DEV + PROD** with writes; **Smart Paste parser live (`228553e`) — CLOSED**; Owner PROD real-data QA PASS for MacBook and Tablets (Owner-reported) (§5B) |
| PROD tablets / MacBooks | Apple MacBook Air M5 (16/512), Samsung A11, Samsung Tab S10 Lite — all published, specs complete (§4) |
| Used iPhones | All 9 published on PROD |
| Android / iPhone Stock Update, images, Spec Upload, Bulk Import | Complete. Do not redo |
| **Next step** | **Mobile Phones Brand Collections — IN PROGRESS, paused.** First ask the Owner the open decision: **Option A** (only brands with published products) or **Option B** (all brands). Nothing is implemented until the Owner answers (§11 #1). Other pending items: `www` decision, image-loading diagnostic, Gadgets PDP mobile WhatsApp overlap (§11) |

---

## 1. Roles and mandatory working rules

| Role | Who | Does |
|---|---|---|
| **Owner** | Muhammad Junaid | Final authority. Approves every phase, DB write, migration, commit, push, deploy and PROD action. |
| **Developer** | Claude Code (sole developer) | Writes code, migrations and tests; runs read-only checks; executes only what the Owner approves in that message. |
| **Analyzer / QA** | ChatGPT (GPT Analyzer) | Reviews plans and Claude reports, does QA, writes Owner-approved prompts for Claude. Does not write production code. |

`AGENTS.md` still names Codex as implementation engineer; in practice Claude Code is the developer.

**Rules for every step**
- Short Roman Urdu with the Owner; **one step at a time.**
- **No coding without Owner approval.** Order: **localhost → Owner approval → DEV → PROD.** Never skip.
- **Every DB write, migration, upload, commit, push and deployment needs explicit Owner approval in that message.** The Owner may approve several named actions in one message (e.g. "A–E"); approval never carries over to later actions.
- Before a migration: confirm the target project ref, run a dry-run and **stop** if anything other than the approved file is listed. Take a read-only before/after snapshot (counts + row fingerprints of products, variants, stock ledger, media).
- Read-only checks run inside `begin transaction read only; … rollback;`.
- **Never guess product facts** (PTA, condition, SIM, colour, specs, images, battery health, warranty). Blank stays blank (NULL). No similar-model matching.
- Preserve uncommitted changes: no cleanup, reset, stash or discard. Never delete catalog data or test products.
- Preserve the approved storefront design and business rules; no redesign.
- **Don't repeat completed work, audits or tests** (§6).
- **Deploy only committed code** from a clean export (`git archive <sha>` + only the needed env file). Never deploy the working-tree `dist/`.
- Never request, print or store secrets. The Owner signs in to Admin; Claude never signs in for them and never clicks Update Website / Save / Publish / Create.
- If Claude Code's safety check or a tool policy blocks a command: stop and report; never work around it.
- **Project information is not saved to long-term memory**; these handover files are the record.
- Windows/Git Bash quirk: heredocs mangle `\\`; write files with the Write/Edit tools. `AdminApp.tsx` has CRLF line endings.

---

## 2. Architecture (locked)

- **Frontend:** React + Vite + TypeScript; one repo serves the storefront and `/admin` (Admin Studio). Admin code is a separate lazy chunk (`AdminApp-*.js`).
- **Hosting:** Firebase Hosting. DEV `isolutions-development-cb1ea.web.app`, PROD `isolutions-pakistan-production.web.app`. `.firebaserc` aliases `development`, `production`. No Cloudflare/OpenNext, no Vercel.
- **Backend:** Supabase (PostgreSQL + Auth + RLS + Edge Functions). DEV `acwatgxkcyrdxpcljxjb`, PROD `nlxfwppywxumymbjkvwt`.
- **Media:** Cloudinary signed upload via Edge Function; only metadata in `product_media`. Delivery URLs via `cloudinaryDeliveryUrl` (`src/lib/cloudinary.ts`, optional `e_trim`).
- **Builds:** `npm run build:dev` (reads `.env.local`) / `npm run build:prod` (reads `.env.production.local`). `npm run dev` always connects to DEV. The Firebase predeploy guard (`scripts/check-hosting-environment.mjs`) refuses a bundle wired to the other environment. `npm run preview:dev|preview:prod` (`scripts/preview-dist.mjs`) serves a built `dist/` behind the same guard.
- **Storefront data:** customer pages read only through security-definer RPCs (`search_public_catalog`, `homepage_featured_products`, `frequently_bought_together`, …) that return published, real, active data only; RLS on catalog tables exposes only published real products.
- **Money** integer paisa · **Stock** = sum of `inventory_movements` · **SKUs** server-assigned per category prefix: `MB` mobile-phones, `AC` mobile-accessories, `GD` gadgets, `IP` tablets, `MC` laptops. DEV and PROD SKUs are independent.
- **Categories:** `gadgets` (top level) with children `tablets` and `laptops`; `mobile-phones`; `mobile-accessories`. Slugs are unchanged and must not be renamed.

### Locked Owner decisions
- **Checkout:** server-side `create_storefront_order`; Cash on Delivery or Bank Transfer only.
- **Shipping:** below Rs 10,000 → Standard Rs 200, Fast Rs 400; Rs 10,000+ → Standard free, Fast Rs 200 (constants in `src/lib/orders.ts`, mirrored by the server).
- **Delivery:** mobile phones Karachi only; **iPads, tablets and MacBooks Karachi only**; gadgets/accessories nationwide; any cart with a Karachi-only item becomes Karachi-only.
- **Android phones:** PTA Approved, Brand New, 1 Year warranty, Karachi only. Android Stock Update: latest list is the truth; listed variants → list price, visible, stock 30; missing variants of published phones hidden (never deleted); one all-or-nothing call per phone.
- **iPhone Stock Update:** §5.1. **Warranty:** §5.4. **Gadgets:** §5A. **Tablets & MacBooks:** §5B. **Images:** §7. **Specifications:** §8. **PDP:** §9. **Bulk Import:** §10.
- **Windows laptops are not sold.** Only Apple MacBooks in `laptops`; a non-Apple laptop cannot be published (§5B).
- **SIM values (database):** `physical_sim`, `esim`, `physical_plus_esim`, `dual_esim`, `dual_physical_sim` (two physical SIMs). Blank = NULL, never inferred. SIM is not part of variant identity.
- **Official WhatsApp Business number (Owner-confirmed):** `923132344912` (0313 2344912), stored in `src/lib/storefrontContact.ts`.
- **"100% Authentic — Official Product"** PDP card: wording stays unchanged on all products (Owner decision 2026-10-24).
- **PDP image browsing never changes storage, variant or price** (Owner decision 2026-10-25, §9.2).
- **Colours:** Gray stored as Grey. ZTE = "ZTE Focus Pro 5G". A57 blue differs by environment (§13 #1).
- **Not authorized:** customer accounts, card/installment gateways, promotions engine, production commerce at scale, internal live chat.
- **Catalog operations are the Owner's (Owner decision 2026-10-31):** routine product uploads, stock updates, specifications, images and publishing are done by the Owner through the existing Admin Studio workflows (Stock Update pages, Media, Spec Upload, Bulk Publish). They are **not** pending development tasks; those modules stay CLOSED. **Android Mobiles is the first category the Owner selected for product uploading** (Owner decision 2026-11-01). Product information is never guessed; missing information stays NULL.

---

## 3. Git (verified 2026-11-01)

- **HEAD:** `5b32024` — "fix: mobile footer layout, YouTube icon and Feedback-4 branding" (on top of the 2026-10-31 handover-docs commit `0813fc5`). `origin/feature/checkout-orders-shipping` = `5b32024`. No staged changes. The 2026-11-01 handover doc edits are uncommitted.

| Commit | What |
|---|---|
| `5b32024` | **Mobile footer + YouTube icon + Feedback-4** (3 paths, via temporary index): `src/styles.css` (mobile footer rules only), `src/StorefrontApp.tsx` (YouTube icon path, 1 line), `public/assets/feedback/Feedback-4.png` (Owner-supplied image). Frontend only (§9.5) |
| `0813fc5` | Handover docs after Premium Mobile PDP rollout |
| `e63e639` | **Premium Mobile PDP** (2 paths, via temporary index): `src/StorefrontApp.tsx`, `src/styles.css`. Frontend only — no migration, RPC, data or business-logic change (§9.4) |
| `c7e63da` | Handover docs after specifications and Bulk Publish rollout |
| `704dc83` | **Admin Catalog Bulk Publish** (5 paths, via temporary index): `src/lib/catalogBulkPublish.ts`, `src/admin/CatalogBulkPublish.tsx` (new), `src/admin/AdminCatalog.tsx`, `src/admin/admin.css` (only the 29 appended Bulk Publish lines; the Owner's other uncommitted `admin.css` lines stay uncommitted), `scripts/catalogBulkPublish.test.mjs`. No migration, no RPC change (§5C) |
| `25f0914` | Handover docs after Smart Paste rollout and PROD tablet uploads |
| `228553e` | **Tablets & MacBooks Smart Paste parser** — only `src/lib/tabletStockUpdate.ts` + `scripts/tabletStockUpdate.test.mjs` (committed via temporary index). No migration, no RPC change |
| `bdc409c` | Handover docs after Gadgets and Tablets & MacBooks PROD rollout |
| `2dd05bd` | Tablets & MacBooks writes allowed on PROD (`TABLET_WRITE_ENVIRONMENTS = ["development", "production"]`) |
| `1e0add3` | **Tablets & MacBooks Stock Update** (13 paths): `src/lib/tabletStockUpdate.ts`, `tabletStockApply.ts`, `tabletStockApplyDb.ts`, `src/admin/TabletStockUpdate.tsx`, migration `202610270001`, `src/lib/collections.ts`, `src/StorefrontApp.tsx` (menu), `src/admin/AdminApp.tsx` (tablet nav + route hunks only), 3 new tests, 2 validator tests updated to the new rule |
| `d3dd1de` | Gadgets Stock Update writes allowed on PROD |
| `86af7c4` | Gadgets PDP V3 — About This Product, Order on WhatsApp, delivery card (`StorefrontApp.tsx`, `pdpDescription.ts`, `styles.css`, test) |
| `867475f` | Home Gadgets collection reads the `gadgets` category; Gadgets draft wording |
| `0bd62cd` | Gadgets Paste List reads the price on its own line |
| `8c81acf` | Neutral Gadgets Paste List placeholder |
| `1463f8d` | **Gadgets Stock Update** (migration `202610260001`, page, libs, PDP description paragraphs) |
| `7968015` | Bulk Import simplification (Excel Create-only) |
| `626f0f0` | PDP colour ↔ image alignment |
| `9176c8d` | iPhone 13 (Used) PDP image sizing |
| `4c17c0b` | iPhone PDP Product Information + WhatsApp Ask Seller (migration `202610230002`) |
| `f43d936` | Global Spec Upload (migration `202610230001`) |
| `1a6014a` | Used iPhone publication without warranty (migration `202610220001`) |
| `9f73bd6` | Media page = manual image upload |
| `649ba8b` / `ba6a4e1` | iPhone Stock Update (write DEV + PROD; migrations `202610210001`, `202610210002`) |
| `5ad4a4d` | Android Stock Update (complete) |

**36 uncommitted entries (verified 2026-10-26; still exactly these 36 after the `228553e`, `704dc83`, `e63e639` and `5b32024` commits — verified 2026-11-01). Preserve them.**
- **Modified tracked (5):**
  - `CLAUDE_HANDOFF.md`
  - `src/admin/AdminApp.tsx` — only the deprecated `/admin/specs-images` notice (+19)
  - `src/admin/admin.css` — deprecated preview / image-preview / C75x / batch / owner-decision styles
  - `scripts/specificationBulkUpload.test.mjs` — one extra check that reads the deprecated `fetch-official-sources.mjs`
  - `scripts/securityRls.test.mjs` — one-line local change from the deprecated official-source work. **Known stale test (not a security issue):** its "authenticated" RPC list lacks `apply_gadget_stock_product` and `apply_tablet_stock_product`, so `SECURITY DEFINER RPCs callable by visitors…` fails (full suite in the working tree 1110/1111 on 2026-10-29). Reproduced on a clean export of `bdc409c` (before Smart Paste) and of `25f0914` (before Bulk Publish); the anon assertion passes. Not modified — fixing it needs its own approval
- **Untracked (31):** deprecated official-source scraping (`src/lib/official*.ts`, `src/lib/robotsTxt.ts`, `src/admin/Official*.tsx`, `src/data/officialSourceSnapshots.json`, `scripts/fetch-official-sources.mjs` + tests); Realme C75x DEV scaffolding (`src/lib/realmeC75x*.ts`, `src/admin/RealmeC75x*.tsx`, `src/data/realmeC75xOfficialSpecs.json`, `scripts/fetch-realme-c75x-specs.mjs` + tests).
- **Ignored local files (not counted):** `scratch/used-iphone-specs/` (excluded via `.git/info/exclude`); `.claude/launch.json` (gitignored; local preview entries).

**Committing from mixed files:** write only the approved file versions into a **temporary index** (`GIT_INDEX_FILE=<tmp> git read-tree HEAD`, `git add -- <files>`, for a partial file `git hash-object -w --path=<file> <prepared copy>` + `git update-index --cacheinfo`), `git commit`, then put the same blobs into the real index so nothing shows as staged. Used for every commit since `9176c8d`.

**Line endings:** no `.gitattributes`, `core.autocrlf=true`. In a fresh Windows `git archive` export two older tests fail only because of CRLF (`androidStockPhoneRpc.test.mjs` and the `homepage_featured_products` check in `phase4.test.mjs`) — not regressions. **Known baseline in a clean export (2026-10-30):** exactly 3 failures — these two plus the stale `securityRls` RPC list — identical on `25f0914` and `704dc83` (clean `704dc83` export: 1036 pass, 3 fail). Outside current scope; don't re-investigate.

---

## 4. Database and hosting state

**Migrations (DEV + PROD, both 66, last `202610270001`):** `202610260001` (Gadgets: `apply_gadget_stock_product` + gadget publishing rule) applied DEV 2026-10-25 and PROD 2026-10-25; `202610270001` (Tablets & MacBooks: `apply_tablet_stock_product` + validator) applied DEV 2026-10-26 and PROD 2026-10-26. Both functions: SECURITY DEFINER, `search_path=""`, `lock_timeout=2s`, execute for `authenticated` only (not anon/public). Current `validate_product_for_publication` md5 = `03ab088f…` on both.

**PROD `nlxfwppywxumymbjkvwt`** (read-only, 2026-10-26, before and after `202610270001` — identical counts and row fingerprints): **112 products** (91 published + 17 draft phones, 4 published gadgets), **401 variants**, **285 images**, 0 orders. No tablet or laptop product yet. Since 2026-10-24 the only PROD catalog changes were the Owner's (Used iPhones published; 4 gadgets added and published — Owner-reported). Claude has made **no PROD product write**.

**PROD tablets / MacBooks — CLOSED (Claude read-only verified 2026-10-30, compared with a read-only snapshot taken 2026-10-29 before the Owner's corrections):** all three **published**, one primary product-level image each, stock 20 per variant (one +20 movement each). Media, media assignments, inventory, prices and SKUs identical to the before-snapshot; the only changes are the S10 Lite RAM values and the new specifications.

| Product (exact PROD title) | Product ID / slug | Variants | Specs |
|---|---|---|---|
| Apple MacBook Air M5 | `721cab16-78cf-4894-b4d6-f96f6a49e8d3` / `apple-macbook-air-m5` | MC001 Skyblue Rs 397,000 · MC002 Silver Rs 402,000 · MC003 Midnight Rs 397,000 — all **16 GB / 512 GB** (Owner's 256 → 512 GB correction confirmed) | **8** |
| Samsung A11 | `3a9269c4-c2b9-44ec-816d-641cae8a666b` / `samsung-a11` | IP001 8 GB / 128 GB, Rs 59,000 | **7** |
| Samsung Tab S10 Lite | `7187b183-bd37-466a-8cbf-6125e8dea47b` / `samsung-tab-s10-lite` | **IP002 6 GB / 128 GB**, Rs 98,500 (was 8/128) · **IP003 8 GB / 256 GB**, Rs 115,000 (was 6/256) | **10** |

- The RAM correction was made by the Owner in PROD Admin (Edit explicit variant); the 25 specs were saved by the Owner through Admin Spec Upload from `iSolutions_Specifications_PROD_Upload_Ready.csv` (Samsung rows matched by exact PROD title + product ID). **Owner-reported:** Admin read-back done and screenshots checked of the PROD Admin variants and the customer-facing specification sections of all three products.
- Observation (Claude, 2026-10-30): Samsung Tab S10 Lite `published_at` moved from 2026-10-28 17:49 to 2026-10-29 17:14 UTC during the Owner's edit; status is still published. No action needed.
- **Specifications task CLOSED — no repeat research or upload.**

**PROD totals (read-only, 2026-10-30):** 120 products = **98 published + 22 draft** (17 Android drafts + 5 new gadget drafts), **0 orders**. **Since then (Owner-reported 2026-10-31, not re-queried by Claude):** the 5 gadget drafts GD005–GD009 got primary images and were published (§5A) → expected **103 published + 17 draft**.

**DEV `acwatgxkcyrdxpcljxjb`** (read-only, 2026-10-26, before `202610270001`): 142 products (4 published gadgets + 1 draft gadget "Tecno Watch 3"; 133 phones, 3 published; 4 tablet drafts with condition `unknown`), 446 variants, 220 images, 8 orders. **After that: the Owner created "Apple MacBook Air M5" through Tablets & MacBooks Stock Update — draft, SKU MC001, stock 20, Rs 420,500 (Owner-reported DEV QA PASS).** DEV keeps 3 old Apple test drafts (MB003, MB311, MB312) — leave them.

**Hosting (deployed 2026-11-01 from clean `git archive 5b32024` exports; only the needed env file copied — `.env.local` for DEV, `.env.production.local` for PROD; `build:dev` / `build:prod`; manual guard run PASS for the right target and the Firebase predeploy guard passed again during each deploy; export folders and env copies deleted afterwards). DEV was verified before PROD was deployed. No pending application deployment.**

| | Commit | Entry bundle | CSS | Admin chunk | Supabase URL in bundle |
|---|---|---|---|---|---|
| DEV `isolutions-development-cb1ea` | `5b32024` | `index-Df-LmKmr.js` | `index-DB5UrX-t.css` | `AdminApp-bByDaa3O.js` | DEV `acwatgxkcyrdxpcljxjb` only |
| PROD `isolutions-pakistan-production` | `5b32024` | `index-CKMM72rE.js` | `index-DB5UrX-t.css` | `AdminApp-ItkWqdLa.js` | PROD `nlxfwppywxumymbjkvwt` only |

Live checks (Claude, 2026-11-01): on DEV, PROD and `isolutionspakistan.com` the served `Feedback-4.png` is byte-identical (sha256) to the committed file, the entry bundle contains the YouTube icon fix, and the CSS contains the 52 px payment-card and WhatsApp safe-area rules; the custom domain serves the same PROD files. Claude could not render the live pages at phone widths (in-app browser "policy check temporarily unavailable", §13 #15); the Owner checked visually (Owner-reported). iPhone, Gadgets and Tablets write lists are all `["development","production"]`. Previous builds: both `e63e639` (DEV `index-DY8QjrMA.js` / `AdminApp-y5OqyATb.js`, PROD `index-DBftZIJ4.js` / `AdminApp-XQ8ljvx-.js`, CSS `index-B34I6U_T.css`, 2026-10-31).

**Custom domain — root CONNECTED (2026-11-01):** `isolutionspakistan.com`, registrar/DNS GoDaddy, Firebase PROD Hosting `isolutions-pakistan-production`.
- **Claude-verified 2026-11-01 (public DNS 8.8.8.8, HTTPS fetches):** root A = `199.36.158.100`; `https://isolutionspakistan.com` loads over HTTPS and serves the `5b32024` PROD build (same entry bundle, CSS and Admin chunk as `isolutions-pakistan-production.web.app`; Supabase PROD only); `www.isolutionspakistan.com` is a CNAME to `shops.myshopify.com` (still Shopify); `portal` A = `76.76.21.21`.
- **Owner-reported:** Firebase Hosting shows the domain as Connected; SSL issued.
- History: TXT `@` = `hosting-site=isolutions-pakistan-production` was added for ownership; the earlier read-only diagnostic that found the Shopify A record (`23.227.38.65`) on the root is outdated.
- **`www` migration is a separate pending Owner decision. Never change DNS without explicit Owner approval.** Claude has made no DNS change.

**Public catalog note:** `search_public_catalog` lists only products with an active brand, active category and at least one active variant; category filters match the slug exactly (children are not included). Pre-existing; unchanged.

---

## 5. iPhone Stock Management (complete on DEV + PROD — do not redo)

### 5.1 Rules (locked)
- New and Used are **separate products** in Mobile Phones: `Apple iPhone 15 Pro Max` (New) and `Apple iPhone 15 Pro Max (Used)` (`…-used`). Matched only by exact title and only if every variant has that condition; otherwise **held**.
- New variant/phone: opening stock **20**. Existing listed variant: price only, stock kept. Hidden listed variant: shown again with the list price. Missing variants: never touched. No quantity field.
- Condition and PTA only from the Owner's page choice or list words. Grade, battery health, cycles, warranty, RAM stay NULL. Karachi-only.
- `Physical Dual` = Dual Physical SIM. Owner-confirmed spellings (iPhone only): Blaxk → Black, Purppe → Purple, Blk → Black. A price line without a colour is Skipped.
- New phones are created as **drafts** (via `apply_catalog_bulk_import_v2`, action Create).
- Page `/admin/iphone-stock-update`: choose Condition + PTA → paste list → Check Changes → Update Website (DEV + PROD).

### 5.2 PROD result
- **9 Used iPhones, 69 variants, 1,380 opening units** (20 each), all Used + PTA Approved, visible, Karachi-only; RAM/grade/battery/cycles/warranty NULL. **All 9 published (Owner).**
- **Dual Physical SIM** only on iPhone 13 (Used) 256 GB Green/Red/Blue/Black/Pink (5 variants). The other 64 variants have SIM NULL; **no variant has Battery Health** (all NULL).

| PROD product | Slug | SKUs | Primary image | Specs |
|---|---|---|---|---|
| Apple iPhone 15 Pro Max (Used) | apple-iphone-15-pro-max-used | MB329–MB333 (5) | 225×225 | 12 |
| Apple iPhone 14 Pro Max (Used) | apple-iphone-14-pro-max-used | MB334–MB342 (9) | 225×225 | 12 |
| Apple iPhone 15 Pro (Used) | apple-iphone-15-pro-used | MB343–MB347 (5) | 225×225 | 12 |
| Apple iPhone 13 Pro Max (Used) | apple-iphone-13-pro-max-used | MB348–MB359 (12) | 447×447 | 12 |
| Apple iPhone 13 Pro (Used) | apple-iphone-13-pro-used | MB360–MB367 (8) | 500×500 | 12 |
| Apple iPhone 13 (Used) | apple-iphone-13-used | MB368–MB376 (9) | 1024×1024 (6 images, §9.1) | 11 |
| Apple iPhone 14 Pro (Used) | apple-iphone-14-pro-used | MB377–MB388 (12) | 225×225 | 12 |
| Apple iPhone 14 (Used) | apple-iphone-14-used | MB389–MB393 (5) | 500×500 | 11 |
| Apple iPhone 15 (Used) | apple-iphone-15-used | MB394–MB397 (4) | 981×981 | 11 |

### 5.3 Migrations (applied DEV + PROD)
`202610210001` (`apply_iphone_stock_phone`), `202610210002` (Dual Physical SIM).

### 5.4 Warranty rules (current validator, DEV + PROD)
- **Used iPhones:** no warranty; NULL; publishing allowed. Exemption only for a real Apple product in Mobile Phones whose title ends with " (Used)" and whose every variant is Used. **Do not type a default warranty for Used iPhones.**
- **New / Box Pack iPhones:** warranty required — 1 year or 2 years, **only from Owner-confirmed product information**.
- **Gadgets** (category `gadgets` itself): PTA, condition and warranty not required (§5A).
- **iPads, tablets and Apple MacBooks** (category `tablets`, or `laptops` with brand Apple): warranty optional for New and Used; PTA and condition must still be set (§5B).
- **Android and all other products:** warranty rule unchanged.
- Other publishing checks unchanged: real classification, title, active brand/category, active variant, price > 0, delivery area, PTA and condition not unknown (except gadgets), primary image. A non-Apple product in `laptops` can never be published (`laptops_apple_brand_required`).

---

## 5A. Gadgets (live DEV + PROD — do not redo)

- **Gadgets Stock Update** (`/admin/gadget-stock-update`, nav "Gadgets Stock"): Paste List → Generate Excel (Product Name, Price, Description) → Owner fills Description → Upload Excel → Check Changes → Update Website. Parser reads "Name - Rs 750" on one line or the price on the next line (blank lines ignored); nothing guessed.
- **Rules:** category `gadgets` only (not its Tablets/Laptops children). Existing gadget with exactly one visible variant: price and/or the Owner's description; **stock never changes**. New gadget: **draft**, stock 20, nationwide, via `apply_catalog_bulk_import_v2`. Duplicates, name clashes and multi-variant products → Needs Review. Server: `apply_gadget_stock_product` (migration `202610260001`). Writes allowed DEV + PROD.
- **Publishing:** gadgets need no PTA, condition or warranty; image, price, delivery, active brand/category/variant still required.
- **Home Gadgets collection** (`/collections/home-gadgets`): category `gadgets` (exact slug; Tablets/Laptops not included).
- **Gadgets PDP V3** (gadgets only): "About This Product" editorial section (Owner's text exactly, paragraphs/line breaks kept, product name not repeated); **Order on WhatsApp** under Buy Now (wa.me `923132344912`, product, variant, quantity, shown price, link — no customer data, no website order); delivery card ("Delivery Across Pakistan" only for a stored nationwide scope, Standard/Fast fees from the checkout constants, note "Final delivery charges are calculated at checkout based on your order total."). Other categories' PDPs unchanged.
- **Data:** DEV 4 published gadgets (Water Nozzle Plastic, Tumbler Stopper, Mini Fan Y05, Crank Chop Blade Chopper (Box Packing)) + 1 draft; PROD 4 published gadgets GD001–GD004 (Owner-added; Claude-verified 2026-10-30).
- **5 PROD gadgets GD005–GD009 (added by the Owner 2026-10-29 through Gadgets Stock Update; Claude read-only verified 2026-10-30 as drafts with 0 images) — images + publishing CLOSED (Owner-reported 2026-10-31):** the Owner uploaded primary images (5/5 uploaded and verified on PROD), Bulk Publish validation 5/5 Ready, **5/5 published, 0 failed**; the Owner visually checked the Home Gadgets collection and product images. No repeat upload or publishing. Each: category `gadgets`, 1 active variant, stock 20, nationwide. Exact PROD titles:

  | SKU | Exact PROD title | Price |
  |---|---|---|
  | GD005 | PU Leather Passport Holder | Rs 400 |
  | GD006 | Baby water play mat | Rs 350 |
  | GD007 | Hair straightener | Rs 900 |
  | GD008 | USB Dynamic Water Pattern Lamp 16 Colours with Remote | Rs 950 |
  | GD009 | Kitchen Oil filter Pot 1.4 liter | Rs 800 |

  Claude did not re-query PROD after the Owner's publishing (Owner-reported result).

## 5B. Tablets & MacBooks (live DEV + PROD — do not redo)

- **Page** `/admin/tablet-stock-update` (nav "Tablets & MacBooks"): choose **Product Type** (iPad / Tablet / MacBook), **Condition** (New / Used) and, for iPad/Tablet, **Connectivity** (WiFi Only / Cellular — PTA Approved / Cellular — Non-PTA) → Paste List → Check Changes → preview (New Products / New Variants / Price Updates / Show Again / Needs Review) → Update Website (confirm names the website). Writes allowed DEV + PROD.
- **Category mapping (existing categories, no new ones):** iPad → `tablets` + Apple; other tablets → `tablets` (any brand except Apple); MacBook → `laptops` + Apple. **Windows laptops are never added.**
- **List formats:** one line `Galaxy Tab A8 4/64; 43,000` (RAM/storage, optional colour, price after `;`, `@`, or a comma-grouped amount); or a block — model heading, then a price line and a configuration line in either order (Owner-confirmed: `Macbook Air M5 Now Available` / `420500` / `16-512Gb Midnight` = MacBook Air M5, 16 GB, 512 GB, Midnight, Rs 420,500). "Now Available" is the only announcement phrase removed. `16-512Gb` = 16 GB RAM / 512 GB.
- **Smart Paste (`228553e`, live DEV + PROD — CLOSED):** natural supplier/WhatsApp lists are read as written: (a) model + RAM/storage heading without a price (`Macbook Air M5 16-256Gb`), then one **colour + price per line** (`SkyBlue 397,000`, `Silver @402,000`, `silver - 402,000`, `Midnight: 450,000`, `Rs …`; `Blue/Grey 210,000` = both colours one price); (b) one-line entries followed by **more storage lines of the same model with their own price** (`Samsung Tab S10 Lite 6-128Gb@98,500` / `6-256Gb @115,000`, noted "Model … read from line N above"); (c) config line under a model heading, then colour + price lines; `8GB-256GB` dash form; blank lines don't break a group. Needs Review (never guessed): colour without price; colour + price with no RAM/storage above; a configuration that already has a colour followed by colour lines; storage line without price; config with no model; brand/model/WiFi words never read as colours; duplicate colour lines; New/Used or PTA differing from the heading. Unknown colours (e.g. "Skyblue") still need the Owner's **Keep**. Compare/plan/write rules unchanged. Unit-less dash config (`8-128` without Gb) and typo units (`Gbb`) are not read — optional future work.
- **Nothing guessed — Needs Review:** unknown brand (e.g. Docomo), two prices or configurations in a row, a block whose price/config order changes, a configuration without a model, missing storage, unclear connectivity (or WiFi vs Cellular conflict), product type mismatch (Apple on Tablet, non-Apple on iPad/MacBook, laptop words on Tablet), duplicate titles/lines, product in another category, a website variant that differs only by a blank RAM/colour, other-condition variants, look-alike new products (Owner confirms "This is a new product"), unknown colour (Owner "Keep").
- **Rules:** New and Used separate products (Used title ends " (Used)"); exact-title matching only. Existing listed variant: price only, stock kept; hidden listed variant: shown again with the list price; missing variants/products untouched. New variant / new product: **draft**, stock **20**, **Karachi only**, warranty/grade/battery/cycles/SIM NULL, colour NULL when not written. PTA: WiFi → Not Applicable; Cellular → Owner-chosen Approved / Non-PTA; MacBook → Not Applicable. Variant identity = RAM + storage + colour + PTA + condition.
- **Server:** `apply_tablet_stock_product` (migration `202610270001`) — one product per call, all or nothing; scope `tablets` or Apple `laptops` only; MacBook PTA must be Not Applicable; SKUs `IP###` (tablets) / `MC###` (MacBooks); read-back inside the transaction. New products via `apply_catalog_bulk_import_v2` (Create, draft). iPhone RPC untouched.
- **Publishing:** warranty optional for tablets and Apple MacBooks (New + Used); PTA/condition/image still required; non-Apple laptops blocked.
- **Storefront:** `/collections/laptops-tablets` (same URL) is now **"Tablets & MacBooks"**: iPad, Android Tablets, **MacBooks** (`?type=macbooks` = `laptops` + Apple; old `?type=laptops` shows the same MacBooks; a non-Apple brand link shows nothing). Menu and drawer renamed; Acer/HP/Dell/Lenovo laptop links removed. `/collections/macbook` and homepage cards unchanged.
- **QA:** localhost (parser/plan 18 tests, RPC + validator on real migrations in PGlite 7 tests, collections 4 tests, Admin harness desktop/mobile); DEV migration + deploy verified; **Owner DEV real-write QA PASS** (MacBook Air M5, draft, MC001, stock 20, Rs 420,500 — Owner-reported). **Smart Paste:** tablet + RPC tests 33/33 PASS on a clean export of `228553e`; `build:dev` + `build:prod` PASS; DEV + PROD deployed and byte-verified 2026-10-28; **Owner PROD real-data QA PASS for MacBook and Tablets (Owner-reported).**

### 5B.1 PROD products uploaded via this page
See §4 (Apple MacBook Air M5 MC001–MC003, Samsung A11 IP001, Samsung Tab S10 Lite IP002–IP003). All three Claude read-only verified 2026-10-30, published, specifications complete.

## 5C. Admin Catalog Bulk Publish (`704dc83`, live DEV + PROD — CLOSED, do not redo)

- **Where:** Admin → Catalog (`/admin/products`). Checkbox **only on Draft rows** (published/archived rows have none); **Select all drafts** (follows the current search; shows the count), **N selected**, **Clear selection**. Selection can mix categories.
- **Validate Selected:** re-reads the selected products fresh and runs the existing server validator `validate_product_for_publication` for each. Shows **Ready to Publish / Needs Review / Already Published / Skipped**, with the exact reason per product (plain words + code, e.g. "primary image required (primary_product_media_required)"). Never writes.
- **Publish Selected (n Ready):** disabled until a current validation exists; any tick/untick makes it stale. Confirmation shows environment + project ref, count and every product name; **PROD requires typing `PUBLISH <n>`**; double-click latch; leave-page warning while running.
- **Server re-validation:** reuses the existing Android bulk-publish engine unchanged (`src/lib/bulkPublish.ts` `runBulkPublish`, `src/lib/bulkPublishDb.ts`): per product it re-reads, re-validates, writes **only `publication_status = 'published'`**, then reads back (prices, variants, SKUs, media, stock unchanged). The `products_enforce_publication` trigger enforces the same validator, so a stale preview can never publish an invalid product. One failure never blocks others; failed products stay Draft. Results: Successfully Published / Failed–Needs Review / Already Published–Skipped with reasons; the list refreshes and the selection clears.
- **All category rules come from the server validator** (image, classification, variants, price, PTA/condition, warranty incl. used-iPhone exemption and optional tablet/MacBook warranty, gadget exemptions, delivery, Apple-only Laptops). No new validator, RPC or migration. Single-product "Validate & publish" in the editor is unchanged.
- **Files:** `src/lib/catalogBulkPublish.ts`, `src/admin/CatalogBulkPublish.tsx`, `src/admin/AdminCatalog.tsx`, `src/admin/admin.css` (Bulk Publish block at the end), `scripts/catalogBulkPublish.test.mjs`.
- **QA (Claude-verified):** localhost mocked-database harness — 12 browser checks PASS (mixed categories, stale preview, mid-run invalidation stays Draft, exactly-only `publication_status` writes, mobile 375 px); tests **28/28** (13 new + 15 engine) on a clean export of `704dc83`; typecheck, lint, `build:dev`, `build:prod` PASS; DEV + PROD guards PASS; live bundles byte-identical.
- **QA (Owner-reported):** DEV — 136 Drafts selected → 55 Ready, 81 Needs Review; a separate 3-product check → all 3 correctly blocked (missing Primary Image). PROD — 3 new gadgets selected → 0 Ready, 3 Needs Review (missing Primary Image), **Publish Selected (0) correctly disabled**. No product was published during QA.
- **Caution:** `npm run dev` / DEV hosting talk to the real DEV database — Publish Selected there really publishes DEV products. Validate Selected is read-only everywhere.

---

## 6. Completed work (do not redo)

1. Phases 0–3B, Phase 4 real catalog, Checkout & Orders + Shipping.
2. Android catalog, images, **Android Stock Update** — DEV + PROD (`5ad4a4d`).
3. **iPhone Stock Update** — code, migrations, DEV + PROD runs and verification; PROD write enable (`649ba8b`).
4. **Manual image upload** (`9f73bd6`); Used iPhone warranty fix (`1a6014a`); **Global Spec Upload** (`f43d936`).
5. **Used iPhone specifications** (105 rows on PROD, verified).
6. **iPhone PDP Product Information + WhatsApp Ask Seller** (`4c17c0b`); all 9 Used iPhones published; iPhone 13 image sizing (`9176c8d`); PDP colour ↔ image alignment (`626f0f0`).
7. **Bulk Import simplification** (`7968015`).
8. **Gadgets Stock Update** + parser fix + Home Gadgets collection + **Gadgets PDP V3** — DEV + PROD (`1463f8d` … `d3dd1de`, migration `202610260001`).
9. **Tablets & MacBooks Stock Update** + storefront collection — DEV + PROD (`1e0add3`, `2dd05bd`, migration `202610270001`), Owner DEV QA PASS.
10. **Tablets & MacBooks Smart Paste parser** — DEV + PROD (`228553e`), Owner PROD QA PASS. CLOSED.
11. **Tablet / MacBook specifications** — 25 PROD specs (MacBook Air M5 8, Samsung A11 7, Samsung Tab S10 Lite 10) + S10 Lite RAM correction; Claude read-only verified 2026-10-30, Owner screenshots checked. CLOSED (§4, §8).
12. **Admin Catalog Bulk Publish** — DEV + PROD (`704dc83`), Owner DEV + PROD QA PASS. CLOSED (§5C).
13. **GD005–GD009 primary images + publishing** — 5/5 images uploaded and verified on PROD, 5/5 Ready, 5/5 published, 0 failed; Home Gadgets collection and images checked (Owner-reported 2026-10-31). CLOSED (§5A).
14. **Premium Mobile PDP** — Android, New iPhone, Used iPhone; DEV + PROD (`e63e639`); Owner desktop + real Android mobile review PASS, real PROD Android mobile PDP OK (Owner-reported). CLOSED — no repeat development, audit or deployment (§9.4).
15. **Mobile footer + YouTube icon + Feedback-4** — DEV + PROD (`5b32024`); localhost QA, Owner real Android footer QA PASS, Owner confirmed everything looks good (Owner-reported). CLOSED — do not reopen or repeat its QA (§9.5).
16. Audits done — don't repeat: footer/YouTube/Feedback-4 localhost QA at 320–1440 px, targeted tests 127/127, typecheck, `build:dev`, DEV + PROD live file checks, custom-domain check (2026-11-01); Premium Mobile PDP localhost visual/keyboard/overlap QA, targeted tests 127/127, DEV + PROD bundle verification (2026-10-31); Bulk Publish localhost/DEV/PROD verification and PROD tablet/MacBook spec read-back (2026-10-30); Specifications CSV product matching (2026-10-29); Smart Paste localhost/DEV/PROD verification and the `securityRls` failure classification (2026-10-28); all Android audits; iPhone DEV/PROD verifications; image architecture review; specification workflow audit; Used iPhone readiness/spec verification; iPhone PDP verification; PDP colour-image audit; image-sizing analysis; Bulk Import necessity review; Gadgets DEV/PROD migration snapshots; Tablets & MacBooks read-only review, DEV/PROD migration snapshots and targeted tests (47/47).

---

## 7. Images (global rules)

**Owner-approved rules — every current and future category, New and Used, one shared `product_media` system:**
- **Official manufacturer image = Primary.** **Actual product photos (Owner) = Secondary.**
- Exact product/model/colour match. Official images need verified commercial usage rights.
- **Manual upload only** — no automatic discovery, scraping, replacement, deletion, reordering or publishing.
- Images stay saved when stock reaches zero, a variant is hidden or restocked.
- Existing 267 PROD Android images stay untouched (Unclassified).
- **Save original-resolution image files and upload them — never drag-and-drop Google Images thumbnails.**
- **iPhone image quality improvement is deferred: the Owner will replace low-resolution primaries later.**
- **Colour association:** an image's colour comes only from its stored `variantId`/`variantIds` (set in the Admin Media editor). An image without an association is a shared image.

**Code today:** Admin → Media (`/admin/media`) = Manual Product Image Upload (Missing Images list → Upload Images → choose Primary → environment-guarded upload). **Not implemented:** image type (Official/Actual), source, usage-rights fields, customer labels, official-primary publishing gate.

---

## 8. Specifications

- **Storage:** `product_specifications` (section, label, value, sort_order; unique per product + section + label). Customers see specs only on published products.
- **Spec Upload (`/admin/spec-upload`, all categories):** Download Template → fill → upload (checked, nothing saved) → **Save Specifications**. Columns: Product Name · Product Slug or Product ID · Section · Label · Value. Exact matching only. Per-product all-or-nothing save via `apply_product_specifications`. PROD needs the typed phrase `APPLY <n> SPECS`.
- **Stock Updates never create specifications.** Tablet/MacBook specs only from exact verified official sources with Owner approval, through Spec Upload.
- **PROD status:** 943 Android + 105 Used iPhone = **1,048** (verified 2026-10-24) **+ 25 tablet/MacBook specs** (Apple MacBook Air M5 8, Samsung A11 7, Samsung Tab S10 Lite 10 — saved by the Owner via Spec Upload, Claude read-only verified 2026-10-30). **Tablet/MacBook specifications CLOSED** — no repeat research or upload.
- No specification task is pending. New products get specs only from exact verified official sources with Owner approval.

---

## 9. PDP (product page)

### 9.0 iPhone Product Information + WhatsApp Ask Seller (`4c17c0b`, live DEV + PROD)
Scope: iPhones only (`apple` + `mobile-phones`). Block from the selected variant's stored data: Condition, PTA Status (not_applicable hidden), SIM Type, Battery Health (hidden on New), Warranty (hidden when NULL). Missing facts → field-specific WhatsApp **Ask Seller** (`923132344912`), no customer data. iPhones show warranty only in the block.

### 9.1 iPhone 13 (Used) image sizing (`9176c8d`, closed)
Slug-scoped Cloudinary `e_trim:10` on main image + thumbnails with fallback to the original. Owner verified. The "pink" image has no colour association (shared image) — Owner data fix in Admin Media.

### 9.2 PDP colour ↔ image alignment (`626f0f0`, live DEV + PROD)
Page load selects the primary image's in-stock variant; colour select shows its own image; thumbnail/arrow selects the image's colour **only if in stock in the selected storage** — image browsing never switches storage, variant or price.

### 9.3 Gadgets PDP V3 (`86af7c4`, live DEV + PROD)
See §5A. Gadgets only; uses `src/lib/pdpDescription.ts` (`descriptionParagraphs`, `gadgetWhatsappOrderUrl`, `gadgetDeliveryInfo`).

### 9.4 Premium Mobile PDP (`e63e639`, live DEV + PROD — CLOSED, do not redo)
- **Scope:** category `mobile-phones` only (Android, New iPhone, Used iPhone). `PDP` in `src/StorefrontApp.tsx` sets `isPhonePdp` and adds the class `pdp-page--phone`; every new rule in `src/styles.css` is scoped to it (the floating WhatsApp rules use `body:has(.pdp-page--phone)`). **Gadgets PDP V3 and Tablets & MacBooks PDPs are unchanged** (markup order and styling).
- **Done:** premium gallery (white image card, thumbnails, arrows); purchase panel card (brand, title, navy price, "Save %" pill, stock pill); storage/colour selectors (selected = navy, colour names wrap to 2 lines); iPhone Product Information block restyled (label above value; Ask Seller pill); Add to Cart / Buy Now (equal height, hover/active/disabled/focus states); unified trust card (same wording; single column on mobile); light specification cards (balanced columns — exactly 4 groups sit 2 × 2; narrower label column); Frequently Bought Together light cards; mobile description heading 26 px with tighter spacing.
- **Keyboard order:** on phones Frequently Bought Together is rendered **after** the purchase buttons in the markup (`frequentlyBoughtTogether` const), so visual and Tab order match. Gadgets still render it before the buttons.
- **Discount badge:** `validCompareAt` only returns a compare-at price that exists and is higher than the price; on phones the badge is also hidden when it rounds to 0 % (the struck compare-at price still shows). No fabricated discounts.
- **Mobile WhatsApp:** at ≤600 px on phone PDPs the floating chat button becomes a 30 × 48 px tab docked in the right gutter (same link and label) — 0 overlaps measured at 360/375/390/412/430 px. Other pages keep the round button.
- **Unchanged:** prices, stock, variants, storage/colour selection, colour ↔ image alignment (§9.2), image sizing/fallback, cart, Buy Now/checkout, warranty/PTA/condition/SIM/battery logic, specification data, WhatsApp links, URLs, Supabase queries/RPCs/schema.
- **QA:** localhost harness with a mocked Supabase client (no DEV/PROD connection, no env files; files lived only in the session scratchpad, not in the repo) — desktop/tablet/mobile visual checks, Tab order, discount cases, overlap scan; real Android phone review over LAN (Owner-reported PASS); targeted tests 127/127, typecheck, `build:dev`, `build:prod` PASS; DEV + PROD deploy byte-verified (§4).

### 9.5 Mobile footer, YouTube icon, Feedback-4 (`5b32024`, live DEV + PROD — CLOSED, do not redo)
Storefront-wide (not a PDP change), recorded here with the other storefront UI work.
- **Mobile footer (`src/styles.css`, only inside `@media (max-width:600px)`):** Bank Transfer / Cash on Delivery cards fixed 52 px high with 40 px artwork (a percentage image height did not resolve in the auto-sized grid row, so the 120×44 artwork overflowed the card); cards stretch to the content edges; Policies column spans the full row so its longest link stays on one line; footer bottom padding `84px + env(safe-area-inset-bottom)` keeps the copyright / "Powered by GrowthifyEdge" lines clear of the floating WhatsApp button; `text-wrap:balance` on the copyright. Floating WhatsApp button `right: max(16px, 12px + env(safe-area-inset-right))`. The phone-PDP WhatsApp edge tab (§9.4) is unchanged. Desktop unchanged.
- **YouTube icon (`src/StorefrontApp.tsx` Footer):** the rounded rectangle and the play triangle were two paths filled with the same colour, so the triangle was invisible. Now one path with `fillRule="evenodd"` — the triangle is cut out and shows the button background (white; light orange on hover). Link `https://www.youtube.com/@iSolutionOfficial` and label "YouTube" unchanged; other icons unchanged.
- **Feedback-4 (`public/assets/feedback/Feedback-4.png`, homepage reviews, referenced in `StorefrontApp.tsx`):** served from the repo (not Cloudinary). Replaced by the Owner's corrected image (official iSolutions Pakistan logo on the bag, box and Thank You card), 1122×1402, unchanged by Claude. Other feedback images untouched. Firebase uses its default 1-hour browser cache for it (no custom headers).
- **QA:** localhost 320/360/375/390/430/1440 px (equal 52 px cards, no horizontal overflow, WhatsApp fully in view, Feedback-4 same frame as Feedback-3); Owner real Android QA over LAN PASS (Owner-reported); targeted tests 127/127, typecheck, `build:dev` PASS; DEV + PROD live file checks (§4).

---

## 10. Bulk Import — current design (`7968015`, live DEV + PROD)

`/admin/bulk-import` = **Excel Create-only workflow**: Prepare Import Workbook (product types Mobile Phone, Tablet, Laptop, Accessory, Gadget), Raw stock lines → Generate Excel, Download Blank Template, Upload Excel, preview. Every row is `Create`; new products are **Drafts**; existing products → NEEDS REVIEW, never updated/replaced/hidden. Environment banner; **PROD typed phrase `CREATE <n> PRODUCTS`**. Legacy tools removed from the Admin UI (files remain, unmounted). `apply_catalog_bulk_import_v2` is shared by Android/iPhone/Gadgets/Tablets Stock Updates.
**Note:** Bulk Import code was not changed for Tablets & MacBooks, so it can still create a non-Apple Laptop **draft**; the validator blocks publishing it.

---

## 11. Pending work (each step needs separate Owner approval)

1. **IN PROGRESS (paused until the next session) — Mobile Phones Brand Collections.** The Owner wants better Mobile Phones brand navigation and collections.
   - **Owner-reported screenshot findings (not yet verified by Claude):** the Mobile Phones dropdown lists brands including Samsung, Infinix, Oppo, Vivo, Tecno and iPhone; selecting `Nothing` opened `/shop?brand=nothing`, which showed 0 products and "Try a broader selection". Some brand collection/navigation paths may not be configured yet.
   - **OPEN OWNER DECISION — ask first in the new chat:** should Mobile Phones navigation show **Option A** — only brands with currently published products, or **Option B** — all brands, including those without published products? Not yet chosen.
   - **Do not implement anything until the Owner answers.** Do not assume every brand needs its own collection page; inspect the existing `/shop?brand=…` filtering and brand-navigation code only after the Owner's instruction. Never invent product availability or brand mappings. Then one step at a time (localhost → approval → DEV → PROD).
2. **Pending Owner decision — `www.isolutionspakistan.com`:** still a CNAME to `shops.myshopify.com`. Moving it to Firebase is a separate DNS change that needs explicit Owner approval. **Never change DNS without it.**
3. **Separate, non-blocking diagnostic (not approved for work):** the Owner reported slow banner and product-image loading. Root cause not established. No optimization, image replacement or new module is approved; a read-only diagnosis needs the Owner's go-ahead.
4. **Minor UI maintenance (needs Owner approval):** on the **Gadgets PDP** at mobile width the round floating WhatsApp button can overlap the quantity control / Buy Now (seen during Premium Mobile PDP QA; not changed by `5b32024`).
5. Owner visual checks on live PROD (Claude's browser is blocked on live hosts), optional: Tablets & MacBooks pages/collection with real data; iPhone Product Information block; colour ↔ image alignment.
6. Later (development, each needs approval): image type/rights/labels, A57 naming, Edge 50 Ultra colours, removal of unmounted legacy Bulk Import files and the deprecated code in the 36 entries, optionally retire `CLAUDE_HANDOFF.md`; fix the stale `securityRls.test.mjs` RPC list (separate approval); optional Smart Paste typo handling (e.g. `Gbb`) — not a blocker.

**Not development tasks (Owner decision 2026-10-31):** routine product uploads, stock updates, specifications, images and publishing — the Owner does these in Admin Studio (§2); **Android Mobiles first** (Owner decision 2026-11-01). Catalog data items in that category (the Owner's, whenever the Owner chooses): 17 PROD Android drafts without images/specs; iPhone 13 "pink" image association; verified SIM / Battery Health; replacing low-resolution iPhone images; DEV tablet drafts with `unknown` condition (held; no automatic cleanup).

---

## 12. Decision record — Stock Update per category (done)

The Owner chose **per-category Stock Update pages** in Admin Studio so the website can be updated without Claude: Android, iPhone (New + Used), Gadgets, and Tablets & MacBooks. Each creates new products as drafts through the shared `apply_catalog_bulk_import_v2` and updates existing products through its own all-or-nothing RPC. Bulk Import stays as the Excel Create-only path (e.g. accessories).

---

## 13. Known risks and open decisions

| # | Item | Status |
|---|---|---|
| 1 | A57 blue: DEV `Icyblue`, PROD `Light Blue` | Open — Owner decision later |
| 2 | Edge 50 Ultra (PROD draft) has "Wood" (MB290) and "Nordic Wood" (MB325) | Open — no merge/hide by Claude |
| 3 | CLI linked to PROD | Every linked `supabase` command hits PROD unless `--project-ref` is given. DEV queries/dry-runs/applies use `--linked --project-ref acwatgxkcyrdxpcljxjb` without relinking. Prove the target with a distinguishing count (PROD 0 orders, DEV 8) |
| 4 | Low-resolution iPhone primaries | Deferred; Owner replaces manually |
| 5 | Image type / rights / labels not implemented | Rules followed manually |
| 6 | iPhone 13 "pink" image has no colour association | Owner data fix in Admin Media (optional) |
| 7 | 17 PROD Android drafts lack a primary image (and specs) | Later |
| 8 | Spec sections are phone-oriented | Optional |
| 9 | A lost network response after a save can show "Not saved"/"Check again" | Run Check Changes again to see the true state |
| 10 | SIM is not part of variant identity | Same model/storage/colour with and without "Physical Dual" is held as a duplicate |
| 11 | DEV and PROD SKUs differ | Always name the environment |
| 12 | 36 uncommitted entries | Preserve; deprecated official-source + Realme C75x code, `CLAUDE_HANDOFF.md`, deprecated `AdminApp.tsx` / `admin.css` hunks, two test lines |
| 13 | Header comments of several applied migrations say "NOT YET APPLIED" (incl. `202610260001`, `202610270001`) | Cosmetic; all applied on DEV + PROD — never edit an applied migration |
| 14 | No `.gitattributes`; working-tree `dist/` is not a release build | Always deploy from clean exports |
| 15 | Claude's in-app browser returns "policy check temporarily unavailable" on the live `web.app` hosts and `isolutionspakistan.com` (again 2026-11-01) | Not bypassed. Live checks = byte-identical bundle comparison, public RPC/HTTP checks, local harness/previews; visual live checks are the Owner's |
| 16 | PROD public catalog lists 74 of 82 published Android products | Pre-existing RPC eligibility |
| 17 | DEV has no published iPhone | Real-data iPhone PDP checks only on PROD |
| 18 | Unmounted legacy Bulk Import files remain | Dead code by design until the Owner decides |
| 19 | Bulk Import can create a non-Apple Laptop draft | Cannot be published (validator); Stock Update refuses it |
| 20 | DEV has 4 tablet drafts with condition `unknown` | Held by Tablets & MacBooks Stock Update; no automatic cleanup |
| 21 | Tablet titles get the shared reader's brand prefix ("Samsung Galaxy Tab A8") | An existing product titled differently is not an exact match → new product / look-alike confirmation |
| 22 | `securityRls.test.mjs` authenticated RPC list is stale (lacks gadget + tablet RPCs) | Pre-existing (reproduced on `bdc409c`); not a security regression; anon list passes. Fix only with approval |
| 23 | Smart Paste does not read typo units (`Gbb`) or unit-less dash configs (`8-128`) | Such lines go to Needs Review; optional future work |
| 24 | MacBook Air M5 512 GB correction and Samsung A11 / Tab S10 Lite facts | **Resolved 2026-10-30** — Claude read-only verified (§4) |
| 25 | PROD Samsung titles are "Samsung A11" and "Samsung Tab S10 Lite" (not "Galaxy Tab …") | **Resolved** — specs matched by exact title + product ID (§4) |
| 26 | Bulk Publish on `npm run dev` / DEV hosting writes to the real DEV database | Use Validate Selected freely; Publish Selected only with Owner intent. Localhost review of Admin code uses a mocked-database harness |
| 27 | Bulk Publish publishes one product after another | Large batches take a little time; the page warns before leaving mid-run. A "Failed" result can also mean the publish write happened but the read-back check failed — run Validate Selected again to see the true state |
| 28 | 5 PROD gadget drafts had no images | **Resolved 2026-10-31** — images uploaded and 5/5 published (Owner-reported, §5A) |
| 29 | Gadgets PDP mobile: floating WhatsApp button can overlap quantity / Buy Now | Open — minor UI item, needs Owner approval (§11 #4). Phone PDPs fixed in `e63e639` |
| 30 | Custom domain not live yet | **Resolved 2026-11-01 for the root domain** — A `199.36.158.100`, HTTPS serves the PROD build (§4) |
| 31 | 2026-10-31 PROD counts (103 published + 17 draft) are derived from the Owner's report | Claude has not re-queried PROD since 2026-10-30 |
| 32 | `www.isolutionspakistan.com` still points to Shopify (`shops.myshopify.com`) | Open — Owner decision; DNS change only with explicit approval (§11 #2) |
| 33 | Slow banner / product-image loading (Owner-reported) | Open — root cause unknown; non-blocking diagnostic, nothing approved (§11 #3) |
| 34 | `/shop?brand=nothing` showed 0 products (Owner-reported screenshot) | Part of Mobile Phones Brand Collections; waits for the Option A / B decision (§11 #1) |

---

## 14. How to start a fresh Claude Code chat

First commands (read-only): `git status --short` (expect **36**, or **39** if the 2026-11-01 handover doc edits are still uncommitted), `git log --oneline -3` (expect **`5b32024`**, or a handover-docs commit on top of it), `cat supabase/.temp/project-ref` (expect PROD **`nlxfwppywxumymbjkvwt`**). If anything differs, report it to the Owner before doing anything. Then acknowledge the HEAD and deployments, keep completed work CLOSED, resume **Mobile Phones Brand Collections** by asking the Owner **Option A or Option B** (§11 #1), and start no coding, audit or deployment automatically.

```text
Continue the iSolutions Pakistan Website project. First read PROJECT_HANDOVER.md (updated 2026-11-01), then AGENTS.md.
Roles: I am the Owner (final authority), you are the sole Developer, ChatGPT is the Analyzer/QA.
Rules: short Roman Urdu, one step at a time; no coding without my approval; localhost → my approval → DEV → PROD; every DB write, migration, upload, commit, push and deploy needs my explicit approval in that message; never guess product facts (missing = NULL); preserve the 36 unrelated uncommitted entries; don't repeat completed work or audits; no unrelated cleanup; never bypass a tool or safety block; don't save project information to long-term memory.
Complete on DEV + PROD — do not redo: Android + iPhone Stock Update, manual image upload, Spec Upload, iPhone PDP, 9 Used iPhones published, PDP image fixes, Bulk Import Create-only, Gadgets Stock Update + Gadgets PDP V3 + Home Gadgets, Tablets & MacBooks Stock Update + collection + Smart Paste (228553e), tablet/MacBook specifications (25 on PROD, CLOSED), Admin Catalog Bulk Publish (704dc83, CLOSED), GD005–GD009 images + publishing (CLOSED), Premium Mobile PDP (e63e639, DEV + PROD, CLOSED), Mobile footer + YouTube icon + Feedback-4 (5b32024, DEV + PROD, CLOSED). Migrations: history 66 on DEV and PROD. No pending application deployment. Root domain isolutionspakistan.com is connected to Firebase PROD and serves 5b32024; www still points to Shopify (my decision later; never change DNS without my approval). Routine uploads, stock, specs, images and publishing are mine in Admin Studio — not development tasks; Android Mobiles first.
Start with read-only checks only: git status (expect 36 entries, or 39 if the handover docs are uncommitted), HEAD = 5b32024 (or a handover-docs commit on top), supabase/.temp/project-ref (PROD nlxfwppywxumymbjkvwt).
Current task: Mobile Phones Brand Collections (paused). First ask me: Option A — only brands with published products, or Option B — all brands? Implement nothing until I answer; do not invent brand mappings or product availability. Other pending items (only on my instruction): www decision, slow image-loading diagnostic, Gadgets PDP mobile WhatsApp overlap. Wait for my instruction.
```
