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

import React, { useState } from "react";
import {
  LayoutDashboard, Users, BadgeCheck, CalendarCheck, CreditCard, Store,
  Star, AlertTriangle, BarChart3, Settings, ShieldAlert, Hammer,
} from "lucide-react";
import { useAuth } from "../appAuth";
import { usePlatform } from "../platform";
import { Logo, EmptyState, PrimaryButton } from "../ui";
import InstructorReview from "./InstructorReview";

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
  const { isSignedIn, profile, displayName } = useAuth();
  const { isAdmin } = usePlatform();
  const [section, setSection] = useState("overview");

  /* Both sources agree or you don't come in. isAdmin reads the role the
     platform context resolved; profile.role is what the database actually
     returned for this account. */
  const allowed = isSignedIn
    && (isAdmin || profile?.role === "admin" || profile?.role === "super_admin");

  if (!allowed) return <Restricted isSignedIn={isSignedIn} />;

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
            <span className="inline-flex items-center gap-1.5 rounded-full bg-red-500/20 text-red-300 px-3 py-1 text-[10px] font-black uppercase tracking-widest">
              <ShieldAlert size={12} /> Admin
            </span>
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
  return (
    <>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Stat label="Students" note="Registered learners" />
        <Stat label="Instructors" note="Verified and active" />
        <Stat label="Bookings" note="Last 30 days" />
        <Stat label="Platform revenue" note="Marketplace fees" />
      </div>

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

      <div className="mt-4 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl p-5">
        <h2 className="font-bold text-slate-900 dark:text-white">Before this goes live</h2>
        <ul className="mt-3 space-y-2.5 text-sm text-slate-600 dark:text-slate-300">
          <li className="flex gap-2.5">
            <span className="text-emerald-500 font-black shrink-0">1</span>
            <span>
              Run <code className="text-xs bg-slate-100 dark:bg-slate-900 px-1.5 py-0.5 rounded">sql/RUN-PENDING.sql</code>,
              which is <code className="text-xs">04</code> instructor profiles,
              <code className="text-xs mx-1">05</code> account roles,
              <code className="text-xs mx-1">06</code> the permission that lets
              this screen verify anyone, and <code className="text-xs mx-1">07</code>
              one account holding both sides — in the order they depend on each
              other. It is one paste and safe to run twice.
            </span>
          </li>
          <li className="flex gap-2.5">
            <span className="text-emerald-500 font-black shrink-0">2</span>
            <span>
              Promote your own account from the Supabase SQL editor — the only
              route in, by design. This <em>adds</em> admin rather than
              replacing what the account already is, so one email can be a
              learner, an instructor and an admin:
              <code className="block mt-1.5 text-xs bg-slate-100 dark:bg-slate-900 p-2 rounded overflow-x-auto whitespace-pre-wrap break-words">
{`update public.profiles
   set roles = array(select distinct unnest(roles || array['admin']))
 where id = (select id from auth.users where email = 'you@example.com');`}
              </code>
              Then sign out and back in — the roles are read when the session
              loads.
            </span>
          </li>
          <li className="flex gap-2.5">
            <span className="text-emerald-500 font-black shrink-0">3</span>
            <span>
              Every action added here must be enforced again in RLS or a
              trigger. This screen's check is a courtesy, not a boundary —
              verifying an instructor is allowed by sql/06, and refused there
              for anyone who isn't an admin, including on their own row.
            </span>
          </li>
        </ul>
      </div>
    </>
  );
}

function Stat({ label, note }) {
  return (
    <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl p-4">
      <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">{label}</p>
      <p className="mt-1 text-2xl font-black text-slate-900 dark:text-white tabular-nums">—</p>
      <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400 leading-snug">{note}</p>
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

/* Deliberately says as little as possible. "You are not an admin" confirms
   that /admin is a real address and that the account exists; a flat refusal
   tells an idle prodder nothing they didn't already know. */
function Restricted({ isSignedIn }) {
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
          {isSignedIn
            ? "This account doesn't have access to platform administration."
            : "Sign in with an administrator account to continue."}
        </p>
        <div className="mt-5">
          <PrimaryButton onClick={() => { window.location.href = "/"; }}>
            Back to PassDrivingTest.ie
          </PrimaryButton>
        </div>
      </div>
    </div>
  );
}
