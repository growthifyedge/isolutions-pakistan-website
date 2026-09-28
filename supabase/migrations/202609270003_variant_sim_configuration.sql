-- Variant SIM configuration (iPhone / new / used stock).
--
-- * sim_configuration: optional variant fact; NULL when not supplied, never inferred.
-- * Additive only: existing rows stay NULL. Variant identity / the explicit-variant
--   uniqueness key is deliberately NOT changed here.

begin;

alter table public.product_variants
  add column sim_configuration text;

alter table public.product_variants
  add constraint variants_sim_configuration_valid
    check (sim_configuration is null or sim_configuration in (
      'physical_sim', 'esim', 'physical_plus_esim', 'dual_esim'
    ));

comment on column public.product_variants.sim_configuration is
  'SIM configuration: physical_sim, esim, physical_plus_esim or dual_esim. NULL when not supplied; never invented.';

commit;
