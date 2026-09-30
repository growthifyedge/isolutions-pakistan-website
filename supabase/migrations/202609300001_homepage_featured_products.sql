begin;

-- Dedicated homepage Featured Products read path. The homepage must not depend on the
-- newest-N page of search_public_catalog: any published, is_featured product is eligible
-- regardless of age. Only sellable products qualify: a primary Cloudinary image and at
-- least one active variant that is priced above zero and in stock. Out-of-stock featured
-- products never appear. Row shape matches search_public_catalog so the storefront reuses
-- the same CatalogProduct type and card.
create function public.homepage_featured_products(p_limit integer default 4)
returns table (
  id uuid, slug text, title text, short_description text, content text,
  default_warranty text, published_at timestamptz,
  is_flash_sale boolean, is_featured boolean, is_best_seller boolean,
  brand jsonb, category jsonb, variants jsonb, media jsonb, specifications jsonb
)
language sql stable security definer set search_path = '' as $$
  with featured as (
    select p.* from public.products p
    left join public.brands b on b.id = p.brand_id
    join public.categories c on c.id = p.category_id
    where p.data_class = 'real' and p.publication_status = 'published' and p.published_at is not null
      and p.is_featured
      and (p.brand_id is null or (b.data_class = 'real' and b.is_active))
      and c.data_class = 'real' and c.is_active
      and exists (
        select 1 from public.product_media m
        where m.product_id = p.id and m.is_primary
          and m.cloudinary_public_id is not null and m.secure_url is not null
      )
      and exists (
        select 1 from public.product_variants v
        where v.product_id = p.id and v.is_active and v.price_minor > 0
          and (select coalesce(sum(im.quantity_delta), 0) from public.inventory_movements im where im.variant_id = v.id) > 0
      )
    order by p.published_at desc, p.id
    limit least(greatest(coalesce(p_limit, 4), 1), 12)
  ), inventory as (
    select v.id as variant_id, coalesce(sum(m.quantity_delta), 0)::bigint as quantity
    from featured p
    join public.product_variants v on v.product_id = p.id and v.is_active
    left join public.inventory_movements m on m.variant_id = v.id
    group by v.id
  )
  select p.id, p.slug, p.title, p.short_description, p.content, p.default_warranty, p.published_at,
    p.is_flash_sale, p.is_featured, p.is_best_seller,
    case when b.id is null then null else jsonb_build_object('id', b.id, 'name', b.name, 'slug', b.slug) end as brand,
    jsonb_build_object('id', c.id, 'name', c.name, 'slug', c.slug) as category,
    coalesce((select jsonb_agg(jsonb_build_object(
      'id', v.id, 'sku', v.sku, 'ram', v.ram_display, 'storage', v.storage_display,
      'color', v.color_finish, 'priceMinor', v.price_minor,
      'compareAtPriceMinor', case when v.compare_at_price_minor > v.price_minor then v.compare_at_price_minor else null end,
      'ptaStatus', v.pta_status, 'condition', v.condition,
      'warranty', coalesce(v.warranty_override, p.default_warranty), 'carrierJv', v.carrier_jv,
      'deliveryScope', coalesce(v.delivery_scope, p.default_delivery_scope), 'quantity', coalesce(i.quantity, 0)
    ) order by v.sort_order, v.id) from public.product_variants v left join inventory i on i.variant_id = v.id
      where v.product_id = p.id and v.is_active and v.price_minor > 0), '[]'::jsonb) as variants,
    coalesce((select jsonb_agg(jsonb_build_object(
      'id', m.id, 'variantId', m.variant_id,
      'variantIds', coalesce((select jsonb_agg(a.variant_id order by a.variant_id) from public.product_media_variant_assignments a where a.media_id = m.id), '[]'::jsonb),
      'publicId', m.cloudinary_public_id, 'url', m.secure_url, 'alt', m.alt_text,
      'width', m.width, 'height', m.height, 'format', m.format, 'isPrimary', m.is_primary
    ) order by m.is_primary desc, m.sort_order, m.id) from public.product_media m where m.product_id = p.id and m.secure_url is not null), '[]'::jsonb) as media,
    coalesce((select jsonb_agg(jsonb_build_object('group', s.specification_group, 'label', s.label, 'value', s.value)
      order by s.sort_order, s.id) from public.product_specifications s where s.product_id = p.id), '[]'::jsonb) as specifications
  from featured p left join public.brands b on b.id = p.brand_id join public.categories c on c.id = p.category_id
  order by p.published_at desc, p.id;
$$;

revoke all on function public.homepage_featured_products(integer) from public;
grant execute on function public.homepage_featured_products(integer) to anon, authenticated;

commit;
