/*
  The earnings arithmetic. Two things here would be wrong in a way that
  looks right: counting a lesson that has not happened, and treating a
  lesson with no price as a lesson worth nothing.
*/

import { describe, it, expect } from "vitest";
import { tally, weekStart, monthStart } from "../instructor/Earnings";

const at = (d, h = 10) => new Date(2026, 9, d, h).toISOString();

const lessons = [
  { starts_at: at(5),  status: "completed", price_cents: 4500 },
  { starts_at: at(6),  status: "completed", price_cents: 4500 },
  { starts_at: at(7),  status: "completed", price_cents: null },
  { starts_at: at(8),  status: "scheduled", price_cents: 4500 },
  { starts_at: at(9),  status: "cancelled", price_cents: 4500 },
  { starts_at: at(10), status: "no_show",   price_cents: 4500 },
];

describe("tally", () => {
  it("counts only what was actually taught", () => {
    const t = tally(lessons);
    /* Scheduled, cancelled and no-show are all excluded. A week that
       includes three lessons that have not happened is a number that will
       be wrong by Friday — and the kind of wrong that gets planned around. */
    expect(t.cents).toBe(9000);
    expect(t.counted).toBe(2);
  });

  it("keeps a priced lesson and an unpriced one apart", () => {
    const t = tally(lessons);
    /* Blank means "not recorded", not "free". Folding it in as zero would
       understate the week and look like an arithmetic bug. */
    expect(t.unpriced).toBe(1);
    expect(t.lessons).toBe(3);
    expect(t.cents).toBe(9000);
  });

  it("respects the window, excluding the upper bound", () => {
    const from = new Date(2026, 9, 6);
    const to = new Date(2026, 9, 7);
    const t = tally(lessons, { from, to });
    expect(t.counted).toBe(1);
    expect(t.cents).toBe(4500);
  });

  it("has nothing to add up when nothing was taught", () => {
    const t = tally([{ starts_at: at(5), status: "scheduled", price_cents: 4500 }]);
    expect(t).toEqual({ cents: 0, counted: 0, unpriced: 0, lessons: 0 });
  });

  it("counts a free lesson as a lesson worth nothing, which it is", () => {
    /* Zero is an answer; blank is the absence of one. They must not be the
       same, in either direction. */
    const t = tally([{ starts_at: at(5), status: "completed", price_cents: 0 }]);
    expect(t.counted).toBe(1);
    expect(t.unpriced).toBe(0);
    expect(t.cents).toBe(0);
  });
});

describe("the windows", () => {
  it("starts a week on Monday", () => {
    /* 2026-10-08 is a Thursday; its week starts on the 5th. */
    expect(weekStart(new Date(2026, 9, 8)).getDate()).toBe(5);
    /* A Sunday belongs to the week that began the previous Monday, not to
       the one starting tomorrow. */
    expect(weekStart(new Date(2026, 9, 11)).getDate()).toBe(5);
    expect(weekStart(new Date(2026, 9, 12)).getDate()).toBe(12);
  });

  it("starts a month at midnight on the first", () => {
    const m = monthStart(new Date(2026, 9, 22, 15, 30));
    expect(m.getDate()).toBe(1);
    expect(m.getMonth()).toBe(9);
    expect(m.getHours()).toBe(0);
  });
});
