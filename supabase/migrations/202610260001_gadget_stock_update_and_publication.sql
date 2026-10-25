-- Gadgets Stock Update: price + description for ONE existing gadget, and the Gadgets publishing rule.
-- NOT YET APPLIED to any database. Requires 202610220001_publication_used_iphone_no_warranty.sql (current validator).
-- Targeted only: one new function, one replaced function. No table, column, policy, trigger or catalog row is changed.
--
-- 1. public.apply_gadget_stock_product(p_product jsonb) — ONE existing gadget per call, all or nothing:
--   {
--     "product_id": "<uuid>",
--     "expected": { "title": "<as seen at Check Changes>", "content": "<saved description, cleaned>" | null,
--                   "variant": { "id": "<uuid>", "price_minor": 1, "is_active": true } },
--     "steps": { "price": { "from_minor": 1, "to_minor": 2 }, "content": { "to": "<Owner's description>" } }
--   }
--   Owner rules (2026-10-25):
--   * Catalog admins only. Real products in the category with slug "gadgets" only (not its Laptops / Tablets children).
--   * The gadget must have exactly ONE variant, visible, and it must be the expected one.
--   * Refused if the title, description, variant, price or visibility changed since Check Changes.
--   * price: the list price for that one variant. content: the Owner's nonblank description, saved as sent.
--     A blank description is never sent and never written (the saved one is kept).
--   * Never changes stock, visibility, publication status, title, slug, media, specifications or colour-image links.
--     Facts (PTA, condition, warranty, delivery, ...) are never written here.
--   * Every write is read back inside the transaction; any difference rolls the whole gadget back.
--   New gadgets are NOT created here: they go through apply_catalog_bulk_import_v2 ("Create", draft, stock 20); their
--   description is then set by this function (expected content null).
--
-- 2. public.validate_product_for_publication — Owner-approved 2026-10-25: a real product in the category with slug
--    "gadgets" does not need PTA, condition or warranty to be published. Every other check is unchanged for gadgets
--    (real classification, title, active brand if any, active category, active variant, price > 0, delivery scope,
--    primary Cloudinary image). Mobile phones (Android, New / Used iPhone), accessories, laptops, tablets and every
--    other category keep exactly the rules of 202610220001. The publication trigger is not changed.

begin;

-- ---------------------------------------------------------------------------
-- 1. Gadget price + description
-- ---------------------------------------------------------------------------

create or replace function public.apply_gadget_stock_product(p_product jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
set lock_timeout = '2s'
as $$
declare
  c_description_max constant integer := 10000;
  v_errors text[] := array[]::text[];
  v_product_id uuid;
  v_variant_id uuid;
  v_product record;
  v_variant record;
  v_steps jsonb;
  v_expected jsonb;
  v_text text;
  v_current_content text;
  v_new_price bigint;
  v_new_content text;
  v_count integer;
  v_before_product jsonb;
  v_before_media jsonb;
  v_before_specs jsonb;
  v_before_links jsonb;
  v_before_variant jsonb;
  v_before_stock bigint;
  v_after jsonb;
begin
  if not public.is_catalog_admin() then
    raise exception 'gadget_stock_product_admin_required';
  end if;

  -- -------------------------------------------------------------------------
  -- 1. Payload shape
  -- -------------------------------------------------------------------------
  if jsonb_typeof(p_product) is distinct from 'object'
     or jsonb_typeof(p_product -> 'steps') is distinct from 'object'
     or jsonb_typeof(p_product -> 'expected') is distinct from 'object'
     or jsonb_typeof(p_product -> 'expected' -> 'variant') is distinct from 'object' then
    raise exception 'gadget_stock_product_invalid_payload';
  end if;
  v_steps := p_product -> 'steps';
  v_expected := p_product -> 'expected';
  if exists (select 1 from jsonb_object_keys(v_steps) k where k not in ('price', 'content')) then
    raise exception 'gadget_stock_product_invalid_payload: steps may only be price and content';
  end if;
  if not (v_steps ? 'price' or v_steps ? 'content') then
    raise exception 'gadget_stock_product_invalid_payload: nothing to change';
  end if;
  begin
    v_product_id := (p_product ->> 'product_id')::uuid;
    v_variant_id := (v_expected -> 'variant' ->> 'id')::uuid;
  exception when invalid_text_representation then
    raise exception 'gadget_stock_product_invalid_payload: product_id and expected variant id must be uuids';
  end;
  if v_product_id is null or v_variant_id is null then
    raise exception 'gadget_stock_product_invalid_payload: product_id and expected variant id are required';
  end if;

  begin
    -- -----------------------------------------------------------------------
    -- 2. Lock the product, then its variants (id order)
    -- -----------------------------------------------------------------------
    select p.id, p.title, p.content, p.data_class::text as data_class, c.slug as category_slug
      into v_product
    from public.products p
    join public.categories c on c.id = p.category_id
    where p.id = v_product_id
    for update of p;
    if not found then
      raise exception 'gadget_stock_product_not_found: %', v_product_id;
    end if;
    if v_product.data_class is distinct from 'real' or v_product.category_slug is distinct from 'gadgets' then
      raise exception 'gadget_stock_product_not_gadget: "%" is not a real product in Gadgets; this update never touches it', v_product.title;
    end if;

    perform 1 from public.product_variants where product_id = v_product_id order by id for update;

    select count(*) into v_count from public.product_variants where product_id = v_product_id;
    if v_count <> 1 then
      raise exception 'gadget_stock_product_not_single_variant: "%" has % variants; only gadgets with exactly one variant are updated here', v_product.title, v_count;
    end if;
    select id, sku, is_active, price_minor, compare_at_price_minor into v_variant
    from public.product_variants where product_id = v_product_id;

    -- -----------------------------------------------------------------------
    -- 3. Changed since Check Changes?
    -- -----------------------------------------------------------------------
    -- The client compares the description with its line endings made plain and outer white space removed.
    v_current_content := nullif(regexp_replace(regexp_replace(coalesce(v_product.content, ''), E'\r\n?', E'\n', 'g'), '^\s+|\s+$', '', 'g'), '');
    if v_variant.id <> v_variant_id
       or (v_expected ->> 'title') is distinct from v_product.title
       or not (v_expected ? 'content')
       or jsonb_typeof(v_expected -> 'content') not in ('string', 'null')
       or (v_expected ->> 'content') is distinct from v_current_content
       or (v_expected -> 'variant' ->> 'price_minor') is null
       or (v_expected -> 'variant' ->> 'price_minor') !~ '^[0-9]{1,15}$'
       or (v_expected -> 'variant' ->> 'price_minor')::bigint <> v_variant.price_minor
       or jsonb_typeof(v_expected -> 'variant' -> 'is_active') is distinct from 'boolean'
       or (v_expected -> 'variant' ->> 'is_active')::boolean is distinct from v_variant.is_active then
      raise exception 'gadget_stock_product_changed_since_check: "%" changed since Check Changes; run Check Changes again', v_product.title;
    end if;
    if not v_variant.is_active then
      raise exception 'gadget_stock_product_hidden: the variant of "%" is hidden; show it in Catalog first', v_product.title;
    end if;

    -- -----------------------------------------------------------------------
    -- 4. Validate the steps (no writes yet)
    -- -----------------------------------------------------------------------
    if v_steps ? 'price' then
      v_text := v_steps -> 'price' ->> 'to_minor';
      if jsonb_typeof(v_steps -> 'price') is distinct from 'object' or v_text is null or v_text !~ '^[0-9]{1,15}$' or v_text::bigint <= 0 then
        v_errors := v_errors || 'New price must be a positive amount'::text;
      else
        v_new_price := v_text::bigint;
        v_text := v_steps -> 'price' ->> 'from_minor';
        if v_text is null or v_text !~ '^[0-9]{1,15}$' or v_text::bigint <> v_variant.price_minor then
          v_errors := v_errors || 'Price changed since Check Changes'::text;
        elsif v_new_price = v_variant.price_minor then
          v_errors := v_errors || 'The new price equals the current price'::text;
        elsif v_variant.compare_at_price_minor is not null and v_new_price >= v_variant.compare_at_price_minor then
          v_errors := v_errors || 'New price is not below the compare-at price'::text;
        end if;
      end if;
    end if;

    if v_steps ? 'content' then
      if jsonb_typeof(v_steps -> 'content') is distinct from 'object' or jsonb_typeof(v_steps -> 'content' -> 'to') is distinct from 'string' then
        v_errors := v_errors || 'Description must be text'::text;
      else
        v_new_content := v_steps -> 'content' ->> 'to';
        if v_new_content !~ '\S' then
          v_errors := v_errors || 'A blank description is never written (the saved one is kept)'::text;
        elsif char_length(v_new_content) > c_description_max then
          v_errors := v_errors || format('Description is longer than %s characters', c_description_max);
        elsif v_new_content is not distinct from v_current_content then
          v_errors := v_errors || 'The new description equals the saved one'::text;
        end if;
      end if;
    end if;

    if cardinality(v_errors) > 0 then
      raise exception using
        message = format('gadget_stock_product_rejected: "%s": %s', v_product.title, array_to_string(v_errors, ' | ')),
        detail = 'Nothing was saved for this gadget.';
    end if;

    -- -----------------------------------------------------------------------
    -- 5. "Before" copy (for the read-back below)
    -- -----------------------------------------------------------------------
    select to_jsonb(p) - 'content' - 'updated_at' into v_before_product from public.products p where p.id = v_product_id;
    select coalesce(jsonb_agg(to_jsonb(m) order by m.id), '[]'::jsonb) into v_before_media from public.product_media m where m.product_id = v_product_id;
    select coalesce(jsonb_agg(to_jsonb(s) order by s.id), '[]'::jsonb) into v_before_specs from public.product_specifications s where s.product_id = v_product_id;
    select coalesce(jsonb_agg(to_jsonb(a) order by a.media_id, a.variant_id), '[]'::jsonb) into v_before_links
    from public.product_media_variant_assignments a join public.product_media m on m.id = a.media_id where m.product_id = v_product_id;
    select to_jsonb(v) - 'updated_at' into v_before_variant from public.product_variants v where v.id = v_variant_id;
    v_before_stock := public.current_inventory(v_variant_id);

    -- -----------------------------------------------------------------------
    -- 6. Write
    -- -----------------------------------------------------------------------
    if v_new_price is not null then
      update public.product_variants set price_minor = v_new_price where id = v_variant_id and product_id = v_product_id;
    end if;
    if v_new_content is not null then
      update public.products set content = v_new_content, updated_by = auth.uid() where id = v_product_id;
      v_before_product := v_before_product || jsonb_build_object('updated_by', auth.uid());
    end if;

    -- -----------------------------------------------------------------------
    -- 7. Read-back: anything not exactly as planned rolls this gadget back
    -- -----------------------------------------------------------------------
    v_errors := array[]::text[];
    select to_jsonb(p) - 'content' - 'updated_at' into v_after from public.products p where p.id = v_product_id;
    if v_after is distinct from v_before_product then v_errors := v_errors || 'the product row changed outside the description'::text; end if;
    if (select content from public.products where id = v_product_id) is distinct from coalesce(v_new_content, v_product.content) then
      v_errors := v_errors || 'description is not as planned'::text;
    end if;
    select coalesce(jsonb_agg(to_jsonb(m) order by m.id), '[]'::jsonb) into v_after from public.product_media m where m.product_id = v_product_id;
    if v_after is distinct from v_before_media then v_errors := v_errors || 'images changed'::text; end if;
    select coalesce(jsonb_agg(to_jsonb(s) order by s.id), '[]'::jsonb) into v_after from public.product_specifications s where s.product_id = v_product_id;
    if v_after is distinct from v_before_specs then v_errors := v_errors || 'specifications changed'::text; end if;
    select coalesce(jsonb_agg(to_jsonb(a) order by a.media_id, a.variant_id), '[]'::jsonb) into v_after
    from public.product_media_variant_assignments a join public.product_media m on m.id = a.media_id where m.product_id = v_product_id;
    if v_after is distinct from v_before_links then v_errors := v_errors || 'colour-image links changed'::text; end if;
    select count(*) into v_count from public.product_variants where product_id = v_product_id;
    if v_count <> 1 then v_errors := v_errors || 'the variant count changed'::text; end if;
    select to_jsonb(v) - 'updated_at' into v_after from public.product_variants v where v.id = v_variant_id;
    if (v_after - 'price_minor') is distinct from (v_before_variant - 'price_minor') then
      v_errors := v_errors || format('variant %s changed outside the price', v_variant.sku);
    end if;
    if (v_after ->> 'price_minor')::bigint is distinct from coalesce(v_new_price, v_variant.price_minor) then
      v_errors := v_errors || format('variant %s price is not as planned', v_variant.sku);
    end if;
    if public.current_inventory(v_variant_id) is distinct from v_before_stock then
      v_errors := v_errors || format('variant %s stock changed', v_variant.sku);
    end if;

    if cardinality(v_errors) > 0 then
      raise exception using
        message = format('gadget_stock_product_verification_failed: "%s": %s', v_product.title, array_to_string(v_errors, ' | ')),
        detail = 'Nothing was saved for this gadget.';
    end if;

  exception
    when lock_not_available then
      raise exception using
        message = 'gadget_stock_product_busy: this gadget is being changed by someone else right now; nothing was saved, try again',
        detail = sqlerrm;
    when check_violation or not_null_violation or foreign_key_violation then
      raise exception using message = 'gadget_stock_product_rejected: ' || sqlerrm, detail = 'Nothing was saved for this gadget.';
  end;

  return jsonb_build_object(
    'product_id', v_product_id,
    'title', v_product.title,
    'status', 'updated',
    'price_updated', v_new_price is not null,
    'description_updated', v_new_content is not null
  );
end;
$$;

revoke all on function public.apply_gadget_stock_product(jsonb) from public, anon;
grant execute on function public.apply_gadget_stock_product(jsonb) to authenticated;

comment on function public.apply_gadget_stock_product(jsonb) is
  'Gadgets Stock Update for ONE existing real gadget (category gadgets, exactly one visible variant), all or nothing: the list price and/or the Owner''s nonblank description (products.content). Refused if anything changed since Check Changes. Never changes stock, visibility, publication status, title, media, specifications or product facts; verifies its own writes before returning.';

-- ---------------------------------------------------------------------------
-- 2. Publishing rule: gadgets need no PTA, condition or warranty
-- ---------------------------------------------------------------------------

create or replace function public.validate_product_for_publication(p_product_id uuid)
returns table (is_valid boolean, errors text[])
language plpgsql stable set search_path = '' as $$
declare v_errors text[] := array[]::text[]; v_product public.products%rowtype; v_used_iphone boolean; v_gadget boolean;
begin
  select * into v_product from public.products where id = p_product_id;
  if not found then return query select false, array['product_not_found']; return; end if;
  if v_product.data_class <> 'real' then v_errors := array_append(v_errors, 'real_catalog_classification_required'); end if;
  if nullif(trim(v_product.title), '') is null then v_errors := array_append(v_errors, 'title_required'); end if;
  if v_product.brand_id is not null and not exists (select 1 from public.brands where id = v_product.brand_id and is_active and data_class = 'real') then v_errors := array_append(v_errors, 'active_real_brand_required'); end if;
  if not exists (select 1 from public.categories where id = v_product.category_id and is_active and data_class = 'real') then v_errors := array_append(v_errors, 'active_real_category_required'); end if;
  if not exists (select 1 from public.product_variants where product_id = p_product_id and is_active) then v_errors := array_append(v_errors, 'active_variant_required'); end if;
  -- Used iPhone (warranty not required): Apple + mobile-phones + "(Used)" title + every variant Used.
  v_used_iphone := v_product.data_class = 'real'
    and v_product.title ~* '\s\(used\)\s*$'
    and exists (select 1 from public.brands where id = v_product.brand_id and data_class = 'real' and lower(btrim(name)) = 'apple')
    and exists (select 1 from public.categories where id = v_product.category_id and slug = 'mobile-phones')
    and exists (select 1 from public.product_variants where product_id = p_product_id)
    and not exists (select 1 from public.product_variants where product_id = p_product_id and condition <> 'used');
  -- Gadget (PTA, condition and warranty not required): a real product in the category with slug "gadgets" itself.
  v_gadget := v_product.data_class = 'real'
    and exists (select 1 from public.categories where id = v_product.category_id and slug = 'gadgets');
  if exists (select 1 from public.product_variants where product_id = p_product_id and is_active and (price_minor <= 0 or delivery_scope is null or (not v_gadget and (pta_status = 'unknown' or condition = 'unknown' or (not v_used_iphone and nullif(trim(coalesce(warranty_override, v_product.default_warranty)), '') is null))))) then v_errors := array_append(v_errors, 'variant_commercial_facts_unresolved'); end if;
  if not exists (select 1 from public.product_media where product_id = p_product_id and is_primary and cloudinary_public_id is not null and secure_url is not null and width > 0 and height > 0 and bytes > 0) then v_errors := array_append(v_errors, 'primary_product_media_required'); end if;
  return query select cardinality(v_errors) = 0, v_errors;
end;
$$;

commit;
