import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const f = (n) => fileURLToPath(new URL(n, import.meta.url));

/* Only the two modules that need a real signed-in session are replaced, and
   they are replaced by SPECIFIER, matched before vite's own resolution —
   an earlier attempt matched on the resolved path, silently did nothing, and
   photographed an error screen while reporting success. The data layer is
   NOT replaced: the supabase client below is pointed at a local server, so
   what is photographed is the production code path. */
const previewAuth = {
  name: "preview-auth",
  enforce: "pre",
  resolveId(source) {
    if (/(^|\/)appAuth(\.jsx?)?$/.test(source))  return f("./fake-auth.jsx");
    if (/(^|\/)platform(\.jsx?)?$/.test(source)) return f("./fake-platform.jsx");
    return null;
  },
};

export default defineConfig({
  root: HERE,
  plugins: [previewAuth, react()],
  define: {
    "import.meta.env.VITE_SUPABASE_URL": JSON.stringify("http://localhost:5599"),
    "import.meta.env.VITE_SUPABASE_ANON_KEY": JSON.stringify("preview-key"),
  },
  build: { outDir: "dist", emptyOutDir: true },
});
