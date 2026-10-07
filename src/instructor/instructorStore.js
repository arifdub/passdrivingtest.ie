/*
  ===========================================================================
  INSTRUCTOR PROFILE STORE

  Reads and writes the one row in instructor_profiles that belongs to the
  signed-in instructor, and keeps a local draft alongside it.

  WHY A LOCAL DRAFT AT ALL

  Registration asks for a dozen things — ADI number, areas, rates, what they
  teach. Nobody fills that in on a phone in one sitting between lessons. The
  draft is saved on every step so coming back tomorrow doesn't start again,
  and so a dropped connection costs nothing. Same local-first shape as
  progressStore and platform.

  WHAT THIS DELIBERATELY CANNOT DO

  Set verification_status to 'verified'. The database rejects it (see
  sql/04-instructor-profiles.sql) and so does this file: submit() moves a
  profile to 'pending' and stops. "Verified ADI" has to mean a human checked
  the number against the RSA register, or it means nothing at all, and the
  learner getting into the car is the one who pays for the difference.
  ===========================================================================
*/

import { supabase, HAS_SUPABASE } from "../supabaseClient";

const DRAFT_KEY = "pdt-instructor-draft-v1";

/* The shape the form fills in. Kept in one place so the form, the draft and
   the database row can't drift apart. */
export const EMPTY_PROFILE = {
  full_name: "",
  phone: "",
  business_name: "",
  bio: "",
  adi_number: "",
  adi_category: "",
  years_experience: "",
  transmissions: [],
  lesson_types: [],
  base_eircode: "",
  counties: [],
  service_areas: [],
  test_centres: [],
  hourly_rate_cents: "",
  edt_rate_cents: "",
  cancellation_policy: "",
  verification_status: "draft",
  verification_notes: null,
  listed: false,
};

export const TRANSMISSIONS = [
  { id: "manual", label: "Manual" },
  { id: "automatic", label: "Automatic" },
];

export const LESSON_TYPES = [
  { id: "edt", label: "EDT", blurb: "The 12 essential lessons" },
  { id: "pretest", label: "Pre-test", blurb: "Final preparation" },
  { id: "mock", label: "Mock test", blurb: "A full dry run" },
  { id: "refresher", label: "Refresher", blurb: "For licensed drivers" },
  { id: "test-day", label: "Test-day car", blurb: "Car and support on the day" },
];

/* The 26 counties, for the areas step. Dublin is split the way learners
   actually search — by routing key — in service_areas instead. */
export const COUNTIES = [
  "Carlow", "Cavan", "Clare", "Cork", "Donegal", "Dublin", "Galway", "Kerry",
  "Kildare", "Kilkenny", "Laois", "Leitrim", "Limerick", "Longford", "Louth",
  "Mayo", "Meath", "Monaghan", "Offaly", "Roscommon", "Sligo", "Tipperary",
  "Waterford", "Westmeath", "Wexford", "Wicklow",
];

/* ------------------------------------------------------------------------- */
/* Draft                                                                      */
/* ------------------------------------------------------------------------- */
export function readDraft() {
  try {
    const raw = JSON.parse(localStorage.getItem(DRAFT_KEY));
    return raw && typeof raw === "object" ? { ...EMPTY_PROFILE, ...raw } : null;
  } catch {
    return null;
  }
}

export function writeDraft(profile) {
  try {
    localStorage.setItem(DRAFT_KEY, JSON.stringify(profile));
  } catch {
    /* private browsing — the form still works, it just won't survive a reload */
  }
}

export function clearDraft() {
  try { localStorage.removeItem(DRAFT_KEY); } catch { /* ignore */ }
}

/* ------------------------------------------------------------------------- */
/* Database                                                                   */
/* ------------------------------------------------------------------------- */

/* Numbers arrive from <input> as strings, and empty means "not answered"
   rather than zero — a rate of €0.00 is a different claim from a blank. */
function toInt(value) {
  if (value === "" || value === null || value === undefined) return null;
  const n = Number(value);
  return Number.isFinite(n) ? Math.round(n) : null;
}

function toRow(profile, userId) {
  return {
    user_id: userId,
    full_name: profile.full_name?.trim() || null,
    phone: profile.phone?.trim() || null,
    business_name: profile.business_name?.trim() || null,
    bio: profile.bio?.trim() || null,
    /* Digits, so it matches what a reviewer reads off the RSA register. */
    adi_number: normaliseAdi(profile.adi_number) || null,
    adi_category: profile.adi_category || null,
    years_experience: toInt(profile.years_experience),
    transmissions: profile.transmissions || [],
    lesson_types: profile.lesson_types || [],
    base_eircode: profile.base_eircode?.trim().toUpperCase() || null,
    counties: profile.counties || [],
    service_areas: profile.service_areas || [],
    test_centres: profile.test_centres || [],
    hourly_rate_cents: toInt(profile.hourly_rate_cents),
    edt_rate_cents: toInt(profile.edt_rate_cents),
    cancellation_policy: profile.cancellation_policy?.trim() || null,
  };
}

export async function loadProfile(userId) {
  if (!HAS_SUPABASE || !userId) return { profile: null, error: null };

  const { data, error } = await supabase
    .from("instructor_profiles")
    .select("*")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    /* Table not created yet (sql/04 not run), or RLS refused. Neither should
       lose what's on the device, so the caller falls back to the draft. */
    console.warn("Instructor profile not loaded:", error.message);
    return { profile: null, error: error.message };
  }
  return { profile: data || null, error: null };
}

/* Saves without submitting: the instructor can come back to it. */
export async function saveProfile(profile, userId) {
  writeDraft(profile);

  if (!HAS_SUPABASE || !userId) {
    return { ok: false, error: "Not signed in — saved on this device only." };
  }

  const { error } = await supabase
    .from("instructor_profiles")
    .upsert(toRow(profile, userId), { onConflict: "user_id" });

  if (error) {
    console.warn("Instructor profile not saved:", error.message);
    return { ok: false, error: error.message };
  }
  return { ok: true, error: null };
}

/* Submits for review. The furthest a client is allowed to move the status. */
export async function submitForReview(profile, userId) {
  const saved = await saveProfile(profile, userId);
  if (!saved.ok) return saved;

  const { error } = await supabase
    .from("instructor_profiles")
    .update({ verification_status: "pending" })
    .eq("user_id", userId);

  if (error) {
    console.warn("Could not submit for review:", error.message);
    return { ok: false, error: error.message };
  }

  clearDraft();
  return { ok: true, error: null };
}

/* ------------------------------------------------------------------------- */
/* Validation                                                                 */
/* ------------------------------------------------------------------------- */

/* An Irish ADI number is digits. Just digits.

   THIS WAS WRONG, AND IT TURNED REAL INSTRUCTORS AWAY

   It used to be /^F\d{5}$/i, on the belief that the number is an F followed
   by five digits. The RSA's own register prints it plainly — "ADI NUMBER |
   40953" — and there is no F anywhere on it. The first instructor to type
   their real number was told it was malformed and could not get past step 2.

   So this is now deliberately loose. The number is checked by a person
   against the register, which is the only check that decides anything; the
   job here is to catch a slip of the hand, not to second-guess the RSA's
   numbering. Anything from three to eight digits passes.

   A leading F is tolerated and stripped, because the field told people to
   type one for weeks and some of them will keep doing it. What gets stored
   is the digits, so it matches what a reviewer reads off the register. */
export const ADI_PATTERN = /^F?\d{3,8}$/i;

/* Spaces out, a stray leading F out, digits kept. */
export function normaliseAdi(value) {
  return (value || "").replace(/\s+/g, "").replace(/^[Ff]/, "");
}

export function validate(profile) {
  const errors = {};

  if (!profile.full_name?.trim()) errors.full_name = "Required";
  if (!profile.phone?.trim()) errors.phone = "Required";

  if (!profile.adi_number?.trim()) {
    errors.adi_number = "Required";
  } else if (!ADI_PATTERN.test(normaliseAdi(profile.adi_number))) {
    errors.adi_number = "An ADI number is digits only, like 40953";
  }

  if (!profile.transmissions?.length) errors.transmissions = "Pick at least one";
  if (!profile.lesson_types?.length) errors.lesson_types = "Pick at least one";
  if (!profile.counties?.length) errors.counties = "Pick at least one";

  if (!profile.hourly_rate_cents && profile.hourly_rate_cents !== 0) {
    errors.hourly_rate_cents = "Required";
  }

  return errors;
}

/* Which step a given field belongs to, so the review step can say "fix this"
   and send them to the right place rather than just refusing. */
export const FIELD_STEP = {
  full_name: 0, phone: 0, business_name: 0, bio: 0,
  adi_number: 1, adi_category: 1, years_experience: 1,
  transmissions: 2, lesson_types: 2,
  base_eircode: 3, counties: 3, service_areas: 3,
  hourly_rate_cents: 4, edt_rate_cents: 4, cancellation_policy: 4,
};
