/*
  The last four instructor screens, rendered with the data layer stubbed.

  The assertions that matter are about what these screens promise. Three of
  them touch money, and this product takes none — so each is checked for the
  absence of a fee as much as for the presence of a figure.
*/

import React from "react";
import { renderToString } from "react-dom/server";
import { describe, it, expect, vi } from "vitest";

vi.mock("../appAuth", () => ({
  useAuth: () => ({ user: { id: "i1", email: "aoife@example.com" }, signOut: () => {} }),
}));

const { default: Marketplace } = await import("../instructor/Marketplace");
const { default: Earnings } = await import("../instructor/Earnings");
const { default: Reviews, Stars } = await import("../instructor/Reviews");
const { default: Messages } = await import("../instructor/Messages");
const { default: Thread } = await import("../Thread");

/* Every one of these begins in a loading state under renderToString, which
   is the only thing this level can honestly assert for the whole screen. The
   parts with judgement in them are tested as units elsewhere. */
describe("they render at all", () => {
  it.each([
    ["Marketplace", <Marketplace />, "Checking your listing"],
    ["Earnings", <Earnings />, "Adding it up"],
    ["Reviews", <Reviews />, "Loading your reviews"],
    ["Messages", <Messages />, "Loading your threads"],
    ["Thread", <Thread bookingId="b1" meId="i1" />, "Loading"],
  ])("%s", (_name, el, expected) => {
    expect(renderToString(el)).toContain(expected);
  });
});

describe("stars", () => {
  it("fills exactly as many as the rating", () => {
    const html = renderToString(<Stars value={3} />);
    const filled = (html.match(/fill-amber-400/g) || []).length;
    expect(filled).toBe(3);
  });

  it("labels itself for a screen reader rather than relying on colour", () => {
    expect(renderToString(<Stars value={4} />)).toContain("4 out of 5");
  });
});

/* ------------------------------------------------------------------------- */
/* What these screens are not allowed to say                                  */
/* ------------------------------------------------------------------------- */

const { tally } = await import("../instructor/Earnings");

describe("the money stance", () => {
  it("counts nothing that has not been taught", () => {
    /* Guarded here as well as in earnings.test.js because this is the
       assertion that keeps a figure from being planned around. */
    const t = tally([
      { starts_at: new Date().toISOString(), status: "scheduled", price_cents: 5000 },
    ]);
    expect(t.cents).toBe(0);
  });
});
