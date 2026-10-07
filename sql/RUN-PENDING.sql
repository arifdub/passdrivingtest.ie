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
-- This is sql/04 + sql/05 + sql/06 in order. Those files remain the originals;
-- this one is for pasting.
--
-- AFTERWARDS — make yourself an admin. There is no client path to it:
--
--   update public.profiles set role = 'admin'
--    where id = (select id from auth.users where email = 'you@example.com');
--
-- then sign out and back in, because the role is read when the session loads.
-- That replaces whatever role the account had, so use a different email if you
-- also want to be an instructor.
--
-- AND CHECK IT:
--
--   select u.email, p.role
--     from public.profiles p join auth.users u on u.id = p.id
--    order by p.role, u.email;
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

drop trigger if exists on_auth_user_created_apply_role on auth.users;
create trigger on_auth_user_created_apply_role
  after insert on auth.users
  for each row execute function public.apply_signup_role();

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
