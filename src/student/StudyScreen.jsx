/*
  STUDY — everything for the theory test in one tab.

  It used to be three tabs (Home was the topic list, Mocks, Progress). The
  app is for every learner now — theory, lessons, pre-test — so the theory
  material lives together here and the tab bar is free for the rest.

  Three parts, one header: Practice (topics and flashcards), Mock tests,
  and Progress. The screens themselves are the same ones as before
  (screens.jsx), drawn without their own headers.
*/

import React from "react";
import { BookOpen, Timer, TrendingUp } from "lucide-react";
import { ScreenHeader, Screen } from "../ui";
import { PracticeScreen, MockHubScreen, ProgressScreen } from "../screens";
import StudentAccount from "./StudentAccount";

export const STUDY_PARTS = [
  { id: "practice", label: "Practice", icon: BookOpen },
  { id: "mocks",    label: "Mock tests", icon: Timer },
  { id: "progress", label: "Progress", icon: TrendingUp },
];

export default function StudyScreen({ go, segment = "practice", onSegment }) {
  /* "See all" on the practice list asks for the mocks screen; inside this
     tab that is a change of part, not a new screen. */
  const goHere = (view) => {
    if (view.screen === "mocks" || view.screen === "progress") return onSegment(view.screen);
    return go(view);
  };

  return (
    <>
      <ScreenHeader
        title="Study theory"
        subtitle="Car, category B · 40 questions, 35 to pass"
        right={<StudentAccount go={go} />}
        below={
          <div role="tablist" className="mt-4 grid grid-cols-3 gap-1 rounded-2xl bg-white/10 p-1">
            {STUDY_PARTS.map(({ id, label, icon: Icon }) => {
              const on = segment === id;
              return (
                <button key={id} role="tab" aria-selected={on} onClick={() => onSegment(id)}
                  className={`inline-flex items-center justify-center gap-1.5 rounded-xl py-2 text-xs font-bold transition ${
                    on ? "bg-white text-slate-900" : "text-slate-300 hover:text-white"}`}>
                  <Icon size={14} /> {label}
                </button>
              );
            })}
          </div>
        }
      />
      <Screen>
        {segment === "mocks" ? <MockHubScreen go={goHere} embedded />
          : segment === "progress" ? <ProgressScreen go={goHere} embedded />
          : <PracticeScreen go={goHere} embedded />}
      </Screen>
    </>
  );
}
