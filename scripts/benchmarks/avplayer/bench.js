const q = new URLSearchParams(location.search);
const mode = q.get("mode") || "avplayer";
const file = q.get("file") || "h264-eac3.mkv";
const surface = document.querySelector("#surface");
const result = (window.result = {
  mode,
  file,
  parameters: Object.fromEntries(q),
  events: [],
  samples: [],
  errors: [],
  requestedWasm: [],
  userAgent: navigator.userAgent,
  isolated: crossOriginIsolated
});
const start = performance.now();
const mark = (name, data) =>
  result.events.push({
    name,
    ms: Math.round(performance.now() - start),
    ...(data ? { data } : {})
  });
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const timeout = (promise, ms = 15000) =>
  Promise.race([
    promise,
    sleep(ms).then(() => {
      throw Error("operation timed out");
    })
  ]);
let player, video, analyser, context, hls, outputStream;
const pixels = document.createElement("canvas");
pixels.width = pixels.height = 8;
const pixelContext = pixels.getContext("2d", { willReadFrequently: true });
let observer = new PerformanceObserver(
  (list) =>
    (result.longTasks =
      (result.longTasks || 0) + list.getEntries().reduce((sum, e) => sum + e.duration, 0))
);
observer.observe({ type: "longtask", buffered: true });
const streamUrl = new URL(q.get("url") || `/media/${file}`, location.href).href;
const statsNames = [
  "audioFrameDecodeCount",
  "audioFrameRenderCount",
  "audioFrameDropCount",
  "audioDecodeErrorPacketCount",
  "videoFrameDecodeCount",
  "videoFrameRenderCount",
  "videoFrameDropCount",
  "videoDecodeErrorPacketCount",
  "audioStutter",
  "videoStutter",
  "audioCurrentTime",
  "videoCurrentTime",
  "videoRenderFramerate",
  "bufferReceiveBytes"
];
const attachMeter = (node, ctx) => {
  context = ctx;
  analyser = ctx.createAnalyser();
  analyser.fftSize = 2048;
  node.connect(analyser);
};
function sample() {
  const sample = {
    ms: Math.round(performance.now() - start),
    currentTime: player ? Number(player.currentTime) / 1000 : video?.currentTime
  };
  if (player) {
    const stats = player.getStats();
    for (const name of statsNames) sample[name] = Number(stats[name]);
    sample.syncMs = sample.audioCurrentTime - sample.videoCurrentTime;
  } else if (video) {
    const quality = video.getVideoPlaybackQuality?.();
    sample.videoFrameDropCount = quality?.droppedVideoFrames;
    sample.videoFrameRenderCount = quality?.totalVideoFrames;
  }
  if (analyser) {
    const data = new Float32Array(analyser.fftSize);
    analyser.getFloatTimeDomainData(data);
    sample.rms = Math.sqrt(data.reduce((sum, x) => sum + x * x, 0) / data.length);
    const frequencies = new Float32Array(analyser.frequencyBinCount);
    analyser.getFloatFrequencyData(frequencies);
    let peak = 0;
    for (let i = 1; i < frequencies.length; i++) if (frequencies[i] > frequencies[peak]) peak = i;
    sample.peakHz = (peak * context.sampleRate) / analyser.fftSize;
  }
  const image = surface.querySelector("video,canvas");
  if (image) {
    try {
      pixelContext.drawImage(image, 10, 10, 8, 8, 0, 0, 8, 8);
      sample.brightness = pixelContext.getImageData(0, 0, 8, 8).data[0];
    } catch {}
  }
  result.samples.push(sample);
}
try {
  if (mode === "avplayer" || mode === "avstream") {
    await new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = "/node_modules/@libmedia/avplayer/dist/umd/avplayer.js";
      s.onload = resolve;
      s.onerror = reject;
      document.head.append(s);
    });
    const AVPlayer = window.AVPlayer;
    mark("libraryLoaded");
    AVPlayer.setLogLevel(2);
    if (mode === "avstream") {
      outputStream = new MediaStream();
      video = document.createElement("video");
      video.playsInline = true;
      surface.append(video);
    }
    player = window.player = new AVPlayer({
      container: outputStream || surface,
      enableHardware: q.get("software") !== "true",
      enableWebCodecs: q.get("software") !== "true",
      enableWorker: q.get("worker") !== "false",
      getWasm(type, codec, mediaType) {
        if (q.get("hybrid") === "true" && type === "decoder" && mediaType === 0) return "";
        const name = {
          27: "h264",
          173: "hevc",
          86018: "aac",
          86019: "ac3",
          86020: "dca",
          86056: "eac3"
        }[codec];
        const path =
          type === "decoder"
            ? `decode/${name}-simd.wasm`
            : type === "resampler"
              ? "resample/resample-simd.wasm"
              : "stretchpitch/stretchpitch-simd.wasm";
        if (type === "decoder" && !name) throw Error(`unsupported test codec ${codec}`);
        result.requestedWasm.push(path);
        return new URL(`/wasm/${path}`, location.href).href;
      }
    });
    for (const event of Object.values(AVPlayer.Events))
      player.on(event, (...data) => {
        if (event !== "time")
          mark(
            event,
            data.map((x) => (typeof x === "bigint" ? Number(x) : x))
          );
      });
    player.on("error", (error) => result.errors.push(String(error)));
    await timeout(player.load(streamUrl));
    result.tracks = player.getStreams().map((s) => ({
      id: s.id,
      index: s.index,
      type: s.mediaType,
      metadata: s.metadata,
      codec: s.codecparProxy.codecId
    }));
    result.duration = Number(player.getDuration()) / 1000;
    await timeout(player.play({ audioMasterForce: q.get("audioMaster") === "true" }));
    if (outputStream) {
      video.srcObject = outputStream;
      await timeout(video.play());

      result.outputTracks = outputStream
        .getTracks()
        .map((t) => ({ kind: t.kind, settings: t.getSettings() }));
    }
    mark("playResolved");
    result.mse = player.isMSE();
    const node = player.getAudioOutputNode();
    if (outputStream) {
      context = new AudioContext();
      const output = q.get("meter") === "element"
        ? context.createMediaElementSource(video)
        : context.createMediaStreamSource(outputStream);
      if (q.get("meter") === "element") output.connect(context.destination);
      attachMeter(output, context);
      await context.resume();
    } else if (node) attachMeter(node, node.context);
    result.dom = [...surface.children].map((n) => n.tagName);
  } else {
    video = document.createElement("video");
    surface.append(video);
    video.playsInline = true;
    for (const event of [
      "loadedmetadata",
      "canplay",
      "playing",
      "waiting",
      "stalled",
      "seeking",
      "seeked",
      "error",
      "ended"
    ])
      video.addEventListener(event, () => mark(event));
    context = new AudioContext();
    const source = context.createMediaElementSource(video);
    source.connect(context.destination);
    attachMeter(source, context);
    await context.resume();
    if (mode === "hls") {
      await new Promise((resolve, reject) => {
        let s = document.createElement("script");
        s.src = "/hls.js";
        s.onload = resolve;
        s.onerror = reject;
        document.head.append(s);
      });
      hls = new Hls({ maxBufferLength: 30 });
      hls.attachMedia(video);
      hls.loadSource(streamUrl);
    } else video.src = streamUrl;
    await timeout(video.play());
    mark("playResolved");
    result.duration = video.duration;
  }
  const timer = setInterval(sample, 20);
  await sleep(6500);
  mark("seekStart");
  const seekStart = performance.now();
  if (player) await timeout(player.seek(20000n));
  else {
    await timeout(
      new Promise((resolve) => {
        video.addEventListener("seeked", resolve, { once: true });
        video.currentTime = 20;
      })
    );
  }
  result.seekMs = Math.round(performance.now() - seekStart);
  mark("seekDone");
  await sleep(3500);
  if (player) {
    const position = Number(player.currentTime);
    mark("pauseStart");
    await timeout(player.pause());
    await sleep(500);
    result.pausedAdvanceMs = Number(player.currentTime) - position;
    await timeout(player.play());
    mark("pauseEnd");
  }
  if (player) {
    const tracks = result.tracks.filter((t) => t.type.toLowerCase() === "audio");
    if (tracks.length > 1) {
      mark("trackSwitchStart");
      const at = performance.now();
      const position = player.currentTime;
      await timeout(player.selectAudio(tracks[1].id));
      if (q.get("switchSeek") === "true") await timeout(player.seek(position));
      result.switchMs = Math.round(performance.now() - at);
      result.selectedTrack = player.getSelectedAudioStreamId();
      mark("trackSwitchDone");
      await sleep(3500);
    }
  }
  clearInterval(timer);
  sample();
  result.audioDetected = result.samples.some((s) => s.rms > 0.02);
  result.videoFlashDetected = result.samples.some((s) => s.brightness > 180);
  result.detectionTimes = result.samples.reduce(
    (out, s, i, all) => {
      const prev = all[i - 1];
      if (s.rms > 0.02 && (!prev || !(prev.rms > 0.02))) out.audio.push(s.ms);
      if (s.brightness > 180 && (!prev || !(prev.brightness > 180))) out.video.push(s.ms);
      return out;
    },
    { audio: [], video: [] }
  );
  result.trackSwitchVerified =
    !result.selectedTrack ||
    result.samples.some(
      (s) =>
        s.ms > result.events.find((e) => e.name === "trackSwitchDone").ms + 400 &&
        s.rms > 0.02 &&
        s.peakHz > 800 &&
        s.peakHz < 950
    );
  if (player) {
    mark("destroyStart");
    await timeout(player.destroy());
    if (outputStream) {
      video.pause();
      video.srcObject = null;
      outputStream.getTracks().forEach((track) => track.stop());
      await context.close();
    }
    mark("destroyDone");
    result.remainingChildren = surface.childElementCount;
  } else {
    video.pause();
    hls?.destroy();
    video.removeAttribute("src");
    video.load();
    await context.close();
  }
  result.ok = result.audioDetected && result.trackSwitchVerified;
} catch (error) {
  result.errors.push(String(error));
  result.ok = false;
} finally {

  observer.disconnect();
  result.elapsedMs = Math.round(performance.now() - start);
  result.resources = performance.getEntriesByType("resource").map((e) => ({
    path: new URL(e.name).pathname,
    bytes: e.transferSize,
    ms: Math.round(e.duration)
  }));
  result.done = true;
}
