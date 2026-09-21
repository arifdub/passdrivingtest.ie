/*
  ===========================================================================
  SHARED UI

  Small pieces used across every screen. Keeping them here means the progress
  bar on the home screen and the one on a section screen can't drift apart.
  ===========================================================================
*/

import React from "react";
import { ChevronLeft, ChevronRight, Lock } from "lucide-react";

/* ------------------------------------------------------------------------- */
/* The brand lockup: the wheel from public/logo.png with the name set in live
   text beneath it.

   The name is TEXT rather than part of the image on purpose. The sister site's
   logo has its wordmark baked into the PNG, which means it cannot be reused
   here, cannot be recoloured, goes soft when scaled up, and turns to mush at
   small sizes. Live text stays crisp at any size on any screen, adapts to dark
   mode, is selectable and readable by a screen reader, and weighs nothing.

   The image therefore carries no words, so its alt is empty and the text below
   is the accessible name — otherwise a screen reader announces the brand
   twice. */
export function Logo({ size = "md", className = "" }) {
  const heights = {
    sm: "h-12",
    md: "h-16",
    lg: "h-24",
    xl: "h-32",
  };
  const words = {
    sm: "text-base",
    md: "text-xl",
    lg: "text-2xl",
    xl: "text-3xl",
  };
  return (
    <div className={`flex flex-col items-center ${className}`}>
      <img
        src="/logo.png"
        alt=""
        className={`${heights[size] || heights.md} w-auto`}
        draggable={false}
      />
      <span
        className={`${words[size] || words.md} mt-2 font-extrabold tracking-tight
                    text-white whitespace-nowrap`}
      >
        Pass<span className="text-blue-600 dark:text-blue-400">Driving</span>Test
        <span className="text-blue-600 dark:text-blue-400">.ie</span>
      </span>
    </div>
  );
}

/* ------------------------------------------------------------------------- */
export function ProgressBar({ pct, tone = "emerald", height = "h-2" }) {
  const tones = {
    emerald: "bg-emerald-500",
    blue: "bg-blue-500",
    amber: "bg-amber-500",
    red: "bg-red-500",
    slate: "bg-slate-400",
  };
  return (
    <div className={`${height} w-full bg-slate-200 dark:bg-slate-700 rounded-full overflow-hidden`}>
      <div
        className={`${height} ${tones[tone] || tones.emerald} rounded-full transition-all duration-500`}
        style={{ width: `${Math.max(0, Math.min(100, pct))}%` }}
      />
    </div>
  );
}

/* Circular percentage ring — the big number on the home and result screens. */
export function ProgressRing({ pct, size = 96, stroke = 8, tone = "emerald", label }) {
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (Math.max(0, Math.min(100, pct)) / 100) * circumference;

  const colors = {
    emerald: "#10b981",
    blue: "#3b82f6",
    amber: "#f59e0b",
    red: "#ef4444",
    slate: "#94a3b8",
  };

  return (
    <div className="relative inline-flex items-center justify-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle
          cx={size / 2} cy={size / 2} r={radius}
          fill="none" strokeWidth={stroke}
          className="stroke-slate-200 dark:stroke-slate-700"
        />
        <circle
          cx={size / 2} cy={size / 2} r={radius}
          fill="none" strokeWidth={stroke} strokeLinecap="round"
          stroke={colors[tone] || colors.emerald}
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          style={{ transition: "stroke-dashoffset 700ms ease" }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="font-black tracking-tight text-slate-900 dark:text-white"
              style={{ fontSize: size / 4 }}>
          {Math.round(pct)}%
        </span>
        {label && (
          <span className="text-[10px] font-bold uppercase tracking-widest text-slate-400">
            {label}
          </span>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------------- */
export function ScreenHeader({
  title, subtitle, onBack, backLabel = "Back", right, compact, below,
}) {
  return (
    <div className="bg-slate-900 text-white">
      {/* env(safe-area-inset-top) is the height of the notch / Dynamic Island.
          It's 0 on desktop and on Android, so max() keeps the normal padding
          everywhere else. index.html already sets viewport-fit=cover, which is
          what makes the inset available at all. */}
      <div
        className={`max-w-2xl mx-auto px-5 ${compact ? "pb-4" : "pb-7"}`}
        style={{ paddingTop: "max(1.25rem, calc(env(safe-area-inset-top) + 0.5rem))" }}
      >
        {/* Compact puts the back button on the same row as the title instead
            of stacking it above. On a screen that has to fit without scrolling
            — the flashcard deck — that row is worth about 50px. */}
        {compact ? (
          <div className="flex items-center gap-2.5">
            {onBack && (
              <button
                onClick={onBack}
                aria-label={backLabel}
                className="shrink-0 bg-white/10 hover:bg-white/20 active:bg-white/25 rounded-xl p-2 transition"
              >
                <ChevronLeft size={20} className="text-emerald-400" strokeWidth={2.5} />
              </button>
            )}
            <div className="min-w-0 flex-1">
              <h1 className="text-xl font-black tracking-tight leading-tight truncate">{title}</h1>
              {subtitle && (
                <p className="text-xs text-slate-400 leading-tight truncate">{subtitle}</p>
              )}
            </div>
            {right}
          </div>
        ) : (
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              {onBack && (
                <button
                  onClick={onBack}
                  className="inline-flex items-center gap-1.5 bg-white/10 hover:bg-white/20 active:bg-white/25 rounded-xl pl-2 pr-3.5 py-2 mb-4 transition"
                >
                  <ChevronLeft size={20} className="text-emerald-400" strokeWidth={2.5} />
                  <span className="text-sm font-bold text-white">{backLabel}</span>
                </button>
              )}
              <h1 className="text-2xl font-black tracking-tight leading-tight">{title}</h1>
              {subtitle && <p className="mt-1.5 text-sm text-slate-300">{subtitle}</p>}
            </div>
            {right}
          </div>
        )}

        {/* Anything the screen wants inside the dark header — a progress strip,
            say — rather than as another card taking vertical space below. */}
        {below}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------------- */
/* The standard page body. `pb-28` clears the tab bar.

   `fill` is for screens that take over the whole display and have no tab bar —
   the flashcard deck. It becomes a flex column that grows to the bottom of the
   viewport, so a screen with little content can stretch one block to fill the
   gap instead of leaving dead space under it. The bottom padding drops to the
   home-indicator inset, since there's no tab bar to clear. */
export function Screen({ children, fill }) {
  if (fill) {
    return (
      <div
        className="max-w-2xl mx-auto px-5 pt-4 flex-1 flex flex-col w-full"
        style={{ paddingBottom: "max(1rem, calc(env(safe-area-inset-bottom) + 0.5rem))" }}
      >
        {children}
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto px-5 pt-4 pb-28">
      {children}
    </div>
  );
}

/* Wraps a header and a `fill` Screen so the two together are exactly one
   viewport tall, which is what lets the Screen's flex-1 child have a real
   height to grow into.

   100dvh rather than 100vh: on mobile Safari, 100vh is the height with the
   address bar hidden, so a 100vh layout sits taller than what you can actually
   see and the bottom of it is cut off until you scroll. */
export function FullScreen({ children }) {
  return (
    <div className="flex flex-col" style={{ minHeight: "100dvh" }}>
      {children}
    </div>
  );
}

/* A tappable row with an icon, a label and an optional progress bar.
   Used for sections and for modules — the blueprint's list rows. */
export function Tile({
  icon: Icon, label, blurb, onClick, locked, pct, showBar,
  meta, tone = "emerald",
}) {
  const toneBg = {
    emerald: "bg-emerald-500",
    blue: "bg-blue-500",
    amber: "bg-amber-500",
    slate: "bg-slate-400",
  }[tone] || "bg-emerald-500";

  return (
    <button
      onClick={locked ? undefined : onClick}
      disabled={locked}
      className={`w-full text-left bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl p-4 flex items-start gap-3.5 transition
        ${locked
          ? "opacity-55 cursor-not-allowed"
          : "hover:border-emerald-400 dark:hover:border-emerald-500 active:scale-[0.99]"}`}
    >
      {Icon && (
        <div className={`w-10 h-10 rounded-xl ${locked ? "bg-slate-300 dark:bg-slate-600" : toneBg} flex items-center justify-center shrink-0`}>
          {locked ? <Lock size={18} className="text-white" /> : <Icon size={18} className="text-white" />}
        </div>
      )}

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="font-bold text-slate-900 dark:text-white truncate">{label}</span>
          {locked && (
            <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-slate-200 dark:bg-slate-700 text-slate-500 dark:text-slate-400 shrink-0">
              Coming soon
            </span>
          )}
        </div>

        {blurb && (
          <p className="mt-0.5 text-sm text-slate-500 dark:text-slate-400 leading-snug">{blurb}</p>
        )}

        {showBar && !locked && (
          <div className="mt-2.5">
            <div className="flex justify-between text-[11px] font-bold text-slate-400 mb-1">
              <span>{meta || "Best score"}</span>
              <span>{pct > 0 ? `${pct}%` : "Not started"}</span>
            </div>
            <ProgressBar pct={pct} tone={pct > 0 ? tone : "slate"} />
          </div>
        )}
      </div>

      {!locked && (
        <ChevronRight size={18} className="text-slate-300 dark:text-slate-600 shrink-0 mt-2.5" />
      )}
    </button>
  );
}

/* ------------------------------------------------------------------------- */
export function EmptyState({ icon: Icon, title, message }) {
  return (
    <div className="text-center py-12 px-6">
      {Icon && (
        <div className="w-14 h-14 rounded-2xl bg-slate-100 dark:bg-slate-800 flex items-center justify-center mx-auto mb-4">
          <Icon size={24} className="text-slate-400" />
        </div>
      )}
      <h2 className="font-bold text-slate-900 dark:text-white">{title}</h2>
      <p className="mt-1.5 text-sm text-slate-500 dark:text-slate-400 max-w-xs mx-auto leading-relaxed">
        {message}
      </p>
    </div>
  );
}

/* ------------------------------------------------------------------------- */
export function PrimaryButton({ children, onClick, disabled, full = true }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`${full ? "w-full" : ""} bg-emerald-500 hover:bg-emerald-400 disabled:opacity-50 disabled:hover:bg-emerald-500 text-slate-900 font-bold py-3 px-6 rounded-xl transition`}
    >
      {children}
    </button>
  );
}

export function SecondaryButton({ children, onClick, full = true }) {
  return (
    <button
      onClick={onClick}
      className={`${full ? "w-full" : ""} bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 hover:border-slate-300 text-slate-700 dark:text-slate-200 font-bold py-3 px-6 rounded-xl transition`}
    >
      {children}
    </button>
  );
}

/* ===========================================================================
   SETTINGS CONTROLS
   =========================================================================== */

/* A proper switch, not a row that says "On".

   Built on a real <button> with role="switch" and aria-checked, so a screen
   reader announces it as a switch and says which way it's set. A styled <div>
   would look identical and tell an assistive user nothing.

   The 44px minimum height is the smallest reliable tap target on a phone; the
   track itself is smaller than that, so the padding does the work. */
export function Toggle({ checked, onChange, label, description, icon: Icon }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className="w-full px-4 py-3.5 flex items-center gap-3 text-left min-h-[56px]"
    >
      {Icon && (
        <Icon
          size={18}
          className={checked ? "text-emerald-500 shrink-0" : "text-slate-400 shrink-0"}
        />
      )}

      <span className="min-w-0 flex-1">
        <span className="block font-semibold text-slate-900 dark:text-white">
          {label}
        </span>
        {description && (
          <span className="block text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            {description}
          </span>
        )}
      </span>

      {/* The track. aria-hidden because the button above already carries the
          state — without this a screen reader reads the switch twice. */}
      <span
        aria-hidden="true"
        className={`relative shrink-0 w-[52px] h-[31px] rounded-full transition-colors duration-200 ${
          checked ? "bg-emerald-500" : "bg-slate-300 dark:bg-slate-600"
        }`}
      >
        <span
          className={`absolute top-[3px] left-[3px] w-[25px] h-[25px] rounded-full bg-white shadow-sm transition-transform duration-200 ${
            checked ? "translate-x-[21px]" : "translate-x-0"
          }`}
        />
      </span>
    </button>
  );
}

/* A destructive action. Red, outlined rather than filled.

   Filled red reads as the primary thing to do on the screen, which is the
   opposite of true for "delete everything". Outlined is unmistakably a warning
   without inviting the tap. */
export function DangerButton({ children, onClick, full = true }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`${full ? "w-full" : ""} border-2 border-red-500 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/40 active:bg-red-100 dark:active:bg-red-950/60 font-bold py-3 px-6 rounded-xl transition`}
    >
      {children}
    </button>
  );
}

/* A group of settings rows, hairline-separated. */
export function SettingsGroup({ title, children }) {
  return (
    <div className="mt-5">
      {title && (
        <p className="mb-2 px-1 text-[11px] font-bold uppercase tracking-widest text-slate-400">
          {title}
        </p>
      )}
      <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl divide-y divide-slate-100 dark:divide-slate-700 overflow-hidden">
        {children}
      </div>
    </div>
  );
}
