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
    const slots = openSlots({ date: TUE, hours: split, rules: bare, now: TUE_MORNING })
      .map(s => s.time);
    expect(slots).toEqual(["09:00", "09:30", "10:00", "14:00", "14:30", "15:00"]);
  });

  it("uses the instructor's own lesson length", () => {
    const slots = openSlots({
      date: TUE, hours: [{ weekday: 2, starts_at: "09:00", ends_at: "11:00" }],
      now: TUE_MORNING,
      rules: { ...DEFAULT_RULES, min_notice_hours: 0, travel_buffer_minutes: 0, lesson_minutes: 90 },
    }).map(s => s.time);
    expect(slots).toEqual(["09:00", "09:30"]);
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
