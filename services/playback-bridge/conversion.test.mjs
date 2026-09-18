import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createPlaybackBridge } from "./server.mjs";

// Opt-in check against synthetic H.264 + two E-AC3 sine-wave tracks.
// The auth stub exists only in this test process; production always verifies Nuvio.
test(
  "E-AC3 becomes audible AAC, preserves video, selects tracks and seeks",
  { skip: !process.env.NUVIO_BRIDGE_FIXTURE_URL },
  async () => {
    const root = await mkdtemp(join(tmpdir(), "nuvio-conversion-test-"));
    const origin = "https://nuvioweb.space";
    const bridge = await createPlaybackBridge({
      root,
      origin,
      authenticate: async (bearer) => ({ id: bearer, role: "authenticated" })
    });
    await new Promise((resolve) => bridge.server.listen(0, "127.0.0.1", resolve));
    const base = `http://127.0.0.1:${bridge.server.address().port}`;
    let cookie;
    const post = async (path, data = {}, identity = "owner") => {
      const response = await fetch(base + path, {
        method: "POST",
        headers: {
          origin,
          Authorization: `Bearer synthetic-test-user-${identity}`,
          "Content-Type": "application/json",
          ...(cookie ? { cookie } : {})
        },
        body: JSON.stringify(data)
      });
      if (response.headers.get("set-cookie"))
        cookie = response.headers.get("set-cookie").split(";")[0];
      return { status: response.status, body: await response.json() };
    };
    try {
      const created = await post("/api/playback/sessions", {
        url: process.env.NUVIO_BRIDGE_FIXTURE_URL
      });
      assert.equal(created.status, 201, JSON.stringify(created.body));
      let session = created.body;
      assert.equal(session.tracks.length, 2);
      assert.equal(session.videoCodec, "h264");
      const duplicate = await post("/api/playback/sessions", {
        url: process.env.NUVIO_BRIDGE_FIXTURE_URL
      });
      assert.equal(duplicate.status, 201, JSON.stringify(duplicate.body));
      assert.equal((await fetch(base + session.url, { headers: { cookie } })).status, 404);
      session = duplicate.body;
      const ownerCookie = cookie;
      const second = await post("/api/playback/sessions", {
        url: process.env.NUVIO_BRIDGE_FIXTURE_URL
      }, "second");
      assert.equal(second.status, 201);
      const third = await post("/api/playback/sessions", {
        url: process.env.NUVIO_BRIDGE_FIXTURE_URL
      }, "third");
      assert.equal(third.status, 429);
      assert.equal((await fetch(base + session.url, { headers: { cookie } })).status, 403);
      await fetch(base + `/api/playback/sessions/${second.body.id}`, {
        method: "DELETE", headers: { origin, cookie }
      });
      cookie = ownerCookie;
      assert.equal((await fetch(base + session.url)).status, 403);
      const manifest = await (await fetch(base + session.url, { headers: { cookie } })).text();
      const segment = manifest.split("\n").find((line) => line.endsWith(".m4s"));
      const directory = session.url.slice(0, session.url.lastIndexOf("/") + 1);
      const parts = await Promise.all(
        ["init.mp4", segment].map(async (name) =>
          Buffer.from(
            await (await fetch(base + directory + name, { headers: { cookie } })).arrayBuffer()
          )
        )
      );
      const audio = await new Promise((resolve, reject) => {
        const child = spawn("ffmpeg", [
          "-v",
          "error",
          "-i",
          "pipe:0",
          "-map",
          "0:a:0",
          "-t",
          "1",
          "-f",
          "s16le",
          "pipe:1"
        ]);
        const chunks = [];
        child.stdout.on("data", (chunk) => chunks.push(chunk));
        child.stderr.resume();
        child.on("error", reject);
        child.on("close", (code) =>
          code === 0
            ? resolve(Buffer.concat(chunks))
            : reject(new Error("Converted audio did not decode"))
        );
        child.stdin.end(Buffer.concat(parts));
      });
      assert.ok(
        audio.length > 10000 && audio.some((byte) => byte !== 0),
        "Decoded audio must contain a non-silent signal"
      );
      const seek = await post(`/api/playback/sessions/${session.id}/seek`, {
        position: 20,
        track: session.tracks[1].index
      });
      assert.equal(seek.status, 200, JSON.stringify(seek.body));
      assert.equal(seek.body.offset, 20);
      assert.equal(seek.body.track, session.tracks[1].index);
      assert.equal(seek.body.duration, session.duration);
      const removed = await fetch(base + `/api/playback/sessions/${session.id}`, {
        method: "DELETE",
        headers: { origin, cookie }
      });
      assert.equal(removed.status, 200);
      assert.equal((await fetch(base + seek.body.url, { headers: { cookie } })).status, 404);
    } finally {
      await bridge.close();
      await rm(root, { recursive: true, force: true });
    }
  }
);
