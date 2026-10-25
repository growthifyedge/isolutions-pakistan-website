# iSolutions Pakistan — GPT Analyzer Handoff

**Prepared:** 2026-10-21 · **Fully updated 2026-10-26** by Claude Code for a fresh ChatGPT Analyzer chat.
**Source priority:** `PROJECT_HANDOVER.md` (2026-10-26) > `GPT_PROJECT_BRIEF.md` (2026-10-26) > this handoff > older chats. All three files were updated together on 2026-10-26 and are consistent. Items marked **(Owner-reported)** were done by the Owner, not by Claude.

## Working roles and rules

- **Owner:** final authority. **Claude Code:** sole developer. **ChatGPT:** Analyzer / QA reviewer; writes a Claude prompt only when the Owner asks.
- **Short Roman Urdu, one step at a time**, one question at a time.
- No coding without Owner approval. Workflow: **localhost → Owner approval → DEV → PROD**.
- **Every DB write, migration, upload, commit, push and deployment needs explicit Owner approval** (several named actions may be approved in one message). Read-only check before, verification after.
- Never guess product facts; blank stays NULL. Preserve approved design/business rules and all uncommitted changes. Don't repeat completed work, audits or tests. Never bypass a Claude safety or tool restriction.
- Do not save project information in long-term memory; rely on these files.

## Verified status (2026-10-26)

- **Git:** branch `feature/checkout-orders-shipping`, code HEAD **`2dd05bd`** + handover-docs commit (pushed). **36 uncommitted entries** — preserve.
- **Supabase CLI:** linked to **PROD `nlxfwppywxumymbjkvwt`**. DEV = `acwatgxkcyrdxpcljxjb`. Migration history: **DEV 66, PROD 66** (last `202610270001`).
- **Hosting:** PROD `2dd05bd` — `index-DhIwDqh5.js` / `AdminApp-dMbswHlJ.js`; DEV `1e0add3` — `index-DjbLI84U.js` / `AdminApp-C2lAm0hM.js`.
- **PROD catalog:** 112 products (108 phones: 91 published + 17 draft; 4 published gadgets), 401 variants, 285 images, 0 orders. No tablet/MacBook yet. Unchanged by the last two migrations.

## Completed — do not repeat

- **Android** (`5ad4a4d`) and **iPhone Stock Management** (9 Used iPhones published on PROD, MB329–MB397).
- **Warranty:** Used iPhones none; New iPhones Owner-confirmed 1/2 years; tablets/iPads/Apple MacBooks optional; gadgets not required; Android unchanged.
- **Manual image upload**, **Global Spec Upload**, 105 Used iPhone specs; **iPhone PDP Product Information + Ask Seller** (`4c17c0b`); image sizing (`9176c8d`); colour ↔ image alignment (`626f0f0`); **Bulk Import Create-only** (`7968015`).
- **Gadgets** (migration `202610260001`, `1463f8d` … `d3dd1de`): Gadgets Stock Update (Excel Name / Price / Description; existing → price/description, stock unchanged; new → draft, stock 20, nationwide), parser for price on the next line, Home Gadgets collection = `gadgets` category, **Gadgets PDP V3** (About This Product, Order on WhatsApp, delivery card). Writes DEV + PROD.
- **Tablets & MacBooks** (migration `202610270001`, `1e0add3`, `2dd05bd`): `/admin/tablet-stock-update` — Product Type iPad / Tablet / MacBook, New/Used, Connectivity; same-line and multiline (MacBook block) formats; exact matching; new → draft, stock 20, Karachi only, warranty NULL; existing → price / show again, stock kept; MacBooks Apple-only (`laptops` + Apple), Windows laptops never added or published; storefront "Tablets & MacBooks" collection on the same URL with a MacBooks filter. Writes DEV + PROD. **Owner DEV real-write QA PASS:** MacBook Air M5 draft, MC001, stock 20, Rs 420,500.

## Verification limits (report them accurately)

- Claude's in-app browser is blocked on the live `web.app` hosts; Claude does not bypass it. Live verification = byte-identical bundle checks, public RPC/HTTP checks, local harnesses/previews.
- **Owner visual checks on PROD with real data:** Gadgets PDP V3, Tablets & MacBooks page and collection, iPhone Product Information block, colour-image alignment.

## Next step

**Owner uploads products on PROD** through Gadgets Stock and Tablets & MacBooks Stock Update, adds primary images and publishes. Claude does no PROD product write without approval. Tablet/MacBook specs only from verified official sources via Spec Upload.

## Other pending work

1. Optional: iPhone 13 pink image association; verified SIM / Battery Health; replace low-resolution iPhone images.
2. DEV tablet drafts with `unknown` condition stay held — no automatic cleanup.
3. Deprecated official-source / Realme C75x code and unmounted legacy Bulk Import files stay untouched until the Owner decides.
4. Later: Android drafts (17 on PROD without images/specs), image type/rights fields and labels.

## Open decisions (don't resolve silently)

1. A57 blue name: DEV `Icyblue` vs PROD `Light Blue`.
2. Edge 50 Ultra (PROD draft): `Wood` (MB290) vs `Nordic Wood` (MB325).
3. Image rules not yet in code: rights-proof definition; label for Unclassified images; official-image publishing gate.
4. Extra spec sections for non-phone categories (tablets/MacBooks).
5. Whether Bulk Import should also refuse non-Apple laptops (today only publishing is blocked).
6. Whether to delete the unmounted legacy Bulk Import files and other deprecated code.

## First response in a fresh GPT chat

1. Read `PROJECT_HANDOVER.md`, `GPT_PROJECT_BRIEF.md` and this file completely.
2. Briefly confirm the current state and the next step (Owner product uploads on PROD).
3. Ask one useful Owner question. No Claude prompt unless the Owner asks.

### Copy-ready message for the fresh GPT Analyzer chat

> Main iSolutions Pakistan ka Owner hoon. Aap Analyzer/QA hain, Claude Code sole Developer hai. Attached `PROJECT_HANDOVER.md`, `GPT_PROJECT_BRIEF.md` aur `GPT_ANALYZER_HANDOFF.md` (sab 2026-10-26) complete read karein; `PROJECT_HANDOVER.md` ko priority dein. Ye DEV + PROD par complete hain — repeat na karein: Android + iPhone Stock Update, image upload, Spec Upload, iPhone PDP, 9 Used iPhones, PDP image fixes, Bulk Import Create-only, Gadgets Stock Update + Gadgets PDP V3 + Home Gadgets, Tablets & MacBooks Stock Update + collection (migrations 66/66 DEV + PROD). Code HEAD `2dd05bd` + handover commit, 36 uncommitted entries preserve, CLI PROD se linked. Short Roman Urdu, ek step at a time, ek sawal. Claude prompt sirf mere kehne par. Har DB write/migration/commit/push/deploy/publish ki approval. Product facts guess nahi. Next: main PROD par products upload aur publish karunga.

**Before deleting chats:** save all three files locally and confirm they are dated 2026-10-26.
