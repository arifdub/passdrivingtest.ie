/* Every section must be reachable from home, and every section must have a
   way back. A bottom bar with four tabs and eleven sections is exactly the
   shape where something ends up stranded. */
import { chromium } from "playwright";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join } from "node:path";

const DIR = "/home/user/passdrivingtest.ie/_preview/dist";
const TYPES = { ".html":"text/html", ".js":"text/javascript", ".css":"text/css" };
const json = (res, v) => {
  res.setHeader("content-type","application/json");
  res.setHeader("access-control-allow-origin","*");
  res.setHeader("access-control-allow-headers","*");
  res.end(JSON.stringify(v));
};
const server = createServer(async (req, res) => {
  const p = req.url === "/" ? "/index.html" : req.url.split("?")[0];
  if (req.method === "OPTIONS") { res.statusCode = 204; return res.end(); }
  if (p.startsWith("/rest/v1/rpc/")) return json(res, p.endsWith("my_waiting") ? [{booking_requests:1,new_enquiries:2,unread_messages:0,lessons_today:0}] : null);
  if (p.startsWith("/rest/v1/")) {
    if (p.endsWith("instructor_profiles")) return json(res, [{ user_id:"11111111-1111-1111-1111-111111111111", full_name:"Zain Ahmed", verification_status:"verified", listed:true, hourly_rate_cents:4500, counties:["Dublin"], lesson_types:["edt"], transmissions:["manual"] }]);
    return json(res, []);
  }
  try {
    res.setHeader("content-type", TYPES[extname(p)] || "application/octet-stream");
    res.end(await readFile(join(DIR, p)));
  } catch { res.statusCode = 404; res.end("no"); }
}).listen(5599);

/* Reached straight from home: the four quick tiles, the More list, and the
   four other tabs. "Hours" is the quick tile for Availability. */
const SECTIONS = ["Students","Calendar","Enquiries","Hours","Bookings","Messages","Marketplace","Earnings","Reviews","Profile & account"];
const TAB_NAMES = ["Students","Calendar","Bookings","Messages"];
const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const page = await b.newPage({ viewport: { width: 390, height: 844 } });
await page.goto("http://localhost:5599/");
await page.waitForSelector("text=Quick Actions", { timeout: 10000 });

let bad = 0;
for (const name of SECTIONS) {
  await page.evaluate(() => window.scrollTo(0, 0));
  /* A tab carrying a count announces itself as "Bookings, 1 waiting" — the
     label is deliberately more informative than the visible text, so the
     match cannot be exact for those. */
  const hit = TAB_NAMES.includes(name)
    ? page.getByRole("button", { name }).first()
    : page.getByRole("button", { name, exact: true }).first();
  if (!(await hit.count())) { console.log(`  ✗ ${name}: no way in from home`); bad++; continue; }
  await hit.click();
  await page.waitForTimeout(350);
  const title = (await page.locator("h1").first().textContent() || "").trim();
  // Either a tab is lit, or there is a back arrow. Something must get you out.
  const back = await page.getByRole("button", { name: "Back to home" }).count();
  const onTab = TAB_NAMES.includes(name);
  if (!back && !onTab) { console.log(`  ✗ ${name}: no way back`); bad++; }
  else console.log(`  ✓ ${name} → "${title}"${back ? " (back arrow)" : " (tab)"}`);
  // Return home for the next one.
  if (back) await page.getByRole("button", { name: "Back to home" }).click();
  else await page.getByRole("button", { name: "Home" }).first().click();
  await page.waitForTimeout(250);
}

/* The account section moved out of the bar and behind the photo, so the one
   route that matters most is the one a test would never think to try. */
await page.getByRole("button", { name: "Account menu" }).click();
await page.getByRole("button", { name: "Edit profile" }).click();
await page.waitForTimeout(400);
{
  const title = (await page.locator("h1").first().textContent() || "").trim();
  if (title === "Account") console.log('  ✓ "Edit profile" in the photo menu → "Account"');
  else { console.log(`  ✗ "Edit profile" landed on "${title}"`); bad++; }
}
console.log(bad ? `\n${bad} stranded` : "\nevery section reachable, and every one has a way out");
await b.close(); server.close();
process.exit(bad ? 1 : 0);
