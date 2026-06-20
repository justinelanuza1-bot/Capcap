-- =============================================================================
-- LostFinder / Capcap — FINAL CONSOLIDATED SCHEMA (run once on a fresh database)
-- =============================================================================
-- This single file is the complete, authoritative database setup. It folds in
-- every migration (001–017) including the unified claim flow + notifications.
-- Run it in the Supabase SQL Editor on a clean project (or after
-- 000_reset_database.sql). It is idempotent where practical and safe to re-run.
--
-- After running:
--   1. Auth → Providers → Email: enable provider + sign-ups
--   2. Create an admin: set profiles.role = 'admin' for your user
--
-- Claim flow (finder-in-the-loop):
--   submit_claim   → exact answers become a VERIFIED claim "awaiting handover"
--                    (issues a retrieval code; does NOT auto-resolve or pay yet)
--   confirm_handover → finder OR admin closes the case: report = resolved,
--                    finder awarded points. This is the ONLY step that resolves.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. TABLES
-- -----------------------------------------------------------------------------

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
  status text not null default 'pending' check (status in ('pending', 'claimed', 'resolved')),
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);

create index if not exists reports_type_status_idx on public.reports (type, status);
create index if not exists reports_user_id_idx on public.reports (user_id);
create index if not exists reports_created_at_idx on public.reports (created_at desc);

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
    check (status in ('auto-approved', 'pending-review', 'approved', 'denied', 'completed')),
  retrieval_code text,
  expires_at timestamptz,
  pickup_location text default '',
  created_at timestamptz not null default now()
);

create index if not exists claims_report_id_idx on public.claims (report_id);
create index if not exists claims_status_idx on public.claims (status);

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
create index if not exists sightings_status_idx on public.sightings (status);

-- In-app notification center (claims, sightings, handovers)
create table if not exists public.notifications (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles(id) on delete cascade,
  type text not null default 'info',
  title text not null,
  body text default '',
  link text default '',
  is_read boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists notifications_user_idx
  on public.notifications (user_id, is_read, created_at desc);

-- recovery link added after sightings exists (avoids circular create-time FK)
alter table public.reports
  add column if not exists recovery_sighting_id bigint references public.sightings(id);

-- -----------------------------------------------------------------------------
-- 2. CORE FUNCTIONS + TRIGGERS
-- -----------------------------------------------------------------------------

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

-- Auto-create profile on signup (unique username fallback)
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

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Create profile on demand if missing (login self-heal)
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

-- Pre-login helpers
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

-- -----------------------------------------------------------------------------
-- 3. POINTS RPC (award to other users; bypasses owner-only profile RLS)
-- -----------------------------------------------------------------------------

create or replace function public.award_points(p_user_id uuid, p_amount integer)
returns public.profiles
language plpgsql
security definer
set search_path = public
as $$
declare
  result public.profiles;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;
  if p_user_id is null then
    raise exception 'Invalid user';
  end if;
  if p_amount is null or p_amount <= 0 then
    raise exception 'Amount must be a positive integer';
  end if;
  if p_user_id = auth.uid() then
    raise exception 'Use profile update for your own points';
  end if;

  update public.profiles
  set points = points + p_amount
  where id = p_user_id
  returning * into result;

  if result.id is null then
    raise exception 'Profile not found';
  end if;

  return result;
end;
$$;

grant execute on function public.award_points(uuid, integer) to authenticated;

-- -----------------------------------------------------------------------------
-- 4. BLIND-VERIFICATION HASH (matches js/domain/verification.js simpleHash)
-- -----------------------------------------------------------------------------

create or replace function public.wrap_int32(val bigint)
returns bigint
language sql
immutable
as $$
  select (val & 4294967295) - case
    when (val & 4294967295) >= 2147483648 then 4294967296
    else 0
  end;
$$;

create or replace function public.to_base36(p_num bigint)
returns text
language plpgsql
immutable
as $$
declare
  chars text := '0123456789abcdefghijklmnopqrstuvwxyz';
  n bigint := p_num;
  result text := '';
  rem int;
begin
  if n = 0 then return '0'; end if;
  while n > 0 loop
    rem := (n % 36)::int;
    result := substr(chars, rem + 1, 1) || result;
    n := n / 36;
  end loop;
  return result;
end;
$$;

create or replace function public.simple_hash_answer(p_text text)
returns text
language plpgsql
immutable
as $$
declare
  normalized text;
  i int;
  chr int;
  h bigint := 0;
begin
  if p_text is null or trim(p_text) = '' then
    return '';
  end if;
  normalized := lower(trim(regexp_replace(p_text, '\s+', ' ', 'g')));
  for i in 1..length(normalized) loop
    chr := ascii(substr(normalized, i, 1));
    h := public.wrap_int32((h << 5) - h + chr);
  end loop;
  return 'H' || upper(public.to_base36(abs(h)));
end;
$$;

-- Server-side verify (does not return stored hashes)
create or replace function public.verify_claim_answers(
  p_report_id bigint,
  p_answer1 text,
  p_answer2 text,
  p_answer3 text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  stored jsonb;
  h1 text; h2 text; h3 text;
  exact boolean;
  word_count int;
  vague boolean;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  select verify_hashes into stored
  from public.reports
  where id = p_report_id and type = 'found' and status = 'pending';

  if stored is null then
    raise exception 'Report not found or has no verification questions';
  end if;

  h1 := public.simple_hash_answer(p_answer1);
  h2 := public.simple_hash_answer(p_answer2);
  h3 := public.simple_hash_answer(p_answer3);

  exact := h1 = (stored->>'q1') and h2 = (stored->>'q2') and h3 = (stored->>'q3');

  word_count := coalesce(
    array_length(
      regexp_split_to_array(trim(coalesce(p_answer1,'') || ' ' || coalesce(p_answer2,'') || ' ' || coalesce(p_answer3,'')), '\s+'),
      1
    ),
    0
  );
  vague := word_count <= 5;

  return jsonb_build_object(
    'exact_match', exact,
    'vague', vague,
    'answer_hashes', jsonb_build_object('q1', h1, 'q2', h2, 'q3', h3)
  );
end;
$$;

grant execute on function public.verify_claim_answers(bigint, text, text, text) to authenticated;

-- -----------------------------------------------------------------------------
-- 5. CLAIM SUBMIT + RESOLVE RPCs (atomic, avoids client RLS pitfalls)
-- -----------------------------------------------------------------------------

-- Unified claim submit: an EXACT match becomes a VERIFIED claim "awaiting
-- handover" (issues a retrieval code, marks the report 'claimed'). It does NOT
-- auto-resolve the report or pay the finder — that happens in confirm_handover.
-- Always notifies the relevant parties via the notifications table.
create or replace function public.submit_claim(
  p_report_id bigint,
  p_answer1 text,
  p_answer2 text,
  p_answer3 text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_report public.reports;
  v_stored jsonb;
  h1 text; h2 text; h3 text;
  v_exact boolean;
  v_vague boolean;
  v_word_count int;
  v_code text;
  v_expires timestamptz;
  v_claim public.claims;
  v_claimant_id uuid;
  v_claimant_name text;
  v_admin record;
begin
  v_claimant_id := auth.uid();
  if v_claimant_id is null then
    raise exception 'Not authenticated';
  end if;

  select name into v_claimant_name from public.profiles where id = v_claimant_id;

  select * into v_report
  from public.reports
  where id = p_report_id and type = 'found' and status = 'pending';

  if not found or v_report.id is null then
    raise exception 'Found item not available for claim (may already be claimed or resolved)';
  end if;

  v_stored := v_report.verify_hashes;
  if v_stored is null then
    raise exception 'This item has no verification questions';
  end if;

  if v_report.user_id = v_claimant_id then
    raise exception 'You cannot claim your own found item';
  end if;

  h1 := public.simple_hash_answer(p_answer1);
  h2 := public.simple_hash_answer(p_answer2);
  h3 := public.simple_hash_answer(p_answer3);

  v_exact := h1 = (v_stored->>'q1') and h2 = (v_stored->>'q2') and h3 = (v_stored->>'q3');

  v_word_count := coalesce(
    array_length(
      regexp_split_to_array(trim(coalesce(p_answer1,'') || ' ' || coalesce(p_answer2,'') || ' ' || coalesce(p_answer3,'')), '\s+'),
      1
    ),
    0
  );
  v_vague := v_word_count <= 5;

  if v_exact then
    v_code := 'LF-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 6));
    v_expires := now() + interval '48 hours';
  end if;

  insert into public.claims (
    report_id, item_name, finder_id, claimant_id, claimant_name,
    answer_hashes, exact_match, vague, status, retrieval_code, expires_at
  ) values (
    p_report_id, v_report.item_name, v_report.user_id, v_claimant_id, coalesce(v_claimant_name, 'User'),
    jsonb_build_object('q1', h1, 'q2', h2, 'q3', h3),
    v_exact, v_vague,
    case when v_exact then 'approved' else 'pending-review' end,
    v_code, v_expires
  )
  returning * into v_claim;

  -- Exact match → report awaits handover (not resolved yet)
  if v_exact then
    update public.reports set status = 'claimed' where id = p_report_id;
  end if;

  -- Always notify the finder their item was claimed
  insert into public.notifications (user_id, type, title, body, link)
  values (
    v_report.user_id,
    case when v_exact then 'claim-verified' else 'claim-new' end,
    case when v_exact then 'Your found item was claimed and verified'
         else 'Someone claimed your found item' end,
    coalesce(v_claimant_name,'A user') || ' claimed "' || v_report.item_name || '". ' ||
    case when v_exact then 'Ownership was auto-verified. Confirm the handover when you return the item.'
         else 'Verification was not exact — an admin will review it.' end,
    'reports'
  );

  if v_exact then
    insert into public.notifications (user_id, type, title, body, link)
    values (
      v_claimant_id, 'claim-verified', 'Claim verified — ready for pickup',
      'Your claim for "' || v_report.item_name || '" is verified. Retrieval code: ' ||
      v_code || ' (valid 48h). Coordinate with the finder for handover.',
      'my-claims'
    );
  else
    for v_admin in select id from public.profiles where role = 'admin' loop
      insert into public.notifications (user_id, type, title, body, link)
      values (
        v_admin.id, 'claim-review', 'New claim needs review',
        coalesce(v_claimant_name,'A user') || ' claimed "' || v_report.item_name ||
        '". Verification was not exact.', 'claims-panel'
      );
    end loop;
  end if;

  return jsonb_build_object(
    'claim_id', v_claim.id,
    'exact_match', v_exact,
    'vague', v_vague,
    'status', v_claim.status,
    'retrieval_code', v_claim.retrieval_code,
    'expires_at', v_claim.expires_at
  );
end;
$$;

grant execute on function public.submit_claim(bigint, text, text, text) to authenticated;

-- Finder OR admin confirms the physical handover. This is the only step that
-- resolves the report and awards finder points. Idempotent.
create or replace function public.confirm_handover(p_claim_id bigint)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid;
  v_claim public.claims;
  v_is_admin boolean;
begin
  v_uid := auth.uid();
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;

  select * into v_claim from public.claims where id = p_claim_id;
  if not found then
    raise exception 'Claim not found';
  end if;

  select public.is_admin() into v_is_admin;
  if v_claim.finder_id <> v_uid and not v_is_admin then
    raise exception 'Only the finder or an admin can confirm this handover';
  end if;

  if v_claim.status = 'completed' then
    raise exception 'This handover was already confirmed';
  end if;
  if v_claim.status not in ('approved', 'auto-approved') then
    raise exception 'This claim is not ready for handover';
  end if;

  update public.claims set status = 'completed' where id = p_claim_id;

  update public.reports
  set status = 'resolved', resolved_at = coalesce(resolved_at, now())
  where id = v_claim.report_id;

  update public.profiles set points = points + 20 where id = v_claim.finder_id;

  insert into public.notifications (user_id, type, title, body, link)
  values
    (v_claim.claimant_id, 'handover-done', 'Item returned — case closed',
     'Your claim for "' || v_claim.item_name || '" is complete. Thanks for using LostFinder!',
     'my-claims'),
    (v_claim.finder_id, 'handover-done', 'Handover confirmed — points awarded',
     'You returned "' || v_claim.item_name || '" and earned 20 points. Thank you!',
     'reports');

  return jsonb_build_object('claim_id', v_claim.id, 'status', 'completed');
end;
$$;

grant execute on function public.confirm_handover(bigint) to authenticated;

-- Admin-approve path / fallback resolve
drop function if exists public.resolve_report_for_claim(bigint);
create or replace function public.resolve_report_for_claim(p_report_id bigint)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  result public.reports;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  if not exists (
    select 1 from public.claims c
    where c.report_id = p_report_id
      and c.claimant_id = auth.uid()
      and c.exact_match = true
      and c.status = 'auto-approved'
  ) then
    raise exception 'No auto-approved claim found for this report';
  end if;

  update public.reports
  set status = 'resolved', resolved_at = coalesce(resolved_at, now())
  where id = p_report_id and type = 'found' and status = 'pending'
  returning * into result;

  if result.id is null then
    select * into result from public.reports where id = p_report_id;
    if result.id is null then
      raise exception 'Report not found';
    end if;
  end if;

  update public.profiles set points = points + 20 where id = result.user_id;

  return jsonb_build_object('ok', true, 'report_id', result.id, 'status', result.status);
end;
$$;

grant execute on function public.resolve_report_for_claim(bigint) to authenticated;

-- -----------------------------------------------------------------------------
-- 6. ROW LEVEL SECURITY
-- -----------------------------------------------------------------------------

alter table public.profiles enable row level security;
alter table public.reports  enable row level security;
alter table public.claims   enable row level security;
alter table public.messages enable row level security;
alter table public.sightings enable row level security;

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
  with check (auth.uid() is not null and auth.uid() = claimant_id);

drop policy if exists "claims_update_admin" on public.claims;
create policy "claims_update_admin"
  on public.claims for update to authenticated
  using (public.is_admin());

grant select, insert on public.claims to authenticated;

-- MESSAGES
drop policy if exists "messages_select_participants" on public.messages;
create policy "messages_select_participants"
  on public.messages for select to authenticated
  using (auth.uid() = sender_id or auth.uid() = receiver_id);

drop policy if exists "messages_select_admin" on public.messages;
create policy "messages_select_admin"
  on public.messages for select to authenticated
  using (public.is_admin());

drop policy if exists "messages_insert_own" on public.messages;
create policy "messages_insert_own"
  on public.messages for insert to authenticated
  with check (
    auth.uid() is not null
    and auth.uid() = sender_id
    and sender_id is distinct from receiver_id
  );

drop policy if exists "messages_update_receiver" on public.messages;
create policy "messages_update_receiver"
  on public.messages for update to authenticated
  using (auth.uid() = receiver_id) with check (auth.uid() = receiver_id);

grant select, insert, update on public.messages to authenticated;

-- SIGHTINGS
drop policy if exists "sightings_select_related" on public.sightings;
create policy "sightings_select_related"
  on public.sightings for select to authenticated
  using (
    auth.uid() = reporter_id
    or exists (select 1 from public.reports r where r.id = report_id and r.user_id = auth.uid())
    or public.is_admin()
  );

drop policy if exists "sightings_insert_own" on public.sightings;
create policy "sightings_insert_own"
  on public.sightings for insert to authenticated
  with check (auth.uid() = reporter_id);

drop policy if exists "sightings_update_owner" on public.sightings;
create policy "sightings_update_owner"
  on public.sightings for update to authenticated
  using (exists (select 1 from public.reports r where r.id = report_id and r.user_id = auth.uid()))
  with check (exists (select 1 from public.reports r where r.id = report_id and r.user_id = auth.uid()));

-- NOTIFICATIONS
alter table public.notifications enable row level security;

drop policy if exists "notifications_select_own" on public.notifications;
create policy "notifications_select_own"
  on public.notifications for select to authenticated
  using (user_id = auth.uid() or public.is_admin());

drop policy if exists "notifications_update_own" on public.notifications;
create policy "notifications_update_own"
  on public.notifications for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Any authenticated user may create a notification for another user
-- (so a claimant can notify a finder, etc.). Low-risk for a campus app.
drop policy if exists "notifications_insert_any" on public.notifications;
create policy "notifications_insert_any"
  on public.notifications for insert to authenticated
  with check (true);

grant select, insert, update on public.notifications to authenticated;

-- -----------------------------------------------------------------------------
-- 7. STORAGE (report-images bucket: report photos + sighting photos)
-- -----------------------------------------------------------------------------

insert into storage.buckets (id, name, public)
values ('report-images', 'report-images', true)
on conflict (id) do nothing;

drop policy if exists "Users upload own report images" on storage.objects;
create policy "Users upload own report images"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'report-images'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "Users update own report images" on storage.objects;
create policy "Users update own report images"
  on storage.objects for update to authenticated
  using (
    bucket_id = 'report-images'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "Public read report images" on storage.objects;
create policy "Public read report images"
  on storage.objects for select to authenticated
  using (bucket_id = 'report-images');

drop policy if exists "Users upload sighting images" on storage.objects;
create policy "Users upload sighting images"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'report-images'
    and (storage.foldername(name))[1] = 'sightings'
    and (storage.foldername(name))[2] = auth.uid()::text
  );

-- -----------------------------------------------------------------------------
-- 8. REALTIME (live chat updates on messages)
-- -----------------------------------------------------------------------------

alter table public.messages replica identity full;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'messages'
  ) then
    alter publication supabase_realtime add table public.messages;
  end if;
exception
  when others then
    raise notice 'Could not add messages to supabase_realtime publication: %', sqlerrm;
end;
$$;

-- Live in-app notifications
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'notifications'
  ) then
    alter publication supabase_realtime add table public.notifications;
  end if;
exception
  when others then
    raise notice 'Could not add notifications to supabase_realtime publication: %', sqlerrm;
end;
$$;

-- Refresh PostgREST schema cache so new RPCs are visible immediately
notify pgrst, 'reload schema';

-- =============================================================================
-- Done. Next: enable Email auth + sign-ups, then set your user's role = 'admin'.
-- =============================================================================
