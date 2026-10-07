-- ===========================================================================
-- LET AN ADMIN ACTUALLY VERIFY AN INSTRUCTOR
--
-- sql/04 says only the service role may move an instructor to 'verified', and
-- that nothing from a browser may. Correct at the time: role was a column the
-- client could write, so "admin" was a claim a browser could make about
-- itself, and trusting it would have meant any learner could verify anyone.
--
-- sql/05 changed that. profiles.role is now set when the account is created
-- and immutable from the client; 'admin' can only be granted server-side, in
-- the SQL editor or by an Edge Function with the service key. A browser can
-- no longer claim it, so a trigger may now believe it.
--
-- Which turns the admin portal from a screen that lists pending instructors
-- into one that can act on them. The alternative was leaving verification as
-- a hand-written UPDATE in the SQL editor — the shape of thing that is fine
-- for the first instructor and wrong by the tenth.
--
-- NOBODY VERIFIES THEMSELVES, STILL
--
-- An admin who is also an instructor may not touch their own row. That is the
-- same rule as before, not a weakening of it: the person checking the ADI
-- number against the RSA register has to be a different person from the one
-- it belongs to, or the badge means nothing again. An admin needing their own
-- ADI verified asks another admin, or runs the UPDATE at the foot of sql/04.
--
-- Safe to run twice.
-- ===========================================================================

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
-- The verification rule, restated
--
-- Replaces the function sql/04 installed. The trigger name is unchanged, so
-- running this file is all that is needed.
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

-- ---------------------------------------------------------------------------
-- An admin needs to see a pending instructor to review one
--
-- sql/04's instructor_admin_all policy already grants this. It is restated
-- here through the helper so both halves of "who is an admin" read the same,
-- and so this file is complete on its own.
-- ---------------------------------------------------------------------------
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

-- ---------------------------------------------------------------------------
-- Making the first admin
--
-- There is no client path to this, by design. Run it here:
--
--   update public.profiles set role = 'admin'
--    where id = (select id from auth.users where email = 'you@example.com');
--
-- Then sign out and back in — the role is read when the session loads.
-- ---------------------------------------------------------------------------
