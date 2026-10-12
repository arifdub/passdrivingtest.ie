-- ===========================================================================
-- WHOSE CAR, AND WHICH GEARBOX
--
-- A learner booking a lesson now says whether it is in the instructor's car
-- or their own, and whether it is manual or automatic. Both the signed-in
-- door (request_booking) and the no-account door on /adi/<number>
-- (request_guest_booking) take the two answers and hand them to
-- place_booking, which stores them on the booking.
--
--   car      'instructor' | 'own'
--   gearbox  'manual' | 'automatic'
--
-- In the instructor's car the gearbox must be one they teach in
-- (instructor_profiles.transmissions). In the learner's own car it is
-- whatever that car is.
--
-- Both are optional to the database, so bookings made before this file and
-- any app still running the old code keep working. The booking screens ask
-- for both before they send.
--
-- Postgres matches functions by their argument list, so adding parameters
-- means dropping the old versions first; otherwise both would exist side by
-- side and PostgREST could not choose between them.
--
-- Needs sql/29. Safe to run twice.
-- ===========================================================================

do $$
begin
  if to_regprocedure('public.request_guest_booking(uuid,timestamptz,text,text,text,text,text,text)') is null
     and to_regprocedure('public.request_guest_booking(uuid,timestamptz,text,text,text,text,text,text,text,text)') is null then
    raise exception 'Run sql/29-guest-bookings.sql before this file.';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 1. The two answers, on the booking
-- ---------------------------------------------------------------------------
alter table public.bookings add column if not exists car     text;
alter table public.bookings add column if not exists gearbox text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'bookings_car_check') then
    alter table public.bookings add constraint bookings_car_check
      check (car is null or car in ('instructor', 'own'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'bookings_gearbox_check') then
    alter table public.bookings add constraint bookings_gearbox_check
      check (gearbox is null or gearbox in ('manual', 'automatic'));
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 2. The old argument lists go
-- ---------------------------------------------------------------------------
drop function if exists public.place_booking(uuid, timestamptz, text, text, text, uuid, text, text, text);
drop function if exists public.request_booking(uuid, timestamptz, text, text, text);
drop function if exists public.request_guest_booking(uuid, timestamptz, text, text, text, text, text, text);

-- ---------------------------------------------------------------------------
-- 3. place_booking, request_booking, request_guest_booking — as in sql/29,
--    plus p_car and p_gearbox
-- ---------------------------------------------------------------------------
create or replace function public.place_booking(
  p_instructor  uuid,
  p_starts_at   timestamptz,
  p_kind        text,
  p_pickup      text,
  p_note        text,
  p_learner     uuid,
  p_guest_name  text,
  p_guest_email text,
  p_guest_phone text,
  p_car         text,
  p_gearbox     text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rules    public.instructor_booking_rules%rowtype;
  v_profile  public.instructor_profiles%rowtype;
  v_local    timestamp;
  v_end      timestamptz;
  v_minutes  int;
  v_buffer   int;
  v_price    int;
  v_id       uuid;
begin
  if p_car is not null and p_car not in ('instructor', 'own') then
    raise exception 'Choose the instructor''s car or your own' using errcode = 'check_violation';
  end if;
  if p_gearbox is not null and p_gearbox not in ('manual', 'automatic') then
    raise exception 'Choose manual or automatic' using errcode = 'check_violation';
  end if;

  if p_learner is not null and p_learner = p_instructor then
    raise exception 'You cannot book yourself' using errcode = 'check_violation';
  end if;

  select * into v_profile from public.instructor_profiles where user_id = p_instructor;
  if not found or v_profile.verification_status <> 'verified' or not v_profile.listed then
    raise exception 'That instructor is not taking bookings' using errcode = 'check_violation';
  end if;

  -- In the instructor's car, the gearbox is theirs: only what they teach in.
  -- In the learner's own car it is whatever that car has.
  if p_car = 'instructor' and p_gearbox is not null
     and coalesce(array_length(v_profile.transmissions, 1), 0) > 0
     and not (p_gearbox = any (v_profile.transmissions)) then
    raise exception 'That instructor doesn''t teach in a % car', p_gearbox using errcode = 'check_violation';
  end if;

  select * into v_rules from public.instructor_booking_rules where instructor_id = p_instructor;
  if not found then
    insert into public.instructor_booking_rules (instructor_id) values (p_instructor)
      returning * into v_rules;
  end if;

  if not v_rules.accepting then
    raise exception 'That instructor has paused new bookings' using errcode = 'check_violation';
  end if;

  v_minutes := v_rules.lesson_minutes;
  v_buffer  := v_rules.travel_buffer_minutes;
  v_end     := p_starts_at + (v_minutes || ' minutes')::interval;

  if p_starts_at < now() + (v_rules.min_notice_hours || ' hours')::interval then
    raise exception 'That is sooner than % hours'' notice', v_rules.min_notice_hours
      using errcode = 'check_violation';
  end if;

  if p_starts_at > now() + (v_rules.max_days_ahead || ' days')::interval then
    raise exception 'That instructor only takes bookings % days ahead', v_rules.max_days_ahead
      using errcode = 'check_violation';
  end if;

  v_local := p_starts_at at time zone 'Europe/Dublin';

  if exists (
    select 1 from public.instructor_time_off t
     where t.instructor_id = p_instructor
       and v_local::date between t.starts_on and t.ends_on
  ) then
    raise exception 'That instructor is off that day' using errcode = 'check_violation';
  end if;

  if not exists (
    select 1 from public.hours_on(p_instructor, v_local::date) h
     where extract(epoch from h.starts_at) / 60 <= extract(epoch from v_local::time) / 60
       and extract(epoch from h.ends_at)   / 60 >= extract(epoch from v_local::time) / 60 + v_minutes
  ) then
    raise exception 'That is outside their working hours' using errcode = 'check_violation';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_instructor::text, 0));

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

  v_price := case when p_kind = 'edt'
                  then coalesce(v_profile.edt_rate_cents, v_profile.hourly_rate_cents)
                  else v_profile.hourly_rate_cents end;

  insert into public.bookings (
    instructor_id, learner_id, guest_name, guest_email, guest_phone,
    starts_at, duration_minutes, kind, price_cents, pickup, note, car, gearbox
  ) values (
    p_instructor, p_learner, p_guest_name, p_guest_email, p_guest_phone,
    p_starts_at, v_minutes, coalesce(p_kind, 'lesson'),
    v_price, nullif(trim(p_pickup), ''), nullif(trim(p_note), ''), p_car, p_gearbox
  )
  returning id into v_id;

  return v_id;
end $$;

revoke all on function public.place_booking(uuid, timestamptz, text, text, text, uuid, text, text, text, text, text)
  from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3b. Signed in
-- ---------------------------------------------------------------------------
create or replace function public.request_booking(
  p_instructor uuid,
  p_starts_at  timestamptz,
  p_kind       text default 'lesson',
  p_pickup     text default null,
  p_note       text default null,
  p_car        text default null,
  p_gearbox    text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_learner uuid := auth.uid();
begin
  if v_learner is null then
    raise exception 'Sign in to book a lesson' using errcode = 'insufficient_privilege';
  end if;

  if exists (
    select 1 from public.bookings b
     where b.instructor_id = p_instructor
       and b.learner_id = v_learner
       and b.status = 'requested'
       and b.starts_at = p_starts_at
  ) then
    raise exception 'You have already asked for that time' using errcode = 'unique_violation';
  end if;

  return public.place_booking(p_instructor, p_starts_at, p_kind, p_pickup, p_note,
                              v_learner, null, null, null, p_car, p_gearbox);
end $$;

revoke all on function public.request_booking(uuid, timestamptz, text, text, text, text, text) from public, anon;
grant execute on function public.request_booking(uuid, timestamptz, text, text, text, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 3c. No account — a name, an email and a phone number
-- ---------------------------------------------------------------------------
create or replace function public.request_guest_booking(
  p_instructor uuid,
  p_starts_at  timestamptz,
  p_name       text,
  p_email      text,
  p_phone      text,
  p_kind       text default 'lesson',
  p_pickup     text default null,
  p_note       text default null,
  p_car        text default null,
  p_gearbox    text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name   text := btrim(coalesce(p_name, ''));
  v_email  text := lower(btrim(coalesce(p_email, '')));
  v_phone  text := btrim(coalesce(p_phone, ''));
  v_digits text := regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g');
begin
  if length(v_name) < 2 or length(v_name) > 80 then
    raise exception 'Enter your name' using errcode = 'check_violation';
  end if;
  if length(v_email) > 254 or v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'Enter a valid email address' using errcode = 'check_violation';
  end if;
  if length(v_digits) < 7 or length(v_digits) > 15 or length(v_phone) > 30 then
    raise exception 'Enter a valid phone number' using errcode = 'check_violation';
  end if;

  if exists (
    select 1 from public.bookings b
     where b.instructor_id = p_instructor
       and lower(b.guest_email) = v_email
       and b.status = 'requested'
       and b.starts_at = p_starts_at
  ) then
    raise exception 'You have already asked for that time' using errcode = 'unique_violation';
  end if;

  if (select count(*) from public.bookings b
       where lower(b.guest_email) = v_email and b.status = 'requested') >= 3 then
    raise exception 'You already have 3 requests waiting for an answer. Wait for a reply before asking for more.'
      using errcode = 'check_violation';
  end if;

  return public.place_booking(p_instructor, p_starts_at, p_kind, p_pickup, p_note,
                              null, v_name, v_email, v_phone, p_car, p_gearbox);
end $$;

revoke all on function public.request_guest_booking(uuid, timestamptz, text, text, text, text, text, text, text, text) from public;
grant execute on function public.request_guest_booking(uuid, timestamptz, text, text, text, text, text, text, text, text)
  to anon, authenticated;
