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
- The stored master uses a 3000 × 3000 limit transformation without upscaling, fixed premium quality normalization, and metadata stripping. `f_auto` is reserved for delivery, not master storage.
- PostgreSQL stores references and descriptive metadata only. Image binary, blobs, and base64 data are forbidden.
- Media deletion is Owner/Admin-only and server-side. Database triggers preserve a valid primary fallback after deletion; reorder sets and variant ownership are validated atomically.
