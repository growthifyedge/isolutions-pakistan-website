create function public.delete_product_variant(p_variant_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_exists boolean;
begin
  if not public.is_catalog_admin() then
    raise exception 'catalog_admin_required';
  end if;

  select exists (
    select 1 from public.product_variants where id = p_variant_id
  ) into v_exists;

  if not v_exists then
    raise exception 'variant_not_found';
  end if;

  if exists (
    select 1 from public.product_media where variant_id = p_variant_id
  ) then
    raise exception 'variant_media_cleanup_required';
  end if;

  update public.bundle_items
  set variant_id = null
  where variant_id = p_variant_id;

  delete from public.inventory_movements where variant_id = p_variant_id;
  delete from public.product_variants where id = p_variant_id;

  return found;
end;
$$;

revoke all on function public.delete_product_variant(uuid) from public;
grant execute on function public.delete_product_variant(uuid) to authenticated;

comment on function public.delete_product_variant(uuid) is
  'Deletes one explicit variant for a catalog admin after Cloudinary-backed variant media has been safely removed; inventory is cleaned and bundle items fall back to product-level selection.';
