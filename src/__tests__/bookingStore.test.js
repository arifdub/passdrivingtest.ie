/*
  The booking layer's own logic is small on purpose — the rules live in
  Postgres. What is here is the part that decides what a person is told, and
  getting that wrong is how "someone else took that hour" turns into a
  constraint name on a screen.
*/

import { describe, it, expect } from "vitest";
import {
  describeBookingError, slotsByDay, slotTime, slotDay, isPast, BOOKING_STATUS,
} from "../bookingStore";

describe("what a refusal says", () => {
  it("passes the database's own sentence through untouched", () => {
    /* request_booking raises these deliberately, written to be read. Any
       rewording here would be a second copy of the rules, drifting. */
    const msg = "That is outside their working hours";
    expect(describeBookingError({ message: msg, code: "23514" })).toBe(msg);
  });

  it("turns the overlap constraint into what actually happened", () => {
    const byCode = describeBookingError({ code: "23P01", message: 'conflicting key value violates exclusion constraint "bookings_no_overlap"' });
    expect(byCode).toBe("Someone just took that time. Pick another.");
    /* PostgREST does not always hand back the code, so the constraint name
       is a second way in. */
    expect(describeBookingError({ message: 'violates exclusion constraint "bookings_no_overlap"' }))
      .toBe("Someone just took that time. Pick another.");
  });

  it("says the migration is missing rather than blaming the learner", () => {
    expect(describeBookingError({ code: "PGRST202", message: "Could not find the function" }))
      .toMatch(/sql\/12/);
    expect(describeBookingError({ code: "42883", message: "function does not exist" }))
      .toMatch(/sql\/12/);
  });

  it("recognises Safari's wording for a dead connection", () => {
    /* "Load failed" is what Safari says when a fetch never happened, and it
       has already cost this project an afternoon once. */
    expect(describeBookingError({ message: "Load failed" })).toMatch(/connection/i);
    expect(describeBookingError({ message: "Failed to fetch" })).toMatch(/connection/i);
  });

  it("has nothing to say about no error", () => {
    expect(describeBookingError(null)).toBeNull();
  });
});

describe("grouping slots", () => {
  it("keeps days in order and times within them", () => {
    const slots = [
      new Date(2026, 9, 13, 9, 0),
      new Date(2026, 9, 13, 10, 30),
      new Date(2026, 9, 15, 11, 0),
    ];
    const days = slotsByDay(slots);
    expect(days).toHaveLength(2);
    expect(days[0].slots).toHaveLength(2);
    expect(slotTime(days[0].slots[0])).toBe("09:00");
    expect(slotTime(days[0].slots[1])).toBe("10:30");
    expect(days[1].slots).toHaveLength(1);
  });

  it("groups by local day, not by UTC", () => {
    /* 23:30 local is the next day in UTC for half the year. Grouping on the
       ISO string would scatter a Tuesday evening across two headings. */
    const late = new Date(2026, 9, 13, 23, 30);
    const earlier = new Date(2026, 9, 13, 9, 0);
    expect(slotsByDay([earlier, late])).toHaveLength(1);
  });

  it("has nothing to group when there are no slots", () => {
    expect(slotsByDay([])).toEqual([]);
  });
});

describe("naming a day", () => {
  it("says Today and Tomorrow before it says a date", () => {
    const today = new Date(); today.setHours(14, 0, 0, 0);
    const tomorrow = new Date(today); tomorrow.setDate(tomorrow.getDate() + 1);
    const later = new Date(today); later.setDate(later.getDate() + 5);

    expect(slotDay(today)).toBe("Today");
    expect(slotDay(tomorrow)).toBe("Tomorrow");
    expect(slotDay(later)).not.toMatch(/Today|Tomorrow/);
  });
});

describe("when a booking is done with", () => {
  it("counts from the end of the lesson, not the start", () => {
    const now = Date.now();
    /* Started half an hour ago, runs an hour: still happening. */
    const running = { starts_at: new Date(now - 30 * 60000).toISOString(), duration_minutes: 60 };
    expect(isPast(running)).toBe(false);

    const over = { starts_at: new Date(now - 90 * 60000).toISOString(), duration_minutes: 60 };
    expect(isPast(over)).toBe(true);
  });

  it("assumes an hour when no length was stored", () => {
    const now = Date.now();
    expect(isPast({ starts_at: new Date(now - 30 * 60000).toISOString() })).toBe(false);
    expect(isPast({ starts_at: new Date(now - 120 * 60000).toISOString() })).toBe(true);
  });

  it("has not happened yet when it is in the future", () => {
    expect(isPast({ starts_at: new Date(Date.now() + 86400000).toISOString() })).toBe(false);
  });
});

describe("the words shown for a status", () => {
  it("calls a requested booking 'Waiting', not 'Pending'", () => {
    /* The learner is told the hour is held but not confirmed. "Waiting" says
       that; "Pending" reads like it is nearly done. */
    expect(BOOKING_STATUS.requested.label).toBe("Waiting");
    expect(BOOKING_STATUS.accepted.label).toBe("Confirmed");
  });

  it("has a word for every status the database allows", () => {
    /* The check constraint in sql/12. A status with no entry here renders as
       a raw column value on someone's screen. */
    for (const s of ["requested", "accepted", "declined", "cancelled", "expired"]) {
      expect(BOOKING_STATUS[s]?.label).toBeTruthy();
    }
  });
});

describe("ends_at, now that the database stores it", () => {
  it("is trusted over the start plus a duration", () => {
    /* The two should agree, and the stored one is what the exclusion
       constraint indexed — so if they ever disagree, the column is right
       and the arithmetic is wrong. */
    const now = Date.now();
    const b = {
      starts_at: new Date(now - 3 * 3600000).toISOString(),
      duration_minutes: 60,
      ends_at: new Date(now + 3600000).toISOString(),
    };
    expect(isPast(b)).toBe(false);
  });

  it("still works for a row that predates the column", () => {
    const b = { starts_at: new Date(Date.now() - 120 * 60000).toISOString(), duration_minutes: 60 };
    expect(isPast(b)).toBe(true);
  });
});
