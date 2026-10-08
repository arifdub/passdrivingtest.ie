/*
  ===========================================================================
  THE MARKETPLACE

  Reading verified instructors, and sending one an enquiry.

  WHAT A BROWSER CAN SEE HERE, AND WHY IT IS SAFE

  instructor_profiles has a public select policy (sql/04) for rows that are
  verified AND listed — that is the marketplace listing, and it is meant to
  be public. Nothing else in the table is readable: a draft registration, a
  pending one, a rejected one, are all invisible to everyone but their owner
  and an admin.

  So these queries need no privilege and no function. The filter below is a
  convenience; the rule is in Postgres, and a crafted request gets the same
  rows as the app does.

  WHAT IS NOT HERE

  Booking. An enquiry is a learner asking about lessons — no time, no money,
  no commitment either way. Booking needs a calendar and availability,
  neither of which exists, and half a booking would be worse than none.
  ===========================================================================
*/

import { supabase, HAS_SUPABASE } from "./supabaseClient";

export async function listInstructors({ county, lessonType, transmission } = {}) {
  if (!HAS_SUPABASE) return { rows: [], error: "No database connection." };

  let q = supabase
    .from("instructor_profiles")
    .select("user_id, full_name, business_name, bio, adi_number, adi_category, " +
            "years_experience, transmissions, lesson_types, counties, service_areas, " +
            "hourly_rate_cents, edt_rate_cents, verified_at, photo_url")
    .eq("verification_status", "verified")
    .eq("listed", true)
    .order("verified_at", { ascending: true })
    .limit(200);

  /* Postgres array containment, so "Dublin" matches an instructor covering
     Dublin and Kildare. */
  if (county) q = q.contains("counties", [county]);
  if (lessonType) q = q.contains("lesson_types", [lessonType]);
  if (transmission) q = q.contains("transmissions", [transmission]);

  const { data, error } = await q;
  if (error) {
    console.warn("Marketplace unavailable:", error.message);
    return { rows: [], error: error.message };
  }
  return { rows: data || [], error: null };
}

/* Which counties actually have someone in them. A filter listing all 26 when
   four have an instructor is a menu of dead ends. */
export async function countiesWithInstructors() {
  const { rows } = await listInstructors();
  const seen = new Set();
  for (const r of rows) for (const c of r.counties || []) seen.add(c);
  return [...seen].sort();
}

/* ------------------------------------------------------------------------- */

export async function sendEnquiry({ instructorId, learnerId, name, phone, area, message }) {
  if (!HAS_SUPABASE) return { ok: false, error: "No database connection." };

  const { error } = await supabase.from("instructor_enquiries").insert({
    instructor_id: instructorId,
    learner_id: learnerId,
    learner_name: name?.trim() || null,
    learner_phone: phone?.trim() || null,
    area: area?.trim() || null,
    message: message?.trim() || null,
  });

  if (error) {
    /* 23505 is the one-open-enquiry-per-pair index doing its job. Said in
       words, because "duplicate key value violates unique constraint" is not
       an answer to "why didn't that send?". */
    if (error.code === "23505") {
      return { ok: false, error: "You've already asked this instructor — they can see it." };
    }
    console.warn("Enquiry not sent:", error.message);
    return { ok: false, error: error.message };
  }
  return { ok: true, error: null };
}

/* The learner's own enquiries, so the directory can show which instructors
   they have already contacted rather than offering to ask again. */
export async function myEnquiries(learnerId) {
  if (!HAS_SUPABASE || !learnerId) return {};
  const { data, error } = await supabase
    .from("instructor_enquiries")
    .select("instructor_id, status, created_at")
    .eq("learner_id", learnerId);

  if (error) return {};
  return Object.fromEntries((data || []).map(e => [e.instructor_id, e]));
}

/* The instructor's side of the same table. */
export async function receivedEnquiries(instructorId) {
  if (!HAS_SUPABASE || !instructorId) return { rows: [], error: "No database connection." };
  const { data, error } = await supabase
    .from("instructor_enquiries")
    .select("*")
    .eq("instructor_id", instructorId)
    .order("created_at", { ascending: false })
    .limit(200);

  if (error) {
    console.warn("Enquiries not loaded:", error.message);
    return { rows: [], error: error.message };
  }
  return { rows: data || [], error: null };
}

export async function setEnquiryStatus(id, status) {
  if (!HAS_SUPABASE) return { ok: false, error: "No database connection." };
  const { error } = await supabase
    .from("instructor_enquiries")
    .update({ status })
    .eq("id", id);
  if (error) {
    console.warn("Enquiry not updated:", error.message);
    return { ok: false, error: error.message };
  }
  return { ok: true, error: null };
}

/* ------------------------------------------------------------------------- */

export function euro(cents) {
  if (cents === null || cents === undefined || cents === "") return null;
  return `€${(cents / 100).toFixed(2)}`;
}

export const LESSON_LABELS = {
  edt: "EDT", pretest: "Pre-test", mock: "Mock test",
  refresher: "Refresher", "test-day": "Test-day car",
};
