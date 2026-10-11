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

## 2. Your own SMTP details

The same mail server Supabase already uses for password resets. In Supabase
it is under **Authentication → Emails → SMTP Settings** — host, port and
username are shown there; the password is the mailbox password you set, and
Supabase will not show it back, so take it from your hosting control panel
if you do not have it to hand.

You need: host, port, username, password, and the address to send from.

Sending from your own server rather than a third party matters for one
practical reason beyond taste: those password resets have already taught
inboxes that mail from your domain, sent by that server, is wanted. A new
sender starts that reputation from zero, and the first thing a new sender
gets is the spam folder.

## 3. Set them in Vercel

**Settings → Environment Variables.** All of these are server-side except
the one marked `VITE_`:

| Name | Value |
|---|---|
| `SUPABASE_URL` | `https://zwwtmvolghcoopicznwa.supabase.co` |
| `SUPABASE_SERVICE_ROLE_KEY` | your **secret** key — the `sb_secret_…` one |
| `NOTIFY_SECRET` | any long random string; step 4 uses the same one |
| `SMTP_HOST` | e.g. `mail.passdrivingtest.ie` |
| `SMTP_PORT` | `465` or `587` — see below |
| `SMTP_USER` | the mailbox it signs in as |
| `SMTP_PASS` | that mailbox's password |
| `NOTIFY_FROM` | `PassDrivingTest <noreply@passdrivingtest.ie>` |
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

### 465 or 587?

Use whatever Supabase is already using — it works, so copy it.

- **465** is TLS from the first byte.
- **587** starts plain and upgrades with STARTTLS.

Getting this backwards does not produce an error. It hangs, and then the
function times out, which looks exactly like a mail server ignoring you.

If your host's certificate is issued for the hosting provider rather than
for your own domain — common on shared hosting — add
`SMTP_ALLOW_SELF_SIGNED` = `true`. The mail still travels encrypted; the
name on the certificate just is not checked.

---

## 5. Check it

Turn notifications on in the portal (Account → Get notified on this device),
then send yourself an enquiry from a second account.

```sql
select status_code, created from net._http_response order by created desc limit 5;
```

`200` means the database reached the function. If nothing arrives after
that, Vercel's function logs say why — the function returns a JSON body
reporting what happened to the email and the push separately, so you can
tell which half is broken.

### Testing without arranging a real booking

Find your own user id:

```sql
select id, email from auth.users where email = 'arifdub@gmail.com';
```

Then, from anywhere (replace both values):

```sh
curl -X POST https://passdrivingtest.ie/api/notify \
  -H "content-type: application/json" \
  -H "x-notify-secret: YOUR-NOTIFY_SECRET" \
  -d '{"kind":"test","id":"YOUR-USER-ID"}'
```

It replies with exactly what happened to the email and the push. If you
would rather not use a terminal for this either, say so — the same thing
can go behind a button in the admin panel.

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
