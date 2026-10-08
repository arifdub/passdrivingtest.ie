/*
  ===========================================================================
  MARKETPLACE — the instructor's side of being findable

  One switch, and an honest account of what it does.

  WHY THIS SCREEN EXISTS AT ALL

  Until now a verified instructor had no way to appear in the directory.
  sql/04 always allowed it and sql/06 always guarded it; what was missing was
  somewhere to ask. The result was a marketplace that could never have
  anybody in it, which is a worse bug than it looks — every other screen in
  this product leads here eventually.

  WHAT IT DELIBERATELY DOES NOT SAY

  Anything about money. Lessons are paid directly to the instructor, in
  whatever way they already take payment. The platform does not handle it,
  does not hold it, and takes nothing — and this screen says so plainly
  rather than leaving a fee to be discovered later.
  ===========================================================================
*/

import React, { useState, useEffect, useCallback } from "react";
import {
  Store, Eye, EyeOff, Loader2, AlertCircle, Check, ShieldCheck, Banknote,
} from "lucide-react";
import { useAuth } from "../appAuth";
import { VerifiedBadge } from "../ui";
import { loadProfile, setListed, listingBlockers } from "./instructorStore";
import { loadAvailability } from "./availabilityStore";
import { euro } from "./teachingStore";

export default function Marketplace({ onOpenAccount, onOpenAvailability }) {
  const { user } = useAuth();
  const [profile, setProfile] = useState(null);
  const [hasHours, setHasHours] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    const [{ profile: p }, a] = await Promise.all([
      loadProfile(user?.id),
      loadAvailability(user?.id),
    ]);
    setProfile(p);
    /* A failed read is not the same as no hours: if sql/11 is missing this
       should not accuse the instructor of having an empty week. */
    setHasHours(a.error ? null : a.hours.length > 0);
    setLoading(false);
  }, [user?.id]);

  useEffect(() => { refresh(); }, [refresh]);

  if (loading) {
    return (
      <div className="flex items-center gap-2.5 text-slate-500 dark:text-slate-400 py-10 justify-center">
        <Loader2 size={18} className="animate-spin" />
        <span className="text-sm">Checking your listing…</span>
      </div>
    );
  }

  const verified = profile?.verification_status === "verified";
  const blockers = listingBlockers(profile, { hasHours });
  const canList = verified && blockers.length === 0;

  return (
    <>
      {/* ------------------------------------------------------------------ */}
      {/* The switch                                                         */}
      {/* ------------------------------------------------------------------ */}
      <div className={`rounded-2xl border p-5 ${
        profile?.listed
          ? "border-emerald-200 dark:border-emerald-900 bg-emerald-50 dark:bg-emerald-950/40"
          : "border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800"
      }`}>
        <div className="flex items-start gap-3">
          {profile?.listed
            ? <Eye size={20} className="text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" />
            : <EyeOff size={20} className="text-slate-400 shrink-0 mt-0.5" />}
          <div className="flex-1 min-w-0">
            <h2 className="font-bold text-slate-900 dark:text-white">
              {profile?.listed ? "You're in the directory" : "You're not listed"}
            </h2>
            <p className="mt-1 text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
              {profile?.listed
                ? "Learners searching your counties can see your card and request your open hours."
                : "Nobody searching can find you. Your own students and your calendar work exactly the same either way."}
            </p>
          </div>
        </div>

        {!verified ? (
          <Blocked>
            Your ADI number has to be checked against the RSA register first.
            That's what the badge means, and it's why a learner can trust it.
          </Blocked>
        ) : blockers.length ? (
          <Blocked>
            <p>Before you go in, a learner needs to be able to see{" "}
              {blockers.length === 1
                ? blockers[0]
                : `${blockers.slice(0, -1).join(", ")} and ${blockers[blockers.length - 1]}`}.
            </p>
            <div className="mt-2 flex gap-3">
              <button onClick={onOpenAccount} className="text-xs font-bold text-emerald-700 dark:text-emerald-400 hover:underline">
                Edit profile
              </button>
              <button onClick={onOpenAvailability} className="text-xs font-bold text-emerald-700 dark:text-emerald-400 hover:underline">
                Set hours
              </button>
            </div>
          </Blocked>
        ) : null}

        {error && (
          <p className="mt-3 text-sm text-red-500 flex items-start gap-1.5">
            <AlertCircle size={15} className="shrink-0 mt-0.5" /> {error}
          </p>
        )}

        <button
          disabled={busy || (!profile?.listed && !canList)}
          onClick={async () => {
            setBusy(true); setError(null);
            const { ok, error: e } = await setListed(user?.id, !profile?.listed);
            setBusy(false);
            if (ok) refresh(); else setError(e);
          }}
          className={`mt-4 w-full rounded-xl font-bold py-3 text-sm transition disabled:opacity-40 ${
            profile?.listed
              ? "border border-slate-200 dark:border-slate-600 text-slate-600 dark:text-slate-300"
              : "bg-emerald-500 hover:bg-emerald-400 text-slate-900"
          }`}
        >
          {busy ? "…" : profile?.listed ? "Take me out of the directory" : "List me in the directory"}
        </button>

        {profile?.listed && (
          <p className="mt-2 text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
            Taking yourself out hides you immediately. Lessons already booked
            are not affected — withdrawing from the directory isn't cancelling
            on people who already arranged something with you.
          </p>
        )}
      </div>

      {/* ------------------------------------------------------------------ */}
      {/* Money, stated once and plainly                                     */}
      {/* ------------------------------------------------------------------ */}
      <div className="mt-4 rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-5">
        <div className="flex items-center gap-2.5">
          <Banknote size={18} className="text-emerald-500 shrink-0" />
          <h2 className="font-bold text-slate-900 dark:text-white">
            Learners pay you directly
          </h2>
        </div>
        <p className="mt-2 text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
          No card is taken here and no money passes through this site. A
          learner books an hour; you take payment the way you already do, in
          the car. The rate on your profile is what they see before they book,
          so there is nothing to negotiate at the kerb.
        </p>
        <p className="mt-2 text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
          <strong className="text-slate-900 dark:text-white">The platform takes nothing.</strong>{" "}
          Not from your own students, not from the ones the directory sends
          you. If that ever changes it will be said here first, in advance,
          and it will not apply to anything already booked.
        </p>
      </div>

      {/* ------------------------------------------------------------------ */}
      {/* What the card looks like                                           */}
      {/* ------------------------------------------------------------------ */}
      {verified && (
        <>
          <h2 className="mt-6 font-black tracking-tight text-slate-900 dark:text-white">
            How you appear
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            {profile?.listed ? "This is your card in the directory." : "This is what would be shown."}
          </p>

          <div className="mt-3 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl p-5">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h3 className="font-black text-slate-900 dark:text-white truncate">
                  {profile?.full_name || "Your name"}
                </h3>
                {profile?.business_name && (
                  <p className="text-sm text-slate-500 dark:text-slate-400 truncate">
                    {profile.business_name}
                  </p>
                )}
              </div>
              <VerifiedBadge size="sm" />
            </div>

            <p className="mt-2.5 text-sm text-slate-600 dark:text-slate-300">
              {(profile?.counties || []).join(", ") || "No areas set"}
            </p>
            {profile?.hourly_rate_cents ? (
              <p className="mt-1.5 text-sm font-bold text-slate-900 dark:text-white">
                {euro(profile.hourly_rate_cents)}/hour
                {profile.edt_rate_cents ? ` · ${euro(profile.edt_rate_cents)} EDT` : ""}
              </p>
            ) : null}
            {profile?.bio && (
              <p className="mt-2.5 text-sm text-slate-500 dark:text-slate-400 leading-relaxed">
                {profile.bio}
              </p>
            )}
          </div>
        </>
      )}
    </>
  );
}

function Blocked({ children }) {
  return (
    <div className="mt-3 rounded-xl bg-slate-100 dark:bg-slate-900/60 p-3.5 text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
      {children}
    </div>
  );
}
