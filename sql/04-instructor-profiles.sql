-- ===========================================================================
-- INSTRUCTOR PROFILES
--
-- Everything that makes someone bookable: who they are, the ADI number that
-- proves they may teach, what they teach, where, and for how much.
--
-- ONE ROW PER INSTRUCTOR, KEYED TO THE ACCOUNT
-- profiles.role says "this person is an instructor". This table says what kind.
-- Splitting it out keeps the columns off every learner's row and gives the
-- marketplace one table to query.
--
-- THE VERIFICATION RULE, WHICH IS THE POINT OF THIS FILE
--
-- An instructor may write their own ADI number. They may NOT write the field
-- that says the number was checked. If both lived in the same place and both
-- were writable, "Verified ADI" would mean "typed their own number in", and a
-- learner handing over their card and getting into a stranger's car deserves
-- better than that.
--
-- So verification_status and verified_at are owned by the platform:
--   · the client may insert and update its own row
--   · a trigger rejects any client write that changes verification_status
--   · only the service role (an Edge Function, or an admin in the SQL editor)
--     can move someone to 'verified'
--
-- Submitting for review is the one transition an instructor may make
-- themselves: draft -> pending. Everything past that is someone else's call.
--
-- Safe to run twice.
-- ===========================================================================

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
-- Nobody verifies themselves
-- ---------------------------------------------------------------------------
create or replace function public.enforce_verification_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Server-side callers are trusted: they are the only route to 'verified'.
  if coalesce(auth.role(), 'service_role') = 'service_role' then
    return new;
  end if;

  if new.verification_status is distinct from old.verification_status then
    -- The one move an instructor may make for themselves: submit for review.
    if old.verification_status in ('draft', 'rejected')
       and new.verification_status = 'pending' then
      return new;
    end if;

    raise exception 'verification_status cannot be changed from the client'
      using errcode = 'insufficient_privilege';
  end if;

  -- Nor may they quietly backdate their own approval.
  if new.verified_at is distinct from old.verified_at then
    raise exception 'verified_at is set by the platform'
      using errcode = 'insufficient_privilege';
  end if;

  -- An unverified instructor must not be able to list themselves.
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

-- A fresh row may not arrive pre-verified either.
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

drop policy if exists instructor_admin_all on public.instructor_profiles;
create policy instructor_admin_all on public.instructor_profiles
  for all using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.role in ('admin', 'super_admin')
    )
  );

-- ---------------------------------------------------------------------------
-- Approving an instructor
--
-- There is no client path to this, by design. Run it here, or from an Edge
-- Function holding the service key, after checking the number against the
-- RSA register:
--
--   update public.instructor_profiles
--      set verification_status = 'verified',
--          verified_at = now(),
--          listed = true
--    where adi_number = '40953';
--
-- To reject, with a reason the instructor will see:
--
--   update public.instructor_profiles
--      set verification_status = 'rejected',
--          verification_notes = 'ADI number not found on the register.'
--    where adi_number = '40953';
-- ---------------------------------------------------------------------------
