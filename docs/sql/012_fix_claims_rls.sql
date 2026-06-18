-- Fix claim submit: grants, resolve report on auto-approve, award finder points
-- Run AFTER 011_award_points_rpc.sql

grant select, insert on public.claims to authenticated;

-- Claimant must read their row after insert ... returning
drop policy if exists "claims_select_participants" on public.claims;
create policy "claims_select_participants"
  on public.claims for select to authenticated
  using (
    auth.uid() = claimant_id
    or auth.uid() = finder_id
    or public.is_admin()
  );

drop policy if exists "claims_insert_own" on public.claims;
create policy "claims_insert_own"
  on public.claims for insert to authenticated
  with check (
    auth.uid() is not null
    and auth.uid() = claimant_id
  );

-- Claimant with auto-approved claim can mark the found report resolved
drop function if exists public.resolve_report_for_claim(bigint);

create or replace function public.resolve_report_for_claim(p_report_id bigint)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  result public.reports;
  v_finder_id uuid;
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
  set status = 'resolved',
      resolved_at = coalesce(resolved_at, now())
  where id = p_report_id
    and type = 'found'
    and status = 'pending'
  returning * into result;

  if result.id is null then
    select * into result from public.reports where id = p_report_id;
    if result.id is null then
      raise exception 'Report not found';
    end if;
  end if;

  v_finder_id := result.user_id;

  update public.profiles
  set points = points + 20
  where id = v_finder_id;

  return jsonb_build_object(
    'ok', true,
    'report_id', result.id,
    'status', result.status
  );
end;
$$;

grant execute on function public.resolve_report_for_claim(bigint) to authenticated;
