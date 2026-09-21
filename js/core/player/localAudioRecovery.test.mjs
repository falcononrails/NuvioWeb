import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import { PlayerController } from "./playerController.js";
import { LocalAudioEngine } from "./engines/localAudioEngine.js";
import { TrackingScrobbleService } from "../../data/repository/trackingScrobbleService.js";

test("stopping local audio and server playback reports the absolute position before teardown", async (t) => {
  const reports = [];
  t.mock.method(TrackingScrobbleService, "report", (context) => reports.push(context));
  for (const engine of ["local", "server"]) {
    const p = Object.create(PlayerController);
    Object.assign(p, {
      video: { currentTime: 3, duration: Infinity, pause() {}, load() {}, removeAttribute() {}, querySelectorAll: () => [] },
      playbackSessionActive: true,
      currentItemId: "tt-test",
      currentItemType: "movie",
      localAudio: engine === "local" ? { position: 1203, duration: 3600 } : null,
      compatibility: engine === "server" ? { offset: 1200, duration: 3600 } : null,
      compatibilityPendingPosition: null,
      setStartupPresentationAudioMuted() {},
      setStartupAudioGate() {},
      stopCompatibilityPlayback() { this.compatibility = null; },
      stopLocalAudioPlayback() { this.localAudio = null; },
      teardownAdaptiveInstances() {},
      clearPlaybackEngineAttempts() {}
    });
    await p.stop({ flushProgress: false });
    assert.equal(reports.at(-1).positionMs, 1203000);
    assert.equal(reports.at(-1).durationMs, 3600000);
    const count = reports.length;
    await p.stop({ flushProgress: false });
    assert.equal(reports.length, count, "repeated cleanup does not send another report");
  }
});

function controller(start) {
  const requests = [];
  class Local {
    async start(...args) {
      return start.apply(this, args);
    }
    async destroy() {
      this.destroyed = true;
    }
  }
  const methods = ["enableCompatibilityPlayback", "stopLocalAudioPlayback"]
    .map((name) => PlayerController[name].toString())
    .join(",");
  const p = vm.runInNewContext(`({${methods}})`, {
    LocalAudioEngine: Local,
    requestCompatibilityPlayback: async (_, data) => {
      requests.push(data);
      return { id: "test" };
    },
    closeCompatibilityPlayback() {},
    setInterval: () => 0
  });
  Object.assign(p, {
    playRequestToken: 1,
    currentPlaybackUrl: "https://media.example/file.mkv",
    currentPlaybackHeaders: {},
    canUseLocalAudioPlayback: () => true,
    teardownAdaptiveInstances() {},
    emitVideoEvent() {},
    setPlaybackRate() {},
    getPlaybackRate: () => 1,
    video: { pause() {}, load() {}, removeAttribute() {}, querySelectorAll: () => [] },
    async loadCompatibilityPlayback(session) {
      this.compatibility = session;
    }
  });
  return { p, requests };
}

test("local audio is tried before allocating a conversion session", async () => {
  const { p, requests } = controller(async function (url, options) {
    assert.equal(url, "https://media.example/file.mkv");
    assert.equal(options.position, 123);
    assert.equal(options.track, 2);
    assert.deepEqual(Array.from(options.preferredLanguages), ["en"]);
  });
  await p.enableCompatibilityPlayback(123, { track: 2, preferredLanguages: ["en"] });
  assert.equal(p.playbackEngine, "avplayer");
  assert.equal(requests.length, 0);
});

test("failed local audio preserves position and track for the server fallback", async () => {
  const { p, requests } = controller(async function () {
    throw new Error("CORS or decoder failure");
  });
  await p.enableCompatibilityPlayback(123, { track: 2, preferredLanguages: ["en"] });
  assert.equal(p.localAudio, null);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].position, 123);
  assert.equal(requests[0].track, 2);
  assert.equal(requests[0].preferredLanguages[0], "en");
});

test("a cancelled local load cannot close a newer player or start server conversion", async () => {
  let fail;
  const { p, requests } = controller(
    () =>
      new Promise((_, reject) => {
        fail = reject;
      })
  );
  const loading = p.enableCompatibilityPlayback(120);
  const previous = p.localAudio;
  p.playRequestToken++;
  const newer = {
    destroy() {
      assert.fail("Stale request destroyed the new player");
    }
  };
  p.localAudio = newer;
  await previous.destroy();
  fail(new Error("Cancelled"));
  await loading;
  assert.equal(p.localAudio, newer);
  assert.equal(requests.length, 0);
});

test("runtime local failure can skip directly to the server", async () => {
  const { p, requests } = controller(() => assert.fail("Do not retry failed local playback"));
  await p.enableCompatibilityPlayback(45, { serverOnly: true });
  assert.equal(requests.length, 1);
  assert.equal(requests[0].position, 45);
});

test("local controller timeline, tracks and seeks do not use MediaStream time", () => {
  const p = Object.create(PlayerController);
  let seek;
  p.video = { currentTime: 3, duration: Infinity };
  p.localAudio = {
    position: 125,
    duration: 1800,
    tracks: [{ id: "7", engine: "avplayer" }],
    seek: (...args) => {
      seek = args;
    }
  };
  assert.equal(p.getCurrentTimeSeconds(), 125);
  assert.equal(p.getDurationSeconds(), 1800);
  assert.equal(p.getBufferedTimeSeconds(), null);
  assert.equal(p.setBrowserAudioTrack(0), true);
  assert.deepEqual(seek, [125, "7"]);
  assert.equal(p.seekToSeconds(600), true);
  assert.deepEqual(seek, [600]);
});

test("track switches expose pending selection immediately and flush old audio with a seek", async () => {
  const engine = Object.create(LocalAudioEngine.prototype);
  const calls = [];
  engine.video = { paused: false };
  engine.operation = Promise.resolve();
  engine.failure = new Promise(() => {});
  engine.emit = (name) => calls.push(name);
  engine.player = {
    selectAudio: async (id) => calls.push(["track", id]),
    seek: async (ms) => calls.push(["seek", ms])
  };
  const operation = engine.seek(120, "7");
  assert.equal(engine.pendingTrackId, 7);
  await operation;
  assert.deepEqual(calls, [
    "waiting",
    ["track", 7],
    ["seek", 120000n],
    "audiotrackschanged",
    "seeked",
    "playing"
  ]);
  assert.equal(engine.pendingTrackId, null);
  assert.equal(engine.pendingPosition, null);
});
