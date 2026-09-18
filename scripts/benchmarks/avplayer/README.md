# AVPlayer playback experiment

AVPlayer 1.3.1 can decode AC3, EAC3 and DTS audio locally while WebCodecs handles video. The EAC3 fixture was silent in Chrome's native player in all three trials; AVPlayer produced audio and switched between the two tracks in every trial.

This is a standalone experiment. It does not change Nuvio's normal player, dependencies or deployment. [Try the synthetic clips](https://nuvioweb.space/__media-tests/avplayer/manual.html).

## Results

Measured September 19, 2026: Windows 11, Ryzen 7 7700X, Chrome 153.0.8010.48, Playwright 1.63.0, headless. Each row is the median of three runs. Files were served over loopback; these are not TorBox or internet buffering measurements.

| Playback path                                   | First video / ready |   Seek | Switch audio | Audio verified |
| ----------------------------------------------- | ------------------: | -----: | -----------: | -------------: |
| AVPlayer canvas, 1080p H264 + EAC3              |              385 ms |  46 ms |        97 ms |            3/3 |
| AVPlayer canvas, 1080p H264 + AC3               |              634 ms |  72 ms |        73 ms |            3/3 |
| AVPlayer canvas, 1080p H264 + DTS               |              328 ms |  86 ms |        61 ms |            3/3 |
| AVPlayer MediaStream, 1080p H264 + EAC3         |              539 ms |  70 ms |        79 ms |            3/3 |
| AVPlayer canvas, 4K HEVC 10-bit SDR + EAC3      |              909 ms |  42 ms |       101 ms |            3/3 |
| AVPlayer MediaStream, 4K HEVC 10-bit SDR + EAC3 |              540 ms | 119 ms |       164 ms |            3/3 |
| Native browser, 1080p H264 + AAC MP4            |               54 ms |  49 ms |   Not tested |            3/3 |
| hls.js, preconverted H264 + AAC                 |              123 ms |  49 ms |   Not tested |            3/3 |
| Native browser, 1080p H264 + EAC3 MKV           |              385 ms |   9 ms |   Not tested |        **0/3** |

AVPlayer reported no decode errors or dropped video frames in these runs. Only audio decoder, resampler and stretch/pitch WASM modules were requested. No software video decoder was loaded. WebCodecs was enabled with hardware preference; this does not establish which GPU decoder the browser actually used.

An isolated run of the existing playback bridge on the Oracle ARM64 VPS took a median 908 ms to create a session, 781 ms to seek and 777 ms to change audio. It had 1.5 CPU cores and 1 GiB RAM. Those numbers include probing and preparation of the bridge's initial HLS buffer, but exclude browser loading and real authentication. The source was a synthetic file on the same VPS. They are not an end-to-end speed comparison with the local player. The hls.js row above starts with already converted files.

## What still blocks a default switch

- **Timing:** the flash/beep probe observed audio roughly 81-118 ms ahead of video in the 1080p canvas runs. MediaStream measured +18 ms, near the native AAC baseline of +21 ms. These are instrumented estimates with 20 ms sampling and a 2048-sample audio window, not physical speaker/display latency. MediaStream audio is measured before the final video element output, so its result does not prove perfect lip sync.
- **CPU:** instrumented renderer usage for EAC3 was 13.5% of one CPU core for canvas and 23.8% for MediaStream at 1080p; 13% and 53.8% at 4K. Pixel readback and probes contribute to that cost. This is not whole-device CPU, GPU usage or battery consumption. Reported JS heap excludes WASM/native/GPU memory.
- **Track changes:** switching an MKV track could leave queued audio behind video. The prototype re-seeks to the saved position after `selectAudio()`. Both track ID and the change from 440 Hz to 880 Hz are checked.
- **Devices and app integration:** real iPhone/Safari, Android, Xbox, long playback, subtitles, PiP, watch progress and real addon sources remain untested. The MediaStream path could retain Nuvio's video-element controls, but is not wired into them here. AVPlayer's canvas subtitle renderer is not available on that output path.
- **Networking:** a local decoder still needs access to the media bytes. CORS restrictions, expired links and HTTP 403 responses remain separate problems. Devices without a supported WebCodecs video decoder still need another path.

The six additional 1080p EAC3 trials with Chrome's 4x CPU throttle also produced audio and switched tracks. That throttle is not a mobile-device benchmark.

Recommendation: keep native playback first. Explore AVPlayer audio decoding as the next fallback, retaining the server for sources/devices it cannot handle. Validate timing on real devices before changing the default.

## Reproduce

From this directory, with Node 22+ and installed Chrome:

```sh
npm ci --ignore-scripts
npm run setup
```

Generate the synthetic 32-second clips with the existing playback image. The following commands use a POSIX shell; run them from this directory with Docker available:

```sh
docker build -t nuvio-avplayer-fixtures -f ../../../services/playback-bridge/Dockerfile ../../..
docker run --rm --user 0 --cpus=2 --memory=1g --entrypoint sh \
  -v "$PWD:/qa" nuvio-avplayer-fixtures /qa/generate.sh
# Optional 4K fixture:
docker run --rm --user 0 --cpus=2 --memory=3g --entrypoint sh \
  -v "$PWD:/qa" nuvio-avplayer-fixtures /qa/generate-4k.sh
npm run benchmark
npm run summarize
```

On PowerShell, use `${PWD}` in the volume argument and put each Docker command on one line. Shell scripts must use LF line endings.

The generated pattern flashes and beeps every two seconds. The audio tracks are labeled English (440 Hz) and Spanish (880 Hz). Each run plays for 6.5 seconds, seeks to 20 seconds, pauses/resumes, switches tracks, then checks audio and destroys the player. The 4K fixture is upscaled test content, not a high-bitrate film or HDR stress test.

```sh
RUN_LABEL=4k- node run.mjs avplayer:hevc-eac3-4k.mkv avstream:hevc-eac3-4k.mkv
RUN_LABEL=4k- npm run summarize
CPU_SLOWDOWN=4 RUN_LABEL=slow- node run.mjs avplayer:h264-eac3.mkv avstream:h264-eac3.mkv
RUN_LABEL=slow- npm run summarize
```

`TRIALS` defaults to 3. Each trial uses a fresh page/context, but the browser process is shared and OS caches may be warm. Startup uses AVPlayer's first-video event, or `play()` resolution for the native/HLS paths; seek uses API completion, not a measured screen refresh. `successful` means audio was detected and, where applicable, the second track's tone was detected. Inspect errors and timing separately. Raw samples are saved under ignored `results/`; the checked-in `measurements.json` records this run's summaries.

`server-bench.mjs` benchmarks a separate bridge instance on Linux with cgroup v2. It substitutes synthetic authentication and binds only to loopback. Never install it as a public service. Run it in a disposable container with the repository mounted at `/repo` and `BENCHMARK_SOURCE_URL` pointing to a publicly reachable copy of the generated EAC3 fixture. Set the same CPU/memory limits as above for comparable results.

## Publish or check the test page

```sh
node package-preview.mjs
# Serve public/ over HTTPS, then:
node manual-smoke.mjs https://your-host/path/manual.html
```

The smoke check uses actual button clicks without the benchmark's autoplay flag. It checks restart, pause/resume, seeking, language selection and cleanup across canvas, MediaStream and native playback, then checks a 390px viewport for overflow. It does not emulate Safari.

The preview only contains synthetic media and library assets. It uses no account, session token or playback bridge. Dependencies are isolated in this directory. AVPlayer is by Gaoxing Zhao, LGPL-3.0-or-later; `setup.mjs` pins the WASM source revision and `package-preview.mjs` includes its license and source link. [Upstream source and build recipes](https://github.com/zhaohappy/libmedia/tree/152f629d3021fd8013efa464fcb7b55f9fbe7753).
