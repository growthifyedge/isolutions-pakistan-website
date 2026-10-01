-- Android mobile warranty backfill (Owner approved, 2026-10-01). Data-only, one transaction.
--
-- Owner rule: Android / non-Apple Mobile Phones with no warranty get "1 Year"; an explicit
-- warranty is never overwritten. Future Bulk Upload v2 imports apply the same rule before
-- preview (src/lib/catalogSheet.ts). This migration backfills the existing real bulk Android
-- variants by setting product_variants.warranty_override = '1 Year'.
--
-- Candidates (all must hold), the same criteria as the Owner-reviewed read-only dry run:
--   * products.data_class = 'real'
--   * category slug = 'mobile-phones'
--   * brand resolved (products.brand_id set, non-blank name) and the brand is not Apple
--   * the product title does not mention iPhone
--   * effective warranty blank: variant warranty_override AND product default_warranty blank
--
-- Guard: the dry run found exactly 105 products / 305 variants. If the candidate set differs
-- in either count, the migration raises before anything is written and the whole transaction
-- (including the audit table) rolls back.
--
-- Never changed: products.default_warranty, price, compare-at, inventory/stock, PTA,
-- condition, SKU, media, publication status. Nothing is published.
--
-- Audit: every updated variant is recorded in public.catalog_warranty_backfill_audit under
-- batch 'android_mobile_warranty_1_year_2026_10_01' (previous and new values, bulk origin).
-- Rerun: if that batch is already recorded, the migration changes nothing (NOTICE only).
--
-- Reverse (run in one transaction; restores only rows still holding the backfilled value):
--   update public.product_variants v
--   set warranty_override = a.previous_warranty_override
--   from public.catalog_warranty_backfill_audit a
--   where a.batch_label = 'android_mobile_warranty_1_year_2026_10_01'
--     and a.variant_id = v.id
--     and v.warranty_override = a.new_warranty_override;
--   delete from public.catalog_warranty_backfill_audit
--   where batch_label = 'android_mobile_warranty_1_year_2026_10_01';

begin;

create table if not exists public.catalog_warranty_backfill_audit (
  id bigint generated always as identity primary key,
  batch_label text not null,
  -- No foreign keys: the audit outlives later catalog cleanup.
  variant_id uuid not null,
  sku text not null,
  product_id uuid not null,
  brand text not null,
  product_title text not null,
  condition text not null,
  is_active boolean not null,
  has_bulk_import_v2_movement boolean not null,
  previous_warranty_override text,
  previous_product_default_warranty text,
  new_warranty_override text not null,
  applied_at timestamptz not null default now(),
  unique (batch_label, variant_id)
);

comment on table public.catalog_warranty_backfill_audit is
  'One row per variant changed by a catalog warranty backfill (previous and new value). Owner/SQL Editor only.';

alter table public.catalog_warranty_backfill_audit enable row level security;
revoke all on table public.catalog_warranty_backfill_audit from public, anon, authenticated;

-- No catalog writes may interleave between counting and updating.
lock table public.products, public.product_variants in share row exclusive mode;

do $$
declare
  c_batch constant text := 'android_mobile_warranty_1_year_2026_10_01';
  c_warranty constant text := '1 Year';
  c_expected_products constant integer := 105;
  c_expected_variants constant integer := 305;
  v_products integer;
  v_variants integer;
  v_updated integer;
begin
  if exists (select 1 from public.catalog_warranty_backfill_audit where batch_label = c_batch) then
    raise notice 'Android warranty backfill % is already recorded; nothing changed.', c_batch;
    return;
  end if;

  create temporary table android_warranty_candidates on commit drop as
  select
    v.id as variant_id,
    v.sku,
    p.id as product_id,
    b.name as brand,
    p.title as product_title,
    v.condition::text as condition,
    v.is_active,
    exists (
      select 1 from public.inventory_movements m
      where m.variant_id = v.id and m.reference = 'bulk_import_v2'
    ) as has_bulk_import_v2_movement,
    v.warranty_override as previous_warranty_override,
    p.default_warranty as previous_product_default_warranty
  from public.product_variants v
  join public.products p on p.id = v.product_id
  join public.categories c on c.id = p.category_id
  join public.brands b on b.id = p.brand_id
  where p.data_class = 'real'
    and c.slug = 'mobile-phones'
    and nullif(btrim(b.name), '') is not null
    and lower(btrim(b.name)) <> 'apple'
    and p.title !~* 'iphone'
    and nullif(btrim(v.warranty_override), '') is null
    and nullif(btrim(p.default_warranty), '') is null;

  select count(distinct product_id), count(*)
  into v_products, v_variants
  from pg_temp.android_warranty_candidates;

  if v_products <> c_expected_products or v_variants <> c_expected_variants then
    raise exception 'android_warranty_backfill_guard: expected % products / % variants, found % / %; nothing changed',
      c_expected_products, c_expected_variants, v_products, v_variants;
  end if;

  insert into public.catalog_warranty_backfill_audit (
    batch_label, variant_id, sku, product_id, brand, product_title, condition, is_active,
    has_bulk_import_v2_movement, previous_warranty_override, previous_product_default_warranty,
    new_warranty_override
  )
  select
    c_batch, variant_id, sku, product_id, brand, product_title, condition, is_active,
    has_bulk_import_v2_movement, previous_warranty_override, previous_product_default_warranty,
    c_warranty
  from pg_temp.android_warranty_candidates;

  -- Only warranty_override changes, and only where it is still blank.
  update public.product_variants v
  set warranty_override = c_warranty
  from pg_temp.android_warranty_candidates c
  where v.id = c.variant_id
    and nullif(btrim(v.warranty_override), '') is null;
  get diagnostics v_updated = row_count;

  if v_updated <> c_expected_variants then
    raise exception 'android_warranty_backfill_guard: updated % variants, expected %; rolled back',
      v_updated, c_expected_variants;
  end if;

  raise notice 'Android warranty backfill %: % variants across % products set to "%".',
    c_batch, v_updated, v_products, c_warranty;
end;
$$;

commit;
