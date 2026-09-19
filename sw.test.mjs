import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("app shell precaches the local IMDb badge and Profile logo but not addon or catalog API responses", async () => {
  const source = await readFile(new URL("./sw.js", import.meta.url), "utf8");

  assert.match(source, /assets\/icons\/imdb_logo_2016\.svg/);
  assert.match(source, /assets\/brand\/app_logo_wordmark\.png/);
  assert.match(source, /if \(url\.origin !== self\.location\.origin\) return;/);
  assert.match(source, /new URL\(entry, self\.registration\.scope\)\.pathname === url\.pathname/);
  assert.doesNotMatch(source, /manifest\.json.*cache\.put|catalog.*cache\.put/i);
});

test("external playback push uses privacy-safe text and notification clicks focus only this worker scope", async () => {
  const source = await readFile(new URL("./sw.js", import.meta.url), "utf8");
  assert.match(source, /self\.addEventListener\("push"/);
  assert.match(source, /Playback updated\. Tap to return to NuvioWeb\./);
  assert.match(source, /Playback completed\. Tap to return to NuvioWeb\./);
  assert.match(source, /data: \{ type: "external-playback-return" \}/);
  assert.match(source, /self\.addEventListener\("notificationclick"/);
  assert.match(source, /self\.clients\.matchAll\(\{ type: "window", includeUncontrolled: true \}\)/);
  assert.match(source, /String\(client\.url \|\| ""\)\.startsWith\(scope\)/);
  assert.match(source, /self\.clients\.openWindow\(scope\)/);
  assert.doesNotMatch(source, /webapp:\/\//);
});


test("stable shell URLs revalidate online and preserve the newest copy for offline use", async () => {
  const { runInNewContext } = await import("node:vm");
  const source = (await readFile(new URL("./sw.js", import.meta.url), "utf8"))
    .replace("__NUVIO_LOCALE_ASSETS__", "[]");
  const origin = "https://nuvio.test";
  const handlers = {};
  const stored = new Map();
  let online = true;
  let status = 200;
  const requests = [];
  const cache = {
    async put(key, response) { stored.set(key, response); },
    async match(request) { return stored.get(origin + new URL(request.url).pathname)?.clone(); }
  };
  runInNewContext(source, {
    URL,
    self: { location: { origin }, registration: { scope: origin + "/" }, addEventListener(type, handler) { handlers[type] = handler; } },
    caches: { open: async () => cache, match: request => cache.match(request) },
    async fetch(request, options) {
      requests.push(options);
      if (!online) throw new Error("Offline");
      return new Response(status === 200 ? "new release" : "Unavailable", { status });
    }
  });
  async function load(pathname) {
    let response;
    const pending = [];
    handlers.fetch({ request: new Request(origin + pathname),
      respondWith(value) { response = value; }, waitUntil(value) { pending.push(value); } });
    const result = await response;
    await Promise.all(pending);
    return result;
  }
  for (const asset of ["/css/desktop.css?v=old", "/app.bundle.js?v=old"]) {
    const key = origin + new URL(asset, origin).pathname;
    stored.set(key, new Response("old release"));
    online = true; status = 200;
    assert.equal(await (await load(asset)).text(), "new release");
    assert.equal(requests.at(-1).cache, "no-cache");
    online = false;
    assert.equal(await (await load(asset)).text(), "new release");
    online = true; status = 503;
    assert.equal(await (await load(asset)).text(), "new release");
  }
  assert.equal(await load("/api/playback/health"), undefined, "API responses stay outside the shell cache");
  const before = requests.length;
  stored.set(origin + "/assets/fonts/jetbrains_sans_regular.ttf", new Response("font"));
  assert.equal(await (await load("/assets/fonts/jetbrains_sans_regular.ttf")).text(), "font");
  assert.equal(requests.length, before, "Fonts keep cache-first loading");
});
