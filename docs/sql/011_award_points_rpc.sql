-- Award points to another user (sighting tips, claim resolution, etc.)
-- Run AFTER 010_verify_claim_rpc.sql
-- Fixes: "Cannot coerce the result to a single JSON object" when owners credit reporters

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

  -- Prevent self-award via RPC (own points use direct profile update in the app)
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
