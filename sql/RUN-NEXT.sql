-- ===========================================================================
-- PASSDRIVINGTEST.IE — THE TWO FILES STILL TO RUN
--
-- sql/04 to sql/11 are already in. This is sql/12 to sql/15, in order,
-- pasting in one go:
--
--   https://supabase.com/dashboard/project/zwwtmvolghcoopicznwa/sql/new
--
-- WHAT WENT WRONG LAST TIME, AND WHAT CHANGES HERE
--
-- The run stopped with:
--
--   ERROR: 42703: column "status" does not exist
--   CONTEXT: alter table public.bookings add constraint bookings_status_check
--
-- A table called `bookings` already existed in this database and was not the
-- one sql/12 describes. `create table if not exists` does not compare shapes
-- — it saw the name was taken, did nothing, and said nothing, so the first
-- statement to touch a missing column was the one that failed, long after
-- the actual problem.
--
-- sql/12 now checks the name before building on it. If that other table is
-- empty it is replaced, since nothing can be lost from a table with no rows.
-- If it has rows in it the run stops and tells you exactly what to look at,
-- because dropping somebody's data to make a migration pass is never the
-- right trade.
--
-- The whole paste runs as one transaction: if any part fails, nothing is
-- applied and the database is left exactly as it was.
--
-- Both parts are safe to run twice.
-- ===========================================================================


-- ###########################################################################
-- ### 12 — BOOKINGS
-- ###########################################################################
--
-- A learner picks one of the instructor's open hours and asks for it. Two of
-- them cannot get the same one: an exclusion constraint makes an overlap
-- something the database is unable to store, and a security definer function
-- checks the hours, the time off, the notice, the buffer and the calendar
-- inside the same transaction. Nothing writes this table from the browser.

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
-- 0. A table called `bookings` that is not this one
--
-- `create table if not exists` is silent when the name is taken. It does not
-- check that the existing table is the one described below — it just does
-- nothing and lets the next statement fail, which is what happened here:
--
--   ERROR: 42703: column "status" does not exist
--   CONTEXT: alter table public.bookings add constraint bookings_status_check
--
-- Something else in this database already owned the name. The constraint was
-- the first statement to notice, three hundred lines after the real problem,
-- and the message said nothing about it.
--
-- So the name is checked properly before anything is built on it.
--
--   Empty and the wrong shape  -> dropped and rebuilt. Nothing can be lost
--                                 from a table with no rows in it.
--   Has rows and the wrong shape -> stop, and say exactly what to look at.
--                                 Dropping somebody's data to make a
--                                 migration pass is never the right trade,
--                                 and quietly bolting our columns onto their
--                                 table would be worse: two meanings of
--                                 "booking" sharing one row.
-- ---------------------------------------------------------------------------
do $$
declare
  v_rows bigint;
  v_ours int;
begin
  if to_regclass('public.bookings') is null then
    return;                       -- nothing there; the create below does it all
  end if;

  select count(*) into v_ours
    from information_schema.columns
   where table_schema = 'public' and table_name = 'bookings'
     and column_name in ('instructor_id', 'learner_id', 'starts_at', 'status');

  if v_ours = 4 then
    return;                       -- already ours, from an earlier run
  end if;

  execute 'select count(*) from public.bookings' into v_rows;

  if v_rows = 0 then
    raise notice
      'A different, empty table called public.bookings was in the way. Replacing it.';
    execute 'drop table public.bookings cascade';
    return;
  end if;

  raise exception
    'public.bookings already exists, holds % row(s), and is not the table this file builds. '
    'Nothing has been changed. Look at what it is:  '
    'select column_name, data_type from information_schema.columns '
    'where table_schema = ''public'' and table_name = ''bookings'' order by ordinal_position;  '
    'If it is not needed, drop it and run this file again. If it is, rename it first '
    '(alter table public.bookings rename to bookings_old;) and move the data across by hand.',
    v_rows;
end $$;

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
  -- Stored, not computed on the fly. The exclusion constraint below has to
  -- index this range, and an index expression must be IMMUTABLE: adding an
  -- interval to a timestamptz is only STABLE, because how many hours a day
  -- contains depends on the session's timezone. So the end is worked out
  -- once by a trigger and kept, and the constraint indexes two plain
  -- columns, which is immutable. Postgres refuses the alternative outright:
  --   ERROR: functions in index expression must be marked IMMUTABLE
  ends_at          timestamptz,
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

-- ends_at is derived, never sent. Keeping it in one place means it cannot
-- disagree with the start and duration it comes from.
create or replace function public.set_booking_end()
returns trigger
language plpgsql
as $$
begin
  new.ends_at := new.starts_at + make_interval(mins => new.duration_minutes);
  return new;
end $$;

drop trigger if exists bookings_set_end on public.bookings;
create trigger bookings_set_end
  before insert or update of starts_at, duration_minutes on public.bookings
  for each row execute function public.set_booking_end();

-- Backfill, for a table created before this column existed.
update public.bookings
   set ends_at = starts_at + make_interval(mins => duration_minutes)
 where ends_at is null;

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
        tstzrange(starts_at, ends_at) with &&
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


-- ###########################################################################
-- ### 13 — REVIEWS AND MESSAGES
-- ###########################################################################
--
-- A review may only be written by someone who completed a lesson with that
-- instructor, enforced by a trigger rather than by the app. An instructor may
-- reply once and may not edit. No average is published until there are enough
-- reviews for one to mean anything. Messages hang off a booking, so there is
-- no inbox to spam and no way to contact a stranger.

-- ---------------------------------------------------------------------------
-- 1. Reviews
-- ---------------------------------------------------------------------------
create table if not exists public.instructor_reviews (
  id uuid primary key default gen_random_uuid(),

  instructor_id uuid not null references auth.users (id) on delete cascade,
  learner_id    uuid not null references auth.users (id) on delete cascade,

  rating smallint not null,
  body   text,

  -- The instructor's single reply, and when they left it.
  reply      text,
  replied_at timestamptz,

  -- An admin can hide a review without deleting it, so there is a record of
  -- what was hidden and when. Hidden reviews leave the average.
  hidden boolean not null default false,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (instructor_id, learner_id)
);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'instructor_reviews_rating_check') then
    alter table public.instructor_reviews
      add constraint instructor_reviews_rating_check check (rating between 1 and 5);
  end if;
end $$;

create index if not exists instructor_reviews_subject_idx
  on public.instructor_reviews (instructor_id, hidden, created_at desc);

drop trigger if exists instructor_reviews_touch on public.instructor_reviews;
create trigger instructor_reviews_touch
  before update on public.instructor_reviews
  for each row execute function public.touch_updated_at();

-- Did this learner actually complete a lesson with this instructor? The only
-- question that decides whether a review may exist.
create or replace function public.has_completed_lesson(p_instructor uuid, p_learner uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
      from public.lessons l
      join public.instructor_students s on s.id = l.student_id
     where l.instructor_id = p_instructor
       and s.learner_id = p_learner
       and l.status = 'completed'
  );
$$;

grant execute on function public.has_completed_lesson(uuid, uuid) to authenticated;

create or replace function public.enforce_review()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if coalesce(auth.role(), 'service_role') = 'service_role' then
    return new;
  end if;

  if public.is_platform_admin() then
    -- An admin may hide a review and nothing else. Not edit it, not rewrite
    -- a rating: moderation is removal, never alteration.
    if TG_OP = 'UPDATE' and (
         new.rating is distinct from old.rating
      or new.body   is distinct from old.body
      or new.reply  is distinct from old.reply
    ) then
      raise exception 'a review can be hidden but not edited'
        using errcode = 'insufficient_privilege';
    end if;
    return new;
  end if;

  -- The instructor's one move: adding or changing their own reply.
  if auth.uid() = new.instructor_id then
    if TG_OP <> 'UPDATE' then
      raise exception 'you cannot write a review of yourself'
        using errcode = 'insufficient_privilege';
    end if;
    if new.rating is distinct from old.rating
       or new.body is distinct from old.body
       or new.hidden is distinct from old.hidden
       or new.learner_id is distinct from old.learner_id then
      raise exception 'you can reply to a review, not change it'
        using errcode = 'insufficient_privilege';
    end if;
    new.replied_at := case when new.reply is null then null else now() end;
    return new;
  end if;

  -- Otherwise this is the learner, writing or revising their own.
  if auth.uid() is distinct from new.learner_id then
    raise exception 'you can only review as yourself'
      using errcode = 'insufficient_privilege';
  end if;

  if not public.has_completed_lesson(new.instructor_id, new.learner_id) then
    raise exception 'you can review an instructor after a lesson with them'
      using errcode = 'insufficient_privilege';
  end if;

  if TG_OP = 'UPDATE' then
    -- A learner revising their review must not touch the instructor's reply
    -- or their own hidden flag.
    new.reply      := old.reply;
    new.replied_at := old.replied_at;
    new.hidden     := old.hidden;
  else
    new.reply := null; new.replied_at := null; new.hidden := false;
  end if;

  return new;
end $$;

drop trigger if exists instructor_reviews_enforce on public.instructor_reviews;
create trigger instructor_reviews_enforce
  before insert or update on public.instructor_reviews
  for each row execute function public.enforce_review();

alter table public.instructor_reviews enable row level security;

-- Reviews of a listed instructor are public; that is the point of them.
drop policy if exists reviews_public_select on public.instructor_reviews;
create policy reviews_public_select on public.instructor_reviews
  for select using (
    hidden = false
    and exists (
      select 1 from public.instructor_profiles i
       where i.user_id = instructor_id
         and i.verification_status = 'verified'
         and i.listed = true)
  );

-- A learner always sees their own, listed or not, hidden or not.
drop policy if exists reviews_own_select on public.instructor_reviews;
create policy reviews_own_select on public.instructor_reviews
  for select using (learner_id = auth.uid() or instructor_id = auth.uid());

drop policy if exists reviews_learner_write on public.instructor_reviews;
create policy reviews_learner_write on public.instructor_reviews
  for insert with check (learner_id = auth.uid());

drop policy if exists reviews_update on public.instructor_reviews;
create policy reviews_update on public.instructor_reviews
  for update using (learner_id = auth.uid() or instructor_id = auth.uid() or public.is_platform_admin())
  with check (learner_id = auth.uid() or instructor_id = auth.uid() or public.is_platform_admin());

-- A learner may delete their own review. Nobody else may, instructor least
-- of all.
drop policy if exists reviews_learner_delete on public.instructor_reviews;
create policy reviews_learner_delete on public.instructor_reviews
  for delete using (learner_id = auth.uid() or public.is_platform_admin());

-- The average, always with its count beside it. Never one without the other:
-- "4.9" means something different from "4.9 from 3 lessons", and the second
-- is the truth.
drop view if exists public.instructor_ratings cascade;
create view public.instructor_ratings as
  select
    i.user_id as instructor_id,
    count(r.id)                                   as review_count,
    round(avg(r.rating)::numeric, 2)              as average_rating
  from public.instructor_profiles i
  left join public.instructor_reviews r
    on r.instructor_id = i.user_id and r.hidden = false
 where i.verification_status = 'verified' and i.listed = true
 group by i.user_id;

grant select on public.instructor_ratings to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. Messages
--
-- Hung off a booking, so there is no inbox to be spammed and no way to
-- message a stranger. Both parties are already known to each other through
-- the booking; this just saves a phone number.
-- ---------------------------------------------------------------------------
create table if not exists public.booking_messages (
  id uuid primary key default gen_random_uuid(),

  booking_id uuid not null references public.bookings (id) on delete cascade,
  sender_id  uuid not null references auth.users (id) on delete cascade,

  body text not null,
  read_at timestamptz,

  created_at timestamptz not null default now()
);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'booking_messages_body_check') then
    alter table public.booking_messages
      add constraint booking_messages_body_check
      check (length(btrim(body)) between 1 and 2000);
  end if;
end $$;

create index if not exists booking_messages_thread_idx
  on public.booking_messages (booking_id, created_at);

-- Only the two people on the booking, and only while the booking is live.
-- A declined request is not a channel to keep talking through.
create or replace function public.enforce_message()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_b public.bookings%rowtype;
begin
  if coalesce(auth.role(), 'service_role') = 'service_role' then
    return new;
  end if;

  select * into v_b from public.bookings where id = new.booking_id;
  if not found then
    raise exception 'No such booking' using errcode = 'no_data_found';
  end if;

  if auth.uid() not in (v_b.instructor_id, v_b.learner_id) then
    raise exception 'That is not your booking' using errcode = 'insufficient_privilege';
  end if;
  if new.sender_id <> auth.uid() then
    raise exception 'you can only send as yourself' using errcode = 'insufficient_privilege';
  end if;
  if v_b.status not in ('requested', 'accepted') then
    raise exception 'that booking is closed' using errcode = 'check_violation';
  end if;

  new.read_at := null;
  return new;
end $$;

drop trigger if exists booking_messages_enforce on public.booking_messages;
create trigger booking_messages_enforce
  before insert on public.booking_messages
  for each row execute function public.enforce_message();

alter table public.booking_messages enable row level security;

drop policy if exists messages_party_select on public.booking_messages;
create policy messages_party_select on public.booking_messages
  for select using (
    exists (select 1 from public.bookings b
             where b.id = booking_id
               and auth.uid() in (b.instructor_id, b.learner_id))
  );

drop policy if exists messages_party_insert on public.booking_messages;
create policy messages_party_insert on public.booking_messages
  for insert with check (sender_id = auth.uid());

-- Marking read is the only update, and only the RECIPIENT may do it: a
-- sender marking their own message read would make every unread count wrong.
drop policy if exists messages_mark_read on public.booking_messages;
create policy messages_mark_read on public.booking_messages
  for update using (
    sender_id <> auth.uid()
    and exists (select 1 from public.bookings b
                 where b.id = booking_id
                   and auth.uid() in (b.instructor_id, b.learner_id))
  )
  with check (
    sender_id <> auth.uid()
    and exists (select 1 from public.bookings b
                 where b.id = booking_id
                   and auth.uid() in (b.instructor_id, b.learner_id))
  );

create or replace function public.mark_thread_read(p_booking uuid)
returns void
language sql
security definer
set search_path = public
as $$
  update public.booking_messages m
     set read_at = now()
   where m.booking_id = p_booking
     and m.sender_id <> auth.uid()
     and m.read_at is null
     and exists (select 1 from public.bookings b
                  where b.id = p_booking
                    and auth.uid() in (b.instructor_id, b.learner_id));
$$;

revoke all on function public.mark_thread_read(uuid) from public, anon;
grant execute on function public.mark_thread_read(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Everything waiting on you, in one call
--
-- What a notification badge counts. Deliberately not a notifications TABLE:
-- a row written when something happens is a second copy of a fact the
-- database already holds, and the first time one fails to be written the
-- badge is wrong forever. This asks the real questions every time.
--
-- This is not a push notification. Nothing here reaches a phone that does
-- not have the app open — that needs a service worker, a push subscription
-- and VAPID keys on a server, none of which exist yet.
-- ---------------------------------------------------------------------------
create or replace function public.my_waiting()
returns table (
  booking_requests bigint,
  new_enquiries    bigint,
  unread_messages  bigint,
  lessons_today    bigint
)
language sql
stable
security definer
set search_path = public
as $$
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
        and starts_at <  (date_trunc('day', now() at time zone 'Europe/Dublin') + interval '1 day') at time zone 'Europe/Dublin')
  where auth.uid() is not null;
$$;

revoke all on function public.my_waiting() from public, anon;
grant execute on function public.my_waiting() to authenticated;

-- ###########################################################################
-- ### 14 — EVERY INSTRUCTOR GETS BOOKING RULES
-- ###########################################################################
--
-- A backfill is not a default. sql/11 gave a booking-rules row to every
-- instructor who existed when it ran, and open_slots gave up when the row
-- was missing — so anyone verified afterwards was permanently unbookable,
-- silently. A trigger now creates the row, and open_slots falls back on the
-- declared defaults rather than returning nothing.

-- ---------------------------------------------------------------------------
-- 1. A rules row the moment there is an instructor
-- ---------------------------------------------------------------------------
create or replace function public.ensure_booking_rules()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.instructor_booking_rules (instructor_id)
  values (new.user_id)
  on conflict (instructor_id) do nothing;
  return new;
end $$;

drop trigger if exists instructor_profiles_ensure_rules on public.instructor_profiles;
create trigger instructor_profiles_ensure_rules
  after insert on public.instructor_profiles
  for each row execute function public.ensure_booking_rules();

-- Everyone who slipped through between sql/11 and now.
insert into public.instructor_booking_rules (instructor_id)
select i.user_id
  from public.instructor_profiles i
 where not exists (
   select 1 from public.instructor_booking_rules r where r.instructor_id = i.user_id
 );

-- ---------------------------------------------------------------------------
-- 2. A missing row must not mean invisible
--
-- Identical to sql/12's version except for the opening: no row now means the
-- declared defaults, and only an explicit `accepting = false` stops the
-- slots. Silence is not a refusal.
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
  v_notice  int;
  v_horizon int;
begin
  if not exists (
    select 1 from public.instructor_profiles
     where user_id = p_instructor and verification_status = 'verified' and listed = true
  ) then
    return;
  end if;

  select * into v_rules from public.instructor_booking_rules where instructor_id = p_instructor;

  if found then
    if not v_rules.accepting then
      return;                       -- paused on purpose
    end if;
    v_minutes := v_rules.lesson_minutes;
    v_buffer  := v_rules.travel_buffer_minutes;
    v_notice  := v_rules.min_notice_hours;
    v_horizon := v_rules.max_days_ahead;
  else
    -- The same values the table declares as defaults. An instructor who has
    -- never opened the terms screen is taking bookings on ordinary terms,
    -- not refusing them.
    v_minutes := 60;
    v_buffer  := 15;
    v_notice  := 24;
    v_horizon := 30;
  end if;

  return query
  with days as (
    select (p_from + offs)::date as d
      from generate_series(0, greatest(least(p_days, 60), 1) - 1) as offs
  ),
  candidates as (
    select
      days.d                                                as day,
      (days.d + h.starts_at + (n * interval '30 minutes'))  as local_start,
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
     where local_start::date = day
       and extract(epoch from local_start::time) / 60 + v_minutes
           <= extract(epoch from ends_at) / 60
  )
  select at
    from fitting
   where at >= now() + (v_notice || ' hours')::interval
     and at <= now() + (v_horizon || ' days')::interval
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
-- 3. Tell a learner WHY there is nothing, rather than showing an empty list
--
-- The app could not distinguish "no hours set", "paused", "fully booked" and
-- "not listed at all" — every one of them arrived as an empty array. This
-- says which, so the screen can say something useful instead of a shrug.
-- ---------------------------------------------------------------------------
create or replace function public.booking_availability(p_instructor uuid)
returns table (
  listed        boolean,
  accepting     boolean,
  has_hours     boolean,
  open_count    bigint
)
language sql
stable
security definer
set search_path = public
as $$
  select
    exists (select 1 from public.instructor_profiles
             where user_id = p_instructor
               and verification_status = 'verified' and listed = true),
    coalesce((select r.accepting from public.instructor_booking_rules r
               where r.instructor_id = p_instructor), true),
    exists (select 1 from public.instructor_hours where instructor_id = p_instructor),
    (select count(*) from public.open_slots(p_instructor, current_date, 14));
$$;

revoke all on function public.booking_availability(uuid) from public;
grant execute on function public.booking_availability(uuid) to anon, authenticated;

-- ###########################################################################
-- ### 15 — PROFILE PHOTOS
-- ###########################################################################
--
-- An avatars bucket, and the rule that a person may only write inside a
-- folder named after their own account id. Reads are public: an instructor's
-- photo is on a public directory card, and a photo behind an expiring signed
-- URL is a broken image on a marketplace listing.

-- ---------------------------------------------------------------------------
-- 1. Somewhere for a learner's photo to live
-- ---------------------------------------------------------------------------
alter table public.profiles
  add column if not exists avatar_url text;

-- ---------------------------------------------------------------------------
-- 2. The bucket
--
-- Created through storage's own table so this file is idempotent. The
-- dashboard's "New bucket" button does the same thing.
--
-- 5 MB is generous for an avatar the app downscales to 512px before it
-- uploads; the limit is there to stop a 48-megapixel phone photo being
-- pushed straight up on a bad connection, not to be reached.
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'avatars', 'avatars', true, 5242880,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update
  set public = true,
      file_size_limit = 5242880,
      allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp'];

-- ---------------------------------------------------------------------------
-- 3. Who may do what
--
-- Read: anyone. Write, replace, delete: only inside your own folder.
-- ---------------------------------------------------------------------------
do $$
begin
  -- storage.objects belongs to the storage extension, so these are created
  -- defensively: on a project where the role running this file cannot add a
  -- policy there, the rest of the migration should still apply and the
  -- reason should be legible rather than a bare permission error.
  begin
    drop policy if exists "avatars are publicly readable" on storage.objects;
    create policy "avatars are publicly readable" on storage.objects
      for select using (bucket_id = 'avatars');

    drop policy if exists "a person writes only their own avatar" on storage.objects;
    create policy "a person writes only their own avatar" on storage.objects
      for insert to authenticated
      with check (
        bucket_id = 'avatars'
        and (storage.foldername(name))[1] = auth.uid()::text
      );

    drop policy if exists "a person replaces only their own avatar" on storage.objects;
    create policy "a person replaces only their own avatar" on storage.objects
      for update to authenticated
      using (
        bucket_id = 'avatars'
        and (storage.foldername(name))[1] = auth.uid()::text
      )
      with check (
        bucket_id = 'avatars'
        and (storage.foldername(name))[1] = auth.uid()::text
      );

    drop policy if exists "a person deletes only their own avatar" on storage.objects;
    create policy "a person deletes only their own avatar" on storage.objects
      for delete to authenticated
      using (
        bucket_id = 'avatars'
        and (storage.foldername(name))[1] = auth.uid()::text
      );
  exception when insufficient_privilege then
    raise notice
      'Could not create the storage policies (%). Add them in the Supabase dashboard under Storage > avatars > Policies: public SELECT, and INSERT/UPDATE/DELETE for authenticated where (storage.foldername(name))[1] = auth.uid()::text.',
      sqlerrm;
  end;
end $$;

-- ---------------------------------------------------------------------------
-- 4. A learner may set their own avatar_url and nothing else that matters
--
-- profiles already has a per-row policy from sql/01 and a trigger from
-- sql/07 that governs roles. avatar_url is an ordinary column: the existing
-- update policy covers it, and enforce_profile_roles still refuses anything
-- privileged in the same write. Nothing new is needed here, and this comment
-- exists so the next person does not go looking for it.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- 5. The photo a learner sees on a marketplace card
--
-- instructor_profiles already has photo_url and is already publicly
-- selectable for verified, listed instructors (sql/04), so the directory
-- needs no change. Stated here only because "where is the policy for the
-- photo" is the obvious question.
-- ---------------------------------------------------------------------------
