begin;

do $$
declare
  v_product_id uuid;
  v_current_price bigint;
  v_expected_count integer;
begin
  select p.id into strict v_product_id
  from public.products p
  join public.brands b on b.id = p.brand_id
  where p.slug = 'apple-macbook-neo'
    and p.title = 'Apple MacBook Neo'
    and p.data_class = 'real'
    and b.name = 'Apple'
    and b.data_class = 'real';

  select v.price_minor into strict v_current_price
  from public.product_variants v
  where v.product_id = v_product_id
    and v.is_active
    and v.ram_display = '8 GB'
    and v.storage_display = '256 GB'
    and v.color_finish = 'Indigo';

  if v_current_price not in (22299800, 22300000) then
    raise exception 'Refusing MacBook Neo repair: unexpected 256 GB / Indigo price_minor %', v_current_price;
  end if;

  update public.product_variants
  set price_minor = 22300000
  where product_id = v_product_id
    and is_active
    and ram_display = '8 GB'
    and storage_display = '256 GB'
    and color_finish = 'Indigo'
    and price_minor = 22299800;

  select count(*) into v_expected_count
  from (
    values
      ('256 GB'::text, 'Blush'::text, 22500000::bigint),
      ('256 GB'::text, 'Silver'::text, 22300000::bigint),
      ('256 GB'::text, 'Indigo'::text, 22300000::bigint),
      ('512 GB'::text, 'Blush'::text, 25900000::bigint),
      ('512 GB'::text, 'Indigo'::text, 25600000::bigint)
  ) as expected(storage_display, color_finish, price_minor)
  join public.product_variants v
    on v.product_id = v_product_id
   and v.is_active
   and v.ram_display = '8 GB'
   and v.storage_display = expected.storage_display
   and v.color_finish = expected.color_finish
   and v.price_minor = expected.price_minor
   and v.compare_at_price_minor is null;

  if v_expected_count <> 5 then
    raise exception 'MacBook Neo approved price verification failed: matched % of 5 variants', v_expected_count;
  end if;
end;
$$;

commit;
