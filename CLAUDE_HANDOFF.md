# iSolutions Pakistan — Project Handoff

**Purpose:** This file is the authoritative continuation reference for the next Claude Code / ChatGPT session on this project. Read this before touching any code.

**Last updated:** 2026-09-23

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
- Firebase development URL: `https://isolutions-development-cb1ea.web.app` (Firebase project `isolutions-development-cb1ea`) — redeployed and confirmed live this session (user-confirmed: "Deployed all good").
- Supabase project ref: `acwatgxkcyrdxpcljxjb`

## 3. Current Deployment State

**Checkout status: FINAL / VERIFIED / LOCKED** (Checkout, Orders, Shipping Methods, delivery fees).

- **Supabase migration `202609230001_checkout_standard_delivery_fee.sql` is APPLIED to the live database** (applied manually via the SQL Editor). Verified live, independent of Git:
  - Read-only RPC probe with an empty customer name → `HTTP 400 customer_name_required` (11-arg function present, normal validation).
  - Brandless orderability probe (no insert — valid customer fields + deliberately invalid city, so every item is validated and the city check fails before any `INSERT`): brandless "Clear Mobile Case" → `delivery_city_invalid` (passed orderability), branded Apple charger control → `delivery_city_invalid`, nonexistent variant → `variant_not_orderable`. Only `202609230001` restores the optional-brand LEFT JOIN, so this confirms it is live.
  - Real test order **ISP-ORD-000003** (see Section 13) stored `delivery_fee_minor = 20000`, `shipping_surcharge_minor = 0`, `total_minor = 719900`.
- **Firebase development hosting has NOT yet been redeployed with the delivery-fee frontend** (commit `6aec780`). Until it is, the hosted dev site still runs the previous checkout build, which does not display the Rs 200 base fee below Rs 10,000, while the live server already charges it. Deploy only when explicitly asked.
- Git: all checkout/order/shipping work is committed locally on branch `feature/checkout-orders-shipping` (`ce92dd9`, `15c8e17`, `4534fa8`, `6aec780`, plus the docs commit). No Git remote is configured yet, so nothing has been pushed.
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
- "Some chunks are larger than 500 kB after minification" build warning (pre-existing, not addressed — would need code-splitting if ever tackled)

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
- Firebase development hosting → last deployed with the earlier shipping-methods build; the delivery-fee frontend (`6aec780`) is **not yet deployed**

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
- Checkout, Orders, Shipping Methods and delivery fees (Sections 4–8) are FINAL / VERIFIED / LOCKED — do not redo them or re-apply their migrations. The only outstanding step is redeploying Firebase dev hosting with the delivery-fee frontend, when explicitly asked.
- Inspect current code before editing — do not guess.
- Do not rebuild, restart, or broadly refactor the existing architecture.
- Do not redo work that's already complete (see Sections 4–10 for what's done).
- Validate UI changes against the real running app (`http://localhost:5173` and `/admin/orders`), not static HTML repro pages.
- Do not deploy to Firebase unless explicitly asked.
- Do not edit applied migrations — always add a new one.
- Do not assume Git history reflects live deployment/migration state on this project — verify live systems directly (read-only) before concluding something is or isn't live.
- Keep changes minimal and targeted to the specific request; don't touch the locked areas in Section 11 without explicit instruction.
- Run `npm run lint` and `npm run build` after any meaningful code change.
