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

/* --------------------------------------------------------------------------
   RUNNING AS A REAL USER, SO POLICIES ACTUALLY APPLY
   --------------------------------------------------------------------------
   Everything else in this file runs as the superuser, which bypasses
   row-level security entirely. Triggers still fire — that is why the trigger
   checks mean something — but a POLICY could be missing, or backwards, and
   every one of those checks would still pass.

   These switch to the `authenticated` role for one statement, which is what
   PostgREST does for a signed-in request. A policy that does not exist shows
   up as a permission error instead of silently allowing everything.
   -------------------------------------------------------------------------- */
create or replace function pg_temp.rls_refused(stmt text, what text)
returns void language plpgsql as $fn$
begin
  begin
    set local role authenticated;
    execute stmt;
    reset role;
    perform pg_temp.report(false, what || ' — WAS ALLOWED');
  exception when others then
    reset role;
    perform pg_temp.report(true, what || ' (' || left(sqlerrm, 44) || ')');
  end;
end $fn$;

create or replace function pg_temp.rls_ok(stmt text, what text)
returns void language plpgsql as $fn$
begin
  begin
    set local role authenticated;
    execute stmt;
    reset role;
    perform pg_temp.report(true, what);
  exception when others then
    reset role;
    perform pg_temp.report(false, what || ' — REFUSED: ' || left(sqlerrm, 50));
  end;
end $fn$;

/* RLS on a SELECT does not raise — it filters. So "is this hidden from
   somebody else" has to be asked as a count, not as a refusal. A refusal
   check over a SELECT passes whether the policy works or does not exist,
   which is the exact shape of a test that guards nothing. */
create or replace function pg_temp.rls_count(stmt text)
returns bigint language plpgsql as $fn$
declare n bigint;
begin
  set local role authenticated;
  execute 'select count(*) from (' || stmt || ') q' into n;
  reset role;
  return n;
exception when others then
  reset role;
  return -1;   -- a hard refusal is also "cannot see it"
end $fn$;

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
    -- The 60-minute lesson length from this instructor's own rules steps
    -- the candidates, so a 9-to-5 day offers 09:00, 10:00, 11:00… and never
    -- 09:30 — a start that would run a lesson into the 10 o'clock hour
    -- nobody picked as its own block.
    not exists (select 1 from public.open_slots(adi, current_date + 5, 1) s where s.slot = pg_temp.slot(9, 5, 30)),
    'open_slots steps by the lesson length, not a fixed half hour');
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

-- --------------------------------------------------------------------------
-- An instructor verified AFTER the migrations ran
--
-- sql/11 backfilled a booking-rules row for everyone who existed at the
-- time, and nothing created another. open_slots gave up when the row was
-- missing, so an instructor who listed themselves the next day was
-- permanently unbookable: directory showed them, hours were set, slot list
-- empty, no explanation anywhere. sql/14 fixes it twice over.
-- --------------------------------------------------------------------------
do $$
declare
  nw constant uuid := '44444444-4444-4444-4444-444444444444';
begin
  -- Set up as the SQL editor would, not as a signed-in learner: sql/04
  -- refuses a profile created already-verified from the client, which is
  -- correct and is tested elsewhere. Earlier blocks left the role as
  -- 'authenticated', so it is put back deliberately.
  perform set_config('request.jwt.claim.role', 'service_role', false);
  perform set_config('request.jwt.claim.sub', '', false);

  insert into auth.users (id, email) values (nw, 'later@example.com') on conflict do nothing;
  insert into public.profiles (id) values (nw) on conflict do nothing;

  delete from public.instructor_booking_rules where instructor_id = nw;
  delete from public.instructor_hours where instructor_id = nw;
  delete from public.instructor_profiles where user_id = nw;

  insert into public.instructor_profiles
    (user_id, full_name, adi_number, verification_status, listed, hourly_rate_cents,
     counties, lesson_types, transmissions)
  values (nw, 'Later Byrne', '50001', 'verified', true, 4000,
          array['Dublin'], array['lesson'], array['manual']);

  perform pg_temp.report(
    exists (select 1 from public.instructor_booking_rules where instructor_id = nw),
    'a new instructor profile gets its booking rules automatically');

  insert into public.instructor_hours (instructor_id, weekday, starts_at, ends_at)
  select nw, d, '09:00', '17:00' from generate_series(0,6) d;

  perform pg_temp.report(
    (select count(*) from public.open_slots(nw, current_date, 14)) > 0,
    'and is bookable');

  -- Even with the row gone entirely, silence must not read as a refusal.
  delete from public.instructor_booking_rules where instructor_id = nw;
  perform pg_temp.report(
    (select count(*) from public.open_slots(nw, current_date, 14)) > 0,
    'no rules row at all falls back to the standard terms');

  -- But an explicit pause still stops everything.
  insert into public.instructor_booking_rules (instructor_id, accepting)
  values (nw, false)
  on conflict (instructor_id) do update set accepting = false;
  perform pg_temp.report(
    (select count(*) from public.open_slots(nw, current_date, 14)) = 0,
    'an explicit pause still stops the slots');

  -- And the screen can tell those apart.
  update public.instructor_booking_rules set accepting = true where instructor_id = nw;
  delete from public.instructor_hours where instructor_id = nw;
  perform pg_temp.report(
    (select has_hours = false and listed = true from public.booking_availability(nw)),
    'booking_availability says it is missing hours, not unlisted');
end $$;

-- --------------------------------------------------------------------------
-- Profile photos: the path IS the permission
--
-- sql/15's write policies check that the first folder of the object name is
-- the caller's own account id. If that expression is wrong, anybody can
-- overwrite anybody's photo — and nothing in the app would reveal it,
-- because the app always writes the correct path.
-- --------------------------------------------------------------------------
do $$
declare
  amy constant text := '22222222-2222-2222-2222-222222222222';
  ben constant text := '33333333-3333-3333-3333-333333333333';
begin
  perform pg_temp.report(
    (select public from storage.buckets where id = 'avatars'),
    'the avatars bucket is readable by anyone');

  perform pg_temp.report(
    storage.foldername(amy || '/1760000000.jpg') = array[amy],
    'the first folder of a photo path is the account id');

  -- The policies are written against auth.uid(); check the expression they
  -- rest on agrees for one person and disagrees for another.
  perform pg_temp.be(amy);
  perform pg_temp.report(
    (storage.foldername(amy || '/x.jpg'))[1] = auth.uid()::text,
    'a person matches their own folder');
  perform pg_temp.report(
    (storage.foldername(ben || '/x.jpg'))[1] is distinct from auth.uid()::text,
    'and does not match somebody else''s');

  perform pg_temp.report(
    (select count(*) from pg_policies
      where schemaname = 'storage' and tablename = 'objects'
        and policyname like '%avatar%') = 4,
    'all four avatar policies exist');

  perform pg_temp.report(
    exists (select 1 from information_schema.columns
             where table_schema = 'public' and table_name = 'profiles'
               and column_name = 'avatar_url'),
    'a learner has somewhere to keep a photo');
end $$;

-- --------------------------------------------------------------------------
-- The bell clears on reading; the work does not
--
-- One number used to answer two questions — "what is new" and "what is still
-- outstanding" — so it could only ever answer one, and the badge never went
-- away. These assert the split holds in both directions, because getting it
-- backwards would be worse: a bell that forgets a booking request nobody
-- answered.
-- --------------------------------------------------------------------------
do $$
declare
  adi constant text := '11111111-1111-1111-1111-111111111111';
  before_unseen bigint;
  after_unseen  bigint;
  before_work   bigint;
  after_work    bigint;
begin
  perform pg_temp.be(adi);

  select unseen, booking_requests into before_unseen, before_work
    from public.my_waiting();
  perform pg_temp.report(before_unseen > 0,
    'a never-opened bell counts what is already there');

  perform public.mark_notifications_seen();

  select unseen, booking_requests into after_unseen, after_work
    from public.my_waiting();
  perform pg_temp.report(after_unseen = 0,
    'opening the bell clears it');
  perform pg_temp.report(after_work = before_work and after_work > 0,
    'but the outstanding work is untouched');
end $$;

do $$
declare
  adi constant text := '11111111-1111-1111-1111-111111111111';
  amy constant text := '22222222-2222-2222-2222-222222222222';
  v_booking uuid;
begin
  -- Something new arriving after the look must light it up again.
  select id into v_booking from public.bookings where status = 'accepted' limit 1;

  perform pg_temp.be(amy);
  insert into public.booking_messages (booking_id, sender_id, body)
  values (v_booking, amy::uuid, 'are we still on for tomorrow?');

  perform pg_temp.be(adi);
  perform pg_temp.report(
    (select unseen from public.my_waiting()) > 0,
    'something arriving after the look lights it up again');

  -- And reading the thread clears the outstanding count too.
  perform public.mark_thread_read(v_booking);
  perform pg_temp.report(
    (select unread_messages from public.my_waiting()) = 0,
    'reading a thread clears its unread count');
end $$;

-- --------------------------------------------------------------------------
-- Enquiries: answerable, deletable, and not sendable to yourself
--
-- The bug on screen was an instructor told "a learner may withdraw an
-- enquiry, nothing else" on an enquiry addressed to them. One account can
-- hold both sides (sql/07), the trigger asked the learner question first,
-- and the instructor branch was never reached — so the enquiry could not be
-- moved and the 1 on the tile stayed with it.
--
-- The last three run as the `authenticated` role, so the policies apply.
-- --------------------------------------------------------------------------
grant usage on schema public to authenticated, anon;
grant select, insert, update, delete on all tables in schema public to authenticated;

do $outer$
declare
  adi constant text := '11111111-1111-1111-1111-111111111111';
  amy constant text := '22222222-2222-2222-2222-222222222222';
begin
  perform set_config('request.jwt.claim.role', 'service_role', false);
  perform set_config('request.jwt.claim.sub', '', false);
  delete from public.instructor_enquiries;

  -- The exact row that was stuck: an account enquiring with itself.
  insert into public.instructor_enquiries
    (instructor_id, learner_id, learner_name, learner_phone, area, message)
  values (adi::uuid, adi::uuid, 'Arif', '0860000000', 'D24', 'test');

  perform pg_temp.be(adi);
  perform pg_temp.expect_ok(
    'update public.instructor_enquiries set status = ''answered'' where learner_id = instructor_id',
    'an instructor can answer their own inbox on an account that is both sides');

  perform pg_temp.expect_ok(
    'delete from public.instructor_enquiries where learner_id = instructor_id',
    'and delete an enquiry');

  perform pg_temp.rls_refused(
    'insert into public.instructor_enquiries (instructor_id, learner_id, learner_name, message)'
    || ' values (''' || adi || ''', ''' || adi || ''', ''Arif'', ''again'')',
    'a new self-enquiry is refused, with RLS applied');

  /* As the LEARNER, which is who the insert policy is written for — the
     first version of this check inserted Amy's enquiry while acting as the
     instructor, so it failed on `auth.uid() = learner_id` and looked like
     the policy was broken. */
  perform pg_temp.be(amy);
  perform pg_temp.rls_ok(
    'insert into public.instructor_enquiries (instructor_id, learner_id, learner_name, message)'
    || ' values (''' || adi || ''', ''' || amy || ''', ''Amy'', ''hello'')',
    'but a real learner may still send one');

  /* An UPDATE that matches no rows raises nothing, so a refusal check over
     an empty table passes for the wrong reason. The row above is the one
     this is about, and it is asserted to exist first. */
  perform pg_temp.report(
    exists (select 1 from public.instructor_enquiries
             where learner_id = amy::uuid and instructor_id = adi::uuid),
    'the learner''s enquiry is really there to be tested against');

  perform pg_temp.rls_refused(
    'update public.instructor_enquiries set status = ''answered'''
    || ' where learner_id = ''' || amy || ''' and instructor_id = ''' || adi || '''',
    'a learner cannot answer on the instructor''s behalf');

end $outer$;

-- --------------------------------------------------------------------------
-- Email notifications: queued, never blocking, and never an open relay
--
-- The shape that matters is what gets SENT to the function: a kind and a row
-- id. Not an address. An endpoint that emails whoever it is asked to is an
-- open relay with a nice URL, and this one is reachable from the internet —
-- so the payload carrying no recipient is the security property, not a
-- detail of the encoding.
-- --------------------------------------------------------------------------
do $outer$
declare
  adi constant text := '11111111-1111-1111-1111-111111111111';
  amy constant text := '22222222-2222-2222-2222-222222222222';
  cian constant text := '55555555-5555-5555-5555-555555555555';
  v_booking uuid;
  v_before  bigint;
  v_declined uuid;
  v_instr_app uuid;
begin
  perform set_config('request.jwt.claim.role', 'service_role', false);

  update public.notify_config
     set endpoint = 'https://example.supabase.co/functions/v1/notify',
         /* Long enough to pass the placeholder guard in sql/19, which
            refuses anything under 16 characters or starting with words like
            "the same" — because that exact sentence was pasted as a value
            in production and produced a silent 401. */
         secret = 'a1b2c3d4e5f60718293a4b5c6d7e8f90', enabled = true;

  delete from net._sent;
  delete from public.instructor_enquiries;

  insert into public.instructor_enquiries (instructor_id, learner_id, learner_name, message)
  values (adi::uuid, amy::uuid, 'Amy', 'hello');

  perform pg_temp.report(
    (select count(*) from net._sent where body->>'kind' = 'enquiry') = 1,
    'a new enquiry queues exactly one email');

  -- ------------------------------------------------------------------
  -- A booking tells both people, not just the instructor
  --
  -- The learner picked the time, typed the pick-up and is the one
  -- waiting; they used to get a screen that said it worked and then
  -- nothing. Two calls, one per person, because they say different
  -- things and link to different portals.
  -- ------------------------------------------------------------------
  delete from net._sent;
  insert into public.bookings (instructor_id, learner_id, starts_at, duration_minutes)
  values (adi::uuid, '22222222-2222-2222-2222-222222222222',
          date_trunc('hour', now()) + interval '3 days', 60);

  perform pg_temp.report(
    (select count(*) from net._sent where body->>'kind' = 'booking') = 1,
    'a booking request still emails the instructor');

  perform pg_temp.report(
    (select count(*) from net._sent where body->>'kind' = 'booking_learner') = 1,
    'and now emails the learner as well');

  perform pg_temp.report(
    (select count(distinct body->>'id') from net._sent) = 1,
    'both are about the same booking');

  perform pg_temp.report(
    (select (body->>'id') is not null and body::text not like '%@%' from net._sent limit 1),
    'the payload carries a row id and no address');

  perform pg_temp.report(
    (select headers->>'x-notify-secret' = 'a1b2c3d4e5f60718293a4b5c6d7e8f90' from net._sent limit 1),
    'and the shared secret, so the endpoint is not open to the world');

  -- The budget it gives the endpoint to answer in.
  --
  -- This is the check that was missing. sql/19 waited 5s, while the endpoint
  -- it calls permits itself 30s and lets the SMTP handshake alone take 22 of
  -- them. So pg_net hung up first on every real call and wrote a row with no
  -- status_code — a recorded failure for a request that was merely slow, and
  -- a day spent reading the wrong column looking for a reason.
  --
  -- Asserted as a floor rather than an exact number so that tuning the
  -- endpoint does not have to come back and edit a test, but a return to a
  -- value that cannot physically fit does.
  perform pg_temp.report(
    (select timeout_ms >= 20000 from net._sent order by id desc limit 1),
    'the call waits long enough for a cold start and a slow mail server');

  -- And the view that reads the outcome. It exists because my own ad-hoc
  -- query built its label as 'call -> ' || status_code: for a failed call
  -- status_code is NULL, 'x' || NULL is NULL in Postgres, and so every row
  -- that had something to say printed as blank.
  perform pg_temp.report(
    (select count(*) from information_schema.columns
      where table_schema = 'public' and table_name = 'notify_log'
        and column_name in ('status_code', 'error_msg', 'timed_out')) = 3,
    'notify_log shows error_msg, not just a status code that may be null');

  -- ------------------------------------------------------------------
  -- Accepting one: the learner is told, the instructor is not
  --
  -- The instructor tapped accept; emailing them about their own tap is
  -- the kind of notification people filter away, taking the ones that
  -- matter with it. The learner, who has been waiting on an answer, is
  -- the whole point.
  -- ------------------------------------------------------------------
  select id into v_booking from public.bookings where status = 'requested' limit 1;
  delete from net._sent;
  update public.bookings set status = 'accepted' where id = v_booking;

  perform pg_temp.report(
    (select count(*) from net._sent where body->>'kind' = 'booking_accepted') = 1,
    'accepting a booking confirms it to the learner');

  perform pg_temp.report(
    (select count(*) from net._sent where body->>'kind' = 'booking') = 0,
    'and does not email the instructor about their own tap');

  -- Two separate guards, checked separately because they protect
  -- against different things and either could be removed alone.
  --
  -- First: `after update OF STATUS`, which means an update that does not
  -- touch the status column never reaches the trigger at all. Correcting
  -- a pick-up on an accepted booking is not a confirmation.
  select count(*) into v_before from net._sent;
  update public.bookings set pickup = 'Somewhere else' where id = v_booking;
  perform pg_temp.report(
    (select count(*) from net._sent) = v_before,
    'editing an already-accepted booking does not confirm it again');

  -- Second: the WHEN clause, which requires the row NOT to have been
  -- accepted a moment ago. This one catches an update that does set the
  -- status, to the value it already held. Verified by removing the
  -- clause and watching this line go red.
  --
  -- Its own baseline. This check used to inherit whatever v_before the
  -- block above it had left behind, which made it pass or fail for
  -- reasons that had nothing to do with what it claims to test.
  select count(*) into v_before from net._sent;
  update public.bookings set status = 'accepted' where id = v_booking;
  perform pg_temp.report(
    (select count(*) from net._sent) = v_before,
    'nor does setting accepted on a booking that is already accepted');

  -- ------------------------------------------------------------------
  -- Declining one: the learner is told that too
  --
  -- A no is worse to not hear than a yes. The learner is holding an
  -- email saying the hour is held for them, about an hour that is not.
  -- ------------------------------------------------------------------
  insert into public.bookings (instructor_id, learner_id, starts_at, duration_minutes)
  values (adi::uuid, '22222222-2222-2222-2222-222222222222',
          date_trunc('day', now()) + interval '5 days 3 hours', 60)  -- 3am: clear of every other test booking, whatever the time now
  returning id into v_declined;

  delete from net._sent;
  update public.bookings set status = 'declined' where id = v_declined;

  perform pg_temp.report(
    (select count(*) from net._sent where body->>'kind' = 'booking_declined') = 1,
    'declining a booking tells the learner');

  perform pg_temp.report(
    (select count(*) from net._sent) = 1,
    'and tells nobody else');

  -- Same transition guard as the acceptance.
  select count(*) into v_before from net._sent;
  update public.bookings set status = 'declined' where id = v_declined;
  perform pg_temp.report(
    (select count(*) from net._sent) = v_before,
    'declining an already-declined booking sends nothing further');


  -- ------------------------------------------------------------------
  -- A new account tells the developer
  --
  -- The whole "cast" at the top of this file was inserted before
  -- notify_config was enabled, so none of those rows should have queued
  -- anything — only a profiles row created from here on should.
  -- ------------------------------------------------------------------
  delete from net._sent;
  insert into auth.users (id, email, raw_user_meta_data) values
    (cian::uuid, 'cian@example.com', '{"role":"instructor"}')
  on conflict do nothing;
  insert into public.profiles (id)
    select id from auth.users where id = cian::uuid
  on conflict do nothing;

  perform pg_temp.report(
    (select count(*) from net._sent
      where body->>'kind' = 'new_user' and body->>'id' = cian) = 1,
    'a new account queues exactly one admin alert');

  -- And the cast at the top of the file, set up before notify_config was
  -- enabled, must not have left anything queued behind it either — this
  -- is the only honest way to prove that silence, since nothing else in
  -- this file has looked at net._sent for 'new_user' until now.
  perform pg_temp.report(
    (select count(*) from net._sent where body->>'kind' = 'new_user') = 1,
    'and nobody from the earlier setup queued one retroactively');

  -- ------------------------------------------------------------------
  -- An instructor submitting for review tells the developer too
  -- ------------------------------------------------------------------
  delete from net._sent;
  insert into public.instructor_profiles
    (user_id, full_name, adi_number, verification_status)
  values (cian::uuid, 'Cian Walsh', '99887', 'draft')
  returning id into v_instr_app;

  perform pg_temp.report(
    (select count(*) from net._sent) = 0,
    'starting a draft application queues nothing — there is nothing to approve yet');

  update public.instructor_profiles
     set verification_status = 'pending'
   where id = v_instr_app;

  perform pg_temp.report(
    (select count(*) from net._sent
      where body->>'kind' = 'instructor_submitted' and body->>'id' = v_instr_app::text) = 1,
    'submitting for review queues exactly one admin alert');

  -- Same transition guard as sql/24 and sql/25: an edit that touches the
  -- column but leaves its value unchanged must not count as a second
  -- submission. Verified by removing the WHEN clause's second half earlier
  -- in this session's work on sql/24 — the same shape, not re-proven here.
  select count(*) into v_before from net._sent;
  update public.instructor_profiles
     set verification_status = 'pending'
   where id = v_instr_app;
  perform pg_temp.report(
    (select count(*) from net._sent) = v_before,
    'resetting pending to pending does not queue a second alert');

  -- And a broken endpoint must not take the write down with it. A different
  -- learner, because one open enquiry per pair is its own rule and tripping
  -- it here would prove nothing about the notifier.
  update public.notify_config set endpoint = 'not-a-url://nowhere';
  perform pg_temp.expect_ok(
    'insert into public.instructor_enquiries (instructor_id, learner_id, learner_name, message)
       values (''' || adi || ''', ''33333333-3333-3333-3333-333333333333'', ''Ben'', ''second'')',
    'a write still succeeds when the notifier is misconfigured');

  update public.notify_config set enabled = false;

  -- ------------------------------------------------------------------
  -- The badge number is the bell's number
  --
  -- Two expressions that are meant to be the same expression. If they
  -- ever drift, the icon says 3 while the bell beside it says 1, and
  -- people stop believing either. Compared directly rather than trusted
  -- to stay in step.
  -- ------------------------------------------------------------------
  perform set_config('request.jwt.claim.sub', adi, true);
  perform pg_temp.report(
    (select public.waiting_count_for(adi::uuid))
      = (select unseen from public.my_waiting()),
    'the app icon count and the bell count are the same number');

  -- And it must not be reachable by anyone with a session. It takes a
  -- user id, so a signed-in caller could otherwise ask for somebody
  -- else's backlog.
  perform pg_temp.rls_refused(
    'select public.waiting_count_for(''' || adi || '''::uuid)',
    'waiting_count_for is not executable by a signed-in caller');
end $outer$;

-- --------------------------------------------------------------------------
-- Push subscriptions: one row per device, and the device belongs to whoever
-- is signed in on it
--
-- The endpoint is unique across ALL accounts, because a browser issues one
-- per device and site. Two people sharing a phone, or one signing out and
-- another in, produce the same endpoint for a different account — so a
-- plain insert hits the constraint and an upsert on endpoint alone leaves
-- the row pointing at whoever got there first, silently sending somebody
-- else's bookings to this phone.
-- --------------------------------------------------------------------------
do $outer$
declare
  adi constant text := '11111111-1111-1111-1111-111111111111';
  amy constant text := '22222222-2222-2222-2222-222222222222';
  ep  constant text := 'https://fcm.googleapis.com/fcm/send/shared-device';
begin
  perform set_config('request.jwt.claim.role', 'service_role', false);
  delete from public.push_subscriptions;

  perform pg_temp.be(adi);
  perform public.save_push_subscription(ep, 'pub-a', 'auth-a', 'iPhone');
  perform pg_temp.report(
    (select user_id from public.push_subscriptions where endpoint = ep) = adi::uuid,
    'a device is saved against the person who registered it');

  -- The same device, a different person signed in.
  perform pg_temp.be(amy);
  perform public.save_push_subscription(ep, 'pub-b', 'auth-b', 'iPhone');
  perform pg_temp.report(
    (select count(*) from public.push_subscriptions where endpoint = ep) = 1,
    'registering again does not duplicate the device');
  perform pg_temp.report(
    (select user_id from public.push_subscriptions where endpoint = ep) = amy::uuid,
    'and the device now belongs to whoever is signed in on it');

  -- A second device for the same person is a second row.
  perform public.save_push_subscription(ep || '-laptop', 'pub-c', 'auth-c', 'Mac');
  perform pg_temp.report(
    (select count(*) from public.push_subscriptions where user_id = amy::uuid) = 2,
    'a person can have more than one device');

  -- And removing one leaves the other.
  perform public.delete_push_subscription(ep);
  perform pg_temp.report(
    (select count(*) from public.push_subscriptions where user_id = amy::uuid) = 1,
    'turning it off on one device leaves the others alone');

  -- Nobody can reach somebody else's devices.
  perform pg_temp.be(adi);
  perform pg_temp.report(
    pg_temp.rls_count('select 1 from public.push_subscriptions where user_id = ''' || amy || '''') = 0,
    'another account cannot see your devices');
  perform pg_temp.report(
    pg_temp.rls_count('select 1 from public.push_subscriptions') = 0,
    'and sees none of them at all, having registered none');
end $outer$;

-- --------------------------------------------------------------------------
-- A placeholder left in notify_config must not produce a doomed call
--
-- The instruction for that field read 'the same NOTIFY_SECRET from step 3'
-- — a sentence that looks enough like a value to be pasted as one, and was.
-- The request then went out, the function refused it with a 401, and
-- nothing anywhere said why.
-- --------------------------------------------------------------------------
do $outer$
declare
  adi constant text := '11111111-1111-1111-1111-111111111111';
  before bigint;
begin
  perform set_config('request.jwt.claim.role', 'service_role', false);
  delete from public.instructor_enquiries;
  delete from net._sent;

  update public.notify_config
     set endpoint = 'https://example.supabase.co/functions/v1/notify',
         secret = 'the same NOTIFY_SECRET from step 3',
         enabled = true;

  select count(*) into before from net._sent;
  insert into public.instructor_enquiries (instructor_id, learner_id, learner_name, message)
  values (adi::uuid, '22222222-2222-2222-2222-222222222222', 'Amy', 'hello');

  perform pg_temp.report(
    (select count(*) from net._sent) = before,
    'a placeholder secret sends nothing, rather than a request doomed to 401');

  -- And a real one still works.
  update public.notify_config set secret = 'a1b2c3d4e5f60718293a4b5c6d7e8f90';
  delete from public.instructor_enquiries;
  insert into public.instructor_enquiries (instructor_id, learner_id, learner_name, message)
  values (adi::uuid, '33333333-3333-3333-3333-333333333333', 'Ben', 'hello');

  perform pg_temp.report(
    (select count(*) from net._sent) > before,
    'and a real secret still sends');

  update public.notify_config set enabled = false;
end $outer$;

-- --------------------------------------------------------------------------
-- Deleting an account actually removes what the privacy policy says it
-- removes — and nothing it does not say
--
-- Account deletion (api/delete-account.js) does not delete rows itself: it
-- calls Supabase's admin API to remove the auth.users row, and everything
-- else disappears as a consequence of `on delete cascade` already declared
-- throughout sql/04 onward. That makes this test a check on the SCHEMA,
-- not on the endpoint — but it is the schema that the privacy policy's
-- retention section describes, word for word, so this is where a drift
-- between what is promised and what the database actually does would be
-- caught.
--
-- A real DELETE on auth.users, the same statement the admin API issues
-- under the hood, with two fresh accounts that touch nothing used
-- elsewhere in this file and are never referenced again after this block.
-- --------------------------------------------------------------------------
do $outer$
declare
  dee constant uuid := '66666666-6666-6666-6666-666666666666';   -- instructor
  fay constant uuid := '77777777-7777-7777-7777-777777777777';   -- learner
  v_booking uuid;
begin
  perform set_config('request.jwt.claim.role', 'service_role', false);

  insert into auth.users (id, email, raw_user_meta_data) values
    (dee, 'dee@example.com', '{"role":"instructor"}'),
    (fay, 'fay@example.com', '{"role":"student"}')
  on conflict do nothing;
  insert into public.profiles (id) select id from auth.users where id in (dee, fay)
  on conflict do nothing;

  insert into public.instructor_profiles
    (user_id, full_name, adi_number, verification_status, listed, hourly_rate_cents,
     counties, lesson_types, transmissions)
  values (dee, 'Dee Quinn', '55221', 'verified', true, 4000,
          array['Cork'], array['lesson'], array['manual']);

  -- sql/14 gives every verified instructor a booking-rules row
  -- automatically the moment they are marked verified, so the row
  -- inserted above for 'dee' already exists by the time this runs.
  -- Upserted, like the file's own top-of-file fixture does, rather than
  -- inserted — a plain insert collides with that trigger's own row.
  insert into public.instructor_booking_rules
    (instructor_id, min_notice_hours, max_days_ahead, lesson_minutes, travel_buffer_minutes)
  values (dee, 2, 30, 60, 15)
  on conflict (instructor_id) do update
    set min_notice_hours=2, max_days_ahead=30, lesson_minutes=60,
        travel_buffer_minutes=15, accepting=true;

  insert into public.bookings (instructor_id, learner_id, starts_at, duration_minutes, status)
  values (dee, fay, date_trunc('hour', now()) + interval '6 days', 60, 'accepted')
  returning id into v_booking;

  insert into public.push_subscriptions (user_id, endpoint, p256dh, auth)
  values (fay, 'https://push.example.com/fay-device', 'k1', 'k2');

  -- Everything is really there before the deletion, or the assertions
  -- after it would be proving nothing.
  perform pg_temp.report(
    (select count(*) from public.bookings where id = v_booking) = 1,
    'setup: the booking exists before either account is deleted');

  -- The instructor deletes their account. db.auth.admin.deleteUser issues
  -- exactly this statement.
  delete from auth.users where id = dee;

  perform pg_temp.report(
    (select count(*) from public.profiles where id = dee) = 0,
    'deleting the instructor removes their profile');
  perform pg_temp.report(
    (select count(*) from public.instructor_profiles where user_id = dee) = 0,
    'and their instructor profile');
  perform pg_temp.report(
    (select count(*) from public.instructor_booking_rules where instructor_id = dee) = 0,
    'and their booking rules');

  -- The consequence the privacy policy's warning box names explicitly:
  -- the booking is gone too, not just the instructor's side of it. Fay
  -- made no request to delete anything, and her record of this lesson is
  -- gone along with it.
  perform pg_temp.report(
    (select count(*) from public.bookings where id = v_booking) = 0,
    'and the booking shared with the learner — her record of it too, not just his');

  -- The learner is untouched by the instructor's deletion.
  perform pg_temp.report(
    (select count(*) from public.profiles where id = fay) = 1,
    'the learner''s own account is unaffected by the instructor deleting theirs');
  perform pg_temp.report(
    (select count(*) from public.push_subscriptions where user_id = fay) = 1,
    'and her registered device is still there');

  -- Now the learner deletes her own account.
  delete from auth.users where id = fay;

  perform pg_temp.report(
    (select count(*) from public.profiles where id = fay) = 0,
    'deleting the learner removes her profile');
  perform pg_temp.report(
    (select count(*) from public.push_subscriptions where user_id = fay) = 0,
    'and her registered device');
end $outer$;

-- --------------------------------------------------------------------------
-- Hours for one date only (sql/28)
--
-- An instructor opened one Thursday and found the next Thursday open too,
-- because weekly hours repeat. A date's own hours replace that weekday's
-- usual hours on that date and nowhere else.
-- --------------------------------------------------------------------------
do $$
declare
  adi  constant uuid := '11111111-1111-1111-1111-111111111111';
  amy  constant text := '22222222-2222-2222-2222-222222222222';
  book constant text := 'select public.request_booking(''11111111-1111-1111-1111-111111111111'', ';
begin
  perform set_config('request.jwt.claim.role', 'service_role', false);
  update public.instructor_booking_rules
     set accepting = true, lesson_minutes = 60, min_notice_hours = 2,
         max_days_ahead = 30, travel_buffer_minutes = 15
   where instructor_id = adi;
  delete from public.instructor_date_hours where instructor_id = adi;
  delete from public.instructor_time_off where instructor_id = adi
     and current_date + 8 between starts_on and ends_on
      or instructor_id = adi and current_date + 15 between starts_on and ends_on;

  -- Usually 09:00-17:00 and 18:00-23:00. On this one date: 10:00-12:00.
  insert into public.instructor_date_hours (instructor_id, on_date, starts_at, ends_at)
  values (adi, current_date + 8, '10:00', '12:00');

  perform pg_temp.report(
    exists (select 1 from public.open_slots(adi, current_date + 8, 1) s where s.slot = pg_temp.slot(10, 8)),
    'a date''s own hours are offered on that date');
  perform pg_temp.report(
    not exists (select 1 from public.open_slots(adi, current_date + 8, 1) s where s.slot = pg_temp.slot(14, 8)),
    'and replace the weekday''s usual hours there');
  perform pg_temp.report(
    (select count(*) from public.open_slots(adi, current_date + 8, 1)) = 2,
    'so 10:00-12:00 with hour lessons is exactly two slots');
  perform pg_temp.report(
    exists (select 1 from public.open_slots(adi, current_date + 15, 1) s where s.slot = pg_temp.slot(14, 15)),
    'the same weekday a week later keeps its usual hours');

  perform pg_temp.be(amy);
  perform pg_temp.expect_refused(book || 'pg_temp.slot(14, 8))',
    'booking the weekday''s usual hour on a date with its own hours is refused');
  perform pg_temp.expect_ok(book || 'pg_temp.slot(10, 8))',
    'booking inside the date''s own hours is accepted');

  perform set_config('request.jwt.claim.role', 'service_role', false);
  perform pg_temp.expect_refused(
    'insert into public.instructor_date_hours (instructor_id, on_date, starts_at, ends_at) values ('''
      || adi || ''', current_date + 8, ''11:00'', ''13:00'')',
    'two blocks on the same date cannot overlap');

  -- Removing the date's hours puts the weekly pattern back.
  delete from public.instructor_date_hours where instructor_id = adi;
  perform pg_temp.report(
    exists (select 1 from public.open_slots(adi, current_date + 8, 1) s where s.slot = pg_temp.slot(14, 8)),
    'removing a date''s hours restores the usual ones');
end $$;

-- --------------------------------------------------------------------------
-- Booking from the instructor's own page, without an account (sql/29)
-- --------------------------------------------------------------------------
do $$
declare
  adi   constant uuid := '11111111-1111-1111-1111-111111111111';
  guest constant text := 'select public.request_guest_booking(''11111111-1111-1111-1111-111111111111'', ';
  v_id  uuid;
  v_b   public.bookings%rowtype;
  v_s   public.instructor_students%rowtype;
begin
  -- The public page finds them by number, however the number was typed.
  perform pg_temp.report(
    (select user_id from public.instructor_page('40953')) = adi,
    'the public page finds an instructor by ADI number');
  perform pg_temp.report(
    (select user_id from public.instructor_page('F 40953')) = adi,
    'and by the same number with a letter and a space');
  perform pg_temp.report(
    not exists (select 1 from public.instructor_page('99999')),
    'an unknown number finds nobody');
  perform pg_temp.report(
    not exists (select 1 from public.instructor_page('')),
    'and an empty one finds nobody, rather than everybody');

  -- Nobody signed in.
  perform set_config('request.jwt.claim.sub', '', false);
  perform set_config('request.jwt.claim.role', 'anon', false);
  delete from public.bookings where instructor_id = adi and current_date + 9 = (starts_at at time zone 'Europe/Dublin')::date;
  delete from public.bookings where lower(guest_email) = 'sam@example.ie';

  perform pg_temp.expect_ok(guest || 'pg_temp.slot(10, 9), ''Sam Walsh'', ''Sam@Example.ie'', ''087 123 4567'')',
    'a guest books an open hour with a name, email and phone');

  select * into v_b from public.bookings
   where instructor_id = adi and starts_at = pg_temp.slot(10, 9) and status = 'requested';
  perform pg_temp.report(
    v_b.learner_id is null and v_b.guest_name = 'Sam Walsh'
      and v_b.guest_email = 'sam@example.ie' and v_b.guest_phone = '087 123 4567',
    'the booking carries the guest, with no account behind it');

  perform pg_temp.expect_refused(guest || 'pg_temp.slot(10, 9), ''Jo Kelly'', ''jo@example.ie'', ''0861234567'')',
    'a second guest cannot take the same hour');
  perform pg_temp.expect_refused(guest || 'pg_temp.slot(14, 9), ''Jo Kelly'', ''not-an-email'', ''0861234567'')',
    'a malformed email is refused');
  perform pg_temp.expect_refused(guest || 'pg_temp.slot(14, 9), ''Jo Kelly'', ''jo@example.ie'', ''123'')',
    'a phone number too short to be one is refused');
  perform pg_temp.expect_refused(guest || 'pg_temp.slot(3, 9), ''Jo Kelly'', ''jo@example.ie'', ''0861234567'')',
    'a guest is held to the same working hours as anyone');

  perform pg_temp.expect_ok(guest || 'pg_temp.slot(12, 9), ''Sam Walsh'', ''sam@example.ie'', ''0871234567'')',
    'the same guest may ask for a second hour');
  perform pg_temp.expect_ok(guest || 'pg_temp.slot(14, 9), ''Sam Walsh'', ''sam@example.ie'', ''0871234567'')',
    'and a third');
  perform pg_temp.expect_refused(guest || 'pg_temp.slot(16, 9), ''Sam Walsh'', ''SAM@example.ie'', ''0871234567'')',
    'but not a fourth while three are still waiting');

  perform pg_temp.report(
    not has_function_privilege('anon',
      'public.place_booking(uuid, timestamptz, text, text, text, uuid, text, text, text, text, text, int)', 'execute'),
    'the internal booking function cannot be called from the browser');
  perform pg_temp.report(
    has_function_privilege('anon',
      'public.request_guest_booking(uuid, timestamptz, text, text, text, text, text, text, text, text, int)', 'execute'),
    'the guest booking function can');

  -- The instructor accepts, and the guest lands in their student list.
  perform pg_temp.be(adi::text);
  perform public.accept_booking(v_b.id);
  select s.* into v_s from public.instructor_students s
    join public.bookings b on b.student_id = s.id where b.id = v_b.id;
  perform pg_temp.report(
    v_s.full_name = 'Sam Walsh' and v_s.email = 'sam@example.ie'
      and v_s.phone = '087 123 4567' and v_s.source = 'own' and v_s.learner_id is null,
    'accepting a guest saves them to the student list with their phone and email');
  perform pg_temp.report(
    exists (select 1 from public.lessons l
             join public.bookings b on b.lesson_id = l.id where b.id = v_b.id),
    'and puts the lesson in the calendar');

  -- A second accepted booking from the same guest reuses that student.
  select id into v_id from public.bookings
   where lower(guest_email) = 'sam@example.ie' and starts_at = pg_temp.slot(12, 9);
  perform public.accept_booking(v_id);
  perform pg_temp.report(
    (select count(*) from public.instructor_students
      where instructor_id = adi and lower(email) = 'sam@example.ie') = 1,
    'the same guest booking again does not make a duplicate student');
end $$;

-- --------------------------------------------------------------------------
-- Whose car, and which gearbox (sql/31)
-- --------------------------------------------------------------------------
do $$
declare
  guest constant text := 'select public.request_guest_booking(''11111111-1111-1111-1111-111111111111'', ';
  who   constant text := '''Cara Doyle'', ''cara@example.ie'', ''0851234567'', ''lesson'', null, null, ';
  v_b   public.bookings%rowtype;
begin
  perform set_config('request.jwt.claim.sub', '', false);
  perform set_config('request.jwt.claim.role', 'anon', false);
  delete from public.bookings where lower(guest_email) = 'cara@example.ie';

  -- Aoife teaches in a manual car only.
  perform pg_temp.expect_ok(guest || 'pg_temp.slot(9, 16), ' || who || '''instructor'', ''manual'')',
    'a guest books in the instructor''s manual car');
  select * into v_b from public.bookings
   where lower(guest_email) = 'cara@example.ie' and starts_at = pg_temp.slot(9, 16);
  perform pg_temp.report(v_b.car = 'instructor' and v_b.gearbox = 'manual',
    'the booking says whose car and which gearbox');

  perform pg_temp.expect_refused(guest || 'pg_temp.slot(9, 18), ' || who || '''instructor'', ''automatic'')',
    'an automatic in the car of an instructor who only has a manual is refused');
  perform pg_temp.expect_ok(guest || 'pg_temp.slot(9, 18), ' || who || '''own'', ''automatic'')',
    'but an automatic in the learner''s own car is fine');
  perform pg_temp.expect_refused(guest || 'pg_temp.slot(9, 20), ' || who || '''van'', ''manual'')',
    'a car that is neither theirs nor the instructor''s is refused');
  perform pg_temp.expect_refused(guest || 'pg_temp.slot(9, 20), ' || who || '''own'', ''semi'')',
    'a gearbox that is neither manual nor automatic is refused');

  -- The signed-in door takes the same two answers.
  perform pg_temp.be('22222222-2222-2222-2222-222222222222');
  perform pg_temp.expect_ok(
    'select public.request_booking(''11111111-1111-1111-1111-111111111111'', pg_temp.slot(11, 16), ''lesson'', null, null, ''own'', ''manual'')',
    'a signed-in learner books in their own manual car');
  perform pg_temp.report(
    exists (select 1 from public.bookings where learner_id = '22222222-2222-2222-2222-222222222222'
             and starts_at = pg_temp.slot(11, 16) and car = 'own' and gearbox = 'manual'),
    'and it is stored the same way');

  -- An app still on the old code sends neither, and still books.
  perform pg_temp.expect_ok(
    'select public.request_booking(''11111111-1111-1111-1111-111111111111'', pg_temp.slot(13, 16))',
    'a booking without the two answers still goes through');
end $$;

-- --------------------------------------------------------------------------
-- Driving level, and who is behind each request (sql/31)
-- --------------------------------------------------------------------------
do $$
declare
  adi   constant uuid := '11111111-1111-1111-1111-111111111111';
  guest constant text := 'select public.request_guest_booking(''11111111-1111-1111-1111-111111111111'', ';
  who   constant text := '''Dan Roche'', ''dan@example.ie'', ''0831234567'', ''lesson'', null, null, ''own'', ''manual'', ';
  v_b   public.bookings%rowtype;
  v_amy uuid;
  v_dan uuid;
  v_sam uuid;
  v_r   record;
begin
  perform set_config('request.jwt.claim.sub', '', false);
  perform set_config('request.jwt.claim.role', 'anon', false);
  delete from public.bookings where lower(guest_email) = 'dan@example.ie';

  perform pg_temp.expect_ok(guest || 'pg_temp.slot(9, 22), ' || who || '3)',
    'a guest books saying they are an experienced learner');
  select * into v_b from public.bookings where lower(guest_email) = 'dan@example.ie';
  perform pg_temp.report(v_b.level = 3, 'the booking carries the level');
  v_dan := v_b.id;

  perform pg_temp.expect_refused(guest || 'pg_temp.slot(11, 22), ' || who || '5)',
    'a level above 4 is refused');
  perform pg_temp.expect_refused(guest || 'pg_temp.slot(11, 22), ' || who || '0)',
    'and below 1');

  select id into v_amy from public.bookings
   where learner_id = '22222222-2222-2222-2222-222222222222' and starts_at = pg_temp.slot(11, 16);
  select id into v_sam from public.bookings
   where lower(guest_email) = 'sam@example.ie' and status = 'requested' limit 1;

  -- The instructor asks who is behind three requests.
  perform pg_temp.be(adi::text);
  select * into v_r from public.booking_learners(array[v_amy]);
  perform pg_temp.report(v_r.email = 'amy@example.com' and v_r.name is not null,
    'an account learner''s name and email reach the instructor');
  select * into v_r from public.booking_learners(array[v_dan]);
  perform pg_temp.report(v_r.name = 'Dan Roche' and not v_r.is_student and v_r.lessons_had = 0,
    'a guest the instructor has never taught is new');
  select * into v_r from public.booking_learners(array[v_sam]);
  perform pg_temp.report(v_r.is_student,
    'a guest already saved to their students is recognised as theirs');

  -- Somebody else's instructor gets nothing back.
  perform pg_temp.be('33333333-3333-3333-3333-333333333333');
  perform pg_temp.report(
    not exists (select 1 from public.booking_learners(array[v_amy, v_dan])),
    'nobody but the booking''s instructor can look the learner up');
  perform pg_temp.report(
    not has_function_privilege('anon', 'public.booking_learners(uuid[])', 'execute'),
    'and nobody signed out can call it at all');
end $$;

-- --------------------------------------------------------------------------
-- Lesson requests: learners post, instructors answer (sql/32)
-- --------------------------------------------------------------------------
do $$
declare
  adi  constant uuid := '11111111-1111-1111-1111-111111111111';
  amy  constant uuid := '22222222-2222-2222-2222-222222222222';
  ben  constant uuid := '33333333-3333-3333-3333-333333333333';
  post constant text := 'select public.post_lesson_request(''Dublin'', ''Lucan'', ''lesson'', ';
  v_req  uuid;
  v_r    record;
  v_seen int;
begin
  delete from public.lesson_requests where learner_id in (amy, ben);

  perform pg_temp.be(amy::text);
  perform pg_temp.expect_ok(post || '2, ''instructor'', ''manual'', ''Weekday evenings'', ''Nervous starter'')',
    'a learner posts a lesson request');
  select id into v_req from public.lesson_requests where learner_id = amy;
  perform pg_temp.report(
    (select first_name from public.lesson_requests where id = v_req) = 'amy',
    'the post carries a first name only');

  perform pg_temp.expect_refused(post || 'null, ''instructor'', ''manual'', null, null)',
    'a post without a driving level is refused');
  perform pg_temp.expect_refused(post || '2, ''bus'', ''manual'', null, null)',
    'a post with a car that is neither is refused');
  perform pg_temp.expect_ok(post || '3, ''own'', ''automatic'', null, null)', 'a second post');
  perform pg_temp.expect_ok(post || '3, ''own'', ''automatic'', null, null)', 'a third post');
  perform pg_temp.expect_refused(post || '3, ''own'', ''automatic'', null, null)',
    'but not a fourth while three are open');

  -- Only a verified instructor sees the board.
  perform pg_temp.be(ben::text);
  perform pg_temp.expect_refused('select * from public.open_lesson_requests()',
    'a learner cannot read the board');
  perform pg_temp.be(adi::text);
  select * into v_r from public.open_lesson_requests('Dublin') where id = v_req;
  perform pg_temp.report(v_r.first_name = 'amy' and v_r.availability = 'Weekday evenings' and not v_r.messaged,
    'a verified instructor sees the post with its details');
  perform pg_temp.report(
    not exists (select 1 from public.open_lesson_requests('Cork') where id = v_req),
    'and the county filter leaves it out of another county');

  -- Who can write first.
  perform pg_temp.be(amy::text);
  perform pg_temp.expect_refused(format('select public.send_request_message(%L, %L, %L)', v_req, adi, 'hello?'),
    'the learner cannot start a thread themselves');
  perform pg_temp.be(ben::text);
  perform pg_temp.expect_refused(format('select public.send_request_message(%L, %L, %L)', v_req, ben, 'I can teach'),
    'someone who is not a verified instructor cannot answer');
  perform pg_temp.be(adi::text);
  perform pg_temp.expect_refused(format('select public.send_request_message(%L, %L, %L)', v_req, ben, 'as ben'),
    'an instructor cannot write as another instructor');
  perform pg_temp.expect_ok(format('select public.send_request_message(%L, %L, %L)', v_req, adi, 'I have evenings free'),
    'a verified instructor messages the learner');
  perform pg_temp.report(
    (select messaged from public.open_lesson_requests('Dublin') where id = v_req),
    'and the board marks it as messaged');

  perform pg_temp.be(amy::text);
  select * into v_r from public.my_request_threads() where request_id = v_req;
  perform pg_temp.report(v_r.i_am = 'learner' and v_r.other_name = 'Aoife Byrne' and v_r.unread = 1,
    'the learner''s conversation list shows the instructor and one unread');
  perform pg_temp.expect_ok(format('select public.send_request_message(%L, %L, %L)', v_req, adi, 'Great, Tuesday?'),
    'the learner replies in that thread');
  perform public.mark_request_thread_read(v_req, adi);
  perform pg_temp.report(
    (select unread from public.my_request_threads() where request_id = v_req) = 0,
    'opening the thread clears the unread count');

  perform pg_temp.be(adi::text);
  perform pg_temp.report(
    (select unread from public.my_request_threads() where request_id = v_req) = 1
      and (select other_name from public.my_request_threads() where request_id = v_req) = 'amy',
    'the instructor sees the learner''s reply, by first name');

  -- Nobody else reads it.
  perform pg_temp.be(ben::text);
  perform pg_temp.report(not exists (select 1 from public.my_request_threads()),
    'a third person has no threads');
  set local role authenticated;
  select count(*) into v_seen from public.request_messages where request_id = v_req;
  reset role;
  perform pg_temp.report(v_seen = 0, 'and cannot read the messages directly');

  -- Closed is closed.
  perform pg_temp.be(amy::text);
  update public.lesson_requests set status = 'closed' where id = v_req;
  perform pg_temp.be(adi::text);
  perform pg_temp.report(not exists (select 1 from public.open_lesson_requests() where id = v_req),
    'a closed post leaves the board');
  perform pg_temp.expect_refused(format('select public.send_request_message(%L, %L, %L)', v_req, adi, 'still there?'),
    'and nobody new can message about it');
end $$;
