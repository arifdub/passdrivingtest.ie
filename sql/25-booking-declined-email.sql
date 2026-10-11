-- ===========================================================================
-- 25. "Not this time" — telling the learner when it is a no
--
-- sql/23 promises a learner that an answer is coming. sql/24 delivers it
-- when the answer is yes. When it is no, nothing was sent at all: the
-- request simply stopped existing, and the learner was left holding an
-- email saying "the hour is held for you" about an hour that is not.
--
-- A no is worse to not hear than a yes. Somebody who is told promptly
-- books another slot the same evening; somebody who hears nothing assumes
-- it is still pending and waits.
--
-- DECLINED ONLY, AND WHY NOT CANCELLED
--
-- decline_booking is the instructor refusing a request, so the learner is
-- always the person who needs telling. cancel_booking can be called by
-- EITHER party (sql/12), and the row does not record which — so an email
-- on cancellation would, half the time, tell a learner about a
-- cancellation they themselves just made.
--
-- Fixing that needs a cancelled_by column, which is a schema change and a
-- separate decision. Left undone and stated here rather than guessed at.
-- ===========================================================================

create or replace function public.notify_on_booking_declined()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform public.notify_async('booking_declined', new.id);
  return null;   -- AFTER trigger; the return is ignored
end $$;

revoke all on function public.notify_on_booking_declined() from public, anon, authenticated;

drop trigger if exists bookings_declined_notify on public.bookings;

create trigger bookings_declined_notify
  after update of status on public.bookings
  for each row
  -- The transition, as in sql/24. `is distinct from` because a null old
  -- status makes <> null, null is not true, and the email would silently
  -- never send.
  when (new.status = 'declined' and old.status is distinct from 'declined')
  execute function public.notify_on_booking_declined();
