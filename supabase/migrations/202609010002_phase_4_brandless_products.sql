begin;

alter table public.products alter column brand_id drop not null;

create or replace function public.validate_product_for_publication(p_product_id uuid)
returns table (is_valid boolean, errors text[])
language plpgsql stable security invoker set search_path = '' as $$
declare v_errors text[] := array[]::text[]; v_product public.products%rowtype;
begin
  select * into v_product from public.products where id = p_product_id;
  if not found then return query select false, array['product_not_found']; return; end if;
  if v_product.data_class <> 'real' then v_errors := array_append(v_errors, 'real_catalog_classification_required'); end if;
  if nullif(trim(v_product.title), '') is null then v_errors := array_append(v_errors, 'title_required'); end if;
  if v_product.brand_id is not null and not exists (select 1 from public.brands where id = v_product.brand_id and is_active and data_class = 'real') then v_errors := array_append(v_errors, 'active_real_brand_required'); end if;
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
      'id', m.id, 'variantId', m.variant_id, 'publicId', m.cloudinary_public_id, 'url', m.secure_url, 'alt', m.alt_text,
      'width', m.width, 'height', m.height, 'format', m.format, 'isPrimary', m.is_primary
    ) order by m.is_primary desc, m.sort_order, m.id) from public.product_media m where m.product_id = p.id and m.secure_url is not null), '[]'::jsonb) as media,
    coalesce((select jsonb_agg(jsonb_build_object('group', s.specification_group, 'label', s.label, 'value', s.value)
      order by s.sort_order, s.id) from public.product_specifications s where s.product_id = p.id), '[]'::jsonb) as specifications
  from eligible p left join public.brands b on b.id = p.brand_id join public.categories c on c.id = p.category_id
  order by p.published_at desc, p.id;
$$;

revoke all on function public.search_public_catalog(text,text,text[],text[],bigint,bigint,text[],text[],public.pta_status[],boolean,public.delivery_scope[],integer,integer) from public;
grant execute on function public.search_public_catalog(text,text,text[],text[],bigint,bigint,text[],text[],public.pta_status[],boolean,public.delivery_scope[],integer,integer) to anon, authenticated;

create or replace function public.apply_catalog_bulk_import(p_batch jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_product jsonb;
  v_variant jsonb;
  v_specification jsonb;
  v_brand_id uuid;
  v_category_id uuid;
  v_product_id uuid;
  v_variant_id uuid;
  v_match_count integer;
  v_delta integer;
  v_current_inventory integer;
  v_is_new_product boolean;
  v_is_new_variant boolean;
  v_validation record;
  v_summary jsonb := jsonb_build_object(
    'created_products', 0, 'updated_products', 0,
    'created_variants', 0, 'updated_variants', 0,
    'created_brands', 0, 'created_categories', 0,
    'inventory_updates', 0, 'upserted_specifications', 0, 'skipped_unchanged', 0,
    'unresolved_rows', 0, 'failed_rows', 0
  );
begin
  if not public.is_catalog_admin() then
    raise exception 'catalog_admin_required';
  end if;
  if jsonb_typeof(p_batch) <> 'object' or jsonb_typeof(p_batch -> 'products') <> 'array' then
    raise exception 'invalid_bulk_import_payload';
  end if;

  for v_product in select value from jsonb_array_elements(p_batch -> 'products') loop
    if nullif(btrim(v_product ->> 'title'), '') is null then raise exception 'product_title_required'; end if;

    v_brand_id := nullif(v_product ->> 'brand_id', '')::uuid;
    if v_brand_id is not null then
      select count(*) into v_match_count from public.brands
      where id = v_brand_id
        and data_class = 'real'
        and is_active
        and (
          nullif(btrim(v_product ->> 'brand'), '') is null
          or lower(btrim(name)) = lower(btrim(v_product ->> 'brand'))
        );
      if v_match_count <> 1 then raise exception 'real_brand_identity_mismatch: %', v_product ->> 'brand'; end if;
    elsif nullif(btrim(v_product ->> 'brand'), '') is not null then
      select count(*), (array_agg(id))[1] into v_match_count, v_brand_id
      from public.brands where data_class = 'real' and is_active and lower(btrim(name)) = lower(btrim(v_product ->> 'brand'));
      if v_match_count > 1 then raise exception 'ambiguous_real_brand: %', v_product ->> 'brand'; end if;
      if v_match_count = 0 then
        insert into public.brands(name, slug, data_class, is_active)
        values (
          btrim(v_product ->> 'brand'),
          case when exists (select 1 from public.brands where slug = lower(regexp_replace(btrim(v_product ->> 'brand'), '[^a-zA-Z0-9]+', '-', 'g'))) then lower(regexp_replace(btrim(v_product ->> 'brand'), '[^a-zA-Z0-9]+', '-', 'g')) || '-real' else lower(regexp_replace(btrim(v_product ->> 'brand'), '[^a-zA-Z0-9]+', '-', 'g')) end,
          'real', true
        ) returning id into v_brand_id;
        v_summary := jsonb_set(v_summary, '{created_brands}', to_jsonb((v_summary ->> 'created_brands')::integer + 1));
      end if;
    else
      v_brand_id := null;
    end if;

    v_product_id := nullif(v_product ->> 'id', '')::uuid;
    v_is_new_product := v_product_id is null;
    if v_product_id is not null then
      select count(*) into v_match_count from public.products
      where id = v_product_id and data_class = 'real' and brand_id is not distinct from v_brand_id;
      if v_match_count <> 1 then raise exception 'product_identity_mismatch: %', v_product ->> 'title'; end if;
    else
      select count(*), (array_agg(id))[1] into v_match_count, v_product_id from public.products
      where data_class = 'real' and (
        slug = v_product ->> 'slug' or
        (brand_id is not distinct from v_brand_id and lower(btrim(title)) = lower(btrim(v_product ->> 'title')))
      );
      if v_match_count > 1 then raise exception 'ambiguous_product_match: %', v_product ->> 'title'; end if;
      v_is_new_product := v_match_count = 0;
    end if;

    v_category_id := nullif(v_product ->> 'category_id', '')::uuid;
    if v_category_id is null and not v_is_new_product and nullif(btrim(v_product ->> 'category'), '') is null then
      select category_id into v_category_id from public.products where id = v_product_id;
    elsif v_category_id is null then
      if nullif(btrim(v_product ->> 'category'), '') is null then raise exception 'category_required_for_new_product: %', v_product ->> 'title'; end if;
      select count(*), (array_agg(id))[1] into v_match_count, v_category_id from public.categories
      where data_class = 'real' and is_active and lower(btrim(name)) = lower(btrim(v_product ->> 'category'));
      if v_match_count > 1 then raise exception 'ambiguous_real_category: %', v_product ->> 'category'; end if;
      if v_match_count = 0 then
        insert into public.categories(name, slug, data_class, is_active)
        values (
          btrim(v_product ->> 'category'),
          case when exists (select 1 from public.categories where slug = lower(regexp_replace(btrim(v_product ->> 'category'), '[^a-zA-Z0-9]+', '-', 'g'))) then lower(regexp_replace(btrim(v_product ->> 'category'), '[^a-zA-Z0-9]+', '-', 'g')) || '-real' else lower(regexp_replace(btrim(v_product ->> 'category'), '[^a-zA-Z0-9]+', '-', 'g')) end,
          'real', true
        ) returning id into v_category_id;
        v_summary := jsonb_set(v_summary, '{created_categories}', to_jsonb((v_summary ->> 'created_categories')::integer + 1));
      end if;
    else
      select count(*) into v_match_count from public.categories where id = v_category_id and data_class = 'real' and is_active;
      if v_match_count <> 1 then raise exception 'real_category_identity_mismatch: %', coalesce(v_product ->> 'category', 'unspecified'); end if;
    end if;

    if v_is_new_product then
      insert into public.products(
        brand_id, category_id, title, slug, short_description, content, publication_status,
        seo_title, seo_description, default_warranty, default_condition, default_delivery_scope, default_pta_status, data_class, created_by, updated_by
      ) values (
        v_brand_id, v_category_id, btrim(v_product ->> 'title'), v_product ->> 'slug',
        nullif(v_product ->> 'short_description', ''), nullif(v_product ->> 'content', ''), 'draft',
        coalesce(nullif(v_product ->> 'seo_title', ''), btrim(v_product ->> 'title')),
        coalesce(nullif(v_product ->> 'seo_description', ''), nullif(v_product ->> 'short_description', '')),
        nullif(v_product ->> 'default_warranty', ''),
        coalesce(nullif(v_product ->> 'default_condition', ''), 'unknown')::public.product_condition,
        nullif(v_product ->> 'default_delivery_scope', '')::public.delivery_scope,
        coalesce(nullif(v_product ->> 'default_pta_status', ''), 'unknown')::public.pta_status,
        'real', auth.uid(), auth.uid()
      ) returning id into v_product_id;
      v_summary := jsonb_set(v_summary, '{created_products}', to_jsonb((v_summary ->> 'created_products')::integer + 1));
    else
      update public.products set
        title = btrim(v_product ->> 'title'), brand_id = v_brand_id, category_id = v_category_id,
        short_description = coalesce(nullif(v_product ->> 'short_description', ''), short_description),
        content = coalesce(nullif(v_product ->> 'content', ''), content),
        seo_title = coalesce(nullif(v_product ->> 'seo_title', ''), seo_title),
        seo_description = coalesce(nullif(v_product ->> 'seo_description', ''), seo_description),
        default_warranty = case when v_product ->> 'default_warranty_source' = 'batch default' and nullif(trim(default_warranty), '') is not null then default_warranty else coalesce(nullif(v_product ->> 'default_warranty', ''), default_warranty) end,
        default_condition = case when v_product ->> 'default_condition_source' = 'batch default' and default_condition <> 'unknown' then default_condition else coalesce(nullif(v_product ->> 'default_condition', ''), default_condition::text)::public.product_condition end,
        default_delivery_scope = case when v_product ->> 'default_delivery_source' = 'batch default' and default_delivery_scope is not null then default_delivery_scope else coalesce(nullif(v_product ->> 'default_delivery_scope', '')::public.delivery_scope, default_delivery_scope) end,
        default_pta_status = case when v_product ->> 'default_pta_source' = 'batch default' and default_pta_status <> 'unknown' then default_pta_status else coalesce(nullif(v_product ->> 'default_pta_status', '')::public.pta_status, default_pta_status) end,
        updated_by = auth.uid()
      where id = v_product_id;
      v_summary := jsonb_set(v_summary, '{updated_products}', to_jsonb((v_summary ->> 'updated_products')::integer + 1));
    end if;

    if jsonb_typeof(v_product -> 'variants') <> 'array' then raise exception 'variants_array_required: %', v_product ->> 'title'; end if;
    for v_variant in select value from jsonb_array_elements(v_product -> 'variants') loop
      if v_variant ->> 'action' = 'UNCHANGED' then
        v_summary := jsonb_set(v_summary, '{skipped_unchanged}', to_jsonb((v_summary ->> 'skipped_unchanged')::integer + 1));
        continue;
      end if;
      v_variant_id := nullif(v_variant ->> 'id', '')::uuid;
      v_is_new_variant := v_variant_id is null;
      if v_variant_id is not null then
        select count(*) into v_match_count from public.product_variants where id = v_variant_id and product_id = v_product_id;
        if v_match_count <> 1 then raise exception 'variant_identity_mismatch: %', v_variant ->> 'sku'; end if;
      else
        select count(*), (array_agg(id))[1] into v_match_count, v_variant_id from public.product_variants
        where product_id = v_product_id and (
          sku = v_variant ->> 'sku' or (
            ram_display is not distinct from nullif(v_variant ->> 'ram_display', '') and
            storage_display is not distinct from nullif(v_variant ->> 'storage_display', '') and
            color_finish is not distinct from nullif(v_variant ->> 'color_finish', '') and
            (coalesce(v_variant ->> 'pta_status', 'unknown') = 'unknown' or
              pta_status = (v_variant ->> 'pta_status')::public.pta_status) and
            (coalesce(v_variant ->> 'condition', 'unknown') = 'unknown' or
              condition = (v_variant ->> 'condition')::public.product_condition) and
            carrier_jv is null
          )
        );
        if v_match_count > 1 then raise exception 'ambiguous_variant_match: %', v_variant ->> 'sku'; end if;
        v_is_new_variant := v_match_count = 0;
      end if;

      if v_is_new_variant then
        if (v_variant ->> 'price_minor') is null then raise exception 'price_required_for_new_variant: %', v_variant ->> 'sku'; end if;
        insert into public.product_variants(
          product_id, sku, ram_display, storage_display, color_finish, price_minor,
          compare_at_price_minor, pta_status, condition, warranty_override, delivery_scope
        ) values (
          v_product_id, v_variant ->> 'sku', nullif(v_variant ->> 'ram_display', ''),
          nullif(v_variant ->> 'storage_display', ''), nullif(v_variant ->> 'color_finish', ''),
          (v_variant ->> 'price_minor')::bigint, nullif(v_variant ->> 'compare_at_price_minor', '')::bigint,
          coalesce(nullif(v_variant ->> 'pta_status', ''), 'unknown')::public.pta_status,
          coalesce(nullif(v_variant ->> 'condition', ''), 'unknown')::public.product_condition,
          nullif(v_variant ->> 'warranty_override', ''), nullif(v_variant ->> 'delivery_scope', '')::public.delivery_scope
        ) returning id into v_variant_id;
        v_summary := jsonb_set(v_summary, '{created_variants}', to_jsonb((v_summary ->> 'created_variants')::integer + 1));
      else
        update public.product_variants set
          price_minor = coalesce(nullif(v_variant ->> 'price_minor', '')::bigint, price_minor),
          compare_at_price_minor = coalesce(nullif(v_variant ->> 'compare_at_price_minor', '')::bigint, compare_at_price_minor),
          pta_status = case when coalesce(v_variant ->> 'pta_status', 'unknown') = 'unknown' then pta_status else (v_variant ->> 'pta_status')::public.pta_status end,
          condition = case when coalesce(v_variant ->> 'condition', 'unknown') = 'unknown' then condition else (v_variant ->> 'condition')::public.product_condition end,
          warranty_override = coalesce(nullif(v_variant ->> 'warranty_override', ''), warranty_override),
          delivery_scope = coalesce(nullif(v_variant ->> 'delivery_scope', '')::public.delivery_scope, delivery_scope)
        where id = v_variant_id;
        v_summary := jsonb_set(v_summary, '{updated_variants}', to_jsonb((v_summary ->> 'updated_variants')::integer + 1));
      end if;

      if v_is_new_variant or (v_variant ->> 'inventory') is not null then
        v_current_inventory := public.current_inventory(v_variant_id);
        v_delta := case
          when (v_variant ->> 'inventory') is not null
            then (v_variant ->> 'inventory')::integer - v_current_inventory
          else 10 - v_current_inventory
        end;
        if v_delta <> 0 then
          insert into public.inventory_movements(variant_id, quantity_delta, reason, reference, note, actor_id)
          values (
            v_variant_id, v_delta, 'correction',
            case when (v_variant ->> 'inventory') is null then 'phase4_bulk_default_inventory' else 'phase4_bulk_import' end,
            case when (v_variant ->> 'inventory') is null then 'Owner-approved default inventory for a new bulk-created variant' else 'Owner-supplied bulk catalog inventory' end,
            auth.uid()
          );
          v_summary := jsonb_set(v_summary, '{inventory_updates}', to_jsonb((v_summary ->> 'inventory_updates')::integer + 1));
        end if;
      end if;
    end loop;

    if jsonb_typeof(v_product -> 'specifications') = 'array' then
      for v_specification in select value from jsonb_array_elements(v_product -> 'specifications') loop
        if nullif(btrim(v_specification ->> 'label'), '') is null or nullif(btrim(v_specification ->> 'value'), '') is null then
          raise exception 'invalid_product_specification: %', v_product ->> 'title';
        end if;
        insert into public.product_specifications(product_id, specification_group, label, value, sort_order)
        values (
          v_product_id, nullif(btrim(v_specification ->> 'group'), ''),
          btrim(v_specification ->> 'label'), btrim(v_specification ->> 'value'),
          coalesce(nullif(v_specification ->> 'sort_order', '')::integer, 0)
        )
        on conflict (product_id, specification_group, label)
        do update set value = excluded.value, sort_order = excluded.sort_order;
        v_summary := jsonb_set(v_summary, '{upserted_specifications}', to_jsonb((v_summary ->> 'upserted_specifications')::integer + 1));
      end loop;
    end if;
    if not v_is_new_product and (select publication_status = 'published' from public.products where id = v_product_id) then
      select * into v_validation from public.validate_product_for_publication(v_product_id);
      if not v_validation.is_valid then
        update public.products set publication_status = 'draft', published_at = null, updated_by = auth.uid() where id = v_product_id;
      end if;
    end if;
  end loop;
  return v_summary;
end;
$$;

revoke all on function public.apply_catalog_bulk_import(jsonb) from public;
grant execute on function public.apply_catalog_bulk_import(jsonb) to authenticated;
comment on function public.apply_catalog_bulk_import(jsonb) is 'Atomic Owner/Admin-only Phase 4 catalog import. Payloads are re-matched server-side; new products remain drafts.';

commit;
