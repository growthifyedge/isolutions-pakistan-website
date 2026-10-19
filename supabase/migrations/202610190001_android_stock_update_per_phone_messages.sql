-- Android Stock Update per-phone function: fix for 8 error messages (follow-up to 202610180001).
-- NOT YET APPLIED to any database.
--
-- Bug: in apply_android_stock_phone, eight messages were appended to the text[] error list as untyped string literals
-- (v_errors := v_errors || 'A new variant needs RAM, storage and colour'). PostgreSQL then reads the literal as an ARRAY
-- literal and raises "malformed array literal: ..." instead of the intended android_stock_phone_rejected message.
-- The phone was still rolled back completely (nothing saved), but the Owner saw a technical error instead of the reason.
--
-- Fix: the same function, unchanged in every rule, step, lock, check and grant; only those eight literals are typed as
-- text ('...'::text). No table, column, policy or data change.

begin;

create or replace function public.apply_android_stock_phone(p_phone jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
set lock_timeout = '2s'
as $$
declare
  c_stock constant integer := 30;
  v_errors text[] := array[]::text[];
  v_product_id uuid;
  v_product record;
  v_steps jsonb;
  v_step jsonb;
  v_kind text;
  v_expected jsonb;
  v_ids uuid[];
  v_id uuid;
  v_variant record;
  v_text text;
  v_price bigint;
  v_from bigint;
  v_stock integer;
  v_delta bigint;
  v_count integer;
  v_price_ids uuid[] := array[]::uuid[];
  v_stock_ids uuid[] := array[]::uuid[];
  v_show_ids uuid[] := array[]::uuid[];
  v_hide_ids uuid[] := array[]::uuid[];
  v_new_configs text[] := array[]::text[];
  v_ram text;
  v_storage text;
  v_color text;
  v_pta text[];
  v_cond text[];
  v_warranty text[];
  v_delivery text[];
  v_inherited jsonb;
  v_before_product jsonb;
  v_before_media jsonb;
  v_before_specs jsonb;
  v_before_links jsonb;
  v_before_variants jsonb;
  v_before_ids uuid[];
  v_planned_price jsonb := '{}'::jsonb;
  v_planned_active jsonb := '{}'::jsonb;
  v_new_variant_id uuid;
  v_new_sku text;
  v_new_variants jsonb := '[]'::jsonb;
  v_corrections integer := 0;
  v_after jsonb;
  v_before jsonb;
begin
  if not public.is_catalog_admin() then
    raise exception 'android_stock_phone_admin_required';
  end if;

  -- -------------------------------------------------------------------------
  -- 1. Payload shape
  -- -------------------------------------------------------------------------
  if jsonb_typeof(p_phone) is distinct from 'object'
     or jsonb_typeof(p_phone -> 'steps') is distinct from 'array'
     or jsonb_array_length(p_phone -> 'steps') = 0
     or jsonb_typeof(p_phone -> 'expected' -> 'variants') is distinct from 'array' then
    raise exception 'android_stock_phone_invalid_payload';
  end if;
  if jsonb_array_length(p_phone -> 'steps') > 300 then
    raise exception 'android_stock_phone_invalid_payload: at most 300 steps per phone';
  end if;
  begin
    v_product_id := (p_phone ->> 'product_id')::uuid;
  exception when invalid_text_representation then
    raise exception 'android_stock_phone_invalid_payload: product_id is not a uuid';
  end;
  if v_product_id is null then
    raise exception 'android_stock_phone_invalid_payload: product_id is required';
  end if;
  v_steps := p_phone -> 'steps';
  v_expected := p_phone -> 'expected' -> 'variants';

  begin
    -- -----------------------------------------------------------------------
    -- 2. Lock the phone, then its variants (id order)
    -- -----------------------------------------------------------------------
    select p.id, p.title, p.data_class::text as data_class, c.slug as category_slug, b.name as brand_name
      into v_product
    from public.products p
    join public.categories c on c.id = p.category_id
    left join public.brands b on b.id = p.brand_id
    where p.id = v_product_id
    for update of p;
    if not found then
      raise exception 'android_stock_phone_not_found: %', v_product_id;
    end if;
    if v_product.data_class is distinct from 'real'
       or v_product.category_slug is distinct from 'mobile-phones'
       or v_product.brand_name is null
       or lower(btrim(v_product.brand_name)) in ('apple', 'nokia', 'hmd')
       or v_product.title ~* '\miphone\M' then
      raise exception 'android_stock_phone_not_android: "%" is not an Android phone; this update never touches it', v_product.title;
    end if;

    perform 1 from public.product_variants where product_id = v_product_id order by id for update;

    -- -----------------------------------------------------------------------
    -- 3. Changed since Check List?
    -- -----------------------------------------------------------------------
    select coalesce(array_agg(id order by id), array[]::uuid[]) into v_before_ids
    from public.product_variants where product_id = v_product_id;
    begin
      select coalesce(array_agg(distinct (e ->> 'id')::uuid), array[]::uuid[]) into v_ids
      from jsonb_array_elements(v_expected) e;
    exception when invalid_text_representation then
      raise exception 'android_stock_phone_invalid_payload: expected variant id is not a uuid';
    end;
    if cardinality(v_ids) <> jsonb_array_length(v_expected)
       or not (v_ids @> v_before_ids and v_before_ids @> v_ids) then
      raise exception 'android_stock_phone_changed_since_check: "%" has a different set of variants now; run Check List again', v_product.title;
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
      raise exception 'android_stock_phone_changed_since_check: a price or visibility of "%" changed since Check List; run Check List again', v_product.title;
    end if;

    -- -----------------------------------------------------------------------
    -- 4. Validate every step (no writes yet)
    -- -----------------------------------------------------------------------
    -- Show / hide first, so price and stock steps can be checked against the visibility AFTER this call.
    for v_step in select value from jsonb_array_elements(v_steps) loop
      v_kind := v_step ->> 'kind';
      if v_kind in ('show', 'hide') then
        if jsonb_typeof(v_step -> 'variant_ids') is distinct from 'array' or jsonb_array_length(v_step -> 'variant_ids') = 0 then
          v_errors := v_errors || format('%s step needs variant_ids', v_kind);
          continue;
        end if;
        for v_text in select value from jsonb_array_elements_text(v_step -> 'variant_ids') loop
          begin
            v_id := v_text::uuid;
          exception when invalid_text_representation then
            v_errors := v_errors || format('%s step: "%s" is not a variant id', v_kind, v_text);
            continue;
          end;
          select id, sku, is_active into v_variant from public.product_variants where id = v_id and product_id = v_product_id;
          if not found then
            v_errors := v_errors || format('%s step: variant %s does not belong to this phone', v_kind, v_id);
          elsif v_id = any(v_show_ids) or v_id = any(v_hide_ids) then
            v_errors := v_errors || format('Variant %s is shown or hidden more than once', v_variant.sku);
          elsif v_kind = 'show' and v_variant.is_active then
            v_errors := v_errors || format('Variant %s is already visible', v_variant.sku);
          elsif v_kind = 'hide' and not v_variant.is_active then
            v_errors := v_errors || format('Variant %s is already hidden', v_variant.sku);
          elsif v_kind = 'show' then
            v_show_ids := v_show_ids || v_id;
          else
            v_hide_ids := v_hide_ids || v_id;
          end if;
        end loop;
      elsif v_kind is null or v_kind not in ('price', 'set_stock', 'add_variant') then
        v_errors := v_errors || format('Unknown step kind "%s"', coalesce(v_kind, ''));
      end if;
    end loop;

    for v_step in select value from jsonb_array_elements(v_steps) loop
      v_kind := v_step ->> 'kind';
      if v_kind in ('price', 'set_stock') then
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
        if v_id = any(v_hide_ids) then
          v_errors := v_errors || format('Variant %s is listed and hidden at the same time', v_variant.sku);
          continue;
        end if;

        if v_kind = 'price' then
          if v_id = any(v_price_ids) then
            v_errors := v_errors || format('Variant %s has more than one price change', v_variant.sku);
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
            v_errors := v_errors || format('Variant %s: price changed since Check List', v_variant.sku);
            continue;
          end if;
          if v_price = v_variant.price_minor then
            v_errors := v_errors || format('Variant %s: the new price equals the current price', v_variant.sku);
            continue;
          end if;
          if v_variant.compare_at_price_minor is not null and v_price >= v_variant.compare_at_price_minor then
            v_errors := v_errors || format('Variant %s: new price is not below the compare-at price', v_variant.sku);
            continue;
          end if;
          v_price_ids := v_price_ids || v_id;
          v_planned_price := v_planned_price || jsonb_build_object(v_id::text, v_price);
        else
          if v_id = any(v_stock_ids) then
            v_errors := v_errors || format('Variant %s has more than one stock change', v_variant.sku);
            continue;
          end if;
          v_text := v_step ->> 'to_stock';
          if v_text is null or v_text !~ '^[0-9]{1,7}$' or v_text::integer <> c_stock then
            v_errors := v_errors || format('Variant %s: stock must be set to %s', v_variant.sku, c_stock);
            continue;
          end if;
          if not (v_variant.is_active or v_id = any(v_show_ids)) then
            v_errors := v_errors || format('Variant %s: stock is only set for variants that are visible after the update', v_variant.sku);
            continue;
          end if;
          v_stock_ids := v_stock_ids || v_id;
        end if;

      elsif v_kind = 'add_variant' then
        v_ram := nullif(btrim(v_step ->> 'ram'), '');
        v_storage := nullif(btrim(v_step ->> 'storage'), '');
        v_color := nullif(btrim(v_step ->> 'color'), '');
        if v_ram is null or v_storage is null or v_color is null then
          v_errors := v_errors || 'A new variant needs RAM, storage and colour'::text;
          continue;
        end if;
        v_text := v_step ->> 'price_minor';
        if v_text is null or v_text !~ '^[0-9]{1,15}$' or v_text::bigint <= 0 then
          v_errors := v_errors || format('New variant %s / %s / %s: price must be a positive amount', v_ram, v_storage, v_color);
          continue;
        end if;
        v_text := v_step ->> 'stock';
        if v_text is null or v_text !~ '^[0-9]{1,7}$' or v_text::integer <> c_stock then
          v_errors := v_errors || format('New variant %s / %s / %s: opening stock must be %s', v_ram, v_storage, v_color, c_stock);
          continue;
        end if;
        v_text := lower(v_ram) || '|' || lower(v_storage) || '|' || lower(v_color);
        if v_text = any(v_new_configs) then
          v_errors := v_errors || format('New variant %s / %s / %s is listed twice', v_ram, v_storage, v_color);
          continue;
        end if;
        v_new_configs := v_new_configs || v_text;
        if exists (
          select 1 from public.product_variants
          where product_id = v_product_id
            and lower(btrim(coalesce(ram_display, ''))) = lower(v_ram)
            and lower(btrim(coalesce(storage_display, ''))) = lower(v_storage)
            and lower(btrim(coalesce(color_finish, ''))) = lower(v_color)
        ) then
          v_errors := v_errors || format('New variant %s / %s / %s already exists on this phone', v_ram, v_storage, v_color);
          continue;
        end if;

        -- Facts are copied from the siblings only when every sibling agrees (never guessed).
        select
          array_agg(distinct pta_status::text), array_agg(distinct condition::text),
          array_agg(distinct coalesce(warranty_override, '<null>')), array_agg(distinct coalesce(delivery_scope::text, '<null>'))
          into v_pta, v_cond, v_warranty, v_delivery
        from public.product_variants
        where product_id = v_product_id
          and (is_active or not exists (select 1 from public.product_variants s where s.product_id = v_product_id and s.is_active));
        if v_pta is null then
          v_errors := v_errors || 'This phone has no existing variant to copy PTA / condition from'::text;
          continue;
        end if;
        if cardinality(v_pta) <> 1 or cardinality(v_cond) <> 1 or cardinality(v_warranty) <> 1 or cardinality(v_delivery) <> 1 then
          v_errors := v_errors || 'The existing variants of this phone do not agree on PTA, condition, warranty or delivery; add this variant by hand'::text;
          continue;
        end if;
        if v_pta[1] = 'unknown' or v_cond[1] = 'unknown' then
          v_errors := v_errors || 'The existing variants of this phone have no PTA / condition to copy'::text;
          continue;
        end if;
        v_inherited := v_step -> 'inherited';
        if jsonb_typeof(v_inherited) is distinct from 'object'
           or (v_inherited ->> 'pta_status') is distinct from v_pta[1]
           or (v_inherited ->> 'condition') is distinct from v_cond[1]
           or coalesce(v_inherited ->> 'warranty_override', '<null>') is distinct from v_warranty[1]
           or coalesce(v_inherited ->> 'delivery_scope', '<null>') is distinct from v_delivery[1] then
          v_errors := v_errors || format('New variant %s / %s / %s: copied PTA / condition / warranty / delivery do not match the phone''s variants now', v_ram, v_storage, v_color);
          continue;
        end if;
      end if;
    end loop;

    if cardinality(v_errors) > 0 then
      raise exception using
        message = format('android_stock_phone_rejected: "%s": %s%s', v_product.title,
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
    select coalesce(jsonb_object_agg(v.id::text, to_jsonb(v) - 'updated_at'), '{}'::jsonb) into v_before_variants
    from public.product_variants v where v.product_id = v_product_id;
    foreach v_id in array v_show_ids loop v_planned_active := v_planned_active || jsonb_build_object(v_id::text, true); end loop;
    foreach v_id in array v_hide_ids loop v_planned_active := v_planned_active || jsonb_build_object(v_id::text, false); end loop;

    -- -----------------------------------------------------------------------
    -- 6. Write
    -- -----------------------------------------------------------------------
    for v_step in select value from jsonb_array_elements(v_steps) where value ->> 'kind' = 'price' loop
      update public.product_variants set price_minor = (v_step ->> 'to_minor')::bigint
      where id = (v_step ->> 'variant_id')::uuid and product_id = v_product_id;
    end loop;
    if cardinality(v_show_ids) > 0 then
      update public.product_variants set is_active = true where product_id = v_product_id and id = any(v_show_ids);
    end if;
    if cardinality(v_hide_ids) > 0 then
      update public.product_variants set is_active = false where product_id = v_product_id and id = any(v_hide_ids);
    end if;

    for v_step in select value from jsonb_array_elements(v_steps) where value ->> 'kind' = 'add_variant' loop
      v_inherited := v_step -> 'inherited';
      insert into public.product_variants (
        product_id, sku, ram_display, storage_display, color_finish, price_minor,
        pta_status, condition, warranty_override, delivery_scope, is_active
      ) values (
        v_product_id, '', btrim(v_step ->> 'ram'), btrim(v_step ->> 'storage'), btrim(v_step ->> 'color'),
        (v_step ->> 'price_minor')::bigint,
        (v_inherited ->> 'pta_status')::public.pta_status, (v_inherited ->> 'condition')::public.product_condition,
        v_inherited ->> 'warranty_override', (v_inherited ->> 'delivery_scope')::public.delivery_scope, true
      ) returning id, sku into v_new_variant_id, v_new_sku;
      insert into public.inventory_movements (variant_id, quantity_delta, reason, reference, note, actor_id)
      values (v_new_variant_id, c_stock, 'initial', 'android_stock_update', 'Android Stock Update opening stock', auth.uid());
      v_new_variants := v_new_variants || jsonb_build_object(
        'id', v_new_variant_id, 'sku', v_new_sku,
        'ram', btrim(v_step ->> 'ram'), 'storage', btrim(v_step ->> 'storage'), 'color', btrim(v_step ->> 'color'),
        'price_minor', (v_step ->> 'price_minor')::bigint, 'inherited', v_inherited);
    end loop;

    -- Stock: 30 minus the stock at this moment (the variant row is locked, so no order can change it meanwhile).
    foreach v_id in array v_stock_ids loop
      v_delta := c_stock - public.current_inventory(v_id);
      if v_delta <> 0 then
        insert into public.inventory_movements (variant_id, quantity_delta, reason, reference, note, actor_id)
        values (v_id, v_delta, 'correction', 'android_stock_update', 'Android Stock Update: stock set to 30', auth.uid());
        v_corrections := v_corrections + 1;
      end if;
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
      if (v_after -> 'is_active') is distinct from coalesce(v_planned_active -> v_id::text, v_before -> 'is_active') then
        v_errors := v_errors || format('variant %s visibility is not as planned', v_before ->> 'sku');
      end if;
      if v_id = any(v_stock_ids) and public.current_inventory(v_id) <> c_stock then
        v_errors := v_errors || format('variant %s stock is not %s', v_before ->> 'sku', c_stock);
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
         or v_variant.pta_status::text is distinct from (v_step -> 'inherited' ->> 'pta_status')
         or v_variant.condition::text is distinct from (v_step -> 'inherited' ->> 'condition')
         or v_variant.warranty_override is distinct from (v_step -> 'inherited' ->> 'warranty_override')
         or v_variant.delivery_scope::text is distinct from (v_step -> 'inherited' ->> 'delivery_scope')
         or v_variant.sim_configuration is not null
         or v_variant.compare_at_price_minor is not null
         or public.current_inventory(v_variant.id) <> c_stock then
        v_errors := v_errors || format('new variant %s is not as planned', coalesce(v_step ->> 'sku', '?'));
      end if;
    end loop;

    if cardinality(v_errors) > 0 then
      raise exception using
        message = format('android_stock_phone_verification_failed: "%s": %s', v_product.title, array_to_string(v_errors, ' | ')),
        detail = 'Nothing was saved for this phone.';
    end if;

  exception
    when lock_not_available then
      raise exception using
        message = 'android_stock_phone_busy: this phone is being changed by someone else right now; nothing was saved, try again',
        detail = sqlerrm;
    when unique_violation then
      raise exception using
        message = 'android_stock_phone_variant_exists: a variant with the same details already exists; nothing was saved',
        detail = sqlerrm;
    when check_violation or not_null_violation or foreign_key_violation then
      raise exception using message = 'android_stock_phone_rejected: ' || sqlerrm, detail = 'Nothing was saved for this phone.';
  end;

  return jsonb_build_object(
    'product_id', v_product_id,
    'title', v_product.title,
    'status', 'updated',
    'price_updates', cardinality(v_price_ids),
    'shown', cardinality(v_show_ids),
    'hidden', cardinality(v_hide_ids),
    'stock_steps', cardinality(v_stock_ids),
    'stock_corrections', v_corrections,
    'new_variants', v_new_variants
  );
end;
$$;

revoke all on function public.apply_android_stock_phone(jsonb) from public, anon;
grant execute on function public.apply_android_stock_phone(jsonb) to authenticated;

comment on function public.apply_android_stock_phone(jsonb) is
  'Android Stock Update for ONE existing Android phone, all or nothing: price, show / hide (never delete), stock set to 30 (one correction row), new variants with sibling-agreed facts and server SKUs. Admin only. Never writes products, media, specifications or colour-image links; verifies its own writes before returning.';

commit;
