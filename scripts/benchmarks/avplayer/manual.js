const $ = (id) => document.getElementById(id);
let player,
  video,
  outputStream,
  busy = false,
  paused = false,
  language = 0;
const report = (message) => {
  $("status").textContent = message;
};
const controls = () => {
  for (const id of ["pause", "seek", "stop"]) $(id).disabled = busy || (!player && !video);
  $("language").disabled = busy || !player;
  $("start").disabled = busy;
  $("pause").textContent = paused ? "Play" : "Pause";
  $("language").textContent = language ? "Switch to English" : "Switch to Spanish";
};
async function stop() {
  if (player) {
    const old = player;
    player = null;
    await old.destroy();
  }
  if (video) {
    video.pause();
    video.srcObject = null;
    video.removeAttribute("src");
    video.load();
    video = null;
  }
  outputStream?.getTracks().forEach((track) => track.stop());
  outputStream = null;
  $("surface").replaceChildren();
  paused = false;
  language = 0;
}
async function perform(action) {
  if (busy) return;
  busy = true;
  controls();
  try {
    await action();
  } catch (error) {
    report(`This test couldn't play: ${error.message || error}`);
  } finally {
    busy = false;
    controls();
  }
}
$("start").onclick = () => {
  // Unlock audio in the click handler, before loading the clip (Safari needs a gesture).
  if (!AVPlayer.audioContext) AVPlayer.audioContext = new AudioContext();
  const audioReady = AVPlayer.audioContext.resume();
  void perform(async () => {
    await stop();
    await audioReady;
    const url = new URL(`./media/${$("source").value}`, location.href).href;
    const started = performance.now();
    report("Loading the test clip…");
    if ($("engine").value === "native") {
      video = document.createElement("video");
      video.playsInline = true;
      video.controls = true;
      video.volume = 0.25;
      video.src = url;
      $("surface").append(video);
      await video.play();
    } else {
      if ($("engine").value === "avstream") {
        outputStream = new MediaStream();
        video = document.createElement("video");
        video.playsInline = true;
        video.volume = 0.25;
        $("surface").append(video);
      }
      player = new AVPlayer({
        container: outputStream || $("surface"),
        enableWorker: true,
        enableHardware: true,
        enableWebCodecs: true,
        getWasm(type, codec, mediaType) {
          if (type === "decoder" && mediaType === 0) return "";
          const name = { 86018: "aac", 86019: "ac3", 86020: "dca", 86056: "eac3" }[codec];
          const path =
            type === "decoder"
              ? `decode/${name}-simd.wasm`
              : type === "resampler"
                ? "resample/resample-simd.wasm"
                : "stretchpitch/stretchpitch-simd.wasm";
          if (type === "decoder" && !name) throw Error("This audio format isn't part of the test.");
          return new URL(`./wasm/${path}`, location.href).href;
        }
      });
      player.on("error", (error) => report(String(error.message || error)));
      player.on("ended", () => {
        paused = true;
        controls();
        report("Test finished. You can start another clip.");
      });
      await player.load(url);
      player.setVolume(outputStream ? 1 : 0.25);
      await player.play({ audioMasterForce: true });
      if (outputStream) {
        video.srcObject = outputStream;
        await video.play();
      }
    }
    report(
      `Started in ${((performance.now() - started) / 1000).toFixed(2)}s. Listen for a beep every two seconds.`
    );
  });
};
$("pause").onclick = () =>
  void perform(async () => {
    if (player) {
      if (paused) {
        await player.play();
        if (outputStream) await video.play();
      } else {
        await player.pause();
        if (outputStream) video.pause();
      }
    } else if (paused) await video.play();
    else video.pause();
    paused = !paused;
  });
$("seek").onclick = () =>
  void perform(async () => {
    if (player) await player.seek(20000n);
    else video.currentTime = 20;
  });
$("language").onclick = () =>
  void perform(async () => {
    const tracks = player
      .getStreams()
      .filter((stream) => stream.mediaType.toLowerCase() === "audio");
    if (tracks.length < 2) return;
    const position = player.currentTime;
    language = language ? 0 : 1;
    await player.selectAudio(tracks[language].id);
    // MKV's pending audio queue can be behind the video after a track switch.
    await player.seek(position);
    report(
      language
        ? "Spanish selected: listen for the higher beep."
        : "English selected: listen for the lower beep."
    );
  });
$("stop").onclick = () =>
  void perform(async () => {
    await stop();
    report("Stopped.");
  });
new ResizeObserver(() => {
  if (!outputStream) player?.resize($("surface").clientWidth, $("surface").clientHeight);
}).observe($("surface"));
window.addEventListener("pagehide", () => {
  void stop();
});
