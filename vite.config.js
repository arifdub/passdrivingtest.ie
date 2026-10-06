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

  THREE STATIC PAGES, ONE APP

    /                      index.html                    the front door:
                           what this is, and the two
                           doors into it
    /driver-theory-test/   driver-theory-test/index.html the full guide to
                           the Driver Theory Test — the
                           page that ranks
    /app/                  app/index.html                the React app

  ONE BUNDLE, FOUR ADDRESSES

  The app is served at /student, /adi, /admin and /app. All four are rewritten
  to app/index.html (see vercel.json) and the router reads the real path, so
  an instructor can be sent passdrivingtest.ie/adi and a learner
  passdrivingtest.ie/student without either being a separate build.

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
      },
    },
  },
});
