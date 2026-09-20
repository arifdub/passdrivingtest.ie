/*
  ===========================================================================
  SUPABASE CLIENT

  The two values come from Vercel's environment variables, never from code:
    VITE_SUPABASE_URL
    VITE_SUPABASE_ANON_KEY

  WHY THIS FILE IS DEFENSIVE
  An earlier version called createClient() with empty strings when those
  variables were missing. createClient does not tolerate that — it throws
  immediately. Because this module is imported at startup, the throw happened
  before React rendered anything, and the whole site came up as a blank white
  page with a perfectly green build.

  So: if the variables are missing, we never call createClient at all. We
  export a harmless stub instead and set HAS_SUPABASE to false. Every caller
  already checks that flag before touching the database, so the study side of
  the app — flashcards, questions, mock tests, local progress — keeps working
  with no account at all.
  ===========================================================================
*/

import { createClient } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const HAS_SUPABASE = Boolean(supabaseUrl && supabaseAnonKey);

/* A stand-in that absorbs any property access or call without throwing.
   Nothing should reach it while HAS_SUPABASE is false, but if something
   slips through, the app degrades instead of dying. */
function makeStub() {
  const noop = async () => ({ data: null, error: { message: "Database not configured." } });
  const handler = {
    get(_t, prop) {
      if (prop === "auth") {
        return {
          getSession: async () => ({ data: { session: null }, error: null }),
          onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
          signUp: noop,
          signInWithPassword: noop,
          signOut: noop,
          resetPasswordForEmail: noop,
        };
      }
      if (prop === "then") return undefined;   // don't look like a promise
      return new Proxy(noop, handler);
    },
    apply() {
      return new Proxy(noop, handler);
    },
  };
  return new Proxy(noop, handler);
}

let client;

if (HAS_SUPABASE) {
  try {
    client = createClient(supabaseUrl, supabaseAnonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    });
  } catch (err) {
    // A malformed URL would otherwise take the whole app down at startup.
    console.error("Supabase failed to initialise:", err);
    client = makeStub();
  }
} else {
  console.warn(
    "Supabase environment variables are missing. Accounts and synced progress " +
    "are unavailable; the app will store progress on this device only."
  );
  client = makeStub();
}

export const supabase = client;
export default supabase;
