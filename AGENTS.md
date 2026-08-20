# Project operating agreement

- Muhammad Junaid is Owner and final decision-maker. GPT is Product Manager, Solution Architect, UX Strategist, and QA Lead. Codex is primary implementation engineer.
- Phase 0 Discovery, Phase 1 Visual Storefront, and Phase 2 Production Architecture are Owner approved.
- Current stage: Phase 3A — Data Model + Admin Foundation, authorized and in progress.
- Approved architecture: React, Vite, TypeScript; Firebase Hosting; Supabase PostgreSQL and Auth; PostgreSQL RLS; Supabase Edge Functions and/or carefully designed RPCs for privileged operations; Cloudinary later; PostgreSQL structured search.
- Preserve the Owner-approved storefront without redesign. Never inherit code or assumptions from an older iSolutions project.
- Phase 3A may implement versioned database migrations, RLS, database-backed Owner/Admin authorization, catalog/inventory foundations, and the Admin Studio.
- Still unauthorized: Cloudinary implementation, real catalog import, customer accounts, checkout, orders, payments, promotions engine, and production commerce.
- Never expose or request a service-role key, database password, or privileged credential. `.env.local` remains untracked.
- Do not introduce Cloudflare/OpenNext or select Vercel as production hosting.
- Preserve the sequence: approved architecture → Phase 3A foundation → Owner/GPT review → later media/catalog/commerce phases only when separately authorized.
