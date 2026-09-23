do $$
declare
  v_updated_count integer;
begin
  update public.product_variants as variant
  set compare_at_price_minor = 9950000
  from public.products as product
  where product.id = variant.product_id
    and product.slug = 'motorola-g77'
    and product.publication_status = 'published'
    and variant.is_active
    and variant.price_minor = 9450000;

  get diagnostics v_updated_count = row_count;

  if v_updated_count = 0 then
    raise exception 'motorola_g77_test_deal_target_not_found';
  end if;

  if exists (
    select 1
    from public.product_variants as variant
    join public.products as product on product.id = variant.product_id
    where product.slug = 'motorola-g77'
      and product.publication_status = 'published'
      and variant.is_active
      and variant.price_minor = 9450000
      and variant.compare_at_price_minor <> 9950000
  ) then
    raise exception 'motorola_g77_test_deal_verification_failed';
  end if;
end
$$;