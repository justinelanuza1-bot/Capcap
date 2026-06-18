-- LostFinder — Storage bucket for report images (Phase 3)
-- Run in Supabase SQL Editor after creating bucket OR use this to create it

insert into storage.buckets (id, name, public)
values ('report-images', 'report-images', true)
on conflict (id) do nothing;

-- Authenticated users can upload to their own folder
create policy "Users upload own report images"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'report-images'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- Authenticated users can update their own uploads
create policy "Users update own report images"
  on storage.objects for update to authenticated
  using (
    bucket_id = 'report-images'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- Public read (bucket is public)
create policy "Public read report images"
  on storage.objects for select to authenticated
  using (bucket_id = 'report-images');
