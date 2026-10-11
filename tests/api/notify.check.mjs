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

console.log(bad ? `\n${bad} failed` : "\nthe endpoint refuses everything it should");
process.exit(bad ? 1 : 0);
