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
const { InstructorDashboard } = await import("../instructor/InstructorPortal");
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

/* InstructorDashboard has no top-level test elsewhere. It carries two
   static panels (money, and notification reach) that were rewritten in
   this change, and a tab bar icon (BellRing) swapped in for one that was
   dropped — the exact shape of bug this project has hit before: an icon
   referenced in JSX but not imported builds clean and only throws when
   the component actually renders. useEffect does not run under
   renderToString, so this only proves the synchronous render is sound,
   not the data-dependent states — which is what the rest of this file's
   "begins in a loading state" caveat already says about every screen
   here. */
describe("the instructor dashboard", () => {
  it("renders, including both static panels", () => {
    const html = renderToString(
      <InstructorDashboard
        loading={false}
        status="verified"
        profile={{ full_name: "Aoife" }}
        draft={{}}
        onRegister={() => {}}
        onGo={() => {}}
        onChanged={() => {}}
        pulse=""
      />,
    );
    expect(html).toContain("Learners pay you directly");
    expect(html).toContain("hear about it, even with the app closed");
  });

  it("no longer claims notifications do not exist", () => {
    /* The panel this replaced said "no email yet, and no notification on
       a closed phone" — true when it was written, false since push and
       email shipped. Asserted as an absence so a future regression (the
       text sliding back to its old wording) is caught rather than merely
       the panel's presence. */
    const html = renderToString(
      <InstructorDashboard
        loading={false} status="verified" profile={{}} draft={{}}
        onRegister={() => {}} onGo={() => {}} onChanged={() => {}} pulse=""
      />,
    );
    expect(html).not.toContain("no email yet");
    expect(html).not.toContain("Nothing reaches you outside the app yet");
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
