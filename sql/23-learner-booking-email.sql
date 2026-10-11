-- ===========================================================================
-- 23. Tell the learner too
--
-- A booking request has always emailed the instructor and nobody else. The
-- person who made the request — who picked a time, typed a pick-up address
-- and is now waiting — got a screen that said it worked and then silence,
-- with nothing in writing to check the night before.
--
-- Same moment, same row, one more call. The two notifications are separate
-- on purpose: they go to different people, say different things, and link
-- to different portals, and a single email addressed to both would be
-- wrong for each.
--
-- notify_async swallows its own failures (sql/19), so a learner's email
-- failing cannot stop the instructor's, and neither can fail the booking.
-- ===========================================================================

create or replace function public.notify_on_booking()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'requested' then
    -- The instructor: somebody is waiting on you.
    perform public.notify_async('booking', new.id);
    -- The learner: your request is in, here is what you asked for.
    perform public.notify_async('booking_learner', new.id);
  end if;
  return null;   -- AFTER trigger; the return is ignored
end $$;

-- The trigger itself is unchanged and still attached from sql/19; only the
-- function body it calls is replaced. Stated because a migration that
-- looks like it does nothing is the kind that gets "helpfully" re-run with
-- a create trigger added, and then every booking emails twice.
