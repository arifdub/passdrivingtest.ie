/*
  ===========================================================================
  INSTRUCTOR PORTAL — shell

  The other half of the platform. An instructor's product is not a learning
  app, it's a business: a calendar, a student list, an inbox of enquiries and
  a payout. This file is the shell those live in — navigation, layout, and
  the empty states each section shows before it has any data.

  WHAT IS DELIBERATELY NOT HERE YET

  Everything that needs a server. Bookings, availability, earnings and the
  marketplace all require logic that cannot run in the browser holding an
  anon key — commission can't be calculated somewhere the instructor could
  edit it, and two students must not be able to take the same 11:00 slot.
  That arrives with the Edge Functions and the booking tables.

  Until then each section states plainly what it will do rather than showing
  invented numbers. A dashboard that reads "€640 this week" before any
  booking exists is worse than an empty one: it can't be trusted later.
  ===========================================================================
*/

import React, { useState, useEffect, useCallback } from "react";
import {
  LayoutDashboard, Calendar, Users, CalendarCheck, Clock, Store,
  Wallet, Star, MessageSquare, UserCircle, Hammer,
  ShieldCheck, ShieldAlert, Clock3, Loader2, Pencil,
} from "lucide-react";
import {
  Logo, EmptyState, PrimaryButton, SecondaryButton, AccountMenu, VerifiedBadge,
} from "../ui";
import { useAuth } from "../appAuth";
import { usePlatform } from "../platform";
import { portalsFor } from "../portals";
import Enquiries from "./Enquiries";
import Students from "./Students";
/* Aliased: lucide-react exports a Calendar icon too, and the collision is
   a build error rather than a warning. Same reason as RouteIcon in App.jsx. */
import CalendarScreen from "./Calendar";
import Availability from "./Availability";
import Account from "./Account";
import { receivedEnquiries } from "../marketplace";
import { listLessons, listStudents } from "./teachingStore";
import InstructorRegistration from "./InstructorRegistration";
import { loadProfile, readDraft } from "./instructorStore";

/* The nav from STEP 11, in the order an instructor's day actually runs:
   what's on today, then the calendar it sits in, then the people in it. */
/* Account sits second on purpose. It used to be last, eleven chips along a
   sideways scroll, which is nowhere — and the only way to edit a profile was
   a button hidden inside the verification card on the dashboard. Someone
   looking for their own details looks for "Account", and now it is the first
   thing after the dashboard. */
const SECTIONS = [
  { id: "dashboard",    label: "Dashboard",    icon: LayoutDashboard },
  { id: "account",      label: "Account",      icon: UserCircle },
  { id: "calendar",     label: "Calendar",     icon: Calendar },
  { id: "students",     label: "Students",     icon: Users },
  { id: "enquiries",    label: "Enquiries",    icon: MessageSquare },
  { id: "availability", label: "Availability", icon: Clock },
  { id: "bookings",     label: "Bookings",     icon: CalendarCheck },
  { id: "marketplace",  label: "Marketplace",  icon: Store },
  { id: "earnings",     label: "Earnings",     icon: Wallet },
  { id: "reviews",      label: "Reviews",      icon: Star },
  { id: "messages",     label: "Messages",     icon: MessageSquare },
];

/* What each section will be, said once, in the section itself. These are
   promises the schema already has a shape for — not marketing copy. */
const COMING = {
  bookings: {
    title: "Bookings",
    message: "Requests from learners to accept or decline. Your hours and terms are set under Availability; what is missing is the server-side piece that holds a slot so two learners cannot claim the same hour.",
  },
  marketplace: {
    title: "Marketplace",
    message: "New-student enquiries, and the empty-slot tool that offers an unbooked hour to learners waiting nearby.",
  },
  earnings: {
    title: "Earnings and payouts",
    message: "What you've earned, what the platform took, and when it lands in your account.",
  },
  reviews: {
    title: "Reviews",
    message: "Reviews from students who actually completed a lesson with you, and your replies to them.",
  },
  messages: {
    title: "Messages",
    message: "Talk to students about a booking without handing over your personal number.",
  },
};

export default function InstructorPortal({ onExitRole }) {
  const { user, signOut } = useAuth();
  const { accountRoles, isAdminAccount } = usePlatform();
  const [section, setSection] = useState("dashboard");
  const [registering, setRegistering] = useState(false);
  /* Set by Students when "Lesson" is tapped on someone, read once by the
     calendar's add sheet, then cleared. Carrying it in state rather than a
     route keeps the portal's one-screen-at-a-time shape. */
  const [bookFor, setBookFor] = useState(null);
  const [profile, setProfile] = useState(null);
  const [draft, setDraft] = useState(null);
  const [loading, setLoading] = useState(true);

  /* The account's row wins; the local draft is the fallback for someone who
     started registering before signing in, or whose table isn't created yet. */
  const refresh = useCallback(async () => {
    setLoading(true);
    const { profile: row } = await loadProfile(user?.id);
    setProfile(row);
    setDraft(readDraft());
    setLoading(false);
  }, [user?.id]);

  useEffect(() => { refresh(); }, [refresh]);

  const status = profile?.verification_status
    || (draft ? "draft" : null);

  if (registering) {
    return (
      <InstructorRegistration
        initial={profile || draft}
        userId={user?.id}
        onDone={async () => { setRegistering(false); await refresh(); }}
        onCancel={() => setRegistering(false)}
      />
    );
  }

  const active = SECTIONS.find(s => s.id === section) || SECTIONS[0];

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-900">
      {/* Header */}
      <div className="bg-slate-900 text-white">
        <div
          className="max-w-5xl mx-auto px-5 pb-4"
          style={{ paddingTop: "max(1.5rem, calc(env(safe-area-inset-top) + 1rem))" }}
        >
          <div className="flex items-center justify-between gap-3">
            <Logo size="sm" />
            {/* Switch changes side without signing out; sign out ends the
                session. Both live here because this screen has no Settings
                to hide them in. */}
            <AccountMenu
              email={user?.email}
              portals={portalsFor({ accountRoles, isAdminAccount, here: "instructor" })}
              onSwitch={onExitRole}
              switchLabel="Back to the site"
              onSignOut={signOut}
            />
          </div>
          <h1 className="mt-3 text-xl font-black tracking-tight">Instructor portal</h1>
          <p className="text-sm text-slate-400">
            Keep your own students. We help you manage them and bring you new ones.
          </p>
        </div>

        {/* Section nav — scrolls sideways on a phone, wraps on a laptop. */}
        <div className="max-w-5xl mx-auto px-5 overflow-x-auto">
          <div className="flex gap-1.5 w-max pb-2">
            {SECTIONS.map(({ id, label, icon: Icon }) => {
              const on = id === section;
              return (
                <button
                  key={id}
                  onClick={() => setSection(id)}
                  className={`shrink-0 inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-bold whitespace-nowrap transition ${
                    on
                      ? "bg-emerald-500 text-slate-900"
                      : "bg-white/10 text-slate-300 hover:bg-white/20"
                  }`}
                >
                  <Icon size={14} /> {label}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-5 py-6 pb-24">
        {section === "dashboard"
          ? (
            <InstructorDashboard
              loading={loading}
              status={status}
              profile={profile}
              draft={draft}
              onRegister={() => setRegistering(true)}
              onOpenAccount={() => setSection("account")}
              onOpenEnquiries={() => setSection("enquiries")}
            />
          )
          : section === "students" ? (
              <Students onBookFor={(student) => { setBookFor(student); setSection("calendar"); }} />
            )
          : section === "calendar" ? (
              <CalendarScreen bookFor={bookFor} onBooked={() => setBookFor(null)} />
            )
          : section === "enquiries" ? <Enquiries onAddedStudent={() => setSection("students")} />
          : section === "availability" ? <Availability />
          : section === "account" ? (
              <Account
                loading={loading}
                status={status}
                profile={profile}
                draft={draft}
                onRegister={() => setRegistering(true)}
              />
            )
          : <ComingSoon section={active} />}
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------------------
   DASHBOARD

   The four numbers an instructor opens the app for. All zero until bookings
   exist — which is the truthful state, not a broken one, so each tile says
   what it counts rather than just showing a bare 0.
   --------------------------------------------------------------------------- */
function num(v) { return typeof v === "number" ? String(v) : "—"; }

function InstructorDashboard({ loading, status, profile, draft, onRegister, onOpenAccount, onOpenEnquiries }) {
  const { user } = useAuth();
  const [newEnquiries, setNewEnquiries] = useState(undefined);
  const [counts, setCounts] = useState({});

  /* Counted here rather than through instructor_stats() so the dashboard
     degrades a tile at a time: with sql/10 missing the student and lesson
     tiles stay blank and the enquiry one still works, instead of one failed
     call emptying all four. */
  useEffect(() => {
    let off = false;
    if (!user?.id) return;

    const dayStart = new Date(); dayStart.setHours(0, 0, 0, 0);
    const dayEnd = new Date(dayStart); dayEnd.setDate(dayEnd.getDate() + 1);
    const weekEnd = new Date(dayStart); weekEnd.setDate(weekEnd.getDate() + 7);

    (async () => {
      const [today, week, students] = await Promise.all([
        listLessons(user.id, { from: dayStart, to: dayEnd }),
        listLessons(user.id, { from: new Date(), to: weekEnd }),
        listStudents(user.id),
      ]);
      if (off) return;
      setCounts({
        today: today.error ? undefined
          : today.rows.filter(l => l.status === "scheduled").length,
        week: week.error ? undefined
          : week.rows.filter(l => l.status === "scheduled").length,
        students: students.error ? undefined : students.rows.length,
      });
    })();

    return () => { off = true; };
  }, [user?.id]);

  /* Only worth asking once verified — nobody can find an unlisted instructor
     to enquire with, so the answer is always zero and the failure when
     sql/09 is missing would be noise on a screen that has nothing to do
     with it. */
  useEffect(() => {
    let off = false;
    if (status !== "verified" || !user?.id) return;
    receivedEnquiries(user.id).then(({ rows }) => {
      if (!off) setNewEnquiries(rows.filter(r => r.status === "new").length);
    });
    return () => { off = true; };
  }, [status, user?.id]);

  return (
    <>
      {/* A panel is for something that needs doing. Once the ADI number has
          been checked there is nothing to do, so the panel becomes a line:
          the badge, and where to go to change anything. Everything else about
          the profile lives under Account now. */}
      {loading
        ? <StatusSkeleton />
        : status === "verified"
          ? <VerifiedLine profile={profile} onOpenAccount={onOpenAccount} />
          : <VerificationCard
              status={status}
              profile={profile}
              draft={draft}
              onRegister={onRegister}
            />}

      <div className="mt-4 grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Stat
          label="Today's lessons"
          value={num(counts.today)}
          note={typeof counts.today === "number"
            ? (counts.today ? "Scheduled for today" : "Nothing on today")
            : "Nothing booked yet"}
        />
        <Stat
          label="Next 7 days"
          value={num(counts.week)}
          note={typeof counts.week === "number" ? "Lessons scheduled" : "Lessons once you add them"}
        />
        <Stat
          label="Active students"
          value={num(counts.students)}
          note={typeof counts.students === "number" ? "Yours plus marketplace" : "Yours plus marketplace"}
        />
        {/* The one tile with something real behind it. The other three wait
            on a calendar and bookings; a number here would have to be
            invented, and this dashboard says why rather than doing that. */}
        <Stat
          label="New enquiries"
          value={typeof newEnquiries === "number" ? String(newEnquiries) : "—"}
          note={typeof newEnquiries === "number"
            ? (newEnquiries ? "Waiting for you" : "None waiting")
            : "From learners nearby"}
        />
      </div>

      <div className="mt-4 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl p-5">
        <div className="flex items-center gap-2.5">
          <Hammer size={18} className="text-amber-500 shrink-0" />
          <h2 className="font-bold text-slate-900 dark:text-white">
            Still being built
          </h2>
        </div>
        <p className="mt-2 text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
          Your calendar, students and availability are working now. Taking a
          booking from a learner is next, and it needs a server: holding a slot
          so two people cannot claim the same hour is not something a browser
          can promise. Until then nothing above is invented — every tile stays
          blank rather than show a number with nothing behind it.
        </p>
      </div>

      <div className="mt-4 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl p-5">
        <h2 className="font-bold text-slate-900 dark:text-white">
          How the fee will work
        </h2>
        <ul className="mt-3 space-y-2.5 text-sm text-slate-600 dark:text-slate-300">
          <li className="flex gap-2.5">
            <span className="font-black text-emerald-500 shrink-0">€0</span>
            <span>
              <strong className="text-slate-900 dark:text-white">Your own students.</strong>{" "}
              Students you already teach and add yourself carry no acquisition
              fee, ever. The calendar is just a tool for you.
            </span>
          </li>
          <li className="flex gap-2.5">
            <span className="font-black text-blue-500 shrink-0">%</span>
            <span>
              <strong className="text-slate-900 dark:text-white">Marketplace students.</strong>{" "}
              A platform fee applies only to learners the marketplace brings
              you — set centrally, shown before you accept, never a surprise.
            </span>
          </li>
        </ul>
      </div>
    </>
  );
}

/* ---------------------------------------------------------------------------
   VERIFICATION

   The first thing on the dashboard until it's resolved, because until an ADI
   number has been checked nothing else in the portal matters: an unverified
   instructor is invisible to every learner, and should be told exactly that
   rather than left to wonder why no bookings arrive.
   --------------------------------------------------------------------------- */
function VerificationCard({ status, profile, draft, onRegister }) {
  /* Not started */
  if (!status) {
    return (
      <Panel tone="blue" icon={ShieldCheck} title="Get verified to take bookings">
        <p>
          Add your ADI number and we'll check it against the RSA register.
          Until that's done your profile isn't visible to learners — which is
          the point: it's what the badge means.
        </p>
        <p className="text-slate-500 dark:text-slate-400">
          It's about ten fields and you don't have to do them in one go — every
          step is saved as you fill it in.
        </p>
        <div className="mt-4">
          <PrimaryButton onClick={onRegister}>Add my details</PrimaryButton>
        </div>
      </Panel>
    );
  }

  /* Started, not submitted */
  if (status === "draft") {
    return (
      <Panel tone="amber" icon={Pencil} title="Your registration is half finished">
        <p>
          Your answers are saved. Finish them and submit, and we'll check your
          ADI number against the RSA register.
        </p>
        <div className="mt-4">
          <PrimaryButton onClick={onRegister}>Finish registering</PrimaryButton>
        </div>
      </Panel>
    );
  }

  /* Waiting on a human */
  if (status === "pending") {
    return (
      <Panel tone="amber" icon={Clock3} title="Verification in progress">
        <p>
          We've got your details and we're checking ADI
          number <strong>{profile?.adi_number || draft?.adi_number}</strong> against
          the RSA register. This usually takes a couple of working days.
        </p>
        <p className="text-slate-500 dark:text-slate-400">
          Your profile stays hidden from learners until it's done.
        </p>
        <div className="mt-4">
          <SecondaryButton onClick={onRegister}>Review my details</SecondaryButton>
        </div>
      </Panel>
    );
  }

  /* Turned down */
  if (status === "rejected") {
    return (
      <Panel tone="red" icon={ShieldAlert} title="We couldn't verify your ADI number">
        <p>
          {profile?.verification_notes
            || "The number didn't match the RSA register. Check it and submit again."}
        </p>
        <div className="mt-4">
          <PrimaryButton onClick={onRegister}>Update and resubmit</PrimaryButton>
        </div>
      </Panel>
    );
  }

  if (status === "suspended") {
    return (
      <Panel tone="red" icon={ShieldAlert} title="Your account is suspended">
        <p>
          {profile?.verification_notes
            || "Your profile has been withdrawn from the marketplace. Get in touch to sort it out."}
        </p>
      </Panel>
    );
  }

  /* 'verified' never reaches here — the dashboard shows VerifiedLine instead,
     and Account carries the detail. Anything else is a status the database
     grew that this screen has not been taught, and saying nothing is better
     than guessing at it. */
  return null;
}

/* ---------------------------------------------------------------------------
   The verified state, which is a badge and not an announcement.
   --------------------------------------------------------------------------- */
function VerifiedLine({ profile, onOpenAccount }) {
  return (
    <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl px-4 py-3 flex items-center gap-3">
      <VerifiedBadge />
      <p className="flex-1 min-w-0 text-xs text-slate-500 dark:text-slate-400 truncate">
        {profile?.listed
          ? "Listed — learners can find you."
          : "Not listed yet; that switch arrives with the marketplace."}
      </p>
      <button
        onClick={onOpenAccount}
        className="shrink-0 text-xs font-bold text-emerald-600 dark:text-emerald-400 hover:underline"
      >
        Account
      </button>
    </div>
  );
}

const TONES = {
  blue:  "bg-blue-50 dark:bg-blue-950/40 border-blue-200 dark:border-blue-900 text-blue-600 dark:text-blue-400",
  amber: "bg-amber-50 dark:bg-amber-950/40 border-amber-200 dark:border-amber-900 text-amber-600 dark:text-amber-400",
  green: "bg-emerald-50 dark:bg-emerald-950/40 border-emerald-200 dark:border-emerald-900 text-emerald-600 dark:text-emerald-400",
  red:   "bg-red-50 dark:bg-red-950/40 border-red-200 dark:border-red-900 text-red-600 dark:text-red-400",
};

function Panel({ tone, icon: Icon, title, children }) {
  const cls = TONES[tone] || TONES.blue;
  return (
    <div className={`border rounded-2xl p-5 ${cls.replace(/text-\S+/g, "")}`}>
      <div className="flex items-center gap-2.5">
        <Icon size={18} className={`shrink-0 ${cls.split(" ").filter(c => c.startsWith("text-")).join(" ")}`} />
        <h2 className="font-bold text-slate-900 dark:text-white">{title}</h2>
      </div>
      <div className="mt-2 space-y-2 text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
        {children}
      </div>
    </div>
  );
}

function StatusSkeleton() {
  return (
    <div className="border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 rounded-2xl p-5 flex items-center gap-3">
      <Loader2 size={18} className="text-slate-400 animate-spin shrink-0" />
      <p className="text-sm text-slate-500 dark:text-slate-400">Checking your registration…</p>
    </div>
  );
}

function Stat({ label, value, note }) {
  return (
    <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl p-4">
      <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">
        {label}
      </p>
      <p className="mt-1 text-2xl font-black text-slate-900 dark:text-white tabular-nums">
        {value}
      </p>
      <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400 leading-snug">
        {note}
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
