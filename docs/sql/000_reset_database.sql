-- =============================================================================
-- LostFinder / Capcap — FULL DATABASE RESET (fresh start)
-- =============================================================================
--
-- ⚠️  DESTRUCTIVE: Deletes ALL app data (reports, claims, messages, sightings,
--     profiles, uploaded images). This cannot be undone.
--
-- What this does NOT delete by default:
--   - auth.users accounts (login accounts remain; profiles are removed)
--
-- When to use:
--   - Wipe app data and re-run migrations 001 → 008 from scratch
--
-- Steps for a fresh start:
--   1. Run THIS file in Supabase SQL Editor
--   2. (Optional) Uncomment Section 8 to remove auth users too
--   3. Re-run 001_schema.sql through 008_sighting_verification.sql in order
--
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Triggers
-- -----------------------------------------------------------------------------
drop trigger if exists on_auth_user_created on auth.users;
drop trigger if exists enforce_weekly_report_limit on public.reports;

-- -----------------------------------------------------------------------------
-- 2. RLS policies — public tables
-- -----------------------------------------------------------------------------
drop policy if exists "profiles_select_authenticated" on public.profiles;
drop policy if exists "profiles_update_own" on public.profiles;
drop policy if exists "profiles_update_admin" on public.profiles;

drop policy if exists "reports_select_authenticated" on public.reports;
drop policy if exists "reports_insert_own" on public.reports;
drop policy if exists "reports_update_own_or_admin" on public.reports;
drop policy if exists "reports_delete_admin" on public.reports;

drop policy if exists "claims_select_participants" on public.claims;
drop policy if exists "claims_insert_own" on public.claims;
drop policy if exists "claims_update_admin" on public.claims;

drop policy if exists "messages_select_participants" on public.messages;
drop policy if exists "messages_select_admin" on public.messages;
drop policy if exists "messages_insert_own" on public.messages;
drop policy if exists "messages_update_receiver" on public.messages;

drop policy if exists "sightings_select_related" on public.sightings;
drop policy if exists "sightings_insert_own" on public.sightings;
drop policy if exists "sightings_update_owner" on public.sightings;

-- -----------------------------------------------------------------------------
-- 3. RLS policies — storage (report-images bucket)
-- -----------------------------------------------------------------------------
drop policy if exists "Users upload own report images" on storage.objects;
drop policy if exists "Users update own report images" on storage.objects;
drop policy if exists "Public read report images" on storage.objects;
drop policy if exists "Users upload sighting images" on storage.objects;

-- -----------------------------------------------------------------------------
-- 4. Break circular FK (reports.recovery_sighting_id → sightings)
-- -----------------------------------------------------------------------------
alter table public.reports
  drop constraint if exists reports_recovery_sighting_id_fkey;

alter table public.reports
  drop column if exists recovery_sighting_id;

-- -----------------------------------------------------------------------------
-- 5. Drop tables (child → parent)
-- -----------------------------------------------------------------------------
drop table if exists public.sightings cascade;
drop table if exists public.messages cascade;
drop table if exists public.claims cascade;
drop table if exists public.reports cascade;
drop table if exists public.profiles cascade;

-- -----------------------------------------------------------------------------
-- 6. Drop functions
-- -----------------------------------------------------------------------------
drop function if exists public.ensure_user_profile();
drop function if exists public.get_login_email(text);
drop function if exists public.check_profile_available(text, text, text);
drop function if exists public.handle_new_user();
drop function if exists public.is_admin();
drop function if exists public.check_weekly_report_limit();

-- -----------------------------------------------------------------------------
-- 7. Clear uploaded images (keeps bucket; re-created by 003_storage.sql)
-- -----------------------------------------------------------------------------
delete from storage.objects where bucket_id = 'report-images';

-- Optional: remove the bucket entirely (uncomment if you want a full storage reset)
-- delete from storage.buckets where id = 'report-images';

-- -----------------------------------------------------------------------------
-- 8. OPTIONAL — Remove all auth users (full account wipe)
-- -----------------------------------------------------------------------------
-- Uncomment the block below ONLY if you also want to delete login accounts.
-- After this, no one can sign in until they register again.
--
-- delete from auth.users;
--
-- =============================================================================
-- Done. Re-run migrations in order: 001 → 002 → 003 → 004 → 005 → 006 → 007 → 008 → 009
-- =============================================================================
