/*
  Whose car, and which gearbox — asked before a lesson is requested.
  Shared by the learner app's booking sheet and the instructor's own page.

  In the instructor's car only the gearboxes they teach in are offered, and
  when that is one, it is chosen for you. The rules are in bookingStore.js
  (gearboxChoices, fitGearbox); the database checks them again (sql/30).
*/

import React from "react";
import { CARS, gearboxChoices, fitGearbox } from "./bookingStore";

export default function CarChoice({ instructor, car, gearbox, onChange, error }) {
  const boxes = car ? gearboxChoices(instructor, car) : [];
  const only = car === "instructor" && boxes.length === 1;

  return (
    <div className="space-y-3">
      <div>
        <Label>Car</Label>
        <div className="mt-2 grid grid-cols-2 gap-2">
          {CARS.map(c => (
            <Chip key={c.id} on={car === c.id}
                  onClick={() => onChange({ car: c.id, gearbox: fitGearbox(instructor, c.id, gearbox) })}>
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
              <Chip key={g.id} on={gearbox === g.id} onClick={() => onChange({ car, gearbox: g.id })}>
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
