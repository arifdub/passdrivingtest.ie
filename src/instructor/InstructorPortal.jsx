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

import React, { useState } from "react";
import {
  LayoutDashboard, Calendar, Users, CalendarCheck, Clock, Store,
  Wallet, Star, MessageSquare, UserCircle, ChevronLeft, Hammer,
} from "lucide-react";
import { Logo, EmptyState } from "../ui";

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
  const [section, setSection] = useState("dashboard");
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
          ? <InstructorDashboard />
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
function InstructorDashboard() {
  return (
    <>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Stat label="Today's lessons" value="—" note="Nothing booked yet" />
        <Stat label="This week" value="—" note="Earnings once paid lessons run" />
        <Stat label="Active students" value="—" note="Yours plus marketplace" />
        <Stat label="New enquiries" value="—" note="From learners nearby" />
      </div>

      <div className="mt-4 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl p-5">
        <div className="flex items-center gap-2.5">
          <Hammer size={18} className="text-amber-500 shrink-0" />
          <h2 className="font-bold text-slate-900 dark:text-white">
            The portal is being built
          </h2>
        </div>
        <p className="mt-2 text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
          Registration, ADI verification, your calendar and the marketplace are
          next. Nothing here is live yet, and no numbers are being invented in
          the meantime — every tile above will stay blank until there is a real
          booking behind it.
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
