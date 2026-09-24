/*
  ===========================================================================
  PROGRESS

  Every quiz, mock test and flashcard deck reports its result here. Every
  progress bar in the app reads from here. Nothing else touches storage.

  How it stores things:
    - Always written to localStorage first, so a result is never lost if the
      network drops mid-test.
    - Also written to Supabase when the learner is signed in with the database
      connected, so progress follows them to another phone or laptop.
    - On sign-in, anything studied before signing in is merged upward. Every
      field merges idempotently — best score wins, ids union, counts take the
      higher of the two. Merging the same data twice must not change it, which
      is why attempts takes the max rather than the sum: local and remote hold
      the same history, not two halves of it. Summing them doubled the count
      on every sign-in until it reached six figures.

  Progress model:
    module   — best %, last %, attempts, passed
    section  — average of its SCORED modules (MCQs and mock tests). Learning
               materials and flashcards don't have a score, so they don't drag
               a section's percentage down.
    path     — average of its sections that have been started.
  ===========================================================================
*/

import React, {
  createContext, useContext, useState, useEffect, useCallback, useMemo, useRef,
} from "react";
import { supabase, HAS_SUPABASE } from "./supabaseClient";
import { useAuth } from "./appAuth";
import { ADI_SECTIONS, MOCKS, PASS_MARK, passMarkFor, verdictFor } from "./appStructure";

const LOCAL_KEY = "pdt-progress-v1";

const ProgressContext = createContext(null);

const emptyEntry = () => ({
  bestPct: 0,
  lastPct: 0,
  lastScore: 0,
  lastTotal: 0,
  attempts: 0,
  correctCount: 0,     // cumulative correct answers, for accuracy
  gradedCount: 0,      // cumulative questions graded, for accuracy
  passed: false,
  completedIds: [],
  /* Mocks only: the section breakdown of the most recent attempt, as
     [{ id, c, t }] — correct and total per section. Five short rows.

     Stored because a single percentage cannot answer the question a candidate
     actually has: "which section keeps letting me down?". Without this the
     Mock Test screen could only repeat what the home screen already shows.
     Deliberately just the last attempt rather than a full history — enough to
     be useful, small enough to sync in the same row. */
  lastSections: [],
  /* A quiz or mock paused mid-attempt: { qids, answers, index, elapsed,
     savedAt }. Rides along with everything else on this row so "continue
     where you left off" survives signing in on another device or
     reinstalling the app, not just a refresh on the same phone. Needs
     sql/02-add-paused-state.sql to have been run — absent until then, same
     as lastSections above. */
  paused: null,
  updatedAt: null,
});

/* Attempts once compounded on every sign-in (see mergeEntry), so some devices
   hold an absurd figure. Anything past this is treated as corrupt and reset
   rather than shown — a six-figure "tests taken" is worse than none. */
const MAX_SANE_ATTEMPTS = 5000;

function sanitise(entry) {
  const e = { ...emptyEntry(), ...(entry || {}) };
  if (!Number.isFinite(e.attempts) || e.attempts < 0 || e.attempts > MAX_SANE_ATTEMPTS) e.attempts = 0;
  if (!Number.isFinite(e.correctCount) || e.correctCount < 0) e.correctCount = 0;
  if (!Number.isFinite(e.gradedCount) || e.gradedCount < 0) e.gradedCount = 0;
  if (e.correctCount > e.gradedCount) e.correctCount = e.gradedCount;

  /* Anything that isn't a well-formed breakdown is dropped rather than shown.
     This comes back from storage and from the server, so it can be stale,
     truncated, or from an older version of the app that never wrote it. */
  e.lastSections = Array.isArray(e.lastSections)
    ? e.lastSections
        .filter(r => r && typeof r.id === "string"
          && Number.isFinite(r.c) && Number.isFinite(r.t)
          && r.t > 0 && r.c >= 0 && r.c <= r.t)
        .slice(0, 10)
    : [];

  /* Same story: comes back from storage and from the server, so it can be
     malformed, stale, or from before this field existed. Anything that
     isn't a usable paused attempt is dropped rather than shown as one. */
  e.paused = (e.paused && typeof e.paused === "object"
    && Array.isArray(e.paused.qids) && e.paused.qids.length
    && Array.isArray(e.paused.answers))
    ? {
        qids: e.paused.qids,
        answers: e.paused.answers,
        index: Number.isFinite(e.paused.index) ? e.paused.index : 0,
        elapsed: Number.isFinite(e.paused.elapsed) ? e.paused.elapsed : 0,
        savedAt: e.paused.savedAt || null,
      }
    : null;

  return e;
}

/* ------------------------------------------------------------------------- */
function readLocal() {
  try {
    const raw = JSON.parse(localStorage.getItem(LOCAL_KEY)) || {};
    const out = {};
    for (const [k, v] of Object.entries(raw)) out[k] = sanitise(v);
    return out;
  } catch {
    return {};
  }
}

function writeLocal(data) {
  try {
    localStorage.setItem(LOCAL_KEY, JSON.stringify(data));
  } catch {
    /* out of quota or private mode — in-memory progress still works */
  }
}

/* Merge two entries for the same module. Best score wins, attempts add. */
function mergeEntry(a, b) {
  if (!a) return b;
  if (!b) return a;
  const newer = (b.updatedAt || "") > (a.updatedAt || "") ? b : a;
  return {
    bestPct: Math.max(a.bestPct || 0, b.bestPct || 0),
    lastPct: newer.lastPct || 0,
    lastScore: newer.lastScore || 0,
    lastTotal: newer.lastTotal || 0,
    attempts: Math.max(a.attempts || 0, b.attempts || 0),
    correctCount: Math.max(a.correctCount || 0, b.correctCount || 0),
    gradedCount: Math.max(a.gradedCount || 0, b.gradedCount || 0),
    passed: Boolean(a.passed || b.passed),
    completedIds: Array.from(new Set([...(a.completedIds || []), ...(b.completedIds || [])])),
    /* The newer side's breakdown wins outright. Merging two breakdowns would
       invent an attempt that never happened — a section row from Monday's
       paper sitting beside one from Friday's.

       Every test here is on `.length`, not truthiness. An empty array is
       truthy, so `a.lastSections || b.lastSections` always returns a's empty
       array and the real breakdown is thrown away. That is exactly what
       happens on every sign-in until the SQL is run: the server has no
       column, so it sends nothing back with a newer timestamp, and the phone's
       own breakdown would be wiped by its own reply. */
    lastSections: newer.lastSections?.length ? newer.lastSections
      : a.lastSections?.length ? a.lastSections
      : (b.lastSections?.length ? b.lastSections : []),
    /* The newer side wins outright, same reasoning as lastSections — and
       correctly so here even when that means null: pausing and finishing
       both bump updatedAt, so "newer" already means "the last thing that
       actually happened to this attempt", clearing included. */
    paused: newer.paused ?? null,
    updatedAt: newer.updatedAt || null,
  };
}

/* ------------------------------------------------------------------------- */
export function ProgressProvider({ children }) {
  const { user, isSignedIn } = useAuth();
  const [entries, setEntries] = useState(() => readLocal());
  const [syncing, setSyncing] = useState(false);
  const mergedFor = useRef(null);

  /* ---- pull from the database on sign-in, merging local work upward ---- */
  useEffect(() => {
    if (!isSignedIn || !HAS_SUPABASE || !user?.id) return;
    if (mergedFor.current === user.id) return;
    mergedFor.current = user.id;

    let cancelled = false;

    (async () => {
      setSyncing(true);
      const { data, error } = await supabase
        .from("progress")
        .select("*")
        .eq("user_id", user.id);

      if (cancelled) return;

      if (error) {
        console.warn("Could not load progress:", error.message);
        setSyncing(false);
        return;
      }

      const remote = {};
      for (const row of data || []) {
        remote[row.module_id] = {
          bestPct: row.best_pct,
          lastPct: row.last_pct,
          lastScore: row.last_score,
          lastTotal: row.last_total,
          attempts: row.attempts,
          correctCount: row.correct_count || 0,
          gradedCount: row.graded_count || 0,
          passed: row.passed,
          completedIds: row.completed_ids || [],
          /* Absent until sql/add-section-results.sql has been run — the
             column simply isn't there, so this reads as undefined and the
             sanitiser turns it into an empty list. */
          lastSections: row.last_sections || [],
          /* Absent until sql/02-add-paused-state.sql has been run — reads as
             undefined and the sanitiser turns it into null, same pattern as
             lastSections above. */
          paused: row.paused || null,
          updatedAt: row.updated_at,
        };
      }

      const local = readLocal();
      const merged = { ...remote };
      const needsPush = [];

      for (const [moduleId, localEntry] of Object.entries(local)) {
        const combined = mergeEntry(remote[moduleId], localEntry);
        merged[moduleId] = combined;
        // Local knew something the database didn't — push it up.
        if (
          !remote[moduleId] ||
          combined.bestPct > (remote[moduleId].bestPct || 0) ||
          combined.attempts > (remote[moduleId].attempts || 0)
        ) {
          needsPush.push([moduleId, combined]);
        }
      }

      setEntries(merged);
      writeLocal(merged);

      for (const [moduleId, entry] of needsPush) {
        await supabase.from("progress").upsert(
          {
            user_id: user.id,
            module_id: moduleId,
            best_pct: entry.bestPct,
            last_pct: entry.lastPct,
            last_score: entry.lastScore,
            last_total: entry.lastTotal,
            attempts: entry.attempts,
            correct_count: entry.correctCount || 0,
            graded_count: entry.gradedCount || 0,
            passed: entry.passed,
            completed_ids: entry.completedIds,
            ...(entry.lastSections?.length
              ? { last_sections: entry.lastSections }
              : null),
            ...(entry.paused ? { paused: entry.paused } : null),
          },
          { onConflict: "user_id,module_id" }
        );
      }

      setSyncing(false);
    })();

    return () => { cancelled = true; };
  }, [isSignedIn, user?.id]);

  /* Signing out shouldn't wipe the device — but it also shouldn't leave one
     learner's scores showing for the next person on a shared phone. */
  useEffect(() => {
    if (!isSignedIn) mergedFor.current = null;
  }, [isSignedIn]);

  /* ---- record a finished quiz or mock test ---- */
  /* `opts` lets the caller supply a verdict this function can't work out for
     itself. A mock passes only on 35 of 40, which is not a fact
     about `score / total` — 88% can be a fail. Without this the store would
     record a pass the result screen is calling a fail. */
  const recordResult = useCallback(async (moduleId, score, total, opts = {}) => {
    if (!total || total <= 0) return null;

    const pct = Math.round((score / total) * 100);
    const passMark = opts.passMark ?? passMarkFor(moduleId) ?? PASS_MARK;
    const didPass = opts.passed !== undefined ? !!opts.passed : pct >= passMark;
    const verdict = verdictFor(pct, passMark);

    let updatedEntry;
    setEntries(prev => {
      const before = prev[moduleId] || emptyEntry();
      updatedEntry = {
        ...before,
        bestPct: Math.max(before.bestPct, pct),
        lastPct: pct,
        lastScore: score,
        lastTotal: total,
        attempts: before.attempts + 1,
        correctCount: (before.correctCount || 0) + score,
        gradedCount: (before.gradedCount || 0) + total,
        passed: before.passed || didPass,
        lastSections: Array.isArray(opts.sections) && opts.sections.length
          ? opts.sections
          : (before.lastSections || []),
        updatedAt: new Date().toISOString(),
      };
      const next = { ...prev, [moduleId]: updatedEntry };
      writeLocal(next);
      return next;
    });

    if (isSignedIn && HAS_SUPABASE && user?.id) {
      const { error } = await supabase.rpc("record_result", {
        p_module_id: moduleId,
        p_score: score,
        p_total: total,
        p_pass_mark: passMark,
        /* The server cannot work out a mock's verdict — it doesn't know the
           five section marks — so it's told. See sql/add-section-results.sql. */
        p_passed: didPass,
        p_sections: Array.isArray(opts.sections) ? opts.sections : null,
      });
      if (error) {
        /* Until that SQL is run the function has the old four-argument
           signature and rejects these. The device keeps its own correct copy
           either way, so this degrades to "works on this phone" rather than
           losing the result. */
        console.warn("Progress not synced:", error.message);
      }
    }

    return { pct, passMark, verdict, entry: updatedEntry };
  }, [isSignedIn, user?.id]);

  /* ---- mark a flashcard known / unknown ---- */
  const toggleCardKnown = useCallback(async (moduleId, cardId) => {
    let nextIds;
    setEntries(prev => {
      const before = prev[moduleId] || emptyEntry();
      const has = before.completedIds.includes(cardId);
      nextIds = has
        ? before.completedIds.filter(id => id !== cardId)
        : [...before.completedIds, cardId];
      const next = {
        ...prev,
        [moduleId]: { ...before, completedIds: nextIds, updatedAt: new Date().toISOString() },
      };
      writeLocal(next);
      return next;
    });

    if (isSignedIn && HAS_SUPABASE && user?.id) {
      await supabase.from("progress").upsert(
        { user_id: user.id, module_id: moduleId, completed_ids: nextIds },
        { onConflict: "user_id,module_id" }
      );
    }
  }, [isSignedIn, user?.id]);

  /* ---- reset one module, or everything ---- */
  const resetModule = useCallback(async (moduleId) => {
    setEntries(prev => {
      const next = { ...prev };
      delete next[moduleId];
      writeLocal(next);
      return next;
    });
    if (isSignedIn && HAS_SUPABASE && user?.id) {
      await supabase.from("progress").delete()
        .eq("user_id", user.id).eq("module_id", moduleId);
    }
  }, [isSignedIn, user?.id]);

  const resetAll = useCallback(async () => {
    setEntries({});
    writeLocal({});
    if (isSignedIn && HAS_SUPABASE && user?.id) {
      await supabase.from("progress").delete().eq("user_id", user.id);
    }
  }, [isSignedIn, user?.id]);

  /* -----------------------------------------------------------------------
     RECORD WHICH QUESTIONS HAVE BEEN SEEN

     Section progress is "how many of this section's questions have you
     answered", so every answered question's id is stored. Ids come from the
     question text itself (see theorySections.js), so they survive banks being
     reordered or extended.

     These are kept in the same completedIds field the flashcards use, which
     is already a jsonb column and already syncs.
     ----------------------------------------------------------------------- */
  const recordAnswered = useCallback(async (sectionId, qids) => {
    if (!sectionId || !qids?.length) return;

    let merged;
    setEntries(prev => {
      const before = prev[sectionId] || emptyEntry();
      merged = Array.from(new Set([...(before.completedIds || []), ...qids]));
      const next = {
        ...prev,
        [sectionId]: { ...before, completedIds: merged, updatedAt: new Date().toISOString() },
      };
      writeLocal(next);
      return next;
    });

    if (isSignedIn && HAS_SUPABASE && user?.id) {
      const { error } = await supabase.from("progress").upsert(
        { user_id: user.id, module_id: sectionId, completed_ids: merged },
        { onConflict: "user_id,module_id" }
      );
      if (error) console.warn("Answered questions not synced:", error.message);
    }
  }, [isSignedIn, user?.id]);

  /* -----------------------------------------------------------------------
     PAUSED ATTEMPT

     Which question a quiz or mock was paused on, what's been picked so far,
     and the clock reading. Written on every pause and cleared on every
     finish/discard, same as the rest of this store — local first, then the
     database when signed in, so it survives a sign-in on another device or
     the app being deleted and reinstalled on this one.
     ----------------------------------------------------------------------- */
  const savePausedAttempt = useCallback(async (moduleId, { qids, answers, index, elapsed }) => {
    if (!moduleId || !qids?.length) return;

    const paused = { qids, answers, index, elapsed, savedAt: new Date().toISOString() };
    setEntries(prev => {
      const before = prev[moduleId] || emptyEntry();
      const next = {
        ...prev,
        [moduleId]: { ...before, paused, updatedAt: new Date().toISOString() },
      };
      writeLocal(next);
      return next;
    });

    if (isSignedIn && HAS_SUPABASE && user?.id) {
      const { error } = await supabase.from("progress").upsert(
        { user_id: user.id, module_id: moduleId, paused },
        { onConflict: "user_id,module_id" }
      );
      // Column doesn't exist yet on this project (sql/02-add-paused-state.sql
      // not run) — the device still has it, resume just won't follow to
      // another one until the migration runs.
      if (error) console.warn("Paused attempt not synced:", error.message);
    }
  }, [isSignedIn, user?.id]);

  const clearPausedAttempt = useCallback(async (moduleId) => {
    if (!moduleId) return;

    setEntries(prev => {
      const before = prev[moduleId];
      if (!before?.paused) return prev;
      const next = {
        ...prev,
        [moduleId]: { ...before, paused: null, updatedAt: new Date().toISOString() },
      };
      writeLocal(next);
      return next;
    });

    if (isSignedIn && HAS_SUPABASE && user?.id) {
      const { error } = await supabase.from("progress").upsert(
        { user_id: user.id, module_id: moduleId, paused: null },
        { onConflict: "user_id,module_id" }
      );
      if (error) console.warn("Paused attempt not cleared remotely:", error.message);
    }
  }, [isSignedIn, user?.id]);

  const getPaused = useCallback((moduleId) => {
    return sanitise(entries[moduleId]).paused;
  }, [entries]);

  /* ---- readers ---- */
  const getModule = useCallback((moduleId) => {
    const entry = sanitise(entries[moduleId]);
    return {
      ...entry,
      /* A mock has no single pass mark — it has five, and `passed` above is
         the honest answer to "did this paper pass". Reported as null so
         nothing downstream prints a number the exam doesn't use. */
      passMark: null,
      started: entry.attempts > 0 || entry.completedIds.length > 0,
      verdict: null,
    };
  }, [entries]);

  /* One of the five exam sections: how much of it has been covered, and how
     well the last attempt went. */
  const getSection = useCallback((sectionId) => {
    const section = ADI_SECTIONS.find(s => s.id === sectionId);
    const entry = sanitise(entries[sectionId]);
    const total = section?.total || 0;
    const answered = Math.min(entry.completedIds.length, total);

    return {
      total,
      answered,
      remaining: Math.max(0, total - answered),
      coveragePct: total ? Math.round((answered / total) * 100) : 0,
      bestPct: entry.bestPct,
      accuracyPct: entry.gradedCount
        ? Math.round((entry.correctCount / entry.gradedCount) * 100)
        : 0,
      correctCount: entry.correctCount,
      gradedCount: entry.gradedCount,
      attempts: entry.attempts,
      passed: entry.passed,
      started: answered > 0 || entry.attempts > 0,
      /* This section's own exam mark, not a global one. */
      passMark: section?.passMark ?? PASS_MARK,
      verdict: entry.attempts > 0
        ? verdictFor(entry.bestPct, section?.passMark ?? PASS_MARK)
        : null,
    };
  }, [entries]);

  /* Headline numbers across all six study sections. */
  const overall = useMemo(() => {
    let answered = 0, total = 0, attempts = 0;
    let correct = 0, graded = 0;
    const scores = [];
    for (const s of ADI_SECTIONS) {
      const e = sanitise(entries[s.id]);
      total += s.total;
      answered += Math.min(e.completedIds.length, s.total);
      attempts += e.attempts;
      correct += e.correctCount;
      graded += e.gradedCount;
      if (e.attempts) scores.push(e.bestPct);
    }
    /* Every mock paper counts toward the totals, not just the first. */
    let mockAttempts = 0, mockBest = 0;
    for (const m of MOCKS) {
      const e = sanitise(entries[m.id]);
      correct += e.correctCount;
      graded += e.gradedCount;
      mockAttempts += e.attempts;
      mockBest = Math.max(mockBest, e.bestPct);
    }

    return {
      answered,
      total,
      coveragePct: total ? Math.round((answered / total) * 100) : 0,
      /* Accuracy is correct answers over questions graded — "how well am I
         doing", as distinct from coverage, which is "how much have I seen". */
      accuracyPct: graded ? Math.round((correct / graded) * 100) : 0,
      correctAnswers: correct,
      gradedAnswers: graded,
      averagePct: scores.length
        ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length)
        : 0,
      bestPct: scores.length ? Math.max(...scores) : 0,
      testsTaken: attempts + mockAttempts,
      mockBest,
      mockAttempts,
      sectionsPassed: ADI_SECTIONS.filter(s => entries[s.id]?.passed).length,
      sectionCount: ADI_SECTIONS.length,
    };
  }, [entries]);

  /* -----------------------------------------------------------------------
     MOCK READINESS

     Pools the section breakdowns from every mock paper sat, and reports each
     section against its own exam pass mark.

     This is the one thing the app can tell a candidate that they cannot work
     out for themselves, and it is the reason the Mock Test screen exists as
     something other than a second copy of the home screen. "You are averaging
     84% but Teaching Ability has come in under its mark both times" is a
     revision plan. "Best score 84%" is not.

     Pooled rather than averaged across papers: 11/20 and 13/20 becomes 24/40,
     which is the right way to combine them — averaging two percentages weights
     a short paper the same as a long one.
     ----------------------------------------------------------------------- */
  const mockReadiness = useMemo(() => {
    const tally = {};
    let papersSat = 0, papersPassed = 0;

    for (const m of MOCKS) {
      const e = sanitise(entries[m.id]);
      if (e.attempts > 0) papersSat++;
      if (e.passed) papersPassed++;
      for (const row of e.lastSections) {
        const t = (tally[row.id] = tally[row.id] || { correct: 0, total: 0 });
        t.correct += row.c;
        t.total += row.t;
      }
    }

    const sections = ADI_SECTIONS.map(s => {
      const t = tally[s.id];
      const passMark = s.passMark ?? PASS_MARK;
      if (!t || !t.total) {
        return {
          id: s.id, label: s.short || s.label,
          examLabel: s.examLabel || s.label,
          passMark, seen: false, pct: 0, correct: 0, total: 0, atStandard: false,
        };
      }
      const pct = Math.round((t.correct / t.total) * 100);
      return {
        id: s.id, label: s.short || s.label,
        examLabel: s.examLabel || s.label,
        passMark, seen: true, pct,
        correct: t.correct, total: t.total,
        atStandard: pct >= passMark,
        /* How far off, in percentage points. Negative means clear of it. */
        gap: passMark - pct,
      };
    });

    const measured = sections.filter(s => s.seen);
    const short = measured.filter(s => !s.atStandard).sort((a, b) => b.gap - a.gap);

    /* The figure that actually decides the test: everything answered across
       every paper sat, pooled into one percentage.

       READINESS IS NOT "EVERY TOPIC AT 88%".

       That was the rule in the sister ADI app, where each section carries its
       own pass mark and one weak section really does fail the paper. This
       test is one mark out of 40 — a learner can be soft on one topic and
       still clear 35 comfortably. Requiring every topic to hit 88% would tell
       people they were not ready when they would in fact pass, and being
       wrong in the cautious direction is still being wrong. */
    const pooledCorrect = measured.reduce((n, s) => n + s.correct, 0);
    const pooledTotal = measured.reduce((n, s) => n + s.total, 0);
    const overallPct = pooledTotal ? Math.round((pooledCorrect / pooledTotal) * 100) : 0;

    return {
      sections,
      measured,
      short,
      /* Where the marks are going — the topic furthest below the standard.
         Guidance for revision, not a verdict: no topic can fail on its own. */
      weakest: short[0] || null,
      overallPct,
      overallCorrect: pooledCorrect,
      overallTotal: pooledTotal,
      papersSat,
      papersPassed,
      papersAvailable: MOCKS.length,
      /* Only meaningful once at least one paper has been sat with a
         breakdown recorded. */
      hasData: measured.length > 0,
      /* One paper cleared is luck; the pooled figure is the honest signal.
         Both are required so a single fluke does not read as ready. */
      readyForExam: pooledTotal > 0 && overallPct >= PASS_MARK && papersPassed > 0,
    };
  }, [entries]);

  /* The weakest sections that have actually been attempted. */
  const weakest = useMemo(() => {
    return ADI_SECTIONS
      .filter(s => (entries[s.id]?.attempts || 0) > 0)
      .map(s => ({ id: s.id, label: s.label, short: s.short, pct: entries[s.id].bestPct }))
      .sort((a, b) => a.pct - b.pct)
      .slice(0, 3);
  }, [entries]);

  const value = useMemo(() => ({
    entries,
    syncing,
    recordResult,
    recordAnswered,
    toggleCardKnown,
    savePausedAttempt,
    clearPausedAttempt,
    getPaused,
    resetModule,
    resetAll,
    getModule,
    getSection,
    overall,
    weakest,
    mockReadiness,
  }), [entries, syncing, recordResult, recordAnswered, toggleCardKnown,
       savePausedAttempt, clearPausedAttempt, getPaused,
       resetModule, resetAll, getModule, getSection, overall, weakest,
       mockReadiness]);

  return <ProgressContext.Provider value={value}>{children}</ProgressContext.Provider>;
}

export function useProgress() {
  const ctx = useContext(ProgressContext);
  if (!ctx) throw new Error("useProgress must be used inside <ProgressProvider>");
  return ctx;
}

export default ProgressProvider;
