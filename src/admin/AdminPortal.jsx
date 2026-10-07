/*
  ===========================================================================
  ADMIN PORTAL  —  /admin

  The third door. Approving instructors, settling disputes, setting the
  platform fee, and seeing what the marketplace is actually doing.

  WHO GETS IN

  Only a signed-in account whose profiles.role is 'admin' or 'super_admin'.
  Everyone else — signed out, or a learner who simply typed /admin — gets the
  restricted notice below and nothing else.

  THAT CHECK IS NOT THE SECURITY BOUNDARY, AND MUST NOT BE MISTAKEN FOR ONE.

  This is browser code. Anyone can edit it in dev tools and render whatever
  they like; what they cannot do is make the database answer them. The real
  boundary is row-level security in Postgres, plus the trigger added in
  sql/03-roles-and-journey.sql that stops a client writing role='admin' to
  its own profile row in the first place.

  So this gate exists to keep the door shut for honest people and to avoid
  shipping a screen that implies access it cannot grant. Every admin action
  added here must be enforced again server-side, in RLS or an Edge Function
  holding the service key. An admin screen that trusts the client is a
  database with no password.
  ===========================================================================
*/

import React, { useState, useEffect, useCallback } from "react";
import {
  LayoutDashboard, Users, BadgeCheck, CalendarCheck, CreditCard, Store,
  Star, AlertTriangle, BarChart3, Settings, ShieldAlert, Hammer,
  Check, X, HelpCircle, RefreshCw,
} from "lucide-react";
import { useAuth } from "../appAuth";
import { usePlatform } from "../platform";
import { portalsFor } from "../portals";
import { Logo, EmptyState, PrimaryButton, AccountMenu } from "../ui";
import AuthScreen from "../AuthScreen";
import InstructorReview from "./InstructorReview";
import { checkSetup, loadStats } from "./setupStatus";

const SECTIONS = [
  { id: "overview",    label: "Overview",    icon: LayoutDashboard },
  { id: "instructors", label: "Instructors", icon: BadgeCheck },
  { id: "students",    label: "Students",    icon: Users },
  { id: "bookings",    label: "Bookings",    icon: CalendarCheck },
  { id: "payments",    label: "Payments",    icon: CreditCard },
  { id: "marketplace", label: "Marketplace", icon: Store },
  { id: "reviews",     label: "Reviews",     icon: Star },
  { id: "disputes",    label: "Disputes",    icon: AlertTriangle },
  { id: "reports",     label: "Reports",     icon: BarChart3 },
  { id: "settings",    label: "Settings",    icon: Settings },
];

const COMING = {
  instructors: {
    title: "Instructor management",
    message: "Approve, reject, suspend and verify. Review ADI numbers and documents before a profile is visible to any learner — nobody appears as verified until someone here says so.",
  },
  students: {
    title: "Student management",
    message: "Search learners, see their bookings and payment history, and handle support requests — without exposing more personal detail than the job needs.",
  },
  bookings: {
    title: "Bookings",
    message: "Every lesson across the platform, its source, and what happened to it.",
  },
  payments: {
    title: "Payments and payouts",
    message: "The ledger: lesson amounts, platform fees, refunds and what each instructor is owed.",
  },
  marketplace: {
    title: "Marketplace",
    message: "Unfilled lesson requests, waitlists, and where demand is outrunning supply.",
  },
  reviews: {
    title: "Review moderation",
    message: "Only learners who completed a lesson can review it. This is where the exceptions get dealt with.",
  },
  disputes: {
    title: "Disputes",
    message: "Refunds, no-shows and anything that needs a human decision.",
  },
  reports: {
    title: "Reports",
    message: "Bookings, GMV, platform revenue, payouts, cancellation rate and average rating.",
  },
  settings: {
    title: "Platform settings",
    message: "The marketplace fee lives here — configurable, never hard-coded, and never charged on an instructor's own students.",
  },
};

export default function AdminPortal() {
  const { isSignedIn, profile, displayName, user, signOut } = useAuth();
  const { isAdmin, accountRoles, isAdminAccount } = usePlatform();
  const [section, setSection] = useState("overview");

  /* Both sources agree or you don't come in. isAdmin reads the role the
     platform context resolved; profile.role is what the database actually
     returned for this account. */
  const allowed = isSignedIn
    && (isAdmin || profile?.role === "admin" || profile?.role === "super_admin");

  /* SIGNED OUT GETS A SIGN-IN, NOT A CLOSED DOOR

     This used to show the restricted notice to everyone, including an admin
     whose session had simply expired — a page saying "sign in with an
     administrator account" and offering no way to sign in. The only route
     back was to guess that /student had a form and that the session was
     shared.

     No sign-up here: an admin account is not something you create, it is
     something granted server-side (sql/07). A form offering to make one
     would be offering something it cannot deliver. */
  if (!isSignedIn) {
    return (
      <AuthScreen
        audience="admin"
        initialView="login"
        allowGuest={false}
        allowSignup={false}
        onBack={() => { window.location.href = "/"; }}
      />
    );
  }

  /* Signed in, but not an admin. */
  if (!allowed) return <Restricted onSignOut={signOut} email={user?.email} />;

  const active = SECTIONS.find(s => s.id === section) || SECTIONS[0];

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-900">
      <div className="bg-slate-900 text-white">
        <div
          className="max-w-6xl mx-auto px-5 pb-4"
          style={{ paddingTop: "max(1.5rem, calc(env(safe-area-inset-top) + 1rem))" }}
        >
          <div className="flex items-center justify-between gap-3">
            <Logo size="sm" />
            <div className="flex items-center gap-2">
              <span className="inline-flex items-center gap-1.5 rounded-full bg-red-500/20 text-red-300 px-3 py-1 text-[10px] font-black uppercase tracking-widest">
                <ShieldAlert size={12} /> Admin
              </span>
              <AccountMenu
                email={user?.email}
                portals={portalsFor({ accountRoles, isAdminAccount, here: "admin" })}
                onSignOut={signOut}
              />
            </div>
          </div>
          <h1 className="mt-3 text-xl font-black tracking-tight">Platform administration</h1>
          <p className="text-sm text-slate-400">Signed in as {displayName}</p>
        </div>

        <div className="max-w-6xl mx-auto px-5 overflow-x-auto">
          <div className="flex gap-1.5 w-max pb-2">
            {SECTIONS.map(({ id, label, icon: Icon }) => {
              const on = id === section;
              return (
                <button
                  key={id}
                  onClick={() => setSection(id)}
                  className={`shrink-0 inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-bold whitespace-nowrap transition ${
                    on ? "bg-white text-slate-900" : "bg-white/10 text-slate-300 hover:bg-white/20"
                  }`}
                >
                  <Icon size={14} /> {label}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-5 py-6 pb-24">
        {section === "overview" ? <Overview />
          : section === "instructors" ? <InstructorReview />
          : <ComingSoon section={active} />}
      </div>
    </div>
  );
}

function Overview() {
  /* Undefined until the first read finishes, null if the function isn't there
     — the tiles tell those two apart rather than showing a zero for either.
     A zero means "none", and neither of those does. */
  const [stats, setStats] = useState(undefined);

  useEffect(() => { loadStats().then(setStats); }, []);

  return (
    <>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Stat label="Learners" value={stats?.learners} note="Accounts with the learner side" />
        <Stat label="Instructors" value={stats?.instructors} note="Accounts with the instructor side" />
        <Stat label="Verified ADIs" value={stats?.verified_instructors} note="Checked against the register" />
        <Stat label="Waiting" value={stats?.pending_review} note="Submitted, not yet checked" />
      </div>

      {/* Bookings and revenue are not built, so they are not tiles. A blank
          tile beside real ones reads as a number that failed to load. */}
      <p className="mt-3 text-xs text-slate-500 dark:text-slate-400">
        Bookings and revenue arrive with the marketplace. Nothing is counted
        for them yet, so they are not shown.
      </p>

      <div className="mt-4 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl p-5">
        <div className="flex items-center gap-2.5">
          <Hammer size={18} className="text-amber-500 shrink-0" />
          <h2 className="font-bold text-slate-900 dark:text-white">Instructors can be reviewed now</h2>
        </div>
        <p className="mt-2 text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
          Registration and ADI verification are built — the Instructors tab is
          the queue, with the counts on it. Bookings and payments are not, so
          those tiles stay blank rather than showing invented figures: the
          numbers on an admin screen are the ones people make decisions on.
        </p>
      </div>

      <SetupChecklist />
    </>
  );
}

/* ---------------------------------------------------------------------------
   SETUP

   This replaced a hand-written list of migrations to run. That list never
   checked anything, so it looked the same whether the work was outstanding or
   finished weeks ago — and a permanent instruction sitting on a dashboard
   stops reading as an instruction and starts reading as an error. It was
   mistaken for one.

   So it asks the database. When everything is in place it says one line and
   gets out of the way; when something is missing it names which file, and
   only that file.
   --------------------------------------------------------------------------- */
function SetupChecklist() {
  const [rows, setRows] = useState(null);
  const [busy, setBusy] = useState(true);

  const refresh = useCallback(async () => {
    setBusy(true);
    setRows(await checkSetup());
    setBusy(false);
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const missing = (rows || []).filter(r => r.state === "missing");
  const unknown = (rows || []).filter(r => r.state === "unknown");
  const settled = rows && missing.length === 0 && unknown.length === 0;

  return (
    <div className="mt-4 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl p-5">
      <div className="flex items-start justify-between gap-3">
        <h2 className="font-bold text-slate-900 dark:text-white">
          {busy && !rows ? "Checking the database…"
            : settled ? "Database is set up"
            : missing.length ? `${missing.length} migration${missing.length > 1 ? "s" : ""} still to run`
            : "Couldn't check the database"}
        </h2>
        <button
          onClick={refresh}
          aria-label="Re-check"
          className="shrink-0 inline-flex items-center justify-center w-8 h-8 rounded-full border border-slate-200 dark:border-slate-700 text-slate-500"
        >
          <RefreshCw size={13} className={busy ? "animate-spin" : ""} />
        </button>
      </div>

      {settled && (
        <p className="mt-2 text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
          Everything this screen needs is in place. Nothing to run.
        </p>
      )}

      <ul className="mt-3 space-y-2.5">
        {(rows || []).map(r => (
          <li key={r.id} className="flex gap-2.5 text-sm">
            <span className="shrink-0 mt-0.5">
              {r.state === "present" ? <Check size={16} className="text-emerald-500" />
                : r.state === "missing" ? <X size={16} className="text-red-500" />
                : <HelpCircle size={16} className="text-amber-500" />}
            </span>
            <span className="text-slate-600 dark:text-slate-300">
              <strong className="text-slate-900 dark:text-white">{r.label}</strong>
              <code className="ml-1.5 text-[11px] bg-slate-100 dark:bg-slate-900 px-1.5 py-0.5 rounded">
                sql/{r.id}
              </code>
              <span className="block text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                {r.state === "present" ? r.detail
                  : r.state === "missing" ? `Not there yet — ${r.detail.toLowerCase()}`
                  : r.note || "Couldn't tell."}
              </span>
            </span>
          </li>
        ))}
      </ul>

      {missing.length > 0 && (
        <p className="mt-3 text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
          Run the matching file from <code className="text-xs bg-slate-100 dark:bg-slate-900 px-1.5 py-0.5 rounded">sql/</code> in
          the Supabase SQL editor, or <code className="text-xs bg-slate-100 dark:bg-slate-900 px-1.5 py-0.5 rounded">sql/RUN-PENDING.sql</code> for
          all of them at once. Every file is safe to run twice.
        </p>
      )}

      {unknown.length > 0 && missing.length === 0 && (
        <p className="mt-3 text-sm text-slate-500 dark:text-slate-400 leading-relaxed">
          These may well be fine — the check itself failed, which is not the
          same as the migration being missing.
        </p>
      )}

      <details className="mt-4">
        <summary className="cursor-pointer text-sm font-semibold text-slate-500 dark:text-slate-400">
          Granting someone admin
        </summary>
        <p className="mt-2 text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
          Only from the Supabase SQL editor, by design. This <em>adds</em> admin
          rather than replacing what the account already is, so one email can be
          a learner, an instructor and an admin. They need to sign out and back
          in afterwards.
        </p>
        <code className="block mt-2 text-xs bg-slate-100 dark:bg-slate-900 p-2 rounded overflow-x-auto whitespace-pre-wrap break-words">
{`update public.profiles
   set roles = array(select distinct unnest(roles || array['admin']))
 where id = (select id from auth.users where email = 'them@example.com');`}
        </code>
      </details>
    </div>
  );
}

function Stat({ label, value, note }) {
  const known = typeof value === "number";
  return (
    <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl p-4">
      <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">{label}</p>
      <p className="mt-1 text-2xl font-black text-slate-900 dark:text-white tabular-nums">
        {known ? value : "—"}
      </p>
      <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400 leading-snug">
        {known ? note : "Not counted yet"}
      </p>
    </div>
  );
}

function ComingSoon({ section }) {
  const copy = COMING[section.id];
  return (
    <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl p-8">
      <EmptyState
        icon={section.icon}
        title={copy?.title || section.label}
        message={copy?.message || "This section is still being built."}
      />
    </div>
  );
}

/* Reached only when someone IS signed in and is not an admin — a signed-out
   visitor gets the sign-in form instead.

   Still says as little as possible about why. But it offers a way out, which
   the previous version did not: the likeliest person here is an admin signed
   into the wrong one of their accounts, and "back to the home page" is no use
   to them at all. */
function Restricted({ onSignOut, email }) {
  return (
    <div className="min-h-screen bg-slate-900 flex flex-col items-center justify-center px-6">
      <div className="max-w-sm text-center">
        <div className="w-12 h-12 rounded-2xl bg-slate-800 border border-slate-700 flex items-center justify-center mx-auto">
          <ShieldAlert size={22} className="text-slate-400" />
        </div>
        <h1 className="mt-4 text-lg font-black tracking-tight text-white">
          Restricted area
        </h1>
        <p className="mt-2 text-sm text-slate-400 leading-relaxed">
          {email ? <strong className="text-slate-300">{email}</strong> : "This account"} doesn't
          have access to platform administration.
        </p>
        <div className="mt-5">
          <PrimaryButton onClick={onSignOut}>
            Sign in as someone else
          </PrimaryButton>
        </div>
        <button
          onClick={() => { window.location.href = "/"; }}
          className="mt-2 w-full text-sm font-semibold text-slate-400 hover:text-emerald-400 py-2.5"
        >
          Back to PassDrivingTest.ie
        </button>
      </div>
    </div>
  );
}
