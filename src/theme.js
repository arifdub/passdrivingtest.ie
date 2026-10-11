/*
  ===========================================================================
  LIGHT OR DARK, IN ONE PLACE

  Every screen in this project already carries `dark:` variants — the
  styling has always been there. What was missing was anywhere outside the
  theory app to change it: App.jsx held the state, and the instructor and
  admin portals do not render through App.jsx, so their dark styles could
  only ever appear if something else had set the class.

  This is that state, lifted out of a component so any portal can reach
  it. Same localStorage key as before — "pdt-theme" — so an instructor who
  had set dark in the theory app finds the portal already dark, and
  nobody's existing preference is reset by this change.

  WHY A SUBSCRIPTION RATHER THAN A CONTEXT

  Two different React trees (the theory app and the portals) and two
  places inside the portal that both show the current state: the account
  menu and the Account screen. A context would have to wrap each tree
  separately and still would not keep the two trees in step. A module-
  level value with listeners is smaller and does keep them in step,
  including across a tab that is open twice.

  Default is light, unchanged. Reading the system preference instead would
  silently flip the app for everybody who has never chosen — a change
  nobody asked for, made on their behalf.
  ===========================================================================
*/

import { useSyncExternalStore } from "react";

const KEY = "pdt-theme";

/* localStorage throws in a private window and in some embedded webviews.
   An unreadable preference is simply no preference. */
function read() {
  try {
    return localStorage.getItem(KEY) === "dark" ? "dark" : "light";
  } catch {
    return "light";
  }
}

let current = read();
const listeners = new Set();

/* The class Tailwind's darkMode: "class" looks for. Set on <html>, so it
   covers portals, modals and anything else rendered outside the root. */
function paint(theme) {
  try {
    document.documentElement.classList.toggle("dark", theme === "dark");
  } catch {
    /* No document: a test, or a server render. Nothing to paint. */
  }
}

/* Applied at import rather than on first render, so a dark-mode user does
   not get a white flash while React boots. */
paint(current);

export function getTheme() {
  return current;
}

export function setTheme(theme) {
  const next = theme === "dark" ? "dark" : "light";
  if (next === current) return;
  current = next;
  paint(next);
  try {
    localStorage.setItem(KEY, next);
  } catch {
    /* It will not survive a reload. It still works for this session, which
       is better than refusing to change at all. */
  }
  listeners.forEach(fn => fn(next));
}

export function toggleTheme() {
  setTheme(current === "dark" ? "light" : "dark");
}

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/* The React side. useSyncExternalStore rather than useState+useEffect so
   that two components reading this never render a frame apart — the menu
   and the Account screen are both on screen at once. */
export function useTheme() {
  const theme = useSyncExternalStore(subscribe, getTheme, () => "light");
  return { theme, setTheme, toggleTheme, isDark: theme === "dark" };
}
