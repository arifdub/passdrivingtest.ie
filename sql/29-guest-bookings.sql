-- ===========================================================================
-- BOOKING WITHOUT AN ACCOUNT, FROM THE INSTRUCTOR'S OWN PAGE
--
-- An ADI shares passdrivingtest.ie/adi/<their ADI number> with their own
-- learners. The page shows their open hours, and a learner can book one
-- with a name, an email and a phone number — no account, no password. If
-- they want an account they can still make one; nobody has to.
--
-- WHAT CHANGES
--
-- 1. bookings can belong to a guest. learner_id becomes optional, and
--    guest_name / guest_email / guest_phone carry the person instead. A
--    row must have one or the other, enforced by a constraint.
--
-- 2. The rules a booking must pass — verified and listed, accepting,
--    notice, horizon, day off, inside that date's hours, no clash with a
--    lesson or another booking, buffer included — move into one internal
--    function, place_booking(). request_booking (signed in) and
--    request_guest_booking (no account) both call it, so the two doors
--    cannot drift apart. The exclusion constraint from sql/12 still
--    refuses an overlap whichever door it came through.
--
-- 3. instructor_page() finds a verified, listed instructor by ADI number
--    for the public page. Digits only on both sides, because some numbers
--    were saved as "F 40953" or with a space.
--
-- 4. accept_booking saves a guest into the instructor's student list, with
--    the phone and email they gave — reusing a student already there with
--    the same email rather than making a duplicate.
--
-- ABUSE
--
-- request_guest_booking is callable without signing in, so it is limited:
-- a guest email may hold at most three requests that are still waiting,
-- across all instructors, and the inputs are checked for shape. A booking
-- still has to land in a real open slot, so the worst case is three held
-- hours that the instructor declines in a tap.
--
-- Needs sql/12, sql/14, sql/28. Safe to run twice.
-- ===========================================================================

do $$
begin
  if to_regprocedure('public.hours_on(uuid,date)') is null then
    raise exception 'Run sql/28-date-specific-hours.sql before this file.';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 1. Guests on bookings
-- ---------------------------------------------------------------------------
alter table public.bookings alter column learner_id drop not null;
alter table public.bookings add column if not exists guest_name  text;
alter table public.bookings add column if not exists guest_email text;
alter table public.bookings add column if not exists guest_phone text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'bookings_someone_check') then
    alter table public.bookings add constraint bookings_someone_check check (
      learner_id is not null
      or (guest_name is not null and guest_email is not null and guest_phone is not null)
    );
  end if;
end $$;

create index if not exists bookings_guest_email_idx
  on public.bookings (lower(guest_email), status) where guest_email is not null;

-- ---------------------------------------------------------------------------
-- 2. The one place a booking is decided
--
-- Not callable from the browser. Only request_booking and
-- request_guest_booking reach it, and each decides who the booking is for
-- before it does.
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
  p_guest_phone text
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
  if p_learner is not null and p_learner = p_instructor then
    raise exception 'You cannot book yourself' using errcode = 'check_violation';
  end if;

  select * into v_profile from public.instructor_profiles where user_id = p_instructor;
  if not found or v_profile.verification_status <> 'verified' or not v_profile.listed then
    raise exception 'That instructor is not taking bookings' using errcode = 'check_violation';
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
    starts_at, duration_minutes, kind, price_cents, pickup, note
  ) values (
    p_instructor, p_learner, p_guest_name, p_guest_email, p_guest_phone,
    p_starts_at, v_minutes, coalesce(p_kind, 'lesson'),
    v_price, nullif(trim(p_pickup), ''), nullif(trim(p_note), '')
  )
  returning id into v_id;

  return v_id;
end $$;

revoke all on function public.place_booking(uuid, timestamptz, text, text, text, uuid, text, text, text)
  from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. Signed in — the same as before, now through place_booking
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
                              v_learner, null, null, null);
end $$;

revoke all on function public.request_booking(uuid, timestamptz, text, text, text) from public, anon;
grant execute on function public.request_booking(uuid, timestamptz, text, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. No account — a name, an email and a phone number
-- ---------------------------------------------------------------------------
create or replace function public.request_guest_booking(
  p_instructor uuid,
  p_starts_at  timestamptz,
  p_name       text,
  p_email      text,
  p_phone      text,
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
                              null, v_name, v_email, v_phone);
end $$;

revoke all on function public.request_guest_booking(uuid, timestamptz, text, text, text, text, text, text) from public;
grant execute on function public.request_guest_booking(uuid, timestamptz, text, text, text, text, text, text)
  to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 5. The public page's lookup
-- ---------------------------------------------------------------------------
create or replace function public.instructor_page(p_adi text)
returns table (
  user_id           uuid,
  full_name         text,
  business_name     text,
  bio               text,
  adi_number        text,
  years_experience  int,
  transmissions     text[],
  lesson_types      text[],
  counties          text[],
  service_areas     text[],
  hourly_rate_cents int,
  edt_rate_cents    int,
  photo_url         text
)
language sql
stable
security definer
set search_path = public
as $$
  select i.user_id, i.full_name, i.business_name, i.bio, i.adi_number,
         i.years_experience, i.transmissions, i.lesson_types, i.counties,
         i.service_areas, i.hourly_rate_cents, i.edt_rate_cents, i.photo_url
    from public.instructor_profiles i
   where i.verification_status = 'verified'
     and i.listed = true
     and regexp_replace(coalesce(i.adi_number, ''), '[^0-9]', '', 'g')
         = regexp_replace(coalesce(p_adi, ''), '[^0-9]', '', 'g')
     and regexp_replace(coalesce(p_adi, ''), '[^0-9]', '', 'g') <> ''
   order by i.verified_at nulls last
   limit 1;
$$;

revoke all on function public.instructor_page(text) from public;
grant execute on function public.instructor_page(text) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 6. Accepting — a guest becomes a student too
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

  if v_b.learner_id is not null then
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
  else
    -- A guest from the instructor's own page. Their own learner, so 'own'.
    select id into v_student
      from public.instructor_students
     where instructor_id = v_b.instructor_id
       and lower(email) = lower(v_b.guest_email)
     order by status = 'active' desc, created_at
     limit 1;

    if v_student is null then
      insert into public.instructor_students (
        instructor_id, full_name, email, phone, source
      ) values (
        v_b.instructor_id, v_b.guest_name, v_b.guest_email, v_b.guest_phone, 'own'
      )
      returning id into v_student;
    else
      update public.instructor_students
         set phone  = coalesce(nullif(phone, ''), v_b.guest_phone),
             status = 'active'
       where id = v_student;
    end if;
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
