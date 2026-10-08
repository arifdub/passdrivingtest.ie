import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
const HERE = fileURLToPath(new URL(".", import.meta.url));

/* No module stubbing. The real supabase client is pointed at a local server
   that answers the RPCs, so what gets photographed is the production code
   path — the same fetch, the same parsing, the same empty-state branches —
   rather than a version of the screen that only exists in a test. */
export default defineConfig({
  root: HERE,
  plugins: [react()],
  define: {
    "import.meta.env.VITE_SUPABASE_URL": JSON.stringify("http://localhost:5599"),
    "import.meta.env.VITE_SUPABASE_ANON_KEY": JSON.stringify("preview-key"),
  },
  build: { outDir: "dist", emptyOutDir: true },
});
