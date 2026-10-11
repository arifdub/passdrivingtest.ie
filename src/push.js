/*
  ===========================================================================
  PUSH NOTIFICATIONS

  The only thing in this product that reaches a phone with the app closed.

  PERMISSION IS ASKED BEHIND A BUTTON, NEVER ON LOAD

  A permission prompt that appears unbidden is the most reflexively
  dismissed dialog on the web, and a dismissal on iOS is close to permanent:
  there is no second prompt, only Settings. So nothing here runs until
  somebody presses something that says what it is for.

  iOS HAS A RULE NOBODY EXPECTS

  Safari on iOS only allows push for a site that has been added to the home
  screen. In a browser tab the API is simply absent — not refused, absent.
  Telling an instructor "notifications are not supported on your phone" when
  the truth is "add this to your home screen first" is the difference
  between a feature nobody uses and one that works.
  ===========================================================================
*/

import { supabase, HAS_SUPABASE } from "./supabaseClient";

/* TRIMMED. Pasting a key into a hosting dashboard from a text file brings a
   trailing newline or a stray space more often than not, and an untrimmed
   key fails inside atob() — which surfaces as "this device wouldn't accept
   notifications", sending somebody to look at their phone when the problem
   is a character they cannot see. */
export const VAPID_PUBLIC_KEY =
  (import.meta.env.VITE_VAPID_PUBLIC_KEY || "").trim();

/* The browser wants a Uint8Array, and VAPID keys travel as base64url. */
export function urlBase64ToUint8Array(input) {
  const base64 = String(input || "").trim();
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const normalised = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(normalised);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

/* Is this actually a VAPID public key?

   It is an uncompressed P-256 point: 65 bytes, the first of which is 0x04.
   The two mistakes that produce a valid-looking string are pasting the
   PRIVATE key (32 bytes) into the public variable, and pasting one of them
   with something else attached. Both throw deep inside subscribe() with a
   message about the device, which is the wrong place to look entirely. */
export function looksLikeVapidKey(key) {
  const k = String(key || "").trim();
  if (!k) return { ok: false, why: "empty" };
  let bytes;
  try {
    bytes = urlBase64ToUint8Array(k);
  } catch {
    return { ok: false, why: "not base64url — check for a stray space or line break" };
  }
  if (bytes.length === 32) {
    return { ok: false, why: "that's the PRIVATE key — the public one is longer" };
  }
  if (bytes.length !== 65) {
    return { ok: false, why: `wrong length (${bytes.length} bytes, expected 65)` };
  }
  if (bytes[0] !== 4) {
    return { ok: false, why: "not an uncompressed P-256 point" };
  }
  return { ok: true };
}

/* Running as an installed app rather than in a browser tab. */
export function isStandalone() {
  if (typeof window === "undefined") return false;
  return window.matchMedia?.("(display-mode: standalone)")?.matches
    || window.navigator?.standalone === true;
}

export function isIOS() {
  if (typeof navigator === "undefined") return false;
  return /iPad|iPhone|iPod/.test(navigator.userAgent)
    /* iPadOS 13+ reports itself as a Mac, and is the one that matters here
       because it has the same home-screen rule. */
    || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}

/* Why push cannot be switched on, in words somebody can act on. Returns null
   when it can. */
export function pushBlockedReason({
  supported = typeof window !== "undefined"
    && "serviceWorker" in navigator && "PushManager" in window,
  permission = typeof Notification !== "undefined" ? Notification.permission : "default",
  ios = isIOS(),
  standalone = isStandalone(),
  hasKey = Boolean(VAPID_PUBLIC_KEY),
  key = VAPID_PUBLIC_KEY,
} = {}) {
  if (!hasKey) {
    return {
      code: "unconfigured",
      text: "Notifications aren't set up on this site yet.",
    };
  }
  /* A key that is present but wrong is a different problem from no key, and
     it is the site's problem rather than the phone's. */
  if (key) {
    const shape = looksLikeVapidKey(key);
    if (!shape.ok) {
      return {
        code: "badkey",
        text: `The notification key on this site isn't right: ${shape.why}. Check VITE_VAPID_PUBLIC_KEY and redeploy.`,
      };
    }
  }
  if (ios && !standalone) {
    /* The important one. On iOS the API is absent in a tab, so without this
       the message would be "not supported", which is wrong and unactionable. */
    return {
      code: "ios-needs-install",
      text: "On iPhone, add this app to your home screen first — then you can turn notifications on.",
    };
  }
  if (!supported) {
    return { code: "unsupported", text: "This browser can't do notifications." };
  }
  if (permission === "denied") {
    return {
      code: "denied",
      text: "Notifications are blocked for this site. You can turn them back on in your browser settings.",
    };
  }
  return null;
}

/* ------------------------------------------------------------------------- */

async function registration() {
  if (!("serviceWorker" in navigator)) return null;
  return navigator.serviceWorker.ready;
}

export async function currentSubscription() {
  const reg = await registration();
  if (!reg) return null;
  try {
    return await reg.pushManager.getSubscription();
  } catch {
    return null;
  }
}

/* The shape the database wants. Exported because turning a PushSubscription
   into three strings is fiddly enough to be worth testing on its own. */
export function toRow(sub) {
  const json = typeof sub.toJSON === "function" ? sub.toJSON() : sub;
  return {
    p_endpoint: json.endpoint,
    p_p256dh: json.keys?.p256dh || "",
    p_auth: json.keys?.auth || "",
    p_user_agent: typeof navigator !== "undefined" ? navigator.userAgent : null,
  };
}

export async function enablePush() {
  const blocked = pushBlockedReason();
  if (blocked) return { ok: false, error: blocked.text, code: blocked.code };

  let permission = Notification.permission;
  if (permission === "default") {
    permission = await Notification.requestPermission();
  }
  if (permission !== "granted") {
    return {
      ok: false,
      code: "denied",
      error: "You said no to notifications. You can change that in your browser settings.",
    };
  }

  const reg = await registration();
  if (!reg) return { ok: false, error: "The app isn't installed properly on this device." };

  let sub = await reg.pushManager.getSubscription();
  if (!sub) {
    try {
      sub = await reg.pushManager.subscribe({
        /* Required by every browser now: a push that shows nothing is not
           allowed, and the service worker always shows something. */
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
      });
    } catch (e) {
      console.warn("Could not subscribe to push:", e?.name, e?.message, e);
      return { ok: false, code: "subscribe-failed", error: describeSubscribeError(e) };
    }
  }

  const saved = await saveSubscription(sub);
  if (!saved.ok) return saved;
  return { ok: true, error: null };
}

/* The browser's own reason, in words that point at the right thing.

   The old message was "This device wouldn't accept notifications" for every
   one of these — which is wrong about three of the four, and sends somebody
   to their phone's settings when the problem is a deployment. */
export function describeSubscribeError(e) {
  const name = e?.name || "";
  const msg = e?.message || "";

  if (name === "NotAllowedError") {
    return "Notifications are blocked for this site. Turn them back on in your phone's settings for this app.";
  }
  if (name === "InvalidAccessError" || /applicationServerKey|InvalidAccess/i.test(msg)) {
    return "The notification key on this site isn't right. Check VITE_VAPID_PUBLIC_KEY in Vercel, then redeploy.";
  }
  if (name === "AbortError") {
    /* On iOS this is what a home-screen app that has not actually been
       re-opened from the icon produces, and also what a device with no
       network produces. Both are worth naming. */
    return "Couldn't reach the notification service. Check you're online, and that you opened this from the home-screen icon rather than Safari.";
  }
  if (name === "NotSupportedError") {
    return "This browser can't do notifications.";
  }
  return `Couldn't turn them on${name ? ` (${name})` : ""}. ${msg || ""}`.trim();
}

export async function saveSubscription(sub) {
  if (!HAS_SUPABASE || !sub) return { ok: false, error: "Not signed in." };

  const { error } = await supabase.rpc("save_push_subscription", toRow(sub));
  if (error) {
    if (error.code === "42883" || error.code === "PGRST202") {
      return { ok: false, error: "Notifications aren't set up on this site yet (sql/20 hasn't been run)." };
    }
    console.warn("Push subscription not saved:", error.message);
    return { ok: false, error: error.message };
  }
  return { ok: true, error: null };
}

export async function disablePush() {
  const sub = await currentSubscription();
  if (!sub) return { ok: true, error: null };

  const { endpoint } = sub;
  /* Told first, unsubscribed second: if the order were reversed and the
     delete failed, the row would point at an endpoint that no longer
     exists and every future send would retry a dead device. */
  if (HAS_SUPABASE) {
    await supabase.rpc("delete_push_subscription", { p_endpoint: endpoint });
  }
  try {
    await sub.unsubscribe();
  } catch {
    /* Already gone. */
  }
  return { ok: true, error: null };
}

/* Called on every load while permission is granted. A browser can rotate a
   subscription without telling anybody, and the stored endpoint silently
   goes dead — the classic "push worked for a week" bug. Re-saving is one
   cheap upsert keyed on the endpoint. */
export async function refreshSubscription() {
  if (typeof Notification === "undefined" || Notification.permission !== "granted") return;
  const sub = await currentSubscription();
  if (sub) await saveSubscription(sub);
}
