import assert from "node:assert/strict";
import test from "node:test";
import { setBrowserRouteTitle, setBrowserMediaTitle } from "./browserDocumentTitle.js";

test("hosted analytics tracks only generic screens and respects privacy preferences", async () => {
  const scripts = [];
  const views = [];
  globalThis.window = {
    location: { hostname: "localhost", href: "https://nuvioweb.space/?token=private#secret" },
    navigator: { language: "en-US" },
    screen: { width: 1920, height: 1080 }
  };
  globalThis.document = {
    title: "Private media title",
    referrer: "https://example.com/private/path?token=private#secret",
    createElement: () => ({ dataset: {} }),
    head: { appendChild: (script) => scripts.push(script) }
  };
  try {
    setBrowserRouteTitle("home");
    window.location.hostname = "self-hosted.example";
    setBrowserRouteTitle("home");
    window.location.hostname = "nuvioweb.space";
    window.navigator.doNotTrack = "1";
    setBrowserRouteTitle("home");
    window.navigator.doNotTrack = "0";
    window.navigator.globalPrivacyControl = true;
    setBrowserRouteTitle("home");
    assert.equal(scripts.length, 0);

    window.navigator.globalPrivacyControl = false;
    setBrowserRouteTitle("unknown-route-with-private-data");
    assert.equal(scripts.length, 0);
    setBrowserRouteTitle("home");
    setBrowserRouteTitle("library");
    assert.equal(scripts.length, 1);
    assert.equal(scripts[0].src, "https://cloud.umami.is/script.js");
    assert.equal(scripts[0].dataset.autoTrack, "false");
    assert.equal(scripts[0].referrerPolicy, "no-referrer");
    assert.equal(views.length, 0);

    window.umami = { track: (payload) => views.push(payload) };
    scripts[0].onload();
    assert.deepEqual(views[0], {
      website: "551048bd-896f-4db1-82f1-6e221709955f",
      hostname: "nuvioweb.space",
      url: "/library",
      title: "Library - NuvioWeb",
      referrer: "https://example.com",
      language: "en-US",
      screen: "1920x1080"
    });
    setBrowserRouteTitle("library");
    setBrowserMediaTitle({ title: "Private media", episodeTitle: "Private episode" });
    assert.equal(views.length, 1);
    setBrowserRouteTitle("player");
    assert.equal(views[1].title, "Player - NuvioWeb");
    assert.equal(views[1].referrer, "https://nuvioweb.space/library");
    setBrowserRouteTitle("home");
    assert.equal(views[2].url, "/");
    assert.ok(!JSON.stringify(views).includes("private"));

    window.navigator.globalPrivacyControl = true;
    setBrowserRouteTitle("calendar");
    assert.equal(views.length, 3);
    window.navigator.globalPrivacyControl = false;
    window.umami.track = () => { throw new Error("blocked"); };
    assert.doesNotThrow(() => setBrowserRouteTitle("calendar"));
    window.umami.track = () => Promise.reject(new Error("offline"));
    setBrowserRouteTitle("search");
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(scripts.length, 1);
  } finally {
    delete globalThis.window;
    delete globalThis.document;
  }
});
