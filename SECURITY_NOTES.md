# Security notes

- Supabase publishable client credentials may be used in the browser because PostgreSQL RLS is the authorization boundary.
- Never expose or request service-role keys, secret keys, database passwords, access tokens, or privileged credentials.
- Admin status is database-backed through `profiles`; frontend email checks are forbidden.
- RLS is enabled on all exposed Phase 3A tables. Anonymous/public reads are restricted to active public catalog rows; drafts, profiles, inventory movements, and all writes are protected.
- Privileged writes must use authenticated Owner/Admin identities and may later use narrowly scoped RPCs or Edge Functions where direct table writes are inappropriate.
- `.env.local` is untracked. No secrets belong in Git, screenshots, logs, or client bundles.
- Cloudinary upload authorization and destruction run only in Supabase Edge Functions after Auth identity and `is_catalog_admin()` verification.
- `CLOUDINARY_API_SECRET` and `CLOUDINARY_API_KEY` are Edge Function secrets and must never use a `VITE_` prefix. Only the cloud name is browser-visible.
- Upload authorization responses are treated as short-lived and include a five-minute client expiry marker. The browser uploads directly to Cloudinary; Supabase never proxies large image files.
- Cloudinary signatures use SHA-256 over the minimal required signed parameter set: `folder`, `timestamp`, and `transformation`. Default boolean upload options are omitted rather than string-canonicalized.
- The stored master uses a 3000 × 3000 limit transformation without upscaling, fixed premium quality normalization, and Cloudinary's supported `fl_force_strip` metadata stripping. `f_auto` is reserved for delivery, not master storage.
- Final publishable-key verification confirms anonymous callers receive HTTP 401 from both Cloudinary Edge Functions and the primary-media RPC; Owner-authenticated lifecycle verification succeeded without storing credentials or tokens.
- PostgreSQL stores references and descriptive metadata only. Image binary, blobs, and base64 data are forbidden.
- Media deletion is Owner/Admin-only and server-side. Database triggers preserve a valid primary fallback after deletion; reorder sets and variant ownership are validated atomically.
- Phase 4 defaults brands, categories, and products to `development`; only explicitly Owner-approved `real` records can pass public RLS and publication validation.
- `search_public_catalog` is a read-only security-definer function with explicit published-real predicates. It exposes numeric availability without granting anonymous access to `inventory_movements`.
- Related public variant, specification, and media policies explicitly require a published `real` parent product. Draft, archived, and development records remain public-invisible.
- Public search/filter parameters are typed and executed in PostgreSQL. The browser receives only public catalog projections and has no mutation path.
- Public storefront taxonomy uses `public_catalog_taxonomy()` rather than direct tables, preventing authenticated Admin read-all policies from widening public navigation/filter results.
## Phase 4 bulk import boundary

Bulk preview uses authenticated RLS reads. Writes are available only through `apply_catalog_bulk_import(jsonb)`, which checks `is_catalog_admin()`, revalidates real taxonomy/product/variant identities, and executes atomically. Anonymous execution is revoked; no privileged key is present in browser code.
