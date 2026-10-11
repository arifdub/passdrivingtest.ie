/* Drives api/notify.js as Vercel would, with no environment set beyond the
   secret — so what is being checked is the gatekeeping, which is the part
   that is reachable from the internet. */
process.env.NOTIFY_SECRET = "s3cret";

const { default: handler } = await import("../../api/notify.js");

const call = async (method, headers, body) => {
  let code = 0, payload = null;
  const res = {
    status(c) { code = c; return this; },
    json(p) { payload = p; return this; },
  };
  await handler({ method, headers, body }, res);
  return { code, payload };
};

let bad = 0;
const is = (what, got, want) => {
  if (got === want) console.log(`  ✓ ${what}`);
  else { console.log(`  ✗ ${what} — got ${got}, wanted ${want}`); bad++; }
};

is("GET is refused",
  (await call("GET", {}, {})).code, 405);

is("a POST with no secret is refused",
  (await call("POST", {}, { kind: "booking", id: "x" })).code, 401);

is("a POST with the wrong secret is refused",
  (await call("POST", { "x-notify-secret": "guess" }, { kind: "booking", id: "x" })).code, 401);

/* With the right secret it gets past the door and then fails on the missing
   database config, which is the correct order: authenticate first. */
const configured = await call("POST", { "x-notify-secret": "s3cret" }, { kind: "booking", id: "x" });
is("the right secret gets past the door", configured.code, 500);
is("and says it is unconfigured rather than leaking anything",
  configured.payload?.error, "not configured");

/* ------------------------------------------------------------------------- */
/* A bad VAPID value must cost push, and nothing else                          */
/*                                                                             */
/* web-push's setVapidDetails validates and throws. Called while the module    */
/* loads, that throw happens before the handler exists — Vercel answers        */
/* FUNCTION_INVOCATION_FAILED, the email never sends either, and the error     */
/* names neither cause. That is exactly what happened in production.           */
/* ------------------------------------------------------------------------- */

const loadsWith = async (env, label) => {
  const saved = { ...process.env };
  Object.assign(process.env, env);
  try {
    const m = await import(`../../api/notify.js?${label}`);
    const ok = typeof m.default === "function";
    if (ok) console.log(`  ✓ still loads with ${label}`);
    else { console.log(`  ✗ ${label}: no handler`); bad++; }
  } catch (e) {
    console.log(`  ✗ ${label}: crashed at import — ${e.message}`);
    bad++;
  }
  process.env = saved;
};

await loadsWith({
  SUPABASE_URL: "https://x.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "k",
  VAPID_PUBLIC_KEY: "sb_publishable_not_a_vapid_key",
  VAPID_PRIVATE_KEY: "short",
  VAPID_SUBJECT: "mailto:a@b.ie",
}, "a-wrong-public-key");

await loadsWith({
  SUPABASE_URL: "https://x.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "k",
  VAPID_PUBLIC_KEY: "BEl62iUYgUivxIkv69yViEuiBIa-Ib9-SkvMeAtA3LFgDzkrxZJjSgSnfckjBJuBkr3qBUAM-Ijv1WjZ-sMcBHo",
  VAPID_PRIVATE_KEY: "pcM9fWMiVEzBqWRuFCGLxuDqPEXoLXBmJq7GdAyFvkA",
  /* The subject without its mailto: prefix — a mistake the setup guide
     actively invites, because an email address looks complete on its own. */
  VAPID_SUBJECT: "arifdub@gmail.com",
}, "a-subject-missing-mailto");

/* -------------------------------------------------------------------------
   A push that is refused must say so.

   sendPush used to swallow anything that was not a 404 or 410 into
   console.error and return {sent: 0}, which reads exactly like "this user
   has no devices". A 403 from Apple — the VAPID key not matching the one
   the device subscribed with — was therefore indistinguishable from
   nothing to do. hostOf is the part of that diagnostic that can be tested
   without a push service: the endpoint is credential-ish, so only its host
   is ever recorded.
   ------------------------------------------------------------------------- */
{
  const { hostOf } = await import("../../api/notify.js");
  is("an Apple endpoint reports its host",
    hostOf("https://web.push.apple.com/abc123secret"), "web.push.apple.com");
  is("and not the token that follows it",
    hostOf("https://fcm.googleapis.com/fcm/send/xyz-token").includes("xyz-token"), false);
  is("a malformed endpoint does not throw",
    hostOf("not a url"), "unparseable endpoint");
}

console.log(bad ? `\n${bad} failed` : "\nthe endpoint refuses everything it should, and survives a bad VAPID config");
process.exit(bad ? 1 : 0);
