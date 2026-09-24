-- Dummy catalog + test order reset (Owner authorized, 2026-09-24). NOT YET APPLIED.
--
-- Every product, variant and order currently in the database is test/dummy data and is
-- hard-deleted so the real catalog starts from a clean state. Brands and categories are kept.
--
-- Apply order: 202609240001_category_structure_final.sql FIRST (its preconditions expect
-- MacBook Neo to exist), then this file, then 202609240003_catalog_sku_sequences.sql,
-- then 202609240004_legacy_bulk_import_server_sku.sql.
--
-- Safety:
--   * One transaction; any failed check rolls everything back.
--   * Aborts if any product or order was created after the cutoff below, so real data
--     added before this runs is never deleted by mistake.
--   * Aborts if any foreign key references products / variants / orders / media / bundles
--     from a table not handled here (a new dependency must be reviewed first).
--   * Deletes children before parents; nothing relies on ON DELETE RESTRICT being bypassed.
--
-- Not handled by SQL: the Cloudinary files behind product_media and bundle images. Their public IDs are listed
-- in a NOTICE below; delete them in the Cloudinary console (isolutions-development folder)
-- after this runs, or remove the media through Admin Media before running it.
--
-- There is no rollback beyond the transaction itself: once committed, the deleted test data
-- is gone. Take a Supabase backup first if any of it might be needed later.

begin;

-- ---------------------------------------------------------------------------
-- Preconditions
-- ---------------------------------------------------------------------------
do $$
declare
  cutoff constant timestamptz := '2026-09-25 00:00:00+05';
  unexpected text;
begin
  if exists (select 1 from public.products where created_at >= cutoff) then
    raise exception 'dummy_reset_precondition_failed: a product was created after % and may be real', cutoff;
  end if;
  if exists (select 1 from public.orders where created_at >= cutoff) then
    raise exception 'dummy_reset_precondition_failed: an order was created after % and may be real', cutoff;
  end if;

  -- Every foreign key that points at a table this reset empties must be one handled below.
  select string_agg(format('%s -> %s (%s)', c.conrelid::regclass, c.confrelid::regclass, c.conname), ', ')
  into unexpected
  from pg_constraint c
  where c.contype = 'f'
    and c.confrelid in (
      'public.products'::regclass,
      'public.product_variants'::regclass,
      'public.product_media'::regclass,
      'public.orders'::regclass,
      'public.bundles'::regclass
    )
    and (c.conrelid, c.confrelid) not in (
      ('public.product_variants'::regclass, 'public.products'::regclass),
      ('public.product_specifications'::regclass, 'public.products'::regclass),
      ('public.product_media'::regclass, 'public.products'::regclass),
      ('public.product_media'::regclass, 'public.product_variants'::regclass),
      ('public.product_media_variant_assignments'::regclass, 'public.product_media'::regclass),
      ('public.product_media_variant_assignments'::regclass, 'public.product_variants'::regclass),
      ('public.inventory_movements'::regclass, 'public.product_variants'::regclass),
      ('public.product_recommendations'::regclass, 'public.products'::regclass),
      ('public.bundle_items'::regclass, 'public.bundles'::regclass),
      ('public.bundle_items'::regclass, 'public.products'::regclass),
      ('public.bundle_items'::regclass, 'public.product_variants'::regclass),
      ('public.order_items'::regclass, 'public.orders'::regclass),
      ('public.order_items'::regclass, 'public.products'::regclass),
      ('public.order_items'::regclass, 'public.product_variants'::regclass)
    );
  if unexpected is not null then
    raise exception 'dummy_reset_precondition_failed: unhandled foreign key(s): %', unexpected;
  end if;
end
$$;

-- Record what is about to be deleted (visible in the SQL Editor output).
do $$
declare
  summary text;
  media text;
begin
  select format(
    'orders=%s order_items=%s products=%s variants=%s inventory_movements=%s specifications=%s media=%s media_assignments=%s recommendations=%s bundles=%s bundle_items=%s',
    (select count(*) from public.orders),
    (select count(*) from public.order_items),
    (select count(*) from public.products),
    (select count(*) from public.product_variants),
    (select count(*) from public.inventory_movements),
    (select count(*) from public.product_specifications),
    (select count(*) from public.product_media),
    (select count(*) from public.product_media_variant_assignments),
    (select count(*) from public.product_recommendations),
    (select count(*) from public.bundles),
    (select count(*) from public.bundle_items)
  ) into summary;
  raise notice 'dummy_reset: deleting %', summary;

  select string_agg(order_number, ', ' order by order_number) into summary from public.orders;
  raise notice 'dummy_reset: orders %', coalesce(summary, 'none');

  select string_agg(slug || ' [' || publication_status || ']', ', ' order by slug) into summary from public.products;
  raise notice 'dummy_reset: products %', coalesce(summary, 'none');

  select string_agg(public_id, ', ' order by public_id) into media
  from (
    select cloudinary_public_id as public_id from public.product_media where cloudinary_public_id is not null
    union all
    select bundle_image_public_id from public.bundles where bundle_image_public_id is not null
  ) as assets;
  raise notice 'dummy_reset: Cloudinary assets to remove manually: %', coalesce(media, 'none');
end
$$;

-- ---------------------------------------------------------------------------
-- Deletes, children before parents
-- ---------------------------------------------------------------------------

-- 1. Test orders (order_items restrict orders, products and variants, so they go first).
delete from public.order_items;
delete from public.orders;

-- 2. Bundles: their items restrict products/variants. Every product is dummy, so every
--    bundle item goes, and bundles left without items are removed with them.
delete from public.bundle_items;
delete from public.bundles b
where not exists (select 1 from public.bundle_items i where i.bundle_id = b.id);

-- 3. Frequently-bought-together links (would cascade, deleted explicitly for clarity).
delete from public.product_recommendations;

-- 4. Inventory history (restricts variant deletion).
delete from public.inventory_movements;

-- 5. Media colour assignments, then media rows (both would cascade from products).
delete from public.product_media_variant_assignments;
delete from public.product_media;

-- 6. Specifications, variants, products.
delete from public.product_specifications;
delete from public.product_variants;
delete from public.products;

-- 7. Restart order numbers (Owner approved) so the first real order is ISP-ORD-000001.
alter sequence public.storefront_order_number_seq restart with 1;

-- ---------------------------------------------------------------------------
-- Validation
-- ---------------------------------------------------------------------------
do $$
declare
  leftovers text;
begin
  select string_agg(name || '=' || total, ', ')
  into leftovers
  from (values
    ('orders', (select count(*) from public.orders)),
    ('order_items', (select count(*) from public.order_items)),
    ('products', (select count(*) from public.products)),
    ('product_variants', (select count(*) from public.product_variants)),
    ('inventory_movements', (select count(*) from public.inventory_movements)),
    ('product_specifications', (select count(*) from public.product_specifications)),
    ('product_media', (select count(*) from public.product_media)),
    ('product_media_variant_assignments', (select count(*) from public.product_media_variant_assignments)),
    ('product_recommendations', (select count(*) from public.product_recommendations)),
    ('bundle_items', (select count(*) from public.bundle_items)),
    ('bundles', (select count(*) from public.bundles))
  ) as counts(name, total)
  where total <> 0;
  if leftovers is not null then
    raise exception 'dummy_reset_validation_failed: rows remain: %', leftovers;
  end if;

  if not exists (select 1 from public.brands) or not exists (select 1 from public.categories) then
    raise exception 'dummy_reset_validation_failed: brands or categories were removed';
  end if;

  -- The next order must be ISP-ORD-000001. Reading pg_sequences does not consume a number.
  if (select coalesce(last_value, 0) from pg_sequences
      where schemaname = 'public' and sequencename = 'storefront_order_number_seq') <> 0 then
    raise exception 'dummy_reset_validation_failed: order number sequence was not restarted';
  end if;
end
$$;

commit;
