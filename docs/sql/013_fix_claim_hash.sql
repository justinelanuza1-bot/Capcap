-- Fix verify_claim_answers: "integer out of range" in simple_hash_answer
-- Run in Supabase SQL Editor (replaces broken hash from 010)

-- Emulate JavaScript (hash |= 0) — 32-bit signed integer wrap
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

-- Re-create verify (unchanged logic, fixed hash)
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
  h1 text;
  h2 text;
  h3 text;
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

  exact := h1 = (stored->>'q1')
    and h2 = (stored->>'q2')
    and h3 = (stored->>'q3');

  word_count := coalesce(
    array_length(
      regexp_split_to_array(
        trim(coalesce(p_answer1, '') || ' ' || coalesce(p_answer2, '') || ' ' || coalesce(p_answer3, '')),
        '\s+'
      ),
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
