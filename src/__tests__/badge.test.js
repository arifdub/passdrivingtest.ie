/*
  The number on the home-screen icon.

  Small surface, but every call sits on an API that is absent on most
  desktop browsers, present-but-refused in some contexts, and on iOS only
  exists for an app added to the home screen. A throw from any of them
  would come from inside a render effect, so the thing worth proving is
  that nothing escapes.
*/

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const { setBadge, clearBadge, badgingSupported } = await import("../badge");

const original = globalThis.navigator;

function withNavigator(nav) {
  Object.defineProperty(globalThis, "navigator", {
    value: nav, configurable: true, writable: true,
  });
}

afterEach(() => {
  Object.defineProperty(globalThis, "navigator", {
    value: original, configurable: true, writable: true,
  });
});

describe("the app icon badge", () => {
  it("does nothing at all where badging does not exist", async () => {
    withNavigator({});
    expect(badgingSupported()).toBe(false);
    /* The assertion is that this resolves rather than throwing. */
    await expect(setBadge(3)).resolves.toBeUndefined();
    await expect(clearBadge()).resolves.toBeUndefined();
  });

  it("sets a positive count", async () => {
    const set = vi.fn(), clear = vi.fn();
    withNavigator({ setAppBadge: set, clearAppBadge: clear });
    await setBadge(4);
    expect(set).toHaveBeenCalledWith(4);
    expect(clear).not.toHaveBeenCalled();
  });

  it("clears rather than setting zero", async () => {
    /* setAppBadge(0) is specified to clear, but Safari has shipped builds
       that draw an empty dot for it. Saying what is meant avoids the
       question entirely. */
    const set = vi.fn(), clear = vi.fn();
    withNavigator({ setAppBadge: set, clearAppBadge: clear });
    await setBadge(0);
    expect(clear).toHaveBeenCalled();
    expect(set).not.toHaveBeenCalled();
  });

  it("treats rubbish as nothing to show, not as a number", async () => {
    const set = vi.fn(), clear = vi.fn();
    withNavigator({ setAppBadge: set, clearAppBadge: clear });
    for (const v of [undefined, null, NaN, -1, "lots"]) await setBadge(v);
    expect(set).not.toHaveBeenCalled();
    expect(clear).toHaveBeenCalledTimes(5);
  });

  it("swallows a refusal, because a missing number is cosmetic", async () => {
    withNavigator({
      setAppBadge: () => Promise.reject(new Error("not allowed")),
      clearAppBadge: () => Promise.reject(new Error("not allowed")),
    });
    await expect(setBadge(2)).resolves.toBeUndefined();
    await expect(clearBadge()).resolves.toBeUndefined();
  });

  it("swallows a synchronous throw too", async () => {
    withNavigator({
      setAppBadge: () => { throw new Error("boom"); },
      clearAppBadge: () => { throw new Error("boom"); },
    });
    await expect(setBadge(2)).resolves.toBeUndefined();
    await expect(clearBadge()).resolves.toBeUndefined();
  });
});
