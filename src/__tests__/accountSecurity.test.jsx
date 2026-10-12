/*
  Changing the sign-in email or password needs the code from the email.
  The sequence runs against a stand-in for Supabase's auth object, so what
  is sent to Supabase, and in what order, is checked here.
*/

import React from "react";
import { renderToString } from "react-dom/server";
import { describe, it, expect, vi } from "vitest";
import {
  sendPasswordCode, changePassword, requestEmailChange, confirmEmailChange,
} from "../accountSecurity";

function fakeAuth({ email = "old@example.com", afterVerify = null, fail = {} } = {}) {
  let current = email;
  return {
    reauthenticate: vi.fn(async () => ({ error: fail.reauthenticate || null })),
    updateUser: vi.fn(async () => ({ error: fail.updateUser || null })),
    verifyOtp: vi.fn(async () => {
      if (fail.verifyOtp) return { error: fail.verifyOtp };
      if (afterVerify) current = afterVerify();
      return { error: null };
    }),
    getUser: vi.fn(async () => ({ data: { user: { email: current } } })),
  };
}

describe("changing the password", () => {
  it("emails a code to the current address", async () => {
    const auth = fakeAuth();
    expect(await sendPasswordCode(auth)).toEqual({ ok: true });
    expect(auth.reauthenticate).toHaveBeenCalledTimes(1);
  });

  it("saves the new password with the code as the nonce", async () => {
    const auth = fakeAuth();
    const r = await changePassword(auth, { password: "newpass1", confirm: "newpass1", code: " 123456 " });
    expect(r.ok).toBe(true);
    expect(auth.updateUser).toHaveBeenCalledWith({ password: "newpass1", nonce: "123456" });
  });

  it("does not call Supabase without a code, or when the passwords differ or are short", async () => {
    const auth = fakeAuth();
    expect((await changePassword(auth, { password: "newpass1", confirm: "newpass1", code: "" })).ok).toBe(false);
    expect((await changePassword(auth, { password: "newpass1", confirm: "newpass2", code: "123456" })).error)
      .toMatch(/don't match/);
    expect((await changePassword(auth, { password: "abc", confirm: "abc", code: "123456" })).error)
      .toMatch(/6 characters/);
    expect(auth.updateUser).not.toHaveBeenCalled();
  });

  it("says plainly when the code is wrong", async () => {
    const auth = fakeAuth({ fail: { updateUser: { message: "Invalid nonce" } } });
    const r = await changePassword(auth, { password: "newpass1", confirm: "newpass1", code: "000000" });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/wrong or has expired/);
  });

  it("says to sign in again when the session has gone", async () => {
    const auth = fakeAuth({ fail: { reauthenticate: { message: "Auth session missing!" } } });
    expect((await sendPasswordCode(auth)).error).toMatch(/signed out/);
  });
});

describe("changing the email", () => {
  it("asks Supabase to send a code to the new address", async () => {
    const auth = fakeAuth();
    const r = await requestEmailChange(auth, { newEmail: " New@Example.com ", currentEmail: "old@example.com" });
    expect(r).toEqual({ ok: true, newEmail: "new@example.com" });
    expect(auth.updateUser).toHaveBeenCalledWith({ email: "new@example.com" });
  });

  it("refuses a bad address or the same one, without calling Supabase", async () => {
    const auth = fakeAuth();
    expect((await requestEmailChange(auth, { newEmail: "nope", currentEmail: "old@example.com" })).ok).toBe(false);
    expect((await requestEmailChange(auth, { newEmail: "OLD@example.com", currentEmail: "old@example.com" })).error)
      .toMatch(/already your email/);
    expect(auth.updateUser).not.toHaveBeenCalled();
  });

  it("says when the address belongs to another account", async () => {
    const auth = fakeAuth({ fail: { updateUser: { message: "A user with this email address has already been registered" } } });
    expect((await requestEmailChange(auth, { newEmail: "taken@example.com", currentEmail: "old@example.com" })).error)
      .toMatch(/another account/);
  });

  it("is done after one code when Supabase only needs the new address's", async () => {
    const auth = fakeAuth({ afterVerify: () => "new@example.com" });
    const r = await confirmEmailChange(auth, {
      newEmail: "new@example.com", currentEmail: "old@example.com", codeNew: "123456", codeCurrent: "",
    });
    expect(r).toEqual({ ok: true });
    expect(auth.verifyOtp).toHaveBeenCalledWith({ email: "new@example.com", token: "123456", type: "email_change" });
  });

  it("asks for the current address's code too when one code is not enough", async () => {
    let verified = 0;
    const auth = fakeAuth({ afterVerify: () => (++verified >= 2 ? "new@example.com" : "old@example.com") });
    const first = await confirmEmailChange(auth, {
      newEmail: "new@example.com", currentEmail: "old@example.com", codeNew: "111111", codeCurrent: "",
    });
    expect(first.ok).toBe(false);
    expect(first.pending).toBe(true);
    expect(first.error).toMatch(/old@example.com/);

    const second = await confirmEmailChange(auth, {
      newEmail: "new@example.com", currentEmail: "old@example.com", codeNew: "", codeCurrent: "222222",
    });
    expect(second).toEqual({ ok: true });
    expect(auth.verifyOtp).toHaveBeenLastCalledWith({ email: "old@example.com", token: "222222", type: "email_change" });
  });

  it("stops at a wrong code", async () => {
    const auth = fakeAuth({ fail: { verifyOtp: { message: "Token has expired or is invalid" } } });
    const r = await confirmEmailChange(auth, {
      newEmail: "new@example.com", currentEmail: "old@example.com", codeNew: "999999", codeCurrent: "",
    });
    expect(r.error).toMatch(/wrong or has expired/);
    expect(auth.getUser).not.toHaveBeenCalled();
  });
});

describe("the card", () => {
  it("offers both changes to a signed-in user, and nothing to a signed-out one", async () => {
    vi.resetModules();
    vi.doMock("../supabaseClient", () => ({ supabase: { auth: {} }, HAS_SUPABASE: true }));
    vi.doMock("../appAuth", () => ({ useAuth: () => ({ user: { email: "me@example.com" } }) }));
    let { default: AccountSecurity } = await import("../AccountSecurity");
    const html = renderToString(<AccountSecurity />);
    expect(html).toContain("Change password");
    expect(html).toContain("Change email");
    expect(html).toContain("me@example.com");

    vi.resetModules();
    vi.doMock("../appAuth", () => ({ useAuth: () => ({ user: null }) }));
    ({ default: AccountSecurity } = await import("../AccountSecurity"));
    expect(renderToString(<AccountSecurity />)).toBe("");
    vi.doUnmock("../appAuth");
    vi.doUnmock("../supabaseClient");
  });
});
