/*
  ===========================================================================
  QUIZ PLAYER

  Runs both a topic practice and the 40-question mock.

  What's here beyond a plain quiz:

    · Previous and Next. You can go back over questions you've already
      answered and change your mind before finishing.
    · Pause. Stops the clock and saves the whole attempt — which questions,
      what you picked, where you were, how long you'd spent. Coming back
      puts you on the same question with the same answers in place.
    · The paused attempt is stored by question id, not by copying the
      questions, so it stays small and survives the bank being edited.
      Anything that has since disappeared from the bank is dropped on
      resume rather than crashing.
  ===========================================================================
*/

import React, { useState, useEffect, useRef, useCallback, useMemo } from "react";
import {
  ChevronLeft, ChevronRight, Check, X, Clock, RotateCcw, Flag,
  Pause, Play, Star, ChevronDown, ChevronUp, AlertTriangle, Layers,
} from "lucide-react";
import {
  ScreenHeader, Screen, ProgressBar, ProgressRing,
  PrimaryButton, SecondaryButton,
} from "./ui";
import { useProgress } from "./progressStore";
import {
  verdictFor, PASS_MARK, PASS_QUESTIONS, passMarkFor, gradeMock, mockVerdict,
  ADI_SECTIONS, MOCK_MINUTES,
} from "./appStructure";
import { QUESTION_BY_QID } from "./theorySections";

/* ---------------------------------------------------------------------------
   Paused attempts

   The raw { qids, answers, index, elapsed, savedAt } lives in the progress
   store now (see progressStore.jsx savePausedAttempt/clearPausedAttempt) so
   it syncs to the account like everything else there. This just rebuilds
   the actual question objects from ids — a question removed from the bank
   since pausing is dropped, along with the answer that went with it.
   --------------------------------------------------------------------------- */
function rebuildPaused(raw) {
  if (!raw?.qids?.length) return null;

  const questions = [];
  const answers = [];
  raw.qids.forEach((qid, i) => {
    const q = QUESTION_BY_QID[qid];
    if (!q) return;
    questions.push(q);
    answers.push(raw.answers?.[i] ?? null);
  });
  if (!questions.length) return null;

  /* Resume at the first unanswered question, not wherever the student
     happened to be looking when they left. Without this, going back to
     review an earlier question right before exiting would save that lower
     index and "resume" somewhere behind their actual progress — reviewing
     must not regress the saved position. All answered (finished the last
     question but never tapped Finish) lands on the last question instead
     of an out-of-range index. */
  let resumeIndex = answers.findIndex(a => a === null || a === undefined);
  if (resumeIndex === -1) resumeIndex = questions.length - 1;

  return {
    questions,
    answers,
    index: resumeIndex,
    elapsed: raw.elapsed || 0,
    savedAt: raw.savedAt,
  };
}

/* ---------------------------------------------------------------------------
   Helpers
   --------------------------------------------------------------------------- */
function shuffle(arr) {
  const out = [...arr];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

function formatClock(seconds) {
  const safe = Math.max(0, Math.floor(seconds));
  const m = Math.floor(safe / 60);
  const s = safe % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

/* "1 hour 30 minutes" rather than "90:00" — for prose, not the clock. */
function formatDuration(minutes) {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (!h) return `${m} minutes`;
  if (!m) return `${h} hour${h === 1 ? "" : "s"}`;
  return `${h} hour${h === 1 ? "" : "s"} ${m} minutes`;
}

function timeAgo(iso) {
  if (!iso) return "";
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs} hour${hrs === 1 ? "" : "s"} ago`;
  const days = Math.round(hrs / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

/* ===========================================================================
   ENTRY
   =========================================================================== */
export default function QuizPlayer({ module, quiz, onExit }) {
  const isMock = module.kind === "mock";

  /* Practice shows a standard to aim at. A mock is marked in whole questions
     (35 of 40) rather than a percentage, so `passMark` stays null here and
     gradeMock does the deciding. */
  const passMark = isMock ? null : (module.passMark || passMarkFor(module.id) || PASS_MARK);

  /* Timed only for mocks. Section practice is study, not assessment, and a
     clock on it would discourage the slow careful reading it wants. */
  const limitSeconds = isMock ? (module.minutes || MOCK_MINUTES) * 60 : null;

  const [stage, setStage] = useState("intro");
  const [session, setSession] = useState(null);
  const [result, setResult] = useState(null);

  const {
    recordResult, recordAnswered, getSection, getModule,
    getPaused, savePausedAttempt, clearPausedAttempt,
  } = useProgress();
  const [paused, setPaused] = useState(() => rebuildPaused(getPaused(module.id)));
  const progress = isMock ? getModule(module.id) : getSection(module.id);

  /* getPaused's identity changes whenever the store's entries change —
     including once a sign-in's cloud merge finishes, which can land well
     after this component's first render. Re-checking keeps a paused
     attempt from another device from being missed just because it arrived
     a moment too late for the initial state. Only while still on the intro
     screen, so it can't clobber a session already running. */
  useEffect(() => {
    if (stage !== "intro") return;
    setPaused(rebuildPaused(getPaused(module.id)));
  }, [getPaused, module.id, stage]);

  const allQuestions = quiz.categories.flatMap(c => c.questions);

  const startFresh = () => {
    const questions = isMock ? allQuestions : shuffle(allQuestions);
    setSession({
      questions,
      answers: new Array(questions.length).fill(null),
      index: 0,
      elapsed: 0,
    });
    clearPausedAttempt(module.id);
    setPaused(null);
    setStage("running");
  };

  const resume = () => {
    /* An attempt paused before the mock was timed carries an unbounded
       count-up figure — anything over the time limit would auto-submit the
       instant it resumed, ending a paper the candidate never sat. Those
       start the clock again rather than being destroyed. */
    const stale = limitSeconds && paused.elapsed >= limitSeconds;
    setSession(stale ? { ...paused, elapsed: 0 } : paused);
    setStage("running");
  };

  /* Credits answered questions to their section's coverage — "X of 34
     covered" on Home and on the section screen. Shared by finish() and by
     persist() below: without also crediting on pause/autosave, coverage
     only ever updated once the whole attempt finished, so a paused attempt
     with 5 of 34 answered still showed "0/34" everywhere else in the app
     until it was completed. Idempotent (recordAnswered unions ids into a
     Set), so credit already given by an earlier pause is a no-op here. */
  const creditAnswered = useCallback((questions, answers) => {
    const bySection = {};
    questions.forEach((q, i) => {
      const raw = answers[i];
      if (raw === null || raw === undefined || !q.qid || !q.sectionId) return;
      (bySection[q.sectionId] = bySection[q.sectionId] || []).push(q.qid);
    });
    for (const [sectionId, qids] of Object.entries(bySection)) {
      recordAnswered(sectionId, qids);
    }
  }, [recordAnswered]);

  /* Shared by the explicit Pause button and the silent autosave below —
     both just persist the same shape. Returns the raw shape rather than
     relying on the store's `entries` to have updated yet: setEntries is
     async, so reading getPaused() back immediately after calling this would
     still see last render's value. */
  const persist = useCallback((state) => {
    const raw = {
      qids: state.questions.map(q => q.qid),
      answers: state.answers,
      index: state.index,
      elapsed: state.elapsed,
    };
    savePausedAttempt(module.id, raw);
    // Coverage ("X of 34 covered" on Home and the section screen) should
    // reflect an in-progress attempt too, not just a finished one.
    creditAnswered(state.questions, state.answers);
    return raw;
  }, [module.id, savePausedAttempt, creditAnswered]);

  const handlePause = (state) => {
    setPaused(rebuildPaused(persist(state)));
    setStage("intro");
    setSession(null);
  };

  /* Runs on every answer and every navigation while the quiz is on screen —
     not just when Pause is explicitly tapped. Without this, answering
     questions 1-15 and then just closing the tab or hitting the top "Exit"
     button (which never calls handlePause) lost everything, because the
     attempt only ever lived in this component's React state. */
  const handleAutosave = useCallback((state) => {
    persist(state);
  }, [persist]);

  const finish = async ({ questions, answers, elapsed, timedOut }) => {
    const log = [];

    questions.forEach((q, i) => {
      const raw = answers[i];
      const skipped = raw === null || raw === undefined;

      /* Topic practice is marked on what you attempted — leaving five
         questions and scoring 20/20 is a real 100% on those twenty.

         A mock is marked on the whole paper. Blank is wrong in the real test,
         and a mock that quietly drops unanswered questions would flatter a
         learner who ran out of time — exactly the learner who most needs to
         know. */
      if (skipped && !isMock) return;

      log.push({
        qid: q.qid,
        sectionId: q.sectionId,
        q: q.q,
        image: q.image,
        options: q.options,
        correct: q.correct,
        picked: skipped ? null : raw,
        explain: q.explain,
        sectionLabel: q.sectionLabel,
        skipped,
        isRight: !skipped && raw === q.correct,
      });
    });

    // Skipped ones were never seen, so they don't count toward coverage —
    // creditAnswered already excludes them by checking the raw answer.
    creditAnswered(questions, answers);

    if (isMock) {
      /* One verdict: 35 of 40. The rows gradeMock returns are a breakdown of
         where the marks went, not five separate pass/fail judgements. */
      const grade = gradeMock(log, { totalQuestions: questions.length });
      const verdict = mockVerdict(grade);

      const saved = await recordResult(module.id, grade.score, grade.total, {
        passMark: PASS_MARK,
        passed: grade.passed,
        /* Kept so the Mock Test screen can say which topics keep costing
           marks. Short keys — this rides along in the same stored row. */
        sections: grade.rows.map(r => ({ id: r.id, c: r.correct, t: r.total })),
      });

      clearPausedAttempt(module.id);
      setPaused(null);
      setResult({
        ...saved,
        score: grade.score,
        total: grade.total,
        pct: grade.pct,
        verdict,
        grade,
        log,
        elapsed,
        timedOut,
      });
      setStage("result");
      return;
    }

    const score = log.filter(item => item.isRight).length;
    const total = log.length || 1;
    const saved = await recordResult(module.id, score, total, { passMark });

    clearPausedAttempt(module.id);
    setPaused(null);
    setResult({ score, total, log, elapsed, passMark, ...saved });
    setStage("result");
  };

  /* ---- intro ---- */
  if (stage === "intro") {
    const answeredCount = paused
      ? paused.answers.filter(a => a !== null && a !== undefined).length
      : 0;

    return (
      <>
        <ScreenHeader
          title={quiz.title}
          subtitle={quiz.subtitle}
          onBack={onExit}
          backLabel="Home"
        />
        <Screen>
          {/* Where you're up to */}
          {!isMock && progress.total > 0 && (
            <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl p-4">
              <div className="flex justify-between text-[11px] font-bold uppercase tracking-widest text-slate-400 mb-1.5">
                <span>Section covered</span>
                <span>{progress.answered} / {progress.total}</span>
              </div>
              <ProgressBar
                pct={progress.coveragePct}
                tone={progress.passed ? "emerald" : progress.started ? "amber" : "slate"}
              />
              {progress.attempts > 0 && (
                <p className={`mt-2 text-sm font-semibold ${
                  progress.passed
                    ? "text-emerald-600 dark:text-emerald-400"
                    : "text-amber-600 dark:text-amber-400"
                }`}>
                  Best {progress.bestPct}%
                  {progress.passed ? " — at pass standard" : ` — ${passMark}% needed`}
                </p>
              )}
            </div>
          )}

          {isMock && progress.attempts > 0 && (
            <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl p-4">
              <div className="flex items-baseline justify-between">
                <span className="text-sm font-semibold text-slate-900 dark:text-white">
                  Best score
                </span>
                <span className="text-xl font-black text-slate-900 dark:text-white">
                  {progress.bestPct}%
                </span>
              </div>
              <div className="mt-2">
                <ProgressBar pct={progress.bestPct} tone={progress.passed ? "emerald" : "amber"} />
              </div>
            </div>
          )}

          {/* Resume a paused attempt */}
          {paused && (
            <div className="mt-4 bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-900 rounded-2xl p-5">
              <div className="flex items-center gap-2.5">
                <Play size={18} className="text-emerald-600 dark:text-emerald-400" />
                <h2 className="font-bold text-slate-900 dark:text-white">Paused attempt</h2>
              </div>
              <p className="mt-2 text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
                You stopped at question {paused.index + 1} of {paused.questions.length},
                with {answeredCount} answered. Saved {timeAgo(paused.savedAt)}.
              </p>
              <div className="mt-4 space-y-2.5">
                <PrimaryButton onClick={resume}>
                  <span className="inline-flex items-center gap-2">
                    <Play size={16} /> Continue where you left off
                  </span>
                </PrimaryButton>
                <button
                  onClick={() => { clearPausedAttempt(module.id); setPaused(null); }}
                  className="w-full text-sm font-semibold text-slate-500 dark:text-slate-400 py-2"
                >
                  Discard and start again
                </button>
              </div>
            </div>
          )}

          {/* What this is */}
          {!paused && (
            <>
              <div className="mt-4 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl p-5">
                <h2 className="font-bold text-slate-900 dark:text-white">
                  {isMock ? "Test conditions" : "About this topic"}
                </h2>
                <ul className="mt-3 space-y-2.5 text-sm text-slate-600 dark:text-slate-300">
                  <li className="flex gap-2.5">
                    <Check size={16} className="text-emerald-500 mt-0.5 shrink-0" />
                    {allQuestions.length} questions
                    {isMock ? ", mixed across all six topics, as in the real test." : " in this topic."}
                  </li>

                  {isMock && (
                    <li className="flex gap-2.5">
                      <Clock size={16} className="text-emerald-500 mt-0.5 shrink-0" />
                      {formatDuration(module.minutes || MOCK_MINUTES)} on the clock. It counts
                      down and submits itself when it reaches zero.
                    </li>
                  )}

                  <li className="flex gap-2.5">
                    <Star size={16} className="text-emerald-500 mt-0.5 shrink-0" />
                    {isMock
                      ? `${PASS_QUESTIONS} of ${allQuestions.length} to pass — one mark for the whole paper.`
                      : `Test standard ${passMark}%.`}
                  </li>

                  <li className="flex gap-2.5">
                    <Pause size={16} className="text-emerald-500 mt-0.5 shrink-0" />
                    {isMock
                      ? "Pausing stops the clock and keeps the time you have left — the real test won't, so use it sparingly."
                      : "You can pause at any point and pick up where you left off."}
                  </li>

                  <li className="flex gap-2.5">
                    {isMock
                      ? <Flag size={16} className="text-emerald-500 mt-0.5 shrink-0" />
                      : <ChevronLeft size={16} className="text-emerald-500 mt-0.5 shrink-0" />}
                    {isMock
                      ? "Answers come at the end, as in the real test. Anything left blank is marked wrong."
                      : "The answer is shown as you go, and you can move back and forward."}
                  </li>
                </ul>
              </div>

              {/* What the paper is, before they start. The sister ADI app
                  lists five section pass marks here; this test has one mark,
                  so the useful facts are different — how many marks there are
                  to spare, and that no single topic can sink the paper. */}
              {isMock && (
                <div className="mt-4 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl p-5">
                  <h2 className="font-bold text-slate-900 dark:text-white">How it's marked</h2>
                  <p className="mt-1.5 text-sm text-slate-500 dark:text-slate-400 leading-relaxed">
                    One score for the whole paper. No topic is marked separately, so a
                    weak subject only matters if it costs you more than the marks you
                    have to spare.
                  </p>
                  <div className="mt-4 space-y-2 text-sm">
                    <div className="flex items-baseline justify-between gap-3">
                      <span className="text-slate-700 dark:text-slate-200">To pass</span>
                      <span className="font-bold text-slate-900 dark:text-white tabular-nums">
                        {PASS_QUESTIONS} of {allQuestions.length}
                      </span>
                    </div>
                    <div className="flex items-baseline justify-between gap-3">
                      <span className="text-slate-700 dark:text-slate-200">Marks to spare</span>
                      <span className="font-bold text-slate-900 dark:text-white tabular-nums">
                        {Math.max(0, allQuestions.length - PASS_QUESTIONS)}
                      </span>
                    </div>
                    <div className="flex items-baseline justify-between gap-3">
                      <span className="text-slate-700 dark:text-slate-200">Time per question</span>
                      <span className="font-bold text-slate-900 dark:text-white tabular-nums">
                        ~{Math.round(((module.minutes || MOCK_MINUTES) * 60) / allQuestions.length)}s
                      </span>
                    </div>
                  </div>
                </div>
              )}

              <div className="mt-4">
                <PrimaryButton onClick={startFresh}>
                  {progress.attempts > 0 ? "Start again" : "Start"}
                </PrimaryButton>
              </div>
            </>
          )}
        </Screen>
      </>
    );
  }

  /* ---- running ---- */
  if (stage === "running" && session) {
    return (
      <QuizRun
        session={session}
        module={module}
        instantFeedback={!isMock}
        limitSeconds={limitSeconds}
        onFinish={finish}
        onPause={handlePause}
        onAutosave={handleAutosave}
        onQuit={() => { setStage("intro"); setSession(null); }}
      />
    );
  }

  /* ---- result ---- */
  if (stage === "result" && result) {
    return (
      <QuizResult
        module={module}
        result={result}
        onRetry={startFresh}
        onExit={onExit}
      />
    );
  }

  return null;
}

/* ===========================================================================
   RUNNING
   =========================================================================== */
function QuizRun({ session, module, instantFeedback, limitSeconds, onFinish, onPause, onAutosave, onQuit }) {
  const { questions } = session;
  const total = questions.length;
  const timed = Number.isFinite(limitSeconds) && limitSeconds > 0;

  const [answers, setAnswers] = useState(session.answers);
  const [index, setIndex] = useState(session.index);
  const [elapsed, setElapsed] = useState(session.elapsed);
  const [revealed, setRevealed] = useState(
    instantFeedback && session.answers[session.index] !== null
  );
  // Bumped on every celebration so <CorrectBurst key={celebrateKey}> remounts
  // and replays even if the previous burst hadn't finished fading yet.
  const [celebrating, setCelebrating] = useState(false);
  const [celebrateKey, setCelebrateKey] = useState(0);

  const startedAt = useRef(Date.now() - session.elapsed * 1000);
  const finished = useRef(false);

  const remaining = timed ? Math.max(0, limitSeconds - elapsed) : null;

  /* Three states worth colouring differently. Ten minutes is enough to still
     act on — change strategy, stop re-reading, answer the blanks. Two minutes
     is not, so it goes red and starts pulsing. */
  const warning = timed && remaining <= 600 && remaining > 120;
  const critical = timed && remaining <= 120;

  const handleFinish = useCallback((opts = {}) => {
    if (finished.current) return;
    finished.current = true;
    /* The timer passes its own reading: `elapsed` in this closure is one tick
       behind at the moment of auto-submit, which would report a 90-minute
       paper as having taken 89:59. */
    onFinish({
      questions,
      answers,
      elapsed: Number.isFinite(opts.elapsed) ? opts.elapsed : elapsed,
      timedOut: opts.timedOut === true,
    });
  }, [questions, answers, elapsed, onFinish]);

  /* Keep the latest handler where the interval can reach it, so the timer
     doesn't have to be torn down and rebuilt on every answer — which would
     lose a fraction of a second each time and let a 90-minute paper drift. */
  const finishRef = useRef(handleFinish);
  useEffect(() => { finishRef.current = handleFinish; }, [handleFinish]);

  /* The clock runs while the quiz is on screen. Pausing unmounts this
     component, which stops it — that's the point of the pause.

     Time is read from the wall clock rather than counted in ticks, so a phone
     that sleeps or a tab left in the background comes back with the right
     time remaining rather than a clock that quietly stopped. */
  useEffect(() => {
    const tick = () => {
      const secs = Math.floor((Date.now() - startedAt.current) / 1000);
      setElapsed(secs);
      if (timed && secs >= limitSeconds) {
        finishRef.current({ timedOut: true, elapsed: limitSeconds });
      }
    };
    tick();
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  }, [timed, limitSeconds]);

  /* Silently persists on every answer and every navigation — not just when
     Pause is tapped. This is what makes a refresh, a killed tab, or just
     tapping "Exit" resumable: by the time any of those happen, the last
     interaction already wrote the attempt to the progress store (local
     immediately, the account when signed in). Skips the first render so
     resuming an attempt doesn't immediately rewrite itself with nothing
     changed. */
  const firstRun = useRef(true);
  useEffect(() => {
    if (firstRun.current) { firstRun.current = false; return; }
    onAutosave({ questions, answers, index, elapsed });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [answers, index]);

  const q = questions[index];
  const picked = answers[index];
  const isLast = index === total - 1;
  const answeredCount = answers.filter(a => a !== null && a !== undefined).length;
  const unansweredCount = total - answeredCount;

  /* Where this question sits in its section — "3 of 20 in Teaching Ability".
     Works off the paper itself rather than assuming 20 each, so it stays right
     if the weighting is ever changed or a section runs short. */
  const position = React.useMemo(() => {
    if (!q?.sectionId) return null;
    const section = ADI_SECTIONS.find(s => s.id === q.sectionId);
    let at = 0, of = 0;
    for (let i = 0; i < questions.length; i++) {
      if (questions[i].sectionId !== q.sectionId) continue;
      of++;
      if (i <= index) at++;
    }
    return {
      at,
      of,
      label: section?.examLabel || q.sectionLabel || "",
      sectionNumber: section?.number ?? "",
    };
  }, [questions, index, q]);

  /* Going back to an already-answered question should show its answer again. */
  useEffect(() => {
    setRevealed(instantFeedback && answers[index] !== null && answers[index] !== undefined);
  }, [index, instantFeedback, answers]);

  function choose(optionIndex) {
    if (revealed) return;
    setAnswers(prev => {
      const next = [...prev];
      next[index] = optionIndex;
      return next;
    });
    if (instantFeedback) {
      setRevealed(true);
      if (optionIndex === q.correct) {
        setCelebrateKey(k => k + 1);
        setCelebrating(true);
      }
    }
  }

  const goTo = useCallback((i) => {
    if (i < 0 || i >= total) return;
    setIndex(i);
  }, [total]);

  function handlePause() {
    onPause({ questions, answers, index, elapsed });
  }

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-900">
      {celebrating && (
        <CorrectBurst key={celebrateKey} onDone={() => setCelebrating(false)} />
      )}

      {/* Top bar. The padding clears the notch and Dynamic Island — the
          previous value was too tight and the row sat under it. */}
      <div className="bg-slate-900 text-white sticky top-0 z-10">
        <div
          className="max-w-2xl mx-auto px-5 pb-3.5"
          style={{ paddingTop: "max(1.75rem, calc(env(safe-area-inset-top) + 1rem))" }}
        >
          <div className="flex items-center justify-between gap-3 mb-3">
            <button
              onClick={onQuit}
              className="flex items-center gap-1 text-xs font-bold uppercase tracking-widest text-slate-400 hover:text-emerald-400 py-1"
            >
              <ChevronLeft size={16} /> Exit
            </button>

            <span className="text-sm font-bold">
              {index + 1} <span className="text-slate-500">/ {total}</span>
            </span>

            <div className="flex items-center gap-3">
              <span
                className={`flex items-center gap-1.5 text-sm font-mono font-bold tabular-nums ${
                  critical ? "text-red-400 animate-pulse"
                    : warning ? "text-amber-400"
                    : "text-slate-300"
                }`}
                title={timed ? "Time remaining" : "Time taken"}
              >
                <Clock size={14} />
                {formatClock(timed ? remaining : elapsed)}
              </span>
              <button
                onClick={handlePause}
                className="flex items-center gap-1.5 bg-white/10 hover:bg-white/20 rounded-lg px-2.5 py-1.5 text-xs font-bold text-white"
              >
                <Pause size={14} /> Pause
              </button>
            </div>
          </div>

          <ProgressBar pct={(answeredCount / total) * 100} height="h-1.5" />
        </div>
      </div>

      {/* Under two minutes, say so in words. The clock alone is easy to miss
          while reading a question, and this is the moment to stop reading and
          start filling in blanks — unanswered is marked wrong. */}
      {critical && (
        <div className="bg-red-500 text-white">
          <div className="max-w-2xl mx-auto px-5 py-2 flex items-center gap-2 text-sm font-bold">
            <AlertTriangle size={15} className="shrink-0" />
            <span>
              {formatClock(remaining)} left
              {unansweredCount > 0 && ` · ${unansweredCount} still blank`}
            </span>
          </div>
        </div>
      )}

      <div className="max-w-2xl mx-auto px-5 py-6 pb-36">
        {/* Which section, and where you are inside it. The real paper is
            sectioned and each section passes or fails on its own, so knowing
            you are 3 questions into Teaching Ability is useful information —
            "question 43 of 100" is not. */}
        {position && module.kind === "mock" && (
          <div className="mb-3 flex items-center gap-2 text-[11px] font-bold uppercase tracking-widest text-emerald-600 dark:text-emerald-400">
            <Layers size={13} className="shrink-0" />
            <span className="truncate">
              Section {position.sectionNumber} · {position.label}
            </span>
            <span className="ml-auto shrink-0 text-slate-400 tabular-nums">
              {position.at}/{position.of}
            </span>
          </div>
        )}

        {/* Sign questions carry an image — the sign is the question. */}
        {q.image && (
          <div className="mb-4 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl p-6 flex justify-center">
            <img src={q.image} alt="" className="max-h-36 w-auto object-contain" />
          </div>
        )}

        {/* rd-lead rather than text-lg: this is the text the Reading size
            setting scales. See textSize.jsx. */}
        <h2 className="rd-lead font-bold text-slate-900 dark:text-white">
          {q.q}
        </h2>

        <div className="mt-5 space-y-2.5">
          {q.options.map((opt, i) => {
            const letter = String.fromCharCode(65 + i);
            const isPicked = picked === i;
            const isAnswer = i === q.correct;

            let cls = "border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800";
            if (revealed && isAnswer) {
              cls = "border-emerald-500 bg-emerald-50 dark:bg-emerald-950/40";
            } else if (revealed && isPicked) {
              cls = "border-red-400 bg-red-50 dark:bg-red-950/40";
            } else if (isPicked) {
              cls = "border-emerald-500 bg-emerald-50 dark:bg-emerald-950/40";
            }

            return (
              <button
                key={i}
                onClick={() => choose(i)}
                disabled={revealed}
                className={`w-full text-left border rounded-2xl px-4 py-3.5 flex items-start gap-3 transition ${cls}`}
              >
                <span className={`w-7 h-7 rounded-lg flex items-center justify-center text-sm font-bold shrink-0 ${
                  (revealed && isAnswer) || (!revealed && isPicked)
                    ? "bg-emerald-500 text-white"
                    : revealed && isPicked
                      ? "bg-red-500 text-white"
                      : "bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-300"
                }`}>
                  {revealed && isAnswer ? <Check size={15} />
                    : revealed && isPicked ? <X size={15} />
                    : letter}
                </span>
                <span className="rd-option text-slate-800 dark:text-slate-100 pt-0.5">
                  {opt}
                </span>
              </button>
            );
          })}
        </div>

        {revealed && q.explain && (
          <Explanation key={q.qid || index} text={q.explain} />
        )}
      </div>

      {/* Previous / Next, plus Finish once anything has been answered. */}
      <div className="fixed bottom-0 inset-x-0 bg-white/95 dark:bg-slate-900/95 backdrop-blur border-t border-slate-200 dark:border-slate-800 px-5 pt-3">
        <div
          className="max-w-2xl mx-auto"
          style={{ paddingBottom: "max(0.875rem, env(safe-area-inset-bottom))" }}
        >
          <div className="flex items-center gap-2.5">
            <button
              onClick={() => goTo(index - 1)}
              disabled={index === 0}
              className="flex-1 flex items-center justify-center gap-1.5 border border-slate-200 dark:border-slate-700 disabled:opacity-40 text-slate-700 dark:text-slate-200 font-bold py-3 rounded-xl transition"
            >
              <ChevronLeft size={18} /> Previous
            </button>

            {isLast ? (
              <button
                onClick={() => handleFinish()}
                disabled={answeredCount === 0}
                className="flex-1 flex items-center justify-center gap-1.5 bg-emerald-500 hover:bg-emerald-400 disabled:opacity-50 text-slate-900 font-bold py-3 rounded-xl transition"
              >
                <Flag size={16} /> Finish
              </button>
            ) : (
              <button
                onClick={() => goTo(index + 1)}
                /* Practice reveals the answer the moment you pick one, so
                   there's nothing to move on to until you have. A mock stays
                   fully enabled — skipping and coming back is legitimate
                   there, same as the real test, and a blank still counts as
                   wrong rather than being blocked. */
                disabled={instantFeedback && !revealed}
                className={`flex-1 flex items-center justify-center gap-1.5 font-bold py-3 rounded-xl transition ${
                  instantFeedback && !revealed
                    ? "border border-slate-200 dark:border-slate-700 text-slate-400 dark:text-slate-500"
                    : "bg-emerald-500 hover:bg-emerald-400 text-slate-900"
                }`}
              >
                Next <ChevronRight size={18} />
              </button>
            )}
          </div>

          {/* Finish early, without walking to the last question. In a mock the
              blanks are named, because they will be marked wrong. */}
          {!isLast && answeredCount > 0 && (
            <button
              onClick={() => handleFinish()}
              className="w-full mt-2 text-xs font-bold uppercase tracking-widest text-slate-400 hover:text-emerald-600 py-1.5"
            >
              {timed && unansweredCount > 0
                ? `Finish now · ${unansweredCount} blank count as wrong`
                : `Finish now · ${answeredCount} answered`}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/* ===========================================================================
   RESULT
   =========================================================================== */
function QuizResult({ module, result, onRetry, onExit }) {
  const [reviewing, setReviewing] = useState(false);
  const [filter, setFilter] = useState(null);   // section id, in a mock review

  const grade = result.grade || null;

  /* The topic that cost the most marks, used to pre-filter the review.
     Null unless it actually dropped something and there is more than one
     topic in the paper — otherwise "review your weakest topic" would offer
     a filter that changes nothing. */
  const weakestTopic = useMemo(() => {
    if (!grade || grade.rows.length < 2) return null;
    const dropped = grade.rows.filter(r => r.total > r.correct);
    if (!dropped.length) return null;
    return dropped.reduce((worst, r) =>
      (r.total - r.correct) > (worst.total - worst.correct) ? r : worst
    );
  }, [grade]);

  const pct = result.pct ?? Math.round((result.score / result.total) * 100);
  const passMark = result.passMark ?? PASS_MARK;
  const verdict = result.verdict ?? verdictFor(pct, passMark);
  const tone = verdict.status === "pass" ? "emerald"
    : verdict.status === "close" ? "amber" : "red";

  if (reviewing) {
    const shown = filter ? result.log.filter(it => it.sectionId === filter) : result.log;
    const wrong = shown.filter(it => !it.isRight).length;

    return (
      <>
        <ScreenHeader
          title="Review answers"
          subtitle={
            filter
              ? `${shown.length - wrong} of ${shown.length} correct in this section`
              : `${result.score} of ${result.total} correct`
          }
          onBack={() => setReviewing(false)}
          backLabel="Result"
        />
        <Screen>
          {/* In a mock, jump straight to the section that let you down rather
              than scrolling a hundred questions to find it. */}
          {grade && grade.rows.length > 1 && (
            <div className="-mx-5 px-5 mb-4 overflow-x-auto">
              <div className="flex gap-2 w-max pb-1">
                <FilterChip active={!filter} onClick={() => setFilter(null)}>
                  All {result.total}
                </FilterChip>
                {grade.rows.map(row => (
                  <FilterChip
                    key={row.id}
                    active={filter === row.id}
                    tone={row.passed ? "pass" : "fail"}
                    onClick={() => setFilter(row.id)}
                  >
                    {row.label} {row.correct}/{row.total}
                  </FilterChip>
                ))}
              </div>
            </div>
          )}

          <div className="space-y-3">
            {shown.map((item, i) => (
              <div
                key={i}
                className={`rounded-2xl p-4 border ${
                  item.isRight
                    ? "border-emerald-200 dark:border-emerald-900 bg-emerald-50/50 dark:bg-emerald-950/20"
                    : "border-red-200 dark:border-red-900 bg-red-50/50 dark:bg-red-950/20"
                }`}
              >
                <div className="flex items-start gap-2.5">
                  <span className={`w-6 h-6 rounded-lg flex items-center justify-center shrink-0 ${
                    item.isRight ? "bg-emerald-500" : "bg-red-500"
                  }`}>
                    {item.isRight
                      ? <Check size={14} className="text-white" />
                      : <X size={14} className="text-white" />}
                  </span>
                  <div className="min-w-0">
                    {item.image && (
                      <img src={item.image} alt="" className="max-h-24 w-auto object-contain mb-2" />
                    )}
                    <p className="rd-body font-semibold text-slate-900 dark:text-white">
                      {item.q}
                    </p>
                  </div>
                </div>

                <div className="mt-3 pl-9 space-y-1 rd-body">
                  {item.skipped ? (
                    <p className="text-amber-600 dark:text-amber-400 font-semibold">
                      Left blank — marked wrong.
                    </p>
                  ) : !item.isRight && (
                    <p className="text-red-600 dark:text-red-400">
                      <span className="font-bold">You chose:</span> {item.options[item.picked]}
                    </p>
                  )}
                  <p className="text-emerald-700 dark:text-emerald-400">
                    <span className="font-bold">Answer:</span> {item.options[item.correct]}
                  </p>
                  {item.explain && (
                    <Explanation text={item.explain} inline />
                  )}
                </div>
              </div>
            ))}
          </div>
        </Screen>
      </>
    );
  }

  return (
    <>
      <ScreenHeader title={module.label} subtitle={module.sectionLabel} />
      <Screen>
        {/* Ran out of time. Said before the score, because it explains it. */}
        {result.timedOut && (
          <div className="mb-4 flex gap-3 bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-900 rounded-2xl p-4">
            <AlertTriangle size={18} className="text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
            <div>
              <p className="font-bold text-slate-900 dark:text-white text-sm">Time ran out</p>
              <p className="mt-1 text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
                The paper submitted itself at zero, as it would in the real test. Anything
                you hadn't answered is marked wrong.
              </p>
            </div>
          </div>
        )}

        <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl p-6 text-center">
          <h2 className={`text-xl font-black tracking-tight ${
            verdict.status === "pass" ? "text-emerald-600 dark:text-emerald-400"
              : verdict.status === "close" ? "text-amber-600 dark:text-amber-400"
              : "text-slate-900 dark:text-white"
          }`}>
            {verdict.title}
          </h2>

          <div className="my-5">
            <ProgressRing
              pct={pct}
              size={128}
              stroke={10}
              /* In a mock the ring follows the verdict, not the number. 88%
                 in emerald beside a failed section would say the opposite of
                 what the result means. */
              tone={grade ? (grade.passed ? "emerald" : tone) : tone}
              label={grade ? "Overall" : "Your score"}
            />
          </div>

          <p className="text-sm text-slate-500 dark:text-slate-400 leading-relaxed max-w-sm mx-auto">
            {verdict.message}
          </p>

          <div className="mt-6 grid grid-cols-3 gap-3 pt-5 border-t border-slate-100 dark:border-slate-700">
            <Stat label="Correct" value={`${result.score}/${result.total}`} />
            {grade
              ? <Stat
                  label={grade.passed ? "Margin" : "Short by"}
                  value={grade.passed
                    ? `+${grade.score - grade.needed}`
                    : `${grade.needed - grade.score}`}
                />
              : <Stat label="Standard" value={`${passMark}%`} />}
            <Stat
              label={result.timedOut ? "Time used" : "Time"}
              value={formatClock(result.elapsed || 0)}
            />
          </div>
        </div>

        {/* WHERE THE MARKS WENT.

            Not the marking scheme — the test has one mark out of 40 and these
            rows carry passMark: null deliberately. They exist because "32 of
            40" tells a learner they missed eight and nothing about which eight.
            No row is coloured red or drawn with a pass line, because no topic
            can fail on its own and a red bar would say otherwise. */}
        {grade && (
          <div className="mt-4 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl p-5">
            <div className="flex items-baseline justify-between">
              <h3 className="font-bold text-slate-900 dark:text-white">Where the marks went</h3>
              <span className={`text-xs font-bold uppercase tracking-widest ${
                grade.passed
                  ? "text-emerald-600 dark:text-emerald-400"
                  : "text-amber-600 dark:text-amber-400"
              }`}>
                {grade.passed
                  ? "Passed"
                  : `${grade.needed - grade.score} short`}
              </span>
            </div>

            <div className="mt-4 space-y-4">
              {grade.rows.map(row => (
                <div key={row.id}>
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="text-sm font-semibold text-slate-800 dark:text-slate-100 truncate">
                      {row.examLabel}
                    </span>
                    <span className="text-sm font-black shrink-0 tabular-nums text-slate-700 dark:text-slate-200">
                      {row.correct}/{row.total}
                    </span>
                  </div>

                  <div className="mt-1.5">
                    {/* No pass line and no red: there is nothing here to fail.
                        Amber marks the topics costing the most, which is the
                        only judgement this breakdown is entitled to make. */}
                    <ProgressBar
                      pct={row.pct}
                      tone={row.pct >= 80 ? "emerald" : row.pct >= 60 ? "amber" : "slate"}
                      height="h-2"
                    />
                  </div>

                  <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                    {row.pct}%
                    {row.total - row.correct > 0 && (
                      <span>{" "}· dropped {row.total - row.correct}</span>
                    )}
                  </p>
                </div>
              ))}
            </div>

            <p className="mt-5 pt-4 border-t border-slate-100 dark:border-slate-700 text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
              The test is marked as one score — {grade.needed} of {grade.total} passes,
              whichever topics the marks come from. This breakdown is only here to show
              you where to spend revision time.
            </p>
          </div>
        )}

        <div className="mt-4 space-y-2.5">
          {/* Open the review already filtered to wherever most of the marks
              went. Nobody reads forty explanations; they read the six that
              cost them the paper.

              The sister ADI app filters to the section that failed. Nothing
              fails here, so the filter is the weakest topic instead — and only
              when it actually dropped marks and there is more than one topic
              to choose between. */}
          {weakestTopic ? (
            <>
              <PrimaryButton
                onClick={() => { setFilter(weakestTopic.id); setReviewing(true); }}
              >
                Review {weakestTopic.label} · {weakestTopic.total - weakestTopic.correct} missed
              </PrimaryButton>
              <button
                onClick={() => { setFilter(null); setReviewing(true); }}
                className="w-full text-sm font-semibold text-slate-500 dark:text-slate-400 hover:text-emerald-600 py-1"
              >
                Review all {result.total} answers
              </button>
            </>
          ) : (
            <PrimaryButton onClick={() => { setFilter(null); setReviewing(true); }}>
              Review answers
            </PrimaryButton>
          )}
          <SecondaryButton onClick={onRetry}>
            <span className="inline-flex items-center gap-2">
              <RotateCcw size={16} /> Try again
            </span>
          </SecondaryButton>
          <button
            onClick={onExit}
            className="w-full text-sm font-semibold text-slate-500 dark:text-slate-400 hover:text-emerald-600 py-2"
          >
            Back to home
          </button>
        </div>
      </Screen>
    </>
  );
}

/* An explanation that collapses when it runs long.

   Most explanations are a sentence or two and show in full. The longer ones
   are clipped to roughly the first three lines with a Read more control, so a
   detailed answer doesn't push the next question off the screen — but the
   detail is still one tap away rather than cut.

   The threshold is on characters rather than a CSS line clamp because the
   control should only appear when there is genuinely more to read; a clamp
   renders the button even when nothing is hidden. */
const EXPLANATION_CLIP = 180;

function Explanation({ text, inline }) {
  const [open, setOpen] = useState(false);
  const long = text.length > EXPLANATION_CLIP;

  // Cut at a word boundary, not mid-word.
  const short = long
    ? text.slice(0, text.lastIndexOf(" ", EXPLANATION_CLIP)).trimEnd() + "…"
    : text;

  const body = (
    <>
      <p className={`rd-body ${
        inline
          ? "text-slate-500 dark:text-slate-400"
          : "text-slate-700 dark:text-slate-200"
      }`}>
        {open || !long ? text : short}
      </p>

      {long && (
        <button
          type="button"
          onClick={() => setOpen(v => !v)}
          className="mt-2 inline-flex items-center gap-1 text-xs font-bold uppercase tracking-widest text-emerald-600 dark:text-emerald-400"
        >
          {open ? <>Show less <ChevronUp size={14} /></> : <>Read more <ChevronDown size={14} /></>}
        </button>
      )}
    </>
  );

  if (inline) return <div className="pt-1">{body}</div>;

  return (
    <div className="mt-4 bg-slate-100 dark:bg-slate-800 rounded-2xl p-4">
      <p className="text-[11px] font-bold uppercase tracking-widest text-slate-400 mb-1">Why</p>
      {body}
    </div>
  );
}

/* A section chip in the review header. Colour carries the pass/fail so the
   failed section is findable without reading five labels. */
function FilterChip({ active, tone, onClick, children }) {
  const base = "shrink-0 rounded-full px-3 py-1.5 text-xs font-bold border transition whitespace-nowrap";

  const cls = active
    ? "bg-slate-900 dark:bg-white text-white dark:text-slate-900 border-slate-900 dark:border-white"
    : tone === "fail"
      ? "bg-red-50 dark:bg-red-950/40 text-red-600 dark:text-red-400 border-red-200 dark:border-red-900"
      : tone === "pass"
        ? "bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-400 border-emerald-200 dark:border-emerald-900"
        : "bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700";

  return (
    <button type="button" onClick={onClick} className={`${base} ${cls}`}>
      {children}
    </button>
  );
}

function Stat({ label, value }) {
  return (
    <div>
      <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">{label}</p>
      <p className="mt-0.5 font-black text-slate-900 dark:text-white">{value}</p>
    </div>
  );
}

/* ===========================================================================
   CORRECT BURST

   A small celebration for a right answer in topic practice — a handful of
   coloured particles and a checkmark badge, both driven by the pdt-burst /
   pdt-pop keyframes in index.css. Not shown in a mock, where feedback is
   deferred to the end and a burst mid-paper would rather give the answer
   away.

   Self-contained on purpose: no confetti library, just ten <span>s and a
   circle. `prefers-reduced-motion` is already handled globally in index.css.
   =========================================================================== */
const BURST_COLORS = ["#10b981", "#34d399", "#6ee7b7", "#fbbf24", "#60a5fa"];
const BURST_DURATION = 700;

function CorrectBurst({ onDone }) {
  useEffect(() => {
    const t = setTimeout(onDone, BURST_DURATION);
    return () => clearTimeout(t);
  }, [onDone]);

  const particles = useMemo(() => Array.from({ length: 10 }, (_, i) => {
    const angle = (i / 10) * Math.PI * 2;
    const dist = 60 + Math.random() * 30;
    return {
      tx: Math.cos(angle) * dist,
      ty: Math.sin(angle) * dist,
      color: BURST_COLORS[i % BURST_COLORS.length],
      delay: Math.round(Math.random() * 60),
    };
  }), []);

  return (
    <div className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center" aria-hidden="true">
      <div className="relative w-0 h-0">
        {particles.map((p, i) => (
          <span
            key={i}
            className="absolute top-1/2 left-1/2 w-2.5 h-2.5 rounded-full"
            style={{
              backgroundColor: p.color,
              "--tx": `${p.tx}px`,
              "--ty": `${p.ty}px`,
              animation: `pdt-burst 550ms ease-out ${p.delay}ms both`,
            }}
          />
        ))}
        <div
          className="absolute top-1/2 left-1/2 w-14 h-14 rounded-full bg-emerald-500 flex items-center justify-center shadow-lg"
          style={{ animation: "pdt-pop 380ms ease-out both" }}
        >
          <Check size={28} className="text-white" strokeWidth={3} />
        </div>
      </div>
    </div>
  );
}
