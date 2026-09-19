import assert from "node:assert/strict";
import test from "node:test";
import { bindBrowserPushReturn, decodeVapidPublicKey, getBrowserPushReturnState, enableBrowserPushReturn, disableBrowserPushReturn } from "./browserPushReturn.js";

test("Push return is unavailable without standards support and decodes VAPID base64url", async () => {
  assert.deepEqual(await getBrowserPushReturnState({ runtime: {} }), { state: "unavailable" });
  assert.deepEqual([...decodeVapidPublicKey("AQID")], [1, 2, 3]);
});

test("push binding sends subscription only in the same-origin POST body", async () => {
  const requests = [];
  const runtime = { isSecureContext: true, PushManager: function () {}, Notification: {}, navigator: { serviceWorker: { ready: Promise.resolve({ pushManager: { getSubscription: async () => ({ toJSON: () => ({ endpoint: "https://push.example", keys: { p256dh: "key", auth: "auth" } }) }) } }) } } };
  assert.equal(await bindBrowserPushReturn({ token: "a".repeat(32), runtime, fetchImpl: async (url, init) => { requests.push({ url, init }); return { ok: true }; } }), true);
  assert.equal(requests[0].url, "/api/external-return/push/bind");
  assert.match(requests[0].init.body, /"token"/);
});

test("subscription failures return only the browser error diagnostic", async () => {
  const runtime = { isSecureContext: true, PushManager: function () {}, Notification: { permission: "default", requestPermission: async () => "granted" }, navigator: { serviceWorker: { ready: Promise.resolve({ pushManager: { getSubscription: async () => null, subscribe: async () => { throw Object.assign(new Error("Subscription denied"), { name: "NotAllowedError" }); } } }) } } };
  const fetchImpl = async () => ({ json: async () => ({ enabled: true, publicKey: "AQID" }) });
  const result = await enableBrowserPushReturn({ runtime, fetchImpl });
  assert.deepEqual(result.diagnostic, { name: "NotAllowedError", message: "Subscription denied" });
});

test("disabling playback return preserves episode alerts on the shared subscription", async () => {
  const values = new Map([["browserPushReturnEnabled", "true"], ["browserEpisodeNotifications", '{"enabled":true}']]);
  let unsubscribed = 0;
  const subscription = { unsubscribe: async () => { unsubscribed++; } };
  const runtime = { isSecureContext: true, PushManager() {}, Notification: { permission: "granted" },
    localStorage: { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) },
    navigator: { serviceWorker: { ready: Promise.resolve({ pushManager: { getSubscription: async () => subscription } }) } } };
  await disableBrowserPushReturn({ runtime });
  assert.equal(unsubscribed, 0);
  assert.equal((await getBrowserPushReturnState({ runtime, fetchImpl: async () => ({ json: async () => ({ enabled: true, publicKey: "AQID", episodes: true }) }) })).state, "not-enabled");
  assert.equal(await bindBrowserPushReturn({ token: "a".repeat(32), runtime }), false);
  values.delete("browserEpisodeNotifications");
  await disableBrowserPushReturn({ runtime });
  assert.equal(unsubscribed, 1);
});
