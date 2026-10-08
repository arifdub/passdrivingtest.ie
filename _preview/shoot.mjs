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

const server = createServer(async (req, res) => {
  const p = req.url === "/" ? "/index.html" : req.url.split("?")[0];

  if (p.startsWith("/rest/v1/rpc/")) {
    const fn = p.slice("/rest/v1/rpc/".length);
    res.setHeader("content-type", "application/json");
    res.setHeader("access-control-allow-origin", "*");
    res.setHeader("access-control-allow-headers", "*");
    if (req.method === "OPTIONS") { res.statusCode = 204; return res.end(); }
    if (fn === "open_slots") return res.end(JSON.stringify(slots()));
    return res.end(JSON.stringify(null));
  }

  try {
    const buf = await readFile(join(DIR, p));
    res.setHeader("content-type", TYPES[extname(p)] || "application/octet-stream");
    res.end(buf);
  } catch { res.statusCode = 404; res.end("no"); }
}).listen(5599);

const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
for (const [name, w, h] of [["390", 390, 844], ["320", 320, 640]]) {
  const page = await b.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 2 });
  await page.goto("http://localhost:5599/");
  page.on("pageerror", e => console.log("  [pageerror]", e.message));
  await page.waitForSelector("text=Time", { timeout: 10000 });
  await page.screenshot({ path: `${process.argv[2]}/book-${name}.png` });

  const overflow = await page.evaluate(() =>
    document.documentElement.scrollWidth > document.documentElement.clientWidth);
  const small = await page.evaluate(() =>
    [...document.querySelectorAll("button")]
      .map(el => ({ t: el.textContent.trim().slice(0,12), r: el.getBoundingClientRect() }))
      .filter(x => x.r.width > 0 && x.r.height > 0 && (x.r.height < 40 || x.r.width < 40))
      .map(x => `${x.t} ${Math.round(x.r.width)}x${Math.round(x.r.height)}`));
  const visibleTimes = await page.evaluate(() => {
    const vh = window.innerHeight;
    return [...document.querySelectorAll("button")]
      .filter(el => /^\d{2}:\d{2}$/.test(el.textContent.trim()))
      .filter(el => { const r = el.getBoundingClientRect(); return r.top >= 0 && r.bottom <= vh; })
      .length;
  });
  console.log(`${name}px  page-overflows-sideways=${overflow}  times-visible-without-scrolling=${visibleTimes}  under-40px=${small.length ? small.join(", ") : "none"}`);
  await page.close();
}
await b.close();
server.close();
