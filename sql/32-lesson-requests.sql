-- ===========================================================================
-- LESSON REQUESTS — a learner posts what they need, instructors answer
--
-- The directory works when there is an instructor near you with open hours.
-- When there isn't, a learner had nowhere to go. Now they can leave their
-- details — where they are, what kind of lesson, their level, whose car,
-- when suits — and every verified instructor can see the post and message
-- them about it.
--
-- WHAT IS SHARED, AND WITH WHOM
--
-- A post shows instructors the learner's FIRST NAME and the details they
-- typed. Never their email or phone: the first contact is a message inside
-- the app, and the learner decides whether to hand over a number.
--
-- Only verified instructors can read the board (open_lesson_requests) or
-- start a conversation. A learner can reply in a conversation an instructor
-- started, but cannot message instructors out of nowhere through this —
-- that is what the directory's enquiry and booking are for.
--
-- THE PIECES
--
--   lesson_requests        the posts. A learner sees and edits their own.
--   request_messages       one thread per (post, instructor).
--   post_lesson_request()  validates and posts; at most 3 open at once.
--   open_lesson_requests() the board, for verified instructors.
--   send_request_message() both sides write through this.
--   my_request_threads()   the conversation list, for either side.
--   mark_request_thread_read()
--
-- A post closes itself after 30 days, or when the learner closes it.
--
-- Needs sql/19 (notify_async) and sql/04. Safe to run twice.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. The posts
-- ---------------------------------------------------------------------------
create table if not exists public.lesson_requests (
  id           uuid primary key default gen_random_uuid(),
  learner_id   uuid not null references auth.users (id) on delete cascade,
  first_name   text not null,
  county       text not null,
  area         text,
  lesson_kind  text not null default 'lesson',
  level        smallint,
  car          text,
  gearbox      text,
  availability text,
  note         text,
  status       text not null default 'open',
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  expires_at   timestamptz not null default now() + interval '30 days'
);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'lesson_requests_status_check') then
    alter table public.lesson_requests add constraint lesson_requests_status_check
      check (status in ('open', 'closed'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'lesson_requests_level_check') then
    alter table public.lesson_requests add constraint lesson_requests_level_check
      check (level is null or level between 1 and 4);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'lesson_requests_car_check') then
    alter table public.lesson_requests add constraint lesson_requests_car_check
      check ((car is null or car in ('instructor', 'own'))
         and (gearbox is null or gearbox in ('manual', 'automatic')));
  end if;
end $$;

create index if not exists lesson_requests_open_idx
  on public.lesson_requests (county, created_at desc) where status = 'open';
create index if not exists lesson_requests_learner_idx
  on public.lesson_requests (learner_id, created_at desc);

alter table public.lesson_requests enable row level security;

-- A learner reads, closes and deletes their own. Posting goes through
-- post_lesson_request, so there is no insert policy.
drop policy if exists lesson_requests_own_select on public.lesson_requests;
create policy lesson_requests_own_select on public.lesson_requests
  for select using (learner_id = auth.uid());

drop policy if exists lesson_requests_own_update on public.lesson_requests;
create policy lesson_requests_own_update on public.lesson_requests
  for update using (learner_id = auth.uid()) with check (learner_id = auth.uid());

drop policy if exists lesson_requests_own_delete on public.lesson_requests;
create policy lesson_requests_own_delete on public.lesson_requests
  for delete using (learner_id = auth.uid());

-- ---------------------------------------------------------------------------
-- 2. The conversations
-- ---------------------------------------------------------------------------
create table if not exists public.request_messages (
  id            uuid primary key default gen_random_uuid(),
  request_id    uuid not null references public.lesson_requests (id) on delete cascade,
  instructor_id uuid not null references auth.users (id) on delete cascade,
  sender_id     uuid not null references auth.users (id) on delete cascade,
  body          text not null,
  read_at       timestamptz,
  created_at    timestamptz not null default now()
);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'request_messages_body_check') then
    alter table public.request_messages add constraint request_messages_body_check
      check (length(btrim(body)) between 1 and 2000);
  end if;
end $$;

create index if not exists request_messages_thread_idx
  on public.request_messages (request_id, instructor_id, created_at);
create index if not exists request_messages_instructor_idx
  on public.request_messages (instructor_id, created_at desc);

alter table public.request_messages enable row level security;

-- The two people in the thread. Writing goes through send_request_message.
drop policy if exists request_messages_party_select on public.request_messages;
create policy request_messages_party_select on public.request_messages
  for select using (
    instructor_id = auth.uid()
    or exists (select 1 from public.lesson_requests r
                where r.id = request_id and r.learner_id = auth.uid())
  );

-- ---------------------------------------------------------------------------
-- 3. Posting
-- ---------------------------------------------------------------------------
create or replace function public.post_lesson_request(
  p_county       text,
  p_area         text,
  p_kind         text,
  p_level        int,
  p_car          text,
  p_gearbox      text,
  p_availability text,
  p_note         text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me    uuid := auth.uid();
  v_first text;
  v_id    uuid;
begin
  if v_me is null then
    raise exception 'Sign in to post a lesson request' using errcode = 'insufficient_privilege';
  end if;
  if length(btrim(coalesce(p_county, ''))) < 2 then
    raise exception 'Choose your county' using errcode = 'check_violation';
  end if;
  if p_level is null or p_level not between 1 and 4 then
    raise exception 'Choose your driving level' using errcode = 'check_violation';
  end if;
  if p_car is null or p_car not in ('instructor', 'own') then
    raise exception 'Choose the instructor''s car or your own' using errcode = 'check_violation';
  end if;
  if p_gearbox is null or p_gearbox not in ('manual', 'automatic') then
    raise exception 'Choose manual or automatic' using errcode = 'check_violation';
  end if;
  if length(coalesce(p_area, '')) > 80 or length(coalesce(p_availability, '')) > 200
     or length(coalesce(p_note, '')) > 600 then
    raise exception 'That is a bit long — keep it shorter' using errcode = 'check_violation';
  end if;

  if (select count(*) from public.lesson_requests
       where learner_id = v_me and status = 'open' and expires_at > now()) >= 3 then
    raise exception 'You already have 3 requests up. Close one before posting another.'
      using errcode = 'check_violation';
  end if;

  select split_part(btrim(coalesce(nullif(p.full_name, ''), split_part(u.email, '@', 1))), ' ', 1)
    into v_first
    from auth.users u left join public.profiles p on p.id = u.id
   where u.id = v_me;

  insert into public.lesson_requests (
    learner_id, first_name, county, area, lesson_kind, level, car, gearbox, availability, note
  ) values (
    v_me, coalesce(nullif(v_first, ''), 'Learner'), btrim(p_county), nullif(btrim(p_area), ''),
    coalesce(nullif(p_kind, ''), 'lesson'), p_level, p_car, p_gearbox,
    nullif(btrim(p_availability), ''), nullif(btrim(p_note), '')
  )
  returning id into v_id;

  return v_id;
end $$;

revoke all on function public.post_lesson_request(text, text, text, int, text, text, text, text) from public, anon;
grant execute on function public.post_lesson_request(text, text, text, int, text, text, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. The board — verified instructors only
-- ---------------------------------------------------------------------------
create or replace function public.open_lesson_requests(p_county text default null)
returns table (
  id           uuid,
  first_name   text,
  county       text,
  area         text,
  lesson_kind  text,
  level        smallint,
  car          text,
  gearbox      text,
  availability text,
  note         text,
  created_at   timestamptz,
  messaged     boolean
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not exists (select 1 from public.instructor_profiles
                  where user_id = auth.uid() and verification_status = 'verified') then
    raise exception 'Only verified instructors can see lesson requests' using errcode = 'insufficient_privilege';
  end if;

  return query
  select r.id, r.first_name, r.county, r.area, r.lesson_kind, r.level, r.car, r.gearbox,
         r.availability, r.note, r.created_at,
         exists (select 1 from public.request_messages m
                  where m.request_id = r.id and m.instructor_id = auth.uid())
    from public.lesson_requests r
   where r.status = 'open'
     and r.expires_at > now()
     and r.learner_id <> auth.uid()
     and (p_county is null or p_county = '' or r.county = p_county)
   order by r.created_at desc
   limit 200;
end $$;

revoke all on function public.open_lesson_requests(text) from public, anon;
grant execute on function public.open_lesson_requests(text) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. Writing in a thread — both sides
--
-- An instructor starts it (verified, post still open). The learner can only
-- answer a thread an instructor has started.
-- ---------------------------------------------------------------------------
create or replace function public.send_request_message(
  p_request    uuid,
  p_instructor uuid,
  p_body       text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me  uuid := auth.uid();
  v_r   public.lesson_requests%rowtype;
  v_id  uuid;
begin
  if v_me is null then
    raise exception 'Sign in first' using errcode = 'insufficient_privilege';
  end if;
  if length(btrim(coalesce(p_body, ''))) not between 1 and 2000 then
    raise exception 'Write a message first' using errcode = 'check_violation';
  end if;

  select * into v_r from public.lesson_requests where id = p_request;
  if not found then
    raise exception 'That request has been removed' using errcode = 'no_data_found';
  end if;

  if v_me = v_r.learner_id then
    if not exists (select 1 from public.request_messages
                    where request_id = p_request and instructor_id = p_instructor) then
      raise exception 'You can reply once an instructor has messaged you' using errcode = 'insufficient_privilege';
    end if;
  else
    if p_instructor is distinct from v_me then
      raise exception 'You can only write as yourself' using errcode = 'insufficient_privilege';
    end if;
    if not exists (select 1 from public.instructor_profiles
                    where user_id = v_me and verification_status = 'verified') then
      raise exception 'Only verified instructors can answer lesson requests' using errcode = 'insufficient_privilege';
    end if;
    if v_r.status <> 'open' or v_r.expires_at <= now() then
      raise exception 'That request is closed' using errcode = 'check_violation';
    end if;
  end if;

  insert into public.request_messages (request_id, instructor_id, sender_id, body)
  values (p_request, p_instructor, v_me, btrim(p_body))
  returning id into v_id;

  return v_id;
end $$;

revoke all on function public.send_request_message(uuid, uuid, text) from public, anon;
grant execute on function public.send_request_message(uuid, uuid, text) to authenticated;

create or replace function public.mark_request_thread_read(p_request uuid, p_instructor uuid)
returns void
language sql
security definer
set search_path = public
as $$
  update public.request_messages m
     set read_at = now()
   where m.request_id = p_request
     and m.instructor_id = p_instructor
     and m.read_at is null
     and m.sender_id <> auth.uid()
     and (m.instructor_id = auth.uid()
          or exists (select 1 from public.lesson_requests r
                      where r.id = m.request_id and r.learner_id = auth.uid()));
$$;

revoke all on function public.mark_request_thread_read(uuid, uuid) from public, anon;
grant execute on function public.mark_request_thread_read(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 6. The conversation list, for whichever side is asking
-- ---------------------------------------------------------------------------
create or replace function public.my_request_threads()
returns table (
  request_id    uuid,
  instructor_id uuid,
  i_am          text,
  other_name    text,
  other_photo   text,
  adi_number    text,
  lesson_kind   text,
  county        text,
  area          text,
  request_open  boolean,
  last_body     text,
  last_at       timestamptz,
  last_from_me  boolean,
  unread        int
)
language sql
stable
security definer
set search_path = public
as $$
  with mine as (
    select distinct m.request_id, m.instructor_id
      from public.request_messages m
      join public.lesson_requests r on r.id = m.request_id
     where m.instructor_id = auth.uid() or r.learner_id = auth.uid()
  )
  select t.request_id, t.instructor_id,
         case when t.instructor_id = auth.uid() then 'instructor' else 'learner' end,
         case when t.instructor_id = auth.uid() then r.first_name
              else coalesce(nullif(ip.business_name, ''), ip.full_name, 'Instructor') end,
         case when t.instructor_id = auth.uid() then null else ip.photo_url end,
         case when t.instructor_id = auth.uid() then null else ip.adi_number end,
         r.lesson_kind, r.county, r.area,
         r.status = 'open' and r.expires_at > now(),
         last.body, last.created_at, last.sender_id = auth.uid(),
         (select count(*)::int from public.request_messages u
           where u.request_id = t.request_id and u.instructor_id = t.instructor_id
             and u.read_at is null and u.sender_id <> auth.uid())
    from mine t
    join public.lesson_requests r on r.id = t.request_id
    left join public.instructor_profiles ip on ip.user_id = t.instructor_id
    cross join lateral (
      select m.body, m.created_at, m.sender_id from public.request_messages m
       where m.request_id = t.request_id and m.instructor_id = t.instructor_id
       order by m.created_at desc limit 1
    ) last
   order by last.created_at desc;
$$;

revoke all on function public.my_request_threads() from public, anon;
grant execute on function public.my_request_threads() to authenticated;

-- ---------------------------------------------------------------------------
-- 7. Telling the other side (email + push, through api/notify.js)
-- ---------------------------------------------------------------------------
create or replace function public.notify_on_request_message()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if to_regprocedure('public.notify_async(text,uuid)') is not null then
    perform public.notify_async('request_message', new.id);
  end if;
  return null;
end $$;

drop trigger if exists request_messages_notify on public.request_messages;
create trigger request_messages_notify
  after insert on public.request_messages
  for each row execute function public.notify_on_request_message();
