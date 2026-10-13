/*
  HOME — the learner's dashboard.

  It used to be the theory topic list, which told a learner doing EDT or
  pre-test lessons that this app was not for them. Now it is the same front
  page for every learner: their next lesson, shortcuts to the four things
  they come here for, a look at their theory progress, and where they are
  on the road to a full licence. The theory material itself is in Study.
*/

import React, { useState, useEffect } from "react";
import {
  BookOpen, Search, Megaphone, MessageSquare, CalendarCheck, Clock3, ChevronRight,
  Route as RouteIcon, Timer, MapPin,
} from "lucide-react";
import { useAuth } from "../appAuth";
import { usePlatform } from "../platform";
import { useProgress } from "../progressStore";
import { Logo, Screen, ProgressRing } from "../ui";
import { slotDay, slotTime } from "../bookingStore";
import { LESSON_LABELS } from "../marketplace";
import StudentAccount from "./StudentAccount";
import { loadInbox } from "./inbox";

export default function HomeDashboard({ go, onUnread }) {
  const { displayName, isSignedIn, isGuest, user } = useAuth();
  const { stage } = usePlatform();
  const { overall, mockReadiness } = useProgress();
  const [inbox, setInbox] = useState(null);

  useEffect(() => {
    let live = true;
    if (isGuest || !user?.id) return;
    loadInbox(user.id).then(box => {
      if (!live) return;
      setInbox(box);
      onUnread?.(box.unread);
    });
    return () => { live = false; };
  }, [user?.id, isGuest, onUnread]);

  const next = inbox?.upcoming?.[0] || null;
  const unread = inbox?.unread || 0;

  const shortcuts = [
    { id: "study", label: "Study theory", sub: `${overall.coveragePct}% covered`, icon: BookOpen,
      tone: "from-emerald-500 to-emerald-600", onClick: () => go({ screen: "study" }) },
    { id: "find", label: "Book a lesson", sub: "Verified instructors", icon: Search,
      tone: "from-blue-500 to-blue-600", onClick: () => go({ screen: "lessons", segment: "find" }) },
    { id: "request", label: "Post a request", sub: "Let instructors find you", icon: Megaphone,
      tone: "from-orange-500 to-orange-600", onClick: () => go({ screen: "lessons", segment: "requests" }) },
    { id: "messages", label: "Messages", sub: unread ? `${unread} unread` : "Instructors & requests", icon: MessageSquare,
      tone: "from-violet-500 to-violet-600", onClick: () => go({ screen: "messages" }), badge: unread },
  ];

  return (
    <>
      <div className="bg-slate-900 text-white">
        <div className="max-w-2xl mx-auto px-5 pb-16"
          style={{ paddingTop: "max(1.25rem, calc(env(safe-area-inset-top) + 0.75rem))" }}>
          <div className="flex items-center justify-between gap-3">
            {/* The wordmark is the way out to the public site — in a new
                tab, because an installed app has no back button. */}
            <a href="/?stay=1" target="_blank" rel="noopener"
              aria-label="PassDrivingTest.ie — the website" className="inline-block">
              <Logo size="sm" icon={false} />
            </a>
            <StudentAccount go={go} />
          </div>
          <p className="mt-5 text-slate-400 text-sm">
            {isSignedIn ? `Welcome back, ${displayName} 👋` : `Hi ${displayName} 👋`}
          </p>
          <h1 className="mt-0.5 text-2xl font-black tracking-tight">Your driving, all in one place</h1>
          {stage && (
            <button onClick={() => go({ screen: "journey" })}
              className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-white/10 hover:bg-white/20 px-3 py-1.5 text-xs font-bold">
              <RouteIcon size={12} /> {stage.label}
            </button>
          )}
        </div>
      </div>

      <Screen>
        {/* Next lesson — the first thing anyone with one booked wants. */}
        <div className="-mt-12 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl p-4 shadow-lg">
          {next ? (
            <button onClick={() => go({ screen: "lessons", segment: "find" })} className="w-full text-left flex items-center gap-3.5">
              <span className={`w-11 h-11 rounded-xl flex items-center justify-center shrink-0 ${
                next.status === "accepted" ? "bg-emerald-500" : "bg-amber-400"}`}>
                {next.status === "accepted"
                  ? <CalendarCheck size={20} className="text-slate-900" />
                  : <Clock3 size={20} className="text-slate-900" />}
              </span>
              <span className="flex-1 min-w-0">
                <span className="block text-[11px] font-bold uppercase tracking-widest text-slate-400">
                  {next.status === "accepted" ? "Next lesson" : "Waiting to be confirmed"}
                </span>
                <span className="block font-black text-slate-900 dark:text-white tabular-nums">
                  {slotDay(new Date(next.starts_at))}, {slotTime(new Date(next.starts_at))}
                </span>
                <span className="block text-sm text-slate-500 dark:text-slate-400 truncate">
                  {next.instructor?.full_name || "Your instructor"} · {LESSON_LABELS[next.kind] || "Lesson"}
                </span>
                {next.pickup && (
                  <span className="mt-0.5 flex items-center gap-1 text-xs text-slate-400 truncate">
                    <MapPin size={11} className="shrink-0" /> {next.pickup}
                  </span>
                )}
              </span>
              <ChevronRight size={18} className="shrink-0 text-slate-300" />
            </button>
          ) : (
            <div className="flex items-center gap-3.5">
              <span className="w-11 h-11 rounded-xl bg-slate-100 dark:bg-slate-700 flex items-center justify-center shrink-0">
                <CalendarCheck size={20} className="text-slate-400" />
              </span>
              <span className="flex-1 min-w-0">
                <span className="block font-bold text-slate-900 dark:text-white">No lessons booked</span>
                <span className="block text-sm text-slate-500 dark:text-slate-400">
                  Find a verified instructor near you and book a time.
                </span>
              </span>
              <button onClick={() => go({ screen: "lessons", segment: "find" })}
                className="shrink-0 rounded-xl bg-emerald-500 text-slate-900 text-sm font-bold px-3.5 py-2">
                Find
              </button>
            </div>
          )}
        </div>

        {/* The four things people come here for. */}
        <div className="mt-4 grid grid-cols-2 gap-2.5">
          {shortcuts.map(({ id, label, sub, icon: Icon, tone, onClick, badge }) => (
            <button key={id} onClick={onClick}
              className={`relative text-left rounded-2xl p-4 text-white bg-gradient-to-br ${tone} active:scale-[0.98] transition`}>
              <Icon size={22} />
              <span className="mt-3 block font-black leading-tight">{label}</span>
              <span className="block text-xs text-white/80 truncate">{sub}</span>
              {badge > 0 && (
                <span className="absolute top-3 right-3 rounded-full bg-white text-violet-700 text-[11px] font-black min-w-[20px] h-5 px-1.5 inline-flex items-center justify-center">
                  {badge}
                </span>
              )}
            </button>
          ))}
        </div>

        {/* Theory, at a glance. The detail is in Study. */}
        <button onClick={() => go({ screen: "study" })}
          className="mt-4 w-full text-left bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl p-4 flex items-center gap-4">
          <ProgressRing pct={overall.coveragePct} size={64} stroke={6} label="covered" />
          <span className="flex-1 min-w-0">
            <span className="block text-[11px] font-bold uppercase tracking-widest text-slate-400">Theory test</span>
            <span className="block mt-0.5 text-sm text-slate-700 dark:text-slate-200 leading-snug">
              {overall.answered === 0
                ? `${overall.total} questions across six topics. Start with any one.`
                : `${overall.answered} of ${overall.total} questions answered${
                    overall.gradedAnswers ? ` · ${overall.accuracyPct}% correct` : ""}`}
            </span>
            {overall.mockBest > 0 && (
              <span className="mt-1 flex items-center gap-1 text-xs font-semibold text-slate-500 dark:text-slate-400">
                <Timer size={12} /> Best mock {overall.mockBest}%
                {mockReadiness?.papersSat ? ` · ${mockReadiness.papersSat} paper${mockReadiness.papersSat === 1 ? "" : "s"} sat` : ""}
              </span>
            )}
          </span>
          <ChevronRight size={18} className="shrink-0 text-slate-300" />
        </button>

        {/* Where they are on the road. */}
        <button onClick={() => go({ screen: "journey" })}
          className="mt-3 w-full text-left bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl p-4 flex items-center gap-3.5">
          <span className="w-10 h-10 rounded-xl bg-slate-900 dark:bg-slate-700 flex items-center justify-center shrink-0">
            <RouteIcon size={18} className="text-emerald-400" />
          </span>
          <span className="flex-1 min-w-0">
            <span className="block font-bold text-slate-900 dark:text-white">My driving journey</span>
            <span className="block text-sm text-slate-500 dark:text-slate-400 truncate">
              {stage ? stage.label : "Theory to full licence, step by step"}
            </span>
          </span>
          <ChevronRight size={18} className="shrink-0 text-slate-300" />
        </button>
      </Screen>
    </>
  );
}
