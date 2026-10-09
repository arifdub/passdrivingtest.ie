/* Does the bell's number actually go away when you read it?
 *
 * The badge counted outstanding work, so it could only clear when the work
 * was done — you read it, closed it, and it still said 5. That is not
 * visible from a unit test or from the SQL alone: it is the number on the
 * screen before and after a tap.
 */
import { chromium } from "playwright";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join } from "node:path";

const DIR = "/home/user/passdrivingtest.ie/_preview/dist";
const TYPES = { ".html":"text/html", ".js":"text/javascript", ".css":"text/css" };
let seen = false;
const json = (res, v) => {
  res.setHeader("content-type","application/json");
  res.setHeader("access-control-allow-origin","*");
  res.setHeader("access-control-allow-headers","*");
  res.end(JSON.stringify(v));
};
const server = createServer(async (req, res) => {
  const p = req.url === "/" ? "/index.html" : req.url.split("?")[0];
  if (req.method === "OPTIONS") { res.statusCode = 204; return res.end(); }
  if (p.endsWith("/rpc/mark_notifications_seen")) { seen = true; return json(res, new Date().toISOString()); }
  if (p.endsWith("/rpc/my_waiting")) return json(res, [{
    booking_requests: 1, new_enquiries: 2, unread_messages: 2,
    lessons_today: 0, unseen: seen ? 0 : 5,
  }]);
  if (p.startsWith("/rest/v1/rpc/")) return json(res, null);
  if (p.startsWith("/rest/v1/")) {
    if (p.endsWith("instructor_profiles")) return json(res, [{
      user_id: "11111111-1111-1111-1111-111111111111", full_name: "Arif Mahmood",
      verification_status: "verified", listed: true, hourly_rate_cents: 4500,
      counties: ["Dublin"], lesson_types: ["edt"], transmissions: ["manual"] }]);
    return json(res, []);
  }
  try {
    res.setHeader("content-type", TYPES[extname(p)] || "application/octet-stream");
    res.end(await readFile(join(DIR, p)));
  } catch { res.statusCode = 404; res.end("no"); }
}).listen(5599);

const badge = (page) => page.evaluate(() => {
  const bell = document.querySelector('button[aria-haspopup="dialog"]');
  const b = bell?.querySelector("span span, span > span");
  const t = [...(bell?.querySelectorAll("span") || [])]
    .map(s => s.textContent.trim()).filter(t => /^\d+\+?$/.test(t));
  return t[0] || null;
});

const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const page = await b.newPage({ viewport: { width: 390, height: 844 } });
await page.goto("http://localhost:5599/");
await page.waitForSelector("text=Quick Actions", { timeout: 10000 });

let bad = 0;
const is = (what, actual, expected) => {
  if (String(actual) === String(expected)) console.log(`  ✓ ${what}`);
  else { console.log(`  ✗ ${what} — got ${actual}, expected ${expected}`); bad++; }
};

is("the bell shows what has arrived", await badge(page), "5");

await page.locator('button[aria-haspopup="dialog"]').first().click();
await page.waitForTimeout(600);
is("the panel still lists the outstanding work", await page.getByText("booking request").count() > 0, true);

await page.keyboard.press("Escape");
await page.waitForTimeout(600);
is("the badge is gone after reading it", await badge(page), "null");

/* And the work itself must NOT have been cleared by looking — a request
   nobody answered is still a person waiting. */
const tabBadge = await page.evaluate(() => {
  const tab = [...document.querySelectorAll("button")]
    .find(el => (el.getAttribute("aria-label") || "").startsWith("Bookings"));
  return (tab?.textContent || "").replace("Bookings", "").trim();
});
is("the Bookings tab still shows its outstanding count", tabBadge, "1");

console.log(bad ? `\n${bad} failed` : "\nthe bell clears on reading; the work does not");
await b.close(); server.close();
process.exit(bad ? 1 : 0);
