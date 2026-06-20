-- =============================================================================
-- Migration 017: Notification Center + Unified Claim Flow
-- Run in Supabase SQL Editor ONCE (after 016_claimed_status.sql).
-- =============================================================================
-- This migration implements the core of docs/13-ux-design-recommendations.md:
--   1. A `notifications` table (in-app notification center) + RLS + Realtime.
--   2. `claims.pickup_location` so the claimant always knows WHERE to collect.
--   3. Rewrites `submit_claim` so an EXACT match no longer auto-resolves the
--      report or pays the finder. Instead it becomes a VERIFIED claim that is
--      "awaiting handover" — identical to the admin-tagged path. The finder (or
--      admin) confirms the physical handover via `confirm_handover`, which is
--      the ONLY thing that resolves the report and awards finder points.
--   4. Adds `confirm_handover(claim_id)` callable by the finder OR an admin.
-- The app degrades gracefully if this migration has not been run yet.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. NOTIFICATIONS TABLE
-- -----------------------------------------------------------------------------
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

alter table public.notifications enable row level security;

drop policy if exists "notifications_select_own" on public.notifications;
create policy "notifications_select_own" on public.notifications
  for select to authenticated
  using (user_id = auth.uid() or public.is_admin());

drop policy if exists "notifications_update_own" on public.notifications;
create policy "notifications_update_own" on public.notifications
  for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- Any authenticated user may create a notification for another user
-- (needed so a claimant can notify a finder, etc.). Low-risk for a campus app.
drop policy if exists "notifications_insert_any" on public.notifications;
create policy "notifications_insert_any" on public.notifications
  for insert to authenticated
  with check (true);

-- Add to Realtime publication (ignore if already present)
do $$
begin
  alter publication supabase_realtime add table public.notifications;
exception
  when duplicate_object then null;
  when undefined_object then null;
end $$;

-- -----------------------------------------------------------------------------
-- 2. PICKUP LOCATION ON CLAIMS
-- -----------------------------------------------------------------------------
alter table public.claims
  add column if not exists pickup_location text default '';

-- -----------------------------------------------------------------------------
-- 3. UNIFIED submit_claim: exact match -> VERIFIED + awaiting handover
-- -----------------------------------------------------------------------------
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
      regexp_split_to_array(
        trim(coalesce(p_answer1,'') || ' ' || coalesce(p_answer2,'') || ' ' || coalesce(p_answer3,'')),
        '\s+'
      ), 1
    ), 0);
  v_vague := v_word_count <= 5;

  -- Exact match issues a code immediately and is VERIFIED, but only goes to
  -- "awaiting handover" — it does NOT resolve the report or pay the finder.
  if v_exact then
    v_code := 'LF-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 6));
    v_expires := now() + interval '48 hours';
  else
    v_code := null;
    v_expires := null;
  end if;

  insert into public.claims (
    report_id, item_name, finder_id, claimant_id, claimant_name,
    answer_hashes, exact_match, vague, status, retrieval_code, expires_at
  ) values (
    p_report_id, v_report.item_name, v_report.user_id, v_claimant_id,
    coalesce(v_claimant_name, 'User'),
    jsonb_build_object('q1', h1, 'q2', h2, 'q3', h3),
    v_exact, v_vague,
    case when v_exact then 'approved' else 'pending-review' end,
    v_code, v_expires
  )
  returning * into v_claim;

  -- Mark the report "claimed" on exact match (awaiting handover), not resolved.
  if v_exact then
    update public.reports set status = 'claimed' where id = p_report_id;
  end if;

  -- Notify the finder that their item was claimed (ALWAYS).
  insert into public.notifications (user_id, type, title, body, link)
  values (
    v_report.user_id,
    case when v_exact then 'claim-verified' else 'claim-new' end,
    case when v_exact
         then 'Your found item was claimed and verified'
         else 'Someone claimed your found item' end,
    coalesce(v_claimant_name,'A user') || ' claimed "' || v_report.item_name || '". ' ||
    case when v_exact
         then 'Ownership was auto-verified. Confirm the handover when you give the item back.'
         else 'Verification was not exact — an admin will review it.' end,
    'reports'
  );

  if v_exact then
    -- Tell the claimant their code (also shown in the UI).
    insert into public.notifications (user_id, type, title, body, link)
    values (
      v_claimant_id, 'claim-verified',
      'Claim verified — ready for pickup',
      'Your claim for "' || v_report.item_name || '" is verified. Retrieval code: ' ||
      v_code || ' (valid 48h). Coordinate with the finder for handover.',
      'my-claims'
    );
  else
    -- Notify all admins there is a claim to review.
    for v_admin in select id from public.profiles where role = 'admin' loop
      insert into public.notifications (user_id, type, title, body, link)
      values (
        v_admin.id, 'claim-review',
        'New claim needs review',
        coalesce(v_claimant_name,'A user') || ' claimed "' || v_report.item_name ||
        '". Verification was not exact.',
        'claims-panel'
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

-- -----------------------------------------------------------------------------
-- 4. confirm_handover: finder OR admin closes the loop
-- -----------------------------------------------------------------------------
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

-- Refresh PostgREST schema cache so the new functions/columns are visible.
notify pgrst, 'reload schema';
