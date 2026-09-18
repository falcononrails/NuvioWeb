import { createServer } from "node:http";
import { readFile, stat, writeFile, mkdir } from "node:fs/promises";
import { createReadStream } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import os from "node:os";
import { chromium } from "playwright";
const root = path.dirname(fileURLToPath(import.meta.url));
process.chdir(root);
const mime = {
  ".mjs": "text/javascript",
  ".js": "text/javascript",
  ".html": "text/html",
  ".wasm": "application/wasm",
  ".mkv": "video/x-matroska",
  ".mp4": "video/mp4",
  ".m3u8": "application/vnd.apple.mpegurl",
  ".m4s": "video/mp4"
};
const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, "http://localhost");
    let file = path.resolve(
      root,
      "." + decodeURIComponent(url.pathname === "/" ? "/index.html" : url.pathname)
    );
    if (!file.startsWith(root + path.sep)) {
      res.writeHead(403).end();
      return;
    }
    if (url.pathname === "/hls.js")
      file = path.resolve(root, "node_modules/hls.js/dist/hls.min.js");
    const info = await stat(file);
    const range = /^bytes=(\d+)-(\d*)$/.exec(req.headers.range || "");
    const start = range ? Number(range[1]) : 0;
    const end = range && range[2] ? Math.min(Number(range[2]), info.size - 1) : info.size - 1;
    if (start > end) {
      res.writeHead(416, { "Content-Range": `bytes */${info.size}` }).end();
      return;
    }
    res.writeHead(range ? 206 : 200, {
      "Content-Type": mime[path.extname(file)] || "application/octet-stream",
      "Content-Length": end - start + 1,
      "Accept-Ranges": "bytes",
      "Cache-Control": "no-store",
      ...(range ? { "Content-Range": `bytes ${start}-${end}/${info.size}` } : {})
    });
    if (req.method === "HEAD") {
      res.end();
      return;
    }
    createReadStream(file, { start, end }).pipe(res);
  } catch {
    res.writeHead(404).end();
  }
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({
  ...(process.env.BUNDLED ? {} : { channel: process.env.BROWSER_CHANNEL || "chrome" }),
  headless: true,
  args: ["--autoplay-policy=no-user-gesture-required"]
});
const cases = process.argv.slice(2).length
  ? process.argv.slice(2)
  : [
      "avplayer:h264-eac3.mkv",
      "avplayer:h264-ac3.mkv",
      "avplayer:h264-dca.mkv",
      "avstream:h264-eac3.mkv",
      "native:h264-eac3.mkv",
      "native:h264-aac.mp4",
      "hls:hls/index.m3u8"
    ];
await mkdir("results", { recursive: true });
try {
  for (let trial = 0; trial < Number(process.env.TRIALS || 3); trial++)
    for (const entry of cases) {
      const [mode, file] = entry.split(":");
      const page = await browser.newPage({ viewport: { width: 1000, height: 600 } });
      const log = [];
      page.on("console", (msg) => log.push(`${msg.type()}: ${msg.text()}`));
      page.on("pageerror", (error) => log.push(String(error)));
      page.on("requestfailed", (req) =>
        log.push(`failed: ${req.url()} ${req.failure()?.errorText}`)
      );
      page.on("worker", (worker) => {
        log.push(`worker: ${worker.url()}`);
      });
      const cdp = await page.context().newCDPSession(page);
      await cdp.send("Performance.enable");
      if (process.env.CPU_SLOWDOWN)
        await cdp.send("Emulation.setCPUThrottlingRate", {
          rate: Number(process.env.CPU_SLOWDOWN)
        });
      await cdp.send("Runtime.enable");
      cdp.on("Runtime.exceptionThrown", (data) =>
        log.push(`runtime: ${JSON.stringify(data.exceptionDetails)}`)
      );
      await page.goto(
        `${base}/?mode=${mode}&file=${encodeURIComponent(file)}&worker=${process.env.WORKER || "true"}&switchSeek=${process.env.SWITCH_SEEK || "true"}&hybrid=${process.env.HYBRID || "true"}&audioMaster=${process.env.AUDIO_MASTER || "true"}`
      );
      try {
        await page.waitForFunction(() => window.result?.done, {}, { timeout: 60000 });
      } catch (error) {
        log.push(String(error));
      }
      const result = await page.evaluate(() =>
        JSON.parse(
          JSON.stringify(window.result, (_, value) =>
            typeof value === "bigint" ? Number(value) : value
          )
        )
      );
      result.browser = await browser.version();
      result.metrics = (await cdp.send("Performance.getMetrics")).metrics;
      result.log = log;
      result.trial = trial;
      result.environment = {
        platform: os.platform(),
        cpu: os.cpus()[0]?.model,
        playwright: "1.63.0",
        cpuSlowdown: Number(process.env.CPU_SLOWDOWN || 1),
        headless: true
      };
      const filename = `results/${process.env.RUN_LABEL || ""}${mode}-${file.replaceAll("/", "-")}-${Date.now()}.json`;
      await writeFile(filename, JSON.stringify(result, null, 2));
      console.log(
        JSON.stringify({
          file: filename,
          ok: result.ok,
          audio: result.audioDetected,
          flash: result.videoFlashDetected,
          errors: result.errors,
          events: result.events.filter((e) =>
            [
              "firstAudioRendered",
              "firstVideoRendered",
              "playResolved",
              "seekDone",
              "trackSwitchDone"
            ].includes(e.name)
          ),
          mse: result.mse,
          seekMs: result.seekMs,
          switchMs: result.switchMs,
          lastSamples: result.samples.slice(-1),
          wasm: result.requestedWasm
        })
      );
      await page.close();
    }
} finally {
  await browser.close();
  server.close();
}
