-- ===========================================================================
-- SEPARATE LEARNER AND INSTRUCTOR ACCOUNTS
--
-- THE PROBLEM THIS FIXES
--
-- Until now one account opened both portals. Someone who registered at /adi
-- could sign in at /student and vice versa, because the only thing deciding
-- which product you saw was a value in localStorage that the browser owns and
-- anyone can edit. "Which of the two are you?" was a device preference.
--
-- It has to be a property of the account:
--
--   · an instructor's portal shows a learner's phone number and address once
--     bookings exist. A learner's progress is the learner's.
--   · "Verified ADI" has to mean something. If any account can walk into the
--     instructor side, the badge is decoration.
--   · the door someone registered at is the one honest answer available.
--     Nobody signs up to be a driving instructor by accident.
--
-- HOW IT IS ENFORCED
--
-- profiles.role already exists (sql/03). What is new here is that the CLIENT
-- CAN NO LONGER WRITE IT. Three triggers:
--
--   1. on auth.users insert   — the role is taken from the sign-up metadata,
--                               which the app sets from the door used
--   2. before insert on profiles — same, for a row the app creates itself
--   3. before update on profiles — the role is immutable from the browser
--
-- Before this, sql/03's trigger let a client move freely between 'student'
-- and 'instructor'. That was deliberate then — the front door set the role —
-- and it is exactly what now has to stop, or the separation is a suggestion.
--
-- Changing a role is a server-side act from here on: the SQL editor, or an
-- Edge Function with the service key. See the bottom of this file.
--
-- Safe to run twice.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. What role does a sign-up ask for?
--
-- The app passes { role: 'student' | 'instructor' } in the sign-up metadata.
-- Anything else, including a missing value and including someone hand-crafting
-- a request that says 'admin', becomes 'student'. Elevation stays server-side.
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
-- Written defensively: this project's profiles row may be created by a trigger
-- that predates this file, or by the app on first write. Rather than assume
-- which, and rather than guess the table's NOT NULL columns, it tries an
-- id-only insert, shrugs if that is not possible, and then sets the role on
-- whichever row ends up existing.
-- ---------------------------------------------------------------------------
create or replace function public.apply_signup_role()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
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
-- Everyone who signed up before this file has role 'student', because that is
-- sql/03's default — including anyone who registered as an instructor, since
-- back then the role was pushed up from the browser and may never have
-- arrived. Anyone who got as far as starting an instructor profile is an
-- instructor; that is evidence, not a guess.
-- ---------------------------------------------------------------------------
update public.profiles p
   set role = 'instructor'
 where p.role = 'student'
   and exists (select 1 from public.instructor_profiles i where i.user_id = p.id);

-- ---------------------------------------------------------------------------
-- 5. Changing a role by hand
--
-- The only way, now, and that is the point. Replace the email and run:
--
--   update public.profiles set role = 'instructor'
--    where id = (select id from auth.users where email = 'you@example.com');
--
--   update public.profiles set role = 'admin'
--    where id = (select id from auth.users where email = 'you@example.com');
--
-- Check who is what:
--
--   select u.email, p.role
--     from public.profiles p join auth.users u on u.id = p.id
--    order by p.role, u.email;
-- ---------------------------------------------------------------------------
