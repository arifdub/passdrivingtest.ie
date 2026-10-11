# Notifications — the part that needs your keys

`api/notify.js` is a Vercel serverless function. It deploys **automatically
on git push**, with the rest of the site — there is no CLI to install and no
second place to deploy to. What it needs from you is environment variables.

Until they are set, nothing breaks. `notify_async` in the database sees an
unconfigured endpoint and returns silently, so bookings, messages and
enquiries work exactly as they do now; they just do not send anything. That
is deliberate: a missing notification must never be an error on the write
that caused it.

---

## 1. Generate the VAPID keys

These are what prove a push came from this site. Run it on your own machine:

```sh
npx web-push generate-vapid-keys
```

You get a public key and a private key. The public one goes in the browser
bundle; the private one never leaves Vercel.

## 2. Get a Resend key (for email)

https://resend.com — the free tier is 3,000 emails a month. Until you verify
a domain, send from `onboarding@resend.dev`.

## 3. Set them in Vercel

**Settings → Environment Variables.** All of these are server-side except
the one marked `VITE_`:

| Name | Value |
|---|---|
| `SUPABASE_URL` | `https://zwwtmvolghcoopicznwa.supabase.co` |
| `SUPABASE_SERVICE_ROLE_KEY` | your **secret** key — the `sb_secret_…` one |
| `NOTIFY_SECRET` | any long random string; step 4 uses the same one |
| `RESEND_API_KEY` | `re_…` |
| `NOTIFY_FROM` | `PassDrivingTest <onboarding@resend.dev>` |
| `VAPID_PUBLIC_KEY` | public key from step 1 |
| `VAPID_PRIVATE_KEY` | private key from step 1 |
| `VAPID_SUBJECT` | `mailto:you@yourdomain.ie` |
| `NOTIFY_SITE` | `https://passdrivingtest.ie` |
| `VITE_VAPID_PUBLIC_KEY` | **the same public key again** |

`VITE_VAPID_PUBLIC_KEY` is the only one the browser sees, and it is meant
to: the public half is what a device subscribes with. **Never** put the
service role key or the VAPID private key in a `VITE_` variable — those are
compiled into the bundle every visitor downloads.

Vite inlines `VITE_` variables at build time, so **redeploy after adding
it** or the browser will still have the old empty value.

## 4. Point the database at it

In the Supabase SQL editor:

```sql
update public.notify_config set
  endpoint = 'https://passdrivingtest.ie/api/notify',
  secret   = 'the same NOTIFY_SECRET from step 3',
  enabled  = true;
```

## 5. Check it

Turn notifications on in the portal (Account → Get notified on this device),
then send yourself an enquiry from a second account.

```sql
select status_code, created from net._http_response order by created desc limit 5;
```

`200` means the database reached the function. If nothing arrives after
that, Vercel's function logs say why — the function returns a JSON body
reporting what happened to the email and the push separately.

---

## On iPhone, it has to be on the home screen

Safari only allows push for a site that has been **added to the home
screen**. In a browser tab the API is not refused, it is absent. The portal
detects this and says "add this to your home screen first" rather than
"not supported", because those lead to completely different actions.

## Why it is shaped this way

**The database never waits.** `pg_net` queues the request and returns; it is
sent after the transaction commits. A booking is written whether or not
Resend or a push service answers. An HTTP call inside the transaction would
mean a learner losing a lesson because a mail provider had a bad afternoon.

**The payload is a kind and a row id. Never a recipient.** The function
reads the row with the service key and works out who to tell. An endpoint
that notifies whoever it is asked to is an open relay with a nice URL, and
this one is on the public internet. `x-notify-secret` is the second lock,
and it is checked **before** anything else — an earlier version checked the
configuration first and returned a 500 naming an environment variable to
anyone who asked.

**Dead devices are pruned.** A push endpoint returning 404 or 410 means the
browser has thrown the subscription away. Those rows are deleted on the
spot, or every future send retries them for ever.

**Email and push are sent independently.** One failing does not stop the
other.
