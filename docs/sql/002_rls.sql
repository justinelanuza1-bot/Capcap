-- LostFinder / Capcap — Phase 0 RLS Policies
-- Run AFTER 001_schema.sql

alter table public.profiles enable row level security;
alter table public.reports enable row level security;
alter table public.claims enable row level security;
alter table public.messages enable row level security;

-- PROFILES
create policy "profiles_select_authenticated"
  on public.profiles for select to authenticated using (true);

create policy "profiles_update_own"
  on public.profiles for update to authenticated
  using (auth.uid() = id) with check (auth.uid() = id);

create policy "profiles_update_admin"
  on public.profiles for update to authenticated
  using (public.is_admin());

-- REPORTS
create policy "reports_select_authenticated"
  on public.reports for select to authenticated using (true);

create policy "reports_insert_own"
  on public.reports for insert to authenticated
  with check (auth.uid() = user_id);

create policy "reports_update_own_or_admin"
  on public.reports for update to authenticated
  using (auth.uid() = user_id or public.is_admin());

create policy "reports_delete_admin"
  on public.reports for delete to authenticated
  using (public.is_admin());

-- CLAIMS
create policy "claims_select_participants"
  on public.claims for select to authenticated
  using (
    auth.uid() = claimant_id
    or auth.uid() = finder_id
    or public.is_admin()
  );

create policy "claims_insert_own"
  on public.claims for insert to authenticated
  with check (auth.uid() = claimant_id);

create policy "claims_update_admin"
  on public.claims for update to authenticated
  using (public.is_admin());

-- MESSAGES
create policy "messages_select_participants"
  on public.messages for select to authenticated
  using (auth.uid() = sender_id or auth.uid() = receiver_id);

create policy "messages_insert_own"
  on public.messages for insert to authenticated
  with check (auth.uid() = sender_id);

create policy "messages_update_receiver"
  on public.messages for update to authenticated
  using (auth.uid() = receiver_id);

grant select, insert, update on public.messages to authenticated;
