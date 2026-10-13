/*
  ===========================================================================
  MESSAGES — the instructor's list of threads

  One thread per live booking, and one per learner request you have
  answered (sql/32). Not an open inbox: you can only talk to someone who
  booked with you or who posted a request you replied to.
  ===========================================================================
*/

import React, { useState, useEffect, useCallback } from "react";
import { MessageSquare, Loader2, AlertCircle, ChevronRight, Megaphone } from "lucide-react";
import { useAuth } from "../appAuth";
import { EmptyState } from "../ui";
import { Sheet } from "./Students";
import Thread from "../Thread";
import { receivedBookings, slotDay, slotTime, isPast } from "../bookingStore";
import { unreadByBooking } from "../socialStore";
import { KIND_LABEL } from "./teachingStore";
import { myThreads, ago } from "../lessonRequests";
import { LESSON_LABELS } from "../marketplace";
import { RequestConversation } from "./LearnerRequests";

export default function Messages({ onRead }) {
  const { user } = useAuth();
  const [rows, setRows] = useState([]);
  const [unread, setUnread] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [open, setOpen] = useState(null);
  const [threads, setThreads] = useState([]);
  const [openThread, setOpenThread] = useState(null);

  const refresh = useCallback(async () => {
    const [{ rows: r, error: e }, u, { rows: t }] = await Promise.all([
      receivedBookings(user?.id, { status: ["requested", "accepted"] }),
      unreadByBooking(user?.id),
      myThreads(),
    ]);
    setThreads(t.filter(x => x.i_am === "instructor"));
    /* A guest booking (sql/29) has nobody on the other end to read a
       thread — they booked with an email and a phone number instead. */
    setRows(r.filter(b => !isPast(b) && b.learner_id));
    setUnread(u);
    setError(e);
    setLoading(false);
  }, [user?.id]);

  useEffect(() => { refresh(); }, [refresh]);

  if (loading) {
    return (
      <div className="flex items-center gap-2.5 text-slate-500 dark:text-slate-400 py-10 justify-center">
        <Loader2 size={18} className="animate-spin" />
        <span className="text-sm">Loading your threads…</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-2xl border border-amber-200 dark:border-amber-900 bg-amber-50 dark:bg-amber-950/40 p-5">
        <div className="flex items-center gap-2.5">
          <AlertCircle size={18} className="text-amber-500 shrink-0" />
          <h2 className="font-bold text-slate-900 dark:text-white">Messages aren't set up yet</h2>
        </div>
        <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">
          Run <code className="font-mono text-xs">sql/13-reviews-and-messages.sql</code> and reload.
        </p>
      </div>
    );
  }

  const requestList = threads.length > 0 && (
    <div className="mb-5">
      <p className="mb-2 text-xs font-bold uppercase tracking-widest text-slate-400 inline-flex items-center gap-1.5">
        <Megaphone size={13} /> Learner requests you answered
      </p>
      <div className="space-y-2">
        {threads.map(t => (
          <button key={t.request_id}
            onClick={() => setOpenThread(t)}
            className="w-full text-left bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl p-4 flex items-center gap-3">
            <div className="flex-1 min-w-0">
              <p className="flex items-baseline gap-2">
                <span className="flex-1 truncate font-bold text-sm text-slate-900 dark:text-white">
                  {t.other_name} · {LESSON_LABELS[t.lesson_kind] || "Lesson"}, {t.area || t.county}
                </span>
                <span className="shrink-0 text-[11px] text-slate-400">{ago(t.last_at)}</span>
              </p>
              <p className="text-xs text-slate-500 dark:text-slate-400 truncate">
                {t.last_from_me ? "You: " : ""}{t.last_body}
              </p>
            </div>
            {t.unread > 0 && (
              <span className="shrink-0 rounded-full bg-emerald-500 text-slate-900 text-[11px] font-black px-2 py-0.5 tabular-nums">
                {t.unread}
              </span>
            )}
            <ChevronRight size={16} className="shrink-0 text-slate-400" />
          </button>
        ))}
      </div>
    </div>
  );

  const requestSheet = openThread && (
    <RequestConversation
      request={{ id: openThread.request_id, first_name: openThread.other_name,
        lesson_kind: openThread.lesson_kind, open: openThread.request_open }}
      meId={user?.id}
      onClose={() => { setOpenThread(null); refresh(); onRead?.(); }}
      onRead={onRead}
    />
  );

  if (!rows.length && threads.length) {
    return <>{requestList}{requestSheet}</>;
  }

  if (!rows.length) {
    return (
      <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl p-8">
        <EmptyState
          icon={MessageSquare}
          title="No threads"
          message="Every booking you have gets a thread, so a learner can tell you they're outside without needing your mobile number. They appear here when a booking does."
        />
      </div>
    );
  }

  return (
    <>
      {requestList}
      {requestSheet}
      <p className="text-xs text-slate-500 dark:text-slate-400">
        One thread per upcoming lesson. Both of you can use it until the
        lesson is over.
      </p>

      <div className="mt-3 space-y-2">
        {rows.map(b => {
          const at = new Date(b.starts_at);
          const n = unread[b.id] || 0;
          return (
            <button
              key={b.id}
              onClick={() => setOpen(b)}
              className="w-full text-left bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl p-4 flex items-center gap-3"
            >
              <div className="flex-1 min-w-0">
                <p className="font-bold text-sm text-slate-900 dark:text-white tabular-nums">
                  {slotDay(at)}, {slotTime(at)}
                </p>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  {KIND_LABEL[b.kind] || b.kind}
                  {b.status === "requested" ? " · not yet accepted" : ""}
                </p>
              </div>
              {n > 0 && (
                <span className="shrink-0 rounded-full bg-emerald-500 text-slate-900 text-[11px] font-black px-2 py-0.5 tabular-nums">
                  {n}
                </span>
              )}
              <ChevronRight size={16} className="shrink-0 text-slate-400" />
            </button>
          );
        })}
      </div>

      {open && (
        <Sheet
          title={`${slotDay(new Date(open.starts_at))}, ${slotTime(new Date(open.starts_at))}`}
          onClose={() => { setOpen(null); refresh(); onRead?.(); }}
        >
          {/* Opening a thread marks it read in the database. The tab badge
              lives a level up, so it is told — otherwise the number sits
              there until the two-minute poll or a section change. */}
          <Thread
            bookingId={open.id}
            meId={user?.id}
            onSent={() => { refresh(); onRead?.(); }}
            onRead={onRead}
          />
        </Sheet>
      )}
    </>
  );
}
