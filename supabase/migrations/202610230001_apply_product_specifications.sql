-- Specifications Bulk Upload: save ONE product's specifications all or nothing.
-- NOT YET APPLIED to any database.
--
-- apply_product_specifications(p_product_id uuid, p_inserts jsonb, p_updates jsonb) returns jsonb
--   p_inserts: [{ "specification_group": "Battery", "label": "Wired Charging", "value": "45W" }, ...]
--   p_updates: [{ "id": "<spec id>", "expected_value": "<value shown in the preview>", "value": "<new value>" }, ...]
--
-- Rules:
--   * One call = one transaction: every insert and every value update of this product is saved, or none is.
--   * SECURITY INVOKER: the caller's own RLS applies (catalog admins only), plus an explicit is_catalog_admin() check.
--   * Concurrent changes are detected, never silently overwritten:
--       - an update applies only while the stored value still equals expected_value (same product);
--       - an insert is refused when the product already has that label (any section, case / spacing ignored).
--     Any refusal raises, so the whole call rolls back.
--   * Only public.product_specifications is written: INSERT new rows and UPDATE `value` of listed rows.
--     Nothing is deleted; section, label and sort_order of existing rows never change.
--   * New rows continue the product's sort_order (current maximum + 1, in payload order).
--   * Works for every category and condition (no category or brand rule).

begin;

create or replace function public.apply_product_specifications(p_product_id uuid, p_inserts jsonb, p_updates jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = ''
set lock_timeout = '2s'
as $$
declare
  v_inserts jsonb := coalesce(p_inserts, '[]'::jsonb);
  v_updates jsonb := coalesce(p_updates, '[]'::jsonb);
  v_item jsonb;
  v_group text;
  v_label text;
  v_value text;
  v_order integer;
  v_count integer;
  v_inserted integer := 0;
  v_updated integer := 0;
begin
  if not public.is_catalog_admin() then
    raise exception using errcode = '42501', message = 'apply_product_specifications_forbidden: catalog admin required';
  end if;
  if p_product_id is null or not exists (select 1 from public.products where id = p_product_id) then
    raise exception 'apply_product_specifications_product_not_found';
  end if;
  if jsonb_typeof(v_inserts) <> 'array' or jsonb_typeof(v_updates) <> 'array' then
    raise exception 'apply_product_specifications_invalid_payload: inserts and updates must be arrays';
  end if;
  if jsonb_array_length(v_inserts) + jsonb_array_length(v_updates) = 0 then
    raise exception 'apply_product_specifications_invalid_payload: nothing to save';
  end if;

  -- One writer per product at a time (released at the end of this transaction).
  perform pg_advisory_xact_lock(hashtextextended('product_specifications:' || p_product_id::text, 0));

  for v_item in select value from jsonb_array_elements(v_updates) loop
    v_value := btrim(coalesce(v_item ->> 'value', ''));
    if v_value = '' or (v_item ->> 'id') is null or (v_item ->> 'expected_value') is null then
      raise exception 'apply_product_specifications_invalid_payload: an update needs id, expected_value and a value';
    end if;
    update public.product_specifications
    set value = v_value
    where id = (v_item ->> 'id')::uuid
      and product_id = p_product_id
      and value = v_item ->> 'expected_value';
    get diagnostics v_count = row_count;
    if v_count <> 1 then
      raise exception 'apply_product_specifications_stale: a stored value changed since the preview; nothing was saved for this product';
    end if;
    v_updated := v_updated + 1;
  end loop;

  select coalesce(max(sort_order), -1) + 1 into v_order from public.product_specifications where product_id = p_product_id;
  for v_item in select value from jsonb_array_elements(v_inserts) loop
    v_group := btrim(coalesce(v_item ->> 'specification_group', ''));
    v_label := regexp_replace(btrim(coalesce(v_item ->> 'label', '')), '\s+', ' ', 'g');
    v_value := btrim(coalesce(v_item ->> 'value', ''));
    if v_group = '' or v_label = '' or v_value = '' then
      raise exception 'apply_product_specifications_invalid_payload: a new specification needs a section, label and value';
    end if;
    if exists (
      select 1 from public.product_specifications
      where product_id = p_product_id
        and lower(regexp_replace(btrim(label), '\s+', ' ', 'g')) = lower(v_label)
    ) then
      raise exception 'apply_product_specifications_stale: "%" already exists for this product; nothing was saved for this product', v_label;
    end if;
    insert into public.product_specifications (product_id, specification_group, label, value, sort_order)
    values (p_product_id, v_group, v_label, v_value, v_order);
    v_order := v_order + 1;
    v_inserted := v_inserted + 1;
  end loop;

  return jsonb_build_object('product_id', p_product_id, 'inserted', v_inserted, 'updated', v_updated);
end;
$$;

revoke all on function public.apply_product_specifications(uuid, jsonb, jsonb) from public, anon;
grant execute on function public.apply_product_specifications(uuid, jsonb, jsonb) to authenticated;

comment on function public.apply_product_specifications(uuid, jsonb, jsonb) is
  'Specifications Bulk Upload for ONE product, all or nothing: inserts new rows and updates listed values only while they still equal the previewed value. Refuses existing labels. Never deletes. Catalog admins only (RLS + explicit check).';

commit;
