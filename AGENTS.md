# Project operating agreement

- Muhammad Junaid is Owner and final decision-maker. GPT is Product Manager, Solution Architect, UX Strategist, and QA Lead. Codex is primary implementation engineer.
- Phase 0 Discovery, Phase 1 Visual Storefront, and Phase 2 Production Architecture are Owner approved.
- Phase 3A — Data Model + Admin Foundation is Owner approved and complete.
- Phase 3B — Cloudinary Media Integration is complete and live-verified in the development Admin Studio; the next phase requires separate Owner authorization.
- Approved architecture: React, Vite, TypeScript; Firebase Hosting; Supabase PostgreSQL and Auth; PostgreSQL RLS; Supabase Edge Functions for signed Cloudinary operations; Cloudinary optimized masters and responsive delivery; PostgreSQL structured search.
- Preserve the Owner-approved storefront without redesign. Never inherit code or assumptions from an older iSolutions project.
- Phase 3B may implement versioned product-media metadata migrations, signed direct upload, secure delete/replace, responsive Cloudinary delivery, publication media validation, and the focused Admin Media workflow.
- Still unauthorized: real catalog import, customer accounts, checkout, orders, payments, promotions engine, and production commerce.
- Never expose or request a service-role key, database password, or privileged credential. `.env.local` remains untracked.
- Do not introduce Cloudflare/OpenNext or select Vercel as production hosting.
- Cloudinary API secrets are Edge Function secrets only. Product binaries/base64 never belong in PostgreSQL, Git, Firebase Hosting, or browser code.
- Preserve the sequence: approved Phase 3A → Phase 3B media → Owner/GPT review → separately authorized real catalog and commerce phases.
