-- Home Gadgets subcategories: product_subcategories + products.subcategory_id + catalog filter + Admin assignment RPC.
-- NOT YET APPLIED to any database (Owner authorization 2026-11-09: localhost implementation and QA only).
-- Requires 202610230002_public_catalog_variant_sim_battery.sql (current search_public_catalog definition).
--
-- Owner-approved plan (PROJECT_HANDOVER.md §5F.4; the specifications-row workaround was rejected):
--   * product_subcategories: name, slug, sort order, active flag, parent category `gadgets` only. The 10 Owner-approved
--     rows are seeded here. The list is changed only by a reviewed migration: clients get SELECT only (no insert /
--     update / delete grant or policy), so the Admin UI cannot create, rename or move a subcategory.
--   * products.subcategory_id: nullable. A composite foreign key (subcategory_id, category_id) → product_subcategories
--     (id, category_id) means a product can only point at a subcategory of its OWN category (today: gadgets). Changing
--     the category of a product that still has a subcategory is refused; deleting a used subcategory is refused.
--   * No product is assigned here. Every existing product keeps subcategory_id NULL; no product category, name, price,
--     variant, stock, description, media or publication status changes.
--   * validate_product_for_publication / enforce_product_publication do not read subcategory_id, and the trigger fires
--     only on publication_status changes, so assigning a subcategory never unpublishes or re-validates a product.
--   * search_public_catalog: one new optional filter p_subcategory_slugs (default NULL = no filter) and one new returned
--     column `subcategory` ({id,name,slug}, NULL when none or inactive). Eligibility (real + published + published_at +
--     active real category + active real brand), every other filter, the ordering, the 100-row cap and the variant /
--     media / specification JSON are unchanged from 202610230002. The return type changes, so the old function is
--     dropped and re-created inside this transaction with the same anon / authenticated EXECUTE grants.
--   * admin_assign_product_subcategories(jsonb): Admin bulk SKU → subcategory assignment. SECURITY DEFINER, refuses
--     non-admins, resolves SKUs on the server, validates EVERY row first (unknown SKU, unknown / inactive subcategory,
--     other category, duplicate SKU, two SKUs of one product with different subcategories, changed since preview) and
--     writes nothing unless all rows are valid (all-or-nothing). It updates only products.subcategory_id.

begin;

-- 1. The subcategory list --------------------------------------------------------------------------------------------

create table public.product_subcategories (
  id uuid primary key default extensions.gen_random_uuid(),
  category_id uuid not null references public.categories(id) on delete restrict,
  name text not null,
  slug text not null,
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint product_subcategories_name_not_blank check (char_length(btrim(name)) > 0),
  constraint product_subcategories_slug_format check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  constraint product_subcategories_slug_key unique (slug),
  constraint product_subcategories_category_name_key unique (category_id, name),
  -- Target of the products composite foreign key (subcategory must belong to the product's own category).
  constraint product_subcategories_id_category_key unique (id, category_id)
);

create index product_subcategories_category_sort_idx on public.product_subcategories (category_id, sort_order);

create trigger product_subcategories_set_updated_at before update on public.product_subcategories
  for each row execute function public.set_updated_at();

-- Parent category must be `gadgets` (Owner decision: Home Gadgets subcategories only).
create function public.product_subcategories_gadgets_only()
returns trigger language plpgsql set search_path = '' as $$
begin
  if not exists (select 1 from public.categories c where c.id = new.category_id and c.slug = 'gadgets') then
    raise exception 'product_subcategories_parent_must_be_gadgets' using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger product_subcategories_gadgets_only before insert or update of category_id on public.product_subcategories
  for each row execute function public.product_subcategories_gadgets_only();

-- The 10 Owner-approved Home Gadgets subcategories (names, order and slugs from the approved Piyave mapping).
do $$
declare
  v_gadgets uuid;
begin
  select id into v_gadgets from public.categories where slug = 'gadgets';
  if v_gadgets is null then
    raise exception 'Home Gadgets subcategories aborted: category gadgets not found';
  end if;
  insert into public.product_subcategories (category_id, name, slug, sort_order) values
    (v_gadgets, 'Kitchen & Dining',      'kitchen-dining',      1),
    (v_gadgets, 'Storage & Organizers',  'storage-organizers',  2),
    (v_gadgets, 'Home & Living',         'home-living',         3),
    (v_gadgets, 'Bathroom Essentials',   'bathroom-essentials', 4),
    (v_gadgets, 'Health & Beauty',       'health-beauty',       5),
    (v_gadgets, 'Gadgets & Accessories', 'gadgets-accessories', 6),
    (v_gadgets, 'Bags & Travel',         'bags-travel',         7),
    (v_gadgets, 'Laundry & Cleaning',    'laundry-cleaning',    8),
    (v_gadgets, 'Sports & Outdoors',     'sports-outdoors',     9),
    (v_gadgets, 'Kids & Toys',           'kids-toys',           10);
end;
$$;

-- RLS: everyone may read active rows, admins read all; nobody writes through the API (migrations only).
alter table public.product_subcategories enable row level security;
revoke all on public.product_subcategories from public, anon, authenticated;
grant select on public.product_subcategories to anon, authenticated;
create policy public_read_active_product_subcategories on public.product_subcategories
  for select to anon, authenticated using (is_active);
create policy admins_read_all_product_subcategories on public.product_subcategories
  for select to authenticated using ((select public.is_catalog_admin()));

-- 2. Product → subcategory --------------------------------------------------------------------------------------------

alter table public.products add column subcategory_id uuid;

alter table public.products add constraint products_subcategory_same_category_fkey
  foreign key (subcategory_id, category_id) references public.product_subcategories (id, category_id)
  on update restrict on delete restrict;

create index products_subcategory_id_idx on public.products (subcategory_id) where subcategory_id is not null;

comment on column public.products.subcategory_id is
  'Optional Home Gadgets subcategory (product_subcategories). Must belong to the product''s own category. Not read by publication validation.';

-- 3. Public catalog: subcategory filter + returned subcategory -------------------------------------------------------

drop function public.search_public_catalog(text,text,text[],text[],bigint,bigint,text[],text[],public.pta_status[],boolean,public.delivery_scope[],integer,integer);

create function public.search_public_catalog(
  p_search text default null, p_slug text default null,
  p_category_slugs text[] default null, p_brand_slugs text[] default null,
  p_price_min bigint default null, p_price_max bigint default null,
  p_storage text[] default null, p_ram text[] default null,
  p_pta_status public.pta_status[] default null, p_in_stock boolean default null,
  p_delivery_scope public.delivery_scope[] default null,
  p_limit integer default 48, p_offset integer default 0,
  p_subcategory_slugs text[] default null
)
returns table (
  id uuid, slug text, title text, short_description text, content text,
  default_warranty text, published_at timestamptz,
  is_flash_sale boolean, is_featured boolean, is_best_seller boolean,
  brand jsonb, category jsonb, variants jsonb, media jsonb, specifications jsonb,
  subcategory jsonb
)
language sql stable security definer set search_path = '' as $$
  with inventory as (
    select v.id as variant_id, coalesce(sum(m.quantity_delta), 0)::bigint as quantity
    from public.product_variants v left join public.inventory_movements m on m.variant_id = v.id
    group by v.id
  ), eligible as (
    select p.* from public.products p
    left join public.brands b on b.id = p.brand_id
    join public.categories c on c.id = p.category_id
    where p.data_class = 'real' and p.publication_status = 'published' and p.published_at is not null
      and (p.brand_id is null or (b.data_class = 'real' and b.is_active))
      and c.data_class = 'real' and c.is_active
      and (p_slug is null or p.slug = p_slug)
      and (p_search is null or btrim(p_search) = '' or p.title ilike '%' || btrim(p_search) || '%' or b.name ilike '%' || btrim(p_search) || '%' or c.name ilike '%' || btrim(p_search) || '%')
      and (p_category_slugs is null or c.slug = any(p_category_slugs))
      and (p_brand_slugs is null or b.slug = any(p_brand_slugs))
      and (p_subcategory_slugs is null or exists (
        select 1 from public.product_subcategories sc
        where sc.id = p.subcategory_id and sc.category_id = p.category_id and sc.is_active and sc.slug = any(p_subcategory_slugs)
      ))
      and exists (
        select 1 from public.product_variants v left join inventory i on i.variant_id = v.id
        where v.product_id = p.id and v.is_active
          and (p_price_min is null or v.price_minor >= p_price_min)
          and (p_price_max is null or v.price_minor <= p_price_max)
          and (p_storage is null or v.storage_display = any(p_storage))
          and (p_ram is null or v.ram_display = any(p_ram))
          and (p_pta_status is null or v.pta_status = any(p_pta_status))
          and (p_delivery_scope is null or coalesce(v.delivery_scope, p.default_delivery_scope) = any(p_delivery_scope))
          and (p_in_stock is null or not p_in_stock or coalesce(i.quantity, 0) > 0)
      )
    order by p.published_at desc, p.id
    limit least(greatest(coalesce(p_limit, 48), 1), 100) offset greatest(coalesce(p_offset, 0), 0)
  )
  select p.id, p.slug, p.title, p.short_description, p.content, p.default_warranty, p.published_at,
    p.is_flash_sale, p.is_featured, p.is_best_seller,
    case when b.id is null then null else jsonb_build_object('id', b.id, 'name', b.name, 'slug', b.slug) end as brand,
    jsonb_build_object('id', c.id, 'name', c.name, 'slug', c.slug) as category,
    coalesce((select jsonb_agg(jsonb_build_object(
      'id', v.id, 'sku', v.sku, 'ram', v.ram_display, 'storage', v.storage_display,
      'color', v.color_finish, 'priceMinor', v.price_minor,
      'compareAtPriceMinor', case when v.compare_at_price_minor > v.price_minor then v.compare_at_price_minor else null end,
      'ptaStatus', v.pta_status, 'condition', v.condition,
      'warranty', coalesce(v.warranty_override, p.default_warranty), 'carrierJv', v.carrier_jv,
      'deliveryScope', coalesce(v.delivery_scope, p.default_delivery_scope), 'quantity', coalesce(i.quantity, 0),
      'simConfiguration', v.sim_configuration, 'batteryHealthPercent', v.battery_health_percent
    ) order by v.sort_order, v.id) from public.product_variants v left join inventory i on i.variant_id = v.id where v.product_id = p.id and v.is_active), '[]'::jsonb) as variants,
    coalesce((select jsonb_agg(jsonb_build_object(
      'id', m.id, 'variantId', m.variant_id,
      'variantIds', coalesce((select jsonb_agg(a.variant_id order by a.variant_id) from public.product_media_variant_assignments a where a.media_id = m.id), '[]'::jsonb),
      'publicId', m.cloudinary_public_id, 'url', m.secure_url, 'alt', m.alt_text,
      'width', m.width, 'height', m.height, 'format', m.format, 'isPrimary', m.is_primary
    ) order by m.is_primary desc, m.sort_order, m.id) from public.product_media m where m.product_id = p.id and m.secure_url is not null), '[]'::jsonb) as media,
    coalesce((select jsonb_agg(jsonb_build_object('group', s.specification_group, 'label', s.label, 'value', s.value)
      order by s.sort_order, s.id) from public.product_specifications s where s.product_id = p.id), '[]'::jsonb) as specifications,
    case when sc.id is null then null else jsonb_build_object('id', sc.id, 'name', sc.name, 'slug', sc.slug) end as subcategory
  from eligible p left join public.brands b on b.id = p.brand_id join public.categories c on c.id = p.category_id
  left join public.product_subcategories sc on sc.id = p.subcategory_id and sc.category_id = p.category_id and sc.is_active
  order by p.published_at desc, p.id;
$$;

revoke all on function public.search_public_catalog(text,text,text[],text[],bigint,bigint,text[],text[],public.pta_status[],boolean,public.delivery_scope[],integer,integer,text[]) from public;
grant execute on function public.search_public_catalog(text,text,text[],text[],bigint,bigint,text[],text[],public.pta_status[],boolean,public.delivery_scope[],integer,integer,text[]) to anon, authenticated;

-- 4. Admin bulk SKU → subcategory assignment ---------------------------------------------------------------------------
-- p_assignments: [{ "sku": "GD032", "subcategory": "kitchen-dining", "expected_current": null | "<slug>" }, ...]
--   expected_current = the product's subcategory slug the Admin preview showed (null = none). A different stored value
--   means somebody changed it after the preview, and the whole call is refused.
-- Returns { "total": n, "updated": n, "unchanged": n }. Raises (nothing written) when any row is invalid.

create function public.admin_assign_product_subcategories(p_assignments jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_item jsonb;
  v_index integer := 0;
  v_sku text;
  v_slug text;
  v_expected text;
  v_product_id uuid;
  v_product_category uuid;
  v_current_slug text;
  v_sub_id uuid;
  v_sub_category uuid;
  v_sub_active boolean;
  v_errors text[] := '{}';
  v_seen_skus text[] := '{}';
  v_plan_products uuid[] := '{}';
  v_plan_subs uuid[] := '{}';
  v_pos integer;
  v_updated integer := 0;
  v_unchanged integer := 0;
  v_rows integer;
begin
  if not coalesce(public.is_catalog_admin(), false) then
    raise exception 'catalog_admin_required' using errcode = '42501';
  end if;
  if p_assignments is null or jsonb_typeof(p_assignments) <> 'array' or jsonb_array_length(p_assignments) = 0 then
    raise exception 'subcategory_assignments_required' using errcode = '22023';
  end if;
  if jsonb_array_length(p_assignments) > 1000 then
    raise exception 'subcategory_assignments_too_many (max 1000)' using errcode = '22023';
  end if;

  -- Pass 1: validate every row; nothing is written.
  for v_item in select value from jsonb_array_elements(p_assignments) loop
    v_index := v_index + 1;
    if jsonb_typeof(v_item) <> 'object' then
      v_errors := array_append(v_errors, format('row %s: not an object', v_index));
      continue;
    end if;
    v_sku := upper(btrim(coalesce(v_item->>'sku', '')));
    v_slug := lower(btrim(coalesce(v_item->>'subcategory', '')));
    v_expected := nullif(lower(btrim(coalesce(v_item->>'expected_current', ''))), '');
    if v_sku = '' then
      v_errors := array_append(v_errors, format('row %s: SKU is empty', v_index));
      continue;
    end if;
    if v_sku = any(v_seen_skus) then
      v_errors := array_append(v_errors, format('row %s: SKU %s appears more than once', v_index, v_sku));
      continue;
    end if;
    v_seen_skus := array_append(v_seen_skus, v_sku);
    if v_slug = '' then
      v_errors := array_append(v_errors, format('row %s: SKU %s has no subcategory', v_index, v_sku));
      continue;
    end if;

    select p.id, p.category_id, sc.slug into v_product_id, v_product_category, v_current_slug
    from public.product_variants v
    join public.products p on p.id = v.product_id
    left join public.product_subcategories sc on sc.id = p.subcategory_id
    where upper(btrim(v.sku)) = v_sku;
    if v_product_id is null then
      v_errors := array_append(v_errors, format('row %s: SKU %s not found', v_index, v_sku));
      continue;
    end if;

    select sc.id, sc.category_id, sc.is_active into v_sub_id, v_sub_category, v_sub_active
    from public.product_subcategories sc where sc.slug = v_slug;
    if v_sub_id is null then
      v_errors := array_append(v_errors, format('row %s: subcategory %s not found', v_index, v_slug));
      continue;
    end if;
    if not v_sub_active then
      v_errors := array_append(v_errors, format('row %s: subcategory %s is not active', v_index, v_slug));
      continue;
    end if;
    if v_sub_category <> v_product_category then
      v_errors := array_append(v_errors, format('row %s: SKU %s is not in the category of subcategory %s', v_index, v_sku, v_slug));
      continue;
    end if;
    if v_item ? 'expected_current' and v_current_slug is distinct from v_expected then
      v_errors := array_append(v_errors, format('row %s: SKU %s subcategory changed after the preview (now %s)', v_index, v_sku, coalesce(v_current_slug, 'none')));
      continue;
    end if;

    v_pos := array_position(v_plan_products, v_product_id);
    if v_pos is not null then
      if v_plan_subs[v_pos] <> v_sub_id then
        v_errors := array_append(v_errors, format('row %s: SKU %s belongs to a product already given a different subcategory', v_index, v_sku));
      end if;
      continue;
    end if;
    v_plan_products := array_append(v_plan_products, v_product_id);
    v_plan_subs := array_append(v_plan_subs, v_sub_id);

    v_product_id := null; v_sub_id := null; v_current_slug := null;
  end loop;

  if cardinality(v_errors) > 0 then
    raise exception 'subcategory_assignment_rejected: %', array_to_string(v_errors[1:25], '; ')
      using errcode = '22023', detail = format('%s invalid row(s); nothing was saved.', cardinality(v_errors));
  end if;

  -- Pass 2: write only products.subcategory_id (never publication_status, so no publication trigger fires).
  for v_pos in 1 .. coalesce(array_length(v_plan_products, 1), 0) loop
    update public.products set subcategory_id = v_plan_subs[v_pos]
    where id = v_plan_products[v_pos] and subcategory_id is distinct from v_plan_subs[v_pos];
    get diagnostics v_rows = row_count;
    if v_rows = 1 then v_updated := v_updated + 1; else v_unchanged := v_unchanged + 1; end if;
  end loop;

  return jsonb_build_object('total', coalesce(array_length(v_plan_products, 1), 0), 'updated', v_updated, 'unchanged', v_unchanged);
end;
$$;

revoke all on function public.admin_assign_product_subcategories(jsonb) from public, anon;
grant execute on function public.admin_assign_product_subcategories(jsonb) to authenticated;

commit;
