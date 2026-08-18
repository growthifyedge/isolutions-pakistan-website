# Prototype architecture

This disposable visual prototype uses React, Vite, and TypeScript. `src/data/mockCatalog.ts` is the single source for explicitly labeled mock merchandising data. `src/App.tsx` holds the small route-level visual system and `src/styles.css` owns centrally manageable design tokens and responsive layouts.

No router dependency is needed for three prototype routes; pathname selection is intentionally simple. No production architecture, backend contract, persistence, schema, media pipeline, commerce service, or deployment target is selected. Those decisions remain open until Owner approval.
