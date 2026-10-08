-- ===========================================================================
-- BOOKING A LESSON
--
-- The piece every screen so far has stopped short of, and the reason it
-- stopped: two learners must not be able to take the same 11:00, and nothing
-- running in a browser can promise that. Both tabs read "free", both write,
-- and the instructor finds out at a kerb.
--
-- I SAID THIS NEEDED AN EDGE FUNCTION. IT DOES NOT.
--
-- Every screen in this product has said booking was waiting on a server-side
-- function. That was the right instinct aimed at the wrong box. The thing
-- actually needed is a transaction, and Postgres is a transaction engine —
-- an Edge Function would only be a slower way of reaching the same database
-- and would still need the constraint below to be correct.
--
-- So the guarantee is in two places, deliberately:
--
--   1. An EXCLUSION CONSTRAINT. Two live bookings for one instructor may not
--      overlap in time. This is not a check the application performs; it is
--      a thing the database cannot represent. Concurrent transactions, a
--      direct PostgREST call, a bug in this file — none of them can get past
--      it, because the second writer is refused at commit.
--
--   2. A SECURITY DEFINER FUNCTION that checks everything else — the hours,
--      the time off, the notice, the horizon, the travel buffer, existing
--      lessons — and turns a refusal into a sentence a person can read.
--
-- The constraint is the guarantee. The function is the manners. If they ever
-- disagree the constraint wins, which is the correct way round.
--
-- WHY A BOOKING IS NOT A LESSON
--
-- A lesson (sql/10) is the instructor's own record: it exists because they
-- say it does. A booking is a request from someone else, which can be
-- declined. Folding them into one table would mean every lesson carries a
-- status it does not have and every count has to remember to filter.
--
-- Accepting a booking CREATES the lesson, and links the two. That is the
-- moment a request becomes a thing in the instructor's day.
--
-- Needs sql/04, sql/06, sql/10 and sql/11. Safe to run twice.
-- ===========================================================================

do $$
begin
  if to_regclass('public.lessons') is null then
    raise exception 'Run sql/10-students-and-lessons.sql before this file.';
  end if;
  if to_regclass('public.instructor_hours') is null then
    raise exception 'Run sql/11-availability.sql before this file.';
  end if;
end $$;

-- Needed for the exclusion constraint below: it mixes an equality test on a
-- uuid with an overlap test on a range, and plain gist cannot index the uuid.
create extension if not exists btree_gist;

-- ---------------------------------------------------------------------------
-- 1. The table
-- ---------------------------------------------------------------------------
create table if not exists public.bookings (
  id uuid primary key default gen_random_uuid(),

  instructor_id uuid not null references auth.users (id) on delete cascade,
  learner_id    uuid not null references auth.users (id) on delete cascade,

  -- Set when the instructor accepts: the student row this learner became,
  -- and the lesson that now sits in the calendar.
  student_id uuid references public.instructor_students (id) on delete set null,
  lesson_id  uuid references public.lessons (id) on delete set null,

  starts_at        timestamptz not null,
  duration_minutes int not null default 60,
  kind             text not null default 'lesson',

  status text not null default 'requested',
  -- Why it was declined or cancelled, in the words of whoever did it.
  resolution_note text,
  resolved_at     timestamptz,

  -- Copied from the instructor's rate at the moment of the request, because
  -- a price that moves after someone agrees to it is not a price.
  price_cents int,

  pickup text,
  note   text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'bookings_status_check') then
    alter table public.bookings add constraint bookings_status_check
      check (status in ('requested', 'accepted', 'declined', 'cancelled', 'expired'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'bookings_duration_check') then
    alter table public.bookings add constraint bookings_duration_check
      check (duration_minutes between 30 and 300);
  end if;
end $$;

create index if not exists bookings_instructor_idx on public.bookings (instructor_id, starts_at);
create index if not exists bookings_learner_idx    on public.bookings (learner_id, starts_at);
create index if not exists bookings_status_idx     on public.bookings (status, starts_at);

drop trigger if exists bookings_touch on public.bookings;
create trigger bookings_touch
  before update on public.bookings
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- 2. THE GUARANTEE
--
-- One instructor cannot hold two live bookings that overlap in time. Only
-- 'requested' and 'accepted' count as live: a declined or cancelled booking
-- releases its hour, which is the whole point of declining one.
--
-- Written as a constraint rather than a check inside the function because a
-- function can be bypassed and a constraint cannot. Two transactions that
-- both pass every test in the function will still have one of them refused
-- here, and that refusal is what makes the slot list honest.
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'bookings_no_overlap') then
    alter table public.bookings
      add constraint bookings_no_overlap
      exclude using gist (
        instructor_id with =,
        tstzrange(starts_at, starts_at + (duration_minutes || ' minutes')::interval) with &&
      )
      where (status in ('requested', 'accepted'));
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 3. Who may see what
--
-- The two people involved, and an admin. A booking holds a learner's name,
-- their pickup address and when they will be standing at it; that is not
-- marketplace data and it is not public in any form.
-- ---------------------------------------------------------------------------
alter table public.bookings enable row level security;

drop policy if exists bookings_mine_select on public.bookings;
create policy bookings_mine_select on public.bookings
  for select using (learner_id = auth.uid() or instructor_id = auth.uid());

-- Nobody writes this table directly. Every change goes through one of the
-- functions below, which is what keeps the rules in one place. There is
-- deliberately no insert or update policy for the client.
drop policy if exists bookings_admin_all on public.bookings;
create policy bookings_admin_all on public.bookings
  for all using (public.is_platform_admin())
  with check (public.is_platform_admin());

-- ---------------------------------------------------------------------------
-- 4. Requesting one
--
-- Everything a slot has to satisfy, in the order that gives the most useful
-- refusal. The caller is always the learner — auth.uid() — so there is no
-- way to book on someone else's behalf.
-- ---------------------------------------------------------------------------
create or replace function public.request_booking(
  p_instructor uuid,
  p_starts_at  timestamptz,
  p_kind       text default 'lesson',
  p_pickup     text default null,
  p_note       text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_learner  uuid := auth.uid();
  v_rules    public.instructor_booking_rules%rowtype;
  v_profile  public.instructor_profiles%rowtype;
  v_local    timestamp;
  v_end      timestamptz;
  v_minutes  int;
  v_buffer   int;
  v_price    int;
  v_id       uuid;
begin
  if v_learner is null then
    raise exception 'Sign in to book a lesson' using errcode = 'insufficient_privilege';
  end if;

  if v_learner = p_instructor then
    raise exception 'You cannot book yourself' using errcode = 'check_violation';
  end if;

  select * into v_profile from public.instructor_profiles where user_id = p_instructor;
  if not found or v_profile.verification_status <> 'verified' or not v_profile.listed then
    raise exception 'That instructor is not taking bookings' using errcode = 'check_violation';
  end if;

  select * into v_rules from public.instructor_booking_rules where instructor_id = p_instructor;
  if not found then
    -- sql/11 backfills a row for everyone with a profile, but an instructor
    -- created between the two is not the learner's problem.
    insert into public.instructor_booking_rules (instructor_id) values (p_instructor)
      returning * into v_rules;
  end if;

  if not v_rules.accepting then
    raise exception 'That instructor has paused new bookings' using errcode = 'check_violation';
  end if;

  v_minutes := v_rules.lesson_minutes;
  v_buffer  := v_rules.travel_buffer_minutes;
  v_end     := p_starts_at + (v_minutes || ' minutes')::interval;

  -- Notice and horizon, against the instructor's terms.
  if p_starts_at < now() + (v_rules.min_notice_hours || ' hours')::interval then
    raise exception 'That is sooner than % hours'' notice', v_rules.min_notice_hours
      using errcode = 'check_violation';
  end if;

  if p_starts_at > now() + (v_rules.max_days_ahead || ' days')::interval then
    raise exception 'That instructor only takes bookings % days ahead', v_rules.max_days_ahead
      using errcode = 'check_violation';
  end if;

  -- Everything below is about the instructor's own local day, so the instant
  -- is converted once, here, and the pieces read off it.
  v_local := p_starts_at at time zone 'Europe/Dublin';

  if exists (
    select 1 from public.instructor_time_off t
     where t.instructor_id = p_instructor
       and v_local::date between t.starts_on and t.ends_on
  ) then
    raise exception 'That instructor is off that day' using errcode = 'check_violation';
  end if;

  -- The whole lesson has to sit inside one block of working hours. Spanning
  -- two blocks would mean driving through the lunch break between them.
  -- Minutes from midnight, not times. Casting `23:30 + 1 hour` back to a
  -- time gives 00:30, which compares as earlier than every end time and
  -- would wave a midnight booking through a nine-to-five day.
  if not exists (
    select 1 from public.instructor_hours h
     where h.instructor_id = p_instructor
       and h.weekday = extract(dow from v_local)
       and extract(epoch from h.starts_at) / 60 <= extract(epoch from v_local::time) / 60
       and extract(epoch from h.ends_at)   / 60 >= extract(epoch from v_local::time) / 60 + v_minutes
  ) then
    raise exception 'That is outside their working hours' using errcode = 'check_violation';
  end if;

  -- Serialise every request for this instructor for the rest of the
  -- transaction. Without it two callers interleave between the checks below
  -- and the insert; with it the second one waits, re-reads, and is refused
  -- properly instead of racing. The exclusion constraint would catch the
  -- booking-against-booking case anyway, but not booking-against-lesson,
  -- which lives in another table.
  perform pg_advisory_xact_lock(hashtextextended(p_instructor::text, 0));

  -- Against the instructor's own calendar, buffer included on both sides.
  if exists (
    select 1 from public.lessons l
     where l.instructor_id = p_instructor
       and l.status <> 'cancelled'
       and tstzrange(
             l.starts_at - (v_buffer || ' minutes')::interval,
             l.starts_at + ((l.duration_minutes + v_buffer) || ' minutes')::interval
           ) && tstzrange(p_starts_at, v_end)
  ) then
    raise exception 'That time is already taken' using errcode = 'check_violation';
  end if;

  -- And against other live requests, buffer included. The constraint covers
  -- the bare overlap; this covers the buffer around it, and says so in words.
  if exists (
    select 1 from public.bookings b
     where b.instructor_id = p_instructor
       and b.status in ('requested', 'accepted')
       and tstzrange(
             b.starts_at - (v_buffer || ' minutes')::interval,
             b.starts_at + ((b.duration_minutes + v_buffer) || ' minutes')::interval
           ) && tstzrange(p_starts_at, v_end)
  ) then
    raise exception 'That time is already taken' using errcode = 'check_violation';
  end if;

  -- One open request per learner per instructor at a time, so a misfiring
  -- button cannot fill someone's inbox.
  if exists (
    select 1 from public.bookings b
     where b.instructor_id = p_instructor
       and b.learner_id = v_learner
       and b.status = 'requested'
       and b.starts_at = p_starts_at
  ) then
    raise exception 'You have already asked for that time' using errcode = 'unique_violation';
  end if;

  v_price := case when p_kind = 'edt'
                  then coalesce(v_profile.edt_rate_cents, v_profile.hourly_rate_cents)
                  else v_profile.hourly_rate_cents end;

  insert into public.bookings (
    instructor_id, learner_id, starts_at, duration_minutes, kind,
    price_cents, pickup, note
  ) values (
    p_instructor, v_learner, p_starts_at, v_minutes, coalesce(p_kind, 'lesson'),
    v_price, nullif(trim(p_pickup), ''), nullif(trim(p_note), '')
  )
  returning id into v_id;

  return v_id;
end $$;

revoke all on function public.request_booking(uuid, timestamptz, text, text, text) from public, anon;
grant execute on function public.request_booking(uuid, timestamptz, text, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. Accepting one
--
-- This is where a request becomes a lesson. The learner becomes a student of
-- this instructor if they are not one already — reusing the row rather than
-- creating a second one for the same person, which is how a student list
-- fills up with duplicates.
--
-- Marked 'marketplace' as its source, because that distinction is what the
-- fee rests on: students the instructor already had are free, forever.
-- ---------------------------------------------------------------------------
create or replace function public.accept_booking(p_booking uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_b       public.bookings%rowtype;
  v_student uuid;
  v_lesson  uuid;
  v_name    text;
  v_email   text;
begin
  select * into v_b from public.bookings where id = p_booking for update;
  if not found then
    raise exception 'No such booking' using errcode = 'no_data_found';
  end if;
  if v_b.instructor_id <> auth.uid() then
    raise exception 'That is not your booking' using errcode = 'insufficient_privilege';
  end if;
  if v_b.status <> 'requested' then
    raise exception 'That booking is already %', v_b.status using errcode = 'check_violation';
  end if;

  select u.email, coalesce(p.full_name, split_part(u.email, '@', 1))
    into v_email, v_name
    from auth.users u
    left join public.profiles p on p.id = u.id
   where u.id = v_b.learner_id;

  select id into v_student
    from public.instructor_students
   where instructor_id = v_b.instructor_id and learner_id = v_b.learner_id;

  if v_student is null then
    insert into public.instructor_students (
      instructor_id, learner_id, full_name, email, source
    ) values (
      v_b.instructor_id, v_b.learner_id, coalesce(v_name, 'New student'), v_email, 'marketplace'
    )
    returning id into v_student;
  end if;

  insert into public.lessons (
    instructor_id, student_id, starts_at, duration_minutes, kind, price_cents, pickup, notes
  ) values (
    v_b.instructor_id, v_student, v_b.starts_at, v_b.duration_minutes,
    v_b.kind, v_b.price_cents, v_b.pickup, v_b.note
  )
  returning id into v_lesson;

  update public.bookings
     set status = 'accepted', student_id = v_student, lesson_id = v_lesson,
         resolved_at = now()
   where id = p_booking;

  return v_lesson;
end $$;

revoke all on function public.accept_booking(uuid) from public, anon;
grant execute on function public.accept_booking(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 6. Declining and cancelling
--
-- Declining is the instructor's; cancelling is either side's. Both free the
-- hour immediately — the exclusion constraint only counts live bookings — so
-- a declined slot is offerable again the moment it is declined.
-- ---------------------------------------------------------------------------
create or replace function public.decline_booking(p_booking uuid, p_reason text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_b public.bookings%rowtype;
begin
  select * into v_b from public.bookings where id = p_booking for update;
  if not found then
    raise exception 'No such booking' using errcode = 'no_data_found';
  end if;
  if v_b.instructor_id <> auth.uid() then
    raise exception 'That is not your booking' using errcode = 'insufficient_privilege';
  end if;
  if v_b.status <> 'requested' then
    raise exception 'That booking is already %', v_b.status using errcode = 'check_violation';
  end if;

  update public.bookings
     set status = 'declined', resolution_note = nullif(trim(p_reason), ''), resolved_at = now()
   where id = p_booking;
end $$;

revoke all on function public.decline_booking(uuid, text) from public, anon;
grant execute on function public.decline_booking(uuid, text) to authenticated;

create or replace function public.cancel_booking(p_booking uuid, p_reason text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_b public.bookings%rowtype;
begin
  select * into v_b from public.bookings where id = p_booking for update;
  if not found then
    raise exception 'No such booking' using errcode = 'no_data_found';
  end if;
  if auth.uid() not in (v_b.instructor_id, v_b.learner_id) then
    raise exception 'That is not your booking' using errcode = 'insufficient_privilege';
  end if;
  if v_b.status not in ('requested', 'accepted') then
    raise exception 'That booking is already %', v_b.status using errcode = 'check_violation';
  end if;

  -- An accepted booking has a lesson in the instructor's calendar. Cancelling
  -- the booking has to cancel that too, or the hour stays blocked and the
  -- instructor is left deleting a lesson for someone who already cancelled.
  if v_b.lesson_id is not null then
    update public.lessons set status = 'cancelled' where id = v_b.lesson_id;
  end if;

  update public.bookings
     set status = 'cancelled', resolution_note = nullif(trim(p_reason), ''), resolved_at = now()
   where id = p_booking;
end $$;

revoke all on function public.cancel_booking(uuid, text) from public, anon;
grant execute on function public.cancel_booking(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 7. The slots, decided by the database
--
-- The browser computes a slot list so a learner sees something instantly.
-- This is the same question answered where it counts, and it is what the
-- booking screen reads before it offers anything. The two agreeing is not
-- relied on: request_booking checks again, inside the transaction.
-- ---------------------------------------------------------------------------
create or replace function public.open_slots(
  p_instructor uuid,
  p_from date,
  p_days int default 7
)
returns table (slot timestamptz)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_rules   public.instructor_booking_rules%rowtype;
  v_minutes int;
  v_buffer  int;
begin
  if not exists (
    select 1 from public.instructor_profiles
     where user_id = p_instructor and verification_status = 'verified' and listed = true
  ) then
    return;
  end if;

  select * into v_rules from public.instructor_booking_rules where instructor_id = p_instructor;
  if not found or not v_rules.accepting then
    return;
  end if;

  v_minutes := v_rules.lesson_minutes;
  v_buffer  := v_rules.travel_buffer_minutes;

  return query
  with days as (
    select (p_from + offs)::date as d
      from generate_series(0, greatest(least(p_days, 60), 1) - 1) as offs
  ),
  candidates as (
    select
      days.d                                                          as day,
      (days.d + h.starts_at + (n * interval '30 minutes'))            as local_start,
      h.ends_at
      from days
      join public.instructor_hours h
        on h.instructor_id = p_instructor
       and h.weekday = extract(dow from days.d)
      cross join generate_series(0, 47) as n
     where not exists (
       select 1 from public.instructor_time_off t
        where t.instructor_id = p_instructor
          and days.d between t.starts_on and t.ends_on
     )
  ),
  fitting as (
    select (local_start at time zone 'Europe/Dublin') as at
      from candidates
     -- Compared as minutes from midnight, not as times. A block starting at
     -- 17:00 plus 24 half-hour steps reaches past midnight, and `::time`
     -- wraps there without complaining — 00:30 would read as earlier than
     -- every end time and every slot after midnight would pass. Staying on
     -- the same local day, and comparing plain numbers, has no such edge.
     where local_start::date = day
       and extract(epoch from local_start::time) / 60 + v_minutes
           <= extract(epoch from ends_at) / 60
  )
  select at
    from fitting
   where at >= now() + (v_rules.min_notice_hours || ' hours')::interval
     and at <= now() + (v_rules.max_days_ahead || ' days')::interval
     and not exists (
       select 1 from public.lessons l
        where l.instructor_id = p_instructor
          and l.status <> 'cancelled'
          and tstzrange(
                l.starts_at - (v_buffer || ' minutes')::interval,
                l.starts_at + ((l.duration_minutes + v_buffer) || ' minutes')::interval
              ) && tstzrange(at, at + (v_minutes || ' minutes')::interval)
     )
     and not exists (
       select 1 from public.bookings b
        where b.instructor_id = p_instructor
          and b.status in ('requested', 'accepted')
          and tstzrange(
                b.starts_at - (v_buffer || ' minutes')::interval,
                b.starts_at + ((b.duration_minutes + v_buffer) || ' minutes')::interval
              ) && tstzrange(at, at + (v_minutes || ' minutes')::interval)
     )
   order by at;
end $$;

revoke all on function public.open_slots(uuid, date, int) from public;
grant execute on function public.open_slots(uuid, date, int) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 8. The dashboard count
--
-- Replaces sql/10's version, adding pending booking requests. Dropped first
-- for the same reason as every other time: OUT parameters are the return
-- type and `create or replace` may not change one.
-- ---------------------------------------------------------------------------
drop function if exists public.instructor_stats();

create function public.instructor_stats()
returns table (
  new_enquiries   bigint,
  open_enquiries  bigint,
  active_students bigint,
  lessons_today   bigint,
  lessons_week    bigint,
  booking_requests bigint
)
language sql
stable
security definer
set search_path = public
as $$
  select
    (select count(*) from public.instructor_enquiries
      where instructor_id = auth.uid() and status = 'new'),
    (select count(*) from public.instructor_enquiries
      where instructor_id = auth.uid() and status in ('new', 'answered')),
    (select count(*) from public.instructor_students
      where instructor_id = auth.uid() and status = 'active'),
    (select count(*) from public.lessons
      where instructor_id = auth.uid()
        and status = 'scheduled'
        and starts_at >= date_trunc('day', now() at time zone 'Europe/Dublin') at time zone 'Europe/Dublin'
        and starts_at <  (date_trunc('day', now() at time zone 'Europe/Dublin') + interval '1 day') at time zone 'Europe/Dublin'),
    (select count(*) from public.lessons
      where instructor_id = auth.uid()
        and status = 'scheduled'
        and starts_at >= now()
        and starts_at <  now() + interval '7 days'),
    (select count(*) from public.bookings
      where instructor_id = auth.uid()
        and status = 'requested'
        and starts_at >= now())
  where auth.uid() is not null;
$$;

revoke all on function public.instructor_stats() from public, anon;
grant execute on function public.instructor_stats() to authenticated;
