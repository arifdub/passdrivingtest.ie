# Email notifications — what you have to do

Everything else in this repo runs when you paste SQL. This one piece cannot:
it needs an email provider's key, and a key is yours, not mine.

Until it is done, nothing breaks. `notify_async` sees an unconfigured
endpoint and returns silently, so bookings, messages and enquiries all work
exactly as they do now — they just do not send email. That is deliberate: a
missing notification must never be an error on the write that triggered it.

## 1. Get a Resend key

https://resend.com — free tier is 3,000 emails a month, which is plenty.
Verify your domain if you want mail from `noreply@passdrivingtest.ie`;
until then Resend's `onboarding@resend.dev` works for testing.

## 2. Deploy the function

```sh
npm install -g supabase            # if you haven't
supabase login
supabase link --project-ref zwwtmvolghcoopicznwa

supabase secrets set RESEND_API_KEY=re_your_key_here
supabase secrets set NOTIFY_FROM="PassDrivingTest <onboarding@resend.dev>"
supabase secrets set NOTIFY_SECRET=$(openssl rand -hex 32)   # keep this
supabase secrets set NOTIFY_SITE=https://passdrivingtest.ie

supabase functions deploy notify
```

Keep the `NOTIFY_SECRET` value — step 3 needs the same one.

## 3. Point the database at it

In the SQL editor:

```sql
update public.notify_config set
  endpoint = 'https://zwwtmvolghcoopicznwa.supabase.co/functions/v1/notify',
  secret   = 'the same NOTIFY_SECRET from step 2',
  enabled  = true;
```

## 4. Check it

Send yourself an enquiry from a second account, then:

```sql
select status_code, created from net._http_response order by created desc limit 5;
```

`200` means it reached the function. If the email still does not arrive, the
function's own logs say why:

```sh
supabase functions logs notify
```

## Why it is shaped this way

**The database never waits for an email.** `pg_net` queues the request and
returns; the worker sends it after the transaction commits. A booking is
written whether or not Resend answers. The alternative — an HTTP call inside
the transaction — means a learner loses their lesson because a mail provider
had a bad afternoon.

**The payload is a kind and a row id. Never an address.** The function reads
the row with the service key and works out who to tell. An endpoint that
emails whoever it is asked to is an open relay with a nice URL, and this one
is reachable from the internet. The `x-notify-secret` header is a second
lock on the same door.

**Instructors can turn it off.** `profiles.email_notifications`, default on,
because somebody who has never seen the setting still wants to know a learner
booked them.

## What this is still not

Push notifications. A phone with the app closed learns nothing from either
realtime or email-on-arrival — email lands in an inbox, which is a different
and slower thing from a phone buzzing. Real push needs a service worker, a
push subscription and VAPID keys, and it is not built.
