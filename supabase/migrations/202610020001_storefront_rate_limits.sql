begin;

-- Lightweight anti-abuse rate limits for the three anonymous storefront write RPCs
-- (Owner request, 2026-10-02). Database-side; guest checkout stays enabled; no CAPTCHA.
--
--   create_storefront_order : 5 per phone number, 20 per trusted client IP, per 15 minutes
--   submit_contact_message  : 5 per email address, 20 per trusted client IP, per 15 minutes
--   subscribe_newsletter    : 5 per email address, 20 per trusted client IP, per 15 minutes
--
-- * The check runs inside the RPC, before anything is written (for orders: before any variant
--   row is locked or stock is taken). A blocked request raises 'rate_limited', so its whole
--   transaction (order, items, inventory movements) is discarded.
-- * Only requests that complete count. A request rejected for any other reason (validation,
--   out of stock, ...) rolls back with its transaction, including its rate-limit entry.
-- * Identities are never stored raw: each is normalised (phone -> local digits, email ->
--   lower-case) and stored only as sha256(secret pepper : scope : identity). The pepper is
--   generated once, here, and is readable by no API role.
-- * The IP limit is higher because many customers can share one address (mobile carrier NAT).
--   The only trusted IP source is cf-connecting-ip, which Cloudflare (in front of hosted
--   Supabase) sets and overwrites itself. x-forwarded-for and x-real-ip are client-suppliable
--   and are never read. A missing or malformed cf-connecting-ip skips the IP limit only; the
--   phone/email limit always runs. IPv4 is limited per address, IPv6 per /64 network (one
--   customer prefix), so rotating addresses inside a prefix does not escape the limit.
-- * Rows older than the window are removed for the identity on every call, and rows older than
--   a day are removed globally, so the table stays small.

create table if not exists public.request_rate_limit_events (
  id bigint generated always as identity primary key,
  scope text not null,
  identity_hash text not null,
  created_at timestamptz not null default now(),
  constraint request_rate_limit_events_scope_check check (scope in (
    'order_phone', 'order_ip', 'contact_email', 'contact_ip', 'newsletter_email', 'newsletter_ip')),
  constraint request_rate_limit_events_hash_check check (identity_hash ~ '^[0-9a-f]{64}$')
);
create index if not exists request_rate_limit_events_identity_idx
  on public.request_rate_limit_events (scope, identity_hash, created_at);
create index if not exists request_rate_limit_events_created_idx
  on public.request_rate_limit_events (created_at);
comment on table public.request_rate_limit_events is
  'Anti-abuse log for storefront RPCs: one row per accepted request (scope + peppered sha256 of the normalised phone/email/IP). No raw identifiers. Internal only.';
alter table public.request_rate_limit_events enable row level security;
revoke all on table public.request_rate_limit_events from public, anon, authenticated;

create table if not exists public.request_rate_limit_secret (
  singleton boolean primary key default true,
  pepper text not null,
  constraint request_rate_limit_secret_singleton check (singleton)
);
comment on table public.request_rate_limit_secret is
  'Random pepper for request_rate_limit_events hashes. Never exposed to API roles.';
alter table public.request_rate_limit_secret enable row level security;
revoke all on table public.request_rate_limit_secret from public, anon, authenticated;
insert into public.request_rate_limit_secret (singleton, pepper)
values (true, encode(sha256(convert_to(gen_random_uuid()::text || gen_random_uuid()::text || clock_timestamp()::text, 'UTF8')), 'hex'))
on conflict (singleton) do nothing;

-- Trusted client IP for rate limiting: only Cloudflare's cf-connecting-ip. Returns the IPv4
-- address, or the IPv6 /64 network (e.g. '2001:db8:1:2::/64'); NULL when the header is missing
-- or is not a single valid IP address (direct database sessions, malformed values).
create or replace function public.request_client_ip()
returns text
language plpgsql
stable
set search_path = ''
as $$
declare
  v_raw text;
  v_ip inet;
begin
  begin
    v_raw := btrim(coalesce(nullif(current_setting('request.headers', true), ''), '{}')::jsonb ->> 'cf-connecting-ip');
    -- A bare address only: no CIDR suffix, no zone id, nothing longer than an IPv6 address.
    if v_raw is null or v_raw = '' or char_length(v_raw) > 45 or v_raw !~ '^[0-9A-Fa-f.:]+$' then
      return null;
    end if;
    v_ip := v_raw::inet;
  exception when invalid_text_representation then
    return null;
  end;
  if family(v_ip) = 4 then
    return host(v_ip);
  end if;
  -- IPv4-mapped IPv6 (::ffff:a.b.c.d) is an IPv4 client; a /64 would lump all of them together.
  if v_ip << inet '::ffff:0.0.0.0/96' then
    return host(inet '0.0.0.0' + (v_ip - inet '::ffff:0.0.0.0'));
  end if;
  return host(network(set_masklen(v_ip, 64))) || '/64';
end;
$$;

-- One identity per customer phone: 0300 123 4567, +92 300 1234567 and 0092 300 1234567 match.
create or replace function public.normalize_rate_limit_phone(p_phone text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when d like '0092%' then '0' || substr(d, 5)
    when d like '92%' and char_length(d) = 12 then '0' || substr(d, 3)
    else nullif(d, '')
  end
  from (select regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g') as d) as digits;
$$;

-- Records one accepted request for (scope, identity), or raises 'rate_limited' when the identity
-- already has p_max requests inside p_window. A NULL/blank identity is not limited.
create or replace function public.enforce_request_rate_limit(
  p_scope text,
  p_identity text,
  p_max integer,
  p_window interval
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_hash text;
  v_count integer;
begin
  if p_identity is null or btrim(p_identity) = '' then
    return;
  end if;
  select encode(sha256(convert_to(s.pepper || ':' || p_scope || ':' || lower(btrim(p_identity)), 'UTF8')), 'hex')
  into v_hash
  from public.request_rate_limit_secret s;

  -- Concurrent requests for the same identity queue here, so a burst cannot all pass the count.
  perform pg_advisory_xact_lock(hashtextextended(p_scope || ':' || v_hash, 0));

  delete from public.request_rate_limit_events where created_at < now() - interval '1 day';
  delete from public.request_rate_limit_events
  where scope = p_scope and identity_hash = v_hash and created_at <= now() - p_window;

  select count(*) into v_count
  from public.request_rate_limit_events
  where scope = p_scope and identity_hash = v_hash and created_at > now() - p_window;
  if v_count >= p_max then
    raise exception using errcode = 'P0001', message = 'rate_limited',
      hint = 'Too many attempts. Please wait a few minutes and try again.';
  end if;

  insert into public.request_rate_limit_events (scope, identity_hash) values (p_scope, v_hash);
end;
$$;

-- Internal helpers: callable only from the storefront RPCs (which run as their owner).
revoke all on function public.request_client_ip() from public, anon, authenticated;
revoke all on function public.normalize_rate_limit_phone(text) from public, anon, authenticated;
revoke all on function public.enforce_request_rate_limit(text, text, integer, interval) from public, anon, authenticated;

-- Storefront order: unchanged from 202610010002 except the rate-limit checks.
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
    v_delivery_fee_minor, v_shipping_surcharge_minor, v_total_minor;
end;
$$;

revoke all on function public.create_storefront_order(text, text, text, text, text, text, text, text, text, text, jsonb) from public;
grant execute on function public.create_storefront_order(text, text, text, text, text, text, text, text, text, text, jsonb) to anon, authenticated;

comment on function public.create_storefront_order(text, text, text, text, text, text, text, text, text, text, jsonb) is 'Anonymous/authenticated storefront order creation with server-side catalog price, locked stock check and stock decrement (sale movements), payment, phone, per-phone/IP rate limit, delivery eligibility, and final delivery fee calculation (Rs 200 standard below Rs 10,000, free at/above; Fast adds Rs 200).';

-- Contact form: unchanged from 202609050002 except the rate-limit checks.
create or replace function public.submit_contact_message(
  p_name text,
  p_email text,
  p_phone text,
  p_message text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  normalized_name text := btrim(coalesce(p_name, ''));
  normalized_email text := lower(btrim(coalesce(p_email, '')));
  normalized_phone text := nullif(btrim(coalesce(p_phone, '')), '');
  normalized_message text := btrim(coalesce(p_message, ''));
begin
  if char_length(normalized_name) not between 1 and 120 then
    raise exception using errcode = '22023', message = 'invalid_name';
  end if;

  if char_length(normalized_email) > 320
    or normalized_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
  then
    raise exception using errcode = '22023', message = 'invalid_email';
  end if;

  if normalized_phone is not null and char_length(normalized_phone) not between 3 and 40 then
    raise exception using errcode = '22023', message = 'invalid_phone';
  end if;

  if char_length(normalized_message) not between 1 and 5000 then
    raise exception using errcode = '22023', message = 'invalid_message';
  end if;

  perform public.enforce_request_rate_limit('contact_email', normalized_email, 5, interval '15 minutes');
  perform public.enforce_request_rate_limit('contact_ip', public.request_client_ip(), 20, interval '15 minutes');

  insert into public.contact_messages (name, email, phone, message)
  values (normalized_name, normalized_email, normalized_phone, normalized_message);

  return true;
end;
$$;

revoke all on function public.submit_contact_message(text, text, text, text) from public;
grant execute on function public.submit_contact_message(text, text, text, text) to anon, authenticated;

-- Newsletter: unchanged from 202609050001 except the rate-limit checks.
create or replace function public.subscribe_newsletter(
  p_email text,
  p_source text default 'about_page'
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  normalized_email text := lower(btrim(coalesce(p_email, '')));
  normalized_source text := left(coalesce(nullif(btrim(p_source), ''), 'about_page'), 64);
begin
  if char_length(normalized_email) > 320
    or normalized_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
  then
    raise exception using
      errcode = '22023',
      message = 'invalid_email';
  end if;

  perform public.enforce_request_rate_limit('newsletter_email', normalized_email, 5, interval '15 minutes');
  perform public.enforce_request_rate_limit('newsletter_ip', public.request_client_ip(), 20, interval '15 minutes');

  insert into public.newsletter_subscribers (email, status, source)
  values (normalized_email, 'subscribed', normalized_source)
  on conflict ((lower(email))) do nothing;

  if found then
    return 'subscribed';
  end if;

  update public.newsletter_subscribers
  set status = 'subscribed',
      source = normalized_source,
      subscribed_at = now(),
      unsubscribed_at = null
  where lower(email) = normalized_email
    and status = 'unsubscribed';

  if found then
    return 'subscribed';
  end if;

  return 'already_subscribed';
end;
$$;

revoke all on function public.subscribe_newsletter(text, text) from public;
grant execute on function public.subscribe_newsletter(text, text) to anon, authenticated;

commit;
