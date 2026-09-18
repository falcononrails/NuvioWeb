import test from "node:test";
import assert from "node:assert/strict";
import { browserSourceWarnings, canAmplifyBrowserMedia, unavailableAudioMessage } from "./browserMediaSupport.js";

test("source warnings distinguish codec hints from confirmed playback support", () => {
  const unsupported = { canPlayType: () => "" };
  assert.equal(browserSourceWarnings({ title: "Pilot x265 DDP5.1" }, unsupported).length, 2);
  assert.deepEqual(browserSourceWarnings({ title: "Pilot x264 AAC" }, unsupported), []);
  assert.deepEqual(browserSourceWarnings({ title: "Pilot HEVC EAC3" }, { canPlayType: () => "probably" }), []);
  assert.equal(browserSourceWarnings({ raw: { behaviorHints: { filename: "Pilot.DTS-HD.mkv" } } }, unsupported).length, 1);
  assert.doesNotMatch(unavailableAudioMessage(), /no audio tracks/i);
});

test("the audio booster never captures native cross-origin media", () => {
  const origin = "https://nuvioweb.space";
  assert.equal(canAmplifyBrowserMedia({ currentSrc: "https://cdn.example/movie.mkv" }, origin), false);
  assert.equal(canAmplifyBrowserMedia({ currentSrc: "blob:https://nuvioweb.space/123" }, origin), true);
  assert.equal(canAmplifyBrowserMedia({ currentSrc: "/movie.mp4" }, origin), true);
  assert.equal(canAmplifyBrowserMedia({ currentSrc: "" }, origin), false);
});
