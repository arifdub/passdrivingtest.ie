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
