# iSolutions Pakistan Website — Project Brief for ChatGPT (Analyzer)

**Prepared:** 2026-10-18 · **Fully updated 2026-10-26** · **Updated 2026-10-29** by Claude Code (Developer) for the Owner.
**Source of truth:** `PROJECT_HANDOVER.md` (updated 2026-10-29) wins on any conflict. Items marked **(Owner-reported)** were done or seen by the Owner, not by Claude.
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
| **Specifications for MacBook Air M5 16/512, Galaxy Tab A11 8/128, Galaxy Tab S10 Lite 6/128 + 6/256** | **NEXT TASK** (§7) |
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
- **"100% Authentic — Official Product"** card wording stays unchanged on all products.

---

## 6. Current state (2026-10-29; Claude-verified unless marked Owner-reported)

**Git:** branch `feature/checkout-orders-shipping`, code HEAD **`228553e`** (Smart Paste parser: only `src/lib/tabletStockUpdate.ts` + its test), pushed (origin = `228553e`), not merged to `master`. **36 uncommitted entries** (deprecated official-source scraping, Realme C75x scaffolding, old `CLAUDE_HANDOFF.md`, deprecated `/admin/specs-images` notice in `AdminApp.tsx`, deprecated admin styles, two old test lines) — preserve. The 2026-10-29 handover doc edits are uncommitted until the Owner approves a commit.
**Supabase CLI:** linked to **PROD**. **Migration history:** **DEV 66 and PROD 66** (last `202610270001`; PROD re-verified 2026-10-28). No migration for Smart Paste.
**Hosting (2026-10-28):** **DEV and PROD both run `228553e`** — DEV `index-C21Oa5e_.js` / `AdminApp-D6-Ah9Pr.js`; PROD `index-DD89arGQ.js` / `AdminApp-Cq8oyAGO.js`. Clean exports, guard PASS, served files byte-identical; each wired only to its own Supabase. Tablet + RPC tests 33/33 PASS.
**Known stale test:** `scripts/securityRls.test.mjs` (one of the 36) fails one assertion because its authenticated RPC list lacks the gadget + tablet RPCs; reproduced on the pre-Smart-Paste baseline `bdc409c`; not a security regression; not modified.

**PROD catalog:**
- 2026-10-26 snapshot (Claude): 112 products, 401 variants, 285 images, 0 orders, no tablet/MacBook then.
- **Apple MacBook Air M5** (Claude read-only, 2026-10-28): published; MC001 Skyblue Rs 397,000 · MC002 Silver Rs 402,000 · MC003 Midnight Rs 397,000; each 16 GB / 256 GB at that time, stock 20, New, PTA Not Applicable, Karachi only; 1 primary image; 0 specs; 0 orders. **Owner-reported:** all three corrected in Admin to **16 GB / 512 GB** — not yet read-back verified by Claude.
- **Samsung A11** 8 GB / 128 GB Rs 59,000, Cellular PTA Approved — **Owner-reported** created.
- **Samsung Tab S10 Lite** 6 GB / 128 GB Rs 98,500 and 6 GB / 256 GB Rs 115,000, Cellular PTA Approved — **Owner-reported** created.
- Exact titles, SKUs and publication status of the Samsung products are not verified by Claude.
**DEV:** 4 published gadgets; 4 old tablet drafts with condition `unknown` (held, untouched); Owner QA MacBook Air M5 draft (MC001, Owner-reported).

**Verification limits (be accurate):**
- Claude's in-app browser is blocked on the live `web.app` hosts; Claude does not bypass it. Live checks are bundle comparisons, public RPC/HTTP checks and local harnesses/previews.
- Owner visual checks still useful on PROD with real data: Gadgets PDP V3, Tablets & MacBooks page/collection, iPhone Product Information block, colour-image alignment.

---

## 7. Pending work

1. **NEXT TASK — officially verified specifications** for: Apple MacBook Air M5 16 GB / 512 GB; Samsung Galaxy Tab A11 8 GB / 128 GB; Samsung Galaxy Tab S10 Lite 6 GB / 128 GB and 6 GB / 256 GB.
   - Exact model + configuration from the official manufacturer source. Earlier research flagged configuration mismatches, **especially Tab S10 Lite 6 GB / 256 GB** — never substitute another configuration; report mismatches to the Owner.
   - Missing/unverified facts stay blank. Use the existing combined Excel **Spec Upload** workflow (exact title/slug matching).
   - First a read-only check of the exact PROD titles/slugs/variants (Samsung products and the MacBook 512 GB fix are Owner-reported).
   - No spec upload or PROD write without explicit Owner approval.
2. Owner: further PROD uploads, primary images and publishing. No Claude PROD product write.
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
- **Titles:** Stock Updates match exact titles only; a product titled differently (e.g. without the brand prefix) is not matched. Spec Upload also matches exactly — the PROD Samsung title may be "Samsung A11" (as pasted), not "Samsung Galaxy Tab A11"; verify before preparing specs.
- **Owner-reported vs verified:** treat the MacBook 512 GB correction and the Samsung tablet facts as Owner-reported until Claude reads them back.
- **Claude's safety check or browser policy may block actions** — stop and report, never bypass.

---

## 9. Standard workflow

1. Owner explains the need → GPT analyzes and asks one question at a time.
2. Owner approves → GPT writes a precise Claude prompt (only when asked).
3. Claude inspects read-only, builds on localhost, runs relevant checks, reports.
4. Owner shares Claude's report → GPT reviews (QA, gaps, risks).
5. Owner approves the named actions → DEV → verify → PROD → verify; commit/push/deploy only as approved.
