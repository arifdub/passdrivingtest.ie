/*
  ===========================================================================
  PWA INSTALL

  Tells the Profile screen which of four situations it's in:

    installed  — already running from the home screen, nothing to offer
    prompt     — Android / Chrome / Edge, where the browser will show a real
                 install dialog when we ask it to
    ios        — iPhone or iPad Safari, which has no install API at all, so
                 the only option is telling them where the button is
    desktop    — everything else; installable in some browsers, not worth a
                 pushy prompt

  The Android side works by catching `beforeinstallprompt`, which fires once
  and only if the browser considers the site installable. We stash the event
  and fire it later when the user actually taps the button — the browser
  won't let us call it from anywhere else.

  This needs public/manifest.json and public/sw.js, which the project already
  has from v3.1.
  ===========================================================================
*/

import { useState, useEffect, useCallback } from "react";

function detectStandalone() {
  if (typeof window === "undefined") return false;
  return (
    window.matchMedia?.("(display-mode: standalone)").matches ||
    // iOS Safari uses its own non-standard flag rather than display-mode.
    window.navigator.standalone === true
  );
}

function detectIOS() {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent || "";
  const isIPhoneOrIPod = /iPhone|iPod/.test(ua);
  // iPadOS 13+ reports itself as a Mac, so a Mac with a touchscreen is an
  // iPad. Real Macs report maxTouchPoints of 0.
  const isIPad = /iPad/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
  return isIPhoneOrIPod || isIPad;
}

export default function usePwaInstall() {
  const [deferred, setDeferred] = useState(null);
  const [installed, setInstalled] = useState(detectStandalone);
  const [isIOS] = useState(detectIOS);

  useEffect(() => {
    function onBeforeInstall(e) {
      // Stop Chrome's own mini-infobar so the button in Profile is the only
      // place this is offered.
      e.preventDefault();
      setDeferred(e);
    }
    function onInstalled() {
      setInstalled(true);
      setDeferred(null);
    }

    window.addEventListener("beforeinstallprompt", onBeforeInstall);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onBeforeInstall);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  const promptInstall = useCallback(async () => {
    if (!deferred) return { ok: false };
    deferred.prompt();
    const { outcome } = await deferred.userChoice;
    // The event can only be used once, whatever they chose.
    setDeferred(null);
    return { ok: outcome === "accepted" };
  }, [deferred]);

  const state = installed
    ? "installed"
    : deferred
      ? "prompt"
      : isIOS
        ? "ios"
        : "desktop";

  return { state, promptInstall };
}
