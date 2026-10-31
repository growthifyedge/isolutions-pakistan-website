# iSolutions Pakistan Website — Project Brief for ChatGPT (Analyzer)

**Prepared:** 2026-10-18 · **Fully updated 2026-10-26** · **Updated 2026-10-29** · **Updated 2026-10-30** · **Updated 2026-10-31** · **Updated 2026-11-01** by Claude Code (Developer) for the Owner.
**Source of truth:** `PROJECT_HANDOVER.md` (updated 2026-11-01) wins on any conflict. Items marked **(Owner-reported)** were done or seen by the Owner, not by Claude.
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
| **Primary images + publishing for 5 PROD gadgets** (GD005–GD009) | **CLOSED** — 5/5 images uploaded and verified on PROD, 5/5 Ready, 5/5 published, 0 failed; Home Gadgets collection checked (Owner-reported 2026-10-31). No repeat |
| **Premium Mobile PDP** (Android, New iPhone, Used iPhone) | **CLOSED — live DEV + PROD** (`e63e639`, frontend only, no migration); Owner desktop + real Android mobile review PASS; real PROD Android mobile PDP OK (Owner-reported). No repeat development, audit or deployment |
| **Mobile footer + YouTube icon + Feedback-4** (payment cards, Policies layout, footer spacing, WhatsApp safe area, YouTube play symbol, corrected Feedback-4 branding image) | **CLOSED — live DEV + PROD** (`5b32024`, frontend only, no migration); Owner real Android footer QA PASS, Owner confirmed everything looks good (Owner-reported). Do not reopen or repeat its QA |
| **Custom domain `isolutionspakistan.com`** (GoDaddy → Firebase PROD) | **Root domain CONNECTED** (2026-11-01) — §6. `www` still Shopify (pending Owner decision) |
| **Mobile Phones Brand Collections** | **IN PROGRESS — paused on an Owner decision (Option A / B)** — §7 |
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
- **Premium Mobile PDP (`e63e639`):** styling scoped to `mobile-phones` only (class `pdp-page--phone`); Gadgets PDP V3 and Tablets & MacBooks unchanged. On phones Frequently Bought Together sits after Add to Cart / Buy Now (visual = keyboard order); discount badge only from a valid compare-at price higher than the price, hidden when it rounds to 0 %; mobile floating WhatsApp is a slim edge tab on phone PDPs (same link). Prices, stock, variants, colour ↔ image alignment, cart, checkout and backend unchanged.
- **Catalog operations are the Owner's (decision 2026-10-31):** routine uploads, stock updates, specifications, images and publishing are done by the Owner in Admin Studio (Stock Update pages, Media, Spec Upload, Bulk Publish). They are not development tasks; those modules stay CLOSED. **Android Mobiles is the first category selected for product uploading** (Owner decision 2026-11-01). Product information is never guessed; missing stays NULL.
- **Storefront footer (`5b32024`):** on mobile (≤600 px) the Bank Transfer / Cash on Delivery cards are equal 52 px with contained artwork, Policies spans the full row, the copyright area keeps space (incl. safe area) above the floating WhatsApp button, which respects the right safe area; YouTube icon shows a cut-out play symbol (same link and label); `Feedback-4.png` is the Owner's corrected image with the official logo. Desktop and the phone-PDP WhatsApp edge tab unchanged.

---

## 6. Current state (2026-11-01; Claude-verified unless marked Owner-reported)

**Git:** branch `feature/checkout-orders-shipping`, HEAD **`5b32024`** (mobile footer, YouTube icon, Feedback-4: `src/styles.css`, `src/StorefrontApp.tsx`, `public/assets/feedback/Feedback-4.png`) on top of the handover-docs commit `0813fc5` (which follows `e63e639` Premium Mobile PDP); pushed — local and origin both `5b32024`; no staged changes; not merged to `master`. **36 uncommitted entries** (deprecated official-source scraping, Realme C75x scaffolding, old `CLAUDE_HANDOFF.md`, deprecated `/admin/specs-images` notice in `AdminApp.tsx`, deprecated admin styles, two old test lines) — the same 36 before and after `5b32024`; preserve them. The 2026-11-01 handover doc edits are uncommitted until the Owner approves a commit.
**Supabase CLI:** linked to **PROD** (verified 2026-11-01). **Migration history:** **DEV 66 and PROD 66** (last `202610270001`, last queried 2026-10-30). No migration for Smart Paste, Bulk Publish, Premium Mobile PDP or the footer fix.
**Hosting (2026-11-01):** **DEV and PROD both run `5b32024`** — DEV `index-Df-LmKmr.js` / `AdminApp-bByDaa3O.js`; PROD `index-CKMM72rE.js` / `AdminApp-ItkWqdLa.js`; same CSS `index-DB5UrX-t.css`. Clean `git archive` exports, environment guard PASS, DEV verified before PROD; each wired only to its own Supabase; live `Feedback-4.png` byte-identical to the commit, YouTube fix and footer CSS present in the live files. Footer task: targeted tests 127/127, typecheck, `build:dev` PASS. Claude could not render live pages at phone widths (browser policy); Owner checked visually (Owner-reported). **No pending application deployment.**
**Custom domain — root CONNECTED:** `isolutionspakistan.com` (GoDaddy DNS) → Firebase PROD `isolutions-pakistan-production`. **Claude-verified 2026-11-01:** root A `199.36.158.100`; HTTPS works and serves the `5b32024` PROD build; `www` CNAME → `shops.myshopify.com` (still Shopify); `portal` A `76.76.21.21`. **Owner-reported:** Firebase status Connected, SSL issued. `www` migration = separate pending Owner decision; never change DNS without explicit approval.
**Known baseline test failures (outside scope, don't re-investigate):** in a clean export exactly 3 fail, identical before and after `704dc83` — the stale `securityRls.test.mjs` authenticated RPC list (lacks gadget + tablet RPCs; not a security regression) and two CRLF-only failures (`androidStockPhoneRpc.test.mjs`, `homepage_featured_products` in `phase4.test.mjs`).

**PROD catalog (Claude read-only, 2026-10-30):** 120 products = 98 published + 22 draft (17 Android + 5 gadgets); 0 orders. **Since then (Owner-reported 2026-10-31, not re-queried by Claude):** GD005–GD009 published → expected 103 published + 17 draft.
- **Apple MacBook Air M5** — published; MC001 Skyblue Rs 397,000 · MC002 Silver Rs 402,000 · MC003 Midnight Rs 397,000; all **16 GB / 512 GB** (Owner correction confirmed); stock 20 each; **8 specs**.
- **Samsung A11** (exact PROD title) — published; IP001 8 GB / 128 GB Rs 59,000; stock 20; **7 specs**.
- **Samsung Tab S10 Lite** (exact PROD title) — published; **IP002 6 GB / 128 GB** Rs 98,500 · **IP003 8 GB / 256 GB** Rs 115,000; stock 20 each; **10 specs**.
- Compared with a read-only snapshot taken before the Owner's changes: prices, stock, media, SKUs and status unchanged; only the S10 Lite RAM values and the 25 specs changed. **Owner-reported:** Admin read-back and screenshots of the PROD variants and customer-facing spec sections checked. **Specifications task CLOSED.**
- **5 gadgets** (Owner-added 2026-10-29 via Gadgets Stock Update): GD005 PU Leather Passport Holder Rs 400 · GD006 Baby water play mat Rs 350 · GD007 Hair straightener Rs 900 · GD008 USB Dynamic Water Pattern Lamp 16 Colours with Remote Rs 950 · GD009 Kitchen Oil filter Pot 1.4 liter Rs 800 — each 1 variant, stock 20, nationwide. Drafts with 0 images on 2026-10-30 (Claude-verified); **images uploaded and 5/5 published on 2026-10-31 (Owner-reported) — CLOSED.**

**Bulk Publish QA (Owner-reported):** DEV — 136 Drafts selected → 55 Ready, 81 Needs Review; separate 3-product check → all 3 blocked (missing Primary Image). PROD — 3 new gadgets → 0 Ready, 3 Needs Review (missing Primary Image); Publish Selected (0) correctly disabled. No product published during QA.
**DEV:** 4 published gadgets; 4 old tablet drafts with condition `unknown` (held, untouched); Owner QA MacBook Air M5 draft (MC001, Owner-reported).

**Verification limits (be accurate):**
- Claude's in-app browser is blocked on the live `web.app` hosts; Claude does not bypass it. Live checks are bundle comparisons, public RPC/HTTP checks and local harnesses/previews.
- Owner visual checks still useful on PROD with real data (optional): Tablets & MacBooks page/collection, iPhone Product Information block, colour-image alignment. Premium Mobile PDP: real PROD Android mobile PDP checked OK by the Owner (Owner-reported).

---

## 7. Pending work

1. **IN PROGRESS (paused) — Mobile Phones Brand Collections.** Owner wants better Mobile Phones brand navigation/collections. **Owner-reported screenshot findings (not yet verified by Claude):** the Mobile Phones dropdown lists brands incl. Samsung, Infinix, Oppo, Vivo, Tecno, iPhone; `Nothing` opened `/shop?brand=nothing` with 0 products and "Try a broader selection"; some brand paths may not be configured. **OPEN OWNER DECISION — ask first:** **Option A** = show only brands with currently published products; **Option B** = show all brands, incl. those without published products. Not chosen yet. **Nothing is implemented until the Owner answers.** Don't assume each brand needs its own collection page; Claude inspects the existing `/shop?brand=…` filtering and brand navigation only on the Owner's instruction; never invent product availability or brand mappings. Then one step at a time.
2. **Pending Owner decision — `www.isolutionspakistan.com`** (still Shopify): DNS change only with explicit approval.
3. **Separate, non-blocking diagnostic:** Owner reported slow banner and product-image loading; root cause not established; no optimization, replacement or module approved.
4. **Minor UI maintenance (needs Owner approval):** Gadgets PDP at mobile width — the round floating WhatsApp button can overlap the quantity control / Buy Now (seen during Premium Mobile PDP QA, outside its phone-only scope; not changed by `5b32024`).
5. Optional development (approval needed): fix the stale `securityRls.test.mjs` list; Smart Paste typo handling (e.g. `Gbb`); image type/rights/labels; A57 naming; Edge 50 Ultra colours; removal of unmounted legacy Bulk Import files and other deprecated code.

**Not development tasks (Owner decision 2026-10-31):** routine uploads, stock updates, specifications, images and publishing — the Owner does them in Admin Studio (e.g. 17 PROD Android drafts without images/specs, iPhone 13 pink image association, verified SIM / Battery Health, replacing low-resolution iPhone images, DEV tablet drafts with `unknown` condition). Don't list them as pending development work.

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
- **DNS:** the root domain is connected to Firebase; never suggest changing `www`, `portal` or any other record without an explicit Owner decision and approval.
- **Brand collections:** don't propose a fix before the Owner picks Option A or B; don't assume brand mappings or stock.
- **Scope creep on PDPs:** phone PDP styling is scoped to `pdp-page--phone`; changes for Gadgets or Tablets PDPs need their own approval.

---

## 9. Standard workflow

1. Owner explains the need → GPT analyzes and asks one question at a time.
2. Owner approves → GPT writes a precise Claude prompt (only when asked).
3. Claude inspects read-only, builds on localhost, runs relevant checks, reports.
4. Owner shares Claude's report → GPT reviews (QA, gaps, risks).
5. Owner approves the named actions → DEV → verify → PROD → verify; commit/push/deploy only as approved.
