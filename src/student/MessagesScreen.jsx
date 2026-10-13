/*
  MESSAGES — every conversation a learner has, in one list.

  Two kinds: the thread on each live booking (sql/13), and conversations
  instructors started about the learner's lesson requests (sql/32). Both
  open in the same conversation screen.
*/

import React, { useState, useEffect, useCallback } from "react";
import { MessageSquare, CalendarCheck, Megaphone, ChevronRight, Loader2, RefreshCw } from "lucide-react";
import { useAuth } from "../appAuth";
import { ScreenHeader, Screen, EmptyState, PrimaryButton } from "../ui";
import { slotDay, slotTime } from "../bookingStore";
import { LESSON_LABELS } from "../marketplace";
import { ago } from "../lessonRequests";
import { initialsFor } from "../avatars";
import StudentAccount from "./StudentAccount";
import { loadInbox } from "./inbox";

export default function MessagesScreen({ go, onUnread }) {
  const { user, isGuest, exitGuest } = useAuth();
  const [inbox, setInbox] = useState(null);

  const refresh = useCallback(async () => {
    const box = await loadInbox(user?.id);
    setInbox(box);
    onUnread?.(box.unread);
  }, [user?.id, onUnread]);

  useEffect(() => { if (!isGuest) refresh(); }, [refresh, isGuest]);

  const header = (
    <ScreenHeader title="Messages" subtitle="Your instructors and lesson requests"
      right={<StudentAccount go={go} />} />
  );

  if (isGuest) {
    return (
      <>
        {header}
        <Screen>
          <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl p-6">
            <EmptyState icon={MessageSquare} title="Messages need an account"
              message="When you book a lesson or post a lesson request, your instructor can write to you here." />
            <div className="mt-4"><PrimaryButton onClick={exitGuest}>Create a free account</PrimaryButton></div>
          </div>
        </Screen>
      </>
    );
  }

  const threads = inbox?.threads || [];
  const bookings = inbox?.liveBookings || [];

  return (
    <>
      {header}
      <Screen>
        {!inbox ? (
          <div className="py-10 flex justify-center"><Loader2 size={18} className="animate-spin text-slate-400" /></div>
        ) : !threads.length && !bookings.length ? (
          <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl p-6">
            <EmptyState icon={MessageSquare} title="No messages yet"
              message="Book a lesson or post a lesson request, and conversations with instructors show up here." />
            <div className="mt-4">
              <PrimaryButton onClick={() => go({ screen: "lessons" })}>Find an instructor</PrimaryButton>
            </div>
          </div>
        ) : (
          <>
            {threads.length > 0 && (
              <Group title="About your lesson requests" icon={Megaphone}>
                {threads.map(t => (
                  <Row key={`${t.request_id}:${t.instructor_id}`}
                    photo={t.other_photo} name={t.other_name}
                    title={t.other_name}
                    sub={`${t.last_from_me ? "You: " : ""}${t.last_body}`}
                    meta={ago(t.last_at)}
                    tag={`${LESSON_LABELS[t.lesson_kind] || "Lesson"} · ${t.area || t.county}`}
                    unread={t.unread}
                    onClick={() => go({ screen: "conversation", kind: "request", requestId: t.request_id,
                      instructorId: t.instructor_id, title: t.other_name, adi: t.adi_number, open: t.request_open })} />
                ))}
              </Group>
            )}
            {bookings.length > 0 && (
              <Group title="About your bookings" icon={CalendarCheck}>
                {bookings.map(b => {
                  const at = new Date(b.starts_at);
                  const name = b.instructor?.full_name || "Your instructor";
                  return (
                    <Row key={b.id} photo={null} name={name} title={name}
                      sub={`${LESSON_LABELS[b.kind] || "Lesson"} · ${slotDay(at)}, ${slotTime(at)}`}
                      tag={b.status === "requested" ? "Waiting for them to confirm" : "Confirmed"}
                      unread={inbox.unreadBookings[b.id] || 0}
                      onClick={() => go({ screen: "conversation", kind: "booking", bookingId: b.id,
                        title: name, subtitle: `${slotDay(at)}, ${slotTime(at)}` })} />
                  );
                })}
              </Group>
            )}
            <button onClick={refresh}
              className="mt-4 w-full inline-flex items-center justify-center gap-1.5 text-xs text-slate-400">
              <RefreshCw size={12} /> Check for new messages
            </button>
          </>
        )}
      </Screen>
    </>
  );
}

function Group({ title, icon: Icon, children }) {
  return (
    <div className="mb-5">
      <p className="mb-2 text-xs font-bold uppercase tracking-widest text-slate-400 inline-flex items-center gap-1.5">
        <Icon size={13} /> {title}
      </p>
      <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl divide-y divide-slate-100 dark:divide-slate-700 overflow-hidden">
        {children}
      </div>
    </div>
  );
}

function Row({ photo, name, title, sub, meta, tag, unread, onClick }) {
  return (
    <button onClick={onClick} className="w-full text-left flex items-center gap-3 px-4 py-3.5 hover:bg-slate-50 dark:hover:bg-slate-700/40">
      <span className="w-10 h-10 rounded-full overflow-hidden shrink-0 bg-gradient-to-br from-emerald-400 to-emerald-600 text-slate-900 text-xs font-black flex items-center justify-center">
        {photo ? <img src={photo} alt="" className="w-full h-full object-cover" /> : initialsFor(name)}
      </span>
      <span className="flex-1 min-w-0">
        <span className="flex items-baseline gap-2">
          <span className={`flex-1 truncate text-sm ${unread ? "font-black" : "font-bold"} text-slate-900 dark:text-white`}>{title}</span>
          {meta && <span className="shrink-0 text-[11px] text-slate-400">{meta}</span>}
        </span>
        <span className={`block truncate text-sm ${unread ? "text-slate-800 dark:text-slate-100 font-semibold" : "text-slate-500 dark:text-slate-400"}`}>{sub}</span>
        {tag && <span className="block truncate text-[11px] text-slate-400">{tag}</span>}
      </span>
      {unread > 0 && (
        <span className="shrink-0 rounded-full bg-emerald-500 text-slate-900 text-[11px] font-black min-w-[20px] h-5 px-1.5 inline-flex items-center justify-center tabular-nums">{unread}</span>
      )}
      <ChevronRight size={16} className="shrink-0 text-slate-300 dark:text-slate-600" />
    </button>
  );
}
