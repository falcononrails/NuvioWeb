import { loadStreamingLibs } from "../../../runtime/loadStreamingLibs.js";

let audioContext;
export function supportsLocalAudio() {
  return Boolean(
    globalThis.VideoDecoder &&
    globalThis.AudioContext &&
    globalThis.AudioWorkletNode &&
    globalThis.MediaStream
  );
}

// Called from the existing player gesture listeners, before asynchronous loading.
export function unlockLocalAudio() {
  if (!supportsLocalAudio()) return;
  try {
    audioContext ||= new AudioContext();
    void audioContext.resume().catch(() => {});
  } catch {
    /* Unsupported audio contexts use the server fallback. */
  }
}

export class LocalAudioEngine {
  constructor(video, emit) {
    this.video = video;
    this.emit = emit;
    this.stream = new MediaStream();
    this.pendingPosition = null;
    this.operation = Promise.resolve();
    this.failure = new Promise((_, reject) => {
      this.reject = reject;
    });
    this.failure.catch(() => {});
    this.onPause = () => {
      if (!this.ready || this.ended) return;
      this.pausedPosition = this.position;
      this.perform(() => this.player.pause());
    };
    this.onPlay = () => {
      if (!this.ready || this.ended) return;
      this.pausedPosition = null;
      this.perform(() => this.player.play({ audioMasterForce: true }));
    };
  }

  async guard(promise) {
    let timer;
    try {
      return await Promise.race([
        promise,
        this.failure,
        new Promise((_, reject) => {
          timer = setTimeout(() => reject(new Error("Local audio playback timed out.")), 15000);
        })
      ]);
    } finally {
      clearTimeout(timer);
    }
  }

  async start(url, { headers = {}, position = 0, track = null } = {}) {
    await this.guard(loadStreamingLibs({ hls: false, dash: false, avplayer: true }));
    if (this.destroyed || !globalThis.AVPlayer) throw new Error("Local audio is unavailable.");
    unlockLocalAudio();
    await this.guard(audioContext.resume());
    const AVPlayer = globalThis.AVPlayer;
    AVPlayer.audioContext = audioContext;
    this.player = new AVPlayer({
      container: this.stream,
      enableHardware: true,
      enableWebCodecs: true,
      enableWorker: true,
      getWasm(type, codec, mediaType) {
        // Keep video on WebCodecs. Software video decoding is too costly for this fallback.
        if (type === "decoder" && mediaType === 0) return "";
        const name = { 86018: "aac", 86019: "ac3", 86020: "dca", 86056: "eac3" }[codec];
        if (type === "decoder" && !name) return "";
        const file =
          type === "decoder"
            ? `decode/${name}-simd.wasm`
            : type === "resampler"
              ? "resample/resample-simd.wasm"
              : "stretchpitch/stretchpitch-simd.wasm";
        return new URL(`assets/libs/avplayer-wasm-1.3.1/${file}`, document.baseURI).href;
      }
    });
    this.player.on("error", () => {
      this.reject(new Error("Local audio could not play this source."));
      if (this.ready && !this.destroyed) this.fail();
    });
    this.player.on("ended", () => {
      if (this.destroyed) return;
      this.ended = true;
      this.video.pause();
      this.emit("ended");
    });
    await this.guard(
      this.player.load(new URL(url, document.baseURI).href, {
        http: { headers, credentials: "omit" },
        ioLoaderOptions: { retryCount: 1, retryInterval: 1 }
      })
    );
    this.loaded = true;
    this.player.setVolume(1); // The existing video element owns mute and volume.
    await this.guard(this.player.play({ audioMasterForce: true, subtitle: false }));
    if (track != null) {
      const selected = this.tracks.find((entry) => entry.sourceIndex === track);
      if (selected) await this.guard(this.player.selectAudio(Number(selected.id)));
    }
    if (position > 0 || track != null)
      await this.guard(this.player.seek(BigInt(Math.round(position * 1000))));
    if (this.destroyed) throw new Error("Playback was stopped.");
    this.video.srcObject = this.stream;
    this.video.playbackRate = 1;
    await this.guard(this.video.play());
    this.ready = true;
    this.video.addEventListener("pause", this.onPause);
    this.video.addEventListener("play", this.onPlay);
    this.emit("audiotrackschanged");
  }

  get tracks() {
    return (this.loaded ? this.player.getStreams() : [])
      .filter((s) => s.mediaType.toLowerCase() === "audio")
      .map((s, index) => ({
        id: String(s.id),
        index,
        sourceIndex: s.index,
        engine: "avplayer",
        label: s.metadata?.title || s.metadata?.language || `Audio ${index + 1}`,
        language: s.metadata?.language || "",
        selected: s.id === (this.pendingTrackId ?? this.player.getSelectedAudioStreamId()),
        codec:
          { 86018: "aac", 86019: "ac3", 86020: "dts", 86056: "eac3" }[s.codecparProxy.codecId] ||
          "",
        raw: { language: s.metadata?.language || "" }
      }));
  }
  get position() {
    return (
      this.pendingPosition ??
      this.pausedPosition ??
      Math.max(0, Number(this.player?.currentTime || 0) / 1000)
    );
  }
  get duration() {
    return this.loaded ? Math.max(0, Number(this.player.getDuration()) / 1000) : 0;
  }

  perform(action) {
    this.operation = this.operation
      .then(async () => {
        if (!this.destroyed) await this.guard(action());
      })
      .catch(() => {
        if (!this.destroyed) this.fail();
      });
    return this.operation;
  }
  fail() {
    if (this.failed) return;
    this.failed = true;
    this.emit("localaudioerror");
  }
  seek(position, track = null) {
    this.pendingPosition = position;
    if (track != null) this.pendingTrackId = Number(track);
    this.emit("waiting");
    return this.perform(async () => {
      const paused = this.video.paused;
      if (track != null) await this.guard(this.player.selectAudio(Number(track)));
      // Flush queued packets after changing MKV audio tracks as well as ordinary seeks.
      await this.guard(this.player.seek(BigInt(Math.round(position * 1000))));
      if (paused) {
        await this.player.pause();
        this.pausedPosition = position;
      }
      if (this.pendingPosition === position) this.pendingPosition = null;
      if (this.pendingTrackId === Number(track)) this.pendingTrackId = null;
      this.emit("audiotrackschanged");
      this.emit("seeked");
      if (!paused) this.emit("playing");
    });
  }
  async destroy() {
    this.destroyed = true;
    this.ready = false;
    this.reject(new Error("Playback was stopped."));
    this.video.removeEventListener("pause", this.onPause);
    this.video.removeEventListener("play", this.onPlay);
    if (this.video.srcObject === this.stream) {
      this.video.pause();
      this.video.srcObject = null;
    }
    this.stream.getTracks().forEach((track) => track.stop());
    await this.player?.destroy();
  }
}
