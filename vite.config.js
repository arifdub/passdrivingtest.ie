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

  DEEP LINKS UNDER /app

  The app now does have a router, so /app/student, /app/instructor and
  anything added later are real addresses — ones a learner can bookmark, be
  sent, or be returned to by a confirmation email.

  Those paths are not files. Without a rewrite the hosting layer looks for
  one, finds nothing and returns 404 — the classic single-page-app deployment
  bug, and one that never shows up in `vite dev`. The rule lives in
  vercel.json, which is pure data: Vercel validates it against a strict schema
  and rejects any key it doesn't recognise, so it cannot carry a comment of
  its own and the reasoning is written down here instead.

  Rewrites are checked after the filesystem, so /app/index.html and the hashed
  assets under /assets/ are still served directly, and the landing page at /
  is untouched.
*/
export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      input: {
        landing: "index.html",
        app: "app/index.html",
      },
    },
  },
});
