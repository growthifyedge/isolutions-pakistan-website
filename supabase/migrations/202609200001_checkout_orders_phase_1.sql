begin;

create sequence if not exists public.storefront_order_number_seq as bigint start with 1 increment by 1;

create table if not exists public.orders (
  id uuid primary key default extensions.gen_random_uuid(),
  order_number text not null unique,
  customer_name text not null,
  phone text not null,
  email text,
  city text not null check (city in ('Karachi', 'Other city in Pakistan')),
  other_city text,
  full_delivery_address text not null,
  area_landmark text,
  order_notes text,
  payment_method text not null check (payment_method in ('cash_on_delivery', 'bank_transfer')),
  delivery_classification text not null check (delivery_classification in ('karachi_only', 'mixed', 'nationwide')),
  subtotal_minor bigint not null check (subtotal_minor >= 0),
  delivery_fee_minor bigint,
  total_minor bigint not null check (total_minor >= 0),
  status text not null default 'new' check (status = 'new'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint orders_customer_name_not_blank check (char_length(trim(customer_name)) between 1 and 160),
  constraint orders_phone_not_blank check (char_length(trim(phone)) between 3 and 40),
  constraint orders_address_not_blank check (char_length(trim(full_delivery_address)) between 1 and 1000),
  constraint orders_other_city_consistent check (
    (city = 'Karachi' and other_city is null)
    or (city = 'Other city in Pakistan' and char_length(trim(coalesce(other_city, ''))) between 1 and 120)
  )
);

create table if not exists public.order_items (
  id uuid primary key default extensions.gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete restrict,
  product_id uuid not null references public.products(id) on delete restrict,
  variant_id uuid not null references public.product_variants(id) on delete restrict,
  product_title_snapshot text not null,
  sku_snapshot text not null,
  variant_attributes_snapshot jsonb not null default '{}'::jsonb,
  quantity integer not null check (quantity > 0),
  unit_price_minor bigint not null check (unit_price_minor >= 0),
  line_total_minor bigint not null check (line_total_minor >= 0),
  delivery_scope_snapshot public.delivery_scope not null,
  image_url_snapshot text,
  created_at timestamptz not null default now(),
  constraint order_items_line_total_matches check (line_total_minor = unit_price_minor * quantity)
);

create index if not exists orders_order_number_idx on public.orders(order_number);
create index if not exists orders_created_at_idx on public.orders(created_at desc);
create index if not exists orders_status_idx on public.orders(status, created_at desc);
create index if not exists order_items_order_id_idx on public.order_items(order_id);

drop trigger if exists orders_set_updated_at on public.orders;
create trigger orders_set_updated_at before update on public.orders
for each row execute function public.set_updated_at();

alter table public.orders enable row level security;
alter table public.order_items enable row level security;

revoke all on public.orders, public.order_items from anon, authenticated;
grant select, update on public.orders to authenticated;
grant select on public.order_items to authenticated;

drop policy if exists orders_admin_select on public.orders;
drop policy if exists orders_admin_update on public.orders;
drop policy if exists order_items_admin_select on public.order_items;
create policy orders_admin_select on public.orders for select to authenticated
using ((select public.is_catalog_admin()));
create policy orders_admin_update on public.orders for update to authenticated
using ((select public.is_catalog_admin())) with check ((select public.is_catalog_admin()));
create policy order_items_admin_select on public.order_items for select to authenticated
using ((select public.is_catalog_admin()));

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
  p_items jsonb
)
returns table (
  order_id uuid,
  order_number text,
  payment_method text,
  subtotal_minor bigint,
  delivery_fee_minor bigint,
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
  v_order_id uuid;
  v_order_number text;
  v_subtotal bigint := 0;
  v_has_karachi_only boolean := false;
  v_has_nationwide boolean := false;
  v_delivery_classification text;
  v_line record;
  v_variant record;
  v_image_url text;
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
    join public.brands b on b.id = p.brand_id
    join public.categories c on c.id = p.category_id
    left join public.inventory_movements m on m.variant_id = v.id
    where v.id = v_line.variant_id
      and v.is_active
      and p.data_class = 'real'
      and p.publication_status = 'published'
      and p.published_at is not null
      and b.data_class = 'real' and b.is_active
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
  v_order_number := 'ISP-ORD-' || lpad(nextval('public.storefront_order_number_seq')::text, 6, '0');

  insert into public.orders (
    order_number, customer_name, phone, email, city, other_city,
    full_delivery_address, area_landmark, order_notes, payment_method,
    delivery_classification, subtotal_minor, delivery_fee_minor, total_minor, status
  ) values (
    v_order_number, v_customer_name, v_phone, v_email, v_city, v_other_city,
    v_address, v_landmark, v_notes, p_payment_method,
    v_delivery_classification, v_subtotal, null, v_subtotal, 'new'
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
  select v_order_id, v_order_number, p_payment_method, v_subtotal, null::bigint, v_subtotal;
end;
$$;

revoke all on function public.create_storefront_order(text, text, text, text, text, text, text, text, text, jsonb) from public;
grant execute on function public.create_storefront_order(text, text, text, text, text, text, text, text, text, jsonb) to anon, authenticated;

comment on table public.orders is 'Storefront checkout orders. Public writes are permitted only through create_storefront_order.';
comment on table public.order_items is 'Immutable commercial snapshots created atomically with a storefront order.';
comment on function public.create_storefront_order(text, text, text, text, text, text, text, text, text, jsonb) is 'Anonymous/authenticated storefront order creation with server-side catalog price, inventory, payment, and delivery validation.';

commit;
