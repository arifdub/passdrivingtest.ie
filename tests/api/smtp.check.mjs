/* Drives api/notify.js against a real SMTP server listening on localhost.
 *
 * The point is the handshake, not the wording: port, TLS mode and auth are
 * where SMTP configuration goes wrong, and every one of those failures
 * presents as a hang rather than an error message.
 */
import { SMTPServer } from "smtp-server";
import { execSync } from "node:child_process";
import { readFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/* A throwaway certificate, so STARTTLS has something to offer. */
const dir = mkdtempSync(join(tmpdir(), "smtp-check-"));
execSync(
  `openssl req -x509 -newkey rsa:2048 -nodes -days 1 -subj "/CN=localhost" ` +
  `-keyout ${dir}/k.pem -out ${dir}/c.pem`,
  { stdio: "ignore" },
);
const KEY = readFileSync(`${dir}/k.pem`);
const CERT = readFileSync(`${dir}/c.pem`);

const received = [];

const server = new SMTPServer({
  authOptional: false,
  /* STARTTLS with a self-signed certificate, which is the awkward case:
     plenty of shared hosting presents a certificate for the host rather
     than for your domain, and nodemailer refuses it by default. */
  secure: false,
  key: KEY,
  cert: CERT,
  onAuth(auth, _session, cb) {
    if (auth.username === "notify@passdrivingtest.ie" && auth.password === "hunter2") {
      return cb(null, { user: auth.username });
    }
    return cb(new Error("bad credentials"));
  },
  onData(stream, _session, cb) {
    let raw = "";
    stream.on("data", (c) => (raw += c));
    stream.on("end", () => { received.push(raw); cb(); });
  },
});

await new Promise((r) => server.listen(2525, "127.0.0.1", r));

process.env.NOTIFY_SECRET = "s3cret";
process.env.SUPABASE_URL = "http://127.0.0.1:9";          // never reached
process.env.SUPABASE_SERVICE_ROLE_KEY = "test";
process.env.SMTP_HOST = "127.0.0.1";
process.env.SMTP_PORT = "2525";
process.env.SMTP_USER = "notify@passdrivingtest.ie";
process.env.SMTP_PASS = "hunter2";
process.env.SMTP_ALLOW_SELF_SIGNED = "true";
process.env.NOTIFY_FROM = "PassDrivingTest <noreply@passdrivingtest.ie>";
process.env.NOTIFY_SITE = "https://passdrivingtest.ie";

/* THE FUNCTION'S OWN TRANSPORT, not a copy of it.
   The first version of this test built its own nodemailer with the right
   settings and passed — proving only that nodemailer works. The thing worth
   testing is how api/notify.js decides between implicit TLS and STARTTLS
   from the port number, which is the single most common SMTP
   misconfiguration and presents as a hang rather than an error. */
const { mailer } = await import("../../api/notify.js");
const transport = mailer();

let bad = 0;
const is = (what, ok) => { if (ok) console.log(`  ✓ ${what}`); else { console.log(`  ✗ ${what}`); bad++; } };

const info = await transport.sendMail({
  from: process.env.NOTIFY_FROM,
  to: "adi@example.ie",
  subject: "New booking request — Tuesday 14 October, 11:00",
  html: "<p>Amy has requested <strong>Tuesday</strong>.</p>",
  text: "New booking request\n\nAmy — Tuesday 14 October, 11:00\n\nhttps://passdrivingtest.ie/adi",
});

is("the mail server accepted it", Boolean(info.messageId));
is("exactly one message arrived", received.length === 1);

const raw = received[0] || "";
is("sent from the configured address", raw.includes("noreply@passdrivingtest.ie"));
is("the subject survived", raw.includes("New booking request"));
is("it is multipart with a plain-text alternative", /multipart\/alternative/i.test(raw));
is("the HTML is in there", /Amy has requested/.test(raw.replace(/=\r?\n/g, "")));

/* Wrong password must fail fast and loudly, not hang. */
process.env.SMTP_PASS = "wrong";
const { mailer: remailer } = await import("../../api/notify.js?bust=" + Date.now());
const wrong = remailer();
let refused = false;
const started = Date.now();
try { await wrong.sendMail({ from: "a@b.ie", to: "c@d.ie", subject: "x", text: "x" }); }
catch { refused = true; }
is("bad credentials are refused", refused);
is("and refused quickly, not by timing out", Date.now() - started < 8000);

/* Port 465 means TLS from the first byte; 587 means start plain and
   upgrade. Getting it backwards hangs rather than erroring, so the choice
   is asserted directly. */
process.env.SMTP_PORT = "465";
const { mailer: m465 } = await import("../../api/notify.js?p=465");
is("port 465 uses implicit TLS", m465().options.secure === true);
process.env.SMTP_PORT = "587";
const { mailer: m587 } = await import("../../api/notify.js?p=587");
is("port 587 starts plain and requires an upgrade",
   m587().options.secure === false && m587().options.requireTLS === true);

server.close();
console.log(bad ? `\n${bad} failed` : "\nSMTP sends, and fails properly when it should");
process.exit(bad ? 1 : 0);
