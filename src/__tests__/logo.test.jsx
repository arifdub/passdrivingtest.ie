/*
  The brand lockup's icon-less mode, added for the learner home screen: that
  screen is the destination the icon used to point at, so showing it there
  again was pure duplication. Every other call site passes no `icon` prop at
  all, so the default has to keep shipping the artwork exactly as before.
*/

import React from "react";
import { renderToString } from "react-dom/server";
import { describe, it, expect } from "vitest";

import { Logo } from "../ui";

describe("Logo", () => {
  it("ships the wheel artwork by default, unchanged for every existing call site", () => {
    const html = renderToString(<Logo size="md" />);
    expect(html).toContain("/logo.png");
  });

  it("drops the artwork when icon={false}, keeping the text wordmark", () => {
    const html = renderToString(<Logo size="md" icon={false} />);
    expect(html).not.toContain("/logo.png");
    /* "PassDrivingTest" is never one text node — "Driving" and ".ie" are
       coloured in their own <span>, so the wordmark is matched piece by
       piece rather than as one string. */
    expect(html).toContain(">Pass<");
    expect(html).toContain(">Driving<");
    expect(html).toContain(">.ie<");
  });
});
