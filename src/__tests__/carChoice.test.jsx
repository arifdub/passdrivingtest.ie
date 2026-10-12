/*
  Whose car, and which gearbox (sql/30). The database refuses an automatic
  in a manual-only instructor's car; these check the screens never offer it,
  and that the answer reaches the request, the card and the old database.
*/

import React from "react";
import { renderToString } from "react-dom/server";
import { describe, it, expect, vi, beforeEach } from "vitest";

const rpc = vi.fn();
vi.mock("../supabaseClient", () => ({ supabase: { rpc: (...a) => rpc(...a) }, HAS_SUPABASE: true }));

const {
  gearboxChoices, fitGearbox, carError, carLabel, requestBooking, requestGuestBooking,
} = await import("../bookingStore");
const { default: CarChoice } = await import("../CarChoice");
const { Card } = await import("../instructor/BookingCard");

const manualOnly = { transmissions: ["manual"] };
const both = { transmissions: ["manual", "automatic"] };
const ids = (list) => list.map(g => g.id);

describe("which gearboxes are offered", () => {
  it("in the instructor's car, only what they teach in", () => {
    expect(ids(gearboxChoices(manualOnly, "instructor"))).toEqual(["manual"]);
    expect(ids(gearboxChoices(both, "instructor"))).toEqual(["manual", "automatic"]);
  });

  it("in the learner's own car, either, whatever the instructor has", () => {
    expect(ids(gearboxChoices(manualOnly, "own"))).toEqual(["manual", "automatic"]);
  });

  it("an instructor who never said is taken to do both", () => {
    expect(ids(gearboxChoices({ transmissions: [] }, "instructor"))).toEqual(["manual", "automatic"]);
  });

  it("switching to a manual-only instructor's car turns an automatic into manual", () => {
    expect(fitGearbox(manualOnly, "instructor", "automatic")).toBe("manual");
    expect(fitGearbox(both, "instructor", "automatic")).toBe("automatic");
    expect(fitGearbox(both, "own", null)).toBeNull();
  });

  it("both answers are needed before sending", () => {
    expect(carError({ car: null, gearbox: null })).toMatch(/car/);
    expect(carError({ car: "own", gearbox: null })).toMatch(/manual or automatic/);
    expect(carError({ car: "own", gearbox: "manual" })).toBeNull();
  });
});

describe("the picker", () => {
  it("asks whose car first, and the gearbox once that is chosen", () => {
    const html = renderToString(<CarChoice instructor={both} car={null} gearbox={null} onChange={() => {}} />);
    expect(html).toContain("Instructor&#x27;s car");
    expect(html).toContain("My own car");
    expect(html).not.toContain("Automatic");
  });

  it("never offers an automatic in a manual-only instructor's car, and says why", () => {
    const html = renderToString(<CarChoice instructor={manualOnly} car="instructor" gearbox="manual" onChange={() => {}} />)
      .replace(/<!-- -->/g, "");
    expect(html).toContain("Manual");
    expect(html).not.toContain(">Automatic<");
    expect(html).toMatch(/Their car is manual/);
  });

  it("offers both in the learner's own car", () => {
    const html = renderToString(<CarChoice instructor={manualOnly} car="own" gearbox={null} onChange={() => {}} />);
    expect(html).toContain(">Manual<");
    expect(html).toContain(">Automatic<");
  });
});

describe("the request", () => {
  beforeEach(() => rpc.mockReset());

  it("sends the car and gearbox", async () => {
    rpc.mockResolvedValue({ data: "b1", error: null });
    await requestBooking({ instructorId: "i", at: new Date(), car: "own", gearbox: "automatic" });
    expect(rpc.mock.calls[0][1]).toMatchObject({ p_car: "own", p_gearbox: "automatic" });
  });

  it("before sql/30 is run, still books, with the answer in the note", async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { code: "PGRST202", message: "not found" } })
       .mockResolvedValueOnce({ data: "b2", error: null });
    const r = await requestGuestBooking({
      instructorId: "i", at: new Date(), name: "Sam", email: "s@x.ie", phone: "0871234567",
      note: "Ring the bell", car: "instructor", gearbox: "manual",
    });
    expect(r.ok).toBe(true);
    const second = rpc.mock.calls[1][1];
    expect(second.p_car).toBeUndefined();
    expect(second.p_note).toBe("Instructor's car · Manual — Ring the bell");
  });
});

describe("the instructor's card", () => {
  it("shows whose car and which gearbox", () => {
    const html = renderToString(<Card booking={{
      starts_at: new Date().toISOString(), status: "requested", kind: "lesson", duration_minutes: 60,
      learner_id: "l", car: "own", gearbox: "automatic",
    }} />);
    expect(carLabel({ car: "own", gearbox: "automatic" })).toBe("Own car · Automatic");
    expect(html).toContain("Own car · Automatic");
  });
});
