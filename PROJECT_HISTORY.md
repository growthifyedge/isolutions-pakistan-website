# Project history

## 2026-08-26 — Authenticated storefront taxonomy isolation repair

- Fixed development brand/category leakage seen when a verified Owner viewed the public storefront while signed in.
- Replaced direct storefront taxonomy table reads with `public_catalog_taxonomy()`, an explicitly real-only published-catalog projection stable across anonymous and authenticated Admin sessions.
- Preserved Admin read-all access, development fixtures, Motorola G77, the public catalog RPC, and all Phase 3B behavior.
- Passed TypeScript, ESLint, 33 automated tests, and the production build. Remote activation requires the forward-only taxonomy RPC migration.

## 2026-08-25 — Phase 4 integration architecture implemented

- Owner approved Phase 3B and authorized Phase 4 real catalog integration while keeping commerce outside scope.
- Added a forward-only migration with explicit `development`/`real` isolation, tightened related-table public RLS, publication validation, structured database-side search/filtering, and safe numeric inventory projection.
- Removed the storefront runtime dependency on fictional mock products; homepage catalog sections, Shop, search/filters, and slug PDP now use Supabase published-real data with honest empty/not-found states.
- Implemented routine database-backed Admin management for taxonomy classification, product drafts, explicit variants/pricing, inventory movements, specifications, existing Cloudinary Media, SEO, and validated publishing.
- Found no Owner-supplied real product dataset in the repository; imported zero real products and did not convert development/prototype records.
- Passed 32 automated tests, TypeScript, ESLint, production build, Phase 3A/3B remote regression checks, and 15-view desktop/tablet/mobile visual QA.
- Remote Phase 4 activation remains pending because the CLI is not linked; the Owner must apply `202608250001_phase_4_real_catalog.sql` in the Supabase SQL Editor before catalog entry.

## 2026-08-25 — Phase 3B live verification complete

- Applied and verified the Phase 3B media migration, RLS boundaries, and both Owner/Admin-authorized Cloudinary Edge Functions in the development project.
- Owner-confirmed the live lifecycle: signed upload, metadata and alt-text update, second upload, primary selection, sidebar Media navigation, and deletion with a valid remaining primary image.
- Replaced the obsolete Media placeholder with a database-backed media index that delegates all mutations to Product → Media.
- Re-ran publishable-key remote boundary checks, TypeScript, ESLint, 16 automated tests, the production build, and responsive Admin visual QA.
- Captured final desktop/mobile Media index and direct product Media screenshots with no overflow, broken images, or page errors.
- Completed Phase 3B without importing real catalog data or starting commerce.

## 2026-08-21 — Phase 3B Cloudinary foundation

- Owner authorized Phase 3B while preserving the approved storefront/Admin design and excluding real catalog and commerce.
- Implemented metadata-only media schema completion, primary/reorder/variant integrity, and required-media publication validation.
- Implemented Owner/Admin-verified Supabase Edge Functions for short-lived signed direct upload and secure Cloudinary destruction.
- Implemented the focused Admin Media workflow: validation, progress, preview/listing, alt text, variant assignment, primary selection, reorder, replace, and delete.
- Captured and verified the safe pre-connection Media state. Live integration remains pending Cloudinary configuration and remote deployment.

## 2026-08-20 — Owner authorization for Phase 3A

- Owner approved Phase 0 Discovery, Phase 1 Visual Storefront, and Phase 2 Production Architecture.
- Authorized Phase 3A Data Model + Admin Foundation.
- Selected React/Vite/TypeScript, Firebase Hosting, Supabase PostgreSQL/Auth/RLS, later Cloudinary, and PostgreSQL structured search.
- Preserved the approved storefront and explicitly deferred Cloudinary implementation, real catalog import, customer accounts, checkout, orders, payments, and promotions.
- Applied the complete Phase 3A foundation to the remote development project through the SQL Editor repair migration.
- Verified public catalog reads and anonymous denial for profiles, inventory, catalog writes, and Admin RPC access using only the publishable key.
- Completed the responsive Admin Studio shell, commercial/security tests, production build, and screenshot QA.
- Verified the Owner Auth identity against the database-backed active `owner` profile, enforced the authorization RPC on login and every protected Admin route, and completed Phase 3A on 2026-08-21.

## 2026-08-19 — Targeted Phase 1 refinement

- Corrected the mobile PDP purchase hierarchy and removed the sticky-CTA spacing defect.
- Clarified homepage merchandising headings without changing the approved visual system.
- Reduced the desktop shop introduction footprint and surfaced the catalog sooner.
- Replaced developer-looking filter labels and improved two-column mobile card legibility.
- Regenerated the complete responsive screenshot and interaction QA evidence set.

## 2026-08-19 — Visual prototype milestone

- Initialized a new, empty project without inherited code.
- Established prototype governance and stage boundaries.
- Built homepage, catalog, PDP, responsive navigation, mock filters, and explicit mock variant combinations.
- Prepared the milestone for visual QA and Owner review.
## 2026-08-27 — Phase 4 bulk catalog workflow

Added Owner-authorized rough-text/CSV parsing, dry-run matching, explicit variant preview, and an authenticated atomic bulk-apply RPC. New catalog records remain real drafts; omitted facts and inventory are preserved or unresolved, and Phase 3B Media remains authoritative.

## 2026-08-29 — Firebase Hosting development setup prepared

- Added Firebase Hosting SPA configuration for the Vite `dist` directory, including an `index.html` fallback for storefront and Admin Studio direct routes.
- Confirmed the frontend consumes only browser-safe Vite configuration: Supabase URL, Supabase publishable key, and Cloudinary cloud name. `.env.local` remains ignored and no server secret is present in Hosting configuration.
- No Firebase project ID, `.firebaserc`, authentication, Hosting URL, custom domain, or deployment was created because Firebase CLI was not installed or authenticated on this machine.
- Once the Owner authorizes Firebase CLI sign-in/project selection, the development deployment command is `firebase deploy --only hosting` after `npm run build`. Production custom-domain launch remains pending; localhost remains available for local development.

## 2026-08-30 â€” Firebase Hosting development live verified

- Firebase Hosting development deployment is active at https://isolutions-development-cb1ea.web.app under verified project `isolutions-development-cb1ea` and alias `development`.
- Owner live-verified `/`, `/shop`, `/admin`, `/admin/bulk-import`, and `/admin/catalog-readiness`, including Supabase-backed catalog reads, Cloudinary delivery, Admin authorization, and SPA direct routing.
- This remains a development/testing deployment only. No production custom domain, Firebase Auth, Firebase Functions, Firestore, or commerce functionality was added; Supabase Auth and PostgreSQL RLS remain authoritative.
