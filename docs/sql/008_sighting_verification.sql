-- Sighting verification: owner confirms tips and credits successful recoveries
-- Run in Supabase SQL Editor after 007_sightings.sql

alter table public.sightings
  add column if not exists status text not null default 'pending'
    check (status in ('pending', 'helpful', 'recovered', 'dismissed')),
  add column if not exists verified_at timestamptz,
  add column if not exists verified_by uuid references public.profiles(id),
  add column if not exists points_awarded integer not null default 0;

alter table public.reports
  add column if not exists recovery_sighting_id bigint references public.sightings(id);

create index if not exists sightings_status_idx on public.sightings (status);

-- Report owner can verify sightings on their lost items
create policy "sightings_update_owner"
  on public.sightings for update to authenticated
  using (
    exists (
      select 1 from public.reports r
      where r.id = report_id and r.user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.reports r
      where r.id = report_id and r.user_id = auth.uid()
    )
  );
