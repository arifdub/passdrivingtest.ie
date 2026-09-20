/*
  ===========================================================================
  APP STRUCTURE — Driver Theory Test (car, category B)

  The app is built around six study sections, the mock paper, and the
  flashcard decks. The sections themselves are defined in theorySections.js,
  which is where the questions are filed. This file describes the app's shape
  and how a paper is marked.

  THE ONE THING TO GET RIGHT

  The real test has a single pass mark: 35 correct out of 40. Not a mark per
  section. If you are porting anything from the ADI app, that is the line to
  watch — its grading is built on five independent section marks, and copying
  that here would invent a failure mode the real test does not have.
  ===========================================================================
*/

import {
  THEORY_SECTIONS, SECTION_BY_ID, MOCK_LENGTH, MOCK_MINUTES,
  MOCK_WEIGHTS, TOTAL_QUESTIONS, MOCK_CAPACITY, PASS_MARK, PASS_QUESTIONS,
} from "./theorySections";

export {
  SECTION_BY_ID, MOCK_LENGTH, MOCK_MINUTES,
  TOTAL_QUESTIONS, MOCK_CAPACITY, PASS_MARK, PASS_QUESTIONS,
};

/* The screens were written against the name ADI_SECTIONS in the sister app
   and are shared with it. Exporting the same name here keeps those files
   byte-identical between the two projects, which is worth more than a tidier
   name — a divergence in a shared component is a bug waiting to happen. */
export const ADI_SECTIONS = THEORY_SECTIONS;
export const THEORY_SECTIONS_LIST = THEORY_SECTIONS;

export function passMarkFor() {
  /* Takes a section id in the sister app. Here every section, and the paper
     itself, is held to the same published standard, so the argument is
     ignored on purpose rather than by oversight. */
  return PASS_MARK;
}

/* ---------------------------------------------------------------------------
   MOCK PAPERS

   Four, because that is how many the bank fills without repeating a question
   (MOCK_CAPACITY works this out from the section sizes). Listing a fifth
   would not break anything — the builder wraps around rather than handing
   back a short paper — but the papers would stop being independent, and a
   learner who has "sat four different mocks" would silently have sat some
   questions twice.
   --------------------------------------------------------------------------- */
const PAPER_BLURBS = [
  `Exam conditions — ${MOCK_LENGTH} questions, ${MOCK_MINUTES} minutes, ${PASS_QUESTIONS} to pass.`,
  `A different ${MOCK_LENGTH} questions. No overlap with Mock Test 1.`,
  `A third paper, sharing none of its questions with the first two.`,
  `The last full paper the bank supports — ${MOCK_LENGTH} fresh questions.`,
];

export const MOCKS = Array.from({ length: Math.max(1, MOCK_CAPACITY) }, (_, i) => ({
  id: i === 0 ? "dtt.mock" : `dtt.mock.${i + 1}`,
  paper: i + 1,
  label: `Mock Test ${i + 1}`,
  blurb: PAPER_BLURBS[i] || `${MOCK_LENGTH} questions under exam conditions.`,
  questionCount: MOCK_LENGTH,
  minutes: MOCK_MINUTES,
}));

export const MOCK_BY_ID = Object.fromEntries(MOCKS.map(m => [m.id, m]));

/* Kept so anything still importing a single MOCK keeps working. */
export const MOCK = MOCKS[0];

/* ---------------------------------------------------------------------------
   GRADING A MOCK

   One number against one bar: 35 of 40.

   The per-section rows this returns are INFORMATION, not assessment. They
   tell a learner where the six marks they dropped actually went, which is
   what makes the result useful for revision. Every row carries
   `passMark: null` so no screen draws a pass line on it — there is no such
   thing as failing a section in this test, and a red bar saying otherwise
   would be a lie told in a very convincing format.

   `log` is the per-question record the quiz builds: { sectionId, isRight }.
   In a timed mock the caller passes the full paper, so anything left blank
   counts against the candidate as it would in the real test.
   --------------------------------------------------------------------------- */
export function gradeMock(log, { totalQuestions } = {}) {
  const total = totalQuestions || MOCK_LENGTH;
  const score = log.filter(item => item.isRight).length;
  const pct = total ? Math.round((score / total) * 100) : 0;

  /* The boundary in whole questions, scaled if a shorter paper is ever sat.
     For the standard 40-question paper this is exactly PASS_QUESTIONS. */
  const needed = total === MOCK_LENGTH
    ? PASS_QUESTIONS
    : Math.ceil((PASS_QUESTIONS / MOCK_LENGTH) * total);

  const rows = ADI_SECTIONS.map(section => {
    const mine = log.filter(item => item.sectionId === section.id);
    const correct = mine.filter(item => item.isRight).length;
    const t = mine.length || MOCK_WEIGHTS[section.id] || 0;

    return {
      id: section.id,
      label: section.short || section.label,
      examLabel: section.examLabel || section.label,
      number: section.number,
      correct,
      total: t,
      pct: t ? Math.round((correct / t) * 100) : 0,
      passMark: null,          // deliberate — see the note above
      needed: null,
      passed: true,            // nothing here can fail on its own
      seen: mine.length,
    };
  }).filter(r => r.total > 0);

  return {
    rows,
    failing: [],               // no section can fail; the paper passes or not
    score,
    total,
    pct,
    needed,
    passed: score >= needed,
  };
}

/* The wording for a graded mock. Separate from verdictFor because it can talk
   in whole questions — "two short" is more useful to a learner than "85%". */
export function mockVerdict(grade) {
  if (grade.passed) {
    return {
      status: "pass",
      title: grade.score === grade.total ? "Full marks" : "Passed",
      message: `${grade.score} of ${grade.total}. The real test needs ${grade.needed}. `
        + `Sit another paper before your test date to be sure it wasn't a good day.`,
    };
  }

  const short = grade.needed - grade.score;

  if (short <= 3) {
    return {
      status: "close",
      title: short === 1 ? "One question short" : `${short} questions short`,
      message: `${grade.score} of ${grade.total}, and you needed ${grade.needed}. `
        + `That is close enough that it could go either way on the day — which is `
        + `not a position to book the test from. The breakdown below shows where the marks went.`,
    };
  }

  return {
    status: "practice",
    title: "Keep practising",
    message: `${grade.score} of ${grade.total}. The pass mark is ${grade.needed}, so there are `
      + `${short} marks to find. The breakdown below shows which topics they are in.`,
  };
}

/* ---------------------------------------------------------------------------
   FLASHCARDS

   Study material, not assessment. Below the sections on the home screen:
   useful for learning, but working through them is not the same as being
   ready for the test.
   --------------------------------------------------------------------------- */
export const DECKS = [
  {
    id: "deck.rules",
    label: "Rules of the Road",
    blurb: "153 quick-recall cards across 20 topics.",
    count: 153,
  },
  {
    id: "deck.signs",
    label: "Road Signs",
    blurb: "Every official sign, by category.",
    count: 240,
  },
];

export const DECK_BY_ID = Object.fromEntries(DECKS.map(d => [d.id, d]));

/* ---------------------------------------------------------------------------
   GUEST ACCESS

   Someone studying without an account gets Section 1 in full, plus the
   flashcards. The other sections and the mock papers ask them to create an
   account first.

   A whole section rather than a taster of each: it is enough to judge whether
   the app is any good, which is the point of letting anyone in without
   signing up.
   --------------------------------------------------------------------------- */
export const GUEST_SECTION_ID = "dtt.sec.rules";

export function lockedForGuest(id, isGuest) {
  if (!isGuest) return false;
  if (id === GUEST_SECTION_ID) return false;
  if (id?.startsWith("deck.")) return false;   // flashcards stay open
  return true;                                  // every mock paper included
}

/* ---------------------------------------------------------------------------
   Pass / fail wording for practising one section. Never the word "failed" —
   a practice run is not the test.
   --------------------------------------------------------------------------- */
export function verdictFor(pct, passMark = PASS_MARK) {
  if (pct >= passMark) {
    return {
      status: "pass",
      title: pct >= 95 ? "Excellent!" : "Passed",
      message: "You're at test standard on this topic. Keep it warm with a retry closer to your test date.",
    };
  }
  if (pct >= passMark - 15) {
    return {
      status: "close",
      title: "Almost there",
      message: `You're close — the real test wants ${passMark}%, which is ${PASS_QUESTIONS} of ${MOCK_LENGTH}. Review what you missed and go again.`,
    };
  }
  return {
    status: "practice",
    title: "Keep practising",
    message: "Work back through this topic, then come to the questions again.",
  };
}
