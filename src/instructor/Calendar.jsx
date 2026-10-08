/*
  ===========================================================================
  CALENDAR

  WHY THIS IS A LIST AND NOT A GRID

  A week grid is what a calendar looks like on a laptop. An instructor looks
  at this on a phone, between lessons, usually to answer one of two
  questions: what's next, and who is it. A grid at 390px gives seven columns
  three characters wide and answers neither.

  So it is an agenda: days in order, lessons under each, today first. The
  week either side is reachable, which covers the other real question —
  "have I anything Thursday?" — without pretending to be Outlook.

  MARKING A LESSON DONE IS THE POINT

  It is the only thing here that produces a number elsewhere: EDT progress is
  counted from completed lessons, and so is the taught count on a student.
  Cancelled and no-show are kept apart from each other because an instructor
  who is owed for a no-show needs to tell them apart later, and because
  deleting it loses the fact that it happened.
  ===========================================================================
*/

import React, { useState, useEffect, useCallback, useMemo } from "react";
import {
  CalendarDays, Plus, Loader2, AlertCircle, Check, X, Clock, MapPin,
  ChevronLeft, ChevronRight, Phone, Trash2,
} from "lucide-react";
import { useAuth } from "../appAuth";
import { EmptyState, PrimaryButton, SecondaryButton } from "../ui";
import { Sheet, Field, Label } from "./Students";
import {
  listStudents, listLessons, addLesson, updateLesson, deleteLesson,
  LESSON_KINDS, KIND_LABEL, toInstant, dayKey, dayLabel, timeLabel, endLabel, euro,
} from "./teachingStore";

/* Monday of the week containing `d`. Irish weeks start Monday; getDay() puts
   Sunday at 0, which is the off-by-one everyone writes once. */
function weekStart(d) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  x.setDate(x.getDate() - ((x.getDay() + 6) % 7));
  return x;
}

export default function Calendar({ bookFor, onBooked }) {
  const { user } = useAuth();

  const [offset, setOffset] = useState(0);          // weeks from this one
  const [rows, setRows] = useState([]);
  const [students, setStudents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [adding, setAdding] = useState(null);       // a student, or true

  const from = useMemo(() => {
    const s = weekStart(new Date());
    s.setDate(s.getDate() + offset * 7);
    return s;
  }, [offset]);

  const to = useMemo(() => {
    const e = new Date(from);
    e.setDate(e.getDate() + 7);
    return e;
  }, [from]);

  const refresh = useCallback(async () => {
    setLoading(true);
    const [{ rows: r, error: e }, { rows: s }] = await Promise.all([
      listLessons(user?.id, { from, to }),
      listStudents(user?.id),
    ]);
    setRows(r); setStudents(s); setError(e); setLoading(false);
  }, [user?.id, from, to]);

  useEffect(() => { refresh(); }, [refresh]);

  /* Opened with a student from the Students screen. */
  useEffect(() => { if (bookFor) setAdding(bookFor); }, [bookFor]);

  const byDay = useMemo(() => {
    const m = new Map();
    for (const l of rows) {
      const k = dayKey(l.starts_at);
      if (!m.has(k)) m.set(k, []);
      m.get(k).push(l);
    }
    return [...m.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [rows]);

  const weekLabel = offset === 0 ? "This week"
    : offset === 1 ? "Next week"
    : offset === -1 ? "Last week"
    : `${from.toLocaleDateString("en-IE", { day: "numeric", month: "short" })} – ${
        new Date(to - 1).toLocaleDateString("en-IE", { day: "numeric", month: "short" })}`;

  return (
    <>
      <div className="flex items-center gap-2">
        <button
          onClick={() => setOffset(o => o - 1)}
          aria-label="Previous week"
          className="shrink-0 inline-flex items-center justify-center w-9 h-9 rounded-full border border-slate-200 dark:border-slate-700 text-slate-500"
        >
          <ChevronLeft size={16} />
        </button>

        <div className="flex-1 text-center">
          <p className="text-sm font-black text-slate-900 dark:text-white">{weekLabel}</p>
          {offset !== 0 && (
            <button onClick={() => setOffset(0)} className="text-xs font-semibold text-emerald-600 dark:text-emerald-400">
              Back to this week
            </button>
          )}
        </div>

        <button
          onClick={() => setOffset(o => o + 1)}
          aria-label="Next week"
          className="shrink-0 inline-flex items-center justify-center w-9 h-9 rounded-full border border-slate-200 dark:border-slate-700 text-slate-500"
        >
          <ChevronRight size={16} />
        </button>

        <button
          onClick={() => setAdding(true)}
          className="shrink-0 inline-flex items-center gap-1.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-900 font-bold px-3.5 py-2 text-sm transition"
        >
          <Plus size={16} /> Lesson
        </button>
      </div>

      {error && (
        <div className="mt-4 flex items-start gap-2.5 bg-red-50 dark:bg-red-950/40 text-red-700 dark:text-red-300 rounded-2xl px-4 py-3 text-sm">
          <AlertCircle size={16} className="mt-0.5 shrink-0" />
          <div>
            <p className="font-semibold">Couldn't load your lessons.</p>
            <p className="mt-0.5 opacity-90">{error}</p>
            <p className="mt-1.5 opacity-75 text-xs">
              If this says the relation doesn't exist, sql/10-students-and-lessons.sql
              hasn't been run yet.
            </p>
          </div>
        </div>
      )}

      {loading && rows.length === 0 && (
        <div className="flex items-center justify-center gap-2.5 text-sm text-slate-500 py-10">
          <Loader2 size={16} className="animate-spin" /> Loading…
        </div>
      )}

      {!loading && byDay.length === 0 && !error && (
        <div className="mt-4 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl p-8">
          <EmptyState
            icon={CalendarDays}
            title="Nothing this week"
            message={
              students.length
                ? "Add a lesson and it shows up here."
                : "Add a student first, then their lessons."
            }
          />
        </div>
      )}

      <div className="mt-4 space-y-5">
        {byDay.map(([key, lessons]) => (
          <div key={key}>
            <h3 className="text-xs font-black uppercase tracking-widest text-slate-400 px-1">
              {dayLabel(key)}
            </h3>
            <div className="mt-2 space-y-2">
              {lessons.map(l => <LessonCard key={l.id} lesson={l} onChanged={refresh} />)}
            </div>
          </div>
        ))}
      </div>

      {adding && (
        <AddLesson
          instructorId={user?.id}
          students={students}
          preset={adding === true ? null : adding}
          onClose={() => { setAdding(null); onBooked?.(); }}
          onAdded={async () => { setAdding(null); onBooked?.(); await refresh(); }}
        />
      )}
    </>
  );
}

/* ------------------------------------------------------------------------- */

const TONE = {
  scheduled: "border-slate-200 dark:border-slate-700",
  completed: "border-emerald-200 dark:border-emerald-900 bg-emerald-50/50 dark:bg-emerald-950/20",
  cancelled: "border-slate-200 dark:border-slate-700 opacity-60",
  "no-show":  "border-red-200 dark:border-red-900 bg-red-50/40 dark:bg-red-950/20",
};

function LessonCard({ lesson, onChanged }) {
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  async function mark(status) {
    setBusy(true); setProblem(null);
    const r = await updateLesson(lesson.id, { status });
    setBusy(false);
    if (!r.ok) { setProblem(r.error); return; }
    await onChanged();
  }

  async function remove() {
    setBusy(true); setProblem(null);
    const r = await deleteLesson(lesson.id);
    setBusy(false);
    if (!r.ok) { setProblem(r.error); return; }
    await onChanged();
  }

  const price = euro(lesson.price_cents);

  return (
    <div className={`bg-white dark:bg-slate-800 border rounded-2xl p-4 ${TONE[lesson.status] || TONE.scheduled}`}>
      <div className="flex items-start gap-3">
        <div className="shrink-0 text-center">
          <p className="text-sm font-black tabular-nums text-slate-900 dark:text-white">
            {timeLabel(lesson.starts_at)}
          </p>
          <p className="text-[11px] tabular-nums text-slate-400">
            {endLabel(lesson.starts_at, lesson.duration_minutes)}
          </p>
        </div>

        <div className="min-w-0 flex-1">
          <p className="font-bold text-slate-900 dark:text-white truncate">
            {lesson.student?.full_name || "Student"}
          </p>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            {KIND_LABEL[lesson.kind] || lesson.kind}
            {price ? ` · ${price}` : ""}
            {lesson.paid ? " · paid" : ""}
            {lesson.status !== "scheduled" ? ` · ${lesson.status}` : ""}
          </p>
          {lesson.pickup && (
            <p className="mt-1 flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400">
              <MapPin size={12} className="shrink-0" /> {lesson.pickup}
            </p>
          )}
          {lesson.notes && (
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400 leading-relaxed">{lesson.notes}</p>
          )}
        </div>

        {lesson.student?.phone && (
          <a
            href={`tel:${lesson.student.phone.replace(/\s+/g, "")}`}
            aria-label={`Call ${lesson.student.full_name}`}
            className="shrink-0 inline-flex items-center justify-center w-9 h-9 rounded-full border border-slate-200 dark:border-slate-700 text-emerald-600 dark:text-emerald-400"
          >
            <Phone size={15} />
          </a>
        )}
      </div>

      {problem && (
        <div className="mt-3 flex items-start gap-2 text-sm bg-red-50 dark:bg-red-950/40 text-red-700 dark:text-red-300 rounded-xl px-3 py-2">
          <AlertCircle size={15} className="mt-0.5 shrink-0" /><span>{problem}</span>
        </div>
      )}

      {lesson.status === "scheduled" && (
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            onClick={() => mark("completed")}
            disabled={busy}
            className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 disabled:opacity-60 text-slate-900 font-bold px-3 py-2 text-xs transition"
          >
            {busy ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />} Taught
          </button>
          <button
            onClick={() => mark("no-show")}
            disabled={busy}
            className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 font-bold px-3 py-2 text-xs"
          >
            No-show
          </button>
          <button
            onClick={() => mark("cancelled")}
            disabled={busy}
            className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 font-bold px-3 py-2 text-xs"
          >
            Cancelled
          </button>
        </div>
      )}

      {lesson.status !== "scheduled" && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button
            onClick={() => mark("scheduled")}
            disabled={busy}
            className="text-xs font-semibold text-slate-500 dark:text-slate-400"
          >
            Put it back
          </button>
          {/* Only offered once a lesson is off the schedule. Deleting a taught
              lesson would silently change an EDT count. */}
          {confirmDelete ? (
            <button
              onClick={remove}
              disabled={busy}
              className="ml-auto inline-flex items-center gap-1.5 text-xs font-bold text-red-600 dark:text-red-400"
            >
              <Trash2 size={13} /> Really delete
            </button>
          ) : (
            <button
              onClick={() => setConfirmDelete(true)}
              className="ml-auto inline-flex items-center gap-1.5 text-xs font-semibold text-slate-400"
            >
              <Trash2 size={13} /> Delete
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------------- */

function AddLesson({ instructorId, students, preset, onClose, onAdded }) {
  const today = new Date();
  const p = n => String(n).padStart(2, "0");

  const [f, setF] = useState({
    student_id: preset?.id || (students[0]?.id || ""),
    date: `${today.getFullYear()}-${p(today.getMonth() + 1)}-${p(today.getDate())}`,
    time: "10:00",
    duration_minutes: 60,
    kind: "lesson",
    price: "",
    pickup: "",
    notes: "",
  });
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState(null);

  const set = patch => setF(prev => ({ ...prev, ...patch }));

  async function save() {
    const starts_at = toInstant(f.date, f.time);
    if (!starts_at) { setProblem("Check the date and time."); return; }

    setBusy(true); setProblem(null);
    const r = await addLesson(instructorId, {
      student_id: f.student_id,
      starts_at,
      duration_minutes: f.duration_minutes,
      kind: f.kind,
      price_cents: f.price === "" ? null : Math.round(Number(f.price) * 100),
      pickup: f.pickup,
      notes: f.notes,
    });
    setBusy(false);
    if (!r.ok) { setProblem(r.error); return; }
    onAdded();
  }

  if (students.length === 0) {
    return (
      <Sheet title="Add a lesson" onClose={onClose}>
        <p className="text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
          A lesson belongs to a student, and you haven't added any yet. Add one
          on the Students tab and come back.
        </p>
        <div className="mt-5"><SecondaryButton onClick={onClose}>Close</SecondaryButton></div>
      </Sheet>
    );
  }

  return (
    <Sheet title={preset ? `Lesson with ${preset.full_name}` : "Add a lesson"} onClose={onClose}>
      <div className="space-y-3">
        {!preset && (
          <div>
            <Label>Student</Label>
            <select
              value={f.student_id}
              onChange={e => set({ student_id: e.target.value })}
              className="mt-1.5 w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2.5 text-sm text-slate-900 dark:text-white"
            >
              {students.map(s => <option key={s.id} value={s.id}>{s.full_name}</option>)}
            </select>
          </div>
        )}

        <div className="grid grid-cols-2 gap-3">
          <Field label="Date" type="date" value={f.date} onChange={v => set({ date: v })} />
          <Field label="Time" type="time" value={f.time} onChange={v => set({ time: v })} />
        </div>

        <div>
          <Label>Length</Label>
          <div className="mt-1.5 flex gap-1.5">
            {[30, 60, 90, 120].map(m => (
              <button
                key={m}
                onClick={() => set({ duration_minutes: m })}
                className={`flex-1 rounded-xl px-2 py-2.5 text-sm font-bold transition ${
                  f.duration_minutes === m
                    ? "bg-emerald-500 text-slate-900"
                    : "border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300"
                }`}
              >
                {m < 60 ? `${m}m` : `${m / 60}h`}
              </button>
            ))}
          </div>
        </div>

        <div>
          <Label>Kind</Label>
          <select
            value={f.kind}
            onChange={e => set({ kind: e.target.value })}
            className="mt-1.5 w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2.5 text-sm text-slate-900 dark:text-white"
          >
            {LESSON_KINDS.map(k => <option key={k.id} value={k.id}>{k.label} — {k.blurb}</option>)}
          </select>
        </div>

        <Field label="Price" type="number" inputMode="decimal" value={f.price}
               onChange={v => set({ price: v })} placeholder="55.00"
               hint="In euro. Optional — leave it if you settle up another way." />

        <Field label="Pick-up" value={f.pickup} onChange={v => set({ pickup: v })}
               placeholder="Their house" />

        <div>
          <Label>Notes</Label>
          <textarea
            value={f.notes}
            onChange={e => set({ notes: e.target.value })}
            rows={2}
            placeholder="Roundabouts and lane discipline."
            className="mt-1.5 w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2.5 text-sm text-slate-900 dark:text-white"
          />
        </div>

        {problem && (
          <div className="flex items-start gap-2 text-sm bg-red-50 dark:bg-red-950/40 text-red-700 dark:text-red-300 rounded-xl px-3 py-2.5">
            <AlertCircle size={15} className="mt-0.5 shrink-0" /><span>{problem}</span>
          </div>
        )}
      </div>

      <div className="mt-5 space-y-2">
        <PrimaryButton onClick={save} disabled={busy}>
          <span className="inline-flex items-center gap-2">
            {busy && <Loader2 size={15} className="animate-spin" />} Add lesson
          </span>
        </PrimaryButton>
        <SecondaryButton onClick={onClose}>Cancel</SecondaryButton>
      </div>
    </Sheet>
  );
}
