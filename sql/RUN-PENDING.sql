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
-- This is sql/04 through sql/10 in order. Those files remain the originals;
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
create or replace function public.instructor_stats()
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
create or replace view public.student_progress
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
create or replace function public.instructor_stats()
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
