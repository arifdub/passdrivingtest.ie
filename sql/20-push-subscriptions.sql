-- ===========================================================================
-- WHERE A PHONE SAYS "SEND IT HERE"
--
-- Web push works by the browser handing you an endpoint URL and two keys.
-- You post an encrypted payload to that URL; the browser vendor's server
-- wakes the device and hands it to a service worker. The device does not
-- have to have the site open. That is the whole difference between this and
-- everything built so far.
--
-- ONE ROW PER DEVICE, NOT PER PERSON
--
-- The same instructor has a phone and a laptop, and each produces its own
-- subscription. Keying on the person would mean the last device to allow
-- notifications silently turns off every other one.
--
-- THE ENDPOINT IS THE IDENTITY
--
-- A browser re-issues the same endpoint for the same device and site, so the
-- endpoint is the natural key. Re-subscribing updates rather than piling up
-- duplicates, which is what would otherwise happen every time somebody
-- cleared their data and allowed notifications again.
--
-- WHAT IS IN HERE IS NOT A SECRET, AND IS STILL NOT PUBLIC
--
-- The keys are per-device public material: holding them lets you encrypt a
-- payload for that device, and the VAPID private key — which lives only in
-- the Vercel environment — is what proves it came from this site. Still,
-- the endpoint says which push service a person uses and roughly when they
-- installed, so the policies below are the usual: your own rows, nobody
-- else's, and no public select at all.
--
-- Safe to run twice.
-- ===========================================================================

create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,

  -- The URL to POST to. Unique: a device re-subscribing replaces itself.
  endpoint text not null unique,

  -- The two keys the payload is encrypted with, as the browser gives them.
  p256dh text not null,
  auth   text not null,

  -- For "you have 3 devices getting these", and for cleaning up later.
  user_agent text,

  created_at timestamptz not null default now(),
  last_used_at timestamptz
);

create index if not exists push_subscriptions_user_idx
  on public.push_subscriptions (user_id);

alter table public.push_subscriptions enable row level security;

-- Your own devices. There is deliberately no public select: nothing about
-- this table is useful to anybody but its owner and the sender.
drop policy if exists push_own_all on public.push_subscriptions;
create policy push_own_all on public.push_subscriptions
  for all using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- Saving one
--
-- A function rather than a bare upsert, because the endpoint is unique
-- across ALL users: two people sharing a device, or one person signing out
-- and another signing in, produce the same endpoint for a different account.
-- A plain insert would hit the unique constraint and fail; an upsert on
-- endpoint alone would quietly leave the row pointing at whoever got there
-- first. This takes the row over, which is right — the device belongs to
-- whoever is signed in on it now.
-- ---------------------------------------------------------------------------
create or replace function public.save_push_subscription(
  p_endpoint text,
  p_p256dh   text,
  p_auth     text,
  p_user_agent text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'not signed in' using errcode = 'insufficient_privilege';
  end if;

  insert into public.push_subscriptions (user_id, endpoint, p256dh, auth, user_agent)
  values (auth.uid(), p_endpoint, p_p256dh, p_auth, left(p_user_agent, 300))
  on conflict (endpoint) do update
    set user_id    = auth.uid(),
        p256dh     = excluded.p256dh,
        auth       = excluded.auth,
        user_agent = excluded.user_agent,
        created_at = now();
end $$;

revoke all on function public.save_push_subscription(text, text, text, text) from public, anon;
grant execute on function public.save_push_subscription(text, text, text, text) to authenticated;

create or replace function public.delete_push_subscription(p_endpoint text)
returns void
language sql
security definer
set search_path = public
as $$
  delete from public.push_subscriptions
   where endpoint = p_endpoint and user_id = auth.uid();
$$;

revoke all on function public.delete_push_subscription(text) from public, anon;
grant execute on function public.delete_push_subscription(text) to authenticated;

-- ---------------------------------------------------------------------------
-- Turning them off without unsubscribing the device
--
-- Separate from email_notifications: somebody may want an email and not a
-- buzz at nine on a Sunday, or the other way round.
-- ---------------------------------------------------------------------------
alter table public.profiles
  add column if not exists push_notifications boolean not null default true;
