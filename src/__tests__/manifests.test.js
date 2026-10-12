/*
  Each installed app must open on its own side.

  The learner app's icon used to open /app/, the old general entry, which
  forwards by the account's role — so a learner icon on the phone of an
  account that is also an instructor opened the instructor portal. Each
  manifest now names its own side directly.
*/

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const read = f => JSON.parse(readFileSync(new URL(`../../public/${f}`, import.meta.url), "utf8"));

describe("what each home-screen icon opens", () => {
  it("the learner icon opens the learner side, never the role-based /app entry", () => {
    const m = read("manifest.json");
    expect(m.start_url.startsWith("/student")).toBe(true);
  });

  it("the instructor icon opens the instructor portal", () => {
    expect(read("manifest-adi.json").start_url.startsWith("/adi")).toBe(true);
  });

  it.each(["manifest.json", "manifest-adi.json", "manifest-admin.json"])(
    "%s opens inside its own scope, or the phone ignores the start address",
    f => {
      const m = read(f);
      expect(m.start_url.startsWith(m.scope)).toBe(true);
    },
  );

  it("installed copies keep their identity, so phones update rather than duplicate", () => {
    expect(read("manifest.json").id).toBe("/app/");
    expect(read("manifest-adi.json").id).toBe("/adi");
  });
});
