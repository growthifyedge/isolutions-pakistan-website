create table public.product_recommendations (
  id uuid primary key default gen_random_uuid(),
  source_product_id uuid not null references public.products(id) on delete cascade,
  recommended_product_id uuid not null references public.products(id) on delete cascade,
  relation_type text not null default 'frequently_bought_together',
  sort_order integer not null default 0 check (sort_order >= 0),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint product_recommendations_distinct_products check (source_product_id <> recommended_product_id),
  constraint product_recommendations_relation_type check (relation_type = 'frequently_bought_together'),
  unique (source_product_id, recommended_product_id, relation_type)
);

create index product_recommendations_source_idx
  on public.product_recommendations(source_product_id, relation_type, is_active, sort_order, id);

create trigger product_recommendations_set_updated_at
before update on public.product_recommendations
for each row execute function public.set_updated_at();

alter table public.product_recommendations enable row level security;

revoke all on table public.product_recommendations from anon, public;
grant select, insert, update, delete on public.product_recommendations to authenticated;

create policy admins_read_product_recommendations on public.product_recommendations
for select to authenticated using ((select public.is_catalog_admin()));
create policy admins_insert_product_recommendations on public.product_recommendations
for insert to authenticated with check ((select public.is_catalog_admin()));
create policy admins_update_product_recommendations on public.product_recommendations
for update to authenticated using ((select public.is_catalog_admin())) with check ((select public.is_catalog_admin()));
create policy admins_delete_product_recommendations on public.product_recommendations
for delete to authenticated using ((select public.is_catalog_admin()));

create function public.frequently_bought_together(
  p_product_id uuid,
  p_limit integer default 4
)
returns table (
  id uuid,
  slug text,
  title text,
  brand jsonb,
  variants jsonb,
  media jsonb
)
language sql stable security definer set search_path = '' as $$
  with inventory as (
    select v.id as variant_id, coalesce(sum(im.quantity_delta), 0)::bigint as quantity
    from public.product_variants v
    left join public.inventory_movements im on im.variant_id = v.id
    group by v.id
  )
  select
    p.id,
    p.slug,
    p.title,
    case when b.id is null then null else jsonb_build_object(
      'id', b.id, 'name', b.name, 'slug', b.slug
    ) end as brand,
    coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', v.id,
        'sku', v.sku,
        'ram', v.ram_display,
        'storage', v.storage_display,
        'color', v.color_finish,
        'priceMinor', v.price_minor,
        'compareAtPriceMinor', case when v.compare_at_price_minor > v.price_minor then v.compare_at_price_minor else null end,
        'ptaStatus', v.pta_status,
        'condition', v.condition,
        'warranty', coalesce(v.warranty_override, p.default_warranty),
        'carrierJv', v.carrier_jv,
        'deliveryScope', coalesce(v.delivery_scope, p.default_delivery_scope),
        'quantity', coalesce(i.quantity, 0)
      ) order by v.sort_order, v.id)
      from public.product_variants v
      left join inventory i on i.variant_id = v.id
      where v.product_id = p.id and v.is_active
    ), '[]'::jsonb) as variants,
    coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', m.id,
        'variantId', m.variant_id,
        'publicId', m.cloudinary_public_id,
        'url', m.secure_url,
        'alt', m.alt_text,
        'width', m.width,
        'height', m.height,
        'format', m.format,
        'isPrimary', m.is_primary
      ) order by m.is_primary desc, m.sort_order, m.id)
      from public.product_media m
      where m.product_id = p.id and m.secure_url is not null
    ), '[]'::jsonb) as media
  from public.product_recommendations r
  join public.products p on p.id = r.recommended_product_id
  left join public.brands b on b.id = p.brand_id
  join public.categories c on c.id = p.category_id
  where r.source_product_id = p_product_id
    and r.relation_type = 'frequently_bought_together'
    and r.is_active
    and r.recommended_product_id <> p_product_id
    and p.data_class = 'real'
    and p.publication_status = 'published'
    and p.published_at is not null
    and (p.brand_id is null or (b.data_class = 'real' and b.is_active))
    and c.data_class = 'real'
    and c.is_active
    and exists (select 1 from public.product_variants v where v.product_id = p.id and v.is_active)
  order by r.sort_order, r.id
  limit least(greatest(coalesce(p_limit, 4), 1), 4);
$$;

revoke all on function public.frequently_bought_together(uuid, integer) from public;
grant execute on function public.frequently_bought_together(uuid, integer) to anon, authenticated;

comment on table public.product_recommendations is
  'Admin-curated product relationships. Public access is available only through restricted storefront RPCs.';
comment on function public.frequently_bought_together(uuid, integer) is
  'Returns at most four active, public-safe frequently bought together recommendations for a PDP.';
