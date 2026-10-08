/*
  Dates and money, which are the two things a lesson is made of and the two
  things easiest to get subtly wrong.

  The date pair matters most: a lesson is entered as "Tuesday at ten" and
  stored as an instant. If those two conversions do not round-trip, a lesson
  is an hour out for half the year and nobody notices until October.
*/
import { describe, it, expect } from "vitest";
import {
  toInstant, toFields, dayKey, dayLabel, timeLabel, endLabel, euro, EDT_TOTAL,
} from "../instructor/teachingStore";

describe("entering a time", () => {
  it("reads a date and a time as local, which is what was meant", () => {
    const d = toInstant("2026-10-14", "10:00");
    expect(d.getFullYear()).toBe(2026);
    expect(d.getMonth()).toBe(9);       // October
    expect(d.getDate()).toBe(14);
    expect(d.getHours()).toBe(10);
    expect(d.getMinutes()).toBe(0);
  });

  it("round-trips back to the same fields", () => {
    for (const [date, time] of [
      ["2026-10-14", "10:00"],
      ["2026-01-02", "07:05"],
      ["2026-12-31", "23:45"],
      /* Across the Irish clock change, which is the one that bites. */
      ["2026-03-29", "01:30"],
      ["2026-10-25", "01:30"],
    ]) {
      const back = toFields(toInstant(date, time).toISOString());
      expect(`${back.date} ${back.time}`).toBe(`${date} ${time}`);
    }
  });

  it("refuses nonsense rather than inventing a date", () => {
    expect(toInstant("", "10:00")).toBeNull();
    expect(toInstant("2026-10-14", "")).toBeNull();
    expect(toInstant("not-a-date", "10:00")).toBeNull();
  });
});

describe("grouping a week", () => {
  it("keys a lesson to its local day, not UTC's", () => {
    /* 00:30 local on the 15th is still the 15th, whatever UTC calls it. */
    const d = toInstant("2026-10-15", "00:30");
    expect(dayKey(d.toISOString())).toBe("2026-10-15");
  });

  it("names today, tomorrow and yesterday", () => {
    const shift = n => {
      const d = new Date(); d.setDate(d.getDate() + n);
      const p = x => String(x).padStart(2, "0");
      return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
    };
    expect(dayLabel(shift(0))).toBe("Today");
    expect(dayLabel(shift(1))).toBe("Tomorrow");
    expect(dayLabel(shift(-1))).toBe("Yesterday");
    expect(dayLabel(shift(5))).not.toMatch(/Today|Tomorrow|Yesterday/);
  });
});

describe("how long a lesson runs", () => {
  it("shows the start and the end", () => {
    const iso = toInstant("2026-10-14", "10:00").toISOString();
    expect(timeLabel(iso)).toBe("10:00");
    expect(endLabel(iso, 90)).toBe("11:30");
  });

  it("treats a missing length as an hour", () => {
    const iso = toInstant("2026-10-14", "10:00").toISOString();
    expect(endLabel(iso, undefined)).toBe("11:00");
  });

  it("carries past midnight without wrapping the clock wrong", () => {
    const iso = toInstant("2026-10-14", "23:30").toISOString();
    expect(endLabel(iso, 60)).toBe("00:30");
  });
});

describe("money", () => {
  it("is euro from the cents it is stored as", () => {
    expect(euro(5500)).toBe("€55.00");
    expect(euro(0)).toBe("€0.00");
  });

  it("tells a free lesson apart from an unpriced one", () => {
    expect(euro(0)).toBe("€0.00");
    expect(euro(null)).toBeNull();
    expect(euro("")).toBeNull();
  });
});

describe("EDT", () => {
  it("is twelve lessons, which is the whole syllabus", () => {
    expect(EDT_TOTAL).toBe(12);
  });
});
