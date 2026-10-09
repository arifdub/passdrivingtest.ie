-- ===========================================================================
-- "I READ IT" AND "IT IS DONE" ARE NOT THE SAME THING
--
-- THE BUG
--
-- The bell's number never went away. You opened it, read what was there,
-- closed it, and the badge still said 3 — for ever, until the work itself
-- was finished.
--
-- That is because my_waiting() counts OUTSTANDING WORK: booking requests not
-- yet answered, enquiries not yet replied to, messages not yet read. Those
-- are the right things to count, and a badge over them is genuinely useful —
-- but they are not notifications. A notification is "something happened
-- since you last looked", and it is supposed to clear when you look.
--
-- One number was doing both jobs and could only ever do one of them.
--
-- SO THERE ARE TWO NUMBERS NOW
--
--   The bell          — what has arrived since you last opened it. Clears
--                       the moment you open it, because that is what looking
--                       at something means.
--
--   The tab badges    — what is still outstanding. Bookings clears when you
--                       accept or decline; Messages clears when you read the
--                       thread. Those SHOULD survive being looked at: a
--                       request you glanced at and did not answer is still a
--                       person waiting at the other end.
--
-- WHY A TIMESTAMP AND NOT A NOTIFICATIONS TABLE
--
-- A row written when something happens is a second copy of a fact the
-- database already holds, and the first time one fails to be written the
-- badge is wrong for ever. One timestamp per person, compared against the
-- created_at that is already there, cannot drift from the thing it
-- describes.
--
-- Needs sql/12 and sql/13. Safe to run twice.
-- ===========================================================================

do $$
begin
  if to_regprocedure('public.my_waiting()') is null then
    raise exception 'Run sql/13-reviews-and-messages.sql before this file.';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 1. When this person last looked
--
-- Null means never, which must count everything rather than nothing — a new
-- instructor with three enquiries waiting should see a 3, not a clean bell.
-- ---------------------------------------------------------------------------
alter table public.profiles
  add column if not exists notifications_seen_at timestamptz;

-- ---------------------------------------------------------------------------
-- 2. Looking at it
--
-- A function rather than a plain update so the client cannot set it to a
-- time in the future and silence the bell permanently, by accident or
-- otherwise. now() is the only value it can ever take.
-- ---------------------------------------------------------------------------
create or replace function public.mark_notifications_seen()
returns timestamptz
language plpgsql
security definer
set search_path = public
as $$
declare
  v_at timestamptz := now();
begin
  if auth.uid() is null then
    raise exception 'not signed in' using errcode = 'insufficient_privilege';
  end if;

  update public.profiles
     set notifications_seen_at = v_at
   where id = auth.uid();

  return v_at;
end $$;

revoke all on function public.mark_notifications_seen() from public, anon;
grant execute on function public.mark_notifications_seen() to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Both numbers, in one call
--
-- The four outstanding counts are unchanged — the tab badges and the panel
-- still read them. `unseen` is the new one, and it is the only thing the
-- bell shows.
--
-- Dropped first: OUT parameters are the return type and `create or replace`
-- may not change one. Same reason as every other time.
-- ---------------------------------------------------------------------------
drop function if exists public.my_waiting();

create function public.my_waiting()
returns table (
  booking_requests bigint,
  new_enquiries    bigint,
  unread_messages  bigint,
  lessons_today    bigint,
  unseen           bigint
)
language sql
stable
security definer
set search_path = public
as $$
  with seen as (
    -- 'epoch' is 1970, so a person who has never opened the bell counts
    -- everything. Coalescing to now() would count nothing and hide a
    -- genuine backlog behind a clean bell.
    select coalesce(
      (select notifications_seen_at from public.profiles where id = auth.uid()),
      'epoch'::timestamptz
    ) as at
  )
  select
    (select count(*) from public.bookings
      where instructor_id = auth.uid() and status = 'requested' and starts_at >= now()),
    (select count(*) from public.instructor_enquiries
      where instructor_id = auth.uid() and status = 'new'),
    (select count(*) from public.booking_messages m
      join public.bookings b on b.id = m.booking_id
     where auth.uid() in (b.instructor_id, b.learner_id)
       and m.sender_id <> auth.uid()
       and m.read_at is null
       and b.status in ('requested', 'accepted')),
    (select count(*) from public.lessons
      where instructor_id = auth.uid()
        and status = 'scheduled'
        and starts_at >= date_trunc('day', now() at time zone 'Europe/Dublin') at time zone 'Europe/Dublin'
        and starts_at <  (date_trunc('day', now() at time zone 'Europe/Dublin') + interval '1 day') at time zone 'Europe/Dublin'),

    -- Arrived since the last look. Counted from created_at, which is already
    -- there on all three tables, so this cannot disagree with the thing it
    -- is describing.
    (
      (select count(*) from public.bookings cross join seen
        where instructor_id = auth.uid()
          and status = 'requested'
          and created_at > seen.at)
      +
      (select count(*) from public.instructor_enquiries cross join seen
        where instructor_id = auth.uid()
          and status = 'new'
          and created_at > seen.at)
      +
      (select count(*) from public.booking_messages m
        join public.bookings b on b.id = m.booking_id
        cross join seen
       where auth.uid() in (b.instructor_id, b.learner_id)
         and m.sender_id <> auth.uid()
         and m.read_at is null
         and b.status in ('requested', 'accepted')
         and m.created_at > seen.at)
    )
  where auth.uid() is not null;
$$;

revoke all on function public.my_waiting() from public, anon;
grant execute on function public.my_waiting() to authenticated;
