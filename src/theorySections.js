/*
  ===========================================================================
  THE DRIVER THEORY TEST SECTIONS

  The Irish Driver Theory Test for cars (category B) is 40 multiple-choice
  questions in 45 minutes, and you need 35 of them right to pass.

  That is ONE pass mark for the whole paper. It is the single biggest
  structural difference from the ADI Stage 1 exam, which grades five sections
  separately against five different marks. Do not carry that model over here:
  there are no per-section pass marks in this test, and inventing some would
  tell a learner they had failed a section that does not exist.

  Sources for the format:
    · https://www.citizensinformation.ie/en/travel-and-recreation/motoring/
      driving-tests/driver-theory-test/   — 40 questions, 45 minutes, 35 to
      pass, EUR 45, certificate valid 2 years
    · https://theorytest.ie/general-information/faqs/   — same figures, and
      confirms questions are drawn at random from a bank per test section

  The sections below are how THIS app organises study. The RSA describes the
  syllabus in terms of the rules of the road, risk perception, eco-driving,
  hazard awareness and good driving behaviour; it does not publish a
  question-count breakdown per topic. So these six sections are a teaching
  structure, not a claim about the real paper's internal composition, and the
  app says so rather than implying otherwise.

  QUESTION IDs
  Every question gets a `qid` hashed from its own text, so it keeps a stable
  identity when a bank is reordered or extended. Progress is stored against
  these ids, which is why they must not be derived from position.
  ===========================================================================
*/

import RULES_QUESTIONS from "./rulesQuestions";
import { ROAD_SIGNS, ROAD_SIGN_CAT } from "./roadSignsData";

/* Small, fast, stable string hash (FNV-1a). Not cryptographic — it only has
   to be consistent and collision-free enough across a few thousand strings. */
function hashId(text) {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

/* ---------------------------------------------------------------------------
   ROAD SIGN QUESTIONS

   Built from the sign deck rather than written out, so the 240 official signs
   become practice questions without 240 hand-written stems. Distractors are
   chosen by walking the other sign names at a fixed stride, which always
   terminates and always gives the same options for the same sign.
   --------------------------------------------------------------------------- */
/* Two sign names are "too close" when one is the other plus a qualifier, or
   when one's words are a subset of the other's. Offering both in one question
   asks the learner to pick between two nearly identical strings from a small
   image — that tests reading, not sign recognition.

   Where such a distinction genuinely matters — single versus double yellow
   line does — it belongs in a written question with an explanation, not in a
   generated four-way guess. */
const normName = s => s.toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();

function tooSimilar(a, b) {
  const x = normName(a), y = normName(b);
  if (x === y) return true;
  if (x.startsWith(y + " ") || y.startsWith(x + " ")) return true;
  const wx = new Set(x.split(" ")), wy = new Set(y.split(" "));
  const shared = [...wx].filter(w => wy.has(w)).length;
  return shared === Math.min(wx.size, wy.size);   // one is a subset of the other
}

function buildSignQuestions() {
  const byCategory = {};
  for (const sign of ROAD_SIGNS) {
    (byCategory[sign.c] = byCategory[sign.c] || []).push(sign);
  }
  const allNames = [...new Set(ROAD_SIGNS.map(s => s.name))];

  const out = [];
  for (const [catId, signs] of Object.entries(byCategory)) {
    const names = [...new Set(signs.map(s => s.name))];

    for (const sign of signs) {
      /* Same-category distractors are what make these questions hard — a
         warning sign's alternatives should be other warning signs. */
      let others = names.filter(n => n !== sign.name && !tooSimilar(n, sign.name));

      /* A small category can run out once the near-duplicates are removed.
         Top up from the whole set rather than lose the question. */
      if (others.length < 3) {
        const extra = allNames.filter(
          n => n !== sign.name && !others.includes(n) && !tooSimilar(n, sign.name)
        );
        others = others.concat(extra);
      }
      if (others.length < 3) continue;

      const start = (sign.id * 7) % others.length;
      let stride = (sign.id % (others.length - 1)) + 1;
      while (stride > 1 && others.length % stride === 0) stride--;

      const wrong = [
        others[start % others.length],
        others[(start + stride) % others.length],
        others[(start + stride * 2) % others.length],
      ];
      if (new Set(wrong).size !== 3) continue;

      const options = [...wrong, sign.name];
      const shift = sign.id % 4;
      const rotated = [...options.slice(shift), ...options.slice(0, shift)];

      out.push({
        q: "What does this sign mean?",
        image: sign.img,
        options: rotated,
        correct: rotated.indexOf(sign.name),
        explain: `${sign.name}. Category: ${ROAD_SIGN_CAT[catId]?.label || catId}.`,
      });
    }
  }
  return out;
}

const SIGN_QUESTIONS = buildSignQuestions();

const pick = (bank, id) => bank.find(c => c.id === id)?.questions || [];

/* ---------------------------------------------------------------------------
   THE PASS MARK  —  read this before changing a number

   35 out of 40. That is 87.5%, and it is published, unambiguous and the same
   for every candidate. There is nothing to estimate here, which is a pleasant
   change from the ADI app where no official figures exist at all.

   PASS_MARK below is expressed as a percentage because every screen in the
   app works in percentages. 87.5 rounds to 88, and the rounding lands
   correctly at the boundary: 35/40 is 87.5% which rounds to 88 and passes,
   34/40 is 85% and fails. PASS_QUESTIONS carries the real integer so nothing
   has to trust that arithmetic.

   The same 88% is applied when practising a single section. That is strict —
   a 34-question section wants 30 right — but it is the actual standard, and
   an app that passes you at 70% while the real test wants 87.5% is not
   preparing you for anything.
   --------------------------------------------------------------------------- */
export const PASS_MARK = 88;
export const PASS_QUESTIONS = 35;

const SECTION_DEFS = [
  {
    id: "dtt.sec.rules",
    number: 1,
    label: "Rules of the Road",
    short: "Rules",
    examLabel: "Rules of the Road",
    blurb: "Right of way, junctions, roundabouts, overtaking, parking and lane discipline.",
    accent: "emerald",
    sources: [...pick(RULES_QUESTIONS, "rules")],
  },
  {
    id: "dtt.sec.signs",
    number: 2,
    label: "Traffic Signs & Road Markings",
    short: "Signs",
    examLabel: "Traffic Signs & Road Markings",
    blurb: "Every official sign, plus road markings, traffic lights and Garda signals.",
    accent: "emerald",
    sources: [
      ...pick(RULES_QUESTIONS, "signs"),
      ...SIGN_QUESTIONS,
    ],
  },
  {
    id: "dtt.sec.speed",
    number: 3,
    label: "Speed, Braking & Vehicle Safety",
    short: "Speed & Safety",
    examLabel: "Speed, Braking & Vehicle Safety",
    blurb: "Speed limits, stopping distances, tyres, lights and roadworthiness.",
    accent: "emerald",
    sources: [...pick(RULES_QUESTIONS, "speed")],
  },
  {
    id: "dtt.sec.vulnerable",
    number: 4,
    label: "Vulnerable Road Users & Hazards",
    short: "Hazards",
    examLabel: "Vulnerable Road Users & Hazard Awareness",
    blurb: "Pedestrians, cyclists, motorcyclists, children, animals and reading hazards early.",
    accent: "emerald",
    sources: [...pick(RULES_QUESTIONS, "vulnerable")],
  },
  {
    id: "dtt.sec.documents",
    number: 5,
    label: "Licences, Documents & the Law",
    short: "Documents",
    examLabel: "Licences, Documents & the Law",
    blurb: "Learner permits, insurance, NCT, penalty points and what the law requires of you.",
    accent: "emerald",
    sources: [...pick(RULES_QUESTIONS, "documents")],
  },
  {
    id: "dtt.sec.responsible",
    number: 6,
    label: "Safe & Responsible Driving",
    short: "Responsible",
    examLabel: "Safe & Responsible Driving",
    blurb: "Alcohol and drugs, fatigue, distraction, eco-driving and driving in bad weather.",
    accent: "emerald",
    sources: [...pick(RULES_QUESTIONS, "responsible")],
  },
];

/* ---------------------------------------------------------------------------
   Build the sections: stamp ids, drop duplicates, drop anything malformed.

   Every section carries the same passMark, because the real test has one.
   It is still stored per section rather than read from the constant, so the
   screens can keep their existing shape and so a future test format with
   different marks needs no restructuring.
   --------------------------------------------------------------------------- */
export const THEORY_SECTIONS = SECTION_DEFS.map(def => {
  const seen = new Set();
  const questions = [];

  for (const q of def.sources) {
    if (!q || !q.q || !Array.isArray(q.options) || q.options.length !== 4) continue;
    if (q.correct == null || q.correct < 0 || q.correct > 3) continue;

    const qid = hashId(q.q + "|" + q.options.join("|"));
    if (seen.has(qid)) continue;          // same question from two banks
    seen.add(qid);

    questions.push({ ...q, qid, sectionId: def.id, sectionLabel: def.label });
  }

  const { sources, ...rest } = def;
  return { ...rest, passMark: PASS_MARK, questions, total: questions.length };
});

export const SECTION_BY_ID = Object.fromEntries(THEORY_SECTIONS.map(s => [s.id, s]));

export const ALL_QUESTIONS = THEORY_SECTIONS.flatMap(s => s.questions);

export const TOTAL_QUESTIONS = ALL_QUESTIONS.length;

/* Lets a paused session be rebuilt from stored question ids alone, rather
   than writing whole questions into browser storage. */
export const QUESTION_BY_QID = Object.fromEntries(ALL_QUESTIONS.map(q => [q.qid, q]));

/* ---------------------------------------------------------------------------
   MOCK TEST

   40 questions in 45 minutes, the shape of the real paper.

   The RSA does not publish how the 40 are split across topics, so this split
   is the app's own and is presented as such. Two things shaped it:

     · Signs get the largest share. They are the most heavily represented
       topic in the real test and the one candidates most often lose marks on,
       and the app holds 240 of them.

     · No section gets so few that practising it is pointless. Below about
       four questions a section stops telling you anything — one unlucky
       guess swings it by 25%.

   The numbers also decide how many independent papers the bank can fill:
   a paper needs `weight` unused questions from every section, so the thinnest
   section sets the ceiling. See MOCK_CAPACITY below.
   --------------------------------------------------------------------------- */
export const MOCK_LENGTH = 40;
export const MOCK_MINUTES = 45;

export const MOCK_WEIGHTS = {
  "dtt.sec.rules":       8,
  "dtt.sec.signs":      12,
  "dtt.sec.speed":       4,
  "dtt.sec.vulnerable":  6,
  "dtt.sec.documents":   6,
  "dtt.sec.responsible": 4,
};

function shuffle(arr, rand) {
  const out = [...arr];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/* ---------------------------------------------------------------------------
   NAMED MOCK PAPERS

   Each mock is a fixed set of 40 questions, not a fresh random draw. That is
   what makes it a paper you can sit, score, and come back to — two attempts
   at Mock 2 are comparable, because they are the same 40 questions.

   The papers do not share questions. Each section's pool is shuffled once
   with a fixed seed, then sliced. The seed is constant, so every learner on
   every device gets the same Mock 2, and it stays the same between sessions.

   Only the presentation order is random, reshuffled on each attempt so nobody
   learns the answers by position.
   --------------------------------------------------------------------------- */

/* Changing this reshuffles which questions land in which paper. Don't, once
   learners have scores against them — their Mock 2 would quietly become a
   different test while keeping the old score. */
const PARTITION_SEED = 20260918;

function seededRng(seed) {
  let s = seed >>> 0;
  return () => {
    // xorshift32 — small, fast, and stable across engines, which matters
    // because every device must compute the same partition.
    s ^= s << 13; s >>>= 0;
    s ^= s >> 17;
    s ^= s << 5;  s >>>= 0;
    return s / 4294967296;
  };
}

/* How many whole non-overlapping papers the bank can currently fill. */
export const MOCK_CAPACITY = (() => {
  let limit = Infinity;
  for (const s of THEORY_SECTIONS) {
    const w = MOCK_WEIGHTS[s.id] || 0;
    if (w > 0) limit = Math.min(limit, Math.floor(s.questions.length / w));
  }
  return Number.isFinite(limit) ? limit : 0;
})();

/* The fixed question set for one paper. `index` is zero-based. */
function questionsForPaper(index) {
  const picked = [];

  for (const section of THEORY_SECTIONS) {
    const want = MOCK_WEIGHTS[section.id] || 0;
    if (!want || !section.questions.length) continue;

    // Same shuffle every time, per section, so slices are stable.
    const pool = shuffle(section.questions, seededRng(PARTITION_SEED + hashId(section.id).length * 7919));
    const start = index * want;

    if (start + want <= pool.length) {
      picked.push(...pool.slice(start, start + want));
    } else {
      /* Past the bank's capacity. Rather than hand back a short paper, wrap
         around — this paper then shares some questions with an earlier one.
         Adding questions to the thin sections removes the overlap. */
      for (let i = 0; i < want; i++) picked.push(pool[(start + i) % pool.length]);
    }
  }

  return picked;
}

/* Public: the questions for a paper.

   Unlike the ADI paper, these are shuffled ACROSS sections rather than run
   section by section. The real theory test does not announce which topic a
   question belongs to — it mixes them, and part of what it tests is noticing
   what kind of question you are looking at. Grouping them would make the app
   easier than the exam.

   Sitting the same paper twice is therefore the same 40 questions in a
   different order, which is what makes two scores comparable. */
export function buildMockTest(paperNumber = 1, length = MOCK_LENGTH) {
  const index = Math.max(0, (Number(paperNumber) || 1) - 1);
  const out = shuffle(questionsForPaper(index), Math.random);

  // Guard against a section being emptied by an edit to the banks.
  if (out.length < length) {
    const used = new Set(out.map(q => q.qid));
    const spare = shuffle(ALL_QUESTIONS.filter(q => !used.has(q.qid)), Math.random);
    out.push(...spare.slice(0, length - out.length));
  }

  return out.slice(0, length);
}

/* How much of a paper overlaps with another — used by the checks, and worth
   keeping exported so a regression is easy to spot. */
export function paperOverlap(a, b) {
  const A = new Set(questionsForPaper(a - 1).map(q => q.qid));
  return questionsForPaper(b - 1).filter(q => A.has(q.qid)).length;
}

export default THEORY_SECTIONS;
