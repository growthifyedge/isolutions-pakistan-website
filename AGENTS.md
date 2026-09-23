# Project operating agreement

- Muhammad Junaid is Owner and final decision-maker. GPT is Product Manager, Solution Architect, UX Strategist, and QA Lead. Codex is primary implementation engineer.
- Phase 0 Discovery, Phase 1 Visual Storefront, and Phase 2 Production Architecture are Owner approved.
- Phase 3A — Data Model + Admin Foundation is Owner approved and complete.
- Phase 3B — Cloudinary Media Integration is Owner approved, complete, and live-verified in the development Admin Studio.
- Current stage: Phase 4 — Real Catalog Integration, Owner authorized and in progress.
- Approved architecture: React, Vite, TypeScript; Firebase Hosting; Supabase PostgreSQL and Auth; PostgreSQL RLS; Supabase Edge Functions for signed Cloudinary operations; Cloudinary optimized masters and responsive delivery; PostgreSQL structured search.
- Preserve the Owner-approved storefront without redesign. Never inherit code or assumptions from an older iSolutions project.
- Phase 3B may implement versioned product-media metadata migrations, signed direct upload, secure delete/replace, responsive Cloudinary delivery, publication media validation, and the focused Admin Media workflow.
- Phase 4 real catalog integration/import is authorized only for explicit Owner-approved facts.
- Checkout & Orders — Owner authorized and implemented (development environment): checkout, secure storefront order creation via the `create_storefront_order` RPC (server-side pricing/validation), `orders`/`order_items`, Admin Orders, Cash on Delivery and Bank Transfer payments, and Shipping Methods (Standard Delivery free at Rs 10,000+, Fast Delivery always +Rs 200). Existing delivery eligibility rules stay locked: mobile phones Karachi only, gadgets/accessories nationwide, any cart containing a Karachi-only mobile becomes Karachi-only.
- Still unauthorized: customer accounts, card/installment payment gateways, promotions engine, and production commerce.
- Never expose or request a service-role key, database password, or privileged credential. `.env.local` remains untracked.
- Do not introduce Cloudflare/OpenNext or select Vercel as production hosting.
- Cloudinary API secrets are Edge Function secrets only. Product binaries/base64 never belong in PostgreSQL, Git, Firebase Hosting, or browser code.
- Preserve the sequence: approved Phase 3A → approved Phase 3B media → authorized Phase 4 real catalog integration → authorized Checkout & Orders → separately authorized further commerce phases.
