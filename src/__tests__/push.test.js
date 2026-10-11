/*
  The push layer's pure parts. Two of these are the difference between a
  feature people use and one they cannot find.
*/

import { describe, it, expect } from "vitest";
import { urlBase64ToUint8Array, pushBlockedReason, toRow } from "../push";

describe("the VAPID key the browser wants", () => {
  it("decodes base64url, not base64", () => {
    /* VAPID keys arrive with - and _ in place of + and /, and without
       padding. Feeding them to atob() unchanged throws, and the failure
       looks like "this device wouldn't accept notifications" — which sends
       you looking at the device. */
    const key = "BEl62iUYgUivxIkv69yViEuiBIa-Ib9-SkvMeAtA3LFgDzkrxZJjSgSnfckjBJuBkr3qBUAM-Ijv1WjZ-sMcBHo";
    const bytes = urlBase64ToUint8Array(key);
    expect(bytes).toBeInstanceOf(Uint8Array);
    /* An uncompressed P-256 point: 65 bytes starting 0x04. */
    expect(bytes.length).toBe(65);
    expect(bytes[0]).toBe(4);
  });

  it("pads a length that is not a multiple of four", () => {
    expect(() => urlBase64ToUint8Array("QQ")).not.toThrow();
    expect(urlBase64ToUint8Array("QQ")[0]).toBe(65);   // "A"
  });
});

describe("why push cannot be turned on", () => {
  const ok = { supported: true, permission: "default", ios: false, standalone: false, hasKey: true };

  it("says nothing is wrong when nothing is", () => {
    expect(pushBlockedReason(ok)).toBeNull();
  });

  it("tells an iPhone user to install the app, not that it is unsupported", () => {
    /* THE important one. Safari only allows push for a site on the home
       screen, and in a tab the API is absent rather than refused — so the
       naive check reports "unsupported", which is wrong and leaves somebody
       with nothing to do about it. */
    const r = pushBlockedReason({ ...ok, ios: true, standalone: false, supported: false });
    expect(r.code).toBe("ios-needs-install");
    expect(r.text).toMatch(/home screen/i);
    expect(r.text).not.toMatch(/support/i);
  });

  it("and not once it IS installed", () => {
    expect(pushBlockedReason({ ...ok, ios: true, standalone: true })).toBeNull();
  });

  it("distinguishes blocked from never-asked", () => {
    /* "Denied" needs Settings; "default" just needs the button. Same screen,
       completely different instruction. */
    expect(pushBlockedReason({ ...ok, permission: "denied" }).code).toBe("denied");
    expect(pushBlockedReason({ ...ok, permission: "default" })).toBeNull();
    expect(pushBlockedReason({ ...ok, permission: "granted" })).toBeNull();
  });

  it("says the site is unconfigured rather than blaming the device", () => {
    /* No VITE_VAPID_PUBLIC_KEY in the build. Telling somebody their phone
       cannot do notifications would send them to the wrong place entirely. */
    const r = pushBlockedReason({ ...ok, hasKey: false });
    expect(r.code).toBe("unconfigured");
    expect(r.text).toMatch(/aren't set up/i);
  });

  it("checks the site before the device", () => {
    /* With no key AND an unsupported browser, the site's own gap is the
       honest answer — fixing the browser would change nothing. */
    expect(pushBlockedReason({ ...ok, hasKey: false, supported: false }).code)
      .toBe("unconfigured");
  });
});

describe("what gets stored", () => {
  it("flattens a PushSubscription into the three things the server needs", () => {
    const sub = {
      toJSON: () => ({
        endpoint: "https://fcm.googleapis.com/fcm/send/abc",
        keys: { p256dh: "pub", auth: "secret" },
      }),
    };
    const row = toRow(sub);
    expect(row.p_endpoint).toBe("https://fcm.googleapis.com/fcm/send/abc");
    expect(row.p256dh).toBeUndefined();          // named for the RPC, not the JSON
    expect(row.p_p256dh).toBe("pub");
    expect(row.p_auth).toBe("secret");
  });

  it("copes with a plain object that has no toJSON", () => {
    const row = toRow({ endpoint: "https://x/y", keys: { p256dh: "a", auth: "b" } });
    expect(row.p_endpoint).toBe("https://x/y");
    expect(row.p_auth).toBe("b");
  });

  it("never sends undefined keys", () => {
    /* A subscription without keys cannot be encrypted for, and empty
       strings fail loudly at the server rather than silently here. */
    const row = toRow({ endpoint: "https://x/y" });
    expect(row.p_p256dh).toBe("");
    expect(row.p_auth).toBe("");
  });
});

/* ------------------------------------------------------------------------- */
/* Telling the site's problem from the phone's                                */
/*                                                                            */
/* Every one of these used to surface as "this device wouldn't accept         */
/* notifications", which sends somebody to their phone settings when the      */
/* problem is a deployment.                                                   */
/* ------------------------------------------------------------------------- */

import { looksLikeVapidKey, describeSubscribeError } from "../push";

const REAL = "BEl62iUYgUivxIkv69yViEuiBIa-Ib9-SkvMeAtA3LFgDzkrxZJjSgSnfckjBJuBkr3qBUAM-Ijv1WjZ-sMcBHo";

describe("is this actually a VAPID public key", () => {
  it("accepts a real one", () => {
    expect(looksLikeVapidKey(REAL).ok).toBe(true);
  });

  it("survives the trailing newline a dashboard paste adds", () => {
    /* The likeliest failure of the lot, and invisible on screen. */
    expect(looksLikeVapidKey(REAL + "\n").ok).toBe(true);
    expect(looksLikeVapidKey("  " + REAL + "  ").ok).toBe(true);
  });

  it("recognises the private key pasted into the public slot", () => {
    /* 32 bytes rather than 65. The guide says to paste the public key in
       two places, which is exactly the instruction somebody misreads. */
    const priv = "pcM9fWMiVEzBqWRuFCGLxuDqPEXoLXBmJq7GdAyFvkA";
    const r = looksLikeVapidKey(priv);
    expect(r.ok).toBe(false);
    expect(r.why).toMatch(/private/i);
  });

  it("rejects something that is not a key at all", () => {
    expect(looksLikeVapidKey("hello").ok).toBe(false);
    expect(looksLikeVapidKey("").why).toBe("empty");
    expect(looksLikeVapidKey(null).ok).toBe(false);
  });

  it("is reported as the site's problem, not the device's", () => {
    const r = pushBlockedReason({
      supported: true, permission: "default", ios: false, standalone: false,
      hasKey: true, key: "hello",
    });
    expect(r.code).toBe("badkey");
    expect(r.text).toMatch(/VITE_VAPID_PUBLIC_KEY/);
    expect(r.text).not.toMatch(/device|phone|browser can't/i);
  });
});

describe("what the browser's refusal actually means", () => {
  it("NotAllowedError points at the phone's settings", () => {
    expect(describeSubscribeError({ name: "NotAllowedError" }))
      .toMatch(/settings/i);
  });

  it("InvalidAccessError points at the deployment", () => {
    const t = describeSubscribeError({ name: "InvalidAccessError" });
    expect(t).toMatch(/VITE_VAPID_PUBLIC_KEY/);
    expect(t).toMatch(/redeploy/i);
  });

  it("AbortError mentions both the network and the home-screen icon", () => {
    /* On iOS this is what a site opened in Safari rather than from the
       installed icon produces, and also what no network produces. */
    const t = describeSubscribeError({ name: "AbortError" });
    expect(t).toMatch(/online/i);
    expect(t).toMatch(/home.screen/i);
  });

  it("never claims the device refused when it did not say so", () => {
    const t = describeSubscribeError({ name: "WeirdError", message: "something odd" });
    expect(t).toMatch(/something odd/);
    expect(t).not.toMatch(/wouldn't accept/i);
  });
});
