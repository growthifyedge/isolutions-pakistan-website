-- Model-Based Shared Specifications, iPhone + Android (Owner-approved localhost development, 2026-11-20/21).
-- FILE ONLY: not applied to DEV or PROD. Apply on DEV first, then PROD, each only with Owner approval.
--
-- Same phone model = same common specifications. The Owner approves a model's verified specifications once on the
-- Admin page "Model Specs"; this migration then:
--   1. adds them to every existing product of that exact model (New and Used, PTA Approved and Non-PTA, with or without
--      the brand in the title, storage or PTA wording in the title) - apply_model_common_specifications;
--   2. keeps them as the model's Owner-approved common specifications (public.model_common_specifications);
--   3. gives them automatically to products of that model created (or renamed into it) later - a deferred trigger on
--      public.products copies the APPROVED list only (never another product's unverified rows).
--
-- Storage is unchanged: rows go into each product's own public.product_specifications, exactly like Spec Upload, so
-- the storefront PDP, Spec Upload and manual editing work with no change. Products stay separate; titles, slugs,
-- variants, prices, stock, PTA, condition, warranty, battery, grade, SIM, RAM and colour are never touched.
--
-- Safety:
--   * Approving = Owner only (role 'owner', active) - Admin and Staff are refused.
--   * The model is read from brand + title on the server (public.model_spec_key, mirrored by src/lib/iphoneModelSpecs.ts).
--     Only Mobile Phones. Anything that is not an exact model (iPhone extra words, any other bracket such as JV or
--     Refurbished) has no key and is never matched. Pro / Pro Max / Pro+ / Lite / FE / 5G stay part of the model.
--   * The caller must send the exact product set it previewed; if the server finds a different set, nothing is saved.
--   * Add-only by default: a label a product already has (any section, case/spacing ignored) is never changed - the same
--     value counts as present, a different value is a conflict and is kept. An already approved label keeps its approved
--     value. Nothing is deleted.
--   * Correction (Owner ticks it per label, sent in p_corrections with the approved value seen in the preview): the
--     approved value is replaced, and ONLY products whose stored value still equals that old approved value are updated
--     to the new one. Products with any other value keep it (shown as a conflict). A stale old value refuses everything.
--   * Variant-specific facts (storage, RAM, colour, price, PTA, condition, warranty, battery health/cycles, grade, SIM,
--     stock, IMEI) are refused and never copied.
--   * One call = one transaction: everything is saved, or nothing is.

-- Title without wording that never changes the model: PTA (PTA, PTA Approved, Non-PTA, also in brackets), storage
-- (256GB, 1TB, 8/256GB, 8GB+256GB), a trailing "(Used)" and a trailing colour (only when the last word is a known
-- colour: "Burgundy", "Natural Titanium", "Cosmic Orange"). Lower case, single spaces. Same lists as COLOUR_WORDS /
-- COLOUR_MODIFIERS in src/lib/iphoneModelSpecs.ts.
create or replace function public.model_title_core(p_title text)
returns text language plpgsql immutable set search_path = '' as $$
declare
  v text;
  w text[];
  c_colours constant text[] := array['black', 'white', 'blue', 'green', 'red', 'purple', 'pink', 'gold', 'silver', 'gray', 'grey',
    'graphite', 'burgundy', 'orange', 'yellow', 'violet', 'lavender', 'mint', 'cream', 'midnight', 'starlight', 'teal', 'beige',
    'brown', 'bronze', 'copper', 'navy', 'titanium'];
  c_modifiers constant text[] := array['natural', 'desert', 'cosmic', 'deep', 'sky', 'light', 'dark', 'space', 'jet', 'rose',
    'sierra', 'alpine', 'pacific', 'ice', 'icy', 'phantom', 'awesome', 'mist', 'glacier', 'ocean', 'forest', 'sunset', 'lime',
    'lemon', 'matte', 'glossy'];
begin
  if p_title is null then return null; end if;
  v := lower(btrim(regexp_replace(p_title, '\s+', ' ', 'g')));
  v := regexp_replace(v, '(^| )\(?(?:pta[ -]approved|non[ -]?pta|pta)\)?(?= |$)', '', 'g');
  v := regexp_replace(v, '(^| )(?:\d+ ?(?:gb|tb)? ?[/+] ?)?\d+ ?(?:gb|tb)(?= |$)', '', 'g');
  v := regexp_replace(lower(btrim(regexp_replace(v, '\s+', ' ', 'g'))), ' ?\(used\)$', '');
  w := string_to_array(v, ' ');
  if cardinality(w) > 1 and w[cardinality(w)] = any(c_colours) then
    w := w[1:cardinality(w) - 1];
    while cardinality(w) > 1 and (w[cardinality(w)] = any(c_colours) or w[cardinality(w)] = any(c_modifiers)) loop
      w := w[1:cardinality(w) - 1];
    end loop;
  end if;
  return array_to_string(w, ' ');
end;
$$;

-- Optional series word written after (or instead of) the brand: "Samsung Galaxy A57" = "Samsung A57" = "Galaxy A57".
-- Same list as BRAND_SERIES_ALIASES in src/lib/iphoneModelSpecs.ts.
create or replace function public.model_brand_series_alias(p_brand_slug text)
returns text language sql immutable set search_path = '' as $$
  select case p_brand_slug when 'samsung' then 'galaxy' when 'motorola' then 'moto' end;
$$;

create or replace function public.iphone_model_key(p_title text)
returns text language plpgsql immutable set search_path = '' as $$
declare v text; m text[];
begin
  if p_title is null then return null; end if;
  v := public.model_title_core(p_title);                -- PTA / storage words are not part of the model
  v := regexp_replace(v, ' ?\(used\)$', '');            -- condition is not part of the model
  v := regexp_replace(v, '^apple ', '');                -- "Apple iPhone ..." = "iPhone ..."
  v := regexp_replace(v, '([0-9])(pro|plus|mini)', '\1 \2', 'g');  -- "15Pro" = "15 Pro"
  v := regexp_replace(v, 'pro ?max', 'pro max', 'g');   -- "ProMax" = "Pro Max"
  if v = 'iphone air' then return 'iphone-air'; end if;
  m := regexp_match(v, '^iphone (x|xr|xs|xs max)$');
  if m is not null then return 'iphone-' || replace(m[1], ' ', '-'); end if;
  m := regexp_match(v, '^iphone ([1-9][0-9]?)e$');
  if m is not null then return 'iphone-' || m[1] || 'e'; end if;
  m := regexp_match(v, '^iphone ([1-9][0-9]?)(?: (pro max|pro|plus|mini))?$');
  if m is not null then return 'iphone-' || m[1] || coalesce('-' || replace(m[2], ' ', '-'), ''); end if;
  return null;
end;
$$;
grant execute on function public.iphone_model_key(text) to authenticated;

-- Phone model key: iPhone rules for Apple; for every other brand, brand slug + model with the brand name in front,
-- "(Used)", PTA and storage ignored ("Samsung A57 PTA 8/256GB (Used)" -> "samsung-a57").
create or replace function public.model_spec_key(p_brand_slug text, p_title text)
returns text language plpgsql immutable set search_path = '' as $$
declare v text; b text; s text;
begin
  if p_brand_slug is null or p_title is null then return null; end if;
  if p_brand_slug = 'apple' then return public.iphone_model_key(p_title); end if;
  if p_brand_slug !~ '^[a-z0-9]+(-[a-z0-9]+)*$' then return null; end if;
  v := regexp_replace(public.model_title_core(p_title), ' ?\(used\)$', '');
  if v ~ '[()]' then return null; end if;               -- JV, Refurbished, ... = not an exact model
  b := replace(p_brand_slug, '-', ' ');
  if v = b then return null; end if;
  if left(v, length(b) + 1) = b || ' ' then v := substr(v, length(b) + 2); end if;
  s := public.model_brand_series_alias(p_brand_slug);   -- "Galaxy" / "Moto"
  if s is not null and v = s then return null; end if;
  if s is not null and left(v, length(s) + 1) = s || ' ' then v := substr(v, length(s) + 2); end if;
  v := regexp_replace(v, '([0-9])(pro|max|plus|ultra|lite|mini|neo|prime|fe)(?= |\+|$)', '\1 \2', 'g');
  v := regexp_replace(v, 'pro ?max', 'pro max', 'g');
  v := regexp_replace(regexp_replace(v, '\+', ' plus ', 'g'), '[^a-z0-9]+', '-', 'g');
  v := regexp_replace(v, '^-+|-+$', '', 'g');
  if v = '' then return null; end if;
  return p_brand_slug || '-' || v;
end;
$$;
grant execute on function public.model_spec_key(text, text) to authenticated;

create or replace function public.is_catalog_owner()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.profiles where id = (select auth.uid()) and role = 'owner'::public.app_role and is_active);
$$;
revoke all on function public.is_catalog_owner() from public, anon;
grant execute on function public.is_catalog_owner() to authenticated;

-- Same rule as isVariantSpecificLabel in src/lib/iphoneModelSpecs.ts.
create or replace function public.is_variant_specific_spec(p_group text, p_label text)
returns boolean language sql immutable set search_path = '' as $$
  select coalesce(p_label, '') ~* '(^|[^a-z])(storage|ram|memory|colou?rs?|price|pta|condition|warranty|battery health|battery cycles?|cycle count|grade|sim|stock|imei)([^a-z]|$)'
      or coalesce(p_group, '') ~* '^(storage|memory|variant|variants|price|pricing)$';
$$;

-- The model's Owner-approved common specifications (the only source for automatic copying to future products).
create table if not exists public.model_common_specifications (
  id uuid primary key default gen_random_uuid(),
  model_key text not null check (model_key ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and length(model_key) <= 120),
  specification_group text not null check (specification_group in ('Display', 'Performance', 'Software', 'Camera', 'Battery', 'Connectivity', 'Build', 'Audio', 'Security', 'Other')),
  label text not null check (length(label) between 1 and 120),
  value text not null check (length(value) between 1 and 600),
  sort_order integer not null default 0,
  approved_by uuid not null,
  approved_at timestamptz not null default now()
);
create unique index if not exists model_common_specifications_label_uidx on public.model_common_specifications (model_key, lower(label));

alter table public.model_common_specifications enable row level security;
revoke all on public.model_common_specifications from public, anon, authenticated;
grant select on public.model_common_specifications to authenticated;
drop policy if exists admins_read_model_common_specifications on public.model_common_specifications;
create policy admins_read_model_common_specifications on public.model_common_specifications for select to authenticated
  using ((select public.is_catalog_admin()));
-- No insert / update / delete policy or grant: written only by apply_model_common_specifications (Owner).

drop function if exists public.apply_iphone_model_specifications(text, uuid[], jsonb);

create or replace function public.apply_model_common_specifications(p_model_key text, p_product_ids uuid[], p_specs jsonb, p_corrections jsonb default '[]'::jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
set lock_timeout = '2s'
as $$
declare
  v_specs jsonb := coalesce(p_specs, '[]'::jsonb);
  v_expected uuid[] := coalesce(p_product_ids, array[]::uuid[]);
  v_server uuid[];
  v_product uuid;
  v_item jsonb;
  v_group text; v_label text; v_value text;
  v_existing public.product_specifications%rowtype;
  v_approved public.model_common_specifications%rowtype;
  v_order integer;
  v_inserted integer; v_present integer; v_conflicts integer;
  v_total integer := 0;
  v_results jsonb := '[]'::jsonb;
  v_labels text[] := array[]::text[];
  v_appr_added integer := 0; v_appr_present integer := 0; v_appr_kept integer := 0; v_appr_corrected integer := 0;
  v_corr jsonb := '{}'::jsonb;        -- lower(label) -> old approved value (normalised)
  v_old text;
  v_corrected integer; v_total_corrected integer := 0;
begin
  if not public.is_catalog_owner() then
    raise exception using errcode = '42501', message = 'apply_model_common_specifications_forbidden: owner required';
  end if;
  if p_model_key is null or p_model_key !~ '^[a-z0-9]+(-[a-z0-9]+)*$' or length(p_model_key) > 120 then
    raise exception 'apply_model_common_specifications_invalid_model';
  end if;
  if jsonb_typeof(v_specs) <> 'array' or jsonb_array_length(v_specs) < 1 or jsonb_array_length(v_specs) > 120 then
    raise exception 'apply_model_common_specifications_invalid_payload: 1 to 120 specifications are required';
  end if;

  -- Validate the shared specifications once.
  for v_item in select value from jsonb_array_elements(v_specs) loop
    v_group := btrim(coalesce(v_item ->> 'specification_group', ''));
    v_label := regexp_replace(btrim(coalesce(v_item ->> 'label', '')), '\s+', ' ', 'g');
    v_value := btrim(coalesce(v_item ->> 'value', ''));
    if v_group not in ('Display', 'Performance', 'Software', 'Camera', 'Battery', 'Connectivity', 'Build', 'Audio', 'Security', 'Other')
       or v_label = '' or v_value = '' or length(v_label) > 120 or length(v_value) > 600 then
      raise exception 'apply_model_common_specifications_invalid_payload: every specification needs a known section, a label and a value';
    end if;
    if public.is_variant_specific_spec(v_group, v_label) then
      raise exception 'apply_model_common_specifications_variant_specific: "%" belongs to variants and is never shared', v_label;
    end if;
    if lower(v_label) = any(v_labels) then
      raise exception 'apply_model_common_specifications_invalid_payload: "%" is listed twice', v_label;
    end if;
    v_labels := array_append(v_labels, lower(v_label));
  end loop;

  -- Corrections of approved values (Owner ticked them in the preview).
  if jsonb_typeof(coalesce(p_corrections, '[]'::jsonb)) <> 'array' then
    raise exception 'apply_model_common_specifications_invalid_payload: corrections must be a list';
  end if;
  for v_item in select value from jsonb_array_elements(coalesce(p_corrections, '[]'::jsonb)) loop
    v_label := lower(regexp_replace(btrim(coalesce(v_item ->> 'label', '')), '\s+', ' ', 'g'));
    v_old := regexp_replace(btrim(coalesce(v_item ->> 'old_value', '')), '\s+', ' ', 'g');
    if v_label = '' or v_old = '' or not (v_label = any(v_labels)) or v_corr ? v_label then
      raise exception 'apply_model_common_specifications_invalid_payload: a correction needs a label from the list and its old approved value';
    end if;
    v_corr := v_corr || jsonb_build_object(v_label, v_old);
  end loop;

  -- The exact products of this model, decided on the server.
  select coalesce(array_agg(p.id order by p.id), array[]::uuid[]) into v_server
  from public.products p
  join public.brands b on b.id = p.brand_id
  join public.categories c on c.id = p.category_id
  where c.slug = 'mobile-phones' and public.model_spec_key(b.slug, p.title) = p_model_key;
  if cardinality(v_server) = 0 then
    raise exception 'apply_model_common_specifications_no_products: no product matches this model';
  end if;
  if (select coalesce(array_agg(x order by x), array[]::uuid[]) from (select distinct unnest(v_expected) x) d) is distinct from v_server then
    raise exception 'apply_model_common_specifications_stale: the matching products changed since the preview; nothing was saved';
  end if;

  -- 1. Record the Owner-approved common specifications of the model (add-only).
  perform pg_advisory_xact_lock(hashtextextended('model_common_specifications:' || p_model_key, 0));
  select coalesce(max(sort_order), -1) + 1 into v_order from public.model_common_specifications where model_key = p_model_key;
  for v_item in select value from jsonb_array_elements(v_specs) loop
    v_group := btrim(v_item ->> 'specification_group');
    v_label := regexp_replace(btrim(v_item ->> 'label'), '\s+', ' ', 'g');
    v_value := btrim(v_item ->> 'value');
    select * into v_approved from public.model_common_specifications where model_key = p_model_key and lower(label) = lower(v_label);
    if found then
      if v_corr ? lower(v_label) and regexp_replace(btrim(v_approved.value), '\s+', ' ', 'g') is distinct from v_corr ->> lower(v_label) then
        raise exception 'apply_model_common_specifications_stale_approved: the approved value of "%" changed since the preview; nothing was saved', v_label;
      end if;
      if regexp_replace(v_approved.value, '\s+', ' ', 'g') = regexp_replace(v_value, '\s+', ' ', 'g') then
        v_appr_present := v_appr_present + 1;
      elsif v_corr ? lower(v_label) then
        update public.model_common_specifications
        set specification_group = v_group, value = v_value, approved_by = (select auth.uid()), approved_at = now()
        where id = v_approved.id;
        v_appr_corrected := v_appr_corrected + 1;
      else
        v_appr_kept := v_appr_kept + 1;   -- the earlier approved value is kept
      end if;
      continue;
    end if;
    if v_corr ? lower(v_label) then
      raise exception 'apply_model_common_specifications_stale_approved: "%" has no approved value to correct; nothing was saved', v_label;
    end if;
    insert into public.model_common_specifications (model_key, specification_group, label, value, sort_order, approved_by)
    values (p_model_key, v_group, v_label, v_value, v_order, (select auth.uid()));
    v_order := v_order + 1;
    v_appr_added := v_appr_added + 1;
  end loop;

  -- 2. Add the missing ones to every existing product of the model (add-only).
  foreach v_product in array v_server loop
    perform pg_advisory_xact_lock(hashtextextended('product_specifications:' || v_product::text, 0));
    v_inserted := 0; v_present := 0; v_conflicts := 0; v_corrected := 0;
    select coalesce(max(sort_order), -1) + 1 into v_order from public.product_specifications where product_id = v_product;
    for v_item in select value from jsonb_array_elements(v_specs) loop
      v_group := btrim(v_item ->> 'specification_group');
      v_label := regexp_replace(btrim(v_item ->> 'label'), '\s+', ' ', 'g');
      v_value := btrim(v_item ->> 'value');
      select * into v_existing from public.product_specifications
      where product_id = v_product and lower(regexp_replace(btrim(label), '\s+', ' ', 'g')) = lower(v_label)
      limit 1;
      if found then
        if regexp_replace(btrim(v_existing.value), '\s+', ' ', 'g') = regexp_replace(v_value, '\s+', ' ', 'g') then
          v_present := v_present + 1;
        elsif v_corr ? lower(v_label) and regexp_replace(btrim(v_existing.value), '\s+', ' ', 'g') = v_corr ->> lower(v_label) then
          -- Owner-ticked correction: this product still shows the old approved value, so it follows the correction.
          update public.product_specifications set value = v_value where id = v_existing.id;
          v_corrected := v_corrected + 1;
        else
          v_conflicts := v_conflicts + 1;   -- stored value kept, never overwritten
        end if;
        continue;
      end if;
      insert into public.product_specifications (product_id, specification_group, label, value, sort_order)
      values (v_product, v_group, v_label, v_value, v_order);
      v_order := v_order + 1;
      v_inserted := v_inserted + 1;
    end loop;
    v_total := v_total + v_inserted;
    v_total_corrected := v_total_corrected + v_corrected;
    v_results := v_results || jsonb_build_object('product_id', v_product, 'inserted', v_inserted, 'present', v_present, 'conflicts', v_conflicts, 'corrected', v_corrected);
  end loop;

  return jsonb_build_object('model_key', p_model_key, 'products', v_results, 'inserted', v_total, 'corrected', v_total_corrected,
    'approved', jsonb_build_object('added', v_appr_added, 'present', v_appr_present, 'kept', v_appr_kept, 'corrected', v_appr_corrected));
end;
$$;

revoke all on function public.apply_model_common_specifications(text, uuid[], jsonb, jsonb) from public, anon;
grant execute on function public.apply_model_common_specifications(text, uuid[], jsonb, jsonb) to authenticated;

comment on function public.apply_model_common_specifications(text, uuid[], jsonb, jsonb) is
  'Model shared specifications (iPhone + Android): records the Owner-approved common specifications of one exact phone model and adds the missing ones to every product of that model (server-side brand + title match). Owner only, add-only unless the Owner ticks a correction of an approved value (then only products still showing the old approved value follow), all or nothing, refuses variant-specific labels.';

-- Future products: when a product is created (or its title / brand / category changes) and its model has
-- Owner-approved common specifications, the missing ones are added. Deferred to the end of the transaction, so the
-- product's own specifications from Bulk Import / Add Product are saved first and always win.
create or replace function public.copy_approved_model_specifications()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_key text;
  v_order integer;
  r public.model_common_specifications%rowtype;
begin
  select public.model_spec_key(b.slug, p.title) into v_key
  from public.products p
  join public.brands b on b.id = p.brand_id
  join public.categories c on c.id = p.category_id
  where p.id = new.id and c.slug = 'mobile-phones';
  if v_key is null or not exists (select 1 from public.model_common_specifications where model_key = v_key) then
    return null;
  end if;
  perform pg_advisory_xact_lock(hashtextextended('product_specifications:' || new.id::text, 0));
  select coalesce(max(sort_order), -1) + 1 into v_order from public.product_specifications where product_id = new.id;
  for r in
    select m.* from public.model_common_specifications m
    where m.model_key = v_key
      and not public.is_variant_specific_spec(m.specification_group, m.label)
      and not exists (select 1 from public.product_specifications s
                      where s.product_id = new.id and lower(regexp_replace(btrim(s.label), '\s+', ' ', 'g')) = lower(m.label))
    order by m.sort_order, m.label
  loop
    insert into public.product_specifications (product_id, specification_group, label, value, sort_order)
    values (new.id, r.specification_group, r.label, r.value, v_order);
    v_order := v_order + 1;
  end loop;
  return null;
end;
$$;
revoke all on function public.copy_approved_model_specifications() from public, anon, authenticated;

drop trigger if exists products_copy_approved_model_specifications on public.products;
create constraint trigger products_copy_approved_model_specifications
  after insert or update of title, brand_id, category_id on public.products
  deferrable initially deferred
  for each row execute function public.copy_approved_model_specifications();
