/*
  ===========================================================================
  A LINE THAT APPEARS WHEN SOMETHING ARRIVES

  Sits under the header, not over the bottom bar — the bar is where the
  counts live and covering them with a notice about the counts is a poor
  trade. Tapping it goes to the thing; it leaves on its own after a few
  seconds either way.

  WHY IT IS NOT A BROWSER NOTIFICATION

  A real one needs permission, and asking for that permission on page load
  is the single most ignored prompt on the web. This appears without asking
  anybody anything. When push is built, the prompt belongs behind a button
  that says what it is for.
  ===========================================================================
*/

import React, { useEffect, useState } from "react";
import { Bell, X } from "lucide-react";

const LINGER_MS = 6000;

export default function Toast({ message, onGo, onDismiss }) {
  const [leaving, setLeaving] = useState(false);

  useEffect(() => {
    if (!message) return;
    setLeaving(false);
    /* Two timers: one to start the fade, one to actually remove it, so the
       transition has somewhere to go. */
    const fade = setTimeout(() => setLeaving(true), LINGER_MS);
    const gone = setTimeout(() => onDismiss?.(), LINGER_MS + 300);
    return () => { clearTimeout(fade); clearTimeout(gone); };
  }, [message, onDismiss]);

  if (!message) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className={`fixed left-0 right-0 z-40 px-4 transition-all duration-300 ${
        leaving ? "opacity-0 -translate-y-2" : "opacity-100 translate-y-0"
      }`}
      style={{ top: "calc(env(safe-area-inset-top) + 0.5rem)" }}
    >
      <div className="max-w-md mx-auto rounded-2xl bg-slate-900 dark:bg-slate-800 text-white shadow-2xl ring-1 ring-white/10 flex items-center gap-3 pl-4 pr-2 py-3">
        <span className="shrink-0 w-8 h-8 rounded-full bg-emerald-500 text-slate-900 flex items-center justify-center">
          <Bell size={16} />
        </span>
        <button
          onClick={() => { onGo?.(); onDismiss?.(); }}
          className="flex-1 min-w-0 text-left"
        >
          <span className="block text-sm font-bold truncate">{message.text}</span>
          <span className="block text-xs text-slate-400">Tap to open</span>
        </button>
        <button
          onClick={() => onDismiss?.()}
          aria-label="Dismiss"
          className="shrink-0 w-9 h-9 flex items-center justify-center rounded-full text-slate-400 hover:bg-white/10"
        >
          <X size={16} />
        </button>
      </div>
    </div>
  );
}
