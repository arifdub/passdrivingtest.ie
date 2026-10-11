-- ===========================================================================
-- 26. Telling the developer, not an instructor or a learner
--
-- Two new moments worth an email, and for the first time the recipient is
-- neither of this app's two kinds of account: it is whoever runs the
-- platform. api/notify.js reads that address from ADMIN_NOTIFY_EMAIL
-- (defaulting to arifdub@gmail.com so this works with no extra Vercel
-- configuration) rather than from any row here — the database only ever
-- says WHAT happened, never WHO should hear about it off-platform.
--
--   1. new_user           — any account finishing sign-up, learner or
--                            instructor. "Finishing" matters: this fires
--                            once per profiles row, which is created once
--                            per account by sql/05's own trigger chain, not
--                            once per attempt.
--
--   2. instructor_submitted — an instructor moving their profile to
--                            'pending': the one transition sql/04 and
--                            sql/06 already treat as "ready for someone
--                            else's decision". Reused here rather than a
--                            new status, because it already IS the moment
--                            a submission becomes real — a second
--                            submission after a rejection fires it again,
--                            correctly, since that also wants a look.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. A new account, of either kind
-- ---------------------------------------------------------------------------
create or replace function public.notify_on_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform public.notify_async('new_user', new.id);
  return null;   -- AFTER trigger; the return is ignored
end $$;

revoke all on function public.notify_on_new_user() from public, anon, authenticated;

drop trigger if exists profiles_notify_new_user on public.profiles;

create trigger profiles_notify_new_user
  after insert on public.profiles
  for each row
  execute function public.notify_on_new_user();

-- ---------------------------------------------------------------------------
-- 2. An instructor submitting for review
--
-- The transition, not the state — same shape as sql/24 and sql/25's own
-- triggers, and for the same reason: without the OLD/NEW comparison, every
-- unrelated edit to an already-pending row (none exist, since only an
-- admin can move it off 'pending' and they move it to 'verified' or
-- 'rejected', never back) would be indistinguishable from a submission.
-- `is distinct from` rather than <>, because a null old status makes <>
-- null, and null is not true, and the alert would silently never send.
-- ---------------------------------------------------------------------------
create or replace function public.notify_on_instructor_submitted()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform public.notify_async('instructor_submitted', new.id);
  return null;   -- AFTER trigger; the return is ignored
end $$;

revoke all on function public.notify_on_instructor_submitted() from public, anon, authenticated;

drop trigger if exists instructor_profiles_notify_submitted on public.instructor_profiles;

create trigger instructor_profiles_notify_submitted
  after update of verification_status on public.instructor_profiles
  for each row
  when (new.verification_status = 'pending' and old.verification_status is distinct from 'pending')
  execute function public.notify_on_instructor_submitted();
