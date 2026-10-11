/*
  One booking, as a card.

  Lifted out of Bookings.jsx when the dashboard started showing incoming
  requests too. It lives in its own file rather than being exported from
  Bookings so that the list of requests can import it without importing
  the screen that contains that list — which would be a cycle, and ESM
  resolves those by handing one side a half-initialised module.
*/

import React from "react";
import { MapPin } from "lucide-react";
import { slotTime, slotDay, isPast, BOOKING_STATUS } from "../bookingStore";
import { KIND_LABEL, euro } from "./teachingStore";

const TONE = {
  amber: "bg-amber-50 dark:bg-amber-950/50 text-amber-700 dark:text-amber-300",
  green: "bg-emerald-50 dark:bg-emerald-950/50 text-emerald-700 dark:text-emerald-300",
  slate: "bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300",
};

export function Card({ booking: b, muted, children }) {
  const at = new Date(b.starts_at);
  /* A request whose hour has passed unanswered is not still waiting, whatever
     the column says — nobody is going to drive to it now. */
  const stale = b.status === "requested" && isPast(b);
  const s = stale
    ? { label: "Missed", tone: "slate" }
    : BOOKING_STATUS[b.status] || { label: b.status, tone: "slate" };

  return (
    <div className={`bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl p-4 ${muted ? "opacity-75" : ""}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-bold text-slate-900 dark:text-white tabular-nums">
            {slotDay(at)}, {slotTime(at)}
          </p>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            {KIND_LABEL[b.kind] || b.kind} · {b.duration_minutes} min
            {b.price_cents ? ` · ${euro(b.price_cents)}` : ""}
          </p>
        </div>
        <span className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-bold ${TONE[s.tone]}`}>
          {s.label}
        </span>
      </div>

      {b.pickup && (
        <p className="mt-2 text-sm text-slate-600 dark:text-slate-300 flex items-start gap-1.5">
          <MapPin size={14} className="shrink-0 mt-0.5 text-slate-400" /> {b.pickup}
        </p>
      )}
      {b.note && (
        <p className="mt-1.5 text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
          “{b.note}”
        </p>
      )}
      {b.resolution_note && (
        <p className="mt-1.5 text-xs text-slate-500 dark:text-slate-400">
          Reason given: {b.resolution_note}
        </p>
      )}

      {children}
    </div>
  );
}

/* Default, because both callers import it as the one thing this file is. */
export default Card;
