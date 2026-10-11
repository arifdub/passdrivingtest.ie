/*
  ===========================================================================
  THE REQUESTS WAITING ON AN ANSWER

  This used to live inside the Bookings screen, which meant the dashboard
  could only point at it: "one learner is waiting on you", and a tap to go
  and find out who. Two taps and a screen change to answer a yes/no
  question is enough friction that answers come hours later, and the
  learner's hour sits held the whole time.

  It is one component used in two places rather than two copies, because
  accept and decline are the highest-consequence buttons in the portal —
  they create a student, put a lesson in a calendar, release a held hour
  and send email. Two implementations of that would drift, and the drift
  would be invisible until somebody was declined twice.

  `limit` is for the dashboard, which shows the first few and links to the
  rest. The Bookings screen passes nothing and shows them all.
  ===========================================================================
*/

import React, { useState, useEffect, useCallback } from "react";
import { Check, X, Loader2, ChevronRight } from "lucide-react";
import { useAuth } from "../appAuth";
import { PrimaryButton, SecondaryButton } from "../ui";
import { Sheet, Field } from "./Students";
import Card from "./BookingCard";
import {
  receivedBookings, acceptBooking, declineBooking,
  slotTime, slotDay, isPast,
} from "../bookingStore";

export default function IncomingBookings({
  limit,
  heading = true,
  onChanged,
  onAccepted,
  onSeeAll,
  /* Changes when the counts the portal holds change, which is how a
     booking arriving while this is already on screen gets into the list.
     Without it this fetched once and then sat there: the footer badge
     went to 1 and no card appeared under it. */
  refreshKey,
}) {
  const { user } = useAuth();
  const [waiting, setWaiting] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(null);
  const [declining, setDeclining] = useState(null);

  const refresh = useCallback(async () => {
    if (!user?.id) return;
    const { rows, error: e } = await receivedBookings(user.id);
    /* A request whose hour has already passed is not waiting on anybody —
       nobody is going to drive to it now. It stays in the full list on the
       Bookings screen, marked Missed. */
    setWaiting((rows || []).filter(b => b.status === "requested" && !isPast(b)));
    setError(e);
    setLoading(false);
  }, [user?.id, refreshKey]);

  useEffect(() => { refresh(); }, [refresh]);

  const act = async (id, fn) => {
    setBusy(id);
    const { ok, error: e } = await fn();
    setBusy(null);
    if (!ok) { setError(e); return false; }
    await refresh();
    /* The tab badge, the icon badge and the dashboard counts all read the
       same number, and none of them know this happened. */
    onChanged?.();
    return true;
  };

  /* Silence while loading, and silence when there is nothing. On the
     dashboard this sits between other cards, and a "no requests" panel
     there is a permanent reminder of an absence. */
  if (loading || (!waiting.length && !error)) return null;

  if (error) {
    return (
      <div className="rounded-2xl border border-amber-200 dark:border-amber-900 bg-amber-50 dark:bg-amber-950/40 p-4">
        <p className="text-sm font-bold text-slate-900 dark:text-white">
          Booking requests could not be loaded
        </p>
        <p className="mt-1 text-xs text-slate-500 dark:text-slate-400 font-mono break-all">
          {error}
        </p>
      </div>
    );
  }

  const shown = limit ? waiting.slice(0, limit) : waiting;
  const hidden = waiting.length - shown.length;

  return (
    <>
      {heading && (
        <>
          <h2 className="font-black tracking-tight text-slate-900 dark:text-white">
            Waiting on you
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            {waiting.length === 1 ? "One request" : `${waiting.length} requests`} — the
            hour stays held until you answer.
          </p>
        </>
      )}

      <div className={heading ? "mt-3 space-y-2" : "space-y-2"}>
        {shown.map(b => (
          <Card key={b.id} booking={b}>
            <div className="mt-3 flex gap-2">
              <button
                disabled={busy === b.id}
                onClick={() => act(b.id, () => acceptBooking(b.id)).then(ok => ok && onAccepted?.())}
                className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 disabled:opacity-50 text-slate-900 font-bold py-2.5 text-sm transition"
              >
                {busy === b.id ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />}
                {busy === b.id ? "…" : "Accept"}
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

      {hidden > 0 && (
        <button
          onClick={onSeeAll}
          className="mt-2 w-full inline-flex items-center justify-center gap-1 rounded-xl border border-slate-200 dark:border-slate-700 py-2.5 text-sm font-bold text-slate-600 dark:text-slate-300"
        >
          {hidden === 1 ? "One more request" : `${hidden} more requests`}
          <ChevronRight size={14} />
        </button>
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
          hint="A line here saves someone guessing whether it was the time, the area, or them. It is included in the email they get."
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
