/*
  What a live change is allowed to say.

  The judgement here is which changes deserve a line at all. A notification
  system that announces the thing you just did is one people learn to ignore
  within a day, and then it is worth nothing when it matters.
*/

import { describe, it, expect } from "vitest";
import { describeChange } from "../realtime";

describe("what gets announced", () => {
  it("announces a new booking request", () => {
    const said = describeChange({
      kind: "booking", event: "INSERT", row: { status: "requested" },
    });
    expect(said.text).toMatch(/booking request/i);
    expect(said.go).toBe("bookings");
  });

  it("says nothing when the instructor accepts one themselves", () => {
    /* Accepting is an UPDATE to a booking. Telling somebody about the thing
       they just did on the screen they did it on is noise, and noise is how
       a badge stops being read. */
    expect(describeChange({
      kind: "booking", event: "UPDATE", row: { status: "accepted" },
    })).toBeNull();
  });

  it("but does announce a learner cancelling", () => {
    /* Also an UPDATE, and the instructor did not do it — somebody is not
       turning up to a lesson that is still in the calendar. */
    const said = describeChange({
      kind: "booking", event: "UPDATE", row: { status: "cancelled" },
    });
    expect(said.text).toMatch(/cancel/i);
  });

  it("announces a message and an enquiry", () => {
    expect(describeChange({ kind: "message", event: "INSERT" }).go).toBe("messages");
    expect(describeChange({ kind: "enquiry", event: "INSERT" }).go).toBe("enquiries");
  });

  it("says nothing about an enquiry merely changing status", () => {
    /* Answering or declining one is the instructor's own action. */
    expect(describeChange({ kind: "enquiry", event: "UPDATE" })).toBeNull();
  });

  it("says nothing about something it does not recognise", () => {
    /* A table added to the publication later must not produce an undefined
       toast with a blank line in it. */
    expect(describeChange({ kind: "lesson", event: "INSERT" })).toBeNull();
    expect(describeChange({})).toBeNull();
    expect(describeChange()).toBeNull();
  });

  it("never announces a booking insert that is not a request", () => {
    /* Rows can be inserted already accepted by a migration or an admin. */
    expect(describeChange({
      kind: "booking", event: "INSERT", row: { status: "accepted" },
    })).toBeNull();
  });
});
