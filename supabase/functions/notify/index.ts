/*
  ===========================================================================
  NOTIFY — the email half

  A Supabase Edge Function. The database calls it when something an
  instructor should be told about is written; it sends one email.

  WHY A FUNCTION AND NOT A TRIGGER THAT SENDS MAIL

  Postgres cannot send email, and should not try. More importantly, an email
  must not be able to fail a booking: if the mail provider is down, the
  learner's booking still has to be written. So the database writes the row,
  commits, and only then asks this to send something. A failure here loses a
  notification, which is recoverable. A failure inside the transaction would
  lose the booking, which is not.

  WHAT IT WILL NOT DO

  It will not take a recipient address from the caller. The payload carries
  a row id; this function reads the row with the service key and works out
  who should be told. An endpoint that emails whoever it is asked to is an
  open relay with a nice URL, and this one is reachable from the internet.

  DEPLOY

    supabase secrets set RESEND_API_KEY=re_...
    supabase secrets set NOTIFY_FROM="PassDrivingTest <noreply@yourdomain.ie>"
    supabase secrets set NOTIFY_SECRET=$(openssl rand -hex 32)
    supabase functions deploy notify

  Then run sql/19, which stores the same NOTIFY_SECRET and calls this.
  ===========================================================================
*/

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const RESEND_KEY   = Deno.env.get("RESEND_API_KEY");
const FROM         = Deno.env.get("NOTIFY_FROM") ?? "PassDrivingTest <onboarding@resend.dev>";
const SECRET       = Deno.env.get("NOTIFY_SECRET");
const SITE         = Deno.env.get("NOTIFY_SITE") ?? "https://passdrivingtest.ie";

const db = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false },
});

type Kind = "booking" | "message" | "enquiry";

function esc(s: unknown): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function when(iso: string): string {
  // The instructor's own clock is the one that matters.
  return new Date(iso).toLocaleString("en-IE", {
    weekday: "long", day: "numeric", month: "long",
    hour: "2-digit", minute: "2-digit", hour12: false,
    timeZone: "Europe/Dublin",
  });
}

function wrap(title: string, body: string, cta: string): string {
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
        <a href="${SITE}/adi" style="display:inline-block;margin-top:20px;background:#10b981;color:#0f172a;font-weight:700;text-decoration:none;padding:12px 20px;border-radius:12px">${esc(cta)}</a>
      </td></tr>
      <tr><td style="padding:16px 24px;background:#f8fafc;color:#64748b;font-size:12px;line-height:1.5">
        You're getting this because you're a verified instructor on
        PassDrivingTest.ie. Turn these off under Account in the portal.
      </td></tr>
    </table>
  </td></tr></table></body></html>`;
}

/* Reads the row, decides who to tell and what to say. Returns null when
   nobody should be emailed — a message the instructor sent themselves, a
   booking that is not a request, an instructor who turned emails off. */
async function compose(kind: Kind, id: string) {
  if (kind === "booking") {
    const { data: b } = await db.from("bookings")
      .select("id, instructor_id, learner_id, starts_at, kind, pickup, status")
      .eq("id", id).single();
    if (!b || b.status !== "requested") return null;

    const learner = await nameOf(b.learner_id);
    return {
      to: b.instructor_id,
      subject: `New booking request — ${when(b.starts_at)}`,
      html: wrap(
        "A learner asked for a lesson",
        `<p style="margin:0 0 8px;color:#334155;line-height:1.6">
           <strong>${esc(learner)}</strong> has requested
           <strong>${esc(when(b.starts_at))}</strong>.</p>
         ${b.pickup ? `<p style="margin:0;color:#64748b;font-size:14px">Pick-up: ${esc(b.pickup)}</p>` : ""}
         <p style="margin:12px 0 0;color:#64748b;font-size:14px">
           The hour is held for them until you accept or decline.</p>`,
        "Open the portal",
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

    // Whoever did not send it.
    const to = m.sender_id === b.instructor_id ? b.learner_id : b.instructor_id;
    if (to === m.sender_id) return null;

    const from = await nameOf(m.sender_id);
    return {
      to,
      subject: `New message about ${when(b.starts_at)}`,
      html: wrap(
        `${from} sent you a message`,
        `<p style="margin:0;padding:14px;background:#f1f5f9;border-radius:12px;color:#334155;line-height:1.6">
           ${esc(m.body)}</p>`,
        "Reply in the portal",
      ),
    };
  }

  if (kind === "enquiry") {
    const { data: e } = await db.from("instructor_enquiries")
      .select("id, instructor_id, learner_name, area, message, status")
      .eq("id", id).single();
    if (!e || e.status !== "new") return null;

    return {
      to: e.instructor_id,
      subject: "New enquiry about lessons",
      html: wrap(
        "A learner asked about lessons",
        `<p style="margin:0 0 8px;color:#334155;line-height:1.6">
           <strong>${esc(e.learner_name || "A learner")}</strong>${e.area ? ` in ${esc(e.area)}` : ""}
           got in touch.</p>
         ${e.message ? `<p style="margin:0;padding:14px;background:#f1f5f9;border-radius:12px;color:#334155;line-height:1.6">${esc(e.message)}</p>` : ""}`,
        "Open the portal",
      ),
    };
  }

  return null;
}

async function nameOf(userId: string): Promise<string> {
  const { data: p } = await db.from("instructor_profiles")
    .select("full_name").eq("user_id", userId).maybeSingle();
  if (p?.full_name) return p.full_name;

  const { data: prof } = await db.from("profiles")
    .select("full_name").eq("id", userId).maybeSingle();
  if (prof?.full_name) return prof.full_name;

  const { data } = await db.auth.admin.getUserById(userId);
  return data?.user?.email?.split("@")[0] || "Someone";
}

async function addressOf(userId: string): Promise<string | null> {
  const { data: prof } = await db.from("profiles")
    .select("email_notifications").eq("id", userId).maybeSingle();
  // Null means the column is missing or the row is new: default to sending,
  // because an instructor who never saw the setting still wants the booking.
  if (prof && prof.email_notifications === false) return null;

  const { data } = await db.auth.admin.getUserById(userId);
  return data?.user?.email ?? null;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("POST only", { status: 405 });

  // The database is the only thing that should be able to call this.
  if (SECRET && req.headers.get("x-notify-secret") !== SECRET) {
    return new Response("no", { status: 401 });
  }

  let payload: { kind?: Kind; id?: string };
  try {
    payload = await req.json();
  } catch {
    return new Response("bad json", { status: 400 });
  }

  const { kind, id } = payload;
  if (!kind || !id) return new Response("kind and id required", { status: 400 });

  const mail = await compose(kind, id);
  if (!mail) return new Response(JSON.stringify({ sent: false, reason: "nothing to send" }), {
    headers: { "content-type": "application/json" },
  });

  const to = await addressOf(mail.to);
  if (!to) return new Response(JSON.stringify({ sent: false, reason: "no address or opted out" }), {
    headers: { "content-type": "application/json" },
  });

  if (!RESEND_KEY) {
    // Deployed without a key: say so loudly in the logs rather than
    // pretending to have sent something.
    console.error("RESEND_API_KEY is not set — nothing was sent");
    return new Response(JSON.stringify({ sent: false, reason: "no provider key" }), { status: 500 });
  }

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      authorization: `Bearer ${RESEND_KEY}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ from: FROM, to, subject: mail.subject, html: mail.html }),
  });

  if (!res.ok) {
    const detail = await res.text();
    console.error("Resend refused:", res.status, detail);
    return new Response(JSON.stringify({ sent: false, status: res.status, detail }), { status: 502 });
  }

  return new Response(JSON.stringify({ sent: true, to }), {
    headers: { "content-type": "application/json" },
  });
});
