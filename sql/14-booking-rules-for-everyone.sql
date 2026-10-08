-- ===========================================================================
-- EVERY INSTRUCTOR NEEDS A BOOKING-RULES ROW, NOT JUST THE ONES WHO EXISTED
--
-- THE BUG
--
-- A learner could not book an instructor who had listed themselves. The
-- directory showed them, their hours were set, and the slot list was empty.
-- Always empty, for ever, with nothing in the app to say why.
--
-- open_slots() reads instructor_booking_rules and gives up if there is no
-- row:
--
--   select * into v_rules from public.instructor_booking_rules ...;
--   if not found or not v_rules.accepting then return; end if;
--
-- sql/11 created that row for every instructor who existed when it ran, and
-- then nothing ever created another. An instructor verified the next day had
-- no row, so no notice period, no horizon, no lesson length — and rather
-- than fall back on the defaults the column definitions already declare,
-- the function returned nothing at all.
--
-- A backfill is not a default. It fixes the past once and is silent about
-- every row created after it, which is the whole failure in one sentence.
--
-- TWO FIXES, BECAUSE ONE IS NOT ENOUGH
--
-- A trigger gives every new instructor_profiles row its rules, so the
-- situation stops arising. And open_slots falls back on the defaults when
-- the row is somehow still missing, so a missing row degrades to "bookable
-- on standard terms" instead of "invisible". The trigger is the fix; the
-- fallback is what stops the same class of bug being silent next time.
--
-- Needs sql/11 and sql/12. Safe to run twice.
-- ===========================================================================

do $$
begin
  if to_regclass('public.instructor_booking_rules') is null then
    raise exception 'Run sql/11-availability.sql before this file.';
  end if;
  if to_regprocedure('public.open_slots(uuid,date,int)') is null then
    raise exception 'Run sql/12-bookings.sql before this file.';
  end if;
end $$;

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
