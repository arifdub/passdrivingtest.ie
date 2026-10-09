/*
  ===========================================================================
  REVIEWS, MESSAGES, AND WHAT IS WAITING ON YOU

  The client side of sql/13. As with bookings, nothing here decides anything:
  whether a learner may review an instructor is settled by a trigger that
  asks whether they completed a lesson, and this file's job is to carry the
  request and translate the refusal.
  ===========================================================================
*/

import { supabase, HAS_SUPABASE } from "./supabaseClient";

/* Below this, an average is one person's opinion rendered as a statistic.
   The number is a judgement call; having one at all is not. */
export const MIN_REVIEWS_TO_SHOW_RATING = 3;

const no = (msg) => ({ ok: false, error: msg || "No database connection." });

export function describeSocialError(error) {
  if (!error) return null;
  const msg = error.message || String(error);

  if (error.code === "42P01" || error.code === "PGRST205" || error.code === "PGRST202") {
    return "Reviews and messages aren't set up on this site yet (sql/13 hasn't been run).";
  }
  if (error.code === "23505") return "You've already reviewed this instructor.";
  if (/Failed to fetch|NetworkError|Load failed/i.test(msg)) {
    return "Couldn't reach the server. Check your connection and try again.";
  }
  /* The triggers in sql/13 raise sentences meant to be read as they are —
     "you can review an instructor after a lesson with them". */
  return msg;
}

/* ------------------------------------------------------------------------- */
/* Reviews                                                                    */
/* ------------------------------------------------------------------------- */

export async function listReviews(instructorId) {
  if (!HAS_SUPABASE || !instructorId) return { rows: [], error: "No database connection." };

  const { data, error } = await supabase
    .from("instructor_reviews")
    .select("*")
    .eq("instructor_id", instructorId)
    .eq("hidden", false)
    .order("created_at", { ascending: false })
    .limit(100);

  if (error) return { rows: [], error: describeSocialError(error) };
  return { rows: data || [], error: null };
}

/* The headline figure for one instructor, or for a page of them. Returns a
   map so a directory can ask once instead of once per card. */
export async function ratingsFor(instructorIds) {
  if (!HAS_SUPABASE || !instructorIds?.length) return {};

  const { data, error } = await supabase
    .from("instructor_ratings")
    .select("*")
    .in("instructor_id", instructorIds);

  if (error) return {};
  return Object.fromEntries((data || []).map(r => [r.instructor_id, r]));
}

/* Whether this learner is allowed to leave one, asked of the database rather
   than guessed at from what the app happens to know. */
export async function canReview(instructorId, learnerId) {
  if (!HAS_SUPABASE || !instructorId || !learnerId) return false;
  const { data, error } = await supabase.rpc("has_completed_lesson", {
    p_instructor: instructorId, p_learner: learnerId,
  });
  return error ? false : !!data;
}

export async function saveReview({ instructorId, learnerId, rating, body }) {
  if (!HAS_SUPABASE || !instructorId || !learnerId) return no();
  if (!(rating >= 1 && rating <= 5)) return { ok: false, error: "Pick one to five stars." };

  const { error } = await supabase
    .from("instructor_reviews")
    .upsert({
      instructor_id: instructorId,
      learner_id: learnerId,
      rating,
      body: body?.trim() || null,
    }, { onConflict: "instructor_id,learner_id" });

  return error ? { ok: false, error: describeSocialError(error) } : { ok: true, error: null };
}

export async function replyToReview(id, reply) {
  if (!HAS_SUPABASE) return no();
  const { error } = await supabase
    .from("instructor_reviews")
    .update({ reply: reply?.trim() || null })
    .eq("id", id);
  return error ? { ok: false, error: describeSocialError(error) } : { ok: true, error: null };
}

/* The average, said the way it should be said. Returns null rather than a
   number when there are too few to mean anything — the caller then shows the
   count on its own, which is honest, instead of a star rating that is not. */
export function ratingLabel(r) {
  const count = Number(r?.review_count) || 0;
  if (!count) return { count: 0, average: null, text: "No reviews yet" };
  if (count < MIN_REVIEWS_TO_SHOW_RATING) {
    return {
      count, average: null,
      text: count === 1 ? "1 review" : `${count} reviews`,
    };
  }
  const avg = Number(r.average_rating);
  return {
    count, average: avg,
    text: `${avg.toFixed(1)} from ${count} reviews`,
  };
}

/* ------------------------------------------------------------------------- */
/* Messages                                                                   */
/* ------------------------------------------------------------------------- */

export async function listMessages(bookingId) {
  if (!HAS_SUPABASE || !bookingId) return { rows: [], error: "No database connection." };

  const { data, error } = await supabase
    .from("booking_messages")
    .select("*")
    .eq("booking_id", bookingId)
    .order("created_at")
    .limit(500);

  if (error) return { rows: [], error: describeSocialError(error) };
  return { rows: data || [], error: null };
}

export async function sendMessage(bookingId, senderId, body) {
  if (!HAS_SUPABASE || !bookingId || !senderId) return no();
  if (!body?.trim()) return { ok: false, error: "Nothing to send." };
  if (body.trim().length > 2000) return { ok: false, error: "That's too long for a message." };

  const { error } = await supabase
    .from("booking_messages")
    .insert({ booking_id: bookingId, sender_id: senderId, body: body.trim() });

  return error ? { ok: false, error: describeSocialError(error) } : { ok: true, error: null };
}

export async function markThreadRead(bookingId) {
  if (!HAS_SUPABASE || !bookingId) return;
  await supabase.rpc("mark_thread_read", { p_booking: bookingId });
}

/* Unread counts per booking, so a list of threads can show which ones want
   an answer without opening each. */
export async function unreadByBooking(userId) {
  if (!HAS_SUPABASE || !userId) return {};

  const { data, error } = await supabase
    .from("booking_messages")
    .select("booking_id, sender_id, read_at")
    .is("read_at", null)
    .neq("sender_id", userId)
    .limit(1000);

  if (error) return {};
  const out = {};
  for (const m of data || []) out[m.booking_id] = (out[m.booking_id] || 0) + 1;
  return out;
}

/* ------------------------------------------------------------------------- */
/* What is waiting                                                            */
/* ------------------------------------------------------------------------- */

/* THIS IS NOT A PUSH NOTIFICATION.

   It is a count, read while the app is open, of things that want an answer.
   A real push — one that lights up a phone sitting in a pocket — needs a
   service worker, a push subscription and VAPID keys held on a server, and
   none of those exist. Calling this "notifications" without saying so would
   leave an instructor believing their phone will buzz when a booking comes
   in. It will not. */
export async function whatIsWaiting() {
  if (!HAS_SUPABASE) return { counts: null, error: "No database connection." };

  const { data, error } = await supabase.rpc("my_waiting");
  if (error) return { counts: null, error: describeSocialError(error) };

  const row = Array.isArray(data) ? data[0] : data;
  if (!row) return { counts: null, error: null };

  return {
    counts: {
      bookingRequests: Number(row.booking_requests) || 0,
      newEnquiries: Number(row.new_enquiries) || 0,
      unreadMessages: Number(row.unread_messages) || 0,
      lessonsToday: Number(row.lessons_today) || 0,
      /* Arrived since the bell was last opened. Undefined rather than 0 when
         sql/16 has not been run, so the caller can fall back on the
         outstanding counts instead of showing a permanently clean bell. */
      unseen: row.unseen === undefined || row.unseen === null
        ? undefined : Number(row.unseen) || 0,
    },
    error: null,
  };
}

/* Opening the bell is what "seen" means. Returns nothing useful — the caller
   re-reads the counts afterwards, because the server's now() is the only
   clock that matters here. */
export async function markNotificationsSeen() {
  if (!HAS_SUPABASE) return;
  try {
    await supabase.rpc("mark_notifications_seen");
  } catch {
    /* Without sql/16 this function does not exist. The bell then keeps
       showing outstanding work, which is the old behaviour — worse, but not
       broken. */
  }
}

/* The number on the bell: what has arrived since it was last opened.

   NOT the outstanding work. Those are different questions and one number was
   trying to answer both — which is why the badge never went away. A booking
   request you have seen but not yet answered is still a person waiting, so
   it stays on the Bookings tab; it just stops being news.

   Falls back to the outstanding counts when `unseen` is absent, which means
   sql/16 has not been run yet. A bell that is wrong in the old way beats a
   bell that is silently always clean. */
export function waitingTotal(counts) {
  if (!counts) return 0;
  if (typeof counts.unseen === "number") return counts.unseen;
  return counts.bookingRequests + counts.newEnquiries + counts.unreadMessages;
}

/* What the panel lists: everything still wanting an answer, seen or not. */
export function outstandingTotal(counts) {
  if (!counts) return 0;
  return counts.bookingRequests + counts.newEnquiries + counts.unreadMessages;
}
