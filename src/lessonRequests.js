/*
  ===========================================================================
  LESSON REQUESTS — a learner posts what they need, instructors answer

  The database side is sql/32. A learner posts (post_lesson_request), sees
  their own posts, and closes them. Verified instructors read the board
  (open_lesson_requests) and start a conversation; the learner can answer
  in it. Both sides list their conversations with my_request_threads.

  Every function takes no client of its own beyond the shared supabase one
  and returns { ok, error } or { rows, error }, the same shape as the other
  stores, so a screen never has to catch.
  ===========================================================================
*/

import { supabase, HAS_SUPABASE } from "./supabaseClient";

const no = (msg) => ({ ok: false, error: msg || "No database connection." });

function say(error) {
  if (!error) return null;
  const msg = error.message || String(error);
  if (error.code === "42883" || error.code === "PGRST202" || error.code === "42P01" || /does not exist/.test(msg)) {
    return "Lesson requests aren't switched on yet (sql/32 hasn't been run).";
  }
  if (/Failed to fetch|NetworkError|Load failed/i.test(msg)) {
    return "Couldn't reach the server. Check your connection and try again.";
  }
  return msg;
}

/* What the form must have before it is sent. The database checks the same. */
export function validateRequest({ county, level, car, gearbox }) {
  const errors = {};
  if (!county) errors.county = "Choose your county";
  if (!level) errors.level = "Choose your driving level";
  if (!car) errors.car = "Choose the instructor's car or your own";
  else if (!gearbox) errors.car = "Choose manual or automatic";
  return errors;
}

/* ---- the learner's side --------------------------------------------------- */

export async function postRequest({ county, area, kind, level, car, gearbox, availability, note }) {
  if (!HAS_SUPABASE) return no();
  const { data, error } = await supabase.rpc("post_lesson_request", {
    p_county: county || "",
    p_area: area || null,
    p_kind: kind || "lesson",
    p_level: level ? Number(level) : null,
    p_car: car || null,
    p_gearbox: gearbox || null,
    p_availability: availability || null,
    p_note: note || null,
  });
  return error ? { ok: false, error: say(error) } : { ok: true, id: data, error: null };
}

export async function myRequests(learnerId) {
  if (!HAS_SUPABASE || !learnerId) return { rows: [], error: null };
  const { data, error } = await supabase
    .from("lesson_requests").select("*")
    .eq("learner_id", learnerId)
    .order("created_at", { ascending: false })
    .limit(20);
  return error ? { rows: [], error: say(error) } : { rows: data || [], error: null };
}

export async function closeRequest(id) {
  if (!HAS_SUPABASE) return no();
  const { error } = await supabase
    .from("lesson_requests").update({ status: "closed", updated_at: new Date().toISOString() })
    .eq("id", id);
  return error ? { ok: false, error: say(error) } : { ok: true, error: null };
}

/* A post is live while open and under 30 days old. */
export function isLive(r, now = Date.now()) {
  return r?.status === "open" && new Date(r.expires_at).getTime() > now;
}

/* ---- the instructor's side ------------------------------------------------ */

export async function openRequests({ county } = {}) {
  if (!HAS_SUPABASE) return { rows: [], error: "No database connection." };
  const { data, error } = await supabase.rpc("open_lesson_requests", { p_county: county || null });
  return error ? { rows: [], error: say(error) } : { rows: data || [], error: null };
}

/* ---- conversations, either side ------------------------------------------- */

export async function myThreads() {
  if (!HAS_SUPABASE) return { rows: [], error: null };
  const { data, error } = await supabase.rpc("my_request_threads");
  return error ? { rows: [], error: say(error) } : { rows: data || [], error: null };
}

export async function threadMessages(requestId, instructorId) {
  if (!HAS_SUPABASE) return { rows: [], error: "No database connection." };
  const { data, error } = await supabase
    .from("request_messages").select("id, sender_id, body, created_at")
    .eq("request_id", requestId).eq("instructor_id", instructorId)
    .order("created_at").limit(500);
  return error ? { rows: [], error: say(error) } : { rows: data || [], error: null };
}

export async function sendRequestMessage(requestId, instructorId, body) {
  if (!HAS_SUPABASE) return no();
  const text = (body || "").trim();
  if (!text) return { ok: false, error: "Write a message first." };
  const { error } = await supabase.rpc("send_request_message", {
    p_request: requestId, p_instructor: instructorId, p_body: text,
  });
  return error ? { ok: false, error: say(error) } : { ok: true, error: null };
}

export async function markRequestThreadRead(requestId, instructorId) {
  if (!HAS_SUPABASE) return;
  await supabase.rpc("mark_request_thread_read", { p_request: requestId, p_instructor: instructorId });
}

export function unreadTotal(threads) {
  return (threads || []).reduce((n, t) => n + (t.unread || 0), 0);
}

/* "2 days ago" — for posts and conversations. */
export function ago(iso, now = Date.now()) {
  if (!iso) return "";
  const mins = Math.max(0, Math.round((now - new Date(iso).getTime()) / 60000));
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const h = Math.round(mins / 60);
  if (h < 24) return `${h} hour${h === 1 ? "" : "s"} ago`;
  const d = Math.round(h / 24);
  return `${d} day${d === 1 ? "" : "s"} ago`;
}
