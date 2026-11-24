-- Catalog → Variants & Pricing: fully editable variants (Owner-approved 2026-11-23, "Option B").
-- Additive only: two new functions. No table, column, constraint, policy, trigger, grant on a table or existing function
-- is changed, and no row is written by this migration.
--
-- public.apply_product_variant_edits(p_edit jsonb) saves every change the Owner reviewed for ONE product, all or nothing:
--   {
--     "product_id": "<uuid>",
--     "expected": { "variants": [ { "id", "ram_display", "storage_display", "color_finish", "price_minor",
--                                   "compare_at_price_minor", "pta_status", "condition", "warranty_override",
--                                   "delivery_scope", "is_active", "stock" }, ... ] },     -- every variant as loaded
--     "updates": [ { "variant_id": "<uuid>", "changes": { "<field>": <new value>, ... } } ],  -- changed fields only
--     "stock":   [ { "variant_id": "<uuid>", "from_stock": 7, "to_stock": 12 } ],
--     "adds":    [ { "ram_display", "storage_display", "color_finish", "price_minor", "compare_at_price_minor",
--                    "pta_status", "condition", "warranty_override", "delivery_scope", "is_active", "stock" } ]
--   }
--
-- Rules:
--   * Owner only (public.is_site_owner(): role 'owner', active). Admin / staff / anon are refused.
--   * Real catalog products only. The product and its variants are locked; the call is refused if ANY variant, field or
--     stock differs from "expected" (someone or an order changed it since the page loaded).
--   * Editable: RAM, storage, colour (rename keeps the same variant row: id, SKU, images, stock history and order
--     history are untouched), price, compare-at (null or above the price), PTA, condition (Brand New / Used), warranty,
--     delivery (mobile phones: Karachi only, the locked delivery rule), visibility. Only the fields sent are written.
--   * Stock: set to an exact number by ONE 'correction' row in inventory_movements (target minus the stock now). The
--     ledger is append-only; no movement is ever updated or deleted. New variants: one 'initial' row when stock > 0.
--   * New variants get a server SKU (existing trigger). Nothing is ever deleted.
--   * Duplicates are refused: no two variants of the product may end with the same RAM / storage / colour (spaces and
--     case ignored) with the same PTA / condition / grade / battery / cycle count / carrier.
--   * A PUBLISHED product must still pass public.validate_product_for_publication after the changes, so it never needs
--     to go back to Draft and can never be left unpublishable. Draft products are saved without that check.
--   * Everything is read back inside the transaction (product row, images, specifications, colour-image links, every
--     variant field, every stock figure, the new rows); any difference rolls the whole product back.

begin;

-- Field check shared by updates and new variants: {"ok": <normalised value>} or {"error": "<plain reason>"}.
create or replace function public.variant_editor_field(p_key text, p_value jsonb, p_mobile_phone boolean)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_text text;
  v_number numeric;
  v_limit integer;
begin
  if p_value is null then
    return jsonb_build_object('error', format('%s is missing', p_key));
  end if;
  if p_key in ('ram_display', 'storage_display', 'color_finish', 'warranty_override') then
    if jsonb_typeof(p_value) = 'null' then
      return jsonb_build_object('ok', 'null'::jsonb);
    end if;
    if jsonb_typeof(p_value) <> 'string' then
      return jsonb_build_object('error', format('%s must be text', p_key));
    end if;
    v_text := nullif(regexp_replace(btrim(p_value #>> '{}'), '\s+', ' ', 'g'), '');
    if v_text is not null and v_text ~ '[[:cntrl:]]' then
      return jsonb_build_object('error', format('%s contains control characters', p_key));
    end if;
    v_limit := 40;
    if p_key = 'warranty_override' then
      v_limit := 80;
    end if;
    if v_text is not null and char_length(v_text) > v_limit then
      return jsonb_build_object('error', format('%s is too long', p_key));
    end if;
    return jsonb_build_object('ok', coalesce(to_jsonb(v_text), 'null'::jsonb));
  elsif p_key in ('price_minor', 'compare_at_price_minor') then
    if p_key = 'compare_at_price_minor' and jsonb_typeof(p_value) = 'null' then
      return jsonb_build_object('ok', 'null'::jsonb);
    end if;
    if jsonb_typeof(p_value) <> 'number' then
      return jsonb_build_object('error', format('%s must be a number', p_key));
    end if;
    v_number := (p_value #>> '{}')::numeric;
    if v_number <> trunc(v_number) or v_number <= 0 or v_number > 1000000000000 then
      return jsonb_build_object('error', format('%s must be a positive whole amount', p_key));
    end if;
    return jsonb_build_object('ok', to_jsonb(v_number::bigint));
  elsif p_key = 'pta_status' then
    if jsonb_typeof(p_value) <> 'string' or (p_value #>> '{}') not in ('approved', 'not_approved', 'not_applicable') then
      return jsonb_build_object('error', 'PTA must be PTA Approved, Non-PTA or Not applicable');
    end if;
    return jsonb_build_object('ok', p_value);
  elsif p_key = 'condition' then
    if jsonb_typeof(p_value) <> 'string' or (p_value #>> '{}') not in ('brand_new', 'used') then
      return jsonb_build_object('error', 'Condition must be Brand New or Used');
    end if;
    return jsonb_build_object('ok', p_value);
  elsif p_key = 'delivery_scope' then
    if jsonb_typeof(p_value) <> 'string' or (p_value #>> '{}') not in ('karachi_only', 'nationwide') then
      return jsonb_build_object('error', 'Delivery must be Karachi only or Nationwide');
    end if;
    if p_mobile_phone and (p_value #>> '{}') <> 'karachi_only' then
      return jsonb_build_object('error', 'Mobile phones are delivered in Karachi only');
    end if;
    return jsonb_build_object('ok', p_value);
  elsif p_key = 'is_active' then
    if jsonb_typeof(p_value) <> 'boolean' then
      return jsonb_build_object('error', 'Visibility must be true or false');
    end if;
    return jsonb_build_object('ok', p_value);
  end if;
  return jsonb_build_object('error', format('"%s" cannot be changed here', p_key));
end;
$$;

revoke all on function public.variant_editor_field(text, jsonb, boolean) from public, anon, authenticated;

create or replace function public.apply_product_variant_edits(p_edit jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
set lock_timeout = '2s'
as $$
declare
  c_fields constant text[] := array['ram_display', 'storage_display', 'color_finish', 'price_minor', 'compare_at_price_minor',
    'pta_status', 'condition', 'warranty_override', 'delivery_scope', 'is_active'];
  c_max_stock constant integer := 100000;
  v_errors text[] := array[]::text[];
  v_product_id uuid;
  v_product record;
  v_mobile boolean;
  v_expected jsonb;
  v_updates jsonb;
  v_stock jsonb;
  v_adds jsonb;
  v_item jsonb;
  v_changes jsonb;
  v_checked jsonb;
  v_key text;
  v_id uuid;
  v_ids uuid[];
  v_before_ids uuid[];
  v_update_ids uuid[] := array[]::uuid[];
  v_stock_ids uuid[] := array[]::uuid[];
  v_sku text;
  v_current jsonb;
  v_planned jsonb;
  v_final jsonb := '{}'::jsonb;
  v_planned_stock jsonb := '{}'::jsonb;
  v_new jsonb := '[]'::jsonb;
  v_new_row jsonb;
  v_text text;
  v_from bigint;
  v_to bigint;
  v_keys text[] := array[]::text[];
  v_labels text[] := array[]::text[];
  v_position integer;
  v_index integer := 0;
  v_valid boolean;
  v_validation text[];
  v_new_id uuid;
  v_new_sku text;
  v_new_variants jsonb := '[]'::jsonb;
  v_corrections integer := 0;
  v_before_product jsonb;
  v_before_media jsonb;
  v_before_specs jsonb;
  v_before_links jsonb;
  v_before_variants jsonb;
  v_before_stock jsonb := '{}'::jsonb;
  v_after jsonb;
  v_before jsonb;
  v_count integer;
begin
  if not public.is_site_owner() then
    raise exception 'variant_editor_owner_required: only the Owner can save variant changes';
  end if;

  -- 1. Payload shape ------------------------------------------------------------------------------------------------
  if jsonb_typeof(p_edit) is distinct from 'object'
     or jsonb_typeof(p_edit -> 'expected' -> 'variants') is distinct from 'array'
     or jsonb_typeof(coalesce(p_edit -> 'updates', '[]'::jsonb)) <> 'array'
     or jsonb_typeof(coalesce(p_edit -> 'stock', '[]'::jsonb)) <> 'array'
     or jsonb_typeof(coalesce(p_edit -> 'adds', '[]'::jsonb)) <> 'array' then
    raise exception 'variant_editor_invalid_payload';
  end if;
  v_updates := coalesce(p_edit -> 'updates', '[]'::jsonb);
  v_stock := coalesce(p_edit -> 'stock', '[]'::jsonb);
  v_adds := coalesce(p_edit -> 'adds', '[]'::jsonb);
  v_expected := p_edit -> 'expected' -> 'variants';
  if jsonb_array_length(v_updates) + jsonb_array_length(v_stock) + jsonb_array_length(v_adds) = 0 then
    raise exception 'variant_editor_invalid_payload: nothing to save';
  end if;
  if jsonb_array_length(v_updates) > 300 or jsonb_array_length(v_stock) > 300 or jsonb_array_length(v_adds) > 50 then
    raise exception 'variant_editor_invalid_payload: too many changes in one save';
  end if;
  begin
    v_product_id := (p_edit ->> 'product_id')::uuid;
  exception when invalid_text_representation then
    raise exception 'variant_editor_invalid_payload: product_id is not a uuid';
  end;
  if v_product_id is null then
    raise exception 'variant_editor_invalid_payload: product_id is required';
  end if;

  begin
    -- 2. Lock the product, then its variants (id order) -------------------------------------------------------------
    select p.id, p.title, p.publication_status::text as publication_status, p.data_class::text as data_class, c.slug as category_slug
      into v_product
    from public.products p
    join public.categories c on c.id = p.category_id
    where p.id = v_product_id
    for update of p;
    if not found then
      raise exception 'variant_editor_not_found: %', v_product_id;
    end if;
    if v_product.data_class is distinct from 'real' then
      raise exception 'variant_editor_not_real: "%" is not a real catalog product', v_product.title;
    end if;
    v_mobile := v_product.category_slug = 'mobile-phones';
    perform 1 from public.product_variants where product_id = v_product_id order by id for update;

    -- 3. Changed since the page loaded? -----------------------------------------------------------------------------
    select coalesce(array_agg(id order by id), array[]::uuid[]) into v_before_ids from public.product_variants where product_id = v_product_id;
    begin
      select coalesce(array_agg(distinct (e ->> 'id')::uuid), array[]::uuid[]) into v_ids from jsonb_array_elements(v_expected) e;
    exception when invalid_text_representation then
      raise exception 'variant_editor_invalid_payload: expected variant id is not a uuid';
    end;
    if cardinality(v_ids) <> jsonb_array_length(v_expected) or not (v_ids @> v_before_ids and v_before_ids @> v_ids) then
      raise exception 'variant_editor_changed_since_load: "%" has a different set of variants now; reload and edit again', v_product.title;
    end if;
    if exists (
      select 1
      from jsonb_array_elements(v_expected) e
      join public.product_variants v on v.id = (e ->> 'id')::uuid
      where e -> 'ram_display' is distinct from coalesce(to_jsonb(v.ram_display), 'null'::jsonb)
         or e -> 'storage_display' is distinct from coalesce(to_jsonb(v.storage_display), 'null'::jsonb)
         or e -> 'color_finish' is distinct from coalesce(to_jsonb(v.color_finish), 'null'::jsonb)
         or e -> 'price_minor' is distinct from to_jsonb(v.price_minor)
         or e -> 'compare_at_price_minor' is distinct from coalesce(to_jsonb(v.compare_at_price_minor), 'null'::jsonb)
         or e -> 'pta_status' is distinct from to_jsonb(v.pta_status::text)
         or e -> 'condition' is distinct from to_jsonb(v.condition::text)
         or e -> 'warranty_override' is distinct from coalesce(to_jsonb(v.warranty_override), 'null'::jsonb)
         or e -> 'delivery_scope' is distinct from coalesce(to_jsonb(v.delivery_scope::text), 'null'::jsonb)
         or e -> 'is_active' is distinct from to_jsonb(v.is_active)
         or e -> 'stock' is distinct from to_jsonb(public.current_inventory(v.id))
    ) then
      raise exception 'variant_editor_changed_since_load: a variant, price or stock of "%" changed since the page loaded; reload and edit again', v_product.title;
    end if;

    -- Every variant as it is now (editable fields), the base of the planned final state.
    for v_current in
      select jsonb_build_object('id', v.id, 'sku', v.sku,
        'ram_display', v.ram_display, 'storage_display', v.storage_display, 'color_finish', v.color_finish,
        'price_minor', v.price_minor, 'compare_at_price_minor', v.compare_at_price_minor,
        'pta_status', v.pta_status::text, 'condition', v.condition::text, 'warranty_override', v.warranty_override,
        'delivery_scope', v.delivery_scope::text, 'is_active', v.is_active,
        'condition_grade', v.condition_grade, 'battery_health_percent', v.battery_health_percent,
        'battery_cycle_count', v.battery_cycle_count, 'carrier_jv', v.carrier_jv)
      from public.product_variants v where v.product_id = v_product_id
    loop
      v_final := v_final || jsonb_build_object(v_current ->> 'id', v_current);
    end loop;

    -- 4. Field updates (only the fields sent) ------------------------------------------------------------------------
    for v_item in select value from jsonb_array_elements(v_updates) loop
      begin
        v_id := (v_item ->> 'variant_id')::uuid;
      exception when invalid_text_representation then
        v_errors := v_errors || 'An update has an invalid variant id'::text;
        continue;
      end;
      v_current := v_final -> v_id::text;
      if v_id is null or v_current is null then
        v_errors := v_errors || format('Variant %s does not belong to this product', coalesce(v_id::text, 'NULL'));
        continue;
      end if;
      v_sku := v_current ->> 'sku';
      if v_id = any(v_update_ids) then
        v_errors := v_errors || format('%s is listed more than once', v_sku);
        continue;
      end if;
      v_update_ids := v_update_ids || v_id;
      v_changes := v_item -> 'changes';
      if jsonb_typeof(v_changes) is distinct from 'object' or v_changes = '{}'::jsonb then
        v_errors := v_errors || format('%s: no change sent', v_sku);
        continue;
      end if;
      v_planned := v_current;
      for v_key in select jsonb_object_keys(v_changes) loop
        if not (v_key = any(c_fields)) then
          v_errors := v_errors || format('%s: "%s" cannot be changed here', v_sku, v_key);
          continue;
        end if;
        v_checked := public.variant_editor_field(v_key, v_changes -> v_key, v_mobile);
        if v_checked ? 'error' then
          v_errors := v_errors || format('%s: %s', v_sku, v_checked ->> 'error');
          continue;
        end if;
        if (v_checked -> 'ok') = (v_current -> v_key) then
          v_errors := v_errors || format('%s: %s is unchanged', v_sku, v_key);
          continue;
        end if;
        v_planned := jsonb_set(v_planned, array[v_key], v_checked -> 'ok');
      end loop;
      v_final := jsonb_set(v_final, array[v_id::text], v_planned);
    end loop;

    -- 5. Stock: exact numbers for existing variants ------------------------------------------------------------------
    for v_item in select value from jsonb_array_elements(v_stock) loop
      begin
        v_id := (v_item ->> 'variant_id')::uuid;
      exception when invalid_text_representation then
        v_errors := v_errors || 'A stock change has an invalid variant id'::text;
        continue;
      end;
      v_current := v_final -> v_id::text;
      if v_id is null or v_current is null then
        v_errors := v_errors || format('Stock: variant %s does not belong to this product', coalesce(v_id::text, 'NULL'));
        continue;
      end if;
      v_sku := v_current ->> 'sku';
      if v_id = any(v_stock_ids) then
        v_errors := v_errors || format('%s: stock is listed more than once', v_sku);
        continue;
      end if;
      v_stock_ids := v_stock_ids || v_id;
      if jsonb_typeof(v_item -> 'from_stock') is distinct from 'number' or jsonb_typeof(v_item -> 'to_stock') is distinct from 'number'
         or (v_item ->> 'to_stock') !~ '^[0-9]{1,7}$' or (v_item ->> 'from_stock') !~ '^-?[0-9]{1,9}$' then
        v_errors := v_errors || format('%s: stock must be a whole number', v_sku);
        continue;
      end if;
      v_from := (v_item ->> 'from_stock')::bigint;
      v_to := (v_item ->> 'to_stock')::bigint;
      if v_to > c_max_stock then
        v_errors := v_errors || format('%s: stock cannot be more than %s', v_sku, c_max_stock);
        continue;
      end if;
      if v_from <> public.current_inventory(v_id) then
        v_errors := v_errors || format('%s: stock changed since the page loaded', v_sku);
        continue;
      end if;
      if v_to = v_from then
        v_errors := v_errors || format('%s: the new stock equals the current stock', v_sku);
        continue;
      end if;
      v_planned_stock := v_planned_stock || jsonb_build_object(v_id::text, v_to);
    end loop;

    -- 6. New variants --------------------------------------------------------------------------------------------------
    for v_item in select value from jsonb_array_elements(v_adds) loop
      v_index := v_index + 1;
      if jsonb_typeof(v_item) is distinct from 'object' then
        v_errors := v_errors || format('New variant %s: invalid', v_index);
        continue;
      end if;
      v_new_row := jsonb_build_object('label', format('New variant %s', v_index), 'condition_grade', null, 'battery_health_percent', null, 'battery_cycle_count', null, 'carrier_jv', null);
      for v_key in select unnest(c_fields) loop
        if v_key in ('compare_at_price_minor', 'warranty_override', 'ram_display', 'storage_display', 'color_finish') and not (v_item ? v_key) then
          v_new_row := v_new_row || jsonb_build_object(v_key, null);
          continue;
        end if;
        if v_key = 'is_active' and not (v_item ? v_key) then
          v_new_row := v_new_row || jsonb_build_object(v_key, true);
          continue;
        end if;
        v_checked := public.variant_editor_field(v_key, v_item -> v_key, v_mobile);
        if v_checked ? 'error' then
          v_errors := v_errors || format('New variant %s: %s', v_index, v_checked ->> 'error');
        else
          v_new_row := v_new_row || jsonb_build_object(v_key, v_checked -> 'ok');
        end if;
      end loop;
      for v_key in select jsonb_object_keys(v_item) loop
        if not (v_key = any(c_fields) or v_key = 'stock') then
          v_errors := v_errors || format('New variant %s: "%s" cannot be set here', v_index, v_key);
        end if;
      end loop;
      if jsonb_typeof(v_new_row -> 'storage_display') = 'null' and jsonb_typeof(v_new_row -> 'color_finish') = 'null' then
        v_errors := v_errors || format('New variant %s: storage or colour is required', v_index);
      end if;
      if jsonb_typeof(v_item -> 'stock') is distinct from 'number' or (v_item ->> 'stock') !~ '^[0-9]{1,7}$' or (v_item ->> 'stock')::bigint > c_max_stock then
        v_errors := v_errors || format('New variant %s: opening stock must be a whole number from 0 to %s', v_index, c_max_stock);
      else
        v_new_row := v_new_row || jsonb_build_object('stock', (v_item ->> 'stock')::bigint);
      end if;
      v_new := v_new || jsonb_build_array(v_new_row);
    end loop;

    -- 7. Final state: prices and duplicates --------------------------------------------------------------------------
    for v_current in
      select value || jsonb_build_object('label', value ->> 'sku') from jsonb_each(v_final)
      union all
      select value from jsonb_array_elements(v_new)
    loop
      if (v_current ->> 'compare_at_price_minor') is not null and (v_current ->> 'price_minor') is not null
         and (v_current ->> 'compare_at_price_minor')::bigint <= (v_current ->> 'price_minor')::bigint then
        v_errors := v_errors || format('%s: the compare-at price must be above the price', v_current ->> 'label');
      end if;
      v_text := concat_ws('|',
        lower(regexp_replace(coalesce(v_current ->> 'ram_display', ''), '\s+', '', 'g')),
        lower(regexp_replace(coalesce(v_current ->> 'storage_display', ''), '\s+', '', 'g')),
        lower(regexp_replace(coalesce(v_current ->> 'color_finish', ''), '\s+', '', 'g')),
        coalesce(v_current ->> 'pta_status', ''), coalesce(v_current ->> 'condition', ''),
        coalesce(v_current ->> 'condition_grade', ''), coalesce(v_current ->> 'battery_health_percent', ''),
        coalesce(v_current ->> 'battery_cycle_count', ''), coalesce(v_current ->> 'carrier_jv', ''));
      v_position := array_position(v_keys, v_text);
      if v_position is not null then
        v_errors := v_errors || format('%s and %s would be the same variant (same RAM / storage / colour / PTA / condition)', v_labels[v_position], v_current ->> 'label');
      else
        v_keys := v_keys || v_text;
        v_labels := v_labels || (v_current ->> 'label');
      end if;
    end loop;

    if cardinality(v_errors) > 0 then
      raise exception using
        message = format('variant_editor_rejected: "%s": %s%s', v_product.title, array_to_string(v_errors[1:10], ' | '),
          case when cardinality(v_errors) > 10 then format(' | (+%s more)', cardinality(v_errors) - 10) else '' end),
        detail = array_to_string(v_errors, E'\n');
    end if;

    -- 8. "Before" copies for the read-back ----------------------------------------------------------------------------
    select to_jsonb(p) into v_before_product from public.products p where p.id = v_product_id;
    select coalesce(jsonb_agg(to_jsonb(m) order by m.id), '[]'::jsonb) into v_before_media from public.product_media m where m.product_id = v_product_id;
    select coalesce(jsonb_agg(to_jsonb(s) order by s.id), '[]'::jsonb) into v_before_specs from public.product_specifications s where s.product_id = v_product_id;
    select coalesce(jsonb_agg(to_jsonb(a) order by a.media_id, a.variant_id), '[]'::jsonb) into v_before_links
    from public.product_media_variant_assignments a join public.product_media m on m.id = a.media_id where m.product_id = v_product_id;
    select coalesce(jsonb_object_agg(v.id::text, to_jsonb(v) - 'updated_at'), '{}'::jsonb) into v_before_variants
    from public.product_variants v where v.product_id = v_product_id;
    foreach v_id in array v_before_ids loop
      v_before_stock := v_before_stock || jsonb_build_object(v_id::text, public.current_inventory(v_id));
    end loop;

    -- 9. Write: changed fields only, new variants, stock corrections ---------------------------------------------------
    for v_item in select value from jsonb_array_elements(v_updates) loop
      v_id := (v_item ->> 'variant_id')::uuid;
      v_changes := v_item -> 'changes';
      v_planned := v_final -> v_id::text;
      update public.product_variants set
        ram_display = case when v_changes ? 'ram_display' then v_planned ->> 'ram_display' else ram_display end,
        storage_display = case when v_changes ? 'storage_display' then v_planned ->> 'storage_display' else storage_display end,
        color_finish = case when v_changes ? 'color_finish' then v_planned ->> 'color_finish' else color_finish end,
        price_minor = case when v_changes ? 'price_minor' then (v_planned ->> 'price_minor')::bigint else price_minor end,
        compare_at_price_minor = case when v_changes ? 'compare_at_price_minor' then (v_planned ->> 'compare_at_price_minor')::bigint else compare_at_price_minor end,
        pta_status = case when v_changes ? 'pta_status' then (v_planned ->> 'pta_status')::public.pta_status else pta_status end,
        condition = case when v_changes ? 'condition' then (v_planned ->> 'condition')::public.product_condition else condition end,
        warranty_override = case when v_changes ? 'warranty_override' then v_planned ->> 'warranty_override' else warranty_override end,
        delivery_scope = case when v_changes ? 'delivery_scope' then (v_planned ->> 'delivery_scope')::public.delivery_scope else delivery_scope end,
        is_active = case when v_changes ? 'is_active' then (v_planned ->> 'is_active')::boolean else is_active end
      where id = v_id and product_id = v_product_id;
    end loop;

    for v_new_row in select value from jsonb_array_elements(v_new) loop
      insert into public.product_variants (
        product_id, sku, ram_display, storage_display, color_finish, price_minor, compare_at_price_minor,
        pta_status, condition, warranty_override, delivery_scope, is_active
      ) values (
        v_product_id, '', v_new_row ->> 'ram_display', v_new_row ->> 'storage_display', v_new_row ->> 'color_finish',
        (v_new_row ->> 'price_minor')::bigint, (v_new_row ->> 'compare_at_price_minor')::bigint,
        (v_new_row ->> 'pta_status')::public.pta_status, (v_new_row ->> 'condition')::public.product_condition,
        v_new_row ->> 'warranty_override', (v_new_row ->> 'delivery_scope')::public.delivery_scope, (v_new_row ->> 'is_active')::boolean
      ) returning id, sku into v_new_id, v_new_sku;
      if (v_new_row ->> 'stock')::bigint > 0 then
        insert into public.inventory_movements (variant_id, quantity_delta, reason, reference, note, actor_id)
        values (v_new_id, (v_new_row ->> 'stock')::integer, 'initial', 'variant_editor', 'Variant editor: opening stock', auth.uid());
      end if;
      v_new_variants := v_new_variants || jsonb_build_array(v_new_row || jsonb_build_object('id', v_new_id, 'sku', v_new_sku));
    end loop;

    for v_key in select jsonb_object_keys(v_planned_stock) loop
      v_id := v_key::uuid;
      v_from := public.current_inventory(v_id);
      v_to := (v_planned_stock ->> v_key)::bigint;
      if v_to <> v_from then
        insert into public.inventory_movements (variant_id, quantity_delta, reason, reference, note, actor_id)
        values (v_id, (v_to - v_from)::integer, 'correction', 'variant_editor', format('Variant editor: stock set from %s to %s', v_from, v_to), auth.uid());
        v_corrections := v_corrections + 1;
      end if;
    end loop;

    -- 10. A published product must still be publishable ---------------------------------------------------------------
    if v_product.publication_status = 'published' then
      select is_valid, errors into v_valid, v_validation from public.validate_product_for_publication(v_product_id);
      if not coalesce(v_valid, false) then
        raise exception using
          message = format('variant_editor_unpublishable: "%s" is live and these changes would break its publish rules (%s); nothing was saved', v_product.title, array_to_string(v_validation, ', ')),
          detail = 'Nothing was saved for this product.';
      end if;
    end if;

    -- 11. Read-back: anything not exactly as planned rolls the product back ----------------------------------------------
    v_errors := array[]::text[];
    select to_jsonb(p) into v_after from public.products p where p.id = v_product_id;
    if v_after is distinct from v_before_product then v_errors := v_errors || 'the product row changed'::text; end if;
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
      v_planned := v_final -> v_id::text;
      if v_after is null then
        v_errors := v_errors || format('variant %s is missing', v_before ->> 'sku');
        continue;
      end if;
      if (v_after - c_fields) is distinct from (v_before - c_fields) then
        v_errors := v_errors || format('variant %s changed outside the edited fields', v_before ->> 'sku');
      end if;
      foreach v_key in array c_fields loop
        if coalesce(v_after -> v_key, 'null'::jsonb) is distinct from coalesce(v_planned -> v_key, 'null'::jsonb) then
          v_errors := v_errors || format('variant %s: %s is not as planned', v_before ->> 'sku', v_key);
        end if;
      end loop;
      if public.current_inventory(v_id) <> coalesce((v_planned_stock ->> v_id::text)::bigint, (v_before_stock ->> v_id::text)::bigint) then
        v_errors := v_errors || format('variant %s: stock is not as planned', v_before ->> 'sku');
      end if;
    end loop;

    select count(*) into v_count from public.product_variants where product_id = v_product_id and not (id = any(v_before_ids));
    if v_count <> jsonb_array_length(v_new_variants) then
      v_errors := v_errors || format('%s new variant(s) found, %s planned', v_count, jsonb_array_length(v_new_variants));
    end if;
    for v_new_row in select value from jsonb_array_elements(v_new_variants) loop
      select to_jsonb(v) into v_after from public.product_variants v where v.id = (v_new_row ->> 'id')::uuid;
      if v_after is null or (v_after ->> 'sku') !~ '^(MB|AC|GD|MC|IP)[0-9]{3}$'
         or public.current_inventory((v_new_row ->> 'id')::uuid) <> (v_new_row ->> 'stock')::bigint then
        v_errors := v_errors || format('new variant %s is not as planned', coalesce(v_new_row ->> 'sku', '?'));
        continue;
      end if;
      foreach v_key in array c_fields loop
        if coalesce(v_after -> v_key, 'null'::jsonb) is distinct from coalesce(v_new_row -> v_key, 'null'::jsonb) then
          v_errors := v_errors || format('new variant %s: %s is not as planned', v_new_row ->> 'sku', v_key);
        end if;
      end loop;
    end loop;

    if cardinality(v_errors) > 0 then
      raise exception using
        message = format('variant_editor_verification_failed: "%s": %s', v_product.title, array_to_string(v_errors, ' | ')),
        detail = 'Nothing was saved for this product.';
    end if;

  exception
    when lock_not_available then
      raise exception using
        message = 'variant_editor_busy: this product is being changed by someone else right now (or an order is being placed); nothing was saved, try again',
        detail = sqlerrm;
    when unique_violation then
      raise exception using
        message = 'variant_editor_variant_exists: a variant with the same details already exists; nothing was saved',
        detail = sqlerrm;
    when check_violation or not_null_violation or foreign_key_violation or invalid_text_representation then
      raise exception using message = 'variant_editor_rejected: ' || sqlerrm, detail = 'Nothing was saved for this product.';
  end;

  return jsonb_build_object(
    'product_id', v_product_id,
    'title', v_product.title,
    'status', 'updated',
    'updated_variants', jsonb_array_length(v_updates),
    'stock_corrections', v_corrections,
    'new_variants', v_new_variants
  );
end;
$$;

revoke all on function public.apply_product_variant_edits(jsonb) from public, anon;
grant execute on function public.apply_product_variant_edits(jsonb) to authenticated;

comment on function public.apply_product_variant_edits(jsonb) is
  'Catalog variant editor for ONE real product, all or nothing, Owner only: changed fields of existing variants (RAM, storage, colour, price, compare-at, PTA, condition, warranty, delivery, visibility), exact stock via one correction row each, new variants with server SKUs. Refused when anything changed since the page loaded, on duplicates, and when a published product would become unpublishable. Never deletes, never writes products, media, specifications or colour-image links; verifies its own writes before returning.';

commit;
