/*
  ===========================================================================
  DELETE MY ACCOUNT — permanently, and only your own

  WHO MAY CALL IT

  Only a signed-in person, and only ever their own account. The caller's
  Supabase access token is verified with getUser(); the id that gets
  deleted comes from that verified token and from nowhere else. A user id
  in the request body would turn this into a way to delete anyone's
  account, so there isn't one — same rule, same reason, as api/test-push.js.

  WHAT ACTUALLY HAPPENS

  db.auth.admin.deleteUser(id) removes the row in auth.users. Everything
  else disappears as a consequence of foreign keys already declared
  `on delete cascade` throughout sql/04 onward — profiles,
  instructor_profiles, availability, lessons, push_subscriptions,
  messages sent, reviews written, and more — not because this function
  deletes each of those tables itself. There is no second list to keep in
  sync with the schema; the schema already says what goes.

  THE ONE CONSEQUENCE WORTH NAMING OUT LOUD

  public.bookings has BOTH instructor_id and learner_id declared
  `on delete cascade` (sql/12). A booking is one row shared by two
  accounts, and deleting either account deletes that row — not just that
  account's view of it. An instructor who deletes their account removes
  a learner's record of lessons that already happened, including ones a
  review or a conversation refers back to; a learner who deletes theirs
  does the same to the instructor's history and earnings record for that
  booking. This endpoint does not soften that — softening it would mean
  redesigning how bookings reference accounts (a snapshot of the other
  party's details at deletion, or `set null` plus a name captured at
  booking time), which is a schema decision for a person to make
  deliberately, not a default to reach for here. The confirmation screen
  says this in plain words before anyone taps the button.

  ENVIRONMENT
    SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
  ===========================================================================
*/

import { createClient } from "@supabase/supabase-js";

const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;

const db = SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY
  ? createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
  : null;

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  /* Authenticate FIRST, before anything that would say whether the
     server is configured. Same ordering bug, same fix, as api/notify.js
     once had: answering an unauthenticated caller with configuration
     detail tells a stranger more than a 401 should. */
  const token = (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  if (!token) return res.status(401).json({ error: "sign in first" });

  if (!db) return res.status(500).json({ error: "not configured" });

  const { data: who, error: whoErr } = await db.auth.getUser(token);
  const userId = who?.user?.id;
  if (whoErr || !userId) return res.status(401).json({ error: "sign in first" });

  /* A confirmation phrase, not just a POST with no body. The browser
     already makes someone type or tap through an explicit warning before
     this request is ever sent (see src/DeleteAccountCard.jsx) — this is
     the second lock, so a replayed or scripted call cannot delete an
     account on its own. Checked against a fixed phrase rather than
     echoing anything caller-supplied back as proof of anything. */
  const { confirm } = req.body || {};
  if (confirm !== "DELETE") {
    return res.status(400).json({ error: "confirmation required" });
  }

  const { error: delErr } = await db.auth.admin.deleteUser(userId);
  if (delErr) {
    console.error("account deletion failed:", delErr.message);
    return res.status(500).json({ error: "could not delete the account" });
  }

  return res.status(200).json({ deleted: true });
}

export const config = { maxDuration: 15 };
