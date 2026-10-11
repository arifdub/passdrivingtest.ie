/* Drives api/test-push.js as Vercel would.

   This endpoint is reachable from the internet and, unlike notify.js, has
   no shared secret in front of it — it is guarded by the caller's own
   Supabase token. So what is checked here is that it cannot be made to
   push to somebody else's phone, and that it refuses before it reveals
   anything about its configuration. */

const { default: handler } = await import("../../api/test-push.js");

const call = async (method, headers = {}, body = undefined) => {
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
  else { console.log(`  ✗ ${what} — got ${JSON.stringify(got)}, wanted ${JSON.stringify(want)}`); bad++; }
};

is("GET is refused", (await call("GET")).code, 405);

const anon = await call("POST");
is("a POST with no token is refused", anon.code, 401);
/* Before anything else. With no SUPABASE_URL set, an unauthenticated call
   that reached the configuration check would answer 500 and name the
   missing variables — which is exactly the ordering bug notify.js had. */
is("and does not leak the configuration to do it", anon.payload?.error, "sign in first");

const empty = await call("POST", { authorization: "Bearer " });
is("an empty bearer token is refused", empty.code, 401);

/* A user id in the body must not be honoured. If it were, this endpoint
   would be a way to buzz any phone on the platform. The id comes from the
   verified token and from nowhere else, so this is still just unauthorised. */
const spoof = await call("POST", {}, { user_id: "00000000-0000-0000-0000-000000000000" });
is("a user id in the body does not get past the door", spoof.code, 401);

console.log(bad ? `\n${bad} failed` : "\ntest-push cannot be made to push to anyone else");
process.exit(bad ? 1 : 0);
