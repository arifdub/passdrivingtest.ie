/*
  ===========================================================================
  AVAILABILITY

  Three questions, in the order an instructor would answer them: which hours
  do you work, which days are you off, and on what terms will you take a
  booking.

  WHAT THE PREVIEW IS AND IS NOT

  The bottom of this screen shows the instructor their own next few days as a
  learner would see them — the hours, minus what is already in the calendar,
  minus the buffer. It is a mirror, so a week that looks wrong here can be
  fixed before a stranger ever sees it.

  It is not a booking. Nothing a browser computes can decide who gets 11:00,
  and the screen says so rather than implying otherwise.
  ===========================================================================
*/

import React, { useState, useEffect, useCallback } from "react";
import {
  Clock, Plus, Trash2, Loader2, AlertCircle, Palmtree, Sparkles,
  CalendarRange, PauseCircle, PlayCircle,
} from "lucide-react";
import { useAuth } from "../appAuth";
import { PrimaryButton, SecondaryButton } from "../ui";
import { Sheet, Field, Label } from "./Students";
import { listLessons } from "./teachingStore";
import {
  loadAvailability, addHours, removeHours, replaceWeek,
  addTimeOff, removeTimeOff, saveRules,
  WEEKDAYS, WEEK_ORDER, TYPICAL_WEEK, DEFAULT_RULES,
  hoursLabel, weeklyHours, openSlots, dateKey,
} from "./availabilityStore";

const DAY = Object.fromEntries(WEEKDAYS.map(d => [d.id, d]));

export default function Availability() {
  const { user } = useAuth();

  const [hours, setHours] = useState([]);
  const [timeOff, setTimeOff] = useState([]);
  const [rules, setRules] = useState({ ...DEFAULT_RULES });
  const [lessons, setLessons] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [addingFor, setAddingFor] = useState(null);   // a weekday id
  const [addingOff, setAddingOff] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    const to = new Date(); to.setDate(to.getDate() + 14);
    const [a, l] = await Promise.all([
      loadAvailability(user?.id),
      listLessons(user?.id, { from: new Date(), to }),
    ]);
    setHours(a.hours); setTimeOff(a.timeOff); setRules(a.rules);
    setLessons(l.rows);
    setError(a.error);
    setLoading(false);
  }, [user?.id]);

  useEffect(() => { refresh(); }, [refresh]);

  if (loading) {
    return (
      <div className="flex items-center gap-2.5 text-slate-500 dark:text-slate-400 py-10 justify-center">
        <Loader2 size={18} className="animate-spin" />
        <span className="text-sm">Loading your week…</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-2xl border border-amber-200 dark:border-amber-900 bg-amber-50 dark:bg-amber-950/40 p-5">
        <div className="flex items-center gap-2.5">
          <AlertCircle size={18} className="text-amber-500 shrink-0" />
          <h2 className="font-bold text-slate-900 dark:text-white">Availability isn't set up yet</h2>
        </div>
        <p className="mt-2 text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
          The database is missing the tables this screen reads. Run{" "}
          <code className="font-mono text-xs">sql/11-availability.sql</code> and reload.
        </p>
        <p className="mt-2 text-xs text-slate-500 dark:text-slate-400 font-mono break-all">{error}</p>
      </div>
    );
  }

  const total = weeklyHours(hours);

  return (
    <>
      {/* ------------------------------------------------------------------ */}
      {/* Taking bookings at all                                             */}
      {/* ------------------------------------------------------------------ */}
      <div className={`rounded-2xl border p-4 flex items-center gap-3 ${
        rules.accepting
          ? "border-emerald-200 dark:border-emerald-900 bg-emerald-50 dark:bg-emerald-950/40"
          : "border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800"
      }`}>
        {rules.accepting
          ? <PlayCircle size={20} className="text-emerald-500 shrink-0" />
          : <PauseCircle size={20} className="text-slate-400 shrink-0" />}
        <div className="flex-1 min-w-0">
          <p className="font-bold text-sm text-slate-900 dark:text-white">
            {rules.accepting ? "Taking new bookings" : "Paused"}
          </p>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            {rules.accepting
              ? "Learners can request the open hours below."
              : "Your hours are kept. Nobody can request them until you turn this back on."}
          </p>
        </div>
        <button
          onClick={async () => {
            const next = { ...rules, accepting: !rules.accepting };
            setRules(next);
            const { ok, error: e } = await saveRules(user?.id, next);
            if (!ok) { setRules(rules); setError(e); }
          }}
          className="shrink-0 rounded-xl px-3 py-2 text-xs font-bold bg-slate-900 dark:bg-white text-white dark:text-slate-900"
        >
          {rules.accepting ? "Pause" : "Resume"}
        </button>
      </div>

      {/* ------------------------------------------------------------------ */}
      {/* The ordinary week                                                  */}
      {/* ------------------------------------------------------------------ */}
      <div className="mt-4 flex items-end justify-between gap-3">
        <div>
          <h2 className="font-black tracking-tight text-slate-900 dark:text-white">Your week</h2>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            {total ? `${total % 1 ? total.toFixed(1) : total} hours a week` : "Nothing set yet"}
          </p>
        </div>
        {!hours.length && (
          <button
            onClick={async () => {
              const { ok, error: e } = await replaceWeek(user?.id, TYPICAL_WEEK);
              if (ok) refresh(); else setError(e);
            }}
            className="shrink-0 inline-flex items-center gap-1.5 rounded-xl bg-slate-900 dark:bg-white text-white dark:text-slate-900 px-3 py-2 text-xs font-bold"
          >
            <Sparkles size={14} /> Mon–Fri, 9–5
          </button>
        )}
      </div>

      <div className="mt-3 space-y-2">
        {WEEK_ORDER.map(id => {
          const blocks = hours.filter(h => h.weekday === id);
          return (
            <div
              key={id}
              className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl p-3.5 flex items-start gap-3"
            >
              <p className="w-11 shrink-0 pt-0.5 text-xs font-bold uppercase tracking-widest text-slate-400">
                {DAY[id].short}
              </p>

              <div className="flex-1 min-w-0">
                {blocks.length ? (
                  <div className="flex flex-wrap gap-1.5">
                    {blocks.map(b => (
                      <span
                        key={b.id}
                        className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-50 dark:bg-emerald-950/50 text-emerald-700 dark:text-emerald-300 px-2 py-1 text-xs font-bold tabular-nums"
                      >
                        {hoursLabel(b)}
                        <button
                          onClick={async () => {
                            const { ok, error: e } = await removeHours(b.id);
                            if (ok) refresh(); else setError(e);
                          }}
                          aria-label={`Remove ${DAY[id].long} ${hoursLabel(b)}`}
                          className="text-emerald-600/60 dark:text-emerald-400/60 hover:text-red-500"
                        >
                          <Trash2 size={12} />
                        </button>
                      </span>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs text-slate-400 pt-1">Not working</p>
                )}
              </div>

              <button
                onClick={() => setAddingFor(id)}
                aria-label={`Add hours on ${DAY[id].long}`}
                className="shrink-0 rounded-lg border border-slate-200 dark:border-slate-600 text-slate-500 dark:text-slate-300 p-1.5"
              >
                <Plus size={14} />
              </button>
            </div>
          );
        })}
      </div>

      {/* ------------------------------------------------------------------ */}
      {/* Time off                                                           */}
      {/* ------------------------------------------------------------------ */}
      <div className="mt-6 flex items-end justify-between gap-3">
        <div>
          <h2 className="font-black tracking-tight text-slate-900 dark:text-white">Time off</h2>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Days nothing can be booked, whatever your week says.
          </p>
        </div>
        <button
          onClick={() => setAddingOff(true)}
          className="shrink-0 inline-flex items-center gap-1.5 rounded-xl bg-slate-900 dark:bg-white text-white dark:text-slate-900 px-3 py-2 text-xs font-bold"
        >
          <Plus size={14} /> Add
        </button>
      </div>

      <div className="mt-3 space-y-2">
        {timeOff.length ? timeOff.map(t => (
          <div
            key={t.id}
            className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl p-3.5 flex items-center gap-3"
          >
            <Palmtree size={16} className="text-amber-500 shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-bold text-slate-900 dark:text-white tabular-nums">
                {rangeLabel(t.starts_on, t.ends_on)}
              </p>
              {t.reason && (
                <p className="text-xs text-slate-500 dark:text-slate-400 truncate">{t.reason}</p>
              )}
            </div>
            <button
              onClick={async () => {
                const { ok, error: e } = await removeTimeOff(t.id);
                if (ok) refresh(); else setError(e);
              }}
              aria-label="Remove time off"
              className="shrink-0 text-slate-400 hover:text-red-500 p-1"
            >
              <Trash2 size={15} />
            </button>
          </div>
        )) : (
          <p className="text-sm text-slate-500 dark:text-slate-400 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl p-4">
            None booked. Add a holiday here and it disappears from your open
            hours without you having to edit the week.
          </p>
        )}
      </div>

      {/* ------------------------------------------------------------------ */}
      {/* Terms                                                              */}
      {/* ------------------------------------------------------------------ */}
      <h2 className="mt-6 font-black tracking-tight text-slate-900 dark:text-white">
        Booking terms
      </h2>
      <p className="text-xs text-slate-500 dark:text-slate-400">
        The rules a booking has to satisfy before it can reach you.
      </p>

      <Rules
        rules={rules}
        onSave={async (next) => {
          setRules(next);
          const { ok, error: e } = await saveRules(user?.id, next);
          if (!ok) setError(e);
          return ok;
        }}
      />

      {/* ------------------------------------------------------------------ */}
      {/* The mirror                                                         */}
      {/* ------------------------------------------------------------------ */}
      <Preview hours={hours} timeOff={timeOff} rules={rules} lessons={lessons} />

      {addingFor !== null && (
        <AddHoursSheet
          weekday={addingFor}
          onClose={() => setAddingFor(null)}
          onSave={async (block) => {
            const { ok, error: e } = await addHours(user?.id, { ...block, weekday: addingFor });
            if (ok) { setAddingFor(null); refresh(); }
            return { ok, error: e };
          }}
        />
      )}

      {addingOff && (
        <AddTimeOffSheet
          onClose={() => setAddingOff(false)}
          onSave={async (fields) => {
            const { ok, error: e } = await addTimeOff(user?.id, fields);
            if (ok) { setAddingOff(false); refresh(); }
            return { ok, error: e };
          }}
        />
      )}
    </>
  );
}

/* ------------------------------------------------------------------------- */

function rangeLabel(from, to) {
  const f = (k) => {
    const [y, m, d] = k.split("-").map(Number);
    return new Date(y, m - 1, d).toLocaleDateString("en-IE", {
      weekday: "short", day: "numeric", month: "short",
    });
  };
  return from === to ? f(from) : `${f(from)} – ${f(to)}`;
}

/* Saved on blur rather than behind a Save button: there are four numbers and
   a round trip to a button is more ceremony than the change deserves. */
export function Rules({ rules, onSave }) {
  const [draft, setDraft] = useState(rules);
  useEffect(() => { setDraft(rules); }, [rules]);

  const commit = (patch) => {
    const next = { ...draft, ...patch };
    setDraft(next);
    onSave(next);
  };

  return (
    <div className="mt-3 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl divide-y divide-slate-100 dark:divide-slate-700">
      <Choice
        label="Lesson length"
        value={draft.lesson_minutes}
        onChange={v => commit({ lesson_minutes: v })}
        options={[{ v: 45, l: "45 min" }, { v: 60, l: "1 hour" }, { v: 90, l: "90 min" }, { v: 120, l: "2 hours" }]}
      />
      <Choice
        label="Notice needed"
        hint="How soon before a lesson you'll still take a booking."
        value={draft.min_notice_hours}
        onChange={v => commit({ min_notice_hours: v })}
        options={[{ v: 2, l: "2 hours" }, { v: 12, l: "12 hours" }, { v: 24, l: "A day" }, { v: 48, l: "2 days" }]}
      />
      <Choice
        label="Booked up to"
        value={draft.max_days_ahead}
        onChange={v => commit({ max_days_ahead: v })}
        options={[{ v: 14, l: "2 weeks" }, { v: 30, l: "A month" }, { v: 60, l: "2 months" }, { v: 90, l: "3 months" }]}
      />
      <Choice
        label="Travel between lessons"
        hint="Kept clear on both sides of every booking."
        value={draft.travel_buffer_minutes}
        onChange={v => commit({ travel_buffer_minutes: v })}
        options={[{ v: 0, l: "None" }, { v: 15, l: "15 min" }, { v: 30, l: "30 min" }, { v: 45, l: "45 min" }]}
      />
    </div>
  );
}

function Choice({ label, hint, value, onChange, options }) {
  return (
    <div className="p-4">
      <Label>{label}</Label>
      {hint && <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">{hint}</p>}
      <div className="mt-2 flex flex-wrap gap-1.5">
        {options.map(o => (
          <button
            key={o.v}
            onClick={() => onChange(o.v)}
            className={`rounded-lg px-2.5 py-1.5 text-xs font-bold transition ${
              Number(value) === o.v
                ? "bg-emerald-500 text-slate-900"
                : "bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300"
            }`}
          >
            {o.l}
          </button>
        ))}
      </div>
    </div>
  );
}

/* The next seven days as a learner would see them.

   Exported because it is the one part of this screen with a real calculation
   behind it, and a test that renders the whole screen only ever sees the
   loading state — effects do not run in renderToString. */
export function Preview({ hours, timeOff, rules, lessons }) {
  const now = new Date();
  const days = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(now); d.setDate(d.getDate() + i); d.setHours(0, 0, 0, 0);
    days.push({ date: d, slots: openSlots({ date: d, hours, lessons, timeOff, rules, now }) });
  }
  const anything = days.some(d => d.slots.length);

  return (
    <div className="mt-6 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl p-5">
      <div className="flex items-center gap-2.5">
        <CalendarRange size={18} className="text-blue-500 shrink-0" />
        <h2 className="font-bold text-slate-900 dark:text-white">Your next seven days</h2>
      </div>
      <p className="mt-1.5 text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
        Your hours, less what's already in your calendar and the travel time
        around it. This is what a learner will be offered.
      </p>

      {anything ? (
        <div className="mt-4 space-y-3">
          {days.map(({ date, slots }) => (
            <div key={dateKey(date)} className="flex items-start gap-3">
              <p className="w-16 shrink-0 pt-1 text-xs font-bold uppercase tracking-widest text-slate-400">
                {date.toLocaleDateString("en-IE", { weekday: "short", day: "numeric" })}
              </p>
              {slots.length ? (
                <div className="flex flex-wrap gap-1">
                  {slots.map(s => (
                    <span
                      key={s.time}
                      className="rounded-md bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 px-1.5 py-0.5 text-[11px] font-bold tabular-nums"
                    >
                      {s.time}
                    </span>
                  ))}
                </div>
              ) : (
                <p className="pt-1 text-xs text-slate-400">—</p>
              )}
            </div>
          ))}
        </div>
      ) : (
        <p className="mt-4 text-sm text-slate-500 dark:text-slate-400">
          Nothing open in the next week. Add some hours above, or check whether
          your notice period rules out the days you meant.
        </p>
      )}

      <p className="mt-4 text-xs text-slate-500 dark:text-slate-400 leading-relaxed border-t border-slate-100 dark:border-slate-700 pt-3">
        Nothing here is bookable yet. Taking a request and holding a slot so
        two learners can't claim the same hour has to happen on the server,
        and that's the next piece being built.
      </p>
    </div>
  );
}

/* ------------------------------------------------------------------------- */

function AddHoursSheet({ weekday, onClose, onSave }) {
  const [from, setFrom] = useState("09:00");
  const [to, setTo] = useState("17:00");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  return (
    <Sheet title={`Hours on ${WEEKDAYS.find(d => d.id === weekday).long}`} onClose={onClose}>
      <div className="grid grid-cols-2 gap-3">
        <Field label="From" type="time" value={from} onChange={setFrom} />
        <Field label="To" type="time" value={to} onChange={setTo} />
      </div>

      <p className="mt-3 text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
        For a lunch break, add two blocks — 09:00 to 13:00 and 14:00 to 17:00.
      </p>

      {error && (
        <p className="mt-3 text-sm text-red-500 flex items-start gap-1.5">
          <AlertCircle size={15} className="shrink-0 mt-0.5" /> {error}
        </p>
      )}

      <div className="mt-5">
        <PrimaryButton
          disabled={busy}
          onClick={async () => {
            setBusy(true); setError(null);
            const r = await onSave({ starts_at: from, ends_at: to });
            if (!r.ok) setError(r.error);
            setBusy(false);
          }}
        >
          {busy ? "Saving…" : "Add these hours"}
        </PrimaryButton>
      </div>
    </Sheet>
  );
}

function AddTimeOffSheet({ onClose, onSave }) {
  const today = dateKey(new Date());
  const [from, setFrom] = useState(today);
  const [to, setTo] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  return (
    <Sheet title="Time off" onClose={onClose}>
      <div className="grid grid-cols-2 gap-3">
        <Field label="First day" type="date" value={from} onChange={setFrom} />
        <Field
          label="Last day"
          type="date"
          value={to}
          onChange={setTo}
          min={from}
          hint="Leave blank for one day"
        />
      </div>

      <div className="mt-3">
        <Field
          label="Reason"
          value={reason}
          onChange={setReason}
          placeholder="Optional — only you see this"
        />
      </div>

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
            const r = await onSave({ starts_on: from, ends_on: to || from, reason });
            if (!r.ok) setError(r.error);
            setBusy(false);
          }}
        >
          {busy ? "Saving…" : "Book the time off"}
        </PrimaryButton>
        <SecondaryButton onClick={onClose}>Cancel</SecondaryButton>
      </div>
    </Sheet>
  );
}
