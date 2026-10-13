/*
  A LEARNER'S LESSON REQUESTS

  For when the directory has nobody near them, or nobody with a time that
  suits: they say where, what kind of lesson, their level, whose car and
  when, and verified instructors can see it and message them (sql/32).

  Their posts are listed with how many instructors have written, and each
  conversation opens in Messages.
*/

import React, { useState, useEffect, useCallback } from "react";
import {
  Megaphone, MapPin, Clock, Gauge, Car, MessageSquare, X, Loader2, AlertCircle,
  ChevronRight, CheckCircle2, ChevronDown,
} from "lucide-react";
import { useAuth } from "../appAuth";
import { PrimaryButton, SecondaryButton } from "../ui";
import CarChoice from "../CarChoice";
import { COUNTIES } from "../instructor/instructorStore";
import { LESSON_LABELS } from "../marketplace";
import { levelLabel, carLabel } from "../bookingStore";
import {
  myRequests, postRequest, closeRequest, myThreads, isLive, validateRequest, ago,
} from "../lessonRequests";

export const REQUEST_KINDS = ["lesson", "edt", "pretest", "mock", "refresher", "test-day"];
export const WHEN_CHOICES = ["Weekday mornings", "Weekday afternoons", "Weekday evenings", "Weekends"];

export default function LessonRequests({ go }) {
  const { user, isGuest, exitGuest } = useAuth();
  const [rows, setRows] = useState([]);
  const [threads, setThreads] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [posting, setPosting] = useState(false);
  const [busy, setBusy] = useState(null);

  const refresh = useCallback(async () => {
    if (!user?.id) { setLoading(false); return; }
    const [{ rows: r, error: e }, { rows: t }] = await Promise.all([myRequests(user.id), myThreads()]);
    setRows(r); setThreads(t); setError(e); setLoading(false);
  }, [user?.id]);

  useEffect(() => { refresh(); }, [refresh]);

  if (isGuest) {
    return (
      <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl p-5">
        <Megaphone size={22} className="text-emerald-500" />
        <h2 className="mt-2 font-black text-slate-900 dark:text-white">Tell instructors what you need</h2>
        <p className="mt-1 text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
          Post where you are, your level and when suits you, and instructors message you.
          You need a free account so they can reach you.
        </p>
        <div className="mt-4"><PrimaryButton onClick={exitGuest}>Create a free account</PrimaryButton></div>
      </div>
    );
  }

  const live = rows.filter(r => isLive(r));
  const old = rows.filter(r => !isLive(r));

  return (
    <div>
      <div className="rounded-2xl bg-gradient-to-br from-emerald-500 to-emerald-600 p-5 text-slate-900">
        <Megaphone size={22} />
        <h2 className="mt-2 text-lg font-black tracking-tight">Can't find a time that suits?</h2>
        <p className="mt-1 text-sm leading-relaxed text-slate-900/80">
          Post what you need. Verified instructors in your county see it and message you here.
          Only your first name is shown — never your email or phone.
        </p>
        <button onClick={() => setPosting(true)} disabled={live.length >= 3}
          className="mt-4 w-full rounded-xl bg-slate-900 text-white font-bold py-3 text-sm disabled:opacity-50">
          {live.length >= 3 ? "You have 3 requests up — close one first" : "Post a lesson request"}
        </button>
      </div>

      {error && (
        <p className="mt-4 flex items-start gap-2 rounded-xl bg-amber-50 dark:bg-amber-950/40 p-3 text-sm text-amber-800 dark:text-amber-200">
          <AlertCircle size={15} className="shrink-0 mt-0.5" /> {error}
        </p>
      )}

      {loading ? (
        <div className="py-8 flex justify-center"><Loader2 size={18} className="animate-spin text-slate-400" /></div>
      ) : (
        <>
          {live.length > 0 && <h3 className="mt-6 mb-2 text-xs font-bold uppercase tracking-widest text-slate-400">Your requests</h3>}
          <div className="space-y-3">
            {live.map(r => (
              <RequestCard key={r.id} request={r} threads={threads.filter(t => t.request_id === r.id)}
                go={go} busy={busy === r.id}
                onClose={async () => {
                  setBusy(r.id);
                  const res = await closeRequest(r.id);
                  setBusy(null);
                  if (!res.ok) setError(res.error); else refresh();
                }} />
            ))}
          </div>
          {old.length > 0 && (
            <>
              <h3 className="mt-6 mb-2 text-xs font-bold uppercase tracking-widest text-slate-400">Closed</h3>
              <div className="space-y-3 opacity-70">
                {old.slice(0, 5).map(r => (
                  <RequestCard key={r.id} request={r} threads={threads.filter(t => t.request_id === r.id)} go={go} closed />
                ))}
              </div>
            </>
          )}
        </>
      )}

      {posting && (
        <RequestSheet onClose={() => setPosting(false)}
          onPosted={() => { setPosting(false); refresh(); }} />
      )}
    </div>
  );
}

function RequestCard({ request: r, threads, go, onClose, busy, closed }) {
  const rows = [
    [MapPin, [r.area, r.county].filter(Boolean).join(", ")],
    [Gauge, levelLabel(r.level)],
    [Car, carLabel(r)],
    [Clock, r.availability],
  ].filter(([, v]) => v);

  return (
    <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-bold text-slate-900 dark:text-white">{LESSON_LABELS[r.lesson_kind] || "Lesson"} request</p>
          <p className="text-xs text-slate-500 dark:text-slate-400">Posted {ago(r.created_at)}</p>
        </div>
        <span className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-bold ${closed
          ? "bg-slate-100 dark:bg-slate-700 text-slate-500"
          : "bg-emerald-50 dark:bg-emerald-950/50 text-emerald-700 dark:text-emerald-300"}`}>
          {closed ? "Closed" : "Open"}
        </span>
      </div>
      <div className="mt-2 space-y-1">
        {rows.map(([Icon, v], i) => (
          <p key={i} className="text-sm text-slate-600 dark:text-slate-300 flex items-start gap-2">
            <Icon size={14} className="shrink-0 mt-0.5 text-slate-400" /> {v}
          </p>
        ))}
        {r.note && <p className="text-sm text-slate-600 dark:text-slate-300 italic">“{r.note}”</p>}
      </div>

      <div className="mt-3 border-t border-slate-100 dark:border-slate-700 pt-3">
        {threads.length === 0 ? (
          <p className="text-xs text-slate-500 dark:text-slate-400">
            {closed ? "No instructor wrote about this one." : "No replies yet. You'll get an email and a notification when an instructor writes."}
          </p>
        ) : (
          <div className="space-y-1.5">
            {threads.map(t => (
              <button key={t.instructor_id}
                onClick={() => go({ screen: "conversation", kind: "request", requestId: t.request_id,
                  instructorId: t.instructor_id, title: t.other_name, adi: t.adi_number, open: t.request_open })}
                className="w-full flex items-center gap-2.5 rounded-xl bg-slate-50 dark:bg-slate-900/40 px-3 py-2.5 text-left">
                <MessageSquare size={15} className="shrink-0 text-emerald-500" />
                <span className="flex-1 min-w-0">
                  <span className="block text-sm font-bold text-slate-900 dark:text-white truncate">{t.other_name}</span>
                  <span className="block text-xs text-slate-500 dark:text-slate-400 truncate">{t.last_body}</span>
                </span>
                {t.unread > 0 && (
                  <span className="rounded-full bg-emerald-500 text-slate-900 text-[10px] font-black px-1.5 tabular-nums">{t.unread}</span>
                )}
                <ChevronRight size={15} className="shrink-0 text-slate-300" />
              </button>
            ))}
          </div>
        )}
        {!closed && (
          <button onClick={onClose} disabled={busy}
            className="mt-3 text-xs font-bold text-slate-500 dark:text-slate-400 inline-flex items-center gap-1">
            {busy ? <Loader2 size={12} className="animate-spin" /> : <X size={12} />} Close this request
          </button>
        )}
      </div>
    </div>
  );
}

/* ---- posting ------------------------------------------------------------- */

export function RequestSheet({ onClose, onPosted }) {
  const [county, setCounty] = useState("");
  const [area, setArea] = useState("");
  const [kind, setKind] = useState("lesson");
  const [pick, setPick] = useState({ level: null, car: null, gearbox: null });
  const [when, setWhen] = useState([]);
  const [whenText, setWhenText] = useState("");
  const [note, setNote] = useState("");
  const [errors, setErrors] = useState({});
  const [sending, setSending] = useState(false);
  const [error, setError] = useState(null);
  const [done, setDone] = useState(false);

  const availability = [...when, whenText.trim()].filter(Boolean).join(", ");

  async function send() {
    const errs = validateRequest({ county, ...pick });
    setErrors(errs); setError(null);
    if (Object.keys(errs).length) return;
    setSending(true);
    const r = await postRequest({ county, area, kind, ...pick, availability, note });
    setSending(false);
    if (!r.ok) return setError(r.error);
    setDone(true);
  }

  return (
    <div className="fixed inset-0 z-40 bg-slate-900/70 backdrop-blur-sm flex items-end" onClick={onClose}>
      <div className="w-full max-h-[92vh] overflow-y-auto bg-white dark:bg-slate-800 rounded-t-3xl p-6"
        style={{ paddingBottom: "max(1.5rem, calc(env(safe-area-inset-bottom) + 1rem))" }}
        onClick={e => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3">
          <h2 className="text-lg font-black tracking-tight text-slate-900 dark:text-white">
            {done ? "Request posted" : "Post a lesson request"}
          </h2>
          <button onClick={onClose} aria-label="Close" className="-mr-2 -mt-1 p-3 text-slate-400"><X size={20} /></button>
        </div>

        {done ? (
          <>
            <CheckCircle2 size={30} className="mt-2 text-emerald-500" />
            <p className="mt-2 text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
              Instructors covering {county} can see it now. When one writes, it shows in
              <strong> Messages</strong> and we email you. It stays up for 30 days, or until you close it.
            </p>
            <div className="mt-5"><PrimaryButton onClick={onPosted}>Done</PrimaryButton></div>
          </>
        ) : (
          <div className="mt-3 space-y-4">
            <div>
              <Label>County</Label>
              <div className="relative mt-2">
                <select value={county} onChange={e => setCounty(e.target.value)} aria-invalid={!!errors.county}
                  className={`w-full appearance-none rounded-xl border bg-white dark:bg-slate-900 pl-3 pr-9 py-3 text-sm font-semibold ${
                    errors.county ? "border-red-400" : "border-slate-200 dark:border-slate-700"} ${county ? "text-slate-900 dark:text-white" : "text-slate-400"}`}>
                  <option value="">Choose your county</option>
                  {COUNTIES.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
                <ChevronDown size={16} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-slate-400" />
              </div>
              {errors.county && <Err>{errors.county}</Err>}
            </div>

            <Field label="Town or area" value={area} onChange={setArea} placeholder="e.g. Lucan, Swords" maxLength={80} />

            <div>
              <Label>Lesson</Label>
              <div className="mt-2 flex flex-wrap gap-2">
                {REQUEST_KINDS.map(k => (
                  <Chip key={k} on={kind === k} onClick={() => setKind(k)}>{LESSON_LABELS[k]}</Chip>
                ))}
              </div>
            </div>

            <CarChoice instructor={null} value={pick} error={errors.level || errors.car}
              onChange={v => { setPick(v); setErrors(e => ({ ...e, level: null, car: null })); }} />

            <div>
              <Label>When suits you</Label>
              <div className="mt-2 flex flex-wrap gap-2">
                {WHEN_CHOICES.map(w => (
                  <Chip key={w} on={when.includes(w)}
                    onClick={() => setWhen(ws => ws.includes(w) ? ws.filter(x => x !== w) : [...ws, w])}>{w}</Chip>
                ))}
              </div>
              <input value={whenText} onChange={e => setWhenText(e.target.value)} maxLength={120}
                placeholder="Anything more specific? e.g. after 6pm, not Fridays"
                className="mt-2 w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2.5 text-sm text-slate-900 dark:text-white" />
            </div>

            <Field label="Anything else" value={note} onChange={setNote} maxLength={600}
              placeholder="Optional — test date, nerves, what you want to work on" />

            {error && <p className="flex items-start gap-2 text-sm text-red-600 dark:text-red-400"><AlertCircle size={15} className="shrink-0 mt-0.5" /> {error}</p>}

            <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
              Instructors see your first name and these details. Your email and phone are not shown —
              you decide whether to share them once someone writes.
            </p>
            <div className="space-y-2">
              <PrimaryButton disabled={sending} onClick={send}>{sending ? "Posting…" : "Post request"}</PrimaryButton>
              <SecondaryButton onClick={onClose}>Cancel</SecondaryButton>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function Label({ children }) {
  return <p className="text-xs font-bold uppercase tracking-widest text-slate-500 dark:text-slate-400">{children}</p>;
}
function Err({ children }) {
  return <p className="mt-1 text-xs font-semibold text-red-600 dark:text-red-400">{children}</p>;
}
function Chip({ on, onClick, children }) {
  return (
    <button type="button" onClick={onClick} aria-pressed={on}
      className={`rounded-xl px-3.5 py-2.5 text-sm font-bold transition ${
        on ? "bg-emerald-500 text-slate-900" : "bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300"}`}>
      {children}
    </button>
  );
}
function Field({ label, value, onChange, ...rest }) {
  return (
    <div>
      <Label>{label}</Label>
      <input value={value} onChange={e => onChange(e.target.value)} {...rest}
        className="mt-2 w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2.5 text-sm text-slate-900 dark:text-white" />
    </div>
  );
}
