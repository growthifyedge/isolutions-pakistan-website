begin;

create or replace function public.public_catalog_taxonomy()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'brands', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', b.id,
        'name', b.name,
        'slug', b.slug
      ) order by b.name, b.id)
      from public.brands b
      where b.data_class = 'real' and b.is_active
        and exists (
          select 1
          from public.products p
          where p.brand_id = b.id
            and p.data_class = 'real'
            and p.publication_status = 'published'
            and p.published_at is not null
        )
    ), '[]'::jsonb),
    'categories', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', c.id,
        'name', c.name,
        'slug', c.slug
      ) order by c.sort_order, c.name, c.id)
      from public.categories c
      where c.data_class = 'real' and c.is_active
        and exists (
          select 1
          from public.products p
          where p.category_id = c.id
            and p.data_class = 'real'
            and p.publication_status = 'published'
            and p.published_at is not null
        )
    ), '[]'::jsonb)
  );
$$;

revoke all on function public.public_catalog_taxonomy() from public;
grant execute on function public.public_catalog_taxonomy() to anon, authenticated;

comment on function public.public_catalog_taxonomy() is
  'Storefront-only real published taxonomy projection. Stable across anonymous and authenticated Admin sessions.';

commit;
