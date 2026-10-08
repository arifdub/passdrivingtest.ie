/*
  ===========================================================================
  BOOKINGS

  Both sides of a booking: a learner asking for an hour, and an instructor
  accepting or declining it.

  NOTHING HERE DECIDES ANYTHING

  Every write goes through a database function (sql/12). The bookings table
  has no insert or update policy for the client at all — not as belt and
  braces, but because the rules only hold if there is exactly one way in.
  A slot list computed in a browser is a convenience; request_booking checks
  the hours, the time off, the notice, the buffer and the overlaps again,
  inside the transaction, and an exclusion constraint refuses two overlapping
  bookings even if the function were wrong.

  So the job of this file is to carry a request and to turn a Postgres error
  into a sentence. It deliberately does not pre-judge whether a slot is
  takeable: the one answer that counts comes back from the attempt.
  ===========================================================================
*/

import { supabase, HAS_SUPABASE } from "./supabaseClient";

export const BOOKING_STATUS = {
  requested: { label: "Waiting", tone: "amber" },
  accepted:  { label: "Confirmed", tone: "green" },
  declined:  { label: "Declined", tone: "slate" },
  cancelled: { label: "Cancelled", tone: "slate" },
  expired:   { label: "Expired", tone: "slate" },
};

const no = (msg) => ({ ok: false, error: msg || "No database connection." });

/* A refusal from request_booking is already a sentence — "That is outside
   their working hours" — raised deliberately so it can be shown as-is. What
   cannot be shown as-is is the plumbing around it, so those are translated
   and anything unrecognised is passed through rather than replaced with a
   vague apology that hides what happened. */
export function describeBookingError(error) {
  if (!error) return null;
  const msg = error.message || String(error);

  if (error.code === "42883" || error.code === "PGRST202") {
    return "Booking isn't set up on this site yet (sql/12 hasn't been run).";
  }
  /* The exclusion constraint firing means someone else got there first in
     the moment between the slot list and the tap. That is the race working
     as designed, and it deserves plain words rather than a constraint name. */
  if (error.code === "23P01" || /bookings_no_overlap/.test(msg)) {
    return "Someone just took that time. Pick another.";
  }
  if (error.code === "23505") return "You've already asked for that time.";
  if (/Failed to fetch|NetworkError|Load failed/i.test(msg)) {
    return "Couldn't reach the server. Check your connection and try again.";
  }
  return msg;
}

/* ------------------------------------------------------------------------- */
/* The learner's side                                                         */
/* ------------------------------------------------------------------------- */

/* The instructor's open slots, as the database sees them. This is the list a
   booking is offered from — not the browser's version, which exists so an
   instructor can check their own week. */
export async function openSlots(instructorId, { from = new Date(), days = 14 } = {}) {
  if (!HAS_SUPABASE || !instructorId) return { rows: [], error: "No database connection." };

  const p = n => String(n).padStart(2, "0");
  const key = `${from.getFullYear()}-${p(from.getMonth() + 1)}-${p(from.getDate())}`;

  const { data, error } = await supabase.rpc("open_slots", {
    p_instructor: instructorId, p_from: key, p_days: days,
  });

  if (error) {
    console.warn("Slots not loaded:", error.message);
    return { rows: [], error: describeBookingError(error) };
  }
  return { rows: (data || []).map(r => new Date(r.slot ?? r)), error: null };
}

export async function requestBooking({ instructorId, at, kind, pickup, note }) {
  if (!HAS_SUPABASE || !instructorId || !at) return no();

  const { data, error } = await supabase.rpc("request_booking", {
    p_instructor: instructorId,
    p_starts_at: at.toISOString(),
    p_kind: kind || "lesson",
    p_pickup: pickup || null,
    p_note: note || null,
  });

  if (error) return { ok: false, error: describeBookingError(error) };
  return { ok: true, id: data, error: null };
}

export async function myBookings(learnerId) {
  if (!HAS_SUPABASE || !learnerId) return { rows: [], error: "No database connection." };

  const { data, error } = await supabase
    .from("bookings").select("*")
    .eq("learner_id", learnerId)
    .order("starts_at", { ascending: false })
    .limit(100);

  if (error) return { rows: [], error: describeBookingError(error) };

  const rows = data || [];
  if (!rows.length) return { rows, error: null };

  /* The instructor's name is a second query rather than a join. bookings
     points at auth.users, not instructor_profiles, so there is no foreign
     key for PostgREST to embed through — asking it to would fail on every
     call and fall back on every call. Two cheap reads beat one that always
     loses. A name that cannot be read is left out rather than guessed at. */
  const ids = [...new Set(rows.map(r => r.instructor_id))];
  const { data: who } = await supabase
    .from("instructor_profiles")
    .select("user_id, full_name, business_name, phone")
    .in("user_id", ids);

  const byId = Object.fromEntries((who || []).map(i => [i.user_id, i]));
  return { rows: rows.map(r => ({ ...r, instructor: byId[r.instructor_id] || null })), error: null };
}

/* ------------------------------------------------------------------------- */
/* The instructor's side                                                      */
/* ------------------------------------------------------------------------- */

export async function receivedBookings(instructorId, { status } = {}) {
  if (!HAS_SUPABASE || !instructorId) return { rows: [], error: "No database connection." };

  let q = supabase
    .from("bookings").select("*")
    .eq("instructor_id", instructorId)
    .order("starts_at");

  if (status) q = Array.isArray(status) ? q.in("status", status) : q.eq("status", status);

  const { data, error } = await q.limit(200);
  if (error) {
    console.warn("Bookings not loaded:", error.message);
    return { rows: [], error: describeBookingError(error) };
  }
  return { rows: data || [], error: null };
}

export async function acceptBooking(id) {
  if (!HAS_SUPABASE) return no();
  const { error } = await supabase.rpc("accept_booking", { p_booking: id });
  return error ? { ok: false, error: describeBookingError(error) } : { ok: true, error: null };
}

export async function declineBooking(id, reason) {
  if (!HAS_SUPABASE) return no();
  const { error } = await supabase.rpc("decline_booking", { p_booking: id, p_reason: reason || null });
  return error ? { ok: false, error: describeBookingError(error) } : { ok: true, error: null };
}

export async function cancelBooking(id, reason) {
  if (!HAS_SUPABASE) return no();
  const { error } = await supabase.rpc("cancel_booking", { p_booking: id, p_reason: reason || null });
  return error ? { ok: false, error: describeBookingError(error) } : { ok: true, error: null };
}

/* ------------------------------------------------------------------------- */
/* Shaping, for the screens                                                   */
/* ------------------------------------------------------------------------- */

/* Slots grouped by local day, in order, so a picker can show "Tue 14" with
   its times under it rather than one flat list of ninety timestamps. */
export function slotsByDay(slots) {
  const out = new Map();
  for (const at of slots) {
    const p = n => String(n).padStart(2, "0");
    const key = `${at.getFullYear()}-${p(at.getMonth() + 1)}-${p(at.getDate())}`;
    if (!out.has(key)) out.set(key, { key, date: at, slots: [] });
    out.get(key).slots.push(at);
  }
  return [...out.values()];
}

export function slotTime(at) {
  return at.toLocaleTimeString("en-IE", { hour: "2-digit", minute: "2-digit", hour12: false });
}

export function slotDay(at) {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const d = new Date(at); d.setHours(0, 0, 0, 0);
  const diff = Math.round((d - today) / 86400000);
  if (diff === 0) return "Today";
  if (diff === 1) return "Tomorrow";
  return at.toLocaleDateString("en-IE", { weekday: "short", day: "numeric", month: "short" });
}

/* A booking is in the past once its hour has gone by — not once the day has.
   An 11:00 that the instructor never answered is dead at noon, and showing
   it as "waiting" after that is a lie about what will happen. */
export function isPast(booking) {
  /* ends_at is a real column (sql/12), kept by a trigger. Preferred over
     recomputing, so this cannot disagree with what the exclusion constraint
     actually indexed. The fallback is for a row read before that column
     existed. */
  const end = booking.ends_at
    ? new Date(booking.ends_at).getTime()
    : new Date(booking.starts_at).getTime() + (booking.duration_minutes || 60) * 60000;
  return end < Date.now();
}
