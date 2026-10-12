/*
  The install guide has to point at the right button on the right phone.
  Real user-agent strings, so a change to the detection that breaks one
  browser shows up here instead of on somebody's phone.
*/

import React from "react";
import { renderToString } from "react-dom/server";
import { describe, it, expect } from "vitest";
import { detectDevice } from "../usePwaInstall";
import InstallPopup, { guideFor } from "../InstallPopup";

const UA = {
  iphoneSafari: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1",
  iphoneChrome: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/129.0.6668.69 Mobile/15E148 Safari/604.1",
  ipad: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15",
  androidChrome: "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Mobile Safari/537.36",
  samsung: "Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/25.0 Chrome/121.0.0.0 Mobile Safari/537.36",
  instagram: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 340.0.0.0",
  facebookAndroid: "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Mobile Safari/537.36 [FBAN/EMA;FBLC/en_GB;FBAV/400.0.0.0]",
  mac: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15",
};

describe("which phone and browser", () => {
  it("tells an iPad (which claims to be a Mac) from a real Mac by touch", () => {
    expect(detectDevice(UA.ipad, 5)).toMatchObject({ ios: true, ipad: true });
    expect(detectDevice(UA.mac, 0)).toMatchObject({ ios: false, ipad: false });
  });

  it("knows Chrome on an iPhone is Chrome, not Safari", () => {
    expect(detectDevice(UA.iphoneChrome).browser).toBe("chrome");
    expect(detectDevice(UA.iphoneSafari).browser).toBe("safari");
  });

  it("knows Samsung Internet, which also says Chrome", () => {
    expect(detectDevice(UA.samsung).browser).toBe("samsung");
  });

  it("knows an in-app browser, which cannot install at all", () => {
    expect(detectDevice(UA.instagram).inApp).toBe(true);
    expect(detectDevice(UA.facebookAndroid).inApp).toBe(true);
    expect(detectDevice(UA.androidChrome).inApp).toBe(false);
  });
});

describe("where the arrow points", () => {
  it("iPhone Safari: down, at the bottom bar's Share", () => {
    const g = guideFor("ios-safari", detectDevice(UA.iphoneSafari));
    expect(g.where).toBe("bottom");
    expect(g.steps[0][1]).toMatch(/Share/);
  });

  it("iPad Safari: top right, where its Share is", () => {
    expect(guideFor("ios-safari", detectDevice(UA.ipad, 5)).where).toBe("top-right");
  });

  it("Chrome on iPhone: top right, the Share in the address bar", () => {
    const g = guideFor("ios-other", detectDevice(UA.iphoneChrome));
    expect(g.where).toBe("top-right");
    expect(g.steps[0][1]).toMatch(/address bar/);
  });

  it("Android Chrome with the install prompt available: one button, no arrow", () => {
    const g = guideFor("prompt", detectDevice(UA.androidChrome));
    expect(g.kind).toBe("prompt");
    expect(g.where).toBeNull();
  });

  it("Android Chrome without it: the ⋮ menu, top right", () => {
    expect(guideFor("android", detectDevice(UA.androidChrome)).where).toBe("top-right");
  });

  it("Samsung Internet: its menu, bottom right", () => {
    expect(guideFor("android", detectDevice(UA.samsung)).where).toBe("bottom-right");
  });

  it("an in-app browser is sent to the real browser first, whatever the phone", () => {
    const g = guideFor("ios-safari", detectDevice(UA.instagram));
    expect(g.steps[1][1]).toMatch(/Open in browser/);
  });

  it("nothing on a computer, and nothing once installed", () => {
    expect(guideFor("desktop", detectDevice(UA.mac))).toBeNull();
    expect(guideFor("installed", detectDevice(UA.iphoneSafari))).toBeNull();
  });
});

describe("the popup", () => {
  it("does not appear on first paint, so it never covers the page as it loads", () => {
    expect(renderToString(<InstallPopup app="instructor" />)).toBe("");
  });
});
