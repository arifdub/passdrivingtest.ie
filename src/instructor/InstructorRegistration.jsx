/*
  ===========================================================================
  INSTRUCTOR REGISTRATION

  Five steps, because asking for a dozen things on one screen is how a form
  gets abandoned on a phone between lessons:

      1  You            name, phone, business, a line about you
      2  Your ADI       the number, the category, how long you've taught
      3  What you teach transmission and lesson types
      4  Where          base eircode, counties, areas
      5  Rates          hourly, EDT, cancellation policy

  then a review step that shows the lot before anything is submitted.

  SAVED AT EVERY STEP
  To the device immediately, and to the account when there is one. Coming
  back tomorrow resumes where they stopped; a dropped connection costs
  nothing. See instructorStore.

  WHAT SUBMITTING DOES, AND WHAT IT DOESN'T
  It moves the profile to 'pending'. It does not make anyone verified, and
  this screen says so in as many words — because the alternative is a badge
  reading "Verified ADI" that means "typed their own number in", and the
  person who finds out it was worthless is a learner alone in a car with a
  stranger.
  ===========================================================================
*/

import React, { useState, useCallback } from "react";
import {
  ChevronLeft, ChevronRight, Check, AlertCircle, Loader2, ShieldCheck,
} from "lucide-react";
import { PrimaryButton, SecondaryButton } from "../ui";
import {
  EMPTY_PROFILE, TRANSMISSIONS, LESSON_TYPES, COUNTIES,
  validate, FIELD_STEP, saveProfile, submitForReview,
} from "./instructorStore";

const STEPS = ["You", "Your ADI", "What you teach", "Where", "Rates", "Review"];

export default function InstructorRegistration({ initial, userId, onDone, onCancel }) {
  const [profile, setProfile] = useState(() => ({ ...EMPTY_PROFILE, ...(initial || {}) }));
  const [step, setStep] = useState(0);
  /* Which steps have been attempted. Errors are only shown on a step once
     someone has tried to leave it — flagging "Required" under a field they
     haven't reached yet is nagging, not helping. */
  const [attempted, setAttempted] = useState(() => new Set());
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState(null);

  const errors = validate(profile);
  const isLast = step === STEPS.length - 1;

  /* Only the problems belonging to the step on screen. */
  const stepErrors = Object.keys(errors).filter(k => (FIELD_STEP[k] ?? 0) === step);
  const touched = attempted.has(step);

  function handleNext() {
    setAttempted(prev => new Set(prev).add(step));

    /* Don't walk past a problem. The previous version advanced anyway, which
       meant the message explaining a malformed ADI number appeared on a
       screen the instructor had already left. */
    if (stepErrors.length) {
      setProblem("Fix the highlighted fields to continue.");
      return;
    }

    setProblem(null);
    setStep(s => s + 1);
  }

  const set = useCallback((patch) => {
    setProfile(p => {
      const next = { ...p, ...patch };
      /* Saved as they type, not only on Next: a form that loses an ADI
         number because the browser was closed has taught the instructor not
         to trust it. */
      saveProfile(next, userId);
      return next;
    });
  }, [userId]);

  const toggle = useCallback((field, value) => {
    setProfile(p => {
      const list = p[field] || [];
      const next = {
        ...p,
        [field]: list.includes(value) ? list.filter(v => v !== value) : [...list, value],
      };
      saveProfile(next, userId);
      return next;
    });
  }, [userId]);

  async function handleSubmit() {
    /* On submit every step counts as attempted, so the review list and the
       step they're sent to both show their problems. */
    setAttempted(new Set(STEPS.map((_, i) => i)));
    if (Object.keys(errors).length) {
      /* Send them to the first step that actually has a problem rather than
         refusing with a red message they then have to hunt for. */
      const first = Object.keys(errors)[0];
      setStep(FIELD_STEP[first] ?? 0);
      setProblem("Some details are still needed — they're highlighted below.");
      return;
    }

    setBusy(true);
    setProblem(null);
    const result = await submitForReview(profile, userId);
    setBusy(false);

    if (!result.ok) {
      setProblem(
        result.error
          ? `Could not submit: ${result.error}`
          : "Could not submit. Your answers are saved — try again shortly."
      );
      return;
    }
    onDone();
  }

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-900">
      {/* Header and progress */}
      <div className="bg-slate-900 text-white">
        <div
          className="max-w-2xl mx-auto px-5 pb-4"
          style={{ paddingTop: "max(1.5rem, calc(env(safe-area-inset-top) + 1rem))" }}
        >
          <button
            onClick={step === 0 ? onCancel : () => setStep(s => s - 1)}
            className="inline-flex items-center gap-1 text-xs font-bold uppercase tracking-widest text-slate-400 hover:text-emerald-400 py-1"
          >
            <ChevronLeft size={16} /> {step === 0 ? "Cancel" : STEPS[step - 1]}
          </button>

          <h1 className="mt-2 text-xl font-black tracking-tight">{STEPS[step]}</h1>
          <p className="text-sm text-slate-400">Step {step + 1} of {STEPS.length}</p>

          <div className="mt-3 flex gap-1.5">
            {STEPS.map((_, i) => (
              <div
                key={i}
                className={`h-1 flex-1 rounded-full ${
                  i <= step ? "bg-emerald-500" : "bg-white/15"
                }`}
              />
            ))}
          </div>
        </div>
      </div>

      <div className="max-w-2xl mx-auto px-5 py-6 pb-32">
        {problem && (
          <div className="mb-4 flex gap-3 bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-900 rounded-2xl p-4">
            <AlertCircle size={18} className="text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
            <p className="text-sm text-slate-700 dark:text-slate-200 leading-relaxed">{problem}</p>
          </div>
        )}

        {step === 0 && <StepYou profile={profile} set={set} errors={errors} touched={touched} />}
        {step === 1 && <StepAdi profile={profile} set={set} errors={errors} touched={touched} />}
        {step === 2 && <StepTeaching profile={profile} toggle={toggle} errors={errors} touched={touched} />}
        {step === 3 && <StepWhere profile={profile} set={set} toggle={toggle} errors={errors} touched={touched} />}
        {step === 4 && <StepRates profile={profile} set={set} errors={errors} touched={touched} />}
        {step === 5 && <StepReview profile={profile} errors={errors} goToStep={setStep} />}
      </div>

      {/* Footer actions */}
      <div className="fixed bottom-0 inset-x-0 bg-white/95 dark:bg-slate-900/95 backdrop-blur border-t border-slate-200 dark:border-slate-800 px-5 pt-3">
        <div
          className="max-w-2xl mx-auto"
          style={{ paddingBottom: "max(0.875rem, env(safe-area-inset-bottom))" }}
        >
          {isLast ? (
            <PrimaryButton onClick={handleSubmit} disabled={busy}>
              <span className="inline-flex items-center gap-2">
                {busy ? <Loader2 size={16} className="animate-spin" /> : <ShieldCheck size={16} />}
                {busy ? "Submitting…" : "Submit for verification"}
              </span>
            </PrimaryButton>
          ) : (
            <PrimaryButton onClick={handleNext}>
              <span className="inline-flex items-center gap-2">
                Next <ChevronRight size={16} />
              </span>
            </PrimaryButton>
          )}
          <p className="mt-2 text-center text-xs text-slate-400">
            Saved as you go — you can finish this later.
          </p>
        </div>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------------------
   Steps
   --------------------------------------------------------------------------- */
function StepYou({ profile, set, errors, touched }) {
  return (
    <>
      <Field label="Full name" error={touched && errors.full_name}>
        <Input value={profile.full_name} onChange={v => set({ full_name: v })}
               placeholder="Sarah O'Connor" autoComplete="name" />
      </Field>
      <Field label="Phone" error={touched && errors.phone}
             hint="Learners only see this once a lesson is booked.">
        <Input value={profile.phone} onChange={v => set({ phone: v })}
               placeholder="087 123 4567" type="tel" autoComplete="tel" />
      </Field>
      <Field label="Business name" hint="Optional — leave blank to use your own name.">
        <Input value={profile.business_name} onChange={v => set({ business_name: v })}
               placeholder="O'Connor School of Motoring" />
      </Field>
      <Field label="About you" hint="A few lines. This is the first thing a learner reads.">
        <textarea
          value={profile.bio}
          onChange={e => set({ bio: e.target.value })}
          rows={4}
          placeholder="Patient, calm and used to nervous first-timers. Teaching in north Dublin since 2015."
          className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3.5 py-3 text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none focus:border-emerald-500"
        />
      </Field>
    </>
  );
}

function StepAdi({ profile, set, errors, touched }) {
  return (
    <>
      <div className="mb-4 flex gap-3 bg-blue-50 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-900 rounded-2xl p-4">
        <ShieldCheck size={18} className="text-blue-600 dark:text-blue-400 shrink-0 mt-0.5" />
        <p className="text-sm text-slate-700 dark:text-slate-200 leading-relaxed">
          Your ADI number is checked against the RSA register by a person
          before your profile is visible to any learner. Nothing here marks
          you as verified on its own.
        </p>
      </div>

      {/* Digits, not "F12345". The RSA register prints it plainly — "ADI
          NUMBER | 40953" — and the earlier instruction to type an F was
          something this app invented, which then rejected the first real
          number anyone entered. The placeholder is a real-shaped number. */}
      <Field label="ADI number" error={touched && errors.adi_number}
             hint="The number on your ADI certificate, as it appears on the RSA register.">
        <Input value={profile.adi_number} onChange={v => set({ adi_number: v })}
               placeholder="40953" inputMode="numeric" />
      </Field>

      <Field label="ADI category" hint="The vehicle category you're approved to instruct in.">
        <Select value={profile.adi_category} onChange={v => set({ adi_category: v })}
                options={[
                  { value: "", label: "Select…" },
                  { value: "B", label: "B — Car" },
                  { value: "A", label: "A — Motorcycle" },
                  { value: "C", label: "C — Truck" },
                  { value: "D", label: "D — Bus" },
                ]} />
      </Field>

      <Field label="Years instructing" hint="Optional.">
        <Input value={profile.years_experience} type="number" inputMode="numeric"
               onChange={v => set({ years_experience: v })} placeholder="8" />
      </Field>
    </>
  );
}

function StepTeaching({ profile, toggle, errors, touched }) {
  return (
    <>
      <Field label="Transmission" error={touched && errors.transmissions}>
        <div className="flex flex-wrap gap-2">
          {TRANSMISSIONS.map(t => (
            <Chip key={t.id} on={profile.transmissions.includes(t.id)}
                  onClick={() => toggle("transmissions", t.id)}>{t.label}</Chip>
          ))}
        </div>
      </Field>

      <Field label="Lesson types" error={touched && errors.lesson_types}
             hint="What a learner can book with you.">
        <div className="space-y-2">
          {LESSON_TYPES.map(t => {
            const on = profile.lesson_types.includes(t.id);
            return (
              <button
                key={t.id}
                onClick={() => toggle("lesson_types", t.id)}
                className={`w-full text-left rounded-xl border p-3.5 flex items-center gap-3 transition ${
                  on
                    ? "bg-emerald-500/10 border-emerald-500"
                    : "bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700"
                }`}
              >
                <span className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 ${
                  on ? "bg-emerald-500 text-white" : "bg-slate-100 dark:bg-slate-700 text-slate-400"
                }`}>
                  {on ? <Check size={15} strokeWidth={3} /> : null}
                </span>
                <span>
                  <span className="block font-bold text-sm text-slate-900 dark:text-white">{t.label}</span>
                  <span className="block text-xs text-slate-500 dark:text-slate-400">{t.blurb}</span>
                </span>
              </button>
            );
          })}
        </div>
      </Field>
    </>
  );
}

function StepWhere({ profile, set, toggle, errors, touched }) {
  return (
    <>
      <Field label="Base eircode" hint="Where you usually start from. Used to match nearby learners.">
        <Input value={profile.base_eircode} onChange={v => set({ base_eircode: v.toUpperCase() })}
               placeholder="D15 XY12" />
      </Field>

      <Field label="Counties you cover" error={touched && errors.counties}>
        <div className="flex flex-wrap gap-2">
          {COUNTIES.map(c => (
            <Chip key={c} on={profile.counties.includes(c)}
                  onClick={() => toggle("counties", c)}>{c}</Chip>
          ))}
        </div>
      </Field>

      <Field label="Pickup areas"
             hint="Optional. Eircode routing keys, comma separated — D15, D24, K67.">
        <Input
          value={(profile.service_areas || []).join(", ")}
          onChange={v => set({
            service_areas: v.split(",").map(s => s.trim().toUpperCase()).filter(Boolean),
          })}
          placeholder="D15, D11, K67"
        />
      </Field>
    </>
  );
}

function StepRates({ profile, set, errors, touched }) {
  return (
    <>
      <div className="mb-4 rounded-2xl bg-slate-100 dark:bg-slate-800 p-4">
        <p className="text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
          You set your own prices. Students you bring yourself carry no
          platform fee — a fee applies only to learners the marketplace sends
          you, and it's shown before you accept.
        </p>
      </div>

      <Field label="Hourly rate" error={touched && errors.hourly_rate_cents}
             hint="What one hour costs a learner, in euro.">
        <Money value={profile.hourly_rate_cents} onChange={v => set({ hourly_rate_cents: v })} />
      </Field>

      <Field label="EDT lesson rate" hint="Optional — leave blank to use your hourly rate.">
        <Money value={profile.edt_rate_cents} onChange={v => set({ edt_rate_cents: v })} />
      </Field>

      <Field label="Cancellation policy" hint="How much notice you need, and what happens if it's late.">
        <textarea
          value={profile.cancellation_policy}
          onChange={e => set({ cancellation_policy: e.target.value })}
          rows={3}
          placeholder="24 hours' notice for a full refund. Later than that is charged in full."
          className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3.5 py-3 text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none focus:border-emerald-500"
        />
      </Field>
    </>
  );
}

function StepReview({ profile, errors, goToStep }) {
  const problems = Object.keys(errors);
  const euro = (cents) => (cents === "" || cents == null ? "—" : `€${(Number(cents) / 100).toFixed(2)}`);

  return (
    <>
      {problems.length > 0 && (
        <div className="mb-4 bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-900 rounded-2xl p-4">
          <p className="font-bold text-sm text-slate-900 dark:text-white">
            {problems.length} thing{problems.length === 1 ? "" : "s"} still needed
          </p>
          <ul className="mt-2 space-y-1">
            {problems.map(key => (
              <li key={key}>
                <button
                  onClick={() => goToStep(FIELD_STEP[key] ?? 0)}
                  className="text-sm font-semibold text-emerald-700 dark:text-emerald-400 underline"
                >
                  {LABELS[key] || key}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl p-5 space-y-3">
        <Row label="Name" value={profile.full_name} />
        <Row label="Phone" value={profile.phone} />
        <Row label="Business" value={profile.business_name} />
        <Row label="ADI number" value={profile.adi_number} />
        <Row label="Category" value={profile.adi_category} />
        <Row label="Transmission" value={profile.transmissions.join(", ")} />
        <Row label="Lessons" value={profile.lesson_types.join(", ")} />
        <Row label="Counties" value={profile.counties.join(", ")} />
        <Row label="Areas" value={(profile.service_areas || []).join(", ")} />
        <Row label="Hourly rate" value={euro(profile.hourly_rate_cents)} />
        <Row label="EDT rate" value={euro(profile.edt_rate_cents)} />
      </div>

      <div className="mt-4 flex gap-3 bg-blue-50 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-900 rounded-2xl p-4">
        <ShieldCheck size={18} className="text-blue-600 dark:text-blue-400 shrink-0 mt-0.5" />
        <p className="text-sm text-slate-700 dark:text-slate-200 leading-relaxed">
          Submitting sends your details for verification. Your profile stays
          invisible to learners until your ADI number has been checked against
          the RSA register — usually a couple of working days.
        </p>
      </div>
    </>
  );
}

const LABELS = {
  full_name: "Your name", phone: "Phone number", adi_number: "ADI number",
  transmissions: "Transmission", lesson_types: "Lesson types",
  counties: "Counties", hourly_rate_cents: "Hourly rate",
};

/* ---------------------------------------------------------------------------
   Small form pieces
   --------------------------------------------------------------------------- */
function Field({ label, hint, error, children }) {
  return (
    <div className="mb-5">
      <label className="block text-sm font-bold text-slate-900 dark:text-white mb-1.5">
        {label}
        {error && <span className="ml-2 text-xs font-semibold text-red-500">{error}</span>}
      </label>
      {children}
      {hint && <p className="mt-1.5 text-xs text-slate-500 dark:text-slate-400 leading-snug">{hint}</p>}
    </div>
  );
}

function Input({ value, onChange, ...rest }) {
  return (
    <input
      value={value ?? ""}
      onChange={e => onChange(e.target.value)}
      className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3.5 py-3 text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none focus:border-emerald-500"
      {...rest}
    />
  );
}

function Select({ value, onChange, options }) {
  return (
    <select
      value={value ?? ""}
      onChange={e => onChange(e.target.value)}
      className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3.5 py-3 text-slate-900 dark:text-white focus:outline-none focus:border-emerald-500"
    >
      {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  );
}

/* Euro in, cents stored. Money in a float is how a payout ends up two cent
   short, so the form is the only place the decimal exists. */
function Money({ value, onChange }) {
  const shown = value === "" || value == null ? "" : String(Number(value) / 100);
  return (
    <div className="relative">
      <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 font-bold">€</span>
      <input
        type="number"
        inputMode="decimal"
        min="0"
        step="0.50"
        value={shown}
        onChange={e => {
          const v = e.target.value;
          onChange(v === "" ? "" : Math.round(Number(v) * 100));
        }}
        placeholder="55.00"
        className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 pl-8 pr-3.5 py-3 text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none focus:border-emerald-500"
      />
    </div>
  );
}

function Chip({ on, onClick, children }) {
  return (
    <button
      onClick={onClick}
      className={`rounded-full px-3.5 py-2 text-sm font-bold border transition ${
        on
          ? "bg-emerald-500 border-emerald-500 text-slate-900"
          : "bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300"
      }`}
    >
      {children}
    </button>
  );
}

function Row({ label, value }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <span className="text-sm text-slate-500 dark:text-slate-400 shrink-0">{label}</span>
      <span className="text-sm font-semibold text-slate-900 dark:text-white text-right break-words">
        {value || "—"}
      </span>
    </div>
  );
}
