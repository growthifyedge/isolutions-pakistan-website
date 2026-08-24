# Testing and QA

Phase 3A gates include TypeScript, ESLint, automated commercial/security rule tests, production build, migration validation where practical, and responsive Admin Studio browser QA.

Critical assertions: variants are explicit; money is integer minor units; draft products are public-invisible; PTA `unknown` differs from `not_approved`; delivery is resolved before publication; invalid publication is blocked; inventory is numeric; public writes fail; Admin authorization is database-backed; RLS protects private and draft data.

Required Admin evidence: 1440px login state, dashboard, product list, product editor, variant editor; 390px navigation/dashboard and catalog/editor. Screenshots live under `artifacts/screenshots/admin/`.

Remote verification evidence lives at `artifacts/phase3a/remote-verification.json`. The publishable-key behavioral suite verifies public catalog availability plus anonymous denial of profiles, inventory movements, catalog writes, and the Admin authorization RPC.

Owner-authenticated authorization was manually verified on 2026-08-21: Supabase Auth login succeeded, the database-backed `is_catalog_admin()` check authorized the active `owner` profile, protected Admin routes loaded, and the header displayed `Verified Owner / Admin`. No password, access token, service-role key, or database secret was requested or stored.

Authenticated Admin screenshots use a clearly identified simulated visual-QA session with the authorization RPC intercepted locally. They validate responsive presentation only; they are not counted as remote authorization evidence.

Phase 3B automated assertions cover Edge Function Admin authorization, metadata-only storage, primary fallback, atomic reorder validation, variant ownership, required publication media, server-side delete ordering, master/delivery transformation separation, absence of Cloudinary secrets from frontend source, and Media navigation delegation. All 16 tests pass.

Phase 3B remote evidence lives at `artifacts/phase3b/remote-verification.json`. Its publishable-key-only checks confirm the approved media columns are live and anonymous callers are denied by the primary-selection RPC and both Cloudinary Edge Functions.

Owner-authenticated live lifecycle verification was confirmed on 2026-08-25: signed upload completed, metadata and alt text updated, a second image uploaded, primary selection changed, sidebar Media navigated to the product editor, and deletion preserved a valid remaining primary image. No password, access token, service-role key, database password, or Cloudinary secret was requested or stored.

Final visual evidence includes `desktop-media-library.png`, `desktop-media-direct.png`, `mobile-media-library.png`, and `mobile-media-direct.png`. The 13-route responsive suite passed with no overflow, broken images, or page errors. These screenshots use the clearly labelled simulated visual-QA dataset and are presentation evidence; the Owner-confirmed development Admin Studio run is the authenticated functional evidence. The production build confirms the storefront and lazy-loaded Admin boundary remain separate.

Phase 4 adds 16 tests covering draft invisibility, development isolation, published-real queries, slug routing, explicit variants, integer money, valid compare-at prices, PTA semantics, explicit delivery, numeric stock, responsive Cloudinary media, database-side filters, anonymous non-mutation, Admin management, and Phase 3B regression. Combined result: 32/32 passing.

Phase 4 visual evidence lives under `artifacts/screenshots/phase4/`. Fifteen homepage, Shop, slug-PDP, Admin Products, Admin Editor, and Admin Media views passed at 1440px, 768px, and 390px with no overflow, broken images, console errors, or page errors. Because no approved real catalog dataset exists, public-product and Admin presentation screenshots use a clearly labelled simulated published-real fixture; they are presentation evidence, not a claim of imported data.

Publishable-key Phase 3A/3B remote regressions pass. Phase 4 remote schema/query verification is intentionally pending until the Owner applies `202608250001_phase_4_real_catalog.sql`; no database credential or service-role key was requested.
