-- Owner-approved (2026-10-15): add exactly two real Android phone brands so the Android Stock Update can create their phones.
--   ZTE    (slug zte)
--   VgoTel (slug vgotel)
--
-- Reuses the canonical real-brand pattern of 202609020001_phase_4_canonical_storefront_brands.sql (real, active, unique slug),
-- but is stricter: it NEVER updates or deletes an existing row. No product, variant, stock, price, specification or media
-- row is touched, and no other brand is touched.
--
--   * no brand with that name (any letter case) or slug  -> insert it
--   * exactly one, already "ZTE"/"VgoTel", that slug, active, real -> nothing to do (safe to re-run)
--   * anything else (e.g. a "Zte" development or inactive row, or the slug used by another brand)
--                                                         -> stop with brand_guard, change nothing (Owner decision)
-- logo_reference stays null: there is no ZTE / VgoTel logo asset, and the homepage brand strip is not changed.
--
-- NOT APPLIED by this change. Apply only with explicit Owner approval (this project applies migrations via the SQL Editor;
-- do not use `supabase db push` on DEV: see the DEV migration-history drift note in CLAUDE_HANDOFF.md).

begin;

do $$
declare
  v_target record;
  v_row public.brands%rowtype;
  v_count integer;
begin
  for v_target in
    select * from (values ('ZTE', 'zte'), ('VgoTel', 'vgotel')) as t(name, slug)
  loop
    select count(*) into v_count
    from public.brands
    where lower(btrim(name)) = lower(v_target.name) or slug = v_target.slug;

    if v_count = 0 then
      insert into public.brands (name, slug, description, logo_reference, is_active, data_class)
      values (v_target.name, v_target.slug, null, null, true, 'real');
      raise notice 'android_brands: added brand %', v_target.name;
    elsif v_count = 1 then
      select * into v_row
      from public.brands
      where lower(btrim(name)) = lower(v_target.name) or slug = v_target.slug;
      if v_row.name = v_target.name and v_row.slug = v_target.slug and v_row.is_active and v_row.data_class = 'real' then
        raise notice 'android_brands: brand % already present; nothing changed', v_target.name;
      else
        raise exception 'brand_guard: % already exists as "%" (slug %, active %, data_class %); nothing changed - Owner decision needed',
          v_target.name, v_row.name, v_row.slug, v_row.is_active, v_row.data_class;
      end if;
    else
      raise exception 'brand_guard: % matches % existing brands by name or slug; nothing changed - Owner decision needed',
        v_target.name, v_count;
    end if;
  end loop;

  -- Post-check: each brand exists exactly once, exact display name, active and real.
  for v_target in
    select * from (values ('ZTE', 'zte'), ('VgoTel', 'vgotel')) as t(name, slug)
  loop
    select count(*) into v_count
    from public.brands
    where name = v_target.name and slug = v_target.slug and is_active and data_class = 'real';
    if v_count <> 1 then
      raise exception 'brand_guard: post-check failed for % (found %)', v_target.name, v_count;
    end if;
  end loop;
end;
$$;

commit;