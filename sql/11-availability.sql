-- ===========================================================================
-- WHEN AN INSTRUCTOR ACTUALLY WORKS
--
-- The calendar in sql/10 records lessons that already exist. This records the
-- opposite: the hours that are open, so something can be booked into them.
-- It is the last piece before booking, and it is deliberately the piece that
-- comes first, because a marketplace that books an instructor into their own
-- Sunday is worse than one that books nothing.
--
-- THREE TABLES, BECAUSE THEY ANSWER THREE DIFFERENT QUESTIONS
--
-- instructor_hours      — the ordinary week. "Tuesdays, 09:00 to 17:00."
-- instructor_time_off   — the exceptions. A holiday, a day at the test centre.
-- instructor_booking_rules — the terms. How much notice, how far ahead, how
--                            long a lesson runs, how long between two.
--
-- Keeping them apart matters: the ordinary week changes once a year, time off
-- changes weekly, and the rules are a settings screen. Folding them into one
-- table would mean rewriting a holiday every time someone edits a Tuesday.
--
-- WHY A LEARNER CAN READ THESE
--
-- Open hours are published information — it is what the listing is for — so
-- a verified, listed instructor's hours, time off and rules are selectable by
-- anyone signed in. The REASON for time off is not: "hospital appointment"
-- is nobody's business, so the public view omits it and only the owner can
-- read the column.
--
-- WHAT THIS STILL DOES NOT DO
--
-- Decide whether a slot is free. That is hours minus lessons minus time off,
-- against the rules, and it has to be computed somewhere two learners cannot
-- race each other into the same 11:00. The browser is not that place. This
-- file lays down what that computation will read; the booking Edge Function
-- is what will do it, and until then the slot list in the portal is the
-- instructor's own view of their own week, which is safe because there is
-- exactly one of them looking.
--
-- Needs sql/04 (touch_updated_at) and sql/06 (is_platform_admin).
-- Safe to run twice.
-- ===========================================================================

do $$
begin
  if to_regprocedure('public.is_platform_admin()') is null then
    raise exception
      'Run sql/06-admin-verification.sql before this file (it creates is_platform_admin).';
  end if;
  if to_regprocedure('public.touch_updated_at()') is null then
    raise exception
      'Run sql/04-instructor-profiles.sql before this file (it creates touch_updated_at).';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 1. The ordinary week
--
-- One row per block of working time. Two rows on a Tuesday is how a lunch
-- break is expressed — 09:00-13:00 and 14:00-17:00 — rather than a separate
-- breaks table that would have to agree with this one.
--
-- weekday is 0 = Sunday through 6 = Saturday, matching JavaScript's
-- getDay(). Postgres's own extract(dow) uses the same numbering, so nothing
-- has to be translated at the boundary.
-- ---------------------------------------------------------------------------
create table if not exists public.instructor_hours (
  id uuid primary key default gen_random_uuid(),
  instructor_id uuid not null references auth.users (id) on delete cascade,

  weekday   smallint not null,
  starts_at time     not null,
  ends_at   time     not null,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'instructor_hours_weekday_check') then
    alter table public.instructor_hours
      add constraint instructor_hours_weekday_check check (weekday between 0 and 6);
  end if;
  -- A block that ends before it starts is not a night shift, it is a typo.
  -- Midnight-crossing hours are not a thing in driving instruction.
  if not exists (select 1 from pg_constraint where conname = 'instructor_hours_order_check') then
    alter table public.instructor_hours
      add constraint instructor_hours_order_check check (ends_at > starts_at);
  end if;
end $$;

create index if not exists instructor_hours_owner_idx
  on public.instructor_hours (instructor_id, weekday, starts_at);

drop trigger if exists instructor_hours_touch on public.instructor_hours;
create trigger instructor_hours_touch
  before update on public.instructor_hours
  for each row execute function public.touch_updated_at();

-- Two blocks on the same day must not overlap. Without this an instructor can
-- say they work 09:00-17:00 and 10:00-11:00, and every later question —
-- how many free slots, how many hours this week — has two defensible answers.
create or replace function public.enforce_hours_no_overlap()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if exists (
    select 1 from public.instructor_hours h
     where h.instructor_id = new.instructor_id
       and h.weekday = new.weekday
       and h.id is distinct from new.id
       and h.starts_at < new.ends_at
       and h.ends_at   > new.starts_at
  ) then
    raise exception 'those hours overlap another block on the same day'
      using errcode = 'check_violation';
  end if;
  return new;
end $$;

drop trigger if exists instructor_hours_no_overlap on public.instructor_hours;
create trigger instructor_hours_no_overlap
  before insert or update on public.instructor_hours
  for each row execute function public.enforce_hours_no_overlap();

-- ---------------------------------------------------------------------------
-- 2. Time off
--
-- Whole days, inclusive at both ends, because that is how a person books a
-- holiday. A single day is the same date twice, which the form fills in for
-- them.
-- ---------------------------------------------------------------------------
create table if not exists public.instructor_time_off (
  id uuid primary key default gen_random_uuid(),
  instructor_id uuid not null references auth.users (id) on delete cascade,

  starts_on date not null,
  ends_on   date not null,
  reason    text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'instructor_time_off_order_check') then
    alter table public.instructor_time_off
      add constraint instructor_time_off_order_check check (ends_on >= starts_on);
  end if;
end $$;

create index if not exists instructor_time_off_owner_idx
  on public.instructor_time_off (instructor_id, starts_on, ends_on);

drop trigger if exists instructor_time_off_touch on public.instructor_time_off;
create trigger instructor_time_off_touch
  before update on public.instructor_time_off
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- 3. The terms
--
-- One row per instructor. Defaults chosen to be the least surprising thing
-- for someone who never opens this screen: a day's notice, bookable a month
-- out, hour lessons, fifteen minutes between them to get across town.
-- ---------------------------------------------------------------------------
create table if not exists public.instructor_booking_rules (
  instructor_id uuid primary key references auth.users (id) on delete cascade,

  min_notice_hours      int not null default 24,
  max_days_ahead        int not null default 30,
  lesson_minutes        int not null default 60,
  travel_buffer_minutes int not null default 15,
  accepting             boolean not null default true,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'instructor_booking_rules_sane_check') then
    alter table public.instructor_booking_rules
      add constraint instructor_booking_rules_sane_check check (
        min_notice_hours      between 0 and 720
        and max_days_ahead    between 1 and 365
        and lesson_minutes    between 30 and 300
        and travel_buffer_minutes between 0 and 240
      );
  end if;
end $$;

drop trigger if exists instructor_booking_rules_touch on public.instructor_booking_rules;
create trigger instructor_booking_rules_touch
  before update on public.instructor_booking_rules
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- 4. Who may read and write what
--
-- The owner, always. A learner, only for an instructor who is verified AND
-- listed — the same gate the directory and enquiries use, so an unlisted
-- instructor's week is as private as their phone number.
-- ---------------------------------------------------------------------------
alter table public.instructor_hours           enable row level security;
alter table public.instructor_time_off        enable row level security;
alter table public.instructor_booking_rules   enable row level security;

do $$
declare
  t text;
begin
  foreach t in array array[
    'instructor_hours', 'instructor_time_off', 'instructor_booking_rules'
  ] loop
    execute format('drop policy if exists %I on public.%I', t || '_own_all', t);
    execute format(
      'create policy %I on public.%I for all
         using (instructor_id = auth.uid())
         with check (instructor_id = auth.uid())', t || '_own_all', t);

    execute format('drop policy if exists %I on public.%I', t || '_public_select', t);
    execute format(
      'create policy %I on public.%I for select
         using (exists (
           select 1 from public.instructor_profiles i
            where i.user_id = public.%I.instructor_id
              and i.verification_status = ''verified''
              and i.listed = true))', t || '_public_select', t, t);

    execute format('drop policy if exists %I on public.%I', t || '_admin_all', t);
    execute format(
      'create policy %I on public.%I for all
         using (public.is_platform_admin())
         with check (public.is_platform_admin())', t || '_admin_all', t);
  end loop;
end $$;

-- The reason for time off is the owner's business. This view is what the
-- public side reads, and it simply does not carry the column — safer than
-- remembering to leave it out of every select.
drop view if exists public.instructor_time_off_public cascade;
create view public.instructor_time_off_public
with (security_invoker = true) as
  select id, instructor_id, starts_on, ends_on
    from public.instructor_time_off;

grant select on public.instructor_time_off_public to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 5. The row every instructor needs
--
-- Rules are read before they are ever written — the portal shows the defaults
-- the moment the screen opens — so give everyone who already has a profile a
-- row rather than making every reader cope with its absence.
-- ---------------------------------------------------------------------------
insert into public.instructor_booking_rules (instructor_id)
select i.user_id
  from public.instructor_profiles i
 where not exists (
   select 1 from public.instructor_booking_rules r where r.instructor_id = i.user_id
 );
