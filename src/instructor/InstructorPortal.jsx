/*
  ===========================================================================
  INSTRUCTOR PORTAL — shell

  The other half of the platform. An instructor's product is not a learning
  app, it's a business: a calendar, a student list, an inbox of enquiries and
  a payout. This file is the shell those live in — navigation, layout, and
  the empty states each section shows before it has any data.

  WHAT IS DELIBERATELY NOT HERE YET

  Everything that needs a server. Bookings, availability, earnings and the
  marketplace all require logic that cannot run in the browser holding an
  anon key — commission can't be calculated somewhere the instructor could
  edit it, and two students must not be able to take the same 11:00 slot.
  That arrives with the Edge Functions and the booking tables.

  Until then each section states plainly what it will do rather than showing
  invented numbers. A dashboard that reads "€640 this week" before any
  booking exists is worse than an empty one: it can't be trusted later.
  ===========================================================================
*/

import React, { useState, useEffect, useCallback, useRef } from "react";
import {
  Home, Calendar, Users, CalendarCheck, Clock, Store, Wallet, Star,
  MessageSquare, UserCircle, Hammer, ShieldCheck, ShieldAlert, Clock3,
  Loader2, Pencil, Bell, ChevronRight, ChevronLeft, Plus, CalendarPlus,
  UserPlus, Zap, CalendarClock, Banknote,
} from "lucide-react";
import {
  PrimaryButton, SecondaryButton, AccountMenu, VerifiedBadge, useDismiss,
} from "../ui";
import { useAuth } from "../appAuth";
import { usePlatform } from "../platform";
import { portalsFor } from "../portals";
import Enquiries from "./Enquiries";
import Students from "./Students";
/* Aliased: lucide-react exports a Calendar icon too, and the collision is
   a build error rather than a warning. Same reason as RouteIcon in App.jsx. */
import CalendarScreen from "./Calendar";
import Availability from "./Availability";
import Bookings from "./Bookings";
import Marketplace from "./Marketplace";
import Earnings from "./Earnings";
import Reviews from "./Reviews";
import Messages from "./Messages";
import Account from "./Account";
import { receivedEnquiries } from "../marketplace";
import { receivedBookings, isPast } from "../bookingStore";
import {
  whatIsWaiting, waitingTotal, outstandingTotal, markNotificationsSeen,
} from "../socialStore";
import { listLessons, listStudents, timeLabel, KIND_LABEL } from "./teachingStore";
import InstructorRegistration from "./InstructorRegistration";
import { loadProfile, readDraft } from "./instructorStore";

/* The nav from STEP 11, in the order an instructor's day actually runs:
   what's on today, then the calendar it sits in, then the people in it. */
/* WHAT IS A TAB AND WHAT IS NOT

   Eleven sections will not fit in a bottom bar, and a bottom bar with eleven
   things in it is a menu, not navigation. So four are tabs — the ones an
   instructor opens every day — and the other seven are reached from the home
   screen, which becomes a hub rather than a wall of chips.

   Everything is still one tap from home. Nothing was buried to make the bar
   fit; the bar was sized to what people actually use. */
const TABS = [
  { id: "dashboard", label: "Home",     icon: Home },
  { id: "students",  label: "Students", icon: Users },
  { id: "calendar",  label: "Calendar", icon: Calendar },
  /* The two that carry a count. Somebody is waiting at the other end of
     both, which is what earns a place in the bar — and a number there is
     seen without opening anything. */
  { id: "bookings",  label: "Bookings", icon: CalendarCheck, badge: "bookingRequests" },
  { id: "messages",  label: "Messages", icon: MessageSquare, badge: "unreadMessages" },
];

/* The big coloured cards at the top of home. Four, because a 2x2 grid is
   what a thumb can reach without the phone moving in the hand. */
/* Bookings moved to the bar, so its tile goes to Availability — which is
   what decides whether a booking can happen at all. An instructor with no
   hours set is invisible, and nothing else on this screen says so. */
const QUICK = [
  { id: "students",     label: "Students",  icon: Users,         tone: "blue" },
  { id: "calendar",     label: "Calendar",  icon: Calendar,      tone: "green" },
  { id: "enquiries",    label: "Enquiries", icon: MessageSquare, tone: "orange" },
  { id: "availability", label: "Hours",     icon: Clock,         tone: "purple" },
];

/* Reached from home, under More. Not lesser — just not daily. */
const MORE = [
  { id: "marketplace", label: "Marketplace",  icon: Store },
  { id: "earnings",    label: "Earnings",     icon: Wallet },
  { id: "reviews",     label: "Reviews",      icon: Star },
  { id: "account",     label: "Profile & account", icon: UserCircle },
];

const TITLES = {
  dashboard: "Instructor Dashboard",
  students: "Students", calendar: "Calendar", account: "Account",
  enquiries: "Enquiries", bookings: "Bookings", availability: "Availability",
  marketplace: "Marketplace", earnings: "Earnings", reviews: "Reviews",
  messages: "Messages",
};

const BLURBS = {
  students: "Manage your students and track their progress.",
  calendar: "View and manage your lessons and bookings.",
  enquiries: "Learners who have asked about lessons.",
  bookings: "Requests to accept or decline.",
  availability: "The hours you work and the terms you book on.",
  marketplace: "How learners find you.",
  earnings: "What you have taught, and what it was worth.",
  reviews: "What your students said.",
  messages: "Talk to a student about a lesson.",
  account: "Your details and verification.",
};


export default function InstructorPortal({ onExitRole }) {
  const { user, signOut } = useAuth();
  const { accountRoles, isAdminAccount } = usePlatform();
  const [section, setSection] = useState("dashboard");
  const [registering, setRegistering] = useState(false);
  /* Set by Students when "Lesson" is tapped on someone, read once by the
     calendar's add sheet, then cleared. Carrying it in state rather than a
     route keeps the portal's one-screen-at-a-time shape. */
  const [bookFor, setBookFor] = useState(null);
  const [profile, setProfile] = useState(null);
  const [draft, setDraft] = useState(null);
  const [loading, setLoading] = useState(true);
  const [waiting, setWaiting] = useState(null);

  /* The account's row wins; the local draft is the fallback for someone who
     started registering before signing in, or whose table isn't created yet. */
  const refresh = useCallback(async () => {
    setLoading(true);
    const { profile: row } = await loadProfile(user?.id);
    setProfile(row);
    setDraft(readDraft());
    setLoading(false);
  }, [user?.id]);

  useEffect(() => { refresh(); }, [refresh]);

  /* What wants an answer, re-asked every couple of minutes while the portal
     is open — and only while it is. There is no push here: a phone in a
     pocket will not light up, because that needs a service worker and VAPID
     keys on a server. The bell says what it knows and the panel behind it
     says what it cannot do. */
  const recount = useCallback(async () => {
    if (!user?.id) return;
    const { counts } = await whatIsWaiting();
    setWaiting(counts);
  }, [user?.id]);

  useEffect(() => {
    if (!user?.id) return;
    let off = false;
    const tick = async () => {
      const { counts } = await whatIsWaiting();
      if (!off) setWaiting(counts);
    };
    tick();
    const id = setInterval(tick, 120000);
    return () => { off = true; clearInterval(id); };
  }, [user?.id, section]);

  const status = profile?.verification_status
    || (draft ? "draft" : null);

  if (registering) {
    return (
      <InstructorRegistration
        initial={profile || draft}
        userId={user?.id}
        onDone={async () => { setRegistering(false); await refresh(); }}
        onCancel={() => setRegistering(false)}
      />
    );
  }

  const isTab = TABS.some(t => t.id === section);

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950">
      {/* ------------------------------------------------------------------ */}
      {/* Header                                                             */}
      {/*                                                                    */}
      {/* A gradient rather than a flat bar, and the section's own title in  */}
      {/* it rather than a fixed "Instructor portal" — so the top of the     */}
      {/* screen tells you where you are instead of what the product is      */}
      {/* called. You already know what it is called; you opened it.         */}
      {/* ------------------------------------------------------------------ */}
      <div className="bg-gradient-to-br from-slate-900 via-slate-900 to-blue-950 text-white">
        <div
          className="max-w-5xl mx-auto px-5 pb-5"
          style={{ paddingTop: "max(1.25rem, calc(env(safe-area-inset-top) + 0.75rem))" }}
        >
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex items-center gap-2">
              {/* A way back for the seven sections that are not tabs: the
                  bar below cannot highlight them, so without this you can
                  reach Earnings and then wonder how to leave it. */}
              {!isTab && (
                <button
                  onClick={() => setSection("dashboard")}
                  aria-label="Back to home"
                  className="-ml-2 p-2 rounded-full text-slate-300 hover:bg-white/10 transition"
                >
                  <ChevronLeft size={20} />
                </button>
              )}
              <div className="min-w-0">
                {/* "Instructor Dashboard" needs ~230px and a 320px phone
                    leaves ~180 once the bell and avatar are placed, so it
                    truncated to "Instructor Da…". A short form beats an
                    ellipsis: nobody needs telling they are in the instructor
                    app, they opened it. */}
                <h1 className="text-xl font-black tracking-tight truncate">
                  {section === "dashboard" ? (
                    <>
                      <span className="min-[360px]:hidden">Dashboard</span>
                      <span className="hidden min-[360px]:inline">Instructor Dashboard</span>
                    </>
                  ) : (TITLES[section] || "Instructor")}
                </h1>
                <p className="text-sm text-slate-400 truncate">
                  {section === "dashboard"
                    ? (profile?.full_name || user?.email || "")
                    : (BLURBS[section] || "")}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-1 shrink-0">
              <NotificationBell
                counts={waiting}
                onGo={(to) => setSection(to)}
                onSeen={async () => { await markNotificationsSeen(); await recount(); }}
              />
              <AccountMenu
                variant="avatar"
                photoUrl={profile?.photo_url}
                email={user?.email}
                /* The whole account section lives behind the photo now,
                   which is where people look for their own details and
                   where the bar no longer has room. */
                actions={[
                  { label: "Edit profile", icon: Pencil, onClick: () => setSection("account") },
                ]}
                portals={portalsFor({ accountRoles, isAdminAccount, here: "instructor" })}
                onSwitch={onExitRole}
                switchLabel="Back to the site"
                onSignOut={signOut}
              />
            </div>
          </div>
        </div>
      </div>

      {/* pb leaves room for the bar, plus whatever the home indicator takes. */}
      <div
        className="max-w-5xl mx-auto px-5 py-5"
        style={{ paddingBottom: "calc(6.5rem + env(safe-area-inset-bottom))" }}
      >
        {section === "dashboard"
          ? (
            <InstructorDashboard
              loading={loading}
              status={status}
              profile={profile}
              draft={draft}
              onRegister={() => setRegistering(true)}
              onGo={setSection}
            />
          )
          : section === "students" ? (
              <Students onBookFor={(student) => { setBookFor(student); setSection("calendar"); }} />
            )
          : section === "calendar" ? (
              <CalendarScreen bookFor={bookFor} onBooked={() => setBookFor(null)} />
            )
          : section === "enquiries" ? <Enquiries onAddedStudent={() => setSection("students")} onChanged={recount} />
          : section === "availability" ? <Availability />
          : section === "bookings" ? (
              <Bookings onAccepted={() => { recount(); setSection("calendar"); }} onChanged={recount} />
            )
          : section === "marketplace" ? (
              <Marketplace
                onOpenAccount={() => setSection("account")}
                onOpenAvailability={() => setSection("availability")}
              />
            )
          : section === "earnings" ? <Earnings />
          : section === "reviews" ? <Reviews />
          : section === "messages" ? <Messages onRead={recount} />
          : section === "account" ? (
              <Account
                loading={loading}
                status={status}
                profile={profile}
                draft={draft}
                onRegister={() => setRegistering(true)}
                onChanged={refresh}
              />
            )
          : null}
      </div>

      <TabBar section={section} onGo={setSection} waiting={waiting} />
    </div>
  );
}

/* ---------------------------------------------------------------------------
   THE BOTTOM BAR

   Fixed, four items, and padded for the home indicator — without
   env(safe-area-inset-bottom) the labels sit under the bar on every iPhone
   since the X, which is the single most common way a web app gives itself
   away as a web app.

   A dot rather than a number on Students and Calendar: the exact count is on
   the bell and on the home screen, and a bar that shouts is a bar people
   learn to ignore.
   --------------------------------------------------------------------------- */
function TabBar({ section, onGo, waiting }) {
  /* A section that is not a tab still belongs somewhere, so Home stays lit
     rather than nothing being lit at all. */
  const active = TABS.some(t => t.id === section) ? section : "dashboard";
  const pending = waitingTotal(waiting);

  return (
    <nav
      className="fixed bottom-0 inset-x-0 z-30 bg-white/95 dark:bg-slate-900/95 backdrop-blur border-t border-slate-200 dark:border-slate-800"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      <div className="max-w-5xl mx-auto grid grid-cols-5">
        {TABS.map(({ id, label, icon: Icon, badge }) => {
          const on = id === active;
          /* A real number, not a dot: "3 bookings waiting" is a different
             decision from "something is waiting", and this is the only
             place it can be seen without opening anything. Absent at zero,
             because a badge reading 0 is a badge nobody believes. */
          const count = badge ? (waiting?.[badge] || 0) : 0;
          return (
            <button
              key={id}
              onClick={() => onGo(id)}
              aria-current={on ? "page" : undefined}
              aria-label={count ? `${label}, ${count} waiting` : label}
              className="relative flex flex-col items-center gap-1 py-2.5 transition"
            >
              <span className={`relative flex items-center justify-center w-12 h-8 rounded-full transition ${
                on ? "bg-emerald-500/15" : ""
              }`}>
                <Icon
                  size={20}
                  className={on ? "text-emerald-600 dark:text-emerald-400" : "text-slate-400"}
                />
                {count > 0 && (
                  <span className="absolute -top-1 right-0.5 min-w-[17px] h-[17px] px-1 rounded-full bg-red-500 text-white text-[10px] font-black flex items-center justify-center tabular-nums">
                    {count > 9 ? "9+" : count}
                  </span>
                )}
                {id === "dashboard" && pending > 0 && !on && (
                  <span className="absolute top-1 right-2 w-2 h-2 rounded-full bg-red-500" />
                )}
              </span>
              <span className={`text-[10px] font-bold ${
                on ? "text-emerald-600 dark:text-emerald-400" : "text-slate-400"
              }`}>
                {label}
              </span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}

/* ---------------------------------------------------------------------------
   DASHBOARD

   The four numbers an instructor opens the app for. All zero until bookings
   exist — which is the truthful state, not a broken one, so each tile says
   what it counts rather than just showing a bare 0.
   --------------------------------------------------------------------------- */

function InstructorDashboard({
  loading, status, profile, draft, onRegister, onGo,
}) {
  const { user } = useAuth();
  const [newEnquiries, setNewEnquiries] = useState(undefined);
  const [counts, setCounts] = useState({});
  const [today, setToday] = useState([]);

  /* Counted here rather than through instructor_stats() so the dashboard
     degrades a tile at a time: with sql/10 missing the student and lesson
     tiles stay blank and the enquiry one still works, instead of one failed
     call emptying all four. */
  useEffect(() => {
    let off = false;
    if (!user?.id) return;

    const dayStart = new Date(); dayStart.setHours(0, 0, 0, 0);
    const dayEnd = new Date(dayStart); dayEnd.setDate(dayEnd.getDate() + 1);
    const weekEnd = new Date(dayStart); weekEnd.setDate(weekEnd.getDate() + 7);

    (async () => {
      const [todays, week, students, requests] = await Promise.all([
        listLessons(user.id, { from: dayStart, to: dayEnd }),
        listLessons(user.id, { from: new Date(), to: weekEnd }),
        listStudents(user.id),
        receivedBookings(user.id, { status: "requested" }),
      ]);
      if (off) return;

      const scheduledToday = todays.error
        ? [] : todays.rows.filter(l => l.status === "scheduled");
      setToday(scheduledToday);
      setCounts({
        today: todays.error ? undefined : scheduledToday.length,
        week: week.error ? undefined
          : week.rows.filter(l => l.status === "scheduled").length,
        students: students.error ? undefined : students.rows.length,
        /* A request whose hour has already gone by is not waiting on anyone.
           Counting it would send the instructor to a screen with nothing
           actionable on it. */
        requests: requests.error ? undefined
          : requests.rows.filter(b => !isPast(b)).length,
      });
    })();

    return () => { off = true; };
  }, [user?.id]);

  /* Only worth asking once verified — nobody can find an unlisted instructor
     to enquire with, so the answer is always zero and the failure when
     sql/09 is missing would be noise on a screen that has nothing to do
     with it. */
  useEffect(() => {
    let off = false;
    if (status !== "verified" || !user?.id) return;
    receivedEnquiries(user.id).then(({ rows }) => {
      if (!off) setNewEnquiries(rows.filter(r => r.status === "new").length);
    });
    return () => { off = true; };
  }, [status, user?.id]);

  const firstName = (profile?.full_name || "").trim().split(/\s+/)[0]
    || (user?.email || "").split("@")[0];

  return (
    <>
      {/* ---------------------------------------------------------------- */}
      {/* Greeting                                                         */}
      {/* ---------------------------------------------------------------- */}
      <div className="rounded-3xl bg-gradient-to-br from-blue-600 via-blue-700 to-indigo-800 text-white p-5 shadow-lg shadow-blue-900/20">
        <p className="text-sm font-semibold text-blue-100">{greeting()},</p>
        <h2 className="text-2xl font-black tracking-tight capitalize">
          {firstName} <span className="not-italic">👋</span>
        </h2>
        <p className="mt-1.5 text-sm text-blue-100 leading-relaxed">
          {counts.today
            ? `You have ${counts.today} lesson${counts.today === 1 ? "" : "s"} on today.`
            : "Your students, lessons and bookings, all in one place."}
        </p>
      </div>

      {/* ---------------------------------------------------------------- */}
      {/* Where to go                                                      */}
      {/* ---------------------------------------------------------------- */}
      {/* Two columns on the narrowest phones. At 320px four tiles leave
          about 38px for a label, and "Enquiries" needs sixty — it rendered
          as "Enquirie". A 2x2 grid there is bigger to hit and reads
          properly; 360px and up gets the row of four. */}
      <div className="mt-4 grid grid-cols-2 min-[360px]:grid-cols-4 gap-2.5">
        {QUICK.map(({ id, label, icon: Icon, tone }) => (
          <button
            key={id}
            onClick={() => onGo(id)}
            className={`rounded-2xl px-1.5 py-3.5 text-white text-center transition active:scale-95 ${QUICK_TONES[tone]}`}
          >
            <span className="relative inline-flex">
              <Icon size={22} />
              {/* A count only where there is something to answer. A badge
                  reading 0 is a badge nobody believes. */}
              {id === "bookings" && counts.requests > 0 && (
                <span className="absolute -top-1.5 -right-2.5 min-w-[17px] h-[17px] px-1 rounded-full bg-red-500 text-[10px] font-black flex items-center justify-center tabular-nums">
                  {counts.requests}
                </span>
              )}
              {id === "enquiries" && newEnquiries > 0 && (
                <span className="absolute -top-1.5 -right-2.5 min-w-[17px] h-[17px] px-1 rounded-full bg-red-500 text-[10px] font-black flex items-center justify-center tabular-nums">
                  {newEnquiries}
                </span>
              )}
            </span>
            <span className="mt-1.5 block text-[11px] font-black leading-tight truncate">
              {label}
            </span>
          </button>
        ))}
      </div>

      {/* ---------------------------------------------------------------- */}
      {/* The numbers                                                      */}
      {/* ---------------------------------------------------------------- */}
      <div className="mt-4 grid grid-cols-2 lg:grid-cols-4 gap-2.5">
        <Stat
          tone="emerald" icon={CalendarClock}
          value={counts.today} label="Today's Lessons"
          onClick={() => onGo("calendar")}
        />
        <Stat
          tone="blue" icon={Calendar}
          value={counts.week} label="Next 7 Days"
          onClick={() => onGo("calendar")}
        />
        <Stat
          tone="amber" icon={Users}
          value={counts.students} label="Active Students"
          onClick={() => onGo("students")}
        />
        <Stat
          tone="violet" icon={MessageSquare}
          value={newEnquiries} label="New Enquiries"
          onClick={() => onGo("enquiries")}
        />
      </div>

      {/* The one thing on this screen somebody is waiting on an answer to. */}
      {counts.requests > 0 && (
        <button
          onClick={() => onGo("bookings")}
          className="mt-3 w-full text-left rounded-2xl border border-emerald-200 dark:border-emerald-900 bg-emerald-50 dark:bg-emerald-950/40 p-4 flex items-center gap-3"
        >
          <CalendarCheck size={20} className="text-emerald-600 dark:text-emerald-400 shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="font-bold text-sm text-slate-900 dark:text-white">
              {counts.requests === 1
                ? "One learner is waiting on you"
                : `${counts.requests} learners are waiting on you`}
            </p>
            <p className="text-xs text-slate-600 dark:text-slate-300">
              The hour stays held until you accept or decline.
            </p>
          </div>
          <ChevronRight size={16} className="shrink-0 text-emerald-600 dark:text-emerald-400" />
        </button>
      )}

      {/* Verification, while there is still something to do about it. */}
      {loading
        ? <div className="mt-4"><StatusSkeleton /></div>
        : status === "verified"
          ? null
          : (
            <div className="mt-4">
              <VerificationCard
                status={status} profile={profile} draft={draft}
                onRegister={onRegister}
              />
            </div>
          )}

      <div className="mt-4 grid md:grid-cols-2 gap-4">
        {/* -------------------------------------------------------------- */}
        {/* Today                                                          */}
        {/* -------------------------------------------------------------- */}
        <Panel2 icon={Calendar} title="Upcoming Lessons">
          {today.length ? (
            <div className="space-y-2">
              {today.slice(0, 4).map(l => (
                <button
                  key={l.id}
                  onClick={() => onGo("calendar")}
                  className="w-full text-left rounded-xl bg-slate-50 dark:bg-slate-900/60 p-3 flex items-center gap-3"
                >
                  <span className="text-sm font-black tabular-nums text-slate-900 dark:text-white shrink-0">
                    {timeLabel(l.starts_at)}
                  </span>
                  <span className="flex-1 min-w-0">
                    <span className="block text-sm font-bold text-slate-900 dark:text-white truncate">
                      {l.student?.full_name || "Student"}
                    </span>
                    <span className="block text-xs text-slate-500 dark:text-slate-400">
                      {KIND_LABEL[l.kind] || l.kind}
                    </span>
                  </span>
                  <ChevronRight size={15} className="shrink-0 text-slate-400" />
                </button>
              ))}
            </div>
          ) : (
            <div className="text-center py-6">
              <div className="w-12 h-12 rounded-2xl bg-slate-100 dark:bg-slate-700 flex items-center justify-center mx-auto mb-3">
                <CalendarClock size={22} className="text-slate-400" />
              </div>
              <p className="font-bold text-sm text-slate-900 dark:text-white">
                No lessons today
              </p>
              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                Your lessons for today will appear here.
              </p>
            </div>
          )}
          <button
            onClick={() => onGo("calendar")}
            className="mt-3 w-full inline-flex items-center justify-center gap-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-bold py-3 text-sm transition"
          >
            <Plus size={16} /> Add Lesson
          </button>
        </Panel2>

        {/* -------------------------------------------------------------- */}
        {/* Quick actions                                                  */}
        {/* -------------------------------------------------------------- */}
        <Panel2 icon={Zap} title="Quick Actions">
          <div className="space-y-2">
            <Action icon={UserPlus}     tone="emerald" label="Add New Student"   onClick={() => onGo("students")} />
            <Action icon={CalendarPlus} tone="blue"    label="Add Lesson"        onClick={() => onGo("calendar")} />
            <Action icon={MessageSquare} tone="violet" label="View Enquiries"    onClick={() => onGo("enquiries")} />
            <Action icon={Clock}        tone="amber"   label="Check Availability" onClick={() => onGo("availability")} />
          </div>
        </Panel2>
      </div>

      {/* ---------------------------------------------------------------- */}
      {/* Everything else                                                  */}
      {/* ---------------------------------------------------------------- */}
      <h2 className="mt-6 text-xs font-bold uppercase tracking-widest text-slate-500 dark:text-slate-400">
        More
      </h2>
      <div className="mt-2 rounded-2xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 divide-y divide-slate-100 dark:divide-slate-700 overflow-hidden">
        {MORE.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => onGo(id)}
            className="w-full text-left px-4 py-3.5 flex items-center gap-3 active:bg-slate-50 dark:active:bg-slate-700/50 transition"
          >
            <Icon size={17} className="text-slate-400 shrink-0" />
            <span className="flex-1 text-sm font-bold text-slate-900 dark:text-white">
              {label}
            </span>
            <ChevronRight size={16} className="text-slate-400 shrink-0" />
          </button>
        ))}
      </div>

      {/* ---------------------------------------------------------------- */}
      {/* Money and notifications, said once                               */}
      {/* ---------------------------------------------------------------- */}
      <div className="mt-4 rounded-2xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 p-5">
        <div className="flex items-center gap-2.5">
          <Banknote size={18} className="text-emerald-500 shrink-0" />
          <h2 className="font-bold text-slate-900 dark:text-white">
            Learners pay you directly
          </h2>
        </div>
        <p className="mt-2 text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
          No card is taken on this site and the platform takes nothing — not
          from your own students, not from the ones the directory sends you.
          If that ever changes you will be told here first, in advance, and it
          will not apply to anything already booked.
        </p>
      </div>

      <div className="mt-4 rounded-2xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 p-5">
        <div className="flex items-center gap-2.5">
          <Hammer size={18} className="text-amber-500 shrink-0" />
          <h2 className="font-bold text-slate-900 dark:text-white">
            Nothing reaches you outside the app yet
          </h2>
        </div>
        <p className="mt-2 text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
          Every part of this portal works. What is missing is being told: no
          email when a learner books, and no notification on your phone. Until
          that exists the only way to find a new request is to open this and
          look, so it is worth a glance each morning.
        </p>
      </div>
    </>
  );
}

/* Morning, afternoon or evening, by the clock on the device — which is the
   instructor's own clock, which is the one that matters. */
function greeting() {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 18) return "Good afternoon";
  return "Good evening";
}

const QUICK_TONES = {
  blue:   "bg-gradient-to-br from-blue-500 to-blue-600",
  green:  "bg-gradient-to-br from-emerald-500 to-emerald-600",
  orange: "bg-gradient-to-br from-orange-500 to-orange-600",
  purple: "bg-gradient-to-br from-violet-500 to-violet-600",
};

const STAT_TONES = {
  emerald: "bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400",
  blue:    "bg-blue-50 dark:bg-blue-950/40 text-blue-600 dark:text-blue-400",
  amber:   "bg-amber-50 dark:bg-amber-950/40 text-amber-600 dark:text-amber-400",
  violet:  "bg-violet-50 dark:bg-violet-950/40 text-violet-600 dark:text-violet-400",
};

/* A tile shows a dash, not a zero, when the number could not be read. Those
   are different facts and the one thing this dashboard has never done is
   invent a number. */
function Stat({ tone, icon: Icon, value, label, onClick }) {
  const known = typeof value === "number";
  return (
    <button
      onClick={onClick}
      className={`rounded-2xl p-3.5 text-left transition active:scale-[0.98] ${STAT_TONES[tone]}`}
    >
      <div className="flex items-start justify-between">
        <Icon size={18} />
        <ChevronRight size={14} className="opacity-50" />
      </div>
      <p className="mt-2 text-2xl font-black tabular-nums text-slate-900 dark:text-white">
        {known ? value : "—"}
      </p>
      <p className="text-[11px] font-bold text-slate-600 dark:text-slate-300 leading-tight">
        {label}
      </p>
    </button>
  );
}

function Panel2({ icon: Icon, title, children }) {
  return (
    <div className="rounded-2xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 p-4">
      <div className="flex items-center gap-2 mb-3">
        <Icon size={17} className="text-blue-500 shrink-0" />
        <h2 className="font-black text-slate-900 dark:text-white">{title}</h2>
      </div>
      {children}
    </div>
  );
}

const ACTION_TONES = {
  emerald: "bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400",
  blue:    "bg-blue-50 dark:bg-blue-950/40 text-blue-600 dark:text-blue-400",
  violet:  "bg-violet-50 dark:bg-violet-950/40 text-violet-600 dark:text-violet-400",
  amber:   "bg-amber-50 dark:bg-amber-950/40 text-amber-600 dark:text-amber-400",
};

function Action({ icon: Icon, tone, label, onClick }) {
  return (
    <button
      onClick={onClick}
      className={`w-full rounded-xl px-3.5 py-3 flex items-center gap-3 transition active:scale-[0.98] ${ACTION_TONES[tone]}`}
    >
      <Icon size={17} className="shrink-0" />
      <span className="flex-1 text-left text-sm font-bold text-slate-900 dark:text-white">
        {label}
      </span>
      <ChevronRight size={15} className="opacity-50 shrink-0" />
    </button>
  );
}

/* ---------------------------------------------------------------------------
   VERIFICATION

   The first thing on the dashboard until it's resolved, because until an ADI
   number has been checked nothing else in the portal matters: an unverified
   instructor is invisible to every learner, and should be told exactly that
   rather than left to wonder why no bookings arrive.
   --------------------------------------------------------------------------- */
function VerificationCard({ status, profile, draft, onRegister }) {
  /* Not started */
  if (!status) {
    return (
      <Panel tone="blue" icon={ShieldCheck} title="Get verified to take bookings">
        <p>
          Add your ADI number and we'll check it against the RSA register.
          Until that's done your profile isn't visible to learners — which is
          the point: it's what the badge means.
        </p>
        <p className="text-slate-500 dark:text-slate-400">
          It's about ten fields and you don't have to do them in one go — every
          step is saved as you fill it in.
        </p>
        <div className="mt-4">
          <PrimaryButton onClick={onRegister}>Add my details</PrimaryButton>
        </div>
      </Panel>
    );
  }

  /* Started, not submitted */
  if (status === "draft") {
    return (
      <Panel tone="amber" icon={Pencil} title="Your registration is half finished">
        <p>
          Your answers are saved. Finish them and submit, and we'll check your
          ADI number against the RSA register.
        </p>
        <div className="mt-4">
          <PrimaryButton onClick={onRegister}>Finish registering</PrimaryButton>
        </div>
      </Panel>
    );
  }

  /* Waiting on a human */
  if (status === "pending") {
    return (
      <Panel tone="amber" icon={Clock3} title="Verification in progress">
        <p>
          We've got your details and we're checking ADI
          number <strong>{profile?.adi_number || draft?.adi_number}</strong> against
          the RSA register. This usually takes a couple of working days.
        </p>
        <p className="text-slate-500 dark:text-slate-400">
          Your profile stays hidden from learners until it's done.
        </p>
        <div className="mt-4">
          <SecondaryButton onClick={onRegister}>Review my details</SecondaryButton>
        </div>
      </Panel>
    );
  }

  /* Turned down */
  if (status === "rejected") {
    return (
      <Panel tone="red" icon={ShieldAlert} title="We couldn't verify your ADI number">
        <p>
          {profile?.verification_notes
            || "The number didn't match the RSA register. Check it and submit again."}
        </p>
        <div className="mt-4">
          <PrimaryButton onClick={onRegister}>Update and resubmit</PrimaryButton>
        </div>
      </Panel>
    );
  }

  if (status === "suspended") {
    return (
      <Panel tone="red" icon={ShieldAlert} title="Your account is suspended">
        <p>
          {profile?.verification_notes
            || "Your profile has been withdrawn from the marketplace. Get in touch to sort it out."}
        </p>
      </Panel>
    );
  }

  /* 'verified' never reaches here — the dashboard shows VerifiedLine instead,
     and Account carries the detail. Anything else is a status the database
     grew that this screen has not been taught, and saying nothing is better
     than guessing at it. */
  return null;
}

/* ---------------------------------------------------------------------------
   The verified state, which is a badge and not an announcement.
   --------------------------------------------------------------------------- */
function VerifiedLine({ profile, onOpenAccount }) {
  return (
    <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl px-4 py-3 flex items-center gap-3">
      <VerifiedBadge />
      <p className="flex-1 min-w-0 text-xs text-slate-500 dark:text-slate-400 truncate">
        {profile?.listed
          ? "Listed — learners can find you."
          : "Not listed yet; that switch arrives with the marketplace."}
      </p>
      <button
        onClick={onOpenAccount}
        className="shrink-0 text-xs font-bold text-emerald-600 dark:text-emerald-400 hover:underline"
      >
        Account
      </button>
    </div>
  );
}

const TONES = {
  blue:  "bg-blue-50 dark:bg-blue-950/40 border-blue-200 dark:border-blue-900 text-blue-600 dark:text-blue-400",
  amber: "bg-amber-50 dark:bg-amber-950/40 border-amber-200 dark:border-amber-900 text-amber-600 dark:text-amber-400",
  green: "bg-emerald-50 dark:bg-emerald-950/40 border-emerald-200 dark:border-emerald-900 text-emerald-600 dark:text-emerald-400",
  red:   "bg-red-50 dark:bg-red-950/40 border-red-200 dark:border-red-900 text-red-600 dark:text-red-400",
};

function Panel({ tone, icon: Icon, title, children }) {
  const cls = TONES[tone] || TONES.blue;
  return (
    <div className={`border rounded-2xl p-5 ${cls.replace(/text-\S+/g, "")}`}>
      <div className="flex items-center gap-2.5">
        <Icon size={18} className={`shrink-0 ${cls.split(" ").filter(c => c.startsWith("text-")).join(" ")}`} />
        <h2 className="font-bold text-slate-900 dark:text-white">{title}</h2>
      </div>
      <div className="mt-2 space-y-2 text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
        {children}
      </div>
    </div>
  );
}

function StatusSkeleton() {
  return (
    <div className="border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 rounded-2xl p-5 flex items-center gap-3">
      <Loader2 size={18} className="text-slate-400 animate-spin shrink-0" />
      <p className="text-sm text-slate-500 dark:text-slate-400">Checking your registration…</p>
    </div>
  );
}


/* ---------------------------------------------------------------------------
   THE BELL

   Counts the three things that want an answer: booking requests, new
   enquiries, unread messages. Lessons today are shown but not counted into
   the badge — a lesson is not waiting on a reply, and counting it would mean
   the badge never clears on a working day.

   IT SAYS WHAT IT CANNOT DO

   This is not a push notification and the panel says so in as many words.
   Nothing here reaches a phone with the app closed: that needs a service
   worker, a push subscription and VAPID keys held on a server, none of which
   exist yet. Leaving that unsaid would have an instructor put their phone
   down expecting it to buzz when a booking arrives, and miss it.
   --------------------------------------------------------------------------- */
function NotificationBell({ counts, onGo, onSeen }) {
  const [open, setOpen] = useState(false);
  const root = useRef(null);
  /* Replaces a full-screen backdrop div that sat at z-30 — the same layer as
     the bottom tab bar, so tapping a tab while this was open hit whichever
     the browser felt like and usually did nothing at all. */
  useDismiss(root, open, useCallback(() => setOpen(false), []));
  /* The badge is what has ARRIVED since this was last opened. The list
     below is what is still outstanding, seen or not — two different
     questions that used to share one number, which is why the badge never
     went away. */
  const total = waitingTotal(counts);
  const outstanding = outstandingTotal(counts);

  const items = [
    { n: counts?.bookingRequests, to: "bookings",  label: "booking request",  plural: "booking requests" },
    { n: counts?.newEnquiries,    to: "enquiries", label: "new enquiry",      plural: "new enquiries" },
    { n: counts?.unreadMessages,  to: "messages",  label: "unread message",   plural: "unread messages" },
  ].filter(i => i.n > 0);

  return (
    <div className="relative" ref={root}>
      <button
        onClick={() => {
          const next = !open;
          setOpen(next);
          /* Opening it IS reading it. Marked immediately rather than on
             close, because people read a panel and then tap straight
             through to the thing it told them about. */
          if (next) onSeen?.();
        }}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={total ? `${total} things waiting on you` : "Nothing waiting"}
        className="relative w-10 h-10 flex items-center justify-center rounded-full text-slate-300 hover:bg-white/10 transition"
      >
        <Bell size={18} />
        {total > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] rounded-full bg-red-500 text-white text-[10px] font-black flex items-center justify-center px-1 tabular-nums ring-2 ring-slate-900">
            {total > 9 ? "9+" : total}
          </span>
        )}
      </button>

      {open && (
          <div className="absolute right-0 top-full mt-1 z-40 w-72 max-w-[calc(100vw-24px)] rounded-2xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 shadow-xl p-4">
            {counts === null ? (
              <p className="text-sm text-slate-500 dark:text-slate-400 leading-relaxed">
                Couldn't check. This needs{" "}
                <code className="font-mono text-xs">sql/13</code> to have been run.
              </p>
            ) : (
              <>
                {items.length ? (
                  <div className="space-y-1">
                    {items.map(i => (
                      <button
                        key={i.to}
                        onClick={() => { setOpen(false); onGo(i.to); }}
                        className="w-full text-left rounded-xl px-3 py-2.5 hover:bg-slate-50 dark:hover:bg-slate-700/50 transition"
                      >
                        <span className="font-bold text-sm text-slate-900 dark:text-white tabular-nums">
                          {i.n}
                        </span>{" "}
                        <span className="text-sm text-slate-600 dark:text-slate-300">
                          {i.n === 1 ? i.label : i.plural}
                        </span>
                      </button>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-slate-500 dark:text-slate-400">
                    Nothing waiting on you.
                  </p>
                )}

                {/* Said once, where somebody who just watched the badge
                    vanish might otherwise think the work vanished with it. */}
                {outstanding > 0 && total === 0 && (
                  <p className="mt-2 px-3 text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
                    Nothing new since you last looked. The counts above are
                    still waiting on an answer.
                  </p>
                )}

                {counts?.lessonsToday > 0 && (
                  <p className="mt-2 px-3 text-xs text-slate-500 dark:text-slate-400">
                    {counts.lessonsToday} lesson{counts.lessonsToday === 1 ? "" : "s"} on today.
                  </p>
                )}
              </>
            )}

            <p className="mt-3 pt-3 border-t border-slate-100 dark:border-slate-700 text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
              This only updates while the app is open. Your phone won't buzz
              when a booking comes in — that needs push notifications, which
              aren't built yet.
            </p>
          </div>
      )}
    </div>
  );
}
