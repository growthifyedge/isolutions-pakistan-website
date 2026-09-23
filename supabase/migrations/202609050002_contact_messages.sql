create table public.contact_messages (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  email text not null,
  phone text,
  message text not null,
  status text not null default 'new',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint contact_messages_name_length_check check (char_length(name) between 1 and 120),
  constraint contact_messages_email_length_check check (char_length(email) between 3 and 320),
  constraint contact_messages_phone_length_check check (phone is null or char_length(phone) between 3 and 40),
  constraint contact_messages_message_length_check check (char_length(message) between 1 and 5000),
  constraint contact_messages_status_check check (status in ('new', 'in_progress', 'resolved')),
  constraint contact_messages_email_normalized_check check (email = lower(btrim(email)))
);

create trigger contact_messages_set_updated_at
before update on public.contact_messages
for each row execute function public.set_updated_at();

alter table public.contact_messages enable row level security;

revoke all on table public.contact_messages from public, anon, authenticated;

create or replace function public.submit_contact_message(
  p_name text,
  p_email text,
  p_phone text,
  p_message text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  normalized_name text := btrim(coalesce(p_name, ''));
  normalized_email text := lower(btrim(coalesce(p_email, '')));
  normalized_phone text := nullif(btrim(coalesce(p_phone, '')), '');
  normalized_message text := btrim(coalesce(p_message, ''));
begin
  if char_length(normalized_name) not between 1 and 120 then
    raise exception using errcode = '22023', message = 'invalid_name';
  end if;

  if char_length(normalized_email) > 320
    or normalized_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
  then
    raise exception using errcode = '22023', message = 'invalid_email';
  end if;

  if normalized_phone is not null and char_length(normalized_phone) not between 3 and 40 then
    raise exception using errcode = '22023', message = 'invalid_phone';
  end if;

  if char_length(normalized_message) not between 1 and 5000 then
    raise exception using errcode = '22023', message = 'invalid_message';
  end if;

  insert into public.contact_messages (name, email, phone, message)
  values (normalized_name, normalized_email, normalized_phone, normalized_message);

  return true;
end;
$$;

revoke all on function public.submit_contact_message(text, text, text, text) from public;
grant execute on function public.submit_contact_message(text, text, text, text) to anon, authenticated;
