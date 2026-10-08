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
import {
  CalendarCheck, Clock, MapPin, Check, X, Loader2, AlertCircle, Inbox,
} from "lucide-react";
import { useAuth } from "../appAuth";
import { EmptyState, PrimaryButton, SecondaryButton } from "../ui";
import { Sheet, Field } from "./Students";
import {
  receivedBookings, acceptBooking, declineBooking,
  slotTime, slotDay, isPast, BOOKING_STATUS,
} from "../bookingStore";
import { KIND_LABEL, euro } from "./teachingStore";

export default function Bookings({ onAccepted }) {
  const { user } = useAuth();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(null);
  const [declining, setDeclining] = useState(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    const { rows: r, error: e } = await receivedBookings(user?.id);
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

  /* Requests first, because they are the only thing here needing an answer.
     Everything else is history and sorts newest-first under it. */
  const waiting = rows.filter(b => b.status === "requested" && !isPast(b));
  const rest = rows
    .filter(b => !(b.status === "requested" && !isPast(b)))
    .sort((a, b) => new Date(b.starts_at) - new Date(a.starts_at));

  const act = async (id, fn) => {
    setBusy(id);
    const { ok, error: e } = await fn();
    setBusy(null);
    if (!ok) { setError(e); return false; }
    await refresh();
    return true;
  };

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
      {waiting.length > 0 && (
        <>
          <h2 className="font-black tracking-tight text-slate-900 dark:text-white">
            Waiting on you
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            {waiting.length === 1 ? "One request" : `${waiting.length} requests`} — the
            hour stays held until you answer.
          </p>
          <div className="mt-3 space-y-2">
            {waiting.map(b => (
              <Card key={b.id} booking={b}>
                <div className="mt-3 flex gap-2">
                  <button
                    disabled={busy === b.id}
                    onClick={() => act(b.id, () => acceptBooking(b.id)).then(ok => ok && onAccepted?.())}
                    className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 disabled:opacity-50 text-slate-900 font-bold py-2.5 text-sm transition"
                  >
                    <Check size={16} /> {busy === b.id ? "…" : "Accept"}
                  </button>
                  <button
                    disabled={busy === b.id}
                    onClick={() => setDeclining(b)}
                    className="shrink-0 inline-flex items-center justify-center gap-1.5 rounded-xl border border-slate-200 dark:border-slate-600 text-slate-600 dark:text-slate-300 font-bold px-4 py-2.5 text-sm"
                  >
                    <X size={16} /> Decline
                  </button>
                </div>
              </Card>
            ))}
          </div>
        </>
      )}

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

      {declining && (
        <DeclineSheet
          booking={declining}
          onClose={() => setDeclining(null)}
          onDecline={async (reason) => {
            const ok = await act(declining.id, () => declineBooking(declining.id, reason));
            if (ok) setDeclining(null);
            return ok;
          }}
        />
      )}
    </>
  );
}

/* ------------------------------------------------------------------------- */

const TONE = {
  amber: "bg-amber-50 dark:bg-amber-950/50 text-amber-700 dark:text-amber-300",
  green: "bg-emerald-50 dark:bg-emerald-950/50 text-emerald-700 dark:text-emerald-300",
  slate: "bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300",
};

function Card({ booking: b, muted, children }) {
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

function DeclineSheet({ booking, onClose, onDecline }) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const at = new Date(booking.starts_at);

  return (
    <Sheet title="Decline this request" onClose={onClose}>
      <p className="text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
        {slotDay(at)} at {slotTime(at)}. The hour goes back into your open
        slots straight away.
      </p>

      <div className="mt-4">
        <Field
          label="Reason"
          value={reason}
          onChange={setReason}
          placeholder="Optional — the learner sees this"
          hint="A line here saves someone guessing whether it was the time, the area, or them."
        />
      </div>

      <div className="mt-5 space-y-2">
        <PrimaryButton
          disabled={busy}
          onClick={async () => { setBusy(true); await onDecline(reason); setBusy(false); }}
        >
          {busy ? "…" : "Decline"}
        </PrimaryButton>
        <SecondaryButton onClick={onClose}>Keep it</SecondaryButton>
      </div>
    </Sheet>
  );
}
