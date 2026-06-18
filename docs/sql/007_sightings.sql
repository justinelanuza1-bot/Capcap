-- Sightings / tips from other users about lost items
-- Run in Supabase SQL Editor

create table if not exists public.sightings (
  id bigint generated always as identity primary key,
  report_id bigint not null references public.reports(id) on delete cascade,
  reporter_id uuid not null references public.profiles(id) on delete cascade,
  reporter_name text not null,
  description text not null,
  location_seen text default '',
  image_url text default '',
  match_score integer not null default 0 check (match_score >= 0 and match_score <= 100),
  match_label text not null default 'low' check (match_label in ('high', 'possible', 'low')),
  status text not null default 'pending' check (status in ('pending', 'helpful', 'recovered', 'dismissed')),
  verified_at timestamptz,
  verified_by uuid references public.profiles(id),
  points_awarded integer not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists sightings_report_id_idx on public.sightings (report_id);
create index if not exists sightings_reporter_id_idx on public.sightings (reporter_id);
create index if not exists sightings_created_at_idx on public.sightings (created_at desc);

alter table public.sightings enable row level security;

-- Reporter, report owner, and admin can view
create policy "sightings_select_related"
  on public.sightings for select to authenticated
  using (
    auth.uid() = reporter_id
    or exists (
      select 1 from public.reports r
      where r.id = report_id and r.user_id = auth.uid()
    )
    or public.is_admin()
  );

-- Any authenticated user can submit (not on own report enforced in app)
create policy "sightings_insert_own"
  on public.sightings for insert to authenticated
  with check (auth.uid() = reporter_id);

-- Storage: allow sightings/{user_id}/... uploads in report-images bucket
create policy "Users upload sighting images"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'report-images'
    and (storage.foldername(name))[1] = 'sightings'
    and (storage.foldername(name))[2] = auth.uid()::text
  );
