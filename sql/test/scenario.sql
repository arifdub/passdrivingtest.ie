-- ===========================================================================
-- THE RULES, EXERCISED
--
-- Each check says what it expects and reports PASS or FAIL for itself, so a
-- change that quietly stops enforcing something shows up as a named failure
-- rather than as a different number of errors in a log.
--
-- `expect_refused` is the important one: most of this file is about things
-- that must NOT be allowed, and a test suite that only checks the happy path
-- would have passed every single time a rule was missing.
-- ===========================================================================

\set QUIET on
\pset tuples_only on
\pset format unaligned

set client_min_messages = warning;

create or replace function pg_temp.report(ok boolean, what text)
returns void language plpgsql as $$
begin
  -- raise WARNING, not NOTICE: the harness turns notices off to silence
  -- the "does not exist, skipping" chatter from re-runnable DDL, and a
  -- result that is invisible at the chosen log level is not a result.
  raise warning '%  %', case when ok then 'PASS' else 'FAIL' end, what;
end $$;

-- Runs a statement that is supposed to be refused, and passes only if it was.
create or replace function pg_temp.expect_refused(stmt text, what text)
returns void language plpgsql as $$
begin
  execute stmt;
  perform pg_temp.report(false, what || ' — WAS ALLOWED');
exception when others then
  perform pg_temp.report(true, what || ' (' || left(sqlerrm, 48) || ')');
end $$;

create or replace function pg_temp.expect_ok(stmt text, what text)
returns void language plpgsql as $$
begin
  execute stmt;
  perform pg_temp.report(true, what);
exception when others then
  perform pg_temp.report(false, what || ' — REFUSED: ' || left(sqlerrm, 60));
end $$;

create or replace function pg_temp.be(who text) returns void language sql as $$
  select set_config('request.jwt.claim.sub', who, false);
  select set_config('request.jwt.claim.role', 'authenticated', false);
$$;

create or replace function pg_temp.slot(h int, dayoffset int default 5, m int default 0)
returns timestamptz language sql as $$
  select ((current_date + dayoffset)::text || ' ' || lpad(h::text,2,'0') || ':' || lpad(m::text,2,'0'))::timestamp
         at time zone 'Europe/Dublin';
$$;

-- --------------------------------------------------------------------------
-- The cast
-- --------------------------------------------------------------------------
insert into auth.users (id, email, raw_user_meta_data) values
  ('11111111-1111-1111-1111-111111111111','adi@example.com','{"role":"instructor"}'),
  ('22222222-2222-2222-2222-222222222222','amy@example.com','{"role":"student"}'),
  ('33333333-3333-3333-3333-333333333333','ben@example.com','{"role":"student"}')
on conflict do nothing;

insert into public.profiles (id)
select id from auth.users on conflict do nothing;

insert into public.instructor_profiles
  (user_id, full_name, adi_number, verification_status, listed, hourly_rate_cents,
   counties, lesson_types, transmissions)
values ('11111111-1111-1111-1111-111111111111','Aoife Byrne','40953','verified',true,4500,
        array['Dublin'], array['edt','lesson'], array['manual'])
on conflict (user_id) do update set verification_status='verified', listed=true;

insert into public.instructor_booking_rules
  (instructor_id, min_notice_hours, max_days_ahead, lesson_minutes, travel_buffer_minutes)
values ('11111111-1111-1111-1111-111111111111', 2, 30, 60, 15)
on conflict (instructor_id) do update
  set min_notice_hours=2, max_days_ahead=30, lesson_minutes=60,
      travel_buffer_minutes=15, accepting=true;

delete from public.instructor_reviews where instructor_id='11111111-1111-1111-1111-111111111111';
delete from public.bookings  where instructor_id='11111111-1111-1111-1111-111111111111';
delete from public.lessons   where instructor_id='11111111-1111-1111-1111-111111111111';
delete from public.instructor_students where instructor_id='11111111-1111-1111-1111-111111111111';
delete from public.instructor_time_off where instructor_id='11111111-1111-1111-1111-111111111111';
delete from public.instructor_hours    where instructor_id='11111111-1111-1111-1111-111111111111';

-- Nine to five every day, plus an evening block that stops at 23:00 so the
-- midnight edge has something to run into.
insert into public.instructor_hours (instructor_id, weekday, starts_at, ends_at)
select '11111111-1111-1111-1111-111111111111', d, '09:00', '17:00' from generate_series(0,6) d;
insert into public.instructor_hours (instructor_id, weekday, starts_at, ends_at)
select '11111111-1111-1111-1111-111111111111', d, '18:00', '23:00' from generate_series(0,6) d;

-- --------------------------------------------------------------------------
-- Booking
-- --------------------------------------------------------------------------
do $$
declare
  adi  constant text := '11111111-1111-1111-1111-111111111111';
  amy  constant text := '22222222-2222-2222-2222-222222222222';
  ben  constant text := '33333333-3333-3333-3333-333333333333';
  book constant text := 'select public.request_booking(''' || '11111111-1111-1111-1111-111111111111' || ''', ';
begin
  perform pg_temp.be(amy);
  perform pg_temp.expect_ok(book || 'pg_temp.slot(11), ''edt'', ''Blanchardstown'')',
    'a learner books a free hour');

  perform pg_temp.be(ben);
  perform pg_temp.expect_refused(book || 'pg_temp.slot(11))',
    'a second learner cannot take the same hour');
  perform pg_temp.expect_refused(book || 'pg_temp.slot(11, 5, 30))',
    'nor an hour inside the travel buffer');
  perform pg_temp.expect_ok(book || 'pg_temp.slot(14))',
    'but a clear hour the same day is fine');
  perform pg_temp.expect_refused(book || 'pg_temp.slot(3))',
    'outside working hours is refused');
  perform pg_temp.expect_refused(book || 'pg_temp.slot(22, 5, 30))',
    'THE MIDNIGHT EDGE: 22:30 would overrun the 23:00 block');
  perform pg_temp.expect_ok(book || 'pg_temp.slot(22))',
    '22:00 ends exactly at 23:00, which fits');
  perform pg_temp.expect_refused(book || 'now() + interval ''1 hour'')',
    'inside the notice period is refused');
  perform pg_temp.expect_refused(book || 'pg_temp.slot(10, 365))',
    'past the booking horizon is refused');

  insert into public.instructor_time_off (instructor_id, starts_on, ends_on)
  values (adi::uuid, current_date + 6, current_date + 6);
  perform pg_temp.expect_refused(book || 'pg_temp.slot(10, 6))',
    'a day off is refused');

  perform pg_temp.be(adi);
  perform pg_temp.expect_refused(book || 'pg_temp.slot(15))',
    'an instructor cannot book themselves');
end $$;

-- --------------------------------------------------------------------------
-- The slot list agrees with the bookings
-- --------------------------------------------------------------------------
do $$
declare adi constant uuid := '11111111-1111-1111-1111-111111111111';
begin
  perform pg_temp.report(
    exists (select 1 from public.open_slots(adi, current_date + 5, 1) s where s.slot = pg_temp.slot(9)),
    'open_slots offers a free 09:00');
  perform pg_temp.report(
    not exists (select 1 from public.open_slots(adi, current_date + 5, 1) s where s.slot = pg_temp.slot(11)),
    'open_slots withholds the taken 11:00');
  perform pg_temp.report(
    not exists (select 1 from public.open_slots(adi, current_date + 5, 1) s where s.slot = pg_temp.slot(22, 5, 30)),
    'open_slots withholds 22:30, which would overrun');
  perform pg_temp.report(
    not exists (select 1 from public.open_slots(adi, current_date + 6, 1)),
    'open_slots offers nothing on a day off');
end $$;

-- --------------------------------------------------------------------------
-- Accepting
-- --------------------------------------------------------------------------
do $$
declare
  adi constant uuid := '11111111-1111-1111-1111-111111111111';
  amy constant uuid := '22222222-2222-2222-2222-222222222222';
  v_booking uuid;
begin
  perform pg_temp.be(adi::text);
  select id into v_booking from public.bookings where learner_id = amy limit 1;

  perform pg_temp.expect_ok('select public.accept_booking(''' || v_booking || ''')',
    'the instructor accepts a request');

  perform pg_temp.report(
    (select source from public.instructor_students where instructor_id = adi and learner_id = amy) = 'marketplace',
    'accepting creates a student marked marketplace');
  perform pg_temp.report(
    exists (select 1 from public.lessons l join public.bookings b on b.lesson_id = l.id where b.id = v_booking),
    'accepting puts a lesson in the calendar');
  perform pg_temp.expect_refused('select public.accept_booking(''' || v_booking || ''')',
    'the same booking cannot be accepted twice');
end $$;

-- --------------------------------------------------------------------------
-- Reviews
-- --------------------------------------------------------------------------
do $$
declare
  adi constant text := '11111111-1111-1111-1111-111111111111';
  amy constant text := '22222222-2222-2222-2222-222222222222';
  ben constant text := '33333333-3333-3333-3333-333333333333';
begin
  perform pg_temp.be(amy);
  perform pg_temp.expect_refused(
    'insert into public.instructor_reviews (instructor_id, learner_id, rating, body)
       values (''' || adi || ''',''' || amy || ''',5,''Great'')',
    'no review before a lesson is COMPLETED');

  update public.lessons set status = 'completed' where instructor_id = adi::uuid;

  perform pg_temp.expect_ok(
    'insert into public.instructor_reviews (instructor_id, learner_id, rating, body)
       values (''' || adi || ''',''' || amy || ''',5,''Great'')',
    'a review after a completed lesson');

  perform pg_temp.be(ben);
  perform pg_temp.expect_refused(
    'insert into public.instructor_reviews (instructor_id, learner_id, rating, body)
       values (''' || adi || ''',''' || ben || ''',1,''Never met them'')',
    'a stranger cannot review');

  perform pg_temp.be(adi);
  perform pg_temp.expect_refused(
    'update public.instructor_reviews set rating = 1, body = ''actually bad''
      where instructor_id = ''' || adi || '''',
    'an instructor cannot edit a review of themselves');
  perform pg_temp.expect_refused(
    'insert into public.instructor_reviews (instructor_id, learner_id, rating)
       values (''' || adi || ''',''' || adi || ''',5)',
    'an instructor cannot review themselves');
  perform pg_temp.expect_ok(
    'update public.instructor_reviews set reply = ''Thanks Amy''
      where instructor_id = ''' || adi || '''',
    'an instructor can reply');
  perform pg_temp.report(
    (select replied_at is not null from public.instructor_reviews limit 1),
    'replying stamps the time');
end $$;

-- --------------------------------------------------------------------------
-- Messages, and the badge
-- --------------------------------------------------------------------------
do $$
declare
  adi constant text := '11111111-1111-1111-1111-111111111111';
  amy constant text := '22222222-2222-2222-2222-222222222222';
  ben constant text := '33333333-3333-3333-3333-333333333333';
  v_booking uuid;
  v_closed  uuid;
begin
  select id into v_booking from public.bookings where status = 'accepted' limit 1;

  perform pg_temp.be(amy);
  perform pg_temp.expect_ok(
    'insert into public.booking_messages (booking_id, sender_id, body)
       values (''' || v_booking || ''',''' || amy || ''',''I''''m outside'')',
    'a learner messages on their own booking');

  perform pg_temp.be(ben);
  perform pg_temp.expect_refused(
    'insert into public.booking_messages (booking_id, sender_id, body)
       values (''' || v_booking || ''',''' || ben || ''',''hello'')',
    'a stranger cannot message on someone else''s booking');

  perform pg_temp.be(amy);
  perform pg_temp.expect_refused(
    'insert into public.booking_messages (booking_id, sender_id, body)
       values (''' || v_booking || ''',''' || adi || ''',''forged'')',
    'nobody can send as someone else');

  -- A declined booking is not a channel to keep talking through.
  perform pg_temp.be(ben);
  select id into v_closed from public.bookings where learner_id = ben::uuid limit 1;
  perform pg_temp.be(adi);
  perform public.decline_booking(v_closed, 'sorry');
  perform pg_temp.be(ben);
  perform pg_temp.expect_refused(
    'insert into public.booking_messages (booking_id, sender_id, body)
       values (''' || v_closed || ''',''' || ben || ''',''still there?'')',
    'a closed booking takes no more messages');

  perform pg_temp.be(adi);
  perform pg_temp.report(
    (select unread_messages from public.my_waiting()) = 1,
    'the badge counts the learner''s unread message');
  perform pg_temp.report(
    (select booking_requests from public.my_waiting()) >= 1,
    'the badge counts outstanding requests');

  perform public.mark_thread_read(v_booking);
  perform pg_temp.report(
    (select unread_messages from public.my_waiting()) = 0,
    'reading the thread clears it');
end $$;

-- --------------------------------------------------------------------------
-- Declining frees the hour again
-- --------------------------------------------------------------------------
do $$
declare
  adi constant uuid := '11111111-1111-1111-1111-111111111111';
  ben constant text := '33333333-3333-3333-3333-333333333333';
begin
  perform pg_temp.be(ben);
  -- Ben's 14:00 was declined above, so it should be offerable again.
  perform pg_temp.report(
    exists (select 1 from public.open_slots(adi, current_date + 5, 1) s where s.slot = pg_temp.slot(14)),
    'a declined hour goes back into the open slots');
end $$;
