/*
  ===========================================================================
  THE LEARNER'S OWN BOOKINGS

  Shown above the instructor list, because someone who has already asked for
  an hour opens this screen to find out what happened to it, not to search
  again.

  WHY A HELD HOUR IS NOT A CONFIRMED ONE, SAID TWICE

  A learner who reads "booked" and rearranges their afternoon around an hour
  the instructor has not accepted has been misled by this screen. So a
  request says "waiting", in those words, and only an accepted one says
  confirmed.
  ===========================================================================
*/

import React, { useState, useEffect, useCallback } from "react";
import { CalendarCheck, Clock3, X, Loader2, MapPin, Phone } from "lucide-react";
import { myBookings, cancelBooking, slotDay, slotTime, isPast } from "./bookingStore";
import { LESSON_LABELS, euro } from "./marketplace";

export default function MyBookings({ learnerId }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    const { rows: r, error: e } = await myBookings(learnerId);
    setRows(r); setError(e); setLoading(false);
  }, [learnerId]);

  useEffect(() => { refresh(); }, [refresh]);

  /* Anything over is history, and history belongs somewhere else. This block
     is about what is still ahead, so it disappears entirely when nothing is —
     an empty panel saying "no bookings" above a list of instructors is just
     something to scroll past. */
  const live = rows.filter(
    b => ["requested", "accepted"].includes(b.status) && !isPast(b)
  );

  if (loading && !rows.length) return null;
  if (error || !live.length) return null;

  return (
    <div className="mb-5">
      <h2 className="font-black tracking-tight text-slate-900 dark:text-white">
        Your lessons
      </h2>
      <div className="mt-2 space-y-2">
        {live.map(b => {
          const at = new Date(b.starts_at);
          const waiting = b.status === "requested";
          return (
            <div
              key={b.id}
              className={`rounded-2xl border p-4 ${
                waiting
                  ? "border-amber-200 dark:border-amber-900 bg-amber-50 dark:bg-amber-950/40"
                  : "border-emerald-200 dark:border-emerald-900 bg-emerald-50 dark:bg-emerald-950/40"
              }`}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-bold text-slate-900 dark:text-white tabular-nums">
                    {slotDay(at)}, {slotTime(at)}
                  </p>
                  <p className="text-xs text-slate-600 dark:text-slate-300 truncate">
                    {b.instructor?.full_name || "Your instructor"}
                    {" · "}{LESSON_LABELS[b.kind] || b.kind}
                    {b.price_cents ? ` · ${euro(b.price_cents)}` : ""}
                  </p>
                </div>
                <span className={`shrink-0 inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-bold ${
                  waiting
                    ? "bg-amber-100 dark:bg-amber-900/60 text-amber-800 dark:text-amber-200"
                    : "bg-emerald-100 dark:bg-emerald-900/60 text-emerald-800 dark:text-emerald-200"
                }`}>
                  {waiting ? <Clock3 size={12} /> : <CalendarCheck size={12} />}
                  {waiting ? "Waiting" : "Confirmed"}
                </span>
              </div>

              <p className="mt-2 text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
                {waiting
                  ? "The hour is held while they decide. Don't plan around it until it's confirmed."
                  : "Confirmed. They'll collect you at the time above."}
              </p>

              {b.pickup && (
                <p className="mt-1.5 text-xs text-slate-600 dark:text-slate-300 flex items-start gap-1.5">
                  <MapPin size={12} className="shrink-0 mt-0.5 text-slate-400" /> {b.pickup}
                </p>
              )}
              {!waiting && b.instructor?.phone && (
                <p className="mt-1 text-xs text-slate-600 dark:text-slate-300 flex items-center gap-1.5">
                  <Phone size={12} className="shrink-0 text-slate-400" /> {b.instructor.phone}
                </p>
              )}

              <button
                disabled={busy === b.id}
                onClick={async () => {
                  setBusy(b.id);
                  const { ok, error: e } = await cancelBooking(b.id);
                  setBusy(null);
                  if (ok) refresh(); else setError(e);
                }}
                className="mt-3 inline-flex items-center gap-1.5 text-xs font-bold text-slate-500 dark:text-slate-400 hover:text-red-500 disabled:opacity-50"
              >
                {busy === b.id
                  ? <Loader2 size={13} className="animate-spin" />
                  : <X size={13} />}
                {waiting ? "Withdraw this request" : "Cancel this lesson"}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
