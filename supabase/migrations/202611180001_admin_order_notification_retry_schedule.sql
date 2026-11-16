begin;

-- Admin New Order Alert: automatic delivery + retry without another checkout or Admin visit. NOT YET APPLIED.
-- Requires 202611170001. Needs Owner approval: enables the Supabase-supported extensions pg_cron (scheduler) and
-- pg_net (outbound HTTP from the database).
--
-- Every minute pg_cron runs public.dispatch_admin_order_notifications():
--   * Nothing due -> returns at once, makes NO HTTP call (idle cost = one indexed EXISTS query per minute).
--   * Something due -> one POST to the existing admin-order-notifications Edge Function, which leases the due rows
--     (skip locked), sends through Gmail and records the result. The existing backoff (1, 5, 15, 60, 240 min, max 6
--     attempts) is enforced by next_attempt_at, so the scheduler never sends early and never sends a 'sent' row again.
--   * The storefront keepalive call stays the instant path; this job is the safety net. Concurrent drains cannot
--     duplicate an email (row lease + skip locked).
--   * No secret is stored or sent: the function takes no input and authenticates to the database with its own
--     server-side service role. The only configuration is the function URL, read from Supabase Vault
--     ('admin_order_notifications_url', created once per environment). Missing or malformed URL -> no call.
--   * Vendor emails (vendor-order-notifications) are not touched.

create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;

create or replace function public.dispatch_admin_order_notifications()
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_url text;
begin
  if not exists (
    select 1 from public.admin_order_notifications n
    where (n.status = 'pending' and n.next_attempt_at <= now()) or (n.status = 'sending' and n.locked_until < now())
  ) then
    return null;
  end if;

  select s.decrypted_secret into v_url from vault.decrypted_secrets s
  where s.name = 'admin_order_notifications_url' limit 1;
  if v_url is null or v_url !~ '^https://[a-z0-9]{20}\.supabase\.co/functions/v1/admin-order-notifications$' then
    return null;
  end if;

  return net.http_post(
    url := v_url,
    body := '{}'::jsonb,
    headers := '{"Content-Type": "application/json"}'::jsonb,
    timeout_milliseconds := 30000);
end;
$$;
revoke all on function public.dispatch_admin_order_notifications() from public, anon, authenticated, service_role;

-- Idempotent: scheduling the same job name again replaces it.
select cron.schedule('admin-order-notifications-retry', '* * * * *', 'select public.dispatch_admin_order_notifications()');

commit;
