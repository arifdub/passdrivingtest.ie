/*
  ===========================================================================
  ENTRY POINT

  Mounts the app and nothing else. The theme class on <html> is set by the
  inline script in app/index.html before this file runs, so the page never
  flashes white on the way into dark mode.
  ===========================================================================
*/

import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";

const el = document.getElementById("root");

if (!el) {
  /* A missing #root used to produce a blank page and no clue why. Say it
     out loud instead — on a phone there is no console to check. */
  document.body.innerHTML =
    '<pre style="padding:24px;font:14px system-ui">No #root element in the page. ' +
    'app/index.html must contain &lt;div id="root"&gt;&lt;/div&gt;.</pre>';
} else {
  createRoot(el).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  );
}
