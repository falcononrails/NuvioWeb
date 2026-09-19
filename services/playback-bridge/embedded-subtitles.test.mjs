import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createPlaybackBridge } from "./server.mjs";

// Generate with scripts/generate-subtitle-fixture.mjs and serve on a public test host.
test("embedded text survives direct/local playback, conversion, language changes and seeks", {
  skip: !process.env.NUVIO_SUBTITLE_FIXTURE_URL
}, async () => {
  const root = await mkdtemp(join(tmpdir(), "nuvio-subtitle-test-"));
  const origin = "https://nuvioweb.space";
  const bridge = await createPlaybackBridge({ root, origin,
    authenticate: async bearer => ({ id: bearer, role: "authenticated" }) });
  await new Promise(resolve => bridge.server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${bridge.server.address().port}/api/playback/sessions`;
  const source = { url: process.env.NUVIO_SUBTITLE_FIXTURE_URL };
  const post = async (path, body, owner = "owner") => {
    const response = await fetch(base + path, { method: "POST",
      headers: { origin, Authorization: `Bearer synthetic-subtitle-test-${owner}` }, body: JSON.stringify(body) });
    return { status: response.status, data: await response.json() };
  };
  const cueStart = (text, label) => {
    const block = text.split(/\n\n/).find(block => block.includes(label));
    assert.ok(block, `Missing ${label}: ${text}`);
    const time = block.match(/([\d:.]+)\s+-->/)[1].split(":").map(Number);
    return time.reduce((total, value) => total * 60 + value, 0);
  };
  try {
    const inspected = await post("", { ...source, inspect: true });
    assert.equal(inspected.status, 200);
    assert.equal(inspected.data.subtitles.length, 2);
    assert.equal(inspected.data.subtitles[1].forced, true);
    const english = inspected.data.subtitles[0].index, spanish = inspected.data.subtitles[1].index;
    for (const position of [0, 24.7, 114.7, 4.2]) {
      const result = await post("", { ...source, subtitle: english, position });
      assert.equal(result.status, 200, JSON.stringify(result.data));
      const timestamp = position > 100 ? 115 : position > 20 ? 25 : 5;
      assert.ok(Math.abs(cueStart(result.data.text, `English ${timestamp}`) + result.data.offset - timestamp) < 0.05,
        "Extraction must preserve original media timestamps after a seek");
    }
    const created = await post("", { ...source, preferredLanguages: ["en"] });
    assert.equal(created.status, 201, JSON.stringify(created.data));
    assert.equal(created.data.track, inspected.data.tracks[1].index, "English must override the first Spanish audio track");
    assert.equal(created.data.subtitles.length, 2);
    const path = `/${created.data.id}`;
    assert.equal((await post(path + "/subtitles", { subtitle: english, position: 0 }, "other")).status, 403);
    assert.equal((await post(path + "/subtitles", { subtitle: 999, position: 0 })).status, 400);
    assert.equal((await post(path + "/subtitles", { subtitle: english, position: -1 })).status, 400);
    const sought = await post(path + "/seek", { position: 24.7 });
    assert.equal(sought.status, 200);
    const directory = join(root, (await readdir(root)).find(name => name.startsWith("session-")), "2");
    const packet = JSON.parse(execFileSync("ffprobe", ["-v", "error", "-read_intervals", "%+#1",
      "-select_streams", "v:0", "-show_packets", "-show_entries", "packet=pts_time", "-of", "json",
      `concat:${join(directory, "init.mp4")}|${join(directory, "segment-00000.m4s")}`]));
    // The fixture's preceding keyframe is at 24s, not the requested 24.7s.
    assert.ok(Math.abs(sought.data.offset + Number(packet.packets[0].pts_time) - 24) < 0.05,
      "Converted video and subtitles must share the original clock after seeking between keyframes");
    const result = await post(path + "/subtitles", { subtitle: spanish, position: 24.7 });
    assert.equal(result.status, 200, JSON.stringify(result.data));
    assert.ok(Math.abs(cueStart(result.data.text, "Spanish 25") + result.data.offset - 25) < 0.05);
    assert.equal((await post(path + "/heartbeat", {})).status, 200, "Subtitles must not stop video conversion");
  } finally {
    await bridge.close();
    await rm(root, { recursive: true, force: true });
  }
});
