begin;

-- Compare-at pricing is optional, but a displayed original price must exceed
-- the corresponding sell price. Normalize legacy equal/lower values to null
-- before enforcing that invariant at the database boundary.
update public.product_variants
set compare_at_price_minor = null
where compare_at_price_minor is not null
  and compare_at_price_minor <= price_minor;

alter table public.product_variants
  drop constraint if exists variants_compare_price_valid;

alter table public.product_variants
  drop constraint if exists variants_compare_price_strictly_greater;

alter table public.product_variants
  add constraint variants_compare_price_strictly_greater
  check (
    compare_at_price_minor is null
    or compare_at_price_minor > price_minor
  );

comment on column public.product_variants.compare_at_price_minor is
  'Optional original price in integer PKR minor units; when present it must exceed price_minor.';

commit;
