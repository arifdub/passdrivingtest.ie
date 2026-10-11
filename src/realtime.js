/*
  ===========================================================================
  LIVE CHANGES

  A websocket that tells the portal when a booking, a message or an enquiry
  arrives, instead of it asking every two minutes.

  WHAT THIS IS, AND WHAT IT IS NOT

  It makes the app live WHILE IT IS OPEN. It is not a push notification: a
  websocket exists only while a page exists, so a phone in a pocket with the
  app closed learns nothing. That still needs a service worker and VAPID
  keys. The difference matters enough that the screen says it in words
  rather than letting a live badge imply otherwise.

  NOTHING HERE IS A PERMISSION

  Realtime runs the same row-level security policies as an ordinary select,
  per subscriber, on every change. An instructor is streamed their own
  bookings because bookings_mine_select lets them read their own bookings —
  subscribing grants nothing that a plain query would not already return.

  WHY EVERY HANDLER JUST SAYS "SOMETHING CHANGED"

  The payload carries the row, and it is tempting to update state from it
  directly. It is not used that way: the row arrives without its joins, the
  counts it would feed are computed server-side anyway, and a client that
  patches its own state from a stream drifts the first time a message is
  missed. So a change triggers a re-read of the thing that changed. One
  round trip, and the screen cannot disagree with the database.
  ===========================================================================
*/

import { supabase, HAS_SUPABASE } from "./supabaseClient";

/* How long to wait before treating a burst as one event. Accepting a booking
   writes a booking, a student and a lesson; without this the portal would
   re-read three times in fifty milliseconds. */
const SETTLE_MS = 400;

/* Subscribes to everything an instructor should be told about.

   onChange is called with { kind, event, row } after the burst settles —
   kind is "booking" | "message" | "enquiry". Returns an unsubscribe.

   A missing table or a project without Realtime turned on fails quietly:
   the two-minute poll is still there underneath, so the app degrades to
   what it did before rather than breaking. */
export function subscribeInstructor(instructorId, onChange) {
  if (!HAS_SUPABASE || !instructorId) return () => {};

  let timer = null;
  let pending = null;

  const fire = (kind, event, row) => {
    /* Last one wins for the description; the re-read covers them all. */
    pending = { kind, event, row };
    clearTimeout(timer);
    timer = setTimeout(() => {
      const p = pending;
      pending = null;
      if (p) onChange(p);
    }, SETTLE_MS);
  };

  const channel = supabase
    .channel(`instructor:${instructorId}`)
    .on("postgres_changes", {
      event: "*", schema: "public", table: "bookings",
      filter: `instructor_id=eq.${instructorId}`,
    }, (payload) => fire("booking", payload.eventType, payload.new || payload.old))
    .on("postgres_changes", {
      event: "INSERT", schema: "public", table: "booking_messages",
    }, (payload) => {
      /* booking_messages has no instructor_id to filter on — it hangs off a
         booking. RLS already limits this to threads on the subscriber's own
         bookings, so anything that arrives is theirs; the only thing to
         drop is an echo of what they just sent themselves. */
      if (payload.new?.sender_id === instructorId) return;
      fire("message", "INSERT", payload.new);
    })
    .on("postgres_changes", {
      event: "*", schema: "public", table: "instructor_enquiries",
      filter: `instructor_id=eq.${instructorId}`,
    }, (payload) => fire("enquiry", payload.eventType, payload.new || payload.old))
    .subscribe();

  return () => {
    clearTimeout(timer);
    try { supabase.removeChannel(channel); } catch { /* already gone */ }
  };
}

/* The same, for a learner: their own bookings and the threads on them. */
export function subscribeLearner(learnerId, onChange) {
  if (!HAS_SUPABASE || !learnerId) return () => {};

  let timer = null;
  const fire = (kind, event, row) => {
    clearTimeout(timer);
    timer = setTimeout(() => onChange({ kind, event, row }), SETTLE_MS);
  };

  const channel = supabase
    .channel(`learner:${learnerId}`)
    .on("postgres_changes", {
      event: "*", schema: "public", table: "bookings",
      filter: `learner_id=eq.${learnerId}`,
    }, (payload) => fire("booking", payload.eventType, payload.new || payload.old))
    .on("postgres_changes", {
      event: "INSERT", schema: "public", table: "booking_messages",
    }, (payload) => {
      if (payload.new?.sender_id === learnerId) return;
      fire("message", "INSERT", payload.new);
    })
    .subscribe();

  return () => {
    clearTimeout(timer);
    try { supabase.removeChannel(channel); } catch { /* already gone */ }
  };
}

/* ------------------------------------------------------------------------- */
/* What to say about it                                                       */
/* ------------------------------------------------------------------------- */

/* The line a toast shows. Exported and pure so the wording is testable
   without a websocket.

   An UPDATE is deliberately quiet for bookings: the instructor accepting one
   is an update, and telling somebody about the thing they just did is how a
   notification system teaches people to ignore it. */
export function describeChange({ kind, event, row } = {}) {
  if (kind === "booking") {
    if (event === "INSERT" && row?.status === "requested") {
      return { text: "New booking request", go: "bookings" };
    }
    if (event === "UPDATE" && row?.status === "cancelled") {
      return { text: "A learner cancelled a lesson", go: "bookings" };
    }
    return null;
  }

  if (kind === "message") {
    return { text: "New message", go: "messages" };
  }

  if (kind === "enquiry") {
    if (event === "INSERT") return { text: "New enquiry", go: "enquiries" };
    return null;
  }

  return null;
}
