/*
  WHAT AN IRISH ADI NUMBER ACTUALLY LOOKS LIKE

  This file exists because the app used to be sure it was an F followed by
  five digits. It isn't. The RSA's public register prints "ADI NUMBER | 40953"
  — digits, no letter — and the rule turned away the first real instructor who
  typed their own number, at step 2 of 6, with the number in front of them.

  Validation here is only meant to catch a slip of the hand. A person checks
  the number against the register, and that is the check that decides
  anything; being clever about the format can only subtract.
*/
import { describe, it, expect } from "vitest";
import { validate, normaliseAdi, EMPTY_PROFILE } from "../instructor/instructorStore";

const withAdi = adi => ({
  ...EMPTY_PROFILE,
  full_name: "A Name",
  phone: "087 123 4567",
  adi_number: adi,
  transmissions: ["manual"],
  lesson_types: ["edt"],
  counties: ["Dublin"],
  hourly_rate_cents: 5500,
});

const errorFor = adi => validate(withAdi(adi)).adi_number;

describe("the number from the register", () => {
  it("accepts a real one", () => {
    expect(errorFor("40953")).toBeUndefined();
  });

  it("accepts the lengths either side of it", () => {
    for (const n of ["123", "1234", "123456", "12345678"])
      expect(errorFor(n)).toBeUndefined();
  });

  it("no longer demands the F it used to invent", () => {
    expect(errorFor("40953")).toBeUndefined();
  });

  it("still tolerates an F from anyone taught to type one", () => {
    expect(errorFor("F40953")).toBeUndefined();
    expect(errorFor("f40953")).toBeUndefined();
  });

  it("ignores spaces", () => {
    expect(errorFor(" 40 953 ")).toBeUndefined();
  });
});

describe("what is still an error", () => {
  it("nothing at all", () => {
    expect(errorFor("")).toBe("Required");
    expect(errorFor("   ")).toBe("Required");
  });

  it("letters in the middle, or words", () => {
    expect(errorFor("not-a-number")).toBeTruthy();
    expect(errorFor("409A3")).toBeTruthy();
  });

  it("far too short or far too long to be a typo", () => {
    expect(errorFor("4")).toBeTruthy();
    expect(errorFor("1234567890123")).toBeTruthy();
  });
});

describe("what gets stored", () => {
  it("is the digits, so it matches what a reviewer reads off the register", () => {
    expect(normaliseAdi("F40953")).toBe("40953");
    expect(normaliseAdi(" 40 953 ")).toBe("40953");
    expect(normaliseAdi("40953")).toBe("40953");
  });

  it("survives nothing being entered", () => {
    expect(normaliseAdi("")).toBe("");
    expect(normaliseAdi(null)).toBe("");
    expect(normaliseAdi(undefined)).toBe("");
  });
});
