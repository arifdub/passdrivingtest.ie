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
const { InstructorDashboard, VerificationGate } = await import("../instructor/InstructorPortal");
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
  /* loading/status/draft/onRegister used to be props here, when the
     dashboard still carried its own VerificationCard for an unverified
     instructor. That branch moved to VerificationGate, which the whole
     portal now shows INSTEAD of this component when the account is not
     verified — so this component is only ever mounted already-verified,
     and those props went with it. Left off deliberately, not by oversight. */
  it("renders, including both static panels", () => {
    const html = renderToString(
      <InstructorDashboard
        profile={{ full_name: "Aoife" }}
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
        profile={{}} onGo={() => {}} onChanged={() => {}} pulse=""
      />,
    );
    expect(html).not.toContain("no email yet");
    expect(html).not.toContain("Nothing reaches you outside the app yet");
  });
});

/* What an unverified account sees INSTEAD of the dashboard above — not a
   banner on top of it. InstructorPortal's own top-level gate (status !==
   "verified") cannot be exercised here: it starts loading=true under
   useState, and that never resolves under renderToString since effects do
   not run server-side, so every render of the full portal would show the
   "Loading your account…" spinner regardless of status. What IS testable,
   and is the thing with judgement in it, is this component itself. */
describe("the verification gate", () => {
  it.each([
    [null, "Get verified to take bookings"],
    ["draft", "Your registration is half finished"],
    ["pending", "Verification in progress"],
    /* Not "We couldn't…" verbatim: React escapes the apostrophe as &#x27;
       in rendered text, so a literal ' in the expectation never matches
       — the same class of mismatch as a curly vs straight quote. Matched
       on the unambiguous part either side of it instead. */
    ["rejected", "verify your ADI number"],
    ["suspended", "Your account is suspended"],
  ])("renders for status %s", (status, expectedHeading) => {
    const html = renderToString(
      <VerificationGate
        status={status}
        profile={{ full_name: "Cian" }}
        draft={null}
        onRegister={() => {}}
        onSignOut={() => {}}
      />,
    );
    expect(html).toContain(expectedHeading);
  });

  it("never shows the dashboard's own content", () => {
    /* The bug this screen exists to fix: a dashboard full of zeros shown
       to someone it has nothing real to say to. None of the dashboard's
       own panels should be reachable from here. */
    const html = renderToString(
      <VerificationGate status="draft" profile={{}} draft={{}}
        onRegister={() => {}} onSignOut={() => {}} />,
    );
    expect(html).not.toContain("Today's Lessons");
    expect(html).not.toContain("New Bookings");
    expect(html).not.toContain("Learners pay you directly");
  });

  it("offers a way to the learner app, not a dead end", () => {
    /* A real <button>, not an <a href> — a plain anchor was reported not
       to navigate at all from inside the installed home-screen app, so
       this goes through window.location.href on click instead, the same
       way every other exit from this SPA already does (App.jsx's onBack
       and onExitRole). renderToString cannot execute that click, so what
       is checked here is what IS checkable without a DOM: that the
       control exists, as a button rather than a link, with the label
       that promises where it goes. */
    const html = renderToString(
      <VerificationGate status="draft" profile={{}} draft={{}}
        onRegister={() => {}} onSignOut={() => {}} />,
    );
    expect(html).toContain("Go to the learner app");
    expect(html).not.toContain('href="/app"');
  });

  it("does not imply a learner identity the account does not have", () => {
    /* profiles.role is one value, set once. This link leaves the portal —
       it does not claim to be, or to create, a second account. */
    const html = renderToString(
      <VerificationGate status="draft" profile={{}} draft={{}}
        onRegister={() => {}} onSignOut={() => {}} />,
    );
    expect(html).toContain("Not an instructor?");
  });

  it("leaves signing out reachable — unverified is not locked out", () => {
    const html = renderToString(
      <VerificationGate status="draft" profile={{}} draft={{}}
        onRegister={() => {}} onSignOut={() => {}} />,
    );
    expect(html).toContain("Sign out");
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
