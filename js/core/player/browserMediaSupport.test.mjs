import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { transform } from "esbuild";
import { browserCompatibilityPolicy } from "../../../scripts/browserCompatibilityPolicy.mjs";
import { browserSourceWarnings, unavailableAudioMessage } from "./browserMediaSupport.js";

test("source warnings distinguish codec hints from confirmed playback support", () => {
  const unsupported = { canPlayType: () => "" };
  assert.equal(browserSourceWarnings({ title: "Pilot x265 DDP5.1" }, unsupported).length, 2);
  assert.deepEqual(browserSourceWarnings({ title: "Pilot x264 AAC" }, unsupported), []);
  assert.deepEqual(browserSourceWarnings({ title: "Pilot HEVC EAC3" }, { canPlayType: () => "probably" }), []);
  assert.equal(browserSourceWarnings({ raw: { behaviorHints: { filename: "Pilot.DTS-HD.mkv" } } }, unsupported).length, 1);
  assert.doesNotMatch(unavailableAudioMessage(), /no audio tracks/i);
});

test("the production transform can create a media probe without an injected video", async () => {
  const source = await readFile(new URL("./browserMediaSupport.js", import.meta.url), "utf8");
  const { code } = await transform(source, { format: "cjs", minify: true, target: `chrome${browserCompatibilityPolicy.chromiumVersion}` });
  const context = { module: { exports: {} }, document: { createElement: () => ({ canPlayType: () => "" }) } };
  vm.runInNewContext(code, context);
  assert.equal(context.module.exports.browserSourceWarnings({title:"Pilot x265 DDP5.1"}).length,2);
});
