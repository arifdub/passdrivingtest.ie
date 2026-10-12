/*
  ===========================================================================
  AN INSTRUCTOR'S OWN PAGE — passdrivingtest.ie/adi/<ADI number>

  The link an ADI sends to their own learners. It shows who they are and
  their open hours, and a learner books one with a name, an email and a
  phone number. No account: a learner who wants one can make one, and one
  who doesn't never has to.

  Someone already signed in as a learner books with their account instead,
  so the lesson shows in their app.

  The slots are the database's (open_slots), the same list every other
  booking screen offers, and the request goes through the same rules
  (place_booking, sql/29). This page decides nothing.
  ===========================================================================
*/

import React, { useState, useEffect, useCallback } from "react";
import { useParams } from "react-router-dom";
import {
  BadgeCheck, CalendarCheck, Loader2, AlertCircle, MapPin, Car, Mail, Phone,
  User as UserIcon, CheckCircle2,
} from "lucide-react";
import { useAuth } from "./appAuth";
import { PrimaryButton, SecondaryButton } from "./ui";
import {
  instructorPage, openSlots, whyNoSlots, slotsByDay, slotTime, slotDay,
  requestBooking, requestGuestBooking, validateGuest, carError,
} from "./bookingStore";
import CarChoice from "./CarChoice";
import { emptyReason } from "./BookSheet";
import { LESSON_LABELS, euro } from "./marketplace";

export default function InstructorPage() {
  const { adi } = useParams();
  const [state, setState] = useState({ loading: true, instructor: null, error: null });

  useEffect(() => {
    let live = true;
    instructorPage(adi).then(r => {
      if (live) setState({ loading: false, instructor: r.instructor, error: r.error });
    });
    return () => { live = false; };
  }, [adi]);

  useEffect(() => {
    const i = state.instructor;
    document.title = i
      ? `Book a lesson with ${i.full_name} — PassDrivingTest.ie`
      : "Book a driving lesson — PassDrivingTest.ie";
  }, [state.instructor]);

  return (
    <div className="min-h-screen bg-slate-100 dark:bg-slate-950">
      <div
        className="bg-slate-900 text-white"
        style={{ paddingTop: "max(1.25rem, env(safe-area-inset-top))" }}
      >
        <div className="max-w-xl mx-auto px-5 pb-6">
          <a href="/" className="text-sm font-extrabold tracking-tight">
            Pass<span className="text-blue-400">Driving</span>Test<span className="text-blue-400">.ie</span>
          </a>
          {state.instructor && <Header instructor={state.instructor} />}
        </div>
      </div>

      <div className="max-w-xl mx-auto px-5 py-5"
           style={{ paddingBottom: "max(2rem, env(safe-area-inset-bottom))" }}>
        {state.loading ? (
          <div className="flex items-center justify-center gap-2.5 py-16 text-sm text-slate-500">
            <Loader2 size={18} className="animate-spin" /> Finding the instructor…
          </div>
        ) : state.instructor ? (
          <Booking instructor={state.instructor} />
        ) : (
          <NotFound adi={adi} error={state.error} />
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------------- */

function Header({ instructor: i }) {
  const rate = i.hourly_rate_cents ? euro(i.hourly_rate_cents) : null;
  return (
    <div className="mt-5 flex items-start gap-4">
      {i.photo_url ? (
        <img src={i.photo_url} alt="" className="w-16 h-16 rounded-2xl object-cover shrink-0 bg-slate-700" />
      ) : (
        <div className="w-16 h-16 rounded-2xl bg-slate-700 flex items-center justify-center shrink-0 text-2xl font-black">
          {(i.full_name || "?").trim().charAt(0).toUpperCase()}
        </div>
      )}
      <div className="min-w-0">
        <h1 className="text-xl font-black tracking-tight leading-tight">{i.full_name}</h1>
        {i.business_name && <p className="text-sm text-slate-300">{i.business_name}</p>}
        <p className="mt-1.5 inline-flex items-center gap-1 rounded-lg bg-emerald-500/15 text-emerald-300 px-2 py-0.5 text-xs font-bold">
          <BadgeCheck size={13} /> Approved Driving Instructor · ADI {i.adi_number}
        </p>
        <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-slate-300">
          {(i.counties || []).length > 0 && (
            <span className="inline-flex items-center gap-1"><MapPin size={12} /> {i.counties.join(", ")}</span>
          )}
          {(i.transmissions || []).length > 0 && (
            <span className="inline-flex items-center gap-1 capitalize"><Car size={12} /> {i.transmissions.join(" & ")}</span>
          )}
          {rate && <span>{rate} / hour</span>}
        </div>
      </div>
    </div>
  );
}

function NotFound({ adi, error }) {
  return (
    <div className="bg-white dark:bg-slate-800 rounded-2xl p-6 text-center">
      <AlertCircle size={28} className="mx-auto text-amber-500" />
      <h1 className="mt-3 text-lg font-black text-slate-900 dark:text-white">
        No instructor found at this address
      </h1>
      <p className="mt-2 text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
        {error
          ? error
          : <>No approved instructor with ADI number <strong>{adi}</strong> is taking bookings here. Check the link you were sent.</>}
      </p>
      <a href="/student" className="mt-5 inline-block text-sm font-bold text-emerald-600 dark:text-emerald-400">
        Find an instructor near you
      </a>
    </div>
  );
}

/* ------------------------------------------------------------------------- */

export function Booking({ instructor }) {
  const { user, isSignedIn, profile } = useAuth();
  const ownPage = isSignedIn && user?.id === instructor.user_id;

  const [days, setDays] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [requestError, setRequestError] = useState(null);
  const [why, setWhy] = useState(null);
  const [dayKey, setDayKey] = useState(null);
  const [picked, setPicked] = useState(null);
  const [kind, setKind] = useState((instructor.lesson_types || [])[0] || "lesson");

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [pickup, setPickup] = useState("");
  const [note, setNote] = useState("");
  const [carPick, setCarPick] = useState({ car: null, gearbox: null });
  const [carErr, setCarErr] = useState(null);
  const [fieldErrors, setFieldErrors] = useState({});
  const [sending, setSending] = useState(false);
  const [done, setDone] = useState(null);

  const asAccount = isSignedIn && !ownPage;

  const refresh = useCallback(async () => {
    setLoading(true);
    const { rows, error } = await openSlots(instructor.user_id, { days: 14 });
    const grouped = slotsByDay(rows);
    setDays(grouped);
    setLoadError(error);
    setWhy(rows.length ? null : await whyNoSlots(instructor.user_id));
    setDayKey(prev => (prev && grouped.some(g => g.key === prev)) ? prev : grouped[0]?.key ?? null);
    setLoading(false);
  }, [instructor.user_id]);

  useEffect(() => { refresh(); }, [refresh]);

  const rate = kind === "edt"
    ? (instructor.edt_rate_cents ?? instructor.hourly_rate_cents)
    : instructor.hourly_rate_cents;

  async function send() {
    setRequestError(null);
    const ce = carError(carPick);
    setCarErr(ce);
    const errs = asAccount ? {} : validateGuest({ name, email, phone });
    setFieldErrors(errs);
    if (ce || Object.keys(errs).length) return;
    setSending(true);
    const r = asAccount
      ? await requestBooking({ instructorId: instructor.user_id, at: picked, kind, pickup, note, ...carPick })
      : await requestGuestBooking({
          instructorId: instructor.user_id, at: picked, name, email, phone, kind, pickup, note, ...carPick,
        });
    setSending(false);
    if (r.ok) {
      setDone({ at: picked, email: asAccount ? (user?.email || "") : email.trim() });
      return;
    }
    setPicked(null);
    await refresh();
    setRequestError(r.error);
  }

  if (done) {
    return (
      <div className="bg-white dark:bg-slate-800 rounded-2xl p-6">
        <CheckCircle2 size={30} className="text-emerald-500" />
        <h2 className="mt-3 text-lg font-black text-slate-900 dark:text-white">Request sent</h2>
        <p className="mt-2 text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
          <strong>{slotDay(done.at)} at {slotTime(done.at)}</strong> is held for you while{" "}
          {instructor.full_name} confirms. It isn't confirmed until they accept.
          {done.email && <> We've emailed <strong>{done.email}</strong>, and you'll get another email as soon as they answer.</>}
        </p>
        <p className="mt-3 text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
          Nothing has been charged. You pay your instructor directly.
        </p>
        <div className="mt-5 space-y-2">
          <PrimaryButton onClick={() => { setDone(null); setPicked(null); refresh(); }}>
            Book another lesson
          </PrimaryButton>
          {!isSignedIn && (
            <a href="/student/signup"
               className="block text-center text-sm font-semibold text-slate-500 dark:text-slate-400 py-2.5">
              Practising for your theory test? Create a free account
            </a>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {ownPage && (
        <p className="rounded-xl bg-blue-50 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-900 p-3.5 text-sm text-slate-700 dark:text-slate-200">
          This is your page, exactly as your learners see it. Share this address with them.
        </p>
      )}

      {instructor.bio && (
        <p className="bg-white dark:bg-slate-800 rounded-2xl p-4 text-sm text-slate-600 dark:text-slate-300 leading-relaxed whitespace-pre-line">
          {instructor.bio}
        </p>
      )}

      <div className="bg-white dark:bg-slate-800 rounded-2xl p-5">
        <h2 className="text-lg font-black tracking-tight text-slate-900 dark:text-white">Book a lesson</h2>
        <p className="text-sm text-slate-500 dark:text-slate-400">Their open times for the next two weeks.</p>

        {requestError && (
          <div className="mt-3 rounded-xl border border-amber-200 dark:border-amber-900 bg-amber-50 dark:bg-amber-950/40 p-3.5 flex items-start gap-2">
            <AlertCircle size={15} className="text-amber-500 shrink-0 mt-0.5" />
            <p className="text-sm text-slate-700 dark:text-slate-200 leading-relaxed">{requestError}</p>
          </div>
        )}

        {(instructor.lesson_types || []).length > 1 && (
          <div className="mt-4">
            <Label>Lesson</Label>
            <div className="mt-2 flex flex-wrap gap-2">
              {instructor.lesson_types.map(t => (
                <Chip key={t} on={kind === t} onClick={() => setKind(t)}>{LESSON_LABELS[t] || t}</Chip>
              ))}
            </div>
          </div>
        )}

        <div className="mt-4">
          {loading ? (
            <div className="flex items-center gap-2.5 text-sm text-slate-500 py-8 justify-center">
              <Loader2 size={16} className="animate-spin" /> Checking their calendar…
            </div>
          ) : loadError ? (
            <p className="text-sm text-amber-700 dark:text-amber-300">{loadError}</p>
          ) : !days.length ? (
            <p className="rounded-xl bg-slate-50 dark:bg-slate-900/40 p-4 text-sm text-slate-600 dark:text-slate-300">
              <strong className="text-slate-900 dark:text-white">{emptyReason(why)}</strong>{" "}
              Try again in a few days, or contact them directly.
            </p>
          ) : (
            <>
              <Label>Day</Label>
              <div className="mt-2 -mx-5 px-5 overflow-x-auto no-scrollbar">
                <div className="flex gap-2 w-max pb-1">
                  {days.map(d => {
                    const on = d.key === dayKey;
                    return (
                      <button key={d.key} onClick={() => { setDayKey(d.key); setPicked(null); }}
                        aria-pressed={on}
                        className={`shrink-0 rounded-2xl px-4 py-2.5 text-center transition ${
                          on ? "bg-emerald-500 text-slate-900"
                             : "bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300"}`}>
                        <span className="block text-sm font-black whitespace-nowrap">{slotDay(d.date)}</span>
                        <span className={`block text-[11px] font-bold tabular-nums ${
                          on ? "text-slate-900/70" : "text-slate-500 dark:text-slate-400"}`}>
                          {d.slots.length} free
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="mt-4"><Label>Time</Label></div>
              <div className="mt-2 grid grid-cols-3 sm:grid-cols-4 gap-2">
                {(days.find(d => d.key === dayKey)?.slots || []).map(at => {
                  const on = picked && picked.getTime() === at.getTime();
                  return (
                    <button key={at.toISOString()} onClick={() => setPicked(at)} aria-pressed={on}
                      className={`rounded-xl py-3 text-sm font-bold tabular-nums transition ${
                        on ? "bg-emerald-500 text-slate-900"
                           : "bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-200"}`}>
                      {slotTime(at)}
                    </button>
                  );
                })}
              </div>
            </>
          )}
        </div>
      </div>

      {picked && !ownPage && (
        <div className="bg-white dark:bg-slate-800 rounded-2xl p-5">
          <div className="rounded-xl bg-emerald-50 dark:bg-emerald-950/40 p-3.5 flex items-center gap-2.5">
            <CalendarCheck size={18} className="text-emerald-600 dark:text-emerald-400 shrink-0" />
            <p className="text-sm font-bold text-slate-900 dark:text-white">
              {slotDay(picked)} at {slotTime(picked)}
              {rate ? <span className="font-normal text-slate-600 dark:text-slate-300"> · {euro(rate)}</span> : null}
            </p>
          </div>

          <div className="mt-4">
            <CarChoice instructor={instructor} car={carPick.car} gearbox={carPick.gearbox}
              error={carErr} onChange={v => { setCarPick(v); setCarErr(null); }} />
          </div>

          <div className="mt-4 space-y-3">
            {asAccount ? (
              <p className="text-sm text-slate-600 dark:text-slate-300">
                Booking as <strong>{profile?.full_name || user?.email}</strong>. It will show in your app.
              </p>
            ) : (
              <>
                <Input icon={UserIcon} label="Your name" value={name} onChange={setName}
                  autoComplete="name" placeholder="First and last name" error={fieldErrors.name} />
                <Input icon={Mail} label="Email" type="email" value={email} onChange={setEmail}
                  autoComplete="email" placeholder="you@email.com" error={fieldErrors.email} />
                <Input icon={Phone} label="Phone" type="tel" value={phone} onChange={setPhone}
                  autoComplete="tel" inputMode="tel" placeholder="087 123 4567" error={fieldErrors.phone} />
              </>
            )}
            <Input icon={MapPin} label="Pick-up address" value={pickup} onChange={setPickup}
              placeholder="Where should they collect you?" />
            <Input label="Anything they should know" value={note} onChange={setNote} placeholder="Optional" />
          </div>

          <p className="mt-3 text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
            {asAccount
              ? "Your name, email and pick-up go to the instructor so they can collect you."
              : "Your name, email, phone and pick-up go to the instructor so they can contact and collect you. No account is needed."}
            {" "}You pay the instructor directly; nothing is charged here.
          </p>

          <div className="mt-5 space-y-2">
            <PrimaryButton disabled={sending} onClick={send}>
              {sending ? "Sending…" : "Request this lesson"}
            </PrimaryButton>
            <SecondaryButton onClick={() => setPicked(null)}>Pick another time</SecondaryButton>
          </div>

          {!isSignedIn && (
            <p className="mt-4 text-center text-xs text-slate-500 dark:text-slate-400">
              Have an account?{" "}
              <a href="/student/signin" className="font-bold text-emerald-600 dark:text-emerald-400">Sign in</a>
              {" "}first, then come back to this page.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function Label({ children }) {
  return (
    <p className="text-xs font-bold uppercase tracking-widest text-slate-500 dark:text-slate-400">{children}</p>
  );
}

function Chip({ on, onClick, children }) {
  return (
    <button onClick={onClick} aria-pressed={on}
      className={`rounded-xl px-4 py-2.5 text-sm font-bold transition ${
        on ? "bg-emerald-500 text-slate-900"
           : "bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300"}`}>
      {children}
    </button>
  );
}

function Input({ icon: Icon, label, value, onChange, error, ...rest }) {
  return (
    <div>
      <label className="block text-xs font-bold uppercase tracking-widest text-slate-500 dark:text-slate-400">
        {label}
      </label>
      <div className="relative mt-1.5">
        {Icon && <Icon size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />}
        <input
          value={value}
          onChange={e => onChange(e.target.value)}
          aria-invalid={!!error}
          className={`w-full rounded-xl border bg-white dark:bg-slate-900 ${Icon ? "pl-9" : "pl-3"} pr-3 py-2.5 text-sm text-slate-900 dark:text-white ${
            error ? "border-red-400" : "border-slate-200 dark:border-slate-700"}`}
          {...rest}
        />
      </div>
      {error && <p className="mt-1 text-xs font-semibold text-red-600 dark:text-red-400">{error}</p>}
    </div>
  );
}
