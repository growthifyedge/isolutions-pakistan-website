begin;

-- Staff Order Email Notifications (Owner approved for localhost, 2026-11-15). NOT YET APPLIED.
-- Requires 202611150002 (vendors, order_fulfilments) and 202611150003 (Confirm & Release).
--
-- Outbox pattern:
--   * vendors.notification_email      - the vendor's order mailbox (Owner-provided facts below).
--   * vendor_order_notifications      - one row per vendor fulfilment (UNIQUE fulfilment_id), written by an AFTER
--                                       INSERT trigger on order_fulfilments, i.e. inside the release transaction:
--                                       a rolled-back release leaves no row, a released part always has one, and a
--                                       repeated release cannot create a second row (fulfilments are unique per
--                                       order + vendor and Confirm & Release refuses an already released order).
--   * The row stores a snapshot of ONLY that vendor's items (title, SKU, variant, quantity) and the order number.
--     No prices, no totals, no customer name / phone / address, nothing about the other vendor.
--   * Enqueueing never blocks a release: any error inside the trigger is caught and reported as a WARNING.
--   * Delivery happens later, outside the release transaction, in the Edge Function vendor-order-notifications.
--     It leases due rows (admin_claim_vendor_notifications), sends them and reports back
--     (admin_complete_vendor_notification). Failures retry with backoff (1, 5, 15, 60, 240 min) up to 6 attempts,
--     then the row is 'failed' and Admin can re-queue it (admin_retry_vendor_notification). A worker that dies
--     mid-send loses its lease after 5 minutes and the row becomes due again (at-least-once). The Gmail API has
--     no provider-level idempotency key, so an ambiguous send (timeout / 5xx) may be retried and deliver a
--     duplicate; it is never marked sent without Gmail's confirmation.
--   * No table grants for writing; Admin can read rows (status shown in Admin Orders). Staff and anon: no access.

-- ---- 1. Vendor mailboxes --------------------------------------------------------------------------------------
alter table public.vendors add column if not exists notification_email text;
alter table public.vendors drop constraint if exists vendors_notification_email_check;
alter table public.vendors add constraint vendors_notification_email_check check (
  notification_email is null or notification_email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'
);
comment on column public.vendors.notification_email is
  'Mailbox that receives this vendor''s released-order notifications (NULL = no email). Changed only by a reviewed migration.';

update public.vendors set notification_email = 'ordersisolution@gmail.com'
  where code = 'isolutions' and notification_email is distinct from 'ordersisolution@gmail.com';
update public.vendors set notification_email = 'isolutionspiyave@gmail.com'
  where code = 'piyavey' and notification_email is distinct from 'isolutionspiyave@gmail.com';

-- ---- 2. Outbox ----------------------------------------------------------------------------------------------------
create table if not exists public.vendor_order_notifications (
  id uuid primary key default extensions.gen_random_uuid(),
  fulfilment_id uuid not null references public.order_fulfilments(id) on delete restrict,
  order_id uuid not null references public.orders(id) on delete restrict,
  vendor_id uuid not null references public.vendors(id) on delete restrict,
  recipient text not null,
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
  constraint vendor_order_notifications_fulfilment_key unique (fulfilment_id)
);
comment on table public.vendor_order_notifications is
  'Outbox: one email per released vendor fulfilment. Written only by the release trigger and the notification RPCs.';
create index if not exists vendor_order_notifications_due_idx
  on public.vendor_order_notifications (next_attempt_at) where status in ('pending', 'sending');
create index if not exists vendor_order_notifications_order_idx on public.vendor_order_notifications (order_id);

alter table public.vendor_order_notifications enable row level security;
revoke all on public.vendor_order_notifications from anon, authenticated;
grant select on public.vendor_order_notifications to authenticated;
drop policy if exists vendor_order_notifications_admin_select on public.vendor_order_notifications;
create policy vendor_order_notifications_admin_select on public.vendor_order_notifications for select to authenticated
  using ((select public.is_catalog_admin()));

-- ---- 3. Enqueue inside the release transaction (never blocks it) --------------------------------------------------
create or replace function public.enqueue_vendor_order_notification()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_recipient text;
  v_vendor_name text;
  v_order_number text;
  v_items jsonb;
begin
  begin
    select v.notification_email, v.name into v_recipient, v_vendor_name from public.vendors v where v.id = new.vendor_id;
    if v_recipient is null then return null; end if;
    select o.order_number into v_order_number from public.orders o where o.id = new.order_id;
    select coalesce(jsonb_agg(jsonb_build_object(
        'title', oi.product_title_snapshot, 'sku', oi.sku_snapshot,
        'variant', oi.variant_attributes_snapshot, 'quantity', oi.quantity
      ) order by oi.created_at, oi.id), '[]'::jsonb)
      into v_items
    from public.order_items oi
    where oi.order_id = new.order_id and oi.vendor_id = new.vendor_id;

    insert into public.vendor_order_notifications (fulfilment_id, order_id, vendor_id, recipient, payload)
    values (new.id, new.order_id, new.vendor_id, v_recipient, jsonb_build_object(
      'order_number', v_order_number, 'vendor_name', v_vendor_name,
      'released_at', new.released_at, 'items', v_items))
    on conflict (fulfilment_id) do nothing;
  exception when others then
    raise warning 'vendor_notification_enqueue_failed: % (%)', sqlerrm, sqlstate;
  end;
  return null;
end;
$$;
revoke all on function public.enqueue_vendor_order_notification() from public, anon, authenticated;

drop trigger if exists order_fulfilments_enqueue_notification on public.order_fulfilments;
create trigger order_fulfilments_enqueue_notification
  after insert on public.order_fulfilments
  for each row execute function public.enqueue_vendor_order_notification();

-- ---- 4. Worker RPCs (Admin session or the service role only) -------------------------------------------------------
create or replace function public.can_send_vendor_notifications()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select auth.role()) = 'service_role', false) or public.is_catalog_admin();
$$;
revoke all on function public.can_send_vendor_notifications() from public, anon, authenticated;

-- Lease up to p_limit due rows: pending and due, or 'sending' whose lease expired (a worker died mid-send).
create or replace function public.admin_claim_vendor_notifications(p_limit integer default 10)
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
    select n.id from public.vendor_order_notifications n
    where (n.status = 'pending' and n.next_attempt_at <= now())
       or (n.status = 'sending' and n.locked_until < now())
    order by n.next_attempt_at, n.created_at
    limit greatest(1, least(coalesce(p_limit, 10), 50))
    for update skip locked
  )
  update public.vendor_order_notifications n
  set status = 'sending', attempts = n.attempts + 1, lease_id = extensions.gen_random_uuid(),
      locked_until = now() + interval '5 minutes', updated_at = now()
  from due where n.id = due.id
  returning n.id, n.lease_id, n.recipient, n.payload, n.attempts;
end;
$$;
revoke all on function public.admin_claim_vendor_notifications(integer) from public, anon;
grant execute on function public.admin_claim_vendor_notifications(integer) to authenticated, service_role;

-- Report one send. Ignored (returns false) when the lease no longer matches, so a slow worker cannot overwrite a
-- newer attempt. Failure: retry after 1, 5, 15, 60, 240 minutes; after max_attempts the row is 'failed'.
create or replace function public.admin_complete_vendor_notification(
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
  select n.attempts, n.max_attempts into v_attempts, v_max from public.vendor_order_notifications n
  where n.id = p_id and n.status = 'sending' and n.lease_id = p_lease_id
  for update;
  if not found then return false; end if;

  if p_ok then
    update public.vendor_order_notifications n
    set status = 'sent', sent_at = now(), last_error = null, lease_id = null, locked_until = null,
        provider_message_id = left(p_provider_message_id, 200), updated_at = now()
    where n.id = p_id;
  else
    update public.vendor_order_notifications n
    set status = case when v_attempts >= v_max then 'failed' else 'pending' end,
        next_attempt_at = now() + make_interval(mins => (array[1, 5, 15, 60, 240])[least(v_attempts, 5)]),
        last_error = left(coalesce(nullif(btrim(p_error), ''), 'send_failed'), 500),
        lease_id = null, locked_until = null, updated_at = now()
    where n.id = p_id;
  end if;
  return true;
end;
$$;
revoke all on function public.admin_complete_vendor_notification(uuid, uuid, boolean, text, text) from public, anon;
grant execute on function public.admin_complete_vendor_notification(uuid, uuid, boolean, text, text) to authenticated, service_role;

-- Admin: re-queue a notification that gave up. A sent notification is never re-sent.
create or replace function public.admin_retry_vendor_notification(p_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_catalog_admin() then
    raise exception using errcode = 'insufficient_privilege', message = 'catalog_admin_required';
  end if;
  update public.vendor_order_notifications n
  set status = 'pending', attempts = 0, next_attempt_at = now(), last_error = null, updated_at = now()
  where n.id = p_id and n.status = 'failed';
  return found;
end;
$$;
revoke all on function public.admin_retry_vendor_notification(uuid) from public, anon;
grant execute on function public.admin_retry_vendor_notification(uuid) to authenticated;

commit;
