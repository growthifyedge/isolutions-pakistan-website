# Security notes

- Supabase publishable client credentials may be used in the browser because PostgreSQL RLS is the authorization boundary.
- Never expose or request service-role keys, secret keys, database passwords, access tokens, or privileged credentials.
- Admin status is database-backed through `profiles`; frontend email checks are forbidden.
- RLS is enabled on all exposed Phase 3A tables. Anonymous/public reads are restricted to active public catalog rows; drafts, profiles, inventory movements, and all writes are protected.
- Privileged writes must use authenticated Owner/Admin identities and may later use narrowly scoped RPCs or Edge Functions where direct table writes are inappropriate.
- `.env.local` is untracked. No secrets belong in Git, screenshots, logs, or client bundles.
- Cloudinary upload security and production deployment security remain deferred.
