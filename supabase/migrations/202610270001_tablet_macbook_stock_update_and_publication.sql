-- Tablets & MacBooks Stock Update (New + Used): one existing tablet / MacBook product per call, all or nothing,
-- and the Tablets & MacBooks publishing rule.
-- NOT YET APPLIED to any database. Additive only: one new function and one replaced validator; no table, column,
-- category, policy or trigger change.
--
-- 1. public.apply_tablet_stock_product(p_product jsonb) applies every planned change of ONE existing product:
--   {
--     "product_id": "<uuid>",
--     "condition": "used" | "brand_new",
--     "expected": { "variants": [ { "id": "<uuid>", "price_minor": 1, "is_active": true }, ... ] },
--     "steps": [
--       { "kind": "price",       "variant_id": "<uuid>", "from_minor": 1, "to_minor": 2 },
--       { "kind": "show",        "variant_id": "<uuid>", "from_minor": 1, "to_minor": 2 },
--       { "kind": "add_variant", "ram": "16 GB" | null, "storage": "512 GB", "color": "Midnight" | null,
--         "price_minor": 1, "stock": 20, "pta_status": "not_applicable", "condition": "brand_new" }
--     ]
--   }
--
--   Owner rules (2026-10-26):
--   * Only real products in the category "tablets" (iPads and other tablets, any brand) or in "laptops" with the brand
--     Apple (MacBooks). Windows laptops are never touched. The product must follow the title rule for "condition"
--     (Used titles end with " (Used)") and EVERY variant it has must be of that condition.
--   * price: an existing visible variant gets the list price. Stock is never touched.
--   * show: a hidden listed variant is shown again with the list price. Stock is never touched (no reset).
--   * add_variant: RAM (optional), storage, colour (optional), price, PTA and condition from the list; opening stock
--     exactly 20 (one 'initial' ledger row); delivery Karachi only. Warranty, grade, battery health, cycle count and
--     SIM stay NULL. PTA: approved / not_approved / not_applicable for tablets; not_applicable only for MacBooks.
--     Refused if a variant with the same RAM / storage / colour / PTA / condition exists.
--   * There is no hide, no delete, no stock change for existing variants, and no write to products, media,
--     specifications or colour-image links. Variants not in the steps are not touched.
--   * The product is refused if its variants, prices or visibility changed since Check Changes.
--   * Every write is read back inside the transaction; any difference rolls the whole product back.
--   New products are NOT created here: they go through apply_catalog_bulk_import_v2 (action "Create", draft, stock 20).
--
-- 2. public.validate_product_for_publication — Owner-approved 2026-10-26:
--   * Tablets & MacBooks (a real product in "tablets", or in "laptops" with the brand Apple): warranty is optional for
--     New and Used. PTA and condition must still be set (PTA "not_applicable" is a set value), and every other check
--     (classification, title, active brand and category, active variant, price, delivery scope, primary image) stays.
--   * "laptops" is for Apple MacBooks only: a non-Apple product in "laptops" cannot be published
--     (laptops_apple_brand_required).
--   * Every other category keeps exactly the rules of 202610260001 (Used iPhone and Gadgets included). The publication
--     trigger is not changed.

begin;

-- ---------------------------------------------------------------------------
-- 1. apply_tablet_stock_product
-- ---------------------------------------------------------------------------

create or replace function public.apply_tablet_stock_product(p_product jsonb)
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
  v_sku_pattern text;
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
  v_ram text;
  v_storage text;
  v_color text;
  v_pta text;
  v_label text;
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
    raise exception 'tablet_stock_product_admin_required';
  end if;

  -- -------------------------------------------------------------------------
  -- 1. Payload shape
  -- -------------------------------------------------------------------------
  if jsonb_typeof(p_product) is distinct from 'object'
     or jsonb_typeof(p_product -> 'steps') is distinct from 'array'
     or jsonb_array_length(p_product -> 'steps') = 0
     or jsonb_typeof(p_product -> 'expected' -> 'variants') is distinct from 'array' then
    raise exception 'tablet_stock_product_invalid_payload';
  end if;
  if jsonb_array_length(p_product -> 'steps') > 300 then
    raise exception 'tablet_stock_product_invalid_payload: at most 300 steps per product';
  end if;
  v_condition := p_product ->> 'condition';
  if v_condition is null or v_condition not in ('brand_new', 'used') then
    raise exception 'tablet_stock_product_invalid_payload: condition must be brand_new or used';
  end if;
  begin
    v_product_id := (p_product ->> 'product_id')::uuid;
  exception when invalid_text_representation then
    raise exception 'tablet_stock_product_invalid_payload: product_id is not a uuid';
  end;
  if v_product_id is null then
    raise exception 'tablet_stock_product_invalid_payload: product_id is required';
  end if;
  v_steps := p_product -> 'steps';
  v_expected := p_product -> 'expected' -> 'variants';

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
      raise exception 'tablet_stock_product_not_found: %', v_product_id;
    end if;
    if v_product.data_class is distinct from 'real'
       or v_product.category_slug is null
       or v_product.category_slug not in ('tablets', 'laptops')
       or (v_product.category_slug = 'laptops' and lower(btrim(coalesce(v_product.brand_name, ''))) <> 'apple') then
      raise exception 'tablet_stock_product_out_of_scope: "%" is not a tablet or an Apple MacBook; this update never touches it', v_product.title;
    end if;
    v_sku_pattern := case v_product.category_slug when 'laptops' then '^MC[0-9]{3}$' else '^IP[0-9]{3}$' end;
    if (v_product.title ~* '\s\(used\)\s*$') is distinct from (v_condition = 'used') then
      raise exception 'tablet_stock_product_wrong_listing: "%" is not the % listing; this update never touches it',
        v_product.title, case when v_condition = 'used' then 'Used' else 'New' end;
    end if;

    perform 1 from public.product_variants where product_id = v_product_id order by id for update;

    if not exists (select 1 from public.product_variants where product_id = v_product_id) then
      raise exception 'tablet_stock_product_wrong_listing: "%" has no variants, so New / Used cannot be confirmed', v_product.title;
    end if;
    if exists (select 1 from public.product_variants where product_id = v_product_id and condition::text <> v_condition) then
      raise exception 'tablet_stock_product_wrong_listing: "%" has variants that are not %; this update never touches it',
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
      raise exception 'tablet_stock_product_invalid_payload: expected variant id is not a uuid';
    end;
    if cardinality(v_ids) <> jsonb_array_length(v_expected)
       or not (v_ids @> v_before_ids and v_before_ids @> v_ids) then
      raise exception 'tablet_stock_product_changed_since_check: "%" has a different set of variants now; run Check Changes again', v_product.title;
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
      raise exception 'tablet_stock_product_changed_since_check: a price or visibility of "%" changed since Check Changes; run Check Changes again', v_product.title;
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
          v_errors := v_errors || format('%s step: variant %s does not belong to this product', v_kind, coalesce(v_id::text, 'NULL'));
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
        v_ram := nullif(btrim(v_step ->> 'ram'), '');
        v_storage := nullif(btrim(v_step ->> 'storage'), '');
        v_color := nullif(btrim(v_step ->> 'color'), '');
        v_pta := v_step ->> 'pta_status';
        v_label := concat_ws(' / ', v_ram, v_storage, v_color);
        if v_storage is null then
          v_errors := v_errors || 'A new variant needs a storage'::text;
          continue;
        end if;
        if v_pta is null or v_pta not in ('approved', 'not_approved', 'not_applicable') then
          v_errors := v_errors || format('New variant %s: PTA must be given', v_label);
          continue;
        end if;
        if v_product.category_slug = 'laptops' and v_pta <> 'not_applicable' then
          v_errors := v_errors || format('New variant %s: a MacBook''s PTA is Not Applicable', v_label);
          continue;
        end if;
        if (v_step ->> 'condition') is distinct from v_condition then
          v_errors := v_errors || format('New variant %s: condition must be %s', v_label, v_condition);
          continue;
        end if;
        v_text := v_step ->> 'price_minor';
        if v_text is null or v_text !~ '^[0-9]{1,15}$' or v_text::bigint <= 0 then
          v_errors := v_errors || format('New variant %s: price must be a positive amount', v_label);
          continue;
        end if;
        v_text := v_step ->> 'stock';
        if v_text is null or v_text !~ '^[0-9]{1,7}$' or v_text::integer <> c_stock then
          v_errors := v_errors || format('New variant %s: opening stock must be %s', v_label, c_stock);
          continue;
        end if;
        v_text := lower(coalesce(v_ram, '')) || '|' || lower(v_storage) || '|' || lower(coalesce(v_color, '')) || '|' || v_pta;
        if v_text = any(v_new_configs) then
          v_errors := v_errors || format('New variant %s is listed twice', v_label);
          continue;
        end if;
        v_new_configs := v_new_configs || v_text;
        if exists (
          select 1 from public.product_variants
          where product_id = v_product_id
            and lower(btrim(coalesce(ram_display, ''))) = lower(coalesce(v_ram, ''))
            and lower(btrim(coalesce(storage_display, ''))) = lower(v_storage)
            and lower(btrim(coalesce(color_finish, ''))) = lower(coalesce(v_color, ''))
            and pta_status::text = v_pta
            and condition::text = v_condition
        ) then
          v_errors := v_errors || format('New variant %s already exists on this product', v_label);
          continue;
        end if;
      else
        v_errors := v_errors || format('Unknown step kind "%s"', coalesce(v_kind, ''));
      end if;
    end loop;

    if cardinality(v_errors) > 0 then
      raise exception using
        message = format('tablet_stock_product_rejected: "%s": %s%s', v_product.title,
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
      v_ram := nullif(btrim(v_step ->> 'ram'), '');
      v_color := nullif(btrim(v_step ->> 'color'), '');
      insert into public.product_variants (
        product_id, sku, ram_display, storage_display, color_finish, price_minor,
        pta_status, condition, sim_configuration, warranty_override, delivery_scope, is_active
      ) values (
        v_product_id, '', v_ram, btrim(v_step ->> 'storage'), v_color,
        (v_step ->> 'price_minor')::bigint,
        (v_step ->> 'pta_status')::public.pta_status, v_condition::public.product_condition,
        null, null, 'karachi_only'::public.delivery_scope, true
      ) returning id, sku into v_new_variant_id, v_new_sku;
      insert into public.inventory_movements (variant_id, quantity_delta, reason, reference, note, actor_id)
      values (v_new_variant_id, c_stock, 'initial', 'tablet_stock_update', 'Tablets & MacBooks Stock Update opening stock', auth.uid());
      v_new_variants := v_new_variants || jsonb_build_object(
        'id', v_new_variant_id, 'sku', v_new_sku,
        'ram', v_ram, 'storage', btrim(v_step ->> 'storage'), 'color', v_color,
        'price_minor', (v_step ->> 'price_minor')::bigint, 'pta_status', v_step ->> 'pta_status');
    end loop;

    -- -----------------------------------------------------------------------
    -- 7. Read-back: anything not exactly as planned rolls this product back
    -- -----------------------------------------------------------------------
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
         or v_variant.sku !~ v_sku_pattern
         or v_variant.is_active is not true
         or v_variant.price_minor <> (v_step ->> 'price_minor')::bigint
         or v_variant.pta_status::text is distinct from (v_step ->> 'pta_status')
         or v_variant.condition::text is distinct from v_condition
         or v_variant.ram_display is distinct from (v_step ->> 'ram')
         or v_variant.storage_display is distinct from (v_step ->> 'storage')
         or v_variant.color_finish is distinct from (v_step ->> 'color')
         or v_variant.condition_grade is not null
         or v_variant.battery_health_percent is not null
         or v_variant.battery_cycle_count is not null
         or v_variant.sim_configuration is not null
         or v_variant.warranty_override is not null
         or v_variant.delivery_scope::text is distinct from 'karachi_only'
         or v_variant.compare_at_price_minor is not null
         or public.current_inventory(v_variant.id) <> c_stock then
        v_errors := v_errors || format('new variant %s is not as planned', coalesce(v_step ->> 'sku', '?'));
      end if;
    end loop;

    if cardinality(v_errors) > 0 then
      raise exception using
        message = format('tablet_stock_product_verification_failed: "%s": %s', v_product.title, array_to_string(v_errors, ' | ')),
        detail = 'Nothing was saved for this product.';
    end if;

  exception
    when lock_not_available then
      raise exception using
        message = 'tablet_stock_product_busy: this product is being changed by someone else right now; nothing was saved, try again',
        detail = sqlerrm;
    when unique_violation then
      raise exception using
        message = 'tablet_stock_product_variant_exists: a variant with the same details already exists; nothing was saved',
        detail = sqlerrm;
    when check_violation or not_null_violation or foreign_key_violation then
      raise exception using message = 'tablet_stock_product_rejected: ' || sqlerrm, detail = 'Nothing was saved for this product.';
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

revoke all on function public.apply_tablet_stock_product(jsonb) from public, anon;
grant execute on function public.apply_tablet_stock_product(jsonb) to authenticated;

comment on function public.apply_tablet_stock_product(jsonb) is
  'Tablets & MacBooks Stock Update for ONE existing product (category tablets, or laptops with the brand Apple; New or Used listing), all or nothing: price only for listed variants, hidden listed variants shown again with the list price, new variants with list facts, opening stock 20 and Karachi-only delivery (server SKUs). Never hides, deletes or changes stock of existing variants; never writes products, media, specifications or colour-image links; verifies its own writes before returning.';

-- ---------------------------------------------------------------------------
-- 2. Publishing rule: Tablets & MacBooks need no warranty; laptops are Apple only
-- ---------------------------------------------------------------------------

create or replace function public.validate_product_for_publication(p_product_id uuid)
returns table (is_valid boolean, errors text[])
language plpgsql stable set search_path = '' as $$
declare v_errors text[] := array[]::text[]; v_product public.products%rowtype; v_used_iphone boolean; v_gadget boolean; v_apple boolean; v_category_slug text; v_tablet_macbook boolean;
begin
  select * into v_product from public.products where id = p_product_id;
  if not found then return query select false, array['product_not_found']; return; end if;
  if v_product.data_class <> 'real' then v_errors := array_append(v_errors, 'real_catalog_classification_required'); end if;
  if nullif(trim(v_product.title), '') is null then v_errors := array_append(v_errors, 'title_required'); end if;
  if v_product.brand_id is not null and not exists (select 1 from public.brands where id = v_product.brand_id and is_active and data_class = 'real') then v_errors := array_append(v_errors, 'active_real_brand_required'); end if;
  if not exists (select 1 from public.categories where id = v_product.category_id and is_active and data_class = 'real') then v_errors := array_append(v_errors, 'active_real_category_required'); end if;
  if not exists (select 1 from public.product_variants where product_id = p_product_id and is_active) then v_errors := array_append(v_errors, 'active_variant_required'); end if;
  select slug into v_category_slug from public.categories where id = v_product.category_id;
  v_apple := exists (select 1 from public.brands where id = v_product.brand_id and data_class = 'real' and lower(btrim(name)) = 'apple');
  -- Used iPhone (warranty not required): Apple + mobile-phones + "(Used)" title + every variant Used.
  v_used_iphone := v_product.data_class = 'real'
    and v_product.title ~* '\s\(used\)\s*$'
    and v_apple
    and v_category_slug = 'mobile-phones'
    and exists (select 1 from public.product_variants where product_id = p_product_id)
    and not exists (select 1 from public.product_variants where product_id = p_product_id and condition <> 'used');
  -- Gadget (PTA, condition and warranty not required): a real product in the category with slug "gadgets" itself.
  v_gadget := v_product.data_class = 'real' and v_category_slug = 'gadgets';
  -- Tablets & MacBooks (warranty not required, New and Used): a real product in "tablets", or in "laptops" with brand Apple.
  v_tablet_macbook := v_product.data_class = 'real' and (v_category_slug = 'tablets' or (v_category_slug = 'laptops' and v_apple));
  -- "laptops" is for Apple MacBooks only (Windows laptops are not sold).
  if v_category_slug = 'laptops' and not v_apple then v_errors := array_append(v_errors, 'laptops_apple_brand_required'); end if;
  if exists (select 1 from public.product_variants where product_id = p_product_id and is_active and (price_minor <= 0 or delivery_scope is null or (not v_gadget and (pta_status = 'unknown' or condition = 'unknown' or (not v_used_iphone and not v_tablet_macbook and nullif(trim(coalesce(warranty_override, v_product.default_warranty)), '') is null))))) then v_errors := array_append(v_errors, 'variant_commercial_facts_unresolved'); end if;
  if not exists (select 1 from public.product_media where product_id = p_product_id and is_primary and cloudinary_public_id is not null and secure_url is not null and width > 0 and height > 0 and bytes > 0) then v_errors := array_append(v_errors, 'primary_product_media_required'); end if;
  return query select cardinality(v_errors) = 0, v_errors;
end;
$$;

commit;
