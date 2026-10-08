/*
  ===========================================================================
  FIND AN INSTRUCTOR

  The first screen where the two halves of the platform meet. Everything
  before this was two products sharing a login: learners studied, instructors
  got verified, and nothing passed between them. The instructor's verified
  card has been saying "your profile is visible to learners" since it was
  written. This is the screen that makes that sentence true.

  WHAT IS SHOWN, AND WHY IT IS ONLY THIS

  Verified, listed instructors. Nothing else is readable — sql/04's public
  policy covers exactly those rows, so a draft or a pending registration is
  invisible here and invisible to a crafted request alike.

  No ratings, no "4.8 from 112 reviews", no distance in kilometres. None of
  those exist yet, and a marketplace that invents its social proof is worse
  than one that admits it is new. What IS known is real: the ADI number was
  checked by a person, and the date it happened.

  AN ENQUIRY IS NOT A BOOKING

  It says so on the button and again in the sheet. There is no calendar and
  no availability, so anything that looked like booking a time would be a
  promise the platform cannot keep — and the learner would turn up.
  ===========================================================================
*/

import React, { useState, useEffect, useCallback } from "react";
import {
  Search, MapPin, Car, BadgeCheck, Loader2, AlertCircle, Check, X,
  MessageSquare, SlidersHorizontal, CalendarCheck, Star,
} from "lucide-react";
import { useAuth } from "./appAuth";
import { ScreenHeader, EmptyState, PrimaryButton, SecondaryButton } from "./ui";
import {
  listInstructors, countiesWithInstructors, sendEnquiry, myEnquiries,
  euro, LESSON_LABELS,
} from "./marketplace";
import BookSheet from "./BookSheet";
import MyBookings from "./MyBookings";
import ReviewSheet from "./ReviewSheet";
import { ratingsFor, ratingLabel, listReviews, canReview } from "./socialStore";
import { myBookings } from "./bookingStore";

export default function FindInstructor({ onBack }) {
  const { user, isGuest, displayName } = useAuth();

  const [county, setCounty] = useState("");
  const [counties, setCounties] = useState([]);
  const [rows, setRows] = useState([]);
  const [sent, setSent] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [asking, setAsking] = useState(null);
  const [booking, setBooking] = useState(null);
  const [reviewing, setReviewing] = useState(null);
  /* Ratings and the learner's own reviews, fetched once for the whole page
     rather than once per card. */
  const [ratings, setRatings] = useState({});
  const [myReviews, setMyReviews] = useState({});
  const [reviewable, setReviewable] = useState({});

  const refresh = useCallback(async () => {
    setLoading(true);
    const [{ rows: r, error: e }, mine] = await Promise.all([
      listInstructors({ county: county || undefined }),
      myEnquiries(user?.id),
    ]);
    setRows(r);
    setSent(mine);
    setError(e);
    setLoading(false);
  }, [county, user?.id]);

  useEffect(() => { refresh(); }, [refresh]);

  /* Ratings for whatever is on screen, plus — for this learner only — which
     instructors they may review and whether they already have.

     Eligibility is asked of the database, but only for the handful of
     instructors the learner has ever booked with. Asking for all fifty cards
     would be fifty round trips to answer "no" forty-eight times, and a
     learner cannot have completed a lesson with someone they never booked.
     The button appearing is a convenience; the trigger in sql/13 is the
     rule, and it is checked again on write. */
  useEffect(() => {
    let off = false;
    const ids = rows.map(r => r.user_id);
    if (!ids.length) return;

    (async () => {
      const map = await ratingsFor(ids);
      if (!off) setRatings(map);
      if (!user?.id) return;

      const { rows: mine } = await myBookings(user.id);
      const known = new Set(mine.map(b => b.instructor_id).filter(id => ids.includes(id)));
      if (!known.size) return;

      const can = {}, written = {};
      await Promise.all([...known].map(async id => {
        if (await canReview(id, user.id)) can[id] = true;
        const { rows: rs } = await listReviews(id);
        const own = (rs || []).find(r => r.learner_id === user.id);
        if (own) written[id] = own;
      }));

      if (!off) { setReviewable(can); setMyReviews(written); }
    })();

    return () => { off = true; };
  }, [rows, user?.id]);
  useEffect(() => { countiesWithInstructors().then(setCounties); }, []);

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-900">
      <ScreenHeader title="Find an instructor" onBack={onBack} />

      <div className="max-w-2xl mx-auto px-5 py-5">
        <p className="text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
          Every instructor here has had their ADI number checked against the
          RSA register by a person. Nobody appears until that is done.
        </p>

        {counties.length > 0 && (
          <div className="mt-4 flex gap-1.5 overflow-x-auto pb-2 -mx-1 px-1">
            <Chip on={!county} onClick={() => setCounty("")}>
              <SlidersHorizontal size={13} /> Everywhere
            </Chip>
            {counties.map(c => (
              <Chip key={c} on={county === c} onClick={() => setCounty(c)}>{c}</Chip>
            ))}
          </div>
        )}

        {error && (
          <div className="mt-4 flex items-start gap-2.5 bg-red-50 dark:bg-red-950/40 text-red-700 dark:text-red-300 rounded-2xl px-4 py-3 text-sm">
            <AlertCircle size={16} className="mt-0.5 shrink-0" />
            <div>
              <p className="font-semibold">Couldn't load instructors.</p>
              <p className="mt-0.5 opacity-90">{error}</p>
            </div>
          </div>
        )}

        {loading && rows.length === 0 && (
          <div className="flex items-center justify-center gap-2.5 text-sm text-slate-500 py-10">
            <Loader2 size={16} className="animate-spin" /> Looking…
          </div>
        )}

        {!loading && rows.length === 0 && !error && (
          <div className="mt-4 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl p-8">
            <EmptyState
              icon={Search}
              title={county ? `No instructors in ${county} yet` : "No instructors yet"}
              message={
                county
                  ? "Nobody verified covers that county so far. Try Everywhere."
                  : "Instructors are being verified now. This fills up as they're checked."
              }
            />
          </div>
        )}

        {!isGuest && <div className="mt-5"><MyBookings learnerId={user?.id} /></div>}

        <div className="mt-4 space-y-3">
          {rows.map(row => (
            <InstructorCard
              key={row.user_id}
              row={row}
              enquiry={sent[row.user_id]}
              isGuest={isGuest}
              onAsk={() => setAsking(row)}
              onBook={() => setBooking(row)}
              rating={ratings[row.user_id]}
              myReview={myReviews[row.user_id]}
              canReview={!!reviewable[row.user_id]}
              onReview={() => setReviewing(row)}
            />
          ))}
        </div>
      </div>

      {reviewing && (
        <ReviewSheet
          instructor={reviewing}
          learnerId={user?.id}
          existing={myReviews[reviewing.user_id]}
          onClose={() => setReviewing(null)}
          onSaved={async () => { setReviewing(null); await refresh(); }}
        />
      )}

      {booking && (
        <BookSheet
          instructor={booking}
          onClose={() => setBooking(null)}
          onBooked={async () => { setBooking(null); await refresh(); }}
        />
      )}

      {asking && (
        <EnquirySheet
          instructor={asking}
          defaultName={displayName === "there" ? "" : displayName}
          learnerId={user?.id}
          onClose={() => setAsking(null)}
          onSent={async () => { setAsking(null); await refresh(); }}
        />
      )}
    </div>
  );
}

/* ------------------------------------------------------------------------- */

function Chip({ on, onClick, children }) {
  return (
    <button
      onClick={onClick}
      className={`shrink-0 inline-flex items-center gap-1.5 rounded-full px-3.5 py-2 text-xs font-bold whitespace-nowrap transition ${
        on
          ? "bg-emerald-500 text-slate-900"
          : "bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-700"
      }`}
    >
      {children}
    </button>
  );
}

function InstructorCard({ row, enquiry, isGuest, onAsk, onBook, rating, myReview, canReview, onReview }) {
  const rate = euro(row.hourly_rate_cents);
  const edt = euro(row.edt_rate_cents);

  return (
    <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="font-black text-slate-900 dark:text-white truncate">
            {row.full_name || "Instructor"}
          </h3>
          {row.business_name && (
            <p className="text-sm text-slate-500 dark:text-slate-400 truncate">{row.business_name}</p>
          )}
        </div>
        <span className="shrink-0 inline-flex items-center gap-1 rounded-full bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 px-2.5 py-1 text-[10px] font-black uppercase tracking-widest">
          <BadgeCheck size={12} /> Verified
        </span>
      </div>

      <Rating r={rating} />

      <dl className="mt-3 space-y-1.5 text-sm">
        <Row icon={MapPin} value={(row.counties || []).join(", ")} />
        <Row icon={Car} value={[
          (row.transmissions || []).join(" / "),
          (row.lesson_types || []).map(t => LESSON_LABELS[t] || t).join(", "),
        ].filter(Boolean).join(" · ")} />
      </dl>

      {(rate || edt) && (
        <p className="mt-2.5 text-sm font-bold text-slate-900 dark:text-white">
          {rate ? `${rate}/hour` : ""}{rate && edt ? " · " : ""}{edt ? `${edt} EDT` : ""}
        </p>
      )}

      {row.bio && (
        <p className="mt-2.5 text-sm text-slate-500 dark:text-slate-400 leading-relaxed">{row.bio}</p>
      )}

      {/* Booking is the primary action now that there are hours behind it.
          Asking stays, because an instructor with no availability set — or a
          learner who wants to talk first — still needs a way in. */}
      <div className="mt-4 space-y-2">
        {isGuest ? (
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Create a free account to book a lesson or get in touch.
          </p>
        ) : (
          <>
            <PrimaryButton onClick={onBook}>
              <span className="inline-flex items-center gap-2">
                <CalendarCheck size={15} /> Book a lesson
              </span>
            </PrimaryButton>

            {/* Only after a lesson they actually completed. */}
            {canReview && (
              <button
                onClick={onReview}
                className="w-full text-sm font-bold text-emerald-700 dark:text-emerald-400 hover:underline py-1"
              >
                {myReview ? "Update your review" : "Leave a review"}
              </button>
            )}

            {enquiry ? (
              <p className="flex items-center gap-2 text-sm font-semibold text-emerald-700 dark:text-emerald-400">
                <Check size={15} />
                {enquiry.status === "declined" ? "They couldn't take this on"
                  : enquiry.status === "answered" ? "They've been in touch"
                  : "Asked — they'll get back to you"}
              </p>
            ) : (
              <SecondaryButton onClick={onAsk}>
                <span className="inline-flex items-center gap-2">
                  <MessageSquare size={15} /> Ask about lessons
                </span>
              </SecondaryButton>
            )}
          </>
        )}
      </div>
    </div>
  );
}

/* The count is never left off. "4.9" and "4.9 from 3 reviews" say different
   things, and an instructor with two glowing reviews is not a 5.0 — so below
   the threshold the average is withheld and only the count is shown. */
function Rating({ r }) {
  const label = ratingLabel(r);
  if (!label.count) return null;

  return (
    <div className="mt-1.5 flex items-center gap-1.5">
      {label.average !== null && (
        <span className="inline-flex gap-0.5">
          {[1, 2, 3, 4, 5].map(n => (
            <Star
              key={n}
              size={13}
              className={n <= Math.round(label.average)
                ? "text-amber-400 fill-amber-400"
                : "text-slate-300 dark:text-slate-600"}
            />
          ))}
        </span>
      )}
      <span className="text-xs text-slate-500 dark:text-slate-400">{label.text}</span>
    </div>
  );
}

function Row({ icon: Icon, value }) {
  if (!value) return null;
  return (
    <div className="flex items-start gap-2">
      <Icon size={14} className="text-slate-400 shrink-0 mt-0.5" />
      <span className="text-slate-600 dark:text-slate-300">{value}</span>
    </div>
  );
}

/* ---------------------------------------------------------------------------
   THE ENQUIRY

   Asks for a phone number, because an instructor returning a call is how this
   actually works, and says plainly that it will be passed on. Nobody should
   discover afterwards that they handed their number to a stranger.
   --------------------------------------------------------------------------- */
function EnquirySheet({ instructor, defaultName, learnerId, onClose, onSent }) {
  const [name, setName] = useState(defaultName || "");
  const [phone, setPhone] = useState("");
  const [area, setArea] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState(null);

  async function submit() {
    if (!phone.trim()) { setProblem("A phone number, so they can ring you back."); return; }
    setBusy(true);
    setProblem(null);
    const result = await sendEnquiry({
      instructorId: instructor.user_id, learnerId, name, phone, area, message,
    });
    setBusy(false);
    if (!result.ok) { setProblem(result.error); return; }
    onSent();
  }

  return (
    <div className="fixed inset-0 z-40 bg-slate-900/70 backdrop-blur-sm flex items-end"
         onClick={onClose}>
      <div
        className="w-full max-h-[90vh] overflow-y-auto bg-white dark:bg-slate-800 rounded-t-3xl p-6"
        style={{ paddingBottom: "max(1.5rem, calc(env(safe-area-inset-bottom) + 1rem))" }}
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <h2 className="text-lg font-black tracking-tight text-slate-900 dark:text-white">
            Ask {instructor.full_name?.split(" ")[0] || "them"} about lessons
          </h2>
          <button onClick={onClose} aria-label="Close" className="shrink-0 text-slate-400 p-1">
            <X size={20} />
          </button>
        </div>

        <p className="mt-1.5 text-sm text-slate-500 dark:text-slate-400 leading-relaxed">
          This isn't a booking — no time is held and nothing is paid. Your name,
          phone number and message are sent to this instructor so they can get
          back to you.
        </p>

        <div className="mt-4 space-y-3">
          <Field label="Your name" value={name} onChange={setName} placeholder="Alex Smith" />
          <Field label="Phone" value={phone} onChange={setPhone} placeholder="087 123 4567"
                 type="tel" hint="They'll ring or text you on this." />
          <Field label="Where you are" value={area} onChange={setArea}
                 placeholder="Tallaght, D24" hint="Optional — helps them say yes or no quickly." />

          <div>
            <label className="block text-xs font-bold uppercase tracking-widest text-slate-500 dark:text-slate-400">
              Anything else
            </label>
            <textarea
              value={message}
              onChange={e => setMessage(e.target.value)}
              rows={3}
              placeholder="I've passed my theory and I'm starting EDT. Weekends suit best."
              className="mt-1.5 w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2.5 text-sm text-slate-900 dark:text-white"
            />
          </div>

          {problem && (
            <div className="flex items-start gap-2 text-sm bg-red-50 dark:bg-red-950/40 text-red-700 dark:text-red-300 rounded-xl px-3 py-2.5">
              <AlertCircle size={15} className="mt-0.5 shrink-0" />
              <span>{problem}</span>
            </div>
          )}
        </div>

        <div className="mt-5 space-y-2">
          <PrimaryButton onClick={submit} disabled={busy}>
            <span className="inline-flex items-center gap-2">
              {busy && <Loader2 size={15} className="animate-spin" />} Send
            </span>
          </PrimaryButton>
          <SecondaryButton onClick={onClose}>Not now</SecondaryButton>
        </div>
      </div>
    </div>
  );
}

function Field({ label, value, onChange, hint, ...rest }) {
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
      {hint && <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{hint}</p>}
    </div>
  );
}
