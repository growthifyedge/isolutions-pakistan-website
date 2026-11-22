-- Simple Website Editor (PROJECT_HANDOVER.md §4S) — Homepage Banner & Slider module.
-- Only the shared foundation the Banner Manager needs is created here: the versioned content table, the
-- site asset registry, Owner-only RLS, the draft / publish / restore RPCs, one published-only public read
-- and the server-side banner validator. Announcement Bar and section editing are NOT part of this file.
--
-- Safety:
-- * Owner only: every write RPC checks public.is_site_owner() (role 'owner', active). 'admin' and 'staff' cannot
--   read drafts, save, publish or restore. There are no direct INSERT/UPDATE/DELETE grants on either table.
-- * The public read returns published content only, enabled banners only. With nothing published the storefront
--   keeps its built-in 7 banners (the fallback lives in the frontend), so applying this file changes nothing visible.
-- * No product, price, stock, order, checkout or shipping object is touched.
-- * 2026-11-21 (localhost, Owner-approved): scope 'pdp_gallery' = the Global PDP Background setting (solid colour or
--   uploaded desktop/mobile background image behind every product's main gallery image), same draft / publish /
--   restore flow and the same Owner-only rules. Nothing published = the built-in PDP look.

create or replace function public.is_site_owner()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.profiles
    where id = (select auth.uid()) and role = 'owner'::public.app_role and is_active
  );
$$;
revoke all on function public.is_site_owner() from public, anon;
grant execute on function public.is_site_owner() to authenticated;

-- Images uploaded through the Edge Function into the Cloudinary folder <root>/site/<uuid>/.
create table if not exists public.site_assets (
  id uuid primary key default gen_random_uuid(),
  cloudinary_public_id text not null unique
    check (cloudinary_public_id ~ '^[A-Za-z0-9_-]+(/[A-Za-z0-9_-]+)*/site/[0-9a-f-]{36}/[A-Za-z0-9_-]+$'),
  secure_url text not null check (secure_url ~ '^https://res\.cloudinary\.com/[A-Za-z0-9_-]+/image/upload/'),
  width integer not null check (width > 0),
  height integer not null check (height > 0),
  bytes bigint not null check (bytes > 0),
  format text not null check (format in ('jpg', 'jpeg', 'png', 'webp', 'avif')),
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);

-- One draft + one published row per scope; earlier published rows become 'archived' (history for Restore).
create table if not exists public.site_content_versions (
  id uuid primary key default gen_random_uuid(),
  scope text not null check (scope in ('announcement_bar', 'homepage', 'pdp_gallery')),
  status text not null check (status in ('draft', 'published', 'archived')),
  content jsonb not null,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  published_at timestamptz,
  published_by uuid,
  archived_at timestamptz
);
create unique index if not exists site_content_versions_one_draft
  on public.site_content_versions (scope) where status = 'draft';
create unique index if not exists site_content_versions_one_published
  on public.site_content_versions (scope) where status = 'published';

alter table public.site_assets enable row level security;
alter table public.site_content_versions enable row level security;
revoke all on public.site_assets from anon, authenticated;
revoke all on public.site_content_versions from anon, authenticated;
grant select on public.site_assets to authenticated;
grant select on public.site_content_versions to authenticated;
drop policy if exists site_assets_owner_read on public.site_assets;
create policy site_assets_owner_read on public.site_assets for select to authenticated
  using ((select public.is_site_owner()));
drop policy if exists site_content_versions_owner_read on public.site_content_versions;
create policy site_content_versions_owner_read on public.site_content_versions for select to authenticated
  using ((select public.is_site_owner()));

-- Banner image: {"src": "/assets/banners/<file>", "publicId": null} (built-in file) or
-- {"src": <registered secure_url>, "publicId": <registered public id>} (uploaded site asset).
create or replace function public.site_banner_image_errors(p_image jsonb, p_prefix text)
returns text[] language plpgsql stable security definer set search_path = '' as $$
declare v_errors text[] := array[]::text[]; v_src text; v_public_id text;
begin
  if p_image is null or jsonb_typeof(p_image) <> 'object' then return array[p_prefix || 'invalid']; end if;
  if exists (select 1 from jsonb_object_keys(p_image) k where k not in ('src', 'publicId')) then
    v_errors := array_append(v_errors, p_prefix || 'unknown_key');
  end if;
  if jsonb_typeof(p_image -> 'src') is distinct from 'string' then return array_append(v_errors, p_prefix || 'src_required'); end if;
  v_src := p_image ->> 'src';
  if p_image -> 'publicId' is null or jsonb_typeof(p_image -> 'publicId') = 'null' then
    if v_src !~ '^/assets/banners/[a-z0-9-]+\.(webp|png|jpg)$' then
      v_errors := array_append(v_errors, p_prefix || 'src_not_allowed');
    end if;
  elsif jsonb_typeof(p_image -> 'publicId') <> 'string' then
    v_errors := array_append(v_errors, p_prefix || 'public_id_invalid');
  else
    v_public_id := p_image ->> 'publicId';
    if not exists (select 1 from public.site_assets where cloudinary_public_id = v_public_id and secure_url = v_src) then
      v_errors := array_append(v_errors, p_prefix || 'asset_not_registered');
    end if;
  end if;
  return v_errors;
end;
$$;
revoke all on function public.site_banner_image_errors(jsonb, text) from public, anon, authenticated;

-- Global PDP Background ('pdp_gallery'):
--   {"mode": "default" | "color" | "image", "color": "#RRGGBB" | null,
--    "desktop": {"src", "publicId"} | null (landscape), "mobile": {"src", "publicId"} | null (portrait)}
-- Images must be uploaded site assets (no outside URLs). Mirrored by validatePdpGalleryBackground in
-- src/lib/pdpGalleryBackground.ts; this function is the authority.
create or replace function public.validate_pdp_gallery_content(p_content jsonb)
returns text[] language plpgsql stable security definer set search_path = '' as $$
declare v_errors text[] := array[]::text[]; v_mode text; v_side text;
begin
  if p_content is null or jsonb_typeof(p_content) <> 'object' then return array['content_must_be_object']; end if;
  if exists (select 1 from jsonb_object_keys(p_content) k where k not in ('mode', 'color', 'desktop', 'mobile')) then
    v_errors := array_append(v_errors, 'content_unknown_key');
  end if;
  v_mode := case when jsonb_typeof(p_content -> 'mode') = 'string' then p_content ->> 'mode' end;
  if v_mode is null or v_mode not in ('default', 'color', 'image') then return array_append(v_errors, 'mode_invalid'); end if;
  if coalesce(jsonb_typeof(p_content -> 'color'), 'null') <> 'null'
     and (jsonb_typeof(p_content -> 'color') <> 'string' or (p_content ->> 'color') !~ '^#[0-9A-Fa-f]{6}$') then
    v_errors := array_append(v_errors, 'color_invalid');
  end if;
  foreach v_side in array array['desktop', 'mobile'] loop
    if coalesce(jsonb_typeof(p_content -> v_side), 'null') <> 'null' then
      if jsonb_typeof(p_content -> v_side) <> 'object'
         or exists (select 1 from jsonb_object_keys(p_content -> v_side) k where k not in ('src', 'publicId'))
         or jsonb_typeof(p_content -> v_side -> 'src') is distinct from 'string'
         or jsonb_typeof(p_content -> v_side -> 'publicId') is distinct from 'string' then
        v_errors := array_append(v_errors, v_side || '_invalid');
      elsif not exists (select 1 from public.site_assets
                        where cloudinary_public_id = p_content -> v_side ->> 'publicId' and secure_url = p_content -> v_side ->> 'src') then
        v_errors := array_append(v_errors, v_side || '_asset_not_registered');
      end if;
    end if;
  end loop;
  if v_mode = 'color' and coalesce(jsonb_typeof(p_content -> 'color'), 'null') = 'null' then
    v_errors := array_append(v_errors, 'color_required');
  end if;
  if v_mode = 'image' and coalesce(jsonb_typeof(p_content -> 'desktop'), 'null') = 'null' then
    v_errors := array_append(v_errors, 'desktop_image_required');
  end if;
  return v_errors;
end;
$$;
revoke all on function public.validate_pdp_gallery_content(jsonb) from public, anon, authenticated;

-- Server-side content validation. Mirrored (for instant feedback only) by validateHomepageBanners in
-- src/lib/homepageBanners.ts; this function is the authority.
create or replace function public.validate_site_content(p_scope text, p_content jsonb)
returns text[] language plpgsql stable security definer set search_path = '' as $$
declare
  v_errors text[] := array[]::text[];
  v_banners jsonb; v_banner jsonb; v_index bigint; v_prefix text; v_text text;
  v_ids text[] := array[]::text[]; v_enabled integer := 0;
begin
  if p_scope = 'pdp_gallery' then return public.validate_pdp_gallery_content(p_content); end if;
  if p_scope is distinct from 'homepage' then return array['scope_not_supported']; end if;
  if p_content is null or jsonb_typeof(p_content) <> 'object' then return array['content_must_be_object']; end if;
  if exists (select 1 from jsonb_object_keys(p_content) k where k <> 'banners') then
    v_errors := array_append(v_errors, 'content_unknown_key');
  end if;
  v_banners := p_content -> 'banners';
  if v_banners is null or jsonb_typeof(v_banners) <> 'array' then return array_append(v_errors, 'banners_must_be_array'); end if;
  if jsonb_array_length(v_banners) < 1 then return array_append(v_errors, 'banners_required'); end if;
  if jsonb_array_length(v_banners) > 12 then return array_append(v_errors, 'banners_too_many'); end if;

  for v_banner, v_index in select value, ordinality from jsonb_array_elements(v_banners) with ordinality loop
    v_prefix := 'banner_' || v_index || '_';
    if jsonb_typeof(v_banner) <> 'object' then v_errors := array_append(v_errors, v_prefix || 'invalid'); continue; end if;
    if exists (select 1 from jsonb_object_keys(v_banner) k
               where k not in ('id', 'enabled', 'alt', 'heading', 'buttonText', 'link', 'desktop', 'mobile')) then
      v_errors := array_append(v_errors, v_prefix || 'unknown_key');
    end if;

    v_text := case when jsonb_typeof(v_banner -> 'id') = 'string' then v_banner ->> 'id' end;
    if v_text is null or v_text !~ '^[A-Za-z0-9_-]{1,64}$' then v_errors := array_append(v_errors, v_prefix || 'id_invalid');
    elsif v_text = any(v_ids) then v_errors := array_append(v_errors, v_prefix || 'id_duplicate');
    else v_ids := array_append(v_ids, v_text); end if;

    if jsonb_typeof(v_banner -> 'enabled') is distinct from 'boolean' then
      v_errors := array_append(v_errors, v_prefix || 'enabled_invalid');
    elsif (v_banner ->> 'enabled')::boolean then v_enabled := v_enabled + 1; end if;

    v_text := case when jsonb_typeof(v_banner -> 'alt') = 'string' then btrim(v_banner ->> 'alt') end;
    if v_text is null or length(v_text) < 1 or length(v_text) > 120 then v_errors := array_append(v_errors, v_prefix || 'alt_invalid'); end if;

    if coalesce(jsonb_typeof(v_banner -> 'heading'), 'null') <> 'null' then
      v_text := case when jsonb_typeof(v_banner -> 'heading') = 'string' then btrim(v_banner ->> 'heading') end;
      if v_text is null or length(v_text) < 1 or length(v_text) > 80 then v_errors := array_append(v_errors, v_prefix || 'heading_invalid'); end if;
    end if;
    if coalesce(jsonb_typeof(v_banner -> 'buttonText'), 'null') <> 'null' then
      v_text := case when jsonb_typeof(v_banner -> 'buttonText') = 'string' then btrim(v_banner ->> 'buttonText') end;
      if v_text is null or length(v_text) < 1 or length(v_text) > 30 then v_errors := array_append(v_errors, v_prefix || 'button_text_invalid'); end if;
      if coalesce(jsonb_typeof(v_banner -> 'link'), 'null') = 'null' then v_errors := array_append(v_errors, v_prefix || 'button_requires_link'); end if;
    end if;
    if coalesce(jsonb_typeof(v_banner -> 'link'), 'null') <> 'null' then
      v_text := case when jsonb_typeof(v_banner -> 'link') = 'string' then v_banner ->> 'link' end;
      -- Internal site paths only: starts with one "/", no scheme, host, backslash or whitespace.
      if v_text is null or length(v_text) > 200 or v_text !~ '^/([A-Za-z0-9._~%?=&#+-][A-Za-z0-9/._~%?=&#+-]*)?$' then
        v_errors := array_append(v_errors, v_prefix || 'link_invalid');
      end if;
    end if;

    v_errors := v_errors || public.site_banner_image_errors(v_banner -> 'desktop', v_prefix || 'desktop_');
    if coalesce(jsonb_typeof(v_banner -> 'mobile'), 'null') <> 'null' then
      v_errors := v_errors || public.site_banner_image_errors(v_banner -> 'mobile', v_prefix || 'mobile_');
    end if;
  end loop;
  if v_enabled < 1 then v_errors := array_append(v_errors, 'enabled_banner_required'); end if;
  return v_errors;
end;
$$;
revoke all on function public.validate_site_content(text, jsonb) from public, anon, authenticated;

create or replace function public.require_site_owner()
returns void language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_site_owner() then raise exception 'owner_required' using errcode = '42501'; end if;
end;
$$;
revoke all on function public.require_site_owner() from public, anon, authenticated;

-- Registers an image the Owner just uploaded through the signed Edge Function upload.
create or replace function public.register_site_asset(
  p_public_id text, p_secure_url text, p_width integer, p_height integer, p_bytes bigint, p_format text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_row public.site_assets%rowtype;
begin
  perform public.require_site_owner();
  insert into public.site_assets (cloudinary_public_id, secure_url, width, height, bytes, format)
  values (p_public_id, p_secure_url, p_width, p_height, p_bytes, lower(p_format))
  on conflict (cloudinary_public_id) do update set secure_url = excluded.secure_url
  returning * into v_row;
  return jsonb_build_object('id', v_row.id, 'publicId', v_row.cloudinary_public_id, 'src', v_row.secure_url,
    'width', v_row.width, 'height', v_row.height);
end;
$$;
revoke all on function public.register_site_asset(text, text, integer, integer, bigint, text) from public, anon;
grant execute on function public.register_site_asset(text, text, integer, integer, bigint, text) to authenticated;

create or replace function public.get_site_content_admin(p_scope text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform public.require_site_owner();
  return jsonb_build_object(
    'draft', (select jsonb_build_object('id', id, 'content', content, 'updatedAt', updated_at)
              from public.site_content_versions where scope = p_scope and status = 'draft'),
    'published', (select jsonb_build_object('id', id, 'content', content, 'publishedAt', published_at)
                  from public.site_content_versions where scope = p_scope and status = 'published'),
    'history', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'status', status, 'publishedAt', published_at,
                                  'archivedAt', archived_at, 'bannerCount', jsonb_array_length(coalesce(content -> 'banners', '[]'::jsonb)))
                                order by published_at desc)
                         from (select * from public.site_content_versions
                               where scope = p_scope and status in ('published', 'archived')
                               order by published_at desc limit 20) recent), '[]'::jsonb));
end;
$$;
revoke all on function public.get_site_content_admin(text) from public, anon;
grant execute on function public.get_site_content_admin(text) to authenticated;

create or replace function public.save_site_content_draft(p_scope text, p_content jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_errors text[]; v_id uuid; v_updated timestamptz;
begin
  perform public.require_site_owner();
  v_errors := public.validate_site_content(p_scope, p_content);
  if cardinality(v_errors) > 0 then
    raise exception 'invalid_site_content: %', array_to_string(v_errors, ',') using errcode = '22023';
  end if;
  update public.site_content_versions set content = p_content, updated_at = now()
  where scope = p_scope and status = 'draft' returning id, updated_at into v_id, v_updated;
  if v_id is null then
    insert into public.site_content_versions (scope, status, content) values (p_scope, 'draft', p_content)
    returning id, updated_at into v_id, v_updated;
  end if;
  return jsonb_build_object('id', v_id, 'updatedAt', v_updated);
end;
$$;
revoke all on function public.save_site_content_draft(text, jsonb) from public, anon;
grant execute on function public.save_site_content_draft(text, jsonb) to authenticated;

-- Publishes the saved draft: the current published version becomes history, the draft becomes published.
create or replace function public.publish_site_content(p_scope text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_draft public.site_content_versions%rowtype; v_errors text[];
begin
  perform public.require_site_owner();
  perform pg_advisory_xact_lock(hashtext('site_content_versions:' || coalesce(p_scope, '')));
  select * into v_draft from public.site_content_versions where scope = p_scope and status = 'draft' for update;
  if not found then raise exception 'draft_not_found' using errcode = 'P0002'; end if;
  v_errors := public.validate_site_content(p_scope, v_draft.content);
  if cardinality(v_errors) > 0 then
    raise exception 'invalid_site_content: %', array_to_string(v_errors, ',') using errcode = '22023';
  end if;
  update public.site_content_versions set status = 'archived', archived_at = now()
  where scope = p_scope and status = 'published';
  update public.site_content_versions
  set status = 'published', published_at = now(), published_by = auth.uid(), updated_at = now()
  where id = v_draft.id;
  return jsonb_build_object('id', v_draft.id, 'publishedAt', now());
end;
$$;
revoke all on function public.publish_site_content(text) from public, anon;
grant execute on function public.publish_site_content(text) to authenticated;

-- Restore: copies a published or archived version into the draft. Nothing goes live until the Owner publishes.
create or replace function public.restore_site_content_version(p_scope text, p_version_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_content jsonb;
begin
  perform public.require_site_owner();
  select content into v_content from public.site_content_versions
  where id = p_version_id and scope = p_scope and status in ('published', 'archived');
  if not found then raise exception 'version_not_found' using errcode = 'P0002'; end if;
  return public.save_site_content_draft(p_scope, v_content);
end;
$$;
revoke all on function public.restore_site_content_version(text, uuid) from public, anon;
grant execute on function public.restore_site_content_version(text, uuid) to authenticated;

-- The only public read: published content, enabled banners only. NULL when nothing is published
-- (the storefront then shows its built-in banners / built-in PDP look).
create or replace function public.get_published_site_content(p_scope text)
returns jsonb language sql stable security definer set search_path = '' as $$
  select case when p_scope = 'homepage' then
    jsonb_build_object('banners', coalesce((
      select jsonb_agg(banner order by ordinality)
      from jsonb_array_elements(v.content -> 'banners') with ordinality as b(banner, ordinality)
      where (banner ->> 'enabled')::boolean), '[]'::jsonb))
  when p_scope = 'pdp_gallery' then
    jsonb_build_object('mode', v.content -> 'mode', 'color', v.content -> 'color',
      'desktop', v.content -> 'desktop', 'mobile', v.content -> 'mobile')
  end
  from public.site_content_versions v
  where v.scope = p_scope and v.status = 'published';
$$;
revoke all on function public.get_published_site_content(text) from public;
grant execute on function public.get_published_site_content(text) to anon, authenticated;
