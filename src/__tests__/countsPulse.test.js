/*
  What makes the dashboard re-read its own data.

  Written after a real bug: the footer badge said 1 and the New Bookings
  tile beside it said 0, on the same screen at the same time. The badge
  reads counts the portal refreshes live; the tile and the list of
  requests fetched once on mount and nothing ever told them a booking had
  arrived. Tapping Bookings mounted a fresh component, which is why it
  looked like the dashboard specifically was broken.

  The fix is a value that changes exactly when there is new work to go and
  read — and crucially, does NOT change otherwise, because re-fetching on
  every poll would be work nobody asked for.
*/

import { describe, it, expect } from "vitest";

const { countsPulse } = await import("../socialStore");

const base = {
  bookingRequests: 0, newEnquiries: 0, unreadMessages: 0,
  lessonsToday: 2, unseen: 0,
};

describe("the dashboard's reason to re-read", () => {
  it("is the same for two objects holding the same numbers", () => {
    /* The poll builds a new object every two minutes whether or not
       anything changed. Identity would re-fetch on every one of them. */
    expect(countsPulse({ ...base })).toBe(countsPulse({ ...base }));
  });

  it("changes when a booking request arrives", () => {
    expect(countsPulse({ ...base, bookingRequests: 1 })).not.toBe(countsPulse(base));
  });

  it("changes when an enquiry arrives", () => {
    expect(countsPulse({ ...base, newEnquiries: 1 })).not.toBe(countsPulse(base));
  });

  it("changes when a message arrives", () => {
    expect(countsPulse({ ...base, unreadMessages: 1 })).not.toBe(countsPulse(base));
  });

  it("does not change when the bell is merely opened", () => {
    /* `unseen` drops to 0 the moment somebody looks at the bell. That is
       not new data to go and read, and re-fetching on it would make
       opening the bell reload the dashboard underneath it. */
    expect(countsPulse({ ...base, unseen: 7 })).toBe(countsPulse({ ...base, unseen: 0 }));
  });

  it("does not change when a lesson is added from this very screen", () => {
    /* lessonsToday moves when the instructor adds a lesson here. The
       screen already knows; re-reading would be chasing its own tail. */
    expect(countsPulse({ ...base, lessonsToday: 9 })).toBe(countsPulse(base));
  });

  it("survives counts that have not loaded yet", () => {
    /* First render, before the first fetch returns. It must produce
       something stable rather than throw, and must then differ once the
       real numbers arrive so the screen reads them. */
    expect(() => countsPulse(undefined)).not.toThrow();
    expect(countsPulse(undefined)).toBe(countsPulse(null));
    expect(countsPulse(undefined)).not.toBe(countsPulse(base));
  });

  it("tells 1 booking apart from 1 enquiry", () => {
    /* A naive sum would call these the same, and a booking replacing an
       enquiry would leave the dashboard showing the enquiry. */
    expect(countsPulse({ ...base, bookingRequests: 1 }))
      .not.toBe(countsPulse({ ...base, newEnquiries: 1 }));
  });
});
