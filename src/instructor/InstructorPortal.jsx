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
  Wallet, Star, MessageSquare, UserCircle, ChevronLeft, Hammer,
  ShieldCheck, ShieldAlert, Clock3, Loader2, Pencil,
} from "lucide-react";
import { Logo, EmptyState, PrimaryButton, SecondaryButton } from "../ui";
import { useAuth } from "../appAuth";
import InstructorRegistration from "./InstructorRegistration";
import { loadProfile, readDraft } from "./instructorStore";

/* The nav from STEP 11, in the order an instructor's day actually runs:
   what's on today, then the calendar it sits in, then the people in it. */
const SECTIONS = [
  { id: "dashboard",    label: "Dashboard",    icon: LayoutDashboard },
  { id: "calendar",     label: "Calendar",     icon: Calendar },
  { id: "students",     label: "Students",     icon: Users },
  { id: "bookings",     label: "Bookings",     icon: CalendarCheck },
  { id: "availability", label: "Availability", icon: Clock },
  { id: "marketplace",  label: "Marketplace",  icon: Store },
  { id: "earnings",     label: "Earnings",     icon: Wallet },
  { id: "reviews",      label: "Reviews",      icon: Star },
  { id: "messages",     label: "Messages",     icon: MessageSquare },
  { id: "profile",      label: "Profile",      icon: UserCircle },
];

/* What each section will be, said once, in the section itself. These are
   promises the schema already has a shape for — not marketing copy. */
const COMING = {
  calendar: {
    title: "Your calendar",
    message: "Day, week and month views of every lesson — your own students and marketplace bookings side by side, with the free slots in between.",
  },
  students: {
    title: "Your students",
    message: "Add the students you already teach, and see the ones the marketplace sends you. Your own students never carry an acquisition fee.",
  },
  bookings: {
    title: "Bookings",
    message: "Requests to accept or decline, upcoming lessons, and the history behind each one.",
  },
  availability: {
    title: "Availability",
    message: "Working days and hours, breaks, holidays, travel buffers and how much notice you need — the rules the marketplace books against.",
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
  profile: {
    title: "Your profile",
    message: "ADI number and verification, areas served, transmission, lesson types, prices and photos — this is what a learner compares you on.",
  },
};

export default function InstructorPortal({ onExitRole }) {
  const { user } = useAuth();
  const [section, setSection] = useState("dashboard");
  const [registering, setRegistering] = useState(false);
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
            <button
              onClick={onExitRole}
              className="inline-flex items-center gap-1 text-xs font-bold uppercase tracking-widest text-slate-400 hover:text-emerald-400 py-1"
            >
              <ChevronLeft size={15} /> Switch
            </button>
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
function InstructorDashboard({ loading, status, profile, draft, onRegister }) {
  return (
    <>
      {loading
        ? <StatusSkeleton />
        : <VerificationCard
            status={status}
            profile={profile}
            draft={draft}
            onRegister={onRegister}
          />}

      <div className="mt-4 grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Stat label="Today's lessons" value="—" note="Nothing booked yet" />
        <Stat label="This week" value="—" note="Earnings once paid lessons run" />
        <Stat label="Active students" value="—" note="Yours plus marketplace" />
        <Stat label="New enquiries" value="—" note="From learners nearby" />
      </div>

      <div className="mt-4 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl p-5">
        <div className="flex items-center gap-2.5">
          <Hammer size={18} className="text-amber-500 shrink-0" />
          <h2 className="font-bold text-slate-900 dark:text-white">
            Still being built
          </h2>
        </div>
        <p className="mt-2 text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
          Your calendar, students and the marketplace are next. Nothing is
          booked yet, and no numbers are being invented in the meantime —
          every tile above stays blank until there is a real booking behind it.
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

  /* Verified */
  return (
    <Panel tone="green" icon={ShieldCheck} title="Verified ADI">
      <p>
        ADI number <strong>{profile?.adi_number}</strong> checked against the RSA
        register. {profile?.listed
          ? "Your profile is visible to learners."
          : "Your profile is verified but not listed yet — that switch arrives with the marketplace."}
      </p>
      <div className="mt-4">
        <SecondaryButton onClick={onRegister}>Edit my profile</SecondaryButton>
      </div>
    </Panel>
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
