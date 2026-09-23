begin;

do $$
declare
  v_product_id uuid;
  v_variant_id uuid;
  v_match_count integer;
  v_updated_count integer;
  v_inventory bigint;
  v_validation record;
begin
  select count(*), (array_agg(p.id))[1]
    into v_match_count, v_product_id
  from public.products p
  join public.brands b on b.id = p.brand_id
  join public.categories c on c.id = p.category_id
  where p.slug = 'apple-20w-usb-c-charger'
    and b.name = 'Apple'
    and c.slug = 'mobile-accessories'
    and p.default_warranty = '1 Year';

  if v_match_count <> 1 then
    raise exception 'expected exactly one Apple charger product, found %', v_match_count;
  end if;

  select count(*), (array_agg(v.id))[1]
    into v_match_count, v_variant_id
  from public.product_variants v
  where v.product_id = v_product_id
    and v.sku = 'APPLE-20W-USBC-CHARGER'
    and v.price_minor = 699900;

  if v_match_count <> 1 then
    raise exception 'expected exactly one existing Apple charger variant at 699900 minor units, found %', v_match_count;
  end if;

  select coalesce(sum(m.quantity_delta), 0)::bigint
    into v_inventory
  from public.inventory_movements m
  where m.variant_id = v_variant_id;

  if v_inventory <> 10 then
    raise exception 'expected Apple charger inventory 10, found %', v_inventory;
  end if;

  update public.product_variants v
  set
    color_finish = 'White',
    condition = 'brand_new'::public.product_condition,
    delivery_scope = 'nationwide'::public.delivery_scope,
    pta_status = 'not_applicable'::public.pta_status
  where v.id = v_variant_id
    and v.product_id = v_product_id
    and v.sku = 'APPLE-20W-USBC-CHARGER';

  get diagnostics v_updated_count = row_count;
  if v_updated_count <> 1 then
    raise exception 'expected to update exactly one existing Apple charger variant, updated %', v_updated_count;
  end if;

  select * into v_validation
  from public.validate_product_for_publication(v_product_id);

  if 'variant_commercial_facts_unresolved' = any(coalesce(v_validation.errors, array[]::text[])) then
    raise exception 'Apple charger commercial facts remain unresolved after targeted update';
  end if;

  if not v_validation.is_valid then
    raise exception 'Apple charger is not ready to publish after targeted update: %', v_validation.errors;
  end if;
end;
$$;

commit;