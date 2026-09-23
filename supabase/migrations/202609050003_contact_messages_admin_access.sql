grant select on table public.contact_messages to authenticated;
grant update (status) on table public.contact_messages to authenticated;

create policy contact_messages_admin_select
on public.contact_messages
for select
to authenticated
using ((select public.is_catalog_admin()));

create policy contact_messages_admin_update_status
on public.contact_messages
for update
to authenticated
using ((select public.is_catalog_admin()))
with check ((select public.is_catalog_admin()));
