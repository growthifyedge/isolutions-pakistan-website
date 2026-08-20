-- iSolutions Pakistan — Owner-approved Phase 3A catalog and admin foundation.
-- This migration intentionally contains no real catalog or commercial fixture data.

create extension if not exists pgcrypto with schema extensions;

create type public.app_role as enum ('owner', 'admin');
create type public.product_publication_status as enum ('draft', 'published', 'archived');
create type public.pta_status as enum ('approved', 'not_approved', 'not_applicable', 'unknown');
create type public.product_condition as enum ('brand_new', 'used', 'open_box', 'refurbished', 'unknown');
create type public.delivery_scope as enum ('karachi_only', 'nationwide');
create type public.inventory_movement_reason as enum ('initial', 'purchase', 'sale', 'return', 'correction', 'damage', 'other');

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  role public.app_role,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint profiles_display_name_length check (display_name is null or char_length(trim(display_name)) between 1 and 120)
);

comment on table public.profiles is 'Database-backed Owner/Admin authorization. Role assignment is privileged and never inferred from email.';

create table public.brands (
  id uuid primary key default extensions.gen_random_uuid(),
  name text not null,
  slug text not null unique,
  description text,
  logo_reference text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint brands_name_not_blank check (char_length(trim(name)) > 0),
  constraint brands_slug_format check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$')
);

create table public.categories (
  id uuid primary key default extensions.gen_random_uuid(),
  parent_id uuid references public.categories(id) on delete restrict,
  name text not null,
  slug text not null unique,
  description text,
  is_active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint categories_name_not_blank check (char_length(trim(name)) > 0),
  constraint categories_slug_format check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  constraint categories_not_own_parent check (parent_id is null or parent_id <> id)
);

create table public.products (
  id uuid primary key default extensions.gen_random_uuid(),
  brand_id uuid not null references public.brands(id) on delete restrict,
  category_id uuid not null references public.categories(id) on delete restrict,
  title text not null,
  slug text not null unique,
  short_description text,
  content text,
  publication_status public.product_publication_status not null default 'draft',
  default_warranty text,
  default_delivery_scope public.delivery_scope,
  seo_title text,
  seo_description text,
  published_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint products_title_not_blank check (char_length(trim(title)) > 0),
  constraint products_slug_format check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  constraint products_seo_title_length check (seo_title is null or char_length(seo_title) <= 70),
  constraint products_seo_description_length check (seo_description is null or char_length(seo_description) <= 170)
);

create table public.product_variants (
  id uuid primary key default extensions.gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete cascade,
  sku text not null unique,
  ram_display text,
  storage_display text,
  color_finish text,
  price_minor bigint not null,
  compare_at_price_minor bigint,
  pta_status public.pta_status not null default 'unknown',
  condition public.product_condition not null default 'unknown',
  warranty_override text,
  carrier_jv text,
  delivery_scope public.delivery_scope,
  is_active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint variants_sku_not_blank check (char_length(trim(sku)) > 0),
  constraint variants_price_nonnegative check (price_minor >= 0),
  constraint variants_compare_price_valid check (compare_at_price_minor is null or compare_at_price_minor >= price_minor),
  constraint variants_explicit_combination_unique unique nulls not distinct (product_id, ram_display, storage_display, color_finish, carrier_jv)
);

comment on table public.product_variants is 'Each row is one explicit sellable combination. Cartesian variant generation is forbidden.';
comment on column public.product_variants.price_minor is 'Integer PKR minor units. Floating-point commercial money is forbidden.';

create table public.inventory_movements (
  id bigint generated always as identity primary key,
  variant_id uuid not null references public.product_variants(id) on delete restrict,
  quantity_delta integer not null,
  reason public.inventory_movement_reason not null,
  reference text,
  note text,
  actor_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint inventory_delta_nonzero check (quantity_delta <> 0)
);

create table public.product_specifications (
  id uuid primary key default extensions.gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete cascade,
  specification_group text,
  label text not null,
  value text not null,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint specifications_label_not_blank check (char_length(trim(label)) > 0),
  constraint specifications_value_not_blank check (char_length(trim(value)) > 0),
  constraint specifications_unique_label unique nulls not distinct (product_id, specification_group, label)
);

create table public.product_media (
  id uuid primary key default extensions.gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete cascade,
  variant_id uuid references public.product_variants(id) on delete cascade,
  cloudinary_public_id text,
  alt_text text not null,
  sort_order integer not null default 0,
  is_primary boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint media_alt_not_blank check (char_length(trim(alt_text)) > 0)
);

create unique index product_media_one_primary_per_product on public.product_media(product_id) where is_primary;
create index categories_parent_id_idx on public.categories(parent_id);
create index products_publication_idx on public.products(publication_status, published_at desc);
create index products_brand_idx on public.products(brand_id);
create index products_category_idx on public.products(category_id);
create index product_variants_product_idx on public.product_variants(product_id, is_active, sort_order);
create index inventory_movements_variant_idx on public.inventory_movements(variant_id, created_at desc);
create index specifications_product_idx on public.product_specifications(product_id, sort_order);
create index product_media_product_idx on public.product_media(product_id, sort_order);

create function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger profiles_set_updated_at before update on public.profiles for each row execute function public.set_updated_at();
create trigger brands_set_updated_at before update on public.brands for each row execute function public.set_updated_at();
create trigger categories_set_updated_at before update on public.categories for each row execute function public.set_updated_at();
create trigger products_set_updated_at before update on public.products for each row execute function public.set_updated_at();
create trigger variants_set_updated_at before update on public.product_variants for each row execute function public.set_updated_at();
create trigger specifications_set_updated_at before update on public.product_specifications for each row execute function public.set_updated_at();
create trigger media_set_updated_at before update on public.product_media for each row execute function public.set_updated_at();

create function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, display_name, role)
  values (new.id, nullif(trim(new.raw_user_meta_data ->> 'display_name'), ''), null)
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_auth_user();

create function public.is_catalog_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles
    where id = (select auth.uid())
      and role in ('owner'::public.app_role, 'admin'::public.app_role)
      and is_active
  );
$$;

revoke all on function public.is_catalog_admin() from public;
grant execute on function public.is_catalog_admin() to authenticated;

create function public.current_inventory(p_variant_id uuid)
returns bigint
language sql
stable
security invoker
set search_path = ''
as $$
  select coalesce(sum(quantity_delta), 0)::bigint
  from public.inventory_movements
  where variant_id = p_variant_id;
$$;

revoke all on function public.current_inventory(uuid) from public;
grant execute on function public.current_inventory(uuid) to authenticated;

create function public.validate_product_for_publication(p_product_id uuid)
returns table (is_valid boolean, errors text[])
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_errors text[] := array[]::text[];
  v_product public.products%rowtype;
begin
  select * into v_product from public.products where id = p_product_id;
  if not found then return query select false, array['product_not_found']; return; end if;
  if nullif(trim(v_product.title), '') is null then v_errors := array_append(v_errors, 'title_required'); end if;
  if not exists (select 1 from public.brands where id = v_product.brand_id and is_active) then v_errors := array_append(v_errors, 'active_brand_required'); end if;
  if not exists (select 1 from public.categories where id = v_product.category_id and is_active) then v_errors := array_append(v_errors, 'active_category_required'); end if;
  if not exists (select 1 from public.product_variants where product_id = p_product_id and is_active) then v_errors := array_append(v_errors, 'active_variant_required'); end if;
  if exists (
    select 1 from public.product_variants
    where product_id = p_product_id and is_active
      and (price_minor <= 0 or delivery_scope is null or pta_status = 'unknown' or condition = 'unknown'
        or nullif(trim(coalesce(warranty_override, v_product.default_warranty)), '') is null)
  ) then v_errors := array_append(v_errors, 'variant_commercial_facts_unresolved'); end if;
  return query select cardinality(v_errors) = 0, v_errors;
end;
$$;

revoke all on function public.validate_product_for_publication(uuid) from public;
grant execute on function public.validate_product_for_publication(uuid) to authenticated;

create function public.enforce_product_publication()
returns trigger
language plpgsql
set search_path = ''
as $$
declare v_valid boolean; v_errors text[];
begin
  if new.publication_status = 'published' and (tg_op = 'INSERT' or old.publication_status is distinct from 'published') then
    if tg_op = 'INSERT' then
      raise exception using errcode = 'check_violation', message = 'product_must_be_saved_as_draft_before_publication_validation';
    end if;
    select is_valid, errors into v_valid, v_errors from public.validate_product_for_publication(new.id);
    if not v_valid then raise exception using errcode = 'check_violation', message = 'product_publication_validation_failed', detail = array_to_string(v_errors, ','); end if;
    new.published_at = coalesce(new.published_at, now());
  elsif new.publication_status <> 'published' then
    new.published_at = null;
  end if;
  return new;
end;
$$;

create trigger products_enforce_publication before insert or update of publication_status on public.products for each row execute function public.enforce_product_publication();

create view public.admin_variant_inventory
with (security_invoker = true)
as
select v.id as variant_id, v.product_id, v.sku, coalesce(sum(m.quantity_delta), 0)::bigint as quantity_on_hand
from public.product_variants v
left join public.inventory_movements m on m.variant_id = v.id
group by v.id, v.product_id, v.sku;

comment on view public.admin_variant_inventory is 'Admin-only numeric inventory projection; underlying RLS applies via security_invoker.';
