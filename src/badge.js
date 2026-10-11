/*
  ===========================================================================
  THE NUMBER ON THE HOME-SCREEN ICON

  It has one rule: it is the same number as the bell. Not "unread
  something", not "things outstanding" — whatever waitingTotal() says, and
  nothing else. A badge that disagrees with the bell two inches below it
  teaches people to distrust both.

  Three places change it:

    - a push arriving while the app is closed   (public/sw.js, from the
      count the server put in the payload)
    - the app loading or refreshing its counts  (here)
    - the bell being opened, which is what      (here, via markSeen)
      "seen" means

  Every call is wrapped. The Badging API is absent on most desktop
  browsers, present-but-refused in some contexts, and on iOS only exists
  for an app added to the home screen. None of that is worth an exception
  reaching the caller: a missing number is a cosmetic loss, and the bell
  inside the app is still right.
  ===========================================================================
*/

/* Present at all? Used only to avoid pointless work — never to decide
   whether the rest of the app can function. */
export function badgingSupported() {
  return typeof navigator !== "undefined" && "setAppBadge" in navigator;
}

export async function setBadge(count) {
  if (!badgingSupported()) return;
  const n = Number(count);
  try {
    /* clearAppBadge rather than setAppBadge(0): passing zero is specified
       to clear, but Safari has shipped builds where it draws an empty dot
       instead. Clearing says what is meant. */
    if (!Number.isFinite(n) || n <= 0) await navigator.clearAppBadge();
    else await navigator.setAppBadge(n);
  } catch {
    /* Refused. Nothing to do and nothing to report. */
  }
}

export async function clearBadge() {
  if (!badgingSupported()) return;
  try {
    await navigator.clearAppBadge();
  } catch {
    /* As above. */
  }
}
