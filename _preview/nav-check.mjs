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

const SECTIONS = ["Students","Calendar","Enquiries","Bookings","Availability","Marketplace","Earnings","Reviews","Messages","Account"];
const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const page = await b.newPage({ viewport: { width: 390, height: 844 } });
await page.goto("http://localhost:5599/");
await page.waitForSelector("text=Quick Actions", { timeout: 10000 });

let bad = 0;
for (const name of SECTIONS) {
  await page.evaluate(() => window.scrollTo(0, 0));
  const hit = page.getByRole("button", { name, exact: true }).first();
  if (!(await hit.count())) { console.log(`  ✗ ${name}: no way in from home`); bad++; continue; }
  await hit.click();
  await page.waitForTimeout(350);
  const title = (await page.locator("h1").first().textContent() || "").trim();
  // Either a tab is lit, or there is a back arrow. Something must get you out.
  const back = await page.getByRole("button", { name: "Back to home" }).count();
  const onTab = ["Students","Calendar","Account"].includes(name);
  if (!back && !onTab) { console.log(`  ✗ ${name}: no way back`); bad++; }
  else console.log(`  ✓ ${name} → "${title}"${back ? " (back arrow)" : " (tab)"}`);
  // Return home for the next one.
  if (back) await page.getByRole("button", { name: "Back to home" }).click();
  else await page.getByRole("button", { name: "Home" }).click();
  await page.waitForTimeout(250);
}
console.log(bad ? `\n${bad} stranded` : "\nevery section reachable, and every one has a way out");
await b.close(); server.close();
process.exit(bad ? 1 : 0);
