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
