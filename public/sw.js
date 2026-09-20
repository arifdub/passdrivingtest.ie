// Service worker.
//
// Its job is to satisfy Chrome's installability check so "Add to Home Screen"
// gives a real full-screen app rather than a bookmark. It caches nothing.
//
// WHY THIS VERSION EXISTS
// The site came up as a blank white page on this domain while the same
// build loaded fine on the .vercel.app URL. The cause was a stale index.html
// held in the browser: it pointed at the previous build's hashed asset files,
// which no longer exist, so every script 404'd and nothing rendered.
//
// Two changes guard against that happening again:
//
//   1. On activate, every cache this origin holds is deleted. That clears
//      anything a previous service worker left behind on devices already out
//      in the wild.
//
//   2. Navigation requests are fetched with cache: "reload", which forces the
//      browser to go to the network for the HTML rather than reusing its own
//      cached copy. The HTML is tiny; the hashed assets it references are the
//      big files, and those are safe to cache forever because their names
//      change whenever their contents do.

const SW_VERSION = "v3-no-cache";

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      // Bin anything a previous version cached.
      const names = await caches.keys();
      await Promise.all(names.map((n) => caches.delete(n)));
      await self.clients.claim();
      console.log("Service worker active:", SW_VERSION, "— caches cleared");
    })()
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;

  // Page loads: always go to the network for fresh HTML.
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request, { cache: "reload" }).catch(
        () =>
          new Response(
            "<!doctype html><meta charset=utf-8><title>Offline</title>" +
              "<body style='font-family:system-ui;padding:2rem;text-align:center'>" +
              "<h1>You're offline</h1><p>Reconnect and try again.</p>",
            { headers: { "Content-Type": "text/html" } }
          )
      )
    );
    return;
  }

  // Everything else passes straight through, uncached.
  event.respondWith(fetch(request));
});

// Lets the app tell a waiting worker to take over immediately.
self.addEventListener("message", (event) => {
  if (event.data === "SKIP_WAITING") self.skipWaiting();
});
