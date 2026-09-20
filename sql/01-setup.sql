-- ===========================================================================
--  PassDrivingTest.ie — complete database setup
--
--  Run this ONCE, in a brand new Supabase project:
--      Supabase dashboard -> SQL Editor -> New query -> paste -> Run
--
--  It is safe to run again; everything is create-if-not-exists or
--  create-or-replace.
--
--  This is the whole schema in one file rather than the chain of migrations
--  the ADI project accumulated. A new project has no history to preserve, so
--  it gets the finished shape directly — including the six-argument
--  record_result, which over there had to be retrofitted after the four
--  argument version was found to be overwriting correct verdicts.
--
--  The two sites are separate entities and MUST NOT share a Supabase project.
--  Both apps use tables called `profiles` and `progress` and a function called
--  `record_result`, and both write module ids into the same column. Pointed at
--  one database they would silently read each other's rows.
-- ===========================================================================


-- ---------------------------------------------------------------------------
-- 1. Profiles
--
--    One row per signed-in learner. The app reads this to greet them and to
--    check subscription state; it is deliberately tolerant of the row being
--    missing (a missing profile must never lock somebody out of studying),
--    but the trigger below means it normally exists from the moment they
--    sign up.
-- ---------------------------------------------------------------------------
create table if not exists public.profiles (
  id                  uuid primary key references auth.users (id) on delete cascade,
  email               text,
  full_name           text,
  subscription_status text        not null default 'active',
  subscription_plan   text        not null default 'free-access',
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

alter table public.profiles enable row level security;

-- Each learner sees and edits only their own row. Written as three separate
-- policies rather than one `for all`, so that a future change to, say, the
-- insert rule cannot silently widen select as well.
drop policy if exists "profiles are self-readable"  on public.profiles;
drop policy if exists "profiles are self-insertable" on public.profiles;
drop policy if exists "profiles are self-updatable"  on public.profiles;

create policy "profiles are self-readable"
  on public.profiles for select using (auth.uid() = id);
create policy "profiles are self-insertable"
  on public.profiles for insert with check (auth.uid() = id);
create policy "profiles are self-updatable"
  on public.profiles for update using (auth.uid() = id) with check (auth.uid() = id);


-- ---------------------------------------------------------------------------
-- 2. Create the profile row on sign-up
--
--    security definer because it runs as the auth system inserting into a
--    table protected by RLS. search_path is pinned: a security definer
--    function that resolves names through a caller-controlled search_path is
--    the classic way to hand somebody else your privileges.
-- ---------------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, full_name)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'full_name', '')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();


-- ---------------------------------------------------------------------------
-- 3. Progress
--
--    One row per learner per module, where a module is a section, a mock
--    paper or a flashcard deck.
--
--    completed_ids is every question id the learner has answered, so the app
--    can show coverage ("how much of this have I seen") separately from
--    accuracy ("how well am I doing"). They are different questions and a
--    single percentage answers neither.
-- ---------------------------------------------------------------------------
create table if not exists public.progress (
  user_id       uuid        not null references auth.users (id) on delete cascade,
  module_id     text        not null,
  best_pct      int         not null default 0,
  last_pct      int         not null default 0,
  last_score    int         not null default 0,
  last_total    int         not null default 0,
  attempts      int         not null default 0,
  correct_count int         not null default 0,
  graded_count  int         not null default 0,
  passed        boolean     not null default false,
  completed_ids text[]      not null default '{}',
  last_sections jsonb       not null default '[]'::jsonb,
  updated_at    timestamptz not null default now(),
  primary key (user_id, module_id)
);

alter table public.progress enable row level security;

drop policy if exists "progress is self-readable"   on public.progress;
drop policy if exists "progress is self-insertable" on public.progress;
drop policy if exists "progress is self-updatable"  on public.progress;
drop policy if exists "progress is self-deletable"  on public.progress;

create policy "progress is self-readable"
  on public.progress for select using (auth.uid() = user_id);
create policy "progress is self-insertable"
  on public.progress for insert with check (auth.uid() = user_id);
create policy "progress is self-updatable"
  on public.progress for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "progress is self-deletable"
  on public.progress for delete using (auth.uid() = user_id);

create index if not exists progress_user_idx on public.progress (user_id);


-- ---------------------------------------------------------------------------
-- 4. record_result
--
--    Recording a finished test. Called by the app instead of an upsert so the
--    counters are incremented server-side in one statement — two devices
--    finishing a test at the same moment can't read-modify-write over each
--    other.
--
--    p_passed exists because the server cannot always judge a pass itself. For
--    the theory test the rule is 35 of 40, which is simple enough — but the
--    client already holds the verdict and the same client code runs against
--    the ADI app, where the rule is per-section and an overall percentage
--    gives the wrong answer. The function believes the caller when told, and
--    falls back to comparing against the pass mark when not.
-- ---------------------------------------------------------------------------
create or replace function public.record_result(
  p_module_id text,
  p_score     int,
  p_total     int,
  p_pass_mark int     default 88,
  p_passed    boolean default null,
  p_sections  jsonb   default null
)
returns public.progress
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_pct      int;
  v_passed   boolean;
  v_sections jsonb;
  v_row      public.progress;
begin
  if p_total <= 0 then
    raise exception 'total must be greater than zero';
  end if;

  v_pct := round((p_score::numeric / p_total::numeric) * 100);

  v_passed := coalesce(p_passed, v_pct >= p_pass_mark);

  -- Must be an array. Anything else is dropped rather than stored, so a bad
  -- payload cannot wedge the progress screen.
  v_sections := case
    when p_sections is null then null
    when jsonb_typeof(p_sections) = 'array' then p_sections
    else null
  end;

  insert into public.progress as pr
        (user_id,    module_id,   best_pct, last_pct, last_score, last_total,
         attempts, correct_count, graded_count, passed,   last_sections)
  values (auth.uid(), p_module_id, v_pct,    v_pct,    p_score,    p_total,
          1,        p_score,       p_total,      v_passed, coalesce(v_sections, '[]'::jsonb))
  on conflict (user_id, module_id) do update
    set best_pct      = greatest(pr.best_pct, excluded.best_pct),
        last_pct      = excluded.last_pct,
        last_score    = excluded.last_score,
        last_total    = excluded.last_total,
        attempts      = pr.attempts + 1,
        correct_count = pr.correct_count + excluded.correct_count,
        graded_count  = pr.graded_count + excluded.graded_count,
        passed        = pr.passed or excluded.passed,
        -- Only overwrite when this attempt carried a breakdown, so a section
        -- practice does not wipe the last mock's data.
        last_sections = case
          when v_sections is null then pr.last_sections
          else excluded.last_sections
        end,
        updated_at    = now()
  returning * into v_row;

  return v_row;
end;
$$;

grant execute on function public.record_result(text, int, int, int, boolean, jsonb) to authenticated;


-- ---------------------------------------------------------------------------
-- 5. Check it worked
--
--    Run this afterwards. Three rows, and record_result showing six arguments.
-- ---------------------------------------------------------------------------
-- select 'profiles' as object,
--        (select count(*) from information_schema.tables
--          where table_schema = 'public' and table_name = 'profiles') as present
-- union all
-- select 'progress',
--        (select count(*) from information_schema.tables
--          where table_schema = 'public' and table_name = 'progress')
-- union all
-- select 'record_result args',
--        (select count(*) from information_schema.parameters p
--           join information_schema.routines r
--             on r.specific_name = p.specific_name
--          where r.routine_schema = 'public' and r.routine_name = 'record_result');
