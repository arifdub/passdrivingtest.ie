/*
  ===========================================================================
  LEAVING A REVIEW

  Only reachable by a learner who completed a lesson with this instructor —
  checked by asking the database, not by guessing from what the app happens
  to have loaded. The same rule is enforced again by a trigger when the
  review is written, so a crafted request gets the same answer as the button.
  ===========================================================================
*/

import React, { useState } from "react";
import { Star, AlertCircle, X } from "lucide-react";
import { PrimaryButton, SecondaryButton } from "./ui";
import { saveReview } from "./socialStore";

export default function ReviewSheet({ instructor, learnerId, existing, onClose, onSaved }) {
  const [rating, setRating] = useState(existing?.rating || 0);
  const [body, setBody] = useState(existing?.body || "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  return (
    <div className="fixed inset-0 z-40 bg-slate-900/70 backdrop-blur-sm flex items-end" onClick={onClose}>
      <div
        className="w-full max-h-[92vh] overflow-y-auto bg-white dark:bg-slate-800 rounded-t-3xl p-6"
        style={{ paddingBottom: "max(1.5rem, calc(env(safe-area-inset-bottom) + 1rem))" }}
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <h2 className="text-lg font-black tracking-tight text-slate-900 dark:text-white">
            {existing ? "Update your review" : `Review ${instructor.full_name || "your instructor"}`}
          </h2>
          <button onClick={onClose} aria-label="Close" className="shrink-0 -mr-2 -mt-1 text-slate-400 p-3">
            <X size={20} />
          </button>
        </div>

        <div className="mt-4 flex gap-1.5">
          {[1, 2, 3, 4, 5].map(n => (
            <button
              key={n}
              onClick={() => setRating(n)}
              aria-label={`${n} star${n === 1 ? "" : "s"}`}
              className="p-1"
            >
              <Star
                size={30}
                className={n <= rating
                  ? "text-amber-400 fill-amber-400"
                  : "text-slate-300 dark:text-slate-600"}
              />
            </button>
          ))}
        </div>

        <textarea
          value={body}
          onChange={e => setBody(e.target.value)}
          rows={4}
          placeholder="What were the lessons like? Optional."
          className="mt-4 w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2.5 text-sm text-slate-900 dark:text-white"
        />

        <p className="mt-2 text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
          This is public, under their name, and they can reply to it once.
          You can change or delete it later — a bad first lesson and a good
          tenth is a real thing.
        </p>

        {error && (
          <p className="mt-3 text-sm text-red-500 flex items-start gap-1.5">
            <AlertCircle size={15} className="shrink-0 mt-0.5" /> {error}
          </p>
        )}

        <div className="mt-5 space-y-2">
          <PrimaryButton
            disabled={busy || !rating}
            onClick={async () => {
              setBusy(true); setError(null);
              const r = await saveReview({
                instructorId: instructor.user_id, learnerId, rating, body,
              });
              setBusy(false);
              if (r.ok) onSaved(); else setError(r.error);
            }}
          >
            {busy ? "…" : existing ? "Update review" : "Post review"}
          </PrimaryButton>
          <SecondaryButton onClick={onClose}>Cancel</SecondaryButton>
        </div>
      </div>
    </div>
  );
}
