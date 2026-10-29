# iSolutions Pakistan Website — Project Brief for ChatGPT (Analyzer)

**Prepared:** 2026-10-18 · **Fully updated 2026-10-26** · **Updated 2026-10-29** · **Updated 2026-10-30** by Claude Code (Developer) for the Owner.
**Source of truth:** `PROJECT_HANDOVER.md` (updated 2026-10-30) wins on any conflict. Items marked **(Owner-reported)** were done or seen by the Owner, not by Claude.
**Purpose:** complete context for ChatGPT to act as **Analyzer / QA reviewer** in a fresh chat.

---

## 1. Roles and working rules (MANDATORY)

| Role | Who | Responsibility |
|---|---|---|
| **Owner** | Muhammad Junaid | Final authority. Approves every phase, DB write, migration, commit, push, deploy and PROD action. |
| **Developer** | Claude Code (sole developer) | Writes all code, migrations and tests; runs builds/tests and read-only checks; executes only what the Owner approves. |
| **Analyzer / QA** | ChatGPT | Analyzes requirements, reviews Claude's plans and reports, finds risks and gaps, and writes precise Claude prompts **only when the Owner asks**. Does not write production code. |

**Rules for the Analyzer**
1. **Short Roman Urdu, one step at a time.** Ask one useful question at a time.
2. **The Owner decides.** Give a recommendation, then wait. No Claude prompt until the Owner asks for one.
3. **Never guess product facts** (price, PTA, condition, SIM, warranty, specs, images, battery). Blank stays blank (NULL). No similar-model matching.
4. **Don't invent codebase details.** Claude's latest verified report wins over memory.
5. Safety gates every Claude prompt must keep:
   - **localhost → Owner approval → DEV → PROD**; never skip.
   - **Explicit Owner approval for every DB write, migration, upload, commit, push and deployment** (the Owner may approve several named actions in one message).
   - Read-only snapshot/dry-run before a write; read-back verification after.
   - Preserve uncommitted changes (no cleanup/reset/stash/discard); never delete catalog data.
   - Deploy only committed code from a clean export; commit mixed files through a temporary Git index.
   - Never request or expose secrets; Claude never signs in as the Owner and never clicks Update Website / Save / Publish / Create.
   - If a Claude safety check or tool policy blocks a command: stop and report, never bypass.
6. Preserve the approved design and business rules; don't propose redesigns or unnecessary features.
7. **Don't ask Claude to repeat completed work, audits or tests** (§4, §6).
8. **Don't save project information in long-term memory**; use these files.
9. Output format: (a) short summary, (b) risks/gaps, (c) recommendation, (d) one question for the Owner, (e) Claude prompt only if the Owner asked.

---

## 2. What the project is

**iSolutions Pakistan** — e-commerce site for a Karachi mobile phone and gadget retailer: new and used phones (Android + iPhone), iPads/tablets, Apple MacBooks (no Windows laptops), gadgets and accessories. Checkout: Cash on Delivery / Bank Transfer. The Owner manages everything in a custom **Admin Studio**. Fresh build; the old Shopify store is reference only.

---

## 3. Architecture (locked)

- React + Vite + TypeScript (storefront + `/admin`), Firebase Hosting (DEV + PROD), Supabase (PostgreSQL + Auth + RLS + Edge Functions), Cloudinary images (metadata only in Postgres). No Cloudflare/OpenNext/Vercel.
- DEV Supabase `acwatgxkcyrdxpcljxjb`, PROD `nlxfwppywxumymbjkvwt`. Hosting: DEV `isolutions-development-cb1ea.web.app`, PROD `isolutions-pakistan-production.web.app`.
- Storefront reads only through security-definer RPCs that return published, real, active data.
- Money in paisa; stock = ledger; server SKUs by category (`MB` phones, `AC` accessories, `GD` gadgets, `IP` tablets, `MC` MacBooks); DEV and PROD SKUs independent. Publishing needs a valid primary image and resolved variant facts.
- Categories: `gadgets` (top level) with children `tablets` and `laptops`; `mobile-phones`; `mobile-accessories`. Slugs are not renamed.
- `npm run build:dev` / `build:prod`; a predeploy guard checks the bundle matches the Firebase target.

---

## 4. Phase history

| Work | Status |
|---|---|
| Phases 0–3B, Phase 4 real catalog (Owner-approved facts only) | Done / ongoing catalog work |
| Checkout & Orders + Shipping | Implemented and locked |
| Android Stock Update | **Complete DEV + PROD** (`5ad4a4d`) |
| iPhone New + Used Stock Management | **Complete DEV + PROD** |
| Used iPhone warranty rule | **Complete DEV + PROD** (migration `202610220001`) |
| Manual image upload | **Live DEV + PROD** (`9f73bd6`) |
| Global Excel/CSV Spec Upload | **Live DEV + PROD** (`f43d936`) |
| iPhone PDP Product Information + WhatsApp Ask Seller | **Live DEV + PROD** (`4c17c0b`) |
| All 9 Used iPhones published on PROD; iPhone 13 image fixes; PDP colour ↔ image alignment | **Done** |
| Bulk Import simplification (Excel Create-only) | **Live DEV + PROD** (`7968015`) |
| **Gadgets Stock Update + Gadgets PDP V3 + Home Gadgets collection** | **Live DEV + PROD, writes DEV + PROD** (`1463f8d` … `d3dd1de`, migration `202610260001`) |
| **Tablets & MacBooks Stock Update + "Tablets & MacBooks" collection** | **Live DEV + PROD, writes DEV + PROD** (`1e0add3`, `2dd05bd`, migration `202610270001`); **Owner DEV real-write QA PASS** |
| **Tablets & MacBooks Smart Paste parser** (natural supplier/WhatsApp lists) | **CLOSED — live DEV + PROD** (`228553e`, no migration); Owner PROD real-data QA PASS for MacBook and Tablets (Owner-reported) |
| **Tablet / MacBook specifications** (MacBook Air M5 8, Samsung A11 7, Samsung Tab S10 Lite 10 = 25 on PROD) + S10 Lite RAM correction | **CLOSED** — Claude read-only verified 2026-10-30; Owner screenshots checked (Owner-reported). No repeat research or upload |
| **Admin Catalog Bulk Publish** (all categories) | **CLOSED — live DEV + PROD** (`704dc83`, no migration); Owner DEV + PROD QA PASS (Owner-reported) |
| **Primary images + publishing for 5 PROD gadget drafts** (GD005–GD009) | **NEXT TASK** (§7) |
| Customer accounts, card/installment gateways, promotions, commerce at scale, internal live chat | Not authorized |

---

## 5. Locked business rules

- **Checkout:** server-side `create_storefront_order`; COD and Bank Transfer only.
- **Shipping:** below Rs 10,000 → Standard Rs 200, Fast Rs 400; Rs 10,000+ → Standard free, Fast Rs 200.
- **Delivery:** mobile phones Karachi only; **iPads, tablets and MacBooks Karachi only**; gadgets/accessories nationwide; any cart with a Karachi-only item becomes Karachi-only.
- **Android:** PTA Approved, Brand New, 1 Year warranty, Karachi only. Stock Update: latest list is the truth; listed variants → list price, visible, stock 30; missing variants hidden (never deleted).
- **iPhone Stock:** New and Used separate products (`… (Used)` title); exact-title matching, else held. New variants/phones stock 20 (drafts); existing variants price only; missing variants untouched. Condition/PTA only from the Owner; grade/battery/cycles/warranty/RAM NULL.
- **Gadgets Stock:** category `gadgets` only; Excel Product Name / Price / Description (Owner's text); existing gadget → price and/or description, stock never changes; new gadget → draft, stock 20, nationwide. Gadgets publish without PTA, condition or warranty.
- **Tablets & MacBooks Stock:** Owner chooses Product Type (iPad / Tablet / MacBook), New/Used and Connectivity (WiFi / Cellular PTA Approved / Cellular Non-PTA; not for MacBooks). iPad → `tablets` + Apple; Tablet → `tablets` (non-Apple); MacBook → `laptops` + Apple. **Windows laptops never added; a non-Apple laptop cannot be published.** New/Used separate (`(Used)` title); exact-title matching; variant = RAM + storage + colour + PTA + condition; new variants/products: draft, stock 20, Karachi only, warranty NULL; existing: price / show again, stock kept; missing untouched. PTA: WiFi and MacBook → Not Applicable; Cellular → Owner-chosen. Unclear connectivity, unknown brands, ambiguous price pairing → Needs Review. **Smart Paste** (`228553e`): the Owner pastes supplier text as-is — model + RAM/storage heading then one colour + price per line; one-line entries followed by more storage lines of the same model; `@`, `-`, `;`, `:`, `Rs`, commas, blank lines. Ambiguous lines still go to Needs Review; unknown colours still need the Owner's "Keep".
- **Warranty:** Used iPhones — none (NULL allowed). New iPhones — 1 or 2 years, Owner-confirmed only. **Tablets/iPads/Apple MacBooks — optional (New + Used).** Gadgets — not required. Android rules unchanged.
- **Images (all categories):** official manufacturer image = Primary; Owner's actual photos = Secondary; exact model/colour; usage rights verified; manual upload only; original-resolution files. An image's colour comes only from its stored variant association in Admin Media.
- **Specifications:** Owner-approved facts from verified official sources only; missing stays blank; Stock Updates never create specs; Spec Upload is the only spec workflow.
- **SIM values:** physical_sim, esim, physical_plus_esim, dual_esim, dual_physical_sim; blank = NULL.
- **iPhone PDP:** Product Information block (Condition, PTA, SIM, Battery Health, Warranty) + WhatsApp **Ask Seller** to **923132344912**.
- **Gadgets PDP V3:** "About This Product" (Owner's text exactly), **Order on WhatsApp** (product, variant, quantity, price, link; no customer data, no website order), delivery card from the stored scope and checkout constants.
- **PDP image browsing never changes storage, variant or price.**
- **Bulk Import = Excel Create-only:** drafts; existing products never updated; PROD typed phrase `CREATE <n> PRODUCTS`.
- **Bulk Publish (Admin → Catalog, all categories):** checkboxes on Draft rows only; Select all drafts; **Validate Selected** runs the existing server validator and never writes (Ready to Publish / Needs Review with exact reason); **Publish Selected** only Ready products, after a current validation, with a confirmation naming environment, count and products (PROD typed `PUBLISH <n>`). Each product is re-validated server-side right before its write (only `publication_status` changes; the `products_enforce_publication` trigger enforces it again); failures stay Draft and never block others. All category publishing rules come from the server validator.
- **"100% Authentic — Official Product"** card wording stays unchanged on all products.

---

## 6. Current state (2026-10-30; Claude-verified unless marked Owner-reported)

**Git:** branch `feature/checkout-orders-shipping`, code HEAD **`704dc83`** (Admin Catalog Bulk Publish: `src/lib/catalogBulkPublish.ts`, `src/admin/CatalogBulkPublish.tsx`, `src/admin/AdminCatalog.tsx`, the Bulk Publish CSS block of `src/admin/admin.css`, `scripts/catalogBulkPublish.test.mjs`), pushed (origin = `704dc83`), not merged to `master`. **36 uncommitted entries** (deprecated official-source scraping, Realme C75x scaffolding, old `CLAUDE_HANDOFF.md`, deprecated `/admin/specs-images` notice in `AdminApp.tsx`, deprecated admin styles, two old test lines) — preserved through the `704dc83` commit; preserve them. The 2026-10-30 handover doc edits are uncommitted until the Owner approves a commit.
**Supabase CLI:** linked to **PROD**. **Migration history:** **DEV 66 and PROD 66** (last `202610270001`). No migration for Smart Paste or Bulk Publish.
**Hosting (2026-10-30):** **DEV and PROD both run `704dc83`** — DEV `index-Dy6lNz3x.js` / `AdminApp-BPbAmIRi.js`; PROD `index-BEfpA1IP.js` / `AdminApp-Ca7_0WNY.js`. Clean `git archive` exports, environment guard PASS (and BLOCKED for the wrong target), live HTML and bundles byte-identical to the tested builds; each wired only to its own Supabase. Bulk Publish tests 28/28 PASS; typecheck, lint, `build:dev`, `build:prod` PASS.
**Known baseline test failures (outside scope, don't re-investigate):** in a clean export exactly 3 fail, identical before and after `704dc83` — the stale `securityRls.test.mjs` authenticated RPC list (lacks gadget + tablet RPCs; not a security regression) and two CRLF-only failures (`androidStockPhoneRpc.test.mjs`, `homepage_featured_products` in `phase4.test.mjs`).

**PROD catalog (Claude read-only, 2026-10-30):** 120 products = 98 published + 22 draft (17 Android + 5 gadgets); 0 orders.
- **Apple MacBook Air M5** — published; MC001 Skyblue Rs 397,000 · MC002 Silver Rs 402,000 · MC003 Midnight Rs 397,000; all **16 GB / 512 GB** (Owner correction confirmed); stock 20 each; **8 specs**.
- **Samsung A11** (exact PROD title) — published; IP001 8 GB / 128 GB Rs 59,000; stock 20; **7 specs**.
- **Samsung Tab S10 Lite** (exact PROD title) — published; **IP002 6 GB / 128 GB** Rs 98,500 · **IP003 8 GB / 256 GB** Rs 115,000; stock 20 each; **10 specs**.
- Compared with a read-only snapshot taken before the Owner's changes: prices, stock, media, SKUs and status unchanged; only the S10 Lite RAM values and the 25 specs changed. **Owner-reported:** Admin read-back and screenshots of the PROD variants and customer-facing spec sections checked. **Specifications task CLOSED.**
- **5 new gadget drafts** (Owner-added 2026-10-29 via Gadgets Stock Update): GD005 PU Leather Passport Holder Rs 400 · GD006 Baby water play mat Rs 350 · GD007 Hair straightener Rs 900 · GD008 USB Dynamic Water Pattern Lamp 16 Colours with Remote Rs 950 · GD009 Kitchen Oil filter Pot 1.4 liter Rs 800 — each 1 variant, stock 20, nationwide, **0 images**, draft.

**Bulk Publish QA (Owner-reported):** DEV — 136 Drafts selected → 55 Ready, 81 Needs Review; separate 3-product check → all 3 blocked (missing Primary Image). PROD — 3 new gadgets → 0 Ready, 3 Needs Review (missing Primary Image); Publish Selected (0) correctly disabled. No product published during QA.
**DEV:** 4 published gadgets; 4 old tablet drafts with condition `unknown` (held, untouched); Owner QA MacBook Air M5 draft (MC001, Owner-reported).

**Verification limits (be accurate):**
- Claude's in-app browser is blocked on the live `web.app` hosts; Claude does not bypass it. Live checks are bundle comparisons, public RPC/HTTP checks and local harnesses/previews.
- Owner visual checks still useful on PROD with real data: Gadgets PDP V3, Tablets & MacBooks page/collection, iPhone Product Information block, colour-image alignment.

---

## 7. Pending work

1. **NEXT TASK — primary images + publishing for the 5 PROD gadget drafts** (GD005–GD009, §6):
   - Owner uploads **actual verified primary images** (original-resolution, exact product) in **Admin → Media**. No automatic image discovery, scraping or publishing.
   - Then Admin → Catalog → tick the drafts → **Validate Selected** → **Publish Selected** only for Ready products (PROD typed `PUBLISH <n>`). Needs Review products stay Draft.
   - Claude: read-only checks only when the Owner asks; no PROD product write, upload or publish by Claude.
2. Owner: further PROD uploads, primary images and publishing via Bulk Publish. No Claude PROD product write.
3. Owner visual checks listed in §6.
4. Optional: iPhone 13 pink image association; verified SIM / Battery Health; replace low-resolution iPhone images; fix the stale `securityRls.test.mjs` list (approval needed); Smart Paste typo handling (e.g. `Gbb`) — not a blocker.
5. Later: DEV tablet drafts with `unknown` condition, Android drafts (17 on PROD), image type/rights/labels, A57 naming, Edge 50 Ultra colours, removal of unmounted legacy Bulk Import files and other deprecated code.

---

## 8. Risks to watch

- **CLI linked to PROD** — every Claude instruction must name the expected project ref; DEV work uses `--project-ref acwatgxkcyrdxpcljxjb` without relinking.
- **Data guessing** is the biggest risk: reject any plan that infers specs, prices, PTA, SIM, warranty, battery, connectivity, colour associations or images.
- **Environment mix-up:** DEV and PROD SKUs differ; confirm the environment before any write.
- **Mixed uncommitted files:** commit only approved lines through a temporary index; `AdminApp.tsx` still holds an unrelated uncommitted `/admin/specs-images` hunk.
- **Bulk Import** can still create a non-Apple Laptop draft (it cannot be published).
- **Titles:** Stock Updates and Spec Upload match exact titles only (e.g. the PROD titles are "Samsung A11", "Samsung Tab S10 Lite", "Kitchen Oil filter Pot 1.4 liter" — exactly as stored).
- **Bulk Publish on DEV writes the real DEV database** (`npm run dev` and DEV hosting) — Validate Selected is always safe; Publish Selected only with Owner intent. A "Failed" result can also mean the write happened but the read-back failed — Validate again to see the true state.
- **Owner-reported vs verified:** keep the label on every result; the Owner's Bulk Publish QA counts and screenshots are Owner-reported.
- **Claude's safety check or browser policy may block actions** — stop and report, never bypass.

---

## 9. Standard workflow

1. Owner explains the need → GPT analyzes and asks one question at a time.
2. Owner approves → GPT writes a precise Claude prompt (only when asked).
3. Claude inspects read-only, builds on localhost, runs relevant checks, reports.
4. Owner shares Claude's report → GPT reviews (QA, gaps, risks).
5. Owner approves the named actions → DEV → verify → PROD → verify; commit/push/deploy only as approved.
