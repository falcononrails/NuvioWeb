import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import https from "node:https";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { isPublicAddress, validateSource, mediaHeaders, openSource } from "./source.mjs";
import { compatibleProbe, createPlaybackBridge, verifyNuvioAccount } from "./server.mjs";

test("source refusals and file limits retain useful errors without exposing the URL", async (t) => {
  let statusCode = 403;
  t.mock.method(https, "get", (_url, _options, respond) => {
    const response = new PassThrough();
    response.statusCode = statusCode;
    response.headers = { "content-length": String(26 * 1024 ** 3) };
    queueMicrotask(() => { respond(response); response.end(); });
    return new EventEmitter();
  });
  const url = "https://1.1.1.1/private-stream-token";
  await assert.rejects(openSource(url), error => error.status === 422 && /HTTP 403/.test(error.message) && !error.message.includes("private-stream-token"));
  statusCode = 200;
  await assert.rejects(openSource(url), { status: 422, message: "This file exceeds the 25 GB conversion limit. Choose a smaller source." });
});

test("Nuvio verifies linked-device account ownership and rejects guests or invalid tokens", async (t) => {
  const owner = "11111111-1111-4111-8111-111111111111";
  const device = "22222222-2222-4222-8222-222222222222";
  let status = 200, result = owner;
  t.mock.method(globalThis, "fetch", async (url, options) => {
    assert.equal(url, "https://auth.example/rest/v1/rpc/get_sync_owner");
    assert.equal(options.method, "POST");
    assert.equal(options.redirect, "error");
    return { ok: status === 200, status, json: async () => result };
  });
  const token = claims => `Bearer header.${Buffer.from(JSON.stringify(claims)).toString("base64url")}.signature`;
  const verify = claims => verifyNuvioAccount(token(claims), "https://auth.example", "public-key");
  assert.equal((await verify({sub: owner, role: "authenticated"})).id, owner);
  assert.equal((await verify({sub: device, role: "authenticated", is_anonymous: true})).id, owner);
  result = device;
  await assert.rejects(verify({sub: device, role: "authenticated", is_anonymous: true}), {status: 401});
  result = owner;
  await assert.rejects(verify({sub: owner, role: "anon"}), {status: 401});
  status = 401;
  await assert.rejects(verify({sub: owner, role: "authenticated"}), {status: 401});
  status = 503;
  await assert.rejects(verify({sub: owner, role: "authenticated"}), {status: 503});
});

test("media requests reject private addresses, rebinding, unsafe protocols and headers", async () => {
  for (const ip of [
    "127.0.0.1",
    "10.2.3.4",
    "169.254.169.254",
    "100.64.0.1",
    "::1",
    "::ffff:127.0.0.1",
    "fc00::1",
    "fe80::1",
    "2001:db8::1",
    "2002:7f00:1::"
  ])
    assert.equal(isPublicAddress(ip), false, ip);
  for (const ip of ["1.1.1.1", "8.8.8.8", "2606:4700:4700::1111"])
    assert.equal(isPublicAddress(ip), true, ip);
  for (const url of [
    "file:///etc/passwd",
    "http://127.0.0.1/a",
    "http://2130706433/a",
    "https://user:secret@example.org/a",
    "https://example.org:8080/a"
  ])
    await assert.rejects(validateSource(url));
  await assert.rejects(
    validateSource("https://example.org/a", async () => [
      { address: "1.1.1.1", family: 4 },
      { address: "192.168.1.1", family: 4 }
    ])
  );
  assert.deepEqual(
    mediaHeaders({ Cookie: "secret", Host: "localhost", Referer: "https://example.org" }),
    { referer: "https://example.org" }
  );
  assert.throws(() => mediaHeaders({ Authorization: "a\r\nHost:localhost" }));
});

test("probes distinguish unsupported video, missing audio and convertible audio", () => {
  const data = {
    format: { duration: "60", bit_rate: "1000000" },
    streams: [
      { codec_type: "video", codec_name: "h264" },
      { index: 1, codec_type: "audio", codec_name: "eac3", tags: { language: "eng" } }
    ]
  };
  assert.equal(compatibleProbe(data).tracks[0].codec, "eac3");
  assert.throws(() => compatibleProbe({ ...data, streams: [data.streams[0]] }), /no audio track/);
  assert.throws(() => compatibleProbe({ ...data, format: { duration: "Infinity" } }), /four hours/);
  assert.throws(
    () =>
      compatibleProbe({
        ...data,
        streams: [{ codec_type: "video", codec_name: "av1" }, data.streams[1]]
      }),
    /video conversion/
  );
});

test("the bridge requires account authentication and same-origin writes before reading a source", async () => {
  const root = await mkdtemp(join(tmpdir(), "nuvio-bridge-test-"));
  const bridge = await createPlaybackBridge({
    root,
    origin: "https://nuvioweb.space",
    authenticate: async () => ({ id: "test-user", role: "authenticated" })
  });
  await new Promise((resolve) => bridge.server.listen(0, "127.0.0.1", resolve));
  const url = `http://127.0.0.1:${bridge.server.address().port}/api/playback/sessions`;
  try {
    const post = (headers) =>
      fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify({ url: "http://127.0.0.1/private" })
      });
    assert.equal((await post({ origin: "https://evil.example" })).status, 403);
    assert.equal((await post({ origin: "https://nuvioweb.space" })).status, 401);
    assert.equal(
      (
        await post({
          origin: "https://nuvioweb.space",
          Authorization: "Bearer test-token-that-is-long-enough"
        })
      ).status,
      400
    );
    assert.equal((await fetch(url + "/" + "a".repeat(48) + "/1/index.m3u8")).status, 404);
  } finally {
    await bridge.close();
    await rm(root, { recursive: true, force: true });
  }
});
