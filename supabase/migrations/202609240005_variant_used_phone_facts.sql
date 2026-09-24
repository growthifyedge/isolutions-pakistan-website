-- Bulk Upload v2 Phase 2: used-phone facts on variants (Owner approved, 2026-09-24).
-- NOT YET APPLIED. Apply before 202609240006_bulk_import_v2.sql.
--
-- * condition_grade: the used-phone grade, currently only 'A++'. The base condition stays
--   in the existing product_condition enum ('used'); the enum is not changed.
-- * battery_health_percent (1-100) and battery_cycle_count (>= 0): optional; blank stays NULL.
-- * The explicit-variant uniqueness key gains the three facts, so two used units of the same
--   configuration with different grade / battery health / cycle count can coexist.
-- Additive only: existing rows get NULLs, and order_items keep referencing variant ids.

begin;

alter table public.product_variants
  add column condition_grade text,
  add column battery_health_percent smallint,
  add column battery_cycle_count integer;

alter table public.product_variants
  add constraint variants_condition_grade_valid
    check (condition_grade is null or (condition_grade = 'A++' and condition = 'used')),
  add constraint variants_battery_health_range
    check (battery_health_percent is null or battery_health_percent between 1 and 100),
  add constraint variants_battery_cycle_nonnegative
    check (battery_cycle_count is null or battery_cycle_count >= 0);

alter table public.product_variants
  drop constraint variants_explicit_combination_unique;
alter table public.product_variants
  add constraint variants_explicit_combination_unique
  unique nulls not distinct
  (product_id, ram_display, storage_display, color_finish, pta_status, condition, carrier_jv,
   condition_grade, battery_health_percent, battery_cycle_count);

comment on column public.product_variants.condition_grade is
  'Used-phone grade (currently A++). Only valid when condition = used. NULL when not supplied.';
comment on column public.product_variants.battery_health_percent is
  'Battery health 1-100 for used phones. NULL when not supplied; never invented.';
comment on column public.product_variants.battery_cycle_count is
  'Battery cycle count (>= 0) for used phones. NULL when not supplied; never invented.';

commit;
