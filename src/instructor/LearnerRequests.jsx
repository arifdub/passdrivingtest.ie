/*
  ===========================================================================
  LEARNER REQUESTS — the other side of the marketplace

  Learners who couldn't find a suitable instructor or time post what they
  need: where, what kind of lesson, their level, whose car, when suits
  (sql/32). Verified instructors see the posts here and message the learner.

  Only a first name is shown. The learner's email and phone stay private
  until they choose to share them in the conversation.

  Filtered to the instructor's own counties by default, because a post in
  Kerry is noise to someone who teaches in Dublin — with "All counties" one
  tap away for anyone who travels.
  ===========================================================================
*/

import React, { useState, useEffect, useCallback, useMemo } from "react";
import {
  Megaphone, MapPin, Gauge, Car, Clock, MessageSquare, Loader2, AlertCircle, Check,
} from "lucide-react";
import { useAuth } from "../appAuth";
import { EmptyState } from "../ui";
import { Sheet } from "./Students";
import Thread from "../Thread";
import { loadProfile } from "./instructorStore";
import { LESSON_LABELS } from "../marketplace";
import { levelLabel, carLabel } from "../bookingStore";
import { openRequests, ago } from "../lessonRequests";
import { requestSource } from "../student/ConversationScreen";

export default function LearnerRequests({ onRead }) {
  const { user } = useAuth();
  const [mine, setMine] = useState(null);       // the instructor's counties
  const [county, setCounty] = useState("mine");  // "mine" | "" (all) | a county
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [open, setOpen] = useState(null);

  useEffect(() => {
    loadProfile(user?.id).then(({ profile }) => setMine(profile?.counties || []));
  }, [user?.id]);

  const refresh = useCallback(async () => {
    setLoading(true);
    const { rows: r, error: e } = await openRequests({
      county: county === "mine" ? null : county || null,
    });
    setRows(r); setError(e); setLoading(false);
  }, [county]);

  useEffect(() => { refresh(); }, [refresh]);

  /* "Your counties" is a filter over the full list rather than one query
     per county. */
  const shown = useMemo(() => (
    county === "mine" && mine?.length ? rows.filter(r => mine.includes(r.county)) : rows
  ), [rows, county, mine]);

  return (
    <>
      <p className="text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
        Learners looking for lessons who haven't found an instructor yet. Message one and the
        conversation lands in their app and their email.
      </p>

      <div className="mt-3 -mx-1 px-1 flex gap-1.5 overflow-x-auto pb-1 no-scrollbar">
        {mine?.length > 0 && <Chip on={county === "mine"} onClick={() => setCounty("mine")}>Your counties</Chip>}
        <Chip on={county === ""} onClick={() => setCounty("")}>All counties</Chip>
      </div>

      {error ? (
        <div className="mt-4 rounded-2xl border border-amber-200 dark:border-amber-900 bg-amber-50 dark:bg-amber-950/40 p-4 flex items-start gap-2.5">
          <AlertCircle size={17} className="shrink-0 mt-0.5 text-amber-500" />
          <p className="text-sm text-slate-700 dark:text-slate-200">{error}</p>
        </div>
      ) : loading ? (
        <div className="py-10 flex justify-center"><Loader2 size={18} className="animate-spin text-slate-400" /></div>
      ) : !shown.length ? (
        <div className="mt-4 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl p-8">
          <EmptyState icon={Megaphone} title="No requests right now"
            message={county === "mine" ? "Nobody in your counties is asking at the moment. Try All counties." : "When a learner posts, it shows here."} />
        </div>
      ) : (
        <div className="mt-4 space-y-3">
          {shown.map(r => (
            <div key={r.id} className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-bold text-slate-900 dark:text-white">
                    {r.first_name} · {LESSON_LABELS[r.lesson_kind] || "Lesson"}
                  </p>
                  <p className="text-xs text-slate-500 dark:text-slate-400">Posted {ago(r.created_at)}</p>
                </div>
                {r.messaged && (
                  <span className="shrink-0 inline-flex items-center gap-1 rounded-full bg-emerald-50 dark:bg-emerald-950/50 text-emerald-700 dark:text-emerald-300 px-2.5 py-1 text-[11px] font-bold">
                    <Check size={12} /> Messaged
                  </span>
                )}
              </div>
              <dl className="mt-2 space-y-1">
                {[
                  [MapPin, [r.area, r.county].filter(Boolean).join(", ")],
                  [Gauge, levelLabel(r.level)],
                  [Car, carLabel(r)],
                  [Clock, r.availability],
                ].filter(([, v]) => v).map(([Icon, v], i) => (
                  <div key={i} className="flex items-start gap-2 text-sm text-slate-700 dark:text-slate-200">
                    <Icon size={14} className="shrink-0 mt-0.5 text-slate-400" /> <span>{v}</span>
                  </div>
                ))}
              </dl>
              {r.note && <p className="mt-1.5 text-sm text-slate-600 dark:text-slate-300 italic">“{r.note}”</p>}
              <button onClick={() => setOpen(r)}
                className="mt-3 w-full inline-flex items-center justify-center gap-1.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-900 font-bold py-2.5 text-sm">
                <MessageSquare size={15} /> {r.messaged ? "Open conversation" : `Message ${r.first_name}`}
              </button>
            </div>
          ))}
        </div>
      )}

      {open && (
        <RequestConversation request={open} meId={user?.id}
          onClose={() => { setOpen(null); refresh(); onRead?.(); }} onRead={onRead} />
      )}
    </>
  );
}

/* The conversation, as a sheet over the board or the Messages list. */
export function RequestConversation({ request, meId, instructorId, title, onClose, onRead }) {
  const who = instructorId || meId;
  const source = useMemo(() => requestSource(request.id, who), [request.id, who]);
  return (
    <Sheet title={title || `${request.first_name} · ${LESSON_LABELS[request.lesson_kind] || "Lesson"}`} onClose={onClose}>
      <Thread
        meId={meId}
        source={source}
        onRead={onRead}
        emptyText="Introduce yourself — when you're free, your price, where you teach. They'll get it by email too."
        closed={request.open === false}
        closedText="This request is closed."
      />
    </Sheet>
  );
}

function Chip({ on, onClick, children }) {
  return (
    <button onClick={onClick} aria-pressed={on}
      className={`shrink-0 rounded-full px-3.5 py-2 text-xs font-bold transition ${
        on ? "bg-slate-900 dark:bg-white text-white dark:text-slate-900"
           : "bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300"}`}>
      {children}
    </button>
  );
}
