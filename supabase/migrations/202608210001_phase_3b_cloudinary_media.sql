begin;

alter table public.product_media
  add column if not exists cloudinary_asset_id text,
  add column if not exists cloudinary_version bigint,
  add column if not exists secure_url text,
  add column if not exists width integer,
  add column if not exists height integer,
  add column if not exists bytes bigint,
  add column if not exists format text;

alter table public.product_media drop constraint if exists media_dimensions_positive;
alter table public.product_media add constraint media_dimensions_positive
  check ((width is null and height is null) or (width > 0 and height > 0));
alter table public.product_media drop constraint if exists media_bytes_positive;
alter table public.product_media add constraint media_bytes_positive check (bytes is null or bytes > 0);
alter table public.product_media drop constraint if exists media_cloudinary_reference_complete;
alter table public.product_media add constraint media_cloudinary_reference_complete check (
  cloudinary_public_id is null or (
    cloudinary_asset_id is not null and cloudinary_version is not null and
    secure_url is not null and width is not null and height is not null and
    bytes is not null and format is not null
  )
);

create unique index if not exists product_media_cloudinary_public_id_unique
  on public.product_media(cloudinary_public_id) where cloudinary_public_id is not null;
create unique index if not exists product_media_cloudinary_asset_id_unique
  on public.product_media(cloudinary_asset_id) where cloudinary_asset_id is not null;

create or replace function public.enforce_product_media_variant_membership()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.variant_id is not null and not exists (
    select 1 from public.product_variants
    where id = new.variant_id and product_id = new.product_id
  ) then
    raise exception using errcode = 'foreign_key_violation', message = 'media_variant_must_belong_to_product';
  end if;
  return new;
end;
$$;
drop trigger if exists product_media_variant_membership on public.product_media;
create trigger product_media_variant_membership
  before insert or update of product_id, variant_id on public.product_media
  for each row execute function public.enforce_product_media_variant_membership();

create or replace function public.set_product_media_primary(p_media_id uuid)
returns void language plpgsql security invoker set search_path = '' as $$
declare v_product_id uuid;
begin
  if not public.is_catalog_admin() then raise exception 'admin_required'; end if;
  select product_id into v_product_id from public.product_media where id = p_media_id for update;
  if v_product_id is null then raise exception 'media_not_found'; end if;
  update public.product_media set is_primary = false where product_id = v_product_id and is_primary;
  update public.product_media set is_primary = true where id = p_media_id;
end;
$$;
revoke all on function public.set_product_media_primary(uuid) from public;
grant execute on function public.set_product_media_primary(uuid) to authenticated;

create or replace function public.reorder_product_media(p_product_id uuid, p_media_ids uuid[])
returns void language plpgsql security invoker set search_path = '' as $$
declare v_expected integer; v_supplied integer;
begin
  if not public.is_catalog_admin() then raise exception 'admin_required'; end if;
  select count(*) into v_expected from public.product_media where product_id = p_product_id;
  select count(distinct id) into v_supplied from unnest(p_media_ids) as ids(id);
  if v_expected <> cardinality(p_media_ids) or v_supplied <> v_expected or exists (
    select 1 from unnest(p_media_ids) as ids(id)
    where not exists (select 1 from public.product_media m where m.id = ids.id and m.product_id = p_product_id)
  ) then raise exception 'media_reorder_set_mismatch'; end if;
  update public.product_media m set sort_order = ordered.position - 1
  from unnest(p_media_ids) with ordinality as ordered(id, position)
  where m.id = ordered.id and m.product_id = p_product_id;
end;
$$;
revoke all on function public.reorder_product_media(uuid, uuid[]) from public;
grant execute on function public.reorder_product_media(uuid, uuid[]) to authenticated;

create or replace function public.ensure_primary_media_after_delete()
returns trigger language plpgsql set search_path = '' as $$
begin
  if old.is_primary then
    update public.product_media set is_primary = true
    where id = (
      select id from public.product_media where product_id = old.product_id
      order by sort_order, created_at, id limit 1
    );
  end if;
  return old;
end;
$$;
drop trigger if exists product_media_restore_primary on public.product_media;
create trigger product_media_restore_primary after delete on public.product_media
  for each row execute function public.ensure_primary_media_after_delete();

create or replace function public.validate_product_for_publication(p_product_id uuid)
returns table (is_valid boolean, errors text[])
language plpgsql stable security invoker set search_path = '' as $$
declare v_errors text[] := array[]::text[]; v_product public.products%rowtype;
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
      and (price_minor <= 0 or delivery_scope is null or pta_status = 'unknown'
        or condition = 'unknown'
        or nullif(trim(coalesce(warranty_override, v_product.default_warranty)), '') is null)
  ) then v_errors := array_append(v_errors, 'variant_commercial_facts_unresolved'); end if;
  if not exists (
    select 1 from public.product_media where product_id = p_product_id
      and is_primary and cloudinary_public_id is not null
      and secure_url is not null and width > 0 and height > 0 and bytes > 0
  ) then v_errors := array_append(v_errors, 'primary_product_media_required'); end if;
  return query select cardinality(v_errors) = 0, v_errors;
end;
$$;

comment on table public.product_media is 'Cloudinary references and descriptive metadata only. Image binary and base64 data are forbidden.';
commit;
