/*
  ===========================================================================
  INSTRUCTOR REVIEW  —  /admin, Instructors

  The other half of registration. An instructor fills in their ADI number and
  submits; until now the only way to act on that was an UPDATE typed into the
  Supabase SQL editor, which is fine for the first instructor and wrong by the
  tenth.

  WHAT A REVIEWER IS ACTUALLY DOING

  Opening the RSA's published register in another tab and checking that the
  number belongs to the name in front of them. So the card leads with those
  two, large, and the number is selectable text rather than something to
  re-type. Everything else — areas, rates, what they teach — is detail that
  matters later and sits below.

  WHY REJECTING DEMANDS A REASON

  The instructor sees it. The portal's rejected card shows verification_notes
  verbatim, and "rejected" with nothing attached is a dead end for someone who
  may simply have mistyped a digit. The button stays disabled until something
  is written.

  WHAT THIS SCREEN CANNOT DO

  Verify anyone it shouldn't. Every write goes through the trigger in sql/06:
  a non-admin is refused, and an admin is refused on their own row. If the
  file hasn't been run, the buttons fail with the database's own message
  rather than appearing to work.
  ===========================================================================
*/

import React, { useState, useEffect, useCallback } from "react";
import {
  BadgeCheck, ShieldAlert, Clock3, Loader2, AlertCircle, Mail, Phone,
  MapPin, Car, Undo2, RefreshCw,
} from "lucide-react";
import { useAuth } from "../appAuth";
import { EmptyState, PrimaryButton, SecondaryButton } from "../ui";
import {
  QUEUES, loadQueue, countsByStatus, approve, reject, suspend, returnToQueue,
  euro, when, waitingFor,
} from "./reviewStore";

export default function InstructorReview() {
  const [queue, setQueue] = useState("pending");
  const [rows, setRows] = useState([]);
  const [counts, setCounts] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    const [{ rows: r, error: e }, c] = await Promise.all([
      loadQueue(queue),
      countsByStatus(),
    ]);
    setRows(r);
    setCounts(c);
    setError(e);
    setLoading(false);
  }, [queue]);

  useEffect(() => { refresh(); }, [refresh]);

  return (
    <>
      {/* The queues, with how many are in each. The count on "Waiting" is the
          one number an admin opens this screen for. */}
      <div className="flex gap-1.5 overflow-x-auto pb-2 -mx-1 px-1">
        {QUEUES.map(q => {
          const on = q.id === queue;
          const n = counts[q.id];
          return (
            <button
              key={q.id}
              onClick={() => setQueue(q.id)}
              className={`shrink-0 inline-flex items-center gap-2 rounded-full px-3.5 py-2 text-xs font-bold transition ${
                on
                  ? "bg-emerald-500 text-slate-900"
                  : "bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-700"
              }`}
            >
              {q.label}
              {n > 0 && (
                <span className={`tabular-nums rounded-full px-1.5 py-0.5 text-[10px] ${
                  on ? "bg-slate-900/15" : "bg-slate-100 dark:bg-slate-700"
                }`}>
                  {n}
                </span>
              )}
            </button>
          );
        })}

        <button
          onClick={refresh}
          aria-label="Refresh"
          className="shrink-0 ml-auto inline-flex items-center justify-center w-9 h-9 rounded-full bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-500"
        >
          <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
        </button>
      </div>

      <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
        {QUEUES.find(q => q.id === queue)?.blurb}
      </p>

      {error && (
        <div className="mt-4 flex items-start gap-2.5 bg-red-50 dark:bg-red-950/40 text-red-700 dark:text-red-300 rounded-2xl px-4 py-3 text-sm">
          <AlertCircle size={16} className="mt-0.5 shrink-0" />
          <div>
            <p className="font-semibold">Couldn't read the review queue.</p>
            <p className="mt-0.5 opacity-90">{error}</p>
            <p className="mt-1.5 opacity-75 text-xs">
              If this says the relation doesn't exist, sql/06-admin-verification.sql
              hasn't been run yet.
            </p>
          </div>
        </div>
      )}

      <div className="mt-4 space-y-3">
        {loading && rows.length === 0 && (
          <div className="flex items-center gap-2.5 text-sm text-slate-500 dark:text-slate-400 py-8 justify-center">
            <Loader2 size={16} className="animate-spin" /> Loading…
          </div>
        )}

        {!loading && rows.length === 0 && !error && (
          <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl p-8">
            <EmptyState
              icon={queue === "pending" ? Clock3 : BadgeCheck}
              title={queue === "pending" ? "Nothing waiting" : `No ${queue} instructors`}
              message={
                queue === "pending"
                  ? "Every submitted registration has been dealt with."
                  : "Nothing in this queue yet."
              }
            />
          </div>
        )}

        {rows.map(row => (
          <ReviewCard key={row.user_id} row={row} queue={queue} onDone={refresh} />
        ))}
      </div>
    </>
  );
}

/* ------------------------------------------------------------------------- */

function ReviewCard({ row, queue, onDone }) {
  const { user } = useAuth();
  const [mode, setMode] = useState(null);        // reject | suspend
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState(null);

  /* An admin may not decide their own. The database refuses it either way —
     this is so the buttons don't offer something that will fail. */
  const isSelf = user?.id && row.user_id === user.id;

  async function run(action) {
    setBusy(true);
    setProblem(null);
    const result = await action();
    setBusy(false);
    if (!result.ok) { setProblem(result.error); return; }
    setMode(null);
    setNotes("");
    await onDone();
  }

  const waited = waitingFor(row.updated_at);

  return (
    <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl p-5">
      {/* The two things being checked against the register, first and biggest. */}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="font-black text-slate-900 dark:text-white truncate">
            {row.full_name || <span className="text-slate-400">No name given</span>}
          </h3>
          {row.business_name && (
            <p className="text-sm text-slate-500 dark:text-slate-400 truncate">{row.business_name}</p>
          )}
        </div>
        {queue === "pending" && waited && (
          <span className="shrink-0 text-[10px] font-bold uppercase tracking-widest text-amber-600 dark:text-amber-400">
            {waited}
          </span>
        )}
      </div>

      {/* select-all because a reviewer pastes this into the RSA register, and
          re-typing a five-digit number is how the wrong one gets checked. */}
      <p className="mt-3 text-2xl font-black tracking-tight text-slate-900 dark:text-white select-all tabular-nums">
        {row.adi_number || <span className="text-base text-slate-400">No ADI number</span>}
      </p>
      <p className="text-xs text-slate-500 dark:text-slate-400">
        {row.adi_category ? `Category ${row.adi_category}` : "Check against the RSA register"}
        {row.years_experience ? ` · ${row.years_experience} years teaching` : ""}
      </p>

      <dl className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-2 text-sm">
        <Field icon={Mail} value={row.email} />
        <Field icon={Phone} value={row.phone} />
        <Field icon={MapPin} value={[
          (row.counties || []).join(", "),
          (row.service_areas || []).join(", "),
        ].filter(Boolean).join(" · ")} />
        <Field icon={Car} value={[
          (row.transmissions || []).join(" / "),
          (row.lesson_types || []).join(", "),
        ].filter(Boolean).join(" · ")} />
      </dl>

      <p className="mt-3 text-sm text-slate-600 dark:text-slate-300">
        {euro(row.hourly_rate_cents) ? `${euro(row.hourly_rate_cents)}/hour` : "No hourly rate"}
        {euro(row.edt_rate_cents) ? ` · ${euro(row.edt_rate_cents)} EDT` : ""}
      </p>

      {row.bio && (
        <p className="mt-3 text-sm text-slate-500 dark:text-slate-400 leading-relaxed">{row.bio}</p>
      )}

      {/* What a previous reviewer decided, and when. */}
      {row.verification_notes && (
        <p className="mt-3 text-sm bg-slate-50 dark:bg-slate-900 rounded-xl px-3 py-2 text-slate-600 dark:text-slate-300">
          {row.verification_notes}
        </p>
      )}
      {row.verified_at && (
        <p className="mt-2 text-xs text-emerald-600 dark:text-emerald-400 font-semibold">
          Verified {when(row.verified_at)}
        </p>
      )}

      {problem && (
        <div className="mt-3 flex items-start gap-2 text-sm bg-red-50 dark:bg-red-950/40 text-red-700 dark:text-red-300 rounded-xl px-3 py-2">
          <AlertCircle size={15} className="mt-0.5 shrink-0" />
          <span>{problem}</span>
        </div>
      )}

      {isSelf ? (
        <p className="mt-4 text-sm text-slate-500 dark:text-slate-400 bg-slate-50 dark:bg-slate-900 rounded-xl px-3 py-2.5">
          This is your own account. Someone else has to check it — that is what
          makes the badge worth anything.
        </p>
      ) : mode ? (
        <div className="mt-4">
          <label className="block text-xs font-bold uppercase tracking-widest text-slate-500 dark:text-slate-400">
            {mode === "reject" ? "Why — they will read this" : "Reason for suspending"}
          </label>
          <textarea
            value={notes}
            onChange={e => setNotes(e.target.value)}
            rows={3}
            autoFocus
            placeholder={mode === "reject"
              ? "That number isn't on the RSA register. Check it and submit again."
              : "Why this profile is being withdrawn."}
            className="mt-1.5 w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2.5 text-sm text-slate-900 dark:text-white"
          />
          <div className="mt-2.5 flex gap-2">
            <PrimaryButton
              full={false}
              disabled={busy || !notes.trim()}
              onClick={() => run(() =>
                (mode === "reject" ? reject : suspend)(row.user_id, notes))}
            >
              <span className="inline-flex items-center gap-2">
                {busy && <Loader2 size={15} className="animate-spin" />}
                {mode === "reject" ? "Send back" : "Suspend"}
              </span>
            </PrimaryButton>
            <SecondaryButton full={false} onClick={() => { setMode(null); setProblem(null); }}>
              Cancel
            </SecondaryButton>
          </div>
        </div>
      ) : (
        <div className="mt-4 flex flex-wrap gap-2">
          {queue !== "verified" && (
            <PrimaryButton full={false} disabled={busy}
                           onClick={() => run(() => approve(row.user_id))}>
              <span className="inline-flex items-center gap-2">
                {busy ? <Loader2 size={15} className="animate-spin" /> : <BadgeCheck size={15} />}
                Verify
              </span>
            </PrimaryButton>
          )}
          {queue === "pending" && (
            <SecondaryButton full={false} onClick={() => setMode("reject")}>
              Send back
            </SecondaryButton>
          )}
          {queue === "verified" && (
            <SecondaryButton full={false} onClick={() => setMode("suspend")}>
              <span className="inline-flex items-center gap-2"><ShieldAlert size={15} /> Suspend</span>
            </SecondaryButton>
          )}
          {(queue === "rejected" || queue === "suspended") && (
            <SecondaryButton full={false} disabled={busy}
                             onClick={() => run(() => returnToQueue(row.user_id))}>
              <span className="inline-flex items-center gap-2"><Undo2 size={15} /> Back to the queue</span>
            </SecondaryButton>
          )}
        </div>
      )}
    </div>
  );
}

function Field({ icon: Icon, value }) {
  if (!value) return null;
  return (
    <div className="flex items-start gap-2 min-w-0">
      <Icon size={14} className="text-slate-400 shrink-0 mt-0.5" />
      <span className="text-slate-600 dark:text-slate-300 break-words min-w-0">{value}</span>
    </div>
  );
}
