/*
  Driving level, whose car, and which gearbox — asked before a lesson is
  requested.
  Shared by the learner app's booking sheet and the instructor's own page.

  In the instructor's car only the gearboxes they teach in are offered, and
  when that is one, it is chosen for you. The rules are in bookingStore.js
  (gearboxChoices, fitGearbox); the database checks them again (sql/31).
*/

import React from "react";
import { ChevronDown } from "lucide-react";
import { CARS, LEVELS, gearboxChoices, fitGearbox } from "./bookingStore";

/* value = { level, car, gearbox } */
export default function CarChoice({ instructor, value, onChange, error }) {
  const { level, car, gearbox } = value;
  const boxes = car ? gearboxChoices(instructor, car) : [];
  const only = car === "instructor" && boxes.length === 1;

  return (
    <div className="space-y-3">
      <div>
        <label htmlFor="driving-level"
          className="block text-xs font-bold uppercase tracking-widest text-slate-500 dark:text-slate-400">
          Driving level
        </label>
        <div className="relative mt-2">
          <select id="driving-level" value={level || ""}
            onChange={e => onChange({ ...value, level: e.target.value ? Number(e.target.value) : null })}
            className={`w-full appearance-none rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 pl-3 pr-9 py-3 text-sm font-semibold ${
              level ? "text-slate-900 dark:text-white" : "text-slate-400"}`}>
            <option value="">Choose your level</option>
            {LEVELS.map(l => <option key={l.id} value={l.id}>{l.label}</option>)}
          </select>
          <ChevronDown size={16} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-slate-400" />
        </div>
      </div>

      <div>
        <Label>Car</Label>
        <div className="mt-2 grid grid-cols-2 gap-2">
          {CARS.map(c => (
            <Chip key={c.id} on={car === c.id}
                  onClick={() => onChange({ ...value, car: c.id, gearbox: fitGearbox(instructor, c.id, gearbox) })}>
              {c.label}
            </Chip>
          ))}
        </div>
      </div>

      {car && (
        <div>
          <Label>Gearbox</Label>
          <div className="mt-2 grid grid-cols-2 gap-2">
            {boxes.map(g => (
              <Chip key={g.id} on={gearbox === g.id} onClick={() => onChange({ ...value, gearbox: g.id })}>
                {g.label}
              </Chip>
            ))}
          </div>
          {only && (
            <p className="mt-1.5 text-xs text-slate-500 dark:text-slate-400">
              Their car is {boxes[0].label.toLowerCase()}. For {boxes[0].id === "manual" ? "an automatic" : "a manual"}, use your own car.
            </p>
          )}
        </div>
      )}

      {error && <p className="text-xs font-semibold text-red-600 dark:text-red-400">{error}</p>}
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
    <button type="button" onClick={onClick} aria-pressed={on}
      className={`rounded-xl px-3 py-3 text-sm font-bold transition ${
        on ? "bg-emerald-500 text-slate-900"
           : "bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300"}`}>
      {children}
    </button>
  );
}
