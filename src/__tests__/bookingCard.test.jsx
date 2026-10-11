/*
  The card both screens now draw.

  It was inside the Bookings screen until the dashboard started showing
  incoming requests; one component in two places is the point, so it is
  worth a test that it renders at all. A component referencing an icon it
  never imported builds cleanly and throws at runtime, which has happened
  in this project before — and now it would take the dashboard down, not
  just one tab.
*/

import React from "react";
import { renderToString } from "react-dom/server";
import { describe, it, expect } from "vitest";

const { default: Card } = await import("../instructor/BookingCard");

const base = {
  id: "b1",
  status: "requested",
  starts_at: new Date(Date.now() + 3 * 86400000).toISOString(),
  duration_minutes: 60,
  kind: "lesson",
};

const html = (b) => renderToString(<Card booking={{ ...base, ...b }} />).replace(/<!-- -->/g, "");

describe("a booking card", () => {
  it("renders a plain request", () => {
    const out = html({});
    expect(out).toContain("60 min");
  });

  it("shows a pick-up address when there is one", () => {
    expect(html({ pickup: "14 O'Connell St" })).toContain("O&#x27;Connell St");
  });

  it("says nothing about pick-up when there is none", () => {
    /* An empty "Pick-up:" label is worse than no label. */
    expect(html({})).not.toContain("Pick-up");
  });

  it("shows the price only when one was agreed", () => {
    expect(html({ price_cents: 4500 })).toContain("45");
    expect(html({ price_cents: null })).not.toContain("€");
  });

  it("passes the learner's note through", () => {
    expect(html({ note: "Second attempt, nervous on roundabouts" }))
      .toContain("nervous on roundabouts");
  });

  it("marks a request whose hour has passed as Missed, not Waiting", () => {
    /* The column still says 'requested'. Nobody is driving to it now, and
       showing it as live work is how a dashboard loses trust. */
    const out = html({ starts_at: new Date(Date.now() - 86400000).toISOString() });
    expect(out).toContain("Missed");
  });

  it("renders the accept and decline buttons it is given", () => {
    const out = renderToString(
      <Card booking={base}><button>Accept</button></Card>
    );
    expect(out).toContain("Accept");
  });
});
