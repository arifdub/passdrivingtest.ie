/* Can an open menu be dismissed?
 *
 * A menu that only closes by hitting the same button again feels stuck, and
 * on a phone it is worse: the panel covers what you were aiming at, so the
 * next tap lands on the panel and nothing happens. This drives the real
 * thing and asserts each way out actually works.
 */
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
  if (p.startsWith("/rest/v1/rpc/"))
    return json(res, p.endsWith("my_waiting")
      ? [{ booking_requests: 1, new_enquiries: 2, unread_messages: 0, lessons_today: 0 }] : null);
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

const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const page = await b.newPage({ viewport: { width: 390, height: 844 } });
await page.goto("http://localhost:5599/");
await page.waitForSelector("text=Quick Actions", { timeout: 10000 });

const account = page.getByRole("button", { name: "Account menu" });
const bell = page.locator('button[aria-haspopup="dialog"]').first();
const signedIn = page.getByText("Signed in as");
const panel = page.getByText("This only updates while the app is open");

let bad = 0;
const check = async (what, fn) => {
  try { await fn(); console.log(`  ✓ ${what}`); }
  catch (e) { console.log(`  ✗ ${what} — ${e.message.split("\n")[0]}`); bad++; }
};

await check("account menu opens", async () => {
  await account.click();
  await signedIn.waitFor({ state: "visible", timeout: 2000 });
});

await check("…and closes when you tap the page behind it", async () => {
  await page.mouse.click(60, 700);
  await signedIn.waitFor({ state: "hidden", timeout: 2000 });
});

await check("…and closes on Escape", async () => {
  await account.click();
  await signedIn.waitFor({ state: "visible", timeout: 2000 });
  await page.keyboard.press("Escape");
  await signedIn.waitFor({ state: "hidden", timeout: 2000 });
});

await check("notification panel opens", async () => {
  await bell.click();
  await panel.waitFor({ state: "visible", timeout: 2000 });
});

await check("…and closes when you tap elsewhere", async () => {
  await page.mouse.click(60, 700);
  await panel.waitFor({ state: "hidden", timeout: 2000 });
});

await check("tapping the bell closes the account menu and opens the panel", async () => {
  await account.click();
  await signedIn.waitFor({ state: "visible", timeout: 2000 });
  await bell.click();
  await signedIn.waitFor({ state: "hidden", timeout: 2000 });
  await panel.waitFor({ state: "visible", timeout: 2000 });
});

await check("and the reverse", async () => {
  await account.click();
  await panel.waitFor({ state: "hidden", timeout: 2000 });
  await signedIn.waitFor({ state: "visible", timeout: 2000 });
  await page.keyboard.press("Escape");
});

await check("a bottom tab is reachable while a menu is open", async () => {
  await bell.click();
  await panel.waitFor({ state: "visible", timeout: 2000 });
  /* The old backdrop sat at the tab bar's own z-index, so this tap used to
     land on nothing. Two taps are honest: the first dismisses, the second
     navigates — but the tab must be reachable, not inert. */
  await page.getByRole("button", { name: "Students" }).first().click();
  await panel.waitFor({ state: "hidden", timeout: 2000 });
  await page.getByRole("button", { name: "Students" }).first().click();
  await page.waitForTimeout(400);
  const title = (await page.locator("h1").first().textContent() || "").trim();
  if (title !== "Students") throw new Error(`landed on "${title}"`);
});

console.log(bad ? `\n${bad} failed` : "\nevery menu dismisses");
await b.close(); server.close();
process.exit(bad ? 1 : 0);
