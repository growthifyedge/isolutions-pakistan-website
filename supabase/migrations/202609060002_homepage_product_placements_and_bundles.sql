alter table public.products
  add column if not exists is_featured boolean not null default false,
  add column if not exists is_best_seller boolean not null default false;

comment on column public.products.is_featured is 'Admin-controlled homepage Featured Products placement.';
comment on column public.products.is_best_seller is 'Admin-controlled homepage Best Seller placement.';

drop function if exists public.search_public_catalog(
  text, text, text[], text[], bigint, bigint, text[], text[],
  public.pta_status[], boolean, public.delivery_scope[], integer, integer
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
  default_warranty text, published_at timestamptz, is_flash_sale boolean,
  is_featured boolean, is_best_seller boolean,
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
  select p.id, p.slug, p.title, p.short_description, p.content, p.default_warranty,
    p.published_at, p.is_flash_sale, p.is_featured, p.is_best_seller,
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
      'id', m.id, 'variantId', m.variant_id, 'publicId', m.cloudinary_public_id, 'url', m.secure_url, 'alt', m.alt_text,
      'width', m.width, 'height', m.height, 'format', m.format, 'isPrimary', m.is_primary
    ) order by m.is_primary desc, m.sort_order, m.id) from public.product_media m where m.product_id = p.id and m.secure_url is not null), '[]'::jsonb) as media,
    coalesce((select jsonb_agg(jsonb_build_object('group', s.specification_group, 'label', s.label, 'value', s.value)
      order by s.sort_order, s.id) from public.product_specifications s where s.product_id = p.id), '[]'::jsonb) as specifications
  from eligible p left join public.brands b on b.id = p.brand_id join public.categories c on c.id = p.category_id
  order by p.published_at desc, p.id;
$$;

revoke all on function public.search_public_catalog(
  text, text, text[], text[], bigint, bigint, text[], text[],
  public.pta_status[], boolean, public.delivery_scope[], integer, integer
) from public;

grant execute on function public.search_public_catalog(
  text, text, text[], text[], bigint, bigint, text[], text[],
  public.pta_status[], boolean, public.delivery_scope[], integer, integer
) to anon, authenticated;

create table public.bundles (
  id uuid primary key default gen_random_uuid(),
  title text not null check (nullif(btrim(title), '') is not null),
  slug text not null unique check (slug = lower(slug) and slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  description text,
  bundle_price_minor bigint not null check (bundle_price_minor > 0),
  is_active boolean not null default false,
  is_featured boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.bundle_items (
  id uuid primary key default gen_random_uuid(),
  bundle_id uuid not null references public.bundles(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete restrict,
  variant_id uuid references public.product_variants(id) on delete restrict,
  quantity integer not null default 1 check (quantity > 0),
  sort_order integer not null default 0 check (sort_order >= 0),
  created_at timestamptz not null default now(),
  unique (bundle_id, product_id)
);

create index bundles_homepage_idx on public.bundles(is_active, is_featured, updated_at desc);
create index bundle_items_bundle_sort_idx on public.bundle_items(bundle_id, sort_order, id);
create trigger bundles_set_updated_at before update on public.bundles
for each row execute function public.set_updated_at();

alter table public.bundles enable row level security;
alter table public.bundle_items enable row level security;

create policy admins_read_all_bundles on public.bundles
for select to authenticated using ((select public.is_catalog_admin()));
create policy admins_insert_bundles on public.bundles
for insert to authenticated with check ((select public.is_catalog_admin()));
create policy admins_update_bundles on public.bundles
for update to authenticated using ((select public.is_catalog_admin())) with check ((select public.is_catalog_admin()));
create policy admins_delete_bundles on public.bundles
for delete to authenticated using ((select public.is_catalog_admin()));

create policy admins_read_all_bundle_items on public.bundle_items
for select to authenticated using ((select public.is_catalog_admin()));
create policy admins_insert_bundle_items on public.bundle_items
for insert to authenticated with check (
  (select public.is_catalog_admin()) and (variant_id is null or exists (
    select 1 from public.product_variants v where v.id = variant_id and v.product_id = product_id))
);
create policy admins_update_bundle_items on public.bundle_items
for update to authenticated using ((select public.is_catalog_admin())) with check (
  (select public.is_catalog_admin()) and (variant_id is null or exists (
    select 1 from public.product_variants v where v.id = variant_id and v.product_id = product_id))
);
create policy admins_delete_bundle_items on public.bundle_items
for delete to authenticated using ((select public.is_catalog_admin()));

create function public.homepage_bundles(p_limit integer default 4)
returns table (id uuid, title text, slug text, description text, bundle_price_minor bigint, items jsonb)
language sql stable security definer set search_path = '' as $$
  select b.id, b.title, b.slug, b.description, b.bundle_price_minor,
    jsonb_agg(jsonb_build_object(
      'id', bi.id, 'quantity', bi.quantity,
      'product', jsonb_build_object(
        'id', p.id, 'title', p.title, 'slug', p.slug,
        'media', case when m.id is null then null else jsonb_build_object(
          'id', m.id, 'publicId', m.cloudinary_public_id, 'url', m.secure_url,
          'alt', m.alt_text, 'width', m.width, 'height', m.height, 'format', m.format
        ) end
      )
    ) order by bi.sort_order, bi.id) as items
  from public.bundles b
  join public.bundle_items bi on bi.bundle_id = b.id
  join public.products p on p.id = bi.product_id
    and p.data_class = 'real' and p.publication_status = 'published' and p.published_at is not null
  join public.categories c on c.id = p.category_id and c.data_class = 'real' and c.is_active
  left join public.brands br on br.id = p.brand_id
  left join lateral (
    select pm.* from public.product_media pm where pm.product_id = p.id and pm.secure_url is not null
    order by pm.is_primary desc, pm.sort_order, pm.id limit 1
  ) m on true
  where b.is_active and b.is_featured and (p.brand_id is null or (br.data_class = 'real' and br.is_active))
  group by b.id
  having count(*) >= 2
  order by b.updated_at desc, b.id
  limit least(greatest(coalesce(p_limit, 4), 1), 12);
$$;

revoke all on function public.homepage_bundles(integer) from public;
grant execute on function public.homepage_bundles(integer) to anon, authenticated;
