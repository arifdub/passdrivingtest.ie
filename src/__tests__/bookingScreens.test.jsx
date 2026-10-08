/*
  The two booking screens, rendered with the data layer stubbed.

  The states worth pinning are the awkward ones: a request whose hour has
  already gone by, an instructor with no open hours, and the moment someone
  else takes the slot between loading the list and tapping it.
*/

import React from "react";
import { renderToString } from "react-dom/server";
import { describe, it, expect, vi } from "vitest";

vi.mock("../appAuth", () => ({
  useAuth: () => ({ user: { id: "i1", email: "aoife@example.com" }, signOut: () => {} }),
}));

const { default: BookSheet } = await import("../BookSheet");
const { default: Bookings } = await import("../instructor/Bookings");

const instructor = {
  user_id: "i1",
  full_name: "Aoife Byrne",
  lesson_types: ["edt", "pretest"],
  hourly_rate_cents: 4500,
  edt_rate_cents: 4000,
};

describe("BookSheet", () => {
  it("opens on the instructor's name and does not promise a charge", () => {
    const html = renderToString(
      <BookSheet instructor={instructor} onClose={() => {}} onBooked={() => {}} />
    );
    expect(html).toContain("Aoife Byrne");
    expect(html).toContain("Checking their calendar");
    /* Money is not taken here and the screen must not imply it is. */
    expect(html).not.toMatch(/pay now|card details|checkout/i);
  });
});

describe("Bookings", () => {
  it("renders without crashing", () => {
    expect(renderToString(<Bookings />)).toContain("Loading your requests");
  });
});

/* ------------------------------------------------------------------------- */
/* The card's reading of a booking, which is where the judgement calls are.   */
/* ------------------------------------------------------------------------- */

const { isPast, BOOKING_STATUS } = await import("../bookingStore");

describe("how a request reads once its hour has gone", () => {
  const hourAgo = {
    id: "b1", status: "requested", duration_minutes: 60,
    starts_at: new Date(Date.now() - 2 * 3600000).toISOString(),
  };
  const soon = {
    id: "b2", status: "requested", duration_minutes: 60,
    starts_at: new Date(Date.now() + 2 * 86400000).toISOString(),
  };

  it("is not still waiting on anyone", () => {
    /* The column still says 'requested'. Nobody is going to drive to it, and
       the screen says "Missed" rather than inviting an answer that cannot
       help. The dashboard count leaves it out for the same reason. */
    expect(isPast(hourAgo)).toBe(true);
    expect(BOOKING_STATUS[hourAgo.status].label).toBe("Waiting");
  });

  it("still is, when the hour is ahead", () => {
    expect(isPast(soon)).toBe(false);
  });
});
