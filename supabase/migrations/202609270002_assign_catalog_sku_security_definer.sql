-- Signed-in Admin variant inserts: run the SKU trigger function as its owner.
-- NOT YET APPLIED. Requires 202609240003_catalog_sku_sequences.sql.
--
-- The variant insert trigger calls public.next_catalog_sku(text), whose EXECUTE is revoked
-- from anon and authenticated. As an invoker function, assign_catalog_variant_sku() failed
-- for Admin inserts outside a SECURITY DEFINER RPC. Running it as its owner lets the trigger
-- assign SKUs while next_catalog_sku stays uncallable directly by clients; variant inserts
-- remain limited to catalog admins by RLS. SKU logic is unchanged; search_path stays ''.

begin;

alter function public.assign_catalog_variant_sku()
  security definer
  set search_path = '';

commit;
