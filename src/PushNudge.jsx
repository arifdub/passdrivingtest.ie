/*
  ===========================================================================
  "YOUR PHONE WILL NOT RING" — SAID WHERE IT WILL BE SEEN

  The toggle for notifications lives inside the bell menu, which an
  instructor opens when they already suspect there is something to see.
  Somebody who never opens it never learns the feature exists, and the
  first they know of a booking is whenever they next happen to look. For a
  learner waiting on an answer that is the difference between an hour and
  a day.

  So the dashboard says it, once, in the place nobody can miss.

  WHAT THIS DELIBERATELY DOES NOT DO

  It does not ask the browser for permission on load. An unbidden
  permission dialog is the most reflexively dismissed thing on the web,
  and on iOS a dismissal has no second chance — only Settings. The nudge
  is a sentence and a button; the dialog only ever follows a tap.

  It does not nag for ever. Dismissing it puts it away for two weeks. A
  banner that cannot be got rid of is one people learn to read past, which
  costs more than it saves. Two weeks because this is worth raising again
  — not because the answer was no.

  It says nothing at all when there is nothing to be done: notifications
  already on, a browser that cannot do push, or a site with no key
  configured. A prompt to fix something the person cannot fix is noise.
  ===========================================================================
*/

import React, { useEffect, useState } from "react";
import { BellRing, Loader2, X, Share } from "lucide-react";
import { enablePush, currentSubscription, pushBlockedReason } from "./push";

const SNOOZE_KEY = "pdt.pushNudge.snoozedUntil";
const TWO_WEEKS = 14 * 24 * 60 * 60 * 1000;

/* localStorage throws in a private window and in some embedded webviews,
   and a crash here would take the dashboard with it. Unreadable means
   not snoozed, which errs towards showing the nudge — the safer side. */
function snoozed() {
  try {
    const until = Number(localStorage.getItem(SNOOZE_KEY));
    return Number.isFinite(until) && until > Date.now();
  } catch {
    return false;
  }
}

function snooze() {
  try {
    localStorage.setItem(SNOOZE_KEY, String(Date.now() + TWO_WEEKS));
  } catch {
    /* Then it reappears next load. Mildly annoying, not broken. */
  }
}

/*
  Whether to say anything, and which of three things to say.

  Pulled out as a plain function because it is the only part with
  judgement in it, and because a component whose state begins as "still
  looking" renders nothing under a server render — so the decision could
  not otherwise be tested at all.

  Returns null for "say nothing", or one of:
    "offer"   — a button that asks the browser, on a tap and never before
    "install" — iOS in a tab, where subscribing is impossible and a button
                would be a dead end
    "denied"  — refused at the OS level, which only Settings can undo
*/
export function nudgeMode({ on, blocked, hidden }) {
  if (hidden) return null;
  /* null means still looking. Showing a banner and then pulling it away
     is worse than a moment of nothing. */
  if (on === null || on === undefined || on) return null;

  /* Nothing the person could act on, so saying it would be noise:
     a browser without push, a site with no key, a key that is wrong —
     the last is for whoever configured the site, not for the instructor
     looking at the dashboard. */
  const code = blocked?.code;
  if (code === "unsupported" || code === "unconfigured" || code === "badkey") return null;

  if (code === "ios-needs-install") return "install";
  if (code === "denied") return "denied";
  return "offer";
}

export default function PushNudge() {
  /* null while looking. Rendering nothing until the answer is known stops
     the banner appearing and vanishing on every dashboard load for people
     who already have it on. */
  const [on, setOn] = useState(null);
  const [blocked, setBlocked] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [hidden, setHidden] = useState(snoozed());

  useEffect(() => {
    let off = false;
    (async () => {
      const reason = pushBlockedReason();
      const sub = await currentSubscription();
      if (off) return;
      setBlocked(reason);
      setOn(Boolean(sub));
    })();
    return () => { off = true; };
  }, []);

  const mode = nudgeMode({ on, blocked, hidden });
  if (!mode) return null;

  async function turnOn() {
    setBusy(true); setError(null);
    const r = await enablePush();
    setBusy(false);
    if (!r.ok) { setError(r.error); return; }
    setOn(true);
  }

  function dismiss() {
    snooze();
    setHidden(true);
  }

  const iosInstall = mode === "install";
  const denied = mode === "denied";

  return (
    <div className="rounded-2xl border border-amber-200 dark:border-amber-900/60 bg-amber-50 dark:bg-amber-950/30 p-4">
      <div className="flex items-start gap-3">
        <span className="shrink-0 w-9 h-9 rounded-full bg-amber-100 dark:bg-amber-900/60 text-amber-600 dark:text-amber-400 flex items-center justify-center">
          <BellRing size={17} />
        </span>

        <div className="flex-1 min-w-0">
          <p className="font-bold text-sm text-slate-900 dark:text-white">
            Notifications are off on this device
          </p>

          {iosInstall ? (
            <p className="mt-0.5 text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
              You'll only see a booking when you open the app. To get notified
              on your phone, tap <Share size={12} className="inline -mt-0.5" /> then{" "}
              <strong>Add to Home Screen</strong>, and turn them on from there.
            </p>
          ) : denied ? (
            <p className="mt-0.5 text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
              You'll only see a booking when you open the app. Your phone blocked
              notifications for this app — turn them back on in{" "}
              <strong>Settings → Notifications</strong>, then come back here.
            </p>
          ) : (
            <p className="mt-0.5 text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
              A learner's booking or message will wait until you next open the
              app. Turn notifications on and your phone will tell you instead.
            </p>
          )}

          <div className="mt-2.5 flex items-center gap-2 flex-wrap">
            {!iosInstall && !denied && (
              <button
                onClick={turnOn}
                disabled={busy}
                className="inline-flex items-center gap-1.5 rounded-xl bg-amber-500 hover:bg-amber-400 px-3.5 py-2 text-sm font-bold text-slate-900 transition disabled:opacity-50"
              >
                {busy ? <Loader2 size={14} className="animate-spin" /> : <BellRing size={14} />}
                {busy ? "…" : "Turn on notifications"}
              </button>
            )}

            <button
              onClick={dismiss}
              className="inline-flex items-center gap-1 rounded-xl px-2.5 py-2 text-xs font-semibold text-slate-500 dark:text-slate-400"
            >
              <X size={12} /> Not now
            </button>
          </div>

          {error && (
            <p className="mt-2 text-xs text-red-500 leading-relaxed">{error}</p>
          )}
        </div>
      </div>
    </div>
  );
}
