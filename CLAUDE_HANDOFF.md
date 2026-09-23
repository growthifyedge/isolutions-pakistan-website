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

- **Supabase migration `202609220003_checkout_shipping_methods.sql` is APPLIED to the live database.** Verified read-only, independent of Git: a probe `POST` to `https://acwatgxkcyrdxpcljxjb.supabase.co/rest/v1/rpc/create_storefront_order` with a body including `p_shipping_method` returned `HTTP 400 {"code":"P0001","message":"customer_name_required"}` — i.e. PostgREST matched and executed the new 11-arg function (the old 10-arg signature without `p_shipping_method` would instead have returned a 404 "function not found in schema cache" error). The migration runs as a single `begin;...commit;` transaction, so this also confirms the preceding `ALTER TABLE ... ADD COLUMN shipping_method, shipping_surcharge_minor` statements committed successfully. No data was mutated by this check (the probe intentionally fails Postgres-side validation before reaching any `INSERT`).
- **Firebase development hosting has been redeployed** with this build. User confirmed successful deployment and testing ("Deployed all good") after local verification.
- **Shipping-method implementation status: DEPLOYED** — schema, RPC, checkout UI, order-success, and Admin Orders display are all live.
- Also verified locally against the real running dev server (`http://localhost:5173`, not static repros) before deployment:
  - `npm run lint` — pass (1 pre-existing unrelated warning, see Section 12)
  - `npm run build` (`tsc -b && vite build`) — pass
  - Checkout UI (Delivery Method cards, free-delivery threshold logic, Fast Delivery surcharge, Order Summary states) — verified visually and via computed-state extraction, scenarios A–F all correct (see Section 5)
- Latest live testing (post-deploy): confirmed successful by the user.
- Note: `git log`/`git status` do **not** reflect this — the working tree may still show these files as uncommitted/untracked, and HEAD may still point at an older commit. That is expected under this project's manual-apply/deploy workflow (see the note above) and is not evidence the migration or deployment didn't happen. If a commit is wanted for this work, that's a separate, explicit ask.

## 4. Locked Business Rules

**Delivery eligibility (do not change):**
- Mobile phones: Karachi only
- Gadgets/accessories: nationwide Pakistan
- Mixed cart containing any Karachi-only mobile: entire order becomes Karachi-only (no split shipments, no "Other city" option)

**Shipping (implemented and deployed this session):**
- Two methods: Standard Delivery, Fast Delivery
- Standard Delivery is FREE when merchandise subtotal ≥ Rs 10,000 (1,000,000 minor units / paisa)
- Below Rs 10,000, no standard base fee is configured anywhere in the project — delivery shows "To be confirmed" rather than an invented amount
- Fast Delivery always adds a Rs 200 (20,000 minor units) surcharge, regardless of subtotal — it is never free, even on Rs 10,000+ orders
- Shipping method selection never changes geographic eligibility — Fast Delivery cannot bypass the Karachi-only rule
- Constants live in `src/lib/orders.ts` (`FREE_STANDARD_DELIVERY_THRESHOLD_MINOR`, `FAST_DELIVERY_SURCHARGE_MINOR`) and are mirrored as literals inside the SQL RPC — client-submitted fees/totals are never trusted; the server recalculates everything from authoritative catalog prices

**Payments:**
- Active: Cash on Delivery, Bank Transfer
- Coming Soon (disabled tiles): Credit/Debit Card, Installments

## 5. Checkout State

File: `src/StorefrontApp.tsx` (`CheckoutPage`, `OrderSuccessPage`)

- 3-step sticky progress indicator: Customer Details → Delivery Details → Payment Method (IntersectionObserver-driven active step)
- Customer Details: Full Name, WhatsApp/Phone, optional Email
- Delivery Details: City (locked to Karachi and hidden dropdown when cart requires it; otherwise Karachi / Other city in Pakistan), conditional "City Name" field when Other city is selected, Area/Landmark, Full Delivery Address, Order Notes
- Delivery eligibility notice (karachi / mixed / nationwide messaging) — unchanged, locked
- **New: "Delivery Method" section** (between the eligibility notice and Payment Method) — two selectable cards:
  - Standard Delivery: shows "FREE" (green badge) at/above threshold, or "To be confirmed" (neutral badge) below it
  - Fast Delivery: always shows "Rs 200" (coral badge), "Priority" label
  - A threshold hint line above the cards: "Add Rs X more to unlock FREE Standard Delivery." / "You've unlocked FREE Standard Delivery." once qualified
  - Default selection: Standard Delivery (never defaults to paid Fast)
- Payment Method: Cash on Delivery / Bank Transfer selectable tiles; Credit/Debit Card and Installments shown disabled as "Coming soon"
- Order Summary (right rail): Subtotal, Delivery Method, Delivery (FREE / Rs X / "To be confirmed" / "To be confirmed (+Rs 200 Fast Delivery)"), and a Total row labeled "Total" when the fee is fully known or "Known Total" when it isn't (never fabricates a final number when delivery is unconfirmed)
- Place Order → calls `createStorefrontOrder()` (`src/lib/orders.ts`) → Supabase RPC `create_storefront_order` → on success, confirmation is saved to `sessionStorage`, cart is cleared (`clearStorefrontCart()`), redirect to `/order-success`
- `/order-success`: reads the saved confirmation (privacy-scoped — only available immediately after checkout), shows Order number, Payment method, Subtotal, Delivery Method, Delivery status, Total/Known total, and (if Fast was selected) a dedicated "Fast Delivery selected (+Rs 200 priority surcharge)" note even when the overall delivery fee is still unconfirmed

## 6. Order Backend

Tables (from `202609200001_checkout_orders_phase_1.sql`, extended by `202609220003_checkout_shipping_methods.sql` — **applied and live**):
- `public.orders` — customer/delivery/payment fields, `subtotal_minor`, `delivery_fee_minor` (nullable = unknown), `total_minor`, `status`, plus new `shipping_method` (`standard`/`fast`, check-constrained) and `shipping_surcharge_minor` (bigint, default 0)
- `public.order_items` — immutable per-line snapshots (title, SKU, variant attributes, price, delivery scope, image) captured at order time, independent of later catalog changes
- `public.storefront_order_number_seq` → order numbers formatted `ISP-ORD-000001` style

RPC: `public.create_storefront_order(...)`
- `SECURITY DEFINER`, `set search_path = ''`, all references fully qualified
- Validates: customer fields, email format, payment method, **shipping method** (new), item array shape/limits/duplicates
- Resolves authoritative price/delivery-scope/publication/stock per variant server-side — client only sends `variant_id` + `quantity`
- Enforces Karachi-only / nationwide / mixed classification from real delivery scopes, not client claims
- Computes shipping fee server-side per the rules in Section 4 — client cannot submit a fee or total
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
- Order detail panel: Customer, Delivery (Destination, Classification, **Shipping Method** — new, Address, Area/Landmark, Notes), Order items (snapshot-based, never live product data), Totals (Subtotal, **Delivery Method** — new, **Delivery Fee** — new: FREE / Rs X / "To be confirmed" / "To be confirmed (+Rs 200 Fast Delivery)", Known total)
- Status update dropdown (`new → confirmed → processing → completed → cancelled`), persists via Supabase update, confirmed to survive a page refresh
- **Admin Order Detail header layout was fixed this project and must not be reverted.** Root cause history: the header previously broke because CSS Grid tracks with `fr` units hit a Chromium subpixel/zoom text-wrap bug, and separately because a **global, unscoped `header { ... }` selector in `src/styles.css`** (the storefront's own sticky-nav CSS) was leaking into `.order-detail > header` since the admin rule didn't explicitly override every property the global rule set. The fix in `src/admin/admin.css` (`.order-detail > header` block) now explicitly resets `display`, `height`, `grid-template-columns`, `padding`, `justify-content`, `align-items`, `box-shadow`, `z-index`, `background` so nothing from the global header rule can leak through again. **Do not remove these explicit resets, and do not reintroduce a grid/flex layout for this header without keeping full property resets.**

## 9. Migrations

Applied to live Supabase (do not edit retroactively):
- `202609200001_checkout_orders_phase_1.sql` — creates `orders`/`order_items`, order number sequence, original `create_storefront_order` RPC
- `202609220001_checkout_optional_brand_fix.sql` — fixes brandless-product orderability (`LEFT JOIN brands`)
- `202609220002_admin_order_status_workflow.sql` — adds `confirmed`/`processing`/`completed`/`cancelled` statuses
- `202609220003_checkout_shipping_methods.sql` — **applied via the Supabase SQL Editor this session (confirmed live via read-only RPC probe, see Section 3).** Adds `shipping_method`/`shipping_surcharge_minor` columns + constraints, replaces `create_storefront_order` with an 11-arg version that accepts `p_shipping_method` and computes delivery fee server-side per Section 4

**Rule for all future changes:** never edit an applied migration file. Always create a new migration with the next sequential timestamp prefix. Note that this project applies migrations via the Supabase SQL Editor, not necessarily `supabase db push` — a migration file being untracked/uncommitted in Git does not mean it hasn't been applied live; verify with a read-only check (e.g. probe the RPC/table via the REST API) rather than assuming from Git state.

## 10. Important Files

- `src/StorefrontApp.tsx` — storefront routes including `CheckoutPage`, `OrderSuccessPage`
- `src/styles.css` — global storefront CSS (also loaded on `/admin` routes via `src/main.tsx` — see the header-leak note in Section 8 before adding any new bare-tag selectors here)
- `src/lib/cart.ts` — client cart (localStorage key `isolutions-storefront-cart`)
- `src/lib/orders.ts` — `createStorefrontOrder()`, shipping/order confirmation types, free-delivery/fast-surcharge constants
- `src/lib/storefrontContact.ts` — centralized WhatsApp contact config (locked design)
- `src/admin/AdminOrders.tsx` — Admin Orders list/detail
- `src/admin/AdminApp.tsx` — Admin shell/routing/auth wrapper
- `src/admin/admin.css` — Admin-only styles
- `supabase/migrations/202609200001_checkout_orders_phase_1.sql`
- `supabase/migrations/202609220001_checkout_optional_brand_fix.sql`
- `supabase/migrations/202609220002_admin_order_status_workflow.sql`
- `supabase/migrations/202609220003_checkout_shipping_methods.sql` (applied and live)

## 11. Locked / Do Not Touch Without Explicit Instruction

- Header/navigation (desktop sticky header, mobile compact header)
- Search drawer
- Wishlist drawer
- Cart drawer
- WhatsApp floating button (`src/lib/storefrontContact.ts` is the single source of truth)
- Homepage locked sections (legacy tech block and old laptop promo stay removed; Home About section stays restored)
- Footer
- Checkout visual system / design language (`.checkout-card`, `.checkout-payment-tile`, `.checkout-shipping-*`, `.checkout-summary*` in `src/styles.css`)
- Admin Order Detail header CSS fix (Section 8) — do not revert to a grid/flex layout without full property resets
- All applied migrations (Section 9)

## 12. Known Non-Blocking Warnings

- `react-hooks/exhaustive-deps` warning in `src/StorefrontApp.tsx` (~line 2936 at last check) for a `useEffect` missing `collection.*` dependencies — pre-existing, not introduced by recent work
- `lottie-web` direct-`eval` warnings during `vite build` (from the `lottie-web` package itself, not project code)
- "Some chunks are larger than 500 kB after minification" build warning (pre-existing, not addressed — would need code-splitting if ever tackled)

## 13. Latest Validation

- `npm run lint` → pass, only the pre-existing warning above
- `npm run build` (`tsc -b && vite build`) → pass, only pre-existing lottie-web/chunk-size warnings
- Pre-deploy UI verification directly against `http://localhost:5173/checkout` (no static repros):
  - Standard/Fast card selection, badges, threshold hint text
  - Subtotal < Rs 10,000 + Standard → "To be confirmed"
  - Subtotal < Rs 10,000 + Fast → "To be confirmed (+Rs 200 Fast Delivery)", no fabricated total
  - Subtotal ≥ Rs 10,000 + Standard → FREE
  - Subtotal ≥ Rs 10,000 + Fast → Rs 200, correct total
  - Mobile-only cart + Fast selected → still Karachi-locked, Other city still hidden
- Supabase shipping migration (`202609220003`) → **APPLIED** via SQL Editor; independently confirmed read-only via a REST probe of `create_storefront_order` (see Section 3) — no direct DB credential/introspection access was used or needed
- Firebase development hosting → **deployed**, confirmed by the user ("Deployed all good")
- Live end-to-end order placement and Admin Orders shipping-method display on the deployed/live environment → confirmed successful by the user

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
- Shipping-methods work (Sections 4–8) is complete, applied, and deployed — do not redo it or re-apply the migration.
- Inspect current code before editing — do not guess.
- Do not rebuild, restart, or broadly refactor the existing architecture.
- Do not redo work that's already complete (see Sections 4–10 for what's done).
- Validate UI changes against the real running app (`http://localhost:5173` and `/admin/orders`), not static HTML repro pages.
- Do not deploy to Firebase unless explicitly asked.
- Do not edit applied migrations — always add a new one.
- Do not assume Git history reflects live deployment/migration state on this project — verify live systems directly (read-only) before concluding something is or isn't live.
- Keep changes minimal and targeted to the specific request; don't touch the locked areas in Section 11 without explicit instruction.
- Run `npm run lint` and `npm run build` after any meaningful code change.
