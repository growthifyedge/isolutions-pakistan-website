begin;

-- Finalizes checkout delivery charges. Replaces the previously unknown
-- ("to be confirmed") standard delivery fee below the free-delivery threshold
-- with a fixed Rs 200 base delivery fee. The server now always stores a known
-- final delivery_fee_minor for new orders:
--
--   subtotal <  Rs 10,000: Standard = Rs 200, Fast = Rs 200 + Rs 200 = Rs 400
--   subtotal >= Rs 10,000: Standard = FREE,   Fast = Rs 0 + Rs 200   = Rs 200
--
-- shipping_surcharge_minor remains Rs 200 for Fast and 0 for Standard.
-- Delivery eligibility (Karachi-only / nationwide / mixed) is unchanged.
--
-- Also restores the optional-brand LEFT JOIN from
-- 202609220001_checkout_optional_brand_fix.sql, which
-- 202609220003_checkout_shipping_methods.sql unintentionally reverted to an
-- inner join (brandless published products were no longer orderable).
--
-- Signature and return type are unchanged, so CREATE OR REPLACE keeps the
-- existing function identity; grants are re-asserted below for safety.

comment on column public.orders.delivery_fee_minor is 'Final delivery fee in minor units (base delivery + shipping surcharge), calculated server-side. NULL only on legacy orders created before 202609230001.';
comment on column public.orders.shipping_surcharge_minor is 'Fast Delivery surcharge component in minor units (Rs 200 for fast, 0 for standard); already included in delivery_fee_minor.';

create or replace function public.create_storefront_order(
  p_customer_name text,
  p_phone text,
  p_email text,
  p_city text,
  p_other_city text,
  p_full_delivery_address text,
  p_area_landmark text,
  p_order_notes text,
  p_payment_method text,
  p_shipping_method text,
  p_items jsonb
)
returns table (
  order_id uuid,
  order_number text,
  payment_method text,
  shipping_method text,
  subtotal_minor bigint,
  delivery_fee_minor bigint,
  shipping_surcharge_minor bigint,
  total_minor bigint
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_customer_name text := nullif(trim(p_customer_name), '');
  v_phone text := nullif(trim(p_phone), '');
  v_email text := nullif(trim(p_email), '');
  v_city text := nullif(trim(p_city), '');
  v_other_city text := nullif(trim(p_other_city), '');
  v_address text := nullif(trim(p_full_delivery_address), '');
  v_landmark text := nullif(trim(p_area_landmark), '');
  v_notes text := nullif(trim(p_order_notes), '');
  v_shipping_method text := nullif(trim(p_shipping_method), '');
  v_order_id uuid;
  v_order_number text;
  v_subtotal bigint := 0;
  v_has_karachi_only boolean := false;
  v_has_nationwide boolean := false;
  v_delivery_classification text;
  v_line record;
  v_variant record;
  v_image_url text;
  v_free_standard_threshold_minor constant bigint := 1000000; -- Rs 10,000
  v_standard_delivery_fee_minor constant bigint := 20000; -- Rs 200 base delivery below threshold
  v_fast_surcharge_minor constant bigint := 20000; -- Rs 200
  v_base_delivery_fee_minor bigint;
  v_shipping_surcharge_minor bigint := 0;
  v_delivery_fee_minor bigint;
  v_total_minor bigint;
begin
  if v_customer_name is null or char_length(v_customer_name) > 160 then
    raise exception 'customer_name_required';
  end if;
  if v_phone is null or char_length(v_phone) > 40 then
    raise exception 'phone_required';
  end if;
  if v_email is not null and (char_length(v_email) > 254 or position('@' in v_email) <= 1) then
    raise exception 'email_invalid';
  end if;
  if v_address is null or char_length(v_address) > 1000 then
    raise exception 'delivery_address_required';
  end if;
  if coalesce(p_payment_method, '') not in ('cash_on_delivery', 'bank_transfer') then
    raise exception 'payment_method_unsupported';
  end if;
  if coalesce(v_shipping_method, '') not in ('standard', 'fast') then
    raise exception 'shipping_method_unsupported';
  end if;
  if p_items is null
    or jsonb_typeof(p_items) <> 'array'
    or jsonb_array_length(p_items) = 0
    or jsonb_array_length(p_items) > 20 then
    raise exception 'order_items_invalid';
  end if;
  if exists (
    select 1
    from jsonb_to_recordset(p_items) as requested(variant_id uuid, quantity integer)
    where variant_id is null or quantity is null or quantity < 1 or quantity > 20
  ) then
    raise exception 'order_item_quantity_invalid';
  end if;
  if exists (
    select 1
    from jsonb_to_recordset(p_items) as requested(variant_id uuid, quantity integer)
    group by variant_id having count(*) > 1
  ) then
    raise exception 'order_item_duplicate_variant';
  end if;

  for v_line in
    select requested.variant_id, requested.quantity
    from jsonb_to_recordset(p_items) as requested(variant_id uuid, quantity integer)
  loop
    select
      v.id as variant_id,
      v.product_id,
      v.sku,
      v.ram_display,
      v.storage_display,
      v.color_finish,
      v.pta_status,
      v.condition,
      coalesce(v.warranty_override, p.default_warranty) as warranty,
      v.price_minor,
      coalesce(v.delivery_scope, p.default_delivery_scope) as delivery_scope,
      coalesce(sum(m.quantity_delta), 0)::bigint as quantity_on_hand,
      p.title as product_title
    into v_variant
    from public.product_variants v
    join public.products p on p.id = v.product_id
    left join public.brands b on b.id = p.brand_id
    join public.categories c on c.id = p.category_id
    left join public.inventory_movements m on m.variant_id = v.id
    where v.id = v_line.variant_id
      and v.is_active
      and p.data_class = 'real'
      and p.publication_status = 'published'
      and p.published_at is not null
      and (
        p.brand_id is null
        or (
          b.id is not null
          and b.data_class = 'real'
          and b.is_active
        )
      )
      and c.data_class = 'real' and c.is_active
    group by v.id, p.id;

    if not found or v_variant.price_minor <= 0 or v_variant.delivery_scope is null then
      raise exception 'variant_not_orderable';
    end if;
    if v_variant.quantity_on_hand < v_line.quantity then
      raise exception 'variant_out_of_stock';
    end if;

    v_subtotal := v_subtotal + (v_variant.price_minor * v_line.quantity);
    v_has_karachi_only := v_has_karachi_only or v_variant.delivery_scope = 'karachi_only'::public.delivery_scope;
    v_has_nationwide := v_has_nationwide or v_variant.delivery_scope = 'nationwide'::public.delivery_scope;
  end loop;

  if v_city is null
    or v_city not in ('Karachi', 'Other city in Pakistan') then
    raise exception 'delivery_city_invalid';
  end if;
  if v_has_karachi_only and v_city <> 'Karachi' then
    raise exception 'karachi_delivery_required';
  end if;
  if v_city = 'Karachi' then
    v_other_city := null;
  elsif v_other_city is null or char_length(v_other_city) > 120 then
    raise exception 'other_city_required';
  end if;

  v_delivery_classification := case
    when v_has_karachi_only and v_has_nationwide then 'mixed'
    when v_has_karachi_only then 'karachi_only'
    else 'nationwide'
  end;

  -- Shipping (authoritative, server-side only; browser totals are never trusted):
  --   base delivery = Rs 0 at/above the Rs 10,000 subtotal threshold, otherwise Rs 200
  --   Fast Delivery always adds a Rs 200 surcharge on top of the base
  --   final delivery fee = base + surcharge (never NULL for new orders)
  v_base_delivery_fee_minor := case
    when v_subtotal >= v_free_standard_threshold_minor then 0
    else v_standard_delivery_fee_minor
  end;
  v_shipping_surcharge_minor := case when v_shipping_method = 'fast' then v_fast_surcharge_minor else 0 end;
  v_delivery_fee_minor := v_base_delivery_fee_minor + v_shipping_surcharge_minor;
  v_total_minor := v_subtotal + v_delivery_fee_minor;

  v_order_number := 'ISP-ORD-' || lpad(nextval('public.storefront_order_number_seq')::text, 6, '0');

  insert into public.orders (
    order_number, customer_name, phone, email, city, other_city,
    full_delivery_address, area_landmark, order_notes, payment_method,
    shipping_method, shipping_surcharge_minor,
    delivery_classification, subtotal_minor, delivery_fee_minor, total_minor, status
  ) values (
    v_order_number, v_customer_name, v_phone, v_email, v_city, v_other_city,
    v_address, v_landmark, v_notes, p_payment_method,
    v_shipping_method, v_shipping_surcharge_minor,
    v_delivery_classification, v_subtotal, v_delivery_fee_minor, v_total_minor, 'new'
  ) returning id into v_order_id;

  for v_line in
    select requested.variant_id, requested.quantity
    from jsonb_to_recordset(p_items) as requested(variant_id uuid, quantity integer)
  loop
    select
      v.id as variant_id,
      v.product_id,
      v.sku,
      v.ram_display,
      v.storage_display,
      v.color_finish,
      v.pta_status,
      v.condition,
      coalesce(v.warranty_override, p.default_warranty) as warranty,
      v.price_minor,
      coalesce(v.delivery_scope, p.default_delivery_scope) as delivery_scope,
      p.title as product_title
    into v_variant
    from public.product_variants v
    join public.products p on p.id = v.product_id
    where v.id = v_line.variant_id;

    select pm.secure_url into v_image_url
    from public.product_media pm
    where pm.product_id = v_variant.product_id and pm.secure_url is not null
    order by (pm.variant_id = v_variant.variant_id) desc, pm.is_primary desc, pm.sort_order, pm.id
    limit 1;

    insert into public.order_items (
      order_id, product_id, variant_id, product_title_snapshot, sku_snapshot,
      variant_attributes_snapshot, quantity, unit_price_minor, line_total_minor,
      delivery_scope_snapshot, image_url_snapshot
    ) values (
      v_order_id, v_variant.product_id, v_variant.variant_id, v_variant.product_title, v_variant.sku,
      jsonb_strip_nulls(jsonb_build_object(
        'ram', v_variant.ram_display,
        'storage', v_variant.storage_display,
        'color', v_variant.color_finish,
        'ptaStatus', v_variant.pta_status::text,
        'condition', v_variant.condition::text,
        'warranty', v_variant.warranty
      )),
      v_line.quantity, v_variant.price_minor, v_variant.price_minor * v_line.quantity,
      v_variant.delivery_scope, v_image_url
    );
  end loop;

  return query
  select v_order_id, v_order_number, p_payment_method, v_shipping_method, v_subtotal,
    v_delivery_fee_minor, v_shipping_surcharge_minor, v_total_minor;
end;
$$;

revoke all on function public.create_storefront_order(text, text, text, text, text, text, text, text, text, text, jsonb) from public;
grant execute on function public.create_storefront_order(text, text, text, text, text, text, text, text, text, text, jsonb) to anon, authenticated;

comment on function public.create_storefront_order(text, text, text, text, text, text, text, text, text, text, jsonb) is 'Anonymous/authenticated storefront order creation with server-side catalog price, inventory, payment, delivery eligibility, and final delivery fee calculation (Rs 200 standard below Rs 10,000, free at/above; Fast adds Rs 200).';

commit;
