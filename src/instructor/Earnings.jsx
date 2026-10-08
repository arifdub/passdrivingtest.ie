/*
  ===========================================================================
  EARNINGS

  What this screen is: a record of the lessons you have taught and what they
  were worth, counted from your own calendar.

  What it is not: a payout. No money passes through this site. Learners pay
  their instructor directly, the way they always have, and the platform takes
  nothing — so there is no balance here, nothing in transit, and nothing to
  withdraw. Saying that once, at the top, is better than letting someone work
  it out from the absence of a button.

  COMPLETED, NOT SCHEDULED

  Only lessons marked taught are counted. A scheduled lesson is shown
  separately as "coming up" and never added in: a week's earnings that
  includes three lessons that have not happened is a number that will be
  wrong by Friday, and the kind of wrong that gets planned around.

  A LESSON WITH NO PRICE IS NOT A LESSON WORTH NOTHING

  Blank is "not recorded" and is counted as such — shown as a number of
  lessons without a figure — rather than quietly folded in as zero, which
  would understate a week and look like a bug in the arithmetic.
  ===========================================================================
*/

import React, { useState, useEffect, useCallback } from "react";
import {
  Wallet, Loader2, AlertCircle, TrendingUp, Banknote, CalendarClock,
} from "lucide-react";
import { useAuth } from "../appAuth";
import { EmptyState } from "../ui";
import { listLessons, euro, KIND_LABEL } from "./teachingStore";

/* Monday-first, matching the calendar. */
export function weekStart(d = new Date()) {
  const out = new Date(d);
  out.setHours(0, 0, 0, 0);
  out.setDate(out.getDate() - ((out.getDay() + 6) % 7));
  return out;
}

export function monthStart(d = new Date()) {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

/* The arithmetic, kept pure so it can be tested without a database.

   Returns the money that was actually recorded, the count of lessons behind
   it, and separately the lessons that had no price on them — because those
   two facts cannot be collapsed into one number without lying about one of
   them. */
export function tally(lessons, { from, to } = {}) {
  let cents = 0, counted = 0, unpriced = 0;

  for (const l of lessons) {
    if (l.status !== "completed") continue;
    const at = new Date(l.starts_at);
    if (from && at < from) continue;
    if (to && at >= to) continue;

    if (typeof l.price_cents === "number") { cents += l.price_cents; counted++; }
    else unpriced++;
  }

  return { cents, counted, unpriced, lessons: counted + unpriced };
}

export default function Earnings() {
  const { user } = useAuth();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    /* A year back is enough for every view here and keeps one read doing
       the work of four. */
    const from = new Date(); from.setFullYear(from.getFullYear() - 1);
    const to = new Date(); to.setDate(to.getDate() + 60);
    const { rows: r, error: e } = await listLessons(user?.id, { from, to });
    setRows(r); setError(e); setLoading(false);
  }, [user?.id]);

  useEffect(() => { refresh(); }, [refresh]);

  if (loading) {
    return (
      <div className="flex items-center gap-2.5 text-slate-500 dark:text-slate-400 py-10 justify-center">
        <Loader2 size={18} className="animate-spin" />
        <span className="text-sm">Adding it up…</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-2xl border border-amber-200 dark:border-amber-900 bg-amber-50 dark:bg-amber-950/40 p-5">
        <div className="flex items-center gap-2.5">
          <AlertCircle size={18} className="text-amber-500 shrink-0" />
          <h2 className="font-bold text-slate-900 dark:text-white">Couldn't read your lessons</h2>
        </div>
        <p className="mt-2 text-xs text-slate-500 dark:text-slate-400 font-mono break-all">{error}</p>
      </div>
    );
  }

  const now = new Date();
  const thisWeek = tally(rows, { from: weekStart(now) });
  const lastWeek = tally(rows, { from: weekStart(new Date(now.getTime() - 7 * 86400000)), to: weekStart(now) });
  const thisMonth = tally(rows, { from: monthStart(now) });
  const everything = tally(rows);

  const upcoming = rows
    .filter(l => l.status === "scheduled" && new Date(l.starts_at) >= now)
    .reduce((sum, l) => sum + (l.price_cents || 0), 0);

  /* The most recent taught lessons, which is what someone checking a figure
     actually wants to look at. */
  const recent = rows
    .filter(l => l.status === "completed")
    .sort((a, b) => new Date(b.starts_at) - new Date(a.starts_at))
    .slice(0, 12);

  return (
    <>
      {/* The one thing this screen must say before any number. */}
      <div className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-4 flex items-start gap-3">
        <Banknote size={18} className="text-emerald-500 shrink-0 mt-0.5" />
        <p className="text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
          <strong className="text-slate-900 dark:text-white">Learners pay you directly.</strong>{" "}
          No money passes through this site and the platform takes nothing, so
          there is no balance and nothing to withdraw. This is a record of
          what you taught, counted from your own calendar.
        </p>
      </div>

      {everything.lessons === 0 ? (
        <div className="mt-4 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl p-8">
          <EmptyState
            icon={Wallet}
            title="Nothing taught yet"
            message="Mark a lesson as taught in your calendar and it turns up here, with whatever price you put on it."
          />
        </div>
      ) : (
        <>
          <div className="mt-4 grid grid-cols-2 lg:grid-cols-4 gap-3">
            <Figure label="This week" t={thisWeek} compare={lastWeek} />
            <Figure label="Last week" t={lastWeek} />
            <Figure label="This month" t={thisMonth} />
            <Figure label="All time" t={everything} />
          </div>

          {upcoming > 0 && (
            <div className="mt-3 rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-4 flex items-center gap-3">
              <CalendarClock size={18} className="text-blue-500 shrink-0" />
              <p className="text-sm text-slate-600 dark:text-slate-300">
                <strong className="text-slate-900 dark:text-white tabular-nums">{euro(upcoming)}</strong>{" "}
                of lessons are scheduled but not taught yet. Not counted above.
              </p>
            </div>
          )}

          <h2 className="mt-6 font-black tracking-tight text-slate-900 dark:text-white">
            Recently taught
          </h2>
          <div className="mt-3 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl divide-y divide-slate-100 dark:divide-slate-700">
            {recent.map(l => (
              <div key={l.id} className="p-3.5 flex items-center gap-3">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-bold text-slate-900 dark:text-white truncate">
                    {l.student?.full_name || "Student"}
                  </p>
                  <p className="text-xs text-slate-500 dark:text-slate-400 tabular-nums">
                    {new Date(l.starts_at).toLocaleDateString("en-IE", {
                      weekday: "short", day: "numeric", month: "short",
                    })}
                    {" · "}{KIND_LABEL[l.kind] || l.kind}
                  </p>
                </div>
                <p className={`shrink-0 text-sm font-black tabular-nums ${
                  typeof l.price_cents === "number"
                    ? "text-slate-900 dark:text-white"
                    : "text-slate-400 font-normal italic text-xs"
                }`}>
                  {typeof l.price_cents === "number" ? euro(l.price_cents) : "no price"}
                </p>
              </div>
            ))}
          </div>
        </>
      )}
    </>
  );
}

function Figure({ label, t, compare }) {
  /* Only shown when both weeks have money in them. A percentage against zero
     is not a percentage, and "+100%" on a first lesson tells nobody anything. */
  const delta = compare && compare.cents > 0 && t.cents > 0
    ? Math.round(((t.cents - compare.cents) / compare.cents) * 100)
    : null;

  return (
    <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl p-4">
      <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">{label}</p>
      <p className="mt-1 text-2xl font-black text-slate-900 dark:text-white tabular-nums">
        {t.counted ? euro(t.cents) : "—"}
      </p>
      <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400 leading-snug">
        {t.lessons
          ? `${t.lessons} lesson${t.lessons === 1 ? "" : "s"}${t.unpriced ? `, ${t.unpriced} with no price` : ""}`
          : "Nothing taught"}
      </p>
      {delta !== null && (
        <p className={`mt-1 inline-flex items-center gap-1 text-xs font-bold ${
          delta >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-slate-500"
        }`}>
          <TrendingUp size={12} className={delta < 0 ? "rotate-180" : ""} />
          {delta >= 0 ? "+" : ""}{delta}%
        </p>
      )}
    </div>
  );
}
