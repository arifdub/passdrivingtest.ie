/*
  ===========================================================================
  PLATFORM CONTEXT — who is this, and where are they on the journey?

  PassDrivingTest.ie is two products sharing one application: a learner's
  journey from theory to full licence, and an instructor's business. This
  provider holds the one fact that decides which of the two a visitor sees.

    role          student | instructor | admin | super_admin | null
    journeyStage  only meaningful for a student — which of the six stages
                  of the journey they said they were at

  WHY NOT JUST A COLUMN ON profiles

  It is a column on profiles — but it cannot only be that, because the role
  is chosen BEFORE anyone signs in. The front door asks "are you a student or
  an instructor?" and the honest answer to "why should I make an account
  first?" is that there isn't one. So the choice is made in localStorage, and
  is written up to the account the moment one exists.

  The same local-first-then-sync shape as progressStore.jsx, for the same
  reason: a choice made offline, or before sign-up, must not be lost.

  DEGRADES WITHOUT THE MIGRATION
  profiles.role and profiles.journey_stage arrive with
  sql/03-roles-and-journey.sql. Until that has been run the column simply
  isn't there, the write fails, and the warning is swallowed — the device
  keeps its own copy and everything still works, exactly as lastSections and
  paused did before their migrations were run.
  ===========================================================================
*/

import React, {
  createContext, useContext, useState, useEffect, useCallback, useMemo, useRef,
} from "react";
import {
  BookOpen, IdCard, Car, Flag, RotateCcw, CalendarClock,
} from "lucide-react";
import { supabase, HAS_SUPABASE } from "./supabaseClient";
import { useAuth } from "./appAuth";

const ROLE_KEY = "pdt-role-v1";
const STAGE_KEY = "pdt-journey-stage-v1";

export const ROLES = ["student", "instructor", "admin", "super_admin"];

/* The six answers to "where are you on your driving journey?" (STEP 5).

   `next` is the route this stage should drop someone into once they've
   chosen, which is what makes the question worth asking at all — a learner
   who says they already hold a permit should not land on a theory-test home
   screen. */
export const JOURNEY_STAGES = [
  {
    id: "theory",
    icon: BookOpen,
    label: "I'm preparing for my theory test",
    blurb: "Start with the theory study guide and practice tests.",
    next: "/student",
  },
  {
    id: "permit",
    icon: IdCard,
    label: "I have my learner permit",
    blurb: "Find driving lessons and start learning.",
    next: "/student",
  },
  {
    id: "edt",
    icon: Car,
    label: "I'm doing EDT",
    blurb: "Continue my EDT journey.",
    next: "/student",
  },
  {
    id: "test-prep",
    icon: Flag,
    label: "I'm preparing for the driving test",
    blurb: "Get pre-test lessons and support.",
    next: "/student",
  },
  {
    id: "refresher",
    icon: RotateCcw,
    label: "I'm an experienced driver",
    blurb: "Refresher lessons.",
    next: "/student",
  },
  {
    id: "test-car",
    icon: CalendarClock,
    label: "I need a test-day car",
    blurb: "Book an instructor and car for your test day.",
    next: "/student",
  },
];

export const STAGE_BY_ID = Object.fromEntries(JOURNEY_STAGES.map(s => [s.id, s]));

/* ---------------------------------------------------------------------------
   THE JOURNEY ITSELF

   Eight milestones from first study to full licence (STEP 26). This is a
   different list from JOURNEY_STAGES above, and the difference matters:
   those six are the answers to "where are you?", these eight are the road
   being travelled. One is a question, the other is the map.

   WHAT THE APP CAN AND CANNOT KNOW

   It can see every question answered and every mock sat, because it ran
   them. It cannot see whether someone passed the real theory test at a
   Prometric centre, or whether a permit arrived in the post — no integration
   exists, and inventing one would be lying to a learner about their own
   progress.

   So those milestones are taken from what the learner said about themselves
   at onboarding, and can be corrected at any time. Self-declared is honest;
   guessed is not.
   --------------------------------------------------------------------------- */
export const JOURNEY_PATH = [
  { id: "theory",      label: "Theory Test",      blurb: "Learn the rules, signs and practise the questions." },
  { id: "permit",      label: "Learner Permit",   blurb: "Apply to the NDLS once you've passed the theory test." },
  { id: "edt",         label: "EDT",              blurb: "The 12 Essential Driver Training lessons with an ADI." },
  { id: "practice",    label: "Practice",         blurb: "Supervised hours between lessons." },
  { id: "mock",        label: "Mock Test",        blurb: "A full paper under exam conditions." },
  { id: "test-prep",   label: "Test Preparation", blurb: "Pre-test lessons and the test-centre routes." },
  { id: "driving-test", label: "Driving Test",    blurb: "The day itself." },
  { id: "full-licence", label: "Full Licence",    blurb: "Two years on N-plates, then you're done." },
];

/* How far along the map each onboarding answer puts someone. Everything
   before this index is treated as behind them.

   "refresher" and "test-car" are not earlier stages of the same road — they
   are people who already drive, arriving for one specific thing. Both are
   placed at test preparation because that is what they came for. */
const STAGE_REACHED = {
  theory: 0,
  permit: 1,
  edt: 2,
  "test-prep": 5,
  refresher: 5,
  "test-car": 6,
};

export function reachedIndexFor(stageId) {
  return STAGE_REACHED[stageId] ?? 0;
}

const PlatformContext = createContext(null);

function readLocal(key) {
  try {
    return localStorage.getItem(key) || null;
  } catch {
    return null;
  }
}

function writeLocal(key, value) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    /* private browsing — the choice just won't survive a reload */
  }
}

export function PlatformProvider({ children }) {
  const { user, isSignedIn, profile, setAccountRoles } = useAuth();

  const [role, setRoleState] = useState(() => readLocal(ROLE_KEY));
  const [journeyStage, setStageState] = useState(() => readLocal(STAGE_KEY));

  /* Pushed up once per sign-in, not on every render. */
  const syncedFor = useRef(null);

  /* ---- the account's answer wins over the device's ----

     Someone who picked "instructor" on their phone and then signed into an
     account that is already a verified instructor should not be asked again.
     An account that says nothing leaves the local choice alone. */
  useEffect(() => {
    if (!profile) return;
    if (profile.role && ROLES.includes(profile.role) && profile.role !== role) {
      setRoleState(profile.role);
      writeLocal(ROLE_KEY, profile.role);
    }
    if (profile.journey_stage && profile.journey_stage !== journeyStage) {
      setStageState(profile.journey_stage);
      writeLocal(STAGE_KEY, profile.journey_stage);
    }
    // Only when the loaded profile changes, not when local state does.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile?.id, profile?.role, profile?.journey_stage]);

  /* ---- and a choice made before signing up follows the learner up ---- */
  const pushToAccount = useCallback(async (patch) => {
    if (!isSignedIn || !HAS_SUPABASE || !user?.id) return;
    const { error } = await supabase
      .from("profiles")
      .update(patch)
      .eq("id", user.id);
    if (error) {
      // Column not added yet, or RLS refused the write. The device keeps its
      // own copy either way.
      console.warn("Role not synced:", error.message);
    }
  }, [isSignedIn, user?.id]);

  useEffect(() => {
    if (!isSignedIn || !user?.id) {
      syncedFor.current = null;
      return;
    }
    if (syncedFor.current === user.id) return;
    syncedFor.current = user.id;

    /* journey_stage only. The role used to be pushed up here too, and that
       was the hole: it meant the device told the account which product the
       person was, so opening the other portal once rewrote it. The role is
       now set when the account is created, from the door used, and the
       database refuses to let a browser change it (sql/05). */
    const patch = {};
    if (journeyStage) patch.journey_stage = journeyStage;
    if (Object.keys(patch).length) pushToAccount(patch);
  }, [isSignedIn, user?.id, role, journeyStage, pushToAccount]);

  /* Local only, on purpose. For a signed-out visitor this is the whole story:
     which door they came in by, so their installed app reopens on the right
     side. For a signed-in one the account's role overrules it everywhere that
     matters — see accountRole below. */
  const setRole = useCallback((next) => {
    setRoleState(next);
    writeLocal(ROLE_KEY, next);
  }, []);

  const setJourneyStage = useCallback((next) => {
    setStageState(next);
    writeLocal(STAGE_KEY, next);
    if (next) pushToAccount({ journey_stage: next });
  }, [pushToAccount]);

  /* Switching back to the front door. Deliberately does NOT sign anyone out
     or clear their progress — it only forgets which door they came in by. */
  const clearRole = useCallback(() => {
    setRoleState(null);
    writeLocal(ROLE_KEY, null);
  }, []);

  /* "I arrived at this door" — as distinct from "I am this".

     FIRST DOOR WINS, AND IT HAS TO.

     Both /student and /adi record who walked through them, so that someone
     who came straight from the landing page still has a role stored and
     isn't asked to pick again next time they open their installed app.

     But merely LOOKING is not choosing. A learner who taps "For instructors"
     on the front door out of curiosity must not come back to find their app
     opening an instructor portal — and an instructor glancing at the student
     side must not lose their way back. So this only ever fills a blank;
     changing sides for real goes through setRole, which is what the explicit
     controls use. */
  const claimRole = useCallback((next) => {
    if (role || !next) return;
    setRole(next);
  }, [role, setRole]);

  /* ---------------------------------------------------------------------
     WHICH SIDES THIS ACCOUNT HOLDS

     `role` above is the device's idea, kept in localStorage: useful before
     anyone signs in, and worth nothing as a permission, because the browser
     owns it and anyone can edit it.

     accountRoles is what the database says, and it is a SET. One person
     learns, teaches, and sends their own kids through the test — an account
     can hold the learner side, the instructor side, or both. Each is added
     deliberately; see addSide.

     Reading profile.roles with profile.role as the fallback, because an
     account loaded before sql/07 ran has only the old single column and
     should still work rather than losing its side.
     --------------------------------------------------------------------- */
  const accountRoles = useMemo(() => {
    if (!isSignedIn || !profile) return [];
    const list = Array.isArray(profile.roles) && profile.roles.length
      ? profile.roles
      : profile.role ? [profile.role] : [];
    return list.filter(r => ROLES.includes(r));
  }, [isSignedIn, profile]);

  const hasAccountRole = useCallback(
    (r) => accountRoles.includes(r), [accountRoles]);

  const isAdminAccount = hasAccountRole("admin") || hasAccountRole("super_admin");

  /* Adds a side to this account. Only ever 'student' or 'instructor' — the
     database refuses anything else, and so does this.

     Deliberate, not automatic: a learner tapping "For instructors" out of
     curiosity must not quietly become one, and an instructor glancing at the
     theory material must not have the learner app appear in their account
     without asking. One tap, taken by the person it belongs to. */
  const addSide = useCallback(async (side) => {
    if (side !== "student" && side !== "instructor") {
      return { ok: false, error: "Not a side." };
    }
    if (accountRoles.includes(side)) return { ok: true, error: null };
    if (!isSignedIn || !user?.id) {
      return { ok: false, error: "Sign in first." };
    }

    /* The write itself belongs to appAuth, which owns the account record in
       both modes. A failure here is most likely sql/07 not having been run;
       saying so beats a button that appears to do nothing. */
    return setAccountRoles([...new Set([...accountRoles, side])]);
  }, [accountRoles, isSignedIn, user?.id, setAccountRoles]);

  const value = useMemo(() => ({
    role,
    accountRoles,
    hasAccountRole,
    isAdminAccount,
    addSide,
    /* Not signed in: the student side is open to guests, which is how the
       free study material has always worked. The instructor side has its own
       sign-in gate and never reaches these. */
    mayUseStudent: !isSignedIn || hasAccountRole("student") || isAdminAccount,
    mayUseInstructor: hasAccountRole("instructor") || isAdminAccount,
    journeyStage,
    stage: journeyStage ? STAGE_BY_ID[journeyStage] || null : null,
    isStudent: role === "student",
    isInstructor: role === "instructor",
    isAdmin: role === "admin" || role === "super_admin",
    hasChosenRole: Boolean(role),
    setRole,
    claimRole,
    setJourneyStage,
    clearRole,
  }), [role, accountRoles, hasAccountRole, isAdminAccount, addSide, isSignedIn,
       journeyStage, setRole, claimRole, setJourneyStage, clearRole]);

  return (
    <PlatformContext.Provider value={value}>{children}</PlatformContext.Provider>
  );
}

export function usePlatform() {
  const ctx = useContext(PlatformContext);
  if (!ctx) throw new Error("usePlatform must be used inside <PlatformProvider>");
  return ctx;
}

export default PlatformProvider;
