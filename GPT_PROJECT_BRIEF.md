# iSolutions Pakistan Website — Project Brief for ChatGPT (Analyzer)

**Prepared:** 2026-10-18 · **Fully updated 2026-10-26** · **Updated 2026-10-29** · **Updated 2026-10-30** · **Updated 2026-10-31** · **Updated 2026-11-01** · **Updated 2026-11-02** by Claude Code (Developer) for the Owner.
**Source of truth:** `PROJECT_HANDOVER.md` (updated 2026-11-02) wins on any conflict. Items marked **(Owner-reported)** were done or seen by the Owner, not by Claude.
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
| **Custom domain `isolutionspakistan.com`** (GoDaddy → Firebase PROD) | **Root domain CONNECTED** (2026-11-01) — §6. Intermittent DNS / NXDOMAIN issue on HOLD. `www` still Shopify (pending Owner decision) |
| **Mobile Phones Brand Collections** (Owner decision **Option B**: all 14 configured brands — Samsung, Infinix, Oppo, Vivo, Tecno, iPhone, Xiaomi, Motorola, Honor, Nothing, Google, Realme, itel, OnePlus) | **CLOSED — live DEV + PROD** (`4a32f22`, frontend only). Brands open `/shop?brand=<slug>&category=mobile-phones`; **iPhone keeps its New / Used collection** |
| **Premium Collection Headers** (collection pages + Mobile Phones brand pages: breadcrumb, "<Brand> Phones", product count) | **CLOSED — live DEV + PROD** (`ec00985`); Owner visually approved (Owner-reported) |
| **Homepage Performance Phase 1** (27 optimized WebP assets — 14 banners, logo, 12 category images, PNG originals kept — and a reliable banner carousel) | **CLOSED — live DEV + PROD** (`1c1819c`, test fix `31f24ca`); Owner confirmed performance and visuals satisfactory (Owner-reported) |
| **PROD Android status check + published image-quality audit** (read-only) | **Done 2026-11-02 — do not repeat** (§6) |
| **Product Image Corrections & Uploading** | **NEXT — pending** (Owner via Admin Studio → Media) — §7 |
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
- **Mobile Phones navigation (`4a32f22`, Option B):** one shared list of 14 brands for the desktop dropdown and mobile drawer, shown with or without published products; brand empty state names the brand; iPhone → `/collections/mobile-phones/iphone` (New / Used tabs). Brand availability is never invented.
- **Homepage images (`1c1819c`):** banners, logo and Shop By Category use WebP copies; the original PNGs stay in the repo; favicon unchanged. Carousel switches only to a banner that has loaded and decoded; failed banners are skipped.
- **Storefront footer (`5b32024`):** on mobile (≤600 px) the Bank Transfer / Cash on Delivery cards are equal 52 px with contained artwork, Policies spans the full row, the copyright area keeps space (incl. safe area) above the floating WhatsApp button, which respects the right safe area; YouTube icon shows a cut-out play symbol (same link and label); `Feedback-4.png` is the Owner's corrected image with the official logo. Desktop and the phone-PDP WhatsApp edge tab unchanged.

---

## 6. Current state (2026-11-02; Claude-verified unless marked Owner-reported)

**Git:** branch `feature/checkout-orders-shipping`, HEAD **`31f24ca`** (homepage performance test line-ending fix). Since the 2026-11-01 handover-docs commit `870be80`: `4a32f22` brand navigation, `ec00985` collection headers, `1c1819c` homepage performance, `31f24ca` test fix. Pushed — local and origin both `31f24ca`; no staged changes; not merged to `master` (verified 2026-11-02). **36 uncommitted entries** (deprecated official-source scraping, Realme C75x scaffolding, old `CLAUDE_HANDOFF.md`, deprecated `/admin/specs-images` notice in `AdminApp.tsx`, deprecated admin styles, two old test lines) — the same 36; preserve them. The 2026-11-02 handover doc edits are uncommitted until the Owner approves a commit.
**Supabase CLI:** linked to **PROD** (verified 2026-11-02). **Migration history:** **DEV 66 and PROD 66** (last `202610270001`, last queried 2026-10-30; 66 files in the repo). All work since 2026-10-26 was frontend only.
**Hosting:** **DEV and PROD both run `31f24ca`** — DEV entry `index-D5pupWYm.js`, PROD entry `index-B0j9aueV.js`, same CSS `index-Bt18bEgZ.css` (re-checked live 2026-11-02). Clean `git archive` exports, environment guard PASS, DEV verified before PROD, each wired only to its own Supabase. **No pending application deployment.**
**Custom domain — root CONNECTED:** `isolutionspakistan.com` (GoDaddy DNS) → Firebase PROD `isolutions-pakistan-production`. **Claude-verified 2026-11-01:** root A `199.36.158.100`; HTTPS serves the PROD build; `www` CNAME → `shops.myshopify.com` (still Shopify); `portal` A `76.76.21.21`. **Owner-reported:** Firebase status Connected, SSL issued. **Intermittent DNS / NXDOMAIN stability issue — HOLD** (Owner reviews later). `www` migration = separate pending Owner decision; never change DNS without explicit approval.

**PROD Android catalog (Claude read-only, 2026-11-02):** **99 Android products = 82 published + 17 draft.** All 17 drafts have no primary image and no specifications; **0/17 Ready to Publish**. Exact draft titles: Infinix Note 60 · itel A100c SE · Motorola Edge 50 Ultra · Motorola Edge 70 · Motorola Razr 50 · Realme C75x · Realme Note 80 · Samsung S26 FE · Tecno Spark 40 Pro Plus · Tecno Spark 50 Pro · VgoTel New 16 Pro · VgoTel New 17 · VgoTel ONYX2 · Xiaomi Note 13 Pro · ZTE A35e · ZTE A36 · ZTE Focus Pro 5G.

**Published product image-quality audit (Claude read-only, 2026-11-02 — done, do not repeat):** 103 published products, 293 images. **22 Poor / Blurry + 67 Needs Improvement = 89 products** need image review/correction; 13 Poor primary images and 9 watermarked images. A product's grade is its weakest image — its primary image is not necessarily poor. Full numbered list: `PROJECT_HANDOVER.md` §7A. Owner-facing working list (exact PROD names, no SKUs, Poor and Needs Improvement not separated):
- **Mobile Phones (82):** Apple iPhone 13 (Used), Apple iPhone 13 Pro (Used), Apple iPhone 13 Pro Max (Used), Apple iPhone 14 (Used), Apple iPhone 14 Pro (Used), Apple iPhone 14 Pro Max (Used), Apple iPhone 15 Pro (Used), Apple iPhone 15 Pro Max (Used), Honor T10, Honor X5c, Honor X5c+, Honor X6c, Honor X8D, Honor X9D, Infinix GT 50 Pro, Infinix Hot 70, Infinix Hot 70 Pro, Infinix Note 60 Pro, Infinix Note Edge, Infinix Smart 20, itel A100c, itel A200+, itel A50c, itel City 200, Motorola Edge 70 Fusion, Motorola G77, Nothing Phone 1, Nothing Phone 2 Pro, Nothing Phone 3A Lite, Nothing Phone 3A Pro, Nothing Phone 4A, Nothing Phone 4A Pro, Oppo A6, Oppo A6c, Oppo A6k, Oppo A6s, Oppo A6s Pro, Oppo Reno 15 5G, Oppo Reno 15 Pro 5G, Oppo Reno 16 5G, Oppo Reno 16f 5G, Realme 15 Pro 5G, Realme 16 5G, Realme C100, Realme C100i, Realme C100x, Realme Note 60x, Samsung A07, Samsung A17, Samsung A27, Samsung A37, Samsung A56, Samsung A57, Samsung Flip 5, Samsung Flip 6, Samsung Fold 5, Samsung Fold 6, Samsung Fold 8 Ultra, Samsung S23 Ultra, Samsung S24 Ultra, Samsung S26, Samsung S26 Plus, Samsung S26 Ultra, Tecno Camon 50, Tecno Camon 50 Pro, Tecno Camon 50 Ultra, Tecno Go 3, Tecno Spark 50, Vivo V70 FE, Vivo X300 FE, Vivo Y05, Vivo Y05e, Vivo Y11d, Vivo Y500, Xiaomi A5, Xiaomi A7 Pro, Xiaomi Note 14 Pro, Xiaomi Note 15, Xiaomi Note 15 Pro, Xiaomi Note 15 Pro+, Xiaomi Poco C85, Xiaomi Redmi 15.
- **Tablets (2):** Samsung A11, Samsung Tab S10 Lite.
- **MacBooks (1):** Apple MacBook Air M5.
- **Gadgets (4):** Baby water play mat, Hair straightener, Mini Fan Y05, USB Dynamic Water Pattern Lamp 16 Colours with Remote.
**Known baseline test failures (outside scope, don't re-investigate):** in a clean export exactly 3 fail, identical before and after `704dc83` — the stale `securityRls.test.mjs` authenticated RPC list (lacks gadget + tablet RPCs; not a security regression) and two CRLF-only failures (`androidStockPhoneRpc.test.mjs`, `homepage_featured_products` in `phase4.test.mjs`).

**PROD catalog (Claude read-only, 2026-10-30):** 120 products = 98 published + 22 draft (17 Android + 5 gadgets); 0 orders. **Since then:** GD005–GD009 published (Owner-reported 2026-10-31) → **103 published products, confirmed read-only 2026-11-02.**
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

1. **NEXT SESSION — PRODUCT IMAGE CORRECTIONS & UPLOADING — PENDING.** The Owner corrects/uploads product images through the existing **Admin Studio → Media** workflow, working from the 89-product list (§6). Rules: reuse existing products (no duplicates); verify exact model, colour and image ↔ variant association; verify official image sources and commercial usage rights (official = Primary, Owner's actual photos = Secondary, original-resolution files); missing product facts NULL; actual uploads, replacements and publishing only with Owner approval. **GPT Analyzer plans and QAs; Claude Code stays sole Developer. Don't propose a new module automatically. Don't ask for the image audit again.**
2. **Intermittent DNS / NXDOMAIN stability issue — HOLD** (Owner reviews later).
3. **Product-card image optimization / Cloudinary performance — Phase 2, pending** (Owner approval needed).
4. **Large remaining homepage assets** — separate future Owner decision.
5. **Pending Owner decision — `www.isolutionspakistan.com`** (Shopify → Firebase): DNS change only with explicit approval.
6. **Minor UI maintenance (pending approval):** Gadgets PDP at mobile width — the round floating WhatsApp button can overlap the quantity control / Buy Now (outside the phone-only Premium Mobile PDP scope).
7. Optional development (approval needed): fix the stale `securityRls.test.mjs` list; Smart Paste typo handling (e.g. `Gbb`); image type/rights/labels; A57 naming; Edge 50 Ultra colours; removal of unmounted legacy Bulk Import files and other deprecated code.

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
- **Brand collections:** CLOSED with Option B (14 brands); don't reopen; don't assume brand mappings or stock.
- **Image corrections:** a wrong colour/model association or an image without verified usage rights is the main risk; duplicate products must never be created; don't repeat the image audit.
- **Scope creep on PDPs:** phone PDP styling is scoped to `pdp-page--phone`; changes for Gadgets or Tablets PDPs need their own approval.

---

## 9. Standard workflow

1. Owner explains the need → GPT analyzes and asks one question at a time.
2. Owner approves → GPT writes a precise Claude prompt (only when asked).
3. Claude inspects read-only, builds on localhost, runs relevant checks, reports.
4. Owner shares Claude's report → GPT reviews (QA, gaps, risks).
5. Owner approves the named actions → DEV → verify → PROD → verify; commit/push/deploy only as approved.
