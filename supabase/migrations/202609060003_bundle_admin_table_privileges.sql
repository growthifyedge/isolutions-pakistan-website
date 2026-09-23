begin;

revoke all privileges on table public.bundles, public.bundle_items from anon;

grant select, insert, update, delete
on table public.bundles, public.bundle_items
to authenticated;

commit;
