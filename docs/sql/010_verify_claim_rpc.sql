-- LostFinder / Capcap — Server-side claim verification + Realtime messages
-- Run AFTER 009_fix_messages_rls.sql

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

-- to_base36 helper (PostgreSQL has no built-in base36)
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

-- Replicate client simpleHash in PostgreSQL (must stay in sync with js/domain/verification.js)
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

-- Verify claim answers server-side; does not return stored hashes
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

-- Enable Realtime for messages (live chat updates)
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
