-- Phase 2 — Staff Orders Dashboard (Owner approved for localhost, 2026-11-14). NOT YET APPLIED.
--
-- Adds the 'staff' profile role. Kept in its own migration because Postgres does not allow a new
-- enum value to be used in the same transaction that adds it; 202611140002 uses it.
--
-- 'staff' is NOT an Admin role: is_catalog_admin() still accepts only 'owner' and 'admin', so a
-- staff profile gets no access to products, inventory, media, coupons, settings or any other
-- Admin module. Staff access is granted only by the explicit policies/RPCs in 202611140002.

alter type public.app_role add value if not exists 'staff';
