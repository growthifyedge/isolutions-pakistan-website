begin;

-- Two-Vendor Order Management, step 2 of 2 (Owner approved for localhost, 2026-11-14). NOT YET APPLIED.
-- Requires 202611140001 (app_role 'staff'), 202611140002 (staff dashboard) and 202611150001 (net restore).
--
-- Vendors: 'isolutions' (iSolutions Pakistan) and 'piyavey' (Piyavey). Model (Owner decisions D1-D8):
--   * order_items.vendor_id    - which vendor fulfils the line. Set ONLY by Admin (admin_assign_order_items);
--                                checkout (create_storefront_order) is unchanged and leaves it NULL.
--   * order_fulfilments        - one row per (order, vendor): that vendor's own status, release time and
--                                stock-restored marker. Created only by admin_release_order_to_vendors, which
--                                refuses while any item is unassigned (D1). Its items are the order items with
--                                the same vendor_id.
--   * profiles.vendor_id       - every staff account belongs to exactly one vendor; non-staff have none.
--   * Staff read ONLY through SECURITY DEFINER RPCs that return their own vendor's released fulfilments, items
--     and item subtotal (D5). The Phase 2 staff RLS policies on orders / order_items / order_status_events /
--     order_staff_seen are removed, so staff have no direct table access to customer or order data at all.
--   * Staff write ONLY through staff_set_fulfilment_status (forward + cancel, own vendor) and
--     staff_mark_fulfilment_seen. No staff table grants or policies for writing exist.
--   * Parent order status = earliest active fulfilment stage; all cancelled = Cancelled; no active stage left
--     = Delivered (D6). Kept in sync by trigger; a direct status update of a split order that disagrees with
--     its fulfilments is refused, so bulk/direct Admin updates cannot bypass vendor rules (D7). Orders without
--     fulfilments (legacy and not-yet-released orders) keep every existing Admin action.
--   * Cancelling a fulfilment returns that vendor's stock exactly once (fulfilment stock_restored_at + the
--     existing unique return index); a later whole-order cancel returns only the rest (202611150001).
--   * Reassignment after release: Admin only, only while both the source and target fulfilments are Received
--     (D3). Recorded as an 'item_reassigned' history event; fulfilment rows are never deleted.
--   * Seen/Unseen per staff account per fulfilment (D8).
--   * Phase 2 order-level staff RPCs staff_set_order_status / staff_mark_order_seen /
--     admin_release_orders_to_staff are dropped (superseded; no staff account exists on DEV or PROD yet).

-- ---- 1. Vendors -------------------------------------------------------------------------------------------------
create table if not exists public.vendors (
  id uuid primary key default extensions.gen_random_uuid(),
  code text not null unique check (code ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  name text not null check (char_length(btrim(name)) between 1 and 120),
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);
comment on table public.vendors is 'Order fulfilment vendors (Owner-approved list; changed only by a reviewed migration).';

insert into public.vendors (code, name, sort_order) values
  ('isolutions', 'iSolutions Pakistan', 1),
  ('piyavey', 'Piyavey', 2)
on conflict (code) do nothing;

alter table public.vendors enable row level security;
revoke all on public.vendors from anon, authenticated;
grant select on public.vendors to authenticated;
drop policy if exists vendors_admin_select on public.vendors;
create policy vendors_admin_select on public.vendors for select to authenticated
  using ((select public.is_catalog_admin()));

-- ---- 2. Staff vendor + item vendor --------------------------------------------------------------------------------
alter table public.profiles add column if not exists vendor_id uuid references public.vendors(id) on delete restrict;
comment on column public.profiles.vendor_id is 'Vendor of a staff account (required for role staff, NULL for everyone else).';
alter table public.profiles drop constraint if exists profiles_vendor_matches_role;
alter table public.profiles add constraint profiles_vendor_matches_role check (
  (role is not distinct from 'staff'::public.app_role and vendor_id is not null)
  or (role is distinct from 'staff'::public.app_role and vendor_id is null)
);

alter table public.order_items add column if not exists vendor_id uuid references public.vendors(id) on delete restrict;
comment on column public.order_items.vendor_id is 'Vendor that fulfils this line. Set only by Admin (admin_assign_order_items); NULL = unassigned. Checkout never sets it.';
create index if not exists order_items_order_vendor_idx on public.order_items (order_id, vendor_id);

-- ---- 3. Fulfilments -----------------------------------------------------------------------------------------------
create table if not exists public.order_fulfilments (
  id uuid primary key default extensions.gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete restrict,
  vendor_id uuid not null references public.vendors(id) on delete restrict,
  status text not null default 'confirmed'
    check (status in ('confirmed', 'processing', 'in_transit', 'completed', 'cancelled')),
  released_at timestamptz not null default now(),
  stock_restored_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint order_fulfilments_order_vendor_key unique (order_id, vendor_id)
);
comment on table public.order_fulfilments is
  'One vendor''s part of an order: its own status (Received / In Process / In Transit / Delivered / Cancelled). Written only by RPCs.';
create index if not exists order_fulfilments_vendor_idx on public.order_fulfilments (vendor_id, released_at desc);

alter table public.order_fulfilments enable row level security;
revoke all on public.order_fulfilments from anon, authenticated;
grant select on public.order_fulfilments to authenticated;
drop policy if exists order_fulfilments_admin_select on public.order_fulfilments;
create policy order_fulfilments_admin_select on public.order_fulfilments for select to authenticated
  using ((select public.is_catalog_admin()));

-- A fulfilment is "live" while at least one order item carries its vendor (reassignment can empty one).
create or replace function public.fulfilment_has_items(p_order_id uuid, p_vendor_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.order_items oi where oi.order_id = p_order_id and oi.vendor_id = p_vendor_id);
$$;
revoke all on function public.fulfilment_has_items(uuid, uuid) from public, anon, authenticated;

-- Parent status from the live fulfilments (NULL = the order has none: legacy / not released).
create or replace function public.derive_order_status_from_fulfilments(p_order_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  with live as (
    select f.status from public.order_fulfilments f
    where f.order_id = p_order_id and public.fulfilment_has_items(f.order_id, f.vendor_id)
  )
  select case
    when not exists (select 1 from live) then null
    when not exists (select 1 from live where status <> 'cancelled') then 'cancelled'
    when not exists (select 1 from live where status in ('confirmed', 'processing', 'in_transit')) then 'completed'
    when exists (select 1 from live where status = 'confirmed') then 'confirmed'
    when exists (select 1 from live where status = 'processing') then 'processing'
    else 'in_transit'
  end;
$$;
revoke all on function public.derive_order_status_from_fulfilments(uuid) from public, anon, authenticated;

create or replace function public.sync_order_status_from_fulfilments(p_order_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status text := public.derive_order_status_from_fulfilments(p_order_id);
begin
  if v_status is not null then
    update public.orders o set status = v_status where o.id = p_order_id and o.status is distinct from v_status;
  end if;
end;
$$;
revoke all on function public.sync_order_status_from_fulfilments(uuid) from public, anon, authenticated;

-- Insert: always starts as Received, released now, stock not restored.
-- Update: order/vendor/release are immutable, cancelled is final, cancellation returns this vendor's stock once.
create or replace function public.guard_order_fulfilment()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order_number text;
  v_vendor_name text;
begin
  if tg_op = 'INSERT' then
    new.status := 'confirmed';
    new.released_at := now();
    new.stock_restored_at := null;
    new.created_at := now();
    new.updated_at := now();
    return new;
  end if;

  new.order_id := old.order_id;
  new.vendor_id := old.vendor_id;
  new.released_at := old.released_at;
  new.created_at := old.created_at;
  new.stock_restored_at := old.stock_restored_at;   -- set only below
  if new.status is distinct from old.status then new.updated_at := now(); else new.updated_at := old.updated_at; end if;

  if old.status = 'cancelled' and new.status is distinct from 'cancelled' then
    raise exception using errcode = 'check_violation', message = 'fulfilment_cancelled_is_final',
      detail = 'A cancelled vendor fulfilment cannot change status.';
  end if;

  if new.status = 'cancelled' and old.status is distinct from 'cancelled' and old.stock_restored_at is null then
    select o.order_number into v_order_number from public.orders o where o.id = old.order_id;
    select v.name into v_vendor_name from public.vendors v where v.id = old.vendor_id;
    -- Only this vendor's lines, and only what is still out (sale minus earlier returns). The unique index
    -- inventory_movements_order_return_once stays the hard once-per-variant guarantee.
    insert into public.inventory_movements (variant_id, quantity_delta, reason, reference, note, actor_id)
    select m.variant_id, (-sum(m.quantity_delta))::integer, 'return', m.reference,
      'Vendor part cancelled: ' || v_order_number || ' (' || v_vendor_name || ')', auth.uid()
    from public.inventory_movements m
    where m.reason in ('sale', 'return')
      and m.reference = 'order:' || old.order_id::text
      and m.variant_id in (
        select oi.variant_id from public.order_items oi where oi.order_id = old.order_id and oi.vendor_id = old.vendor_id)
    group by m.variant_id, m.reference
    having sum(m.quantity_delta) <> 0;
    new.stock_restored_at := now();
  end if;
  return new;
end;
$$;
revoke all on function public.guard_order_fulfilment() from public, anon, authenticated;

drop trigger if exists order_fulfilments_guard on public.order_fulfilments;
create trigger order_fulfilments_guard
  before insert or update on public.order_fulfilments
  for each row execute function public.guard_order_fulfilment();

-- ---- 4. History -----------------------------------------------------------------------------------------------
alter table public.order_status_events
  add column if not exists fulfilment_id uuid references public.order_fulfilments(id) on delete restrict,
  add column if not exists vendor_id uuid references public.vendors(id) on delete restrict,
  add column if not exists from_vendor_id uuid references public.vendors(id) on delete restrict,
  add column if not exists order_item_id uuid references public.order_items(id) on delete restrict;
alter table public.order_status_events drop constraint if exists order_status_events_event_check;
alter table public.order_status_events add constraint order_status_events_event_check
  check (event in ('status_changed', 'released', 'item_reassigned'));
create index if not exists order_status_events_fulfilment_idx on public.order_status_events (fulfilment_id, id)
  where fulfilment_id is not null;
comment on column public.order_status_events.fulfilment_id is 'Vendor fulfilment the event belongs to (NULL = whole-order event).';

-- Vendor events + parent sync after every fulfilment insert / status change.
create or replace function public.after_order_fulfilment_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role text;
begin
  select p.role::text into v_role from public.profiles p where p.id = (select auth.uid());
  if v_role not in ('owner', 'admin', 'staff') then v_role := null; end if;
  if tg_op = 'INSERT' then
    insert into public.order_status_events (order_id, event, from_status, to_status, actor_id, actor_role, fulfilment_id, vendor_id)
    values (new.order_id, 'released', null, new.status, (select auth.uid()), v_role, new.id, new.vendor_id);
  elsif new.status is distinct from old.status then
    insert into public.order_status_events (order_id, event, from_status, to_status, actor_id, actor_role, fulfilment_id, vendor_id)
    values (new.order_id, 'status_changed', old.status, new.status, (select auth.uid()), v_role, new.id, new.vendor_id);
  end if;
  perform public.sync_order_status_from_fulfilments(new.order_id);
  return null;
end;
$$;
revoke all on function public.after_order_fulfilment_change() from public, anon, authenticated;

drop trigger if exists order_fulfilments_after_change on public.order_fulfilments;
create trigger order_fulfilments_after_change
  after insert or update on public.order_fulfilments
  for each row execute function public.after_order_fulfilment_change();

-- ---- 5. Split orders: parent status follows the fulfilments only -------------------------------------------------
create or replace function public.guard_split_order_status()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_derived text;
begin
  if new.status is distinct from old.status
    and exists (select 1 from public.order_fulfilments f where f.order_id = new.id) then
    v_derived := public.derive_order_status_from_fulfilments(new.id);
    if v_derived is null or new.status is distinct from v_derived then
      raise exception using errcode = 'check_violation', message = 'split_order_status_managed_per_vendor',
        detail = format('Order %s is released to vendors; change each vendor''s status instead.', old.order_number);
    end if;
  end if;
  return new;
end;
$$;
revoke all on function public.guard_split_order_status() from public, anon, authenticated;

drop trigger if exists orders_guard_split_status on public.orders;
create trigger orders_guard_split_status
  before update on public.orders
  for each row execute function public.guard_split_order_status();

-- ---- 6. Seen markers (per staff account, per fulfilment) ---------------------------------------------------------
create table if not exists public.order_fulfilment_seen (
  fulfilment_id uuid not null references public.order_fulfilments(id) on delete restrict,
  staff_id uuid not null references auth.users(id) on delete cascade,
  seen_at timestamptz not null default now(),
  primary key (fulfilment_id, staff_id)
);
comment on table public.order_fulfilment_seen is 'Which staff account opened which vendor fulfilment (New badge). Written and read only by RPCs.';
alter table public.order_fulfilment_seen enable row level security;
revoke all on public.order_fulfilment_seen from anon, authenticated;

-- ---- 7. Remove the Phase 2 order-level staff access ----------------------------------------------------------------
drop policy if exists orders_staff_select on public.orders;
drop policy if exists order_items_staff_select on public.order_items;
drop policy if exists order_status_events_staff_select on public.order_status_events;
drop policy if exists order_staff_seen_own_select on public.order_staff_seen;
revoke all on public.order_staff_seen from anon, authenticated;
drop function if exists public.staff_set_order_status(uuid, text);
drop function if exists public.staff_mark_order_seen(uuid);
drop function if exists public.admin_release_orders_to_staff(uuid[]);

-- ---- 8. Staff identity --------------------------------------------------------------------------------------------
create or replace function public.current_staff_vendor()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select p.vendor_id
  from public.profiles p
  join public.vendors v on v.id = p.vendor_id
  where p.id = (select auth.uid())
    and p.role = 'staff'::public.app_role
    and p.is_active
    and v.is_active;
$$;
revoke all on function public.current_staff_vendor() from public, anon, authenticated;

-- Active staff account of an active vendor (the /staff sign-in gate).
create or replace function public.is_order_staff()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.current_staff_vendor() is not null;
$$;
revoke all on function public.is_order_staff() from public, anon;
grant execute on function public.is_order_staff() to authenticated;

create or replace function public.staff_current_vendor()
returns table (code text, name text)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if public.current_staff_vendor() is null then
    raise exception using errcode = 'insufficient_privilege', message = 'staff_access_required';
  end if;
  return query select v.code, v.name from public.vendors v where v.id = public.current_staff_vendor();
end;
$$;
revoke all on function public.staff_current_vendor() from public, anon;
grant execute on function public.staff_current_vendor() to authenticated;

-- ---- 9. Staff reads (own vendor only; no whole-order financials, no other vendor's lines) ----------------------
create or replace function public.staff_list_fulfilments()
returns table (
  fulfilment_id uuid, order_id uuid, order_number text, status text, released_at timestamptz, updated_at timestamptz,
  order_created_at timestamptz, customer_name text, phone text, email text, city text, other_city text,
  full_delivery_address text, area_landmark text, order_notes text, payment_method text, shipping_method text,
  items jsonb, vendor_subtotal_minor bigint, is_seen boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_vendor uuid := public.current_staff_vendor();
begin
  if v_vendor is null then
    raise exception using errcode = 'insufficient_privilege', message = 'staff_access_required';
  end if;
  return query
  select f.id, o.id, o.order_number, f.status, f.released_at, f.updated_at, o.created_at,
    o.customer_name, o.phone, o.email, o.city, o.other_city, o.full_delivery_address, o.area_landmark, o.order_notes,
    o.payment_method, o.shipping_method, lines.items, lines.subtotal,
    exists (select 1 from public.order_fulfilment_seen s where s.fulfilment_id = f.id and s.staff_id = (select auth.uid()))
  from public.order_fulfilments f
  join public.orders o on o.id = f.order_id
  join lateral (
    select jsonb_agg(jsonb_build_object(
        'id', oi.id, 'product_title_snapshot', oi.product_title_snapshot, 'sku_snapshot', oi.sku_snapshot,
        'variant_attributes_snapshot', oi.variant_attributes_snapshot, 'quantity', oi.quantity,
        'unit_price_minor', oi.unit_price_minor, 'line_total_minor', oi.line_total_minor
      ) order by oi.created_at, oi.id) as items,
      sum(oi.line_total_minor)::bigint as subtotal
    from public.order_items oi
    where oi.order_id = f.order_id and oi.vendor_id = f.vendor_id
  ) lines on lines.items is not null
  where f.vendor_id = v_vendor
  order by f.released_at desc, f.id;
end;
$$;
revoke all on function public.staff_list_fulfilments() from public, anon;
grant execute on function public.staff_list_fulfilments() to authenticated;

create or replace function public.staff_fulfilment_history(p_fulfilment_id uuid)
returns table (id bigint, event text, from_status text, to_status text, actor_role text, created_at timestamptz)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_vendor uuid := public.current_staff_vendor();
begin
  if v_vendor is null then
    raise exception using errcode = 'insufficient_privilege', message = 'staff_access_required';
  end if;
  if not exists (select 1 from public.order_fulfilments f where f.id = p_fulfilment_id and f.vendor_id = v_vendor) then
    raise exception using errcode = 'no_data_found', message = 'order_not_available';
  end if;
  return query
  select e.id, e.event, e.from_status, e.to_status, e.actor_role, e.created_at
  from public.order_status_events e
  where e.fulfilment_id = p_fulfilment_id and e.vendor_id = v_vendor and e.event in ('released', 'status_changed')
  order by e.id;
end;
$$;
revoke all on function public.staff_fulfilment_history(uuid) from public, anon;
grant execute on function public.staff_fulfilment_history(uuid) to authenticated;

-- ---- 10. Staff writes --------------------------------------------------------------------------------------------
create or replace function public.staff_mark_fulfilment_seen(p_fulfilment_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_vendor uuid := public.current_staff_vendor();
begin
  if v_vendor is null then
    raise exception using errcode = 'insufficient_privilege', message = 'staff_access_required';
  end if;
  if not exists (
    select 1 from public.order_fulfilments f
    where f.id = p_fulfilment_id and f.vendor_id = v_vendor and public.fulfilment_has_items(f.order_id, f.vendor_id)
  ) then
    raise exception using errcode = 'no_data_found', message = 'order_not_available';
  end if;
  insert into public.order_fulfilment_seen (fulfilment_id, staff_id)
  values (p_fulfilment_id, (select auth.uid()))
  on conflict (fulfilment_id, staff_id) do nothing;
  return true;
end;
$$;
revoke all on function public.staff_mark_fulfilment_seen(uuid) from public, anon;
grant execute on function public.staff_mark_fulfilment_seen(uuid) to authenticated;

-- Received -> In Process -> In Transit -> Delivered; Cancelled (this vendor's whole part) from any active stage.
-- Lock order: the parent order row first, then the fulfilment (same as every Admin RPC), so concurrent vendor /
-- Admin changes queue instead of racing; the status is re-read under the lock.
create or replace function public.staff_set_fulfilment_status(p_fulfilment_id uuid, p_status text)
returns table (id uuid, status text)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_vendor uuid := public.current_staff_vendor();
  v_order_id uuid;
  v_current text;
begin
  if v_vendor is null then
    raise exception using errcode = 'insufficient_privilege', message = 'staff_access_required';
  end if;
  select f.order_id into v_order_id from public.order_fulfilments f where f.id = p_fulfilment_id and f.vendor_id = v_vendor;
  if v_order_id is null then
    raise exception using errcode = 'no_data_found', message = 'order_not_available';
  end if;
  perform 1 from public.orders o where o.id = v_order_id for update;
  select f.status into v_current from public.order_fulfilments f
  where f.id = p_fulfilment_id and f.vendor_id = v_vendor and public.fulfilment_has_items(f.order_id, f.vendor_id)
  for update;
  if not found then
    raise exception using errcode = 'no_data_found', message = 'order_not_available';
  end if;
  if not (
       (v_current = 'confirmed'  and p_status in ('processing', 'cancelled'))
    or (v_current = 'processing' and p_status in ('in_transit', 'cancelled'))
    or (v_current = 'in_transit' and p_status in ('completed', 'cancelled'))
  ) then
    raise exception using errcode = 'check_violation', message = 'order_status_transition_not_allowed',
      detail = format('%s -> %s is not allowed for staff.', v_current, coalesce(p_status, 'null'));
  end if;

  update public.order_fulfilments f set status = p_status where f.id = p_fulfilment_id;
  insert into public.order_fulfilment_seen (fulfilment_id, staff_id)
  values (p_fulfilment_id, (select auth.uid()))
  on conflict (fulfilment_id, staff_id) do nothing;

  return query select f.id, f.status from public.order_fulfilments f where f.id = p_fulfilment_id;
end;
$$;
revoke all on function public.staff_set_fulfilment_status(uuid, text) from public, anon;
grant execute on function public.staff_set_fulfilment_status(uuid, text) to authenticated;

-- ---- 11. Admin: assign / reassign, release, per-vendor status, cancel open parts ----------------------------------
-- p_assignments = [{"item_id": "<uuid>", "vendor": "isolutions" | "piyavey" | null}], all-or-nothing.
-- Before release: any vendor or NULL (unassign) on an order that is not Delivered / Cancelled.
-- After release (D3): a vendor is required, and both the item's current fulfilment and the target vendor's
-- fulfilment (if it exists) must still be Received. A missing target fulfilment is created (released now).
create or replace function public.admin_assign_order_items(p_order_id uuid, p_assignments jsonb)
returns table (item_id uuid, vendor_code text)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_order_status text;
  v_split boolean;
  v_row record;
  v_source_id uuid;
  v_source_status text;
  v_target_id uuid;
  v_target_status text;
begin
  if not public.is_catalog_admin() then
    raise exception using errcode = 'insufficient_privilege', message = 'catalog_admin_required';
  end if;
  select o.status into v_order_status from public.orders o where o.id = p_order_id for update;
  if not found then
    raise exception using errcode = 'no_data_found', message = 'order_not_found';
  end if;
  if p_assignments is null or jsonb_typeof(p_assignments) <> 'array'
    or jsonb_array_length(p_assignments) = 0 or jsonb_array_length(p_assignments) > 100 then
    raise exception using errcode = 'invalid_parameter_value', message = 'vendor_assignments_invalid';
  end if;

  -- Validate every row before writing anything (all-or-nothing).
  if exists (
    select 1 from jsonb_to_recordset(p_assignments) a(item_id uuid, vendor text)
    left join public.order_items oi on oi.id = a.item_id and oi.order_id = p_order_id
    where a.item_id is null or oi.id is null
  ) then
    raise exception using errcode = 'invalid_parameter_value', message = 'order_item_not_in_order';
  end if;
  if exists (
    select 1 from jsonb_to_recordset(p_assignments) a(item_id uuid, vendor text) group by a.item_id having count(*) > 1
  ) then
    raise exception using errcode = 'invalid_parameter_value', message = 'order_item_duplicate';
  end if;
  if exists (
    select 1 from jsonb_to_recordset(p_assignments) a(item_id uuid, vendor text)
    left join public.vendors v on v.code = nullif(btrim(a.vendor), '') and v.is_active
    where nullif(btrim(a.vendor), '') is not null and v.id is null
  ) then
    raise exception using errcode = 'invalid_parameter_value', message = 'vendor_invalid';
  end if;

  v_split := exists (select 1 from public.order_fulfilments f where f.order_id = p_order_id);
  if not v_split then
    -- Not released yet: free assignment (NULL = unassign) unless the order is already Delivered / Cancelled.
    if v_order_status in ('completed', 'cancelled') then
      raise exception using errcode = 'check_violation', message = 'order_not_assignable';
    end if;
    update public.order_items oi set vendor_id = v.id
    from jsonb_to_recordset(p_assignments) a(item_id uuid, vendor text)
    left join public.vendors v on v.code = nullif(btrim(a.vendor), '')
    where oi.id = a.item_id and oi.order_id = p_order_id and oi.vendor_id is distinct from v.id;
  else
    if exists (select 1 from jsonb_to_recordset(p_assignments) a(item_id uuid, vendor text) where nullif(btrim(a.vendor), '') is null) then
      raise exception using errcode = 'check_violation', message = 'order_item_vendor_required';
    end if;
    -- Released (D3): move an item only while both vendor parts are still Received.
    for v_row in
      select a.item_id, v.id as vendor_id, oi.vendor_id as current_vendor_id
      from jsonb_to_recordset(p_assignments) a(item_id uuid, vendor text)
      join public.order_items oi on oi.id = a.item_id and oi.order_id = p_order_id
      join public.vendors v on v.code = btrim(a.vendor)
      where oi.vendor_id is distinct from v.id
      order by a.item_id
    loop
      v_source_id := null; v_source_status := null; v_target_id := null; v_target_status := null;
      select f.id, f.status into v_source_id, v_source_status from public.order_fulfilments f
      where f.order_id = p_order_id and f.vendor_id = v_row.current_vendor_id for update;
      if v_source_id is null or v_source_status <> 'confirmed' then
        raise exception using errcode = 'check_violation', message = 'fulfilment_not_reassignable',
          detail = 'Items can be moved only while their vendor part is still Received.';
      end if;
      select f.id, f.status into v_target_id, v_target_status from public.order_fulfilments f
      where f.order_id = p_order_id and f.vendor_id = v_row.vendor_id for update;
      if v_target_id is not null and v_target_status <> 'confirmed' then
        raise exception using errcode = 'check_violation', message = 'fulfilment_not_reassignable',
          detail = 'The target vendor part is no longer Received.';
      end if;

      update public.order_items oi set vendor_id = v_row.vendor_id where oi.id = v_row.item_id;
      if v_target_id is null then
        insert into public.order_fulfilments (order_id, vendor_id) values (p_order_id, v_row.vendor_id)
        returning id into v_target_id;
      end if;
      -- Both vendor parts changed: their staff see them as new again.
      delete from public.order_fulfilment_seen s where s.fulfilment_id in (v_source_id, v_target_id);
      insert into public.order_status_events (order_id, event, from_status, to_status, actor_id, actor_role,
        fulfilment_id, vendor_id, from_vendor_id, order_item_id)
      select p_order_id, 'item_reassigned', 'confirmed', 'confirmed', (select auth.uid()), p.role::text,
        v_target_id, v_row.vendor_id, v_row.current_vendor_id, v_row.item_id
      from public.profiles p where p.id = (select auth.uid());
    end loop;
    perform public.sync_order_status_from_fulfilments(p_order_id);
  end if;

  return query
  select oi.id, v.code from public.order_items oi left join public.vendors v on v.id = oi.vendor_id
  where oi.order_id = p_order_id order by oi.created_at, oi.id;
end;
$$;
revoke all on function public.admin_assign_order_items(uuid, jsonb) from public, anon;
grant execute on function public.admin_assign_order_items(uuid, jsonb) to authenticated;

-- D1: every item must have an active vendor. Only New / Received orders that are not released yet.
create or replace function public.admin_release_order_to_vendors(p_order_id uuid)
returns table (fulfilment_id uuid, vendor_code text, status text)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_status text;
begin
  if not public.is_catalog_admin() then
    raise exception using errcode = 'insufficient_privilege', message = 'catalog_admin_required';
  end if;
  select o.status into v_status from public.orders o where o.id = p_order_id for update;
  if not found then
    raise exception using errcode = 'no_data_found', message = 'order_not_found';
  end if;
  if exists (select 1 from public.order_fulfilments f where f.order_id = p_order_id) then
    raise exception using errcode = 'check_violation', message = 'order_already_released_to_vendors';
  end if;
  if v_status not in ('new', 'confirmed') then
    raise exception using errcode = 'check_violation', message = 'order_not_releasable',
      detail = 'Only New or Received orders can be released to vendors.';
  end if;
  if not exists (select 1 from public.order_items oi where oi.order_id = p_order_id)
    or exists (select 1 from public.order_items oi where oi.order_id = p_order_id and oi.vendor_id is null) then
    raise exception using errcode = 'check_violation', message = 'order_items_unassigned',
      detail = 'Assign every item to a vendor before release.';
  end if;
  if exists (
    select 1 from public.order_items oi join public.vendors v on v.id = oi.vendor_id
    where oi.order_id = p_order_id and not v.is_active
  ) then
    raise exception using errcode = 'check_violation', message = 'vendor_invalid';
  end if;

  insert into public.order_fulfilments (order_id, vendor_id)
  select p_order_id, d.vendor_id
  from (select distinct oi.vendor_id from public.order_items oi where oi.order_id = p_order_id) d
  join public.vendors v on v.id = d.vendor_id
  order by v.sort_order, v.code;

  return query
  select f.id, v.code, f.status from public.order_fulfilments f join public.vendors v on v.id = f.vendor_id
  where f.order_id = p_order_id order by v.sort_order, v.code;
end;
$$;
revoke all on function public.admin_release_order_to_vendors(uuid) from public, anon;
grant execute on function public.admin_release_order_to_vendors(uuid) to authenticated;

-- D7: Admin manages each vendor's status separately (any change except leaving Cancelled).
create or replace function public.admin_set_fulfilment_status(p_fulfilment_id uuid, p_status text)
returns table (id uuid, status text)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_order_id uuid;
begin
  if not public.is_catalog_admin() then
    raise exception using errcode = 'insufficient_privilege', message = 'catalog_admin_required';
  end if;
  if coalesce(p_status, '') not in ('confirmed', 'processing', 'in_transit', 'completed', 'cancelled') then
    raise exception using errcode = 'invalid_parameter_value', message = 'fulfilment_status_invalid';
  end if;
  select f.order_id into v_order_id from public.order_fulfilments f where f.id = p_fulfilment_id;
  if v_order_id is null then
    raise exception using errcode = 'no_data_found', message = 'fulfilment_not_found';
  end if;
  perform 1 from public.orders o where o.id = v_order_id for update;
  perform 1 from public.order_fulfilments f
  where f.id = p_fulfilment_id and public.fulfilment_has_items(f.order_id, f.vendor_id)
  for update;
  if not found then
    raise exception using errcode = 'check_violation', message = 'fulfilment_has_no_items';
  end if;
  update public.order_fulfilments f set status = p_status where f.id = p_fulfilment_id;
  return query select f.id, f.status from public.order_fulfilments f where f.id = p_fulfilment_id;
end;
$$;
revoke all on function public.admin_set_fulfilment_status(uuid, text) from public, anon;
grant execute on function public.admin_set_fulfilment_status(uuid, text) to authenticated;

-- "Cancel all open vendor parts": cancels every live Received / In Process / In Transit fulfilment of the order.
-- Delivered parts are left alone (the order then ends Delivered with a partial cancellation).
create or replace function public.admin_cancel_open_fulfilments(p_order_id uuid)
returns table (id uuid, status text)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
begin
  if not public.is_catalog_admin() then
    raise exception using errcode = 'insufficient_privilege', message = 'catalog_admin_required';
  end if;
  perform 1 from public.orders o where o.id = p_order_id for update;
  if not found then
    raise exception using errcode = 'no_data_found', message = 'order_not_found';
  end if;
  if not exists (select 1 from public.order_fulfilments f where f.order_id = p_order_id) then
    raise exception using errcode = 'check_violation', message = 'order_not_released_to_vendors';
  end if;
  perform 1 from public.order_fulfilments f where f.order_id = p_order_id order by f.id for update;
  return query
  update public.order_fulfilments f set status = 'cancelled'
  where f.order_id = p_order_id
    and f.status in ('confirmed', 'processing', 'in_transit')
    and public.fulfilment_has_items(f.order_id, f.vendor_id)
  returning f.id, f.status;
end;
$$;
revoke all on function public.admin_cancel_open_fulfilments(uuid) from public, anon;
grant execute on function public.admin_cancel_open_fulfilments(uuid) to authenticated;

commit;
