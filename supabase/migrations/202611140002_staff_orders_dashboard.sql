begin;

-- Phase 2 — Staff Orders Dashboard (Owner approved for localhost, 2026-11-14). NOT YET APPLIED.
-- Requires 202611140001 (app_role 'staff').
--
-- Status model (existing values reused; one new value):
--   new        = Pending / New   (checkout)
--   confirmed  = Received        (Admin releases the order to staff)
--   processing = In Process
--   in_transit = In Transit      (NEW)
--   completed  = Delivered
--   cancelled  = Cancelled       (final; stock restored once — unchanged, 202610010002)
--
-- 1. orders.released_at: when the order was released to staff. Set by a trigger the first time an
--    order enters an active staff status (Received / In Process / In Transit), or explicitly by
--    admin_release_orders_to_staff. Once set it never changes. Existing orders are NOT backfilled:
--    historical confirmed/processing orders stay invisible to staff until an Admin releases them.
-- 2. Staff (active 'staff' profile) can read only released orders and their items (RLS). Staff
--    have no UPDATE policy on orders: a direct table update matches zero rows. The only staff
--    write is staff_set_order_status (status column only, forward transitions validated here)
--    and staff_mark_order_seen.
-- 3. order_status_events: append-only history of every status change and release, written by a
--    trigger (Admin single/bulk updates and staff updates alike). Nobody can insert, change or
--    delete events directly.
-- 4. order_staff_seen: per-staff "seen" marker for the New Orders badge (independent of status).

-- ---- 1. Status + release ----------------------------------------------------------------------
alter table public.orders drop constraint if exists orders_status_check;
alter table public.orders add constraint orders_status_check
  check (status in ('new', 'confirmed', 'processing', 'in_transit', 'completed', 'cancelled'));

alter table public.orders add column if not exists released_at timestamptz;
comment on column public.orders.released_at is
  'When the order was released to staff (first entry into Received / In Process / In Transit, or admin_release_orders_to_staff). Set once; NULL = staff cannot see the order.';
create index if not exists orders_released_at_idx on public.orders (released_at desc) where released_at is not null;

create or replace function public.guard_order_release()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.released_at is not null then
    new.released_at := old.released_at;            -- set once, never changed or cleared
  elsif new.status in ('confirmed', 'processing', 'in_transit')
    and (new.status is distinct from old.status or new.released_at is not null) then
    new.released_at := now();                      -- released now (by status change or explicit release)
  else
    new.released_at := null;                       -- not releasable (new / completed / cancelled)
  end if;
  return new;
end;
$$;
revoke all on function public.guard_order_release() from public, anon, authenticated;

drop trigger if exists orders_guard_release on public.orders;
create trigger orders_guard_release
  before update on public.orders
  for each row execute function public.guard_order_release();

-- ---- 2. Staff identity -------------------------------------------------------------------------
create or replace function public.is_order_staff()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles
    where id = (select auth.uid())
      and role = 'staff'::public.app_role
      and is_active
  );
$$;
revoke all on function public.is_order_staff() from public, anon;
grant execute on function public.is_order_staff() to authenticated;

-- Staff read only released orders and their items. Existing grants (select on orders/order_items
-- for authenticated) are unchanged; the Admin policies are unchanged.
drop policy if exists orders_staff_select on public.orders;
create policy orders_staff_select on public.orders for select to authenticated
  using ((select public.is_order_staff()) and released_at is not null);

drop policy if exists order_items_staff_select on public.order_items;
create policy order_items_staff_select on public.order_items for select to authenticated
  using ((select public.is_order_staff()) and exists (
    select 1 from public.orders o where o.id = order_items.order_id and o.released_at is not null));

-- ---- 3. Status history -------------------------------------------------------------------------
create table if not exists public.order_status_events (
  id bigint generated always as identity primary key,
  order_id uuid not null references public.orders(id) on delete restrict,
  event text not null check (event in ('status_changed', 'released')),
  from_status text,
  to_status text not null,
  actor_id uuid references auth.users(id) on delete set null,
  actor_role text check (actor_role in ('owner', 'admin', 'staff')),
  created_at timestamptz not null default now()
);
comment on table public.order_status_events is
  'Append-only order status history (status changes and releases to staff), written only by trigger.';
create index if not exists order_status_events_order_idx on public.order_status_events (order_id, id);
create index if not exists order_status_events_staff_idx on public.order_status_events (created_at desc) where actor_role = 'staff';

alter table public.order_status_events enable row level security;
revoke all on public.order_status_events from anon, authenticated;
grant select on public.order_status_events to authenticated;

drop policy if exists order_status_events_admin_select on public.order_status_events;
create policy order_status_events_admin_select on public.order_status_events for select to authenticated
  using ((select public.is_catalog_admin()));
drop policy if exists order_status_events_staff_select on public.order_status_events;
create policy order_status_events_staff_select on public.order_status_events for select to authenticated
  using ((select public.is_order_staff()) and exists (
    select 1 from public.orders o where o.id = order_status_events.order_id and o.released_at is not null));

create or replace function public.record_order_status_event()
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
  if new.status is distinct from old.status then
    insert into public.order_status_events (order_id, event, from_status, to_status, actor_id, actor_role)
    values (new.id, 'status_changed', old.status, new.status, (select auth.uid()), v_role);
  end if;
  if old.released_at is null and new.released_at is not null then
    insert into public.order_status_events (order_id, event, from_status, to_status, actor_id, actor_role)
    values (new.id, 'released', old.status, new.status, (select auth.uid()), v_role);
  end if;
  return null;
end;
$$;
revoke all on function public.record_order_status_event() from public, anon, authenticated;

drop trigger if exists orders_record_status_event on public.orders;
create trigger orders_record_status_event
  after update on public.orders
  for each row execute function public.record_order_status_event();

-- ---- 4. Per-staff seen marker ------------------------------------------------------------------
create table if not exists public.order_staff_seen (
  order_id uuid not null references public.orders(id) on delete restrict,
  staff_id uuid not null references auth.users(id) on delete cascade,
  seen_at timestamptz not null default now(),
  primary key (order_id, staff_id)
);
comment on table public.order_staff_seen is
  'Which staff account has opened which released order (New Orders badge). Written only by staff_mark_order_seen / staff_set_order_status.';

alter table public.order_staff_seen enable row level security;
revoke all on public.order_staff_seen from anon, authenticated;
grant select on public.order_staff_seen to authenticated;

drop policy if exists order_staff_seen_own_select on public.order_staff_seen;
create policy order_staff_seen_own_select on public.order_staff_seen for select to authenticated
  using (staff_id = (select auth.uid()) and (select public.is_order_staff()));

-- ---- 5. Staff RPCs -----------------------------------------------------------------------------
create or replace function public.staff_mark_order_seen(p_order_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_order_staff() then
    raise exception using errcode = 'insufficient_privilege', message = 'staff_access_required';
  end if;
  if not exists (select 1 from public.orders o where o.id = p_order_id and o.released_at is not null) then
    raise exception using errcode = 'no_data_found', message = 'order_not_available';
  end if;
  insert into public.order_staff_seen (order_id, staff_id)
  values (p_order_id, (select auth.uid()))
  on conflict (order_id, staff_id) do nothing;
  return true;
end;
$$;
revoke all on function public.staff_mark_order_seen(uuid) from public, anon;
grant execute on function public.staff_mark_order_seen(uuid) to authenticated;

-- The only way staff change an order: the status column, forward only, on released orders.
--   Received -> In Process -> In Transit -> Delivered; Cancelled from any of the three active stages.
-- Cancellation runs the existing orders_restore_stock_on_cancel trigger (stock returned once).
create or replace function public.staff_set_order_status(p_order_id uuid, p_status text)
returns table (id uuid, status text)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_current text;
begin
  if not public.is_order_staff() then
    raise exception using errcode = 'insufficient_privilege', message = 'staff_access_required';
  end if;
  select o.status into v_current
  from public.orders o
  where o.id = p_order_id and o.released_at is not null
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

  update public.orders o set status = p_status where o.id = p_order_id;
  insert into public.order_staff_seen (order_id, staff_id)
  values (p_order_id, (select auth.uid()))
  on conflict (order_id, staff_id) do nothing;

  return query select o.id, o.status from public.orders o where o.id = p_order_id;
end;
$$;
revoke all on function public.staff_set_order_status(uuid, text) from public, anon;
grant execute on function public.staff_set_order_status(uuid, text) to authenticated;

-- ---- 6. Admin release (historical orders) ------------------------------------------------------
-- Runs as the caller (Admin RLS applies). Releases active, not-yet-released orders explicitly, so
-- historical confirmed/processing orders are never released blindly by this migration.
create or replace function public.admin_release_orders_to_staff(p_order_ids uuid[])
returns table (id uuid, released_at timestamptz)
language plpgsql
security invoker
set search_path = ''
as $$
#variable_conflict use_column
begin
  if not public.is_catalog_admin() then
    raise exception using errcode = 'insufficient_privilege', message = 'catalog_admin_required';
  end if;
  return query
  update public.orders o
  set released_at = now()
  where o.id = any(p_order_ids)
    and o.released_at is null
    and o.status in ('confirmed', 'processing', 'in_transit')
  returning o.id, o.released_at;
end;
$$;
revoke all on function public.admin_release_orders_to_staff(uuid[]) from public, anon;
grant execute on function public.admin_release_orders_to_staff(uuid[]) to authenticated;

commit;
