/*
  HELP — how the instructor portal works.

  Everything that explains rather than does lives here, reached from the
  account menu, so the dashboard can be the work itself: lessons, requests,
  numbers. One topic open at a time, each a few lines.
*/

import React, { useState } from "react";
import {
  ChevronDown, Link2, CalendarCheck, Clock, Users, Banknote, BellRing,
  Smartphone, MessageSquare, ShieldCheck,
} from "lucide-react";

export const TOPICS = [
  {
    id: "page", icon: Link2, title: "Your booking page",
    body: [
      "Your page is passdrivingtest.ie/adi/ followed by your ADI number. Copy or share it from the card at the bottom of your dashboard.",
      "Learners see your open times and book with a name, email and phone number. They don't need an account.",
      "Their request lands in Bookings with their phone and email. Accept it and they are saved to your Students and the lesson goes in your Calendar.",
    ],
  },
  {
    id: "bookings", icon: CalendarCheck, title: "Booking requests",
    body: [
      "A request holds that hour for the learner until you accept or decline it, so answer it as soon as you can.",
      "Accept puts the lesson in your Calendar and emails the learner a confirmation. Decline frees the hour and tells them, with your reason if you give one.",
      "You can answer up to three requests straight from the dashboard. The rest are under Bookings.",
    ],
  },
  {
    id: "hours", icon: Clock, title: "Setting your hours",
    body: [
      "Your week repeats every week. Tap the clock on a day to switch hours on and off one at a time.",
      "Specific dates are for one date only: they replace that day's usual hours on that date and nowhere else.",
      "Time off blocks whole days. Booking terms set the lesson length, notice needed, how far ahead learners can book and travel time between lessons.",
      "Learners are offered start times one lesson length apart. A 60-minute lesson gives 9:00, 10:00, 11:00.",
    ],
  },
  {
    id: "students", icon: Users, title: "Students and lessons",
    body: [
      "Add your own students under Students. They don't need an account.",
      "Lessons you add in the Calendar block that time, so learners can't book it.",
    ],
  },
  {
    id: "money", icon: Banknote, title: "Payments",
    body: [
      "Learners pay you directly. No card is taken on this site and the platform takes nothing, from your own students or from the ones the directory sends you.",
      "If that ever changes you will be told first, in advance, and it will not apply to anything already booked.",
    ],
  },
  {
    id: "notify", icon: BellRing, title: "Notifications",
    body: [
      "A booking, message or enquiry reaches you by push notification and email, even with the app closed.",
      "If a phone has gone quiet, check notifications are switched on for it under the bell menu or in your account.",
    ],
  },
  {
    id: "messages", icon: MessageSquare, title: "Messages",
    body: [
      "Every booking from a learner with an account gets a thread, open until the lesson is over.",
      "Learners who booked from your page without an account have no thread. Call or email them using the details on the booking.",
    ],
  },
  {
    id: "install", icon: Smartphone, title: "Install the app",
    body: [
      "Open passdrivingtest.ie/adi in your phone's browser.",
      "iPhone: tap Share, then Add to Home Screen. Android: tap the ⋮ menu, then Install app or Add to Home screen.",
      "It then opens full screen from its own ADI icon, and notifications can reach it.",
    ],
  },
  {
    id: "verify", icon: ShieldCheck, title: "Verification and your listing",
    body: [
      "Your ADI number is checked against the RSA register by a person before learners can find or book you.",
      "Your listing, under Marketplace, decides whether you appear in the directory and whether your booking page takes bookings.",
    ],
  },
];

export default function Help() {
  const [open, setOpen] = useState(TOPICS[0].id);
  return (
    <div className="space-y-2">
      {TOPICS.map(({ id, icon: Icon, title, body }) => {
        const isOpen = open === id;
        return (
          <div key={id}
               className="rounded-2xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 overflow-hidden">
            <button
              onClick={() => setOpen(isOpen ? null : id)}
              aria-expanded={isOpen}
              className="w-full text-left px-4 py-3.5 flex items-center gap-3"
            >
              <Icon size={18} className="text-blue-500 shrink-0" />
              <span className="flex-1 text-sm font-bold text-slate-900 dark:text-white">{title}</span>
              <ChevronDown size={16}
                className={`text-slate-400 shrink-0 transition-transform ${isOpen ? "rotate-180" : ""}`} />
            </button>
            {isOpen && (
              <div className="px-4 pb-4 -mt-1 space-y-2">
                {body.map((p, i) => (
                  <p key={i} className="text-sm text-slate-600 dark:text-slate-300 leading-relaxed">{p}</p>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
