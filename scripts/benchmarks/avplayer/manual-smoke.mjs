import assert from "node:assert/strict";
import { chromium } from "playwright";
const url = process.argv[2];
assert.ok(url, "Pass the URL of the deployed manual.html");
const browser = await chromium.launch({
  channel: process.env.BROWSER_CHANNEL || "chrome",
  headless: true
});
try {
  const page = await browser.newPage({ viewport: { width: 1000, height: 850 } });
  const errors = [];
  page.on("pageerror", (error) => errors.push(String(error)));
  await page.goto(url);
  for (const [engine, file, decoding = "auto"] of [
    ["avstream", "h264-eac3.mkv"],
    ["avplayer", "h264-dca.mkv"],
    ["avstream", "hevc-eac3-4k.mkv"],
    ["native", "h264-aac.mp4"],
    ["avstream", "h264-eac3.mkv", "software"],
    ["avstream", "hevc-eac3-4k-bframes.mkv", "software"]
  ]) {
    await page.locator("#engine").selectOption(engine);
    await page.locator("#source").selectOption(file);
    await page.locator("#decoding").selectOption(decoding);
    await page.locator("#start").click();
    await page.waitForFunction(
      () => document.querySelector("#status").textContent.startsWith("Started in"),
      {},
      { timeout: 30000 }
    );
    if (engine !== "native") {
      if (decoding === "software") await page.waitForFunction(() =>
        document.querySelector("#metrics").textContent.startsWith("Software video (WASM)"));
      await page.waitForFunction(() =>
        AVPlayer.Instances.some(
          (p) =>
            Number(p.getStats().audioFrameRenderCount) > 5 &&
            Number(p.getStats().videoFrameRenderCount) > 5
        )
      );
      await page.locator("#language").click();
      await page.waitForFunction(() =>
        document.querySelector("#status").textContent.startsWith("Spanish selected")
      );
      assert.ok(
        await page.evaluate(() =>
          AVPlayer.Instances.some(
            (p) =>
              p.getSelectedAudioStreamId() ===
              p.getStreams().filter((s) => s.mediaType.toLowerCase() === "audio")[1]?.id
          )
        )
      );
    }
    await page.locator("#pause").click();
    await page.waitForFunction(() => document.querySelector("#pause").textContent === "Play");
    await page.locator("#pause").click();
    await page.waitForFunction(() => document.querySelector("#pause").textContent === "Pause");
    await page.locator("#seek").click();
    await page.locator("#stop").click();
    await page.waitForFunction(() => document.querySelector("#status").textContent === "Stopped.");
    assert.equal(await page.locator("#surface").evaluate((node) => node.childElementCount), 0);
    console.log(`PASS ${engine} ${file} ${decoding}: start, tracks, pause, resume, seek, cleanup`);
  }
  assert.deepEqual(errors, []);
  await page.setViewportSize({ width: 390, height: 844 });
  assert.ok(
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    "Preview fits a narrow viewport"
  );
} finally {
  await browser.close();
}
