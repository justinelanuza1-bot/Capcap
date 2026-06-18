-- LostFinder / Capcap — RLS Policy Reference (documentation)
-- Run AFTER all migrations. Idempotent re-create of core policies.
-- Full security summary: docs/06-system-design.md

-- PROFILES
drop policy if exists "profiles_select_authenticated" on public.profiles;
create policy "profiles_select_authenticated"
  on public.profiles for select to authenticated using (true);

drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own"
  on public.profiles for update to authenticated
  using (auth.uid() = id) with check (auth.uid() = id);

drop policy if exists "profiles_update_admin" on public.profiles;
create policy "profiles_update_admin"
  on public.profiles for update to authenticated
  using (public.is_admin());

-- REPORTS
drop policy if exists "reports_select_authenticated" on public.reports;
create policy "reports_select_authenticated"
  on public.reports for select to authenticated using (true);

drop policy if exists "reports_insert_own" on public.reports;
create policy "reports_insert_own"
  on public.reports for insert to authenticated
  with check (auth.uid() = user_id);

drop policy if exists "reports_update_own_or_admin" on public.reports;
create policy "reports_update_own_or_admin"
  on public.reports for update to authenticated
  using (auth.uid() = user_id or public.is_admin());

drop policy if exists "reports_delete_admin" on public.reports;
create policy "reports_delete_admin"
  on public.reports for delete to authenticated
  using (public.is_admin());

-- CLAIMS
drop policy if exists "claims_select_participants" on public.claims;
create policy "claims_select_participants"
  on public.claims for select to authenticated
  using (auth.uid() = claimant_id or auth.uid() = finder_id or public.is_admin());

drop policy if exists "claims_insert_own" on public.claims;
create policy "claims_insert_own"
  on public.claims for insert to authenticated
  with check (auth.uid() = claimant_id);

drop policy if exists "claims_update_admin" on public.claims;
create policy "claims_update_admin"
  on public.claims for update to authenticated
  using (public.is_admin());

-- MESSAGES (see also 009_fix_messages_rls.sql for grants)
drop policy if exists "messages_select_participants" on public.messages;
create policy "messages_select_participants"
  on public.messages for select to authenticated
  using (auth.uid() = sender_id or auth.uid() = receiver_id);

drop policy if exists "messages_insert_own" on public.messages;
create policy "messages_insert_own"
  on public.messages for insert to authenticated
  with check (auth.uid() = sender_id);

drop policy if exists "messages_update_receiver" on public.messages;
create policy "messages_update_receiver"
  on public.messages for update to authenticated
  using (auth.uid() = receiver_id);

grant select, insert, update on public.messages to authenticated;

-- SIGHTINGS (from 007_sightings.sql)
drop policy if exists "sightings_select_authenticated" on public.sightings;
create policy "sightings_select_authenticated"
  on public.sightings for select to authenticated using (true);

drop policy if exists "sightings_insert_authenticated" on public.sightings;
create policy "sightings_insert_authenticated"
  on public.sightings for insert to authenticated
  with check (auth.uid() = reporter_id);

drop policy if exists "sightings_update_owner_or_admin" on public.sightings;
create policy "sightings_update_owner_or_admin"
  on public.sightings for update to authenticated
  using (
    auth.uid() in (select user_id from public.reports where id = report_id)
    or public.is_admin()
  );
