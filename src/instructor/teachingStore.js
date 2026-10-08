/*
  ===========================================================================
  STUDENTS AND LESSONS

  The instructor's own book. Reads and writes instructor_students and
  lessons, both of which are theirs alone under row-level security (sql/10).

  WHY DATES ARE HANDLED THE WAY THEY ARE

  A lesson is stored as a timestamptz — an instant — and entered as a local
  date and time, which is what an instructor means by "Tuesday at ten". The
  conversion happens once, here, in both directions, rather than in each
  screen. Doing it per-screen is how a lesson ends up an hour out for half
  the year.

  Nothing in here is clever about recurrence. Most driving lessons are
  arranged one at a time, and a repeating-lesson feature that is wrong about
  bank holidays is worse than none.
  ===========================================================================
*/

import { supabase, HAS_SUPABASE } from "../supabaseClient";

export const LESSON_KINDS = [
  { id: "lesson",    label: "Lesson",       blurb: "A standard driving lesson" },
  { id: "edt",       label: "EDT",          blurb: "Counts toward the twelve" },
  { id: "pretest",   label: "Pre-test",     blurb: "Final preparation" },
  { id: "mock",      label: "Mock test",    blurb: "A full dry run" },
  { id: "refresher", label: "Refresher",    blurb: "For a licensed driver" },
  { id: "test-day",  label: "Test-day car", blurb: "Car and support on the day" },
];

export const KIND_LABEL = Object.fromEntries(LESSON_KINDS.map(k => [k.id, k.label]));

export const EDT_TOTAL = 12;

const no = (msg) => ({ ok: false, error: msg || "No database connection." });

/* ------------------------------------------------------------------------- */
/* Students                                                                   */
/* ------------------------------------------------------------------------- */

export async function listStudents(instructorId, { includeArchived = false } = {}) {
  if (!HAS_SUPABASE || !instructorId) return { rows: [], error: "No database connection." };

  let q = supabase
    .from("instructor_students")
    .select("*")
    .eq("instructor_id", instructorId)
    .order("full_name");

  if (!includeArchived) q = q.eq("status", "active");

  const { data, error } = await q;
  if (error) {
    console.warn("Students not loaded:", error.message);
    return { rows: [], error: error.message };
  }
  return { rows: data || [], error: null };
}

/* Counted, not stored — see sql/10. Returned keyed by student so a list can
   show "7 of 12" without a query each. */
export async function progressByStudent(instructorId) {
  if (!HAS_SUPABASE || !instructorId) return {};
  const { data, error } = await supabase
    .from("student_progress")
    .select("*")
    .eq("instructor_id", instructorId);
  if (error) return {};
  return Object.fromEntries((data || []).map(r => [r.student_id, r]));
}

export async function addStudent(instructorId, fields) {
  if (!HAS_SUPABASE || !instructorId) return no();
  if (!fields.full_name?.trim()) return { ok: false, error: "A name, at least." };

  const { data, error } = await supabase
    .from("instructor_students")
    .insert({
      instructor_id: instructorId,
      learner_id: fields.learner_id || null,
      full_name: fields.full_name.trim(),
      phone: fields.phone?.trim() || null,
      email: fields.email?.trim() || null,
      area: fields.area?.trim() || null,
      notes: fields.notes?.trim() || null,
      source: fields.source === "marketplace" ? "marketplace" : "own",
    })
    .select("id")
    .single();

  if (error) {
    if (error.code === "23505") {
      return { ok: false, error: "That learner is already one of your students." };
    }
    console.warn("Student not added:", error.message);
    return { ok: false, error: error.message };
  }
  return { ok: true, id: data?.id, error: null };
}

export async function updateStudent(id, patch) {
  if (!HAS_SUPABASE) return no();
  const { error } = await supabase.from("instructor_students").update(patch).eq("id", id);
  if (error) {
    console.warn("Student not updated:", error.message);
    return { ok: false, error: error.message };
  }
  return { ok: true, error: null };
}

/* ------------------------------------------------------------------------- */
/* Lessons                                                                    */
/* ------------------------------------------------------------------------- */

export async function listLessons(instructorId, { from, to, studentId } = {}) {
  if (!HAS_SUPABASE || !instructorId) return { rows: [], error: "No database connection." };

  let q = supabase
    .from("lessons")
    .select("*, student:instructor_students(id, full_name, phone)")
    .eq("instructor_id", instructorId)
    .order("starts_at");

  if (from) q = q.gte("starts_at", from.toISOString());
  if (to) q = q.lt("starts_at", to.toISOString());
  if (studentId) q = q.eq("student_id", studentId);

  const { data, error } = await q.limit(500);
  if (error) {
    console.warn("Lessons not loaded:", error.message);
    return { rows: [], error: error.message };
  }
  return { rows: data || [], error: null };
}

export async function addLesson(instructorId, fields) {
  if (!HAS_SUPABASE || !instructorId) return no();
  if (!fields.student_id) return { ok: false, error: "Which student?" };
  if (!fields.starts_at) return { ok: false, error: "When?" };

  const { error } = await supabase.from("lessons").insert({
    instructor_id: instructorId,
    student_id: fields.student_id,
    starts_at: fields.starts_at.toISOString(),
    duration_minutes: Number(fields.duration_minutes) || 60,
    kind: fields.kind || "lesson",
    price_cents: fields.price_cents ?? null,
    pickup: fields.pickup?.trim() || null,
    notes: fields.notes?.trim() || null,
  });

  if (error) {
    console.warn("Lesson not added:", error.message);
    return { ok: false, error: error.message };
  }
  return { ok: true, error: null };
}

export async function updateLesson(id, patch) {
  if (!HAS_SUPABASE) return no();
  const { error } = await supabase.from("lessons").update(patch).eq("id", id);
  if (error) {
    console.warn("Lesson not updated:", error.message);
    return { ok: false, error: error.message };
  }
  return { ok: true, error: null };
}

export async function deleteLesson(id) {
  if (!HAS_SUPABASE) return no();
  const { error } = await supabase.from("lessons").delete().eq("id", id);
  if (error) return { ok: false, error: error.message };
  return { ok: true, error: null };
}

/* ------------------------------------------------------------------------- */
/* Dates                                                                      */
/* ------------------------------------------------------------------------- */

/* A date input gives "2026-10-14" and a time input "10:00". Combined through
   the Date constructor they are read in the browser's own zone, which for an
   Irish instructor is the zone they meant. */
export function toInstant(dateStr, timeStr) {
  if (!dateStr || !timeStr) return null;
  const [y, m, d] = dateStr.split("-").map(Number);
  const [hh, mm] = timeStr.split(":").map(Number);
  if ([y, m, d, hh, mm].some(n => Number.isNaN(n))) return null;
  return new Date(y, m - 1, d, hh, mm, 0, 0);
}

/* The other direction, for filling the form when editing. */
export function toFields(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return { date: "", time: "" };
  const p = n => String(n).padStart(2, "0");
  return {
    date: `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`,
    time: `${p(d.getHours())}:${p(d.getMinutes())}`,
  };
}

export function dayKey(iso) {
  const d = new Date(iso);
  const p = n => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function dayLabel(key) {
  const [y, m, d] = key.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const diff = Math.round((date - today) / 86400000);
  if (diff === 0) return "Today";
  if (diff === 1) return "Tomorrow";
  if (diff === -1) return "Yesterday";
  return date.toLocaleDateString("en-IE", {
    weekday: "short", day: "numeric", month: "short",
  });
}

export function timeLabel(iso) {
  return new Date(iso).toLocaleTimeString("en-IE", { hour: "2-digit", minute: "2-digit", hour12: false });
}

export function endLabel(iso, minutes) {
  const end = new Date(new Date(iso).getTime() + (minutes || 60) * 60000);
  return end.toLocaleTimeString("en-IE", { hour: "2-digit", minute: "2-digit", hour12: false });
}

export function euro(cents) {
  if (cents === null || cents === undefined || cents === "") return null;
  return `€${(cents / 100).toFixed(2)}`;
}
