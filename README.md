# PassDrivingTest.ie

Irish Driver Theory Test practice, plus a public guide to the test at `/`.

This is a **separate project** from PassADITest.ie. Separate repository,
separate Vercel project, separate Supabase project, separate domain. See
[Keeping them apart](#keeping-them-apart) — one of those separations is not
optional.

---

## What was already here, and what wasn't

The folder you had held the app, converted and working. Three things were
missing and are now done:

| | Was | Now |
|---|---|---|
| `index.html` | one line: `placeholder landing page` | full SEO landing page |
| `public/` | empty | icons, manifest, robots, sitemap, service worker, llms.txt, social card |
| `sql/` | empty | complete schema in one file |

The app source itself needed one change: `Logo` in `src/ui.jsx` (see below).

---

## Setting it up

### 1. Push to a new GitHub repository

Everything in this folder goes in, at the root. `node_modules` and `dist` are
already in `.gitignore`.

### 2. Create a Supabase project and run the SQL

New project → **SQL Editor** → paste all of `sql/01-setup.sql` → Run.

It creates `profiles`, `progress`, the row-level security policies, the
sign-up trigger and the `record_result` function. It is safe to run twice.

The commented-out block at the bottom is a check — uncomment and run it to
confirm you get both tables and a six-argument `record_result`.

### 3. Deploy on Vercel

Import the repository. Framework preset **Vite**; the build command and output
directory are detected. Add two environment variables from
Supabase → Settings → API:

```
VITE_SUPABASE_URL        https://your-project-ref.supabase.co
VITE_SUPABASE_ANON_KEY   your anon public key
```

The anon key belongs in the browser — row-level security is what actually
protects the data. The `service_role` key does not, ever.

### 4. Point the domain at it

Vercel → Settings → Domains → `passdrivingtest.ie`. Then remove that domain
from the ADI project, or the two will fight over it.

### 5. Google Search Console

Add `passdrivingtest.ie`, verify, submit `https://passdrivingtest.ie/sitemap.xml`,
then use URL Inspection on the homepage and Request Indexing.

---

## Keeping them apart

**The two sites must not share a Supabase project.** Both apps have tables
called `profiles` and `progress` and a function called `record_result`, and
both write module ids into the same column. Pointed at one database they would
read and overwrite each other's rows, and nothing would error — a learner's ADI
mock score would just quietly appear against a theory test module. Two
products, two databases.

Separate Vercel projects and repositories matter much less; they are just
tidiness. The database one is the trap.

---

## The landing page

One self-contained file, no build step, no framework, no blocking JavaScript.
Everything is inline so the page is readable in one request.

Structure: what the test is (with the format table for every category) →
booking and test day → after you pass → costs → the two rule changes coming on
1 November 2026 → accessibility and languages → the app → FAQ.

**On the figures.** Every fee, duration and rule was checked in September 2026
against theorytest.ie (the official provider, Prometric Ireland), rsa.ie,
ndls.ie and citizensinformation.ie. Where no authoritative source states
something, the page does not state it either. Three specific gaps, so you know
they are deliberate rather than oversights:

- **No lateness grace period.** Nothing official publishes one. The page says
  arrive 30 minutes early and that arriving late can cost the fee.
- **No figure for how much extra time an accommodation grants.** Not published.
  The page says to ask when arranging it.
- **No claim that the question bank has been updated for the February 2025
  speed limits.** The last documented test revision is July 2024 and the current
  official revision material is the May 2024 edition, both of which predate the
  change. There is no published statement either way, so the page says exactly
  that and tells learners to know the 60 km/h rural default regardless.

One source conflict worth knowing about: citizensinformation gives the
cancellation threshold as five business days, theorytest.ie gives seven
calendar days. The page uses theorytest.ie's, because the provider sets the
policy.

### Verified

```
horizontal scroll, 390px and 1280px      none
all icon links                           200, correct content-type
every rel="icon" square, multiple of 48  48 / 96 / 192
JSON-LD                                  parses; Organization, WebSite,
                                         WebApplication, HowTo, FAQPage
FAQ markup vs visible text               12 of 12 match exactly
scroll reveals                           12 of 12 complete, none stuck hidden
counters                                 settle at 393 / 240 / 4
contrast, 24 colour pairs                all pass WCAG AA
network/JS errors                        none
```

Rendered in a real browser, not read off the markup. The FAQ check matters
because markup describing content a visitor cannot see is grounds for a manual
action rather than a ranking boost, and it is easy to let the two drift.

---

## The logo

Same wheel as the ADI site, recoloured from green to blue — same shape so it
still reads as one family, clearly a different site at a glance.

The recolour rebuilds each green pixel at the new hue while keeping its own
saturation and brightness, so all the 3D shading and the highlights survive.
Two things that had to be got right:

- The hue mask starts at 40°, not 70°. The artwork's highlights run
  **yellow**-green, and a mask that catches only green leaves yellow streaks
  across a blue tick.
- The icons are cropped tight to the disc, which meant cutting away the speed
  lines. Those attach directly to the rim, so a straight vertical crop cannot
  remove them — the mask is a circle, fitted to the disc's own edge (residual
  0.4px over 124 sample points) with everything outside it on the left dropped.

Icon sizes are 48, 96 and 192 — all multiples of 48, which is Google's rule for
the favicon beside a search result. `favicon.ico` also sits at the site root,
because that is the path Google and older browsers try by convention with no
link tag at all.

`og-card.png` is a proper 1200×630 social card rather than a reused square
logo, which gets letterboxed with grey bars by every platform.

### `src/ui.jsx` changed

The ADI `logo.png` has its wordmark baked into the image, so it could not be
reused. Rather than fake that glossy 3D lettering to say a different word,
`Logo` now renders the wheel with the name in **live text** underneath. It
stays crisp at any size, adapts to dark mode, is selectable and readable by a
screen reader, and weighs nothing.

---

## Two things I did not do, and why

### 1. The app is still green inside

The landing page is blue. The app's light theme is still the ADI sage-green
paper with emerald accents — 193 references across the source.

I could remap them: 17 distinct class names, and the CSS-override technique
already in `app/index.html` would do it without touching the JSX. **But npm is
blocked in the environment I was working in, so I could not build or render the
React app to check the result.** A partly-applied override gives you a page
that is blue in some places and green in others, which is worse than being
consistently green — and it is exactly the kind of thing that looks fine in the
diff and wrong on the screen.

So the app is internally consistent as it stands, just not matched to the
landing page. Say the word and I will do it properly with the app actually
rendering in front of me.

### 2. The question bank needs work before this takes money

Measured, not guessed: **98% of distractors in the written questions are
another question's correct answer.** The bank was generated by pairing
flashcard fronts with other flashcards' backs. Often that is fine. Often it is
not:

> **What must a horse-drawn vehicle carry at night?**
> · Two brakes — one on the front wheel, one on the back.
> · An approved safety frame, to protect the driver in a rollover.
> · **Two red rear reflectors, and a lamp showing white to the front…** ✓
> · Stop and remain stopped until the children have crossed…

Only one option is about lights. You do not need to know the rule.

I read 18 spread evenly across the bank; **about 10 had at least one distractor
answering a different question entirely.** Worth knowing: my automated checks
said the bank was clean — answer positions balanced at 23/25/27/24, "pick the
longest" at 24% against 25% chance. Those tests were measuring the wrong thing.
The giveaway here is meaning, and no lexical test catches it.

Accurate size: **393 questions = 269 sign questions** (all the same "What does
this sign mean?" over different images) **+ 124 written.** The official Irish
bank is around 800. The landing page says 393 questions, 240 road signs and 4
mock papers, which are all true — but the 124 written questions are the ones
doing the real work, and a share of them are easier than the test.

Rewriting distractors so each one is a plausible wrong answer to *that*
question is the highest-value work left on this project.

---

## Project shape

```
index.html          landing page  — indexed
app/index.html      the React app — noindex
src/                app source
public/             served at the site root
sql/01-setup.sql    run once in a new Supabase project
```

`vite.config.js` builds both HTML entries, so `dist/index.html` and
`dist/app/index.html` come out and Vercel serves `/app` with no rewrite rule.

The app is a PWA: `manifest.json` scopes it to `/app/`, and the landing page
redirects to `/app/` when launched from a home-screen icon, so an icon added
while reading the landing page still opens the app rather than the marketing
page.
