/*
  ===========================================================================
  INSTALL POPUP

  A dismissible card offering "Add to Home Screen", shown over the Welcome
  view — a first-time visitor's best chance of installing, before they've
  decided whether to sign up.

  Reuses usePwaInstall's browser-specific states so the steps shown here
  match the ones on the Profile screen's install card: Safari's Share button
  lives at the bottom of the screen, but Chrome/Firefox/Edge on iOS and most
  Android browsers put their menu next to the address bar at the top —
  telling everyone "tap Share at the bottom" is wrong for most of them.

  Dismissal is remembered in localStorage so it only interrupts once; it
  never shows again after "installed" becomes true either.
  ===========================================================================
*/

import React, { useEffect, useState } from "react";
import { X, Smartphone, Share2, MoreVertical, Menu, Download } from "lucide-react";
import usePwaInstall from "./usePwaInstall";

const DISMISSED_KEY = "pdt_install_popup_dismissed";

function Step({ n, children }) {
  return (
    <li className="flex items-start gap-3">
      <span className="w-6 h-6 rounded-full bg-emerald-500/15 text-emerald-400 flex items-center justify-center text-xs font-black shrink-0">
        {n}
      </span>
      <span className="text-sm text-slate-200 leading-snug pt-0.5">{children}</span>
    </li>
  );
}

export default function InstallPopup() {
  const { state, promptInstall } = usePwaInstall();
  const [dismissed, setDismissed] = useState(true);

  useEffect(() => {
    try {
      setDismissed(localStorage.getItem(DISMISSED_KEY) === "1");
    } catch {
      setDismissed(false);
    }
  }, []);

  function dismiss() {
    setDismissed(true);
    try {
      localStorage.setItem(DISMISSED_KEY, "1");
    } catch {
      // Private browsing or storage disabled — it just asks again next visit.
    }
  }

  if (dismissed) return null;
  if (!["prompt", "ios-safari", "ios-other", "android"].includes(state)) return null;

  const steps = {
    "ios-safari": (
      <>
        <Step n="1">
          Tap the <Share2 size={14} className="inline mx-0.5 -mt-0.5 text-blue-400" />
          <span className="font-semibold"> Share</span> button at the bottom of Safari.
        </Step>
        <Step n="2">Scroll down and tap <span className="font-semibold">Add to Home Screen</span>.</Step>
        <Step n="3">Tap <span className="font-semibold">Add</span> in the top right.</Step>
      </>
    ),
    "ios-other": (
      <>
        <Step n="1">
          Tap the <MoreVertical size={14} className="inline mx-0.5 -mt-0.5 text-blue-400" />
          or <Share2 size={14} className="inline mx-0.5 -mt-0.5 text-blue-400" /> icon
          next to the address bar, top right.
        </Step>
        <Step n="2">
          Tap <span className="font-semibold">Share</span>, then
          <span className="font-semibold"> More</span> if it's not listed yet.
        </Step>
        <Step n="3">Choose <span className="font-semibold">Add to Home Screen</span> and confirm.</Step>
      </>
    ),
    android: (
      <>
        <Step n="1">
          Tap the <Menu size={14} className="inline mx-0.5 -mt-0.5 text-blue-400" /> menu, top right.
        </Step>
        <Step n="2">
          Choose <span className="font-semibold">Add to Home screen</span> or
          <span className="font-semibold"> Install app</span>.
        </Step>
        <Step n="3">Confirm when your browser asks.</Step>
      </>
    ),
  };

  return (
    <div className="w-full bg-slate-800 border border-slate-700 rounded-2xl p-5 shadow-xl relative">
      <button
        onClick={dismiss}
        aria-label="Dismiss"
        className="absolute top-4 right-4 w-8 h-8 rounded-full bg-slate-700/70 hover:bg-slate-700 flex items-center justify-center text-slate-300"
      >
        <X size={16} />
      </button>

      <div className="flex items-center gap-3 pr-10">
        <div className="w-10 h-10 rounded-xl bg-slate-900 flex items-center justify-center shrink-0">
          <Smartphone size={18} className="text-emerald-400" />
        </div>
        <div>
          <h2 className="font-bold text-white leading-tight">Add to your Home Screen</h2>
          <p className="text-xs text-slate-400">Free — no App Store needed</p>
        </div>
      </div>

      {state === "prompt" ? (
        <>
          <p className="mt-4 text-sm text-slate-300 leading-relaxed">
            Add PassDrivingTest to your home screen for full-screen study with
            no browser bar, and it still works offline.
          </p>
          <button
            onClick={async () => {
              const result = await promptInstall();
              if (result.ok) dismiss();
            }}
            className="mt-4 w-full inline-flex items-center justify-center gap-2 bg-emerald-500 hover:bg-emerald-400 text-slate-900 font-bold py-3 rounded-xl transition"
          >
            <Download size={16} /> Add to Home Screen
          </button>
        </>
      ) : (
        <>
          <ol className="mt-4 space-y-3">{steps[state]}</ol>
          <p className="mt-4 pt-4 border-t border-slate-700 text-xs text-slate-400 leading-relaxed">
            It opens full screen with its own icon, and works offline.
          </p>
        </>
      )}
    </div>
  );
}
