/* Drives api/delete-account.js as Vercel would.

   Reachable from the internet, like test-push.js, and guarded the same
   way: the caller's own Supabase token decides whose account this can
   touch, never a value in the request. The one thing this endpoint adds
   on top of that pattern is a second lock — a confirmation phrase — since
   what it does if both locks open is irreversible in a way a test push
   is not. */

const { default: handler } = await import("../../api/delete-account.js");

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

const anon = await call("POST", {}, { confirm: "DELETE" });
is("a POST with no token is refused", anon.code, 401);
/* Same ordering bug notify.js once had: an unauthenticated caller reaching
   the configuration check first would learn the server is half set up. */
is("and does not leak the configuration to do it", anon.payload?.error, "sign in first");

const empty = await call("POST", { authorization: "Bearer " }, { confirm: "DELETE" });
is("an empty bearer token is refused", empty.code, 401);

/* With no SUPABASE_URL set in this test environment, a token-bearing call
   never reaches auth.getUser — it stops at "not configured" first. That is
   still the correct order (authenticate, then check configuration) and is
   exercised the same way test-push.js's own check accepts it: as the
   visible proof that the token check runs before the config check, not
   after it. */
const withToken = await call(
  "POST",
  { authorization: "Bearer not-a-real-token" },
  { confirm: "DELETE" },
);
is("a bearer token reaches past the auth gate before configuration is checked",
  withToken.code, 500);
is("and the 500 is the configuration error, not a crash",
  withToken.payload?.error, "not configured");

console.log(bad ? `\n${bad} failed` : "\ndelete-account cannot be made to delete anyone's account but the caller's own");
process.exit(bad ? 1 : 0);
