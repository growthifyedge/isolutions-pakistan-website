# Approved production architecture

## Current scope

Phase 3A and Owner-approved Phase 3B are complete. Phase 4 replaces runtime mock-catalog dependencies with a Supabase public catalog RPC and database-backed Admin authoring while preserving the approved storefront/Admin design. No real products are imported until the Owner supplies complete approved facts.

## Approved stack

- Frontend: React, Vite, TypeScript
- Hosting: Firebase Hosting, Spark/free tier initially; custom domain later
- Database: Supabase PostgreSQL
- Authentication: Supabase Auth
- Authorization: PostgreSQL Row Level Security backed by `profiles`
- Privileged operations: Supabase Edge Functions and/or narrowly designed PostgreSQL RPCs when required
- Media: Cloudinary optimized high-quality master plus on-demand responsive delivery
- Search: PostgreSQL/Supabase structured filtering and search

Phase 4 adds an explicit `catalog_data_class` boundary on brands, categories, and products. Existing and unresolved records default to `development`; only active, validated, published `real` records are eligible for public RLS and `search_public_catalog`. The RPC performs structured search/filtering and returns numeric inventory without granting anonymous inventory-table access.

The public storefront uses slug routes, explicit variants, integer-minor-unit prices, validated compare-at prices, numeric availability, public specifications, and responsive Cloudinary delivery. Commerce actions remain absent.
Commercial money uses `BIGINT` integer minor units. Sellable variants are explicit rows, never Cartesian combinations. Publication uses validated state transitions rather than a blind boolean. Inventory is numeric and auditable through movements. Commercial facts remain structured.

Media flow: authenticated Owner/Admin browser → Supabase Edge Function role verification → short-lived signed upload authorization → direct browser-to-Cloudinary upload → optimized master (limit 3000 × 3000, no upscaling, quality normalization, metadata stripping) → metadata-only `product_media` row. Storefront delivery uses requested widths with `q_auto,f_auto` and Cloudinary CDN caching; derivatives are generated on demand.

Secure deletion is requested by the authenticated browser and performed server-side by a Supabase Edge Function before metadata deletion. Primary selection and reorder operations use narrowly scoped PostgreSQL functions, while variant membership and primary fallback are database enforced.

Cloudflare/OpenNext and Vercel hosting are not approved. Checkout, orders, payments, customer accounts, and promotions remain outside Phase 4.
