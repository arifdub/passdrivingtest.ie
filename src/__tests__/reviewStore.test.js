/*
  The decisions an admin makes about an instructor, as data.

  These assert the patch sent to the database, not the database's answer. The
  database has its own rules — sql/06 — and they are the ones that hold; what
  is worth pinning here is that approving lists someone, that every refusal
  carries the reason they will read, and that this file never sets verified_at
  itself.
*/
import { describe, it, expect, vi, beforeEach } from "vitest";

/* One captured call per test. */
const sent = { table: null, patch: null, column: null, value: null };

vi.mock("../supabaseClient", () => ({
  HAS_SUPABASE: true,
  supabase: {
    from(table) {
      sent.table = table;
      return {
        update(patch) {
          sent.patch = patch;
          return {
            eq(column, value) {
              sent.column = column;
              sent.value = value;
              return Promise.resolve({ error: null });
            },
          };
        },
      };
    },
  },
}));

const { approve, reject, suspend, returnToQueue, euro, waitingFor, when } =
  await import("../admin/reviewStore");

beforeEach(() => {
  sent.table = sent.patch = sent.column = sent.value = null;
});

describe("decisions", () => {
  it("writes to instructor_profiles, keyed by the instructor's user id", async () => {
    await approve("user-1");
    expect(sent.table).toBe("instructor_profiles");
    expect(sent.column).toBe("user_id");
    expect(sent.value).toBe("user-1");
  });

  it("approving lists them", async () => {
    await approve("user-1");
    expect(sent.patch.verification_status).toBe("verified");
    expect(sent.patch.listed).toBe(true);
  });

  it("never sets verified_at — the trigger owns it", async () => {
    await approve("user-1");
    expect(sent.patch).not.toHaveProperty("verified_at");
  });

  it("rejecting carries the reason and un-lists them", async () => {
    await reject("user-1", "  Not on the register.  ");
    expect(sent.patch.verification_status).toBe("rejected");
    expect(sent.patch.verification_notes).toBe("Not on the register.");
    expect(sent.patch.listed).toBe(false);
  });

  it("suspending carries the reason and un-lists them", async () => {
    await suspend("user-1", "Complaint upheld.");
    expect(sent.patch.verification_status).toBe("suspended");
    expect(sent.patch.verification_notes).toBe("Complaint upheld.");
    expect(sent.patch.listed).toBe(false);
  });

  it("sending one back to the queue does not leave them listed", async () => {
    await returnToQueue("user-1");
    expect(sent.patch.verification_status).toBe("pending");
    expect(sent.patch.listed).toBe(false);
  });

  it("approving with no note clears a previous one rather than keeping it", async () => {
    await approve("user-1");
    expect(sent.patch.verification_notes).toBeNull();
  });
});

describe("formatting", () => {
  it("shows money in euro from the cents it is stored as", () => {
    expect(euro(5500)).toBe("€55.00");
    expect(euro(5)).toBe("€0.05");
  });

  it("tells a zero rate apart from no rate", () => {
    expect(euro(0)).toBe("€0.00");
    expect(euro(null)).toBeNull();
    expect(euro("")).toBeNull();
  });

  it("counts how long something has been waiting", () => {
    const days = n => new Date(Date.now() - n * 86400000).toISOString();
    expect(waitingFor(days(0))).toBe("today");
    expect(waitingFor(days(1))).toBe("1 day");
    expect(waitingFor(days(9))).toBe("9 days");
    expect(waitingFor(null)).toBeNull();
  });

  it("does not invent a date from a broken one", () => {
    expect(when("not a date")).toBeNull();
    expect(when(null)).toBeNull();
  });
});
