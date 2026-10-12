/*
  These two screens are new and large, and a mistake in either is a blank
  section in production rather than a failing build — React renders nothing
  and logs to a console nobody is watching.

  So they are rendered here, to a string, with the data layer stubbed. This
  does not check that they look right. It checks that they render at all,
  with real data and with none, which is the failure that would otherwise
  reach an instructor.
*/

import React from "react";
import { renderToString } from "react-dom/server";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { DEFAULT_RULES } from "../instructor/availabilityStore";

/* useAuth throws outside its provider, and the provider wants Supabase. The
   screens only ever read user.id and user.email from it. */
vi.mock("../appAuth", () => ({
  useAuth: () => ({ user: { id: "u1", email: "aoife@example.com" }, signOut: () => {} }),
}));

const hours = [
  { id: "h1", weekday: 2, starts_at: "09:00", ends_at: "13:00" },
  { id: "h2", weekday: 2, starts_at: "14:00", ends_at: "17:00" },
  { id: "h3", weekday: 4, starts_at: "10:00", ends_at: "16:00" },
];
const timeOff = [{ id: "t1", starts_on: "2026-12-24", ends_on: "2026-12-26", reason: "Christmas" }];

const state = { hours, timeOff, rules: undefined, error: null };

vi.mock("../instructor/teachingStore", async (importOriginal) => ({
  ...(await importOriginal()),
  listLessons: async () => ({ rows: [], error: null }),
}));

vi.mock("../instructor/availabilityStore", async (importOriginal) => {
  const real = await importOriginal();
  return {
    ...real,
    loadAvailability: async () => ({
      hours: state.hours,
      timeOff: state.timeOff,
      rules: state.rules || real.DEFAULT_RULES,
      error: state.error,
    }),
  };
});

const realStore = await import("../instructor/availabilityStore");
const { default: Availability, Preview, Rules, HourGrid, SpecificDates, DateHoursSheet } = await import("../instructor/Availability");
const { default: Account } = await import("../instructor/Account");

const profile = {
  full_name: "Aoife Byrne",
  business_name: "Byrne School of Motoring",
  phone: "0871234567",
  adi_number: "40953",
  bio: "Patient, based in Dublin 15.",
  transmissions: ["manual"],
  lesson_types: ["edt", "pretest"],
  counties: ["Dublin"],
  service_areas: ["D15"],
  hourly_rate_cents: 4500,
  edt_rate_cents: 4000,
  listed: true,
};

describe("Account", () => {
  it("shows the verified badge and the edit button, not a verification panel", () => {
    const html = renderToString(
      <Account loading={false} status="verified" profile={profile} onRegister={() => {}} />
    );
    expect(html).toContain("Verified ADI");
    expect(html).toContain("Edit my profile");
    expect(html).toContain("40953");
    expect(html).toContain("Byrne School of Motoring");
    /* The thing that used to be on the dashboard must not come back here
       once there is nothing left to do about it. */
    expect(html).not.toContain("Get verified to take bookings");
  });

  it("asks an unregistered instructor for their details", () => {
    const html = renderToString(
      <Account loading={false} status={null} profile={null} draft={null} onRegister={() => {}} />
    );
    expect(html).toContain("Add my details");
    expect(html).toContain("Get verified to take bookings");
    expect(html).not.toContain("Verified ADI");
  });

  it("names a missing field rather than leaving a blank line", () => {
    const html = renderToString(
      <Account
        loading={false}
        status="draft"
        profile={{ full_name: "Half Done" }}
        onRegister={() => {}}
      />
    );
    expect(html).toContain("Not set");
    expect(html).toContain("Half finished");
  });

  it("shows the reviewer's note when verification was refused", () => {
    const html = renderToString(
      <Account
        loading={false}
        status="rejected"
        profile={{ ...profile, verification_notes: "Number not on the register." }}
        onRegister={() => {}}
      />
    );
    expect(html).toContain("Number not on the register.");
    expect(html).toContain("Update and resubmit");
  });
});

describe("Availability", () => {
  beforeEach(() => {
    state.hours = hours; state.timeOff = timeOff; state.rules = undefined; state.error = null;
  });

  /* renderToString does not run effects, so the whole screen only ever
     renders its loading state here. That is worth one assertion and no more;
     the parts with something to say are rendered directly below. */
  it("renders without crashing", () => {
    expect(renderToString(<Availability />)).toContain("Loading your week");
  });

  it("renders the week's open slots, and says they are not bookable yet", () => {
    /* A Tuesday, so the two Tuesday blocks in `hours` are in range. */
    const html = renderToString(
      <Preview hours={hours} timeOff={[]} rules={DEFAULT_RULES} lessons={[]} />
    );
    expect(html).toContain("Your next seven days");
    expect(html).toMatch(/\d{2}:\d{2}/);
    /* The promise this screen must never make, in either direction. */
    expect(html).not.toMatch(/book this slot/i);
    expect(html).toContain("Nothing here is bookable yet");
  });

  it("says so plainly when a week is open but nothing fits", () => {
    const html = renderToString(
      <Preview hours={[]} timeOff={[]} rules={DEFAULT_RULES} lessons={[]} />
    );
    expect(html).toContain("Nothing open in the next week");
  });

  it("highlights the terms the instructor actually chose", () => {
    const html = renderToString(
      <Rules
        rules={{ ...DEFAULT_RULES, lesson_minutes: 90, travel_buffer_minutes: 0 }}
        onSave={() => {}}
      />
    );
    /* Every option is on screen either way, so the assertion has to be about
       which one is SELECTED — the emerald chip — not which ones exist. */
    const selected = [...html.matchAll(/bg-emerald-500[^>]*>([^<]+)</g)].map(m => m[1].trim());
    expect(selected).toContain("90 min");
    expect(selected).toContain("None");
    expect(selected).not.toContain("1 hour");
  });

  describe("specific dates", () => {
    const noop = () => {};

    it("lists each date once, with its hours", () => {
      const html = renderToString(
        <SpecificDates
          dateHours={[
            { id: "a", on_date: "2026-10-15", starts_at: "10:00", ends_at: "12:00" },
            { id: "b", on_date: "2026-10-15", starts_at: "14:00", ends_at: "15:00" },
          ]}
          unavailable={null} onAdd={noop} onEdit={noop} onRemove={noop}
        />
      );
      expect(html).toContain("15 Oct");
      expect(html).toContain("10:00–12:00");
      expect(html).toContain("14:00–15:00");
      expect([...html.matchAll(/Change the hours on 2026-10-15/g)]).toHaveLength(1);
    });

    it("starts a date from that weekday's usual hours, and says only that date changes", () => {
      const { nextDateFor, dateKey } = realStore;
      const soon = new Date(); soon.setDate(soon.getDate() + 1);
      const thu = nextDateFor(4, soon);
      const html = renderToString(
        <DateHoursSheet
          initialDate={dateKey(thu)}
          hours={[{ weekday: 4, starts_at: "09:00", ends_at: "12:00" }]}
          dateHours={[]}
          onClose={noop} onSave={noop}
        />
      );
      expect([...html.matchAll(/aria-pressed="true"/g)]).toHaveLength(3);
      /* React marks inserted text with <!-- --> in server output, so the
         sentence is matched without them. */
      expect(html.replace(/<!-- -->/g, "")).toContain("Every other Thursday keeps your usual hours");
    });

    it("says how to switch it on rather than offering a button that would fail", () => {
      const html = renderToString(
        <SpecificDates dateHours={[]} unavailable="relation does not exist"
          onAdd={noop} onEdit={noop} onRemove={noop} />
      );
      expect(html).toContain("sql/28-date-specific-hours.sql");
      expect(html).not.toContain("Add a date");
    });
  });

  describe("the hourly picker", () => {
    it("opens with the day's existing hours already switched on", () => {
      const html = renderToString(
        <HourGrid
          blocks={[{ starts_at: "09:00", ends_at: "13:00" }]}
          onSave={() => {}}
          onClose={() => {}}
        />
      );
      /* aria-pressed is how a screen reader hears "on" — asserted on the
         attribute rather than a colour class, which a redesign could change
         without the picker's actual state changing. */
      expect(html).toContain('aria-pressed="true"');
      expect(html).toContain('aria-pressed="false"');
    });

    it("offers every hour switched off for a day marked not working", () => {
      const html = renderToString(
        <HourGrid blocks={[]} onSave={() => {}} onClose={() => {}} />
      );
      expect(html).not.toContain('aria-pressed="true"');
      /* 06:00 to 22:00, the default range, is sixteen tiles. */
      expect([...html.matchAll(/aria-pressed="false"/g)]).toHaveLength(16);
    });
  });
});
