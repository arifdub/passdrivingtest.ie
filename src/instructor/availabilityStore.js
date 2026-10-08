/*
  ===========================================================================
  AVAILABILITY

  The instructor's ordinary week, the days they are off, and the terms they
  book on. Reads and writes the three tables in sql/11.

  THE SLOT MATHS LIVES HERE, AND IT IS NOT THE BOOKING RULE

  openSlots() below turns hours minus lessons minus time off into a list of
  startable times. It exists so the instructor can SEE their week the way a
  learner will, and so the shape of the calculation is written down and
  tested before anything depends on it.

  It is not what will decide a booking. Two learners can run this in two
  browsers a second apart and both be told 11:00 is free; only something
  holding a lock can answer that, and that is the booking Edge Function's
  job. Every function here is deliberately pure and synchronous so the same
  code can be lifted into it rather than rewritten from memory.
  ===========================================================================
*/

import { supabase, HAS_SUPABASE } from "../supabaseClient";

/* Sunday first, matching Date.getDay() and Postgres extract(dow). The UI
   renders them Monday-first; the numbering and the display order are
   different questions and conflating them is how a Sunday ends up on a
   Monday. */
export const WEEKDAYS = [
  { id: 0, short: "Sun", long: "Sunday" },
  { id: 1, short: "Mon", long: "Monday" },
  { id: 2, short: "Tue", long: "Tuesday" },
  { id: 3, short: "Wed", long: "Wednesday" },
  { id: 4, short: "Thu", long: "Thursday" },
  { id: 5, short: "Fri", long: "Friday" },
  { id: 6, short: "Sat", long: "Saturday" },
];

/* Monday-first, which is how a working week reads in Ireland. */
export const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0];

export const DEFAULT_RULES = {
  min_notice_hours: 24,
  max_days_ahead: 30,
  lesson_minutes: 60,
  travel_buffer_minutes: 15,
  accepting: true,
};

/* A sensible starting week for someone who has never opened this screen:
   weekdays, nine to five. Offered, never applied behind their back. */
export const TYPICAL_WEEK = [1, 2, 3, 4, 5].map(weekday => ({
  weekday, starts_at: "09:00", ends_at: "17:00",
}));

const no = (msg) => ({ ok: false, error: msg || "No database connection." });

/* ------------------------------------------------------------------------- */
/* Time, as minutes from midnight                                             */
/*                                                                            */
/* Every comparison in this file is between two times on the same day, so     */
/* minutes-from-midnight is the whole of what is needed and Date objects      */
/* would only add timezones to a question that has none.                      */
/* ------------------------------------------------------------------------- */

export function toMinutes(hhmm) {
  if (typeof hhmm !== "string") return null;
  const m = hhmm.match(/^(\d{1,2}):(\d{2})/);
  if (!m) return null;
  const h = Number(m[1]), mi = Number(m[2]);
  if (h > 23 || mi > 59) return null;
  return h * 60 + mi;
}

export function fromMinutes(mins) {
  const m = Math.max(0, Math.round(mins));
  const p = n => String(n).padStart(2, "0");
  return `${p(Math.floor(m / 60) % 24)}:${p(m % 60)}`;
}

/* Postgres hands back a time as "09:00:00". The form wants "09:00". */
export function trimTime(t) {
  const m = toMinutes(t);
  return m === null ? "" : fromMinutes(m);
}

export function hoursLabel(block) {
  return `${trimTime(block.starts_at)}–${trimTime(block.ends_at)}`;
}

/* How long a block of hours runs, in hours, for the "14h a week" summary. */
export function blockHours(block) {
  const a = toMinutes(block.starts_at), b = toMinutes(block.ends_at);
  if (a === null || b === null || b <= a) return 0;
  return (b - a) / 60;
}

export function weeklyHours(blocks) {
  return (blocks || []).reduce((sum, b) => sum + blockHours(b), 0);
}

export function overlaps(a, b) {
  const a1 = toMinutes(a.starts_at), a2 = toMinutes(a.ends_at);
  const b1 = toMinutes(b.starts_at), b2 = toMinutes(b.ends_at);
  if ([a1, a2, b1, b2].some(v => v === null)) return false;
  return a1 < b2 && a2 > b1;
}

/* ------------------------------------------------------------------------- */
/* Days                                                                       */
/* ------------------------------------------------------------------------- */

export function dateKey(d) {
  const p = n => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/* Inclusive at both ends, because that is what a person means by "off from
   the 3rd to the 7th". Compared as date strings, which sort correctly and
   cannot drift an hour the way two Date objects can. */
export function isDayOff(key, timeOff) {
  return (timeOff || []).some(t => key >= t.starts_on && key <= t.ends_on);
}

/* ------------------------------------------------------------------------- */
/* The slots                                                                  */
/* ------------------------------------------------------------------------- */

/* Startable times on one day.

   A slot is kept only if the whole lesson fits inside a block of working
   hours, and if neither the lesson nor the travel buffer around it touches
   something already booked. The buffer is applied on both sides of the
   existing lesson rather than only after it, because the drive is the same
   length in either direction.

   `now` and `rules` decide what is too soon and too far out. Passing `now`
   in rather than reading the clock is what makes this testable. */
export function openSlots({
  date, hours = [], lessons = [], timeOff = [],
  rules = DEFAULT_RULES, now = new Date(), step = 30,
}) {
  const key = dateKey(date);
  if (isDayOff(key, timeOff)) return [];

  const lessonMins = rules.lesson_minutes || DEFAULT_RULES.lesson_minutes;
  const buffer = rules.travel_buffer_minutes ?? DEFAULT_RULES.travel_buffer_minutes;

  const earliest = new Date(now.getTime() + (rules.min_notice_hours ?? 0) * 3600000);
  const latest = new Date(now.getTime());
  latest.setDate(latest.getDate() + (rules.max_days_ahead ?? DEFAULT_RULES.max_days_ahead));

  const blocks = hours.filter(h => h.weekday === date.getDay());
  if (!blocks.length) return [];

  /* Already-booked time on this day, widened by the buffer, as minute ranges.
     A cancelled lesson frees its slot; a completed one in the past still
     occupies it, which is right — the hour was used. */
  const taken = lessons
    .filter(l => l.status !== "cancelled" && dateKey(new Date(l.starts_at)) === key)
    .map(l => {
      const s = new Date(l.starts_at);
      const start = s.getHours() * 60 + s.getMinutes();
      return {
        from: start - buffer,
        to: start + (l.duration_minutes || lessonMins) + buffer,
      };
    });

  const out = [];
  for (const block of blocks) {
    const from = toMinutes(block.starts_at);
    const to = toMinutes(block.ends_at);
    if (from === null || to === null) continue;

    for (let m = from; m + lessonMins <= to; m += step) {
      if (taken.some(t => m < t.to && m + lessonMins > t.from)) continue;

      const at = new Date(date);
      at.setHours(Math.floor(m / 60), m % 60, 0, 0);
      if (at < earliest || at > latest) continue;

      out.push({ time: fromMinutes(m), at, minutes: lessonMins });
    }
  }

  return out.sort((a, b) => a.at - b.at);
}

/* ------------------------------------------------------------------------- */
/* Database                                                                   */
/* ------------------------------------------------------------------------- */

export async function loadAvailability(instructorId) {
  const empty = { hours: [], timeOff: [], rules: { ...DEFAULT_RULES }, error: null };
  if (!HAS_SUPABASE || !instructorId) {
    return { ...empty, error: "No database connection." };
  }

  const [h, t, r] = await Promise.all([
    supabase.from("instructor_hours").select("*")
      .eq("instructor_id", instructorId).order("weekday").order("starts_at"),
    supabase.from("instructor_time_off").select("*")
      .eq("instructor_id", instructorId).order("starts_on"),
    supabase.from("instructor_booking_rules").select("*")
      .eq("instructor_id", instructorId).maybeSingle(),
  ]);

  /* One missing table should not blank the whole screen, so each part falls
     back on its own and the first real error is what gets reported. */
  const error = h.error?.message || t.error?.message || r.error?.message || null;
  if (error) console.warn("Availability not fully loaded:", error);

  return {
    hours: (h.data || []).map(row => ({
      ...row, starts_at: trimTime(row.starts_at), ends_at: trimTime(row.ends_at),
    })),
    timeOff: t.data || [],
    /* No row yet is not an error: sql/11 backfills existing instructors and
       the defaults are what a new one would get anyway. */
    rules: { ...DEFAULT_RULES, ...(r.data || {}) },
    error,
  };
}

export async function addHours(instructorId, { weekday, starts_at, ends_at }) {
  if (!HAS_SUPABASE || !instructorId) return no();

  const from = toMinutes(starts_at), to = toMinutes(ends_at);
  if (from === null || to === null) return { ok: false, error: "A start and an end time." };
  if (to <= from) return { ok: false, error: "The end has to be after the start." };

  const { error } = await supabase.from("instructor_hours").insert({
    instructor_id: instructorId,
    weekday: Number(weekday),
    starts_at: fromMinutes(from),
    ends_at: fromMinutes(to),
  });

  if (error) {
    /* The overlap trigger in sql/11 raises check_violation with a sentence
       already fit to show someone. */
    if (/overlap/i.test(error.message)) {
      return { ok: false, error: "Those hours overlap another block on that day." };
    }
    console.warn("Hours not added:", error.message);
    return { ok: false, error: error.message };
  }
  return { ok: true, error: null };
}

export async function removeHours(id) {
  if (!HAS_SUPABASE) return no();
  const { error } = await supabase.from("instructor_hours").delete().eq("id", id);
  return error ? { ok: false, error: error.message } : { ok: true, error: null };
}

/* Replaces the whole week in one go, for the "use a typical week" shortcut.
   Delete-then-insert rather than a diff: the set is a dozen rows at most and
   a diff would be more code to get subtly wrong. */
export async function replaceWeek(instructorId, blocks) {
  if (!HAS_SUPABASE || !instructorId) return no();

  const { error: cleared } = await supabase
    .from("instructor_hours").delete().eq("instructor_id", instructorId);
  if (cleared) return { ok: false, error: cleared.message };

  if (!blocks.length) return { ok: true, error: null };

  const { error } = await supabase.from("instructor_hours").insert(
    blocks.map(b => ({
      instructor_id: instructorId,
      weekday: Number(b.weekday),
      starts_at: b.starts_at,
      ends_at: b.ends_at,
    }))
  );
  return error ? { ok: false, error: error.message } : { ok: true, error: null };
}

export async function addTimeOff(instructorId, { starts_on, ends_on, reason }) {
  if (!HAS_SUPABASE || !instructorId) return no();
  if (!starts_on) return { ok: false, error: "Which day?" };

  const to = ends_on || starts_on;
  if (to < starts_on) return { ok: false, error: "The last day is before the first." };

  const { error } = await supabase.from("instructor_time_off").insert({
    instructor_id: instructorId,
    starts_on, ends_on: to,
    reason: reason?.trim() || null,
  });
  return error ? { ok: false, error: error.message } : { ok: true, error: null };
}

export async function removeTimeOff(id) {
  if (!HAS_SUPABASE) return no();
  const { error } = await supabase.from("instructor_time_off").delete().eq("id", id);
  return error ? { ok: false, error: error.message } : { ok: true, error: null };
}

export async function saveRules(instructorId, rules) {
  if (!HAS_SUPABASE || !instructorId) return no();

  const { error } = await supabase.from("instructor_booking_rules").upsert({
    instructor_id: instructorId,
    min_notice_hours: Number(rules.min_notice_hours),
    max_days_ahead: Number(rules.max_days_ahead),
    lesson_minutes: Number(rules.lesson_minutes),
    travel_buffer_minutes: Number(rules.travel_buffer_minutes),
    accepting: !!rules.accepting,
  }, { onConflict: "instructor_id" });

  if (error) {
    console.warn("Booking rules not saved:", error.message);
    return { ok: false, error: error.message };
  }
  return { ok: true, error: null };
}
