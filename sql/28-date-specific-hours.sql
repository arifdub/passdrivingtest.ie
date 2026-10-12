-- ===========================================================================
-- HOURS FOR ONE DATE ONLY
--
-- THE GAP
--
-- An instructor opened Thursday 15 October and found Thursday 22 October
-- open too. instructor_hours is a weekly pattern: a Thursday row means
-- every Thursday. Time off could take a date away but nothing could add
-- hours to one date, or change them, without changing every week.
--
-- THE RULE
--
-- instructor_date_hours holds hours for a single calendar date. When a date
-- has any rows here, they REPLACE that weekday's usual hours for that date
-- only. Dates without rows keep the weekly pattern. Time off still beats
-- both: a day off is a day off.
--
-- One function, hours_on(), answers "which hours does this instructor work
-- on this date", and every caller asks it: open_slots (what a learner is
-- offered), request_booking (the check when they ask) and
-- booking_availability (why the list is empty). The rule written once
-- cannot drift between the three.
--
-- Needs sql/11, sql/12, sql/14 and sql/27. Safe to run twice.
-- ===========================================================================

do $$
begin
  if to_regclass('public.instructor_hours') is null then
    raise exception 'Run sql/11-availability.sql before this file.';
  end if;
  if to_regprocedure('public.request_booking(uuid,timestamptz,text,text,text)') is null then
    raise exception 'Run sql/12-bookings.sql before this file.';
  end if;
  if to_regprocedure('public.booking_availability(uuid)') is null then
    raise exception 'Run sql/14-booking-rules-for-everyone.sql before this file.';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 1. The table
-- ---------------------------------------------------------------------------
create table if not exists public.instructor_date_hours (
  id uuid primary key default gen_random_uuid(),
  instructor_id uuid not null references auth.users (id) on delete cascade,

  on_date   date not null,
  starts_at time not null,
  ends_at   time not null,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'instructor_date_hours_order_check') then
    alter table public.instructor_date_hours
      add constraint instructor_date_hours_order_check check (ends_at > starts_at);
  end if;
end $$;

create index if not exists instructor_date_hours_owner_idx
  on public.instructor_date_hours (instructor_id, on_date, starts_at);

drop trigger if exists instructor_date_hours_touch on public.instructor_date_hours;
create trigger instructor_date_hours_touch
  before update on public.instructor_date_hours
  for each row execute function public.touch_updated_at();

-- The same no-overlap rule as the weekly hours, per date instead of weekday.
create or replace function public.enforce_date_hours_no_overlap()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if exists (
    select 1 from public.instructor_date_hours h
     where h.instructor_id = new.instructor_id
       and h.on_date = new.on_date
       and h.id is distinct from new.id
       and h.starts_at < new.ends_at
       and h.ends_at   > new.starts_at
  ) then
    raise exception 'those hours overlap another block on the same date'
      using errcode = 'check_violation';
  end if;
  return new;
end $$;

drop trigger if exists instructor_date_hours_no_overlap on public.instructor_date_hours;
create trigger instructor_date_hours_no_overlap
  before insert or update on public.instructor_date_hours
  for each row execute function public.enforce_date_hours_no_overlap();

-- Same access as instructor_hours: the owner does anything, anyone signed in
-- can read a verified and listed instructor's hours, an admin does anything.
alter table public.instructor_date_hours enable row level security;

drop policy if exists instructor_date_hours_own_all on public.instructor_date_hours;
create policy instructor_date_hours_own_all on public.instructor_date_hours
  for all using (instructor_id = auth.uid())
  with check (instructor_id = auth.uid());

drop policy if exists instructor_date_hours_public_select on public.instructor_date_hours;
create policy instructor_date_hours_public_select on public.instructor_date_hours
  for select using (exists (
    select 1 from public.instructor_profiles i
     where i.user_id = public.instructor_date_hours.instructor_id
       and i.verification_status = 'verified'
       and i.listed = true));

drop policy if exists instructor_date_hours_admin_all on public.instructor_date_hours;
create policy instructor_date_hours_admin_all on public.instructor_date_hours
  for all using (public.is_platform_admin())
  with check (public.is_platform_admin());

-- ---------------------------------------------------------------------------
-- 2. The one answer to "which hours on this date"
--
-- Time off is NOT applied here; each caller already refuses a day off with
-- its own wording. This answers only which blocks the date has.
-- ---------------------------------------------------------------------------
create or replace function public.hours_on(p_instructor uuid, p_date date)
returns table (starts_at time, ends_at time)
language sql
stable
security definer
set search_path = public
as $$
  select d.starts_at, d.ends_at
    from public.instructor_date_hours d
   where d.instructor_id = p_instructor and d.on_date = p_date
  union all
  select w.starts_at, w.ends_at
    from public.instructor_hours w
   where w.instructor_id = p_instructor
     and w.weekday = extract(dow from p_date)
     and not exists (
       select 1 from public.instructor_date_hours d
        where d.instructor_id = p_instructor and d.on_date = p_date
     );
$$;

revoke all on function public.hours_on(uuid, date) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. open_slots — sql/27's version, reading hours through hours_on()
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
      return;
    end if;
    v_minutes := v_rules.lesson_minutes;
    v_buffer  := v_rules.travel_buffer_minutes;
    v_notice  := v_rules.min_notice_hours;
    v_horizon := v_rules.max_days_ahead;
  else
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
      days.d as day,
      (days.d + h.starts_at + (n * (greatest(v_minutes, 1) || ' minutes')::interval)) as local_start,
      h.ends_at
      from days
      cross join lateral public.hours_on(p_instructor, days.d) h
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

-- ---------------------------------------------------------------------------
-- 4. request_booking — sql/12's version, checking hours through hours_on()
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

  -- The whole lesson inside one block of that date's hours — the date's own
  -- hours if it has any, the weekday's usual hours if not.
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
-- 5. booking_availability — an instructor with only date hours has hours
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
    exists (select 1 from public.instructor_hours where instructor_id = p_instructor)
      or exists (select 1 from public.instructor_date_hours
                  where instructor_id = p_instructor and on_date >= current_date),
    (select count(*) from public.open_slots(p_instructor, current_date, 14));
$$;

revoke all on function public.booking_availability(uuid) from public;
grant execute on function public.booking_availability(uuid) to anon, authenticated;
