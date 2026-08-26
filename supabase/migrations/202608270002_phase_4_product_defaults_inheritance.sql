begin;

alter table public.products
  add column if not exists default_pta_status public.pta_status not null default 'unknown';

comment on column public.products.default_pta_status is
  'Owner-supplied inheritance convenience only. Explicit product_variants.pta_status remains authoritative.';

alter table public.product_variants
  drop constraint if exists variants_explicit_combination_unique;
alter table public.product_variants
  add constraint variants_explicit_combination_unique
  unique nulls not distinct
  (product_id, ram_display, storage_display, color_finish, pta_status, condition, carrier_jv);


do $$
declare
  v_count integer;
begin
  select count(*) into v_count
  from public.products
  where slug = 'apple-17-pro-max'
    and data_class = 'real';

  if v_count <> 1 then
    raise exception 'Apple 17 Pro Max delivery repair aborted: expected one exact real product, found %', v_count;
  end if;

  update public.products
  set default_delivery_scope = 'karachi_only'
  where slug = 'apple-17-pro-max'
    and data_class = 'real';
end;
$$;
create or replace function public.apply_catalog_bulk_import(p_batch jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_product jsonb;
  v_variant jsonb;
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
    'inventory_updates', 0, 'skipped_unchanged', 0,
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
    if nullif(btrim(v_product ->> 'brand'), '') is null then raise exception 'product_brand_required: %', v_product ->> 'title'; end if;

    v_brand_id := nullif(v_product ->> 'brand_id', '')::uuid;
    if v_brand_id is not null then
      select count(*) into v_match_count from public.brands
      where id = v_brand_id and data_class = 'real' and lower(btrim(name)) = lower(btrim(v_product ->> 'brand'));
      if v_match_count <> 1 then raise exception 'real_brand_identity_mismatch: %', v_product ->> 'brand'; end if;
    else
      select count(*), (array_agg(id))[1] into v_match_count, v_brand_id
      from public.brands where data_class = 'real' and lower(btrim(name)) = lower(btrim(v_product ->> 'brand'));
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
    end if;

    v_product_id := nullif(v_product ->> 'id', '')::uuid;
    v_is_new_product := v_product_id is null;
    if v_product_id is not null then
      select count(*) into v_match_count from public.products
      where id = v_product_id and data_class = 'real' and brand_id = v_brand_id;
      if v_match_count <> 1 then raise exception 'product_identity_mismatch: %', v_product ->> 'title'; end if;
    else
      select count(*), (array_agg(id))[1] into v_match_count, v_product_id from public.products
      where data_class = 'real' and (
        slug = v_product ->> 'slug' or
        (brand_id = v_brand_id and lower(btrim(title)) = lower(btrim(v_product ->> 'title')))
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
      where data_class = 'real' and lower(btrim(name)) = lower(btrim(v_product ->> 'category'));
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
      select count(*) into v_match_count from public.categories where id = v_category_id and data_class = 'real';
      if v_match_count <> 1 then raise exception 'real_category_identity_mismatch: %', coalesce(v_product ->> 'category', 'unspecified'); end if;
    end if;

    if v_is_new_product then
      insert into public.products(
        brand_id, category_id, title, slug, short_description, publication_status,
        seo_title, seo_description, default_delivery_scope, default_pta_status, data_class, created_by, updated_by
      ) values (
        v_brand_id, v_category_id, btrim(v_product ->> 'title'), v_product ->> 'slug',
        nullif(v_product ->> 'short_description', ''), 'draft',
        nullif(v_product ->> 'seo_title', ''), nullif(v_product ->> 'seo_description', ''),
        nullif(v_product ->> 'default_delivery_scope', '')::public.delivery_scope,
        coalesce(nullif(v_product ->> 'default_pta_status', ''), 'unknown')::public.pta_status,
        'real', auth.uid(), auth.uid()
      ) returning id into v_product_id;
      v_summary := jsonb_set(v_summary, '{created_products}', to_jsonb((v_summary ->> 'created_products')::integer + 1));
    else
      update public.products set
        title = btrim(v_product ->> 'title'), brand_id = v_brand_id, category_id = v_category_id,
        short_description = coalesce(nullif(v_product ->> 'short_description', ''), short_description),
        seo_title = coalesce(nullif(v_product ->> 'seo_title', ''), seo_title),
        seo_description = coalesce(nullif(v_product ->> 'seo_description', ''), seo_description),
        default_delivery_scope = coalesce(nullif(v_product ->> 'default_delivery_scope', '')::public.delivery_scope, default_delivery_scope),
        default_pta_status = coalesce(nullif(v_product ->> 'default_pta_status', '')::public.pta_status, default_pta_status),
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

      if (v_variant ->> 'inventory') is not null then
        v_current_inventory := public.current_inventory(v_variant_id);
        v_delta := (v_variant ->> 'inventory')::integer - v_current_inventory;
        if v_delta <> 0 then
          insert into public.inventory_movements(variant_id, quantity_delta, reason, reference, note, actor_id)
          values (v_variant_id, v_delta, 'correction', 'phase4_bulk_import', 'Owner-approved bulk catalog import', auth.uid());
          v_summary := jsonb_set(v_summary, '{inventory_updates}', to_jsonb((v_summary ->> 'inventory_updates')::integer + 1));
        end if;
      end if;
    end loop;

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
