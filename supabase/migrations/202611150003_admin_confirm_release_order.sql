-- Two-Vendor Order Management: one-click "Confirm & Release" (Owner-approved simplification, 2026-11-14).
-- Saves the Admin's vendor choice for EVERY item of an unreleased order and releases the vendor parts in one
-- call. A PL/pgSQL function runs inside the caller's single statement/transaction: if any step raises, every
-- write of this call (item vendors, fulfilments, events) is rolled back, so nothing is partly saved or released.
-- It reuses admin_assign_order_items (validation, all-or-nothing) and admin_release_order_to_vendors (D1, one
-- part per vendor) unchanged; their Admin check, triggers, events and stock rules stay the only write path.
-- Never called at checkout: the Admin chooses the vendors (suggestions are only preselected in the UI).
create or replace function public.admin_confirm_and_release_order(p_order_id uuid, p_assignments jsonb)
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
  -- Lock the order first: a repeated or concurrent submission waits here, then sees the parts and is refused.
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
  if p_assignments is null or jsonb_typeof(p_assignments) <> 'array' then
    raise exception using errcode = 'invalid_parameter_value', message = 'vendor_assignments_invalid';
  end if;
  -- D1: the submission must name a vendor for every item of the order (no default vendor, no partial release).
  if exists (
    select 1 from public.order_items oi where oi.order_id = p_order_id
      and not exists (
        select 1 from jsonb_to_recordset(p_assignments) a(item_id uuid, vendor text)
        where a.item_id = oi.id and nullif(btrim(a.vendor), '') is not null
      )
  ) or not exists (select 1 from public.order_items oi where oi.order_id = p_order_id) then
    raise exception using errcode = 'check_violation', message = 'order_items_unassigned',
      detail = 'Assign every item to a vendor before release.';
  end if;

  perform 1 from public.admin_assign_order_items(p_order_id, p_assignments);
  return query select r.fulfilment_id, r.vendor_code, r.status from public.admin_release_order_to_vendors(p_order_id) r;
end;
$$;
revoke all on function public.admin_confirm_and_release_order(uuid, jsonb) from public, anon;
grant execute on function public.admin_confirm_and_release_order(uuid, jsonb) to authenticated;
