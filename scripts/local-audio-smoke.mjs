// npm run build, then: node scripts/local-audio-smoke.mjs /path/to/synthetic/fixtures
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { createReadStream } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { build } from "esbuild";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fixtures = path.resolve(process.argv[2] || "test-media");
await stat(path.join(fixtures, "h264-eac3.mkv"));
let conversions = 0;
let subtitleReads = 0;
let html = `<!doctype html><button id="start">Start</button><video id="videoPlayer" playsinline></video>
<div id="playerHtmlSubtitles"></div><script type="module">
import {PlayerController as p} from '/js/core/player/playerController.js';
import {PlayerScreen as screen} from '/js/ui/screens/player/playerScreen.js';
import {AuthManager} from '/js/core/auth/authManager.js';
import {SessionStore} from '/js/core/storage/sessionStore.js';
import {LocalAudioEngine} from '/js/core/player/engines/localAudioEngine.js';
import {PlayerSettingsStore} from '/js/data/local/playerSettingsStore.js';
window.playerSettings=PlayerSettingsStore;
const originalStart=LocalAudioEngine.prototype.start;
const originalPlay=HTMLMediaElement.prototype.play;
HTMLMediaElement.prototype.play=function(...args){
  if(this.srcObject && p.localAudio && window.firstAttachedAudio == null) window.firstAttachedAudio=p.localAudio.tracks.find(t=>t.selected)?.language;
  return originalPlay.apply(this,args);
};
LocalAudioEngine.prototype.start=async function(...args){try{return await originalStart.apply(this,args);}catch(e){window.localFailure=e.stack;throw e;}};
window.p=p; window.screen=screen;
AuthManager.refreshSessionIfNeeded=async()=>true;
SessionStore.accessToken='synthetic-test-only';
p.init();
document.querySelector('#start').onclick=async()=>{
  try { await p.play('/media/h264-eac3.mkv'); await p.enableCompatibilityPlayback(0); window.started=true; }
  catch(e) { window.failure=String(e); }
};
window.ready=true;
</script>`;
const script = html
  .match(/<script type="module">([\s\S]*)<\/script>/)[1]
  .replaceAll("from '/js/", "from './js/");
const bundle = (
  await build({
    stdin: { contents: script, resolveDir: root },
    bundle: true,
    write: false,
    format: "iife"
  })
).outputFiles[0].text;
html = html.replace(
  /<script type="module">[\s\S]*<\/script>/,
  '<script src="/harness.js"></script>'
);
const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, "http://localhost");
    if (url.pathname === "/harness.js")
      return res.writeHead(200, { "Content-Type": "text/javascript" }).end(bundle);
    if (url.pathname === "/") return res.writeHead(200, { "Content-Type": "text/html" }).end(html);
    if (url.pathname === "/api/playback/sessions" && req.method === "POST") {
      let body = "";
      for await (const chunk of req) body += chunk;
      const data = JSON.parse(body);
      if (data.subtitle !== undefined) {
        subtitleReads++;
        const offset = Math.max(0, data.position - 5);
        const language = data.subtitle === 3 ? "English" : "Spanish";
        const timestamp = seconds => `00:${String(Math.floor(seconds / 60)).padStart(2, "0")}:${(seconds % 60).toFixed(3).padStart(6, "0")}`;
        const text = "WEBVTT\n\n" + [5, 15, 25, 115, 135].filter(t => t >= offset && t < offset + 125)
          .map(t => `${timestamp(t - offset)} --> ${timestamp(t - offset + 3)}\n${language} ${t}\n`).join("\n");
        return res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({ offset, end: Math.min(150, offset + 125), text }));
      }
      conversions++;
      return res.writeHead(200, { "Content-Type": "application/json" }).end(
        JSON.stringify({
          id: "synthetic",
          url: "/media/hls/index.m3u8",
          offset: 0,
          duration: 32,
          track: 1,
          tracks: [{ index: 1, language: "eng" }]
        })
      );
    }
    if (url.pathname.startsWith("/api/"))
      return res.writeHead(200, { "Content-Type": "application/json" }).end("{}");
    const base = url.pathname.startsWith("/media/")
      ? fixtures
      : url.pathname.startsWith("/assets/")
        ? path.join(root, "dist")
        : root;
    const relative = url.pathname.startsWith("/media/") ? url.pathname.slice(6) : url.pathname;
    const file = path.resolve(base, "." + decodeURIComponent(relative));
    if (!file.startsWith(base + path.sep)) return res.writeHead(403).end();
    const info = await stat(file);
    const range = /^bytes=(\d+)-(\d*)$/.exec(req.headers.range || "");
    const start = range ? Number(range[1]) : 0;
    const end = range?.[2] ? Math.min(Number(range[2]), info.size - 1) : info.size - 1;
    if (start > end) return res.writeHead(416).end();
    const mime = {
      ".js": "text/javascript",
      ".mjs": "text/javascript",
      ".wasm": "application/wasm",
      ".mkv": "video/x-matroska",
      ".mp4": "video/mp4",
      ".m4s": "video/mp4",
      ".m3u8": "application/vnd.apple.mpegurl"
    };
    res.writeHead(range ? 206 : 200, {
      "Content-Type": mime[path.extname(file)] || "application/octet-stream",
      "Content-Length": end - start + 1,
      "Accept-Ranges": "bytes",
      ...(range ? { "Content-Range": `bytes ${start}-${end}/${info.size}` } : {})
    });
    createReadStream(file, { start, end }).pipe(res);
  } catch {
    res.writeHead(404).end();
  }
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const browser = await chromium.launch({
  channel: process.env.BROWSER_CHANNEL || "chrome",
  headless: true
});
try {
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (error) => {
    errors.push(String(error));
    console.error(String(error));
  });
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.waitForFunction(() => window.ready);
  await page.locator("#start").click();
  await page.waitForFunction(() => window.started || window.failure, {}, { timeout: 45000 });
  assert.equal(await page.evaluate(() => window.failure), undefined);
  assert.equal(
    await page.evaluate(() => p.playbackEngine),
    "avplayer",
    await page.evaluate(() => window.localFailure)
  );
  assert.equal(conversions, 0, "Supported local audio must not reserve a server slot");
  await page.waitForFunction(() => p.localAudio.player.getStats().audioFrameRenderCount > 10);
  const initial = await page.evaluate(async () => {
    const context = new AudioContext();
    await context.resume();
    const meter = context.createAnalyser();
    meter.fftSize = 2048;
    context.createMediaStreamSource(p.localAudio.stream).connect(meter);
    window.readTone = () => {
      const values = new Float32Array(meter.frequencyBinCount);
      meter.getFloatFrequencyData(values);
      const peak = values.indexOf(Math.max(...values));
      return { hz: (peak * context.sampleRate) / meter.fftSize, level: values[peak] };
    };
    return { duration: p.getDurationSeconds(), tracks: p.getBrowserAudioTracks().length };
  });
  assert.ok(initial.duration > 31 && initial.tracks === 2);
  await page.waitForFunction(() => {
    const t = readTone();
    return t.hz > 400 && t.hz < 500 && t.level > -40;
  });
  await page.evaluate(() => p.pause());
  await page.waitForFunction(() => p.video.paused);
  await page.waitForTimeout(300);
  const pausedAt = await page.evaluate(() => p.getCurrentTimeSeconds());
  await page.waitForTimeout(500);
  assert.ok(Math.abs((await page.evaluate(() => p.getCurrentTimeSeconds())) - pausedAt) < 0.08);
  await page.evaluate(() => p.resume());
  await page.waitForFunction((at) => p.getCurrentTimeSeconds() > at + 0.3, pausedAt);
  await page.evaluate(() => p.seekToSeconds(20));
  await page.waitForFunction(
    () => p.localAudio.pendingPosition === null && p.getCurrentTimeSeconds() >= 19.5
  );
  await page.evaluate(() => p.setBrowserAudioTrack(1));
  await page.waitForFunction(
    () => p.getBrowserAudioTracks()[1].selected && p.localAudio.pendingPosition === null
  );
  await page.waitForFunction(() => {
    const t = readTone();
    return t.hz > 800 && t.hz < 950 && t.level > -40;
  });
  await page.evaluate(() => {
    screen.htmlSubtitleCues = [{ start: 19, end: 31, text: "Timeline check" }];
    screen.subtitleDelayMs = 0;
    screen.uiRefs = { htmlSubtitles: document.querySelector("#playerHtmlSubtitles") };
    screen.renderHtmlSubtitleOverlayAtCurrentTime();
  });
  assert.match(await page.locator("#playerHtmlSubtitles").innerText(), /Timeline check/);
  await page.evaluate(() => p.setPlaybackRate(1.25));
  assert.equal(await page.evaluate(() => p.getPlaybackRate()), 1.25);
  await page.evaluate(() => p.seekToSeconds(31));
  await page.waitForFunction(() => p.isPlaybackEnded());
  await page.evaluate(async () => {
    await p.stop({ flushProgress: false });
    await p.play("/media/h264-aac.mp4");
  });
  await page.waitForFunction(() => p.video.readyState >= 3 && !p.video.paused);
  assert.equal(await page.evaluate(() => p.localAudio), null);
  assert.equal(await page.evaluate(() => p.video.srcObject), null);
  assert.equal(await page.evaluate(() => p.video.playbackRate), 1.25);
  assert.equal(await page.evaluate(() => AVPlayer.Instances.length), 0);
  assert.equal(conversions, 0);
  console.log(
    "PASS native playback, local EAC3, audible tracks, timeline, subtitles, pause, seek, speed, cleanup"
  );

  // A failed local fetch must fall through to converted HLS once, with native controls intact.
  await page.evaluate(async () => {
    await p.play("/media/missing.mkv");
    await p.enableCompatibilityPlayback(0);
  });
  await page.waitForFunction(() => p.compatibility && p.video.readyState >= 3 && !p.video.paused);
  assert.equal(conversions, 1);
  assert.equal(await page.evaluate(() => p.localAudio), null);
  console.log("PASS local failure falls back to server HLS once");
  await page.evaluate(() => p.stop({ flushProgress: false }));

  // Cancel while AVPlayer is waiting for the media: it cannot attach to a later source.
  let blocked;
  await page.route("**/slow.mkv", (route) => {
    blocked = route;
  });
  await page.evaluate(async () => {
    await p.play("/slow.mkv");
    window.cancelledAttempt = p.enableCompatibilityPlayback(0);
  });
  await page.waitForFunction(() => Boolean(p.localAudio));
  await page.evaluate(async () => {
    await p.stop({ flushProgress: false });
    await p.play("/media/h264-aac.mp4");
  });
  if (blocked) await blocked.abort().catch(() => {});
  await page.evaluate(() => window.cancelledAttempt);
  assert.equal(await page.evaluate(() => p.localAudio), null);
  assert.equal(await page.evaluate(() => p.playbackEngine), "native-file");
  assert.equal(conversions, 1, "A cancelled attempt must not allocate a server session");
  await page.evaluate(() => p.stop({ flushProgress: false }));
  console.log("PASS Back/source-change during loading cancels local and server work");

  await page.evaluate(async () => {
    const container = document.createElement("div");
    container.id = "player";
    document.body.append(container);
    const url = new URL("/media/h264-eac3.mkv", location.href).href;
    playerSettings.set({ preferredAudioLanguage: "es" });
    window.firstAttachedAudio = null;
    await screen.mount({
      streamUrl: url,
      title: "Synthetic playback test",
      streamCandidates: [{ url, title: "EAC3 1080p test", name: "Synthetic", addonName: "Test" }]
    });
  });
  await page.waitForFunction(
    () => p.playbackEngine === "avplayer" && !screen.loadingVisible,
    {},
    { timeout: 30000 }
  );
  assert.equal(await page.evaluate(() => screen.isStartupErrorVisible()), false);
  assert.equal(await page.evaluate(() => screen.getAudioEntries().length), 2);
  assert.equal(await page.evaluate(() => window.firstAttachedAudio), 'spa', 'Preferred audio must be selected before the stream is audible');
  await page.waitForFunction(
    () => p.getBrowserAudioTracks()[1].selected && p.localAudio.pendingPosition === null
  );
  assert.equal(conversions, 1, "The actual player screen recovers audio without the server");
  await page.evaluate(() => screen.cleanup());
  assert.equal(await page.evaluate(() => p.localAudio), null);
  assert.deepEqual(errors, []);
  console.log("PASS automatic recovery through the actual player UI, audio menu and teardown");
  // Real embedded MKV metadata, existing subtitle UI/overlay and the original media clock.
  await page.evaluate(async () => {
    await screen.mount({ streamUrl: new URL('/media/embedded-subtitles.mkv', location.href).href,
      title: 'Embedded subtitle test', streamCandidates: [{ url: new URL('/media/embedded-subtitles.mkv', location.href).href,
        title: 'EAC3 test', name: 'Synthetic' }] });
  });
  await page.waitForFunction(() => p.playbackEngine === 'avplayer' && !screen.loadingVisible);
  const embedded = await page.evaluate(() => screen.getSubtitleEntries('builtIn').filter(e => e.embeddedSubtitleTrack != null));
  assert.equal(embedded.length, 2);
  assert.equal(embedded[0].track.supported, true);
  await page.evaluate(() => {
    screen.openSubtitleDialog();
    screen.applySubtitleEntry(screen.getSubtitleEntries('builtIn').find(e => e.embeddedSubtitleTrack === 3));
  });
  await page.waitForFunction(() => screen.htmlSubtitleCues.length > 0);
  for (const [position, text] of [[5.5, 'English 5'], [25.5, 'English 25'], [135.5, 'English 135'], [15.5, 'English 15']]) {
    await page.evaluate(position => p.seekToSeconds(position), position);
    try {
      await page.waitForFunction(text => screen.uiRefs.htmlSubtitles?.textContent.includes(text), text, { timeout: 10000 });
    } catch (error) {
      console.log('Subtitle seek failed', position, await page.evaluate(() => ({ time:p.getCurrentTimeSeconds(),
        subtitle:screen.selectedAddonSubtitleId, selection:screen.embeddedSubtitleSelection,
        cues:screen.htmlSubtitleCues, html:screen.uiRefs.htmlSubtitles?.textContent })));
      throw error;
    }
    assert.equal(await page.evaluate(() => screen.isStartupErrorVisible()), false);
  }
  await page.evaluate(() => screen.applySubtitleEntry(screen.getSubtitleEntries('builtIn').find(e => e.embeddedSubtitleTrack === 4)));
  await page.waitForFunction(() => screen.uiRefs.htmlSubtitles?.textContent.includes('Spanish 15'));
  await page.evaluate(() => screen.applySubtitleEntry(screen.getSubtitleEntries('builtIn')[0]));
  assert.equal(await page.evaluate(() => screen.embeddedSubtitleSelection), null);
  assert.equal(await page.evaluate(() => screen.uiRefs.htmlSubtitles?.textContent), '');
  assert.ok(subtitleReads >= 3 && subtitleReads <= 5, 'Subtitle windows must be reused until a seek/window change');
  await page.evaluate(() => screen.cleanup());
  console.log('PASS embedded languages, forward/back seeks, window refresh, Off and cleanup');
  for (const file of ["h264-ac3.mkv", "h264-dca.mkv", "hevc-eac3-4k.mkv"]) {
    await page.evaluate(async (file) => {
      await p.play("/media/" + file);
      await p.enableCompatibilityPlayback(0);
    }, file);
    assert.equal(
      await page.evaluate(() => p.playbackEngine),
      "avplayer",
      file + ": " + (await page.evaluate(() => window.localFailure))
    );
    await page.waitForFunction(() => p.localAudio.player.getStats().audioFrameRenderCount > 5);
    await page.evaluate(() => p.stop({ flushProgress: false }));
    console.log("PASS integrated local decoding: " + file);
  }
  await page.waitForFunction(() => AVPlayer.Instances.length === 0);
  assert.deepEqual(errors, [], "Playback and cleanup must not leave unhandled errors");
} finally {
  await browser.close();
  server.closeAllConnections();
  server.close();
}
