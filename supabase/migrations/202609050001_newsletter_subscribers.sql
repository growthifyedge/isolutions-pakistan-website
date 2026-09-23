create table public.newsletter_subscribers (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  status text not null default 'subscribed'
    constraint newsletter_subscribers_status_check
    check (status in ('subscribed', 'unsubscribed')),
  source text not null default 'about_page',
  subscribed_at timestamptz not null default now(),
  unsubscribed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint newsletter_subscribers_email_normalized_check
    check (email = lower(btrim(email))),
  constraint newsletter_subscribers_email_length_check
    check (char_length(email) between 3 and 320),
  constraint newsletter_subscribers_source_length_check
    check (char_length(source) between 1 and 64)
);

create unique index newsletter_subscribers_email_lower_unique
  on public.newsletter_subscribers (lower(email));

create trigger newsletter_subscribers_set_updated_at
before update on public.newsletter_subscribers
for each row execute function public.set_updated_at();

alter table public.newsletter_subscribers enable row level security;

revoke all on table public.newsletter_subscribers from public, anon, authenticated;

create or replace function public.subscribe_newsletter(
  p_email text,
  p_source text default 'about_page'
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  normalized_email text := lower(btrim(coalesce(p_email, '')));
  normalized_source text := left(coalesce(nullif(btrim(p_source), ''), 'about_page'), 64);
begin
  if char_length(normalized_email) > 320
    or normalized_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
  then
    raise exception using
      errcode = '22023',
      message = 'invalid_email';
  end if;

  insert into public.newsletter_subscribers (email, status, source)
  values (normalized_email, 'subscribed', normalized_source)
  on conflict ((lower(email))) do nothing;

  if found then
    return 'subscribed';
  end if;

  update public.newsletter_subscribers
  set status = 'subscribed',
      source = normalized_source,
      subscribed_at = now(),
      unsubscribed_at = null
  where lower(email) = normalized_email
    and status = 'unsubscribed';

  if found then
    return 'subscribed';
  end if;

  return 'already_subscribed';
end;
$$;

revoke all on function public.subscribe_newsletter(text, text) from public;
grant execute on function public.subscribe_newsletter(text, text) to anon, authenticated;
