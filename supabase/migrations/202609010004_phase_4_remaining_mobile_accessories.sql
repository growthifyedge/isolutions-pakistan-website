begin;

do $$
declare
  v_category_id uuid;
  v_brand_id uuid;
  v_product_id uuid;
  v_variant_id uuid;
  v_existing_product_id uuid;
  v_match_count integer;
  v_inventory bigint;
  v_item jsonb;
  v_brand_slug text;
  v_validation record;
begin
  select count(*), (array_agg(id))[1]
    into v_match_count, v_category_id
  from public.categories
  where slug = 'mobile-accessories'
    and name = 'Mobile Accessories'
    and data_class = 'real'
    and is_active;

  if v_match_count <> 1 then
    raise exception 'expected one active real Mobile Accessories category, found %', v_match_count;
  end if;

  for v_item in
    select value from jsonb_array_elements('[{"title":"Samsung USB-C Cable","slug":"samsung-usb-c-cable","brand":"Samsung","brand_slug":"samsung","sku":"SAMSUNG-USBC-CABLE","price_minor":249900,"color":"White"},{"title":"Xiaomi 10000mAh Power Bank","slug":"xiaomi-10000mah-power-bank","brand":"Xiaomi","brand_slug":"xiaomi","sku":"XIAOMI-10000MAH-POWER-BANK","price_minor":599900,"color":"Black"},{"title":"Clear Mobile Case","slug":"clear-mobile-case","brand":null,"brand_slug":null,"sku":"CLEAR-MOBILE-CASE","price_minor":149900,"color":"Clear"}]'::jsonb)
  loop
    v_brand_id := null;

    if nullif(v_item ->> 'brand', '') is not null then
      select count(*), (array_agg(id))[1]
        into v_match_count, v_brand_id
      from public.brands
      where data_class = 'real'
        and lower(btrim(name)) = lower(btrim(v_item ->> 'brand'));

      if v_match_count > 1 then
        raise exception 'ambiguous real brand for %', v_item ->> 'brand';
      elsif v_match_count = 1 then
        update public.brands set is_active = true where id = v_brand_id;
      else
        v_brand_slug := v_item ->> 'brand_slug';
        if exists (select 1 from public.brands where slug = v_brand_slug) then
          v_brand_slug := v_brand_slug || '-real';
        end if;
        if exists (select 1 from public.brands where slug = v_brand_slug) then
          raise exception 'canonical real brand slug unavailable for %', v_item ->> 'brand';
        end if;
        insert into public.brands (name, slug, data_class, is_active)
        values (v_item ->> 'brand', v_brand_slug, 'real', true)
        returning id into v_brand_id;
      end if;
    end if;

    v_product_id := null;
    insert into public.products (
      brand_id, category_id, title, slug, publication_status,
      default_warranty, default_condition, default_delivery_scope,
      default_pta_status, data_class
    )
    values (
      v_brand_id, v_category_id, v_item ->> 'title', v_item ->> 'slug', 'draft',
      '1 Year', 'brand_new', 'nationwide', 'not_applicable', 'real'
    )
    on conflict (slug) do nothing
    returning id into v_product_id;

    if v_product_id is null then
      select count(*), (array_agg(id))[1]
        into v_match_count, v_product_id
      from public.products
      where slug = v_item ->> 'slug';

      if v_match_count <> 1 then
        raise exception 'expected exactly one product for slug %, found %', v_item ->> 'slug', v_match_count;
      end if;

      update public.products
      set brand_id = v_brand_id,
          category_id = v_category_id,
          title = v_item ->> 'title',
          default_warranty = '1 Year',
          default_condition = 'brand_new',
          default_delivery_scope = 'nationwide',
          default_pta_status = 'not_applicable',
          data_class = 'real'
      where id = v_product_id;
    end if;

    v_existing_product_id := null;
    select product_id into v_existing_product_id
    from public.product_variants
    where sku = v_item ->> 'sku';

    if found and v_existing_product_id <> v_product_id then
      raise exception 'SKU % already belongs to another product', v_item ->> 'sku';
    end if;

    insert into public.product_variants (
      product_id, sku, ram_display, storage_display, color_finish,
      price_minor, compare_at_price_minor, pta_status, condition,
      warranty_override, delivery_scope, is_active, sort_order
    )
    values (
      v_product_id, v_item ->> 'sku', null, null, v_item ->> 'color',
      (v_item ->> 'price_minor')::bigint, null, 'not_applicable', 'brand_new',
      '1 Year', 'nationwide', true, 0
    )
    on conflict (sku) do nothing;

    v_variant_id := null;
    update public.product_variants
    set ram_display = null,
        storage_display = null,
        color_finish = v_item ->> 'color',
        price_minor = (v_item ->> 'price_minor')::bigint,
        compare_at_price_minor = null,
        pta_status = 'not_applicable',
        condition = 'brand_new',
        warranty_override = '1 Year',
        delivery_scope = 'nationwide',
        is_active = true,
        sort_order = 0
    where product_id = v_product_id
      and sku = v_item ->> 'sku'
    returning id into v_variant_id;

    if v_variant_id is null then
      raise exception 'variant resolution failed for SKU %', v_item ->> 'sku';
    end if;

    if not exists (select 1 from public.inventory_movements where variant_id = v_variant_id) then
      insert into public.inventory_movements (variant_id, quantity_delta, reason, reference, note)
      values (v_variant_id, 10, 'initial', 'phase-4-remaining-mobile-accessories', 'Initial inventory for Owner-approved Mobile Accessories catalog seed');
    end if;

    select coalesce(sum(quantity_delta), 0)::bigint into v_inventory
    from public.inventory_movements
    where variant_id = v_variant_id;

    if v_inventory <> 10 then
      raise exception 'expected inventory 10 for SKU %, found %', v_item ->> 'sku', v_inventory;
    end if;

    select * into v_validation
    from public.validate_product_for_publication(v_product_id);

    if not v_validation.is_valid
      and v_validation.errors <> array['primary_product_media_required']::text[] then
      raise exception 'unexpected publication blockers for %: %', v_item ->> 'slug', v_validation.errors;
    end if;
  end loop;
end;
$$;

commit;