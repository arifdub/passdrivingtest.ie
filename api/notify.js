/*
  ===========================================================================
  NOTIFY — email and push, in one place

  A Vercel serverless function. The database calls it (via pg_net, after the
  transaction commits) when something an instructor should be told about is
  written. It sends an email and a push notification to every device that
  asked for one.

  WHY HERE AND NOT A SUPABASE EDGE FUNCTION

  This site already deploys to Vercel on every push, so there is no second
  CLI to install, no second login, and no second place to remember to
  deploy. It also runs Node rather than Deno, which means `web-push` — the
  library that does VAPID signing and payload encryption properly — is just
  a dependency rather than something to hand-roll against an RFC.

  WHAT IT WILL NOT DO

  It will not take a recipient from the caller. The payload is a kind and a
  row id; this reads the row with the service key and works out who should
  be told. An endpoint that notifies whoever it is asked to is an open relay
  with a nice URL, and this one is reachable from the internet. The shared
  secret header is the second lock on the same door.

  A FAILURE HERE MUST NOT MATTER

  The row is already committed by the time this runs. Everything below is
  best effort: a dead push endpoint is deleted and the email still goes, a
  refused email does not stop the push, and nothing reports an error back to
  a learner who has already successfully booked a lesson.

  ENVIRONMENT (set in Vercel → Settings → Environment Variables)

    SUPABASE_URL                 https://<ref>.supabase.co
    SUPABASE_SERVICE_ROLE_KEY    the secret key — NEVER a VITE_ var
    NOTIFY_SECRET                any long random string; also in notify_config
    RESEND_API_KEY               re_...            (omit to skip email)
    NOTIFY_FROM                  "PassDrivingTest <noreply@yourdomain.ie>"
    VAPID_PUBLIC_KEY             from `npx web-push generate-vapid-keys`
    VAPID_PRIVATE_KEY            the other half — never in the browser
    VAPID_SUBJECT                mailto:you@yourdomain.ie
    NOTIFY_SITE                  https://passdrivingtest.ie
  ===========================================================================
*/

import { createClient } from "@supabase/supabase-js";
import webpush from "web-push";

const {
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY,
  NOTIFY_SECRET,
  RESEND_API_KEY,
  NOTIFY_FROM = "PassDrivingTest <onboarding@resend.dev>",
  VAPID_PUBLIC_KEY,
  VAPID_PRIVATE_KEY,
  VAPID_SUBJECT = "mailto:hello@passdrivingtest.ie",
  NOTIFY_SITE = "https://passdrivingtest.ie",
} = process.env;

const db = SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY
  ? createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
  : null;

const pushReady = Boolean(VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY);
if (pushReady) {
  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
}

/* ------------------------------------------------------------------------- */
/* Wording                                                                    */
/* ------------------------------------------------------------------------- */

function esc(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/* The instructor's own clock is the one that matters. */
function when(iso) {
  return new Date(iso).toLocaleString("en-IE", {
    weekday: "long", day: "numeric", month: "long",
    hour: "2-digit", minute: "2-digit", hour12: false,
    timeZone: "Europe/Dublin",
  });
}

function wrap(title, body, cta) {
  return `<!doctype html><html><body style="margin:0;background:#f1f5f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:24px 12px">
    <table role="presentation" width="100%" style="max-width:520px;background:#fff;border-radius:16px;overflow:hidden">
      <tr><td style="background:#0f172a;padding:20px 24px">
        <div style="color:#fff;font-weight:800;font-size:17px">PassDrivingTest.ie</div>
        <div style="color:#94a3b8;font-size:13px">Instructor portal</div>
      </td></tr>
      <tr><td style="padding:24px">
        <h1 style="margin:0 0 12px;font-size:19px;color:#0f172a">${esc(title)}</h1>
        ${body}
        <a href="${NOTIFY_SITE}/adi" style="display:inline-block;margin-top:20px;background:#10b981;color:#0f172a;font-weight:700;text-decoration:none;padding:12px 20px;border-radius:12px">${esc(cta)}</a>
      </td></tr>
      <tr><td style="padding:16px 24px;background:#f8fafc;color:#64748b;font-size:12px;line-height:1.5">
        You're getting this because you're an instructor on PassDrivingTest.ie.
        Turn these off under Account in the portal.
      </td></tr>
    </table>
  </td></tr></table></body></html>`;
}

async function nameOf(userId) {
  const { data: i } = await db.from("instructor_profiles")
    .select("full_name").eq("user_id", userId).maybeSingle();
  if (i?.full_name) return i.full_name;

  const { data: p } = await db.from("profiles")
    .select("full_name").eq("id", userId).maybeSingle();
  if (p?.full_name) return p.full_name;

  const { data } = await db.auth.admin.getUserById(userId);
  return data?.user?.email?.split("@")[0] || "Someone";
}

/* Reads the row and decides who to tell and what to say. Returns null when
   nobody should hear about it. */
async function compose(kind, id) {
  if (kind === "booking") {
    const { data: b } = await db.from("bookings")
      .select("id, instructor_id, learner_id, starts_at, pickup, status")
      .eq("id", id).single();
    if (!b || b.status !== "requested") return null;

    const learner = await nameOf(b.learner_id);
    return {
      to: b.instructor_id,
      go: "/adi",
      subject: `New booking request — ${when(b.starts_at)}`,
      push: { title: "New booking request", body: `${learner} — ${when(b.starts_at)}` },
      html: wrap("A learner asked for a lesson",
        `<p style="margin:0 0 8px;color:#334155;line-height:1.6"><strong>${esc(learner)}</strong> has requested <strong>${esc(when(b.starts_at))}</strong>.</p>
         ${b.pickup ? `<p style="margin:0;color:#64748b;font-size:14px">Pick-up: ${esc(b.pickup)}</p>` : ""}
         <p style="margin:12px 0 0;color:#64748b;font-size:14px">The hour is held for them until you accept or decline.</p>`,
        "Open the portal"),
    };
  }

  if (kind === "message") {
    const { data: m } = await db.from("booking_messages")
      .select("id, booking_id, sender_id, body").eq("id", id).single();
    if (!m) return null;

    const { data: b } = await db.from("bookings")
      .select("instructor_id, learner_id, starts_at").eq("id", m.booking_id).single();
    if (!b) return null;

    /* Whoever did not send it. */
    const to = m.sender_id === b.instructor_id ? b.learner_id : b.instructor_id;
    if (!to || to === m.sender_id) return null;

    const from = await nameOf(m.sender_id);
    return {
      to,
      go: to === b.instructor_id ? "/adi" : "/app",
      subject: `New message about ${when(b.starts_at)}`,
      push: { title: `${from}`, body: m.body.slice(0, 120) },
      html: wrap(`${from} sent you a message`,
        `<p style="margin:0;padding:14px;background:#f1f5f9;border-radius:12px;color:#334155;line-height:1.6">${esc(m.body)}</p>`,
        "Reply in the portal"),
    };
  }

  if (kind === "enquiry") {
    const { data: e } = await db.from("instructor_enquiries")
      .select("id, instructor_id, learner_name, area, message, status")
      .eq("id", id).single();
    if (!e || e.status !== "new") return null;

    const who = e.learner_name || "A learner";
    return {
      to: e.instructor_id,
      go: "/adi",
      subject: "New enquiry about lessons",
      push: { title: "New enquiry", body: `${who}${e.area ? ` — ${e.area}` : ""}` },
      html: wrap("A learner asked about lessons",
        `<p style="margin:0 0 8px;color:#334155;line-height:1.6"><strong>${esc(who)}</strong>${e.area ? ` in ${esc(e.area)}` : ""} got in touch.</p>
         ${e.message ? `<p style="margin:0;padding:14px;background:#f1f5f9;border-radius:12px;color:#334155;line-height:1.6">${esc(e.message)}</p>` : ""}`,
        "Open the portal"),
    };
  }

  return null;
}

/* ------------------------------------------------------------------------- */
/* Sending                                                                    */
/* ------------------------------------------------------------------------- */

async function sendEmail(userId, mail) {
  if (!RESEND_API_KEY) return { sent: false, why: "no RESEND_API_KEY" };

  const { data: p } = await db.from("profiles")
    .select("email_notifications").eq("id", userId).maybeSingle();
  /* Absent means the column or row is new: send. Somebody who has never seen
     the setting still wants to know a learner booked them. */
  if (p?.email_notifications === false) return { sent: false, why: "opted out" };

  const { data } = await db.auth.admin.getUserById(userId);
  const to = data?.user?.email;
  if (!to) return { sent: false, why: "no address" };

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { authorization: `Bearer ${RESEND_API_KEY}`, "content-type": "application/json" },
    body: JSON.stringify({ from: NOTIFY_FROM, to, subject: mail.subject, html: mail.html }),
  });

  if (!res.ok) return { sent: false, why: `resend ${res.status}: ${await res.text()}` };
  return { sent: true };
}

async function sendPush(userId, mail) {
  if (!pushReady) return { sent: 0, why: "no VAPID keys" };

  const { data: p } = await db.from("profiles")
    .select("push_notifications").eq("id", userId).maybeSingle();
  if (p?.push_notifications === false) return { sent: 0, why: "opted out" };

  const { data: subs } = await db.from("push_subscriptions")
    .select("id, endpoint, p256dh, auth").eq("user_id", userId);
  if (!subs?.length) return { sent: 0, why: "no devices" };

  const payload = JSON.stringify({
    title: mail.push.title,
    body: mail.push.body,
    url: `${NOTIFY_SITE}${mail.go}`,
  });

  let sent = 0;
  const dead = [];

  await Promise.all(subs.map(async (s) => {
    try {
      await webpush.sendNotification(
        { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
        payload,
        { TTL: 3600 },
      );
      sent++;
    } catch (e) {
      /* 404 and 410 mean the browser has thrown the subscription away —
         app uninstalled, data cleared, permission revoked. Keeping those
         rows means every future send retries a dead endpoint for ever. */
      if (e?.statusCode === 404 || e?.statusCode === 410) dead.push(s.id);
      else console.error("push failed", e?.statusCode, e?.body || e?.message);
    }
  }));

  if (dead.length) {
    await db.from("push_subscriptions").delete().in("id", dead);
  }

  return { sent, pruned: dead.length };
}

/* ------------------------------------------------------------------------- */

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "POST only" });
  }
  /* AUTHENTICATE FIRST. This ran after the configuration check, so an
     unauthenticated caller got a 500 naming an environment variable —
     telling a stranger the endpoint is real, what it is wired to, and that
     it is half set up. Nothing is read, and nothing is said, until the
     caller has proved it is the database. */
  if (NOTIFY_SECRET && req.headers["x-notify-secret"] !== NOTIFY_SECRET) {
    return res.status(401).json({ error: "no" });
  }
  if (!db) {
    console.error("SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY is not set");
    return res.status(500).json({ error: "not configured" });
  }

  const { kind, id } = req.body || {};
  if (!kind || !id) return res.status(400).json({ error: "kind and id required" });

  let mail;
  try {
    mail = await compose(kind, id);
  } catch (e) {
    console.error("compose failed", e);
    return res.status(500).json({ error: "could not read the row" });
  }
  if (!mail) return res.status(200).json({ sent: false, reason: "nothing to send" });

  /* Independently, so one failing does not take the other with it. */
  const [email, push] = await Promise.allSettled([
    sendEmail(mail.to, mail),
    sendPush(mail.to, mail),
  ]);

  return res.status(200).json({
    kind,
    email: email.status === "fulfilled" ? email.value : { error: String(email.reason) },
    push: push.status === "fulfilled" ? push.value : { error: String(push.reason) },
  });
}
