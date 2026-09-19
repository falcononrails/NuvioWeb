import test from "node:test";
import assert from "node:assert/strict";
import { episodeNotificationSchedule, enableEpisodeNotifications, disableEpisodeNotifications } from "./browserEpisodeNotifications.js";
import { AuthManager } from "../../core/auth/authManager.js";

test("alerts use Calendar dates at local 9 AM, skip history/movies and bound the next month", () => {
  const now = new Date(2026, 8, 19, 12).getTime();
  const events = episodeNotificationSchedule([
    { id: "film", type: "movie", released: "2026-09-20" },
    { id: "series", name: "Series", type: "series", videos: [
      { season: 1, episode: 1, released: "2026-09-18" },
      { season: 1, episode: 2, released: "2026-09-20" },
      { season: 1, episode: 3, released: "2026-11-20" },
      { season: 1, episode: 4, released: "invalid" }
    ] }
  ], now);
  assert.deepEqual(events, [{ key: "series:series:1:2", seriesId: "series", title: "Series · S1 E2", at: new Date(2026, 8, 20, 9).getTime() }]);
});

test("permission denial makes no subscription, and logout during enabling revokes the new schedule", async () => {
  const names = ["Notification", "navigator", "PushManager", "isSecureContext", "localStorage", "fetch"];
  const original = Object.fromEntries(names.map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  const auth = { state: AuthManager.state, getEffectiveUserId: AuthManager.getEffectiveUserId, refreshSessionIfNeeded: AuthManager.refreshSessionIfNeeded };
  const values = new Map();
  const calls = [];
  let permission = "denied";
  let unsubscribe = 0;
  const subscription = { toJSON: () => ({ endpoint: "https://fcm.googleapis.com/test", keys: {} }), unsubscribe: async () => { unsubscribe++; return true; } };
  const registration = { pushManager: { getSubscription: async () => subscription } };
  const mocks = {
    isSecureContext: true, PushManager() {},
    Notification: { permission: "default", requestPermission: async () => { assert.equal(calls.length, 0); return permission; } },
    navigator: { serviceWorker: { ready: Promise.resolve(registration), getRegistration: async () => registration } },
    localStorage: { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) },
    fetch: async (url, options = {}) => {
      calls.push([url, options.method]);
      if (url.endsWith("public-key")) return { json: async () => ({ enabled: true, episodes: true, publicKey: "AQID" }) };
      if (options.method === "POST") { AuthManager.sessionGeneration++; return { ok: true, json: async () => ({ id: "a".repeat(48) }) }; }
      return { ok: true };
    }
  };
  try {
    for (const [name, value] of Object.entries(mocks)) Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
    AuthManager.state = "authenticated";
    AuthManager.getEffectiveUserId = async () => "owner";
    AuthManager.refreshSessionIfNeeded = async () => true;
    await assert.rejects(enableEpisodeNotifications(), /blocked/);
    assert.equal(calls.length, 0);
    permission = "granted";
    await enableEpisodeNotifications();
    assert.equal(calls.at(-1)[1], "DELETE");
    assert.equal(values.has("browserEpisodeNotifications"), false);
    values.set("browserEpisodeNotifications", JSON.stringify({ enabled: true, id: "b".repeat(48) }));
    await disableEpisodeNotifications();
    assert.equal(values.has("browserEpisodeNotifications"), false);
    assert.equal(unsubscribe, 0, "The playback-return subscription is preserved");
  } finally {
    Object.assign(AuthManager, auth);
    for (const name of names) { if (original[name]) Object.defineProperty(globalThis, name, original[name]); else delete globalThis[name]; }
  }
});
