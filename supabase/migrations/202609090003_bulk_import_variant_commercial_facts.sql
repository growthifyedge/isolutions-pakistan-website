begin;

alter function public.apply_catalog_bulk_import(jsonb)
  rename to apply_catalog_bulk_import_phase4_legacy;

revoke all on function public.apply_catalog_bulk_import_phase4_legacy(jsonb) from public, anon, authenticated;

create or replace function public.catalog_variant_sku(
  p_product_slug text,
  p_ram text,
  p_storage text,
  p_color text
)
returns text
language sql
immutable
strict
set search_path = ''
as $$
  select upper(trim(both '-' from regexp_replace(
    concat_ws('-', p_product_slug, nullif(p_ram, ''), nullif(p_storage, ''), nullif(p_color, '')),
    '[^a-zA-Z0-9]+', '-', 'g'
  )));
$$;

revoke all on function public.catalog_variant_sku(text,text,text,text) from public, anon, authenticated;

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
  v_expected_sku text;
  v_source text;
  v_result jsonb;
begin
  if not public.is_catalog_admin() then
    raise exception 'catalog_admin_required';
  end if;
  if jsonb_typeof(p_batch) <> 'object' or jsonb_typeof(p_batch -> 'products') <> 'array' then
    raise exception 'invalid_bulk_import_payload';
  end if;

  -- Reject unresolved or internally inconsistent variant rows before the
  -- legacy atomic writer can make any database changes.
  for v_product in select value from jsonb_array_elements(p_batch -> 'products') loop
    if jsonb_typeof(v_product -> 'variants') <> 'array' then
      raise exception 'variants_array_required: %', v_product ->> 'title';
    end if;
    for v_variant in select value from jsonb_array_elements(v_product -> 'variants') loop
      if v_variant ->> 'action' = 'UNCHANGED' then continue; end if;
      v_source := coalesce(nullif(btrim(v_variant ->> 'source'), ''), v_product ->> 'title', 'variant row');
      if nullif(btrim(v_variant ->> 'sku'), '') is null then raise exception '%: Missing SKU', v_source; end if;
      if nullif(v_variant ->> 'price_minor', '') is null or (v_variant ->> 'price_minor')::bigint <= 0 then raise exception '%: Missing Price', v_source; end if;
      if coalesce(v_variant ->> 'pta_status', 'unknown') = 'unknown' then raise exception '%: Missing PTA Status', v_source; end if;
      if coalesce(v_variant ->> 'condition', 'unknown') = 'unknown' then raise exception '%: Missing Condition', v_source; end if;
      if nullif(btrim(v_variant ->> 'warranty_override'), '') is null then raise exception '%: Missing Warranty', v_source; end if;
      if nullif(v_variant ->> 'delivery_scope', '') is null then raise exception '%: Missing Delivery', v_source; end if;
      if nullif(v_variant ->> 'id', '') is null and nullif(v_variant ->> 'inventory', '') is null then raise exception '%: Missing Inventory', v_source; end if;
      if nullif(v_variant ->> 'compare_at_price_minor', '') is not null and
         (v_variant ->> 'compare_at_price_minor')::bigint <= (v_variant ->> 'price_minor')::bigint then
        raise exception '%: Compare-at price must exceed Price', v_source;
      end if;
      if coalesce(nullif(v_variant ->> 'ram_display', ''), nullif(v_variant ->> 'storage_display', ''), nullif(v_variant ->> 'color_finish', '')) is not null then
        v_expected_sku := public.catalog_variant_sku(
          v_product ->> 'slug',
          coalesce(v_variant ->> 'ram_display', ''),
          coalesce(v_variant ->> 'storage_display', ''),
          coalesce(v_variant ->> 'color_finish', '')
        );
        if v_variant ->> 'sku' <> v_expected_sku then
          raise exception '%: SKU does not match structured variant identity (expected %)', v_source, v_expected_sku;
        end if;
      end if;
    end loop;
  end loop;

  v_result := public.apply_catalog_bulk_import_phase4_legacy(p_batch);

  -- The former writer intentionally preserved identity columns on update.
  -- Synchronize them from the now-validated structured payload in the same
  -- transaction so Admin display, publication and the PDP share one identity.
  for v_product in select value from jsonb_array_elements(p_batch -> 'products') loop
    v_product_id := nullif(v_product ->> 'id', '')::uuid;
    if v_product_id is null then
      select id into v_product_id from public.products where slug = v_product ->> 'slug';
    end if;
    for v_variant in select value from jsonb_array_elements(v_product -> 'variants') loop
      if v_variant ->> 'action' = 'UNCHANGED' then continue; end if;
      v_variant_id := nullif(v_variant ->> 'id', '')::uuid;
      if v_variant_id is null then
        select id into v_variant_id from public.product_variants
        where product_id = v_product_id and sku = v_variant ->> 'sku';
      end if;
      update public.product_variants
      set sku = btrim(v_variant ->> 'sku'),
          ram_display = nullif(btrim(v_variant ->> 'ram_display'), ''),
          storage_display = nullif(btrim(v_variant ->> 'storage_display'), ''),
          color_finish = nullif(btrim(v_variant ->> 'color_finish'), '')
      where id = v_variant_id and product_id = v_product_id;
      if not found then raise exception 'variant_identity_sync_failed: %', v_variant ->> 'sku'; end if;
    end loop;
  end loop;
  return v_result;
end;
$$;

revoke all on function public.apply_catalog_bulk_import(jsonb) from public, anon;
grant execute on function public.apply_catalog_bulk_import(jsonb) to authenticated;
comment on function public.apply_catalog_bulk_import(jsonb) is
  'Atomic Owner/Admin-only bulk catalog import with pre-write commercial-fact validation and canonical structured variant identity.';

commit;
