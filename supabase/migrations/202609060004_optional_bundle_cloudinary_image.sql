begin;

alter table public.bundles
  add column bundle_image_url text,
  add column bundle_image_public_id text;

alter table public.bundles
  add constraint bundles_image_reference_complete check (
    (bundle_image_url is null and bundle_image_public_id is null)
    or (bundle_image_url is not null and bundle_image_public_id is not null)
  );

create unique index bundles_image_public_id_unique
  on public.bundles(bundle_image_public_id)
  where bundle_image_public_id is not null;

drop function if exists public.homepage_bundles(integer);

create function public.homepage_bundles(p_limit integer default 4)
returns table (
  id uuid, title text, slug text, description text, bundle_price_minor bigint,
  bundle_image_url text, bundle_image_public_id text, items jsonb
)
language sql stable security definer set search_path = '' as $$
  select b.id, b.title, b.slug, b.description, b.bundle_price_minor,
    b.bundle_image_url, b.bundle_image_public_id,
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

commit;
