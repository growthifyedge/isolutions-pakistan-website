-- Locked sequential SKU system (Owner approved, 2026-09-24). NOT YET APPLIED.
--
-- Every new variant SKU is exactly 5 characters: a 2-letter prefix + a 3-digit number,
-- assigned by the database when the variant is inserted.
--
--   Category (slug)                      Prefix   Product Type
--   Mobile Phones (mobile-phones)        MB       Mobile Phone
--   Accessories   (mobile-accessories)   AC       Accessory
--   Gadgets       (gadgets)              GD       Gadget
--   Laptops       (laptops)              MC       Laptop / MacBook
--   Tablets       (tablets)              IP       Tablet / iPad
--
-- * Each prefix has its own PostgreSQL sequence (MB001, MB002, ... independent of AC001, ...).
--   nextval() is atomic, so simultaneous imports can never receive the same number.
-- * Numbers are never reused: sequences only move forward, a deleted variant's number is not
--   handed out again, and a rolled-back import simply leaves a gap.
-- * Sequences stop at 999 and raise catalog_sku_sequence_exhausted instead of producing a
--   6-character SKU.
-- * New variants must be inserted with a blank SKU (the database assigns it); a supplied SKU
--   on insert is rejected. An existing variant's SKU can never be changed, so Replace Existing
--   keeps it. Variant identity never depends on the SKU.
--
-- Apply order: 202609240001 (categories), 202609240002 (reset), then this file. It requires
-- the locked categories and that no variant still carries an old-format SKU.

begin;

-- ---------------------------------------------------------------------------
-- Preconditions
-- ---------------------------------------------------------------------------
do $$
begin
  if (
    select count(*)
    from public.categories
    where slug in ('mobile-phones', 'mobile-accessories', 'gadgets', 'laptops', 'tablets')
      and data_class = 'real'
      and is_active
  ) <> 5 then
    raise exception 'catalog_sku_precondition_failed: apply 202609240001_category_structure_final.sql first';
  end if;

  if exists (select 1 from public.product_variants where sku !~ '^(MB|AC|GD|MC|IP)[0-9]{3}$') then
    raise exception 'catalog_sku_precondition_failed: variants with old-format SKUs exist; apply 202609240002_dummy_catalog_and_order_reset.sql first';
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- Sequences (one per prefix, 1..999, no cycling)
-- ---------------------------------------------------------------------------
create sequence public.catalog_sku_mb_seq as integer minvalue 1 maxvalue 999 start with 1 no cycle;
create sequence public.catalog_sku_ac_seq as integer minvalue 1 maxvalue 999 start with 1 no cycle;
create sequence public.catalog_sku_gd_seq as integer minvalue 1 maxvalue 999 start with 1 no cycle;
create sequence public.catalog_sku_mc_seq as integer minvalue 1 maxvalue 999 start with 1 no cycle;
create sequence public.catalog_sku_ip_seq as integer minvalue 1 maxvalue 999 start with 1 no cycle;

revoke all on sequence
  public.catalog_sku_mb_seq, public.catalog_sku_ac_seq, public.catalog_sku_gd_seq,
  public.catalog_sku_mc_seq, public.catalog_sku_ip_seq
from public, anon, authenticated;

-- Continue after any sequential SKU that already exists (none are expected after the reset).
do $$
declare
  prefix text;
  highest integer;
begin
  foreach prefix in array array['MB', 'AC', 'GD', 'MC', 'IP'] loop
    select max(substr(sku, 3)::integer) into highest
    from public.product_variants
    where sku ~ ('^' || prefix || '[0-9]{3}$');
    if highest is not null then
      perform setval(format('public.catalog_sku_%s_seq', lower(prefix))::regclass, highest, true);
    end if;
  end loop;
end
$$;

-- ---------------------------------------------------------------------------
-- Prefix and next-SKU functions
-- ---------------------------------------------------------------------------
create function public.catalog_sku_prefix(p_category_id uuid)
returns text
language sql
stable
set search_path = ''
as $$
  select case c.slug
    when 'mobile-phones' then 'MB'
    when 'mobile-accessories' then 'AC'
    when 'gadgets' then 'GD'
    when 'laptops' then 'MC'
    when 'tablets' then 'IP'
  end
  from public.categories c
  where c.id = p_category_id;
$$;

comment on function public.catalog_sku_prefix(uuid) is
  'SKU prefix for a locked catalog category (MB/AC/GD/MC/IP); NULL for any other category.';

create function public.next_catalog_sku(p_prefix text)
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_number bigint;
begin
  begin
    v_number := case p_prefix
      when 'MB' then nextval('public.catalog_sku_mb_seq')
      when 'AC' then nextval('public.catalog_sku_ac_seq')
      when 'GD' then nextval('public.catalog_sku_gd_seq')
      when 'MC' then nextval('public.catalog_sku_mc_seq')
      when 'IP' then nextval('public.catalog_sku_ip_seq')
    end;
  exception
    when sequence_generator_limit_exceeded then
      raise exception using errcode = 'check_violation', message = format('catalog_sku_sequence_exhausted: %s', p_prefix);
  end;
  if v_number is null then
    raise exception using errcode = 'check_violation', message = format('catalog_sku_prefix_unknown: %s', coalesce(p_prefix, 'NULL'));
  end if;
  return p_prefix || lpad(v_number::text, 3, '0');
end;
$$;

revoke all on function public.next_catalog_sku(text) from public, anon, authenticated;

comment on function public.next_catalog_sku(text) is
  'Consumes and returns the next SKU for a prefix (e.g. MB001). Only called by the variant insert trigger.';

-- ---------------------------------------------------------------------------
-- Server-side assignment and immutability
-- ---------------------------------------------------------------------------
create function public.assign_catalog_variant_sku()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_prefix text;
begin
  if tg_op = 'INSERT' then
    if nullif(btrim(new.sku), '') is not null then
      raise exception using errcode = 'check_violation', message = 'catalog_sku_server_assigned',
        detail = 'Insert new variants with a blank SKU; the database assigns the next sequential SKU.';
    end if;
    select public.catalog_sku_prefix(p.category_id) into v_prefix
    from public.products p
    where p.id = new.product_id;
    if v_prefix is null then
      raise exception using errcode = 'check_violation', message = 'catalog_sku_prefix_unknown_for_category',
        detail = 'The product must be in Mobile Phones, Accessories, Gadgets, Laptops or Tablets.';
    end if;
    new.sku := public.next_catalog_sku(v_prefix);
  elsif new.sku is distinct from old.sku then
    raise exception using errcode = 'check_violation', message = 'catalog_sku_immutable';
  end if;
  return new;
end;
$$;

create trigger product_variants_assign_catalog_sku
  before insert or update of sku on public.product_variants
  for each row execute function public.assign_catalog_variant_sku();

alter table public.product_variants
  add constraint variants_sku_catalog_format check (sku ~ '^(MB|AC|GD|MC|IP)[0-9]{3}$');

comment on column public.product_variants.sku is
  'Server-assigned sequential SKU (MB/AC/GD/MC/IP + 3 digits). Immutable; never used as variant identity.';

-- ---------------------------------------------------------------------------
-- Validation
-- ---------------------------------------------------------------------------
do $$
begin
  if public.catalog_sku_prefix((select id from public.categories where slug = 'mobile-phones')) is distinct from 'MB'
    or public.catalog_sku_prefix((select id from public.categories where slug = 'mobile-accessories')) is distinct from 'AC'
    or public.catalog_sku_prefix((select id from public.categories where slug = 'gadgets')) is distinct from 'GD'
    or public.catalog_sku_prefix((select id from public.categories where slug = 'laptops')) is distinct from 'MC'
    or public.catalog_sku_prefix((select id from public.categories where slug = 'tablets')) is distinct from 'IP' then
    raise exception 'catalog_sku_validation_failed: category prefix mapping';
  end if;
  if not exists (
    select 1 from pg_trigger
    where tgrelid = 'public.product_variants'::regclass
      and tgname = 'product_variants_assign_catalog_sku'
      and not tgisinternal
  ) then
    raise exception 'catalog_sku_validation_failed: trigger missing';
  end if;
end
$$;

commit;
