-- =============================================================================
-- Migration 016: Add 'claimed' to reports.status and 'completed' to claims.status
-- Run in Supabase SQL Editor ONCE.
-- =============================================================================
-- This introduces a two-step resolution flow:
--   pending  →  claimed  (admin tags the match, connects parties)
--   claimed  →  resolved (admin confirms physical handover)
-- For claims:
--   approved →  completed (physical handover confirmed)
-- =============================================================================

-- Drop existing check constraints so we can widen them.
-- (PostgreSQL requires DROP + ADD to change a check constraint.)

alter table public.reports
  drop constraint if exists reports_status_check;

alter table public.reports
  add constraint reports_status_check
    check (status in ('pending', 'claimed', 'resolved'));

alter table public.claims
  drop constraint if exists claims_status_check;

alter table public.claims
  add constraint claims_status_check
    check (status in ('auto-approved', 'pending-review', 'approved', 'denied', 'completed'));
