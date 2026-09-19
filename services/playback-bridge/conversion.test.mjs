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
      const inspected = await post("/api/playback/sessions", {
        url: process.env.NUVIO_BRIDGE_FIXTURE_URL, inspect: true
      });
      assert.equal(inspected.status, 200, JSON.stringify(inspected.body));
      assert.equal(inspected.body.tracks.length, 2);
      assert.equal(inspected.body.url, undefined, "Inspection does not create a converted stream");
      assert.equal(cookie, undefined, "Inspection releases its slot without creating a session cookie");
      const created = await post("/api/playback/sessions", {
        url: process.env.NUVIO_BRIDGE_FIXTURE_URL,
        preferredLanguages: [inspected.body.tracks[1].language]
      });
      assert.equal(created.status, 201, JSON.stringify(created.body));
      let session = created.body;
      const initialManifest = await (await fetch(base + session.url, { headers: { cookie } })).text();
      assert.ok([...initialManifest.matchAll(/^#EXTINF:([\d.]+)/gm)]
        .reduce((total, match) => total + Number(match[1]), 0) >= 12,
        "Playback must begin with a useful buffer, not only a segment count");
      assert.equal(session.tracks.length, 2);
      assert.equal(session.videoCodec, "h264");
      assert.equal(session.track, inspected.body.tracks[1].index, "Conversion starts in the preferred language");
      const inspectDuringPlayback = await post("/api/playback/sessions", {
        url: process.env.NUVIO_BRIDGE_FIXTURE_URL, inspect: true
      });
      assert.equal(inspectDuringPlayback.status, 409, "Inspection must not interrupt an active conversion");
      assert.equal((await fetch(base + session.url, { headers: { cookie } })).status, 200);
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
        position: 20.7,
        track: session.tracks[1].index
      });
      assert.equal(seek.status, 200, JSON.stringify(seek.body));
      assert.equal(seek.body.track, session.tracks[1].index);
      assert.equal(seek.body.duration, session.duration);
      const seekManifest = await (await fetch(base + seek.body.url, { headers: { cookie } })).text();
      const bufferedSeconds = [...seekManifest.matchAll(/^#EXTINF:([\d.]+)/gm)]
        .reduce((total, match) => total + Number(match[1]), 0);
      assert.ok(bufferedSeconds >= 12 || seekManifest.includes("#EXT-X-ENDLIST"),
        "A seek must buffer twelve seconds, not just two possibly tiny segments");
      const seekDirectory = seek.body.url.slice(0, seek.body.url.lastIndexOf("/") + 1);
      const seekSegment = seekManifest.split("\n").find(line => line.endsWith(".m4s"));
      const seekParts = await Promise.all(["init.mp4", seekSegment].map(async name =>
        Buffer.from(await (await fetch(base + seekDirectory + name, { headers: { cookie } })).arrayBuffer())));
      const probeTiming = (options = []) => new Promise((resolve, reject) => {
        const child = spawn("ffprobe", ["-v", "error", ...options, "-show_entries", "stream=codec_type,start_time", "-of", "json", "pipe:0"]);
        let output = "";
        child.stdout.on("data", chunk => output += chunk);
        child.stderr.resume();
        child.on("error", reject);
        child.on("close", code => code === 0 ? resolve(JSON.parse(output).streams) : reject(new Error("Converted timing did not decode")));
        child.stdin.end(Buffer.concat(seekParts));
      });
      const streams = await probeTiming();
      const withoutEdits = await probeTiming(["-ignore_editlist", "1"]);
      assert.deepEqual(withoutEdits, streams,
        "Browser playback must not need an MP4 edit list to align the audio and video");
      const start = type => Number(streams.find(stream => stream.codec_type === type)?.start_time);
      assert.ok(Math.abs(seek.body.offset + start("video") - 20) < 0.15,
        "The original clock must follow the fixture's 20s keyframe, not the requested 20.7s seek");
      assert.ok(Math.abs(start("audio") - start("video")) < 0.15,
        "A seek between keyframes must keep audio with the copied video's preroll for browser HLS");
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
