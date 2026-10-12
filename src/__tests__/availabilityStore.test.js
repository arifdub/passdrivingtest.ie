/*
  The slot calculation is the first thing on this platform that will tell a
  stranger "yes, 11:00 is free". Everything it gets wrong shows up as an
  instructor double-booked at a kerb, so it is pinned here rather than
  trusted to read correctly.
*/

import { describe, it, expect } from "vitest";
import {
  toMinutes, fromMinutes, trimTime, blockHours, weeklyHours, overlaps,
  dateKey, isDayOff, openSlots, DEFAULT_RULES, TYPICAL_WEEK, WEEK_ORDER,
  hourGridRange, blocksToHourSet, hourSetToBlocks, nextDateFor, hoursForDate,
} from "../instructor/availabilityStore";

/* 2026-10-13 is a Tuesday. getDay() === 2. */
const TUE = new Date(2026, 9, 13);
const TUE_MORNING = new Date(2026, 9, 13, 7, 0);

const nineToFive = [{ weekday: 2, starts_at: "09:00", ends_at: "17:00" }];

/* No notice and no buffer, so a test about one rule is not quietly also a
   test about the other two. */
const bare = { ...DEFAULT_RULES, min_notice_hours: 0, travel_buffer_minutes: 0 };

describe("times", () => {
  it("reads both the form's 09:00 and Postgres's 09:00:00", () => {
    expect(toMinutes("09:00")).toBe(540);
    expect(toMinutes("09:00:00")).toBe(540);
    expect(trimTime("09:30:00")).toBe("09:30");
  });

  it("refuses a time that is not one", () => {
    expect(toMinutes("25:00")).toBeNull();
    expect(toMinutes("09:70")).toBeNull();
    expect(toMinutes("")).toBeNull();
    expect(toMinutes(undefined)).toBeNull();
  });

  it("round-trips", () => {
    expect(fromMinutes(toMinutes("14:45"))).toBe("14:45");
  });

  it("adds a week up, counting a lunch break as the gap it is", () => {
    const split = [
      { starts_at: "09:00", ends_at: "13:00" },
      { starts_at: "14:00", ends_at: "17:00" },
    ];
    expect(weeklyHours(split)).toBe(7);
    expect(blockHours({ starts_at: "09:00", ends_at: "09:00" })).toBe(0);
  });

  it("sees an overlap but not a touch", () => {
    const a = { starts_at: "09:00", ends_at: "12:00" };
    expect(overlaps(a, { starts_at: "11:00", ends_at: "13:00" })).toBe(true);
    /* Back-to-back blocks are fine: 12:00 is the end of one and the start
       of the next, and an instructor who splits a day that way means it. */
    expect(overlaps(a, { starts_at: "12:00", ends_at: "14:00" })).toBe(false);
  });
});

describe("time off", () => {
  it("is inclusive at both ends", () => {
    const off = [{ starts_on: "2026-10-12", ends_on: "2026-10-14" }];
    expect(isDayOff("2026-10-12", off)).toBe(true);
    expect(isDayOff("2026-10-14", off)).toBe(true);
    expect(isDayOff("2026-10-15", off)).toBe(false);
  });

  it("empties the day", () => {
    const slots = openSlots({
      date: TUE, hours: nineToFive, rules: bare, now: TUE_MORNING,
      timeOff: [{ starts_on: "2026-10-13", ends_on: "2026-10-13" }],
    });
    expect(slots).toEqual([]);
  });
});

describe("open slots", () => {
  it("fills the block and stops when the lesson no longer fits", () => {
    const slots = openSlots({ date: TUE, hours: nineToFive, rules: bare, now: TUE_MORNING });
    expect(slots[0].time).toBe("09:00");
    /* 16:00 is the last hour that ends by 17:00. 16:30 would run over. */
    expect(slots[slots.length - 1].time).toBe("16:00");
    expect(slots.some(s => s.time === "16:30")).toBe(false);
  });

  it("steps by the lesson length, not by a fixed half hour", () => {
    /* The bug this guards: an instructor picks hours one at a time — 9 to
       10, 10 to 11 — on a 60-minute lesson, and a learner was offered 09:30
       as well, a start time that runs into the next hour the instructor
       never agreed to as a block. One candidate per hour is the whole of
       what "9 to 5, hour lessons" means. */
    const slots = openSlots({ date: TUE, hours: nineToFive, rules: bare, now: TUE_MORNING })
      .map(s => s.time);
    expect(slots).toEqual([
      "09:00", "10:00", "11:00", "12:00", "13:00", "14:00", "15:00", "16:00",
    ]);
  });

  it("offers nothing on a day the instructor does not work", () => {
    const wed = new Date(2026, 9, 14);
    expect(openSlots({ date: wed, hours: nineToFive, rules: bare, now: TUE_MORNING })).toEqual([]);
  });

  it("keeps the buffer clear on both sides of a booked lesson", () => {
    const lessons = [{
      starts_at: new Date(2026, 9, 13, 11, 0).toISOString(),
      duration_minutes: 60, status: "scheduled",
    }];
    const slots = openSlots({
      date: TUE, hours: nineToFive, lessons, now: TUE_MORNING,
      rules: { ...DEFAULT_RULES, min_notice_hours: 0, travel_buffer_minutes: 15 },
    }).map(s => s.time);

    expect(slots).not.toContain("11:00");
    /* 10:30–11:30 would run into the 10:45 buffer before an 11:00 lesson. */
    expect(slots).not.toContain("10:30");
    /* 12:00 starts at the buffer's edge after a lesson ending at 12:00 —
       12:15 is the first that clears it. */
    expect(slots).not.toContain("12:00");
    expect(slots).toContain("09:00");
  });

  it("frees the slot again when the lesson is cancelled", () => {
    const at = new Date(2026, 9, 13, 11, 0).toISOString();
    const booked = openSlots({
      date: TUE, hours: nineToFive, rules: bare, now: TUE_MORNING,
      lessons: [{ starts_at: at, duration_minutes: 60, status: "scheduled" }],
    }).map(s => s.time);
    const freed = openSlots({
      date: TUE, hours: nineToFive, rules: bare, now: TUE_MORNING,
      lessons: [{ starts_at: at, duration_minutes: 60, status: "cancelled" }],
    }).map(s => s.time);

    expect(booked).not.toContain("11:00");
    expect(freed).toContain("11:00");
  });

  it("honours the notice period", () => {
    const slots = openSlots({
      date: TUE, hours: nineToFive, now: TUE_MORNING,
      rules: { ...DEFAULT_RULES, min_notice_hours: 4, travel_buffer_minutes: 0 },
    }).map(s => s.time);

    /* 07:00 plus four hours' notice means nothing before 11:00. */
    expect(slots).not.toContain("10:30");
    expect(slots[0]).toBe("11:00");
  });

  it("will not reach past the booking horizon", () => {
    const farOff = new Date(2026, 11, 15);            // a Tuesday, two months out
    const slots = openSlots({
      date: farOff, hours: nineToFive, now: TUE_MORNING,
      rules: { ...DEFAULT_RULES, min_notice_hours: 0, max_days_ahead: 30 },
    });
    expect(slots).toEqual([]);
  });

  it("works a split day as two blocks with the gap kept", () => {
    const split = [
      { weekday: 2, starts_at: "09:00", ends_at: "11:00" },
      { weekday: 2, starts_at: "14:00", ends_at: "16:00" },
    ];
    /* `bare` carries the default 60-minute lesson, and the step now follows
       it: one candidate an hour, not a 30-minute offer that would start a
       lesson at 09:30 and run past the hour someone actually picked. */
    const slots = openSlots({ date: TUE, hours: split, rules: bare, now: TUE_MORNING })
      .map(s => s.time);
    expect(slots).toEqual(["09:00", "10:00", "14:00", "15:00"]);
  });

  it("uses the instructor's own lesson length", () => {
    const slots = openSlots({
      date: TUE, hours: [{ weekday: 2, starts_at: "09:00", ends_at: "11:00" }],
      now: TUE_MORNING,
      rules: { ...DEFAULT_RULES, min_notice_hours: 0, travel_buffer_minutes: 0, lesson_minutes: 90 },
    }).map(s => s.time);
    /* A 90-minute lesson in a two-hour block has room for exactly one —
       09:00 to 10:30, with only half an hour left over, nowhere near
       another 90 minutes. */
    expect(slots).toEqual(["09:00"]);
  });

  it("can still be asked for 30-minute offers explicitly, overriding the lesson length", () => {
    const slots = openSlots({
      date: TUE, hours: nineToFive, rules: bare, now: TUE_MORNING, step: 30,
    }).map(s => s.time);
    expect(slots).toContain("09:30");
  });
});

describe("the hourly picker", () => {
  it("marks an hour on only when a block covers it completely", () => {
    const nineToFive = [{ starts_at: "09:00", ends_at: "17:00" }];
    const on = blocksToHourSet(nineToFive, 6, 22);
    expect(on.has(9)).toBe(true);
    expect(on.has(16)).toBe(true);     // the 16:00–17:00 tile
    expect(on.has(17)).toBe(false);    // nothing covers 17:00–18:00
    expect(on.has(8)).toBe(false);
  });

  it("leaves an hour off when a block only partly covers it", () => {
    /* A block built with the old from/to sheet can start mid-hour. Rounding
       that hour "on" here would let a save silently stretch the block to a
       full hour nobody asked to work. */
    const half = [{ starts_at: "09:30", ends_at: "17:00" }];
    expect(blocksToHourSet(half, 6, 22).has(9)).toBe(false);
    expect(blocksToHourSet(half, 6, 22).has(10)).toBe(true);
  });

  it("the default grid spans 06:00–22:00", () => {
    expect(hourGridRange([])).toEqual({ start: 6, end: 22 });
  });

  it("stretches the grid to fit a block outside the default range", () => {
    expect(hourGridRange([{ starts_at: "05:00", ends_at: "23:00" }]))
      .toEqual({ start: 5, end: 23 });
  });

  it("merges contiguous on-hours into one block", () => {
    const blocks = hourSetToBlocks(new Set([9, 10, 11, 12]));
    expect(blocks).toEqual([{ starts_at: "09:00", ends_at: "13:00" }]);
  });

  it("keeps a gap in the middle of the day as two blocks — the 3–4pm case", () => {
    /* 9 to 5 with 15:00–16:00 switched off. */
    const hours = [9, 10, 11, 12, 13, 14, 16].reduce((s, h) => s.add(h), new Set());
    expect(hourSetToBlocks(hours)).toEqual([
      { starts_at: "09:00", ends_at: "15:00" },
      { starts_at: "16:00", ends_at: "17:00" },
    ]);
  });

  it("says not working when nothing is on", () => {
    expect(hourSetToBlocks(new Set())).toEqual([]);
  });

  it("round-trips a split day through the grid and back", () => {
    const split = [
      { starts_at: "09:00", ends_at: "13:00" },
      { starts_at: "14:00", ends_at: "17:00" },
    ];
    const on = blocksToHourSet(split, 6, 22);
    expect(hourSetToBlocks(on)).toEqual(split);
  });
});

describe("hours for one date only", () => {
  /* 2026-10-15 and 2026-10-22 are both Thursdays (getDay() === 4). */
  const THU_15 = new Date(2026, 9, 15);
  const THU_22 = new Date(2026, 9, 22);
  const weekly = [{ weekday: 4, starts_at: "09:00", ends_at: "17:00" }];
  const oneDate = [{ on_date: "2026-10-15", starts_at: "10:00", ends_at: "12:00" }];

  it("replaces the weekday's usual hours on that date", () => {
    expect(hoursForDate(THU_15, weekly, oneDate)).toEqual(oneDate);
  });

  it("leaves the same weekday the following week alone", () => {
    /* The reported bug: opening Thursday 15 Oct also opened 22 Oct. */
    expect(hoursForDate(THU_22, weekly, oneDate)).toEqual(weekly);
  });

  it("opens a date whose weekday has no usual hours at all", () => {
    expect(hoursForDate(THU_15, [], oneDate)).toEqual(oneDate);
    expect(hoursForDate(THU_22, [], oneDate)).toEqual([]);
  });

  it("is what the slot list uses", () => {
    const at = d => openSlots({
      date: d, hours: weekly, dateHours: oneDate, rules: bare, now: new Date(2026, 9, 14, 7),
    }).map(s => s.time);
    expect(at(THU_15)).toEqual(["10:00", "11:00"]);
    expect(at(THU_22)[0]).toBe("09:00");
  });
});

describe("which date a weekday row means", () => {
  /* 2026-10-13 is a Tuesday (getDay() === 2), matching the TUE constant used
     for the slot-maths tests above. */
  const TUE = new Date(2026, 9, 13);

  it("is today when today itself is a match", () => {
    expect(dateKey(nextDateFor(2, TUE))).toBe("2026-10-13");
  });

  it("is the next occurrence, not last week's", () => {
    /* Monday is behind Tuesday in the week, so this has to roll forward
       almost a full week rather than landing on the Monday just gone. */
    expect(dateKey(nextDateFor(1, TUE))).toBe("2026-10-19");
  });

  it("is tomorrow when tomorrow is a match", () => {
    expect(dateKey(nextDateFor(3, TUE))).toBe("2026-10-14");
  });

  it("never looks more than six days out", () => {
    const monday = nextDateFor(1, TUE);
    const diffDays = Math.round((monday - TUE) / 86400000);
    expect(diffDays).toBeLessThanOrEqual(6);
    expect(diffDays).toBeGreaterThanOrEqual(0);
  });
});

describe("the offered defaults", () => {
  it("is a Monday-to-Friday nine to five", () => {
    expect(TYPICAL_WEEK).toHaveLength(5);
    expect(weeklyHours(TYPICAL_WEEK)).toBe(40);
    expect(TYPICAL_WEEK.some(b => b.weekday === 0 || b.weekday === 6)).toBe(false);
  });

  it("displays the week Monday-first while numbering it Sunday-first", () => {
    expect(WEEK_ORDER[0]).toBe(1);
    expect(WEEK_ORDER[6]).toBe(0);
    expect([...WEEK_ORDER].sort()).toEqual([0, 1, 2, 3, 4, 5, 6]);
  });
});
