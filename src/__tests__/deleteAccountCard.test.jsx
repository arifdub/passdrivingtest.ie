/*
  The delete-account card, shared by the learner's Settings screen and the
  instructor's Account screen.

  Two things are worth proving:

  - the confirmation phrase is the actual gate, not just a decoration —
    close variants that a careless rewrite could accept (a trailing
    space, a different case, the word in a sentence) are checked
    individually rather than trusted to "look right"
  - the component mounts cleanly for both roles. It sits in the header
    area of both account screens; an icon referenced in JSX but not
    imported builds clean and only throws on render, which has happened
    in this project before.

  renderToString only ever shows the CLOSED state — open/typed/busy/done
  live in useState, and effects and clicks do not run under a server
  render. That is a real limit on what this file proves, stated rather
  than worked around: the expanded state, the role-specific warning
  copy inside it, and the button's enabled/disabled styling were checked
  by eye in a Playwright screenshot during development, not by a test
  that runs in CI. If that copy regresses, this file will not catch it.
*/

import React from "react";
import { renderToString } from "react-dom/server";
import { describe, it, expect } from "vitest";

const { default: DeleteAccountCard, confirmMatches } = await import("../DeleteAccountCard");

describe("the confirmation phrase", () => {
  it("accepts the exact word", () => {
    expect(confirmMatches("DELETE")).toBe(true);
  });

  it("is case-insensitive — the word is the bar, not caps lock", () => {
    expect(confirmMatches("delete")).toBe(true);
    expect(confirmMatches("Delete")).toBe(true);
  });

  it("tolerates surrounding whitespace from a careless paste", () => {
    expect(confirmMatches("  DELETE  ")).toBe(true);
  });

  it("refuses a near miss", () => {
    expect(confirmMatches("DELET")).toBe(false);
    expect(confirmMatches("DELETEE")).toBe(false);
    expect(confirmMatches("DELETE ME")).toBe(false);
  });

  it("refuses nothing, null and undefined without throwing", () => {
    expect(confirmMatches("")).toBe(false);
    expect(confirmMatches(null)).toBe(false);
    expect(confirmMatches(undefined)).toBe(false);
  });
});

describe("the card itself", () => {
  it("mounts for a learner", () => {
    const html = renderToString(
      <DeleteAccountCard role="learner" onDeleted={() => {}} />,
    );
    expect(html).toContain("Delete my account");
  });

  it("mounts for an instructor", () => {
    const html = renderToString(
      <DeleteAccountCard role="instructor" onDeleted={() => {}} />,
    );
    expect(html).toContain("Delete my account");
  });

  it("names the instructor-only loss on their own collapsed summary", () => {
    /* The one piece of role-specific copy that IS visible in the closed
       state, so it is the one piece this file can actually check. */
    const learner = renderToString(<DeleteAccountCard role="learner" onDeleted={() => {}} />);
    const instructor = renderToString(<DeleteAccountCard role="instructor" onDeleted={() => {}} />);
    expect(instructor).toContain("students");
    expect(learner).not.toContain("students");
  });
});
