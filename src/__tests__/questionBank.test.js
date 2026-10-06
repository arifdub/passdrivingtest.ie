/*
  ===========================================================================
  QUESTION BANK INTEGRITY

  The question bank is the product. It is also hand-edited, which is how it
  ended up shipping questions whose wrong answers belonged to a completely
  different question — "At a T-junction, who has right of way?" offering an
  option about disabled parking permits.

  These tests are the guard rail that mistake earned. They do not check that
  an answer is factually correct — no test can — but they catch every
  structural way the bank can be broken by an edit:

    · an option list that isn't four options
    · a `correct` index pointing at nothing
    · the same option twice in one question (one of them unselectable)
    · two questions with identical text
    · an empty question or option
    · a sign image referenced that isn't in public/signs

  Run with `npm test`.
  ===========================================================================
*/

import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

import RULES_CATEGORIES_QUIZ from "../rulesQuestions.js";
import { ROAD_SIGNS } from "../roadSignsData.js";

const allQuestions = RULES_CATEGORIES_QUIZ.flatMap(cat =>
  cat.questions.map((q, i) => ({ ...q, categoryId: cat.id, index: i }))
);

/* Names the question in a failure message, rather than just "expected 3 to
   be 4" with no clue which of 153 it was. */
const where = (q) => `[${q.categoryId} #${q.index}] ${q.q}`;

describe("question bank structure", () => {
  it("has questions in every category", () => {
    expect(RULES_CATEGORIES_QUIZ.length).toBeGreaterThan(0);
    for (const cat of RULES_CATEGORIES_QUIZ) {
      expect(cat.questions.length, `category ${cat.id} is empty`).toBeGreaterThan(0);
    }
  });

  it("gives every question exactly four options", () => {
    for (const q of allQuestions) {
      expect(q.options.length, where(q)).toBe(4);
    }
  });

  it("points `correct` at a real option", () => {
    for (const q of allQuestions) {
      expect(Number.isInteger(q.correct), where(q)).toBe(true);
      expect(q.correct, where(q)).toBeGreaterThanOrEqual(0);
      expect(q.correct, where(q)).toBeLessThan(q.options.length);
    }
  });

  it("never repeats an option within a question", () => {
    /* A duplicated option is worse than untidy: one of the two is
       unselectable as the right answer, so the question can be answered
       correctly and still marked wrong. */
    for (const q of allQuestions) {
      const unique = new Set(q.options);
      expect(unique.size, `${where(q)} — duplicate option`).toBe(q.options.length);
    }
  });

  it("has no blank question or option text", () => {
    for (const q of allQuestions) {
      expect(q.q.trim().length, where(q)).toBeGreaterThan(0);
      for (const opt of q.options) {
        expect(opt.trim().length, `${where(q)} — blank option`).toBeGreaterThan(0);
      }
    }
  });

  it("asks each question only once", () => {
    const seen = new Map();
    for (const q of allQuestions) {
      const key = q.q.trim().toLowerCase();
      expect(seen.has(key), `duplicate question: ${q.q} (also in ${seen.get(key)})`).toBe(false);
      seen.set(key, q.categoryId);
    }
  });
});

describe("road signs", () => {
  const signsDir = path.resolve(process.cwd(), "public/signs");

  it("has a deck to show", () => {
    expect(ROAD_SIGNS.length).toBeGreaterThan(0);
  });

  it("names every sign", () => {
    for (const sign of ROAD_SIGNS) {
      expect(typeof sign.name === "string" && sign.name.trim().length > 0,
        `sign ${sign.id} has no name`).toBe(true);
    }
  });

  it("points every sign at an image that exists", () => {
    /* The deck shipped once with all 240 images missing — every card a
       broken-image icon. The paths are data, so nothing failed loudly; this
       is what would have caught it. */
    const missing = ROAD_SIGNS
      .map(s => s.img)
      .filter(img => !fs.existsSync(path.join(signsDir, path.basename(img))));

    expect(missing, `missing sign images: ${missing.slice(0, 5).join(", ")}`).toEqual([]);
  });
});
