/*
  ===========================================================================
  A MESSAGE THREAD ON ONE BOOKING

  Shared by both sides — the instructor's Messages screen and the learner's
  booking card open the same component, because there is nothing asymmetric
  about two people talking about a lesson.

  WHY THIS IS NOT A CHAT PRODUCT

  No typing indicators, no read receipts shown to the sender, no presence.
  It exists so "I'm outside" and "running ten minutes late" do not require
  handing a stranger a personal mobile number. Every feature beyond that is
  a feature to maintain and a way to be misread.

  It does not live-update either. Messages load when the thread opens and
  after you send one. A realtime subscription is a socket per open thread
  and a lot of ways to leak one, for a product where the two people involved
  are about to be in the same car.
  ===========================================================================
*/

import React, { useState, useEffect, useRef, useCallback } from "react";
import { Send, Loader2, AlertCircle, RefreshCw } from "lucide-react";
import { listMessages, sendMessage, markThreadRead } from "./socialStore";

export default function Thread({ bookingId, meId, closed, onSent }) {
  const [rows, setRows] = useState([]);
  const [text, setText] = useState("");
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState(null);
  const endRef = useRef(null);

  const refresh = useCallback(async (markRead = true) => {
    const { rows: r, error: e } = await listMessages(bookingId);
    setRows(r); setError(e); setLoading(false);
    if (markRead && r.length) await markThreadRead(bookingId);
  }, [bookingId]);

  useEffect(() => { refresh(); }, [refresh]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "nearest" });
  }, [rows.length]);

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm text-slate-500 dark:text-slate-400 py-6 justify-center">
        <Loader2 size={15} className="animate-spin" /> Loading…
      </div>
    );
  }

  return (
    <div>
      <div className="max-h-72 overflow-y-auto space-y-2 pr-0.5">
        {rows.length === 0 ? (
          <p className="text-sm text-slate-500 dark:text-slate-400 py-4 text-center leading-relaxed">
            Nothing yet. Use this for the small things — where you are, if
            you're running late.
          </p>
        ) : rows.map(m => {
          const mine = m.sender_id === meId;
          return (
            <div key={m.id} className={`flex ${mine ? "justify-end" : "justify-start"}`}>
              <div className={`max-w-[85%] rounded-2xl px-3.5 py-2 ${
                mine
                  ? "bg-emerald-500 text-slate-900 rounded-br-md"
                  : "bg-slate-100 dark:bg-slate-700 text-slate-800 dark:text-slate-100 rounded-bl-md"
              }`}>
                <p className="text-sm leading-relaxed whitespace-pre-wrap break-words">{m.body}</p>
                <p className={`mt-0.5 text-[10px] tabular-nums ${
                  mine ? "text-slate-900/60" : "text-slate-500 dark:text-slate-400"
                }`}>
                  {new Date(m.created_at).toLocaleTimeString("en-IE", {
                    hour: "2-digit", minute: "2-digit", hour12: false,
                  })}
                </p>
              </div>
            </div>
          );
        })}
        <div ref={endRef} />
      </div>

      {error && (
        <p className="mt-2 text-sm text-red-500 flex items-start gap-1.5">
          <AlertCircle size={15} className="shrink-0 mt-0.5" /> {error}
        </p>
      )}

      {closed ? (
        <p className="mt-3 text-xs text-slate-500 dark:text-slate-400 text-center">
          This lesson is over, so the thread is closed.
        </p>
      ) : (
        <form
          className="mt-3 flex gap-2"
          onSubmit={async (e) => {
            e.preventDefault();
            if (!text.trim() || sending) return;
            setSending(true); setError(null);
            const { ok, error: err } = await sendMessage(bookingId, meId, text);
            setSending(false);
            if (!ok) { setError(err); return; }
            setText("");
            await refresh(false);
            onSent?.();
          }}
        >
          <input
            value={text}
            onChange={e => setText(e.target.value)}
            maxLength={2000}
            placeholder="Message…"
            className="flex-1 min-w-0 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2.5 text-sm text-slate-900 dark:text-white"
          />
          <button
            type="submit"
            disabled={sending || !text.trim()}
            aria-label="Send"
            className="shrink-0 rounded-xl bg-emerald-500 hover:bg-emerald-400 disabled:opacity-40 text-slate-900 px-4 transition"
          >
            {sending ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
          </button>
        </form>
      )}

      {/* Said once, where someone might otherwise wait for a message that
          never arrives on screen. */}
      {!closed && (
        <button
          onClick={() => refresh()}
          className="mt-2 w-full inline-flex items-center justify-center gap-1.5 text-[11px] text-slate-400 hover:text-slate-600 dark:hover:text-slate-300"
        >
          <RefreshCw size={11} /> Check for replies
        </button>
      )}
    </div>
  );
}
