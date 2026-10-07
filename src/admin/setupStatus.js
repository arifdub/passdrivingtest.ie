/*
  ===========================================================================
  IS THE DATABASE ACTUALLY SET UP?

  The admin overview used to carry a hand-written "before this goes live"
  checklist. It never checked anything, so it looked identical whether the
  work was outstanding or finished years ago — which is how a setup note
  turns into something that reads like a permanent error.

  This asks the database instead. Each migration leaves one thing a browser
  can see through PostgREST, so a single cheap select per migration tells us
  whether it landed:

    04  instructor_profiles   the table registration writes to
    06  instructor_review     the admin-only view behind the review queue
    07  profiles.roles        the column that lets one account hold both sides
    08  admin_stats()         the counts on this dashboard

  WHAT IS NOT CHECKED, AND WHY IT IS NOT PRETENDED

  05 leaves only functions and triggers, and PostgREST exposes neither. There
  is no honest probe for it from here, so it is not listed — a tick that was
  really a guess would be worse than no tick. 07 replaces 05's trigger
  anyway, so a working 07 is the thing that matters.

  Missing and "I couldn't tell" are kept apart. A failure that isn't one of
  the two "this does not exist" codes gets reported as unknown rather than
  quietly becoming a cross, because telling someone to re-run a migration
  they already ran is its own kind of wrong.
  ===========================================================================
*/

import { supabase, HAS_SUPABASE } from "../supabaseClient";

/* Postgres says so precisely: 42P01 is an undefined table or view, 42703 an
   undefined column. Anything else — a permission refusal, a network failure —
   means the thing may well be there and something else went wrong. */
const MISSING = new Set(["42P01", "42703", "PGRST202", "PGRST204", "PGRST205"]);

export const CHECKS = [
  {
    id: "04",
    label: "Instructor profiles",
    detail: "The table registration saves to.",
    table: "instructor_profiles",
    column: "id",
  },
  {
    id: "06",
    label: "Review queue",
    detail: "The admin-only view behind the Instructors tab.",
    table: "instructor_review",
    column: "user_id",
  },
  {
    id: "07",
    label: "Account roles",
    detail: "Lets one email hold the learner and instructor sides.",
    table: "profiles",
    column: "roles",
  },
  {
    id: "08",
    label: "Dashboard counts",
    detail: "Counts learners and instructors without reading them.",
    rpc: "admin_stats",
  },
];

async function probe({ table, column, rpc }) {
  /* A missing function comes back as 404/PGRST202 rather than a Postgres
     error code, so it needs its own recognition. */
  const { error } = rpc
    ? await supabase.rpc(rpc)
    : await supabase.from(table).select(column).limit(1);

  if (!error) return { state: "present" };
  if (MISSING.has(error.code)) return { state: "missing" };
  return { state: "unknown", note: error.message };
}

/* The counts themselves. Returns null when the function isn't there yet —
   the tiles stay blank, which is what they have always done and is still
   better than a number nobody can stand over. */
export async function loadStats() {
  if (!HAS_SUPABASE) return null;
  const { data, error } = await supabase.rpc("admin_stats");
  if (error) {
    console.warn("admin_stats unavailable:", error.message);
    return null;
  }
  return Array.isArray(data) ? data[0] || null : data || null;
}

export async function checkSetup() {
  if (!HAS_SUPABASE) {
    return CHECKS.map(c => ({ ...c, state: "unknown", note: "No database connection." }));
  }
  return Promise.all(CHECKS.map(async c => ({ ...c, ...(await probe(c)) })));
}
