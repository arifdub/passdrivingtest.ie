/*
  ===========================================================================
  ASKING THE SERVER TO DELETE THIS ACCOUNT

  The actual deletion — db.auth.admin.deleteUser — needs the service-role
  key, which never reaches the browser. So this calls api/delete-account,
  the same bearer-token pattern as sendTestPush in src/push.js: the
  session's own access token proves who is asking, and the server trusts
  nothing else about identity.
  ===========================================================================
*/

import { supabase, HAS_SUPABASE } from "./supabaseClient";

export async function deleteMyAccount() {
  if (!HAS_SUPABASE) return { ok: false, error: "Not signed in." };

  const { data } = await supabase.auth.getSession();
  const token = data?.session?.access_token;
  if (!token) return { ok: false, error: "Sign in again and retry." };

  let res;
  try {
    res = await fetch("/api/delete-account", {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ confirm: "DELETE" }),
    });
  } catch {
    /* Offline, or the function is not deployed on this host. Nothing was
       deleted — a failed request never reached the server. */
    return { ok: false, error: "Could not reach the server. Nothing was deleted." };
  }

  let body = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }

  if (!res.ok) {
    return { ok: false, error: body?.error || `Server said ${res.status}.` };
  }
  return { ok: true };
}
