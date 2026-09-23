begin;

insert into public.brands (
  name,
  slug,
  description,
  logo_reference,
  is_active,
  data_class
)
values
  ('Apple', 'apple', null, '/assets/brands/apple.svg', true, 'real'),
  ('Samsung', 'samsung', null, '/assets/brands/samsung.svg', true, 'real'),
  ('Xiaomi', 'xiaomi', null, '/assets/brands/xiaomi.svg', true, 'real'),
  ('Motorola', 'motorola', null, '/assets/brands/motorola.svg', true, 'real'),
  ('Honor', 'honor', null, '/assets/brands/honor.svg', true, 'real'),
  ('Nothing', 'nothing', null, '/assets/brands/nothing.svg', true, 'real'),
  ('Google', 'google', null, '/assets/brands/google.svg', true, 'real'),
  ('Tecno', 'tecno', null, '/assets/brands/tecno.svg', true, 'real'),
  ('Infinix', 'infinix', null, '/assets/brands/infinix.svg', true, 'real'),
  ('Vivo', 'vivo', null, '/assets/brands/vivo.svg', true, 'real'),
  ('Oppo', 'oppo', null, '/assets/brands/oppo.svg', true, 'real'),
  ('Realme', 'realme', null, '/assets/brands/realme.svg', true, 'real'),
  ('itel', 'itel', null, '/assets/brands/itel.svg', true, 'real'),
  ('OnePlus', 'oneplus', null, '/assets/brands/oneplus.svg', true, 'real')
on conflict (slug) do update
set
  name = excluded.name,
  logo_reference = excluded.logo_reference,
  is_active = true,
  data_class = 'real',
  updated_at = now();

commit;