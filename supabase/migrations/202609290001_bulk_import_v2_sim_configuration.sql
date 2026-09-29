-- Bulk Upload v2: SIM Configuration is imported into product_variants.sim_configuration.
-- NOT YET APPLIED. Requires 202609270001_bulk_import_v2_plus_slug.sql and
-- 202609270003_variant_sim_configuration.sql.
--
-- Payload: each variant may carry "sim_configuration": physical_sim, esim,
-- physical_plus_esim, dual_esim, or blank/null. Any other value fails validation
-- ('Unknown SIM Configuration "..."'); nothing is coerced or inferred.
--
-- Create: the variant is inserted with the supplied value (blank -> NULL).
-- Replace Existing: a supplied value replaces the stored one; a blank value keeps the
-- existing sim_configuration (same rule as Grade / Battery Health / Cycle Count / Warranty).
--
-- SIM Configuration is NOT part of variant identity: the in-file duplicate check, the
-- Replace Existing matching and the uniqueness key are unchanged. Everything else in the
-- function is copied verbatim from 202609270001.

begin;

create or replace function public.apply_catalog_bulk_import_v2(p_batch jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_errors text[] := array[]::text[];
  v_product jsonb;
  v_variant jsonb;
  v_spec jsonb;
  v_pidx integer;
  v_vidx integer;
  v_psrc text;
  v_vsrc text;
  v_action text;
  v_type text;
  v_expected_slug text;
  v_brand_name text;
  v_brand_id uuid;
  v_category_name text;
  v_category_id uuid;
  v_category_slug text;
  v_title text;
  v_slug text;
  v_existing_id uuid;
  v_product_id uuid;
  v_existing_category uuid;
  v_count integer;
  v_text text;
  v_price bigint;
  v_compare bigint;
  v_stock integer;
  v_pta public.pta_status;
  v_cond public.product_condition;
  v_grade text;
  v_bh smallint;
  v_cc integer;
  v_sim text;
  v_delivery public.delivery_scope;
  v_row record;
  v_p record;
  v_v record;
  v_e record;
  v_match uuid;
  v_variant_id uuid;
  v_sku text;
  v_delta bigint;
  v_validation record;
  v_total_variants integer := 0;
  v_summary jsonb := jsonb_build_object(
    'products_created', 0, 'products_replaced', 0,
    'variants_created', 0, 'variants_updated', 0, 'variants_reactivated', 0, 'variants_hidden', 0,
    'inventory_adjustments', 0, 'specifications_created', 0
  );
  v_assigned jsonb := '[]'::jsonb;
  v_compare_cleared jsonb := '[]'::jsonb;
  v_hidden integer;
begin
  if not public.is_catalog_admin() then raise exception 'catalog_admin_required'; end if;
  if jsonb_typeof(p_batch) is distinct from 'object'
     or jsonb_typeof(p_batch -> 'products') is distinct from 'array'
     or jsonb_array_length(p_batch -> 'products') = 0 then
    raise exception 'invalid_bulk_import_payload';
  end if;
  if jsonb_array_length(p_batch -> 'products') > 500 then
    raise exception 'bulk_import_v2_too_large: at most 500 products per import';
  end if;

  drop table if exists pg_temp.bulk_v2_products;
  drop table if exists pg_temp.bulk_v2_variants;
  create temporary table bulk_v2_products (
    idx integer primary key, source text, action text, product_type text,
    brand_id uuid, category_id uuid, title text, slug text,
    product_id uuid, specs jsonb
  ) on commit drop;
  create temporary table bulk_v2_variants (
    pidx integer, vidx integer, source text, sku text,
    ram text, storage text, color text, price bigint, compare_at bigint, stock integer,
    pta public.pta_status, cond public.product_condition, grade text, bh smallint, cc integer,
    sim text, warranty text, delivery public.delivery_scope,
    match_id uuid, variant_id uuid, was_active boolean,
    primary key (pidx, vidx)
  ) on commit drop;

  -- -------------------------------------------------------------------------
  -- 1. Parse and validate every product and variant (no writes yet)
  -- -------------------------------------------------------------------------
  for v_product, v_pidx in
    select value, ordinality::integer from jsonb_array_elements(p_batch -> 'products') with ordinality
  loop
    v_title := nullif(btrim(v_product ->> 'title'), '');
    v_psrc := coalesce(nullif(btrim(v_product ->> 'source'), ''), v_title, format('Product %s', v_pidx));
    v_action := v_product ->> 'action';
    v_type := v_product ->> 'product_type';
    v_brand_name := nullif(btrim(v_product ->> 'brand'), '');
    v_category_name := nullif(btrim(v_product ->> 'category'), '');
    v_brand_id := null;
    v_category_id := null;
    v_category_slug := null;
    v_existing_id := null;
    v_slug := null;

    if v_action is null or v_action not in ('Create', 'Replace Existing') then
      v_errors := v_errors || format('%s: Action must be Create or Replace Existing', v_psrc);
    end if;
    if v_title is null then
      v_errors := v_errors || format('%s: Product Title is required', v_psrc);
    end if;
    v_expected_slug := case v_type
      when 'Mobile Phone' then 'mobile-phones'
      when 'Accessory' then 'mobile-accessories'
      when 'Gadget' then 'gadgets'
      when 'Tablet' then 'tablets'
      when 'Laptop' then 'laptops'
    end;
    if v_expected_slug is null then
      v_errors := v_errors || format('%s: Product Type must be Mobile Phone, Accessory, Gadget, Tablet or Laptop', v_psrc);
    end if;

    if v_brand_name is not null then
      select count(*), (array_agg(id))[1] into v_count, v_brand_id
      from public.brands where data_class = 'real' and is_active and lower(btrim(name)) = lower(v_brand_name);
      if v_count <> 1 then
        v_errors := v_errors || format('%s: Brand not found among active brands: "%s"', v_psrc, v_brand_name);
        v_brand_id := null;
      end if;
    end if;

    if v_category_name is not null then
      select count(*), (array_agg(id))[1], (array_agg(slug))[1] into v_count, v_category_id, v_category_slug
      from public.categories where data_class = 'real' and is_active and lower(btrim(name)) = lower(v_category_name);
      if v_count <> 1 then
        v_errors := v_errors || format('%s: Category not found among active categories: "%s"', v_psrc, v_category_name);
        v_category_id := null;
      end if;
    elsif v_expected_slug is not null then
      select id, slug into v_category_id, v_category_slug
      from public.categories where data_class = 'real' and is_active and slug = v_expected_slug;
      if v_category_id is null then
        v_errors := v_errors || format('%s: No active category for Product Type %s', v_psrc, v_type);
      end if;
    end if;
    if v_category_id is not null and v_expected_slug is not null and v_category_slug <> v_expected_slug then
      v_errors := v_errors || format('%s: Category "%s" does not match Product Type %s', v_psrc, v_category_name, v_type);
    end if;

    if v_title is not null then
      select count(*), (array_agg(id))[1], (array_agg(category_id))[1] into v_count, v_existing_id, v_existing_category
      from public.products
      where data_class = 'real' and brand_id is not distinct from v_brand_id and lower(btrim(title)) = lower(v_title);
      if v_count > 1 then
        v_errors := v_errors || format('%s: More than one existing product is named "%s"', v_psrc, v_title);
        v_existing_id := null;
      elsif v_action = 'Create' and v_count = 1 then
        v_errors := v_errors || format('%s: Action is Create but "%s" already exists; use Replace Existing', v_psrc, v_title);
      elsif v_action = 'Replace Existing' and v_count = 0 then
        v_errors := v_errors || format('%s: Action is Replace Existing but "%s" does not exist; use Create', v_psrc, v_title);
      elsif v_action = 'Replace Existing' and v_category_id is not null and v_existing_category <> v_category_id then
        v_errors := v_errors || format('%s: Category differs from the existing product; import does not change categories', v_psrc);
      end if;
      if v_action = 'Create' then
        -- Same rule as the client (catalogSlug): '+' is model identity, so it becomes "plus"
        -- (Note 15 Pro+ -> xiaomi-note-15-pro-plus, never xiaomi-note-15-pro).
        v_slug := btrim(regexp_replace(regexp_replace(lower(v_title), '\+', ' plus ', 'g'), '[^a-z0-9]+', '-', 'g'), '-');
        if v_slug = '' then
          v_errors := v_errors || format('%s: Product Title must contain letters or digits', v_psrc);
        elsif exists (select 1 from public.products where slug = v_slug) then
          v_errors := v_errors || format('%s: Product slug "%s" is already used by another product', v_psrc, v_slug);
        end if;
      end if;
    end if;

    if v_action = 'Create' and jsonb_typeof(v_product -> 'specifications') = 'array' then
      for v_spec in select value from jsonb_array_elements(v_product -> 'specifications') loop
        if nullif(btrim(v_spec ->> 'label'), '') is null or nullif(btrim(v_spec ->> 'value'), '') is null then
          v_errors := v_errors || format('%s: Every specification needs a name and a value', v_psrc);
        end if;
      end loop;
      if exists (
        select 1 from jsonb_array_elements(v_product -> 'specifications') s
        group by lower(coalesce(nullif(btrim(s.value ->> 'group'), ''), '')), lower(btrim(s.value ->> 'label'))
        having count(*) > 1
      ) then
        v_errors := v_errors || format('%s: Duplicate specification name in the same section', v_psrc);
      end if;
    end if;

    insert into pg_temp.bulk_v2_products (idx, source, action, product_type, brand_id, category_id, title, slug, product_id, specs)
    values (
      v_pidx, v_psrc, v_action, v_type, v_brand_id, v_category_id, v_title, v_slug,
      case when v_action = 'Replace Existing' then v_existing_id end,
      case when v_action = 'Create' and jsonb_typeof(v_product -> 'specifications') = 'array' then v_product -> 'specifications' else '[]'::jsonb end
    );

    if jsonb_typeof(v_product -> 'variants') is distinct from 'array' or jsonb_array_length(v_product -> 'variants') = 0 then
      v_errors := v_errors || format('%s: At least one variant row is required', v_psrc);
      continue;
    end if;

    for v_variant, v_vidx in
      select value, ordinality::integer from jsonb_array_elements(v_product -> 'variants') with ordinality
    loop
      v_total_variants := v_total_variants + 1;
      v_vsrc := coalesce(nullif(btrim(v_variant ->> 'source'), ''), format('%s variant %s', v_psrc, v_vidx));

      v_text := nullif(btrim(v_variant ->> 'price_minor'), '');
      v_price := null;
      if v_text is null or v_text !~ '^[0-9]{1,15}$' or v_text::bigint <= 0 then
        v_errors := v_errors || format('%s: Price must be a positive PKR amount', v_vsrc);
      else
        v_price := v_text::bigint;
      end if;

      v_text := nullif(btrim(v_variant ->> 'compare_at_price_minor'), '');
      v_compare := null;
      if v_text is not null then
        if v_text !~ '^[0-9]{1,15}$' then
          v_errors := v_errors || format('%s: Compare-at Price must be a PKR amount', v_vsrc);
        else
          v_compare := v_text::bigint;
          if v_price is not null and v_compare <= v_price then
            v_errors := v_errors || format('%s: Compare-at Price must be higher than Price', v_vsrc);
          end if;
        end if;
      end if;

      v_text := nullif(btrim(v_variant ->> 'stock'), '');
      v_stock := 10;
      if v_text is not null then
        if v_text !~ '^[0-9]{1,7}$' then
          v_errors := v_errors || format('%s: Stock must be a whole number of 0 or more', v_vsrc);
        else
          v_stock := v_text::integer;
        end if;
      end if;

      v_text := nullif(btrim(v_variant ->> 'pta_status'), '');
      v_pta := null;
      if v_text is not null then
        if v_text not in ('approved', 'not_approved', 'not_applicable') then
          v_errors := v_errors || format('%s: Unknown PTA Status "%s"', v_vsrc, v_text);
        else
          v_pta := v_text::public.pta_status;
        end if;
      end if;

      v_text := nullif(btrim(v_variant ->> 'condition'), '');
      v_cond := null;
      if v_text is not null then
        if v_text not in ('brand_new', 'used', 'open_box', 'refurbished') then
          v_errors := v_errors || format('%s: Unknown Condition "%s"', v_vsrc, v_text);
        else
          v_cond := v_text::public.product_condition;
        end if;
      end if;

      v_grade := nullif(btrim(v_variant ->> 'condition_grade'), '');
      if v_grade is not null and v_grade <> 'A++' then
        v_errors := v_errors || format('%s: Condition Grade must be A++', v_vsrc);
        v_grade := null;
      elsif v_grade is not null and v_cond is distinct from 'used' then
        v_errors := v_errors || format('%s: Condition Grade A++ requires Condition Used', v_vsrc);
      end if;

      v_text := nullif(btrim(v_variant ->> 'battery_health_percent'), '');
      v_bh := null;
      if v_text is not null then
        if v_text !~ '^[0-9]{1,3}$' or v_text::integer not between 1 and 100 then
          v_errors := v_errors || format('%s: Battery Health must be a whole number from 1 to 100', v_vsrc);
        else
          v_bh := v_text::smallint;
        end if;
      end if;

      v_text := nullif(btrim(v_variant ->> 'battery_cycle_count'), '');
      v_cc := null;
      if v_text is not null then
        if v_text !~ '^[0-9]{1,7}$' then
          v_errors := v_errors || format('%s: Cycle Count must be a whole number of 0 or more', v_vsrc);
        else
          v_cc := v_text::integer;
        end if;
      end if;

      -- SIM Configuration: optional; blank is NULL; only the four stored values are accepted.
      v_sim := nullif(btrim(v_variant ->> 'sim_configuration'), '');
      if v_sim is not null and v_sim not in ('physical_sim', 'esim', 'physical_plus_esim', 'dual_esim') then
        v_errors := v_errors || format('%s: Unknown SIM Configuration "%s"', v_vsrc, v_sim);
        v_sim := null;
      end if;

      v_text := nullif(btrim(v_variant ->> 'delivery_scope'), '');
      v_delivery := null;
      if v_text is not null then
        if v_text not in ('karachi_only', 'nationwide') then
          v_errors := v_errors || format('%s: Unknown Delivery Scope "%s"', v_vsrc, v_text);
        else
          v_delivery := v_text::public.delivery_scope;
          if v_type = 'Mobile Phone' and v_delivery = 'nationwide' then
            v_errors := v_errors || format('%s: Mobile phones are Karachi-only; Nationwide conflicts', v_vsrc);
          end if;
        end if;
      end if;

      insert into pg_temp.bulk_v2_variants (
        pidx, vidx, source, sku, ram, storage, color, price, compare_at, stock,
        pta, cond, grade, bh, cc, sim, warranty, delivery
      ) values (
        v_pidx, v_vidx, v_vsrc, nullif(btrim(v_variant ->> 'sku'), ''),
        nullif(btrim(v_variant ->> 'ram'), ''), nullif(btrim(v_variant ->> 'storage'), ''),
        nullif(btrim(v_variant ->> 'color'), ''), v_price, v_compare, v_stock,
        v_pta, v_cond, v_grade, v_bh, v_cc, v_sim,
        nullif(btrim(v_variant ->> 'warranty'), ''), v_delivery
      );
    end loop;
  end loop;

  if v_total_variants > 5000 then
    raise exception 'bulk_import_v2_too_large: at most 5000 variants per import';
  end if;

  -- The same product twice in one file.
  for v_row in
    select string_agg(source, ', ' order by idx) as sources
    from pg_temp.bulk_v2_products where title is not null
    group by brand_id, lower(title) having count(*) > 1
  loop
    v_errors := v_errors || format('The same product appears more than once: %s', v_row.sources);
  end loop;
  for v_row in
    select string_agg(source, ', ' order by idx) as sources
    from pg_temp.bulk_v2_products where slug is not null
    group by slug having count(*) > 1
  loop
    v_errors := v_errors || format('Products would share one slug: %s', v_row.sources);
  end loop;

  -- The same variant twice in one product.
  for v_row in
    select string_agg(source, ', ' order by vidx) as sources
    from pg_temp.bulk_v2_variants
    group by pidx, lower(coalesce(ram, '')), lower(coalesce(storage, '')), lower(coalesce(color, '')),
      pta, cond, grade, bh, cc
    having count(*) > 1
  loop
    v_errors := v_errors || format('Duplicate variant: %s', v_row.sources);
  end loop;

  -- Match Replace Existing rows to existing variants (active or hidden); check SKUs.
  for v_v in
    select v.*, p.product_id, p.action
    from pg_temp.bulk_v2_variants v join pg_temp.bulk_v2_products p on p.idx = v.pidx
    order by v.pidx, v.vidx
  loop
    v_match := null;
    if v_v.action = 'Replace Existing' and v_v.product_id is not null then
      select count(*), (array_agg(e.id))[1] into v_count, v_match
      from public.product_variants e
      where e.product_id = v_v.product_id and e.carrier_jv is null
        and lower(coalesce(btrim(e.ram_display), '')) = lower(coalesce(v_v.ram, ''))
        and lower(coalesce(btrim(e.storage_display), '')) = lower(coalesce(v_v.storage, ''))
        and lower(coalesce(btrim(e.color_finish), '')) = lower(coalesce(v_v.color, ''))
        and (v_v.pta is null or e.pta_status = v_v.pta or e.pta_status = 'unknown')
        and (v_v.cond is null or e.condition = v_v.cond or e.condition = 'unknown')
        and (v_v.grade is null or e.condition_grade is null or e.condition_grade = v_v.grade)
        and (v_v.bh is null or e.battery_health_percent is null or e.battery_health_percent = v_v.bh)
        and (v_v.cc is null or e.battery_cycle_count is null or e.battery_cycle_count = v_v.cc);
      if v_count > 1 then
        -- Prefer the variant whose supplied facts match exactly (not via unknown / blank).
        select count(*), (array_agg(e.id))[1] into v_count, v_match
        from public.product_variants e
        where e.product_id = v_v.product_id and e.carrier_jv is null
          and lower(coalesce(btrim(e.ram_display), '')) = lower(coalesce(v_v.ram, ''))
          and lower(coalesce(btrim(e.storage_display), '')) = lower(coalesce(v_v.storage, ''))
          and lower(coalesce(btrim(e.color_finish), '')) = lower(coalesce(v_v.color, ''))
          and (v_v.pta is null or e.pta_status = v_v.pta)
          and (v_v.cond is null or e.condition = v_v.cond)
          and (v_v.grade is null or e.condition_grade = v_v.grade)
          and (v_v.bh is null or e.battery_health_percent = v_v.bh)
          and (v_v.cc is null or e.battery_cycle_count = v_v.cc);
        if v_count <> 1 then
          v_errors := v_errors || format('%s: Matches more than one existing variant; add PTA, Condition, Battery Health or Cycle Count to tell them apart', v_v.source);
          v_match := null;
        end if;
      end if;
    end if;
    if v_match is not null then
      select sku, is_active into v_e from public.product_variants where id = v_match;
      update pg_temp.bulk_v2_variants set match_id = v_match, was_active = v_e.is_active
      where pidx = v_v.pidx and vidx = v_v.vidx;
      if v_v.sku is not null and upper(v_v.sku) <> upper(v_e.sku) then
        v_errors := v_errors || format('%s: SKU %s does not match the existing variant SKU %s; SKUs cannot be changed', v_v.source, v_v.sku, v_e.sku);
      end if;
    elsif v_v.sku is not null then
      v_errors := v_errors || format('%s: SKU is assigned automatically; leave it blank for a new variant', v_v.source);
    end if;
  end loop;

  for v_row in
    select string_agg(source, ', ' order by vidx) as sources
    from pg_temp.bulk_v2_variants where match_id is not null
    group by match_id having count(*) > 1
  loop
    v_errors := v_errors || format('Rows match the same existing variant: %s', v_row.sources);
  end loop;

  if cardinality(v_errors) > 0 then
    raise exception using
      message = format('bulk_import_v2_validation_failed: %s%s',
        array_to_string(v_errors[1:20], ' | '),
        case when cardinality(v_errors) > 20 then format(' | (+%s more)', cardinality(v_errors) - 20) else '' end),
      detail = array_to_string(v_errors, E'\n');
  end if;

  -- -------------------------------------------------------------------------
  -- 2. Write (still one transaction; any failure rolls everything back)
  -- -------------------------------------------------------------------------
  begin
    for v_p in select * from pg_temp.bulk_v2_products order by idx loop
      v_product_id := v_p.product_id;
      if v_p.action = 'Create' then
        insert into public.products (
          brand_id, category_id, title, slug, publication_status, data_class, created_by, updated_by
        ) values (
          v_p.brand_id, v_p.category_id, v_p.title, v_p.slug, 'draft', 'real', auth.uid(), auth.uid()
        ) returning id into v_product_id;
        update pg_temp.bulk_v2_products set product_id = v_product_id where idx = v_p.idx;
        insert into public.product_specifications (product_id, specification_group, label, value, sort_order)
        select v_product_id, nullif(btrim(s.value ->> 'group'), ''), btrim(s.value ->> 'label'),
          btrim(s.value ->> 'value'), s.ordinality::integer - 1
        from jsonb_array_elements(v_p.specs) with ordinality s;
        get diagnostics v_count = row_count;
        v_summary := jsonb_set(v_summary, '{specifications_created}', to_jsonb((v_summary ->> 'specifications_created')::integer + v_count));
        v_summary := jsonb_set(v_summary, '{products_created}', to_jsonb((v_summary ->> 'products_created')::integer + 1));
      else
        v_summary := jsonb_set(v_summary, '{products_replaced}', to_jsonb((v_summary ->> 'products_replaced')::integer + 1));
      end if;

      for v_v in select * from pg_temp.bulk_v2_variants where pidx = v_p.idx order by vidx loop
        if v_v.match_id is null then
          -- Blank SKU: the product_variants trigger assigns the next MB/AC/GD/MC/IP SKU.
          insert into public.product_variants (
            product_id, sku, ram_display, storage_display, color_finish, price_minor, compare_at_price_minor,
            pta_status, condition, condition_grade, battery_health_percent, battery_cycle_count,
            sim_configuration, warranty_override, delivery_scope, is_active
          ) values (
            v_product_id, '', v_v.ram, v_v.storage, v_v.color, v_v.price, v_v.compare_at,
            coalesce(v_v.pta, 'unknown'), coalesce(v_v.cond, 'unknown'), v_v.grade, v_v.bh, v_v.cc,
            v_v.sim, v_v.warranty, v_v.delivery, true
          ) returning id, sku into v_variant_id, v_sku;
          v_summary := jsonb_set(v_summary, '{variants_created}', to_jsonb((v_summary ->> 'variants_created')::integer + 1));
          v_assigned := v_assigned || jsonb_build_object('product', v_p.title, 'source', v_v.source, 'sku', v_sku);
        else
          select * into v_e from public.product_variants where id = v_v.match_id;
          v_compare := case
            when v_v.compare_at is not null then v_v.compare_at
            when v_e.compare_at_price_minor > v_v.price then v_e.compare_at_price_minor
            else null
          end;
          if v_v.compare_at is null and v_e.compare_at_price_minor is not null and v_compare is null then
            v_compare_cleared := v_compare_cleared || jsonb_build_object('product', v_p.title, 'source', v_v.source, 'sku', v_e.sku);
          end if;
          update public.product_variants set
            is_active = true,
            price_minor = v_v.price,
            compare_at_price_minor = v_compare,
            pta_status = coalesce(v_v.pta, pta_status),
            condition = coalesce(v_v.cond, condition),
            condition_grade = coalesce(v_v.grade, condition_grade),
            battery_health_percent = coalesce(v_v.bh, battery_health_percent),
            battery_cycle_count = coalesce(v_v.cc, battery_cycle_count),
            sim_configuration = coalesce(v_v.sim, sim_configuration),
            warranty_override = coalesce(v_v.warranty, warranty_override),
            delivery_scope = coalesce(v_v.delivery, delivery_scope)
          where id = v_v.match_id;
          v_variant_id := v_v.match_id;
          if v_v.was_active then
            v_summary := jsonb_set(v_summary, '{variants_updated}', to_jsonb((v_summary ->> 'variants_updated')::integer + 1));
          else
            v_summary := jsonb_set(v_summary, '{variants_reactivated}', to_jsonb((v_summary ->> 'variants_reactivated')::integer + 1));
          end if;
        end if;
        update pg_temp.bulk_v2_variants set variant_id = v_variant_id where pidx = v_v.pidx and vidx = v_v.vidx;

        -- Final stock = Excel stock (10 when blank), recorded as a ledger correction.
        v_delta := v_v.stock - public.current_inventory(v_variant_id);
        if v_delta <> 0 then
          insert into public.inventory_movements (variant_id, quantity_delta, reason, reference, note, actor_id)
          values (v_variant_id, v_delta, 'correction', 'bulk_import_v2', 'Bulk Upload v2 stock from Excel', auth.uid());
          v_summary := jsonb_set(v_summary, '{inventory_adjustments}', to_jsonb((v_summary ->> 'inventory_adjustments')::integer + 1));
        end if;
      end loop;

      if v_p.action = 'Replace Existing' then
        update public.product_variants set is_active = false
        where product_id = v_product_id and is_active
          and id not in (select variant_id from pg_temp.bulk_v2_variants where pidx = v_p.idx and variant_id is not null);
        get diagnostics v_hidden = row_count;
        v_summary := jsonb_set(v_summary, '{variants_hidden}', to_jsonb((v_summary ->> 'variants_hidden')::integer + v_hidden));

        if (select publication_status = 'published' from public.products where id = v_product_id) then
          select * into v_validation from public.validate_product_for_publication(v_product_id);
          if not v_validation.is_valid then
            raise exception 'bulk_import_v2_publication_guard: "%" is published and would fail publication checks (%); complete the missing values or unpublish it first',
              v_p.title, array_to_string(v_validation.errors, ', ');
          end if;
        end if;
      end if;
    end loop;
  exception
    when unique_violation then
      raise exception using
        message = 'bulk_import_v2_conflict: a variant with the same RAM/Storage/Color/PTA/Condition/Grade/BH/CC already exists for this product, or the slug is taken',
        detail = sqlerrm;
    when check_violation or foreign_key_violation or not_null_violation then
      raise exception using message = 'bulk_import_v2_rejected: ' || sqlerrm;
  end;

  return v_summary || jsonb_build_object(
    'assigned_skus', v_assigned,
    'compare_at_cleared', v_compare_cleared,
    'products', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', p.product_id, 'title', p.title, 'action', p.action,
        'has_primary_image', exists (
          select 1 from public.product_media m
          where m.product_id = p.product_id and m.is_primary and m.cloudinary_public_id is not null
        )
      ) order by p.idx), '[]'::jsonb)
      from pg_temp.bulk_v2_products p
    )
  );
end;
$$;

revoke all on function public.apply_catalog_bulk_import_v2(jsonb) from public, anon;
grant execute on function public.apply_catalog_bulk_import_v2(jsonb) to authenticated;
comment on function public.apply_catalog_bulk_import_v2(jsonb) is
  'Bulk Upload v2 atomic import (Create / Replace Existing). Admin only; validates everything before writing; server-assigned SKUs; preserves product-level data on replace; hides (never deletes) variants missing from the file.';


commit;
