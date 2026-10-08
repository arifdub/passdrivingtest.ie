/*
  ===========================================================================
  ACCOUNT

  Where an instructor's own details live, and the one place they are edited.

  WHY THE DASHBOARD NO LONGER CARRIES THIS

  "Verify your ADI" was the first thing on the dashboard, which was right
  while it was unresolved and wrong the moment it wasn't. A verified
  instructor opening the app wants today's lessons, not a panel congratulating
  them on something they did weeks ago — and "Edit my profile" buried inside
  a verification card is not where anyone would look for it.

  So the dashboard keeps the card only while there is something to do about
  it, and shows a badge once there isn't. The profile itself moved here,
  where a person would look for their own details.
  ===========================================================================
*/

import React from "react";
import {
  UserCircle, Pencil, Mail, Phone, MapPin, Car, Euro, Briefcase,
  ShieldCheck, Clock3, ShieldAlert, Loader2,
} from "lucide-react";
import { useAuth } from "../appAuth";
import AvatarPicker from "../AvatarPicker";
import { setInstructorPhoto } from "../avatars";
import { PrimaryButton, SecondaryButton, VerifiedBadge } from "../ui";
import { TRANSMISSIONS, LESSON_TYPES } from "./instructorStore";

const TRANSMISSION_LABEL = Object.fromEntries(TRANSMISSIONS.map(t => [t.id, t.label]));
const LESSON_LABEL = Object.fromEntries(LESSON_TYPES.map(t => [t.id, t.label]));

function euro(cents) {
  if (cents === null || cents === undefined || cents === "") return null;
  return `€${(cents / 100).toFixed(2)}`;
}

export default function Account({ loading, status, profile, draft, onRegister, onChanged }) {
  const { user } = useAuth();
  const p = profile || draft;

  if (loading) {
    return (
      <div className="flex items-center gap-2.5 text-slate-500 dark:text-slate-400 py-10 justify-center">
        <Loader2 size={18} className="animate-spin" />
        <span className="text-sm">Loading your details…</span>
      </div>
    );
  }

  return (
    <>
      {/* ------------------------------------------------------------------ */}
      {/* Who this is                                                        */}
      {/* ------------------------------------------------------------------ */}
      <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl p-5">
        <div className="min-w-0">
          <h2 className="text-lg font-black tracking-tight text-slate-900 dark:text-white truncate">
            {p?.full_name || "Your profile"}
          </h2>
          {p?.business_name && (
            <p className="text-sm text-slate-500 dark:text-slate-400 truncate">{p.business_name}</p>
          )}
          <div className="mt-2">
            <StatusBadge status={status} />
          </div>
        </div>

        {/* Tap the circle. An instructor's photo is the first thing a learner
            looks at on a directory card, so it is said plainly that this one
            is public rather than left to be discovered. */}
        <div className="mt-4 pt-4 border-t border-slate-100 dark:border-slate-700">
          <AvatarPicker
            url={profile?.photo_url}
            userId={user?.id}
            name={p?.full_name || user?.email}
            note="Shown on your card in the directory, so learners can see who they are booking."
            onSave={async (url) => {
              const r = await setInstructorPhoto(user?.id, url);
              if (r.ok) await onChanged?.();
              return r;
            }}
          />
        </div>

        {p?.bio && (
          <p className="mt-4 text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
            {p.bio}
          </p>
        )}

        <div className="mt-4">
          <PrimaryButton onClick={onRegister}>
            {p ? "Edit my profile" : "Add my details"}
          </PrimaryButton>
        </div>
      </div>

      {/* ------------------------------------------------------------------ */}
      {/* What a learner compares them on                                    */}
      {/* ------------------------------------------------------------------ */}
      {p && (
        <div className="mt-4 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl divide-y divide-slate-100 dark:divide-slate-700">
          <Row icon={Mail} label="Sign-in email" value={user?.email} />
          <Row icon={Phone} label="Phone" value={p.phone} />
          <Row
            icon={ShieldCheck}
            label="ADI number"
            value={p.adi_number}
            note={status === "verified" ? "Checked against the RSA register" : null}
          />
          <Row
            icon={Car}
            label="Transmission"
            value={(p.transmissions || []).map(t => TRANSMISSION_LABEL[t] || t).join(", ")}
          />
          <Row
            icon={Briefcase}
            label="Lessons taught"
            value={(p.lesson_types || []).map(t => LESSON_LABEL[t] || t).join(", ")}
          />
          <Row
            icon={MapPin}
            label="Areas"
            value={(p.counties || []).join(", ")}
            note={(p.service_areas || []).length ? (p.service_areas || []).join(", ") : null}
          />
          <Row
            icon={Euro}
            label="Hourly rate"
            value={euro(p.hourly_rate_cents)}
            note={p.edt_rate_cents ? `EDT ${euro(p.edt_rate_cents)}` : null}
          />
        </div>
      )}

      {/* ------------------------------------------------------------------ */}
      {/* Anything still owed                                                */}
      {/* ------------------------------------------------------------------ */}
      {status !== "verified" && (
        <div className="mt-4">
          <Unfinished status={status} profile={profile} draft={draft} onRegister={onRegister} />
        </div>
      )}
    </>
  );
}

function Row({ icon: Icon, label, value, note }) {
  return (
    <div className="p-4 flex items-start gap-3">
      <Icon size={16} className="text-slate-400 shrink-0 mt-0.5" />
      <div className="flex-1 min-w-0">
        <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">{label}</p>
        {/* An unanswered field says so rather than showing an empty line that
            reads as a rendering bug. */}
        <p className={`text-sm ${value ? "text-slate-900 dark:text-white font-medium" : "text-slate-400 italic"} break-words`}>
          {value || "Not set"}
        </p>
        {note && <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 break-words">{note}</p>}
      </div>
    </div>
  );
}

function StatusBadge({ status }) {
  if (status === "verified") return <VerifiedBadge />;

  const map = {
    pending: { icon: Clock3, text: "Verification in progress", cls: "bg-amber-50 dark:bg-amber-950/50 text-amber-700 dark:text-amber-300" },
    rejected: { icon: ShieldAlert, text: "Not verified", cls: "bg-red-50 dark:bg-red-950/50 text-red-700 dark:text-red-300" },
    suspended: { icon: ShieldAlert, text: "Suspended", cls: "bg-red-50 dark:bg-red-950/50 text-red-700 dark:text-red-300" },
    draft: { icon: Pencil, text: "Half finished", cls: "bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300" },
  };
  const m = map[status] || { icon: Pencil, text: "Not registered", cls: "bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300" };
  const Icon = m.icon;

  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-bold ${m.cls}`}>
      <Icon size={13} /> {m.text}
    </span>
  );
}

/* The same words the dashboard used to carry, kept here for the states where
   there is genuinely something left to do. */
function Unfinished({ status, profile, draft, onRegister }) {
  const box = "rounded-2xl border p-5 text-sm leading-relaxed";

  if (!status) {
    return (
      <div className={`${box} border-blue-200 dark:border-blue-900 bg-blue-50 dark:bg-blue-950/40`}>
        <h3 className="font-bold text-slate-900 dark:text-white">Get verified to take bookings</h3>
        <p className="mt-2 text-slate-600 dark:text-slate-300">
          Add your ADI number and we'll check it against the RSA register. Until
          that's done your profile isn't visible to learners — which is the
          point: it's what the badge means.
        </p>
      </div>
    );
  }

  if (status === "draft") {
    return (
      <div className={`${box} border-amber-200 dark:border-amber-900 bg-amber-50 dark:bg-amber-950/40`}>
        <h3 className="font-bold text-slate-900 dark:text-white">Your registration is half finished</h3>
        <p className="mt-2 text-slate-600 dark:text-slate-300">
          Your answers are saved. Finish them and submit, and we'll check your
          ADI number against the RSA register.
        </p>
        <div className="mt-4">
          <SecondaryButton onClick={onRegister}>Finish registering</SecondaryButton>
        </div>
      </div>
    );
  }

  if (status === "pending") {
    return (
      <div className={`${box} border-amber-200 dark:border-amber-900 bg-amber-50 dark:bg-amber-950/40`}>
        <h3 className="font-bold text-slate-900 dark:text-white">Verification in progress</h3>
        <p className="mt-2 text-slate-600 dark:text-slate-300">
          We're checking ADI number{" "}
          <strong>{profile?.adi_number || draft?.adi_number}</strong> against the
          RSA register. This usually takes a couple of working days, and your
          profile stays hidden from learners until it's done.
        </p>
      </div>
    );
  }

  if (status === "rejected") {
    return (
      <div className={`${box} border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/40`}>
        <h3 className="font-bold text-slate-900 dark:text-white">We couldn't verify your ADI number</h3>
        <p className="mt-2 text-slate-600 dark:text-slate-300">
          {profile?.verification_notes
            || "The number didn't match the RSA register. Check it and submit again."}
        </p>
        <div className="mt-4">
          <SecondaryButton onClick={onRegister}>Update and resubmit</SecondaryButton>
        </div>
      </div>
    );
  }

  return (
    <div className={`${box} border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/40`}>
      <h3 className="font-bold text-slate-900 dark:text-white">Your account is suspended</h3>
      <p className="mt-2 text-slate-600 dark:text-slate-300">
        {profile?.verification_notes
          || "Your profile has been withdrawn from the marketplace. Get in touch to sort it out."}
      </p>
    </div>
  );
}
