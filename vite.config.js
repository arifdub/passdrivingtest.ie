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

  The app has no client-side router (navigation is React state), so there are
  no deep links under /app that need rewriting back to index.html.
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
