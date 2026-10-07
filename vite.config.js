import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

/*
  Two pages, not one.

    /       index.html      the landing page — plain HTML, no JavaScript,
                            this is what Google indexes
    /app    app/index.html  the React app

  Vite builds one HTML entry by default. Listing both here produces
  dist/index.html and dist/app/index.html, and Vercel serves /app from the
  second without any rewrite rule — a directory index is a directory index.

  TWO STATIC PAGES, ONE BUNDLE, TWO APP DOCUMENTS

    /                      index.html                    the front door:
                           what this is, and the two
                           doors into it
    /driver-theory-test/   driver-theory-test/index.html the full guide to
                           the Driver Theory Test — the
                           page that ranks
    /app/                  app/index.html                the learner's app
    /adi                   adi/index.html                the instructor's app

  ONE BUNDLE, FIVE ADDRESSES

  The app is served at /student, /adi, /admin and /app, and every one of them
  loads the same bundle and the same router, which reads the real path. So an
  instructor can be sent passdrivingtest.ie/adi and a learner
  passdrivingtest.ie/student without either being a separate build.

  WHY /adi HAS ITS OWN DOCUMENT ANYWAY

  Not for different code — for a different manifest. A manifest belongs to the
  document that links it and one document can link exactly one, so while /adi
  and /student were the same file there was one app name, one icon and one
  start_url between them: an instructor adding the portal to their home screen
  got an icon called PassDrivingTest that opened the learner's app. /student,
  /admin and /app still rewrite to app/index.html; only /adi has its own.

  /app is kept because home-screen icons point at it: the manifest's start_url
  is /app/, and iOS baked that into every icon already installed. Dropping it
  would 404 their app.

  Those paths are not files. Without the rewrite the hosting layer looks for
  one, finds nothing and returns 404 — the classic single-page-app deployment
  bug, and one that never shows up in `vite dev`. The rules live in
  vercel.json, which is pure data: Vercel validates it against a strict schema
  and rejects any key it doesn't recognise, so it cannot carry a comment of
  its own and the reasoning is written down here instead.

  Rewrites are checked after the filesystem, so the static pages and the
  hashed assets under /assets/ are still served directly.
*/
export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      input: {
        landing: "index.html",
        guide: "driver-theory-test/index.html",
        app: "app/index.html",
        /* The instructor's installable app. Same bundle, same router — a
           separate document only so it can carry its own manifest, name and
           icon. See adi/index.html. */
        adi: "adi/index.html",
        /* And the admin's. Same bundle again; a third document only so the
           admin portal can be installed as its own app with its own name and
           icon, rather than appearing on a home screen as the learner's. */
        admin: "admin/index.html",
      },
    },
  },
});
