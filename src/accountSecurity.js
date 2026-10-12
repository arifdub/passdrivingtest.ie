/*
  Changing the sign-in email or password, confirmed by a code sent by email.

  PASSWORD
    1. reauthenticate() emails a 6-digit code to the CURRENT address
       (Supabase "Reauthentication" template, {{ .Token }}).
    2. updateUser({ password, nonce: code }) saves the new password only if
       the code is right. Supabase enforces the code when "Secure password
       change" is on under Authentication → Providers → Email.

  EMAIL
    1. updateUser({ email: newEmail }) emails a code to the NEW address —
       and, with "Secure email change" on, a second code to the current
       one (Supabase "Change email address" template, {{ .Token }}).
    2. verifyOtp({ email, token, type: "email_change" }) for each code.
       The change takes effect once every required code is in.

  Each function takes Supabase's `auth` object so the sequence can be tested
  against a stand-in.
*/

const WRONG_CODE = "That code is wrong or has expired. Use the code in the newest email, or send a new one.";

function say(err, fallback) {
  const raw = err?.message || fallback || "Something went wrong.";
  if (/nonce|otp|token|expired|invalid.*code|reauthentication/i.test(raw)) return WRONG_CODE;
  if (/already (been )?registered|already exists|email_exists/i.test(raw)) {
    return "That email address is already used by another account.";
  }
  if (/session missing|not authenticated|jwt expired/i.test(raw)) {
    return "You've been signed out. Sign in again, then try once more.";
  }
  if (/load failed|failed to fetch|networkerror/i.test(raw)) {
    return "Couldn't reach the server. Check your connection and try again.";
  }
  return raw;
}

export function looksLikeEmail(s) {
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test((s || "").trim());
}

/* ---- password ---------------------------------------------------------- */

export async function sendPasswordCode(auth) {
  const { error } = await auth.reauthenticate();
  return error ? { ok: false, error: say(error) } : { ok: true };
}

export async function changePassword(auth, { password, confirm, code }) {
  if (!/^\d{6,10}$/.test((code || "").trim())) {
    return { ok: false, error: "Enter the code from the email — numbers only." };
  }
  if ((password || "").length < 6) return { ok: false, error: "Your new password needs at least 6 characters." };
  if (password !== confirm) return { ok: false, error: "The two passwords don't match." };

  const { error } = await auth.updateUser({ password, nonce: code.trim() });
  return error ? { ok: false, error: say(error) } : { ok: true };
}

/* ---- email ------------------------------------------------------------- */

export async function requestEmailChange(auth, { newEmail, currentEmail }) {
  const to = (newEmail || "").trim().toLowerCase();
  if (!looksLikeEmail(to)) return { ok: false, error: "Enter a valid email address." };
  if (to === (currentEmail || "").trim().toLowerCase()) {
    return { ok: false, error: "That's already your email address." };
  }
  const { error } = await auth.updateUser({ email: to });
  return error ? { ok: false, error: say(error) } : { ok: true, newEmail: to };
}

/* Verifies whichever codes were given. Done when the account's email is the
   new one; otherwise the other address's code is still needed. */
export async function confirmEmailChange(auth, { newEmail, currentEmail, codeNew, codeCurrent }) {
  const n = (codeNew || "").trim();
  const c = (codeCurrent || "").trim();
  if (!n && !c) return { ok: false, error: "Enter the code from the email." };
  if ((n && !/^\d{6,10}$/.test(n)) || (c && !/^\d{6,10}$/.test(c))) {
    return { ok: false, error: "Codes are numbers only." };
  }

  if (n) {
    const { error } = await auth.verifyOtp({ email: newEmail, token: n, type: "email_change" });
    if (error) return { ok: false, error: say(error) };
  }
  if (c) {
    const { error } = await auth.verifyOtp({ email: currentEmail, token: c, type: "email_change" });
    if (error) return { ok: false, error: say(error) };
  }

  const { data } = await auth.getUser();
  const now = (data?.user?.email || "").toLowerCase();
  if (now === newEmail.toLowerCase()) return { ok: true };
  return {
    ok: false,
    pending: true,
    error: `Nearly there. Enter the code we sent to your current address, ${currentEmail}, as well.`,
  };
}
