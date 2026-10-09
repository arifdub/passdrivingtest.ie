/*
  ===========================================================================
  ENQUIRIES

  Learners who found this instructor in the marketplace and asked about
  lessons. The first thing on this platform that arrives from the other side.

  WHAT A REPLY IS, HERE

  A phone call. There is no messaging, so "Answered" does not send anything —
  it marks the enquiry as dealt with so the queue stops showing it as new.
  The button says Call rather than Reply for that reason: a button labelled
  Reply that opens a phone dialler is a small lie that costs someone a
  confused tap.

  DECLINING IS NOT RUDE, IT IS INFORMATION

  A learner's card in the marketplace says "they couldn't take this on"
  rather than leaving them waiting on a reply that is never coming. An
  instructor with a full book does a learner more good by saying so.
  ===========================================================================
*/

import React, { useState, useEffect, useCallback } from "react";
import {
  MessageSquare, Phone, MapPin, Check, X, Loader2, AlertCircle, RefreshCw,
  UserPlus,
} from "lucide-react";
import { useAuth } from "../appAuth";
import { EmptyState, PrimaryButton, SecondaryButton } from "../ui";
import { receivedEnquiries, setEnquiryStatus } from "../marketplace";
import { addStudent } from "./teachingStore";
import { when } from "../admin/reviewStore";

const QUEUES = [
  { id: "new",      label: "New",      blurb: "Not dealt with yet" },
  { id: "answered", label: "Answered", blurb: "You've been in touch" },
  { id: "declined", label: "Declined", blurb: "You couldn't take them on" },
];

export default function Enquiries({ onAddedStudent, onChanged }) {
  const { user } = useAuth();
  const [queue, setQueue] = useState("new");
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    const { rows: r, error: e } = await receivedEnquiries(user?.id);
    setRows(r);
    setError(e);
    setLoading(false);
    /* An answered enquiry stops being outstanding, and the bar's count
       lives a level up. */
    onChanged?.();
  }, [onChanged, user?.id]);

  useEffect(() => { refresh(); }, [refresh]);

  const counts = rows.reduce((a, r) => ({ ...a, [r.status]: (a[r.status] || 0) + 1 }), {});
  const shown = rows.filter(r => r.status === queue);

  return (
    <>
      <div className="flex gap-1.5 overflow-x-auto pb-2 -mx-1 px-1">
        {QUEUES.map(q => {
          const on = q.id === queue;
          const n = counts[q.id];
          return (
            <button
              key={q.id}
              onClick={() => setQueue(q.id)}
              className={`shrink-0 inline-flex items-center gap-2 rounded-full px-3.5 py-2 text-xs font-bold transition ${
                on ? "bg-emerald-500 text-slate-900"
                   : "bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-700"
              }`}
            >
              {q.label}
              {n > 0 && (
                <span className={`tabular-nums rounded-full px-1.5 py-0.5 text-[10px] ${
                  on ? "bg-slate-900/15" : "bg-slate-100 dark:bg-slate-700"
                }`}>{n}</span>
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
            <p className="font-semibold">Couldn't read your enquiries.</p>
            <p className="mt-0.5 opacity-90">{error}</p>
            <p className="mt-1.5 opacity-75 text-xs">
              If this says the relation doesn't exist, sql/09-enquiries.sql
              hasn't been run yet.
            </p>
          </div>
        </div>
      )}

      {!loading && shown.length === 0 && !error && (
        <div className="mt-4 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl p-8">
          <EmptyState
            icon={MessageSquare}
            title={queue === "new" ? "No new enquiries" : `Nothing ${queue}`}
            message={
              queue === "new"
                ? "Learners who find you in the marketplace appear here. You have to be verified and listed to be found."
                : "Nothing in this queue yet."
            }
          />
        </div>
      )}

      <div className="mt-4 space-y-3">
        {shown.map(row => (
          <EnquiryCard key={row.id} row={row} onDone={refresh} onAddedStudent={onAddedStudent} />
        ))}
      </div>
    </>
  );
}

function EnquiryCard({ row, onDone, onAddedStudent }) {
  const { user } = useAuth();
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState(null);
  const [added, setAdded] = useState(false);

  /* The whole point of an enquiry. Everything the learner typed is already
     here, so retyping it into the student form would be busywork — and
     busywork is where a name gets spelled two different ways.

     learner_id carries across, which is what links this student to a
     platform account, and source 'marketplace' is what will one day decide
     the fee. An instructor's own students stay free, forever; that promise
     needs this column to be right from the first row. */
  async function keepAsStudent() {
    setBusy(true); setProblem(null);
    const r = await addStudent(user?.id, {
      learner_id: row.learner_id,
      full_name: row.learner_name || "Learner",
      phone: row.learner_phone,
      area: row.area,
      notes: row.message,
      source: "marketplace",
    });
    setBusy(false);
    if (!r.ok) { setProblem(r.error); return; }
    setAdded(true);
    if (row.status === "new") await setEnquiryStatus(row.id, "answered");
    await onDone();
    onAddedStudent?.();
  }

  async function mark(status) {
    setBusy(true);
    setProblem(null);
    const r = await setEnquiryStatus(row.id, status);
    setBusy(false);
    if (!r.ok) { setProblem(r.error); return; }
    await onDone();
  }

  return (
    <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl p-5">
      <div className="flex items-start justify-between gap-3">
        <h3 className="font-black text-slate-900 dark:text-white truncate">
          {row.learner_name || "A learner"}
        </h3>
        <span className="shrink-0 text-[10px] font-bold uppercase tracking-widest text-slate-400">
          {when(row.created_at)}
        </span>
      </div>

      {row.area && (
        <p className="mt-1.5 flex items-center gap-2 text-sm text-slate-600 dark:text-slate-300">
          <MapPin size={14} className="text-slate-400 shrink-0" /> {row.area}
        </p>
      )}

      {row.message && (
        <p className="mt-2.5 text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
          {row.message}
        </p>
      )}

      {row.learner_phone && (
        <a
          href={`tel:${row.learner_phone.replace(/\s+/g, "")}`}
          className="mt-3 inline-flex items-center gap-2 text-sm font-bold text-emerald-700 dark:text-emerald-400"
        >
          <Phone size={15} /> {row.learner_phone}
        </a>
      )}

      {problem && (
        <div className="mt-3 flex items-start gap-2 text-sm bg-red-50 dark:bg-red-950/40 text-red-700 dark:text-red-300 rounded-xl px-3 py-2">
          <AlertCircle size={15} className="mt-0.5 shrink-0" />
          <span>{problem}</span>
        </div>
      )}

      {added && (
        <p className="mt-3 flex items-center gap-2 text-sm font-semibold text-emerald-700 dark:text-emerald-400">
          <Check size={15} /> Added to your students
        </p>
      )}

      {row.status !== "declined" && !added && (
        <div className="mt-4 flex flex-wrap gap-2">
          <PrimaryButton full={false} disabled={busy} onClick={keepAsStudent}>
            <span className="inline-flex items-center gap-2">
              {busy ? <Loader2 size={15} className="animate-spin" /> : <UserPlus size={15} />}
              Take them on
            </span>
          </PrimaryButton>
          {row.status === "new" && (
            <>
              <SecondaryButton full={false} onClick={() => mark("answered")}>
                <span className="inline-flex items-center gap-2"><Check size={15} /> Just answered</span>
              </SecondaryButton>
              <SecondaryButton full={false} onClick={() => mark("declined")}>
                <span className="inline-flex items-center gap-2"><X size={15} /> Can't take this on</span>
              </SecondaryButton>
            </>
          )}
        </div>
      )}
    </div>
  );
}
