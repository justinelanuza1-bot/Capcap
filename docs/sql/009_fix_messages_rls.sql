-- Fix: "new row violates row-level security policy for table messages"
-- Run in Supabase SQL Editor after 002_rls.sql

-- Ensure authenticated role can access the table
grant select, insert, update on public.messages to authenticated;

-- Replace insert policy (must match auth.uid() to sender_id)
drop policy if exists "messages_insert_own" on public.messages;

create policy "messages_insert_own"
  on public.messages for insert to authenticated
  with check (
    auth.uid() is not null
    and auth.uid() = sender_id
    and sender_id is distinct from receiver_id
  );

-- Participants can read their threads (required for insert ... returning)
drop policy if exists "messages_select_participants" on public.messages;

create policy "messages_select_participants"
  on public.messages for select to authenticated
  using (
    auth.uid() = sender_id
    or auth.uid() = receiver_id
  );

-- Receiver can mark messages read
drop policy if exists "messages_update_receiver" on public.messages;

create policy "messages_update_receiver"
  on public.messages for update to authenticated
  using (auth.uid() = receiver_id)
  with check (auth.uid() = receiver_id);

-- Admin read (stats) — re-apply if missing after reset
drop policy if exists "messages_select_admin" on public.messages;

create policy "messages_select_admin"
  on public.messages for select to authenticated
  using (public.is_admin());
