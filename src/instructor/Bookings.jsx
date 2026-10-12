/*
  ===========================================================================
  BOOKINGS — the instructor's side

  Requests from learners, to accept or decline. Accepting creates the student
  and the lesson in one database call (sql/12), so a confirmed booking is
  already in the calendar before this screen re-renders.

  WHY DECLINING ASKS FOR A REASON AND DOES NOT REQUIRE ONE

  A learner who is declined with nothing is left guessing whether it was the
  time, the area, or them. A reason costs the instructor five seconds and is
  worth a great deal at the other end — but making it mandatory just produces
  "no" typed into a box, so it is offered, not demanded.
  ===========================================================================
*/

import React, { useState, useEffect, useCallback } from "react";
import { Loader2, AlertCircle, Inbox } from "lucide-react";
import { useAuth } from "../appAuth";
import { EmptyState } from "../ui";
import Card from "./BookingCard";
import IncomingBookings from "./IncomingBookings";
import { receivedBookings, isPast } from "../bookingStore";

export default function Bookings({ onAccepted, onChanged }) {
  const { user } = useAuth();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    const { rows: r, error: e } = await receivedBookings(user?.id, { withLearners: true });
    setRows(r); setError(e); setLoading(false);
  }, [user?.id]);

  useEffect(() => { refresh(); }, [refresh]);

  if (loading) {
    return (
      <div className="flex items-center gap-2.5 text-slate-500 dark:text-slate-400 py-10 justify-center">
        <Loader2 size={18} className="animate-spin" />
        <span className="text-sm">Loading your requests…</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-2xl border border-amber-200 dark:border-amber-900 bg-amber-50 dark:bg-amber-950/40 p-5">
        <div className="flex items-center gap-2.5">
          <AlertCircle size={18} className="text-amber-500 shrink-0" />
          <h2 className="font-bold text-slate-900 dark:text-white">Bookings aren't set up yet</h2>
        </div>
        <p className="mt-2 text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
          Run <code className="font-mono text-xs">sql/12-bookings.sql</code> and reload.
        </p>
        <p className="mt-2 text-xs text-slate-500 dark:text-slate-400 font-mono break-all">{error}</p>
      </div>
    );
  }

  /* Requests needing an answer are rendered by IncomingBookings, which the
     dashboard also uses — accept and decline exist in one place only. What
     is left here is history, newest first. A request whose hour has passed
     belongs to history even though its status still says requested: nobody
     is driving to it now, and it shows as Missed. */
  const waiting = rows.filter(b => b.status === "requested" && !isPast(b));
  const rest = rows
    .filter(b => !(b.status === "requested" && !isPast(b)))
    .sort((a, b) => new Date(b.starts_at) - new Date(a.starts_at));

  if (!rows.length) {
    return (
      <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl p-8">
        <EmptyState
          icon={Inbox}
          title="No booking requests yet"
          message="Learners can request the hours you set under Availability. When one does, it lands here for you to accept or decline."
        />
      </div>
    );
  }

  return (
    <>
      <IncomingBookings
        onAccepted={onAccepted}
        /* Answering one changes the history list below as well as every
           count outside this screen. */
        onChanged={() => { refresh(); onChanged?.(); }}
      />

      {rest.length > 0 && (
        <>
          <h2 className={`font-black tracking-tight text-slate-900 dark:text-white ${waiting.length ? "mt-6" : ""}`}>
            Everything else
          </h2>
          <div className="mt-3 space-y-2">
            {rest.map(b => <Card key={b.id} booking={b} muted />)}
          </div>
        </>
      )}
    </>
  );
}
