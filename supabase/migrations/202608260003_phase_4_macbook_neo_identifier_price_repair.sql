begin;

do $$
declare
  v_product_count integer;
  v_identity_count integer;
  v_updated_count integer;
  v_verified_count integer;
begin
  select count(*) into v_product_count
  from public.products
  where id = 'e7c72e6e-9a4d-449c-a38d-e15d3e594e99'::uuid
    and title = 'Apple MacBook Neo'
    and slug = 'apple-macbook-neo'
    and data_class = 'real';

  if v_product_count <> 1 then
    raise exception 'MacBook Neo repair aborted: expected exactly one verified product, found %', v_product_count;
  end if;

  with expected(id, sku, storage_display, color_finish, price_minor) as (
    values
      ('e0b2800f-3f6d-48b7-914a-754274263896'::uuid, 'PPLE-MACBOOK-NEO-256-BLUSH'::text, '256 GB'::text, 'Blush'::text, 22500000::bigint),
      ('da71503e-843e-4b07-80d2-f0da593ce8b7'::uuid, 'APPLE-MACBOOK-NEO-256-SILVER'::text, '256 GB'::text, 'Silver'::text, 22300000::bigint),
      ('79fe89d0-07aa-4dde-b6a9-78d60e7966f9'::uuid, 'APPLE-MACBOOK-NEO-256-INDIGO'::text, '256 GB'::text, 'Indigo'::text, 22300000::bigint),
      ('50b0ec2d-9055-43ae-8776-edb1866574ad'::uuid, 'APPLE-MACBOOK-NEO-512-BLUSH'::text, '512 GB'::text, 'Blush'::text, 25900000::bigint),
      ('0d0fba96-b13f-46f6-a94c-428176de33fe'::uuid, 'APPLE-MACBOOK-NEO-512-INDIGO'::text, '512 GB'::text, 'Indigo'::text, 25600000::bigint)
  )
  select count(*) into v_identity_count
  from expected e
  join public.product_variants v
    on v.id = e.id
   and v.product_id = 'e7c72e6e-9a4d-449c-a38d-e15d3e594e99'::uuid
   and v.sku = e.sku
   and v.storage_display = e.storage_display
   and v.color_finish = e.color_finish
   and v.is_active;

  if v_identity_count <> 5 then
    raise exception 'MacBook Neo repair aborted: expected five exact variant identities, found %', v_identity_count;
  end if;

  with expected(id, price_minor) as (
    values
      ('e0b2800f-3f6d-48b7-914a-754274263896'::uuid, 22500000::bigint),
      ('da71503e-843e-4b07-80d2-f0da593ce8b7'::uuid, 22300000::bigint),
      ('79fe89d0-07aa-4dde-b6a9-78d60e7966f9'::uuid, 22300000::bigint),
      ('50b0ec2d-9055-43ae-8776-edb1866574ad'::uuid, 25900000::bigint),
      ('0d0fba96-b13f-46f6-a94c-428176de33fe'::uuid, 25600000::bigint)
  )
  update public.product_variants v
  set price_minor = e.price_minor
  from expected e
  where v.id = e.id
    and v.product_id = 'e7c72e6e-9a4d-449c-a38d-e15d3e594e99'::uuid;

  get diagnostics v_updated_count = row_count;
  if v_updated_count <> 5 then
    raise exception 'MacBook Neo repair aborted: expected to update five variants, updated %', v_updated_count;
  end if;

  with expected(id, price_minor) as (
    values
      ('e0b2800f-3f6d-48b7-914a-754274263896'::uuid, 22500000::bigint),
      ('da71503e-843e-4b07-80d2-f0da593ce8b7'::uuid, 22300000::bigint),
      ('79fe89d0-07aa-4dde-b6a9-78d60e7966f9'::uuid, 22300000::bigint),
      ('50b0ec2d-9055-43ae-8776-edb1866574ad'::uuid, 25900000::bigint),
      ('0d0fba96-b13f-46f6-a94c-428176de33fe'::uuid, 25600000::bigint)
  )
  select count(*) into v_verified_count
  from expected e
  join public.product_variants v
    on v.id = e.id
   and v.product_id = 'e7c72e6e-9a4d-449c-a38d-e15d3e594e99'::uuid
   and v.price_minor = e.price_minor;

  if v_verified_count <> 5 then
    raise exception 'MacBook Neo repair verification failed: verified % of 5 prices', v_verified_count;
  end if;
end;
$$;

commit;
