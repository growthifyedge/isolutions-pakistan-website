# Approved production architecture

## Current scope

Phase 3A implements the data model, PostgreSQL/RLS security boundary, Supabase Auth authorization foundation, and a responsive Admin Studio. The Owner-approved storefront remains unchanged and continues using clearly marked mock catalog data until a later catalog-integration approval.

## Approved stack

- Frontend: React, Vite, TypeScript
- Hosting: Firebase Hosting, Spark/free tier initially; custom domain later
- Database: Supabase PostgreSQL
- Authentication: Supabase Auth
- Authorization: PostgreSQL Row Level Security backed by `profiles`
- Privileged operations: Supabase Edge Functions and/or narrowly designed PostgreSQL RPCs when required
- Media: Cloudinary approved, but implementation deferred
- Search: PostgreSQL/Supabase structured filtering and search

Commercial money uses `BIGINT` integer minor units. Sellable variants are explicit rows, never Cartesian combinations. Publication uses validated state transitions rather than a blind boolean. Inventory is numeric and auditable through movements. Commercial facts remain structured.

Cloudflare/OpenNext and Vercel hosting are not approved. Checkout, orders, payments, customer accounts, promotions, Cloudinary implementation, and real catalog import remain outside Phase 3A.
