/*
  The student app's shape after the redesign: one app for every learner,
  not just the theory test. Five tabs — Home, Study, Lessons, Messages,
  Journey — with the account behind the photo in the top-right, the theory
  material together in Study, and lesson requests for when the directory
  has nobody suitable.
*/

import React from "react";
import { renderToString } from "react-dom/server";
import { describe, it, expect, vi } from "vitest";

const mockAuth = vi.fn();
vi.mock("../appAuth", () => ({ useAuth: () => mockAuth() }));
vi.mock("../platform", async (orig) => ({
  ...(await orig()),
  usePlatform: () => ({ stage: { label: "I'm doing EDT" }, accountRoles: ["student"], isAdminAccount: false }),
}));

const { TABS, normaliseView } = await import("../App");
const { default: HomeDashboard } = await import("../student/HomeDashboard");
const { default: StudyScreen } = await import("../student/StudyScreen");
const { default: LessonsScreen } = await import("../student/LessonsScreen");
const { default: MessagesScreen } = await import("../student/MessagesScreen");
const { ProgressProvider } = await import("../progressStore");
const { validateRequest, isLive } = await import("../lessonRequests");

const signedIn = { displayName: "Zain", isSignedIn: true, isGuest: false, user: null,
  profile: {}, subscription: { label: "Free" }, exitGuest: () => {}, signOut: () => {} };
const guest = { ...signedIn, displayName: "there", isSignedIn: false, isGuest: true };

const text = (el) => renderToString(<ProgressProvider>{el}</ProgressProvider>).replace(/<!-- -->/g, "");

describe("the tabs", () => {
  it("are Home, Study, Lessons, Messages and Journey", () => {
    expect(TABS.map(t => t.id)).toEqual(["home", "study", "lessons", "messages", "journey"]);
  });

  it("no longer have Mocks, Progress or Settings — those moved into Study and the account menu", () => {
    for (const gone of ["mocks", "progress", "profile"]) expect(TABS.some(t => t.id === gone)).toBe(false);
  });

  it("send the old screen names to where those things live now", () => {
    expect(normaliseView({ screen: "mocks" })).toEqual({ screen: "study", segment: "mocks" });
    expect(normaliseView({ screen: "progress" })).toEqual({ screen: "study", segment: "progress" });
    expect(normaliseView({ screen: "instructors" })).toEqual({ screen: "lessons", segment: "find" });
    expect(normaliseView({ screen: "mock", mockId: "x" })).toEqual({ screen: "mock", mockId: "x" });
  });
});

describe("home", () => {
  it("welcomes a signed-in learner back by name, with the account menu top-right", () => {
    mockAuth.mockReturnValue(signedIn);
    const html = text(<HomeDashboard go={() => {}} />);
    expect(html).toContain("Welcome back, Zain");
    expect(html).toContain('aria-label="Account menu"');
    expect(html).not.toContain("/logo.png");
  });

  it("is for every learner: study, booking, requests and messages side by side", () => {
    mockAuth.mockReturnValue(signedIn);
    const html = text(<HomeDashboard go={() => {}} />);
    for (const s of ["Study theory", "Book a lesson", "Post a request", "Messages", "No lessons booked", "My driving journey"]) {
      expect(html).toContain(s);
    }
    expect(html).toContain("I&#x27;m doing EDT");
  });

  it("keeps the plain greeting for a guest", () => {
    mockAuth.mockReturnValue(guest);
    const html = text(<HomeDashboard go={() => {}} />);
    expect(html).toContain("Hi there");
    expect(html).not.toContain("Welcome back");
  });
});

describe("study", () => {
  it("holds practice, mock tests and progress under one header", () => {
    mockAuth.mockReturnValue(signedIn);
    const html = text(<StudyScreen go={() => {}} segment="practice" onSegment={() => {}} />);
    expect(html).toContain("Study theory");
    for (const s of ["Practice", "Mock tests", "Progress", "The six topics", "Flashcards"]) expect(html).toContain(s);
  });

  it("shows the mock papers in the mocks part, without a second header", () => {
    mockAuth.mockReturnValue(signedIn);
    const html = text(<StudyScreen go={() => {}} segment="mocks" onSegment={() => {}} />);
    expect(html).toContain("Mock Test 1");
    expect(html.match(/<h1/g)).toHaveLength(1);
  });
});

describe("lessons and messages", () => {
  it("offers a guest an account before posting a request", () => {
    mockAuth.mockReturnValue(guest);
    const html = text(<LessonsScreen go={() => {}} segment="requests" onSegment={() => {}} />);
    expect(html).toContain("Find an instructor");
    expect(html).toContain("Create a free account");
  });

  it("tells a guest messages need an account", () => {
    mockAuth.mockReturnValue(guest);
    expect(text(<MessagesScreen go={() => {}} />)).toContain("Messages need an account");
  });
});

describe("a lesson request", () => {
  it("needs a county, a level, and whose car with which gearbox", () => {
    expect(Object.keys(validateRequest({})).sort()).toEqual(["car", "county", "level"]);
    expect(validateRequest({ county: "Dublin", level: 2, car: "own" }).car).toMatch(/manual or automatic/);
    expect(validateRequest({ county: "Dublin", level: 2, car: "own", gearbox: "manual" })).toEqual({});
  });

  it("is live while open and under 30 days old", () => {
    const later = new Date(Date.now() + 864e5).toISOString();
    const earlier = new Date(Date.now() - 1000).toISOString();
    expect(isLive({ status: "open", expires_at: later })).toBe(true);
    expect(isLive({ status: "open", expires_at: earlier })).toBe(false);
    expect(isLive({ status: "closed", expires_at: later })).toBe(false);
  });
});
