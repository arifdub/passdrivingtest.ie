-- ===========================================================================
-- 21. The notification call was hanging up before the answer came back
--
-- The symptom was a row in net._http_response with no status_code at all.
-- Not a 401, not a 500 — nothing. pg_net records that when the request
-- never completed, and the reason sits in error_msg, which is a column my
-- own diagnostic query forgot to select, so the rows printed as blank and
-- the cause stayed hidden for a day.
--
-- The cause is a budget mismatch between the two halves of this chain:
--
--   api/notify.js  says  maxDuration: 30      (it may take up to 30s)
--                        SMTP connect  6s
--                             greeting 6s
--                             socket  10s     (shared hosting is slow)
--   sql/19         said  timeout_milliseconds := 5000
--
-- Five seconds is less than the SMTP handshake alone is permitted, never
-- mind a cold serverless start in front of it. So pg_net gave up first,
-- every time, and logged a failure for a call that may well have been
-- working. That is the worst kind of bug: the evidence says 'broken' while
-- the thing it is measuring is merely slow.
--
-- Raised to 25s — comfortably past a cold start plus a slow mail server,
-- and still inside Vercel's 30s ceiling, so whatever the function finally
-- answers gets recorded instead of thrown away.
--
-- Nothing about this is a retry or a workaround. pg_net is still queueing
-- the call after commit, a mail failure still cannot fail a booking, and
-- the request is still fire-and-forget from the trigger's point of view.
-- The only change is how long we are willing to listen for the reply.
-- ===========================================================================

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

  -- A secret that is obviously not a secret. See sql/19 for why this guard
  -- exists; the short version is that a placeholder written as a sentence
  -- gets pasted as a value.
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
    -- 25s, not 5s. Must exceed (cold start + SMTP handshake) and stay
    -- under api/notify.js's maxDuration of 30, or we discard the answer
    -- to a question we asked.
    timeout_milliseconds := 25000
  );
exception when others then
  raise warning 'notify_async(%, %) failed: %', p_kind, p_id, sqlerrm;
end $$;

revoke all on function public.notify_async(text, uuid) from public, anon, authenticated;


-- ---------------------------------------------------------------------------
-- A diagnostic that tells the truth
--
-- Built because my ad-hoc one did not. Two rules it follows and the old one
-- broke: never build a label by concatenating a nullable column (in
-- Postgres 'x' || NULL is NULL, so the whole row goes blank), and always
-- show error_msg, because for a failed call that is the only column with
-- anything in it.
--
--   select * from public.notify_log;
-- ---------------------------------------------------------------------------
create or replace view public.notify_log as
select r.id,
       r.created                                        as at,
       r.status_code,                                   -- null = never answered
       r.timed_out,
       r.error_msg,                                     -- the reason, when null
       left(coalesce(r.content, ''), 500)               as body
  from net._http_response r
 order by r.created desc;

comment on view public.notify_log is
  'Recent outbound notification calls, newest first. A null status_code means no HTTP reply arrived — read error_msg, not body.';

revoke all on public.notify_log from public, anon, authenticated;
