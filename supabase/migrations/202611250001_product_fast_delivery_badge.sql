begin;

-- Product-level Fast Delivery badge (PDP only). Default OFF for every existing and new product.
-- Display flag only: it does not change shipping fees, shipping methods or delivery eligibility.
-- Reads/writes use the existing products RLS policies (public read of published rows, catalog-admin update).
alter table public.products
  add column if not exists is_fast_delivery boolean not null default false;

comment on column public.products.is_fast_delivery is
  'Shows the fixed "Fast Delivery" badge beside the PDP price when true. Display only; default false.';

commit;
