-- Bundle Offers Editor (Admin Studio -> Homepage -> Bundle Offers), localhost implementation 2026-11-25.
-- PREPARED ONLY — not applied to DEV or PROD. Applying it needs separate Owner approval (DEV first, then PROD).
--
-- Reuses the Website Editor foundation of 202611200001 (site_content_versions, site_assets, Owner-only
-- save / publish / restore RPCs, published-only public read) exactly like 202611230001 (promo_popup). This file only:
--   1. allows the new scope 'bundle_offers' in site_content_versions,
--   2. adds its server-side validator,
--   3. teaches validate_site_content and get_published_site_content about the new scope (every existing branch —
--      'homepage', 'pdp_gallery', 'promo_popup' — is copied unchanged from 202611230001),
--   4. adds bundle_offers_installed(), a read-only probe the Admin uses to know saving is available.
--
-- Content ('bundle_offers'):
--   {"tiles": [ {"image": {"src": <registered site asset secure_url>, "publicId": <registered id>} | null,
--                "link": "/internal/path"} x exactly 4 ],
--    "promo": {"image": {...} | null, "link": "/internal/path" | null}}
-- image null = keep the built-in image for that slot. Nothing published (the state right after applying this file)
-- = NULL = the storefront keeps today's four tiles, links and promotional banner: applying it changes nothing visible.
--
-- Safety: Owner only (unchanged RPC checks); no direct table grants; no product, bundle, price, stock, order,
-- checkout, shipping, homepage banner or popup object is touched.

begin;

alter table public.site_content_versions drop constraint if exists site_content_versions_scope_check;
alter table public.site_content_versions add constraint site_content_versions_scope_check
  check (scope in ('announcement_bar', 'homepage', 'pdp_gallery', 'promo_popup', 'bundle_offers'));

-- One optional image: NULL = built-in; otherwise an uploaded, registered site asset (no outside URLs).
create or replace function public.bundle_offer_image_errors(p_image jsonb, p_prefix text)
returns text[] language plpgsql stable security definer set search_path = '' as $$
begin
  if coalesce(jsonb_typeof(p_image), 'null') = 'null' then return array[]::text[]; end if;
  if jsonb_typeof(p_image) <> 'object'
     or exists (select 1 from jsonb_object_keys(p_image) k where k not in ('src', 'publicId'))
     or jsonb_typeof(p_image -> 'src') is distinct from 'string'
     or jsonb_typeof(p_image -> 'publicId') is distinct from 'string' then
    return array[p_prefix || 'image_invalid'];
  end if;
  if not exists (select 1 from public.site_assets
                 where cloudinary_public_id = p_image ->> 'publicId'
                   and secure_url = p_image ->> 'src'
                   and format in ('jpg', 'jpeg', 'png', 'webp', 'avif')) then
    return array[p_prefix || 'image_asset_not_registered'];
  end if;
  return array[]::text[];
end;
$$;
revoke all on function public.bundle_offer_image_errors(jsonb, text) from public, anon, authenticated;

-- Internal site paths only (same rule as the homepage banner and popup links).
create or replace function public.bundle_offer_link_ok(p_link jsonb)
returns boolean language sql immutable set search_path = '' as $$
  select coalesce(jsonb_typeof(p_link) = 'string' and length(p_link #>> '{}') <= 200
    and (p_link #>> '{}') ~ '^/([A-Za-z0-9._~%?=&#+-][A-Za-z0-9/._~%?=&#+-]*)?$', false);
$$;
revoke all on function public.bundle_offer_link_ok(jsonb) from public, anon, authenticated;

-- Mirrored by validateBundleOffers in src/lib/bundleOffers.ts (instant feedback only); this function is the authority.
create or replace function public.validate_bundle_offers_content(p_content jsonb)
returns text[] language plpgsql stable security definer set search_path = '' as $$
declare v_errors text[] := array[]::text[]; v_tile jsonb; v_index bigint; v_prefix text;
begin
  if p_content is null or jsonb_typeof(p_content) <> 'object' then return array['content_must_be_object']; end if;
  if exists (select 1 from jsonb_object_keys(p_content) k where k not in ('tiles', 'promo')) then
    v_errors := array_append(v_errors, 'content_unknown_key');
  end if;

  if jsonb_typeof(p_content -> 'tiles') is distinct from 'array' or jsonb_array_length(p_content -> 'tiles') <> 4 then
    v_errors := array_append(v_errors, 'tiles_must_be_four');
  else
    for v_tile, v_index in select value, ordinality from jsonb_array_elements(p_content -> 'tiles') with ordinality loop
      v_prefix := 'tile_' || v_index || '_';
      if jsonb_typeof(v_tile) <> 'object' then v_errors := array_append(v_errors, v_prefix || 'invalid'); continue; end if;
      if exists (select 1 from jsonb_object_keys(v_tile) k where k not in ('image', 'link')) then
        v_errors := array_append(v_errors, v_prefix || 'unknown_key');
      end if;
      v_errors := v_errors || public.bundle_offer_image_errors(v_tile -> 'image', v_prefix);
      if not public.bundle_offer_link_ok(v_tile -> 'link') then
        v_errors := array_append(v_errors, v_prefix || 'link_invalid');
      end if;
    end loop;
  end if;

  if jsonb_typeof(p_content -> 'promo') is distinct from 'object' then
    v_errors := array_append(v_errors, 'promo_invalid');
  else
    if exists (select 1 from jsonb_object_keys(p_content -> 'promo') k where k not in ('image', 'link')) then
      v_errors := array_append(v_errors, 'promo_unknown_key');
    end if;
    v_errors := v_errors || public.bundle_offer_image_errors(p_content -> 'promo' -> 'image', 'promo_');
    if coalesce(jsonb_typeof(p_content -> 'promo' -> 'link'), 'null') <> 'null'
       and not public.bundle_offer_link_ok(p_content -> 'promo' -> 'link') then
      v_errors := array_append(v_errors, 'promo_link_invalid');
    end if;
  end if;
  return v_errors;
end;
$$;
revoke all on function public.validate_bundle_offers_content(jsonb) from public, anon, authenticated;

-- Installation probe for the Admin (the shared get_site_content_admin answers for any scope, so it cannot tell).
-- Returns only whether the caller is the Owner; reveals nothing else.
create or replace function public.bundle_offers_installed()
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('installed', true, 'owner', public.is_site_owner());
$$;
revoke all on function public.bundle_offers_installed() from public, anon;
grant execute on function public.bundle_offers_installed() to authenticated;

-- Same function as 202611230001 plus the 'bundle_offers' branch (first line of the body).
create or replace function public.validate_site_content(p_scope text, p_content jsonb)
returns text[] language plpgsql stable security definer set search_path = '' as $$
declare
  v_errors text[] := array[]::text[];
  v_banners jsonb; v_banner jsonb; v_index bigint; v_prefix text; v_text text;
  v_ids text[] := array[]::text[]; v_enabled integer := 0;
begin
  if p_scope = 'bundle_offers' then return public.validate_bundle_offers_content(p_content); end if;
  if p_scope = 'promo_popup' then return public.validate_promo_popup_content(p_content); end if;
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

-- Same function as 202611230001 plus the 'bundle_offers' branch (tiles + promo, as validated on save).
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
  when p_scope = 'bundle_offers' then
    jsonb_build_object('tiles', v.content -> 'tiles', 'promo', v.content -> 'promo')
  when p_scope = 'promo_popup' then
    case when jsonb_typeof(v.content -> 'enabled') = 'boolean' and (v.content ->> 'enabled')::boolean
              and jsonb_typeof(v.content -> 'image') = 'object' and jsonb_typeof(v.content -> 'link') = 'string' then
      jsonb_build_object('enabled', true, 'image', v.content -> 'image', 'link', v.content -> 'link')
    end
  end
  from public.site_content_versions v
  where v.scope = p_scope and v.status = 'published';
$$;
revoke all on function public.get_published_site_content(text) from public;
grant execute on function public.get_published_site_content(text) to anon, authenticated;

commit;
