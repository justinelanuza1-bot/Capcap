-- Phase 4: Allow admins to read all messages (for stats dashboard)
-- Run in Supabase SQL Editor

create policy "messages_select_admin"
  on public.messages for select to authenticated
  using (public.is_admin());
