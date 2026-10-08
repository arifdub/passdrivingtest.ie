/*
  ===========================================================================
  REVIEWS — the instructor's side

  Read them, reply once each. Nothing here can change a rating or remove a
  review, because an instructor who can edit their own reviews has none.
  ===========================================================================
*/

import React, { useState, useEffect, useCallback } from "react";
import { Star, Loader2, AlertCircle, MessageSquare, Check } from "lucide-react";
import { useAuth } from "../appAuth";
import { EmptyState, PrimaryButton, SecondaryButton } from "../ui";
import { Sheet } from "./Students";
import {
  listReviews, ratingsFor, replyToReview, ratingLabel,
  MIN_REVIEWS_TO_SHOW_RATING,
} from "../socialStore";

export function Stars({ value, size = 14 }) {
  return (
    <span className="inline-flex gap-0.5" aria-label={`${value} out of 5`}>
      {[1, 2, 3, 4, 5].map(n => (
        <Star
          key={n}
          size={size}
          className={n <= value ? "text-amber-400 fill-amber-400" : "text-slate-300 dark:text-slate-600"}
        />
      ))}
    </span>
  );
}

export default function Reviews() {
  const { user } = useAuth();
  const [rows, setRows] = useState([]);
  const [rating, setRating] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [replying, setReplying] = useState(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    const [{ rows: r, error: e }, map] = await Promise.all([
      listReviews(user?.id),
      ratingsFor([user?.id]),
    ]);
    setRows(r); setRating(map[user?.id] || null); setError(e); setLoading(false);
  }, [user?.id]);

  useEffect(() => { refresh(); }, [refresh]);

  if (loading) {
    return (
      <div className="flex items-center gap-2.5 text-slate-500 dark:text-slate-400 py-10 justify-center">
        <Loader2 size={18} className="animate-spin" />
        <span className="text-sm">Loading your reviews…</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-2xl border border-amber-200 dark:border-amber-900 bg-amber-50 dark:bg-amber-950/40 p-5">
        <div className="flex items-center gap-2.5">
          <AlertCircle size={18} className="text-amber-500 shrink-0" />
          <h2 className="font-bold text-slate-900 dark:text-white">Reviews aren't set up yet</h2>
        </div>
        <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">
          Run <code className="font-mono text-xs">sql/13-reviews-and-messages.sql</code> and reload.
        </p>
      </div>
    );
  }

  const r = ratingLabel(rating);

  if (!rows.length) {
    return (
      <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl p-8">
        <EmptyState
          icon={Star}
          title="No reviews yet"
          message="Only a learner who has completed a lesson with you can leave one, so these take a while to arrive — and that's what makes them worth having."
        />
      </div>
    );
  }

  return (
    <>
      <div className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-5">
        {r.average !== null ? (
          <>
            <div className="flex items-center gap-3">
              <p className="text-3xl font-black text-slate-900 dark:text-white tabular-nums">
                {r.average.toFixed(1)}
              </p>
              <div>
                <Stars value={Math.round(r.average)} size={16} />
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  from {r.count} review{r.count === 1 ? "" : "s"}
                </p>
              </div>
            </div>
          </>
        ) : (
          <>
            <p className="font-bold text-slate-900 dark:text-white">{r.text}</p>
            <p className="mt-1 text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
              No average is shown anywhere until you have {MIN_REVIEWS_TO_SHOW_RATING}.
              One five-star review is a person's opinion, not a rating, and
              showing it as one would make the number meaningless for
              everybody.
            </p>
          </>
        )}
      </div>

      <div className="mt-4 space-y-2">
        {rows.map(rev => (
          <div
            key={rev.id}
            className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl p-4"
          >
            <div className="flex items-center justify-between gap-3">
              <Stars value={rev.rating} />
              <p className="text-xs text-slate-400 tabular-nums">
                {new Date(rev.created_at).toLocaleDateString("en-IE", { day: "numeric", month: "short", year: "numeric" })}
              </p>
            </div>

            {rev.body && (
              <p className="mt-2 text-sm text-slate-700 dark:text-slate-200 leading-relaxed">
                {rev.body}
              </p>
            )}

            {rev.reply ? (
              <div className="mt-3 rounded-xl bg-slate-50 dark:bg-slate-900/60 p-3">
                <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">
                  Your reply
                </p>
                <p className="mt-1 text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
                  {rev.reply}
                </p>
                <button
                  onClick={() => setReplying(rev)}
                  className="mt-2 text-xs font-bold text-emerald-600 dark:text-emerald-400 hover:underline"
                >
                  Edit reply
                </button>
              </div>
            ) : (
              <button
                onClick={() => setReplying(rev)}
                className="mt-3 inline-flex items-center gap-1.5 text-xs font-bold text-emerald-600 dark:text-emerald-400 hover:underline"
              >
                <MessageSquare size={13} /> Reply
              </button>
            )}
          </div>
        ))}
      </div>

      {replying && (
        <ReplySheet
          review={replying}
          onClose={() => setReplying(null)}
          onSave={async (text) => {
            const { ok, error: e } = await replyToReview(replying.id, text);
            if (ok) { setReplying(null); refresh(); }
            return { ok, error: e };
          }}
        />
      )}
    </>
  );
}

function ReplySheet({ review, onClose, onSave }) {
  const [text, setText] = useState(review.reply || "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  return (
    <Sheet title="Reply to this review" onClose={onClose}>
      <div className="rounded-xl bg-slate-50 dark:bg-slate-900/60 p-3.5">
        <Stars value={review.rating} />
        {review.body && (
          <p className="mt-1.5 text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
            {review.body}
          </p>
        )}
      </div>

      <textarea
        value={text}
        onChange={e => setText(e.target.value)}
        rows={4}
        placeholder="Your reply is public, under their review."
        className="mt-4 w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2.5 text-sm text-slate-900 dark:text-white"
      />
      <p className="mt-1.5 text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
        A short, even reply to a poor review does you more good than a long
        one. Everybody reading it can see both.
      </p>

      {error && (
        <p className="mt-3 text-sm text-red-500 flex items-start gap-1.5">
          <AlertCircle size={15} className="shrink-0 mt-0.5" /> {error}
        </p>
      )}

      <div className="mt-5 space-y-2">
        <PrimaryButton
          disabled={busy}
          onClick={async () => {
            setBusy(true); setError(null);
            const r = await onSave(text);
            if (!r.ok) setError(r.error);
            setBusy(false);
          }}
        >
          {busy ? "…" : review.reply ? "Update reply" : "Post reply"}
        </PrimaryButton>
        <SecondaryButton onClick={onClose}>Cancel</SecondaryButton>
      </div>
    </Sheet>
  );
}
