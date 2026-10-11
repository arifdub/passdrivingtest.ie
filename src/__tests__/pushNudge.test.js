/*
  When the dashboard tells an instructor their phone will not ring.

  The nudge exists because the toggle lives in the bell menu, which
  somebody only opens when they already suspect there is something to see.
  Getting this wrong in either direction has a cost: silent when it should
  speak, and an instructor finds out about a booking a day late; speaking
  when it should be silent, and it is a banner people learn to read past.
*/

import { describe, it, expect } from "vitest";

const { nudgeMode } = await import("../PushNudge");

describe("whether to nudge about notifications", () => {
  it("says nothing while it is still finding out", () => {
    /* A banner that appears and is then pulled away on every dashboard
       load is worse than a moment of nothing. */
    expect(nudgeMode({ on: null, blocked: null, hidden: false })).toBe(null);
    expect(nudgeMode({ on: undefined, blocked: null, hidden: false })).toBe(null);
  });

  it("says nothing when notifications are already on", () => {
    expect(nudgeMode({ on: true, blocked: null, hidden: false })).toBe(null);
  });

  it("says nothing once dismissed", () => {
    expect(nudgeMode({ on: false, blocked: null, hidden: true })).toBe(null);
  });

  it("offers to turn them on when they are simply off", () => {
    expect(nudgeMode({ on: false, blocked: null, hidden: false })).toBe("offer");
  });

  it("gives instructions, not a button, for iOS in a tab", () => {
    /* Safari cannot subscribe outside a home-screen app, so a button
       would be a dead end that appears to do nothing. */
    expect(nudgeMode({ on: false, blocked: { code: "ios-needs-install" }, hidden: false }))
      .toBe("install");
  });

  it("points at Settings when the phone has already refused", () => {
    /* A permission that was denied cannot be re-requested from a page.
       Offering the button again would silently fail. */
    expect(nudgeMode({ on: false, blocked: { code: "denied" }, hidden: false }))
      .toBe("denied");
  });

  it("stays quiet about things the instructor cannot fix", () => {
    /* A browser with no push, a site with no key, a key that is wrong:
       all real problems, none of them this person's to solve, and a
       prompt to fix them is noise on their dashboard. */
    for (const code of ["unsupported", "unconfigured", "badkey"]) {
      expect(nudgeMode({ on: false, blocked: { code }, hidden: false })).toBe(null);
    }
  });

  it("treats an unfamiliar reason as something worth offering", () => {
    /* A code added later and not handled here should still get the
       button rather than silence — being asked once beats never being
       told the feature exists. */
    expect(nudgeMode({ on: false, blocked: { code: "something-new" }, hidden: false }))
      .toBe("offer");
  });
});
