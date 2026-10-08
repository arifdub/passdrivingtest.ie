-- ===========================================================================
-- PASSDRIVINGTEST.IE — EVERYTHING STILL TO RUN
--
-- Paste the whole file into the Supabase SQL editor and run it once:
--   https://supabase.com/dashboard/project/zwwtmvolghcoopicznwa/sql/new
--
-- Order matters and is already correct here: 04 creates the table 05 and 06
-- refer to, and 06 replaces a function 04 installs. Every part is idempotent,
-- so running this when some of it has already been applied is safe. If you
-- are unsure whether 04 went in, run the lot.
--
-- This is sql/04 through sql/14 in order. Those files remain the originals;
-- this one is for pasting.
--
-- AFTERWARDS — make yourself an admin. There is no client path to it:
--
--   update public.profiles
--      set roles = array(select distinct unnest(roles || array['admin']))
--    where id = (select id from auth.users where email = 'you@example.com');
--
-- then sign out and back in, because the roles are read when the session
-- loads. This ADDS admin; it does not replace the sides the account already
-- holds, so the same email can be a learner, an instructor and an admin.
--
-- AND CHECK IT:
--
--   select u.email, p.roles
--     from public.profiles p join auth.users u on u.id = p.id
--    order by u.email;
-- ===========================================================================


-- ###########################################################################
-- ### 04 — INSTRUCTOR PROFILES
-- ###########################################################################
--
-- Everything that makes someone bookable: who they are, the ADI number that
-- proves they may teach, what they teach, where, and for how much.
--
-- THE VERIFICATION RULE, WHICH IS THE POINT OF THIS PART
--
-- An instructor may write their own ADI number. They may NOT write the field
-- that says the number was checked. If both lived in the same place and both
-- were writable, "Verified ADI" would mean "typed their own number in", and a
-- learner handing over their card and getting into a stranger's car deserves
-- better than that.
--
-- Submitting for review is the one transition an instructor may make
-- themselves: draft -> pending. Everything past that is someone else's call.

create extension if not exists "pgcrypto";

create table if not exists public.instructor_profiles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users (id) on delete cascade,

  -- Who they are
  full_name      text,
  phone          text,
  business_name  text,
  bio            text,
  photo_url      text,

  -- What lets them teach. adi_number is what the platform checks against the
  -- RSA's published register; adi_category is the vehicle class.
  adi_number     text,
  adi_category   text,
  years_experience int,

  -- What they teach. Arrays rather than booleans so adding "motorway lessons"
  -- later is data, not a migration.
  transmissions  text[] default '{}',      -- manual, automatic
  lesson_types   text[] default '{}',      -- edt, pretest, mock, refresher, test-day

  -- Where they teach
  base_eircode   text,
  counties       text[] default '{}',
  service_areas  text[] default '{}',      -- eircode routing keys: D15, D24…
  test_centres   text[] default '{}',

  -- What they charge. Cents, not euro: a lesson price is money, and money in
  -- a float is how you end up two cent short on a payout.
  hourly_rate_cents int,
  edt_rate_cents    int,
  cancellation_policy text,

  -- Platform-owned. See the trigger below.
  verification_status text not null default 'draft',
  verification_notes  text,
  verified_at         timestamptz,

  -- Marketplace visibility. Separate from verification on purpose: a verified
  -- instructor may still want to be invisible while their calendar is full.
  listed boolean not null default false,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'instructor_verification_status_check') then
    alter table public.instructor_profiles
      add constraint instructor_verification_status_check
      check (verification_status in ('draft', 'pending', 'verified', 'rejected', 'suspended'));
  end if;
end $$;

-- The marketplace's hot path: verified, listed instructors in an area.
create index if not exists instructor_profiles_listed_idx
  on public.instructor_profiles (verification_status, listed);
create index if not exists instructor_profiles_areas_idx
  on public.instructor_profiles using gin (service_areas);

-- ---------------------------------------------------------------------------
-- Keep updated_at honest
-- ---------------------------------------------------------------------------
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

drop trigger if exists instructor_profiles_touch on public.instructor_profiles;
create trigger instructor_profiles_touch
  before update on public.instructor_profiles
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- A fresh row may not arrive pre-verified
-- ---------------------------------------------------------------------------
create or replace function public.enforce_verification_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if coalesce(auth.role(), 'service_role') = 'service_role' then
    return new;
  end if;
  if new.verification_status not in ('draft', 'pending') then
    raise exception 'a new instructor profile starts as draft'
      using errcode = 'insufficient_privilege';
  end if;
  new.verified_at := null;
  new.listed := false;
  return new;
end $$;

drop trigger if exists instructor_profiles_enforce_insert on public.instructor_profiles;
create trigger instructor_profiles_enforce_insert
  before insert on public.instructor_profiles
  for each row execute function public.enforce_verification_insert();

-- The UPDATE rule is installed here and then replaced by 06 below, which adds
-- the admin case. The trigger is created once, at the end of 06.
drop trigger if exists instructor_profiles_enforce_verification on public.instructor_profiles;

-- ---------------------------------------------------------------------------
-- Row-level security
--
-- Three audiences, three different answers:
--   the instructor   full read/write of their own row (bar the fields above)
--   an admin         read and write every row — this is how approval happens
--   everyone else    only verified, listed instructors, because that is the
--                    marketplace listing and it is meant to be public
-- ---------------------------------------------------------------------------
alter table public.instructor_profiles enable row level security;

drop policy if exists instructor_own_select on public.instructor_profiles;
create policy instructor_own_select on public.instructor_profiles
  for select using (auth.uid() = user_id);

drop policy if exists instructor_own_insert on public.instructor_profiles;
create policy instructor_own_insert on public.instructor_profiles
  for insert with check (auth.uid() = user_id);

drop policy if exists instructor_own_update on public.instructor_profiles;
create policy instructor_own_update on public.instructor_profiles
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists instructor_public_select on public.instructor_profiles;
create policy instructor_public_select on public.instructor_profiles
  for select using (verification_status = 'verified' and listed = true);


-- ###########################################################################
-- ### 05 — SEPARATE LEARNER AND INSTRUCTOR ACCOUNTS
-- ###########################################################################
--
-- Until now one account opened both portals, because the only thing deciding
-- which product you saw was a value in localStorage that the browser owns and
-- anyone can edit. "Which of the two are you?" was a device preference.
--
-- profiles.role already exists (sql/03). What is new is that THE CLIENT CAN NO
-- LONGER WRITE IT. sql/03's trigger let a client move freely between 'student'
-- and 'instructor' — deliberate then, when the front door set the role, and
-- exactly what has to stop now or the separation is a suggestion.

-- ---------------------------------------------------------------------------
-- 1. What role does a sign-up ask for?
--
-- The app passes { role: 'student' | 'instructor' } in the sign-up metadata.
-- Anything else — a missing value, or someone hand-crafting a request that
-- says 'admin' — becomes 'student'. Elevation stays server-side.
-- ---------------------------------------------------------------------------
create or replace function public.requested_role(meta jsonb)
returns text
language sql
immutable
as $$
  select case when meta->>'role' = 'instructor' then 'instructor' else 'student' end;
$$;

-- ---------------------------------------------------------------------------
-- 2. A new account gets the role of the door it registered at
--
-- Written defensively: the profiles row may be created by a trigger that
-- predates this, or by the app on first write. Rather than assume which, and
-- rather than guess the table's NOT NULL columns, it tries an id-only insert,
-- shrugs if that is not possible, and sets the role on whichever row exists.
-- ---------------------------------------------------------------------------
create or replace function public.apply_signup_role()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Trigger 3 refuses every role change that isn't server-side, and this IS
  -- the server side — but it runs inside the sign-up request, where
  -- auth.role() reads 'anon', so it would otherwise be refused by its own
  -- guard and sign-up would fail for every instructor. The flag says "this
  -- write is mine". `true` makes it local to this transaction, and there is
  -- no way to set it from the browser: PostgREST exposes tables and the
  -- functions you publish, not arbitrary SQL.
  perform set_config('pdt.applying_signup_role', 'on', true);

  begin
    insert into public.profiles (id) values (new.id) on conflict (id) do nothing;
  exception when others then
    -- Another trigger owns row creation, or the table wants more columns than
    -- an id. Either way the app creates the row and trigger 3 handles it.
    null;
  end;

  update public.profiles
     set role = public.requested_role(new.raw_user_meta_data)
   where id = new.id
     and role not in ('admin', 'super_admin');

  perform set_config('pdt.applying_signup_role', 'off', true);
  return new;
end $$;

-- WHY THIS IS WRAPPED, AND NOT A PLAIN CREATE TRIGGER
--
-- auth.users belongs to supabase_auth_admin, not to the role the SQL editor
-- runs as. On most projects postgres can still attach a trigger to it; on
-- some it cannot, and the failure is "must be owner of relation users".
--
-- A pasted script runs as ONE transaction, so that one statement failing
-- rolls back everything behind it — the table, the columns, the policies —
-- and leaves no trace of why. A migration that takes itself down over a
-- belt-and-braces step is worse than one that says so and carries on.
--
-- And it IS belt and braces: the role is also applied by the trigger on
-- profiles, which reads the same sign-up metadata and needs no privilege on
-- the auth schema. This one just gets it there a moment earlier.
do $$
begin
  execute 'drop trigger if exists on_auth_user_created_apply_role on auth.users';
  execute 'create trigger on_auth_user_created_apply_role
             after insert on auth.users
             for each row execute function public.apply_signup_role()';
exception when others then
  raise notice
    'Could not attach the sign-up trigger to auth.users (%). Not fatal: the trigger on profiles applies the role from the same metadata.',
    sqlerrm;
end $$;

-- ---------------------------------------------------------------------------
-- 3. The role is set by the platform, not sent by the browser
--
-- INSERT: whatever role the client puts in the row is discarded and replaced
-- with the one recorded on the account at sign-up.
--
-- UPDATE: the role cannot change. Not to admin, not between student and
-- instructor. The client may still write every other column on its own row.
-- ---------------------------------------------------------------------------
create or replace function public.enforce_profile_role()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  meta jsonb;
begin
  -- A null auth.role() means there is no request context at all: the SQL
  -- editor, a migration, an Edge Function with the service key. Those are the
  -- trusted callers and the only route to an elevated role.
  if coalesce(auth.role(), 'service_role') = 'service_role' then
    return new;
  end if;

  -- The sign-up trigger above, writing the role it was given. See its comment.
  if coalesce(current_setting('pdt.applying_signup_role', true), 'off') = 'on' then
    return new;
  end if;

  if TG_OP = 'INSERT' then
    select raw_user_meta_data into meta from auth.users where id = new.id;
    new.role := public.requested_role(meta);
    return new;
  end if;

  if new.role is distinct from old.role then
    raise exception
      'role cannot be changed from the client; it is set when the account is created'
      using errcode = 'insufficient_privilege';
  end if;

  return new;
end $$;

-- Replaces sql/03's trigger, which permitted student <-> instructor.
drop trigger if exists profiles_enforce_role_change on public.profiles;
drop trigger if exists profiles_enforce_role on public.profiles;
create trigger profiles_enforce_role
  before insert or update on public.profiles
  for each row execute function public.enforce_profile_role();

-- ---------------------------------------------------------------------------
-- 4. Existing accounts
--
-- Everyone who signed up before this has role 'student', sql/03's default,
-- including anyone who registered as an instructor back when the role was
-- pushed up from the browser and may never have arrived. Anyone who got as far
-- as starting an instructor profile is an instructor: evidence, not a guess.
-- ---------------------------------------------------------------------------
do $$
begin
  if to_regclass('public.instructor_profiles') is not null then
    update public.profiles p
       set role = 'instructor'
     where p.role = 'student'
       and exists (select 1 from public.instructor_profiles i where i.user_id = p.id);
  end if;
end $$;


-- ###########################################################################
-- ### 06 — LET AN ADMIN ACTUALLY VERIFY AN INSTRUCTOR
-- ###########################################################################
--
-- 04 said only the service role may move an instructor to 'verified'. Correct
-- at the time: role was a column the client could write, so "admin" was a
-- claim a browser could make about itself.
--
-- 05 changed that. profiles.role is now set when the account is created and
-- immutable from the client, so a browser can no longer claim 'admin' and a
-- trigger may now believe it. That turns /admin from a screen that lists
-- pending instructors into one that can act on them.
--
-- NOBODY VERIFIES THEMSELVES, STILL. An admin who is also an instructor may
-- not touch their own row: the person checking the ADI number against the RSA
-- register has to be a different person from the one it belongs to.

-- ---------------------------------------------------------------------------
-- Is the caller a platform admin?
--
-- security definer so it can read profiles regardless of that table's own
-- policies, and so a recursive policy check cannot deadlock it.
-- ---------------------------------------------------------------------------
create or replace function public.is_platform_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
     where id = auth.uid()
       and role in ('admin', 'super_admin')
  );
$$;

-- ---------------------------------------------------------------------------
-- The verification rule, with the admin case added
-- ---------------------------------------------------------------------------
create or replace function public.enforce_verification_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Server-side callers are trusted.
  if coalesce(auth.role(), 'service_role') = 'service_role' then
    return new;
  end if;

  -- An admin may decide anyone's verification but their own.
  if public.is_platform_admin() and new.user_id is distinct from auth.uid() then
    -- verified_at follows the status rather than being sent by the client, so
    -- a mis-set clock or a forgotten field can't produce a verified profile
    -- with no date on it, or a date with no verification behind it.
    if new.verification_status = 'verified'
       and old.verification_status is distinct from 'verified' then
      new.verified_at := now();
    elsif new.verification_status <> 'verified' then
      new.verified_at := null;
      new.listed := false;
    end if;
    return new;
  end if;

  -- Everyone else: the instructor themselves, including an admin on their own
  -- row. The one move they may make is submitting for review.
  if new.verification_status is distinct from old.verification_status then
    if old.verification_status in ('draft', 'rejected')
       and new.verification_status = 'pending' then
      return new;
    end if;

    raise exception 'verification_status cannot be changed from the client'
      using errcode = 'insufficient_privilege';
  end if;

  if new.verified_at is distinct from old.verified_at then
    raise exception 'verified_at is set by the platform'
      using errcode = 'insufficient_privilege';
  end if;

  if new.listed and new.verification_status <> 'verified' then
    raise exception 'only a verified instructor can be listed'
      using errcode = 'insufficient_privilege';
  end if;

  return new;
end $$;

drop trigger if exists instructor_profiles_enforce_verification on public.instructor_profiles;
create trigger instructor_profiles_enforce_verification
  before update on public.instructor_profiles
  for each row execute function public.enforce_verification_change();

-- An admin needs to see a pending instructor in order to review one.
drop policy if exists instructor_admin_all on public.instructor_profiles;
create policy instructor_admin_all on public.instructor_profiles
  for all using (public.is_platform_admin())
  with check (public.is_platform_admin());

-- An admin also needs the instructor's email, to tell them the outcome. It
-- lives on auth.users, which no browser role can read.
--
-- So this view does NOT use security_invoker. It runs as its owner, which is
-- how it can reach auth.users at all — and that means row-level security on
-- instructor_profiles does not apply to it either. A view that bypasses RLS
-- and is granted to every signed-in account would hand each of them every
-- instructor's email, so the gate has to be inside the view itself.
--
-- is_platform_admin() in the WHERE clause is that gate. For anyone else the
-- predicate is false and the view is empty — not an error, just nothing.
drop view if exists public.instructor_review cascade;
create view public.instructor_review as
  select i.*, u.email
    from public.instructor_profiles i
    join auth.users u on u.id = i.user_id
   where public.is_platform_admin();

grant select on public.instructor_review to authenticated;


-- ###########################################################################
-- ### 07 — ONE ACCOUNT CAN BE BOTH
-- ###########################################################################

-- ===========================================================================
-- ONE ACCOUNT CAN BE BOTH
--
-- sql/05 gave an account exactly one role, fixed at sign-up and immutable
-- from the browser. That fixed a real hole — the device used to decide which
-- product you were — but it answered it too hard: a learner who later
-- qualifies as an ADI had to abandon their email, and an instructor who
-- wanted to look at the theory material could not.
--
-- Both of those are ordinary. The same person learns, teaches, and sends
-- their own kids through the test.
--
-- WHAT CHANGES, AND WHAT DOES NOT
--
-- role becomes roles: a set rather than a single value. An account can hold
-- 'student', 'instructor', both, or either plus 'admin'.
--
-- The client may add and remove 'student' and 'instructor' on its own row.
-- That is not a loosening: both were always self-service. Anyone could
-- already create an account at either door, so granting yourself a side you
-- could have signed up for grants nothing you did not have.
--
-- 'admin' and 'super_admin' stay exactly as locked as they were. A client
-- that tries to add one is refused, and one that quietly drops an existing
-- one is refused too — demoting an admin is as much a privileged act as
-- promoting one.
--
-- And verification is untouched. Holding 'instructor' means you can open the
-- portal. It has never meant your ADI number has been checked, and sql/06
-- still says a person does that.
--
-- profiles.role is kept and maintained from roles, so anything still reading
-- it — is_platform_admin(), older code — keeps working.
--
-- Run sql/03 to sql/06 first. Safe to run twice.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. The column
-- ---------------------------------------------------------------------------
alter table public.profiles
  add column if not exists roles text[];

-- Backfill from the single role each account already has. Runs once; after
-- that roles is set and this changes nothing.
update public.profiles
   set roles = array[coalesce(role, 'student')]
 where roles is null;

alter table public.profiles
  alter column roles set default array['student'],
  alter column roles set not null;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'profiles_roles_check') then
    alter table public.profiles
      add constraint profiles_roles_check
      check (
        array_length(roles, 1) between 1 and 4
        and roles <@ array['student', 'instructor', 'admin', 'super_admin']::text[]
      );
  end if;
end $$;

create index if not exists profiles_roles_idx on public.profiles using gin (roles);

-- ---------------------------------------------------------------------------
-- 2. Helpers
-- ---------------------------------------------------------------------------
create or replace function public.privileged_roles(r text[])
returns text[]
language sql
immutable
as $$
  select coalesce(
    array(select unnest(r) intersect select unnest(array['admin', 'super_admin'])),
    '{}'::text[]
  );
$$;

-- The one value profiles.role is allowed to be, given the set. Most
-- privileged wins, so an admin who also teaches still reads as an admin.
create or replace function public.primary_role(r text[])
returns text
language sql
immutable
as $$
  select case
    when 'super_admin' = any(r) then 'super_admin'
    when 'admin'       = any(r) then 'admin'
    when 'instructor'  = any(r) then 'instructor'
    else 'student'
  end;
$$;

-- ---------------------------------------------------------------------------
-- 3. What a client may do to its own roles
--
-- Add or drop 'student' and 'instructor' freely. Touch 'admin' or
-- 'super_admin' — in either direction — and the write is refused.
--
-- Replaces sql/05's enforce_profile_role, which made the role immutable.
-- ---------------------------------------------------------------------------
create or replace function public.enforce_profile_roles()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  meta jsonb;
  requested text;
begin
  -- Server-side callers are trusted: the SQL editor, a migration, an Edge
  -- Function with the service key.
  if coalesce(auth.role(), 'service_role') = 'service_role' then
    -- A trusted caller who writes the OLD single column meant it. Every
    -- instruction written before this file says `set role = 'admin'`, and
    -- deriving role from roles unconditionally would quietly undo that
    -- write: roles is unchanged, so role snaps back and the update appears
    -- to do nothing at all. The intent is folded into the set instead.
    if TG_OP = 'UPDATE'
       and new.role is distinct from old.role
       and new.roles is not distinct from old.roles then
      new.roles := array(select distinct unnest(new.roles || array[new.role]));
    end if;

    new.role := public.primary_role(new.roles);
    return new;
  end if;

  if TG_OP = 'INSERT' then
    -- A new row gets the side it registered at, and nothing else, whatever
    -- the client sent.
    select raw_user_meta_data into meta from auth.users where id = new.id;
    requested := public.requested_role(meta);
    new.roles := array[requested];
    new.role  := requested;
    return new;
  end if;

  -- The sign-up trigger, writing the side it was given. See sql/05.
  if coalesce(current_setting('pdt.applying_signup_role', true), 'off') = 'on' then
    new.role := public.primary_role(new.roles);
    return new;
  end if;

  -- Nothing privileged may be gained...
  if public.privileged_roles(new.roles) <> public.privileged_roles(old.roles) then
    raise exception
      'admin roles cannot be changed from the client'
      using errcode = 'insufficient_privilege';
  end if;

  -- ...and at least one side has to remain, or the account can open nothing.
  if coalesce(array_length(new.roles, 1), 0) = 0 then
    raise exception 'an account must keep at least one side'
      using errcode = 'check_violation';
  end if;

  -- role is derived, never sent.
  new.role := public.primary_role(new.roles);
  return new;
end $$;

drop trigger if exists profiles_enforce_role_change on public.profiles;
drop trigger if exists profiles_enforce_role on public.profiles;
drop trigger if exists profiles_enforce_roles on public.profiles;
create trigger profiles_enforce_roles
  before insert or update on public.profiles
  for each row execute function public.enforce_profile_roles();

-- ---------------------------------------------------------------------------
-- 4. The sign-up trigger writes the set
--
-- Replaces sql/05's version, which wrote the single column.
-- ---------------------------------------------------------------------------
create or replace function public.apply_signup_role()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform set_config('pdt.applying_signup_role', 'on', true);

  begin
    insert into public.profiles (id) values (new.id) on conflict (id) do nothing;
  exception when others then
    null;
  end;

  update public.profiles
     set roles = array[public.requested_role(new.raw_user_meta_data)]
   where id = new.id
     and public.privileged_roles(roles) = '{}'::text[];

  perform set_config('pdt.applying_signup_role', 'off', true);
  return new;
end $$;

-- ---------------------------------------------------------------------------
-- 5. Anyone who already has an instructor profile keeps the learner side too
--
-- They had it before sql/05 split the two, and taking it away now would be a
-- regression nobody asked for.
-- ---------------------------------------------------------------------------
do $$
begin
  if to_regclass('public.instructor_profiles') is not null then
    update public.profiles p
       set roles = array(select distinct unnest(p.roles || array['instructor']))
     where exists (select 1 from public.instructor_profiles i where i.user_id = p.id)
       and not ('instructor' = any(p.roles));
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 6. Granting an admin, which is still only possible from here
--
--   update public.profiles
--      set roles = array(select distinct unnest(roles || array['admin']))
--    where id = (select id from auth.users where email = 'you@example.com');
--
-- Taking it back:
--
--   update public.profiles
--      set roles = array(select unnest(roles) except select 'admin')
--    where id = (select id from auth.users where email = 'you@example.com');
--
-- Who holds what:
--
--   select u.email, p.roles
--     from public.profiles p join auth.users u on u.id = p.id
--    order by u.email;
-- ---------------------------------------------------------------------------


-- ###########################################################################
-- ### 08 — THE NUMBERS ON THE ADMIN DASHBOARD
-- ###########################################################################

-- ===========================================================================
-- THE NUMBERS ON THE ADMIN DASHBOARD
--
-- The tiles have been blank since the portal was built, because there was no
-- honest way to fill them: row-level security lets an account read its own
-- profile row and no one else's, so a browser counting profiles counts to
-- one. Inventing a figure was never an option — the numbers on an admin
-- screen are the ones decisions get made on.
--
-- WHY A FUNCTION AND NOT A POLICY
--
-- The obvious alternative is an admin policy on profiles granting select over
-- every row. That works, and it hands every admin session the whole user
-- table — every email, every name — to compute four integers with. A
-- security-definer function returns the four integers instead. Counting
-- people does not require being able to read them.
--
-- The gate is the WHERE clause: is_platform_admin() is false for everyone
-- else, so the function returns no rows rather than an error. Nothing is
-- leaked by its existence.
--
-- Needs sql/04 (instructor_profiles), sql/06 (is_platform_admin) and sql/07
-- (profiles.roles). Safe to run twice.
-- ===========================================================================

create or replace function public.admin_stats()
returns table (
  learners             bigint,
  instructors          bigint,
  verified_instructors bigint,
  pending_review       bigint,
  admins               bigint
)
language sql
stable
security definer
set search_path = public
as $$
  select
    (select count(*) from public.profiles
      where 'student' = any(roles)),
    (select count(*) from public.profiles
      where 'instructor' = any(roles)),
    (select count(*) from public.instructor_profiles
      where verification_status = 'verified'),
    (select count(*) from public.instructor_profiles
      where verification_status = 'pending'),
    (select count(*) from public.profiles
      where roles && array['admin', 'super_admin']::text[])
  where public.is_platform_admin();
$$;

revoke all on function public.admin_stats() from public, anon;
grant execute on function public.admin_stats() to authenticated;


-- ###########################################################################
-- ### 09 — ENQUIRIES
-- ###########################################################################

-- ===========================================================================
-- ENQUIRIES — THE FIRST THING THAT CROSSES BETWEEN THE TWO SIDES
--
-- Until now the two products have been separate: a learner studies, an
-- instructor gets verified, and nothing passes between them. The verified
-- card has been telling instructors "your profile is visible to learners"
-- while no screen anywhere listed one. This is the table that makes that
-- sentence true.
--
-- WHAT AN ENQUIRY IS
--
-- A learner saw a verified instructor in their county and asked about
-- lessons. It is not a booking: no time, no money, no commitment on either
-- side. Booking needs a calendar and availability, neither of which exists,
-- and inventing half of it here would be worse than the gap.
--
-- WHO SEES WHAT
--
--   the learner      their own enquiries, and may withdraw one
--   the instructor   enquiries addressed to them, and may answer or decline
--   an admin         all of them, for disputes
--   anyone else      nothing
--
-- A learner's phone number is in here. That is the point of the thing — an
-- instructor cannot ring back without it — but it means this table is the
-- first place on the platform holding one person's contact details for
-- another person to read, so the policies below are the whole file.
--
-- THE INSTRUCTOR HAS TO BE VERIFIED
--
-- Enforced in the insert policy, not just in the UI. A learner can only
-- enquire with someone the marketplace would show them, which is the same
-- rule sql/04 uses for who is listed at all. Otherwise a crafted request
-- could reach an instructor whose ADI number was never checked.
--
-- Needs sql/04 and sql/07. Safe to run twice.
-- ===========================================================================

create table if not exists public.instructor_enquiries (
  id uuid primary key default gen_random_uuid(),

  learner_id    uuid not null references auth.users (id) on delete cascade,
  instructor_id uuid not null references auth.users (id) on delete cascade,

  -- What the learner said, and how to reach them back.
  message       text,
  learner_name  text,
  learner_phone text,

  -- Where they are, so an instructor can tell at a glance whether it is
  -- anywhere near them without opening it.
  area          text,

  status     text not null default 'new',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'enquiry_status_check') then
    alter table public.instructor_enquiries
      add constraint enquiry_status_check
      check (status in ('new', 'answered', 'declined', 'withdrawn'));
  end if;
end $$;

-- One open enquiry per learner per instructor. Without this, a tap that
-- double-fires or an impatient learner becomes two rows an instructor has to
-- read twice.
create unique index if not exists enquiry_one_open_per_pair
  on public.instructor_enquiries (learner_id, instructor_id)
  where status in ('new', 'answered');

create index if not exists enquiry_instructor_idx
  on public.instructor_enquiries (instructor_id, status, created_at desc);

drop trigger if exists instructor_enquiries_touch on public.instructor_enquiries;
create trigger instructor_enquiries_touch
  before update on public.instructor_enquiries
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Row-level security
-- ---------------------------------------------------------------------------
alter table public.instructor_enquiries enable row level security;

drop policy if exists enquiry_learner_select on public.instructor_enquiries;
create policy enquiry_learner_select on public.instructor_enquiries
  for select using (auth.uid() = learner_id);

drop policy if exists enquiry_instructor_select on public.instructor_enquiries;
create policy enquiry_instructor_select on public.instructor_enquiries
  for select using (auth.uid() = instructor_id);

-- A learner may only write their own, and only to someone the marketplace
-- would have shown them.
drop policy if exists enquiry_learner_insert on public.instructor_enquiries;
create policy enquiry_learner_insert on public.instructor_enquiries
  for insert with check (
    auth.uid() = learner_id
    and exists (
      select 1 from public.instructor_profiles i
       where i.user_id = instructor_id
         and i.verification_status = 'verified'
         and i.listed = true
    )
  );

-- Either side may move it along; nobody may hand it to someone else.
drop policy if exists enquiry_learner_update on public.instructor_enquiries;
create policy enquiry_learner_update on public.instructor_enquiries
  for update using (auth.uid() = learner_id)
  with check (auth.uid() = learner_id);

drop policy if exists enquiry_instructor_update on public.instructor_enquiries;
create policy enquiry_instructor_update on public.instructor_enquiries
  for update using (auth.uid() = instructor_id)
  with check (auth.uid() = instructor_id);

drop policy if exists enquiry_admin_all on public.instructor_enquiries;
create policy enquiry_admin_all on public.instructor_enquiries
  for all using (public.is_platform_admin())
  with check (public.is_platform_admin());

-- The learner and the instructor may each only set the statuses that are
-- theirs to set: a learner withdraws, an instructor answers or declines.
-- Neither can mark the other's intent.
create or replace function public.enforce_enquiry_status()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if coalesce(auth.role(), 'service_role') = 'service_role'
     or public.is_platform_admin() then
    return new;
  end if;

  if new.status is distinct from old.status then
    if auth.uid() = old.learner_id and new.status not in ('withdrawn') then
      raise exception 'a learner may withdraw an enquiry, nothing else'
        using errcode = 'insufficient_privilege';
    end if;
    if auth.uid() = old.instructor_id and new.status not in ('answered', 'declined') then
      raise exception 'an instructor may answer or decline an enquiry'
        using errcode = 'insufficient_privilege';
    end if;
  end if;

  -- Neither side rewrites what the learner said, or who it was for.
  if new.learner_id is distinct from old.learner_id
     or new.instructor_id is distinct from old.instructor_id
     or new.message is distinct from old.message then
    raise exception 'an enquiry cannot be rewritten'
      using errcode = 'insufficient_privilege';
  end if;

  return new;
end $$;

drop trigger if exists instructor_enquiries_status on public.instructor_enquiries;
create trigger instructor_enquiries_status
  before update on public.instructor_enquiries
  for each row execute function public.enforce_enquiry_status();

-- ---------------------------------------------------------------------------
-- The counts on the instructor's dashboard
--
-- Same shape and same reason as admin_stats: an instructor may read the
-- enquiries addressed to them, so this is only saving round trips, but it
-- keeps the dashboard to one call.
-- ---------------------------------------------------------------------------
-- Dropped first, not replaced. This file is re-runnable, and by the time it
-- is run a second time section 10 below has usually already widened this
-- function to five columns. A function's OUT parameters are its return type,
-- so `create or replace` would stop with `42P13: cannot change return type
-- of existing function` — narrowing is refused exactly as widening is.
-- Section 10 widens it again a few hundred lines down, in this same
-- transaction, so nothing is left narrow.
drop function if exists public.instructor_stats();

create function public.instructor_stats()
returns table (new_enquiries bigint, open_enquiries bigint)
language sql
stable
security definer
set search_path = public
as $$
  select
    (select count(*) from public.instructor_enquiries
      where instructor_id = auth.uid() and status = 'new'),
    (select count(*) from public.instructor_enquiries
      where instructor_id = auth.uid() and status in ('new', 'answered'))
  where auth.uid() is not null;
$$;

revoke all on function public.instructor_stats() from public, anon;
grant execute on function public.instructor_stats() to authenticated;


-- ###########################################################################
-- ### 10 — STUDENTS AND LESSONS
-- ###########################################################################

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
-- sql/09 above created this with two columns. A function's OUT parameters
-- are its return type, and Postgres will not let `create or replace` change
-- one — it stops with `42P13: cannot change return type of existing
-- function`. So the old one goes first.
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


-- ###########################################################################
-- ### 11 — AVAILABILITY
-- ###########################################################################
--
-- The hours an instructor works, the days they are off, and the terms they
-- book on. The last piece before a learner can request a lesson: the booking
-- itself has to be decided on the server, where two people cannot race each
-- other into the same 11:00, and this is what that will read.

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


-- ###########################################################################
-- ### 12 — BOOKINGS
-- ###########################################################################
--
-- A learner picks one of the hours above and asks for it. Two of them cannot
-- get the same one: an exclusion constraint makes an overlap something the
-- database is unable to store, and a security definer function checks the
-- hours, the time off, the notice, the buffer and the calendar inside the
-- same transaction. Nothing writes this table from the browser.

-- Needed for the exclusion constraint below: it mixes an equality test on a
-- uuid with an overlap test on a range, and plain gist cannot index the uuid.
create extension if not exists btree_gist;

-- ---------------------------------------------------------------------------
-- 0. A table called `bookings` that is not this one
--
-- `create table if not exists` is silent when the name is taken. It does not
-- check that the existing table is the one described below — it just does
-- nothing and lets the next statement fail, which is what happened here:
--
--   ERROR: 42703: column "status" does not exist
--   CONTEXT: alter table public.bookings add constraint bookings_status_check
--
-- Something else in this database already owned the name. The constraint was
-- the first statement to notice, three hundred lines after the real problem,
-- and the message said nothing about it.
--
-- So the name is checked properly before anything is built on it.
--
--   Empty and the wrong shape  -> dropped and rebuilt. Nothing can be lost
--                                 from a table with no rows in it.
--   Has rows and the wrong shape -> stop, and say exactly what to look at.
--                                 Dropping somebody's data to make a
--                                 migration pass is never the right trade,
--                                 and quietly bolting our columns onto their
--                                 table would be worse: two meanings of
--                                 "booking" sharing one row.
-- ---------------------------------------------------------------------------
do $$
declare
  v_rows bigint;
  v_ours int;
begin
  if to_regclass('public.bookings') is null then
    return;                       -- nothing there; the create below does it all
  end if;

  select count(*) into v_ours
    from information_schema.columns
   where table_schema = 'public' and table_name = 'bookings'
     and column_name in ('instructor_id', 'learner_id', 'starts_at', 'status');

  if v_ours = 4 then
    return;                       -- already ours, from an earlier run
  end if;

  execute 'select count(*) from public.bookings' into v_rows;

  if v_rows = 0 then
    raise notice
      'A different, empty table called public.bookings was in the way. Replacing it.';
    execute 'drop table public.bookings cascade';
    return;
  end if;

  raise exception
    'public.bookings already exists, holds % row(s), and is not the table this file builds. '
    'Nothing has been changed. Look at what it is:  '
    'select column_name, data_type from information_schema.columns '
    'where table_schema = ''public'' and table_name = ''bookings'' order by ordinal_position;  '
    'If it is not needed, drop it and run this file again. If it is, rename it first '
    '(alter table public.bookings rename to bookings_old;) and move the data across by hand.',
    v_rows;
end $$;

-- ---------------------------------------------------------------------------
-- 1. The table
-- ---------------------------------------------------------------------------
create table if not exists public.bookings (
  id uuid primary key default gen_random_uuid(),

  instructor_id uuid not null references auth.users (id) on delete cascade,
  learner_id    uuid not null references auth.users (id) on delete cascade,

  -- Set when the instructor accepts: the student row this learner became,
  -- and the lesson that now sits in the calendar.
  student_id uuid references public.instructor_students (id) on delete set null,
  lesson_id  uuid references public.lessons (id) on delete set null,

  starts_at        timestamptz not null,
  duration_minutes int not null default 60,
  -- Stored, not computed on the fly. The exclusion constraint below has to
  -- index this range, and an index expression must be IMMUTABLE: adding an
  -- interval to a timestamptz is only STABLE, because how many hours a day
  -- contains depends on the session's timezone. So the end is worked out
  -- once by a trigger and kept, and the constraint indexes two plain
  -- columns, which is immutable. Postgres refuses the alternative outright:
  --   ERROR: functions in index expression must be marked IMMUTABLE
  ends_at          timestamptz,
  kind             text not null default 'lesson',

  status text not null default 'requested',
  -- Why it was declined or cancelled, in the words of whoever did it.
  resolution_note text,
  resolved_at     timestamptz,

  -- Copied from the instructor's rate at the moment of the request, because
  -- a price that moves after someone agrees to it is not a price.
  price_cents int,

  pickup text,
  note   text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'bookings_status_check') then
    alter table public.bookings add constraint bookings_status_check
      check (status in ('requested', 'accepted', 'declined', 'cancelled', 'expired'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'bookings_duration_check') then
    alter table public.bookings add constraint bookings_duration_check
      check (duration_minutes between 30 and 300);
  end if;
end $$;

create index if not exists bookings_instructor_idx on public.bookings (instructor_id, starts_at);
create index if not exists bookings_learner_idx    on public.bookings (learner_id, starts_at);
create index if not exists bookings_status_idx     on public.bookings (status, starts_at);

-- ends_at is derived, never sent. Keeping it in one place means it cannot
-- disagree with the start and duration it comes from.
create or replace function public.set_booking_end()
returns trigger
language plpgsql
as $$
begin
  new.ends_at := new.starts_at + make_interval(mins => new.duration_minutes);
  return new;
end $$;

drop trigger if exists bookings_set_end on public.bookings;
create trigger bookings_set_end
  before insert or update of starts_at, duration_minutes on public.bookings
  for each row execute function public.set_booking_end();

-- Backfill, for a table created before this column existed.
update public.bookings
   set ends_at = starts_at + make_interval(mins => duration_minutes)
 where ends_at is null;

drop trigger if exists bookings_touch on public.bookings;
create trigger bookings_touch
  before update on public.bookings
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- 2. THE GUARANTEE
--
-- One instructor cannot hold two live bookings that overlap in time. Only
-- 'requested' and 'accepted' count as live: a declined or cancelled booking
-- releases its hour, which is the whole point of declining one.
--
-- Written as a constraint rather than a check inside the function because a
-- function can be bypassed and a constraint cannot. Two transactions that
-- both pass every test in the function will still have one of them refused
-- here, and that refusal is what makes the slot list honest.
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'bookings_no_overlap') then
    alter table public.bookings
      add constraint bookings_no_overlap
      exclude using gist (
        instructor_id with =,
        tstzrange(starts_at, ends_at) with &&
      )
      where (status in ('requested', 'accepted'));
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 3. Who may see what
--
-- The two people involved, and an admin. A booking holds a learner's name,
-- their pickup address and when they will be standing at it; that is not
-- marketplace data and it is not public in any form.
-- ---------------------------------------------------------------------------
alter table public.bookings enable row level security;

drop policy if exists bookings_mine_select on public.bookings;
create policy bookings_mine_select on public.bookings
  for select using (learner_id = auth.uid() or instructor_id = auth.uid());

-- Nobody writes this table directly. Every change goes through one of the
-- functions below, which is what keeps the rules in one place. There is
-- deliberately no insert or update policy for the client.
drop policy if exists bookings_admin_all on public.bookings;
create policy bookings_admin_all on public.bookings
  for all using (public.is_platform_admin())
  with check (public.is_platform_admin());

-- ---------------------------------------------------------------------------
-- 4. Requesting one
--
-- Everything a slot has to satisfy, in the order that gives the most useful
-- refusal. The caller is always the learner — auth.uid() — so there is no
-- way to book on someone else's behalf.
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
    -- sql/11 backfills a row for everyone with a profile, but an instructor
    -- created between the two is not the learner's problem.
    insert into public.instructor_booking_rules (instructor_id) values (p_instructor)
      returning * into v_rules;
  end if;

  if not v_rules.accepting then
    raise exception 'That instructor has paused new bookings' using errcode = 'check_violation';
  end if;

  v_minutes := v_rules.lesson_minutes;
  v_buffer  := v_rules.travel_buffer_minutes;
  v_end     := p_starts_at + (v_minutes || ' minutes')::interval;

  -- Notice and horizon, against the instructor's terms.
  if p_starts_at < now() + (v_rules.min_notice_hours || ' hours')::interval then
    raise exception 'That is sooner than % hours'' notice', v_rules.min_notice_hours
      using errcode = 'check_violation';
  end if;

  if p_starts_at > now() + (v_rules.max_days_ahead || ' days')::interval then
    raise exception 'That instructor only takes bookings % days ahead', v_rules.max_days_ahead
      using errcode = 'check_violation';
  end if;

  -- Everything below is about the instructor's own local day, so the instant
  -- is converted once, here, and the pieces read off it.
  v_local := p_starts_at at time zone 'Europe/Dublin';

  if exists (
    select 1 from public.instructor_time_off t
     where t.instructor_id = p_instructor
       and v_local::date between t.starts_on and t.ends_on
  ) then
    raise exception 'That instructor is off that day' using errcode = 'check_violation';
  end if;

  -- The whole lesson has to sit inside one block of working hours. Spanning
  -- two blocks would mean driving through the lunch break between them.
  -- Minutes from midnight, not times. Casting `23:30 + 1 hour` back to a
  -- time gives 00:30, which compares as earlier than every end time and
  -- would wave a midnight booking through a nine-to-five day.
  if not exists (
    select 1 from public.instructor_hours h
     where h.instructor_id = p_instructor
       and h.weekday = extract(dow from v_local)
       and extract(epoch from h.starts_at) / 60 <= extract(epoch from v_local::time) / 60
       and extract(epoch from h.ends_at)   / 60 >= extract(epoch from v_local::time) / 60 + v_minutes
  ) then
    raise exception 'That is outside their working hours' using errcode = 'check_violation';
  end if;

  -- Serialise every request for this instructor for the rest of the
  -- transaction. Without it two callers interleave between the checks below
  -- and the insert; with it the second one waits, re-reads, and is refused
  -- properly instead of racing. The exclusion constraint would catch the
  -- booking-against-booking case anyway, but not booking-against-lesson,
  -- which lives in another table.
  perform pg_advisory_xact_lock(hashtextextended(p_instructor::text, 0));

  -- Against the instructor's own calendar, buffer included on both sides.
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

  -- And against other live requests, buffer included. The constraint covers
  -- the bare overlap; this covers the buffer around it, and says so in words.
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

  -- One open request per learner per instructor at a time, so a misfiring
  -- button cannot fill someone's inbox.
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
-- 5. Accepting one
--
-- This is where a request becomes a lesson. The learner becomes a student of
-- this instructor if they are not one already — reusing the row rather than
-- creating a second one for the same person, which is how a student list
-- fills up with duplicates.
--
-- Marked 'marketplace' as its source, because that distinction is what the
-- fee rests on: students the instructor already had are free, forever.
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

-- ---------------------------------------------------------------------------
-- 6. Declining and cancelling
--
-- Declining is the instructor's; cancelling is either side's. Both free the
-- hour immediately — the exclusion constraint only counts live bookings — so
-- a declined slot is offerable again the moment it is declined.
-- ---------------------------------------------------------------------------
create or replace function public.decline_booking(p_booking uuid, p_reason text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_b public.bookings%rowtype;
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

  update public.bookings
     set status = 'declined', resolution_note = nullif(trim(p_reason), ''), resolved_at = now()
   where id = p_booking;
end $$;

revoke all on function public.decline_booking(uuid, text) from public, anon;
grant execute on function public.decline_booking(uuid, text) to authenticated;

create or replace function public.cancel_booking(p_booking uuid, p_reason text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_b public.bookings%rowtype;
begin
  select * into v_b from public.bookings where id = p_booking for update;
  if not found then
    raise exception 'No such booking' using errcode = 'no_data_found';
  end if;
  if auth.uid() not in (v_b.instructor_id, v_b.learner_id) then
    raise exception 'That is not your booking' using errcode = 'insufficient_privilege';
  end if;
  if v_b.status not in ('requested', 'accepted') then
    raise exception 'That booking is already %', v_b.status using errcode = 'check_violation';
  end if;

  -- An accepted booking has a lesson in the instructor's calendar. Cancelling
  -- the booking has to cancel that too, or the hour stays blocked and the
  -- instructor is left deleting a lesson for someone who already cancelled.
  if v_b.lesson_id is not null then
    update public.lessons set status = 'cancelled' where id = v_b.lesson_id;
  end if;

  update public.bookings
     set status = 'cancelled', resolution_note = nullif(trim(p_reason), ''), resolved_at = now()
   where id = p_booking;
end $$;

revoke all on function public.cancel_booking(uuid, text) from public, anon;
grant execute on function public.cancel_booking(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 7. The slots, decided by the database
--
-- The browser computes a slot list so a learner sees something instantly.
-- This is the same question answered where it counts, and it is what the
-- booking screen reads before it offers anything. The two agreeing is not
-- relied on: request_booking checks again, inside the transaction.
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
begin
  if not exists (
    select 1 from public.instructor_profiles
     where user_id = p_instructor and verification_status = 'verified' and listed = true
  ) then
    return;
  end if;

  select * into v_rules from public.instructor_booking_rules where instructor_id = p_instructor;
  if not found or not v_rules.accepting then
    return;
  end if;

  v_minutes := v_rules.lesson_minutes;
  v_buffer  := v_rules.travel_buffer_minutes;

  return query
  with days as (
    select (p_from + offs)::date as d
      from generate_series(0, greatest(least(p_days, 60), 1) - 1) as offs
  ),
  candidates as (
    select
      days.d                                                          as day,
      (days.d + h.starts_at + (n * interval '30 minutes'))            as local_start,
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
     -- Compared as minutes from midnight, not as times. A block starting at
     -- 17:00 plus 24 half-hour steps reaches past midnight, and `::time`
     -- wraps there without complaining — 00:30 would read as earlier than
     -- every end time and every slot after midnight would pass. Staying on
     -- the same local day, and comparing plain numbers, has no such edge.
     where local_start::date = day
       and extract(epoch from local_start::time) / 60 + v_minutes
           <= extract(epoch from ends_at) / 60
  )
  select at
    from fitting
   where at >= now() + (v_rules.min_notice_hours || ' hours')::interval
     and at <= now() + (v_rules.max_days_ahead || ' days')::interval
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
-- 8. The dashboard count
--
-- Replaces sql/10's version, adding pending booking requests. Dropped first
-- for the same reason as every other time: OUT parameters are the return
-- type and `create or replace` may not change one.
-- ---------------------------------------------------------------------------
drop function if exists public.instructor_stats();

create function public.instructor_stats()
returns table (
  new_enquiries   bigint,
  open_enquiries  bigint,
  active_students bigint,
  lessons_today   bigint,
  lessons_week    bigint,
  booking_requests bigint
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
        and starts_at <  now() + interval '7 days'),
    (select count(*) from public.bookings
      where instructor_id = auth.uid()
        and status = 'requested'
        and starts_at >= now())
  where auth.uid() is not null;
$$;

revoke all on function public.instructor_stats() from public, anon;
grant execute on function public.instructor_stats() to authenticated;


-- ###########################################################################
-- ### 13 — REVIEWS AND MESSAGES
-- ###########################################################################
--
-- A review may only be written by someone who completed a lesson with that
-- instructor, enforced by a trigger rather than by the app. An instructor may
-- reply once and may not edit. No average is published until there are enough
-- reviews for one to mean anything. Messages hang off a booking, so there is
-- no inbox to spam and no way to contact a stranger.

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

-- ###########################################################################
-- ### 14 — EVERY INSTRUCTOR GETS BOOKING RULES
-- ###########################################################################
--
-- A backfill is not a default. sql/11 gave a booking-rules row to every
-- instructor who existed when it ran, and open_slots gave up when the row
-- was missing — so anyone verified afterwards was permanently unbookable,
-- silently. A trigger now creates the row, and open_slots falls back on the
-- declared defaults rather than returning nothing.

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
