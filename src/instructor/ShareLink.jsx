/*
  The instructor's own booking page, ready to send.

  passdrivingtest.ie/adi/<ADI number> lets their learners book an open hour
  with a name, an email and a phone number — no account. This card is where
  the instructor gets the address: copy it, or hand it to the phone's share
  sheet to send by WhatsApp or text.
*/

import React, { useState } from "react";
import { Link2, Copy, Check, Share2, ExternalLink } from "lucide-react";
import { pageLink } from "../bookingStore";

export default function ShareLink({ profile }) {
  const [copied, setCopied] = useState(false);
  const link = pageLink(profile?.adi_number);
  if (!link) return null;

  /* Unlisted, the page shows "no instructor found" — say so here rather
     than hand out a link that leads nowhere. */
  if (!profile?.listed) {
    return (
      <div className="mt-3 rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-4">
        <p className="font-bold text-sm text-slate-900 dark:text-white flex items-center gap-2">
          <Link2 size={16} className="text-blue-500" /> Your booking page
        </p>
        <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
          Turn your listing on and learners can book you at{" "}
          <span className="font-semibold break-all">{link.replace("https://", "")}</span>.
        </p>
      </div>
    );
  }

  const canShare = typeof navigator !== "undefined" && typeof navigator.share === "function";

  async function copy() {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* Clipboard refused (an old browser, or no permission). The address
         is on screen to copy by hand. */
    }
  }

  async function share() {
    try {
      await navigator.share({
        title: "Book a driving lesson",
        text: `Book a driving lesson with ${profile.full_name || "me"} — pick a time that suits you:`,
        url: link,
      });
    } catch {
      /* Cancelled. Nothing to do. */
    }
  }

  return (
    <div className="mt-3 rounded-2xl border border-blue-200 dark:border-blue-900 bg-blue-50 dark:bg-blue-950/40 p-4">
      <p className="font-bold text-sm text-slate-900 dark:text-white flex items-center gap-2">
        <Link2 size={16} className="text-blue-500" /> Your booking page
      </p>
      <p className="mt-1 text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
        Send this to your learners. They see your open times and book with a
        name, email and phone number. No account needed.
      </p>
      <p className="mt-2.5 rounded-xl bg-white dark:bg-slate-900 border border-blue-100 dark:border-blue-900 px-3 py-2 text-sm font-bold text-blue-700 dark:text-blue-300 break-all select-all">
        {link.replace("https://", "")}
      </p>
      <div className="mt-2.5 grid grid-cols-3 gap-2">
        <button onClick={copy}
          className="rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 py-2.5 text-xs font-bold text-slate-700 dark:text-slate-200 inline-flex items-center justify-center gap-1.5">
          {copied ? <Check size={14} className="text-emerald-500" /> : <Copy size={14} />}
          {copied ? "Copied" : "Copy"}
        </button>
        {canShare ? (
          <button onClick={share}
            className="rounded-xl bg-blue-600 py-2.5 text-xs font-bold text-white inline-flex items-center justify-center gap-1.5">
            <Share2 size={14} /> Share
          </button>
        ) : (
          <a href={`https://wa.me/?text=${encodeURIComponent(`Book a driving lesson with me: ${link}`)}`}
            target="_blank" rel="noopener noreferrer"
            className="rounded-xl bg-blue-600 py-2.5 text-xs font-bold text-white inline-flex items-center justify-center gap-1.5">
            <Share2 size={14} /> WhatsApp
          </a>
        )}
        <a href={link.replace("https://passdrivingtest.ie", "")} target="_blank" rel="noopener noreferrer"
          className="rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 py-2.5 text-xs font-bold text-slate-700 dark:text-slate-200 inline-flex items-center justify-center gap-1.5">
          <ExternalLink size={14} /> View
        </a>
      </div>
    </div>
  );
}
