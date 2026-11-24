-- Promotional Popup (Admin Studio → Marketing → Promotional Popup), localhost implementation 2026-11-23.
-- PREPARED ONLY — not applied to DEV or PROD. Applying it needs separate Owner approval (DEV first, then PROD).
--
-- Reuses the Website Editor foundation of 202611200001 (site_content_versions, site_assets, Owner-only
-- save / publish / restore RPCs, the published-only public read). This file only:
--   1. allows the new scope 'promo_popup' in site_content_versions,
--   2. adds its server-side validator,
--   3. teaches validate_site_content and get_published_site_content about the new scope,
--   4. adds promo_popup_installed(), a read-only probe the Admin uses to know saving is available.
-- The 'homepage' and 'pdp_gallery' branches below are copied unchanged from 202611200001.
--
-- Content ('promo_popup'):
--   {"enabled": true | false,
--    "image": {"src": <registered site asset secure_url>, "publicId": <registered public id>} | null,
--    "link": "/internal/path" | null}
-- Enabled requires an image and a link. The public read returns the popup only when it is enabled (and complete);
-- otherwise NULL, so the storefront shows nothing. Nothing published (the state right after applying this file)
-- = NULL = no popup: applying it changes nothing visible.
--
-- Safety: Owner only (unchanged RPC checks); no direct table grants; no product, price, stock, order, checkout,
-- shipping or homepage banner object is touched.

alter table public.site_content_versions drop constraint if exists site_content_versions_scope_check;
alter table public.site_content_versions add constraint site_content_versions_scope_check
  check (scope in ('announcement_bar', 'homepage', 'pdp_gallery', 'promo_popup'));

-- Mirrored by validatePromoPopup in src/lib/promoPopup.ts (instant feedback only); this function is the authority.
create or replace function public.validate_promo_popup_content(p_content jsonb)
returns text[] language plpgsql stable security definer set search_path = '' as $$
declare v_errors text[] := array[]::text[]; v_link text; v_has_image boolean := false; v_has_link boolean := false;
begin
  if p_content is null or jsonb_typeof(p_content) <> 'object' then return array['content_must_be_object']; end if;
  if exists (select 1 from jsonb_object_keys(p_content) k where k not in ('enabled', 'image', 'link')) then
    v_errors := array_append(v_errors, 'content_unknown_key');
  end if;
  if jsonb_typeof(p_content -> 'enabled') is distinct from 'boolean' then
    v_errors := array_append(v_errors, 'enabled_invalid');
  end if;

  if coalesce(jsonb_typeof(p_content -> 'image'), 'null') <> 'null' then
    if jsonb_typeof(p_content -> 'image') <> 'object'
       or exists (select 1 from jsonb_object_keys(p_content -> 'image') k where k not in ('src', 'publicId'))
       or jsonb_typeof(p_content -> 'image' -> 'src') is distinct from 'string'
       or jsonb_typeof(p_content -> 'image' -> 'publicId') is distinct from 'string' then
      v_errors := array_append(v_errors, 'image_invalid');
    elsif not exists (select 1 from public.site_assets
                      where cloudinary_public_id = p_content -> 'image' ->> 'publicId'
                        and secure_url = p_content -> 'image' ->> 'src'
                        and format in ('jpg', 'jpeg', 'png', 'webp')) then
      v_errors := array_append(v_errors, 'image_asset_not_registered');
    else
      v_has_image := true;
    end if;
  end if;

  if coalesce(jsonb_typeof(p_content -> 'link'), 'null') <> 'null' then
    v_link := case when jsonb_typeof(p_content -> 'link') = 'string' then p_content ->> 'link' end;
    -- Internal site paths only (same rule as the homepage banner link): one leading "/", no scheme, host, "//",
    -- backslash or whitespace.
    if v_link is null or length(v_link) > 200 or v_link !~ '^/([A-Za-z0-9._~%?=&#+-][A-Za-z0-9/._~%?=&#+-]*)?$' then
      v_errors := array_append(v_errors, 'link_invalid');
    else
      v_has_link := true;
    end if;
  end if;

  if jsonb_typeof(p_content -> 'enabled') = 'boolean' and (p_content ->> 'enabled')::boolean then
    if not v_has_image and coalesce(jsonb_typeof(p_content -> 'image'), 'null') = 'null' then
      v_errors := array_append(v_errors, 'image_required');
    end if;
    if not v_has_link and coalesce(jsonb_typeof(p_content -> 'link'), 'null') = 'null' then
      v_errors := array_append(v_errors, 'link_required');
    end if;
  end if;
  return v_errors;
end;
$$;
revoke all on function public.validate_promo_popup_content(jsonb) from public, anon, authenticated;

-- Installation probe for the Admin (the shared get_site_content_admin answers for any scope, so it cannot tell).
-- Returns only whether the caller is the Owner; reveals nothing else.
create or replace function public.promo_popup_installed()
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('installed', true, 'owner', public.is_site_owner());
$$;
revoke all on function public.promo_popup_installed() from public, anon;
grant execute on function public.promo_popup_installed() to authenticated;

-- Same function as 202611200001 plus the 'promo_popup' branch (first line of the body).
create or replace function public.validate_site_content(p_scope text, p_content jsonb)
returns text[] language plpgsql stable security definer set search_path = '' as $$
declare
  v_errors text[] := array[]::text[];
  v_banners jsonb; v_banner jsonb; v_index bigint; v_prefix text; v_text text;
  v_ids text[] := array[]::text[]; v_enabled integer := 0;
begin
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

-- Same function as 202611200001 plus the 'promo_popup' branch: only an enabled, complete popup is public.
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
