/*
  ===========================================================================
  TURNING ON THE THING THAT REACHES A CLOSED PHONE

  One button, behind a sentence that says what it does. Never a prompt on
  load: an unbidden permission dialog is the most reflexively dismissed
  thing on the web, and on iOS a dismissal has no second chance — only
  Settings.

  The iOS case gets its own message. Safari only allows push for a site
  added to the home screen, and in a tab the API is absent rather than
  refused. "Not supported on your phone" would be both wrong and
  unactionable; "add it to your home screen first" is something a person
  can do.
  ===========================================================================
*/

import React, { useEffect, useState, useCallback } from "react";
import { BellRing, BellOff, Loader2, AlertCircle, Check, Share, Send } from "lucide-react";
import {
  enablePush, disablePush, currentSubscription, pushBlockedReason, isIOS, isStandalone,
  sendTestPush,
} from "./push";

export default function PushToggle({ compact }) {
  const [on, setOn] = useState(null);     // null = still looking
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [blocked, setBlocked] = useState(null);
  /* The result of a test send, kept verbatim. A tick here would be a lie:
     the server can report a successful send to a phone that stays silent,
     and that distinction is the whole reason this button exists. */
  const [test, setTest] = useState(null);
  const [testing, setTesting] = useState(false);

  const check = useCallback(async () => {
    setBlocked(pushBlockedReason());
    const sub = await currentSubscription();
    setOn(Boolean(sub));
  }, []);

  useEffect(() => { check(); }, [check]);

  async function turnOn() {
    setBusy(true); setError(null);
    const r = await enablePush();
    setBusy(false);
    if (!r.ok) { setError(r.error); setBlocked(pushBlockedReason()); return; }
    setOn(true);
  }

  async function runTest() {
    setTesting(true); setTest(null);
    setTest(await sendTestPush());
    setTesting(false);
  }

  async function turnOff() {
    setBusy(true); setError(null);
    await disablePush();
    setBusy(false);
    setOn(false);
  }

  /* iOS in a tab: not a failure, an instruction. */
  if (blocked?.code === "ios-needs-install") {
    return (
      <Wrap compact={compact}>
        <p className="text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
          <strong className="text-slate-900 dark:text-white">Add this to your home screen</strong>{" "}
          and you can turn on notifications. On iPhone, tap{" "}
          <Share size={13} className="inline -mt-0.5" /> then{" "}
          <strong>Add to Home Screen</strong>.
        </p>
      </Wrap>
    );
  }

  if (blocked?.code === "badkey") {
    return (
      <Wrap compact={compact}>
        <p className="text-sm text-amber-700 dark:text-amber-400 leading-relaxed">
          {blocked.text}
        </p>
      </Wrap>
    );
  }

  if (blocked?.code === "unconfigured") {
    return (
      <Wrap compact={compact}>
        <p className="text-sm text-slate-500 dark:text-slate-400 leading-relaxed">
          {blocked.text}
        </p>
      </Wrap>
    );
  }

  if (blocked?.code === "unsupported") {
    return (
      <Wrap compact={compact}>
        <p className="text-sm text-slate-500 dark:text-slate-400 leading-relaxed">
          {blocked.text} You'll still see everything when you open the app.
        </p>
      </Wrap>
    );
  }

  return (
    <Wrap compact={compact}>
      <div className="flex items-start gap-3">
        <span className={`shrink-0 w-9 h-9 rounded-full flex items-center justify-center ${
          on ? "bg-emerald-100 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-400"
             : "bg-slate-100 dark:bg-slate-700 text-slate-400"
        }`}>
          {on ? <BellRing size={17} /> : <BellOff size={17} />}
        </span>

        <div className="flex-1 min-w-0">
          <p className="font-bold text-sm text-slate-900 dark:text-white">
            {on ? "Notifications are on" : "Get notified on this device"}
          </p>
          <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
            {on
              ? "Your phone will buzz when a learner books, messages or enquires — even with the app closed."
              : "A booking or a message will reach you with the app closed, instead of waiting until you open it."}
          </p>

          {blocked?.code === "denied" ? (
            <p className="mt-2 text-xs text-amber-600 dark:text-amber-400 leading-relaxed">
              {blocked.text}
            </p>
          ) : (
            <button
              onClick={on ? turnOff : turnOn}
              disabled={busy || on === null}
              className={`mt-2.5 inline-flex items-center gap-1.5 rounded-xl px-3.5 py-2 text-sm font-bold transition disabled:opacity-50 ${
                on
                  ? "border border-slate-200 dark:border-slate-600 text-slate-600 dark:text-slate-300"
                  : "bg-emerald-500 hover:bg-emerald-400 text-slate-900"
              }`}
            >
              {busy
                ? <Loader2 size={14} className="animate-spin" />
                : on ? <BellOff size={14} /> : <BellRing size={14} />}
              {busy ? "…" : on ? "Turn off on this device" : "Turn on notifications"}
            </button>
          )}

          {error && (
            <p className="mt-2 text-xs text-red-500 flex items-start gap-1.5">
              <AlertCircle size={13} className="shrink-0 mt-0.5" /> {error}
            </p>
          )}

          {on && (
            <>
              <p className="mt-2 text-[11px] text-slate-400 flex items-center gap-1">
                <Check size={11} /> This device only — turn it on separately on a laptop.
              </p>

              <button
                onClick={runTest}
                disabled={testing}
                className="mt-2.5 inline-flex items-center gap-1.5 rounded-xl border border-slate-200 dark:border-slate-600 px-3 py-1.5 text-xs font-bold text-slate-600 dark:text-slate-300 transition disabled:opacity-50"
              >
                {testing
                  ? <Loader2 size={12} className="animate-spin" />
                  : <Send size={12} />}
                {testing ? "Sending…" : "Send a test notification"}
              </button>

              {test && <TestResult test={test} />}
            </>
          )}
        </div>
      </div>
    </Wrap>
  );
}

/* ---------------------------------------------------------------------------
   What came back, said plainly.

   Three outcomes that a single success/failure flag would blur together:

     - the server could not send, and says why (a key mismatch, no devices)
     - the server sent, and the phone showed it — working
     - the server sent, and the phone showed nothing — delivered but
       silenced, which is a phone setting, not a bug here

   The third is the one that has cost the most time, so it gets said out
   loud rather than hidden behind a tick.
   --------------------------------------------------------------------------- */
export function TestResult({ test }) {
  if (!test.ok) {
    return (
      <p className="mt-2 text-xs text-red-500 flex items-start gap-1.5">
        <AlertCircle size={13} className="shrink-0 mt-0.5" /> {test.error}
      </p>
    );
  }

  if (test.why) {
    return (
      <p className="mt-2 text-xs text-amber-600 dark:text-amber-400 leading-relaxed">
        {test.why}
      </p>
    );
  }

  if (!test.sent) {
    const first = test.failed?.[0];
    return (
      <p className="mt-2 text-xs text-amber-600 dark:text-amber-400 leading-relaxed">
        {first
          ? `${first.host} refused it${first.status ? ` (${first.status})` : ""}: ${first.why}`
          : "Nothing was sent, and no reason was given."}
      </p>
    );
  }

  return (
    <div className="mt-2 text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
      <p className="text-emerald-600 dark:text-emerald-400 font-semibold">
        Sent to {test.sent} device{test.sent === 1 ? "" : "s"}.
      </p>
      <p className="mt-0.5">
        Nothing on your phone within a few seconds? Then it was delivered and
        silenced — check Settings → Notifications for this app, and that
        Focus or Do Not Disturb is off.
      </p>
      {test.expired > 0 && (
        <p className="mt-0.5">
          {test.expired} old device{test.expired === 1 ? " was" : "s were"} expired and removed.
        </p>
      )}
      {test.failed?.length > 0 && (
        <p className="mt-0.5 text-amber-600 dark:text-amber-400">
          {test.failed[0].host} refused one
          {test.failed[0].status ? ` (${test.failed[0].status})` : ""}: {test.failed[0].why}
        </p>
      )}
    </div>
  );
}

function Wrap({ compact, children }) {
  if (compact) return <div className="pt-3 border-t border-slate-100 dark:border-slate-700">{children}</div>;
  return (
    <div className="rounded-2xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 p-4">
      {children}
    </div>
  );
}
