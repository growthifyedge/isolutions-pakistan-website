begin;

-- Admin New Order Alert (Owner approved for localhost, 2026-11-16). NOT YET APPLIED.
-- Requires 202611160001 (can_send_vendor_notifications: Admin session or service role).
--
-- Outbox pattern, mirroring vendor_order_notifications:
--   * admin_order_notifications - one row per order (UNIQUE order_id), written by a DEFERRED constraint trigger on
--     orders: it runs at COMMIT of the checkout transaction, after create_storefront_order has inserted every
--     order_item. A rolled-back checkout leaves no row; a committed order always gets exactly one.
--   * create_storefront_order is NOT modified (pricing, stock, payment and shipping stay locked).
--   * Snapshot: order number, placed time, payment + shipping method, server-calculated amounts and the items
--     (title, SKU, variant, quantity, unit price, line total). NO customer name, phone, email, address, city or notes.
--   * Enqueueing never blocks checkout: any error inside the trigger is caught and reported as a WARNING.
--   * Delivery: Edge Function admin-order-notifications (service role, server-side only) leases due rows, sends them
--     through the existing Gmail transport and reports back. Failures retry with backoff (1, 5, 15, 60, 240 min) up to
--     6 attempts, then 'failed'. A worker that dies mid-send loses its 5-minute lease and the row becomes due again.
--   * Recipient: the Owner-approved Admin mailbox below. Changed only by a reviewed migration.
--   * No table grants for writing; Admin can read rows. Staff and anon: no access.

create table if not exists public.admin_order_notifications (
  id uuid primary key default extensions.gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete restrict,
  recipient text not null check (recipient ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'),
  payload jsonb not null,
  status text not null default 'pending' check (status in ('pending', 'sending', 'sent', 'failed')),
  attempts integer not null default 0 check (attempts >= 0),
  max_attempts integer not null default 6 check (max_attempts between 1 and 20),
  next_attempt_at timestamptz not null default now(),
  lease_id uuid,
  locked_until timestamptz,
  last_error text,
  provider_message_id text,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint admin_order_notifications_order_key unique (order_id)
);
comment on table public.admin_order_notifications is
  'Outbox: one New Order Alert email to the Admin mailbox per committed order. Written only by the orders trigger and the notification RPCs.';
create index if not exists admin_order_notifications_due_idx
  on public.admin_order_notifications (next_attempt_at) where status in ('pending', 'sending');

alter table public.admin_order_notifications enable row level security;
revoke all on public.admin_order_notifications from anon, authenticated;
grant select on public.admin_order_notifications to authenticated;
drop policy if exists admin_order_notifications_admin_select on public.admin_order_notifications;
create policy admin_order_notifications_admin_select on public.admin_order_notifications for select to authenticated
  using ((select public.is_catalog_admin()));

-- ---- Enqueue at COMMIT of the order transaction (never blocks it) -------------------------------------------------
create or replace function public.enqueue_admin_order_notification()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order record;
  v_items jsonb;
begin
  begin
    select o.id, o.order_number, o.created_at, o.payment_method, o.shipping_method, o.subtotal_minor,
           o.delivery_fee_minor, o.discount_minor, o.shipping_discount_minor, o.total_minor, o.coupon_code_snapshot
      into v_order
    from public.orders o where o.id = new.id;
    if not found then return null; end if;

    select coalesce(jsonb_agg(jsonb_build_object(
        'title', oi.product_title_snapshot, 'sku', oi.sku_snapshot, 'variant', oi.variant_attributes_snapshot,
        'quantity', oi.quantity, 'unit_price_minor', oi.unit_price_minor, 'line_total_minor', oi.line_total_minor
      ) order by oi.created_at, oi.id), '[]'::jsonb)
      into v_items
    from public.order_items oi where oi.order_id = new.id;
    if jsonb_array_length(v_items) = 0 then return null; end if;

    insert into public.admin_order_notifications (order_id, recipient, payload)
    values (new.id, 'isolutionpakistan89@gmail.com', jsonb_build_object(
      'order_number', v_order.order_number, 'placed_at', v_order.created_at,
      'payment_method', v_order.payment_method, 'shipping_method', v_order.shipping_method,
      'subtotal_minor', v_order.subtotal_minor, 'delivery_fee_minor', v_order.delivery_fee_minor,
      'discount_minor', coalesce(v_order.discount_minor, 0), 'shipping_discount_minor', coalesce(v_order.shipping_discount_minor, 0),
      'total_minor', v_order.total_minor, 'coupon_code', v_order.coupon_code_snapshot, 'items', v_items))
    on conflict (order_id) do nothing;
  exception when others then
    raise warning 'admin_order_notification_enqueue_failed: % (%)', sqlerrm, sqlstate;
  end;
  return null;
end;
$$;
revoke all on function public.enqueue_admin_order_notification() from public, anon, authenticated;

drop trigger if exists orders_enqueue_admin_notification on public.orders;
create constraint trigger orders_enqueue_admin_notification
  after insert on public.orders
  deferrable initially deferred
  for each row execute function public.enqueue_admin_order_notification();

-- ---- Worker RPCs (service role or Admin session only; reuse can_send_vendor_notifications) -------------------------
-- Cheap check so the Edge Function never contacts Google when nothing is due.
create or replace function public.admin_has_due_admin_order_notifications()
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.can_send_vendor_notifications() then
    raise exception using errcode = 'insufficient_privilege', message = 'catalog_admin_required';
  end if;
  return exists (
    select 1 from public.admin_order_notifications n
    where (n.status = 'pending' and n.next_attempt_at <= now()) or (n.status = 'sending' and n.locked_until < now()));
end;
$$;
revoke all on function public.admin_has_due_admin_order_notifications() from public, anon;
grant execute on function public.admin_has_due_admin_order_notifications() to authenticated, service_role;

create or replace function public.admin_claim_admin_order_notifications(p_limit integer default 10)
returns table (id uuid, lease_id uuid, recipient text, payload jsonb, attempts integer)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
begin
  if not public.can_send_vendor_notifications() then
    raise exception using errcode = 'insufficient_privilege', message = 'catalog_admin_required';
  end if;
  return query
  with due as (
    select n.id from public.admin_order_notifications n
    where (n.status = 'pending' and n.next_attempt_at <= now())
       or (n.status = 'sending' and n.locked_until < now())
    order by n.next_attempt_at, n.created_at
    limit greatest(1, least(coalesce(p_limit, 10), 50))
    for update skip locked
  )
  update public.admin_order_notifications n
  set status = 'sending', attempts = n.attempts + 1, lease_id = extensions.gen_random_uuid(),
      locked_until = now() + interval '5 minutes', updated_at = now()
  from due where n.id = due.id
  returning n.id, n.lease_id, n.recipient, n.payload, n.attempts;
end;
$$;
revoke all on function public.admin_claim_admin_order_notifications(integer) from public, anon;
grant execute on function public.admin_claim_admin_order_notifications(integer) to authenticated, service_role;

create or replace function public.admin_complete_admin_order_notification(
  p_id uuid, p_lease_id uuid, p_ok boolean, p_error text default null, p_provider_message_id text default null)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_attempts integer;
  v_max integer;
begin
  if not public.can_send_vendor_notifications() then
    raise exception using errcode = 'insufficient_privilege', message = 'catalog_admin_required';
  end if;
  select n.attempts, n.max_attempts into v_attempts, v_max from public.admin_order_notifications n
  where n.id = p_id and n.status = 'sending' and n.lease_id = p_lease_id
  for update;
  if not found then return false; end if;

  if p_ok then
    update public.admin_order_notifications n
    set status = 'sent', sent_at = now(), last_error = null, lease_id = null, locked_until = null,
        provider_message_id = left(p_provider_message_id, 200), updated_at = now()
    where n.id = p_id;
  else
    update public.admin_order_notifications n
    set status = case when v_attempts >= v_max then 'failed' else 'pending' end,
        next_attempt_at = now() + make_interval(mins => (array[1, 5, 15, 60, 240])[least(v_attempts, 5)]),
        last_error = left(coalesce(nullif(btrim(p_error), ''), 'send_failed'), 500),
        lease_id = null, locked_until = null, updated_at = now()
    where n.id = p_id;
  end if;
  return true;
end;
$$;
revoke all on function public.admin_complete_admin_order_notification(uuid, uuid, boolean, text, text) from public, anon;
grant execute on function public.admin_complete_admin_order_notification(uuid, uuid, boolean, text, text) to authenticated, service_role;

commit;
