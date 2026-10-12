/*
  Password reset by a code typed into the app. The old emailed link went to
  /#reset, which nothing handled, so it opened the home page and did nothing.
*/

import React from "react";
import { renderToString } from "react-dom/server";
import { describe, it, expect, vi } from "vitest";

import { runResetWithCode } from "../appAuth";

function fakeAuth({ codeOk = true, passwordErrors = [] } = {}) {
  const errors = [...passwordErrors];
  return {
    verifyOtp: vi.fn(async () => (codeOk
      ? { data: {}, error: null }
      : { data: {}, error: { message: "Token has expired or is invalid" } })),
    updateUser: vi.fn(async ({ password }) => {
      const e = errors.shift();
      return e
        ? { data: null, error: { message: e } }
        : { data: { user: { id: "u1", email: "a@b.ie", password } }, error: null };
    }),
  };
}

const refs = () => ({ holdSession: { current: false }, verifiedFor: { current: null } });

describe("resetting with a code", () => {
  it("refuses a wrong code and never touches the password", async () => {
    const auth = fakeAuth({ codeOk: false });
    const r = refs();
    const out = await runResetWithCode({ auth, ...r, email: "A@B.ie", code: "111111", password: "newpass1" });
    expect(out.ok).toBe(false);
    expect(out.error).toMatch(/wrong or has expired/);
    expect(auth.updateUser).not.toHaveBeenCalled();
    /* Ordinary sign-in must work again straight away. */
    expect(r.holdSession.current).toBe(false);
  });

  it("checks the code as a recovery code, then saves the new password", async () => {
    const auth = fakeAuth();
    const r = refs();
    const out = await runResetWithCode({ auth, ...r, email: " A@B.ie ", code: " 123456 ", password: "newpass1" });
    expect(auth.verifyOtp).toHaveBeenCalledWith({ email: "a@b.ie", token: "123456", type: "recovery" });
    expect(auth.updateUser).toHaveBeenCalledWith({ password: "newpass1" });
    expect(out.ok).toBe(true);
    expect(out.user.id).toBe("u1");
    expect(r.holdSession.current).toBe(false);
    expect(r.verifiedFor.current).toBe(null);
  });

  it("keeps the person out of the app while the new password is unsaved", async () => {
    /* The code signs them in. If the password is then rejected, letting
       that session through would leave them inside with the old password. */
    const auth = fakeAuth({ passwordErrors: ["New password should be different from the old password."] });
    const r = refs();
    const out = await runResetWithCode({ auth, ...r, email: "a@b.ie", code: "123456", password: "oldpass" });
    expect(out.ok).toBe(false);
    expect(out.codeAccepted).toBe(true);
    expect(out.error).toMatch(/different from the old/);
    expect(r.holdSession.current).toBe(true);
  });

  it("retries a rejected password without asking for the single-use code again", async () => {
    const auth = fakeAuth({ passwordErrors: ["Password should be at least 6 characters."] });
    const r = refs();
    await runResetWithCode({ auth, ...r, email: "a@b.ie", code: "123456", password: "abc" });
    const out = await runResetWithCode({ auth, ...r, email: "a@b.ie", code: "", password: "longer-one" });
    expect(auth.verifyOtp).toHaveBeenCalledTimes(1);
    expect(auth.updateUser).toHaveBeenCalledTimes(2);
    expect(out.ok).toBe(true);
    expect(r.holdSession.current).toBe(false);
  });
});

describe("the reset screen", () => {
  it("asks for the email first and offers to send a code, not a link", async () => {
    vi.resetModules();
    vi.doMock("../appAuth", () => ({
      useAuth: () => ({ resetPassword: vi.fn(), resetWithCode: vi.fn(), cancelReset: vi.fn() }),
    }));
    const { ResetPassword } = await import("../AuthScreen");
    const html = renderToString(<ResetPassword initialEmail="arif@example.com" onBack={() => {}} />);
    expect(html).toContain("Reset your password");
    expect(html).toContain("Email me a code");
    expect(html).toContain('value="arif@example.com"');
    expect(html).not.toContain("Code from the email");
    vi.doUnmock("../appAuth");
  });
});
