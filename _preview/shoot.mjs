import { chromium } from "playwright";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join } from "node:path";

const DIR = "/home/user/passdrivingtest.ie/_preview/dist";
const TYPES = { ".html":"text/html", ".js":"text/javascript", ".css":"text/css" };
/* Slots for the next fortnight: five working days, nine to five, in the
   shape PostgREST returns for a set-returning function. */
function slots() {
  const out = [];
  for (const d of [4, 5, 11, 12, 18]) {
    const day = new Date(); day.setDate(day.getDate() + d); day.setHours(0, 0, 0, 0);
    for (let m = 9 * 60; m + 60 <= 17 * 60; m += 30) {
      const at = new Date(day); at.setHours(Math.floor(m / 60), m % 60, 0, 0);
      out.push({ slot: at.toISOString() });
    }
  }
  return out;
}

let seen = false;

const server = createServer(async (req, res) => {
  const p = req.url === "/" ? "/index.html" : req.url.split("?")[0];

  const json = (v) => {
    res.setHeader("content-type", "application/json");
    res.setHeader("access-control-allow-origin", "*");
    res.setHeader("access-control-allow-headers", "*");
    res.setHeader("access-control-expose-headers", "content-range");
    if (req.method === "OPTIONS") { res.statusCode = 204; return res.end(); }
    res.end(JSON.stringify(v));
  };

  if (p.startsWith("/rest/v1/") && !p.startsWith("/rest/v1/rpc/")) {
    const table = p.slice("/rest/v1/".length);
    if (table === "instructor_profiles") {
      return json([{ user_id: "11111111-1111-1111-1111-111111111111",
        full_name: "Zain Ahmed", verification_status: "verified", listed: true,
        adi_number: "40953", hourly_rate_cents: 4500, counties: ["Dublin"],
        lesson_types: ["edt","lesson"], transmissions: ["manual"] }]);
    }
    if (table === "lessons") {
      const at = (h) => { const d = new Date(); d.setHours(h, 0, 0, 0); return d.toISOString(); };
      return json([
        { id: "l1", starts_at: at(10), duration_minutes: 60, kind: "lesson", status: "scheduled", student: { full_name: "John Smith" } },
        { id: "l2", starts_at: at(13), duration_minutes: 60, kind: "edt",    status: "scheduled", student: { full_name: "Sarah Ahmed" } },
        { id: "l3", starts_at: at(16), duration_minutes: 60, kind: "pretest",status: "scheduled", student: { full_name: "Emma Walsh" } },
      ]);
    }
    if (table === "instructor_students") {
      return json([1,2,3,4,5,6,7,8].map(n => ({ id: "s" + n, full_name: "Student " + n, status: "active" })));
    }
    if (table === "bookings") {
      const soon = new Date(Date.now() + 2 * 86400000).toISOString();
      return json([{ id: "b1", status: "requested", starts_at: soon, duration_minutes: 60, kind: "edt" }]);
    }
    if (table === "instructor_enquiries") {
      return json([{ id: "e1", status: "new" }, { id: "e2", status: "new" }]);
    }
    return json([]);
  }

  if (p.startsWith("/rest/v1/rpc/")) {
    const fn = p.slice("/rest/v1/rpc/".length);
    res.setHeader("content-type", "application/json");
    res.setHeader("access-control-allow-origin", "*");
    res.setHeader("access-control-allow-headers", "*");
    if (req.method === "OPTIONS") { res.statusCode = 204; return res.end(); }
    if (fn === "open_slots") return res.end(JSON.stringify(slots()));
    if (fn === "mark_notifications_seen") { seen = true; return res.end(JSON.stringify(new Date().toISOString())); }
    if (fn === "my_waiting") return res.end(JSON.stringify([{
      booking_requests: 1, new_enquiries: 2, unread_messages: 2, lessons_today: 3,
      /* What the real function does: outstanding work is unchanged by
         looking, and only `unseen` goes to zero. */
      unseen: seen ? 0 : 5,
    }]));
    return res.end(JSON.stringify(null));
  }

  try {
    const buf = await readFile(join(DIR, p));
    res.setHeader("content-type", TYPES[extname(p)] || "application/octet-stream");
    res.end(buf);
  } catch { res.statusCode = 404; res.end("no"); }
}).listen(5599);

const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
for (const [name, w, h] of [["390", 390, 844], ["320", 320, 640], ["430", 430, 932]]) {
  const page = await b.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 2 });
  await page.goto("http://localhost:5599/");
  page.on("pageerror", e => console.log("  [pageerror]", e.message));
  await page.waitForSelector(process.env.WAIT_FOR || "text=Time", { timeout: 10000 });
  await page.screenshot({ fullPage: !!process.env.FULL, path: `${process.argv[2]}/${process.env.SHOT || "book"}-${name}.png` });

  const overflow = await page.evaluate(() =>
    document.documentElement.scrollWidth > document.documentElement.clientWidth);
  const small = await page.evaluate(() =>
    [...document.querySelectorAll("button")]
      .map(el => ({ t: el.textContent.trim().slice(0,12), r: el.getBoundingClientRect() }))
      .filter(x => x.r.width > 0 && x.r.height > 0 && (x.r.height < 40 || x.r.width < 40))
      .map(x => `${x.t} ${Math.round(x.r.width)}x${Math.round(x.r.height)}`));
  /* Text that is wider than the box drawn around it. This is how "Enquiries"
     shipped as "Enquirie" — it looks fine in source and only shows up at one
     particular width, which is exactly the thing a person stops checking
     after the third screenshot. */
  const clipped = await page.evaluate(() =>
    [...document.querySelectorAll("span, p, h1, h2, button")]
      .filter(el => el.children.length === 0 && el.textContent.trim())
      .filter(el => el.scrollWidth > el.clientWidth + 1)
      .map(el => el.textContent.trim().slice(0, 20))
      .slice(0, 8));

  const visibleTimes = await page.evaluate(() => {
    const vh = window.innerHeight;
    return [...document.querySelectorAll("button")]
      .filter(el => /^\d{2}:\d{2}$/.test(el.textContent.trim()))
      .filter(el => { const r = el.getBoundingClientRect(); return r.top >= 0 && r.bottom <= vh; })
      .length;
  });
  console.log(`${name}px  page-overflows-sideways=${overflow}  times-visible-without-scrolling=${visibleTimes}  under-40px=${small.length ? small.join(", ") : "none"}  clipped-text=${clipped.length ? clipped.join(" | ") : "none"}`);
  await page.close();
}
await b.close();
server.close();
