-- ===========================================================================
-- ROLES AND JOURNEY STAGE
--
-- PassDrivingTest.ie is becoming two products in one application: a learner's
-- journey from theory to full licence, and an instructor's business. Every
-- screen past the front door depends on knowing which of the two a signed-in
-- person is, so that fact belongs on the account, not only on the device.
--
-- ONE USER ROW, NOT TWO TABLES
-- An instructor is a person who may also be learning to ride a motorbike, and
-- an admin is a person. Splitting users into separate student/instructor
-- tables means duplicate accounts, duplicate auth and a migration the first
-- time someone is both. The role is a column; the role-specific detail
-- (ADI number, service areas, prices) goes in its own table later, keyed back
-- to this one.
--
-- Safe to run twice.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. The columns
-- ---------------------------------------------------------------------------
alter table public.profiles
  add column if not exists role text not null default 'student';

alter table public.profiles
  add column if not exists journey_stage text;

-- Done as a separate statement so re-running the file doesn't fail on an
-- already-present constraint.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'profiles_role_check'
  ) then
    alter table public.profiles
      add constraint profiles_role_check
      check (role in ('student', 'instructor', 'admin', 'super_admin'));
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'profiles_journey_stage_check'
  ) then
    alter table public.profiles
      add constraint profiles_journey_stage_check
      check (journey_stage is null or journey_stage in (
        'theory', 'permit', 'edt', 'test-prep', 'refresher', 'test-car'
      ));
  end if;
end $$;

-- Finding every instructor is the marketplace's single hottest query.
create index if not exists profiles_role_idx on public.profiles (role);

-- ---------------------------------------------------------------------------
-- 2. Nobody may promote themselves
--
-- THIS IS THE IMPORTANT PART OF THIS FILE.
--
-- The existing row-level security lets a signed-in user update their own
-- profile row — which is correct for a display name, and catastrophic for a
-- role column: a learner could set role = 'admin' with one line of JavaScript
-- from the browser console and walk into the admin portal.
--
-- Column-level grants can't express "you may write this column but only these
-- values", so the rule is enforced by trigger instead. A client may move
-- between 'student' and 'instructor' freely (that's the front door doing its
-- job). Nothing may reach 'admin' or 'super_admin' except the service role,
-- i.e. a server-side call with the secret key, which the browser never has.
-- ---------------------------------------------------------------------------
create or replace function public.enforce_role_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.role is not distinct from old.role then
    return new;
  end if;

  -- Server-side callers (Edge Functions, SQL editor, admin tooling) are
  -- trusted; they are the only route to an elevated role.
  if coalesce(auth.role(), 'service_role') = 'service_role' then
    return new;
  end if;

  if new.role in ('admin', 'super_admin') or old.role in ('admin', 'super_admin') then
    raise exception 'role % cannot be set from the client', new.role
      using errcode = 'insufficient_privilege';
  end if;

  return new;
end $$;

drop trigger if exists profiles_enforce_role_change on public.profiles;
create trigger profiles_enforce_role_change
  before update on public.profiles
  for each row
  execute function public.enforce_role_change();

-- ---------------------------------------------------------------------------
-- 3. Check it worked
--
-- Uncomment and run. Expect: two columns, two constraints, one trigger.
-- ---------------------------------------------------------------------------
-- select column_name, data_type, column_default
--   from information_schema.columns
--  where table_name = 'profiles' and column_name in ('role', 'journey_stage');
--
-- select conname from pg_constraint
--  where conname in ('profiles_role_check', 'profiles_journey_stage_check');
--
-- select tgname from pg_trigger where tgname = 'profiles_enforce_role_change';
