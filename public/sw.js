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

/* ---------------------------------------------------------------------------
   PUSH

   This is the part that runs when the app is closed. The browser wakes this
   worker, hands it an encrypted payload the server signed with the VAPID
   private key, and gives it a few seconds to show something.

   A push that arrives and shows nothing is not allowed: on Chrome and
   Firefox, failing to call showNotification revokes the site's permission
   after a few offences. So every branch below ends in a notification, even
   the one where the payload could not be read.
   --------------------------------------------------------------------------- */

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (e) {
    // A malformed or unencrypted payload. Still has to show something.
    data = {};
  }

  const title = data.title || "PassDrivingTest";
  const options = {
    body: data.body || "Something is waiting in your portal.",
    icon: "/adi-icon-192.png",
    badge: "/adi-icon-192.png",
    // Collapses repeats: three messages in a thread replace each other
    // rather than stacking three identical banners.
    tag: data.tag || "pdt-notify",
    renotify: true,
    data: { url: data.url || "/adi" },
  };

  /* The number on the home-screen icon.

     Badging is a separate thing from the notification itself: the banner
     is the alert, the badge is what is still waiting afterwards. iOS 16.4+
     supports it for an installed web app, and ignores it otherwise, so a
     phone that cannot do this simply shows the banner and no number.

     The count comes from the server because this worker has no session and
     cannot ask the database itself. When the payload carries no count —
     an older server, or the lookup failed — the badge is left exactly as
     it is rather than guessed at or cleared. */
  const badge = Number(data.badge);

  event.waitUntil((async () => {
    await self.registration.showNotification(title, options);
    try {
      if (Number.isFinite(badge) && badge > 0) {
        await self.navigator?.setAppBadge?.(badge);
      } else if (badge === 0) {
        await self.navigator?.clearAppBadge?.();
      }
    } catch {
      /* Unsupported, or refused. The notification has already been shown,
         which is the part that matters. */
    }
  })());
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = event.notification.data?.url || "/adi";

  // Focus a tab that is already on the site rather than opening a fifth one.
  event.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const client of all) {
      if (client.url.includes(new URL(url, self.location.origin).pathname)) {
        await client.focus();
        return;
      }
    }
    for (const client of all) {
      if ("navigate" in client) {
        await client.navigate(url);
        await client.focus();
        return;
      }
    }
    await self.clients.openWindow(url);
  })());
});

/* A subscription can be rotated by the browser without the user doing
   anything. Without this the old endpoint goes dead and the device quietly
   stops receiving — the classic "it worked for a week" push bug.

   The page itself re-saves on every load, which covers the common case;
   this covers a rotation that happens while nothing is open. */
self.addEventListener("pushsubscriptionchange", (event) => {
  event.waitUntil((async () => {
    const clientsList = await self.clients.matchAll({ includeUncontrolled: true });
    for (const client of clientsList) {
      client.postMessage({ type: "push-subscription-changed" });
    }
  })());
});
