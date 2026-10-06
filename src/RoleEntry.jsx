/*
  ===========================================================================
  ROLE ENTRY — the front door

  The first question the platform asks, before anything else and before any
  account: what are you here to do?

    I'm a Student     learn, practise, find an instructor, pass the test
    I'm an Instructor manage your students, fill your calendar, get paid

  NO SIGN-UP WALL HERE, DELIBERATELY

  The old app opened on a login screen. That is the wrong order for a
  marketplace: a learner comparing instructors, and an instructor sizing up
  whether this is worth their time, both need to see the thing before being
  asked for an email. The account comes later, at the point it actually buys
  them something — booking, saving progress, taking payment.

  The choice is remembered (see platform.jsx), so this screen is shown once.
  "Not sure yet" is not an option on purpose; every visitor is one or the
  other, and an undecided third path would just be a worse version of both.
  ===========================================================================
*/

import React from "react";
import {
  GraduationCap, Briefcase, ChevronRight, ShieldCheck, Route, CalendarCheck,
} from "lucide-react";
import { Logo } from "./ui";

export default function RoleEntry({ onChoose }) {
  return (
    <div
      className="min-h-screen bg-slate-900 flex flex-col items-center px-5"
      style={{
        paddingTop: "max(2rem, calc(env(safe-area-inset-top) + 1.25rem))",
        paddingBottom: "max(2rem, calc(env(safe-area-inset-bottom) + 1.25rem))",
      }}
    >
      <div className="w-full max-w-sm flex flex-col items-center">
        <Logo size="lg" />

        <h1 className="mt-6 text-2xl font-black tracking-tight text-white text-center leading-tight">
          Your complete driving journey starts here
        </h1>
        <p className="mt-2 text-sm text-slate-300 text-center leading-relaxed">
          Learn. Book. Practise. Prepare. Pass.
        </p>

        <div className="mt-7 w-full space-y-3">
          <RoleCard
            icon={GraduationCap}
            title="I'm a Student"
            body="Learn and book driving lessons"
            tone="emerald"
            onClick={() => onChoose("student")}
          />
          <RoleCard
            icon={Briefcase}
            title="I'm an Instructor"
            body="Join and get more students"
            tone="blue"
            onClick={() => onChoose("instructor")}
          />
        </div>

        {/* Three reasons to trust it, in the wireframe's own words. Kept to
            icon + two words each — this is a decision screen, not a pitch. */}
        <div className="mt-8 w-full grid grid-cols-3 gap-2.5">
          <Reassurance icon={ShieldCheck} label="Verified Instructors" />
          <Reassurance icon={Route} label="Complete Learning Path" />
          <Reassurance icon={CalendarCheck} label="Book with Confidence" />
        </div>

        <p className="mt-7 text-xs text-slate-500 text-center leading-relaxed">
          You can change this later. Studying for the theory test doesn't
          need an account.
        </p>
      </div>
    </div>
  );
}

function RoleCard({ icon: Icon, title, body, tone, onClick }) {
  const accent = tone === "blue"
    ? "bg-blue-500 text-white"
    : "bg-emerald-500 text-slate-900";

  return (
    <button
      onClick={onClick}
      className="w-full text-left bg-slate-800 hover:bg-slate-700/80 border border-slate-700 rounded-2xl p-4 flex items-center gap-3.5 transition active:scale-[0.99]"
    >
      <span className={`w-11 h-11 rounded-xl flex items-center justify-center shrink-0 ${accent}`}>
        <Icon size={22} strokeWidth={2.4} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block font-bold text-white">{title}</span>
        <span className="block text-sm text-slate-400 leading-snug">{body}</span>
      </span>
      <ChevronRight size={20} className="text-slate-500 shrink-0" />
    </button>
  );
}

function Reassurance({ icon: Icon, label }) {
  return (
    <div className="flex flex-col items-center text-center gap-1.5">
      <span className="w-9 h-9 rounded-full bg-slate-800 border border-slate-700 flex items-center justify-center">
        <Icon size={16} className="text-emerald-400" />
      </span>
      <span className="text-[10px] font-bold uppercase tracking-wide text-slate-400 leading-tight">
        {label}
      </span>
    </div>
  );
}
