/*
  ===========================================================================
  MY DRIVING JOURNEY

  The screen that answers the three questions a learner actually has:

      Where am I?
      What should I do next?
      How close am I to passing?

  Eight milestones from theory to full licence, with the one they're on
  pulled out at the top as a single next step. Everything else is a row.

  WHERE THE STATUS COMES FROM

  Theory is measured, not claimed: coverage and mock scores come from the
  progress store, which recorded every question actually answered. The
  milestones the app cannot observe — passing the real theory test at a test
  centre, a permit arriving — come from what the learner told us at
  onboarding, and can be corrected here at any time.

  Stages whose features don't exist yet say so. An EDT row that showed
  "0 / 12" would imply the app was counting something; it isn't, and a
  learner comparing that against their instructor's record would be the one
  who found out.
  ===========================================================================
*/

import React from "react";
import {
  BookOpen, IdCard, Car, Clock, Timer, Flag, ClipboardCheck, Award,
  Check, ChevronRight, Lock, Pencil,
} from "lucide-react";
import { Screen, ProgressBar, ProgressRing, PrimaryButton } from "./ui";
import { useProgress } from "./progressStore";
import { useAuth } from "./appAuth";
import { usePlatform, JOURNEY_PATH, reachedIndexFor } from "./platform";
import { PASS_MARK } from "./appStructure";

const ICONS = {
  theory: BookOpen,
  permit: IdCard,
  edt: Car,
  practice: Clock,
  mock: Timer,
  "test-prep": ClipboardCheck,
  "driving-test": Flag,
  "full-licence": Award,
};

/* The stages that have something real behind them today. The rest are drawn
   as the road ahead rather than as features that are broken. */
/* EDT joins these not because lessons are booked here — they are not — but
   because the thing a learner needs at that point, finding a verified
   instructor, now exists. */
const BUILT = new Set(["theory", "mock", "edt"]);

/* Which screen each built milestone opens. */
const OPENS = { theory: "home", mock: "mocks", edt: "instructors" };

export default function StudentJourney({ go, onChangeStage }) {
  const { isGuest } = useAuth();
  const { overall, mockReadiness } = useProgress();
  const { journeyStage, stage } = usePlatform();

  const reached = reachedIndexFor(journeyStage);

  /* The one thing to do next: the first milestone not behind them. */
  const currentIndex = Math.min(reached, JOURNEY_PATH.length - 1);
  const current = JOURNEY_PATH[currentIndex];

  return (
    <>
      <div className="bg-slate-900 text-white">
        <div
          className="max-w-2xl mx-auto px-5 pb-6"
          style={{ paddingTop: "max(1.5rem, calc(env(safe-area-inset-top) + 0.875rem))" }}
        >
          <h1 className="text-2xl font-black tracking-tight">My driving journey</h1>
          <p className="mt-1 text-sm text-slate-400">
            Theory to full licence, and where you are on it.
          </p>

          {stage && (
            <button
              onClick={onChangeStage}
              className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-white/10 hover:bg-white/20 px-3 py-1.5 text-xs font-bold transition"
            >
              <Pencil size={12} />
              {stage.label}
            </button>
          )}
        </div>
      </div>

      <Screen>
        {/* NEXT STEP — the whole point of the screen. */}
        <NextStep
          milestone={current}
          overall={overall}
          mockReadiness={mockReadiness}
          go={go}
        />

        <p className="mt-6 mb-3 text-xs font-bold uppercase tracking-widest text-slate-400">
          The full journey
        </p>

        <div className="space-y-2.5">
          {JOURNEY_PATH.map((milestone, i) => (
            <MilestoneRow
              key={milestone.id}
              milestone={milestone}
              position={i}
              currentIndex={currentIndex}
              overall={overall}
              mockReadiness={mockReadiness}
              isGuest={isGuest}
              go={go}
            />
          ))}
        </div>

        <p className="mt-5 text-xs text-slate-400 leading-relaxed">
          Theory progress is measured from the questions you've actually
          answered. The permit and test milestones are what you told us — tap
          your stage above to correct them any time.
        </p>
      </Screen>
    </>
  );
}

/* ---------------------------------------------------------------------------
   NEXT STEP
   --------------------------------------------------------------------------- */
function NextStep({ milestone, overall, mockReadiness, go }) {
  const Icon = ICONS[milestone.id] || BookOpen;
  const built = BUILT.has(milestone.id);

  /* Theory is the one stage that can give a genuinely specific instruction,
     because it is the one being measured. */
  const theoryLine = overall.answered === 0
    ? `${overall.total} questions across six topics. Start anywhere.`
    : `${overall.answered} of ${overall.total} questions answered` +
      (overall.gradedAnswers > 0 ? ` · ${overall.accuracyPct}% correct` : "");

  return (
    <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl p-5">
      <p className="text-[11px] font-bold uppercase tracking-widest text-emerald-600 dark:text-emerald-400">
        Your next step
      </p>

      <div className="mt-2.5 flex items-start gap-3.5">
        <div className="w-11 h-11 rounded-xl bg-emerald-500 flex items-center justify-center shrink-0">
          <Icon size={22} className="text-white" />
        </div>
        <div className="min-w-0 flex-1">
          <h2 className="font-black text-lg text-slate-900 dark:text-white leading-tight">
            {milestone.label}
          </h2>
          <p className="mt-0.5 text-sm text-slate-500 dark:text-slate-400 leading-snug">
            {milestone.id === "theory" ? theoryLine : milestone.blurb}
          </p>
        </div>
      </div>

      {milestone.id === "theory" && overall.answered > 0 && (
        <div className="mt-4">
          <ProgressBar pct={overall.coveragePct} />
        </div>
      )}

      {milestone.id === "mock" && (
        <p className="mt-3 text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
          {mockReadiness.papersSat === 0
            ? "You haven't sat a full paper yet. It's 40 questions in 45 minutes — the closest thing to the real test."
            : `${mockReadiness.papersSat} paper${mockReadiness.papersSat === 1 ? "" : "s"} sat, best ${overall.mockBest}%. ${PASS_MARK}% passes.`}
        </p>
      )}

      <div className="mt-4">
        {built ? (
          <PrimaryButton
            onClick={() => go({ screen: OPENS[milestone.id] || "home" })}
          >
            {milestone.id === "mock" ? "Sit a mock test" : "Continue learning"}
          </PrimaryButton>
        ) : (
          <div className="rounded-xl bg-slate-100 dark:bg-slate-900/60 p-3.5">
            <p className="text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
              This part of the journey is being built. In the meantime the
              theory section is open and your progress is being kept.
            </p>
            <button
              onClick={() => go({ screen: "home" })}
              className="mt-2.5 text-sm font-bold text-emerald-600 dark:text-emerald-400 inline-flex items-center gap-1"
            >
              Go to the theory section <ChevronRight size={15} />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------------------
   ONE MILESTONE
   --------------------------------------------------------------------------- */
function MilestoneRow({ milestone, position, currentIndex, overall, mockReadiness, isGuest, go }) {
  const Icon = ICONS[milestone.id] || BookOpen;
  const built = BUILT.has(milestone.id);

  const done = position < currentIndex;
  const active = position === currentIndex;

  /* What this row says on its right-hand side. Measured where it can be,
     honest about being unmeasured where it can't. */
  let status;
  if (milestone.id === "theory") {
    status = overall.answered > 0 ? `${overall.coveragePct}% covered` : "Not started";
  } else if (milestone.id === "mock") {
    status = mockReadiness.papersSat > 0 ? `Best ${overall.mockBest}%` : "Not sat";
  } else if (done) {
    status = "Done";
  } else if (!built) {
    status = "Coming soon";
  } else {
    status = "Not started";
  }

  const openable = built && !(isGuest && milestone.id === "mock");

  return (
    <button
      onClick={() => {
        if (!openable) return;
        go({ screen: OPENS[milestone.id] || "home" });
      }}
      disabled={!openable}
      className={`w-full text-left bg-white dark:bg-slate-800 border rounded-2xl p-4 transition ${
        active
          ? "border-emerald-400"
          : "border-slate-200 dark:border-slate-700"
      } ${openable ? "hover:border-emerald-400 active:scale-[0.99]" : "opacity-80"}`}
    >
      <div className="flex items-center gap-3.5">
        <div className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${
          done ? "bg-emerald-500"
            : active ? "bg-slate-900 dark:bg-slate-600"
            : "bg-slate-200 dark:bg-slate-700"
        }`}>
          {done
            ? <Check size={17} className="text-white" strokeWidth={3} />
            : <Icon size={17} className={
                active ? "text-white" : "text-slate-400 dark:text-slate-400"
              } />}
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2">
            <span className="font-bold text-slate-900 dark:text-white leading-tight truncate">
              {milestone.label}
            </span>
            <span className="ml-auto shrink-0 text-[10px] font-black uppercase tracking-wider text-slate-400">
              {status}
            </span>
          </div>
          <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400 leading-snug">
            {milestone.blurb}
          </p>
        </div>

        {openable
          ? <ChevronRight size={17} className="text-slate-300 dark:text-slate-600 shrink-0" />
          : !built
            ? <Lock size={14} className="text-slate-300 dark:text-slate-600 shrink-0" />
            : null}
      </div>
    </button>
  );
}
