-- Publication validation: New iPhones may be published without a warranty.
-- NOT YET APPLIED to any database (file only, 2026-11-18). Requires 202611060001_publication_accessories_no_warranty.sql
-- (the current validator on DEV + PROD).
--
-- Owner-approved 2026-11-18:
--   * Warranty is optional for New and Used iPhones. A missing warranty stays NULL and never blocks publication;
--     a stated warranty is kept exactly as stored.
--   * New iPhone = a real Apple product in "mobile-phones" whose title does NOT end with " (Used)" and whose every
--     variant is Brand New. The Used iPhone rule (v_used_iphone) is unchanged.
--   * Only the warranty requirement is removed. PTA (not unknown), condition (not unknown), price > 0, delivery
--     scope, active variant, primary Cloudinary image and every other check stay required.
--   * Android (non-Apple mobile phones) and every other category keep their current warranty rules. Mixed, open-box
--     or refurbished Apple phones get no new exemption.
-- No product, variant, warranty, SKU, category or media row is changed by this migration.

begin;

create or replace function public.validate_product_for_publication(p_product_id uuid)
returns table (is_valid boolean, errors text[])
language plpgsql stable set search_path = '' as $$
declare v_errors text[] := array[]::text[]; v_product public.products%rowtype; v_used_iphone boolean; v_new_iphone boolean; v_gadget boolean; v_apple boolean; v_category_slug text; v_tablet_macbook boolean; v_accessory boolean;
begin
  select * into v_product from public.products where id = p_product_id;
  if not found then return query select false, array['product_not_found']; return; end if;
  if v_product.data_class <> 'real' then v_errors := array_append(v_errors, 'real_catalog_classification_required'); end if;
  if nullif(trim(v_product.title), '') is null then v_errors := array_append(v_errors, 'title_required'); end if;
  if v_product.brand_id is not null and not exists (select 1 from public.brands where id = v_product.brand_id and is_active and data_class = 'real') then v_errors := array_append(v_errors, 'active_real_brand_required'); end if;
  if not exists (select 1 from public.categories where id = v_product.category_id and is_active and data_class = 'real') then v_errors := array_append(v_errors, 'active_real_category_required'); end if;
  if not exists (select 1 from public.product_variants where product_id = p_product_id and is_active) then v_errors := array_append(v_errors, 'active_variant_required'); end if;
  select slug into v_category_slug from public.categories where id = v_product.category_id;
  v_apple := exists (select 1 from public.brands where id = v_product.brand_id and data_class = 'real' and lower(btrim(name)) = 'apple');
  -- Used iPhone (warranty not required): Apple + mobile-phones + "(Used)" title + every variant Used.
  v_used_iphone := v_product.data_class = 'real'
    and v_product.title ~* '\s\(used\)\s*$'
    and v_apple
    and v_category_slug = 'mobile-phones'
    and exists (select 1 from public.product_variants where product_id = p_product_id)
    and not exists (select 1 from public.product_variants where product_id = p_product_id and condition <> 'used');
  -- New iPhone (warranty not required): Apple + mobile-phones + no "(Used)" title + every variant Brand New.
  v_new_iphone := v_product.data_class = 'real'
    and v_product.title !~* '\s\(used\)\s*$'
    and v_apple
    and v_category_slug = 'mobile-phones'
    and exists (select 1 from public.product_variants where product_id = p_product_id)
    and not exists (select 1 from public.product_variants where product_id = p_product_id and condition <> 'brand_new');
  -- Gadget (PTA, condition and warranty not required): a real product in the category with slug "gadgets" itself.
  v_gadget := v_product.data_class = 'real' and v_category_slug = 'gadgets';
  -- Tablets & MacBooks (warranty not required, New and Used): a real product in "tablets", or in "laptops" with brand Apple.
  v_tablet_macbook := v_product.data_class = 'real' and (v_category_slug = 'tablets' or (v_category_slug = 'laptops' and v_apple));
  -- Mobile Accessories (warranty not required; PTA and condition still required): a real product in "mobile-accessories".
  v_accessory := v_product.data_class = 'real' and v_category_slug = 'mobile-accessories';
  -- "laptops" is for Apple MacBooks only (Windows laptops are not sold).
  if v_category_slug = 'laptops' and not v_apple then v_errors := array_append(v_errors, 'laptops_apple_brand_required'); end if;
  if exists (select 1 from public.product_variants where product_id = p_product_id and is_active and (price_minor <= 0 or delivery_scope is null or (not v_gadget and (pta_status = 'unknown' or condition = 'unknown' or (not v_used_iphone and not v_new_iphone and not v_tablet_macbook and not v_accessory and nullif(trim(coalesce(warranty_override, v_product.default_warranty)), '') is null))))) then v_errors := array_append(v_errors, 'variant_commercial_facts_unresolved'); end if;
  if not exists (select 1 from public.product_media where product_id = p_product_id and is_primary and cloudinary_public_id is not null and secure_url is not null and width > 0 and height > 0 and bytes > 0) then v_errors := array_append(v_errors, 'primary_product_media_required'); end if;
  return query select cardinality(v_errors) = 0, v_errors;
end;
$$;

commit;
