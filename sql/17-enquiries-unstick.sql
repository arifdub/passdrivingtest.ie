-- ===========================================================================
-- AN ENQUIRY YOU CANNOT ANSWER, DECLINE OR DELETE
--
-- THE BUG ON SCREEN
--
--   a learner may withdraw an enquiry, nothing else
--
-- shown to an INSTRUCTOR, on an enquiry addressed to them, when they tapped
-- "Just answered". So the enquiry stayed 'new' for ever, and the 1 on the
-- Enquiries tile stayed with it — the count was right, it was the enquiry
-- that could not be moved.
--
-- WHY
--
-- sql/07 made one account able to hold both sides, and sql/09's trigger was
-- written before that. It asks "is the caller the learner?" first:
--
--   if auth.uid() = old.learner_id and new.status not in ('withdrawn') ...
--   if auth.uid() = old.instructor_id and new.status not in ('answered'...
--
-- When the same account is both — which is exactly what happens the first
-- time anybody tests their own listing — the learner branch matches first
-- and refuses, and the instructor branch is never reached. The rule was
-- right; the order was wrong.
--
-- Checking the instructor first is the correct order regardless of that
-- bug: on an enquiry addressed to you, the thing you are doing IS
-- instructing, whatever else the account also is.
--
-- AND TWO THINGS THAT WERE MISSING
--
-- request_booking refuses to let you book yourself. Nothing stopped you
-- enquiring with yourself, so the first thing a new instructor does to see
-- how their listing looks creates a row that then gets stuck. New ones are
-- refused now; the one already there is still answerable, because the
-- ordering fix above covers it.
--
-- And there was no delete policy at all. A test enquiry, a duplicate, a row
-- somebody wants gone — there was no way. Either party may now delete one.
--
-- Needs sql/09. Safe to run twice.
-- ===========================================================================

do $$
begin
  if to_regclass('public.instructor_enquiries') is null then
    raise exception 'Run sql/09-enquiries.sql before this file.';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 1. The instructor's rule wins on their own enquiry
-- ---------------------------------------------------------------------------
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
    -- INSTRUCTOR FIRST. An account can be both sides (sql/07), and on an
    -- enquiry addressed to you the thing you are doing is instructing.
    -- Asking the learner question first refused the instructor their own
    -- inbox.
    if auth.uid() = old.instructor_id then
      if new.status not in ('answered', 'declined') then
        raise exception 'an instructor may answer or decline an enquiry'
          using errcode = 'insufficient_privilege';
      end if;
    elsif auth.uid() = old.learner_id then
      if new.status <> 'withdrawn' then
        raise exception 'a learner may withdraw an enquiry, nothing else'
          using errcode = 'insufficient_privilege';
      end if;
    else
      raise exception 'that enquiry is not yours'
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
-- 2. You cannot enquire with yourself
--
-- The same rule request_booking already has. Existing rows are left alone:
-- this only refuses new ones, and section 1 makes the existing ones
-- answerable.
-- ---------------------------------------------------------------------------
drop policy if exists enquiry_learner_insert on public.instructor_enquiries;
create policy enquiry_learner_insert on public.instructor_enquiries
  for insert with check (
    auth.uid() = learner_id
    and learner_id <> instructor_id
    and exists (
      select 1 from public.instructor_profiles i
       where i.user_id = instructor_id
         and i.verification_status = 'verified'
         and i.listed = true
    )
  );

-- ---------------------------------------------------------------------------
-- 3. Somebody can delete one
--
-- Either party, and an admin. Deleting is not the same as declining —
-- declining is an answer the learner can see, deleting is "this should not
-- be in my list". Both are wanted, and until now only the first existed.
-- ---------------------------------------------------------------------------
drop policy if exists enquiry_delete on public.instructor_enquiries;
create policy enquiry_delete on public.instructor_enquiries
  for delete using (
    auth.uid() in (learner_id, instructor_id)
    or public.is_platform_admin()
  );
