/*
  ===========================================================================
  APP SHELL

  Holds the navigation stack, the bottom tab bar, and the gate that decides
  whether to show the login screen or the app.

  TWO LAYERS OF NAVIGATION, ON PURPOSE

  Outside: a real router (react-router-dom), because the platform now has
  parts that must have URLs — the front door, the student side, the
  instructor portal, and in time public instructor profiles that Google has
  to be able to index and a learner has to be able to send to a friend.

  Inside the student app: the original stack of view objects. The theory
  section is a fixed tree — home → section → module — and a stack gives a
  correct back button on every screen with no URL handling to get wrong.
  Converting it to routes buys nothing today and would risk the one part of
  this application that is already finished and in use, so it stays.

  Deep links under /app need a rewrite to /app/index.html in production;
  see vercel.json.
  ===========================================================================
*/

import React, { useState, useEffect, useCallback, useRef } from "react";
import {
  BrowserRouter, Routes, Route, Navigate, useNavigate,
} from "react-router-dom";
import {
  Home as HomeIcon, BookOpen, Timer, TrendingUp, User, Loader2, Lock,
  /* Aliased: react-router exports a <Route> too, and the collision is a
     build error, not a warning. */
  Settings as SettingsIcon, Route as RouteIcon, ArrowRight, AlertCircle,
} from "lucide-react";
import { AuthProvider, useAuth } from "./appAuth";
import { PlatformProvider, usePlatform } from "./platform";
import { ProgressProvider } from "./progressStore";
import { TextSizeProvider } from "./textSize";
import AuthScreen from "./AuthScreen";
import RoleEntry from "./RoleEntry";
import StudentOnboarding from "./StudentOnboarding";
import StudentJourney from "./StudentJourney";
import FindInstructor from "./FindInstructor";
import InstructorPortal from "./instructor/InstructorPortal";
import AdminPortal from "./admin/AdminPortal";
import { HomeScreen, MockHubScreen, ProgressScreen, ProfileScreen } from "./screens";
import QuizPlayer from "./QuizPlayer";
import FlashcardPlayer from "./FlashcardPlayer";
import { SECTION_BY_ID, buildMockTest } from "./theorySections";
import { MOCKS, MOCK_BY_ID, DECK_BY_ID, PASS_MARK, lockedForGuest } from "./appStructure";
import { getDeck } from "./contentSources";
import { EmptyState, Logo } from "./ui";

/* The tab ids double as screen ids, so a tab's id must not collide with a
   screen that means something else. "mocks" (the list) is deliberately not
   "mock" (a paper being sat) — one tap of the tab would otherwise drop the
   learner straight into a 90-minute timed exam. */
const TABS = [
  { id: "home",     label: "Home",      icon: HomeIcon },
  /* The journey sits between the theory section and the exam, which is where
     it belongs in the product too: it is the map that explains why the
     theory section is the first thing a learner sees. */
  { id: "journey",  label: "Journey",   icon: RouteIcon },
  /* "Mocks", not "Mock Test": with five tabs the longer label wraps onto two
     lines on a 320px phone and makes that one tab taller than its
     neighbours. Only the label changed — the screen id stays "mocks", which
     is what the routing and the tab/route mapping are keyed on. */
  { id: "mocks",    label: "Mocks",     icon: Timer },
  { id: "progress", label: "Progress",  icon: TrendingUp },
  /* The screen id stays "profile" deliberately — it's only the label that
     changed, and renaming the route would break the tab/route mapping for no
     gain. The screen still shows the account details; Settings is simply a
     better name for what people come here to do. */
  { id: "profile",  label: "Settings",  icon: SettingsIcon },
];

/* ===========================================================================
   NAVIGATION SHELL
   =========================================================================== */
function AppShell() {
  const { journeyStage } = usePlatform();

  /* WHERE A LEARNER LANDS DEPENDS ON WHAT THEY TOLD US.

     Someone studying for the theory test should open straight into the thing
     they came for — the topics and the questions — with no map in the way.

     Everyone else said they are past it: they hold a permit, they're doing
     EDT, they need a car for test day. Opening those five on a theory-test
     home screen tells them this app isn't for them. They get the journey
     instead, which shows where they are, says plainly which parts aren't
     built yet, and still offers the theory section. */
  const startTab = journeyStage && journeyStage !== "theory" ? "journey" : "home";

  const [tab, setTab] = useState(startTab);
  const [stack, setStack] = useState([{ screen: startTab }]);

  /* Measured by the tab bar itself — see the shell's render, below. */
  const [tabBarHeight, setTabBarHeight] = useState(0);
  const [theme, setTheme] = useState(() => {
    try {
      return localStorage.getItem("pdt-theme") || "light";
    } catch {
      return "light";
    }
  });

  useEffect(() => {
    document.documentElement.classList.toggle("dark", theme === "dark");
    try { localStorage.setItem("pdt-theme", theme); } catch { /* ignore */ }
  }, [theme]);

  const toggleTheme = () => setTheme(t => (t === "dark" ? "light" : "dark"));

  const go = useCallback((view) => {
    setStack(s => [...s, view]);
    window.scrollTo(0, 0);
  }, []);

  const back = useCallback(() => {
    setStack(s => (s.length > 1 ? s.slice(0, -1) : s));
    window.scrollTo(0, 0);
  }, []);

  /* Tapping a tab resets that tab to its root — the expected app behaviour. */
  const selectTab = (id) => {
    setTab(id);
    setStack([{ screen: id }]);
    window.scrollTo(0, 0);
  };

  const view = stack[stack.length - 1];
  const canGoBack = stack.length > 1;

  /* Which tab lights up. Derived from what's actually on screen rather than
     from the last tab tapped, because "See all" on the home screen pushes the
     Mock Test screen without going through the tab bar — and a highlighted
     Home tab above a Mock Test screen is the kind of small wrongness that
     makes an app feel unfinished. Falls back to the tab state for screens
     that aren't a tab root, such as a section or a deck. */
  const activeTab = TABS.some(t => t.id === view.screen) ? view.screen : tab;

  /* ---------------------------------------------------------------------
     SWIPE BACK

     Only counts when the gesture starts within 32px of the left edge, the
     way iOS does it. A swipe starting anywhere else would fight the
     flashcard deck, which uses left/right swipes to change card.
     --------------------------------------------------------------------- */
  const swipe = useRef(null);

  function onPointerDown(e) {
    if (!canGoBack) return;
    if (e.clientX > 32) return;
    swipe.current = { x: e.clientX, y: e.clientY };
  }

  function onPointerMove(e) {
    if (!swipe.current) return;
    const dy = Math.abs(e.clientY - swipe.current.y);
    const dx = e.clientX - swipe.current.x;
    // Drifting vertically means they're scrolling, not going back.
    if (dy > 60 && dy > Math.abs(dx)) swipe.current = null;
  }

  function onPointerUp(e) {
    if (!swipe.current) return;
    const dx = e.clientX - swipe.current.x;
    swipe.current = null;
    if (dx > 70) back();
  }

  /* The tab bar is fixed, so the page behind it has no idea it exists and the
     last card on every screen was being clipped. The bar measures itself and
     the shell publishes that as a custom property; src/index.css spends it in
     two places. Measured rather than hard-coded because the bar grows with the
     home-indicator inset and with the reading size. */
  const tabsHidden = isFullScreen(view);

  return (
    <div
      className="app-shell bg-slate-50 dark:bg-slate-900"
      style={{ "--pdt-tabbar": tabsHidden ? "0px" : `${tabBarHeight}px` }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={() => { swipe.current = null; }}
    >
      <div className="app-content">
        <CurrentScreen view={view} go={go} back={back} theme={theme} toggleTheme={toggleTheme} />
      </div>
      <TabBar
        tab={activeTab}
        onSelect={selectTab}
        hidden={tabsHidden}
        onMeasure={setTabBarHeight}
      />
    </div>
  );
}

/* Quiz runs and flashcard decks take over the screen — the tab bar would only
   be a way to lose your place mid-test. */
function isFullScreen(view) {
  return view.screen === "section" || view.screen === "mock" || view.screen === "deck";
}

/* ===========================================================================
   SCREEN SWITCH

   Flatter than before. The app is now home -> section, home -> mock, or
   home -> deck. There are no nested paths left to walk through.
   =========================================================================== */
function CurrentScreen({ view, go, back, theme, toggleTheme }) {
  const { isGuest, exitGuest } = useAuth();
  const navigate = useNavigate();

  /* A guest can reach a locked section from the Progress tab as well as the
     home screen, so the check lives here too. The home screen's lock is the
     signpost; this is the actual gate. */
  const gated = view.screen === "section" ? view.sectionId
    : view.screen === "mock" ? (view.mockId || MOCKS[0].id)
    : null;
  if (gated && lockedForGuest(gated, isGuest)) {
    return <GuestLocked onBack={back} onCreateAccount={exitGuest} />;
  }

  switch (view.screen) {
    case "home":
      return <HomeScreen go={go} />;

    /* The whole road, theory to full licence, and what to do next. */
    case "journey":
      return (
        <StudentJourney
          go={go}
          onChangeStage={() => navigate("/student/onboarding")}
        />
      );

    /* The Mock Test tab — the list of papers and how ready you are. Note the
       plural: "mock" below is a paper actually being sat. */
    case "mocks":
      return <MockHubScreen go={go} />;

    case "progress":
      return <ProgressScreen go={go} />;

    case "profile":
      return <ProfileScreen theme={theme} toggleTheme={toggleTheme} />;

    /* One of the six study topics — practice its questions. */
    case "section": {
      const section = SECTION_BY_ID[view.sectionId];
      if (!section || !section.questions.length) return <NotReady onBack={back} />;
      return (
        <QuizPlayer
          key={section.id}
          module={{
            id: section.id,
            label: section.label,
            sectionLabel: `Topic ${section.number}`,
            kind: "mcq",
            /* One published standard for the whole test, applied here too. */
            passMark: section.passMark ?? PASS_MARK,
          }}
          quiz={{
            title: section.label,
            subtitle: `${section.total} questions · test standard ${section.passMark ?? PASS_MARK}%`,
            categories: [{
              id: section.id,
              title: section.label,
              blurb: section.blurb,
              questions: section.questions,
            }],
          }}
          onExit={back}
        />
      );
    }

    /* A named mock paper. Each is a fixed set of 100 questions with its own
       score history; the order is reshuffled on every attempt. */
    case "mock": {
      const paper = MOCK_BY_ID[view.mockId] || MOCKS[0];
      const questions = buildMockTest(paper.paper, paper.questionCount);
      if (!questions.length) return <NotReady onBack={back} />;
      return (
        <QuizPlayer
          key={paper.id}
          module={{
            id: paper.id,
            label: paper.label,
            sectionLabel: "Exam conditions",
            kind: "mock",
            questionCount: paper.questionCount,
            /* The pass mark is one number, 35 of 40, applied in gradeMock. */
            minutes: paper.minutes,
          }}
          quiz={{
            title: paper.label,
            subtitle: paper.blurb,
            categories: [{ id: paper.id, title: paper.label, questions }],
          }}
          onExit={back}
        />
      );
    }

    /* Where the two halves of the platform meet. Not a tab: a learner needs
       it once, around EDT, not on every screen — and a sixth tab does not fit
       a 320px phone. It is reached from the journey and from Home. */
    case "instructors":
      return <FindInstructor onBack={back} />;

    case "deck": {
      const deck = DECK_BY_ID[view.deckId];
      const content = getDeck(view.deckId);
      if (!deck || !content) return <NotReady onBack={back} />;
      return (
        <FlashcardPlayer
          module={{ id: deck.id, label: deck.label, sectionLabel: "Flashcards" }}
          deck={content}
          onExit={back}
        />
      );
    }

    default:
      return <HomeScreen go={go} />;
  }
}

function GuestLocked({ onBack, onCreateAccount }) {
  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-900 flex flex-col items-center justify-center px-6">
      <div className="max-w-sm text-center">
        <div className="w-12 h-12 rounded-2xl bg-emerald-500 flex items-center justify-center mx-auto">
          <Lock size={22} className="text-white" />
        </div>
        <h2 className="mt-4 text-lg font-black tracking-tight text-slate-900 dark:text-white">
          Create a free account
        </h2>
        <p className="mt-2 text-sm text-slate-500 dark:text-slate-400 leading-relaxed">
          Guests get Rules of the Road and the flashcards in full. An account
          opens the other five topics and the mock tests, and keeps everything
          you've already studied.
        </p>
        <button
          onClick={onCreateAccount}
          className="mt-5 w-full bg-emerald-500 hover:bg-emerald-400 text-slate-900 font-bold py-3 rounded-xl"
        >
          Create a free account
        </button>
        <button
          onClick={onBack}
          className="mt-2 w-full text-sm font-semibold text-slate-500 dark:text-slate-400 py-2.5"
        >
          Go back
        </button>
      </div>
    </div>
  );
}

function NotReady({ onBack }) {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-6">
      <EmptyState
        icon={BookOpen}
        title="Not ready yet"
        message="The content for this section is still being written. It'll appear here as soon as it's added."
      />
      <button
        onClick={onBack}
        className="mt-2 text-sm font-bold text-emerald-600 dark:text-emerald-400"
      >
        Go back
      </button>
    </div>
  );
}

/* ===========================================================================
   TAB BAR
   =========================================================================== */
function TabBar({ tab, onSelect, hidden, onMeasure }) {
  const ref = useRef(null);

  /* Reports its own height, including the home-indicator spacer below the
     labels, so the shell can leave exactly that much room and no more. */
  useEffect(() => {
    if (hidden) { onMeasure(0); return; }
    const el = ref.current;
    if (!el) return;

    const report = () => onMeasure(el.offsetHeight);
    report();

    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(report);
    ro.observe(el);
    return () => ro.disconnect();
  }, [hidden, onMeasure]);

  if (hidden) return null;
  return (
    <nav ref={ref} className="fixed bottom-0 inset-x-0 bg-white/95 dark:bg-slate-800/95 backdrop-blur border-t border-slate-200 dark:border-slate-700 z-20">
      <div className="max-w-2xl mx-auto flex">
        {TABS.map(({ id, label, icon: Icon }) => {
          const active = tab === id;
          return (
            <button
              key={id}
              onClick={() => onSelect(id)}
              className={`flex-1 flex flex-col items-center gap-0.5 py-2.5 transition ${
                active
                  ? "text-emerald-600 dark:text-emerald-400"
                  : "text-slate-400 dark:text-slate-500"
              }`}
            >
              <Icon size={20} strokeWidth={active ? 2.5 : 2} />
              <span className="text-[10px] font-bold uppercase tracking-wider">{label}</span>
            </button>
          );
        })}
      </div>
      {/* iPhone home-indicator clearance */}
      <div style={{ height: "env(safe-area-inset-bottom)" }} />
    </nav>
  );
}


/* ===========================================================================
   ERROR BOUNDARY

   Without this, any exception thrown during render produces a blank white
   page and nothing else — no message on screen, and on a phone there is no
   console to check. That is a miserable thing to debug.

   With it, the error text and the top of the stack are shown on screen, so a
   problem can be diagnosed from the phone it happened on.
   =========================================================================== */
class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null, info: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    this.setState({ info });
    console.error("App crashed:", error, info);
  }

  render() {
    if (!this.state.error) return this.props.children;

    const { error, info } = this.state;
    return (
      <div className="min-h-screen bg-slate-900 text-white p-5 overflow-auto">
        <div className="max-w-2xl mx-auto" style={{ paddingTop: "env(safe-area-inset-top)" }}>
          <h1 className="text-xl font-black tracking-tight mt-4">Something went wrong</h1>
          <p className="mt-2 text-sm text-slate-400">
            The app hit an error while loading. The details below are what to
            send on if you need help fixing it.
          </p>

          <pre className="mt-5 text-xs bg-slate-800 rounded-xl p-4 overflow-x-auto whitespace-pre-wrap break-words text-red-300">
{String(error && (error.stack || error.message || error))}
          </pre>

          {info?.componentStack && (
            <pre className="mt-3 text-xs bg-slate-800 rounded-xl p-4 overflow-x-auto whitespace-pre-wrap break-words text-slate-400">
{info.componentStack.trim().split("\n").slice(0, 8).join("\n")}
            </pre>
          )}

          <button
            onClick={() => window.location.reload()}
            className="mt-5 w-full bg-emerald-500 hover:bg-emerald-400 text-slate-900 font-bold py-3 rounded-xl"
          >
            Reload
          </button>

          <button
            onClick={() => {
              try { localStorage.clear(); } catch { /* ignore */ }
              window.location.reload();
            }}
            className="mt-2.5 w-full border border-slate-600 text-slate-300 font-bold py-3 rounded-xl"
          >
            Clear saved data and reload
          </button>
        </div>
      </div>
    );
  }
}

/* ===========================================================================
   GATE — the student app, behind whatever access rules apply

   Unchanged from before the platform split: the theory experience and who is
   allowed into it are exactly as they were. It simply sits under /student now
   rather than being the whole application.
   =========================================================================== */
function Splash() {
  return (
    <div className="min-h-screen bg-slate-900 flex flex-col items-center justify-center gap-3">
      <Loader2 size={28} className="text-emerald-400 animate-spin" />
      <p className="text-sm text-slate-400">Loading…</p>
    </div>
  );
}

function StudentGate() {
  const { loading, hasAccess } = useAuth();

  if (loading) return <Splash />;

  if (!hasAccess) return <AuthScreen />;

  return (
    <ProgressProvider>
      <AppShell />
    </ProgressProvider>
  );
}

/* ===========================================================================
   ROUTES

   Three doors, each a top-level address someone can be sent:

     /student   the learning app        (theory, journey, progress)
     /adi       the instructor's business
     /admin     platform administration

   plus two supporting paths:

     /student/onboarding   where are you up to?  (asked once)
     /app                  the legacy entry

   WHY /app STILL EXISTS

   Because home-screen icons point at it. The manifest's start_url is /app/,
   and every learner who already installed the app has that URL baked into
   their icon — iOS captured it at install time and will not re-read the
   manifest. Removing the route would turn their app into a 404. So it stays,
   and forwards to whichever door suits them.

   The front door itself is no longer in here: it's the static page at /,
   which is faster, indexable, and the thing people actually type.
   =========================================================================== */
function LegacyEntry() {
  const { hasChosenRole, isInstructor, setRole } = usePlatform();
  const navigate = useNavigate();

  /* Someone who has used the app before goes straight back to their side. */
  if (hasChosenRole) {
    return <Navigate to={isInstructor ? "/adi" : "/student"} replace />;
  }

  /* An installed app with no stored role — most likely a learner whose
     browser data was cleared. Ask rather than guess. */
  return (
    <RoleEntry
      onChoose={(role) => {
        setRole(role);
        navigate(role === "instructor" ? "/adi" : "/student/onboarding");
      }}
    />
  );
}

/* ---------------------------------------------------------------------------
   SIGN IN AND SIGN UP, AS ADDRESSES

   /student/signin  /student/signup  /adi/signin  /adi/signup

   WHY THESE ARE SEPARATE ROUTES AND NOT A QUERY STRING

   The landing page offers four of them — sign in and sign up, for learners
   and for instructors — and each needs to land on the form itself. Three
   things make that impossible through /student alone:

     · /student redirects anyone without a journey stage to the onboarding
       question. Correct for a learner starting out, wrong for someone who
       already has an account and is trying to get back into it — they'd be
       asked where they're up to before being allowed to prove who they are.
     · /student's gate hands guests straight through, so a guest tapping
       "Sign in" would land back in the app they were already in, with no
       form in sight.
     · /adi doesn't gate on auth at all. The portal is readable while signed
       out by design, so "Sign in" there has nowhere to point.

   A returning user is sent on as soon as they're signed in, so these
   addresses are never a dead end if they're bookmarked.
   --------------------------------------------------------------------------- */
function StudentAuthRoute({ view }) {
  const { claimRole } = usePlatform();
  const { loading, isSignedIn } = useAuth();

  /* Same as /student: the door they came through is their answer to "which
     are you?". claimRole never overwrites a choice already made. */
  useEffect(() => { claimRole("student"); }, [claimRole]);

  if (loading) return <Splash />;

  /* isSignedIn, not hasAccess: a guest asking to sign in must get the form,
     not be waved through on the access they already had. */
  if (isSignedIn) return <Navigate to="/student" replace />;

  return (
    <AuthScreen
      audience="student"
      initialView={view}
      onBack={() => { window.location.href = "/"; }}
    />
  );
}

function InstructorAuthRoute({ view }) {
  const { claimRole } = usePlatform();
  const { loading, isSignedIn } = useAuth();

  useEffect(() => { claimRole("instructor"); }, [claimRole]);

  if (loading) return <Splash />;
  if (isSignedIn) return <Navigate to="/adi" replace />;

  return (
    <AuthScreen
      audience="instructor"
      initialView={view}
      /* No guest mode here. Guest exists so a learner can try the questions
         before giving an email; an instructor has nothing to try — the one
         thing registration does needs an account to submit against. */
      allowGuest={false}
      onBack={() => { window.location.href = "/"; }}
    />
  );
}

/* ---------------------------------------------------------------------------
   ADD THIS SIDE

   A learner's account at /adi, or an instructor's at /student.

   This used to be a dead end that told them to register again with a second
   email address. That was wrong about how people actually are: the same
   person learns, teaches, and sends their own kids through the test. An ADI
   who wants to read the theory material should not need a second inbox, and a
   learner who qualifies three years later should not lose their account.

   So it is an offer, not a refusal. One tap adds the side to the account they
   already have — same email, same password, same sign-in.

   WHY IT IS A TAP AND NOT AUTOMATIC

   Because walking through a door is not the same as asking to live there. A
   learner tapping "For instructors" on the front page to see what it is must
   not quietly become an instructor, and an ADI glancing at the theory section
   must not find a learner's app in their account tomorrow. The person decides,
   once, in a sentence they can read.

   Nothing is granted by this that could not be had anyway: both sides are
   self-service sign-ups. Holding the instructor side means the portal opens —
   it has never meant an ADI number has been checked, and sql/06 still says a
   person does that.
   --------------------------------------------------------------------------- */
function AddSide({ side }) {
  const { signOut, user } = useAuth();
  const { addSide, accountRoles } = usePlatform();

  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState(null);

  const wantInstructor = side === "instructor";
  const label = wantInstructor ? "instructor" : "learner";
  const other = wantInstructor ? "learner" : "instructor";
  const elsewhere = wantInstructor ? "/student" : "/adi";

  /* NO navigate() HERE, AND THAT IS THE WHOLE TRICK.

     This screen is rendered BY the route the person already asked for — the
     gate inside /student or /adi, standing in front of the real thing. Adding
     the side changes what that gate decides, so the route renders its own
     content on the next pass and there is nowhere to go.

     Navigating anyway cost an afternoon: /student would navigate to /student,
     which lands in the same place but counts as a navigation, and it landed
     AFTER the gate's own <Navigate> to the onboarding question. React
     Router's <Navigate> fires once on mount, so it never ran again and the
     screen went blank — a route rendering a redirect that had already been
     overruled. */
  async function add() {
    setBusy(true);
    setProblem(null);
    const result = await addSide(side);
    setBusy(false);
    if (!result.ok) setProblem(result.error);
  }

  return (
    <div
      className="min-h-screen bg-slate-900 flex flex-col items-center justify-center px-5"
      style={{ paddingTop: "max(2rem, env(safe-area-inset-top))" }}
    >
      <div className="w-full max-w-sm">
        <Logo size="md" className="mx-auto" />

        <div className="mt-7 bg-white dark:bg-slate-800 rounded-2xl p-6 shadow-xl">
          <h1 className="text-xl font-black tracking-tight text-slate-900 dark:text-white">
            Add the {label} side to your account
          </h1>
          <p className="mt-2 text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
            {user?.email ? <strong>{user.email}</strong> : "This account"} is
            set up as {other === "learner" ? "a learner" : "an instructor"}.
            You can have both — same email, same password, nothing else to
            fill in.
          </p>
          <p className="mt-2 text-sm text-slate-500 dark:text-slate-400 leading-relaxed">
            {wantInstructor
              ? "You'll be asked for your ADI number afterwards, and a person checks it against the RSA register before any learner can see you."
              : "The theory questions, mock tests and flashcards, same as any learner gets."}
          </p>

          {problem && (
            <div className="mt-4 flex items-start gap-2 text-sm bg-red-50 dark:bg-red-950/40 text-red-700 dark:text-red-300 rounded-xl px-3 py-2.5">
              <AlertCircle size={15} className="mt-0.5 shrink-0" />
              <span>{problem}</span>
            </div>
          )}

          <button
            onClick={add}
            disabled={busy}
            className="mt-5 w-full flex items-center justify-center gap-2 bg-emerald-500 hover:bg-emerald-400 disabled:opacity-60 text-slate-900 font-bold py-3 rounded-xl transition"
          >
            {busy && <Loader2 size={16} className="animate-spin" />}
            Add the {label} side
          </button>

          {/* Where they already belong, for someone who arrived here by
              mistake rather than by intent. */}
          {accountRoles.length > 0 && (
            <a
              href={elsewhere}
              className="mt-2 w-full flex items-center justify-center gap-2 text-sm font-semibold text-slate-500 dark:text-slate-400 hover:text-emerald-600 dark:hover:text-emerald-400 py-2.5"
            >
              Back to my {other} {other === "learner" ? "app" : "portal"} <ArrowRight size={14} />
            </a>
          )}

          <button
            onClick={signOut}
            className="w-full text-sm font-semibold text-slate-500 dark:text-slate-400 hover:text-emerald-600 dark:hover:text-emerald-400 py-2.5"
          >
            Sign out and use a different account
          </button>
        </div>

        <button
          onClick={() => { window.location.href = "/"; }}
          className="mt-3 w-full text-sm font-semibold text-slate-400 hover:text-emerald-400 py-2.5"
        >
          Back to passdrivingtest.ie
        </button>
      </div>
    </div>
  );
}

function StudentOnboardingRoute() {
  const { setJourneyStage } = usePlatform();
  const { isSignedIn, continueAsGuest } = useAuth();
  const navigate = useNavigate();

  return (
    <StudentOnboarding
      onContinue={(stageId) => {
        setJourneyStage(stageId);

        /* STRAIGHT INTO THE LEARNING SECTION, NOT A SIGN-UP SCREEN.

           They clicked "Start learning — free" on the front door and then
           answered a question about themselves. Asking for an email before
           showing them a single question is how that goodwill gets spent.

           Guest mode already exists and already does the right thing: Rules
           of the Road and the flashcards in full, the other five topics and
           the mock tests visible but locked, each one offering a free
           account. The ask happens where it means something — at the thing
           they just tried to open — instead of at the door.

           Signing in still gets them everything, and every locked topic,
           the journey screen and Settings all lead there. */
        if (!isSignedIn) continueAsGuest();

        navigate("/student", { replace: true });
      }}
      /* Back goes out to the front door, which is a real page, not a route
         this router owns. */
      onBack={() => { window.location.href = "/"; }}
    />
  );
}

function StudentRoute() {
  const { journeyStage, claimRole, mayUseStudent } = usePlatform();
  const { loading } = useAuth();

  /* Arriving at /student is the answer to "which are you?", the same way
     /adi is. Most learners now come straight from the landing page and never
     see the in-app chooser, so without this their role is never recorded —
     and the next time they open their installed app at /app it would ask
     them to pick a side they already picked.

     claimRole, not setRole: it fills a blank and never overwrites a choice
     already made. See platform.jsx. */
  useEffect(() => { claimRole("student"); }, [claimRole]);

  if (loading) return <Splash />;

  /* An instructor's account does not open the learner's app. See platform.jsx
     — this reads the role the database holds, not the one on the device. */
  if (!mayUseStudent) return <AddSide side="student" />;

  /* Someone who chose "student" but never answered the journey question —
     including everyone who was already using the app before the platform
     split — is asked once, then never again. */
  if (!journeyStage) return <Navigate to="/student/onboarding" replace />;

  return <StudentGate />;
}

function InstructorRoute() {
  const { claimRole, mayUseInstructor } = usePlatform();
  const { loading, isSignedIn } = useAuth();

  /* Same as the student side: record the door they came through so /app
     knows where to send them next time — but only if they hadn't already
     picked one. A learner who taps "For instructors" on the front door to
     see what it is must not have their app switched out from under them. */
  useEffect(() => { claimRole("instructor"); }, [claimRole]);

  if (loading) return <Splash />;

  /* THE PORTAL BEGINS AT THE DOOR

     This used to render signed out, on the reasoning that an ADI deciding
     whether to join shouldn't need an account to see what they'd be joining.
     The landing page already does that job, and better: it is the page that
     explains the platform, and it is the one that gets indexed. What the
     portal showed a signed-out visitor was a dashboard they couldn't use and
     a registration form that couldn't be submitted.

     So the account comes first, and it asks for almost nothing: an email and
     a password. The ADI number, areas, lesson types and rates are a dozen
     fields that nobody fills in between lessons, and they are now asked for
     inside the portal, whenever it suits — saved as a draft at every step,
     and submitted for verification when it's done. Registering and getting
     verified are two different days.

     isSignedIn, not hasAccess: guest mode is a learner's affordance and has
     no meaning here. */
  if (!isSignedIn) {
    return (
      <AuthScreen
        audience="instructor"
        allowGuest={false}
        onBack={() => { window.location.href = "/"; }}
      />
    );
  }

  /* Signed in, but with a learner's account. */
  if (!mayUseInstructor) return <AddSide side="instructor" />;

  return (
    <InstructorPortal
      /* Back out to the static front door, not an in-app screen: that page
         is where both doors are. A full navigation, because / is not a route
         this router owns. */
      onExitRole={() => { window.location.href = "/"; }}
    />
  );
}

/* ===========================================================================
   ROOT
   =========================================================================== */
export default function App() {
  return (
    <ErrorBoundary>
      {/* Outside the auth gate on purpose: the reading size is a device
          preference, not an account one, so it should apply on the welcome
          and login screens too — and survive signing out. */}
      <TextSizeProvider>
        <AuthProvider>
          {/* Inside Auth so the chosen role can follow a learner up to their
              account the moment they make one, and come back down on another
              device when they sign in. */}
          <PlatformProvider>
            {/* No basename. The same bundle is served at /student, /adi,
                /admin and /app — Vercel rewrites all four to this page — so
                the router matches real, top-level paths. */}
            <BrowserRouter>
              <Routes>
                <Route path="/student/signin" element={<StudentAuthRoute view="login" />} />
                <Route path="/student/signup" element={<StudentAuthRoute view="signup" />} />
                <Route path="/student/onboarding" element={<StudentOnboardingRoute />} />
                <Route path="/student/*" element={<StudentRoute />} />

                <Route path="/adi/signin" element={<InstructorAuthRoute view="login" />} />
                <Route path="/adi/signup" element={<InstructorAuthRoute view="signup" />} />
                <Route path="/adi/*" element={<InstructorRoute />} />
                <Route path="/admin/*" element={<AdminPortal />} />

                {/* Legacy, and the fallback. Both land somewhere useful
                    rather than on a dead end. */}
                <Route path="/app/*" element={<LegacyEntry />} />
                <Route path="*" element={<LegacyEntry />} />
              </Routes>
            </BrowserRouter>
          </PlatformProvider>
        </AuthProvider>
      </TextSizeProvider>
    </ErrorBoundary>
  );
}
