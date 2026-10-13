/*
  Everything a learner might have a conversation about, in one read:
  their live bookings (each has a thread, sql/13) and the conversations
  instructors started about their lesson requests (sql/32).

  Used by the Messages tab, the Home dashboard and the tab-bar badge, so
  the three always agree on the unread number.
*/

import { myBookings, isPast } from "../bookingStore";
import { unreadByBooking } from "../socialStore";
import { myThreads, unreadTotal } from "../lessonRequests";

export async function loadInbox(userId) {
  if (!userId) return { bookings: [], threads: [], unreadBookings: {}, unread: 0, error: null };
  const [{ rows: bookings, error }, unreadBookings, { rows: threads }] = await Promise.all([
    myBookings(userId), unreadByBooking(userId), myThreads(),
  ]);
  const live = (bookings || []).filter(b => ["requested", "accepted"].includes(b.status));
  const bookingUnread = live.reduce((n, b) => n + (unreadBookings?.[b.id] || 0), 0);
  return {
    bookings: bookings || [],
    liveBookings: live,
    upcoming: live.filter(b => !isPast(b)).sort((a, b) => new Date(a.starts_at) - new Date(b.starts_at)),
    threads: threads || [],
    unreadBookings: unreadBookings || {},
    unread: bookingUnread + unreadTotal(threads),
    error,
  };
}
