begin;

create type public.catalog_data_class as enum ('development', 'real');

alter table public.brands add column data_class public.catalog_data_class not null default 'development';
alter table public.categories add column data_class public.catalog_data_class not null default 'development';
alter table public.products add column data_class public.catalog_data_class not null default 'development';

comment on column public.products.data_class is 'Only Owner-approved real records may use real; development is never public.';
create index brands_public_catalog_idx on public.brands(data_class, is_active, name);
create index categories_public_catalog_idx on public.categories(data_class, is_active, sort_order, name);
create index products_real_publication_idx on public.products(data_class, publication_status, published_at desc);

drop policy if exists public_read_active_brands on public.brands;
create policy public_read_active_real_brands on public.brands for select to anon, authenticated
using (is_active and data_class = 'real');
drop policy if exists public_read_active_categories on public.categories;
create policy public_read_active_real_categories on public.categories for select to anon, authenticated
using (is_active and data_class = 'real');
drop policy if exists public_read_published_products on public.products;
create policy public_read_published_real_products on public.products for select to anon, authenticated
using (data_class = 'real' and publication_status = 'published' and published_at is not null);

drop policy if exists public_read_active_published_variants on public.product_variants;
create policy public_read_active_published_real_variants on public.product_variants for select to anon, authenticated
using (is_active and exists (
  select 1 from public.products p where p.id = product_id
    and p.data_class = 'real' and p.publication_status = 'published' and p.published_at is not null
));

drop policy if exists public_read_published_specifications on public.product_specifications;
create policy public_read_published_real_specifications on public.product_specifications for select to anon, authenticated
using (exists (
  select 1 from public.products p where p.id = product_id
    and p.data_class = 'real' and p.publication_status = 'published' and p.published_at is not null
));

drop policy if exists public_read_published_media on public.product_media;
create policy public_read_published_real_media on public.product_media for select to anon, authenticated
using (exists (
  select 1 from public.products p where p.id = product_id
    and p.data_class = 'real' and p.publication_status = 'published' and p.published_at is not null
));

create or replace function public.validate_product_for_publication(p_product_id uuid)
returns table (is_valid boolean, errors text[])
language plpgsql stable security invoker set search_path = '' as $$
declare v_errors text[] := array[]::text[]; v_product public.products%rowtype;
begin
  select * into v_product from public.products where id = p_product_id;
  if not found then return query select false, array['product_not_found']; return; end if;
  if v_product.data_class <> 'real' then v_errors := array_append(v_errors, 'real_catalog_classification_required'); end if;
  if nullif(trim(v_product.title), '') is null then v_errors := array_append(v_errors, 'title_required'); end if;
  if not exists (select 1 from public.brands where id = v_product.brand_id and is_active and data_class = 'real') then v_errors := array_append(v_errors, 'active_real_brand_required'); end if;
  if not exists (select 1 from public.categories where id = v_product.category_id and is_active and data_class = 'real') then v_errors := array_append(v_errors, 'active_real_category_required'); end if;
  if not exists (select 1 from public.product_variants where product_id = p_product_id and is_active) then v_errors := array_append(v_errors, 'active_variant_required'); end if;
  if exists (select 1 from public.product_variants where product_id = p_product_id and is_active and (price_minor <= 0 or delivery_scope is null or pta_status = 'unknown' or condition = 'unknown' or nullif(trim(coalesce(warranty_override, v_product.default_warranty)), '') is null)) then v_errors := array_append(v_errors, 'variant_commercial_facts_unresolved'); end if;
  if not exists (select 1 from public.product_media where product_id = p_product_id and is_primary and cloudinary_public_id is not null and secure_url is not null and width > 0 and height > 0 and bytes > 0) then v_errors := array_append(v_errors, 'primary_product_media_required'); end if;
  return query select cardinality(v_errors) = 0, v_errors;
end;
$$;

create or replace function public.search_public_catalog(
  p_search text default null, p_slug text default null,
  p_category_slugs text[] default null, p_brand_slugs text[] default null,
  p_price_min bigint default null, p_price_max bigint default null,
  p_storage text[] default null, p_ram text[] default null,
  p_pta_status public.pta_status[] default null, p_in_stock boolean default null,
  p_delivery_scope public.delivery_scope[] default null,
  p_limit integer default 48, p_offset integer default 0
)
returns table (
  id uuid, slug text, title text, short_description text, content text,
  default_warranty text, published_at timestamptz,
  brand jsonb, category jsonb, variants jsonb, media jsonb, specifications jsonb
)
language sql stable security definer set search_path = '' as $$
  with inventory as (
    select v.id as variant_id, coalesce(sum(m.quantity_delta), 0)::bigint as quantity
    from public.product_variants v left join public.inventory_movements m on m.variant_id = v.id
    group by v.id
  ), eligible as (
    select p.* from public.products p
    join public.brands b on b.id = p.brand_id join public.categories c on c.id = p.category_id
    where p.data_class = 'real' and p.publication_status = 'published' and p.published_at is not null
      and b.data_class = 'real' and b.is_active and c.data_class = 'real' and c.is_active
      and (p_slug is null or p.slug = p_slug)
      and (p_search is null or btrim(p_search) = '' or p.title ilike '%' || btrim(p_search) || '%' or b.name ilike '%' || btrim(p_search) || '%' or c.name ilike '%' || btrim(p_search) || '%')
      and (p_category_slugs is null or c.slug = any(p_category_slugs))
      and (p_brand_slugs is null or b.slug = any(p_brand_slugs))
      and exists (
        select 1 from public.product_variants v left join inventory i on i.variant_id = v.id
        where v.product_id = p.id and v.is_active
          and (p_price_min is null or v.price_minor >= p_price_min)
          and (p_price_max is null or v.price_minor <= p_price_max)
          and (p_storage is null or v.storage_display = any(p_storage))
          and (p_ram is null or v.ram_display = any(p_ram))
          and (p_pta_status is null or v.pta_status = any(p_pta_status))
          and (p_delivery_scope is null or coalesce(v.delivery_scope, p.default_delivery_scope) = any(p_delivery_scope))
          and (p_in_stock is null or not p_in_stock or coalesce(i.quantity, 0) > 0)
      )
    order by p.published_at desc, p.id
    limit least(greatest(coalesce(p_limit, 48), 1), 100) offset greatest(coalesce(p_offset, 0), 0)
  )
  select p.id, p.slug, p.title, p.short_description, p.content, p.default_warranty, p.published_at,
    jsonb_build_object('id', b.id, 'name', b.name, 'slug', b.slug) as brand,
    jsonb_build_object('id', c.id, 'name', c.name, 'slug', c.slug) as category,
    coalesce((select jsonb_agg(jsonb_build_object(
      'id', v.id, 'sku', v.sku, 'ram', v.ram_display, 'storage', v.storage_display,
      'color', v.color_finish, 'priceMinor', v.price_minor,
      'compareAtPriceMinor', case when v.compare_at_price_minor > v.price_minor then v.compare_at_price_minor else null end,
      'ptaStatus', v.pta_status, 'condition', v.condition,
      'warranty', coalesce(v.warranty_override, p.default_warranty), 'carrierJv', v.carrier_jv,
      'deliveryScope', coalesce(v.delivery_scope, p.default_delivery_scope), 'quantity', coalesce(i.quantity, 0)
    ) order by v.sort_order, v.id) from public.product_variants v left join inventory i on i.variant_id = v.id where v.product_id = p.id and v.is_active), '[]'::jsonb) as variants,
    coalesce((select jsonb_agg(jsonb_build_object(
      'id', m.id, 'variantId', m.variant_id, 'publicId', m.cloudinary_public_id, 'url', m.secure_url, 'alt', m.alt_text,
      'width', m.width, 'height', m.height, 'format', m.format, 'isPrimary', m.is_primary
    ) order by m.is_primary desc, m.sort_order, m.id) from public.product_media m where m.product_id = p.id and m.secure_url is not null), '[]'::jsonb) as media,
    coalesce((select jsonb_agg(jsonb_build_object('group', s.specification_group, 'label', s.label, 'value', s.value)
      order by s.sort_order, s.id) from public.product_specifications s where s.product_id = p.id), '[]'::jsonb) as specifications
  from eligible p join public.brands b on b.id = p.brand_id join public.categories c on c.id = p.category_id
  order by p.published_at desc, p.id;
$$;

revoke all on function public.search_public_catalog(text,text,text[],text[],bigint,bigint,text[],text[],public.pta_status[],boolean,public.delivery_scope[],integer,integer) from public;
grant execute on function public.search_public_catalog(text,text,text[],text[],bigint,bigint,text[],text[],public.pta_status[],boolean,public.delivery_scope[],integer,integer) to anon, authenticated;

commit;
