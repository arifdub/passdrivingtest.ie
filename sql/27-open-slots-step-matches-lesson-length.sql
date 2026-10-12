-- ===========================================================================
-- A SLOT EVERY LESSON LENGTH, NOT EVERY HALF HOUR
--
-- THE BUG
--
-- An instructor picks their day hour by hour in the Availability screen's
-- hourly picker — 9 to 10, 10 to 11, 11 to 12 — and with the standard
-- 60-minute lesson, a learner was offered 09:00 AND 09:30 AND 10:00 and so
-- on. Nothing about "9 to 5, hour lessons" means a lesson can start at
-- 09:30; that slot runs into the 10 o'clock hour the instructor never
-- agreed to as its own block, and it was only on offer because open_slots
-- stepped through every working block in fixed half-hour jumps regardless
-- of how long a lesson actually takes.
--
-- THE FIX
--
-- The step is now the lesson length itself. A 60-minute lesson in a 9-to-5
-- day offers 9, 10, 11, 12…; a 90-minute lesson offers 9, 10:30, 12…. Either
-- way, every offered start leaves exactly the booked lesson and nothing
-- unaccounted for before the next one could start.
--
-- Identical to sql/14's version except for that one interval and the
-- generate_series bound it depends on — 47 half-hour steps always covered a
-- day; a lesson length divides it unevenly, so the bound is computed from
-- the lesson length instead of hard-coded.
--
-- Needs sql/14 (defines the function this replaces). Safe to run twice.
-- ===========================================================================

do $$
begin
  if to_regprocedure('public.open_slots(uuid,date,int)') is null then
    raise exception 'Run sql/12-bookings.sql before this file.';
  end if;
end $$;

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
      days.d                                                        as day,
      -- One candidate per lesson length, not per fixed half hour. The upper
      -- bound covers a full day of back-to-back lessons at this length,
      -- with a floor of 1 so a lesson length Postgres would otherwise
      -- divide by zero against can't crash this.
      (days.d + h.starts_at + (n * (greatest(v_minutes, 1) || ' minutes')::interval))
                                                                      as local_start,
      h.ends_at
      from days
      join public.instructor_hours h
        on h.instructor_id = p_instructor
       and h.weekday = extract(dow from days.d)
      cross join generate_series(0, (1440 / greatest(v_minutes, 1))) as n
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
