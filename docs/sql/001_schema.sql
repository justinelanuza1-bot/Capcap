-- LostFinder / Capcap — Phase 0 Schema
-- Run in Supabase SQL Editor

-- Profiles (extends auth.users)
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text unique not null,
  email text unique not null,
  name text not null,
  id_number text unique,
  contact_number text default '',
  role_label text default 'Student',
  role text not null default 'user' check (role in ('user', 'admin')),
  points integer not null default 0,
  created_at timestamptz not null default now()
);

-- Reports
create table if not exists public.reports (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles(id) on delete cascade,
  user_name text not null,
  type text not null check (type in ('lost', 'found')),
  category text not null default 'Other',
  item_name text not null,
  location text not null,
  date_reported date,
  description text not null,
  image_url text default '',
  verify_hashes jsonb,
  contact_number text default '',
  status text not null default 'pending' check (status in ('pending', 'resolved')),
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);

create index if not exists reports_type_status_idx on public.reports (type, status);
create index if not exists reports_user_id_idx on public.reports (user_id);
create index if not exists reports_created_at_idx on public.reports (created_at desc);

-- Claims
create table if not exists public.claims (
  id bigint generated always as identity primary key,
  report_id bigint not null references public.reports(id) on delete cascade,
  item_name text not null,
  finder_id uuid not null references public.profiles(id),
  claimant_id uuid not null references public.profiles(id),
  claimant_name text not null,
  answer_hashes jsonb not null,
  exact_match boolean not null default false,
  vague boolean not null default false,
  status text not null default 'pending-review'
    check (status in ('auto-approved', 'pending-review', 'approved', 'denied')),
  retrieval_code text,
  expires_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists claims_report_id_idx on public.claims (report_id);
create index if not exists claims_status_idx on public.claims (status);

-- Messages
create table if not exists public.messages (
  id bigint generated always as identity primary key,
  report_id bigint not null references public.reports(id) on delete cascade,
  sender_id uuid not null references public.profiles(id),
  sender_name text not null,
  receiver_id uuid not null references public.profiles(id),
  message text not null,
  is_read boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists messages_report_participants_idx
  on public.messages (report_id, sender_id, receiver_id);
create index if not exists messages_created_at_idx on public.messages (created_at desc);

-- Auto-create profile on signup
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, username, email, name, id_number, contact_number, role_label)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'username', split_part(new.email, '@', 1)),
    new.email,
    coalesce(new.raw_user_meta_data->>'name', ''),
    new.raw_user_meta_data->>'id_number',
    coalesce(new.raw_user_meta_data->>'contact_number', ''),
    coalesce(new.raw_user_meta_data->>'role_label', 'Student')
  );
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Admin check helper
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'admin'
  );
$$;

-- Weekly report limit (3 per 7 days)
create or replace function public.check_weekly_report_limit()
returns trigger
language plpgsql
as $$
declare
  report_count integer;
begin
  select count(*) into report_count
  from public.reports
  where user_id = new.user_id
    and created_at >= now() - interval '7 days';

  if report_count >= 3 then
    raise exception 'Weekly report limit reached (3 per week)';
  end if;
  return new;
end;
$$;

drop trigger if exists enforce_weekly_report_limit on public.reports;
create trigger enforce_weekly_report_limit
  before insert on public.reports
  for each row execute function public.check_weekly_report_limit();
