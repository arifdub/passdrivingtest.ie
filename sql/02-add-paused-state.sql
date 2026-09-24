-- ===========================================================================
-- PAUSED ATTEMPT SYNC
--
-- A quiz or mock paused mid-attempt (which question, what's been picked so
-- far, how much time was on the clock) was previously kept in localStorage
-- only. That meant "continue where you left off" worked on the same phone
-- and browser, but not after signing in on another device, and not after
-- deleting and reinstalling the app on the same one.
--
-- This adds one nullable jsonb column to the existing `progress` table, so
-- a paused attempt rides along with everything else that already syncs on
-- that row (best score, attempts, answered question ids). No new table, no
-- new RLS policy needed — the existing per-row policy on `progress` already
-- covers it.
--
-- Safe to run twice.
-- ===========================================================================

alter table public.progress
  add column if not exists paused jsonb;
