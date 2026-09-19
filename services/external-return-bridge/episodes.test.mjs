import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { once } from "node:events";
import { createEpisodeStore, validPushSubscription } from "./episodes.mjs";
import { createExternalReturnServer } from "./bridge.mjs";

const subscription = { endpoint: "https://fcm.googleapis.com/fcm/send/test", keys: { p256dh: "A".repeat(87), auth: "B".repeat(22) } };
test("release schedule survives restart, groups episodes, skips history, deduplicates and revokes", async () => {
  const dir = await mkdtemp(join(tmpdir(), "nuvio-alerts-"));
  const file = join(dir, "episodes.json");
  let time = Date.now();
  const now = () => time;
  const sent = [];
  try {
    let store = createEpisodeStore({ file, now });
    const events = [{ key: "old", title: "Old", at: time - 1000 }, ...[1,2].map(i => ({ key: `new${i}`, title: `Series E${i}`, at: time + 1000 }))];
    const value = { subscription, profile: "1", events };
    const { id } = store.put("owner", value);
    await store.deliver(async (_, payload) => sent.push(payload));
    assert.equal(sent.length, 0);
    time += 2000;
    store = createEpisodeStore({ file, now });
    await store.deliver(async (_, payload) => sent.push(payload));
    assert.equal(sent.length, 1);
    assert.equal(sent[0].body, "Series E1 · Series E2");
    store.put("owner", { ...value, id });
    store = createEpisodeStore({ file, now });
    await store.deliver(async (_, payload) => sent.push(payload));
    assert.equal(sent.length, 1);
    assert.throws(() => store.put("other-owner", { ...value, id }), { status: 409 });
    assert.throws(() => store.put("owner", value), { status: 409 });
    store.remove(id);
    assert.deepEqual(JSON.parse(await readFile(file, "utf8")), {});
    store.put("owner", { ...value, events: [{ key: "later", title: "Later", at: time + 1000 }] });
    time += 33 * 86400000;
    await store.deliver(async (_, payload) => sent.push(payload));
    assert.equal(sent.length, 1);
    assert.deepEqual(JSON.parse(await readFile(file, "utf8")), {});
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("push destinations and account/device limits reject unsafe requests", () => {
  for (const endpoint of ["http://fcm.googleapis.com/a", "https://127.0.0.1/a", "https://fcm.googleapis.com.evil.test/a", "https://a:b@fcm.googleapis.com/a", "https://fcm.googleapis.com:8080/a"]) {
    assert.equal(validPushSubscription({ ...subscription, endpoint }), false);
  }
  assert.equal(validPushSubscription(subscription), true);
  assert.equal(validPushSubscription({ ...subscription, endpoint: "https://web.push.apple.com/test" }), true);
  const store = createEpisodeStore();
  const value = { subscription, profile: "1", events: [] };
  assert.throws(() => store.put("owner", { ...value, events: [null] }), { status: 400 });
  assert.throws(() => store.put("owner", { ...value, events: new Array(301).fill({}) }), { status: 400 });
  assert.throws(() => store.put("owner", { ...value, profile: "999" }), { status: 400 });
  for (let i = 0; i < 8; i++) store.put("owner", { ...value, subscription: { ...subscription, endpoint: subscription.endpoint + i } });
  assert.throws(() => store.put("owner", value), { status: 429 });
});

test("only verified accounts can schedule; revocation works after logout", async () => {
  const server = createExternalReturnServer({ episodeStore: createEpisodeStore(), env: { NUVIO_ORIGIN: "https://nuvio.test", NUVIO_WEB_PUSH_PRIVATE_KEY: "key", NUVIO_SUPABASE_URL: "https://auth.test", NUVIO_SUPABASE_ANON_KEY: "public" },
    authenticate: async bearer => { assert.equal(bearer, "Bearer " + "a".repeat(30)); return { id: "owner" }; } });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const url = `http://127.0.0.1:${server.address().port}/api/external-return/episodes`;
  const body = JSON.stringify({ subscription, profile: "1", events: [] });
  try {
    assert.equal((await fetch(url, { method: "POST", body })).status, 401);
    assert.equal((await fetch(url, { method: "POST", body, headers: { Origin: "https://evil.test" } })).status, 403);
    const response = await fetch(url, { method: "POST", body, headers: { Authorization: "Bearer " + "a".repeat(30) } });
    assert.equal(response.status, 200);
    const { id } = await response.json();
    assert.equal((await fetch(url, { method: "DELETE", body: JSON.stringify({ id }) })).status, 200);
  } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
});
