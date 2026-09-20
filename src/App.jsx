/*
  ===========================================================================
  APP SHELL

  Holds the navigation stack, the bottom tab bar, and the gate that decides
  whether to show the login screen or the app.

  Navigation is a plain stack of view objects rather than a router. The app is
  a fixed tree — home → path → section → module — and a stack gives a correct
  back button on every screen with no URL handling to get wrong. Swap in a
  router later if deep links are ever needed.
  ===========================================================================
*/

import React, { useState, useEffect, useCallback, useRef } from "react";
import {
  Home as HomeIcon, BookOpen, Timer, TrendingUp, User, Loader2, Lock,
  Settings as SettingsIcon,
} from "lucide-react";
import { AuthProvider, useAuth } from "./appAuth";
import { ProgressProvider } from "./progressStore";
import { TextSizeProvider } from "./textSize";
import AuthScreen from "./AuthScreen";
import { HomeScreen, MockHubScreen, ProgressScreen, ProfileScreen } from "./screens";
import QuizPlayer from "./QuizPlayer";
import FlashcardPlayer from "./FlashcardPlayer";
import { SECTION_BY_ID, buildMockTest } from "./theorySections";
import { MOCKS, MOCK_BY_ID, DECK_BY_ID, PASS_MARK, lockedForGuest } from "./appStructure";
import { getDeck } from "./contentSources";
import { EmptyState } from "./ui";

/* The tab ids double as screen ids, so a tab's id must not collide with a
   screen that means something else. "mocks" (the list) is deliberately not
   "mock" (a paper being sat) — one tap of the tab would otherwise drop the
   learner straight into a 90-minute timed exam. */
const TABS = [
  { id: "home",     label: "Home",      icon: HomeIcon },
  { id: "mocks",    label: "Mock Test", icon: Timer },
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
  const [tab, setTab] = useState("home");
  const [stack, setStack] = useState([{ screen: "home" }]);
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

  return (
    <div
      className="min-h-screen bg-slate-50 dark:bg-slate-900"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={() => { swipe.current = null; }}
    >
      <CurrentScreen view={view} go={go} back={back} theme={theme} toggleTheme={toggleTheme} />
      <TabBar tab={activeTab} onSelect={selectTab} hidden={isFullScreen(view)} />
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
function TabBar({ tab, onSelect, hidden }) {
  if (hidden) return null;
  return (
    <nav className="fixed bottom-0 inset-x-0 bg-white/95 dark:bg-slate-800/95 backdrop-blur border-t border-slate-200 dark:border-slate-700 z-20">
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
   GATE
   =========================================================================== */
function Gate() {
  const { loading, hasAccess } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-900 flex flex-col items-center justify-center gap-3">
        <Loader2 size={28} className="text-emerald-400 animate-spin" />
        <p className="text-sm text-slate-400">Loading…</p>
      </div>
    );
  }

  if (!hasAccess) return <AuthScreen />;

  return (
    <ProgressProvider>
      <AppShell />
    </ProgressProvider>
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
          <Gate />
        </AuthProvider>
      </TextSizeProvider>
    </ErrorBoundary>
  );
}
