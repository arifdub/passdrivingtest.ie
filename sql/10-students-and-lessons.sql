-- ===========================================================================
-- AN INSTRUCTOR'S STUDENTS, AND THE LESSONS THEY TEACH THEM
--
-- The first part of this platform an instructor can use on day one, with no
-- learner on it and no marketplace. The landing page has been promising it
-- since the beginning: keep the students you already teach, no acquisition
-- fee, the calendar is just a tool for you. This is that.
--
-- A STUDENT IS NOT AN ACCOUNT
--
-- Most of an instructor's students will never sign up here. They are a name
-- and a mobile number in a notebook, and the notebook is what this replaces.
-- So a student row belongs to the INSTRUCTOR and stands on its own; the
-- optional learner_id links it to a platform account when there is one,
-- which is how a marketplace enquiry becomes a student without being retyped.
--
-- That also decides the privacy shape. These rows hold other people's phone
-- numbers, entered by someone else, and the people named in them mostly
-- cannot see them. So: the instructor who owns them, and nobody else. Not
-- other instructors, not the public, and not — for now — the learner either,
-- because a learner reading an instructor's private notes about them is a
-- conversation to have before it is a feature to ship.
--
-- EDT IS COUNTED, NOT STORED
--
-- "7 of 12" comes from counting completed EDT lessons, so it cannot drift
-- from the lessons that produced it. A column would be a second source of
-- truth for the same fact, and the first time someone deletes a lesson it
-- would be wrong.
--
-- Needs sql/04 (touch_updated_at) and sql/06 (is_platform_admin).
-- Safe to run twice.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 0. The files this one stands on
--
-- Running these out of order used to fail with a bare `42883: function
-- public.is_platform_admin() does not exist` three hundred lines in, which
-- says nothing about what to do. Say it plainly instead.
-- ---------------------------------------------------------------------------
do $$
begin
  if to_regprocedure('public.is_platform_admin()') is null then
    raise exception
      'Run sql/06-admin-verification.sql before this file (it creates is_platform_admin).';
  end if;
  if to_regclass('public.instructor_profiles') is null then
    raise exception
      'Run sql/04-instructor-profiles.sql before this file.';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 1. Students
-- ---------------------------------------------------------------------------
create table if not exists public.instructor_students (
  id uuid primary key default gen_random_uuid(),
  instructor_id uuid not null references auth.users (id) on delete cascade,

  -- Null for the majority who never sign up. Not unique on its own: two
  -- different instructors may each teach the same learner.
  learner_id uuid references auth.users (id) on delete set null,

  full_name text not null,
  phone     text,
  email     text,
  area      text,
  notes     text,

  -- Where they came from, so "no acquisition fee, ever" can be told apart
  -- from a learner the marketplace brought. The fee, when it exists, will be
  -- decided by this column.
  source text not null default 'own',

  status text not null default 'active',

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'student_source_check') then
    alter table public.instructor_students
      add constraint student_source_check check (source in ('own', 'marketplace'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'student_status_check') then
    alter table public.instructor_students
      add constraint student_status_check check (status in ('active', 'archived'));
  end if;
end $$;

create index if not exists student_instructor_idx
  on public.instructor_students (instructor_id, status, full_name);

-- One student row per learner per instructor, so turning the same enquiry
-- into a student twice cannot happen.
create unique index if not exists student_one_per_learner
  on public.instructor_students (instructor_id, learner_id)
  where learner_id is not null;

drop trigger if exists instructor_students_touch on public.instructor_students;
create trigger instructor_students_touch
  before update on public.instructor_students
  for each row execute function public.touch_updated_at();

alter table public.instructor_students enable row level security;

drop policy if exists student_own_all on public.instructor_students;
create policy student_own_all on public.instructor_students
  for all using (auth.uid() = instructor_id)
  with check (auth.uid() = instructor_id);

drop policy if exists student_admin_all on public.instructor_students;
create policy student_admin_all on public.instructor_students
  for all using (public.is_platform_admin())
  with check (public.is_platform_admin());

-- ---------------------------------------------------------------------------
-- 2. Lessons
--
-- A lesson is a time, a student and a length. Everything else is optional,
-- because an instructor adding tomorrow's lesson at a traffic light should
-- not be made to price it first.
-- ---------------------------------------------------------------------------
create table if not exists public.lessons (
  id uuid primary key default gen_random_uuid(),
  instructor_id uuid not null references auth.users (id) on delete cascade,
  student_id uuid not null references public.instructor_students (id) on delete cascade,

  starts_at        timestamptz not null,
  duration_minutes int not null default 60,

  kind   text not null default 'lesson',
  status text not null default 'scheduled',

  -- Cents, as everywhere. Money in a float is how a payout ends up two cent
  -- short.
  price_cents int,
  paid        boolean not null default false,

  pickup text,
  notes  text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'lesson_kind_check') then
    alter table public.lessons
      add constraint lesson_kind_check
      check (kind in ('lesson', 'edt', 'pretest', 'mock', 'refresher', 'test-day'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'lesson_status_check') then
    alter table public.lessons
      add constraint lesson_status_check
      check (status in ('scheduled', 'completed', 'cancelled', 'no-show'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'lesson_duration_check') then
    alter table public.lessons
      add constraint lesson_duration_check
      check (duration_minutes between 15 and 600);
  end if;
end $$;

create index if not exists lesson_day_idx
  on public.lessons (instructor_id, starts_at);
create index if not exists lesson_student_idx
  on public.lessons (student_id, starts_at desc);

drop trigger if exists lessons_touch on public.lessons;
create trigger lessons_touch
  before update on public.lessons
  for each row execute function public.touch_updated_at();

-- A lesson must belong to one of this instructor's own students. Enforced
-- here rather than trusted from the client, or a crafted request could file
-- a lesson against someone else's student and read their name back out of
-- the join.
create or replace function public.enforce_lesson_student()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if coalesce(auth.role(), 'service_role') = 'service_role' then
    return new;
  end if;
  if not exists (
    select 1 from public.instructor_students s
     where s.id = new.student_id
       and s.instructor_id = new.instructor_id
  ) then
    raise exception 'that student is not yours'
      using errcode = 'insufficient_privilege';
  end if;
  return new;
end $$;

drop trigger if exists lessons_enforce_student on public.lessons;
create trigger lessons_enforce_student
  before insert or update on public.lessons
  for each row execute function public.enforce_lesson_student();

alter table public.lessons enable row level security;

drop policy if exists lesson_own_all on public.lessons;
create policy lesson_own_all on public.lessons
  for all using (auth.uid() = instructor_id)
  with check (auth.uid() = instructor_id);

drop policy if exists lesson_admin_all on public.lessons;
create policy lesson_admin_all on public.lessons
  for all using (public.is_platform_admin())
  with check (public.is_platform_admin());

-- ---------------------------------------------------------------------------
-- 3. EDT progress, counted
--
-- Twelve lessons is the whole syllabus, so "7 of 12" is the number an
-- instructor and a learner both care about. Counted from completed lessons
-- of kind 'edt', which is why there is no column holding it.
-- ---------------------------------------------------------------------------
drop view if exists public.student_progress cascade;
create view public.student_progress
with (security_invoker = true)
as
  select
    s.id as student_id,
    s.instructor_id,
    count(*) filter (where l.kind = 'edt' and l.status = 'completed')   as edt_done,
    count(*) filter (where l.status = 'completed')                      as lessons_done,
    count(*) filter (where l.status = 'scheduled' and l.starts_at >= now()) as upcoming,
    max(l.starts_at) filter (where l.status = 'completed')              as last_lesson_at,
    min(l.starts_at) filter (where l.status = 'scheduled' and l.starts_at >= now()) as next_lesson_at
  from public.instructor_students s
  left join public.lessons l on l.student_id = s.id
  group by s.id, s.instructor_id;

grant select on public.student_progress to authenticated;

-- ---------------------------------------------------------------------------
-- 4. The dashboard's numbers
--
-- Replaces sql/09's version, adding the two that were still dashes.
-- ---------------------------------------------------------------------------
-- sql/09 created this with two columns. A function's OUT parameters are its
-- return type, and Postgres will not let `create or replace` change one —
-- it stops with `42P13: cannot change return type of existing function`.
-- So the old one goes first. Dropping and recreating inside the same script
-- is atomic: no window where the dashboard finds nothing.
drop function if exists public.instructor_stats();

create function public.instructor_stats()
returns table (
  new_enquiries   bigint,
  open_enquiries  bigint,
  active_students bigint,
  lessons_today   bigint,
  lessons_week    bigint
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
        and starts_at < now() + interval '7 days')
  where auth.uid() is not null;
$$;

revoke all on function public.instructor_stats() from public, anon;
grant execute on function public.instructor_stats() to authenticated;
