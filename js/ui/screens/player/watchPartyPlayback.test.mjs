import assert from "node:assert/strict";
import test from "node:test";
import { bindPartyPlayback, playerPartyMedia } from "./watchPartyPlayback.js";
import { partyCodeFromInput, partyStreamParams } from "./watchPartyDialog.js";
import { mediaKeyOf, PartyEventType } from "../../../core/party/partyModels.js";

test("party invite opens the host episode through local addon selection", () => {
  assert.equal(partyCodeFromInput("https://nuvio.tv/party/ABC234"), "ABC234");
  assert.equal(partyCodeFromInput("https://example.org/party/ABC234"), "");
  const media = { meta_type: "series", meta_id: "tt123", season: 1, episode: 2, source: { url: "private" } };
  const params = partyStreamParams(media);
  assert.equal(params.videoId, "tt123:1:2");
  assert.equal(params.manualSelection, true);
  assert.equal(params.startFromBeginning, true);
  assert.equal(JSON.stringify(params).includes("private"), false);
  assert.equal(partyStreamParams({ meta_type: "tv", meta_id: "test" }), null);
});

test("web player publishes local host controls and follows remote playback as a guest", async () => {
  const params = { itemType: "movie", itemId: "tt123", videoId: "tt123", streamUrl: "private" };
  const media = playerPartyMedia(params);
  const mediaKey = mediaKeyOf(media);
  assert.equal(JSON.stringify(media).includes("private"), false);
  const video = Object.assign(new EventTarget(), { paused: false, readyState: 4 });
  const calls = [];
  let rate = 1;
  let position = 0;
  const controller = {
    video,
    currentItemId: "tt123",
    currentVideoId: "tt123",
    getCurrentTimeSeconds: () => position,
    getDurationSeconds: () => 60,
    getPlaybackRate: () => rate,
    getSupportedPlaybackRates: () => [1, 1.25],
    seekToSeconds: (seconds) => { position = seconds; calls.push(["seek", seconds]); },
    pause: () => { video.paused = true; calls.push(["pause"]); },
    resume: () => { video.paused = false; calls.push(["resume"]); },
    async setPlaybackRate(value) { rate = value; calls.push(["rate", value]); return true; }
  };
  const room = { mediaKey, hostMemberId: "host", memberId: "host" };
  let playback = null;
  let notify;
  let tick;
  const repository = {
    getState: () => ({ party: room }),
    getPlayback: () => playback,
    subscribeState: () => () => {},
    subscribeEvents: (callback) => { notify = callback; return () => { notify = null; }; },
    nowMs: () => 10000,
    publishPlayback: (...args) => calls.push(["publish", ...args]),
    setLocalStatus: () => {}
  };
  const dispose = bindPartyPlayback({ params }, controller, repository, {
    schedule: (callback) => { tick = callback; return 1; },
    cancel: () => { tick = null; },
    openMedia: (next) => calls.push(["open", next.meta_id]),
    now: () => 5000
  });
  video.dispatchEvent(new Event("playing"));
  assert.deepEqual(calls.splice(0), [["publish", false, 0, 1]]);

  room.memberId = "guest";
  playback = { media_key: mediaKey, paused: true, at: 9000, position_ms: 5000, rate: 1.25 };
  tick();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(calls.splice(0), [["seek", 5], ["pause"], ["rate", 1.25]]);
  video.dispatchEvent(new Event("pause"));
  assert.deepEqual(calls, []);
  notify({ type: PartyEventType.MediaChanged, media: { ...media, meta_id: "tt456" } });
  assert.deepEqual(calls.splice(0), [["open", "tt456"]]);

  dispose();
  assert.deepEqual(calls, [["rate", 1]]);
  assert.equal(tick, null);
  assert.equal(notify, null);
});
