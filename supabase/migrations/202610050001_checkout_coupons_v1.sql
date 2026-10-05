begin;

-- Checkout coupon codes v1 (Owner request, 2026-10-05). Production-safe: schema, functions and
-- grants only; no data changes, no catalog assumptions. Applies the same way to dev and production.
--
-- Coupon types (exactly three):
--   percentage    discount_value = whole percent 1..100 of the ELIGIBLE merchandise subtotal,
--                 rounded DOWN to a whole rupee, optionally capped by maximum_discount_minor.
--   fixed_amount  discount_value = amount in minor units (paisa), capped at the eligible subtotal.
--   free_shipping discount_value is NULL; removes the order's delivery charge (Standard or Fast,
--                 including the Fast surcharge). Merchandise subtotal is unchanged.
--
-- Rules (enforced server-side; the storefront preview is informational only):
--   * Codes: trimmed, stored upper-case, matched case-insensitively; 3-32 chars of A-Z 0-9 - _.
--   * is_active = false, a future starts_at or a past ends_at always fails.
--   * minimum_order_minor is compared with the WHOLE pre-discount merchandise subtotal (all cart
--     lines, shipping excluded), even for category/product coupons: it is an order-size threshold.
--   * applies_to: all = every line; category = lines whose product is in the category or in a direct
--     sub-category (e.g. Gadgets covers Laptops and Tablets); product = lines of that product only.
--     The discount is computed on eligible lines only; a cart with no eligible line is rejected.
--   * Shipping is always priced from the PRE-DISCOUNT merchandise subtotal (Rs 200 below Rs 10,000,
--     free at/above; Fast adds Rs 200), so a coupon never changes delivery eligibility.
--   * Final total = subtotal - discount + delivery fee - shipping discount, never below zero.
--   * Usage: total_usage_limit counts all redemptions; per_customer_usage_limit counts redemptions
--     for the same normalised phone number (guest checkout identity, stored only as a peppered hash).
--     A redemption is recorded atomically with its order and stock reservation. A failed order
--     records nothing. CANCELLED ORDERS KEEP THEIR REDEMPTION (usage is not restored), so a
--     coupon cannot be replayed by ordering and cancelling. Stock is still restored on cancellation.
--   * The coupon row is locked FOR UPDATE inside create_storefront_order, so concurrent orders
--     using the same coupon queue and the usage limits cannot be exceeded.

-- ---------------------------------------------------------------------------------------------
-- 1. Coupon definitions (managed by Owner/Admin only)
-- ---------------------------------------------------------------------------------------------
create table public.coupons (
  id uuid primary key default extensions.gen_random_uuid(),
  code text not null,
  name text not null,
  description text,
  discount_type text not null,
  discount_value bigint,
  minimum_order_minor bigint,
  maximum_discount_minor bigint,
  starts_at timestamptz,
  ends_at timestamptz,
  total_usage_limit integer,
  per_customer_usage_limit integer,
  applies_to text not null default 'all',
  category_id uuid references public.categories(id) on delete restrict,
  product_id uuid references public.products(id) on delete restrict,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint coupons_code_format check (code ~ '^[A-Z0-9][A-Z0-9_-]{2,31}$'),
  constraint coupons_name_not_blank check (char_length(btrim(name)) between 1 and 120),
  constraint coupons_description_length check (description is null or char_length(description) <= 1000),
  constraint coupons_discount_type_check check (discount_type in ('percentage', 'fixed_amount', 'free_shipping')),
  constraint coupons_discount_value_valid check (
    (discount_type = 'percentage' and discount_value between 1 and 100)
    or (discount_type = 'fixed_amount' and discount_value > 0)
    or (discount_type = 'free_shipping' and discount_value is null)
  ),
  constraint coupons_minimum_order_valid check (minimum_order_minor is null or minimum_order_minor >= 0),
  constraint coupons_maximum_discount_valid check (
    maximum_discount_minor is null or (discount_type = 'percentage' and maximum_discount_minor > 0)
  ),
  constraint coupons_dates_valid check (starts_at is null or ends_at is null or ends_at > starts_at),
  constraint coupons_total_usage_limit_valid check (total_usage_limit is null or total_usage_limit > 0),
  constraint coupons_per_customer_usage_limit_valid check (per_customer_usage_limit is null or per_customer_usage_limit > 0),
  constraint coupons_scope_valid check (
    (applies_to = 'all' and category_id is null and product_id is null)
    or (applies_to = 'category' and category_id is not null and product_id is null)
    or (applies_to = 'product' and product_id is not null and category_id is null)
  )
);
create unique index coupons_code_key on public.coupons (code);
create index coupons_category_idx on public.coupons (category_id) where category_id is not null;
create index coupons_product_idx on public.coupons (product_id) where product_id is not null;
comment on table public.coupons is
  'Checkout coupon codes (v1: percentage, fixed_amount, free_shipping). Managed by Owner/Admin; storefront access only through validate_storefront_coupon and create_storefront_order.';

-- Canonical storage: trimmed upper-case code, trimmed name, blank description -> NULL.
create function public.canonicalize_coupon()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.code := upper(btrim(coalesce(new.code, '')));
  new.name := btrim(coalesce(new.name, ''));
  new.description := nullif(btrim(coalesce(new.description, '')), '');
  return new;
end;
$$;
create trigger coupons_canonicalize before insert or update on public.coupons
  for each row execute function public.canonicalize_coupon();
create trigger coupons_set_updated_at before update on public.coupons
  for each row execute function public.set_updated_at();

alter table public.coupons enable row level security;
revoke all on table public.coupons from public, anon, authenticated;
grant select, insert, update, delete on table public.coupons to authenticated;
create policy coupons_admin_select on public.coupons for select to authenticated
  using ((select public.is_catalog_admin()));
create policy coupons_admin_insert on public.coupons for insert to authenticated
  with check ((select public.is_catalog_admin()));
create policy coupons_admin_update on public.coupons for update to authenticated
  using ((select public.is_catalog_admin())) with check ((select public.is_catalog_admin()));
create policy coupons_admin_delete on public.coupons for delete to authenticated
  using ((select public.is_catalog_admin()));

-- ---------------------------------------------------------------------------------------------
-- 2. Orders: coupon snapshot and discount amounts (existing orders keep 0 / NULL)
-- ---------------------------------------------------------------------------------------------
alter table public.orders
  add column coupon_id uuid references public.coupons(id) on delete restrict,
  add column coupon_code_snapshot text,
  add column discount_minor bigint not null default 0,
  add column shipping_discount_minor bigint not null default 0;
alter table public.orders
  add constraint orders_discounts_non_negative check (discount_minor >= 0 and shipping_discount_minor >= 0),
  add constraint orders_coupon_snapshot_consistent check ((coupon_id is null) = (coupon_code_snapshot is null)),
  add constraint orders_discount_within_subtotal check (discount_minor <= subtotal_minor),
  add constraint orders_shipping_discount_within_fee check (shipping_discount_minor <= coalesce(delivery_fee_minor, 0));
-- Enforced for every new/updated order; existing rows are not re-validated (NOT VALID).
alter table public.orders
  add constraint orders_total_matches_components check (
    delivery_fee_minor is null
    or total_minor = subtotal_minor - discount_minor + delivery_fee_minor - shipping_discount_minor
  ) not valid;
create index orders_coupon_idx on public.orders (coupon_id) where coupon_id is not null;
comment on column public.orders.subtotal_minor is 'Merchandise subtotal before any coupon discount.';
comment on column public.orders.delivery_fee_minor is 'Delivery fee priced from the pre-discount subtotal, before any free-shipping coupon.';
comment on column public.orders.discount_minor is 'Coupon merchandise discount (minor units).';
comment on column public.orders.shipping_discount_minor is 'Coupon shipping discount (minor units); equals delivery_fee_minor for a free-shipping coupon.';
comment on column public.orders.total_minor is 'Final charged total = subtotal - discount + delivery fee - shipping discount.';

-- ---------------------------------------------------------------------------------------------
-- 3. Redemptions (written only by create_storefront_order, in the order's transaction)
-- ---------------------------------------------------------------------------------------------
create table public.coupon_redemptions (
  id bigint generated always as identity primary key,
  coupon_id uuid not null references public.coupons(id) on delete restrict,
  order_id uuid not null references public.orders(id) on delete cascade,
  customer_phone_hash text not null,
  discount_minor bigint not null,
  shipping_discount_minor bigint not null default 0,
  created_at timestamptz not null default now(),
  constraint coupon_redemptions_order_unique unique (order_id),
  constraint coupon_redemptions_hash_check check (customer_phone_hash ~ '^[0-9a-f]{64}$'),
  constraint coupon_redemptions_amounts_check check (discount_minor >= 0 and shipping_discount_minor >= 0)
);
create index coupon_redemptions_coupon_idx on public.coupon_redemptions (coupon_id);
create index coupon_redemptions_customer_idx on public.coupon_redemptions (coupon_id, customer_phone_hash);
comment on table public.coupon_redemptions is
  'One row per order that used a coupon. Customer identity is a peppered sha256 of the normalised phone (no raw phone). Kept when the order is cancelled.';
alter table public.coupon_redemptions enable row level security;
revoke all on table public.coupon_redemptions from public, anon, authenticated;
grant select on table public.coupon_redemptions to authenticated;
create policy coupon_redemptions_admin_select on public.coupon_redemptions for select to authenticated
  using ((select public.is_catalog_admin()));

-- Coupon validation calls are rate limited per trusted client IP (guessing protection).
alter table public.request_rate_limit_events drop constraint request_rate_limit_events_scope_check;
alter table public.request_rate_limit_events add constraint request_rate_limit_events_scope_check check (scope in (
  'order_phone', 'order_ip', 'contact_email', 'contact_ip', 'newsletter_email', 'newsletter_ip', 'coupon_ip'));

-- ---------------------------------------------------------------------------------------------
-- 4. Pricing helpers (internal)
-- ---------------------------------------------------------------------------------------------
-- Locked shipping rule, priced from the PRE-DISCOUNT merchandise subtotal.
create function public.storefront_delivery_fee(p_subtotal_minor bigint, p_shipping_method text)
returns bigint
language sql
immutable
set search_path = ''
as $$
  select ((case when p_subtotal_minor >= 1000000 then 0 else 20000 end)
        + (case when p_shipping_method = 'fast' then 20000 else 0 end))::bigint;
$$;

-- Per-customer coupon identity: peppered sha256 of the normalised phone (same normalisation and
-- pepper as the storefront rate limits, with its own scope). NULL for a missing phone.
create function public.coupon_customer_hash(p_phone text)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when public.normalize_rate_limit_phone(p_phone) is null then null
    else encode(sha256(convert_to(s.pepper || ':coupon_phone:' || public.normalize_rate_limit_phone(p_phone), 'UTF8')), 'hex')
  end
  from public.request_rate_limit_secret s;
$$;

-- Evaluates one coupon against a cart. Prices come from the catalog (never the browser).
-- r_reason = 'ok' or a reason code: coupon_invalid, coupon_inactive, coupon_not_started,
-- coupon_expired, cart_invalid, coupon_not_applicable, coupon_minimum_not_met,
-- coupon_usage_limit_reached, coupon_customer_limit_reached.
-- p_lock = true takes a FOR UPDATE lock on the coupon row (order creation).
create function public.evaluate_storefront_coupon(
  p_code text,
  p_items jsonb,
  p_shipping_method text,
  p_customer_hash text,
  p_lock boolean
)
returns table (
  r_reason text,
  r_coupon_id uuid,
  r_code text,
  r_discount_type text,
  r_subtotal_minor bigint,
  r_eligible_subtotal_minor bigint,
  r_discount_minor bigint,
  r_delivery_fee_minor bigint,
  r_shipping_discount_minor bigint,
  r_total_minor bigint
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_code text := upper(btrim(coalesce(p_code, '')));
  v_coupon public.coupons%rowtype;
  v_method text := case when p_shipping_method = 'fast' then 'fast' else 'standard' end;
  v_requested integer;
  v_distinct integer;
  v_lines integer;
  v_subtotal bigint;
  v_eligible bigint;
  v_delivery bigint;
  v_discount bigint := 0;
  v_shipping_discount bigint := 0;
  v_used integer;
begin
  r_code := v_code;

  if v_code !~ '^[A-Z0-9][A-Z0-9_-]{2,31}$' then
    r_reason := 'coupon_invalid'; return next; return;
  end if;
  if p_lock then
    select * into v_coupon from public.coupons c where c.code = v_code for update;
  else
    select * into v_coupon from public.coupons c where c.code = v_code;
  end if;
  if not found then
    r_reason := 'coupon_invalid'; return next; return;
  end if;
  if not v_coupon.is_active then
    r_reason := 'coupon_inactive'; return next; return;
  end if;
  if v_coupon.starts_at is not null and v_coupon.starts_at > now() then
    r_reason := 'coupon_not_started'; return next; return;
  end if;
  if v_coupon.ends_at is not null and v_coupon.ends_at <= now() then
    r_reason := 'coupon_expired'; return next; return;
  end if;

  -- Cart lines: same orderable-variant rules as create_storefront_order.
  if p_items is null or jsonb_typeof(p_items) <> 'array'
    or jsonb_array_length(p_items) = 0 or jsonb_array_length(p_items) > 20
    or exists (
      select 1 from jsonb_to_recordset(p_items) as req(variant_id uuid, quantity integer)
      where req.variant_id is null or req.quantity is null or req.quantity < 1 or req.quantity > 20
    ) then
    r_reason := 'cart_invalid'; return next; return;
  end if;
  select count(*), count(distinct req.variant_id) into v_requested, v_distinct
  from jsonb_to_recordset(p_items) as req(variant_id uuid, quantity integer);

  with req as (
    select x.variant_id, x.quantity from jsonb_to_recordset(p_items) as x(variant_id uuid, quantity integer)
  ), lines as (
    select req.quantity::bigint * v.price_minor as line_total, p.id as line_product_id,
      p.category_id as line_category_id, cat.parent_id as line_parent_category_id
    from req
    join public.product_variants v on v.id = req.variant_id and v.is_active and v.price_minor > 0
    join public.products p on p.id = v.product_id
    join public.categories cat on cat.id = p.category_id
    left join public.brands b on b.id = p.brand_id
    where p.data_class = 'real'
      and p.publication_status = 'published'
      and p.published_at is not null
      and cat.data_class = 'real' and cat.is_active
      and (p.brand_id is null or (b.id is not null and b.data_class = 'real' and b.is_active))
  )
  select count(*),
    coalesce(sum(lines.line_total), 0),
    coalesce(sum(lines.line_total) filter (where
      v_coupon.applies_to = 'all'
      or (v_coupon.applies_to = 'category'
          and (lines.line_category_id = v_coupon.category_id or lines.line_parent_category_id = v_coupon.category_id))
      or (v_coupon.applies_to = 'product' and lines.line_product_id = v_coupon.product_id)
    ), 0)
  into v_lines, v_subtotal, v_eligible
  from lines;

  if v_lines <> v_requested or v_distinct <> v_requested then
    r_reason := 'cart_invalid'; return next; return;
  end if;
  if v_eligible <= 0 then
    r_reason := 'coupon_not_applicable'; return next; return;
  end if;
  if v_coupon.minimum_order_minor is not null and v_subtotal < v_coupon.minimum_order_minor then
    r_reason := 'coupon_minimum_not_met'; return next; return;
  end if;
  if v_coupon.total_usage_limit is not null then
    select count(*) into v_used from public.coupon_redemptions cr where cr.coupon_id = v_coupon.id;
    if v_used >= v_coupon.total_usage_limit then
      r_reason := 'coupon_usage_limit_reached'; return next; return;
    end if;
  end if;
  if v_coupon.per_customer_usage_limit is not null and p_customer_hash is not null then
    select count(*) into v_used from public.coupon_redemptions cr
    where cr.coupon_id = v_coupon.id and cr.customer_phone_hash = p_customer_hash;
    if v_used >= v_coupon.per_customer_usage_limit then
      r_reason := 'coupon_customer_limit_reached'; return next; return;
    end if;
  end if;

  v_delivery := public.storefront_delivery_fee(v_subtotal, v_method);
  if v_coupon.discount_type = 'percentage' then
    -- Whole-rupee discount, rounded down (integer division of positive values floors).
    v_discount := (v_eligible * v_coupon.discount_value / 10000) * 100;
    if v_coupon.maximum_discount_minor is not null then
      v_discount := least(v_discount, v_coupon.maximum_discount_minor);
    end if;
  elsif v_coupon.discount_type = 'fixed_amount' then
    v_discount := least(v_coupon.discount_value, v_eligible);
  else
    v_shipping_discount := v_delivery;
  end if;
  v_discount := least(greatest(v_discount, 0), v_subtotal);
  v_shipping_discount := least(greatest(v_shipping_discount, 0), v_delivery);

  r_reason := 'ok';
  r_coupon_id := v_coupon.id;
  r_code := v_coupon.code;
  r_discount_type := v_coupon.discount_type;
  r_subtotal_minor := v_subtotal;
  r_eligible_subtotal_minor := v_eligible;
  r_discount_minor := v_discount;
  r_delivery_fee_minor := v_delivery;
  r_shipping_discount_minor := v_shipping_discount;
  r_total_minor := v_subtotal - v_discount + v_delivery - v_shipping_discount;
  return next;
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- 5. Storefront coupon preview (informational; order creation re-validates everything)
-- ---------------------------------------------------------------------------------------------
create function public.validate_storefront_coupon(
  p_code text,
  p_items jsonb,
  p_shipping_method text default 'standard',
  p_phone text default null
)
returns table (
  valid boolean,
  reason text,
  code text,
  discount_type text,
  subtotal_minor bigint,
  eligible_subtotal_minor bigint,
  discount_minor bigint,
  delivery_fee_minor bigint,
  shipping_discount_minor bigint,
  total_minor bigint
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_result record;
begin
  perform public.enforce_request_rate_limit('coupon_ip', public.request_client_ip(), 30, interval '15 minutes');
  select * into v_result
  from public.evaluate_storefront_coupon(p_code, p_items, p_shipping_method, public.coupon_customer_hash(p_phone), false);
  return query select
    v_result.r_reason = 'ok', v_result.r_reason, v_result.r_code, v_result.r_discount_type,
    v_result.r_subtotal_minor, v_result.r_eligible_subtotal_minor, v_result.r_discount_minor,
    v_result.r_delivery_fee_minor, v_result.r_shipping_discount_minor, v_result.r_total_minor;
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- 6. Storefront order: 202610020001 plus an optional coupon (new trailing parameter + columns)
-- ---------------------------------------------------------------------------------------------
drop function public.create_storefront_order(text, text, text, text, text, text, text, text, text, text, jsonb);

create function public.create_storefront_order(
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
  p_items jsonb,
  p_coupon_code text default null
)
returns table (
  order_id uuid,
  order_number text,
  payment_method text,
  shipping_method text,
  subtotal_minor bigint,
  delivery_fee_minor bigint,
  shipping_surcharge_minor bigint,
  total_minor bigint,
  coupon_code text,
  discount_minor bigint,
  shipping_discount_minor bigint
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
  v_coupon_input text := nullif(upper(btrim(coalesce(p_coupon_code, ''))), '');
  v_order_id uuid;
  v_order_number text;
  v_subtotal bigint := 0;
  v_has_karachi_only boolean := false;
  v_has_nationwide boolean := false;
  v_delivery_classification text;
  v_line record;
  v_variant record;
  v_image_url text;
  v_fast_surcharge_minor constant bigint := 20000; -- Rs 200
  v_shipping_surcharge_minor bigint := 0;
  v_delivery_fee_minor bigint;
  v_coupon record;
  v_coupon_id uuid;
  v_coupon_code text;
  v_customer_hash text;
  v_discount_minor bigint := 0;
  v_shipping_discount_minor bigint := 0;
  v_total_minor bigint;
begin
  if v_customer_name is null or char_length(v_customer_name) > 160 then
    raise exception 'customer_name_required';
  end if;
  if v_phone is null then
    raise exception 'phone_required';
  end if;
  if char_length(v_phone) > 40
    or v_phone !~ '^[0-9+() -]+$'
    or char_length(regexp_replace(v_phone, '[^0-9]', '', 'g')) not between 10 and 15 then
    raise exception 'phone_invalid';
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

  -- Anti-abuse (202610020001): checked before any variant is locked or stock is taken. A blocked
  -- request raises here, so it creates no order, no items and no inventory movement.
  perform public.enforce_request_rate_limit('order_phone', public.normalize_rate_limit_phone(v_phone), 5, interval '15 minutes');
  perform public.enforce_request_rate_limit('order_ip', public.request_client_ip(), 20, interval '15 minutes');

  -- Lock every requested variant (in id order, so concurrent orders queue without deadlocks).
  -- The stock checks below run after the lock, so they see stock taken by any order that
  -- committed while this one waited.
  perform 1
  from public.product_variants v
  where v.id in (select requested.variant_id from jsonb_to_recordset(p_items) as requested(variant_id uuid, quantity integer))
  order by v.id
  for update;

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

  -- Shipping (authoritative, server-side only), always from the PRE-DISCOUNT subtotal:
  -- Rs 200 below Rs 10,000, free at/above; Fast Delivery adds a Rs 200 surcharge.
  v_shipping_surcharge_minor := case when v_shipping_method = 'fast' then v_fast_surcharge_minor else 0 end;
  v_delivery_fee_minor := public.storefront_delivery_fee(v_subtotal, v_shipping_method);

  -- Coupon (authoritative): the coupon row is locked so usage limits hold under concurrency;
  -- any failure aborts the whole order (nothing is created, no stock taken, no usage recorded).
  if v_coupon_input is not null then
    v_customer_hash := public.coupon_customer_hash(v_phone);
    select * into v_coupon
    from public.evaluate_storefront_coupon(v_coupon_input, p_items, v_shipping_method, v_customer_hash, true);
    if v_coupon.r_reason is distinct from 'ok' then
      raise exception using errcode = 'P0001', message = coalesce(v_coupon.r_reason, 'coupon_invalid');
    end if;
    if v_coupon.r_subtotal_minor <> v_subtotal or v_coupon.r_delivery_fee_minor <> v_delivery_fee_minor then
      raise exception 'order_pricing_mismatch';
    end if;
    v_coupon_id := v_coupon.r_coupon_id;
    v_coupon_code := v_coupon.r_code;
    v_discount_minor := v_coupon.r_discount_minor;
    v_shipping_discount_minor := v_coupon.r_shipping_discount_minor;
  end if;

  v_total_minor := v_subtotal - v_discount_minor + v_delivery_fee_minor - v_shipping_discount_minor;
  if v_total_minor < 0 then
    raise exception 'order_total_invalid';
  end if;

  v_order_number := 'ISP-ORD-' || lpad(nextval('public.storefront_order_number_seq')::text, 6, '0');

  insert into public.orders (
    order_number, customer_name, phone, email, city, other_city,
    full_delivery_address, area_landmark, order_notes, payment_method,
    shipping_method, shipping_surcharge_minor,
    delivery_classification, subtotal_minor, delivery_fee_minor, total_minor, status,
    coupon_id, coupon_code_snapshot, discount_minor, shipping_discount_minor
  ) values (
    v_order_number, v_customer_name, v_phone, v_email, v_city, v_other_city,
    v_address, v_landmark, v_notes, p_payment_method,
    v_shipping_method, v_shipping_surcharge_minor,
    v_delivery_classification, v_subtotal, v_delivery_fee_minor, v_total_minor, 'new',
    v_coupon_id, v_coupon_code, v_discount_minor, v_shipping_discount_minor
  ) returning id into v_order_id;

  if v_coupon_id is not null then
    insert into public.coupon_redemptions (coupon_id, order_id, customer_phone_hash, discount_minor, shipping_discount_minor)
    values (v_coupon_id, v_order_id, v_customer_hash, v_discount_minor, v_shipping_discount_minor);
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

    -- Take the stock: one outgoing movement per order line.
    insert into public.inventory_movements (variant_id, quantity_delta, reason, reference, note, actor_id)
    values (v_line.variant_id, -v_line.quantity, 'sale', 'order:' || v_order_id::text,
      'Storefront order ' || v_order_number, auth.uid());
  end loop;

  -- Defence in depth: stock can never end below zero.
  if exists (
    select 1
    from jsonb_to_recordset(p_items) as requested(variant_id uuid, quantity integer)
    where (select coalesce(sum(m.quantity_delta), 0) from public.inventory_movements m where m.variant_id = requested.variant_id) < 0
  ) then
    raise exception 'variant_out_of_stock';
  end if;

  return query
  select v_order_id, v_order_number, p_payment_method, v_shipping_method, v_subtotal,
    v_delivery_fee_minor, v_shipping_surcharge_minor, v_total_minor,
    v_coupon_code, v_discount_minor, v_shipping_discount_minor;
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- 7. Privileges: storefront entry points only; helpers are internal
-- ---------------------------------------------------------------------------------------------
revoke all on function public.canonicalize_coupon() from public, anon, authenticated;
revoke all on function public.storefront_delivery_fee(bigint, text) from public, anon, authenticated;
revoke all on function public.coupon_customer_hash(text) from public, anon, authenticated;
revoke all on function public.evaluate_storefront_coupon(text, jsonb, text, text, boolean) from public, anon, authenticated;

revoke all on function public.validate_storefront_coupon(text, jsonb, text, text) from public, anon, authenticated;
grant execute on function public.validate_storefront_coupon(text, jsonb, text, text) to anon, authenticated;

revoke all on function public.create_storefront_order(text, text, text, text, text, text, text, text, text, text, jsonb, text) from public, anon, authenticated;
grant execute on function public.create_storefront_order(text, text, text, text, text, text, text, text, text, text, jsonb, text) to anon, authenticated;

comment on function public.validate_storefront_coupon(text, jsonb, text, text) is
  'Storefront coupon preview (rate limited per IP). Returns reason/discount/totals only; informational — create_storefront_order re-validates.';
comment on function public.create_storefront_order(text, text, text, text, text, text, text, text, text, text, jsonb, text) is 'Anonymous/authenticated storefront order creation with server-side catalog price, locked stock check and stock decrement (sale movements), payment, phone, per-phone/IP rate limit, delivery eligibility, final delivery fee calculation (Rs 200 standard below Rs 10,000, free at/above; Fast adds Rs 200) and optional coupon (locked, re-validated, redemption recorded atomically).';

commit;
