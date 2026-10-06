/*
  ===========================================================================
  STUDENT ONBOARDING — "where are you on your driving journey?"

  Asked once, straight after someone says they're a student, and still before
  any account. Six answers, from "I haven't sat the theory test" through to
  "I just need a car for test day" (see JOURNEY_STAGES in platform.jsx).

  WHY ASK AT ALL

  Because the honest answer to "what should I do next?" is completely
  different for each of them, and a platform that opens every learner on a
  theory-test home screen is wrong for five of the six. The stage picked here
  is what lets the dashboard lead with the right next step rather than a menu.

  It is a hint, not a commitment — it can be changed at any time, and nothing
  is locked behind it. Someone who picks "I'm doing EDT" can still open the
  theory section.
  ===========================================================================
*/

import React, { useState } from "react";
import { Check, ChevronLeft } from "lucide-react";
import { JOURNEY_STAGES } from "./platform";
import { Logo, PrimaryButton } from "./ui";

export default function StudentOnboarding({ onContinue, onBack }) {
  const [picked, setPicked] = useState(null);

  return (
    <div
      className="min-h-screen bg-slate-900 flex flex-col items-center px-5"
      style={{
        paddingTop: "max(1.5rem, calc(env(safe-area-inset-top) + 1rem))",
        paddingBottom: "max(2rem, calc(env(safe-area-inset-bottom) + 1.25rem))",
      }}
    >
      <div className="w-full max-w-sm">
        {onBack && (
          <button
            onClick={onBack}
            className="inline-flex items-center gap-1 text-xs font-bold uppercase tracking-widest text-slate-400 hover:text-emerald-400 py-1"
          >
            <ChevronLeft size={16} /> Back
          </button>
        )}

        <div className="flex justify-center mt-2">
          <Logo size="md" />
        </div>

        <h1 className="mt-6 text-2xl font-black tracking-tight text-white leading-tight">
          Where are you in your driving journey?
        </h1>
        <p className="mt-2 text-sm text-slate-400 leading-relaxed">
          So we can show you the right next step. You can change this any time.
        </p>

        <div className="mt-6 space-y-2.5">
          {JOURNEY_STAGES.map(stage => (
            <StageCard
              key={stage.id}
              stage={stage}
              selected={picked === stage.id}
              onSelect={() => setPicked(stage.id)}
            />
          ))}
        </div>

        <div className="mt-6">
          <PrimaryButton
            onClick={() => picked && onContinue(picked)}
            disabled={!picked}
          >
            Continue
          </PrimaryButton>
        </div>
      </div>
    </div>
  );
}

function StageCard({ stage, selected, onSelect }) {
  const { icon: Icon, label, blurb } = stage;

  return (
    <button
      onClick={onSelect}
      aria-pressed={selected}
      className={`w-full text-left rounded-2xl p-3.5 flex items-start gap-3 border transition active:scale-[0.99] ${
        selected
          ? "bg-emerald-500/10 border-emerald-500"
          : "bg-slate-800 border-slate-700 hover:border-slate-600"
      }`}
    >
      <span
        className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${
          selected ? "bg-emerald-500 text-slate-900" : "bg-slate-900 text-slate-300"
        }`}
      >
        {selected ? <Check size={18} strokeWidth={3} /> : <Icon size={18} />}
      </span>
      <span className="min-w-0 flex-1 pt-0.5">
        <span className="block font-bold text-white text-sm leading-snug">{label}</span>
        <span className="block text-xs text-slate-400 leading-snug mt-0.5">{blurb}</span>
      </span>
    </button>
  );
}
