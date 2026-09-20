/*
  ===========================================================================
  SCREENS

  Home is built around the six study topics. Each shows how much of its bank
  has been covered and how the last run went. Below them sits the mock test,
  and below that the flashcard decks — study material rather than assessment,
  so they don't compete with the topics for attention.

  The real test does not have topics. It is one paper of 40 mixed questions
  with a single pass mark of 35. These six exist so there is a sensible way to
  study and to see where marks are being lost; every screen here is worded to
  keep that distinction, because a learner who believes they can "fail a
  section" will revise the wrong way.
  ===========================================================================
*/

import React, { useState } from "react";
import {
  ClipboardCheck, ShieldCheck, GraduationCap, Wrench, Truck, Layers,
  TrendingUp, User, LogOut, Shield, ChevronRight, Trash2, Timer,
  Smartphone, Download, Share2, Check, Lock, Play, AlertTriangle, Target,
  Sun, Moon, Type,
} from "lucide-react";
import {
  ADI_SECTIONS, MOCKS, DECKS, PASS_MARK, PASS_QUESTIONS, MOCK_LENGTH, MOCK_MINUTES, lockedForGuest,
} from "./appStructure";
import { useAuth } from "./appAuth";
import { useProgress } from "./progressStore";
import usePwaInstall from "./usePwaInstall";
import { getDeck } from "./contentSources";
import {
  Logo, Screen, ScreenHeader, ProgressBar, ProgressRing, EmptyState,
  SecondaryButton, PrimaryButton, Toggle, DangerButton, SettingsGroup,
} from "./ui";
import { useTextSize } from "./textSize";

const SECTION_ICON = {
  "dtt.sec.rules": ClipboardCheck,
  "dtt.sec.signs": Truck,
  "dtt.sec.speed": Timer,
  "dtt.sec.vulnerable": ShieldCheck,
  "dtt.sec.documents": GraduationCap,
  "dtt.sec.responsible": Wrench,
};

/* ===========================================================================
   HOME
   =========================================================================== */
export function HomeScreen({ go }) {
  const { displayName, subscription, isGuest, exitGuest } = useAuth();
  const { getSection, getModule, overall } = useProgress();
  const [lockedPrompt, setLockedPrompt] = React.useState(null);


  /* Combined flashcard progress across every deck. Counted from the real
     decks, so it cannot drift from what the deck screens show. */
  const cardStats = DECKS.reduce((acc, d) => {
    const content = getDeck(d.id);
    const size = content ? content.cards.length : (d.count || 0);
    const known = Math.min(getModule(d.id).completedIds.length, size);
    return { total: acc.total + size, known: acc.known + known };
  }, { total: 0, known: 0 });
  const cardPct = cardStats.total
    ? Math.round((cardStats.known / cardStats.total) * 100)
    : 0;

  return (
    <>
      <div className="bg-slate-900 text-white">
        <div
          className="max-w-2xl mx-auto px-5 pb-6"
          style={{ paddingTop: "max(1.5rem, calc(env(safe-area-inset-top) + 0.875rem))" }}
        >
          <div className="flex justify-center">
            {/* The logo is the way back out to the public site.

                target="_blank" matters more than it looks: when the app is
                running as an installed home-screen app there is no address
                bar and no Back button, so a same-window navigation to the
                landing page would strand someone on it with no way back to
                their progress. Opening it in the browser instead leaves the
                app exactly where it was.

                ?stay=1 stops the landing page's own redirect from bouncing
                straight back here — that redirect exists to make the
                home-screen icon always open the app, and this is the one
                case where the landing page was asked for on purpose. */}
            <a
              href="/?stay=1"
              target="_blank"
              rel="noopener"
              aria-label="PassDrivingTest.ie — about the Driver Theory Test"
              className="inline-block"
            >
              <Logo size="md" />
            </a>
          </div>
          <p className="mt-4 text-slate-400 text-sm">Hi {displayName} 👋</p>
          <h1 className="mt-0.5 text-2xl font-black tracking-tight">Driver Theory Test</h1>
          <p className="mt-1 text-sm text-slate-400">
            Car &amp; category B — 40 questions, 35 to pass
          </p>
        </div>
      </div>

      <Screen>
        {/* Overall coverage */}
        <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl p-4 flex items-center gap-4 -mt-10 shadow-lg">
          <ProgressRing pct={overall.coveragePct} size={72} stroke={6} label="covered" />
          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-bold uppercase tracking-widest text-slate-400">
              Your progress
            </p>
            <p className="mt-1 text-sm text-slate-600 dark:text-slate-300 leading-snug">
              {overall.answered === 0
                ? `${overall.total} questions across six topics. Pick one below to start.`
                : `${overall.answered} of ${overall.total} questions answered` +
                  (overall.sectionsPassed > 0
                    ? ` · ${overall.sectionsPassed} of ${overall.sectionCount} topics at test standard.`
                    : ".")}
            </p>

            {/* Coverage says how much has been seen; accuracy says how well
                it went. Showing only the first flatters a weak score. */}
            {overall.gradedAnswers > 0 && (
              <div className="mt-2.5 flex items-baseline gap-2">
                <span className={`text-lg font-black ${
                  overall.accuracyPct >= PASS_MARK
                    ? "text-emerald-600 dark:text-emerald-400"
                    : "text-amber-600 dark:text-amber-400"
                }`}>
                  {overall.accuracyPct}%
                </span>
                <span className="text-xs font-semibold text-slate-400">
                  correct · {overall.correctAnswers} of {overall.gradedAnswers}
                </span>
              </div>
            )}
          </div>
        </div>

        {/* The six study topics */}
        <p className="mt-6 mb-1 text-xs font-bold uppercase tracking-widest text-slate-400">
          The six topics
        </p>
        <p className="mb-3 text-xs text-slate-400 leading-snug">
          The real test is one paper of 40 mixed questions. These topics are how
          to study for it, not sections you are marked on separately.
        </p>

        <div className="space-y-2.5">
          {ADI_SECTIONS.map(section => {
            const Icon = SECTION_ICON[section.id] || ClipboardCheck;
            const p = getSection(section.id);
            const locked = lockedForGuest(section.id, isGuest);
            return (
              <button
                key={section.id}
                onClick={() => locked
                  ? setLockedPrompt(section.label)
                  : go({ screen: "section", sectionId: section.id })}
                className={`w-full text-left bg-white dark:bg-slate-800 border rounded-2xl p-4 transition active:scale-[0.99] ${
                  locked
                    ? "border-slate-200 dark:border-slate-700 opacity-70"
                    : "border-slate-200 dark:border-slate-700 hover:border-emerald-400"
                }`}
              >
                <div className="flex items-start gap-3.5">
                  <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${
                    locked
                      ? "bg-slate-300 dark:bg-slate-600"
                      : p.passed ? "bg-emerald-500" : "bg-slate-700 dark:bg-slate-600"
                  }`}>
                    {locked
                      ? <Lock size={17} className="text-white" />
                      : <Icon size={18} className="text-white" />}
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-baseline gap-2">
                      <span className="text-[10px] font-black text-slate-300 dark:text-slate-600">
                        {section.number}
                      </span>
                      <span className="font-bold text-slate-900 dark:text-white leading-tight">
                        {section.label}
                      </span>
                      {/* The sister ADI app shows each section's own pass
                          mark here, because they differ. This test has one
                          mark for the whole paper, so printing 88% six times
                          would be noise. The question count differs and is
                          what someone picking a topic actually wants. */}
                      <span className="ml-auto shrink-0 text-[10px] font-black uppercase tracking-wider text-slate-400 tabular-nums">
                        {p.total} Qs
                      </span>
                    </div>

                    {locked ? (
                      <p className="mt-1.5 text-sm text-slate-500 dark:text-slate-400 leading-snug">
                        {p.total} questions · create a free account to unlock
                      </p>
                    ) : (
                      <div className="mt-2">
                        <div className="flex justify-between text-[11px] font-bold text-slate-400 mb-1">
                          <span>{p.answered} / {p.total} questions</span>
                          <span>
                            {p.attempts > 0
                              ? `${p.accuracyPct}% correct · best ${p.bestPct}%`
                              : "Not started"}
                          </span>
                        </div>
                        <ProgressBar
                          pct={p.coveragePct}
                          tone={p.passed ? "emerald" : p.started ? "amber" : "slate"}
                        />
                      </div>
                    )}

                    {!locked && p.attempts > 0 && (
                      <p className={`mt-1.5 text-xs font-semibold ${
                        p.passed
                          ? "text-emerald-600 dark:text-emerald-400"
                          : "text-amber-600 dark:text-amber-400"
                      }`}>
                        {p.passed ? "At pass standard" : `Keep practising — ${p.passMark}% needed`}
                      </p>
                    )}
                  </div>

                  {locked
                    ? <Lock size={15} className="text-slate-300 dark:text-slate-600 shrink-0 mt-2.5" />
                    : <ChevronRight size={18} className="text-slate-300 dark:text-slate-600 shrink-0 mt-2" />}
                </div>
              </button>
            );
          })}
        </div>

        {/* Mock tests — kept here as well as on their own tab. The tab is
            where the readiness breakdown lives; this is the shortcut for
            someone already on the home screen. */}
        <div className="mt-6 mb-3 flex items-baseline justify-between gap-3">
          <p className="text-xs font-bold uppercase tracking-widest text-slate-400">
            Exam conditions
          </p>
          <button
            onClick={() => go({ screen: "mocks" })}
            className="text-xs font-bold uppercase tracking-widest text-emerald-600 dark:text-emerald-400 inline-flex items-center gap-0.5"
          >
            See all <ChevronRight size={13} />
          </button>
        </div>

        <div className="space-y-2.5">
          {MOCKS.map(paper => {
            const m = getModule(paper.id);
            const locked = lockedForGuest(paper.id, isGuest);
            return (
              <button
                key={paper.id}
                onClick={() => locked
                  ? setLockedPrompt(paper.label)
                  : go({ screen: "mock", mockId: paper.id })}
                className={`w-full text-left rounded-2xl p-4 bg-slate-900 transition active:scale-[0.99] ${
                  locked ? "opacity-70" : "hover:bg-slate-800"
                }`}
              >
                <div className="flex items-start gap-3.5">
                  <div className="w-11 h-11 rounded-xl bg-white/15 flex items-center justify-center shrink-0">
                    {locked
                      ? <Lock size={20} className="text-white" />
                      : <Timer size={22} className="text-white" />}
                  </div>

                  <div className="flex-1 min-w-0">
                    <h2 className="text-base font-black tracking-tight text-white">
                      {paper.label}
                    </h2>
                    <p className="mt-0.5 text-sm text-slate-300 leading-snug">
                      {locked
                        ? "Create a free account to unlock the full mock exam."
                        : paper.blurb}
                    </p>

                    {!locked && m.attempts > 0 && (
                      <div className="mt-2.5">
                        <div className="flex justify-between text-[11px] font-bold text-slate-400 mb-1">
                          <span>Best score</span>
                          <span>{m.bestPct}%{m.passed ? " · passed" : ""}</span>
                        </div>
                        <div className="h-2 bg-white/15 rounded-full overflow-hidden">
                          <div
                            className={`h-2 rounded-full ${m.passed ? "bg-emerald-400" : "bg-amber-400"}`}
                            style={{ width: `${m.bestPct}%` }}
                          />
                        </div>
                      </div>
                    )}
                  </div>

                  <ChevronRight size={18} className="text-slate-500 shrink-0 mt-3" />
                </div>
              </button>
            );
          })}
        </div>

        {/* Flashcards */}
        <div className="mt-6 mb-3">
          <div className="flex items-baseline justify-between gap-3">
            <p className="text-xs font-bold uppercase tracking-widest text-slate-400">
              Flashcards
            </p>
            <span className="text-xs font-bold text-slate-400 tabular-nums">
              {cardStats.known} / {cardStats.total} known
            </span>
          </div>

          <div className="mt-1.5 flex items-center gap-2.5">
            <div className="flex-1">
              <ProgressBar
                pct={cardPct}
                tone={cardPct === 100 ? "emerald" : cardStats.known ? "amber" : "slate"}
              />
            </div>
            <span className="text-[11px] font-bold text-slate-400 shrink-0 tabular-nums">
              {cardPct}%
            </span>
          </div>

          <p className="mt-1.5 text-xs text-slate-400 leading-snug">
            Study material. Useful for learning, but not a substitute for the sections above.
          </p>
        </div>

        <div className="space-y-2.5">
          {DECKS.map(deck => {
            const p = getModule(deck.id);
            /* Count the real deck rather than the figure in appStructure, so
               adding cards to a data file can never leave the home screen
               quoting a stale total. */
            const content = getDeck(deck.id);
            const size = content ? content.cards.length : deck.count;
            const known = Math.min(p.completedIds.length, size);
            const pct = size ? Math.round((known / size) * 100) : 0;
            return (
              <button
                key={deck.id}
                onClick={() => go({ screen: "deck", deckId: deck.id })}
                className="w-full text-left bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl p-4 flex items-center gap-3.5 transition hover:border-emerald-400 active:scale-[0.99]"
              >
                <div className="w-10 h-10 rounded-xl bg-slate-200 dark:bg-slate-700 flex items-center justify-center shrink-0">
                  <Layers size={18} className="text-slate-600 dark:text-slate-300" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-bold text-slate-900 dark:text-white">{deck.label}</p>
                  <p className="text-sm text-slate-500 dark:text-slate-400 leading-snug">
                    {known > 0
                      ? `${known} of ${size} cards known`
                      : `${size} cards · ${deck.blurb}`}
                  </p>
                  <div className="mt-2 flex items-center gap-2.5">
                    <div className="flex-1">
                      <ProgressBar
                        pct={pct}
                        tone={pct === 100 ? "emerald" : known ? "amber" : "slate"}
                      />
                    </div>
                    <span className="text-[11px] font-bold text-slate-400 shrink-0 tabular-nums">
                      {pct}%
                    </span>
                  </div>
                </div>
                <ChevronRight size={18} className="text-slate-300 dark:text-slate-600 shrink-0" />
              </button>
            );
          })}
        </div>

        {isGuest && overall.answered > 0 && (
          <button
            onClick={exitGuest}
            className="mt-6 w-full text-left bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-900 rounded-2xl p-4 flex items-center gap-3"
          >
            <div className="flex-1">
              <p className="font-bold text-slate-900 dark:text-white text-sm">Save your progress</p>
              <p className="mt-0.5 text-sm text-slate-600 dark:text-slate-300 leading-snug">
                Create an account and everything you've studied comes with you.
              </p>
            </div>
            <ChevronRight size={18} className="text-emerald-600 dark:text-emerald-400 shrink-0" />
          </button>
        )}

        {!isGuest && (
          <p className="mt-6 text-center text-xs text-slate-400">
            Subscription: <span className="font-bold text-emerald-600 dark:text-emerald-400">
              {subscription.label}
            </span>
          </p>
        )}
      </Screen>

      {/* Shown when a guest taps something they don't have yet. A sheet rather
          than a redirect, so they can dismiss it and carry on with Section 1
          instead of being thrown out to the sign-up form. */}
      {lockedPrompt && (
        <div
          className="fixed inset-0 z-30 bg-slate-900/70 backdrop-blur-sm flex items-end"
          onClick={() => setLockedPrompt(null)}
        >
          <div
            className="w-full bg-white dark:bg-slate-800 rounded-t-3xl p-6"
            style={{ paddingBottom: "max(1.5rem, calc(env(safe-area-inset-bottom) + 1rem))" }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="w-10 h-10 rounded-xl bg-emerald-500 flex items-center justify-center">
              <Lock size={18} className="text-white" />
            </div>
            <h2 className="mt-4 text-lg font-black tracking-tight text-slate-900 dark:text-white">
              {lockedPrompt}
            </h2>
            <p className="mt-2 text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
              Guests get Section&nbsp;1 and the flashcards in full. Create a free
              account to open the other four sections and the mock exam — and
              your progress will follow you to any device.
            </p>
            <p className="mt-2 text-sm text-slate-500 dark:text-slate-400 leading-relaxed">
              Everything you've already studied comes with you.
            </p>

            <div className="mt-5 space-y-2.5">
              <PrimaryButton onClick={exitGuest}>Create a free account</PrimaryButton>
              <button
                onClick={() => setLockedPrompt(null)}
                className="w-full text-sm font-semibold text-slate-500 dark:text-slate-400 py-2.5"
              >
                Not now
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

/* ===========================================================================
   MOCK TEST HUB  —  the tab

   This replaced a "Learn" tab that rendered the home screen, so tapping it
   changed nothing. Two Home buttons is worse than three tabs.

   The danger in replacing it was building a second copy of the home screen's
   mock cards — a tab that just repeats what you already scrolled past is the
   same mistake in different clothes. So this screen answers a question the
   home screen can't:

     WHERE ARE YOUR MARKS ACTUALLY GOING?

   The test is one score out of 40, so no topic can fail you on its own — but
   "best score 82%" is still not a revision plan. Pooling the topic breakdowns
   from every paper sat gives one: "Traffic Signs is averaging 61% across two
   papers, and that is most of the gap."

   Order on the screen is deliberate — the verdict first, then the thing to
   do about it, then the papers. Someone opening this tab wants to know where
   they stand before they pick a paper.
   =========================================================================== */
export function MockHubScreen({ go }) {
  const { getModule, mockReadiness } = useProgress();
  const { isGuest, exitGuest } = useAuth();

  const r = mockReadiness;
  const papers = MOCKS.map(p => ({ ...p, progress: getModule(p.id) }));
  const anySat = papers.some(p => p.progress.attempts > 0);

  /* A paper stopped part-way. Surfaced at the top because an unfinished 90
     minutes is the most time-sensitive thing on this screen — resuming beats
     starting something new. */
  const resumable = papers.find(p => hasPausedAttempt(p.id));

  /* Guests can't sit a mock. Rather than a screen of padlocks, explain what
     the exam is and what an account gets them — this tab is the strongest
     reason to sign up, so it should read like one. */
  if (isGuest) {
    return (
      <>
        <ScreenHeader
          title="Mock Test"
          subtitle="Full exam conditions"
        />
        <Screen>
          <ExamConditionsCard />
          <div className="mt-4 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl p-5 text-center">
            <div className="w-12 h-12 mx-auto rounded-2xl bg-slate-100 dark:bg-slate-700 flex items-center justify-center">
              <Lock size={22} className="text-slate-400" />
            </div>
            <h2 className="mt-3 font-bold text-slate-900 dark:text-white">
              Mock papers need an account
            </h2>
            <p className="mt-1.5 text-sm text-slate-500 dark:text-slate-400 leading-relaxed">
              A mock is {MOCK_LENGTH} questions over {MOCK_MINUTES} minutes, and it's only
              worth sitting if the result is still there next week. An account keeps your
              scores and section breakdown across every device.
            </p>
            <div className="mt-4">
              <PrimaryButton onClick={exitGuest}>Create a free account</PrimaryButton>
            </div>
          </div>
        </Screen>
      </>
    );
  }

  return (
    <>
      <ScreenHeader
        title="Mock Test"
        subtitle={`${MOCK_LENGTH} questions · ${MOCK_MINUTES} minutes · ${PASS_QUESTIONS} to pass`}
      />
      <Screen>
        {/* ---- 1. Where you stand ---- */}
        {!r.hasData ? (
          <div className="bg-slate-900 rounded-2xl p-5">
            <div className="flex items-center gap-2.5">
              <Target size={18} className="text-emerald-400 shrink-0" />
              <h2 className="font-bold text-white">Nothing measured yet</h2>
            </div>
            <p className="mt-2 text-sm text-slate-300 leading-relaxed">
              Sit a paper and this becomes a breakdown of where your marks went,
              topic by topic — which is what tells you where to revise. Practising
              one topic is good preparation, but only a full 40-question paper
              measures you the way the real test does.
            </p>
          </div>
        ) : r.readyForExam ? (
          <div className="bg-emerald-600 rounded-2xl p-5">
            <div className="flex items-center gap-2.5">
              <Check size={18} className="text-white shrink-0" />
              <h2 className="font-bold text-white">You're at test standard</h2>
            </div>
            <p className="mt-2 text-sm text-emerald-50 leading-relaxed">
              {r.overallCorrect} of {r.overallTotal} across every paper you've sat —
              {" "}{r.overallPct}%, where the test needs {PASS_MARK}%. Keep it warm with
              a re-sit closer to your test date.
            </p>
          </div>
        ) : (
          <div className="bg-slate-900 rounded-2xl p-5">
            <div className="flex items-center gap-2.5">
              <AlertTriangle size={18} className="text-amber-400 shrink-0" />
              <h2 className="font-bold text-white">
                {r.overallPct >= PASS_MARK - 5 ? "Nearly there" : "Not ready yet"}
              </h2>
            </div>
            <p className="mt-2 text-sm text-slate-300 leading-relaxed">
              {r.overallCorrect} of {r.overallTotal} across every paper you've sat —
              {" "}{r.overallPct}%, and the test needs {PASS_MARK}% ({PASS_QUESTIONS} of{" "}
              {MOCK_LENGTH}).
              {r.weakest
                ? ` Most of the gap is in ${r.weakest.examLabel}, where you're on ${r.weakest.pct}%.`
                : ""}
            </p>
            {r.weakest && (
            <button
              onClick={() => go({ screen: "section", sectionId: r.weakest.id })}
              className="mt-4 w-full bg-emerald-500 hover:bg-emerald-400 text-slate-900 font-bold py-2.5 rounded-xl transition flex items-center justify-center gap-2"
            >
              Practise {r.weakest.label} <ChevronRight size={16} />
            </button>
            )}
          </div>
        )}

        {/* ---- 2. Where the marks are going ---- */}
        {r.hasData && (
          <div className="mt-4 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl p-5">
            <div className="flex items-baseline justify-between">
              <h2 className="font-bold text-slate-900 dark:text-white">
                Where your marks are going
              </h2>
              <span className="text-[11px] font-bold uppercase tracking-widest text-slate-400">
                {r.overallPct}% overall
              </span>
            </div>
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
              Pooled across every paper you've sat. No topic can fail you on its own —
              the test is one mark out of {MOCK_LENGTH} — so read these as where the
              revision time is best spent. The line is the overall standard.
            </p>

            <div className="mt-4 space-y-3.5">
              {r.sections.map(s => (
                <button
                  key={s.id}
                  onClick={() => go({ screen: "section", sectionId: s.id })}
                  className="w-full text-left"
                >
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="text-sm font-semibold text-slate-800 dark:text-slate-100 truncate">
                      {s.examLabel}
                    </span>
                    <span className={`text-sm font-black shrink-0 tabular-nums ${
                      !s.seen ? "text-slate-300 dark:text-slate-600"
                        : s.atStandard ? "text-emerald-600 dark:text-emerald-400"
                        : "text-red-500 dark:text-red-400"
                    }`}>
                      {s.seen ? `${s.pct}%` : "—"}
                    </span>
                  </div>
                  <div className="mt-1.5 relative">
                    <ProgressBar
                      pct={s.seen ? s.pct : 0}
                      tone={!s.seen ? "slate" : s.atStandard ? "emerald" : "red"}
                      height="h-2"
                    />
                    <span
                      className="absolute top-0 bottom-0 w-px bg-slate-900 dark:bg-white"
                      style={{ left: `${s.passMark}%` }}
                      aria-hidden="true"
                    />
                  </div>
                  <p className="mt-1 text-xs text-slate-400">
                    {s.seen ? `${s.correct}/${s.total} correct` : "Not covered yet"}
                  </p>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* ---- 3. Resume ---- */}
        {resumable && (
          <button
            onClick={() => go({ screen: "mock", mockId: resumable.id })}
            className="mt-4 w-full text-left bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-900 rounded-2xl p-4 flex items-center gap-3"
          >
            <div className="w-10 h-10 rounded-xl bg-emerald-500 flex items-center justify-center shrink-0">
              <Play size={18} className="text-slate-900" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="font-bold text-slate-900 dark:text-white text-sm">
                {resumable.label} is paused
              </p>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Pick it up with the time you had left
              </p>
            </div>
            <ChevronRight size={18} className="text-emerald-600 shrink-0" />
          </button>
        )}

        {/* ---- 4. The papers ---- */}
        <p className="mt-6 mb-3 text-xs font-bold uppercase tracking-widest text-slate-400">
          {MOCKS.length} papers
        </p>

        <div className="space-y-2.5">
          {papers.map(p => (
            <MockPaperCard
              key={p.id}
              paper={p}
              onOpen={() => go({ screen: "mock", mockId: p.id })}
            />
          ))}
        </div>

        {/* ---- 5. What the exam is ---- */}
        <div className="mt-4">
          <ExamConditionsCard />
        </div>

        {!anySat && (
          <p className="mt-4 text-center text-xs text-slate-400 leading-relaxed px-4">
            Nothing here is graded against you — a mock is a measurement, and a bad
            first one is more useful than no first one.
          </p>
        )}
      </Screen>
    </>
  );
}

/* One paper. Carries its own history, since each is a fixed set of questions
   and two attempts at the same paper are directly comparable. */
function MockPaperCard({ paper, onOpen }) {
  const m = paper.progress;
  const sat = m.attempts > 0;

  return (
    <button
      onClick={onOpen}
      className="w-full text-left rounded-2xl p-4 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 hover:border-slate-300 dark:hover:border-slate-600 transition active:scale-[0.99]"
    >
      <div className="flex items-start gap-3.5">
        <div className={`w-11 h-11 rounded-xl flex items-center justify-center shrink-0 ${
          !sat ? "bg-slate-900 dark:bg-slate-700"
            : m.passed ? "bg-emerald-500" : "bg-amber-500"
        }`}>
          {sat && m.passed
            ? <Check size={20} className="text-white" strokeWidth={3} />
            : <Timer size={20} className="text-white" />}
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-baseline justify-between gap-2">
            <h3 className="font-black tracking-tight text-slate-900 dark:text-white">
              {paper.label}
            </h3>
            {sat && (
              <span className="text-sm font-black text-slate-900 dark:text-white shrink-0 tabular-nums">
                {m.bestPct}%
              </span>
            )}
          </div>

          <p className="mt-0.5 text-sm text-slate-500 dark:text-slate-400 leading-snug">
            {paper.blurb}
          </p>

          {sat ? (
            <>
              <div className="mt-2.5">
                <ProgressBar pct={m.bestPct} tone={m.passed ? "emerald" : "amber"} height="h-1.5" />
              </div>
              <p className={`mt-1.5 text-xs font-semibold ${
                m.passed
                  ? "text-emerald-600 dark:text-emerald-400"
                  : "text-amber-600 dark:text-amber-400"
              }`}>
                {m.passed ? "Passed every section" : "Not every section passed"}
                <span className="font-normal text-slate-400">
                  {" "}· {m.attempts} attempt{m.attempts === 1 ? "" : "s"}
                </span>
              </p>
            </>
          ) : (
            <p className="mt-2 text-xs font-bold uppercase tracking-widest text-emerald-600 dark:text-emerald-400">
              Not attempted
            </p>
          )}
        </div>

        <ChevronRight size={18} className="text-slate-300 dark:text-slate-600 shrink-0 mt-3" />
      </div>
    </button>
  );
}

/* The exam's shape, stated once here rather than re-explained on every mock
   intro screen. */
function ExamConditionsCard() {
  return (
    <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl p-5">
      <h2 className="font-bold text-slate-900 dark:text-white">The real test</h2>
      <p className="mt-1.5 text-sm text-slate-500 dark:text-slate-400 leading-relaxed">
        {MOCK_LENGTH} multiple-choice questions in {MOCK_MINUTES} minutes. You need{" "}
        {PASS_QUESTIONS} right — one mark for the whole paper, not a mark per topic.
        You can be weak on one subject and still pass comfortably.
      </p>
      <div className="mt-4 space-y-1.5 text-sm">
        <div className="flex items-baseline justify-between gap-3">
          <span className="text-slate-600 dark:text-slate-300">Questions</span>
          <span className="font-bold text-slate-900 dark:text-white tabular-nums">{MOCK_LENGTH}</span>
        </div>
        <div className="flex items-baseline justify-between gap-3">
          <span className="text-slate-600 dark:text-slate-300">Time</span>
          <span className="font-bold text-slate-900 dark:text-white tabular-nums">{MOCK_MINUTES} minutes</span>
        </div>
        <div className="flex items-baseline justify-between gap-3">
          <span className="text-slate-600 dark:text-slate-300">To pass</span>
          <span className="font-bold text-slate-900 dark:text-white tabular-nums">
            {PASS_QUESTIONS} of {MOCK_LENGTH}
            <span className="ml-1.5 font-semibold text-slate-400">{PASS_MARK}%</span>
          </span>
        </div>
        <div className="flex items-baseline justify-between gap-3">
          <span className="text-slate-600 dark:text-slate-300">Marks you can drop</span>
          <span className="font-bold text-slate-900 dark:text-white tabular-nums">{MOCK_LENGTH - PASS_QUESTIONS}</span>
        </div>
      </div>
    </div>
  );
}

/* Whether a paper has a saved half-finished attempt. Reads the same key
   QuizPlayer writes — kept to one line here rather than importing the player,
   which would pull the whole quiz engine into the home bundle. */
function hasPausedAttempt(moduleId) {
  try {
    return Boolean(localStorage.getItem(`pdt-paused-${moduleId}`));
  } catch {
    return false;
  }
}

/* ===========================================================================
   PROGRESS
   =========================================================================== */
export function ProgressScreen({ go }) {
  const { getSection, getModule, overall } = useProgress();

  /* Combined flashcard progress across every deck. Counted from the real
     decks, so it cannot drift from what the deck screens show. */
  const cardStats = DECKS.reduce((acc, d) => {
    const content = getDeck(d.id);
    const size = content ? content.cards.length : (d.count || 0);
    const known = Math.min(getModule(d.id).completedIds.length, size);
    return { total: acc.total + size, known: acc.known + known };
  }, { total: 0, known: 0 });
  const cardPct = cardStats.total
    ? Math.round((cardStats.known / cardStats.total) * 100)
    : 0;

  return (
    <>
      <ScreenHeader title="My Progress" subtitle="Across all six topics" />
      <Screen>
        <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl p-5 flex items-center gap-5">
          <ProgressRing pct={overall.coveragePct} size={84} stroke={7} label="covered" />
          <div className="flex-1 grid grid-cols-2 gap-3">
            <Stat label="Answered" value={`${overall.answered} / ${overall.total}`} />
            <Stat
              label="Correct"
              value={overall.gradedAnswers ? `${overall.accuracyPct}%` : "—"}
              tone={overall.gradedAnswers
                ? (overall.accuracyPct >= PASS_MARK ? "good" : "warn")
                : undefined}
            />
            <Stat label="Tests taken" value={overall.testsTaken} />
            <Stat label="Best score" value={overall.bestPct ? `${overall.bestPct}%` : "—"} />
          </div>
        </div>

        {overall.answered === 0 ? (
          <EmptyState
            icon={TrendingUp}
            title="Nothing tracked yet"
            message="Answer some questions in any section and your progress will build here."
          />
        ) : (
          <>
            <p className="mt-6 mb-2.5 text-xs font-bold uppercase tracking-widest text-slate-400">
              By section
            </p>
            <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl divide-y divide-slate-100 dark:divide-slate-700">
              {ADI_SECTIONS.map(s => {
                const p = getSection(s.id);
                return (
                  <button
                    key={s.id}
                    onClick={() => go({ screen: "section", sectionId: s.id })}
                    className="w-full text-left px-4 py-3.5"
                  >
                    <div className="flex items-baseline justify-between gap-3">
                      <p className="text-sm font-semibold text-slate-900 dark:text-white truncate">
                        {s.number}. {s.short}
                      </p>
                      <span className="text-xs font-bold text-slate-400 shrink-0">
                        {p.answered}/{p.total}
                      </span>
                    </div>
                    <div className="mt-1.5">
                      <ProgressBar
                        pct={p.coveragePct}
                        tone={p.passed ? "emerald" : p.started ? "amber" : "slate"}
                      />
                    </div>
                    <p className="mt-1.5 text-xs text-slate-500 dark:text-slate-400">
                      {p.attempts > 0
                        ? `${p.accuracyPct}% correct (${p.correctCount}/${p.gradedCount}) · best ${p.bestPct}% · ${p.attempts} attempt${p.attempts === 1 ? "" : "s"}`
                        : "Not attempted yet"}
                    </p>
                  </button>
                );
              })}
            </div>

            {MOCKS.some(m => getModule(m.id).attempts > 0) && (
              <>
                <p className="mt-6 mb-2.5 text-xs font-bold uppercase tracking-widest text-slate-400">
                  Mock tests
                </p>
                <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl divide-y divide-slate-100 dark:divide-slate-700">
                  {MOCKS.map(paper => {
                    const m = getModule(paper.id);
                    return (
                      <div key={paper.id} className="px-4 py-3.5">
                        <div className="flex items-baseline justify-between gap-3">
                          <span className="text-sm font-semibold text-slate-900 dark:text-white">
                            {paper.label}
                          </span>
                          <span className="text-lg font-black text-slate-900 dark:text-white">
                            {m.attempts > 0 ? `${m.bestPct}%` : "—"}
                          </span>
                        </div>
                        <div className="mt-1.5">
                          <ProgressBar
                            pct={m.bestPct}
                            tone={m.attempts === 0 ? "slate" : m.passed ? "emerald" : "amber"}
                          />
                        </div>
                        <p className={`mt-1.5 text-xs font-semibold ${
                          m.attempts === 0
                            ? "text-slate-400"
                            : m.passed
                              ? "text-emerald-600 dark:text-emerald-400"
                              : "text-amber-600 dark:text-amber-400"
                        }`}>
                          {m.attempts === 0
                            ? "Not attempted yet"
                            : m.passed
                              ? "Passed every section"
                              : "Not every section passed"}
                          {m.attempts > 0 && (
                            <span className="font-normal text-slate-400">
                              {" "}· {m.attempts} attempt{m.attempts === 1 ? "" : "s"}
                            </span>
                          )}
                        </p>
                      </div>
                    );
                  })}
                </div>
              </>
            )}
          </>
        )}
      </Screen>
    </>
  );
}

function Stat({ label, value, tone }) {
  const colour = tone === "good" ? "text-emerald-600 dark:text-emerald-400"
    : tone === "warn" ? "text-amber-600 dark:text-amber-400"
    : "text-slate-900 dark:text-white";
  return (
    <div>
      <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">{label}</p>
      <p className={`mt-0.5 text-lg font-black ${colour}`}>{value}</p>
    </div>
  );
}

/* ===========================================================================
   INSTALL CARD
   =========================================================================== */
function InstallCard() {
  const { state, promptInstall } = usePwaInstall();

  if (state === "installed") {
    return (
      <div className="mt-4 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl p-4 flex items-center gap-3">
        <Check size={18} className="text-emerald-500 shrink-0" />
        <div>
          <p className="font-semibold text-slate-900 dark:text-white text-sm">
            Installed on your home screen
          </p>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            You're running the app version.
          </p>
        </div>
      </div>
    );
  }

  if (state === "prompt") {
    return (
      <div className="mt-4 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl p-5">
        <div className="flex items-center gap-3">
          <Smartphone size={18} className="text-emerald-500 shrink-0" />
          <h2 className="font-bold text-slate-900 dark:text-white">Install the app</h2>
        </div>
        <p className="mt-2 text-sm text-slate-500 dark:text-slate-400 leading-relaxed">
          Add PassDrivingTest to your home screen for full-screen study with no
          browser bar.
        </p>
        <div className="mt-4">
          <PrimaryButton onClick={promptInstall}>
            <span className="inline-flex items-center gap-2">
              <Download size={16} /> Add to Home Screen
            </span>
          </PrimaryButton>
        </div>
      </div>
    );
  }

  if (state === "ios") {
    return (
      <div className="mt-4 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl p-5">
        <div className="flex items-center gap-3">
          <Smartphone size={18} className="text-emerald-500 shrink-0" />
          <h2 className="font-bold text-slate-900 dark:text-white">Add to your Home Screen</h2>
        </div>
        <ol className="mt-4 space-y-3">
          <InstallStep n="1">
            Tap the <Share2 size={14} className="inline mx-0.5 -mt-0.5 text-blue-500" />
            <span className="font-semibold"> Share</span> button at the bottom of Safari.
          </InstallStep>
          <InstallStep n="2">
            Scroll down and tap <span className="font-semibold">Add to Home Screen</span>.
          </InstallStep>
          <InstallStep n="3">
            Tap <span className="font-semibold">Add</span> in the top right.
          </InstallStep>
        </ol>
        <p className="mt-4 pt-4 border-t border-slate-100 dark:border-slate-700 text-xs text-slate-400 leading-relaxed">
          This only works in Safari. If you're in another browser on iPhone,
          open passdrivingtest.ie/app in Safari first.
        </p>
      </div>
    );
  }

  return (
    <div className="mt-4 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl p-4 flex items-start gap-3">
      <Smartphone size={18} className="text-slate-400 shrink-0 mt-0.5" />
      <div>
        <p className="font-semibold text-slate-900 dark:text-white text-sm">Study on your phone</p>
        <p className="mt-0.5 text-sm text-slate-500 dark:text-slate-400 leading-relaxed">
          Open passdrivingtest.ie/app on your phone to add it to your home screen.
        </p>
      </div>
    </div>
  );
}

function InstallStep({ n, children }) {
  return (
    <li className="flex items-start gap-3">
      <span className="w-6 h-6 rounded-lg bg-slate-100 dark:bg-slate-700 flex items-center justify-center text-xs font-black text-slate-500 dark:text-slate-300 shrink-0">
        {n}
      </span>
      <span className="text-sm text-slate-600 dark:text-slate-300 leading-snug pt-0.5">
        {children}
      </span>
    </li>
  );
}

/* ===========================================================================
   PROFILE
   =========================================================================== */
export function ProfileScreen({ theme, toggleTheme }) {
  const { profile, displayName, subscription, signOut, mode, isGuest, exitGuest } = useAuth();
  const { resetAll, overall } = useProgress();
  const { sizeId, setSizeId, sizes } = useTextSize();

  /* Reset is two taps, not one.

     window.confirm was doing this before, and it works, but it's a grey system
     dialog with an OK button that looks identical to every other prompt — easy
     to dismiss on autopilot. This asks in the app, states exactly what
     disappears, and makes the confirming button the red one. The cancel is
     the wider, calmer target. */
  const [confirmingReset, setConfirmingReset] = useState(false);
  const [resetDone, setResetDone] = useState(false);

  async function doReset() {
    await resetAll();
    setConfirmingReset(false);
    setResetDone(true);
    setTimeout(() => setResetDone(false), 4000);
  }

  return (
    <>
      <ScreenHeader title="Settings" />
      <Screen>
        <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl p-5 flex items-center gap-4">
          <div className="w-14 h-14 rounded-full bg-slate-200 dark:bg-slate-700 flex items-center justify-center shrink-0">
            <User size={24} className="text-slate-500 dark:text-slate-300" />
          </div>
          <div className="min-w-0">
            <p className="font-bold text-slate-900 dark:text-white truncate">
              {isGuest ? "Studying as a guest" : displayName}
            </p>
            <p className="text-sm text-slate-500 dark:text-slate-400 truncate">
              {isGuest ? "No account yet" : profile?.email}
            </p>
          </div>
        </div>

        {isGuest ? (
          <div className="mt-4 bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-900 rounded-2xl p-5">
            <h2 className="font-bold text-slate-900 dark:text-white">Keep your progress safe</h2>
            <p className="mt-1.5 text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
              Your scores live on this device only. Create an account and
              everything you've already done comes with you.
            </p>
            <div className="mt-4">
              <PrimaryButton onClick={exitGuest}>Create an account</PrimaryButton>
            </div>
          </div>
        ) : (
          <div className="mt-4 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl p-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <Shield size={18} className="text-emerald-500" />
                <span className="font-semibold text-slate-900 dark:text-white">Subscription</span>
              </div>
              <span className="text-xs font-bold uppercase tracking-wider px-2.5 py-1 rounded-full bg-emerald-100 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-400">
                {subscription.label}
              </span>
            </div>
            {subscription.note && (
              <p className="mt-2.5 text-sm text-slate-500 dark:text-slate-400">
                {subscription.note}
              </p>
            )}
          </div>
        )}

        <InstallCard />

        {/* ---- Appearance ---- */}
        <SettingsGroup title="Appearance">
          <Toggle
            label="Dark mode"
            description={theme === "dark" ? "Easier at night" : "Currently light"}
            icon={theme === "dark" ? Moon : Sun}
            checked={theme === "dark"}
            onChange={toggleTheme}
          />

          {/* ---- Reading size ----

              Four steps rather than a slider. A slider on a phone is fiddly,
              gives no sense of what you're choosing until you let go, and
              invites a value nobody wants. Four labelled buttons showing the
              actual size are quicker and honest about the range. */}
          <div className="px-4 py-4">
            <div className="flex items-center gap-3">
              <Type size={18} className="text-slate-400 shrink-0" />
              <div className="min-w-0 flex-1">
                <p className="font-semibold text-slate-900 dark:text-white">Reading size</p>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                  Questions, answers and flashcards
                </p>
              </div>
            </div>

            <div className="mt-3.5 grid grid-cols-4 gap-2">
              {sizes.map(s => {
                const active = s.id === sizeId;
                return (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => setSizeId(s.id)}
                    aria-pressed={active}
                    className={`rounded-xl py-2.5 px-1 border transition flex flex-col items-center justify-center gap-0.5 ${
                      active
                        ? "border-emerald-500 bg-emerald-50 dark:bg-emerald-950/40"
                        : "border-slate-200 dark:border-slate-700 hover:border-slate-300 dark:hover:border-slate-600"
                    }`}
                  >
                    {/* Each button is set at the size it selects, so you can
                        see the choice rather than read a label for it. */}
                    <span
                      className={`font-bold leading-none ${
                        active
                          ? "text-emerald-700 dark:text-emerald-400"
                          : "text-slate-700 dark:text-slate-200"
                      }`}
                      style={{ fontSize: `${s.scale * 1.05}rem` }}
                    >
                      {s.sample}
                    </span>
                    <span className={`text-[10px] font-bold uppercase tracking-wider ${
                      active ? "text-emerald-600 dark:text-emerald-400" : "text-slate-400"
                    }`}>
                      {s.label}
                    </span>
                  </button>
                );
              })}
            </div>

            {/* Live preview, in the same classes the quiz uses — so what you
                see here is exactly what a question will look like, rather than
                an approximation you have to go and verify. */}
            <div className="mt-3.5 rounded-xl bg-slate-50 dark:bg-slate-900/60 border border-slate-200 dark:border-slate-700 p-3.5">
              <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-1.5">
                Preview
              </p>
              <p className="rd-lead font-bold text-slate-900 dark:text-white">
                What is the maximum speed limit on a motorway?
              </p>
              <p className="rd-option mt-2 text-slate-600 dark:text-slate-300">
                120 km/h
              </p>
            </div>
          </div>
        </SettingsGroup>

        {/* ---- Progress ---- */}
        <SettingsGroup title="Progress">
          <div className="px-4 py-4">
            <div className="flex items-center gap-3">
              <Trash2 size={18} className="text-red-500 shrink-0" />
              <div className="min-w-0 flex-1">
                <p className="font-semibold text-slate-900 dark:text-white">Reset my progress</p>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                  {overall.answered > 0
                    ? `${overall.answered} answered questions, ${overall.testsTaken} test${overall.testsTaken === 1 ? "" : "s"} taken`
                    : "Nothing recorded yet"}
                </p>
              </div>
            </div>

            {resetDone ? (
              <div className="mt-3.5 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-900 px-3.5 py-3 flex items-center gap-2.5">
                <Check size={16} className="text-emerald-600 dark:text-emerald-400 shrink-0" />
                <p className="text-sm font-semibold text-emerald-700 dark:text-emerald-400">
                  Progress cleared.
                </p>
              </div>
            ) : confirmingReset ? (
              <div className="mt-3.5 rounded-xl bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900 p-3.5">
                <div className="flex gap-2.5">
                  <AlertTriangle size={17} className="text-red-500 shrink-0 mt-0.5" />
                  <div>
                    <p className="font-bold text-slate-900 dark:text-white text-sm">
                      Delete everything?
                    </p>
                    {/* Named specifically. "Your progress" is vague enough
                        that people tap it without picturing the loss. */}
                    <p className="mt-1 text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
                      Every topic score, every mock result, and all
                      {" "}{overall.answered} answered questions go. Your flashcard
                      marks go too. This cannot be undone.
                    </p>
                  </div>
                </div>
                <div className="mt-3.5 flex gap-2.5">
                  {/* py-3 rather than py-2.5: at 2.5 these came out 39px tall,
                      just under the 44px that's reliably tappable — and this is
                      the worst place in the app to mis-tap. */}
                  <button
                    onClick={() => setConfirmingReset(false)}
                    className="flex-1 border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 font-bold py-3 rounded-xl"
                  >
                    Keep it
                  </button>
                  <button
                    onClick={doReset}
                    className="flex-1 bg-red-500 hover:bg-red-600 text-white font-bold py-3 rounded-xl transition"
                  >
                    Yes, reset
                  </button>
                </div>
              </div>
            ) : (
              <div className="mt-3.5">
                <DangerButton onClick={() => setConfirmingReset(true)}>
                  <span className="inline-flex items-center gap-2">
                    <Trash2 size={16} /> Reset progress
                  </span>
                </DangerButton>
              </div>
            )}
          </div>
        </SettingsGroup>

        {!isGuest && (
          <div className="mt-4">
            <SecondaryButton onClick={signOut}>
              <span className="inline-flex items-center gap-2 text-red-600 dark:text-red-400">
                <LogOut size={16} /> Log out
              </span>
            </SecondaryButton>
          </div>
        )}

        <p className="mt-6 text-center text-xs text-slate-400">
          {overall.answered} of {overall.total} questions answered
          {mode === "local" && " · saved on this device only"}
        </p>
      </Screen>
    </>
  );
}
