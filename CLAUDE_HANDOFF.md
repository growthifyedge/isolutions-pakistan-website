# iSolutions Pakistan — Project Handoff

**Purpose:** This file is the authoritative continuation reference for the next Claude Code / ChatGPT session on this project. Read this before touching any code.

**Last updated:** 2026-09-24

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
- Git: all work is committed locally on branch `feature/checkout-orders-shipping` — checkout/orders/shipping (`ce92dd9`, `15c8e17`, `4534fa8`, `6aec780`, `2e42146`) and Bulk Upload v2 (`2ec8f00`, `32a34cd`, `d8a7859`, plus the handoff update commit). `master` is untouched at `885059e`. **No Git remote is configured**, so nothing has been pushed.
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
- `npm test`: **6 pre-existing failing tests** (source-text assertions that drifted from earlier committed code, e.g. they expect `persistChangedVariantPrices` but the code is `persistChangedVariantPricing`): `batchDefaultsReadiness` "inventory default 10 does not regress"; `bulkInventoryAutomation` "new variant with omitted inventory…" and "Bulk Preview renders default…"; `phase4` "storefront does not import the fictional mock catalog", "variants remain explicit rows…", "variant create, save, reload…". They fail identically on a clean checkout without the Bulk Upload v2 work. Not fixed yet — review each (stale vs real regression) before changing.
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

## 16. Bulk Upload v2 (Admin Bulk Import) — current state

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
