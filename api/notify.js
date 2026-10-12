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

  EMAIL GOES THROUGH YOUR OWN SMTP

  The same server that already sends the password-reset mail. That is worth
  preferring over a third-party API for a reason beyond taste: those resets
  have already taught inboxes that mail from this domain, sent by this
  server, is wanted. Sending notifications from somewhere else starts that
  reputation again from zero, and the first thing a new sender gets is the
  spam folder.

  Resend stays as a fallback purely so a project with no SMTP configured
  still works. SMTP wins whenever SMTP_HOST is set.

  ENVIRONMENT (set in Vercel → Settings → Environment Variables)

    SUPABASE_URL                 https://<ref>.supabase.co
    SUPABASE_SERVICE_ROLE_KEY    the secret key — NEVER a VITE_ var
    NOTIFY_SECRET                any long random string; also in notify_config

    SMTP_HOST                    mail.yourdomain.ie
    SMTP_PORT                    465 (implicit TLS) or 587 (STARTTLS)
    SMTP_USER                    the mailbox it signs in as
    SMTP_PASS                    its password
    NOTIFY_FROM                  "PassDrivingTest <noreply@yourdomain.ie>"

    RESEND_API_KEY               only if you have no SMTP server

    VAPID_PUBLIC_KEY             the pair that proves a push came from here
    VAPID_PRIVATE_KEY            never in the browser
    VAPID_SUBJECT                mailto:you@yourdomain.ie
    NOTIFY_SITE                  https://passdrivingtest.ie

    ADMIN_NOTIFY_EMAIL           where "a new account exists" and "an
                                  instructor wants approval" are sent.
                                  Defaults to arifdub@gmail.com so this
                                  works with no extra Vercel configuration;
                                  change the variable and redeploy to send
                                  it elsewhere — a saved environment
                                  variable does not reach an already-
                                  running function, same as every other
                                  one on this list.
  ===========================================================================
*/

import { createClient } from "@supabase/supabase-js";
import webpush from "web-push";
import nodemailer from "nodemailer";

const {
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY,
  NOTIFY_SECRET,
  RESEND_API_KEY,
  SMTP_HOST,
  SMTP_PORT = "465",
  SMTP_USER,
  SMTP_PASS,
  /* Plenty of shared hosting presents a certificate for the hosting
     provider rather than for your own domain, and nodemailer refuses it.
     This is the escape hatch for that, off unless explicitly set — the mail
     still travels encrypted, the name on the certificate just is not
     checked. */
  SMTP_ALLOW_SELF_SIGNED,
  NOTIFY_FROM = "PassDrivingTest <onboarding@resend.dev>",
  VAPID_PUBLIC_KEY,
  VAPID_PRIVATE_KEY,
  VAPID_SUBJECT = "mailto:hello@passdrivingtest.ie",
  NOTIFY_SITE = "https://passdrivingtest.ie",
  ADMIN_NOTIFY_EMAIL = "arifdub@gmail.com",
} = process.env;

const db = SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY
  ? createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
  : null;

const smtpReady = Boolean(SMTP_HOST && SMTP_USER && SMTP_PASS);

/* Built per invocation rather than held open. A serverless instance may be
   frozen between calls, and a pooled SMTP connection resumed after a freeze
   is a socket the server hung up on an hour ago — which fails as a timeout
   rather than as anything readable.

   The timeouts are deliberately shorter than the function's own limit. A
   mail server that is not answering should give up and let the push through,
   not hold the whole invocation until Vercel kills it — and shorter again
   than the window the caller in Postgres is willing to wait, or the answer
   arrives after nobody is listening. */
export function mailer() {
  const port = Number(SMTP_PORT) || 465;
  return nodemailer.createTransport({
    host: SMTP_HOST,
    port,
    /* 465 is TLS from the first byte; 587 starts plain and upgrades. Getting
       this backwards is the single most common SMTP misconfiguration and it
       presents as a hang, not an error. */
    secure: port === 465,
    requireTLS: port !== 465,
    auth: { user: SMTP_USER, pass: SMTP_PASS },
    tls: SMTP_ALLOW_SELF_SIGNED === "true"
      ? { rejectUnauthorized: false }
      : undefined,
    pool: false,
    /* These three add up to the worst case, and the worst case has to fit
       inside the 25s that sql/21 gives pg_net to wait for a reply — not
       just inside Vercel's 30s. Past that window the database records the
       call as having failed with no status code even when the mail went
       out, which is how a slow mail server came to look like a broken one.
       6 + 6 + 10 = 22s, leaving room for a cold start in front of it. */
    connectionTimeout: 6000,
    greetingTimeout: 6000,
    socketTimeout: 10000,
  });
}

/* NOT AT MODULE SCOPE.

   setVapidDetails VALIDATES the keys and throws — "Vapid public key should
   be 65 bytes long when decoded", or "Vapid subject is not a valid URL" for
   a subject missing its mailto: prefix. Called while the module loads, that
   throw happens before the handler exists, so Vercel answers
   FUNCTION_INVOCATION_FAILED and nothing in the function ever runs.
 
   Which meant one mistyped VAPID variable took down the email as well, and
   the error that came back named neither. Push failing should cost push,
   and nothing else. */
let pushState = null;

function ensurePush() {
  if (pushState) return pushState;

  if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) {
    pushState = { ready: false, why: "VAPID_PUBLIC_KEY or VAPID_PRIVATE_KEY is not set" };
    return pushState;
  }
  try {
    webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
    pushState = { ready: true };
  } catch (e) {
    /* The library's own message is exact and worth passing through: it names
       which of the three values it rejected and why. */
    pushState = { ready: false, why: `VAPID config rejected: ${e?.message || e}` };
    console.error("Push is disabled:", pushState.why);
  }
  return pushState;
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

/* The frame every notification email sits in.

   It takes `go` and `audience` because this app has two portals and both
   get email. Until now the frame hardcoded "Instructor portal", an
   instructor footer, and a button pointing at /adi — so a learner
   receiving a message about their own lesson was handed a link to the
   instructor portal, and told they were getting it because they are an
   instructor. Neither was true, and the link went somewhere they cannot
   use.

   Defaulting to the instructor keeps every existing caller behaving
   exactly as before; the learner emails pass "learner". */
/* Money, as a person writes it. price_cents because storing money as a
   float is how a lesson comes to cost 44.99999 euro. */
export function euro(cents) {
  return new Intl.NumberFormat("en-IE", { style: "currency", currency: "EUR" })
    .format((Number(cents) || 0) / 100);
}

/* The lesson's particulars, as a table rather than a paragraph.

   A table because this is reference material: a learner comes back to this
   email the night before to check the time and where they are being picked
   up, and scanning a label-and-value list beats re-reading a sentence.

   Rows are passed as [label, value] and nulls are dropped, so a caller can
   write `b.pickup ? [...] : null` inline instead of assembling an array
   first. Every value is escaped — pickup and note are typed by a person. */
export function detailTable(rows) {
  const cells = rows.filter(Boolean).map(([label, value]) => `
    <tr>
      <td style="padding:8px 12px;color:#64748b;font-size:14px;white-space:nowrap;vertical-align:top">${esc(label)}</td>
      <td style="padding:8px 12px;color:#0f172a;font-size:14px;font-weight:600">${esc(String(value))}</td>
    </tr>`).join("");

  return `<table role="presentation" width="100%" style="background:#f8fafc;border-radius:12px;border-collapse:separate;border-spacing:0">${cells}</table>`;
}

/* Three audiences, not two.

   "learner" was added for sql/23 under the assumption that anyone who
   wasn't an instructor must be a learner — true until the admin alerts
   below, which go to neither. Reusing "learner" for those would have told
   the developer they were "getting this because you booked a lesson",
   which is wrong in a way that undermines every other sentence in the
   email. A third branch, rather than a guess dressed up as one of the
   other two. */
export function wrap(title, body, cta, { go = "/adi", audience = "instructor" } = {}) {
  const kicker = { instructor: "Instructor portal", learner: "Driving lessons", guest: "Driving lessons", admin: "Admin alert" }[audience]
    || "Instructor portal";
  const footer = {
    learner: "You're getting this because you booked a lesson through PassDrivingTest.ie. Turn these off under Account in the app.",
    guest: "You're getting this because a lesson was booked on PassDrivingTest.ie with this email address. You only hear from us about bookings you make.",
    admin: "You're getting this because you're set as the admin contact for PassDrivingTest.ie. Change ADMIN_NOTIFY_EMAIL in Vercel to send it elsewhere.",
  }[audience]
    || "You're getting this because you're an instructor on PassDrivingTest.ie. Turn these off under Account in the portal.";

  return `<!doctype html><html><body style="margin:0;background:#f1f5f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:24px 12px">
    <table role="presentation" width="100%" style="max-width:520px;background:#fff;border-radius:16px;overflow:hidden">
      <tr><td style="background:#0f172a;padding:20px 24px">
        <div style="color:#fff;font-weight:800;font-size:17px">PassDrivingTest.ie</div>
        <div style="color:#94a3b8;font-size:13px">${kicker}</div>
      </td></tr>
      <tr><td style="padding:24px">
        <h1 style="margin:0 0 12px;font-size:19px;color:#0f172a">${esc(title)}</h1>
        ${body}
        <a href="${NOTIFY_SITE}${go}" style="display:inline-block;margin-top:20px;background:#10b981;color:#0f172a;font-weight:700;text-decoration:none;padding:12px 20px;border-radius:12px">${esc(cta)}</a>
      </td></tr>
      <tr><td style="padding:16px 24px;background:#f8fafc;color:#64748b;font-size:12px;line-height:1.5">
        ${footer}
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

/* Who the learner side of a booking is, and where their button goes.

   A guest booked from the instructor's own page (sql/29) with no account:
   there is no user id to look an address up from and no app to send them
   to, so the email goes to the address they typed and the button goes back
   to that instructor's page. The instructor's phone is included because a
   guest has no in-app messages to reach them with. */
async function learnerSide(b) {
  if (b.learner_id) {
    return { to: b.learner_id, go: "/student", audience: "learner", guest: false, phone: null };
  }
  const { data: i } = await db.from("instructor_profiles")
    .select("adi_number, phone").eq("user_id", b.instructor_id).maybeSingle();
  const digits = String(i?.adi_number || "").replace(/\D/g, "");
  return {
    to: undefined,
    toEmail: b.guest_email,
    go: digits ? `/adi/${digits}` : "/",
    audience: "guest",
    guest: true,
    phone: i?.phone || null,
  };
}

const GUEST_COLS = ", guest_name, guest_email, guest_phone";

/* Whose car and which gearbox (sql/30). Booking emails read the whole row,
   so they work the same before and after that file is run; a booking made
   before it simply has neither. */
export function carText(b, reader) {
  const own = reader === "instructor" ? "Learner's own car" : "Your own car";
  const theirs = reader === "instructor" ? "Your car" : "Instructor's car";
  const car = b.car === "own" ? own : b.car === "instructor" ? theirs : null;
  const box = b.gearbox === "automatic" || b.gearbox === "manual" ? b.gearbox : null;
  if (!car) return box ? box[0].toUpperCase() + box.slice(1) : null;
  return box ? `${car}, ${box}` : car;
}

/* Reads the row and decides who to tell and what to say. Returns null when
   nobody should hear about it. */
async function compose(kind, id) {
  /* A test send, so the setup can be proved without arranging a real
     booking. Same secret, same code path, same server — the only thing it
     does not exercise is the database trigger. */
  if (kind === "test") {
    return {
      to: id,
      go: "/adi",
      subject: "Notifications are working",
      push: { title: "Notifications are working", body: "This is a test from your portal." },
      html: wrap("Notifications are working",
        `<p style="margin:0;color:#334155;line-height:1.6">
           If you are reading this, your mail server and PassDrivingTest.ie
           are talking to each other. Nothing else needed.</p>`,
        "Open the portal"),
    };
  }

  if (kind === "booking") {
    const { data: b } = await db.from("bookings")
      .select("*")
      .eq("id", id).single();
    if (!b || b.status !== "requested") return null;

    const learner = b.learner_id ? await nameOf(b.learner_id) : b.guest_name;
    return {
      to: b.instructor_id,
      go: "/adi",
      subject: `New booking request — ${when(b.starts_at)}`,
      push: { title: "New booking request", body: `${learner} — ${when(b.starts_at)}` },
      html: wrap("A learner asked for a lesson",
        `<p style="margin:0 0 8px;color:#334155;line-height:1.6"><strong>${esc(learner)}</strong> has requested <strong>${esc(when(b.starts_at))}</strong>.</p>
         ${carText(b, "instructor") ? `<p style="margin:0 0 4px;color:#334155;font-size:14px">Car: <strong>${esc(carText(b, "instructor"))}</strong></p>` : ""}
         ${b.pickup ? `<p style="margin:0;color:#64748b;font-size:14px">Pick-up: ${esc(b.pickup)}</p>` : ""}
         ${b.learner_id ? "" : `<p style="margin:8px 0 0;color:#64748b;font-size:14px">Booked from your own page, without an account.<br>
           Phone: <strong>${esc(b.guest_phone)}</strong> · Email: ${esc(b.guest_email)}<br>
           Accepting saves them to your students.</p>`}
         <p style="margin:12px 0 0;color:#64748b;font-size:14px">The hour is held for them until you accept or decline.</p>`,
        "Open the portal"),
    };
  }

  /* The same booking, told to the other person.

     WORDING. At this moment the booking is 'requested': the instructor has
     not accepted it yet. "Your lesson is confirmed" would be the natural
     sentence and it would be false — a learner who reads it and turns up
     has been misled by us, and the hour may yet be declined. So this says
     what is actually true: the request is in, the hour is held, and a
     confirmation follows.

     It carries the full detail anyway, because the detail is the same
     either way and a learner wants it in writing now, not after. */
  if (kind === "booking_learner") {
    const { data: b } = await db.from("bookings")
      .select("*")
      .eq("id", id).single();
    if (!b || b.status !== "requested") return null;

    const instructor = await nameOf(b.instructor_id);
    const who = await learnerSide(b);
    return {
      to: who.to,
      toEmail: who.toEmail,
      go: who.go,
      subject: `Lesson request sent - ${when(b.starts_at)}`,
      push: {
        title: "Lesson request sent",
        body: `${instructor} - ${when(b.starts_at)}`,
      },
      html: wrap(
        "Your lesson request is with your instructor",
        `<p style="margin:0 0 14px;color:#334155;line-height:1.6">
           We have sent your request to <strong>${esc(instructor)}</strong>.
           The hour is held for you until they confirm — you will get another
           email the moment they do.</p>
         ${detailTable([
           ["Instructor", instructor],
           ["When", when(b.starts_at)],
           ["How long", `${b.duration_minutes || 60} minutes`],
           carText(b) ? ["Car", carText(b)] : null,
           b.pickup ? ["Pick-up", b.pickup] : null,
           b.price_cents ? ["Price", euro(b.price_cents)] : null,
           b.note ? ["Your note", b.note] : null,
         ])}
         <p style="margin:14px 0 0;color:#64748b;font-size:14px">
           You pay your instructor directly. Nothing is charged here.</p>`,
        who.guest ? "See their page" : "See it in the app",
        { go: who.go, audience: who.audience },
      ),
    };
  }

  /* The confirmation sql/23's email promised.

     Same details as the request, deliberately: a learner should not have
     to find the earlier email to know where they are being collected.
     This is the one they will keep. */
  if (kind === "booking_accepted") {
    const { data: b } = await db.from("bookings")
      .select("*")
      .eq("id", id).single();
    /* The trigger fires on the transition, but a row can change again
       between the trigger and this call — declined, cancelled — and a
       confirmation for a lesson that is no longer on is worse than none. */
    if (!b || b.status !== "accepted") return null;

    const instructor = await nameOf(b.instructor_id);
    const who = await learnerSide(b);
    return {
      to: who.to,
      toEmail: who.toEmail,
      go: who.go,
      subject: `Lesson confirmed - ${when(b.starts_at)}`,
      push: {
        title: "Lesson confirmed",
        body: `${instructor} - ${when(b.starts_at)}`,
      },
      html: wrap(
        "Your lesson is confirmed",
        `<p style="margin:0 0 14px;color:#334155;line-height:1.6">
           <strong>${esc(instructor)}</strong> has confirmed your lesson.
           It is in your diary now — here are the details.</p>
         ${detailTable([
           ["Instructor", instructor],
           ["When", when(b.starts_at)],
           ["How long", `${b.duration_minutes || 60} minutes`],
           carText(b) ? ["Car", carText(b)] : null,
           b.pickup ? ["Pick-up", b.pickup] : null,
           b.price_cents ? ["Price", euro(b.price_cents)] : null,
           b.note ? ["Your note", b.note] : null,
         ])}
         <p style="margin:14px 0 0;color:#64748b;font-size:14px">
           You pay your instructor directly. If you need to change or cancel,
           ${who.guest
             ? (who.phone ? `call or text them on <strong>${esc(who.phone)}</strong>` : "contact them")
             : "message them in the app"} as early as you can.</p>`,
        who.guest ? "See their page" : "See it in the app",
        { go: who.go, audience: who.audience },
      ),
    };
  }

  /* The answer when it is no.

     Harder to write than the yes and more important to send. The learner
     is holding an email that says the hour is held for them, about an
     hour that is not. Told promptly they book another slot the same
     evening; told nothing they assume it is still pending and wait.

     TONE. No apology on the instructor's behalf — we do not know why, and
     an instructor who is simply booked up has done nothing to be sorry
     for. It says what happened, repeats the slot so there is no doubt
     WHICH request this was, passes on their reason if they gave one, and
     points at the next useful action. */
  if (kind === "booking_declined") {
    const { data: b } = await db.from("bookings")
      .select("id, instructor_id, learner_id, starts_at, duration_minutes, resolution_note, status" + GUEST_COLS)
      .eq("id", id).single();
    if (!b || b.status !== "declined") return null;

    const instructor = await nameOf(b.instructor_id);
    const who = await learnerSide(b);
    return {
      to: who.to,
      toEmail: who.toEmail,
      go: who.go,
      subject: `Lesson not confirmed - ${when(b.starts_at)}`,
      push: {
        title: "Lesson not confirmed",
        body: `${instructor} could not take ${when(b.starts_at)}`,
      },
      html: wrap(
        "That slot is not available",
        `<p style="margin:0 0 14px;color:#334155;line-height:1.6">
           <strong>${esc(instructor)}</strong> could not take your lesson on
           <strong>${esc(when(b.starts_at))}</strong>. The hour is no longer
           held, and you have not been charged anything.</p>
         ${b.resolution_note
            ? `<p style="margin:0 0 14px;padding:14px;background:#f1f5f9;border-radius:12px;color:#334155;line-height:1.6">
                 <span style="color:#64748b;font-size:13px">They said:</span><br>${esc(b.resolution_note)}</p>`
            : ""}
         <p style="margin:0;color:#334155;line-height:1.6">
           ${who.guest
             ? "Their other open times are on their page. Most learners find another slot the same week."
             : "Their other times are in the app, and there are other instructors in your area. Most learners find another slot the same week."}</p>`,
        "Find another time",
        { go: who.go, audience: who.audience },
      ),
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
    /* A guest booking (sql/29) has no learner account to tell. */
    if (!to) return null;
    if (!to || to === m.sender_id) return null;

    const from = await nameOf(m.sender_id);
    return {
      to,
      go: to === b.instructor_id ? "/adi" : "/student",
      subject: `New message about ${when(b.starts_at)}`,
      push: { title: `${from}`, body: m.body.slice(0, 120) },
      /* `go` was computed just above and then ignored by wrap, so a
         learner was sent to the instructor portal to read a message about
         their own lesson. It is passed through now. */
      html: wrap(`${from} sent you a message`,
        `<p style="margin:0;padding:14px;background:#f1f5f9;border-radius:12px;color:#334155;line-height:1.6">${esc(m.body)}</p>`,
        to === b.instructor_id ? "Reply in the portal" : "Reply in the app",
        { go: to === b.instructor_id ? "/adi" : "/student",
          audience: to === b.instructor_id ? "instructor" : "learner" }),
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

  /* Told to the developer, not to any account on the platform.

     Both of these set `to: undefined` and `toEmail: ADMIN_NOTIFY_EMAIL`
     instead. `to` is a user id everywhere else in this file — it is how
     sendPush finds a device and how sendEmail finds an address — and an
     admin alert has neither a device nor a profiles row of its own to
     look up. sendEmail and sendPush both check for toEmail/a missing `to`
     before doing anything that would query a uuid column with one, which
     is what stops this being a confusing 500 instead of a quiet no-op. */

  if (kind === "new_user") {
    const { data: p } = await db.from("profiles")
      .select("id, role, full_name, created_at").eq("id", id).maybeSingle();
    if (!p) return null;

    const { data } = await db.auth.admin.getUserById(id);
    const email = data?.user?.email || "(no email on the account)";
    const who = p.full_name || email;
    const role = p.role === "instructor" ? "instructor" : "learner";

    return {
      to: undefined,
      toEmail: ADMIN_NOTIFY_EMAIL,
      go: "/admin",
      subject: `New ${role} account — ${who}`,
      push: { title: "New account", body: `${who} (${role})` },
      html: wrap(
        `A new ${role} signed up`,
        `${detailTable([
          ["Name", p.full_name || "(not given yet)"],
          ["Email", email],
          ["Role", role],
          ["Signed up", when(p.created_at)],
        ])}`,
        "Open the admin portal",
        { go: "/admin", audience: "admin" },
      ),
    };
  }

  if (kind === "instructor_submitted") {
    const { data: i } = await db.from("instructor_profiles")
      .select(`
        id, user_id, full_name, phone, adi_number, adi_category,
        years_experience, lesson_types, counties, service_areas,
        hourly_rate_cents, verification_status
      `)
      .eq("id", id).single();
    /* A race against the admin, same guard as every other compose branch:
       between the trigger firing and this call, the row may already have
       moved on (an admin who was mid-review when it landed, or a second
       submission queued behind the first). Nothing to tell anyone in
       that case — the row no longer says what the trigger thought it did. */
    if (!i || i.verification_status !== "pending") return null;

    const { data } = await db.auth.admin.getUserById(i.user_id);
    const email = data?.user?.email || "(no email on the account)";
    const who = i.full_name || email;
    const areas = [...(i.counties || []), ...(i.service_areas || [])];

    return {
      to: undefined,
      toEmail: ADMIN_NOTIFY_EMAIL,
      go: "/admin",
      subject: `New instructor awaiting approval — ${who}`,
      push: { title: "Instructor awaiting approval", body: who },
      html: wrap(
        "An instructor submitted for review",
        `${detailTable([
          ["Name", i.full_name || "(not given)"],
          ["Email", email],
          ["Phone", i.phone || "(not given)"],
          ["ADI number", i.adi_number || "(not given)"],
          i.adi_category ? ["Category", i.adi_category] : null,
          i.years_experience != null ? ["Experience", `${i.years_experience} years`] : null,
          i.lesson_types?.length ? ["Teaches", i.lesson_types.join(", ")] : null,
          areas.length ? ["Areas", areas.join(", ")] : null,
          i.hourly_rate_cents ? ["Rate", euro(i.hourly_rate_cents)] : null,
        ])}
         <p style="margin:14px 0 0;color:#64748b;font-size:14px">
           Check the ADI number against the RSA register, then approve or
           decline from Instructors in the admin portal.</p>`,
        "Review in the admin portal",
        { go: "/admin", audience: "admin" },
      ),
    };
  }

  return null;
}

/* ------------------------------------------------------------------------- */
/* Sending                                                                    */
/* ------------------------------------------------------------------------- */

/* What to record when the mail server says no.

   Exported so the test can exercise this exact expression against a real
   refusal rather than a copy of it — a test that rebuilds the string it
   is checking proves only that two pieces of code agree with each other. */
export function smtpFailureReason(e) {
  return [
    `smtp ${e?.code || "error"}`,
    e?.responseCode ? `(${e.responseCode})` : "",
    e?.response || e?.message || "",
  ].filter(Boolean).join(" ").slice(0, 400);
}

async function sendEmail(userId, mail) {
  if (!smtpReady && !RESEND_API_KEY) return { sent: false, why: "no SMTP and no RESEND_API_KEY" };

  /* An admin alert (new_user, instructor_submitted) carries its address
     directly — mail.toEmail — because there is no account, and so no
     profiles row and no auth.users row, to look either up from. Taking
     this branch before the two queries below matters: userId is
     undefined for these, and `.eq("id", undefined)` against a uuid
     column is a database error, not an empty result. */
  let to = mail.toEmail;
  if (!to) {
    const { data: p } = await db.from("profiles")
      .select("email_notifications").eq("id", userId).maybeSingle();
    /* Absent means the column or row is new: send. Somebody who has never
       seen the setting still wants to know a learner booked them. */
    if (p?.email_notifications === false) return { sent: false, why: "opted out" };

    const { data } = await db.auth.admin.getUserById(userId);
    to = data?.user?.email;
    if (!to) return { sent: false, why: "no address" };
  }

  /* Your own server first. See the note at the top: the domain's sending
     reputation is already built on it. */
  if (smtpReady) {
    try {
      const info = await mailer().sendMail({
        from: NOTIFY_FROM,
        to,
        subject: mail.subject,
        html: mail.html,
        /* A plain-text alternative. Some filters score a multipart message
           more kindly than HTML alone, and a watch or a terminal client
           shows this instead of nothing. */
        text: `${mail.push.title}\n\n${mail.push.body}\n\n${NOTIFY_SITE}${mail.go}`,
      });
      return { sent: true, via: "smtp", id: info.messageId };
    } catch (e) {
      /* Falls through to Resend when there is one, because a mail server
         having a bad afternoon should not mean silence. */
      console.error("SMTP refused:", e?.code, e?.response || e?.message);

      /* The server's own words, which this used to discard.

         `why` was `smtp ${e.code}`, and e.code is the nodemailer category
         — EMESSAGE, EENVELOPE, EAUTH. That is the shape of the problem,
         never the reason for it. The reason is in e.response: the literal
         SMTP reply, "550 5.7.1 ..." or "552 ...", which names what was
         refused and why. Without it a rejection reads as "smtp EMESSAGE"
         and there is nothing further to learn, however hard the record is
         stared at.

         EMESSAGE specifically means the server accepted the conversation
         and then rejected the message at DATA — a content or policy
         decision, not a connection or a password. Exactly the case where
         the reply text is the entire diagnosis. */
      if (!RESEND_API_KEY) return { sent: false, why: smtpFailureReason(e) };
    }
  }

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { authorization: `Bearer ${RESEND_API_KEY}`, "content-type": "application/json" },
    body: JSON.stringify({ from: NOTIFY_FROM, to, subject: mail.subject, html: mail.html }),
  });

  if (!res.ok) return { sent: false, why: `resend ${res.status}: ${await res.text()}` };
  return { sent: true, via: "resend" };
}

/* Which push service refused — Apple, Google, Mozilla. The endpoint itself
   is a credential-ish URL, so only its host goes into a stored diagnostic. */
export function hostOf(endpoint) {
  try {
    return new URL(endpoint).host;
  } catch {
    return "unparseable endpoint";
  }
}

async function sendPush(userId, mail) {
  /* An admin alert has no account and so no device to push to — see the
     matching guard in sendEmail. Checked first, before anything that
     would query a uuid column with undefined. */
  if (!userId) return { sent: 0, why: "no device recipient (admin notification)" };

  const state = ensurePush();
  if (!state.ready) return { sent: 0, why: state.why };

  const { data: p } = await db.from("profiles")
    .select("push_notifications").eq("id", userId).maybeSingle();
  if (p?.push_notifications === false) return { sent: 0, why: "opted out" };

  const { data: subs } = await db.from("push_subscriptions")
    .select("id, endpoint, p256dh, auth").eq("user_id", userId);
  if (!subs?.length) return { sent: 0, why: "no devices" };

  /* The number for the app icon.

     The service worker that receives this push has no session, so it
     cannot work the count out for itself — it has to be told. Asking the
     database for it here means the icon and the bell are reading the same
     expression (sql/22 is my_waiting()'s own), rather than two counts that
     drift apart until the icon says 3 and the bell says 1.

     A failure is not worth abandoning the push for: a notification with no
     number beats no notification. */
  let badge;
  try {
    const { data } = await db.rpc("waiting_count_for", { p_user: userId });
    if (data !== null && data !== undefined) badge = Number(data);
  } catch {
    /* sql/22 not run yet, most likely. The push still goes. */
  }

  const payload = JSON.stringify({
    title: mail.push.title,
    body: mail.push.body,
    url: `${NOTIFY_SITE}${mail.go}`,
    ...(Number.isFinite(badge) ? { badge } : {}),
  });

  let sent = 0;
  const dead = [];
  const failed = [];

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
      if (e?.statusCode === 404 || e?.statusCode === 410) {
        dead.push(s.id);
        return;
      }
      /* Everything else used to go to console.error and nowhere else, so
         the caller got {sent: 0, pruned: 0} — a number that cannot be told
         apart from "there was nothing to send". The reason matters: a 403
         is a VAPID key that does not match the one the device subscribed
         with, a 400 is a malformed subscription, a 429 is rate limiting.
         Carried back in the response so it ends up in notify_log instead
         of in a log stream nobody opens. */
      failed.push({
        host: hostOf(s.endpoint),
        status: e?.statusCode ?? null,
        why: String(e?.body || e?.message || e).slice(0, 200),
      });
    }
  }));

  if (dead.length) {
    await db.from("push_subscriptions").delete().in("id", dead);
  }

  /* `failed` is omitted when empty so the ordinary success case stays short. */
  return failed.length
    ? { sent, pruned: dead.length, failed }
    : { sent, pruned: dead.length };
}

/* ------------------------------------------------------------------------- */

/* Longer than the 10 seconds a Node function gets by default. An SMTP
   handshake on a cold start plus a push fan-out can exceed it, and being
   killed mid-send looks exactly like a mail server that is ignoring you. */
export const config = { maxDuration: 30 };

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
    /* Named, now that the caller has proved it is the database. "not
       configured" sent somebody to check all ten variables; this sends them
       to the one. */
    const missing = [
      !SUPABASE_URL && "SUPABASE_URL",
      !SUPABASE_SERVICE_ROLE_KEY && "SUPABASE_SERVICE_ROLE_KEY",
    ].filter(Boolean);
    console.error("Missing environment variables:", missing.join(", "));
    return res.status(500).json({
      error: "not configured",
      missing,
      hint: "Add these in Vercel > Settings > Environment Variables, then redeploy.",
    });
  }

  const { kind, id } = req.body || {};
  if (!kind || !id) return res.status(400).json({ error: "kind and id required" });

  let mail;
  try {
    mail = await compose(kind, id);
  } catch (e) {
    console.error("compose failed", e);
    return res.status(500).json({
      error: "could not read the row",
      kind,
      /* The message, not the stack. pg_net stores the response body, so this
         is readable from the SQL editor without going to Vercel's logs —
         which matters because the person debugging this is usually already
         in the SQL editor. */
      detail: String(e?.message || e).slice(0, 300),
    });
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
