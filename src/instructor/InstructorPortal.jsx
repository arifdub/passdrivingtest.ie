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
  MessageSquare, UserCircle, BellRing, ShieldCheck, ShieldAlert, Clock3,
  Loader2, Pencil, Bell, ChevronRight, ChevronLeft, Plus, CalendarPlus,
  UserPlus, Zap, CalendarClock, Banknote, LogOut, GraduationCap,
} from "lucide-react";
import {
  PrimaryButton, SecondaryButton, AccountMenu, VerifiedBadge, useDismiss,
} from "../ui";
import { useAuth } from "../appAuth";
import { setBadge } from "../badge";
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
  countsPulse,
} from "../socialStore";
import { subscribeInstructor, describeChange } from "../realtime";
import Toast from "../Toast";
import PushToggle from "../PushToggle";
import PushNudge from "../PushNudge";
import IncomingBookings from "./IncomingBookings";
import { refreshSubscription } from "../push";
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
  const [toast, setToast] = useState(null);

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
     is open. Push now covers the closed-app case, so this is no longer the
     only way a count can change — but it is still the one that corrects it:
     a push can be missed, dropped or refused, and the poll is what makes
     the bell right again afterwards. */
  const recount = useCallback(async () => {
    if (!user?.id) return;
    const { counts } = await whatIsWaiting();
    setWaiting(counts);
  }, [user?.id]);

  /* The home-screen icon shows the bell's number, and never its own.

     One effect on the one piece of state, so every path that can change
     the count — first load, the poll below, a realtime event, opening the
     bell — moves the icon too, without any of them having to remember to.
     The service worker sets it while the app is closed; this corrects it
     the moment the app is open. */
  useEffect(() => {
    setBadge(waitingTotal(waiting));
  }, [waiting]);

  useEffect(() => {
    if (!user?.id) return;
    let off = false;
    const tick = async () => {
      const { counts } = await whatIsWaiting();
      if (!off) setWaiting(counts);
    };
    tick();
    /* The poll stays. Realtime below makes it live, but a websocket drops on
       a tunnel, a lock screen, a flaky 3G — and the one thing worse than a
       two-minute delay is a count that is wrong until the app is restarted.
       Belt and braces, and the braces are cheap. */
    const id = setInterval(tick, 120000);
    return () => { off = true; clearInterval(id); };
  }, [user?.id, section]);

  /* A browser can rotate a push subscription without telling anybody, and
     the stored endpoint goes quietly dead — the classic "push worked for a
     week" bug. One cheap upsert per load, keyed on the endpoint. */
  useEffect(() => {
    if (!user?.id) return;
    refreshSubscription();
    const onMessage = (e) => {
      if (e.data?.type === "push-subscription-changed") refreshSubscription();
    };
    navigator.serviceWorker?.addEventListener?.("message", onMessage);
    return () => navigator.serviceWorker?.removeEventListener?.("message", onMessage);
  }, [user?.id]);

  /* Live: a booking, a message or an enquiry arriving re-reads the counts
     and says so, instead of the screen sitting on a stale number for up to
     two minutes while the instructor watches it. */
  useEffect(() => {
    if (!user?.id) return;
    return subscribeInstructor(user.id, (change) => {
      recount();
      const said = describeChange(change);
      /* Not everything is worth a line — accepting a booking is an update to
         a booking, and telling somebody about the thing they just did is how
         a notification system teaches people to ignore it. */
      if (said) setToast(said);
    });
  }, [user?.id, recount]);

  const status = profile?.verification_status
    || (draft ? "draft" : null);

  /* Neither the gate below nor the real portal, for the single request it
     takes to find out which one is right. Showing the full dashboard here
     — even briefly — would flash the exact "zeros and tiles" view the
     gate exists to prevent; showing the gate here would flash "you are
     not verified" at somebody who, a moment later, turns out to be. A
     plain wait is the only state that cannot be the wrong answer. */
  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 dark:bg-slate-950 flex items-center justify-center gap-2.5 text-slate-500 dark:text-slate-400">
        <Loader2 size={18} className="animate-spin" />
        <span className="text-sm">Loading your account…</span>
      </div>
    );
  }

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

  /* An unverified account sees none of the portal — not the dashboard, not
     Students, not the Calendar — because none of it is real for them yet.
     Every tile behind this gate reads 0, because an instructor nobody can
     find has no students, no bookings, nothing to check against a
     calendar: a dashboard full of zeros is not a feature, it is the portal
     describing its own uselessness in detail. The one useful thing on it,
     "get verified", is exactly what this gate leads with.

     `loading` is already handled above, so by here the account is known. */
  if (status !== "verified") {
    return (
      <VerificationGate
        status={status}
        profile={profile}
        draft={draft}
        onRegister={() => setRegistering(true)}
        onSignOut={signOut}
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
          className="max-w-5xl mx-auto px-5 pb-4"
          style={{ paddingTop: "max(1rem, calc(env(safe-area-inset-top) + 0.6rem))" }}
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

      {/* pb leaves room for the bar, plus whatever the home indicator takes.
          The bar itself was trimmed (see TabBar) to give the dashboard more
          room, so this reserve shrank with it — still clear of the bar,
          just not by as much as it was. */}
      <div
        className="max-w-5xl mx-auto px-5 pt-4"
        style={{ paddingBottom: "calc(5.5rem + env(safe-area-inset-bottom))" }}
      >
        {section === "dashboard"
          ? (
            <InstructorDashboard
              profile={profile}
              onGo={setSection}
              /* Answering a request from the dashboard has to move the
                 bell, the tab badge and the icon badge, none of which
                 this screen owns. */
              onChanged={recount}
              /* And the reverse: when realtime or the poll finds a new
                 booking, this screen has to re-read its own data.

                 It did not. The tab badge below reads `waiting`, which is
                 refreshed live; the dashboard's tiles and its list of
                 requests fetch once on mount and were never told. So a
                 booking arriving put 1 on the footer badge while the New
                 Bookings tile beside it still said 0 — two numbers
                 disagreeing on one screen — and the request card did not
                 appear until the Bookings tab was opened, which mounts a
                 fresh component.

                 A string of the numbers rather than the object: the poll
                 builds a new object every two minutes whether or not
                 anything changed, and re-fetching on that would be work
                 nobody asked for. This changes only when a number does. */
              pulse={countsPulse(waiting)}
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

      <Toast
        message={toast}
        onGo={() => toast?.go && setSection(toast.go)}
        onDismiss={() => setToast(null)}
      />

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
              className="relative flex flex-col items-center gap-0.5 py-1.5 transition"
            >
              <span className={`relative flex items-center justify-center w-11 h-7 rounded-full transition ${
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

export function InstructorDashboard({
  profile, onGo, onChanged, pulse,
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
    /* `pulse` is what makes this re-read when a booking, enquiry or
       message arrives. Without it these tiles are a photograph taken when
       the screen mounted. */
  }, [user?.id, pulse]);

  /* Used to also check status === "verified" here — nobody can find an
     unlisted instructor to enquire with, so the answer would always be
     zero and the failure when sql/09 is missing would be noise on a
     screen that has nothing to do with it. That check is redundant now:
     InstructorPortal does not mount this component at all until the
     account is verified (see VerificationGate), so by the time this
     effect can run, it always is. */
  useEffect(() => {
    let off = false;
    if (!user?.id) return;
    receivedEnquiries(user.id).then(({ rows }) => {
      if (!off) setNewEnquiries(rows.filter(r => r.status === "new").length);
    });
    return () => { off = true; };
  }, [user?.id]);

  const firstName = (profile?.full_name || "").trim().split(/\s+/)[0]
    || (user?.email || "").split("@")[0];

  return (
    <>
      {/* ---------------------------------------------------------------- */}
      {/* Greeting                                                         */}
      {/* ---------------------------------------------------------------- */}
      <div className="rounded-3xl bg-gradient-to-br from-blue-600 via-blue-700 to-indigo-800 text-white p-4 shadow-lg shadow-blue-900/20">
        <p className="text-sm font-semibold text-blue-100">{greeting()},</p>
        <h2 className="text-2xl font-black tracking-tight capitalize">
          {firstName} <span className="not-italic">👋</span>
        </h2>
        <p className="mt-1 text-sm text-blue-100 leading-relaxed">
          {counts.today
            ? `You have ${counts.today} lesson${counts.today === 1 ? "" : "s"} on today.`
            : "Your students, lessons and bookings, all in one place."}
        </p>
      </div>

      {/* ---------------------------------------------------------------- */}
      {/* "Your phone will not ring"                                       */}
      {/* ---------------------------------------------------------------- */}
      {/* Directly under the greeting, because the toggle itself lives in
          the bell menu — which somebody only opens when they already
          suspect there is something waiting. It renders nothing when
          notifications are on, when the browser cannot do push, or when
          there is nothing the person could act on. */}
      <PushNudge />

      {/* ---------------------------------------------------------------- */}
      {/* Where to go                                                      */}
      {/* ---------------------------------------------------------------- */}
      {/* Two columns on the narrowest phones. At 320px four tiles leave
          about 38px for a label, and "Enquiries" needs sixty — it rendered
          as "Enquirie". A 2x2 grid there is bigger to hit and reads
          properly; 360px and up gets the row of four. */}
      <div className="mt-3 grid grid-cols-2 min-[360px]:grid-cols-4 gap-2">
        {QUICK.map(({ id, label, icon: Icon, tone }) => (
          <button
            key={id}
            onClick={() => onGo(id)}
            className={`rounded-2xl px-1.5 py-3 text-white text-center transition active:scale-95 ${QUICK_TONES[tone]}`}
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
      <div className="mt-3 grid grid-cols-2 lg:grid-cols-4 gap-2">
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
        {/* Was New Enquiries. Bookings are the thing with a clock on them:
            an unanswered request holds an hour the instructor cannot sell
            and a learner cannot plan around. Enquiries keep their badge on
            the quick tile above, where a count still shows. */}
        <Stat
          tone="violet" icon={CalendarCheck}
          value={counts.requests} label="New Bookings"
          onClick={() => onGo("bookings")}
        />
      </div>

      {/* The requests themselves, answerable here.

          This was a banner saying "one learner is waiting on you" with a
          chevron into the Bookings screen. Two taps and a screen change to
          answer a yes/no question is enough friction that answers come
          hours later — and the learner's hour stays held for every one of
          them. The same component the Bookings screen uses, so accept and
          decline have one implementation, not two.

          Three at most here; the rest are a tap away. */}
      <div className="mt-3">
        <IncomingBookings
          limit={3}
          heading={false}
          onSeeAll={() => onGo("bookings")}
          onAccepted={() => onGo("calendar")}
          onChanged={onChanged}
          refreshKey={pulse}
        />
      </div>

      {/* Verification used to have a card here for whoever was not yet
          verified. It cannot be reached now — InstructorPortal gates the
          whole dashboard behind verification before this component ever
          mounts (see VerificationGate) — so there is nothing left for an
          unverified instructor to see on this screen at all, which was
          the point. */}

      <div className="mt-3 grid md:grid-cols-2 gap-3">
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
      <div className="mt-3 rounded-2xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 p-4">
        <div className="flex items-center gap-2.5">
          <Banknote size={18} className="text-emerald-500 shrink-0" />
          <h2 className="font-bold text-slate-900 dark:text-white">
            Learners pay you directly
          </h2>
        </div>
        <p className="mt-1.5 text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
          No card is taken on this site and the platform takes nothing — not
          from your own students, not from the ones the directory sends you.
          If that ever changes you will be told here first, in advance, and it
          will not apply to anything already booked.
        </p>
      </div>

      {/* Was "Nothing reaches you outside the app yet", written before push
          and email existed. Both now do — see src/badge.js, src/PushNudge
          and api/notify.js — so the warning it gave was no longer true and
          was left as an UNDERSTATEMENT nobody had corrected: a reader who
          believed it would check the app out of habit rather than trust a
          closed-phone notification that, by now, usually arrives. */}
      <div className="mt-3 rounded-2xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 p-4">
        <div className="flex items-center gap-2.5">
          <BellRing size={18} className="text-emerald-500 shrink-0" />
          <h2 className="font-bold text-slate-900 dark:text-white">
            You'll hear about it, even with the app closed
          </h2>
        </div>
        <p className="mt-1.5 text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
          A booking, message or enquiry reaches you by push notification and
          email, not just inside the app. If a device of yours has gone
          quiet, check it is turned on under Account.
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
      className={`rounded-2xl p-3 text-left transition active:scale-[0.98] ${STAT_TONES[tone]}`}
    >
      <div className="flex items-start justify-between">
        <Icon size={18} />
        <ChevronRight size={14} className="opacity-50" />
      </div>
      <p className="mt-1.5 text-2xl font-black tabular-nums text-slate-900 dark:text-white">
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
    <div className="rounded-2xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 p-3.5">
      <div className="flex items-center gap-2 mb-2.5">
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
   THE GATE

   What an unverified account sees instead of the portal. Used to be: the
   full dashboard, tiles and tab bar and all, with a VerificationCard
   bolted on top of it saying "by the way, none of this works yet." Every
   number on that dashboard was a zero, because an instructor nobody can
   find has no students, no bookings, nothing a calendar could show —
   so the screen's main content was itself an argument for why the screen
   should not be shown.

   This replaces the whole portal, not just the dashboard tile, for as
   long as that is true: Students, Calendar, Bookings and Messages are
   exactly as empty and exactly as pointless as the Home tab was, so
   gating only Home would just move the zeros one tap away rather than
   remove them.

   Two ways out, both honest about what they do:

     - finish verification, via the same InstructorRegistration flow and
       the same status-aware copy (VerificationCard, below) that already
       existed — not duplicated, reused, so the wording for "draft" vs
       "pending" vs "rejected" lives in exactly one place
     - leave for the learner app. This does not create or imply a second,
       learner-facing identity for an instructor account — profiles.role
       is one value, set once at sign-up (sql/05) — it is a plain link to
       /app for somebody who signed up at the wrong door and wants the
       study tool instead, which does not require any particular role to
       use as a guest or to sign in to separately.

   Signing out stays reachable too. Being unverified is not being locked
   out of your own account.
   --------------------------------------------------------------------------- */
export function VerificationGate({ status, profile, draft, onRegister, onSignOut }) {
  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 flex flex-col">
      <div className="bg-gradient-to-br from-slate-900 via-slate-900 to-blue-950 text-white">
        <div
          className="max-w-lg mx-auto px-5 pb-5"
          style={{ paddingTop: "max(1.25rem, calc(env(safe-area-inset-top) + 0.75rem))" }}
        >
          <h1 className="text-xl font-black tracking-tight">Instructor</h1>
          <p className="text-sm text-slate-400">
            {profile?.full_name || draft?.full_name || ""}
          </p>
        </div>
      </div>

      <div className="flex-1 max-w-lg w-full mx-auto px-5 py-5">
        <VerificationCard
          status={status} profile={profile} draft={draft}
          onRegister={onRegister}
        />

        {/* A button, not a line of text easy to mistake for a label — and
            window.location.href rather than a plain <a href>, matching
            how every other exit from this SPA already works (App.jsx's
            own onBack and onExitRole do the same). /app is a separate
            HTML document and a separate bundle (vite.config.js's own
            entries), not a route this router owns, so this has to be a
            real navigation and not React Router's — a plain <a> SHOULD
            already do that on an ordinary page, but inside an installed
            home-screen app (display: standalone) a tap on an anchor has
            been seen to do nothing at all rather than navigate, which is
            exactly the complaint this replaces: forcing it through
            location.href is the one path that works the same whether
            this is a browser tab or an icon on a home screen. */}
        <div className="mt-5">
          <button
            type="button"
            onClick={() => { window.location.href = "/app"; }}
            className="w-full inline-flex items-center justify-center gap-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 font-bold py-3 text-sm transition hover:border-emerald-400 dark:hover:border-emerald-600 hover:text-emerald-600 dark:hover:text-emerald-400"
          >
            <GraduationCap size={16} />
            Not an instructor? Go to the learner app
          </button>
        </div>

        <div className="mt-8 text-center">
          <button
            onClick={onSignOut}
            className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-400 dark:text-slate-500 hover:text-red-500"
          >
            <LogOut size={13} /> Sign out
          </button>
        </div>
      </div>
    </div>
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
          <div
            role="dialog"
            aria-label="Notifications"
            className="absolute right-0 top-full mt-1 z-40 w-72 max-w-[calc(100vw-24px)] rounded-2xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 shadow-xl p-4"
          >
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

            {/* The offer belongs here, where somebody is already thinking
                about being told things — not in a prompt on load. */}
            <PushToggle compact />
          </div>
      )}
    </div>
  );
}
