/* Every icon the built pages reference must actually be in the build.

   Written because the instructor app showed a letter tile instead of its
   icon, and a missing file and a cached one look identical from here. This
   cannot tell you what iOS decided to draw, but it can tell you whether
   the thing it was offered exists — and that is the half that is checkable.

   Run against dist/, so it needs a build first. */

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const DIST = "dist";
let bad = 0;
const is = (what, ok) => {
  if (ok) console.log(`  ✓ ${what}`);
  else { console.log(`  ✗ ${what}`); bad++; }
};

if (!existsSync(DIST)) {
  console.log("dist/ is missing — run the build first");
  process.exit(1);
}

for (const page of ["index.html", "adi/index.html", "app/index.html"]) {
  const path = join(DIST, page);
  if (!existsSync(path)) { is(`${page} exists`, false); continue; }
  const html = readFileSync(path, "utf8");

  /* Every local href on an icon or manifest link. */
  const refs = [...html.matchAll(/<link[^>]+rel="(?:icon|apple-touch-icon(?:-precomposed)?|manifest)"[^>]*>/g)]
    .map(m => (m[0].match(/href="([^"]+)"/) || [])[1])
    .filter(h => h && h.startsWith("/"));

  is(`${page} references at least one icon`, refs.length > 0);

  for (const ref of new Set(refs)) {
    is(`${page} → ${ref}`, existsSync(join(DIST, ref.replace(/^\//, ""))));
  }
}

/* The instructor page specifically: iOS reads apple-touch-icon once, at
   install, and picks by rule rather than preference. A sized link alone
   leaves older iOS with nothing. */
const adi = readFileSync(join(DIST, "adi/index.html"), "utf8");
const appleLinks = adi.match(/<link[^>]+rel="apple-touch-icon(?:-precomposed)?"[^>]*>/g) || [];
is("the instructor page offers a sized apple-touch-icon",
  appleLinks.some(l => l.includes("180x180")));
is("and an unsized one, for when no size matches",
  appleLinks.some(l => l.includes('rel="apple-touch-icon"') && !l.includes("sizes=")));
is("and a precomposed one, for older iOS",
  appleLinks.some(l => l.includes("precomposed")));

/* Each manifest's own icons, which is a separate list from the links. */
for (const m of ["manifest.json", "manifest-adi.json", "manifest-admin.json"]) {
  const path = join(DIST, m);
  if (!existsSync(path)) { is(`${m} exists`, false); continue; }
  for (const icon of JSON.parse(readFileSync(path, "utf8")).icons || []) {
    is(`${m} → ${icon.src}`, existsSync(join(DIST, icon.src.replace(/^\//, ""))));
  }
}

console.log(bad ? `\n${bad} missing` : "\nevery referenced icon is in the build");
process.exit(bad ? 1 : 0);
