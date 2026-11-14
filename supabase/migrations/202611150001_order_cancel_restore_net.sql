begin;

-- Two-Vendor Order Management, step 1 of 2 (Owner approved for localhost, 2026-11-14). NOT YET APPLIED.
--
-- Whole-order cancellation restores only the stock that is still out.
--
-- Until now restore_cancelled_order_stock (202610010002) reversed every 'sale' movement of the order. With
-- vendor fulfilments (202611150002) one vendor's part of an order can be cancelled first; its stock is then
-- returned with a 'return' movement on the same reference ('order:<order id>') and variant. A later
-- whole-order cancellation must not return that stock a second time (the unique index
-- inventory_movements_order_return_once would also make the whole cancellation fail).
--
-- Change: the restore now nets 'sale' AND 'return' movements of the order per variant and returns only what
-- is still outstanding (net <> 0). For every order without an earlier return (all orders before this
-- migration) the result is identical to before: only 'sale' rows exist, so the net equals the sale total.
-- Everything else is unchanged: cancelled is final, stock_restored_at is set once and is not editable, no
-- other status touches stock, and the unique index stays as the hard once-per-variant guarantee.

create or replace function public.restore_cancelled_order_stock()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.status = 'cancelled' and new.status is distinct from 'cancelled' then
    raise exception using errcode = 'check_violation', message = 'order_cancelled_is_final',
      detail = format('Order %s is cancelled; cancelled orders cannot change status.', old.order_number);
  end if;

  -- stock_restored_at is set only here; any attempt to change it is ignored.
  new.stock_restored_at := old.stock_restored_at;

  if new.status = 'cancelled' and old.status is distinct from 'cancelled' and old.stock_restored_at is null then
    -- Return only what is still out: sale minus anything already returned (e.g. a cancelled vendor part).
    insert into public.inventory_movements (variant_id, quantity_delta, reason, reference, note, actor_id)
    select m.variant_id, (-sum(m.quantity_delta))::integer, 'return', m.reference,
      'Order cancelled: ' || new.order_number, auth.uid()
    from public.inventory_movements m
    where m.reason in ('sale', 'return') and m.reference = 'order:' || new.id::text
    group by m.variant_id, m.reference
    having sum(m.quantity_delta) <> 0;
    new.stock_restored_at := now();
  end if;
  return new;
end;
$$;

revoke all on function public.restore_cancelled_order_stock() from public, anon, authenticated;

commit;
