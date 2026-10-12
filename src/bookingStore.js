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

/* Why there are no slots. Four very different situations arrive at the
   screen as the same empty array — not listed, paused, no hours set, fully
   booked — and a learner can act on only some of them. Asked separately so
   the screen can say which rather than shrug.

   Returns null when it cannot tell, which is distinct from "nothing is
   wrong": sql/14 may not have been run. */
export async function whyNoSlots(instructorId) {
  if (!HAS_SUPABASE || !instructorId) return null;

  const { data, error } = await supabase.rpc("booking_availability", {
    p_instructor: instructorId,
  });
  if (error) return null;

  const row = Array.isArray(data) ? data[0] : data;
  if (!row) return null;

  return {
    listed: !!row.listed,
    accepting: !!row.accepting,
    hasHours: !!row.has_hours,
    openCount: Number(row.open_count) || 0,
  };
}

export async function requestBooking({ instructorId, at, kind, pickup, note, level, car, gearbox }) {
  if (!HAS_SUPABASE || !instructorId || !at) return no();

  const { data, error } = await rpcWithCar("request_booking", {
    p_instructor: instructorId,
    p_starts_at: at.toISOString(),
    p_kind: kind || "lesson",
    p_pickup: pickup || null,
  }, { level, car, gearbox, note });

  if (error) return { ok: false, error: describeBookingError(error) };
  return { ok: true, id: data, error: null };
}

/* ------------------------------------------------------------------------- */
/* Whose car, and which gearbox (sql/30)                                      */
/* ------------------------------------------------------------------------- */

export const CARS = [
  { id: "instructor", label: "Instructor's car" },
  { id: "own",        label: "My own car" },
];
export const GEARBOXES = [
  { id: "manual",    label: "Manual" },
  { id: "automatic", label: "Automatic" },
];

export const LEVELS = [
  { id: 1, label: "Level 1 - Absolute beginner" },
  { id: 2, label: "Level 2 - Beginner" },
  { id: 3, label: "Level 3 - Experienced learner" },
  { id: 4, label: "Level 4 - Advanced, ready for test" },
];
export function levelLabel(level) {
  return LEVELS.find(l => l.id === Number(level))?.label || null;
}

/* In the instructor's car the gearbox is theirs, so only what they teach in.
   In the learner's own car it is whatever that car is. An instructor who
   never said is assumed to do both rather than neither. */
export function gearboxChoices(instructor, car) {
  if (car !== "instructor") return GEARBOXES;
  const theirs = (instructor?.transmissions || []).filter(t => GEARBOXES.some(g => g.id === t));
  return theirs.length ? GEARBOXES.filter(g => theirs.includes(g.id)) : GEARBOXES;
}

/* Picking a car can make the gearbox already chosen impossible (an automatic,
   then the instructor's car when they only have a manual). Keep it if it
   still fits; if only one fits, that is the answer; otherwise ask again. */
export function fitGearbox(instructor, car, gearbox) {
  const choices = gearboxChoices(instructor, car);
  if (choices.some(g => g.id === gearbox)) return gearbox;
  return choices.length === 1 ? choices[0].id : null;
}

export function carError({ level, car, gearbox }) {
  if (!level) return "Choose your driving level";
  if (!car) return "Choose the instructor's car or your own";
  if (!gearbox) return "Choose manual or automatic";
  return null;
}

/* "Instructor's car · Manual", for cards and emails. Null on bookings made
   before anyone was asked. */
export function carLabel(b) {
  const car = b?.car === "own" ? "Own car" : b?.car === "instructor" ? "Instructor's car" : null;
  const box = b?.gearbox === "automatic" ? "Automatic" : b?.gearbox === "manual" ? "Manual" : null;
  return [car, box].filter(Boolean).join(" · ") || null;
}

/* The database may not have sql/31 yet while the app already asks. Rather
   than refuse every booking in that gap, send it the old way and keep the
   answer in the note, where the instructor will still read it. */
async function rpcWithCar(fn, args, { level, car, gearbox, note }) {
  const first = await supabase.rpc(fn, {
    ...args, p_note: note || null,
    p_car: car || null, p_gearbox: gearbox || null, p_level: level ? Number(level) : null,
  });
  if (!first.error || first.error.code !== "PGRST202" || (!car && !gearbox && !level)) return first;
  const said = [levelLabel(level), carLabel({ car, gearbox })].filter(Boolean).join(" · ");
  const withCar = [said, note].filter(Boolean).join(" — ") || null;
  return supabase.rpc(fn, { ...args, p_note: withCar });
}

/* ------------------------------------------------------------------------- */
/* An instructor's own page — /adi/<ADI number>                               */
/* ------------------------------------------------------------------------- */

/* The instructor behind an ADI number, if they are verified and listed.
   Digits are compared on the server, so "F 40953" and "40953" both work. */
export async function instructorPage(adi) {
  if (!HAS_SUPABASE) return { instructor: null, error: "No database connection." };
  const { data, error } = await supabase.rpc("instructor_page", { p_adi: String(adi || "") });
  if (error) {
    return { instructor: null, error: describeBookingError(error) };
  }
  const row = Array.isArray(data) ? data[0] : data;
  return { instructor: row || null, error: null };
}

/* What a guest must give before a request is sent. The server checks the
   same things (sql/29); this is so the form can say so before the round
   trip rather than after. */
export function validateGuest({ name, email, phone }) {
  const errors = {};
  const n = (name || "").trim();
  if (n.length < 2) errors.name = "Enter your name";
  else if (n.length > 80) errors.name = "That name is too long";
  const e = (email || "").trim();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e) || e.length > 254) errors.email = "Enter a valid email address";
  const digits = (phone || "").replace(/\D/g, "");
  if (digits.length < 7 || digits.length > 15) errors.phone = "Enter a valid phone number";
  return errors;
}

/* A booking without an account. The request is the same one a signed-in
   learner makes, decided by the same rules (place_booking in sql/29). */
export async function requestGuestBooking({ instructorId, at, name, email, phone, kind, pickup, note, level, car, gearbox }) {
  if (!HAS_SUPABASE || !instructorId || !at) return no();

  const { data, error } = await rpcWithCar("request_guest_booking", {
    p_instructor: instructorId,
    p_starts_at: at.toISOString(),
    p_name: (name || "").trim(),
    p_email: (email || "").trim(),
    p_phone: (phone || "").trim(),
    p_kind: kind || "lesson",
    p_pickup: pickup || null,
  }, { level, car, gearbox, note });

  if (error) {
    if (error.code === "42883" || error.code === "PGRST202") {
      return { ok: false, error: "Booking without an account isn't switched on yet (sql/29 hasn't been run)." };
    }
    return { ok: false, error: describeBookingError(error) };
  }
  return { ok: true, id: data, error: null };
}

/* The person on a booking, whichever way they booked. */
export function bookingPerson(b) {
  if (!b) return { name: "", email: null, phone: null, guest: false };
  if (!b.learner_id && b.guest_email) {
    return { name: b.guest_name || "Guest", email: b.guest_email, phone: b.guest_phone, guest: true };
  }
  return { name: b.learner?.full_name || b.learner_name || "", email: null, phone: null, guest: false };
}

/* The shareable address for an instructor's page. */
export function pageLink(adiNumber, origin = "https://passdrivingtest.ie") {
  const digits = String(adiNumber || "").replace(/\D/g, "");
  return digits ? `${origin}/adi/${digits}` : null;
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

export async function receivedBookings(instructorId, { status, withLearners } = {}) {
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
  const rows = data || [];
  if (!withLearners || !rows.length) return { rows, error: null };
  return { rows: await withLearnerDetails(rows), error: null };
}

/* Who is behind each request: name and email for those with an account,
   whether they are already the instructor's student, and how many lessons
   they have had together (booking_learners, sql/31). Extra, not essential:
   if it fails the cards just show less. */
async function withLearnerDetails(rows) {
  const { data, error } = await supabase.rpc("booking_learners", { p_ids: rows.map(r => r.id) });
  if (error || !Array.isArray(data)) return rows;
  const byId = Object.fromEntries(data.map(d => [d.booking_id, d]));
  return rows.map(r => (byId[r.id] ? { ...r, who: byId[r.id] } : r));
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
