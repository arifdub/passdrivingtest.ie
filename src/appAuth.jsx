/*
  ===========================================================================
  AUTH + SUBSCRIPTION

  One provider wrapped around the app. Everything else just calls useAuth().

  Two modes, chosen automatically:

    Supabase mode  — when VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY are set.
                     Real accounts, real sessions, progress synced across
                     every device the learner signs in on.

    Local mode     — when they aren't. Accounts live in the browser only.
                     Lets you run and demo the app before touching Supabase,
                     and stops a misconfigured deploy from showing a dead
                     login screen. Never use this for real customers.

  SUBSCRIPTION
  Right now every signed-in learner is "active" and nothing is charged.
  That decision lives in exactly one place — SUBSCRIPTION_REQUIRED below.
  When you add payments, set it to true and the gate turns on across the
  whole app; no screens need rewriting.
  ===========================================================================
*/

import React, {
  createContext, useContext, useState, useEffect, useCallback, useMemo,
} from "react";
import { supabase, HAS_SUPABASE } from "./supabaseClient";

/* -------------------------------------------------------------------------
   THE SUBSCRIPTION SWITCH — the only line to change when payments go live.
   ------------------------------------------------------------------------- */
export const SUBSCRIPTION_REQUIRED = false;

const LOCAL_USERS_KEY = "pdt-local-users-v1";
const LOCAL_SESSION_KEY = "pdt-local-session-v1";
const GUEST_KEY = "pdt-guest-v1";

const AuthContext = createContext(null);

/* -------------------------------------------------------------------------
   Local-mode helpers
   ------------------------------------------------------------------------- */
function readLocal(key, fallback) {
  try {
    const v = JSON.parse(localStorage.getItem(key));
    return v ?? fallback;
  } catch {
    return fallback;
  }
}

function writeLocal(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* private browsing — the session just won't survive a reload */
  }
}

/* Deliberately NOT a password hash. Local mode is a development and demo
   convenience, not a security boundary — anything typed here is visible in
   the browser anyway. Real security comes from Supabase in the mode above. */
function localUserId(email) {
  return `local-${email.trim().toLowerCase()}`;
}

/* -------------------------------------------------------------------------
   Provider
   ------------------------------------------------------------------------- */
export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [guest, setGuest] = useState(() => readLocal(GUEST_KEY, false));

  /* ---- load the profile row that goes with a Supabase user ---- */
  const loadProfile = useCallback(async (u) => {
    if (!u) return setProfile(null);

    if (!HAS_SUPABASE) {
      setProfile({
        id: u.id,
        email: u.email,
        full_name: u.full_name || "",
        subscription_status: "active",
        subscription_plan: "free-access",
      });
      return;
    }

    const { data, error: err } = await supabase
      .from("profiles")
      .select("*")
      .eq("id", u.id)
      .maybeSingle();

    if (err) {
      // A missing profile row shouldn't lock anyone out of studying.
      console.warn("Could not load profile:", err.message);
      setProfile({
        id: u.id,
        email: u.email,
        full_name: u.user_metadata?.full_name || "",
        subscription_status: "active",
        subscription_plan: "free-access",
      });
      return;
    }

    setProfile(
      data || {
        id: u.id,
        email: u.email,
        full_name: u.user_metadata?.full_name || "",
        subscription_status: "active",
        subscription_plan: "free-access",
      }
    );
  }, []);

  /* ---- restore an existing session on first load ---- */
  useEffect(() => {
    let cancelled = false;

    async function boot() {
      if (!HAS_SUPABASE) {
        const session = readLocal(LOCAL_SESSION_KEY, null);
        if (!cancelled && session) {
          setUser(session);
          await loadProfile(session);
        }
        if (!cancelled) setLoading(false);
        return;
      }

      const { data } = await supabase.auth.getSession();
      const sessionUser = data?.session?.user ?? null;
      if (!cancelled) {
        setUser(sessionUser);
        await loadProfile(sessionUser);
        setLoading(false);
      }
    }

    boot();

    if (!HAS_SUPABASE) return () => { cancelled = true; };

    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      const u = session?.user ?? null;
      setUser(u);
      loadProfile(u);
    });

    return () => {
      cancelled = true;
      sub?.subscription?.unsubscribe?.();
    };
  }, [loadProfile]);

  /* ---- sign up ---- */
  const signUp = useCallback(async ({ email, password, fullName }) => {
    setError(null);

    if (!HAS_SUPABASE) {
      const users = readLocal(LOCAL_USERS_KEY, {});
      const key = email.trim().toLowerCase();
      if (users[key]) {
        const msg = "An account with that email already exists on this device.";
        setError(msg);
        return { ok: false, error: msg };
      }
      const u = { id: localUserId(email), email: key, full_name: fullName || "" };
      users[key] = { ...u, password };
      writeLocal(LOCAL_USERS_KEY, users);
      writeLocal(LOCAL_SESSION_KEY, u);
      leaveGuest();
      setUser(u);
      await loadProfile(u);
      return { ok: true };
    }

    const { data, error: err } = await supabase.auth.signUp({
      email: email.trim(),
      password,
      options: { data: { full_name: fullName || "" } },
    });

    if (err) {
      setError(err.message);
      return { ok: false, error: err.message };
    }

    // With "Confirm email" switched on in Supabase, there's no session yet —
    // the learner has to click the link in their inbox first.
    if (!data.session) {
      return { ok: true, needsConfirmation: true };
    }
    leaveGuest();
    return { ok: true };
  }, [loadProfile]);

  /* ---- sign in ---- */
  const signIn = useCallback(async ({ email, password }) => {
    setError(null);

    if (!HAS_SUPABASE) {
      const users = readLocal(LOCAL_USERS_KEY, {});
      const key = email.trim().toLowerCase();
      const found = users[key];
      if (!found || found.password !== password) {
        const msg = "Email or password is incorrect.";
        setError(msg);
        return { ok: false, error: msg };
      }
      const u = { id: found.id, email: found.email, full_name: found.full_name };
      writeLocal(LOCAL_SESSION_KEY, u);
      leaveGuest();
      setUser(u);
      await loadProfile(u);
      return { ok: true };
    }

    const { error: err } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    });

    if (err) {
      setError(err.message);
      return { ok: false, error: err.message };
    }
    leaveGuest();
    return { ok: true };
  }, [loadProfile]);

  /* ---- guest mode ----
     Study without an account. Progress is written to this device only; the
     moment they do sign up, the progress store merges it into the new
     account, so nothing studied as a guest is lost. */
  const continueAsGuest = useCallback(() => {
    writeLocal(GUEST_KEY, true);
    setGuest(true);
    setError(null);
  }, []);

  /* Leaves guest mode without wiping progress — used both when an account is
     created and when a guest taps "Create an account" from the profile page. */
  function leaveGuest() {
    writeLocal(GUEST_KEY, false);
    setGuest(false);
  }

  const exitGuest = useCallback(() => leaveGuest(), []);

  /* ---- sign out ---- */
  const signOut = useCallback(async () => {
    leaveGuest();
    if (!HAS_SUPABASE) {
      writeLocal(LOCAL_SESSION_KEY, null);
      setUser(null);
      setProfile(null);
      return;
    }
    await supabase.auth.signOut();
    setUser(null);
    setProfile(null);
  }, []);

  /* ---- password reset ---- */
  const resetPassword = useCallback(async (email) => {
    if (!HAS_SUPABASE) {
      return { ok: false, error: "Password reset needs the database connected." };
    }
    const { error: err } = await supabase.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: `${window.location.origin}/#reset`,
    });
    if (err) return { ok: false, error: err.message };
    return { ok: true };
  }, []);

  /* ---- subscription ---- */
  const subscription = useMemo(() => {
    const status = profile?.subscription_status || "active";
    return {
      status,
      plan: profile?.subscription_plan || "free-access",
      // While SUBSCRIPTION_REQUIRED is false everyone has full access,
      // whatever the stored status says.
      isActive: SUBSCRIPTION_REQUIRED ? status === "active" : true,
      label: SUBSCRIPTION_REQUIRED
        ? (status === "active" ? "Active" : "Inactive")
        : "Active",
      // Shown on the profile screen so it's honest about what's going on.
      note: SUBSCRIPTION_REQUIRED
        ? null
        : "Full access — no payment required during launch.",
    };
  }, [profile]);

  const value = useMemo(() => ({
    user,
    profile,
    loading,
    error,
    setError,
    isSignedIn: Boolean(user),
    isGuest: guest && !user,
    // What the app gate checks: a real account OR guest mode.
    hasAccess: Boolean(user) || guest,
    displayName:
      (guest && !user)
        ? "there"
        : profile?.full_name?.trim() ||
          user?.email?.split("@")[0] ||
          "there",
    subscription,
    mode: HAS_SUPABASE ? "supabase" : "local",
    signUp,
    signIn,
    signOut,
    resetPassword,
    continueAsGuest,
    exitGuest,
  }), [user, profile, loading, error, subscription, guest, signUp, signIn,
       signOut, resetPassword, continueAsGuest, exitGuest]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
}

export default AuthProvider;
