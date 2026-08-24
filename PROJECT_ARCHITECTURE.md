# Approved production architecture

## Current scope

Phase 3A is Owner approved and complete. Phase 3B completes the live-verified Cloudinary product-media path without redesigning the Owner-approved storefront or Admin Studio. The catalog remains clearly marked development/test data until a later approval.

## Approved stack

- Frontend: React, Vite, TypeScript
- Hosting: Firebase Hosting, Spark/free tier initially; custom domain later
- Database: Supabase PostgreSQL
- Authentication: Supabase Auth
- Authorization: PostgreSQL Row Level Security backed by `profiles`
- Privileged operations: Supabase Edge Functions and/or narrowly designed PostgreSQL RPCs when required
- Media: Cloudinary optimized high-quality master plus on-demand responsive delivery
- Search: PostgreSQL/Supabase structured filtering and search

Commercial money uses `BIGINT` integer minor units. Sellable variants are explicit rows, never Cartesian combinations. Publication uses validated state transitions rather than a blind boolean. Inventory is numeric and auditable through movements. Commercial facts remain structured.

Media flow: authenticated Owner/Admin browser → Supabase Edge Function role verification → short-lived signed upload authorization → direct browser-to-Cloudinary upload → optimized master (limit 3000 × 3000, no upscaling, quality normalization, metadata stripping) → metadata-only `product_media` row. Storefront delivery uses requested widths with `q_auto,f_auto` and Cloudinary CDN caching; derivatives are generated on demand.

Secure deletion is requested by the authenticated browser and performed server-side by a Supabase Edge Function before metadata deletion. Primary selection and reorder operations use narrowly scoped PostgreSQL functions, while variant membership and primary fallback are database enforced.

Cloudflare/OpenNext and Vercel hosting are not approved. Checkout, orders, payments, customer accounts, promotions, and real catalog import remain outside Phase 3B.
