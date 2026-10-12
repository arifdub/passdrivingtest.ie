/*
  ===========================================================================
  INSTALL GUIDE

  Shown when the app is open in a browser rather than from the home screen.
  It works out the phone and browser, says exactly which button to tap, and
  puts a bouncing arrow on the spot where that button actually is:

    iPhone Safari      Share is in the bottom toolbar      arrow at the bottom
    iPad Safari        Share is top right                   arrow top right
    Chrome on iPhone   Share is in the address bar, top     arrow top right
    Firefox/Edge iOS   menu in the bottom toolbar           arrow at the bottom
    Android Chrome     one-tap install when the browser
                       offers it, otherwise the menu        arrow top right
    Samsung Internet   menu bottom right                    arrow bottom right
    Facebook/Instagram an in-app browser cannot install;    arrow top right,
    and other in-app   open the page in the real browser    to "Open in browser"

  Desktop and already-installed get nothing.

  Closing it hides it for two weeks on this device, per app, so it asks
  again later but never nags.
  ===========================================================================
*/

import React, { useEffect, useState } from "react";
import { X, Share, MoreVertical, MoreHorizontal, Menu, Download, ArrowUp, ArrowDown } from "lucide-react";
import usePwaInstall from "./usePwaInstall";

const QUIET_DAYS = 14;

const APPS = {
  instructor: {
    name: "ADI Instructor",
    icon: "/icons/instructor-180.png",
    why: "Your bookings, students and calendar in one tap, with notifications when a learner books.",
  },
  learner: {
    name: "PassDrivingTest",
    icon: "/icons/student-180.png",
    why: "Study full screen, pick up where you left off, and keep your progress in one tap.",
  },
};

const ICONS = { share: Share, dots: MoreHorizontal, kebab: MoreVertical, menu: Menu };

/* What to say and where to point, for a given phone and browser. Pure, so
   it can be tested without a phone. Returns null when there is nothing to
   offer. Each step is [icon key or null, text]. */
export function guideFor(state, device = {}) {
  if (state === "installed" || state === "desktop") return null;

  if (device.inApp) {
    return {
      kind: "steps", where: "top-right",
      steps: [
        ["dots", "Tap the ⋯ menu at the top right."],
        [null, `Choose "Open in browser" (or Open in Safari / Chrome).`],
        [null, "Then add it to your Home Screen from there."],
      ],
    };
  }

  if (state === "prompt") return { kind: "prompt", where: null, steps: [] };

  if (state === "ios-safari") {
    return device.ipad
      ? {
          kind: "steps", where: "top-right",
          steps: [
            ["share", "Tap Share at the top right."],
            [null, "Tap Add to Home Screen."],
            [null, "Tap Add."],
          ],
        }
      : {
          kind: "steps", where: "bottom",
          steps: [
            ["share", "Tap Share in the bar at the bottom. On newer iPhones tap ⋯ first, then Share."],
            [null, "Scroll down and tap Add to Home Screen."],
            [null, "Tap Add."],
          ],
        };
  }

  if (state === "ios-other") {
    if (device.browser === "chrome") {
      return {
        kind: "steps", where: "top-right",
        steps: [
          ["share", "Tap Share in the address bar, top right."],
          [null, "Tap Add to Home Screen (under More if you can't see it)."],
          [null, "Tap Add."],
        ],
      };
    }
    return {
      kind: "steps", where: "bottom",
      steps: [
        ["menu", "Tap the menu in the bar at the bottom."],
        [null, "Tap Share, then Add to Home Screen."],
        [null, "Tap Add."],
      ],
    };
  }

  if (state === "android") {
    if (device.browser === "samsung") {
      return {
        kind: "steps", where: "bottom-right",
        steps: [
          ["menu", "Tap the ☰ menu at the bottom right."],
          [null, "Tap Add page to, then Home screen."],
          [null, "Tap Add."],
        ],
      };
    }
    return {
      kind: "steps", where: "top-right",
      steps: [
        ["kebab", "Tap the ⋮ menu at the top right."],
        [null, "Tap Add to Home screen or Install app."],
        [null, "Tap Install or Add."],
      ],
    };
  }

  return null;
}

function quietKey(app) { return `pdt_install_guide_${app}_closed_at`; }

function recentlyClosed(app) {
  try {
    const at = Number(localStorage.getItem(quietKey(app)) || 0);
    return at > 0 && Date.now() - at < QUIET_DAYS * 86400000;
  } catch {
    return false;
  }
}

export default function InstallPopup({ app = "learner", delayMs = 1500 }) {
  const { state, promptInstall, device } = usePwaInstall();
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (recentlyClosed(app)) return;
    const t = setTimeout(() => setVisible(true), delayMs);
    return () => clearTimeout(t);
  }, [app, delayMs]);

  function close() {
    setVisible(false);
    try { localStorage.setItem(quietKey(app), String(Date.now())); } catch { /* private mode */ }
  }

  const guide = guideFor(state, device);
  if (!visible || !guide) return null;

  const meta = APPS[app] || APPS.learner;
  const atTop = guide.where === "top-right";

  return (
    <>
      {guide.where && <Arrow where={guide.where} />}

      <div
        className={`fixed inset-x-0 z-50 flex justify-center px-4 ${atTop ? "top-0" : "bottom-0"}`}
        style={atTop
          ? { paddingTop: "calc(max(0.75rem, env(safe-area-inset-top)) + 3.5rem)" }
          : { paddingBottom: `calc(max(0.75rem, env(safe-area-inset-bottom)) + ${guide.where ? "3.5rem" : "0rem"})` }}
        role="dialog"
        aria-label={`Install ${meta.name}`}
      >
        <div className="w-full max-w-sm bg-slate-900 text-white border border-slate-700 rounded-2xl p-4 shadow-2xl relative">
          <button
            onClick={close}
            aria-label="Close"
            className="absolute top-3 right-3 w-8 h-8 rounded-full bg-slate-800 flex items-center justify-center text-slate-300"
          >
            <X size={16} />
          </button>

          <div className="flex items-center gap-3 pr-10">
            <img src={meta.icon} alt="" className="w-11 h-11 rounded-xl shrink-0" />
            <div className="min-w-0">
              <p className="font-black leading-tight">Install {meta.name}</p>
              <p className="text-xs text-slate-400">Free. No App Store needed.</p>
            </div>
          </div>

          <p className="mt-3 text-sm text-slate-300 leading-snug">{meta.why}</p>

          {guide.kind === "prompt" ? (
            <button
              onClick={async () => {
                const r = await promptInstall();
                if (r.ok) close();
              }}
              className="mt-3 w-full inline-flex items-center justify-center gap-2 bg-emerald-500 text-slate-900 font-bold py-3 rounded-xl"
            >
              <Download size={16} /> Install
            </button>
          ) : (
            <ol className="mt-3 space-y-2">
              {guide.steps.map(([icon, text], i) => {
                const Icon = icon ? ICONS[icon] : null;
                return (
                  <li key={i} className="flex items-start gap-2.5">
                    <span className="w-6 h-6 rounded-full bg-blue-500/20 text-blue-300 flex items-center justify-center text-xs font-black shrink-0">
                      {i + 1}
                    </span>
                    <span className="text-sm text-slate-100 leading-snug pt-0.5">
                      {Icon && <Icon size={15} className="inline -mt-0.5 mr-1 text-blue-400" />}
                      {text}
                    </span>
                  </li>
                );
              })}
            </ol>
          )}

          <button onClick={close} className="mt-3 w-full text-xs font-semibold text-slate-400 py-1.5">
            Not now
          </button>
        </div>
      </div>
    </>
  );
}

/* The bouncing arrow, sitting right against the edge where the button is. */
function Arrow({ where }) {
  const pos = {
    "top-right": { top: "max(0.25rem, env(safe-area-inset-top))", right: "1rem" },
    bottom: { bottom: "max(0.25rem, env(safe-area-inset-bottom))", left: "50%", transform: "translateX(-50%)" },
    "bottom-right": { bottom: "max(0.25rem, env(safe-area-inset-bottom))", right: "1.25rem" },
  }[where];
  const Icon = where === "top-right" ? ArrowUp : ArrowDown;
  return (
    <div className="fixed z-50 pointer-events-none" style={pos} data-arrow={where}>
      <div className="animate-bounce w-12 h-12 rounded-full bg-blue-500 text-white flex items-center justify-center shadow-xl shadow-blue-900/40 ring-4 ring-blue-500/30">
        <Icon size={26} strokeWidth={3} />
      </div>
    </div>
  );
}
