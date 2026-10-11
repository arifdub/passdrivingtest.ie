-- ===========================================================================
-- 24. "Your booking is confirmed"
--
-- sql/23 tells the learner their request is in and that a confirmation
-- follows. This is the confirmation. Without it that sentence is a promise
-- the system does not keep, and the learner is left refreshing an app to
-- find out whether they have a lesson on Tuesday.
--
-- WHY A SEPARATE TRIGGER
--
-- sql/19's trigger is AFTER INSERT. An acceptance is an UPDATE, so it was
-- never going to see it. This adds one, and it fires on the TRANSITION
-- rather than on the state: the WHEN clause requires the row to have not
-- been accepted a moment ago. Without that, every later edit of an
-- accepted booking — a pick-up corrected, a note added — would send
-- another confirmation.
--
-- Still nothing to the instructor. They are the one who tapped accept; an
-- email telling them what they just did is the kind of notification people
-- set up a filter for, and then miss the ones that matter.
-- ===========================================================================

create or replace function public.notify_on_booking_accepted()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform public.notify_async('booking_accepted', new.id);
  return null;   -- AFTER trigger; the return is ignored
end $$;

revoke all on function public.notify_on_booking_accepted() from public, anon, authenticated;

drop trigger if exists bookings_accepted_notify on public.bookings;

create trigger bookings_accepted_notify
  after update of status on public.bookings
  for each row
  -- The transition, not the state. `is distinct from` rather than <>
  -- because a null old status would make <> null, and null is not true,
  -- and the confirmation would silently never send.
  when (new.status = 'accepted' and old.status is distinct from 'accepted')
  execute function public.notify_on_booking_accepted();
