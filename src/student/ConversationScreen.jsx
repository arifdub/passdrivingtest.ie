/*
  One conversation, full screen — a booking thread or a lesson-request one.
  The thread itself is Thread.jsx either way; a request conversation passes
  its own storage (sql/32) and adds a way to book that instructor.
*/

import React, { useMemo } from "react";
import { CalendarPlus } from "lucide-react";
import { useAuth } from "../appAuth";
import { ScreenHeader, Screen } from "../ui";
import Thread from "../Thread";
import { threadMessages, sendRequestMessage, markRequestThreadRead } from "../lessonRequests";

export function requestSource(requestId, instructorId) {
  return {
    list: () => threadMessages(requestId, instructorId),
    send: (text) => sendRequestMessage(requestId, instructorId, text),
    markRead: () => markRequestThreadRead(requestId, instructorId),
  };
}

export default function ConversationScreen({ view, back, onRead }) {
  const { user } = useAuth();
  const isRequest = view.kind === "request";
  const source = useMemo(
    () => (isRequest ? requestSource(view.requestId, view.instructorId) : null),
    [isRequest, view.requestId, view.instructorId],
  );
  const adi = String(view.adi || "").replace(/\D/g, "");

  return (
    <>
      <ScreenHeader compact onBack={back} title={view.title || "Conversation"}
        subtitle={view.subtitle || (isRequest ? "About your lesson request" : undefined)} />
      <Screen>
        {isRequest && adi && (
          <a href={`/adi/${adi}`}
            className="mb-4 flex items-center gap-3 rounded-2xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-900 p-3.5">
            <CalendarPlus size={18} className="shrink-0 text-emerald-600 dark:text-emerald-400" />
            <span className="flex-1 text-sm">
              <span className="block font-bold text-slate-900 dark:text-white">See their times and book</span>
              <span className="block text-slate-600 dark:text-slate-300">Opens {view.title}'s booking page</span>
            </span>
          </a>
        )}
        <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl p-4">
          <Thread
            bookingId={view.bookingId}
            meId={user?.id}
            source={source}
            onRead={onRead}
            closed={isRequest && view.open === false}
            closedText="This request is closed, so the conversation is too."
            emptyText={isRequest ? "No messages yet." : undefined}
          />
        </div>
      </Screen>
    </>
  );
}
