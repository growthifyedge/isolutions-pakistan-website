-- Publication validation: Used iPhones may be published without a warranty.
-- NOT YET APPLIED to any database. Requires 202609010002_phase_4_brandless_products.sql (current validator).
--
-- Owner-approved 2026-10-22:
--   * Used iPhones carry NO warranty. Their warranty stays NULL and must not block publication.
--   * New / Box Pack iPhones keep the warranty requirement (1 or 2 years, Owner-confirmed only).
--   * Android and every other product keep the existing rule unchanged.
--
-- The exemption applies only when ALL of these hold (same identity rule as apply_iphone_stock_phone):
--   * real product, brand named "Apple" (real), category mobile-phones;
--   * title ends with " (Used)";
--   * the product has variants and EVERY variant (active or hidden) has condition 'used'.
-- Mixed New/Used, unknown, open-box or refurbished variants, a plain title or any other brand get no exemption.
-- Every other check is unchanged: real classification, title, brand, category, active variant, price > 0,
-- delivery scope, PTA not unknown, condition not unknown, primary Cloudinary image.
-- No product, variant, warranty or media row is changed by this migration.

begin;

create or replace function public.validate_product_for_publication(p_product_id uuid)
returns table (is_valid boolean, errors text[])
language plpgsql stable set search_path = '' as $$
declare v_errors text[] := array[]::text[]; v_product public.products%rowtype; v_used_iphone boolean;
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
  if exists (select 1 from public.product_variants where product_id = p_product_id and is_active and (price_minor <= 0 or delivery_scope is null or pta_status = 'unknown' or condition = 'unknown' or (not v_used_iphone and nullif(trim(coalesce(warranty_override, v_product.default_warranty)), '') is null))) then v_errors := array_append(v_errors, 'variant_commercial_facts_unresolved'); end if;
  if not exists (select 1 from public.product_media where product_id = p_product_id and is_primary and cloudinary_public_id is not null and secure_url is not null and width > 0 and height > 0 and bytes > 0) then v_errors := array_append(v_errors, 'primary_product_media_required'); end if;
  return query select cardinality(v_errors) = 0, v_errors;
end;
$$;

commit;
