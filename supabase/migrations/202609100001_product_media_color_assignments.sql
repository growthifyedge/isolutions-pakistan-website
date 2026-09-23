begin;

create table public.product_media_variant_assignments (
  media_id uuid not null references public.product_media(id) on delete cascade,
  variant_id uuid not null references public.product_variants(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (media_id, variant_id)
);

create index product_media_variant_assignments_variant_idx
  on public.product_media_variant_assignments(variant_id, media_id);

alter table public.product_media_variant_assignments enable row level security;

grant select, insert, delete on public.product_media_variant_assignments to authenticated;

create policy admins_read_product_media_variant_assignments
  on public.product_media_variant_assignments for select to authenticated
  using ((select public.is_catalog_admin()));
create policy admins_insert_product_media_variant_assignments
  on public.product_media_variant_assignments for insert to authenticated
  with check ((select public.is_catalog_admin()));
create policy admins_delete_product_media_variant_assignments
  on public.product_media_variant_assignments for delete to authenticated
  using ((select public.is_catalog_admin()));

create function public.set_product_media_color_assignment(p_media_id uuid, p_color text default null)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_product_id uuid;
  v_color text := nullif(btrim(p_color), '');
  v_count integer;
begin
  if not public.is_catalog_admin() then
    raise exception 'catalog_admin_required';
  end if;

  select product_id into v_product_id
  from public.product_media
  where id = p_media_id;
  if v_product_id is null then
    raise exception 'product_media_not_found';
  end if;

  if v_color is not null and not exists (
    select 1 from public.product_variants
    where product_id = v_product_id
      and nullif(btrim(color_finish), '') is not null
      and lower(btrim(color_finish)) = lower(v_color)
  ) then
    raise exception 'product_color_not_found';
  end if;

  delete from public.product_media_variant_assignments where media_id = p_media_id;

  if v_color is null then
    return 0;
  end if;

  insert into public.product_media_variant_assignments(media_id, variant_id)
  select p_media_id, id
  from public.product_variants
  where product_id = v_product_id
    and lower(btrim(color_finish)) = lower(v_color);

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.set_product_media_color_assignment(uuid, text) from public;
grant execute on function public.set_product_media_color_assignment(uuid, text) to authenticated;

drop function if exists public.search_public_catalog(
  text,
  text,
  text[],
  text[],
  bigint,
  bigint,
  text[],
  text[],
  public.pta_status[],
  boolean,
  public.delivery_scope[],
  integer,
  integer
);

create function public.search_public_catalog(
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
    left join public.brands b on b.id = p.brand_id
    join public.categories c on c.id = p.category_id
    where p.data_class = 'real' and p.publication_status = 'published' and p.published_at is not null
      and (p.brand_id is null or (b.data_class = 'real' and b.is_active))
      and c.data_class = 'real' and c.is_active
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
    case when b.id is null then null else jsonb_build_object('id', b.id, 'name', b.name, 'slug', b.slug) end as brand,
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
      'id', m.id, 'variantId', m.variant_id,
      'variantIds', coalesce((select jsonb_agg(a.variant_id order by a.variant_id) from public.product_media_variant_assignments a where a.media_id = m.id), '[]'::jsonb),
      'publicId', m.cloudinary_public_id, 'url', m.secure_url, 'alt', m.alt_text,
      'width', m.width, 'height', m.height, 'format', m.format, 'isPrimary', m.is_primary
    ) order by m.is_primary desc, m.sort_order, m.id) from public.product_media m where m.product_id = p.id and m.secure_url is not null), '[]'::jsonb) as media,
    coalesce((select jsonb_agg(jsonb_build_object('group', s.specification_group, 'label', s.label, 'value', s.value)
      order by s.sort_order, s.id) from public.product_specifications s where s.product_id = p.id), '[]'::jsonb) as specifications
  from eligible p left join public.brands b on b.id = p.brand_id join public.categories c on c.id = p.category_id
  order by p.published_at desc, p.id;
$$;

revoke all on function public.search_public_catalog(text,text,text[],text[],bigint,bigint,text[],text[],public.pta_status[],boolean,public.delivery_scope[],integer,integer) from public;
grant execute on function public.search_public_catalog(text,text,text[],text[],bigint,bigint,text[],text[],public.pta_status[],boolean,public.delivery_scope[],integer,integer) to anon, authenticated;

commit;
