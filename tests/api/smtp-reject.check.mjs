/* What a refused email records.

   The existing SMTP check proves a message can be sent. This proves the
   opposite case, which is the one that cost days: a server that accepts
   the conversation, reads the message, and then says no.

   nodemailer reports that as code EMESSAGE. The code is the category —
   it is identical for every content rejection ever made, and on its own
   it is unactionable. The server's reply, "550 5.7.1 ..." , is the
   diagnosis. notify.js used to store only the code, so every rejection in
   the database read "smtp EMESSAGE" with nothing behind it.

   A real SMTP server is started here and told to refuse at DATA. */

import { SMTPServer } from "smtp-server";

const PORT = 2527;
const REJECTION = "550 5.7.1 Message rejected by content filter (test)";

/* STARTTLS stays ENABLED. mailer() sets requireTLS on every port that is
   not 465, so a server refusing to upgrade fails as ETLS before the
   message is ever offered — which is a real property of this app worth
   keeping exercised, and was the first thing this test discovered about
   itself. smtp-server ships a self-signed certificate for this; the
   client is told to accept it the same way shared hosting needs. */
const server = new SMTPServer({
  authOptional: true,
  /* Accept any login. The point of this test is what happens AFTER the
     message is accepted for transmission, so every earlier stage has to
     succeed or the rejection under test is never reached. */
  onAuth(auth, session, callback) {
    callback(null, { user: auth.username });
  },
  onData(stream, session, callback) {
    stream.on("end", () => {
      /* Refuse AFTER the message body, which is what makes this EMESSAGE
         rather than EENVELOPE. */
      const err = new Error(REJECTION);
      err.responseCode = 550;
      callback(err);
    });
    stream.resume();
  },
});

await new Promise((res, rej) => {
  server.listen(PORT, "127.0.0.1", res);
  server.on("error", rej);
});

process.env.SUPABASE_URL = "https://x.supabase.co";
process.env.SUPABASE_SERVICE_ROLE_KEY = "k";
process.env.SMTP_HOST = "127.0.0.1";
process.env.SMTP_PORT = String(PORT);
process.env.SMTP_USER = "u";
process.env.SMTP_PASS = "p";
process.env.NOTIFY_FROM = "PassDrivingTest <no-reply@example.ie>";
process.env.SMTP_ALLOW_SELF_SIGNED = "true";
delete process.env.RESEND_API_KEY;

const { mailer, smtpFailureReason } = await import("../../api/notify.js");

let bad = 0;
const is = (what, ok, detail) => {
  if (ok) console.log(`  ✓ ${what}`);
  else { console.log(`  ✗ ${what}${detail ? ` — ${detail}` : ""}`); bad++; }
};

let caught = null;
try {
  await mailer().sendMail({
    from: process.env.NOTIFY_FROM,
    to: "instructor@example.ie",
    /* The booking subject's shape, em dash and all — the one that differs
       from every other subject this app sends. */
    subject: "New booking request — Monday 13 October, 14:00",
    html: "<p>A learner asked for a lesson.</p>",
    text: "A learner asked for a lesson.",
  });
} catch (e) {
  caught = e;
}

is("a refused message throws rather than reporting success", Boolean(caught));
is("nodemailer categorises it as EMESSAGE", caught?.code === "EMESSAGE", `got ${caught?.code}`);

/* The point of the whole exercise: the reason survives. */
is("the server's own reply is on the error",
  String(caught?.response || "").includes("content filter"),
  `response was ${JSON.stringify(caught?.response)}`);
is("and its numeric code", caught?.responseCode === 550, `got ${caught?.responseCode}`);

/* notify.js's own function, not a copy of it. Rebuilding the string here
   would only prove that two pieces of code agree with each other. The old
   version of this produced "smtp EMESSAGE" and stopped there. */
const why = smtpFailureReason(caught);

is("the recorded reason names the code", why.includes("EMESSAGE"));
is("and the numeric reply", why.includes("550"));
is("and the words a person can act on", why.includes("content filter"), why);
is("and is more than the bare category", why !== "smtp EMESSAGE");

await new Promise(r => server.close(r));

console.log(bad ? `\n${bad} failed` : "\na refused email records why it was refused");
process.exit(bad ? 1 : 0);
