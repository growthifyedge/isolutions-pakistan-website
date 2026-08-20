# Testing and QA

Phase 3A gates include TypeScript, ESLint, automated commercial/security rule tests, production build, migration validation where practical, and responsive Admin Studio browser QA.

Critical assertions: variants are explicit; money is integer minor units; draft products are public-invisible; PTA `unknown` differs from `not_approved`; delivery is resolved before publication; invalid publication is blocked; inventory is numeric; public writes fail; Admin authorization is database-backed; RLS protects private and draft data.

Required Admin evidence: 1440px login state, dashboard, product list, product editor, variant editor; 390px navigation/dashboard and catalog/editor. Screenshots live under `artifacts/screenshots/admin/`.

Remote verification evidence lives at `artifacts/phase3a/remote-verification.json`. The publishable-key behavioral suite verifies public catalog availability plus anonymous denial of profiles, inventory movements, catalog writes, and the Admin authorization RPC.

Owner-authenticated authorization was manually verified on 2026-08-21: Supabase Auth login succeeded, the database-backed `is_catalog_admin()` check authorized the active `owner` profile, protected Admin routes loaded, and the header displayed `Verified Owner / Admin`. No password, access token, service-role key, or database secret was requested or stored.

Authenticated Admin screenshots use a clearly identified simulated visual-QA session with the authorization RPC intercepted locally. They validate responsive presentation only; they are not counted as remote authorization evidence.
