/*
  Light or dark, shared across two React trees.

  The theory app and the portals do not render through the same root, and
  inside the portal both the account menu and the Account screen show the
  current state at once. The thing worth proving is that they cannot
  disagree, and that nothing here throws when storage is unavailable —
  which is a real case: a private window, or an embedded webview.
*/

import { describe, it, expect, beforeEach, vi } from "vitest";

/* This project's tests run in plain Node — there is no jsdom, and adding
   one for a class toggle would be a dependency for a two-line API. These
   are the only DOM and storage calls theme.js makes. */
const classes = new Set();
Object.defineProperty(globalThis, "document", {
  value: {
    documentElement: {
      classList: {
        toggle: (c, on) => (on ? classes.add(c) : classes.delete(c)),
        contains: (c) => classes.has(c),
      },
    },
  },
  configurable: true, writable: true,
});

const store = {};
const fakeStorage = {
  getItem: (k) => (k in store ? store[k] : null),
  setItem: (k, v) => { store[k] = String(v); },
  removeItem: (k) => { delete store[k]; },
};
Object.defineProperty(globalThis, "localStorage", {
  value: fakeStorage, configurable: true, writable: true,
});

const { getTheme, setTheme, toggleTheme, subscribe } = await import("../theme");

beforeEach(() => setTheme("light"));

describe("the theme", () => {
  it("starts light, because flipping everybody to dark is not our call", () => {
    expect(getTheme()).toBe("light");
  });

  it("puts the class Tailwind looks for on <html>", () => {
    setTheme("dark");
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    setTheme("light");
    expect(document.documentElement.classList.contains("dark")).toBe(false);
  });

  it("remembers the choice", () => {
    setTheme("dark");
    expect(localStorage.getItem("pdt-theme")).toBe("dark");
  });

  it("uses the key the theory app already used, so nobody is reset", () => {
    /* An instructor who set dark in the theory app should find the portal
       already dark, not back to light. */
    setTheme("dark");
    expect(Object.keys(store)).toContain("pdt-theme");
  });

  it("tells every listener, so two components cannot disagree", () => {
    const a = vi.fn(), b = vi.fn();
    const offA = subscribe(a), offB = subscribe(b);
    setTheme("dark");
    expect(a).toHaveBeenCalledWith("dark");
    expect(b).toHaveBeenCalledWith("dark");
    offA(); offB();
  });

  it("says nothing when the value has not changed", () => {
    /* Otherwise every re-render of a menu would wake every subscriber. */
    const seen = vi.fn();
    const off = subscribe(seen);
    setTheme("light");
    expect(seen).not.toHaveBeenCalled();
    off();
  });

  it("toggles both ways", () => {
    toggleTheme();
    expect(getTheme()).toBe("dark");
    toggleTheme();
    expect(getTheme()).toBe("light");
  });

  it("treats rubbish as light rather than as a third state", () => {
    setTheme("banana");
    expect(getTheme()).toBe("light");
    setTheme(undefined);
    expect(getTheme()).toBe("light");
  });

  it("still changes when storage refuses to save", async () => {
    /* A private window. The preference will not survive a reload, which
       beats refusing to change at all. */
    Object.defineProperty(globalThis, "localStorage", {
      value: {
        getItem: () => { throw new Error("denied"); },
        setItem: () => { throw new Error("denied"); },
      },
      configurable: true, writable: true,
    });
    expect(() => setTheme("dark")).not.toThrow();
    expect(getTheme()).toBe("dark");
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    Object.defineProperty(globalThis, "localStorage", {
      value: fakeStorage, configurable: true, writable: true,
    });
  });
});

/* ---------------------------------------------------------------------------
   And the menu that carries it.

   What this can and cannot check, stated plainly: the menu renders closed,
   so the theme row is not in the output and nothing here proves it looks
   right. What it does prove is that AccountMenu still mounts after gaining
   a hook and two icons — an icon referenced but not imported builds
   cleanly and throws on render, and this component is in the header of
   every portal, so that throw would take all of them down at once.

   The row's appearance is unverified by any test and was checked by
   reading it. Opening the menu needs a DOM this project does not have.
   --------------------------------------------------------------------------- */
describe("the account menu after gaining a theme row", () => {
  it("still mounts", async () => {
    const React = (await import("react")).default;
    const { renderToString } = await import("react-dom/server");
    const { AccountMenu } = await import("../ui");

    const out = renderToString(
      React.createElement(AccountMenu, { email: "a@b.ie", onSignOut: () => {} }),
    );
    expect(out).toContain("Account menu");   // the trigger's aria-label
  });

  it("mounts in the avatar variant the instructor portal uses", async () => {
    const React = (await import("react")).default;
    const { renderToString } = await import("react-dom/server");
    const { AccountMenu } = await import("../ui");

    expect(() => renderToString(
      React.createElement(AccountMenu, {
        email: "a@b.ie", variant: "avatar", onSignOut: () => {},
        actions: [], portals: [],
      }),
    )).not.toThrow();
  });
});
