-- ===========================================================================
-- LIVE NOTIFICATIONS, WITHOUT A SERVER
--
-- Until now the portal learned about a new booking by asking every two
-- minutes. An instructor watching the screen while a learner books could sit
-- there for 119 seconds looking at a stale number.
--
-- Supabase Realtime streams Postgres changes straight to the browser over a
-- websocket. No Edge Function, no polling, no keys to obtain — the rows
-- already exist and the client is already authenticated. This file just says
-- which tables are worth listening to.
--
-- WHAT THIS IS NOT
--
-- It is not a push notification. Nothing here reaches a phone with the app
-- closed; a websocket only exists while a page is open. That still needs a
-- service worker and VAPID keys, and it is still not built. What this does
-- is make the app live WHILE IT IS OPEN, which is a different and smaller
-- promise — said in those words on screen rather than implied.
--
-- ROW-LEVEL SECURITY STILL APPLIES
--
-- Realtime checks the same policies as an ordinary select, per subscriber,
-- on every change. An instructor is streamed their own bookings because
-- bookings_mine_select lets them read their own bookings, and for no other
-- reason. Adding a table here grants nothing; it only makes what somebody
-- could already read arrive sooner.
--
-- REPLICA IDENTITY
--
-- Postgres sends only the primary key of a deleted or updated row unless the
-- table is told otherwise. The filters below are on instructor_id, which is
-- not the primary key — so without `replica identity full` a subscriber
-- cannot tell whether a change was theirs, and Realtime drops it. This is
-- the thing that silently makes a correct-looking subscription receive
-- nothing.
--
-- Needs sql/09, sql/12 and sql/13. Safe to run twice.
-- ===========================================================================

do $$
begin
  if to_regclass('public.booking_messages') is null then
    raise exception 'Run sql/13-reviews-and-messages.sql before this file.';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 1. The publication Realtime reads
--
-- Created if the project has not got one. On Supabase it already exists, so
-- this is for a self-hosted Postgres and for the test harness.
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 2. The three tables worth listening to
--
-- A booking request, a message, an enquiry. Each one is somebody waiting at
-- the other end, which is exactly the set the bell already counts.
--
-- Lessons are deliberately absent: an instructor's own calendar changes
-- because they changed it, and streaming your own writes back to yourself is
-- noise.
-- ---------------------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array['bookings', 'booking_messages', 'instructor_enquiries'] loop
    -- `add table` throws if it is already in the publication, and this file
    -- has to be re-runnable.
    if not exists (
      select 1 from pg_publication_tables
       where pubname = 'supabase_realtime'
         and schemaname = 'public'
         and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
      raise notice 'Realtime now streams public.%', t;
    end if;

    -- See the note at the top: without this, a filter on anything but the
    -- primary key silently receives nothing.
    execute format('alter table public.%I replica identity full', t);
  end loop;
end $$;
