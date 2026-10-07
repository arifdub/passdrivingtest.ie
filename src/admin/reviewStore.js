/*
  ===========================================================================
  INSTRUCTOR REVIEW — the queue, and the two decisions

  Reads the instructor_review view (sql/06), which is instructor_profiles plus
  the account's email and is visible to admins only. Writes go to
  instructor_profiles itself; the view is for reading.

  WHAT THIS FILE DOES NOT DECIDE

  Whether the caller is an admin. It asks, the database answers. Every query
  here would return nothing and every write would raise for anyone else, and
  that is the only check that counts — the portal's own gate is a courtesy to
  stop an admin-less visitor staring at an empty screen.

  Nor does it set verified_at. The trigger does, from the status, so a profile
  cannot end up verified with no date on it or dated with no verification
  behind it.
  ===========================================================================
*/

import { supabase, HAS_SUPABASE } from "../supabaseClient";

/* The queue first, then everything already decided. Pending sorted oldest
   first: someone who submitted on Monday should not be behind Friday's. */
export const QUEUES = [
  { id: "pending",  label: "Waiting",  blurb: "Submitted, not yet checked" },
  { id: "verified", label: "Verified", blurb: "Checked and live" },
  { id: "rejected", label: "Rejected", blurb: "Sent back with a reason" },
  { id: "suspended", label: "Suspended", blurb: "Withdrawn from the marketplace" },
];

export async function loadQueue(status) {
  if (!HAS_SUPABASE) {
    return { rows: [], error: "Not connected to the database." };
  }

  const ascending = status === "pending";
  const { data, error } = await supabase
    .from("instructor_review")
    .select("*")
    .eq("verification_status", status)
    .order("updated_at", { ascending })
    .limit(200);

  if (error) {
    console.warn("Review queue not loaded:", error.message);
    return { rows: [], error: error.message };
  }
  return { rows: data || [], error: null };
}

export async function countsByStatus() {
  if (!HAS_SUPABASE) return {};
  const { data, error } = await supabase
    .from("instructor_review")
    .select("verification_status");

  if (error) return {};
  return (data || []).reduce((acc, r) => {
    acc[r.verification_status] = (acc[r.verification_status] || 0) + 1;
    return acc;
  }, {});
}

/* ------------------------------------------------------------------------- */

async function decide(userId, patch) {
  if (!HAS_SUPABASE) return { ok: false, error: "Not connected to the database." };

  const { error } = await supabase
    .from("instructor_profiles")
    .update(patch)
    .eq("user_id", userId);

  if (error) {
    /* The likely causes, in order: sql/06 hasn't been run, this account isn't
       an admin, or it's their own row. All three are the database refusing,
       which is what it is for. */
    console.warn("Decision rejected:", error.message);
    return { ok: false, error: error.message };
  }
  return { ok: true, error: null };
}

/* Approving lists them. Verification is what the marketplace filters on, and
   an instructor who has just been approved and wants to stay hidden can say
   so once that switch exists — the opposite default would mean approving
   someone and nothing visibly happening. */
export function approve(userId, notes) {
  return decide(userId, {
    verification_status: "verified",
    verification_notes: notes?.trim() || null,
    listed: true,
  });
}

/* The reason is required, not optional: "rejected" with no note is a dead end
   for the person who gets it, and they can see this text — it is what the
   instructor portal shows them on the rejected card. */
export function reject(userId, notes) {
  return decide(userId, {
    verification_status: "rejected",
    verification_notes: notes.trim(),
    listed: false,
  });
}

export function suspend(userId, notes) {
  return decide(userId, {
    verification_status: "suspended",
    verification_notes: notes.trim(),
    listed: false,
  });
}

/* Back into the queue — for a suspension lifted, or a rejection reconsidered. */
export function returnToQueue(userId) {
  return decide(userId, { verification_status: "pending", listed: false });
}

/* ------------------------------------------------------------------------- */

export function euro(cents) {
  if (cents === null || cents === undefined || cents === "") return null;
  return `€${(cents / 100).toFixed(2)}`;
}

export function when(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString("en-IE", { day: "numeric", month: "short", year: "numeric" });
}

/* How long something has been waiting, which is the number that matters in a
   review queue: not when it arrived, but how long nobody has looked at it. */
export function waitingFor(iso) {
  if (!iso) return null;
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
  if (Number.isNaN(days)) return null;
  if (days <= 0) return "today";
  if (days === 1) return "1 day";
  return `${days} days`;
}
