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
