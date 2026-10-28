# iSolutions Pakistan Website — Project Handover

**Prepared:** 2026-10-19 · **Fully updated 2026-10-26** · **Updated 2026-10-29** (Smart Paste rollout, PROD tablet/MacBook uploads, next task = specifications) by Claude Code (Developer) for fresh Claude Code and GPT Analyzer chats.
**Verified from:** git, the code, read-only database queries on PROD and DEV, read-only public RPC calls and HTTP/bundle checks of the live DEV and PROD sites (latest 2026-10-28).
Items marked **(Owner-reported)** were done or seen by the Owner, not by Claude. No passwords, keys or secrets are in this file.

**Source priority:** this file > `GPT_PROJECT_BRIEF.md` > `GPT_ANALYZER_HANDOFF.md` > `CLAUDE_HANDOFF.md` (old long history, last updated 2026-10-16). Claude's auto-memory folder also holds older project notes — they are **not** authoritative (Owner rule: no project facts in long-term memory).

---

## 0. Status at a glance (2026-10-29)

| Area | Status |
|---|---|
| Git | Branch `feature/checkout-orders-shipping`, code HEAD **`228553e`** (Smart Paste parser), pushed (origin = `228553e`, verified 2026-10-28). Not merged to `master`. This 2026-10-29 handover update is **local and uncommitted** until the Owner approves a commit |
| Uncommitted | **36 original entries** — preserve them (§3) — plus the 3 edited handover docs until they are committed (`git status --short` = 39 while uncommitted; 36 after a handover commit) |
| Supabase CLI | **Linked to PROD `nlxfwppywxumymbjkvwt`.** DEV = `acwatgxkcyrdxpcljxjb` |
| Migration history | **DEV 66 and PROD 66**, both ending at `202610270001`. PROD re-verified 2026-10-28 (`supabase migration list`, local = remote). No migration since 2026-10-26 |
| Hosting | **DEV and PROD both run `228553e`** — DEV `index-C21Oa5e_.js`, PROD `index-DD89arGQ.js`. Clean exports, environment guard PASS, served files byte-identical to the builds (verified 2026-10-28, §4) |
| Gadgets Stock Update | **Live DEV + PROD** with writes on DEV + PROD; Gadgets PDP V3 and Home Gadgets collection live (§5A) |
| Tablets & MacBooks Stock Update | **Live DEV + PROD** with writes; **Smart Paste parser live (`228553e`) — CLOSED**; Owner PROD real-data QA PASS for MacBook and Tablets (Owner-reported) (§5B) |
| PROD tablets / MacBooks | Owner uploaded Apple MacBook Air M5, Samsung A11, Samsung Tab S10 Lite (§4, §5B.1). MacBook storage corrected to 512 GB by the Owner — **not yet read-back verified by Claude** |
| Used iPhones | All 9 published on PROD |
| Android / iPhone Stock Update, images, Spec Upload, Bulk Import | Complete. Do not redo |
| **Next task** | **Officially verified specifications** for MacBook Air M5 16/512, Samsung Galaxy Tab A11 8/128, Samsung Galaxy Tab S10 Lite 6/128 + 6/256 (§11 #1). No spec upload or PROD write without Owner approval |

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

---

## 3. Git (verified 2026-10-28)

- **Code HEAD:** `228553e` — "feat: support natural supplier lists in tablet and MacBook stock update" (on top of the 2026-10-26 handover-docs commit `bdc409c`). `origin/feature/checkout-orders-shipping` = `228553e`. The 2026-10-29 handover doc edits are uncommitted.

| Commit | What |
|---|---|
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

**36 uncommitted entries (verified 2026-10-26; still exactly these 36 after the `228553e` commit, verified 2026-10-28). Preserve them.**
- **Modified tracked (5):**
  - `CLAUDE_HANDOFF.md`
  - `src/admin/AdminApp.tsx` — only the deprecated `/admin/specs-images` notice (+19)
  - `src/admin/admin.css` — deprecated preview / image-preview / C75x / batch / owner-decision styles
  - `scripts/specificationBulkUpload.test.mjs` — one extra check that reads the deprecated `fetch-official-sources.mjs`
  - `scripts/securityRls.test.mjs` — one-line local change from the deprecated official-source work. **Known stale test (not a security issue):** its "authenticated" RPC list lacks `apply_gadget_stock_product` and `apply_tablet_stock_product`, so `SECURITY DEFINER RPCs callable by visitors…` fails (full suite 1097/1098). Reproduced on a clean export of `bdc409c` (before Smart Paste); the anon assertion passes. Not modified — fixing it needs its own approval
- **Untracked (31):** deprecated official-source scraping (`src/lib/official*.ts`, `src/lib/robotsTxt.ts`, `src/admin/Official*.tsx`, `src/data/officialSourceSnapshots.json`, `scripts/fetch-official-sources.mjs` + tests); Realme C75x DEV scaffolding (`src/lib/realmeC75x*.ts`, `src/admin/RealmeC75x*.tsx`, `src/data/realmeC75xOfficialSpecs.json`, `scripts/fetch-realme-c75x-specs.mjs` + tests).
- **Ignored local files (not counted):** `scratch/used-iphone-specs/` (excluded via `.git/info/exclude`); `.claude/launch.json` (gitignored; local preview entries).

**Committing from mixed files:** write only the approved file versions into a **temporary index** (`GIT_INDEX_FILE=<tmp> git read-tree HEAD`, `git add -- <files>`, for a partial file `git hash-object -w --path=<file> <prepared copy>` + `git update-index --cacheinfo`), `git commit`, then put the same blobs into the real index so nothing shows as staged. Used for every commit since `9176c8d`.

**Line endings:** no `.gitattributes`, `core.autocrlf=true`. In a fresh Windows `git archive` export two older tests fail only because of CRLF (`androidStockPhoneRpc.test.mjs` and the `homepage_featured_products` check in `phase4.test.mjs`) — not regressions.

---

## 4. Database and hosting state

**Migrations (DEV + PROD, both 66, last `202610270001`):** `202610260001` (Gadgets: `apply_gadget_stock_product` + gadget publishing rule) applied DEV 2026-10-25 and PROD 2026-10-25; `202610270001` (Tablets & MacBooks: `apply_tablet_stock_product` + validator) applied DEV 2026-10-26 and PROD 2026-10-26. Both functions: SECURITY DEFINER, `search_path=""`, `lock_timeout=2s`, execute for `authenticated` only (not anon/public). Current `validate_product_for_publication` md5 = `03ab088f…` on both.

**PROD `nlxfwppywxumymbjkvwt`** (read-only, 2026-10-26, before and after `202610270001` — identical counts and row fingerprints): **112 products** (91 published + 17 draft phones, 4 published gadgets), **401 variants**, **285 images**, 0 orders. No tablet or laptop product yet. Since 2026-10-24 the only PROD catalog changes were the Owner's (Used iPhones published; 4 gadgets added and published — Owner-reported). Claude has made **no PROD product write**.

**PROD tablets / MacBooks (2026-10-28 onward):**
- **Apple MacBook Air M5** — **Claude-verified (read-only PROD query, 2026-10-28, before the Owner's correction):** product `721cab16-78cf-4894-b4d6-f96f6a49e8d3`, slug `apple-macbook-air-m5`, category `laptops`, brand Apple, **published**, 1 primary product-level image (no variant images), 0 specs, 0 order items (PROD orders 0). Three variants, each 16 GB / **256 GB**, New, PTA Not Applicable, Karachi only, warranty NULL, active, stock 20 (one +20 movement each):

  | SKU | Colour | Variant ID | Price |
  |---|---|---|---|
  | MC001 | Skyblue | `0929db0c-e1eb-4104-b89a-337ffef8c5d4` | Rs 397,000 |
  | MC002 | Silver | `805104e2-10e6-42b0-b994-1ce59466a134` | Rs 402,000 |
  | MC003 | Midnight | `e4c0a104-0f50-4fd6-add8-1a08cd339df4` | Rs 397,000 |

  No 512 GB variant existed. **Owner-reported (2026-10-28):** the 256 GB storage was wrong; the Owner corrected all three variants in PROD Admin (variant edit → Storage) to **16 GB / 512 GB** — "Done". Claude's recommended method was this in-place Admin edit (same IDs/SKUs; the Admin save sends no price or stock). **The correction has not yet been read-back verified by Claude** — verify read-only before relying on it.
- **Samsung A11** — Owner-reported: created via Tablets & MacBooks Stock Update; 8 GB / 128 GB, Rs 59,000, Cellular — PTA Approved. Not verified by Claude (title, SKU, publication status, stock unknown to Claude).
- **Samsung Tab S10 Lite** — Owner-reported: created; 6 GB / 128 GB Rs 98,500 and 6 GB / 256 GB Rs 115,000, Cellular — PTA Approved. Not verified by Claude.
- PROD public REST counts (anon, 2026-10-28, after the deploy): 98 visible products, 306 visible variants. No full read-only snapshot was taken this session — do not compare with the 2026-10-26 totals above as if they were the same measure.

**DEV `acwatgxkcyrdxpcljxjb`** (read-only, 2026-10-26, before `202610270001`): 142 products (4 published gadgets + 1 draft gadget "Tecno Watch 3"; 133 phones, 3 published; 4 tablet drafts with condition `unknown`), 446 variants, 220 images, 8 orders. **After that: the Owner created "Apple MacBook Air M5" through Tablets & MacBooks Stock Update — draft, SKU MC001, stock 20, Rs 420,500 (Owner-reported DEV QA PASS).** DEV keeps 3 old Apple test drafts (MB003, MB311, MB312) — leave them.

**Hosting (deployed 2026-10-28 from clean `git archive 228553e` exports, guard PASS, HTML + all 19 top-level asset files byte-identical to the builds):**

| | Commit | Entry bundle | Admin chunk | Supabase in bundle |
|---|---|---|---|---|
| DEV | `228553e` | `index-C21Oa5e_.js` | `AdminApp-D6-Ah9Pr.js` | DEV only (the PROD ref appears only in the environment-table constant, no PROD URL) |
| PROD | `228553e` | `index-DD89arGQ.js` | `AdminApp-Cq8oyAGO.js` | PROD only (0 DEV refs) |

DEV and PROD now run the same commit. iPhone, Gadgets and Tablets write lists are all `["development","production"]`. Previous builds: DEV `1e0add3` (`index-DjbLI84U.js`), PROD `2dd05bd` (`index-DhIwDqh5.js`).

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
- **Data:** DEV 4 published gadgets (Water Nozzle Plastic, Tumbler Stopper, Mini Fan Y05, Crank Chop Blade Chopper (Box Packing)) + 1 draft; PROD 4 published gadgets (Owner-reported, verified in counts).

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
See §4 (Apple MacBook Air M5 MC001–MC003, Samsung A11, Samsung Tab S10 Lite). Only the MacBook was read by Claude; the Samsung products are Owner-reported.

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
11. Audits done — don't repeat: Smart Paste localhost/DEV/PROD verification and the `securityRls` failure classification (2026-10-28); all Android audits; iPhone DEV/PROD verifications; image architecture review; specification workflow audit; Used iPhone readiness/spec verification; iPhone PDP verification; PDP colour-image audit; image-sizing analysis; Bulk Import necessity review; Gadgets DEV/PROD migration snapshots; Tablets & MacBooks read-only review, DEV/PROD migration snapshots and targeted tests (47/47).

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
- **PROD status:** 943 Android + 105 Used iPhone = **1,048** (verified 2026-10-24). Apple MacBook Air M5 had **0 specs** (verified 2026-10-28); Samsung A11 / Tab S10 Lite specs not checked by Claude (none were uploaded by Claude).
- **Next spec task:** §11 #1.

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

---

## 10. Bulk Import — current design (`7968015`, live DEV + PROD)

`/admin/bulk-import` = **Excel Create-only workflow**: Prepare Import Workbook (product types Mobile Phone, Tablet, Laptop, Accessory, Gadget), Raw stock lines → Generate Excel, Download Blank Template, Upload Excel, preview. Every row is `Create`; new products are **Drafts**; existing products → NEEDS REVIEW, never updated/replaced/hidden. Environment banner; **PROD typed phrase `CREATE <n> PRODUCTS`**. Legacy tools removed from the Admin UI (files remain, unmounted). `apply_catalog_bulk_import_v2` is shared by Android/iPhone/Gadgets/Tablets Stock Updates.
**Note:** Bulk Import code was not changed for Tablets & MacBooks, so it can still create a non-Apple Laptop **draft**; the validator blocks publishing it.

---

## 11. Pending work (each step needs separate Owner approval)

1. **NEXT TASK — officially verified specifications** (prepare only; upload needs separate Owner approval):
   1. Apple MacBook Air M5 — 16 GB / 512 GB.
   2. Samsung Galaxy Tab A11 — 8 GB / 128 GB.
   3. Samsung Galaxy Tab S10 Lite — 6 GB / 128 GB and 6 GB / 256 GB.
   - Verify the exact model and configuration on the official manufacturer source. Earlier research flagged configuration mismatches, **especially Tab S10 Lite 6 GB / 256 GB** — never substitute another configuration; report a mismatch to the Owner.
   - Missing or unverified facts stay blank. Use the existing combined Excel **Spec Upload** workflow (§8). No spec upload or PROD write without explicit Owner approval.
   - First, read-only: confirm the exact PROD titles/slugs/variants of these products (the Samsung products and the MacBook 512 GB correction are Owner-reported, not yet verified by Claude).
2. **Owner:** continue PROD uploads through the Stock Update pages, add primary images (Admin Media) and publish. Claude does no PROD product write.
3. Owner visual checks on live PROD (Claude's browser is blocked on live hosts): Gadgets PDP V3 and Tablets & MacBooks pages/collection with real data; iPhone Product Information block; colour ↔ image alignment.
4. Optional, Owner: iPhone 13 "pink" image association; verified SIM / Battery Health in Admin; replace low-resolution iPhone images.
5. Later: DEV tablet drafts with `unknown` condition (held by the Stock Update; no automatic cleanup), Android drafts (17 on PROD without images/specs), image type/rights/labels, A57 naming, Edge 50 Ultra colours, removal of unmounted legacy Bulk Import files and the deprecated code in the 36 entries, optionally retire `CLAUDE_HANDOFF.md`; fix the stale `securityRls.test.mjs` RPC list (separate approval); optional Smart Paste typo handling (e.g. `Gbb`) — not a blocker.

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
| 15 | Claude's in-app browser returns "policy check temporarily unavailable" on the live `web.app` hosts | Not bypassed. Live checks = byte-identical bundle comparison, public RPC/HTTP checks, local harness/previews; visual live checks are the Owner's |
| 16 | PROD public catalog lists 74 of 82 published Android products | Pre-existing RPC eligibility |
| 17 | DEV has no published iPhone | Real-data iPhone PDP checks only on PROD |
| 18 | Unmounted legacy Bulk Import files remain | Dead code by design until the Owner decides |
| 19 | Bulk Import can create a non-Apple Laptop draft | Cannot be published (validator); Stock Update refuses it |
| 20 | DEV has 4 tablet drafts with condition `unknown` | Held by Tablets & MacBooks Stock Update; no automatic cleanup |
| 21 | Tablet titles get the shared reader's brand prefix ("Samsung Galaxy Tab A8") | An existing product titled differently is not an exact match → new product / look-alike confirmation |
| 22 | `securityRls.test.mjs` authenticated RPC list is stale (lacks gadget + tablet RPCs) | Pre-existing (reproduced on `bdc409c`); not a security regression; anon list passes. Fix only with approval |
| 23 | Smart Paste does not read typo units (`Gbb`) or unit-less dash configs (`8-128`) | Such lines go to Needs Review; optional future work |
| 24 | MacBook Air M5 512 GB correction and Samsung A11 / Tab S10 Lite facts are Owner-reported | Verify read-only before using them in specs |
| 25 | The PROD Samsung titles may be "Samsung A11" (as pasted) rather than "Samsung Galaxy Tab A11" | Unverified — check the exact title before spec matching (Spec Upload matches exactly) |

---

## 14. How to start a fresh Claude Code chat

First commands (read-only): `git status --short` (expect **36**, or **39** if the 2026-10-29 handover doc edits are still uncommitted), `git log --oneline -3` (expect **`228553e`**, or a handover-docs commit on top of it), `cat supabase/.temp/project-ref` (expect PROD **`nlxfwppywxumymbjkvwt`**). If anything differs, report it to the Owner before doing anything.

```text
Continue the iSolutions Pakistan Website project. First read PROJECT_HANDOVER.md (updated 2026-10-29), then AGENTS.md.
Roles: I am the Owner (final authority), you are the sole Developer, ChatGPT is the Analyzer/QA.
Rules: short Roman Urdu, one step at a time; no coding without my approval; localhost → my approval → DEV → PROD; every DB write, migration, commit, push and deploy needs my explicit approval in that message; never guess product facts; preserve uncommitted changes; don't repeat completed work or audits; never bypass a safety block; don't save project information to long-term memory.
Complete on DEV + PROD — do not redo: Android + iPhone Stock Update, manual image upload, Spec Upload, iPhone PDP, 9 Used iPhones published, PDP image fixes, Bulk Import Create-only, Gadgets Stock Update + Gadgets PDP V3 + Home Gadgets, Tablets & MacBooks Stock Update + collection + Smart Paste parser (228553e, DEV + PROD) (migrations 202610260001 and 202610270001; history 66 on DEV and PROD).
Start with read-only checks only: git status (expect 36 entries, or 39 if the handover docs are uncommitted), HEAD = 228553e (or a handover-docs commit on top), supabase/.temp/project-ref (PROD nlxfwppywxumymbjkvwt).
Next task: officially verified specifications for MacBook Air M5 16/512, Samsung Galaxy Tab A11 8/128, Samsung Galaxy Tab S10 Lite 6/128 + 6/256 (PROJECT_HANDOVER.md §11 #1). Verify exact configurations; blank stays blank; no upload without my approval. Wait for my instruction.
```
