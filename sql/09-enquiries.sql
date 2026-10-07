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
