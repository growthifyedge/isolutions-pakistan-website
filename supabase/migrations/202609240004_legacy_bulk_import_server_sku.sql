-- Legacy bulk import on the server-assigned SKU system (Owner approved, 2026-09-24).
-- NOT YET APPLIED.
--
-- Apply order: 202609240001 -> 202609240002 -> 202609240003 -> this file.
--
-- After 202609240003 the database assigns every new variant SKU (MB001, AC001, ...) and an
-- existing SKU can never change. This replaces the apply_catalog_bulk_import wrapper so that:
--   * new variants are sent with a blank SKU; a supplied SKU for a new variant is rejected;
--   * the old long-SKU checks (SKU must agree with RAM/Storage/Color) are removed;
--   * existing variants keep their SKU: the post-write sync updates RAM/Storage/Color only.
-- The inner writer apply_catalog_bulk_import_phase4_legacy is unchanged: it inserts the blank
-- SKU and the 202609240003 trigger replaces it with the next sequential SKU. The old long-SKU
-- builder catalog_variant_sku() is dropped so only one SKU system remains.

begin;

do $$
begin
  if not exists (
    select 1 from pg_trigger
    where tgrelid = 'public.product_variants'::regclass
      and tgname = 'product_variants_assign_catalog_sku'
      and not tgisinternal
  ) then
    raise exception 'legacy_import_sku_precondition_failed: apply 202609240003_catalog_sku_sequences.sql first';
  end if;
end
$$;

create or replace function public.apply_catalog_bulk_import(p_batch jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_product jsonb;
  v_variant jsonb;
  v_product_id uuid;
  v_variant_id uuid;
  v_source text;
  v_result jsonb;
begin
  if not public.is_catalog_admin() then raise exception 'catalog_admin_required'; end if;
  if jsonb_typeof(p_batch) <> 'object' or jsonb_typeof(p_batch -> 'products') <> 'array' then
    raise exception 'invalid_bulk_import_payload';
  end if;

  for v_product in select value from jsonb_array_elements(p_batch -> 'products') loop
    if jsonb_typeof(v_product -> 'variants') <> 'array' then
      raise exception 'variants_array_required: %', v_product ->> 'title';
    end if;
    for v_variant in select value from jsonb_array_elements(v_product -> 'variants') loop
      if v_variant ->> 'action' = 'UNCHANGED' then continue; end if;
      v_source := coalesce(nullif(btrim(v_variant ->> 'source'), ''), v_product ->> 'title', 'variant row');
      -- New variants get a database-assigned SKU; existing variants keep theirs.
      if nullif(v_variant ->> 'id', '') is null and nullif(btrim(v_variant ->> 'sku'), '') is not null then
        raise exception '%: SKU is assigned automatically; leave it blank for a new variant', v_source;
      end if;
      if nullif(v_variant ->> 'price_minor', '') is null or (v_variant ->> 'price_minor')::bigint <= 0 then raise exception '%: Missing Price', v_source; end if;
      if coalesce(v_variant ->> 'pta_status', 'unknown') = 'unknown' then raise exception '%: Missing PTA Status', v_source; end if;
      if coalesce(v_variant ->> 'condition', 'unknown') = 'unknown' then raise exception '%: Missing Condition', v_source; end if;
      if nullif(btrim(v_variant ->> 'warranty_override'), '') is null then raise exception '%: Missing Warranty', v_source; end if;
      if nullif(v_variant ->> 'delivery_scope', '') is null then raise exception '%: Missing Delivery', v_source; end if;
      if nullif(v_variant ->> 'id', '') is null and nullif(v_variant ->> 'inventory', '') is null then raise exception '%: Missing Inventory', v_source; end if;
      if nullif(v_variant ->> 'inventory', '') is not null and
         ((v_variant ->> 'inventory')::numeric < 0 or (v_variant ->> 'inventory')::numeric <> trunc((v_variant ->> 'inventory')::numeric)) then
        raise exception '%: Inventory must be a non-negative whole number', v_source;
      end if;
      if nullif(v_variant ->> 'compare_at_price_minor', '') is not null and
         (v_variant ->> 'compare_at_price_minor')::bigint <= (v_variant ->> 'price_minor')::bigint then
        raise exception '%: Compare-at price must exceed Price', v_source;
      end if;
    end loop;
  end loop;

  v_result := public.apply_catalog_bulk_import_phase4_legacy(p_batch);

  -- The inner writer preserves identity columns when it updates an existing variant.
  -- Synchronize RAM/Storage/Color for variants the client matched by id. The SKU is never
  -- touched (it is immutable); newly created variants already carry the payload identity.
  for v_product in select value from jsonb_array_elements(p_batch -> 'products') loop
    v_product_id := nullif(v_product ->> 'id', '')::uuid;
    if v_product_id is null then
      select id into v_product_id from public.products where slug = v_product ->> 'slug';
    end if;
    for v_variant in select value from jsonb_array_elements(v_product -> 'variants') loop
      if v_variant ->> 'action' = 'UNCHANGED' then continue; end if;
      v_variant_id := nullif(v_variant ->> 'id', '')::uuid;
      if v_variant_id is null then continue; end if;
      update public.product_variants
      set ram_display = nullif(btrim(v_variant ->> 'ram_display'), ''),
          storage_display = nullif(btrim(v_variant ->> 'storage_display'), ''),
          color_finish = nullif(btrim(v_variant ->> 'color_finish'), '')
      where id = v_variant_id and product_id = v_product_id;
      if not found then raise exception 'variant_identity_sync_failed: %', coalesce(v_variant ->> 'source', v_variant ->> 'id'); end if;
    end loop;
  end loop;
  return v_result;
end;
$$;

revoke all on function public.apply_catalog_bulk_import(jsonb) from public, anon;
grant execute on function public.apply_catalog_bulk_import(jsonb) to authenticated;
comment on function public.apply_catalog_bulk_import(jsonb) is
  'Atomic Owner/Admin-only structured bulk import with pre-write commercial validation. New variants receive database-assigned sequential SKUs; existing SKUs are never changed.';

drop function if exists public.catalog_variant_sku(text, text, text, text);

commit;
