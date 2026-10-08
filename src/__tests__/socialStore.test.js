/*
  Two judgement calls are encoded here and both are easy to get wrong in a
  way nobody notices: when an average is honest enough to show, and what a
  notification badge counts.
*/

import { describe, it, expect } from "vitest";
import {
  ratingLabel, waitingTotal, describeSocialError, MIN_REVIEWS_TO_SHOW_RATING,
} from "../socialStore";

describe("what a rating is allowed to claim", () => {
  it("shows no average at all below the threshold", () => {
    /* A single five-star review is one person's opinion. Rendering it as
       "5.0" makes it look like a measurement of something. */
    const one = ratingLabel({ review_count: 1, average_rating: 5 });
    expect(one.average).toBeNull();
    expect(one.text).toBe("1 review");
    expect(one.text).not.toContain("5");

    const two = ratingLabel({ review_count: 2, average_rating: 4.5 });
    expect(two.average).toBeNull();
    expect(two.text).toBe("2 reviews");
  });

  it("shows it at the threshold, with the count beside it", () => {
    const r = ratingLabel({ review_count: MIN_REVIEWS_TO_SHOW_RATING, average_rating: 4.67 });
    expect(r.average).toBeCloseTo(4.67);
    /* Never the average alone: "4.7" and "4.7 from 3 reviews" say different
       things and only the second is true. */
    expect(r.text).toContain("4.7");
    expect(r.text).toContain("3 reviews");
  });

  it("says so plainly when there are none", () => {
    const r = ratingLabel({ review_count: 0, average_rating: null });
    expect(r.count).toBe(0);
    expect(r.average).toBeNull();
    expect(r.text).toBe("No reviews yet");
  });

  it("treats a missing row as no reviews, not as an error", () => {
    /* instructor_ratings only covers listed instructors, so an unlisted one
       simply has no row. */
    expect(ratingLabel(undefined).text).toBe("No reviews yet");
    expect(ratingLabel(null).average).toBeNull();
  });
});

describe("the badge", () => {
  const counts = {
    bookingRequests: 2, newEnquiries: 1, unreadMessages: 3, lessonsToday: 4,
  };

  it("counts only what is waiting on an answer", () => {
    /* Lessons today are shown in the panel but deliberately excluded: a
       lesson is not a thing to reply to, and including it would mean the
       badge never clears on a working day. */
    expect(waitingTotal(counts)).toBe(6);
  });

  it("is zero, not broken, when nothing is waiting", () => {
    expect(waitingTotal({ bookingRequests: 0, newEnquiries: 0, unreadMessages: 0, lessonsToday: 9 })).toBe(0);
    expect(waitingTotal(null)).toBe(0);
  });
});

describe("what a refusal says", () => {
  it("names the missing migration rather than blaming the person", () => {
    expect(describeSocialError({ code: "42P01", message: "relation does not exist" }))
      .toMatch(/sql\/13/);
    expect(describeSocialError({ code: "PGRST205", message: "not found" }))
      .toMatch(/sql\/13/);
  });

  it("passes the trigger's own sentence through", () => {
    /* sql/13 raises these to be read as they are. */
    const msg = "you can review an instructor after a lesson with them";
    expect(describeSocialError({ message: msg, code: "42501" })).toBe(msg);
  });

  it("recognises a dead connection in Safari's words", () => {
    expect(describeSocialError({ message: "Load failed" })).toMatch(/connection/i);
  });

  it("has nothing to say about no error", () => {
    expect(describeSocialError(null)).toBeNull();
  });
});
