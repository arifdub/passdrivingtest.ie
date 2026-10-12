/*
  Booking from an instructor's own page, without an account (sql/29).
  The server decides; these check what the screens say and send.
*/

import React from "react";
import { renderToString } from "react-dom/server";
import { describe, it, expect, vi } from "vitest";

vi.mock("../appAuth", () => ({
  useAuth: () => ({ user: null, isSignedIn: false, profile: null }),
}));

const { validateGuest, pageLink } = await import("../bookingStore");
const { default: Card } = await import("../instructor/BookingCard");
const { default: ShareLink } = await import("../instructor/ShareLink");
const { Booking } = await import("../InstructorPage");

describe("what a guest has to give", () => {
  it("accepts a name, an email and a phone number", () => {
    expect(validateGuest({ name: "Sam Walsh", email: "sam@example.ie", phone: "087 123 4567" })).toEqual({});
  });

  it("says which field is wrong, not just that something is", () => {
    const e = validateGuest({ name: "S", email: "sam@", phone: "123" });
    expect(Object.keys(e).sort()).toEqual(["email", "name", "phone"]);
  });

  it("accepts an international number with a plus and spaces", () => {
    expect(validateGuest({ name: "Sam", email: "s@x.ie", phone: "+353 87 123 4567" }).phone).toBeUndefined();
  });
});

describe("the link an instructor shares", () => {
  it("is the ADI number, digits only", () => {
    expect(pageLink("40953")).toBe("https://passdrivingtest.ie/adi/40953");
    expect(pageLink("F 40953")).toBe("https://passdrivingtest.ie/adi/40953");
  });

  it("is nothing when there is no number to build it from", () => {
    expect(pageLink("")).toBeNull();
    expect(pageLink(undefined)).toBeNull();
  });

  it("is offered on the dashboard once they are listed", () => {
    const html = renderToString(<ShareLink profile={{ adi_number: "40953", listed: true, full_name: "Aoife" }} />);
    expect(html).toContain("passdrivingtest.ie/adi/40953");
    expect(html).toContain("No account needed");
  });

  it("explains, rather than hands out a dead link, while they are unlisted", () => {
    const html = renderToString(<ShareLink profile={{ adi_number: "40953", listed: false }} />);
    expect(html).toContain("Turn your listing on");
    expect(html).not.toContain("Copy");
  });
});

describe("a guest booking, as the instructor sees it", () => {
  const guest = {
    id: "b1", learner_id: null, starts_at: new Date(Date.now() + 86400000).toISOString(),
    duration_minutes: 60, kind: "lesson", status: "requested",
    guest_name: "Sam Walsh", guest_email: "sam@example.ie", guest_phone: "087 123 4567",
  };

  it("shows who it is and how to reach them, tappable", () => {
    const html = renderToString(<Card booking={guest} />);
    expect(html).toContain("Sam Walsh");
    expect(html).toContain('href="tel:0871234567"');
    expect(html).toContain('href="mailto:sam@example.ie"');
    expect(html).toContain("Booked from your page");
    expect(html).toContain("accepting saves them to your students");
  });

  it("leaves a booking from an account exactly as it was", () => {
    const html = renderToString(<Card booking={{ ...guest, learner_id: "u2", guest_email: null }} />);
    expect(html).not.toContain("Booked from your page");
    expect(html).not.toContain("tel:");
  });
});

describe("the instructor's page", () => {
  it("offers booking to someone with no account", () => {
    const html = renderToString(
      <Booking instructor={{ user_id: "i1", full_name: "Aoife Byrne", lesson_types: ["lesson", "edt"] }} />
    );
    expect(html).toContain("Book a lesson");
    expect(html).toContain("Checking their calendar");
  });
});
