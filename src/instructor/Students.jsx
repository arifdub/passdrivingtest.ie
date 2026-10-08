/*
  ===========================================================================
  STUDENTS

  The instructor's own book, which is the part of this platform they can use
  on day one with no learner on it and no marketplace. "Keep the students you
  already teach, no acquisition fee" has been on the landing page since the
  start; this is the screen that means it.

  MOST STUDENTS ARE NOT ACCOUNTS

  A name and a mobile number, the way they are in the notebook this replaces.
  Adding one asks for a name and nothing else is required — an instructor
  typing this in at a kerb should not be made to fill a form.

  EDT IS COUNTED FROM LESSONS

  "7 of 12" comes from completed lessons of that kind, so it cannot disagree
  with the lessons that produced it. Nothing here writes it.
  ===========================================================================
*/

import React, { useState, useEffect, useCallback } from "react";
import {
  Users, Plus, Phone, MapPin, Loader2, AlertCircle, X, Archive,
  CalendarPlus, Search, Store,
} from "lucide-react";
import { useAuth } from "../appAuth";
import { EmptyState, PrimaryButton, SecondaryButton } from "../ui";
import {
  listStudents, progressByStudent, addStudent, updateStudent, EDT_TOTAL,
} from "./teachingStore";

export default function Students({ onBookFor }) {
  const { user } = useAuth();

  const [rows, setRows] = useState([]);
  const [progress, setProgress] = useState({});
  const [query, setQuery] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  const [adding, setAdding] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    const [{ rows: r, error: e }, p] = await Promise.all([
      listStudents(user?.id, { includeArchived: showArchived }),
      progressByStudent(user?.id),
    ]);
    setRows(r); setProgress(p); setError(e); setLoading(false);
  }, [user?.id, showArchived]);

  useEffect(() => { refresh(); }, [refresh]);

  const needle = query.trim().toLowerCase();
  const shown = needle
    ? rows.filter(r =>
        (r.full_name || "").toLowerCase().includes(needle) ||
        (r.phone || "").includes(needle) ||
        (r.area || "").toLowerCase().includes(needle))
    : rows;

  return (
    <>
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Search by name, phone or area"
            className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 pl-9 pr-3 py-2.5 text-sm text-slate-900 dark:text-white"
          />
        </div>
        <button
          onClick={() => setAdding(true)}
          className="shrink-0 inline-flex items-center gap-1.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-900 font-bold px-3.5 text-sm transition"
        >
          <Plus size={16} /> Add
        </button>
      </div>

      <button
        onClick={() => setShowArchived(v => !v)}
        className="mt-2 text-xs font-semibold text-slate-500 dark:text-slate-400"
      >
        {showArchived ? "Hide archived" : "Show archived too"}
      </button>

      {error && (
        <div className="mt-4 flex items-start gap-2.5 bg-red-50 dark:bg-red-950/40 text-red-700 dark:text-red-300 rounded-2xl px-4 py-3 text-sm">
          <AlertCircle size={16} className="mt-0.5 shrink-0" />
          <div>
            <p className="font-semibold">Couldn't load your students.</p>
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

      {!loading && shown.length === 0 && !error && (
        <div className="mt-4 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl p-8">
          <EmptyState
            icon={Users}
            title={needle ? "Nobody matches that" : "No students yet"}
            message={
              needle
                ? "Try a different name or number."
                : "Add the students you already teach. They don't need an account here, and there's no fee for them — ever."
            }
          />
        </div>
      )}

      <div className="mt-4 space-y-3">
        {shown.map(row => (
          <StudentCard
            key={row.id}
            row={row}
            progress={progress[row.id]}
            onBook={() => onBookFor?.(row)}
            onChanged={refresh}
          />
        ))}
      </div>

      {adding && (
        <AddStudent
          instructorId={user?.id}
          onClose={() => setAdding(false)}
          onAdded={async () => { setAdding(false); await refresh(); }}
        />
      )}
    </>
  );
}

/* ------------------------------------------------------------------------- */

function StudentCard({ row, progress, onBook, onChanged }) {
  const [busy, setBusy] = useState(false);
  const edt = progress?.edt_done || 0;
  const next = progress?.next_lesson_at;

  async function archive() {
    setBusy(true);
    await updateStudent(row.id, { status: row.status === "active" ? "archived" : "active" });
    setBusy(false);
    await onChanged();
  }

  return (
    <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="font-black text-slate-900 dark:text-white truncate">{row.full_name}</h3>
          {row.area && (
            <p className="mt-0.5 flex items-center gap-1.5 text-sm text-slate-500 dark:text-slate-400">
              <MapPin size={13} className="shrink-0" /> {row.area}
            </p>
          )}
        </div>
        {row.source === "marketplace" && (
          <span className="shrink-0 inline-flex items-center gap-1 rounded-full bg-blue-50 dark:bg-blue-950/40 text-blue-700 dark:text-blue-300 px-2.5 py-1 text-[10px] font-black uppercase tracking-widest">
            <Store size={11} /> Marketplace
          </span>
        )}
      </div>

      {/* Twelve lessons is the whole syllabus, so the bar is against twelve
          and not against however many they happen to have had. */}
      <div className="mt-3">
        <div className="flex items-center justify-between text-xs">
          <span className="font-bold uppercase tracking-widest text-slate-400">EDT</span>
          <span className="tabular-nums font-bold text-slate-600 dark:text-slate-300">
            {edt} of {EDT_TOTAL}
          </span>
        </div>
        <div className="mt-1.5 h-1.5 rounded-full bg-slate-100 dark:bg-slate-700 overflow-hidden">
          <div
            className="h-full rounded-full bg-emerald-500 transition-all"
            style={{ width: `${Math.min(100, (edt / EDT_TOTAL) * 100)}%` }}
          />
        </div>
      </div>

      <p className="mt-2.5 text-sm text-slate-500 dark:text-slate-400">
        {next
          ? `Next lesson ${new Date(next).toLocaleDateString("en-IE", { weekday: "short", day: "numeric", month: "short" })}`
          : "Nothing booked in"}
        {progress?.lessons_done ? ` · ${progress.lessons_done} taught` : ""}
      </p>

      {row.notes && (
        <p className="mt-2.5 text-sm text-slate-500 dark:text-slate-400 leading-relaxed">{row.notes}</p>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-2">
        {row.phone && (
          <a
            href={`tel:${row.phone.replace(/\s+/g, "")}`}
            className="inline-flex items-center gap-1.5 text-sm font-bold text-emerald-700 dark:text-emerald-400"
          >
            <Phone size={15} /> {row.phone}
          </a>
        )}
        <div className="ml-auto flex gap-2">
          <SecondaryButton full={false} onClick={onBook}>
            <span className="inline-flex items-center gap-1.5"><CalendarPlus size={15} /> Lesson</span>
          </SecondaryButton>
          <button
            onClick={archive}
            disabled={busy}
            aria-label={row.status === "active" ? "Archive" : "Restore"}
            className="inline-flex items-center justify-center w-10 rounded-xl border border-slate-200 dark:border-slate-700 text-slate-400"
          >
            <Archive size={15} />
          </button>
        </div>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------------------
   A name is the only required field. Everything else can be filled in when
   there is a moment — the alternative is an instructor abandoning the form
   at a kerb and going back to the notebook.
   --------------------------------------------------------------------------- */
function AddStudent({ instructorId, onClose, onAdded }) {
  const [f, setF] = useState({ full_name: "", phone: "", area: "", notes: "" });
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState(null);

  const set = p => setF(prev => ({ ...prev, ...p }));

  async function save() {
    setBusy(true); setProblem(null);
    const r = await addStudent(instructorId, f);
    setBusy(false);
    if (!r.ok) { setProblem(r.error); return; }
    onAdded();
  }

  return (
    <Sheet title="Add a student" onClose={onClose}>
      <div className="space-y-3">
        <Field label="Name" value={f.full_name} onChange={v => set({ full_name: v })}
               placeholder="Ciara Byrne" autoFocus />
        <Field label="Phone" value={f.phone} onChange={v => set({ phone: v })}
               placeholder="087 123 4567" type="tel" hint="Optional, but it's how you'll reach them." />
        <Field label="Area" value={f.area} onChange={v => set({ area: v })}
               placeholder="Tallaght, D24" />
        <div>
          <Label>Notes</Label>
          <textarea
            value={f.notes}
            onChange={e => set({ notes: e.target.value })}
            rows={2}
            placeholder="Started EDT in March. Nervous on roundabouts."
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
        <PrimaryButton onClick={save} disabled={busy || !f.full_name.trim()}>
          <span className="inline-flex items-center gap-2">
            {busy && <Loader2 size={15} className="animate-spin" />} Add student
          </span>
        </PrimaryButton>
        <SecondaryButton onClick={onClose}>Cancel</SecondaryButton>
      </div>
    </Sheet>
  );
}

/* ------------------------------------------------------------------------- */
/* Shared bits, exported so the calendar uses the same ones                   */
/* ------------------------------------------------------------------------- */

export function Sheet({ title, children, onClose }) {
  return (
    <div className="fixed inset-0 z-40 bg-slate-900/70 backdrop-blur-sm flex items-end" onClick={onClose}>
      <div
        className="w-full max-h-[92vh] overflow-y-auto bg-white dark:bg-slate-800 rounded-t-3xl p-6"
        style={{ paddingBottom: "max(1.5rem, calc(env(safe-area-inset-bottom) + 1rem))" }}
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 mb-4">
          <h2 className="text-lg font-black tracking-tight text-slate-900 dark:text-white">{title}</h2>
          <button onClick={onClose} aria-label="Close" className="shrink-0 text-slate-400 p-1">
            <X size={20} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function Label({ children }) {
  return (
    <label className="block text-xs font-bold uppercase tracking-widest text-slate-500 dark:text-slate-400">
      {children}
    </label>
  );
}

export function Field({ label, value, onChange, hint, ...rest }) {
  return (
    <div>
      <Label>{label}</Label>
      <input
        value={value ?? ""}
        onChange={e => onChange(e.target.value)}
        className="mt-1.5 w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2.5 text-sm text-slate-900 dark:text-white"
        {...rest}
      />
      {hint && <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{hint}</p>}
    </div>
  );
}
