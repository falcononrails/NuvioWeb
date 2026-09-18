import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

test("a rejected session refreshes once and retries with the new token", async () => {
  const source = (await readFile(new URL("./compatibilityPlayback.js", import.meta.url), "utf8"))
    .replace(/^import .*;\r?\n/gm, "").replace(/export /g, "");
  for (const refreshWorks of [true, false]) {
    const sessions = { accessToken: "old" };
    const sent = [];
    let refreshes = 0;
    const context = {
      SessionStore: sessions, AbortSignal,
      AuthManager: { async refreshSessionIfNeeded(options) {
        if (!options?.force) return true;
        refreshes++;
        sessions.accessToken = "new";
        return refreshWorks;
      } },
      async fetch(_url, { headers }) {
        sent.push(headers.Authorization);
        return sent.length === 1
          ? { status: 401, ok: false, json: async () => ({error: "Sign in again"}) }
          : { status: 200, ok: true, json: async () => ({id: "session"}) };
      }
    };
    vm.runInNewContext(source, context);
    const result = context.requestCompatibilityPlayback();
    if (refreshWorks) assert.equal((await result).id, "session");
    else await assert.rejects(result, /Sign in again/);
    assert.equal(refreshes, 1);
    assert.deepEqual(sent, refreshWorks ? ["Bearer old", "Bearer new"] : ["Bearer old"]);
  }
});

test("conversion resolves addon redirects in the browser and cancels the media body", async () => {
  const source = (await readFile(new URL("./compatibilityPlayback.js", import.meta.url), "utf8"))
    .replace(/^import .*;\r?\n/gm, "").replace(/export /g, "");
  for (const corsBlocked of [false, true]) {
    const original = "https://addon.example/redirect/private-token";
    const resolved = "https://cdn.example/video.mkv?token=private";
    let cancelled = false;
    const context = {
      SessionStore: { accessToken: "session-token" }, AbortSignal, URL,
      AuthManager: { refreshSessionIfNeeded: async () => true },
      async fetch(url, options) {
        if (url === original) {
          assert.equal(options.headers.Range, "bytes=0-0");
          assert.equal(options.credentials, "omit");
          if (corsBlocked) throw new TypeError("CORS");
          return { ok: true, url: resolved, body: { cancel: async () => { cancelled = true; } } };
        }
        assert.equal(url, "/api/playback/sessions");
        const data = JSON.parse(options.body);
        assert.equal(data.url, corsBlocked ? original : resolved);
        assert.equal(data.headers.Authorization, corsBlocked ? "addon-token" : undefined);
        assert.equal(data.headers.Referer, "https://app.example");
        assert.equal(data.position, 319);
        assert.equal(cancelled, !corsBlocked);
        return { ok: true, json: async () => ({ id: "session" }) };
      }
    };
    vm.runInNewContext(source, context);
    assert.equal((await context.requestCompatibilityPlayback("", {
      url: original, position: 319,
      headers: { Authorization: "addon-token", Referer: "https://app.example" }
    })).id, "session");
  }
});
