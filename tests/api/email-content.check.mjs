/* What the emails actually say, and to whom.

   This app has two portals and both get email. The frame used to be
   written for one of them: it said "Instructor portal", told the reader
   they were getting it because they are an instructor, and pointed its
   button at /adi — including in the message email, which already went to
   learners about their own lessons. A learner was being sent somewhere
   they cannot use.

   Also checked here: escaping. A pick-up address and a note are typed by
   a learner and then placed into HTML that is sent to somebody else. */

process.env.NOTIFY_SITE = "https://passdrivingtest.ie";

const { wrap, detailTable, euro } = await import("../../api/notify.js");

let bad = 0;
const is = (what, ok, detail) => {
  if (ok) console.log(`  ✓ ${what}`);
  else { console.log(`  ✗ ${what}${detail ? ` — ${detail}` : ""}`); bad++; }
};

/* ---- who the email is for ------------------------------------------- */

const toInstructor = wrap("Title", "<p>body</p>", "Open the portal");
is("the instructor frame names the instructor portal", toInstructor.includes("Instructor portal"));
is("and links there", toInstructor.includes('href="https://passdrivingtest.ie/adi"'));
is("and says why they are getting it", toInstructor.includes("you're an instructor"));

const toLearner = wrap("Title", "<p>body</p>", "See it in the app",
  { go: "/app", audience: "learner" });
is("the learner frame does not claim they are an instructor",
  !toLearner.includes("you're an instructor"));
is("does not send them to the instructor portal",
  !toLearner.includes('href="https://passdrivingtest.ie/adi"'));
is("links to the app instead", toLearner.includes('href="https://passdrivingtest.ie/app"'));
is("and says why they are getting it", toLearner.includes("you booked a lesson"));

/* The default must stay as it was, or every existing email changes
   silently. */
is("no options means the instructor frame, exactly as before",
  wrap("T", "<p>b</p>", "c") === wrap("T", "<p>b</p>", "c", {}));

/* ---- the lesson details --------------------------------------------- */

const table = detailTable([
  ["When", "Monday 13 October, 14:00"],
  ["How long", "60 minutes"],
  null,
  ["Pick-up", "14 O'Connell St"],
]);
is("every row given is shown", ["When", "How long", "Pick-up"].every(l => table.includes(l)));
is("a null row is dropped rather than rendered empty", !table.includes("undefined"));
/* Left as a literal apostrophe, and that is correct. esc escapes & < > and
   the double quote; a bare ' is harmless in text content and inside the
   double-quoted attributes this template uses, and escaping it would put
   "O&#39;Connell St" in front of a learner in any client that renders the
   address as plain text. The double quote is the one that must not survive
   — asserted below. */
is("an apostrophe in an address is left readable", table.includes("O'Connell"));
is("but a double quote cannot break out of an attribute",
  !detailTable([["Pick-up", '14 " onmouseover=x']]).includes('" onmouseover'));

const nasty = detailTable([["Your note", '<script>alert(1)</script>']]);
is("a typed note cannot inject markup", !nasty.includes("<script>"));
is("and is still legible as text", nasty.includes("&lt;script&gt;"));

const injectedLabel = detailTable([['<b>Label', "x"]]);
is("a label is escaped too", !injectedLabel.includes("<b>Label"));

/* A title goes through esc as well — it is built from a person's name. */
is("the title is escaped",
  wrap('<img src=x onerror=1>', "<p>b</p>", "c").includes("&lt;img"));

/* ---- money ----------------------------------------------------------- */

is("cents become euro", euro(4500) === "€45.00", euro(4500));
is("an odd amount is not rounded away", euro(4499) === "€44.99", euro(4499));
is("nothing becomes zero, not NaN", euro(null) === "€0.00", euro(null));

console.log(bad ? `\n${bad} failed` : "\nthe emails say the right thing to the right person");
process.exit(bad ? 1 : 0);
