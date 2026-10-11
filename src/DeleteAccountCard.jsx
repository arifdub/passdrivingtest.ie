/*
  ===========================================================================
  DELETE MY ACCOUNT

  One card, shared by the learner's Settings screen and the instructor's
  Account screen, for the same reason IncomingBookings and BookingCard are
  shared between the dashboard and the Bookings tab: this is one of the
  highest-consequence buttons in the app, and two implementations of "are
  you sure, and here is exactly what goes" would drift — differently
  worded, differently honest, on the two sides of the same account system.

  THE WARNING IS SPECIFIC ON PURPOSE

  "This cannot be undone" is true of almost every destructive action and
  persuades nobody of anything. What is said here instead is what this
  project's own schema actually does (see api/delete-account.js for the
  full account): everything tied to this account goes, including —
  this is the part worth a person's full attention — EVERY BOOKING THIS
  ACCOUNT WAS EVER PART OF, on both sides. An instructor deleting their
  account removes a learner's record of lessons that happened; a learner
  deleting theirs removes an instructor's record and earnings history for
  the same lessons. That is not a possible side effect to hedge about; it
  is exactly what `on delete cascade` on both sides of bookings.instructor_id
  and bookings.learner_id does, and a person agreeing to delete their own
  account is entitled to know it affects someone else's records too.

  Two taps, like every other destructive action in this app (see
  ProfileScreen's own "Reset my progress", which this follows) — PLUS a
  typed phrase for this one specifically, because signing out of every
  device and losing every conversation and booking is a larger loss than
  a quiz score, and a typed word is a different, slower kind of agreement
  than a second tap.
  ===========================================================================
*/

import React, { useState } from "react";
import { AlertTriangle, Check, Loader2, Trash2 } from "lucide-react";
import { DangerButton } from "./ui";
import { deleteMyAccount } from "./deleteAccount";

const PHRASE = "DELETE";

/* Pulled out so it is testable without a DOM — this project's tests run
   in plain Node, with no jsdom (see src/theme.js and src/PushNudge.jsx for
   the same pattern). Case-insensitive on purpose: the word is the bar, not
   whether caps lock happened to be on. What is actually SENT to the server
   is always the fixed literal "DELETE" regardless of what was typed here —
   see deleteMyAccount — so this only ever gates the button, never becomes
   the value trusted server-side. */
export function confirmMatches(typed) {
  return String(typed ?? "").trim().toUpperCase() === PHRASE;
}

export default function DeleteAccountCard({ role, onDeleted }) {
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [done, setDone] = useState(false);

  const isInstructor = role === "instructor";

  async function confirm() {
    setBusy(true);
    setError(null);
    const r = await deleteMyAccount();
    setBusy(false);
    if (!r.ok) { setError(r.error); return; }
    /* The account is already gone on the server — there is no "undo" to
       race with here, unlike the reset-progress card this otherwise
       follows. A brief, unmissable confirmation, then hand control to the
       caller, which signs out and lets the app's own router take it from
       there — the same path an ordinary sign-out already takes. */
    setDone(true);
    setTimeout(() => onDeleted?.(), 1800);
  }

  if (done) {
    return (
      <div className="px-4 py-4">
        <div className="rounded-xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-900 px-3.5 py-3 flex items-center gap-2.5">
          <Check size={16} className="text-emerald-600 dark:text-emerald-400 shrink-0" />
          <p className="text-sm font-semibold text-emerald-700 dark:text-emerald-400">
            Account deleted. Signing you out…
          </p>
        </div>
      </div>
    );
  }

  if (!open) {
    return (
      <div className="px-4 py-4">
        <div className="flex items-center gap-3">
          <Trash2 size={18} className="text-red-500 shrink-0" />
          <div className="min-w-0 flex-1">
            <p className="font-semibold text-slate-900 dark:text-white">Delete my account</p>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              Removes your profile, {isInstructor ? "students, " : ""}
              bookings and messages permanently
            </p>
          </div>
        </div>
        <div className="mt-3.5">
          <DangerButton onClick={() => setOpen(true)}>
            <span className="inline-flex items-center gap-2">
              <Trash2 size={16} /> Delete my account
            </span>
          </DangerButton>
        </div>
      </div>
    );
  }

  return (
    <div className="px-4 py-4">
      <div className="rounded-xl bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900 p-3.5">
        <div className="flex gap-2.5">
          <AlertTriangle size={17} className="text-red-500 shrink-0 mt-0.5" />
          <div className="min-w-0">
            <p className="font-bold text-slate-900 dark:text-white text-sm">
              This deletes everything, for everyone involved
            </p>
            <p className="mt-1 text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
              Your profile, {isInstructor && "your students, your availability, "}
              every message you sent and every booking you were part of —
              gone, immediately, with no way back.
            </p>
            {/* The part a confirm dialog usually leaves out: this is not
                only your own data. */}
            <p className="mt-2 text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
              {isInstructor
                ? "A learner you taught loses their record of lessons with you — the booking itself, not just your side of it."
                : "An instructor you booked loses their record of that lesson too — including it in their earnings history, not just your side of it."}
            </p>
          </div>
        </div>

        <label className="mt-3.5 block">
          <span className="text-xs font-semibold text-slate-600 dark:text-slate-300">
            Type <span className="font-mono font-bold text-red-600 dark:text-red-400">{PHRASE}</span> to confirm
          </span>
          <input
            type="text"
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            autoCapitalize="characters"
            autoCorrect="off"
            spellCheck={false}
            className="mt-1.5 w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3.5 py-2.5 text-sm font-mono tracking-widest text-slate-900 dark:text-white"
            placeholder={PHRASE}
          />
        </label>

        {error && (
          <p className="mt-2.5 text-xs text-red-600 dark:text-red-400">{error}</p>
        )}

        <div className="mt-3.5 flex gap-2.5">
          <button
            onClick={() => { setOpen(false); setTyped(""); setError(null); }}
            disabled={busy}
            className="flex-1 border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 font-bold py-3 rounded-xl disabled:opacity-50"
          >
            Keep my account
          </button>
          <button
            onClick={confirm}
            disabled={busy || !confirmMatches(typed)}
            className="flex-1 bg-red-500 hover:bg-red-600 disabled:bg-red-300 dark:disabled:bg-red-900 disabled:cursor-not-allowed text-white font-bold py-3 rounded-xl transition inline-flex items-center justify-center gap-2"
          >
            {busy ? <Loader2 size={16} className="animate-spin" /> : null}
            {busy ? "Deleting…" : "Delete permanently"}
          </button>
        </div>
      </div>
    </div>
  );
}
