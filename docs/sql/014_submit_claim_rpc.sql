-- Atomic claim submit: verify answers, insert claim, resolve report, award finder points
-- Run AFTER 013_fix_claim_hash.sql
-- Fixes persistent "Cannot coerce the result to a single JSON object" on claim submit

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
  h1 text;
  h2 text;
  h3 text;
  v_exact boolean;
  v_vague boolean;
  v_word_count int;
  v_code text;
  v_expires timestamptz;
  v_claim public.claims;
  v_claimant_id uuid;
  v_claimant_name text;
begin
  v_claimant_id := auth.uid();
  if v_claimant_id is null then
    raise exception 'Not authenticated';
  end if;

  select name into v_claimant_name
  from public.profiles
  where id = v_claimant_id;

  select * into v_report
  from public.reports
  where id = p_report_id
    and type = 'found'
    and status = 'pending';

  if not found or v_report.id is null then
    raise exception 'Found item not available for claim (may already be resolved)';
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

  v_exact := h1 = (v_stored->>'q1')
    and h2 = (v_stored->>'q2')
    and h3 = (v_stored->>'q3');

  v_word_count := coalesce(
    array_length(
      regexp_split_to_array(
        trim(coalesce(p_answer1, '') || ' ' || coalesce(p_answer2, '') || ' ' || coalesce(p_answer3, '')),
        '\s+'
      ),
      1
    ),
    0
  );
  v_vague := v_word_count <= 5;

  if v_exact then
    v_code := 'LF-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 6));
    v_expires := now() + interval '48 hours';
  else
    v_code := null;
    v_expires := null;
  end if;

  insert into public.claims (
    report_id,
    item_name,
    finder_id,
    claimant_id,
    claimant_name,
    answer_hashes,
    exact_match,
    vague,
    status,
    retrieval_code,
    expires_at
  ) values (
    p_report_id,
    v_report.item_name,
    v_report.user_id,
    v_claimant_id,
    coalesce(v_claimant_name, 'User'),
    jsonb_build_object('q1', h1, 'q2', h2, 'q3', h3),
    v_exact,
    v_vague,
    case when v_exact then 'auto-approved' else 'pending-review' end,
    v_code,
    v_expires
  )
  returning * into v_claim;

  if v_exact then
    update public.reports
    set status = 'resolved',
        resolved_at = coalesce(resolved_at, now())
    where id = p_report_id;

    update public.profiles
    set points = points + 20
    where id = v_report.user_id;
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

grant select, insert on public.claims to authenticated;

-- Refresh PostgREST schema cache so submit_claim is visible immediately
notify pgrst, 'reload schema';
