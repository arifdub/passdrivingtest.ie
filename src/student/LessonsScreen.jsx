/*
  LESSONS — finding an instructor, and asking for lessons when the
  directory has nobody suitable.

  Two parts: the directory (with the learner's own bookings on top, as
  before) and their lesson requests (sql/32).
*/

import React from "react";
import { Search, Megaphone } from "lucide-react";
import { ScreenHeader, Screen } from "../ui";
import FindInstructor from "../FindInstructor";
import LessonRequests from "./LessonRequests";
import StudentAccount from "./StudentAccount";

export const LESSON_PARTS = [
  { id: "find",     label: "Find an instructor", icon: Search },
  { id: "requests", label: "Lesson requests",    icon: Megaphone },
];

export default function LessonsScreen({ go, segment = "find", onSegment }) {
  return (
    <>
      <ScreenHeader
        title="Driving lessons"
        subtitle="Book a verified instructor, or tell them what you need"
        right={<StudentAccount go={go} />}
        below={
          <div role="tablist" className="mt-4 grid grid-cols-2 gap-1 rounded-2xl bg-white/10 p-1">
            {LESSON_PARTS.map(({ id, label, icon: Icon }) => {
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
        {segment === "requests" ? <LessonRequests go={go} /> : <FindInstructor embedded onPostRequest={() => onSegment("requests")} />}
      </Screen>
    </>
  );
}
