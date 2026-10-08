/*
  ===========================================================================
  BOOKING A SLOT — the learner's side

  Pick a day, pick a time, say where you'd like to be picked up, send.

  THE SLOTS COME FROM THE DATABASE, NOT FROM HERE

  There is a slot calculation in availabilityStore.js, and this screen does
  not use it. That one exists so an instructor can check their own week; this
  one asks open_slots() (sql/12), which reads the same hours against the same
  lessons and the same live bookings at the moment of asking.

  Even that is only a list of candidates. Between loading it and tapping one,
  somebody else may have taken the hour — so request_booking checks the lot
  again inside its transaction, and an exclusion constraint refuses an
  overlap even if it didn't. When that happens this screen says "someone just
  took that time" and reloads, which is the honest outcome rather than a
  failure to hide.
  ===========================================================================
*/

import React, { useState, useEffect, useCallback } from "react";
import {
  CalendarCheck, Loader2, AlertCircle, Check, X, MapPin,
} from "lucide-react";
import { PrimaryButton, SecondaryButton } from "./ui";
import {
  openSlots, requestBooking, whyNoSlots, slotsByDay, slotTime, slotDay,
} from "./bookingStore";
import { LESSON_LABELS, euro } from "./marketplace";

export default function BookSheet({ instructor, onClose, onBooked }) {
  const [days, setDays] = useState([]);
  const [loading, setLoading] = useState(true);
  /* Two different errors, deliberately kept apart.

     `loadError` is the slot list failing to arrive. `requestError` is the
     answer to something the person just did — "someone just took that time",
     "that is outside their working hours". They were one variable, and
     refusing a booking then reloading the slots overwrote the refusal with
     null before anyone could read it. The request appeared to do nothing at
     all, which is the worst way to tell somebody no. */
  const [loadError, setLoadError] = useState(null);
  const [requestError, setRequestError] = useState(null);
  const [why, setWhy] = useState(null);
  const [picked, setPicked] = useState(null);
  const [kind, setKind] = useState((instructor.lesson_types || [])[0] || "lesson");
  const [pickup, setPickup] = useState("");
  const [note, setNote] = useState("");
  const [sending, setSending] = useState(false);
  const [done, setDone] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    const { rows, error: e } = await openSlots(instructor.user_id, { days: 14 });
    setDays(slotsByDay(rows));
    setLoadError(e);
    /* Only asked when there is nothing to show. It costs a round trip and
       answers a question nobody has when the list is full. */
    setWhy(rows.length ? null : await whyNoSlots(instructor.user_id));
    setLoading(false);
  }, [instructor.user_id]);

  useEffect(() => { refresh(); }, [refresh]);

  const rate = kind === "edt"
    ? (instructor.edt_rate_cents ?? instructor.hourly_rate_cents)
    : instructor.hourly_rate_cents;

  return (
    <div className="fixed inset-0 z-40 bg-slate-900/70 backdrop-blur-sm flex items-end" onClick={onClose}>
      <div
        className="w-full max-h-[92vh] overflow-y-auto bg-white dark:bg-slate-800 rounded-t-3xl p-6"
        style={{ paddingBottom: "max(1.5rem, calc(env(safe-area-inset-bottom) + 1rem))" }}
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 mb-1">
          <h2 className="text-lg font-black tracking-tight text-slate-900 dark:text-white">
            {done ? "Request sent" : `Book with ${instructor.full_name || "this instructor"}`}
          </h2>
          <button onClick={onClose} aria-label="Close" className="shrink-0 text-slate-400 p-1">
            <X size={20} />
          </button>
        </div>

        {done ? (
          <>
            <p className="mt-3 text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
              The hour is held for you while they decide. It's at the top of
              this screen under <strong>Your lessons</strong>, and it is not
              confirmed until they accept — so don't rearrange your day around
              it yet. Nothing has been charged: you pay the instructor
              directly on the day.
            </p>
            <div className="mt-5">
              <PrimaryButton onClick={onBooked}>Done</PrimaryButton>
            </div>
          </>
        ) : (
          <>
            <p className="text-sm text-slate-500 dark:text-slate-400">
              Their open hours for the next two weeks.
            </p>

            {/* The answer to the last attempt, kept at the top where the eye
                already is, and not cleared by reloading the list. */}
            {requestError && (
              <div className="mt-3 rounded-xl border border-amber-200 dark:border-amber-900 bg-amber-50 dark:bg-amber-950/40 p-3.5 flex items-start gap-2">
                <AlertCircle size={15} className="text-amber-500 shrink-0 mt-0.5" />
                <p className="text-sm text-slate-700 dark:text-slate-200 leading-relaxed">
                  {requestError}
                </p>
              </div>
            )}

            {/* Lesson type ------------------------------------------------ */}
            {(instructor.lesson_types || []).length > 1 && (
              <div className="mt-4">
                <p className="text-xs font-bold uppercase tracking-widest text-slate-500 dark:text-slate-400">
                  Lesson
                </p>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {(instructor.lesson_types || []).map(t => (
                    <button
                      key={t}
                      onClick={() => setKind(t)}
                      className={`rounded-lg px-2.5 py-1.5 text-xs font-bold transition ${
                        kind === t
                          ? "bg-emerald-500 text-slate-900"
                          : "bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300"
                      }`}
                    >
                      {LESSON_LABELS[t] || t}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Slots ------------------------------------------------------ */}
            <div className="mt-4">
              {loading ? (
                <div className="flex items-center gap-2.5 text-sm text-slate-500 dark:text-slate-400 py-8 justify-center">
                  <Loader2 size={16} className="animate-spin" /> Checking their calendar…
                </div>
              ) : loadError ? (
                <Note tone="amber">{loadError}</Note>
              ) : !days.length ? (
                /* An empty slot list has several causes and the learner can
                   act on none of them, so say what it means rather than just
                   that it is empty, and point at the thing they CAN do. */
                <Note tone="slate">
                  <strong className="text-slate-900 dark:text-white">{emptyReason(why)}</strong>{" "}
                  Close this and use <strong>Ask about lessons</strong> — that
                  reaches them whatever their calendar says.
                </Note>
              ) : (
                <div className="space-y-3">
                  {days.map(d => (
                    <div key={d.key} className="flex items-start gap-3">
                      <p className="w-20 shrink-0 pt-1.5 text-xs font-bold uppercase tracking-widest text-slate-400">
                        {slotDay(d.date)}
                      </p>
                      <div className="flex flex-wrap gap-1.5">
                        {d.slots.map(at => {
                          const on = picked && picked.getTime() === at.getTime();
                          return (
                            <button
                              key={at.toISOString()}
                              onClick={() => setPicked(at)}
                              className={`rounded-lg px-2.5 py-1.5 text-xs font-bold tabular-nums transition ${
                                on
                                  ? "bg-emerald-500 text-slate-900"
                                  : "bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300"
                              }`}
                            >
                              {slotTime(at)}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* The rest, once a time is chosen ---------------------------- */}
            {picked && (
              <>
                <div className="mt-5 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 p-3.5 flex items-center gap-2.5">
                  <CalendarCheck size={18} className="text-emerald-600 dark:text-emerald-400 shrink-0" />
                  <p className="text-sm font-bold text-slate-900 dark:text-white">
                    {slotDay(picked)} at {slotTime(picked)}
                    {rate ? <span className="font-normal text-slate-600 dark:text-slate-300"> · {euro(rate)}</span> : null}
                  </p>
                </div>

                <div className="mt-4 space-y-3">
                  <Input
                    label="Pick-up address"
                    value={pickup}
                    onChange={setPickup}
                    placeholder="Where should they collect you?"
                  />
                  <Input
                    label="Anything they should know"
                    value={note}
                    onChange={setNote}
                    placeholder="Optional"
                  />
                </div>

                <p className="mt-3 text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
                  Your name, email and this address go to the instructor so they
                  can collect you.
                </p>
                {/* Said before they commit, not discovered afterwards. No
                    card is taken anywhere in this product. */}
                <p className="mt-2 text-xs text-slate-600 dark:text-slate-300 leading-relaxed rounded-xl bg-slate-50 dark:bg-slate-900/50 p-3">
                  <strong className="text-slate-900 dark:text-white">You pay the instructor directly.</strong>{" "}
                  No card is taken here and nothing is charged by this site.
                  Settle up with them in the car, however they normally take
                  payment{rate ? ` — the lesson is ${euro(rate)}` : ""}.
                </p>

                <div className="mt-5 space-y-2">
                  <PrimaryButton
                    disabled={sending}
                    onClick={async () => {
                      setSending(true); setRequestError(null);
                      const r = await requestBooking({
                        instructorId: instructor.user_id,
                        at: picked, kind, pickup, note,
                      });
                      setSending(false);
                      if (r.ok) { setDone(true); return; }

                      /* Set AFTER the reload is kicked off, and in its own
                         variable, so refreshing the slots cannot erase the
                         reason. Whatever went wrong, the list is now suspect
                         — most of all when somebody else took the hour. */
                      setPicked(null);
                      await refresh();
                      setRequestError(r.error);
                    }}
                  >
                    {sending ? "Sending…" : "Request this lesson"}
                  </PrimaryButton>
                  <SecondaryButton onClick={() => setPicked(null)}>
                    Pick another time
                  </SecondaryButton>
                </div>
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}

/* One sentence per cause, because a learner reads "nothing available" and
   concludes the site is broken. Only the last of these is about the
   instructor being busy; the rest are about them not having finished setting
   up, which is worth saying differently. */
export function emptyReason(why) {
  if (!why) return "No open hours in the next two weeks.";
  if (!why.listed) return "This instructor isn't taking bookings here at the moment.";
  if (!why.accepting) return "They've paused new bookings for now.";
  if (!why.hasHours) return "They haven't set their working hours yet.";
  return "They're fully booked for the next two weeks.";
}

function Note({ tone, children }) {
  const cls = tone === "amber"
    ? "border-amber-200 dark:border-amber-900 bg-amber-50 dark:bg-amber-950/40"
    : "border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/40";
  return (
    <div className={`rounded-xl border p-4 text-sm text-slate-600 dark:text-slate-300 leading-relaxed flex items-start gap-2 ${cls}`}>
      {tone === "amber" && <AlertCircle size={15} className="text-amber-500 shrink-0 mt-0.5" />}
      <span>{children}</span>
    </div>
  );
}

function Input({ label, value, onChange, ...rest }) {
  return (
    <div>
      <label className="block text-xs font-bold uppercase tracking-widest text-slate-500 dark:text-slate-400">
        {label}
      </label>
      <input
        value={value}
        onChange={e => onChange(e.target.value)}
        className="mt-1.5 w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2.5 text-sm text-slate-900 dark:text-white"
        {...rest}
      />
    </div>
  );
}
