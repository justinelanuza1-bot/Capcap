-- Fix: "Cannot coerce the result to a single JSON object" on login
-- Cause: auth.users exists but public.profiles row is missing
-- Run in Supabase SQL Editor

-- 1. Backfill profiles for any auth users missing one
insert into public.profiles (id, username, email, name, id_number, contact_number, role_label, role)
select
  u.id,
  coalesce(
    nullif(trim(u.raw_user_meta_data->>'username'), ''),
    split_part(u.email, '@', 1)
  ) || case
    when exists (
      select 1 from public.profiles p2
      where p2.username = coalesce(nullif(trim(u.raw_user_meta_data->>'username'), ''), split_part(u.email, '@', 1))
    ) then '_' || left(u.id::text, 8)
    else ''
  end,
  u.email,
  coalesce(nullif(trim(u.raw_user_meta_data->>'name'), ''), split_part(u.email, '@', 1)),
  nullif(trim(u.raw_user_meta_data->>'id_number'), ''),
  coalesce(u.raw_user_meta_data->>'contact_number', ''),
  coalesce(u.raw_user_meta_data->>'role_label', 'Student'),
  'user'
from auth.users u
left join public.profiles p on p.id = u.id
where p.id is null
on conflict (id) do nothing;

-- 2. Auto-create profile on login if still missing
create or replace function public.ensure_user_profile()
returns public.profiles
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user auth.users%rowtype;
  v_profile public.profiles%rowtype;
  v_username text;
  v_suffix text := '';
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  select * into v_profile from public.profiles where id = auth.uid();
  if found then
    return v_profile;
  end if;

  select * into v_user from auth.users where id = auth.uid();
  if not found then
    raise exception 'Auth user not found';
  end if;

  v_username := coalesce(
    nullif(trim(v_user.raw_user_meta_data->>'username'), ''),
    split_part(v_user.email, '@', 1)
  );

  while exists (select 1 from public.profiles where username = v_username || v_suffix) loop
    v_suffix := '_' || left(gen_random_uuid()::text, 6);
  end loop;

  insert into public.profiles (id, username, email, name, id_number, contact_number, role_label, role)
  values (
    v_user.id,
    v_username || v_suffix,
    v_user.email,
    coalesce(nullif(trim(v_user.raw_user_meta_data->>'name'), ''), split_part(v_user.email, '@', 1)),
    nullif(trim(v_user.raw_user_meta_data->>'id_number'), ''),
    coalesce(v_user.raw_user_meta_data->>'contact_number', ''),
    coalesce(v_user.raw_user_meta_data->>'role_label', 'Student'),
    'user'
  )
  returning * into v_profile;

  return v_profile;
end;
$$;

grant execute on function public.ensure_user_profile() to authenticated;

-- 3. Harden signup trigger (avoid silent profile failures)
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  v_username text;
  v_suffix text := '';
begin
  v_username := coalesce(
    nullif(trim(new.raw_user_meta_data->>'username'), ''),
    split_part(new.email, '@', 1)
  );

  while exists (select 1 from public.profiles where username = v_username || v_suffix) loop
    v_suffix := '_' || left(gen_random_uuid()::text, 6);
  end loop;

  insert into public.profiles (id, username, email, name, id_number, contact_number, role_label)
  values (
    new.id,
    v_username || v_suffix,
    new.email,
    coalesce(nullif(trim(new.raw_user_meta_data->>'name'), ''), split_part(new.email, '@', 1)),
    nullif(trim(new.raw_user_meta_data->>'id_number'), ''),
    coalesce(new.raw_user_meta_data->>'contact_number', ''),
    coalesce(new.raw_user_meta_data->>'role_label', 'Student')
  );

  return new;
end;
$$;
