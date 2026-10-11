/*
  What the test-notification button says back.

  Written because the three outcomes below look identical through a boolean,
  and the third one — delivered, then silenced by the phone — is the one
  that has cost the most time to recognise. A tick on that case would send
  somebody looking for a bug that is not in the code.

  Also a plain render test: a component that references an icon it never
  imported builds cleanly and throws at runtime, which has already happened
  once in this project.
*/

import React from "react";
import { renderToString } from "react-dom/server";
import { describe, it, expect } from "vitest";

const { TestResult } = await import("../PushToggle");

/* renderToString puts <!-- --> between adjacent interpolations, so
   "Sent to 2 devices" is never literally present in the markup. Stripping
   those markers is normalising the renderer's bookkeeping, not loosening
   the assertion — the words and their order still have to be right. */
const html = (test) =>
  renderToString(<TestResult test={test} />).replace(/<!-- -->/g, "");

describe("the result of a test notification", () => {
  it("shows the server's own reason when it could not send", () => {
    const out = html({ ok: true, sent: 0, devices: 2, why: "VAPID config rejected: bad key" });
    expect(out).toContain("VAPID config rejected");
  });

  it("names the push service and status when one refused", () => {
    const out = html({
      ok: true, devices: 1, sent: 0,
      failed: [{ host: "web.push.apple.com", status: 403, why: "VapidPkHashMismatch" }],
    });
    expect(out).toContain("web.push.apple.com");
    expect(out).toContain("403");
    expect(out).toContain("VapidPkHashMismatch");
  });

  it("does not claim success when nothing was sent and nothing explained why", () => {
    const out = html({ ok: true, devices: 0, sent: 0 });
    expect(out).toContain("no reason was given");
    expect(out).not.toContain("Sent to");
  });

  it("counts the devices it reached", () => {
    expect(html({ ok: true, devices: 2, sent: 2 })).toContain("Sent to 2 devices");
    expect(html({ ok: true, devices: 1, sent: 1 })).toContain("Sent to 1 device");
  });

  it("says a successful send may still be a silent phone", () => {
    /* The point of the whole panel. Without this line, 'Sent to 2 devices'
       and a quiet pocket reads as a contradiction rather than as a setting. */
    const out = html({ ok: true, devices: 2, sent: 2 });
    expect(out).toContain("delivered and");
    expect(out).toMatch(/Do Not Disturb/);
  });

  it("reports an expired device rather than silently dropping it", () => {
    expect(html({ ok: true, devices: 2, sent: 1, expired: 1 })).toContain("expired and removed");
  });

  it("shows a transport failure as an error, not as a reason", () => {
    expect(html({ ok: false, error: "Could not reach the server." }))
      .toContain("Could not reach the server.");
  });
});
