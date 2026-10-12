/*
  One booking, as a card.

  Lifted out of Bookings.jsx when the dashboard started showing incoming
  requests too. It lives in its own file rather than being exported from
  Bookings so that the list of requests can import it without importing
  the screen that contains that list — which would be a cycle, and ESM
  resolves those by handing one side a half-initialised module.
*/

import React from "react";
import {
  MapPin, Phone, Mail, Link2, Car, Gauge, Clock, Euro, MessageSquare, User as UserIcon,
} from "lucide-react";
import {
  slotTime, slotDay, isPast, BOOKING_STATUS, carLabel, levelLabel, bookingPerson,
} from "../bookingStore";
import { KIND_LABEL, euro } from "./teachingStore";

const TONE = {
  amber: "bg-amber-50 dark:bg-amber-950/50 text-amber-700 dark:text-amber-300",
  green: "bg-emerald-50 dark:bg-emerald-950/50 text-emerald-700 dark:text-emerald-300",
  slate: "bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300",
};

/* "2 hours ago", for when the request came in. */
export function ago(iso, now = Date.now()) {
  if (!iso) return null;
  const mins = Math.max(0, Math.round((now - new Date(iso).getTime()) / 60000));
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const h = Math.round(mins / 60);
  if (h < 24) return `${h} hour${h === 1 ? "" : "s"} ago`;
  const d = Math.round(h / 24);
  return `${d} day${d === 1 ? "" : "s"} ago`;
}

export function Card({ booking: b, muted, children }) {
  const at = new Date(b.starts_at);
  const end = new Date(at.getTime() + (b.duration_minutes || 60) * 60000);
  /* A request whose hour has passed unanswered is not still waiting, whatever
     the column says — nobody is going to drive to it now. */
  const stale = b.status === "requested" && isPast(b);
  const s = stale
    ? { label: "Missed", tone: "slate" }
    : BOOKING_STATUS[b.status] || { label: b.status, tone: "slate" };

  /* Who is asking. A guest typed their details on the instructor's page
     (sql/29); a learner with an account is looked up by booking_learners
     (sql/31) and arrives as `b.who`. */
  const person = bookingPerson(b);
  const name = b.who?.name || person.name;
  const email = person.email || b.who?.email || null;
  const phone = person.phone;
  const known = b.who
    ? (b.who.is_student
        ? `Your student${b.who.lessons_had ? ` · ${b.who.lessons_had} lesson${b.who.lessons_had === 1 ? "" : "s"} so far` : ""}`
        : "New learner")
    : null;

  const details = [
    [Clock, "Lesson", `${KIND_LABEL[b.kind] || b.kind || "Lesson"} · ${b.duration_minutes || 60} min`],
    b.price_cents ? [Euro, "Price", euro(b.price_cents)] : null,
    levelLabel(b.level) ? [Gauge, "Level", levelLabel(b.level)] : null,
    carLabel(b) ? [Car, "Car", carLabel(b)] : null,
    b.pickup ? [MapPin, "Pick-up", b.pickup] : null,
    b.note ? [MessageSquare, "Note", `“${b.note}”`] : null,
  ].filter(Boolean);

  return (
    <div className={`bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl p-4 ${muted ? "opacity-75" : ""}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-bold text-slate-900 dark:text-white tabular-nums">
            {slotDay(at)}, {slotTime(at)}–{slotTime(end)}
          </p>
          {b.created_at && b.status === "requested" && !stale && (
            <p className="text-xs text-slate-500 dark:text-slate-400">Requested {ago(b.created_at)}</p>
          )}
        </div>
        <span className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-bold ${TONE[s.tone]}`}>
          {s.label}
        </span>
      </div>

      {(name || email || phone) && (
        <div className="mt-3 rounded-xl bg-slate-50 dark:bg-slate-900/40 p-3">
          <div className="flex items-center gap-2 min-w-0">
            <UserIcon size={15} className="shrink-0 text-slate-400" />
            <p className="text-sm font-bold text-slate-900 dark:text-white truncate">{name || "Learner"}</p>
            {known && (
              <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-bold ${
                b.who.is_student ? TONE.green : "bg-blue-50 dark:bg-blue-950/50 text-blue-700 dark:text-blue-300"}`}>
                {known}
              </span>
            )}
          </div>
          {(phone || email) && (
            <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-sm">
              {phone && (
                <a href={`tel:${phone.replace(/[^\d+]/g, "")}`}
                   className="inline-flex items-center gap-1.5 font-semibold text-emerald-600 dark:text-emerald-400">
                  <Phone size={13} /> {phone}
                </a>
              )}
              {email && (
                <a href={`mailto:${email}`}
                   className="inline-flex items-center gap-1.5 font-semibold text-emerald-600 dark:text-emerald-400 break-all">
                  <Mail size={13} /> {email}
                </a>
              )}
            </div>
          )}
          {/* Booked from the instructor's own page with no account (sql/29).
              The only way to reach them is what they typed. */}
          {person.guest && (
            <p className="mt-1.5 text-xs text-slate-500 dark:text-slate-400 inline-flex items-center gap-1">
              <Link2 size={12} /> Booked from your page, no account
              {b.status === "requested" ? " · accepting saves them to your students" : ""}
            </p>
          )}
        </div>
      )}

      <dl className="mt-3 space-y-1.5">
        {details.map(([Icon, label, value]) => (
          <div key={label} className="flex items-start gap-2 text-sm">
            <Icon size={14} className="shrink-0 mt-0.5 text-slate-400" />
            <dt className="w-16 shrink-0 text-slate-500 dark:text-slate-400">{label}</dt>
            <dd className="min-w-0 flex-1 font-semibold text-slate-800 dark:text-slate-100 break-words">{value}</dd>
          </div>
        ))}
      </dl>

      {b.resolution_note && (
        <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
          Reason given: {b.resolution_note}
        </p>
      )}

      {children}
    </div>
  );
}

/* Default, because both callers import it as the one thing this file is. */
export default Card;
