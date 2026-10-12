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
const { default: Help, TOPICS: HelpTopics } = await import("../instructor/Help");
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

/* InstructorDashboard has no top-level test elsewhere. useEffect does not
   run under renderToString, so this only proves the synchronous render is
   sound — an icon referenced but not imported builds clean and only throws
   when the component renders, which this catches. */
describe("the instructor dashboard", () => {
  const render = () => renderToString(
    <InstructorDashboard
      profile={{ full_name: "Aoife", adi_number: "40953", listed: true }}
      onGo={() => {}}
      onChanged={() => {}}
      pulse=""
    />,
  );

  it("renders, with the booking page link as the last thing on it", () => {
    const html = render();
    expect(html).toContain("Your booking page");
    /* Last: set up once, shared now and then. Nothing after it but the
       closing markup. */
    expect(html.lastIndexOf("Your booking page")).toBeGreaterThan(html.lastIndexOf("Profile &amp; account"));
  });

  it("keeps explanations off it — they are under Help now", () => {
    const html = render();
    expect(html).not.toContain("Learners pay you directly");
    expect(html).not.toContain("even with the app closed");
  });
});

describe("help", () => {
  it("carries what the dashboard used to explain", () => {
    const text = HelpTopics.map(t => t.body.join(" ")).join(" ");
    expect(text).toContain("Learners pay you directly");
    expect(text).toContain("even with the app closed");
    expect(text).toContain("passdrivingtest.ie/adi/");
  });

  it("renders with the first topic open", () => {
    const html = renderToString(<Help />);
    expect(html).toContain("Your booking page");
    expect(html).toContain('aria-expanded="true"');
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
