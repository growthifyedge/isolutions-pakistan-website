# Next Codex session

Continue the existing iSolutions Pakistan website from the checked-in project state. Phase 3A is Owner approved and complete. Phase 3B Cloudinary integration is in progress with code complete in a safe pre-connection state. Read `AGENTS.md`, `PROJECT_STATE.json`, migrations, tests, and current Git state first. Preserve the approved storefront and Admin design.

Do not request or expose secrets. Confirm the Owner has configured `VITE_CLOUDINARY_CLOUD_NAME` locally and `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET` as Supabase Edge Function secrets, then apply `202608210001_phase_3b_cloudinary_media.sql`, deploy `cloudinary-upload-signature` and `cloudinary-delete-media`, and perform one development-only end-to-end media verification. Do not import real catalog data or start commerce.
