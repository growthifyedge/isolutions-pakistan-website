-- Locked final category structure (Owner approved, 2026-09-24).
--
--   Mobile Phones            <- Product Type: Mobile Phone
--   Accessories              <- Product Type: Accessory
--   Gadgets                  <- Product Type: Gadget
--    |- Laptops              <- Product Type: Laptop / MacBook
--    '- Tablets              <- Product Type: Tablet / iPad
--
-- Data-only change. No product changes delivery scope: delivery is product/variant level,
-- never category level, and MacBook Neo stays Karachi Only (verified below, not updated).
--
-- Storefront compatibility (no storefront code change needed):
--   * "Mobile Phones" / mobile-phones still matches the /collections/mobile-phones aliases.
--   * Accessories keeps the slug mobile-accessories, so /collections/mobile-accessories,
--     the homepage accessories section and existing /shop?category= links keep working.
--   * Laptops keeps its name/slug, so /collections/macbook and /collections/laptops-tablets
--     keep resolving; Tablets makes the iPad / Android Tablets collections resolvable.
--
-- Old categories are retired (is_active = false), never deleted, and only after their
-- products have been moved. The whole script runs in one transaction and aborts on any
-- unexpected state, so it cannot be half-applied or applied twice.
--
-- Note: 202609010003 / 202609010004 look up "Mobile Accessories" by name. They are already
-- applied; after this migration they would fail if replayed on a database in this state.
--
-- Rollback (run in one transaction, only if no new products use Gadgets/Tablets):
--   update public.categories set parent_id = null, sort_order = 0 where id = 'cd4c5f08-6b67-4586-a1db-71f6c6ebdb7f';
--   delete from public.categories where slug in ('tablets', 'gadgets');
--   update public.categories set name = 'Mobile Accessories', sort_order = 0 where id = 'fcd30d59-0951-4ed9-be74-8066e809a3f2';
--   update public.categories set name = 'Accessories', slug = 'accessories', is_active = true where id = 'dcd2e519-febf-4e78-80b6-2e0360a9907e';
--   update public.categories set name = 'Smartphones', slug = 'smartphones', sort_order = 0 where id = '3c053b90-9475-415e-8613-41f712463113';
--   -- Products moved in step 2 are listed by the NOTICE this migration raises; move them back by id if needed.

begin;

create temporary table category_restructure_baseline on commit drop as
select
  (select count(*) from public.products) as product_count,
  (select count(*) from public.products where publication_status = 'published') as published_count;

-- ---------------------------------------------------------------------------
-- Preconditions
-- ---------------------------------------------------------------------------
do $$
declare
  expected record;
begin
  for expected in
    select *
    from (values
      ('3c053b90-9475-415e-8613-41f712463113'::uuid, 'Smartphones', 'smartphones'),
      ('cd4c5f08-6b67-4586-a1db-71f6c6ebdb7f'::uuid, 'Laptops', 'laptops'),
      ('fcd30d59-0951-4ed9-be74-8066e809a3f2'::uuid, 'Mobile Accessories', 'mobile-accessories'),
      ('dcd2e519-febf-4e78-80b6-2e0360a9907e'::uuid, 'Accessories', 'accessories')
    ) as categories(id, name, slug)
  loop
    if not exists (
      select 1
      from public.categories c
      where c.id = expected.id
        and c.name = expected.name
        and c.slug = expected.slug
        and c.data_class = 'real'
        and c.is_active
        and c.parent_id is null
    ) then
      raise exception 'category_restructure_precondition_failed: % (%) is not in the expected state', expected.name, expected.slug;
    end if;
  end loop;

  if exists (
    select 1
    from public.categories
    where slug in ('mobile-phones', 'gadgets', 'tablets', 'accessories-retired')
  ) then
    raise exception 'category_restructure_precondition_failed: a target slug (mobile-phones, gadgets, tablets, accessories-retired) is already in use';
  end if;

  if exists (
    select 1
    from public.categories
    where lower(btrim(name)) in ('mobile phones', 'gadgets', 'tablets')
  ) then
    raise exception 'category_restructure_precondition_failed: a category named Mobile Phones, Gadgets or Tablets already exists';
  end if;

  if not exists (
    select 1
    from public.products p
    where p.slug = 'apple-macbook-neo'
      and p.category_id = 'cd4c5f08-6b67-4586-a1db-71f6c6ebdb7f'
      and p.default_delivery_scope = 'karachi_only'
  ) or exists (
    select 1
    from public.product_variants v
    join public.products p on p.id = v.product_id
    where p.slug = 'apple-macbook-neo'
      and v.delivery_scope is distinct from 'karachi_only'
  ) then
    raise exception 'category_restructure_precondition_failed: MacBook Neo is not in Laptops with Karachi Only delivery';
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- 1. Smartphones -> Mobile Phones
-- ---------------------------------------------------------------------------
update public.categories
set name = 'Mobile Phones', slug = 'mobile-phones', sort_order = 1
where id = '3c053b90-9475-415e-8613-41f712463113';

-- ---------------------------------------------------------------------------
-- 2. Consolidate Accessories into the current Mobile Accessories category
-- ---------------------------------------------------------------------------
do $$
declare
  moved text;
begin
  select string_agg(p.id::text || ' ' || p.slug, ', ' order by p.slug)
  into moved
  from public.products p
  where p.category_id = 'dcd2e519-febf-4e78-80b6-2e0360a9907e';
  raise notice 'category_restructure: products moved from old Accessories: %', coalesce(moved, 'none');
end
$$;

update public.products
set category_id = 'fcd30d59-0951-4ed9-be74-8066e809a3f2'
where category_id = 'dcd2e519-febf-4e78-80b6-2e0360a9907e';

update public.categories
set name = 'Accessories (retired)', slug = 'accessories-retired', is_active = false
where id = 'dcd2e519-febf-4e78-80b6-2e0360a9907e';

-- Slug stays mobile-accessories for link and storefront-collection compatibility.
update public.categories
set name = 'Accessories', sort_order = 2
where id = 'fcd30d59-0951-4ed9-be74-8066e809a3f2';

-- ---------------------------------------------------------------------------
-- 3-4. Gadgets with Laptops and Tablets as sub-categories
-- ---------------------------------------------------------------------------
insert into public.categories (name, slug, data_class, is_active, sort_order)
values ('Gadgets', 'gadgets', 'real', true, 3);

update public.categories
set parent_id = (select id from public.categories where slug = 'gadgets'), sort_order = 1
where id = 'cd4c5f08-6b67-4586-a1db-71f6c6ebdb7f';

insert into public.categories (parent_id, name, slug, data_class, is_active, sort_order)
values ((select id from public.categories where slug = 'gadgets'), 'Tablets', 'tablets', 'real', true, 2);

-- ---------------------------------------------------------------------------
-- Final validation
-- ---------------------------------------------------------------------------
do $$
declare
  gadgets_id uuid;
begin
  select id into gadgets_id
  from public.categories
  where slug = 'gadgets' and name = 'Gadgets' and data_class = 'real' and is_active and parent_id is null;
  if gadgets_id is null then
    raise exception 'category_restructure_validation_failed: Gadgets missing';
  end if;

  if (
    select array_agg(name order by name)
    from public.categories
    where data_class = 'real' and is_active and parent_id is null
  ) is distinct from array['Accessories', 'Gadgets', 'Mobile Phones'] then
    raise exception 'category_restructure_validation_failed: active top-level categories are not exactly Mobile Phones, Accessories, Gadgets';
  end if;

  if not exists (
    select 1 from public.categories
    where id = '3c053b90-9475-415e-8613-41f712463113'
      and name = 'Mobile Phones' and slug = 'mobile-phones' and is_active
  ) or not exists (
    select 1 from public.categories
    where id = 'fcd30d59-0951-4ed9-be74-8066e809a3f2'
      and name = 'Accessories' and slug = 'mobile-accessories' and is_active
  ) then
    raise exception 'category_restructure_validation_failed: Mobile Phones / Accessories not renamed as expected';
  end if;

  if (
    select count(*)
    from public.categories
    where parent_id = gadgets_id
      and data_class = 'real'
      and is_active
      and ((id = 'cd4c5f08-6b67-4586-a1db-71f6c6ebdb7f' and name = 'Laptops' and slug = 'laptops')
        or (name = 'Tablets' and slug = 'tablets'))
  ) <> 2 then
    raise exception 'category_restructure_validation_failed: Laptops and Tablets are not both active sub-categories of Gadgets';
  end if;

  if exists (
    select 1 from public.categories
    where id = 'dcd2e519-febf-4e78-80b6-2e0360a9907e' and is_active
  ) or exists (
    select 1 from public.products
    where category_id = 'dcd2e519-febf-4e78-80b6-2e0360a9907e'
  ) then
    raise exception 'category_restructure_validation_failed: retired Accessories category is still active or still has products';
  end if;

  if exists (
    select 1
    from public.products p
    join public.categories c on c.id = p.category_id
    where p.data_class = 'real'
      and not (c.data_class = 'real' and c.is_active)
  ) then
    raise exception 'category_restructure_validation_failed: a real product is left in an inactive or development category';
  end if;

  if (
    select (select count(*) from public.products) <> b.product_count
        or (select count(*) from public.products where publication_status = 'published') <> b.published_count
    from category_restructure_baseline b
  ) then
    raise exception 'category_restructure_validation_failed: product counts changed';
  end if;

  if not exists (
    select 1
    from public.products p
    where p.slug = 'apple-macbook-neo'
      and p.category_id = 'cd4c5f08-6b67-4586-a1db-71f6c6ebdb7f'
      and p.default_delivery_scope = 'karachi_only'
  ) or exists (
    select 1
    from public.product_variants v
    join public.products p on p.id = v.product_id
    where p.slug = 'apple-macbook-neo'
      and v.delivery_scope is distinct from 'karachi_only'
  ) then
    raise exception 'category_restructure_validation_failed: MacBook Neo delivery or category changed';
  end if;
end
$$;

commit;
