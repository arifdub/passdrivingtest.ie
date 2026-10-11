/*
  ===========================================================================
  "SEND ME ONE NOW" — THE SHORTEST LOOP BETWEEN A CHANGE AND AN ANSWER

  Diagnosing push through the booking flow means: make a booking, wait for
  pg_net, open the SQL editor, write a query, read a truncated column on a
  phone. Four minutes a round, and every round costs a real booking row.

  This does the same send with none of that. It pushes to the caller's own
  devices and hands back what each push service said, so the answer appears
  on the screen already in your hand.

  WHO MAY CALL IT

  Only a signed-in person, and only ever to their own devices. The caller's
  Supabase access token is verified with getUser(); the user id comes from
  that verified token and from nowhere else. A user id in the request body
  would turn this into a way to buzz any phone on the platform, so there
  isn't one.

  The service-role key is used, after that check, solely to read the
  caller's own push_subscriptions rows and to prune the dead ones.

  ENVIRONMENT
    SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
    VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT
    NOTIFY_SITE
  ===========================================================================
*/

import { createClient } from "@supabase/supabase-js";
import webpush from "web-push";

const {
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY,
  VAPID_PUBLIC_KEY,
  VAPID_PRIVATE_KEY,
  VAPID_SUBJECT = "mailto:hello@passdrivingtest.ie",
  NOTIFY_SITE = "https://passdrivingtest.ie",
} = process.env;

const db = SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY
  ? createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
  : null;

/* Lazy and guarded, for the same reason as in notify.js: setVapidDetails
   validates and throws, and a throw at module scope is
   FUNCTION_INVOCATION_FAILED with no usable message. Here the whole point
   is to report that message, so it must be caught. */
let pushState = null;
function ensurePush() {
  if (pushState) return pushState;
  try {
    webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
    pushState = { ready: true };
  } catch (e) {
    pushState = { ready: false, why: `VAPID config rejected: ${e?.message || e}` };
  }
  return pushState;
}

/* Only the host. The endpoint carries a device-identifying token and does
   not belong in a response that may be screenshotted or pasted. */
function hostOf(endpoint) {
  try {
    return new URL(endpoint).host;
  } catch {
    return "unparseable endpoint";
  }
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  /* Authenticate FIRST. notify.js once answered a 500 naming its missing
     environment variables to anyone who asked; the order matters. */
  const token = (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  if (!token) return res.status(401).json({ error: "sign in first" });

  if (!db) return res.status(500).json({ error: "not configured" });

  const { data: who, error: whoErr } = await db.auth.getUser(token);
  const userId = who?.user?.id;
  if (whoErr || !userId) return res.status(401).json({ error: "sign in first" });

  const state = ensurePush();
  if (!state.ready) {
    /* The single most common cause, and previously invisible: a public key
       that is not a VAPID key, or a subject without its mailto: prefix. */
    return res.status(200).json({ sent: 0, devices: 0, why: state.why });
  }

  const { data: subs, error: subsErr } = await db
    .from("push_subscriptions")
    .select("id, endpoint, p256dh, auth")
    .eq("user_id", userId);

  if (subsErr) return res.status(500).json({ error: "could not read your devices" });
  if (!subs?.length) {
    return res.status(200).json({
      sent: 0,
      devices: 0,
      why: "This account has no registered devices. Turn notifications on first.",
    });
  }

  const payload = JSON.stringify({
    title: "Test notification",
    body: "If this buzzed your phone, push is working.",
    url: `${NOTIFY_SITE}/adi`,
    tag: "pdt-test",
  });

  let sent = 0;
  const dead = [];
  const failed = [];

  await Promise.all(subs.map(async (s) => {
    try {
      await webpush.sendNotification(
        { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
        payload,
        { TTL: 60 },
      );
      sent++;
    } catch (e) {
      if (e?.statusCode === 404 || e?.statusCode === 410) {
        dead.push(s.id);
        return;
      }
      failed.push({
        host: hostOf(s.endpoint),
        status: e?.statusCode ?? null,
        why: String(e?.body || e?.message || e).slice(0, 300),
      });
    }
  }));

  if (dead.length) await db.from("push_subscriptions").delete().in("id", dead);

  return res.status(200).json({
    devices: subs.length,
    sent,
    expired: dead.length,
    ...(failed.length ? { failed } : {}),
  });
}

export const config = { maxDuration: 15 };
