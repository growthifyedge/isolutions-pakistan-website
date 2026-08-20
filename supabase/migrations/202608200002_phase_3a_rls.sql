-- Phase 3A grants and RLS policies. Admin authorization is profile-role based.

alter table public.profiles enable row level security;
alter table public.brands enable row level security;
alter table public.categories enable row level security;
alter table public.products enable row level security;
alter table public.product_variants enable row level security;
alter table public.inventory_movements enable row level security;
alter table public.product_specifications enable row level security;
alter table public.product_media enable row level security;

revoke all on all tables in schema public from anon, authenticated;
grant select on public.brands, public.categories, public.products, public.product_variants, public.product_specifications, public.product_media to anon, authenticated;
grant select on public.profiles, public.inventory_movements, public.admin_variant_inventory to authenticated;
grant insert, update, delete on public.brands, public.categories, public.products, public.product_variants, public.product_specifications, public.product_media to authenticated;
grant insert on public.inventory_movements to authenticated;
grant usage, select on sequence public.inventory_movements_id_seq to authenticated;

create policy profiles_read_self_or_admin on public.profiles for select to authenticated
using (id = (select auth.uid()) or (select public.is_catalog_admin()));

create policy public_read_active_brands on public.brands for select to anon, authenticated using (is_active);
create policy admins_read_all_brands on public.brands for select to authenticated using ((select public.is_catalog_admin()));
create policy admins_insert_brands on public.brands for insert to authenticated with check ((select public.is_catalog_admin()));
create policy admins_update_brands on public.brands for update to authenticated using ((select public.is_catalog_admin())) with check ((select public.is_catalog_admin()));
create policy admins_delete_brands on public.brands for delete to authenticated using ((select public.is_catalog_admin()));

create policy public_read_active_categories on public.categories for select to anon, authenticated using (is_active);
create policy admins_read_all_categories on public.categories for select to authenticated using ((select public.is_catalog_admin()));
create policy admins_insert_categories on public.categories for insert to authenticated with check ((select public.is_catalog_admin()));
create policy admins_update_categories on public.categories for update to authenticated using ((select public.is_catalog_admin())) with check ((select public.is_catalog_admin()));
create policy admins_delete_categories on public.categories for delete to authenticated using ((select public.is_catalog_admin()));

create policy public_read_published_products on public.products for select to anon, authenticated using (publication_status = 'published' and published_at is not null);
create policy admins_read_all_products on public.products for select to authenticated using ((select public.is_catalog_admin()));
create policy admins_insert_products on public.products for insert to authenticated with check ((select public.is_catalog_admin()));
create policy admins_update_products on public.products for update to authenticated using ((select public.is_catalog_admin())) with check ((select public.is_catalog_admin()));
create policy admins_delete_products on public.products for delete to authenticated using ((select public.is_catalog_admin()));

create policy public_read_active_published_variants on public.product_variants for select to anon, authenticated
using (is_active and exists (select 1 from public.products p where p.id = product_id and p.publication_status = 'published' and p.published_at is not null));
create policy admins_read_all_variants on public.product_variants for select to authenticated using ((select public.is_catalog_admin()));
create policy admins_insert_variants on public.product_variants for insert to authenticated with check ((select public.is_catalog_admin()));
create policy admins_update_variants on public.product_variants for update to authenticated using ((select public.is_catalog_admin())) with check ((select public.is_catalog_admin()));
create policy admins_delete_variants on public.product_variants for delete to authenticated using ((select public.is_catalog_admin()));

create policy admins_read_inventory on public.inventory_movements for select to authenticated using ((select public.is_catalog_admin()));
create policy admins_insert_inventory on public.inventory_movements for insert to authenticated with check ((select public.is_catalog_admin()) and actor_id = (select auth.uid()));

create policy public_read_published_specifications on public.product_specifications for select to anon, authenticated
using (exists (select 1 from public.products p where p.id = product_id and p.publication_status = 'published' and p.published_at is not null));
create policy admins_read_all_specifications on public.product_specifications for select to authenticated using ((select public.is_catalog_admin()));
create policy admins_insert_specifications on public.product_specifications for insert to authenticated with check ((select public.is_catalog_admin()));
create policy admins_update_specifications on public.product_specifications for update to authenticated using ((select public.is_catalog_admin())) with check ((select public.is_catalog_admin()));
create policy admins_delete_specifications on public.product_specifications for delete to authenticated using ((select public.is_catalog_admin()));

create policy public_read_published_media on public.product_media for select to anon, authenticated
using (exists (select 1 from public.products p where p.id = product_id and p.publication_status = 'published' and p.published_at is not null));
create policy admins_read_all_media on public.product_media for select to authenticated using ((select public.is_catalog_admin()));
create policy admins_insert_media on public.product_media for insert to authenticated with check ((select public.is_catalog_admin()));
create policy admins_update_media on public.product_media for update to authenticated using ((select public.is_catalog_admin())) with check ((select public.is_catalog_admin()));
create policy admins_delete_media on public.product_media for delete to authenticated using ((select public.is_catalog_admin()));

revoke update, delete on public.inventory_movements from authenticated;
revoke all on public.profiles from anon;
revoke insert, update, delete on public.profiles from authenticated;
