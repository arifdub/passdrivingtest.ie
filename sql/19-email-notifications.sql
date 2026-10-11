-- ===========================================================================
-- EMAIL, WHEN THE APP IS NOT OPEN
--
-- sql/18 made the portal live while it is open. This is the other half: an
-- instructor driving all day finds out about a booking without opening
-- anything.
--
-- AN EMAIL MUST NOT BE ABLE TO LOSE A BOOKING
--
-- The obvious shape — a trigger that calls out to a mail provider — puts a
-- network request inside the transaction that writes the booking. If the
-- provider is slow the booking is slow; if it is down the booking fails. A
-- learner losing their lesson because Resend had a bad afternoon is not a
-- trade anyone would make.
--
-- pg_net does not work that way. net.http_post() queues the request and
-- returns immediately; the worker sends it after the transaction commits.
-- So the booking is written whatever happens next, and a failure loses a
-- notification, which is recoverable, rather than the thing itself.
--
-- WHAT IS SENT TO THE FUNCTION
--
-- A kind and a row id. Not an address, not a name, not a message body. The
-- function reads the row with the service key and works out who to tell —
-- because an endpoint that emails whoever it is asked to is an open relay
-- with a nice URL, and that one is reachable from the internet.
--
-- WHERE THE SECRETS LIVE
--
-- In a table only the server can read, not in this file. Nothing here goes
-- into git with a key in it: section 2 is where YOU paste them, once.
--
-- Needs sql/12, sql/13 and the `notify` Edge Function deployed.
-- Safe to run twice.
-- ===========================================================================

do $$
begin
  if to_regclass('public.booking_messages') is null then
    raise exception 'Run sql/13-reviews-and-messages.sql before this file.';
  end if;
end $$;

-- pg_net is what makes the call non-blocking. Supabase ships it; a plain
-- Postgres may not, and this file should still apply there — notify_async
-- already survives its absence, so a missing extension is a warning and not
-- a failed migration.
do $$
begin
  create extension if not exists pg_net with schema extensions;
exception when others then
  raise notice
    'pg_net is not available here (%). Everything else in this file applies; emails will not be sent until it is.',
    sqlerrm;
end $$;

-- ---------------------------------------------------------------------------
-- 1. An instructor can turn these off
--
-- Default on, because somebody who has never seen the setting still wants to
-- know a learner booked them. Off is one update away and the footer of every
-- email says where.
-- ---------------------------------------------------------------------------
alter table public.profiles
  add column if not exists email_notifications boolean not null default true;

-- ---------------------------------------------------------------------------
-- 2. Where to call, and the shared secret
--
-- PASTE YOUR VALUES HERE, then run the file. The row is readable by nobody
-- but the server: no policy is created for it and RLS is on, so PostgREST
-- returns nothing to any client, signed in or not.
-- ---------------------------------------------------------------------------
create table if not exists public.notify_config (
  id boolean primary key default true check (id),
  endpoint text not null,
  secret   text not null,
  enabled  boolean not null default true,
  updated_at timestamptz not null default now()
);

alter table public.notify_config enable row level security;
revoke all on public.notify_config from anon, authenticated;

-- Replace both values. The secret must match NOTIFY_SECRET on the function.
insert into public.notify_config (id, endpoint, secret, enabled)
values (
  true,
  'REPLACE_ME_endpoint',
  'REPLACE_ME_secret',
  false   -- flip to true once both values above are real
)
on conflict (id) do nothing;   -- never overwrites what you have already set

-- ---------------------------------------------------------------------------
-- 3. The one place that makes the call
-- ---------------------------------------------------------------------------
create or replace function public.notify_async(p_kind text, p_id uuid)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  cfg public.notify_config%rowtype;
begin
  select * into cfg from public.notify_config where id;

  -- Not configured yet, or deliberately off. Silent: a missing email must
  -- never be an error on the write that triggered it.
  if not found or not cfg.enabled or cfg.endpoint like 'REPLACE_ME%' then
    return;
  end if;

  -- A secret that is obviously not a secret.
  --
  -- The instruction for this field used to read 'the same NOTIFY_SECRET
  -- from step 3', which is a sentence that looks enough like a value to be
  -- pasted as one — and was. The request then goes out, the function
  -- refuses it with a 401, and nothing anywhere says why. Caught here
  -- instead, loudly, before a doomed call is made.
  if cfg.secret like 'REPLACE_ME%'
     or cfg.secret ~* '^(the same|paste|your|<)'
     or length(cfg.secret) < 16 then
    raise warning
      'notify_config.secret is still a placeholder (%). No notification was sent. Set it to the same NOTIFY_SECRET that is in Vercel.',
      left(cfg.secret, 30);
    return;
  end if;

  perform net.http_post(
    url     := cfg.endpoint,
    headers := jsonb_build_object(
                 'content-type', 'application/json',
                 'x-notify-secret', cfg.secret
               ),
    body    := jsonb_build_object('kind', p_kind, 'id', p_id),
    timeout_milliseconds := 5000
  );
exception when others then
  -- pg_net missing, a bad URL, anything. The row is already written and
  -- that is what matters.
  raise warning 'notify_async(%, %) failed: %', p_kind, p_id, sqlerrm;
end $$;

revoke all on function public.notify_async(text, uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. The three moments worth an email
--
-- A booking REQUEST, a message to the other party, a new enquiry. Not an
-- acceptance — the learner sees that in the app and an instructor does not
-- need emailing about their own tap.
-- ---------------------------------------------------------------------------
create or replace function public.notify_on_booking()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'requested' then
    perform public.notify_async('booking', new.id);
  end if;
  return null;   -- AFTER trigger; the return is ignored
end $$;

drop trigger if exists bookings_notify on public.bookings;
create trigger bookings_notify
  after insert on public.bookings
  for each row execute function public.notify_on_booking();

create or replace function public.notify_on_message()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform public.notify_async('message', new.id);
  return null;
end $$;

drop trigger if exists booking_messages_notify on public.booking_messages;
create trigger booking_messages_notify
  after insert on public.booking_messages
  for each row execute function public.notify_on_message();

create or replace function public.notify_on_enquiry()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform public.notify_async('enquiry', new.id);
  return null;
end $$;

drop trigger if exists instructor_enquiries_notify on public.instructor_enquiries;
create trigger instructor_enquiries_notify
  after insert on public.instructor_enquiries
  for each row execute function public.notify_on_enquiry();

-- ---------------------------------------------------------------------------
-- 5. Turning it on, after the function is deployed
--
--   update public.notify_config set
--     endpoint = 'https://zwwtmvolghcoopicznwa.supabase.co/functions/v1/notify',
--     secret   = '<the same NOTIFY_SECRET you set on the function>',
--     enabled  = true;
--
-- And to check it is reaching anything:
--
--   select id, url, status_code, created
--     from net._http_response order by created desc limit 5;
-- ---------------------------------------------------------------------------
