-- iPhone Stock Update (New + Used): one existing iPhone product per call, all or nothing.
-- NOT YET APPLIED to any database. Additive only: one new function, no table, column, category or policy change.
--
-- public.apply_iphone_stock_phone(p_phone jsonb) applies every planned change of ONE existing iPhone product:
--   {
--     "product_id": "<uuid>",
--     "condition": "used" | "brand_new",
--     "expected": { "variants": [ { "id": "<uuid>", "price_minor": 1, "is_active": true }, ... ] },
--     "steps": [
--       { "kind": "price",       "variant_id": "<uuid>", "from_minor": 1, "to_minor": 2 },
--       { "kind": "show",        "variant_id": "<uuid>", "from_minor": 1, "to_minor": 2 },
--       { "kind": "add_variant", "storage": "256 GB", "color": "Black", "price_minor": 1, "stock": 20,
--         "pta_status": "approved", "condition": "used", "sim_configuration": null | "dual_physical_sim" | ... }
--     ]
--   }
--
-- Owner rules (2026-10-21):
--   * New and Used iPhones are separate products in Mobile Phones. Used titles end with " (Used)"; New titles do not.
--     The product must be Apple, real, in mobile-phones, follow the title rule for "condition", and EVERY variant it has
--     must be of that condition. Anything else is refused (a plain-title product with Used variants is never touched).
--   * price: an existing visible variant gets the list price. Stock is never touched.
--   * show: a hidden listed variant is shown again with the list price. Stock is never touched (no reset).
--   * add_variant: storage, colour, price, PTA and condition from the list; opening stock exactly 20 (one 'initial'
--     ledger row). SIM only when the list gives it (optional "sim_configuration", one of the stored values; blank =
--     NULL). RAM, grade, battery health, cycle count and warranty stay NULL; delivery is Karachi only (locked
--     mobile-phone rule). Refused if a variant with the same storage / colour / PTA / condition exists.
--     The SIM of an EXISTING variant is never written here.
--   * There is no hide, no delete, no stock change for existing variants, and no write to products, media,
--     specifications or colour-image links. Variants not in the steps are not touched.
--   * The phone is refused if its variants, prices or visibility changed since Check Changes.
--   * Every write is read back inside the transaction; any difference rolls the whole phone back.
-- New iPhone products are NOT created here: they go through apply_catalog_bulk_import_v2 (action "Create", draft).

begin;

create or replace function public.apply_iphone_stock_phone(p_phone jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
set lock_timeout = '2s'
as $$
declare
  c_stock constant integer := 20;
  v_errors text[] := array[]::text[];
  v_product_id uuid;
  v_product record;
  v_condition text;
  v_steps jsonb;
  v_step jsonb;
  v_kind text;
  v_expected jsonb;
  v_ids uuid[];
  v_id uuid;
  v_variant record;
  v_text text;
  v_price bigint;
  v_count integer;
  v_touched uuid[] := array[]::uuid[];
  v_price_ids uuid[] := array[]::uuid[];
  v_show_ids uuid[] := array[]::uuid[];
  v_new_configs text[] := array[]::text[];
  v_storage text;
  v_color text;
  v_pta text;
  v_sim text;
  v_before_product jsonb;
  v_before_media jsonb;
  v_before_specs jsonb;
  v_before_links jsonb;
  v_before_variants jsonb;
  v_before_stock jsonb;
  v_before_ids uuid[];
  v_planned_price jsonb := '{}'::jsonb;
  v_new_variant_id uuid;
  v_new_sku text;
  v_new_variants jsonb := '[]'::jsonb;
  v_after jsonb;
  v_before jsonb;
begin
  if not public.is_catalog_admin() then
    raise exception 'iphone_stock_phone_admin_required';
  end if;

  -- -------------------------------------------------------------------------
  -- 1. Payload shape
  -- -------------------------------------------------------------------------
  if jsonb_typeof(p_phone) is distinct from 'object'
     or jsonb_typeof(p_phone -> 'steps') is distinct from 'array'
     or jsonb_array_length(p_phone -> 'steps') = 0
     or jsonb_typeof(p_phone -> 'expected' -> 'variants') is distinct from 'array' then
    raise exception 'iphone_stock_phone_invalid_payload';
  end if;
  if jsonb_array_length(p_phone -> 'steps') > 300 then
    raise exception 'iphone_stock_phone_invalid_payload: at most 300 steps per phone';
  end if;
  v_condition := p_phone ->> 'condition';
  if v_condition is null or v_condition not in ('brand_new', 'used') then
    raise exception 'iphone_stock_phone_invalid_payload: condition must be brand_new or used';
  end if;
  begin
    v_product_id := (p_phone ->> 'product_id')::uuid;
  exception when invalid_text_representation then
    raise exception 'iphone_stock_phone_invalid_payload: product_id is not a uuid';
  end;
  if v_product_id is null then
    raise exception 'iphone_stock_phone_invalid_payload: product_id is required';
  end if;
  v_steps := p_phone -> 'steps';
  v_expected := p_phone -> 'expected' -> 'variants';

  begin
    -- -----------------------------------------------------------------------
    -- 2. Lock the product, then its variants (id order)
    -- -----------------------------------------------------------------------
    select p.id, p.title, p.data_class::text as data_class, c.slug as category_slug, b.name as brand_name
      into v_product
    from public.products p
    join public.categories c on c.id = p.category_id
    left join public.brands b on b.id = p.brand_id
    where p.id = v_product_id
    for update of p;
    if not found then
      raise exception 'iphone_stock_phone_not_found: %', v_product_id;
    end if;
    if v_product.data_class is distinct from 'real'
       or v_product.category_slug is distinct from 'mobile-phones'
       or lower(btrim(coalesce(v_product.brand_name, ''))) <> 'apple' then
      raise exception 'iphone_stock_phone_not_iphone: "%" is not an Apple mobile phone; this update never touches it', v_product.title;
    end if;
    if (v_product.title ~* '\s\(used\)\s*$') is distinct from (v_condition = 'used') then
      raise exception 'iphone_stock_phone_wrong_listing: "%" is not the % listing; this update never touches it',
        v_product.title, case when v_condition = 'used' then 'Used' else 'New' end;
    end if;

    perform 1 from public.product_variants where product_id = v_product_id order by id for update;

    if not exists (select 1 from public.product_variants where product_id = v_product_id) then
      raise exception 'iphone_stock_phone_wrong_listing: "%" has no variants, so New / Used cannot be confirmed', v_product.title;
    end if;
    if exists (select 1 from public.product_variants where product_id = v_product_id and condition::text <> v_condition) then
      raise exception 'iphone_stock_phone_wrong_listing: "%" has variants that are not %; this update never touches it',
        v_product.title, case when v_condition = 'used' then 'Used' else 'New' end;
    end if;

    -- -----------------------------------------------------------------------
    -- 3. Changed since Check Changes?
    -- -----------------------------------------------------------------------
    select coalesce(array_agg(id order by id), array[]::uuid[]) into v_before_ids
    from public.product_variants where product_id = v_product_id;
    begin
      select coalesce(array_agg(distinct (e ->> 'id')::uuid), array[]::uuid[]) into v_ids
      from jsonb_array_elements(v_expected) e;
    exception when invalid_text_representation then
      raise exception 'iphone_stock_phone_invalid_payload: expected variant id is not a uuid';
    end;
    if cardinality(v_ids) <> jsonb_array_length(v_expected)
       or not (v_ids @> v_before_ids and v_before_ids @> v_ids) then
      raise exception 'iphone_stock_phone_changed_since_check: "%" has a different set of variants now; run Check Changes again', v_product.title;
    end if;
    if exists (
      select 1
      from jsonb_array_elements(v_expected) e
      join public.product_variants v on v.id = (e ->> 'id')::uuid
      where (e ->> 'price_minor') is null
         or (e ->> 'price_minor') !~ '^[0-9]{1,15}$'
         or v.price_minor <> (e ->> 'price_minor')::bigint
         or jsonb_typeof(e -> 'is_active') is distinct from 'boolean'
         or v.is_active <> (e ->> 'is_active')::boolean
    ) then
      raise exception 'iphone_stock_phone_changed_since_check: a price or visibility of "%" changed since Check Changes; run Check Changes again', v_product.title;
    end if;

    -- -----------------------------------------------------------------------
    -- 4. Validate every step (no writes yet)
    -- -----------------------------------------------------------------------
    for v_step in select value from jsonb_array_elements(v_steps) loop
      v_kind := v_step ->> 'kind';
      if v_kind in ('price', 'show') then
        begin
          v_id := (v_step ->> 'variant_id')::uuid;
        exception when invalid_text_representation then
          v_errors := v_errors || format('%s step: variant_id is not a uuid', v_kind);
          continue;
        end;
        select id, sku, is_active, price_minor, compare_at_price_minor into v_variant
        from public.product_variants where id = v_id and product_id = v_product_id;
        if v_id is null or not found then
          v_errors := v_errors || format('%s step: variant %s does not belong to this phone', v_kind, coalesce(v_id::text, 'NULL'));
          continue;
        end if;
        if v_id = any(v_touched) then
          v_errors := v_errors || format('Variant %s is changed more than once', v_variant.sku);
          continue;
        end if;
        if v_kind = 'price' and not v_variant.is_active then
          v_errors := v_errors || format('Variant %s is hidden; use a show step', v_variant.sku);
          continue;
        end if;
        if v_kind = 'show' and v_variant.is_active then
          v_errors := v_errors || format('Variant %s is already visible', v_variant.sku);
          continue;
        end if;
        v_text := v_step ->> 'to_minor';
        if v_text is null or v_text !~ '^[0-9]{1,15}$' or v_text::bigint <= 0 then
          v_errors := v_errors || format('Variant %s: new price must be a positive amount', v_variant.sku);
          continue;
        end if;
        v_price := v_text::bigint;
        v_text := v_step ->> 'from_minor';
        if v_text is null or v_text !~ '^[0-9]{1,15}$' or v_text::bigint <> v_variant.price_minor then
          v_errors := v_errors || format('Variant %s: price changed since Check Changes', v_variant.sku);
          continue;
        end if;
        if v_kind = 'price' and v_price = v_variant.price_minor then
          v_errors := v_errors || format('Variant %s: the new price equals the current price', v_variant.sku);
          continue;
        end if;
        if v_price <> v_variant.price_minor and v_variant.compare_at_price_minor is not null and v_price >= v_variant.compare_at_price_minor then
          v_errors := v_errors || format('Variant %s: new price is not below the compare-at price', v_variant.sku);
          continue;
        end if;
        v_touched := v_touched || v_id;
        if v_price <> v_variant.price_minor then
          v_price_ids := v_price_ids || v_id;
          v_planned_price := v_planned_price || jsonb_build_object(v_id::text, v_price);
        end if;
        if v_kind = 'show' then
          v_show_ids := v_show_ids || v_id;
        end if;

      elsif v_kind = 'add_variant' then
        v_storage := nullif(btrim(v_step ->> 'storage'), '');
        v_color := nullif(btrim(v_step ->> 'color'), '');
        v_pta := v_step ->> 'pta_status';
        if v_storage is null or v_color is null then
          v_errors := v_errors || 'A new iPhone variant needs storage and colour'::text;
          continue;
        end if;
        if v_pta is null or v_pta not in ('approved', 'not_approved', 'not_applicable') then
          v_errors := v_errors || format('New variant %s / %s: PTA must be given', v_storage, v_color);
          continue;
        end if;
        v_sim := nullif(btrim(v_step ->> 'sim_configuration'), '');
        if v_sim is not null and v_sim not in ('physical_sim', 'esim', 'physical_plus_esim', 'dual_esim', 'dual_physical_sim') then
          v_errors := v_errors || format('New variant %s / %s: unknown SIM configuration "%s"', v_storage, v_color, v_sim);
          continue;
        end if;
        if (v_step ->> 'condition') is distinct from v_condition then
          v_errors := v_errors || format('New variant %s / %s: condition must be %s', v_storage, v_color, v_condition);
          continue;
        end if;
        v_text := v_step ->> 'price_minor';
        if v_text is null or v_text !~ '^[0-9]{1,15}$' or v_text::bigint <= 0 then
          v_errors := v_errors || format('New variant %s / %s: price must be a positive amount', v_storage, v_color);
          continue;
        end if;
        v_text := v_step ->> 'stock';
        if v_text is null or v_text !~ '^[0-9]{1,7}$' or v_text::integer <> c_stock then
          v_errors := v_errors || format('New variant %s / %s: opening stock must be %s', v_storage, v_color, c_stock);
          continue;
        end if;
        v_text := lower(v_storage) || '|' || lower(v_color) || '|' || v_pta;
        if v_text = any(v_new_configs) then
          v_errors := v_errors || format('New variant %s / %s is listed twice', v_storage, v_color);
          continue;
        end if;
        v_new_configs := v_new_configs || v_text;
        if exists (
          select 1 from public.product_variants
          where product_id = v_product_id
            and lower(btrim(coalesce(storage_display, ''))) = lower(v_storage)
            and lower(btrim(coalesce(color_finish, ''))) = lower(v_color)
            and pta_status::text = v_pta
            and condition::text = v_condition
        ) then
          v_errors := v_errors || format('New variant %s / %s already exists on this phone', v_storage, v_color);
          continue;
        end if;
      else
        v_errors := v_errors || format('Unknown step kind "%s"', coalesce(v_kind, ''));
      end if;
    end loop;

    if cardinality(v_errors) > 0 then
      raise exception using
        message = format('iphone_stock_phone_rejected: "%s": %s%s', v_product.title,
          array_to_string(v_errors[1:10], ' | '),
          case when cardinality(v_errors) > 10 then format(' | (+%s more)', cardinality(v_errors) - 10) else '' end),
        detail = array_to_string(v_errors, E'\n');
    end if;

    -- -----------------------------------------------------------------------
    -- 5. "Before" copy (for the read-back below)
    -- -----------------------------------------------------------------------
    select to_jsonb(p) into v_before_product from public.products p where p.id = v_product_id;
    select coalesce(jsonb_agg(to_jsonb(m) order by m.id), '[]'::jsonb) into v_before_media from public.product_media m where m.product_id = v_product_id;
    select coalesce(jsonb_agg(to_jsonb(s) order by s.id), '[]'::jsonb) into v_before_specs from public.product_specifications s where s.product_id = v_product_id;
    select coalesce(jsonb_agg(to_jsonb(a) order by a.media_id, a.variant_id), '[]'::jsonb) into v_before_links
    from public.product_media_variant_assignments a join public.product_media m on m.id = a.media_id where m.product_id = v_product_id;
    select coalesce(jsonb_object_agg(v.id::text, to_jsonb(v) - 'updated_at'), '{}'::jsonb),
           coalesce(jsonb_object_agg(v.id::text, public.current_inventory(v.id)), '{}'::jsonb)
      into v_before_variants, v_before_stock
    from public.product_variants v where v.product_id = v_product_id;

    -- -----------------------------------------------------------------------
    -- 6. Write
    -- -----------------------------------------------------------------------
    for v_step in select value from jsonb_array_elements(v_steps) where value ->> 'kind' in ('price', 'show') loop
      update public.product_variants
      set price_minor = (v_step ->> 'to_minor')::bigint,
          is_active = true
      where id = (v_step ->> 'variant_id')::uuid and product_id = v_product_id;
    end loop;

    for v_step in select value from jsonb_array_elements(v_steps) where value ->> 'kind' = 'add_variant' loop
      v_sim := nullif(btrim(v_step ->> 'sim_configuration'), '');
      insert into public.product_variants (
        product_id, sku, ram_display, storage_display, color_finish, price_minor,
        pta_status, condition, sim_configuration, warranty_override, delivery_scope, is_active
      ) values (
        v_product_id, '', null, btrim(v_step ->> 'storage'), btrim(v_step ->> 'color'),
        (v_step ->> 'price_minor')::bigint,
        (v_step ->> 'pta_status')::public.pta_status, v_condition::public.product_condition,
        v_sim, null, 'karachi_only'::public.delivery_scope, true
      ) returning id, sku into v_new_variant_id, v_new_sku;
      insert into public.inventory_movements (variant_id, quantity_delta, reason, reference, note, actor_id)
      values (v_new_variant_id, c_stock, 'initial', 'iphone_stock_update', 'iPhone Stock Update opening stock', auth.uid());
      v_new_variants := v_new_variants || jsonb_build_object(
        'id', v_new_variant_id, 'sku', v_new_sku,
        'storage', btrim(v_step ->> 'storage'), 'color', btrim(v_step ->> 'color'),
        'price_minor', (v_step ->> 'price_minor')::bigint, 'pta_status', v_step ->> 'pta_status',
        'sim_configuration', v_sim);
    end loop;

    -- -----------------------------------------------------------------------
    -- 7. Read-back: anything not exactly as planned rolls this phone back
    -- -----------------------------------------------------------------------
    v_errors := array[]::text[];
    select to_jsonb(p) into v_after from public.products p where p.id = v_product_id;
    if v_after is distinct from v_before_product then v_errors := v_errors || 'the phone row changed'::text; end if;
    select coalesce(jsonb_agg(to_jsonb(m) order by m.id), '[]'::jsonb) into v_after from public.product_media m where m.product_id = v_product_id;
    if v_after is distinct from v_before_media then v_errors := v_errors || 'images changed'::text; end if;
    select coalesce(jsonb_agg(to_jsonb(s) order by s.id), '[]'::jsonb) into v_after from public.product_specifications s where s.product_id = v_product_id;
    if v_after is distinct from v_before_specs then v_errors := v_errors || 'specifications changed'::text; end if;
    select coalesce(jsonb_agg(to_jsonb(a) order by a.media_id, a.variant_id), '[]'::jsonb) into v_after
    from public.product_media_variant_assignments a join public.product_media m on m.id = a.media_id where m.product_id = v_product_id;
    if v_after is distinct from v_before_links then v_errors := v_errors || 'colour-image links changed'::text; end if;

    foreach v_id in array v_before_ids loop
      select to_jsonb(v) - 'updated_at' into v_after from public.product_variants v where v.id = v_id;
      v_before := v_before_variants -> v_id::text;
      if v_after is null then
        v_errors := v_errors || format('variant %s is missing', v_before ->> 'sku');
        continue;
      end if;
      if (v_after - 'price_minor' - 'is_active') is distinct from (v_before - 'price_minor' - 'is_active') then
        v_errors := v_errors || format('variant %s changed outside price / visibility', v_before ->> 'sku');
      end if;
      if (v_after -> 'price_minor') is distinct from coalesce(v_planned_price -> v_id::text, v_before -> 'price_minor') then
        v_errors := v_errors || format('variant %s price is not as planned', v_before ->> 'sku');
      end if;
      if (v_after -> 'is_active') is distinct from (case when v_id = any(v_show_ids) then 'true'::jsonb else v_before -> 'is_active' end) then
        v_errors := v_errors || format('variant %s visibility is not as planned', v_before ->> 'sku');
      end if;
      if to_jsonb(public.current_inventory(v_id)) is distinct from (v_before_stock -> v_id::text) then
        v_errors := v_errors || format('variant %s stock changed', v_before ->> 'sku');
      end if;
    end loop;

    select count(*) into v_count from public.product_variants where product_id = v_product_id and not (id = any(v_before_ids));
    if v_count <> jsonb_array_length(v_new_variants) then
      v_errors := v_errors || format('%s new variant(s) found, %s planned', v_count, jsonb_array_length(v_new_variants));
    end if;
    for v_step in select value from jsonb_array_elements(v_new_variants) loop
      select * into v_variant from public.product_variants where id = (v_step ->> 'id')::uuid;
      if not found
         or v_variant.sku !~ '^MB[0-9]{3}$'
         or v_variant.is_active is not true
         or v_variant.price_minor <> (v_step ->> 'price_minor')::bigint
         or v_variant.pta_status::text is distinct from (v_step ->> 'pta_status')
         or v_variant.condition::text is distinct from v_condition
         or v_variant.ram_display is not null
         or v_variant.condition_grade is not null
         or v_variant.battery_health_percent is not null
         or v_variant.battery_cycle_count is not null
         or v_variant.sim_configuration is distinct from (v_step ->> 'sim_configuration')
         or v_variant.warranty_override is not null
         or v_variant.delivery_scope::text is distinct from 'karachi_only'
         or v_variant.compare_at_price_minor is not null
         or public.current_inventory(v_variant.id) <> c_stock then
        v_errors := v_errors || format('new variant %s is not as planned', coalesce(v_step ->> 'sku', '?'));
      end if;
    end loop;

    if cardinality(v_errors) > 0 then
      raise exception using
        message = format('iphone_stock_phone_verification_failed: "%s": %s', v_product.title, array_to_string(v_errors, ' | ')),
        detail = 'Nothing was saved for this phone.';
    end if;

  exception
    when lock_not_available then
      raise exception using
        message = 'iphone_stock_phone_busy: this phone is being changed by someone else right now; nothing was saved, try again',
        detail = sqlerrm;
    when unique_violation then
      raise exception using
        message = 'iphone_stock_phone_variant_exists: a variant with the same details already exists; nothing was saved',
        detail = sqlerrm;
    when check_violation or not_null_violation or foreign_key_violation then
      raise exception using message = 'iphone_stock_phone_rejected: ' || sqlerrm, detail = 'Nothing was saved for this phone.';
  end;

  return jsonb_build_object(
    'product_id', v_product_id,
    'title', v_product.title,
    'status', 'updated',
    'price_updates', cardinality(v_price_ids),
    'shown', cardinality(v_show_ids),
    'new_variants', v_new_variants
  );
end;
$$;

revoke all on function public.apply_iphone_stock_phone(jsonb) from public, anon;
grant execute on function public.apply_iphone_stock_phone(jsonb) to authenticated;

comment on function public.apply_iphone_stock_phone(jsonb) is
  'iPhone Stock Update for ONE existing Apple product (New or Used listing), all or nothing: price only for listed variants, hidden listed variants shown again with the list price, new variants with list facts and opening stock 20 (server SKUs). Never hides, deletes or changes stock of existing variants; never writes products, media, specifications or colour-image links; verifies its own writes before returning.';

commit;
