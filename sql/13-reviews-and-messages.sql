-- ===========================================================================
-- REVIEWS, AND TALKING TO A STUDENT
--
-- The last two things on the instructor's nav, and the two most easily done
-- badly.
--
-- A REVIEW HAS TO BE EARNED
--
-- The only person who may review an instructor is one who completed a lesson
-- with them. Not a learner who enquired, not one whose booking was declined,
-- and not somebody who made an account five minutes ago. That is enforced
-- here, in a trigger, and not in the app — a review system whose integrity
-- depends on the client is a review system a competitor can write into.
--
-- One review per learner per instructor, editable afterwards. Editable
-- because a bad first lesson and a good tenth is a real thing and a person
-- should be able to say so; one-per-pair because an instructor should not be
-- liftable by one enthusiastic student with an evening free.
--
-- The instructor may reply, once, and may not edit the review. An instructor
-- who can edit their own reviews has no reviews.
--
-- RATINGS ARE NOT SHOWN UNTIL THERE ARE ENOUGH OF THEM
--
-- A single five-star review is not a 5.0 rating, it is one person's opinion
-- rendered as a statistic. The view below reports the count alongside the
-- average and never the average alone, and the app refuses to draw stars
-- under three. Nothing here invents a number for an instructor who has none.
--
-- MESSAGES ARE ATTACHED TO A BOOKING
--
-- Not an open inbox. A learner may message an instructor about a lesson they
-- actually have with them, and that thread closes with the lesson. This is
-- deliberately not a chat product: it exists so "I'm outside" and "running
-- ten minutes late" do not require handing over a personal mobile number.
--
-- Needs sql/04, sql/06, sql/10 and sql/12. Safe to run twice.
-- ===========================================================================

do $$
begin
  if to_regclass('public.bookings') is null then
    raise exception 'Run sql/12-bookings.sql before this file.';
  end if;
end $$;

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
