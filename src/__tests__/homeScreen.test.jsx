/*
  The learner home screen's header: no wheel icon any more (the home screen
  IS the destination it used to point at), the heading reads "Practice
  Theory Test" instead of the old "Driver Theory Test", and a signed-in
  learner gets a welcome-back line with their name rather than the bare
  "Hi {name}" that showed for guests too.
*/

import React from "react";
import { renderToString } from "react-dom/server";
import { describe, it, expect, vi } from "vitest";

const mockAuth = vi.fn();
vi.mock("../appAuth", () => ({
  useAuth: () => mockAuth(),
}));

const { HomeScreen } = await import("../screens");
const { ProgressProvider } = await import("../progressStore");

function render() {
  return renderToString(
    <ProgressProvider>
      <HomeScreen go={() => {}} />
    </ProgressProvider>,
  );
}

describe("the learner home screen header", () => {
  it("no longer carries the wheel icon — the wordmark alone is the way back out", () => {
    mockAuth.mockReturnValue({
      displayName: "Zain", isSignedIn: true, isGuest: false,
      subscription: { label: "Free" }, exitGuest: () => {},
    });
    expect(render()).not.toContain("/logo.png");
  });

  it("greets a signed-in learner by name as a welcome back, not a bare \"Hi\"", () => {
    mockAuth.mockReturnValue({
      displayName: "Zain", isSignedIn: true, isGuest: false,
      subscription: { label: "Free" }, exitGuest: () => {},
    });
    const html = render();
    expect(html).toContain("Welcome back, Zain");
    expect(html).not.toContain("Hi Zain");
  });

  it("keeps the plain greeting for a guest who is not signed in", () => {
    mockAuth.mockReturnValue({
      displayName: "there", isSignedIn: false, isGuest: true,
      subscription: { label: "Free" }, exitGuest: () => {},
    });
    const html = render();
    expect(html).toContain("Hi there");
    expect(html).not.toContain("Welcome back");
  });

  it("titles the screen Practice Theory Test, not the old Driver Theory Test", () => {
    mockAuth.mockReturnValue({
      displayName: "Zain", isSignedIn: true, isGuest: false,
      subscription: { label: "Free" }, exitGuest: () => {},
    });
    const html = render();
    expect(html).toContain('tracking-tight">Practice Theory Test</h1>');
    expect(html).not.toContain('tracking-tight">Driver Theory Test</h1>');
  });
});
