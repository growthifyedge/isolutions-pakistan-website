insert into public.categories (
  name,
  slug,
  description,
  data_class,
  is_active
)
values (
  'Mobile Accessories',
  'mobile-accessories',
  'Accessories for mobile devices.',
  'real',
  true
)
on conflict (slug) do update
set
  name = excluded.name,
  description = excluded.description,
  data_class = excluded.data_class,
  is_active = excluded.is_active,
  updated_at = now();

do $$
begin
  if not exists (
    select 1
    from public.categories
    where name = 'Mobile Accessories'
      and slug = 'mobile-accessories'
      and data_class = 'real'
      and is_active
  ) then
    raise exception 'mobile_accessories_category_verification_failed';
  end if;
end
$$;