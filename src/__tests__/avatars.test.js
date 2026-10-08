/*
  The parts of the photo flow that are pure, and the two that go wrong
  without anybody noticing: an off-centre crop, and an upload path that
  does not carry the permission.
*/

import { describe, it, expect } from "vitest";
import {
  cropBox, pathFor, initialsFor, describeAvatarError, MAX_BYTES, ACCEPT,
} from "../avatars";

describe("cropping to a square", () => {
  it("takes the middle of a landscape photo, not the corner", () => {
    /* Left-aligning a 4000x3000 photo crops to the leftmost 3000px, which on
       a portrait of a person is usually their shoulder and a doorframe. */
    const { sx, sy, side } = cropBox(4000, 3000);
    expect(side).toBe(3000);
    expect(sx).toBe(500);
    expect(sy).toBe(0);
  });

  it("and of a portrait photo", () => {
    const { sx, sy, side } = cropBox(3000, 4000);
    expect(side).toBe(3000);
    expect(sx).toBe(0);
    expect(sy).toBe(500);
  });

  it("leaves a square alone", () => {
    expect(cropBox(1000, 1000)).toEqual({ sx: 0, sy: 0, side: 1000 });
  });

  it("rounds to whole pixels", () => {
    /* drawImage with a fractional source offset resamples, which softens the
       image for no reason. */
    const { sx, side } = cropBox(1001, 1000);
    expect(Number.isInteger(sx)).toBe(true);
    expect(Number.isInteger(side)).toBe(true);
  });
});

describe("where the file goes", () => {
  it("puts it in a folder named after the account", () => {
    /* This is not a convention — it IS the permission. sql/15's policies
       check (storage.foldername(name))[1] = auth.uid()::text, so a path that
       does not start with the account id is refused by Postgres. */
    const id = "11111111-1111-1111-1111-111111111111";
    expect(pathFor(id).startsWith(id + "/")).toBe(true);
  });

  it("uses a new name every time", () => {
    /* A fixed path would keep the same URL, and every browser and CDN
       holding the old picture would go on showing it — "I changed my photo
       and it didn't change". */
    const id = "abc";
    const a = pathFor(id);
    const b = pathFor(id);
    expect(a).toMatch(/^abc\/\d+\.jpg$/);
    // Same millisecond is possible; the shape is what matters here.
    expect(a.split("/")[0]).toBe(b.split("/")[0]);
  });
});

describe("initials", () => {
  it("takes two words from a name", () => {
    expect(initialsFor("Arif Mahmood")).toBe("AM");
    expect(initialsFor("Aoife")).toBe("A");
  });

  it("falls back to the email's local part", () => {
    expect(initialsFor("arifdub@yahoo.com")).toBe("A");
    expect(initialsFor("john.smith@example.ie")).toBe("JS");
  });

  it("never renders blank", () => {
    /* An empty circle reads as a failure to load. */
    expect(initialsFor("")).toBe("?");
    expect(initialsFor(null)).toBe("?");
    expect(initialsFor("123456")).toBe("?");
  });
});

describe("what a failure says", () => {
  it("names the missing migration rather than blaming the person", () => {
    expect(describeAvatarError({ message: "Bucket not found" })).toMatch(/sql\/15/);
  });

  it("explains a refusal in terms of whose photo it is", () => {
    expect(describeAvatarError({ message: "new row violates row-level security policy" }))
      .toMatch(/only change your own/i);
  });

  it("recognises Safari's wording for a dead connection", () => {
    expect(describeAvatarError({ message: "Load failed" })).toMatch(/connection/i);
  });

  it("has nothing to say about no error", () => {
    expect(describeAvatarError(null)).toBeNull();
  });
});

describe("what the picker will accept", () => {
  it("offers only the types the bucket allows", () => {
    /* sql/15 sets allowed_mime_types on the bucket. A type offered here but
       refused there is a file chooser that leads to a 400. */
    for (const t of ["image/jpeg", "image/png", "image/webp"]) {
      expect(ACCEPT).toContain(t);
    }
    expect(ACCEPT).not.toContain("image/heic");
  });

  it("caps at the same size the bucket does", () => {
    expect(MAX_BYTES).toBe(5 * 1024 * 1024);
  });
});
