-- Auth helpers for pre-login flows (username lookup, duplicate check)
-- Run in Supabase SQL Editor

create or replace function public.get_login_email(p_username text)
returns text
language sql
security definer
set search_path = public
as $$
  select email
  from public.profiles
  where lower(username) = lower(trim(p_username))
  limit 1;
$$;

create or replace function public.check_profile_available(
  p_username text,
  p_email text,
  p_id_number text
)
returns boolean
language sql
security definer
set search_path = public
as $$
  select not exists (
    select 1
    from public.profiles
    where lower(username) = lower(trim(p_username))
       or lower(email) = lower(trim(p_email))
       or id_number = trim(p_id_number)
  );
$$;

grant execute on function public.get_login_email(text) to anon, authenticated;
grant execute on function public.check_profile_available(text, text, text) to anon, authenticated;
